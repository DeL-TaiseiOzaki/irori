import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Space, TerminalEvent, TerminalSession, TerminalShell } from '../domain/types';
import { Icon } from './Icon';

const host = window.irori;

export default function TerminalPanel({ space, onClose }: { space: Space; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<TerminalSession | undefined>(undefined);
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [selected, setSelected] = useState('');
  const [generation, setGeneration] = useState(0);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const report = (error: unknown) => setError(String(error));

  useEffect(() => {
    let disposed = false;
    let current: TerminalSession | undefined;
    const early: TerminalEvent[] = [];
    const term = new Terminal({
      fontFamily: 'Cascadia Mono, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 3000,
      allowProposedApi: false,
      theme: {
        background: '#202627',
        foreground: '#e0e5e1',
        cursor: '#d8b57a',
        selectionBackground: '#465550',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current!);
    // xterm handles escape sequences and paste. No terminal output enters HTML or URL handlers.
    const receive = (event: TerminalEvent) => {
      if (!current || event.id !== current.id || disposed) return;
      if (event.type === 'data') {
        term.write(event.data, () => {
          if (!disposed) void host.acknowledgeTerminal(event.id, event.data.length).catch(report);
        });
      } else {
        setRunning(false);
        term.writeln(`\r\n[プロセスが終了しました: ${event.code}]`);
        session.current = undefined;
      }
    };
    const unsubscribe = host.onEvent((message) => {
      if (message.type !== 'terminal') return;
      if (!current) early.push(message.event);
      else receive(message.event);
    });
    const input = term.onData((data) => {
      if (session.current) void host.writeTerminal(session.current.id, data).catch(report);
    });
    const resize = () => {
      if (disposed || !container.current?.clientWidth) return;
      fit.fit();
      if (current) void host.resizeTerminal(current.id, term.cols, term.rows).catch(report);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    setError('');
    setStarting(true);
    void (async () => {
      const options = await host.terminalShells();
      if (disposed) return;
      setShells(options);
      const shell = options.find((item) => item.id === selected) ?? options[0];
      if (!shell) throw Error('使用できるシェルが見つかりません。');
      setSelected(shell.id);
      fit.fit();
      current = await host.openTerminal(space.scopeId, shell.id, term.cols, term.rows);
      if (disposed) {
        await host.closeTerminal(current.id);
        return;
      }
      session.current = current;
      setRunning(true);
      early.splice(0).forEach(receive);
      term.focus();
    })()
      .catch((error) => {
        if (!disposed) report(error);
      })
      .finally(() => {
        if (!disposed) setStarting(false);
      });
    return () => {
      disposed = true;
      unsubscribe();
      observer.disconnect();
      input.dispose();
      term.dispose();
      session.current = undefined;
      if (current) void host.closeTerminal(current.id);
    };
    // A shell selection takes effect only on the explicit Open action after exit.
  }, [space.scopeId, generation]);

  async function stop() {
    if (session.current) await host.closeTerminal(session.current.id).catch(report);
    session.current = undefined;
    setRunning(false);
  }
  return (
    <section className="terminal-panel" aria-label={`${space.name} のターミナル`}>
      <div className="terminal-toolbar">
        <strong>
          <Icon name="terminal" /> {space.name}
        </strong>
        <select
          aria-label="ターミナルのシェル"
          value={selected}
          disabled={running || starting}
          onChange={(event) => setSelected(event.target.value)}
        >
          {shells.map((shell) => (
            <option key={shell.id} value={shell.id}>
              {shell.name}
            </option>
          ))}
        </select>
        <span className="terminal-state">{starting ? '起動中…' : running ? '実行中' : '終了'}</span>
        {running ? (
          <button onClick={() => void stop()}>プロセスを終了</button>
        ) : (
          <button
            disabled={starting || !selected}
            onClick={() => setGeneration((value) => value + 1)}
          >
            開く
          </button>
        )}
        <button
          title="ターミナルのプロセスを終了して閉じる"
          aria-label="ターミナルを終了して閉じる"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="terminal-screen" ref={container} />
    </section>
  );
}
