import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TerminalService } from '../src/terminal/service';
import { FileService } from '../src/host/files';
import { hostArguments } from '../src/domain/host-requests';

test(
  'Native terminal detects shells, owns its KB, handles Unicode/flow control, resize and exit',
  { timeout: 20000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori terminal 日本語 '));
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const kb = path.join(base, 'KB with spaces');
    await mkdir(kb);
    const space = await files.register(kb, 'Terminal test', 'personal');
    let output = '';
    let exited = false;
    const terminals = new TerminalService(files, (event) => {
      if (event.type === 'data') {
        output += event.data;
        // Emulate xterm's acknowledgement after consuming output, not a mocked PTY.
        setTimeout(() => terminals.acknowledge(event.id, event.data.length), 5);
      } else exited = true;
    });
    t.after(async () => {
      await terminals.closeAll();
      await rm(base, { recursive: true, force: true });
    });
    const shells = await terminals.available();
    assert(shells.length > 0);
    await assert.rejects(
      terminals.open(space.scopeId, '/not-a-detected-shell', 80, 24),
      /検出済み/,
    );
    await assert.rejects(terminals.open('foreign-scope', shells[0].id, 80, 24));
    const session = await terminals.open(space.scopeId, shells[0].id, 80, 24);
    assert.equal(session.cwd, kb);
    terminals.resize(session.id, 100, 30);
    assert(!hostArguments.resizeTerminal.safeParse([session.id, 0, 30]).success);
    assert(!hostArguments.writeTerminal.safeParse([session.id, 'x'.repeat(65537)]).success);
    const windows = process.platform === 'win32';
    terminals.write(
      session.id,
      windows
        ? "Set-Content -LiteralPath 'terminal 日本語.txt' -Value '端末から保存' -Encoding utf8\r"
        : "printf '端末から保存\\n' > 'terminal 日本語.txt'\r",
    );
    async function until(check: () => Promise<boolean> | boolean) {
      const deadline = Date.now() + 10000;
      while (!(await check())) {
        assert(Date.now() < deadline, 'Terminal operation timed out');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    await until(async () =>
      (await readFile(path.join(kb, 'terminal 日本語.txt'), 'utf8').catch(() => '')).includes(
        '端末から保存',
      ),
    );
    output = '';
    terminals.write(
      session.id,
      windows
        ? "[Console]::Write(('x' * 300000) + 'FLOW_DONE')\r"
        : "head -c 300000 /dev/zero | tr '\\0' x; printf '\\nFLOW_DONE\\n'\r",
    );
    await until(() => output.length > 300000 && output.includes('FLOW_DONE'));
    terminals.write(session.id, windows ? 'Start-Sleep -Seconds 60\r' : 'sleep 60\r');
    await new Promise((resolve) => setTimeout(resolve, 150));
    terminals.write(session.id, '\x03');
    terminals.write(session.id, 'exit\r');
    await until(() => exited);
    assert.equal(terminals.busy, false);
    assert.throws(() => terminals.write(session.id, 'echo stale\r'), /終了/);
  },
);

test(
  'Closing the native terminal terminates its foreground child',
  { skip: process.platform === 'win32', timeout: 10000 },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), 'irori terminal child '));
    const files = new FileService(path.join(base, 'device'));
    await files.init();
    const kb = path.join(base, 'kb');
    await mkdir(kb);
    const space = await files.register(kb, 'Child cleanup', 'personal');
    const terminals = new TerminalService(files, (event) => {
      if (event.type === 'data') terminals.acknowledge(event.id, event.data.length);
    });
    t.after(async () => {
      await terminals.closeAll();
      await rm(base, { recursive: true, force: true });
    });
    const shells = await terminals.available();
    const session = await terminals.open(space.scopeId, shells[0].id, 80, 24);
    terminals.write(session.id, 'sleep 60 & echo $! > child.pid; wait\r');
    let pid = 0;
    for (let i = 0; i < 100 && !pid; i++) {
      pid = Number(await readFile(path.join(kb, 'child.pid'), 'utf8').catch(() => ''));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(pid > 0);
    await terminals.close(session.id);
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('Terminal child survived close');
  },
);
