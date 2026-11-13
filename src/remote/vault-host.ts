// irori's vault host: the process that keeps irori's services for the vaults on
// an SSH host (ADR 061). The person's device starts it through `ssh`:
//
//   vault-host.cjs attach --data <folder>
//     joins its input and output to the vault host of that folder, starting one
//     when none answers;
//   vault-host.cjs serve --data <folder>
//     is that vault host. It listens on a socket only its user can open, goes on
//     while an agent works after the connection has gone, and ends by itself
//     once nothing has run, no report waits to be collected and no device has
//     been attached for a while.
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { setLanguage } from '../domain/i18n';
import type { HostEvent } from '../domain/types';
import { createVaultHost, type HostQuestion } from './host';
import { attachRequest, attachedLine, type AttachReply } from './protocol';
import { readFrames, writeFrame } from './wire';

/**
 * The version of this vault host: the digest of its one built file, which the
 * person's device computes of the same bytes before it sends them. A run from
 * source has none.
 */
const vaultHostVersion = /\.cjs$/.test(process.argv[1] ?? '')
  ? createHash('sha256').update(readFileSync(process.argv[1])).digest('hex').slice(0, 16)
  : 'source';

/** How many events are kept for a device that attaches again. */
const eventsKept = 2000;
/** How long the vault host stays with nothing running, no report waiting and no device attached. */
const idleDefault = 15 * 60_000;
/** A host started this recently may not listen yet; it is not taken for a dead one. */
const startingFor = 15_000;

const connect = (socketPath: string) =>
  new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });

/** One vault host per folder: takes the folder's pid file, unless a host there lives or is starting. */
async function takePlace(dataDir: string, socketPath: string) {
  const file = path.join(dataDir, 'host.pid');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const answering = await connect(socketPath).then(
      (socket) => (socket.destroy(), true),
      () => false,
    );
    if (answering) return undefined;
    const written = await fs.stat(file).then(
      (info) => info.mtimeMs,
      () => 0,
    );
    if (Date.now() - written < startingFor) return undefined;
    // Left by a host that ended without tidying up.
    await fs.rm(file, { force: true });
  }
  return undefined;
}

async function serve(dataDir: string) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.chmod(dataDir, 0o700);
  const socketPath = path.join(dataDir, 'host.sock');
  const pidFile = await takePlace(dataDir, socketPath);
  if (!pidFile) return;
  await fs.rm(socketPath, { force: true });

  let seq = 0;
  const recent: { seq: number; event: HostEvent }[] = [];
  /** The device attached now; there is one at a time, the newest. */
  let device: net.Socket | undefined;
  let lastAttached = Date.now();
  let asked = 0;
  const questions = new Map<number, { question: HostQuestion; answer(value: unknown): void }>();
  const emit = (event: HostEvent) => {
    const frame = { seq: ++seq, event };
    recent.push(frame);
    if (recent.length > eventsKept) recent.shift();
    if (device) writeFrame(device, frame);
  };
  const put = (number: number, { question, params }: HostQuestion) =>
    device && writeFrame(device, { ask: number, question, params });
  const host = await createVaultHost({
    dataDir,
    emit,
    // A question waits for a device: one that attaches later is asked it then.
    ask: (question) =>
      new Promise((answer) => {
        const number = ++asked;
        questions.set(number, { question, answer });
        put(number, question);
      }),
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await host.close().catch(() => {});
    await fs.rm(socketPath, { force: true }).catch(() => {});
    await fs.rm(pidFile, { force: true }).catch(() => {});
    // The device is let go last: once its connection ends, another vault host may take this place.
    device?.destroy();
    process.exit(0);
  };

  const server = net.createServer((socket) => {
    readFrames(
      socket,
      async (frame) => {
        if ('answer' in frame) {
          if (device !== socket) return;
          questions.get(frame.answer)?.answer(frame.value);
          questions.delete(frame.answer);
          return;
        }
        if (!('method' in frame)) return;
        const { id, method, args } = frame;
        try {
          if (method === '$attach') {
            const request = attachRequest.parse(args[0]);
            setLanguage(request.language);
            if (device && device !== socket) device.destroy();
            device = socket;
            lastAttached = Date.now();
            const after = request.resume ?? seq;
            const missed = recent.filter((item) => item.seq > after);
            const reply: AttachReply = {
              version: vaultHostVersion,
              about: host.about(),
              seq,
              // Every event after `resume` is still kept, or some have been dropped.
              resumed: after >= seq || missed[0]?.seq === after + 1,
              running: host.running,
            };
            writeFrame(socket, { id, ok: true, value: reply });
            for (const item of missed) writeFrame(socket, item);
            for (const [number, { question }] of questions) put(number, question);
            return;
          }
          if (device !== socket) throw Error('Not attached');
          if (method === '$shutdown') {
            writeFrame(socket, { id, ok: true });
            return void stop();
          }
          writeFrame(socket, { id, ok: true, value: await host.call(method, args) });
        } catch (error) {
          writeFrame(socket, {
            id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      () => {
        if (device === socket) {
          device = undefined;
          lastAttached = Date.now();
        }
        socket.destroy();
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await fs.chmod(socketPath, 0o600);

  const idle = Number(process.env.IRORI_VAULT_HOST_IDLE_MS) || idleDefault;
  setInterval(
    () => {
      // A report not yet collected is a reason to stay, as a run is: its device may be away for hours.
      if (device || host.running || host.waiting) lastAttached = Date.now();
      else if (Date.now() - lastAttached >= idle) void stop();
    },
    Math.min(idle, 30_000),
  );
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  // The login that started this host ending is not a reason to stop.
  process.on('SIGHUP', () => {});
}

async function attach(dataDir: string) {
  const socketPath = path.join(dataDir, 'host.sock');
  let socket = await connect(socketPath).catch(() => undefined);
  if (!socket) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const logFile = path.join(dataDir, 'host.log');
    // The log starts over once it has grown; it is for finding why a host did not start.
    const size = await fs.stat(logFile).then(
      (info) => info.size,
      () => 0,
    );
    const log = await fs.open(logFile, size > 1024 * 1024 ? 'w' : 'a', 0o600);
    // With the options this process was started with, which a run from source needs.
    spawn(process.execPath, [...process.execArgv, process.argv[1], 'serve', '--data', dataDir], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    }).unref();
    await log.close();
    for (let tries = 0; tries < 150 && !socket; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      socket = await connect(socketPath).catch(() => undefined);
    }
    if (!socket) {
      process.stderr.write(`irori: the vault host did not start; see ${logFile}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`${attachedLine}\n`);
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on('close', () => process.exit(0));
  socket.on('error', () => process.exit(1));
  process.stdin.on('end', () => socket.end());
}

async function main() {
  const [mode] = process.argv.slice(2);
  const at = process.argv.indexOf('--data');
  const dataDir = at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : undefined;
  if (!dataDir || (mode !== 'serve' && mode !== 'attach')) {
    process.stderr.write('usage: vault-host (serve|attach) --data <folder>\n');
    process.exit(2);
  }
  if (mode === 'attach') return attach(dataDir);
  // Standard output is the log; what modules print stays readable there.
  await serve(dataDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
