import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { agentEnv, launch } from '../agents/process';
import { t } from '../domain/i18n';
import type { RemoteLauncher, RemotePayload } from './remote-link';

/**
 * `ssh` as irori runs it for an SSH host (ADR 061): the system's client, with the
 * person's own configuration, keys and agent. No prompt can be answered here, so
 * none is asked (`BatchMode`), and a connection that went quiet is noticed.
 * The destination is one argument after `--`, never an option.
 */
export const sshLauncher = (host: { destination: string; port?: number }): RemoteLauncher => ({
  run: (command) =>
    launch(
      'ssh',
      [
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=20',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=4',
        ...(host.port ? ['-p', String(host.port)] : []),
        '--',
        host.destination,
        command,
      ],
      os.homedir(),
      agentEnv(),
    ),
});

/**
 * The Node irori's vault host runs on, from nodejs.org. Each archive's size and
 * SHA-256 are pinned here as SHASUMS256.txt lists them for this release, so a
 * download that differs is refused before it is sent anywhere.
 */
export const hostNode = {
  version: 'v24.21.0',
  archives: {
    x64: {
      name: 'node-v24.21.0-linux-x64.tar.gz',
      size: 58088022,
      sha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
    },
    arm64: {
      name: 'node-v24.21.0-linux-arm64.tar.gz',
      size: 57824078,
      sha256: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
    },
  } as Record<string, { name: string; size: number; sha256: string }>,
};

const cannotDownload = () =>
  Error(
    t(
      'SSH ホストに送る Node をダウンロードできませんでした。',
      'Could not download the Node to send to the SSH host.',
    ),
  );
const mismatch = () =>
  Error(
    t(
      'ダウンロードした Node が想定のファイルと一致しませんでした。',
      'The downloaded Node did not match the expected file.',
    ),
  );

async function matches(file: string, release: { size: number; sha256: string }) {
  const info = await fs.stat(file).catch(() => undefined);
  if (!info?.isFile() || info.size !== release.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex') === release.sha256;
}

/** Downloads one pinned archive over HTTPS into `file`, which is there only once it matched. */
async function download(
  url: string,
  file: string,
  release: { size: number; sha256: string },
  request: typeof fetch,
) {
  const response = await request(url, {
    signal: AbortSignal.timeout(20 * 60_000),
    redirect: 'error',
    credentials: 'omit',
  }).catch(() => {
    throw cannotDownload();
  });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw cannotDownload();
  }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}`;
  const out = await fs.open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0;
  try {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read().catch(() => {
          throw cannotDownload();
        });
        if (done) break;
        size += value.byteLength;
        if (size > release.size) throw mismatch();
        hash.update(value);
        await out.write(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    await out.close();
    if (size !== release.size || hash.digest('hex') !== release.sha256) throw mismatch();
    await fs.rename(temporary, file);
  } finally {
    await out.close().catch(() => {});
    await fs.rm(temporary, { force: true });
  }
}

/**
 * What a released irori sends an SSH host: the vault host it was built with, and
 * the official Node, downloaded once to irori's data and checked before each use.
 * A run from source may name a Node on this device to send instead
 * (`IRORI_VAULT_HOST_NODE`), which the tests do; a packaged app never does.
 */
export function shippedPayload(options: {
  dataDir: string;
  /** The vault host's built file. */
  bundle: string;
  packaged: boolean;
  fetch?: typeof fetch;
}): RemotePayload {
  let bundle: ReturnType<RemotePayload['bundle']> | undefined;
  const fetching = new Map<string, Promise<string>>();
  return {
    bundle: () =>
      (bundle ??= fs.readFile(options.bundle).then((bytes) => ({
        version: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
        bytes,
      }))),
    nodeVersion: hostNode.version,
    async node(arch) {
      const local = !options.packaged && process.env.IRORI_VAULT_HOST_NODE;
      if (local) return { binary: local };
      const release = hostNode.archives[arch];
      if (!release) throw cannotDownload();
      const file = path.join(options.dataDir, 'vault-host', release.name);
      let ready = fetching.get(arch);
      if (!ready) {
        ready = (async () => {
          if (!(await matches(file, release)))
            await download(
              `https://nodejs.org/dist/${hostNode.version}/${release.name}`,
              file,
              release,
              options.fetch ?? fetch,
            );
          return file;
        })().finally(() => fetching.delete(arch));
        fetching.set(arch, ready);
      }
      return {
        archive: await ready,
        member: `${release.name.replace(/\.tar\.gz$/, '')}/bin/node`,
      };
    },
  };
}
