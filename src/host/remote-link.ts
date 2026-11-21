import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { t, type Language } from '../domain/i18n';
import type { HostEvent } from '../domain/types';
import { decode, encode, lineLimit, type Frame } from '../remote/wire';
import {
  attachedLine,
  busyLine,
  doneLine,
  failedLine,
  needsLine,
  replacingLine,
  type AttachReply,
} from '../remote/protocol';

/** Runs commands on one SSH host: each call is one login. */
export interface RemoteLauncher {
  /** Starts `command` in the host's shell; the child's pipes are the far process's. */
  run(command: string): ChildProcess;
  /** Whether the person is being asked something for a login now: that time is theirs, not the host's. */
  asking?(): boolean;
  /** Whether the person gave no answer to what a login asked, which ended it. */
  cancelled?(): boolean;
  /** Ends what is asked for logins that are over. */
  settle?(): void;
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
// The command is one word for the host's login shell, whatever shell that is:
// a POSIX script in single quotes, itself free of single quotes.
const script = (text: string) => `sh -c '${text}'`;

/**
 * Attaches to the vault host. Where it is not installed, says what is missing and
 * takes it from the same login: a line `archive|binary|bundle <bytes> [member]`,
 * then that many bytes, answered by a line each, and `go` to start. One login is
 * one sign-in, so a person asked for a password or a code is asked once.
 */
const starter = (version: string, node: string) => {
  const at = places(version, node);
  const failed = `{ echo ${failedLine}; exit 1; }`;
  return script(
    `umask 077; n="${at.node}"; b="${at.bundle}"; ` +
      `if [ ! -x "$n" ] || [ ! -f "$b" ]; then ` +
      `echo ${needsLine} "$(uname -s)" "$(uname -m)" $([ -x "$n" ] && echo node) $([ -f "$b" ] && echo bundle); ` +
      `go=; while read -r what size member; do case "$what" in ` +
      `archive) d="\${n%/node}"; w="$d.new"; rm -rf "$w"; mkdir -p "$w" && head -c "$size" | tar -xzf - -C "$w" "$member" && ` +
      `mkdir -p "$d" && mv "$w/$member" "$n" && chmod 700 "$n"; s=$?; rm -rf "$w"; [ $s -eq 0 ] || ${failed}; echo ${doneLine};; ` +
      `binary) mkdir -p "\${n%/node}" && head -c "$size" > "$n.new" && chmod 700 "$n.new" && mv "$n.new" "$n" || ${failed}; echo ${doneLine};; ` +
      `bundle) mkdir -p "\${b%/vault-host.cjs}" && head -c "$size" > "$b.new" && mv "$b.new" "$b" || ${failed}; echo ${doneLine};; ` +
      `go) go=1; break;; ` +
      `*) exit 1;; ` +
      `esac; done; [ -n "$go" ] || exit 1; fi; ` +
      `exec "$n" "$b" attach --data "${at.data}"`,
  );
};

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

  /**
   * One login: starts `ssh`, sends what the host says it lacks, and resolves once
   * the vault host answers. Whatever the login shell prints first is passed over.
   */
  private login(bundle: { version: string; bytes: Buffer }, node: string) {
    const { launcher, payload, onProgress } = this.options;
    const child = launcher.run(starter(bundle.version, node));
    let err = '';
    child.stderr!.on('data', (chunk) => (err = (err + chunk).slice(-4000)));
    child.stdin!.on('error', () => {});
    let buffer = '';
    let attached = false;
    return new Promise<ChildProcess>((resolve, reject) => {
      let over = false;
      const failed = (message?: string) => {
        if (over) return;
        over = true;
        clearInterval(timer);
        if (!attached) child.kill();
        reject(
          launcher.cancelled?.()
            ? new LoginCancelled()
            : Error(
                message ??
                  t(
                    `SSH で接続できませんでした。\n${reason(err)}`,
                    `Could not connect over SSH.\n${reason(err)}`,
                  ),
              ),
        );
      };
      // How long the host may stay silent. While the person is asked for a password
      // or a code, or a part is on its way, the time is not the host's.
      let quiet = 0;
      let sending = false;
      const timer = setInterval(() => {
        if (attached || sending || launcher.asking?.()) quiet = 0;
        else if (++quiet >= 90) failed();
      }, 1000);
      /** Resolves with the next line the starter says of a part: in place, or not. */
      let part: ((placed: boolean) => void) | undefined;
      const send = async (header: string, source: Readable, total: number, label: string) => {
        const placed = new Promise<boolean>((done) => (part = done));
        let sent = 0;
        let shown = -1;
        source.on('data', (chunk: Buffer) => {
          sent += chunk.length;
          const step = Math.floor((sent / total) * 20);
          if (step === shown) return;
          shown = step;
          onProgress(`${label} (${megabytes(sent)} / ${megabytes(total)} MB)`);
        });
        source.on('error', () => failed());
        sending = true;
        child.stdin!.write(`${header}\n`);
        // The login goes on after this part: its input stays open.
        source.pipe(child.stdin!, { end: false });
        const ok = await placed;
        sending = false;
        if (!ok)
          throw Error(
            t(
              `SSH ホストに irori の部品を置けませんでした。\n${reason(err)}`,
              `Could not put irori's files on the SSH host.\n${reason(err)}`,
            ),
          );
      };
      const install = async ([system, machine, ...there]: string[]) => {
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
          const { size } = await fs.stat(file);
          await send(
            'archive' in runtime ? `archive ${size} ${runtime.member}` : `binary ${size}`,
            createReadStream(file),
            size,
            t('Node を送っています', 'Sending Node'),
          );
        }
        if (!there.includes('bundle'))
          await send(
            `bundle ${bundle.bytes.length}`,
            Readable.from([bundle.bytes]),
            bundle.bytes.length,
            t('irori の vault host を送っています', "Sending irori's vault host"),
          );
        onProgress(t('vault host を起動しています', 'Starting the vault host'));
        child.stdin!.write('go\n');
      };
      child.once('error', (error) =>
        failed(
          t(
            `ssh を起動できませんでした（${error.message}）。OpenSSH クライアントが必要です。`,
            `Could not start ssh (${error.message}). The OpenSSH client is needed.`,
          ),
        ),
      );
      child.once('close', () => {
        if (attached) return this.ended(child);
        // A part on its way says itself that it could not be put there.
        if (part) return part(false);
        failed();
      });
      let installing = false;
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > lineLimit) {
          buffer = '';
          if (attached) child.kill();
          else failed();
          return;
        }
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at).replace(/\r$/, '');
          buffer = buffer.slice(at + 1);
          if (attached) {
            this.received(child, line);
            continue;
          }
          quiet = 0;
          if (line === attachedLine) {
            attached = true;
            over = true;
            clearInterval(timer);
            resolve(child);
          } else if (line === doneLine || line === failedLine) {
            part?.(line === doneLine);
            part = undefined;
          } else if (line === replacingLine)
            onProgress(t('vault host を入れ替えています', 'Replacing the vault host'));
          else if (line === busyLine)
            failed(
              t(
                'この SSH ホストでは、別のバージョンの irori がエージェントを実行中です。終わってから接続します。',
                'Another version of irori is running an agent on this SSH host. irori connects once it finishes.',
              ),
            );
          else if (line.startsWith(`${needsLine} `) && !installing) {
            installing = true;
            install(line.split(' ').slice(1)).catch((error: Error) => failed(error.message));
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

  /**
   * Connects in one login, in which what is missing is installed and a vault host of
   * another version gives way; resolves with what the vault host says of itself.
   */
  async connect(): Promise<AttachReply> {
    const { payload, launcher, onProgress } = this.options;
    const bundle = await payload.bundle();
    onProgress(t('SSH で接続しています', 'Connecting over SSH'));
    try {
      this.child = await this.login(bundle, payload.nodeVersion);
    } finally {
      // Nothing is asked for a login that is over, whichever way it ended.
      launcher.settle?.();
    }
    this.open = true;
    const reply = await this.request<AttachReply>('$attach', [
      {
        version: bundle.version,
        language: this.options.language(),
        ...(this.seq !== undefined && { resume: this.seq }),
      },
    ]);
    if (reply.version !== bundle.version) {
      this.close();
      throw Error(
        t(
          'SSH ホストで vault host を起動できませんでした。',
          'The vault host did not start on the SSH host.',
        ),
      );
    }
    if (!reply.resumed) this.seq = reply.seq;
    this.seq ??= reply.seq;
    return reply;
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

/** The person gave no answer to what `ssh` asked, so the login was ended. */
export class LoginCancelled extends Error {
  constructor() {
    super(
      t(
        '入力を取り消したため、接続していません。もう一度接続すると、あらためて尋ねます。',
        'Not connected: the question was cancelled. Connecting again asks again.',
      ),
    );
  }
}

/** The connection to the SSH host ended while an answer was awaited. */
export class ConnectionEnded extends Error {
  constructor() {
    super(t('SSH ホストとの接続が切れました。', 'The connection to the SSH host ended.'));
  }
}
