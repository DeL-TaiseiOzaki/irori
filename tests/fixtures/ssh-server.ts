import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import ssh2 from 'ssh2';

const { Server, utils } = ssh2;

/**
 * An SSH server on a loopback port that the system's `ssh` signs in to, for
 * what a host asks while it does: each of `asks` in turn, as one
 * keyboard-interactive question (a password, then a verification code). A wrong
 * answer fails that attempt, and `ssh` starts over from the first question.
 * `run` gets each command a login runs; without it the command runs in a shell
 * of this machine, with `home` as its home folder.
 */
export async function sshServer(options: {
  asks: { prompt: string; answer: string }[];
  home?: string;
  run?: (command: string) => { output: string; code: number };
}) {
  const key = utils.generateKeyPairSync('ed25519');
  const state = { logins: 0, connections: 0, commands: [] as string[] };
  const clients = new Set<{ end(): void }>();
  const server = new Server({ hostKeys: [key.private] }, (client) => {
    state.connections++;
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', (context) => {
      if (context.method !== 'keyboard-interactive')
        return context.reject(['keyboard-interactive']);
      const ask = (at: number) => {
        const next = options.asks[at];
        if (!next) return context.accept();
        context.prompt([{ prompt: next.prompt, echo: false }], (answers) => {
          if (answers[0] !== next.answer) return context.reject(['keyboard-interactive']);
          ask(at + 1);
        });
      };
      ask(0);
    });
    client.on('ready', () => {
      state.logins++;
      client.on('session', (accept) => {
        accept().on('exec', (accepted, _reject, info) => {
          const stream = accepted();
          state.commands.push(info.command);
          if (options.run) {
            const { output, code } = options.run(info.command);
            stream.write(output);
            stream.exit(code);
            return void stream.end();
          }
          const child = spawn('sh', ['-c', info.command], {
            env: { ...process.env, HOME: options.home, IRORI_VAULT_HOST_IDLE_MS: '1500' },
            stdio: 'pipe',
          });
          stream.pipe(child.stdin);
          child.stdin.on('error', () => {});
          child.stdout.pipe(stream, { end: false });
          child.stderr.pipe(stream.stderr, { end: false });
          stream.on('close', () => child.kill());
          child.on('close', (code) => {
            stream.exit(code ?? 1);
            stream.end();
          });
        });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    state,
    // A login still open is ended, and one that does not let go is not waited for.
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end();
        server.close(() => resolve());
        setTimeout(resolve, 2000).unref();
      }),
  };
}
