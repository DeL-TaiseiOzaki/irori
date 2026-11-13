import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { t, type Language } from '../domain/i18n';
import type { HostEvent } from '../domain/types';
import { decode, encode, type Frame } from '../remote/wire';
import { attachedLine, needsLine, type AttachReply } from '../remote/protocol';

/** Runs commands on one SSH host: each call is one login. */
export interface RemoteLauncher {
  /** Starts `command` in the host's shell; the child's pipes are the far process's. */
  run(command: string): ChildProcess;
}

/** What this device sends an SSH host so that irori's vault host runs there. */
export interface RemotePayload {
  /** The vault host's one file, and its version: the digest of those bytes. */
  bundle(): Promise<{ version: string; bytes: Buffer }>;
  /** The version of Node the vault host runs on, as the folder it is kept in is named. */
  nodeVersion: string;
  /**
   * That Node for a Linux host of this architecture: an archive of the official
   * distribution with the path of `node` inside it, or the program itself.
   */
  node(arch: string): Promise<{ archive: string; member: string } | { binary: string }>;
}

/** Everything of irori's on an SSH host is under this folder of the person's home there. */
const base = '$HOME/.irori-host';
const places = (version: string, node: string) => ({
  node: `${base}/node/${node}/node`,
  bundle: `${base}/bin/${version}/vault-host.cjs`,
  data: `${base}/data`,
});
/** The line an install prints when everything it was sent is in place. */
const doneLine = 'IRORI-DONE';

// Each command is one word for the host's login shell, whatever shell that is:
// a POSIX script in single quotes, itself free of single quotes.
const script = (text: string) => `sh -c '${text}'`;

/** Attaches to the vault host, or says what is missing for it to start. */
const starter = (version: string, node: string) => {
  const at = places(version, node);
  return script(
    `umask 077; n="${at.node}"; b="${at.bundle}"; ` +
      `if [ -x "$n" ] && [ -f "$b" ]; then exec "$n" "$b" attach --data "${at.data}"; fi; ` +
      `echo ${needsLine} "$(uname -s)" "$(uname -m)" $([ -x "$n" ] && echo node) $([ -f "$b" ] && echo bundle)`,
  );
};
const installBundle = (version: string) =>
  script(
    `umask 077; d="${base}/bin/${version}"; mkdir -p "$d" && cat > "$d/vault-host.cjs.new" && ` +
      `mv "$d/vault-host.cjs.new" "$d/vault-host.cjs" && echo ${doneLine}`,
  );
const installNodeArchive = (node: string, member: string) =>
  script(
    `umask 077; d="${base}/node/${node}"; w="$d.new"; rm -rf "$w"; mkdir -p "$w" && ` +
      `tar -xzf - -C "$w" "${member}" && mkdir -p "$d" && mv "$w/${member}" "$d/node" && chmod 700 "$d/node"; ` +
      `s=$?; rm -rf "$w"; [ $s -eq 0 ] && echo ${doneLine}`,
  );
const installNodeBinary = (node: string) =>
  script(
    `umask 077; d="${base}/node/${node}"; mkdir -p "$d" && cat > "$d/node.new" && ` +
      `chmod 700 "$d/node.new" && mv "$d/node.new" "$d/node" && echo ${doneLine}`,
  );

/** The kinds of host irori's vault host runs on. */
const architectures: Record<string, string> = {
  x86_64: 'x64',
  amd64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
};

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));
/** The end of what `ssh` or the host wrote to standard error, as the reason to show. */
const reason = (stderr: string) => stderr.trim().split('\n').slice(-4).join('\n').slice(-600);

export interface RemoteLinkOptions {
  launcher: RemoteLauncher;
  payload: RemotePayload;
  language(): Language;
  onEvent(event: HostEvent): void;
  /** Answers what the vault host asks the person. */
  ask(question: string, params: unknown): Promise<unknown>;
  /** What is being done to connect, to show while it takes time. */
  onProgress(detail: string): void;
  /** The connection ended after it was open, by itself or because `close` was called. */
  onClosed(): void;
}

/**
 * One connection to an SSH host's vault host (ADR 061): the system's `ssh` with
 * the vault host on its pipes. Opening it installs what is missing on the host,
 * and replaces a vault host of another version once nothing runs on it.
 */
export class RemoteLink {
  private child?: ChildProcess;
  private next = 0;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; first?(value: unknown): void }
  >();
  private open = false;
  /** The number of the last event received, to go on from when attaching again. */
  seq?: number;
  constructor(private options: RemoteLinkOptions) {}

  /** Sends bytes to a command on the host and resolves once it says they are in place. */
  private async install(command: string, source: Readable, total: number, label: string) {
    const child = this.options.launcher.run(command);
    let out = '';
    let err = '';
    child.stdout!.on('data', (chunk) => (out = (out + chunk).slice(-4000)));
    child.stderr!.on('data', (chunk) => (err = (err + chunk).slice(-4000)));
    let sent = 0;
    let shown = -1;
    source.on('data', (chunk: Buffer) => {
      sent += chunk.length;
      const step = Math.floor((sent / total) * 20);
      if (step === shown) return;
      shown = step;
      this.options.onProgress(`${label} (${megabytes(sent)} / ${megabytes(total)} MB)`);
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    source.on('error', () => child.kill());
    child.stdin!.on('error', () => {});
    source.pipe(child.stdin!);
    const code = await exited;
    if (code !== 0 || !out.includes(doneLine))
      throw Error(
        t(
          `SSH ホストに irori の部品を置けませんでした。\n${reason(err)}`,
          `Could not put irori's files on the SSH host.\n${reason(err)}`,
        ),
      );
  }

  /** Starts `ssh` and reads up to the line that says whether the vault host answered. */
  private start(command: string) {
    const child = this.options.launcher.run(command);
    let err = '';
    child.stderr!.on('data', (chunk) => (err = (err + chunk).slice(-4000)));
    let buffer = '';
    let attached = false;
    return new Promise<{ child: ChildProcess; needs?: string[] }>((resolve, reject) => {
      const failed = (message?: string) =>
        reject(
          Error(
            message ??
              t(
                `SSH で接続できませんでした。\n${reason(err)}`,
                `Could not connect over SSH.\n${reason(err)}`,
              ),
          ),
        );
      const timer = setTimeout(() => {
        child.kill();
        failed();
      }, 90_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        failed(
          t(
            `ssh を起動できませんでした（${error.message}）。OpenSSH クライアントが必要です。`,
            `Could not start ssh (${error.message}). The OpenSSH client is needed.`,
          ),
        );
      });
      child.once('close', () => {
        clearTimeout(timer);
        if (attached) this.ended(child);
        else failed();
      });
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buffer += chunk;
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at).replace(/\r$/, '');
          buffer = buffer.slice(at + 1);
          if (attached) {
            this.received(child, line);
            continue;
          }
          // Whatever the login shell printed first is passed over.
          if (line === attachedLine) {
            attached = true;
            clearTimeout(timer);
            resolve({ child });
          } else if (line.startsWith(`${needsLine} `)) {
            clearTimeout(timer);
            resolve({ child, needs: line.split(' ').slice(1) });
          }
        }
      });
    });
  }

  private received(child: ChildProcess, line: string) {
    if (child !== this.child || !line.trim()) return;
    let frame: Frame;
    try {
      frame = decode(line);
    } catch {
      // Not the vault host's words: the connection cannot be trusted further.
      return void child.kill();
    }
    if ('seq' in frame) {
      this.seq = frame.seq;
      this.options.onEvent(frame.event as HostEvent);
    } else if ('ask' in frame) {
      const { ask } = frame;
      void this.options
        .ask(frame.question, frame.params)
        .catch(() => false)
        .then((value) => this.write({ answer: ask, value }));
    } else if ('ok' in frame) {
      const waiting = this.pending.get(frame.id);
      this.pending.delete(frame.id);
      if (!waiting) return;
      if (frame.ok) {
        // Before the events that follow in the same read are handed on.
        waiting.first?.(frame.value);
        waiting.resolve(frame.value);
      } else waiting.reject(Error(frame.error));
    }
  }

  private ended(child: ChildProcess) {
    if (child !== this.child) return;
    this.child = undefined;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const item of waiting) item.reject(new ConnectionEnded());
    if (!this.open) return;
    this.open = false;
    this.options.onClosed();
  }

  private write(frame: Frame) {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return false;
    stdin.write(encode(frame));
    return true;
  }

  /**
   * Asks the vault host. `first` gets the answer before any event that arrived
   * with it, for a caller that must be listening by then.
   */
  request<T>(method: string, args: unknown[], first?: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        first: first as ((value: unknown) => void) | undefined,
      });
      if (!this.write({ id, method, args })) {
        this.pending.delete(id);
        reject(new ConnectionEnded());
      }
    });
  }

  /** Connects, installing and replacing what is needed; resolves with what the vault host says of itself. */
  async connect(): Promise<AttachReply> {
    const { payload, onProgress } = this.options;
    const bundle = await payload.bundle();
    const node = payload.nodeVersion;
    for (let attempt = 0; attempt < 4; attempt++) {
      onProgress(t('SSH で接続しています', 'Connecting over SSH'));
      const started = await this.start(starter(bundle.version, node));
      if (started.needs) {
        const [system, machine, ...there] = started.needs;
        const arch = architectures[machine];
        if (system !== 'Linux' || !arch)
          throw Error(
            t(
              `この SSH ホスト（${system} ${machine}）にはまだ対応していません。Linux の x64 と arm64 で動きます。`,
              `This SSH host (${system} ${machine}) is not supported yet. Linux on x64 and arm64 is.`,
            ),
          );
        if (!there.includes('node')) {
          onProgress(t('Node を用意しています', 'Getting Node ready'));
          const runtime = await payload.node(arch);
          const file = 'archive' in runtime ? runtime.archive : runtime.binary;
          await this.install(
            'archive' in runtime
              ? installNodeArchive(node, runtime.member)
              : installNodeBinary(node),
            createReadStream(file),
            (await fs.stat(file)).size,
            t('Node を送っています', 'Sending Node'),
          );
        }
        if (!there.includes('bundle'))
          await this.install(
            installBundle(bundle.version),
            Readable.from([bundle.bytes]),
            bundle.bytes.length,
            t('irori の vault host を送っています', "Sending irori's vault host"),
          );
        continue;
      }
      this.child = started.child;
      this.open = true;
      const reply = await this.request<AttachReply>('$attach', [
        {
          version: bundle.version,
          language: this.options.language(),
          ...(this.seq !== undefined && { resume: this.seq }),
        },
      ]);
      if (reply.version === bundle.version) {
        if (!reply.resumed) this.seq = reply.seq;
        this.seq ??= reply.seq;
        return reply;
      }
      // A vault host of another version answered: it gives way once nothing runs on it.
      if (reply.running) {
        this.close();
        throw Error(
          t(
            'この SSH ホストでは、別のバージョンの irori がエージェントを実行中です。終わってから接続します。',
            'Another version of irori is running an agent on this SSH host. irori connects once it finishes.',
          ),
        );
      }
      onProgress(t('vault host を入れ替えています', 'Replacing the vault host'));
      const closed = new Promise<void>((resolve) => started.child.once('close', () => resolve()));
      this.open = false;
      await this.request('$shutdown', []).catch(() => {});
      await closed;
      this.seq = undefined;
    }
    throw Error(
      t(
        'SSH ホストで vault host を起動できませんでした。',
        'The vault host did not start on the SSH host.',
      ),
    );
  }

  /** Ends the connection; the vault host goes on by itself while an agent works there. */
  close() {
    const child = this.child;
    if (!child) return;
    this.open = false;
    child.stdin?.end();
    // A host that does not let go is not waited for.
    setTimeout(() => child.kill(), 3000).unref();
  }
  get connected() {
    return this.open && !!this.child;
  }
}

/** The connection to the SSH host ended while an answer was awaited. */
export class ConnectionEnded extends Error {
  constructor() {
    super(t('SSH ホストとの接続が切れました。', 'The connection to the SSH host ended.'));
  }
}
