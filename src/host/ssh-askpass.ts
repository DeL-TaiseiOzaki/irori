import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import writeFileAtomic from 'write-file-atomic';
import { commandLaunchers } from '../agents/command-bridge';

/*
 * What `ssh` asks while it signs in is answered in irori's window (ADR 061,
 * amended): a password, a key's passphrase, a verification code, whether to
 * trust a host's key. `ssh` has no terminal here, so it runs the program named
 * by SSH_ASKPASS with its question as the argument and reads the answer from
 * that program's output. The program is a small client of irori's own: it hands
 * the question to this process and prints what the person answered. The `ssh`
 * a jump host is reached with inherits the environment, so its questions come
 * the same way.
 *
 * The client reaches this process through a socket in a folder only the person
 * can open (a named pipe on Windows), never a network port. On Windows the
 * client is a program of its own (`native/askpass/Askpass.cs`): there `ssh`
 * starts SSH_ASKPASS with the question written after it unquoted, so a script,
 * which Windows would hand to cmd.exe, would let a host's words run as commands.
 *
 * An answer is passed on and kept nowhere: not in a file, a log or a setting.
 */

/** What `ssh` asks for one login, as it words it. */
export interface LoginQuestion {
  text: string;
  /**
   * How `ssh` wants it answered (SSH_ASKPASS_PROMPT): nothing for words to type,
   * `confirm` for yes or no, `none` for a notice that takes no answer.
   */
  hint: '' | 'confirm' | 'none';
}

/** The answer to a question: the words, or nothing when the person gives none and the login is to end. */
export type AskLogin = (question: LoginQuestion, gone: AbortSignal) => Promise<string | undefined>;

/** The logins of one connection attempt that may ask the person. */
export interface LoginSession {
  /** What `ssh` is started with so that its questions come here. */
  env: NodeJS.ProcessEnv;
  /**
   * Where `ssh` is started so that it finds the program by its name alone (Windows): a
   * folder put first on its search path, and the folder it runs in.
   */
  found?: { searchPath: string; cwd: string };
  /** Whether a question is waiting for the person now. */
  asking(): boolean;
  /** Whether the person gave no answer to one, which ends the attempt. */
  cancelled(): boolean;
  /** Called when the person gives no answer: `ssh` would only ask again, so it is stopped. */
  onCancel(stop: () => void): void;
  /** The attempt is over: nothing more is asked for it, and what was is taken back. */
  settle(): void;
}

/** The longest question read and the longest answer given, in bytes. */
const limits = { question: 16 * 1024, answer: 4096 };

/*
 * Between the client and this process, on one connection:
 *   client: a length in four bytes, least significant first, then that many bytes
 *           of UTF-8: the session, a line break, ssh's hint, a line break, the question;
 *   here:   one byte, 1 for an answer and 0 for none, then a length as above and
 *           the answer in UTF-8.
 */
const client = `'use strict';
const net = require('node:net');
const address = process.env.IRORI_SSH_ASKPASS;
const session = process.env.IRORI_SSH_ASKPASS_SESSION;
if (!address || !session) process.exit(1);
const body = Buffer.from(
  session + '\\n' + String(process.env.SSH_ASKPASS_PROMPT || '') + '\\n' + process.argv.slice(2).join(' '),
  'utf8',
);
const head = Buffer.alloc(4);
head.writeUInt32LE(body.length);
const socket = net.connect(address);
let reply = Buffer.alloc(0);
let answered = false;
socket.on('error', () => process.exit(1));
socket.on('connect', () => socket.write(Buffer.concat([head, body])));
socket.on('data', (chunk) => {
  if (answered) return;
  reply = Buffer.concat([reply, chunk]);
  if (reply.length < 5) return;
  const length = reply.readUInt32LE(1);
  if (reply[0] !== 1) process.exit(1);
  if (reply.length < 5 + length) return;
  answered = true;
  process.stdout.write(reply.subarray(5, 5 + length).toString('utf8') + '\\n', () => process.exit(0));
});
socket.on('close', () => answered || process.exit(1));
`;

/** A question's text as it may be shown: printable, free of bidi spoofing, and no longer than a screen takes. */
const shownText = (value: string) =>
  value
    // Control and bidi format characters would let a host redraw or spoof what the person reads; line breaks and tabs stay.
    .replace(/[^\P{Cc}\n\t]|\p{Cf}/gu, '')
    .slice(0, 4000)
    .trim();

type Session = {
  ask: AskLogin;
  open: Set<AbortController>;
  cancelled: boolean;
  stop?: () => void;
};

export interface SshAskpassOptions {
  /** irori's data folder: the client's script is kept in it. */
  dataDir: string;
  /** What runs the client's script as Node: irori's own program. */
  runtime?: string;
  /** The client for Windows, a program of its own; without it nothing can be asked there. */
  windowsClient?: string;
  platform?: NodeJS.Platform;
}

export class SshAskpass {
  private program?: string;
  private found?: { searchPath: string; cwd: string };
  private address?: string;
  private server?: net.Server;
  private folder?: string;
  private sessions = new Map<string, Session>();
  constructor(private options: SshAskpassOptions) {}

  /**
   * Puts the client where `ssh` can run it and starts listening; before any
   * session. Where there is no client to run (Windows without its program),
   * `available` stays false and logins ask nothing.
   */
  async init() {
    const { dataDir, runtime = process.execPath, platform = process.platform } = this.options;
    if (platform === 'win32') {
      const built = this.options.windowsClient;
      if (
        !built ||
        !(await stat(built).then(
          (info) => info.isFile(),
          () => false,
        ))
      )
        return;
      // Win32-OpenSSH does not start a program whose path has letters outside the system's
      // own code page in it, as a person's folder may (seen with 9.5: CreateProcessW
      // error 2). So `ssh` is given the program's name alone and finds it on its search
      // path, which Windows hands on as it is. It is started in a folder of irori's data,
      // where nothing of that name is: Windows looks there before the search path.
      const cwd = path.join(dataDir, 'ssh');
      await mkdir(cwd, { recursive: true });
      this.program = path.basename(built);
      this.found = { searchPath: path.dirname(built), cwd };
      this.address = `\\\\.\\pipe\\irori-ssh-${randomBytes(16).toString('hex')}`;
    } else {
      const directory = path.join(dataDir, 'ssh');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const script = path.join(directory, 'askpass.cjs');
      await writeFileAtomic(script, client, { mode: 0o600 });
      this.program = path.join(directory, 'askpass');
      await writeFileAtomic(
        this.program,
        commandLaunchers(
          "hands irori what ssh asks while it signs in, and prints the person's answer.",
          runtime,
          script,
        ).posix,
        { mode: 0o700 },
      );
      await chmod(this.program, 0o700);
      // A socket's path is short on every system: a folder of this process's own, not the data folder.
      this.folder = await mkdtemp(path.join(os.tmpdir(), 'irori-ssh-'));
      this.address = path.join(this.folder, 's');
    }
    const server = net.createServer((socket) => this.serve(socket));
    server.maxConnections = 16;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.address, resolve);
    });
    this.server = server;
  }
  /** Whether what `ssh` asks can be asked here. */
  get available() {
    return !!this.server;
  }

  private serve(socket: net.Socket) {
    let buffer = Buffer.alloc(0);
    let read = false;
    const gone = new AbortController();
    const refuse = () => socket.destroy();
    socket.setTimeout(10_000, refuse);
    socket.on('error', () => {});
    socket.on('close', () => gone.abort());
    socket.on('data', (chunk) => {
      if (read) return;
      if (buffer.length + chunk.length > 4 + limits.question) return refuse();
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (length > limits.question) return refuse();
      if (buffer.length < 4 + length) return;
      read = true;
      socket.setTimeout(0);
      const [id, hint, ...rest] = buffer
        .subarray(4, 4 + length)
        .toString('utf8')
        .split('\n');
      buffer = Buffer.alloc(0);
      const session = this.sessions.get(id);
      if (!session) return refuse();
      void this.answer(session, socket, gone, {
        text: shownText(rest.join('\n')),
        hint: hint === 'confirm' || hint === 'none' ? hint : '',
      });
    });
  }
  private async answer(
    session: Session,
    socket: net.Socket,
    gone: AbortController,
    question: LoginQuestion,
  ) {
    // The client that goes away, or the attempt that ends, takes its question with it.
    session.open.add(gone);
    let answer: string | undefined;
    try {
      answer = await Promise.race([
        session.ask(question, gone.signal),
        new Promise<undefined>((resolve) =>
          gone.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
        ),
      ]);
    } catch {
      answer = undefined;
    }
    session.open.delete(gone);
    if (gone.signal.aborted) return void socket.destroy();
    const words = Buffer.from(answer ?? '', 'utf8').subarray(0, limits.answer);
    const reply = Buffer.alloc(5 + words.length);
    reply[0] = answer === undefined ? 0 : 1;
    reply.writeUInt32LE(words.length, 1);
    words.copy(reply, 5);
    socket.end(reply, () => {
      words.fill(0);
      reply.fill(0);
    });
    if (answer !== undefined) return;
    // No answer is not a wrong answer: `ssh` would ask again, so the attempt ends here.
    session.cancelled = true;
    session.stop?.();
  }

  /** A session for one connection attempt; `ask` shows the person each question. */
  session(ask: AskLogin): LoginSession | undefined {
    if (!this.program || !this.address || !this.server) return undefined;
    const id = randomBytes(16).toString('hex');
    const state: Session = { ask, open: new Set(), cancelled: false };
    this.sessions.set(id, state);
    return {
      env: {
        SSH_ASKPASS: this.program,
        // Asked through the program whether or not there is a terminal (OpenSSH 8.4 and later).
        SSH_ASKPASS_REQUIRE: 'force',
        // Before 8.4 the program is used when there is no terminal and a display is named.
        DISPLAY: process.env.DISPLAY || ':0',
        IRORI_SSH_ASKPASS: this.address,
        IRORI_SSH_ASKPASS_SESSION: id,
      },
      ...(this.found && { found: this.found }),
      asking: () => state.open.size > 0,
      cancelled: () => state.cancelled,
      onCancel: (stop) => {
        state.stop = stop;
      },
      settle: () => {
        this.sessions.delete(id);
        for (const gone of state.open) gone.abort();
        state.open.clear();
      },
    };
  }

  async close() {
    for (const state of this.sessions.values()) for (const gone of state.open) gone.abort();
    this.sessions.clear();
    this.server?.close();
    this.server = undefined;
    if (this.folder) await rm(this.folder, { recursive: true, force: true }).catch(() => {});
  }
}
