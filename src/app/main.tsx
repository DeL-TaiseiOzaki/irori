import { Dialog } from './Dialog';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentEvent,
  AgentAnswers,
  AgentId,
  AgentInfo,
  AgentSession,
  Document,
  Entry,
  Space,
  WorkspaceProfile,
  CloudRoot,
} from '../domain/types';
const Editor = lazy(() =>
  import('../editor/Editor').then((module) => ({ default: module.Editor })),
);
const CsvPreview = lazy(() =>
  import('./CsvPreview').then((module) => ({ default: module.CsvPreview })),
);
const OntologyPanel = lazy(() =>
  import('./OntologyPanel').then((module) => ({ default: module.OntologyPanel })),
);
const TerminalPanel = lazy(() => import('./TerminalPanel'));
import type { EditorHandle } from '../editor/Editor';
import { sourceOnly } from '../editor/preservation';
import './style.css';
import { Startup, RegisterSpace } from './Startup';
import { Connections } from './Connections';
import { GitPanel } from './GitPanel';
import { LayerExplorer, Tree } from './LayerExplorer';
import { appIcon } from './branding';
import { Icon } from './Icon';
import { agentIds, agentNames } from '../domain/types';
const host = window.irori;
function Request({
  event,
  ended,
  onError,
}: {
  event: AgentEvent;
  ended: boolean;
  onError: (e: unknown) => void;
}) {
  const [answers, setAnswers] = useState<AgentAnswers>({});
  const [done, setDone] = useState(false);
  async function reply(allow: boolean) {
    try {
      await host.respond(event.requestId!, allow, answers);
      setDone(true);
    } catch (e) {
      onError(e);
    }
  }
  if (done || ended)
    return <div className="request resolved">{done ? '回答済み' : '要求は終了しました'}</div>;
  return (
    <div className="request">
      <strong>{event.text}</strong>
      <details>
        <summary>操作の詳細</summary>
        <pre>{event.details}</pre>
      </details>
      {event.questions?.map((q) => (
        <fieldset className="agent-question" key={q.id}>
          <legend>{q.title}</legend>
          {q.options && (
            <div className="choices">
              {q.options.map((o) => (
                <button
                  key={o}
                  aria-pressed={
                    q.multiple ? (answers[q.id] ?? []).includes(o) : answers[q.id] === o
                  }
                  onClick={() =>
                    setAnswers((a) => {
                      const previous = a[q.id];
                      const values = Array.isArray(previous)
                        ? previous
                        : previous
                          ? [previous]
                          : [];
                      return {
                        ...a,
                        [q.id]: q.multiple
                          ? values.includes(o)
                            ? values.filter((v) => v !== o)
                            : [...values, o]
                          : o,
                      };
                    })
                  }
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {q.multiple ? (
            <textarea
              aria-label={q.title}
              placeholder="複数の回答は1行ずつ入力"
              value={
                Array.isArray(answers[q.id])
                  ? (answers[q.id] as string[]).join('\n')
                  : (answers[q.id] ?? '')
              }
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value.split('\n') }))}
            />
          ) : (
            <input
              aria-label={q.title}
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <div className="actions">
        <button onClick={() => void reply(false)}>拒否</button>
        <button className="primary" onClick={() => void reply(true)}>
          {event.questions ? '回答する' : '今回のみ許可'}
        </button>
      </div>
    </div>
  );
}
function SessionControls({
  scopeId,
  agent,
  running,
  onReset,
  onError,
}: {
  scopeId: string;
  agent: AgentId;
  running: boolean;
  onReset: () => void;
  onError: (error: unknown) => void;
}) {
  const [session, setSession] = useState<AgentSession>();
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    let current = true;
    void host
      .agentSession(scopeId, agent)
      .then((value) => {
        if (current) setSession(value);
      })
      .catch((error) => {
        if (current) setSession({ state: 'unavailable', detail: String(error) });
      });
    return () => {
      current = false;
    };
  }, [scopeId, agent, running]);
  async function reset() {
    setResetting(true);
    try {
      await host.resetAgentSession(scopeId, agent);
      setSession({ state: 'empty' });
      onReset();
    } catch (error) {
      onError(error);
    } finally {
      setResetting(false);
    }
  }
  return (
    <div className="session-controls">
      <small role="status">
        {!session
          ? '会話の状態を確認中…'
          : session.state === 'saved'
            ? '次の実行で前回の会話を引き継ぎます。会話本文の再表示には未対応です。'
            : session.state === 'empty'
              ? '次の実行で新しい会話を始めます。'
              : session.detail}
      </small>
      {session && session.state !== 'empty' && (
        <>
          <button disabled={running || resetting} onClick={() => void reset()}>
            会話の継続をリセット
          </button>
          <small>
            このスペース・エージェントの継続を解除します。ノートとCLI側の履歴は残ります。
          </small>
        </>
      )}
    </div>
  );
}
function App() {
  const [creatingNote, setCreatingNote] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceProfile>(),
    [startup, setStartup] = useState(true);
  const [connectionsOpen, setConnectionsOpen] = useState(false),
    [connecting, setConnecting] = useState(false);
  const [cloudRoot, setCloudRoot] = useState<CloudRoot>(),
    [connectionTarget, setConnectionTarget] = useState<CloudRoot>();
  const [gitOpen, setGitOpen] = useState(false);
  const [ontologyOpen, setOntologyOpen] = useState(false);
  const [terminalSpace, setTerminalSpace] = useState<Space>();
  const [spaces, setSpaces] = useState<Space[]>([]),
    [active, setActive] = useState<Space>(),
    [doc, setDoc] = useState<Document>(),
    [buffer, setBuffer] = useState('');
  const [revision, setRevision] = useState(0),
    [editorKey, setEditorKey] = useState(0),
    [mode, setMode] = useState<'rich' | 'source' | 'table'>('rich'),
    [external, setExternal] = useState<Document>();
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [panel, setPanel] = useState(false),
    [agent, setAgent] = useState<AgentId>('codex'),
    [infos, setInfos] = useState<AgentInfo[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]),
    [running, setRunning] = useState(false),
    [prompt, setPrompt] = useState(''),
    [fresh, setFresh] = useState(false);
  const [add, setAdd] = useState(false),
    [noteName, setNoteName] = useState(''),
    [newNote, setNewNote] = useState(false);
  const histories = useRef(new Map<string, AgentEvent[]>());
  const conversationKey = useRef('');
  function updateEvents(update: (events: AgentEvent[]) => AgentEvent[]) {
    setEvents((previous) => {
      const next = update(previous);
      histories.current.set(conversationKey.current, next);
      return next;
    });
  }
  useEffect(() => {
    conversationKey.current = `${active?.scopeId ?? ''}:${agent}`;
    setEvents(histories.current.get(conversationKey.current) ?? []);
    setFresh(false);
  }, [active?.scopeId, agent]);
  const editor = useRef<EditorHandle>(null);
  const current = useRef({ doc, buffer });
  current.current = { doc, buffer };
  const dirty = !!doc && buffer !== doc.text;
  const report = (e: unknown) => setError(String(e));
  function load(next: Document) {
    setDoc(next);
    setBuffer(next.text);
    setExternal(undefined);
    setMode(
      /\.csv$/i.test(next.path)
        ? 'table'
        : !next.readOnly && /\.md$/i.test(next.path) && !sourceOnly(next.text)
          ? 'rich'
          : 'source',
    );
    setEditorKey((k) => k + 1);
    setStatus(next.readOnly ? 'クラウド資料・読み取り専用' : 'この端末に保存済み');
  }
  async function refreshSpaces() {
    const list = await host.spaces();
    setSpaces(list);
    setActive((a) => a ?? list[0]);
  }
  async function reconcile() {
    const now = current.current;
    if (!now.doc) return;
    try {
      const disk = now.doc.workspaceId
        ? await host.cloudRead(now.doc.workspaceId, now.doc.path)
        : await host.read(now.doc.scopeId, now.doc.path);
      if (
        current.current.doc?.path !== now.doc.path ||
        current.current.doc?.scopeId !== now.doc.scopeId
      )
        return;
      if (disk.hash !== now.doc.hash) {
        const latest = editor.current?.getText() ?? current.current.buffer;
        if (latest !== now.doc.text) {
          setBuffer(latest);
          setExternal(disk);
        } else load(disk);
      }
    } catch (e) {
      report(e);
    }
  }
  useEffect(() => {
    void refreshSpaces().catch(report);
    void host.agents().then(setInfos).catch(report);
    return host.onEvent((event) => {
      if (event.type === 'files') {
        setRevision((r) => r + 1);
        void reconcile();
      } else if (event.type === 'agent') {
        const incoming = event.event;
        updateEvents((all) => {
          const last = all.at(-1);
          if (incoming.type === 'text' && last?.type === 'text' && last.runId === incoming.runId)
            return [
              ...all.slice(0, -1),
              { ...last, text: (last.text + incoming.text).slice(-200000) },
            ];
          return [...all, incoming].slice(-400);
        });
        if (incoming.type === 'done') {
          setRunning(false);
          setRevision((r) => r + 1);
          void reconcile();
        }
      }
    });
  }, []);
  useEffect(() => {
    if (!doc || !dirty) return;
    const timer = setTimeout(() => void host.draft({ ...doc, text: buffer }).catch(report), 250);
    return () => clearTimeout(timer);
  }, [doc, buffer, dirty]);
  useEffect(() => {
    window.iroriFlushDraft = async () => {
      const c = current.current;
      const latest = editor.current?.getText() ?? c.buffer;
      if (c.doc && latest !== c.doc.text) await host.draft({ ...c.doc, text: latest });
    };
    return () => {
      delete window.iroriFlushDraft;
    };
  }, []);
  async function save() {
    if (!doc || doc.readOnly || gitOpen) return;
    try {
      const saved = await host.save({ ...doc, text: editor.current?.getText() ?? buffer });
      load(saved);
    } catch (e) {
      report(e);
      void reconcile();
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('.terminal-panel')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function selectSpace(space: Space) {
    if (dirty || (doc && (editor.current?.getText() ?? buffer) !== doc.text)) {
      report('未保存のノートを保存してから移動してください。');
      return false;
    }
    if (running || connecting) return false;
    if (active?.scopeId !== space.scopeId) {
      setActive(space);
      setDoc(undefined);
      setBuffer('');
      setExternal(undefined);
      setStatus('');
    }
    return true;
  }
  async function open(space: Space, entry: Entry) {
    try {
      if (entry.blocked) {
        setStatus(entry.blocked);
        return;
      }
      if (dirty || (doc && (editor.current?.getText() ?? buffer) !== doc.text)) {
        setError('未保存のノートを保存してから移動してください。');
        return;
      }
      if (running && (space.scopeId !== active?.scopeId || entry.path !== doc?.path)) {
        setError('実行を停止してからスペースを切り替えてください。');
        return;
      }
      if (/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(entry.path)) {
        const next = await host.read(space.scopeId, entry.path);
        setActive(space);
        load(next);
      } else await host.openExternal(space.scopeId, entry.path);
    } catch (e) {
      report(e);
    }
  }
  async function start() {
    if (!active) return;
    try {
      if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
        await host.save({ ...doc!, text: editor.current?.getText() ?? buffer });
        load(await host.read(doc!.scopeId, doc!.path));
      }
      setError('');
      setRunning(true);
      await host.start({
        scopeId: active.scopeId,
        agent,
        prompt,
        notePath: doc?.scopeId === active.scopeId ? doc.path : undefined,
        newSession: fresh,
      });
      if (fresh) updateEvents(() => []);
      updateEvents((all) => [...all, { runId: 'user', type: 'status', text: `あなた: ${prompt}` }]);
      setPrompt('');
      setFresh(false);
    } catch (e) {
      setRunning(false);
      report(e);
    }
  }
  async function openWorkspace(profile: WorkspaceProfile) {
    const available = spaces.filter((space) => profile.scopeIds.includes(space.scopeId));
    setWorkspace(profile);
    setActive(available[0]);
    setDoc(undefined);
    setBuffer('');
    setExternal(undefined);
    setStartup(false);
    setConnecting(true);
    setCloudRoot(undefined);
    try {
      setCloudRoot(await host.workspaceCloud(profile.id));
      const nextIds = [...available.map((space) => space.scopeId), profile.id];
      for (const previousId of workspace ? [...workspace.scopeIds, workspace.id] : []) {
        if (
          !nextIds.includes(previousId) &&
          (previousId === workspace?.id || spaces.some((space) => space.scopeId === previousId))
        )
          for (const connection of await host.cloudConnections(previousId).catch((error) => {
            report(error);
            return [];
          }))
            if (connection.state === 'mounted' || connection.state === 'error')
              await host.disconnectCloud(previousId, connection.mountId).catch(report);
      }
      for (const id of nextIds)
        for (const connection of await host.cloudConnections(id).catch((error) => {
          report(error);
          return [];
        })) {
          if (connection.state !== 'unconfigured' && connection.state !== 'mounted') {
            await host.connectCloud(id, connection.mountId).catch(() => {
              setStatus('接続できないクラウドがあります。「クラウド接続」で確認できます。');
            });
          }
        }
    } catch (error) {
      report(error);
    } finally {
      setConnecting(false);
      setRevision((v) => v + 1);
    }
  }
  function showConnections(target: CloudRoot) {
    setConnectionTarget(target);
    setConnectionsOpen(true);
  }
  async function openCloud(root: CloudRoot, entry: Entry) {
    if (entry.blocked) {
      setStatus(entry.blocked);
      return;
    }
    if (
      dirty ||
      running ||
      connecting ||
      (doc && (editor.current?.getText() ?? buffer) !== doc.text)
    ) {
      report('未保存のノートを保存し、実行を停止してから資料を開いてください。');
      return;
    }
    try {
      if (/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(entry.path))
        load(await host.cloudRead(root.scopeId, entry.path));
      else await host.openCloudFile(root.scopeId, entry.path);
    } catch (error) {
      report(error);
    }
  }
  if (startup)
    return (
      <Startup
        spaces={spaces}
        refresh={refreshSpaces}
        onOpen={(profile) => void openWorkspace(profile)}
      />
    );
  return (
    <div className={`app ${panel ? 'panel-open' : ''} ${terminalSpace ? 'terminal-open' : ''}`}>
      <a className="skip-to-editor" href="#editor-main">
        編集領域へ移動
      </a>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-icon" src={appIcon} alt="" width="40" height="40" />
          irori<span className="preview">Preview</span>
        </div>
        <button
          className="workspace-switch"
          disabled={dirty || running || connecting || !!terminalSpace}
          onClick={() => {
            if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
              report('未保存のノートを保存してから移動してください。');
              return;
            }
            setStartup(true);
          }}
        >
          <Icon name="grid" />
          <span>
            <small>ワークスペース</small>
            {workspace?.name ?? 'ワークスペース'}
          </span>
          <Icon name="chevron" className="rotated" size={13} />
        </button>
        <LayerExplorer
          spaces={spaces.filter((space) => workspace?.scopeIds.includes(space.scopeId))}
          activeId={active?.scopeId}
          selected={doc}
          revision={revision}
          locked={dirty || running || connecting}
          onSelect={(space) => {
            selectSpace(space);
          }}
          onOpen={(space, entry) => void open(space, entry)}
          onConnect={(space) => {
            if (selectSpace(space)) showConnections(space);
          }}
          onNote={(space) => {
            if (selectSpace(space)) setNewNote(true);
          }}
          onRefresh={() => setRevision((value) => value + 1)}
        />
        {cloudRoot && (
          <section className="workspace-drive" aria-label="ワークスペースの Google Drive">
            <div className="scope-heading">
              <strong>
                <Icon name="cloud" size={14} /> Google Drive
              </strong>
              <button
                className="scope-action"
                disabled={dirty || running || connecting}
                onClick={() => showConnections(cloudRoot)}
                aria-label="Drive フォルダを接続"
              >
                接続
              </button>
            </div>
            <Tree
              space={cloudRoot}
              layer="contents"
              directory="contents"
              roots={{ entries: [] }}
              revision={revision}
              selected={doc}
              readEntries={host.cloudEntries}
              onOpen={(root, entry) => void openCloud(root, entry)}
            />
          </section>
        )}
        <button
          className="add-space"
          disabled={running || dirty || connecting}
          onClick={() => setAdd(true)}
        >
          <Icon name="plus" /> スペースを追加
        </button>
      </aside>
      <main id="editor-main" tabIndex={-1}>
        <header>
          <div className="document-location" title={doc?.path}>
            <span className="muted">
              {doc?.workspaceId ? `${workspace?.name} · Drive` : (active?.name ?? 'ようこそ')}
            </span>
            <Icon name="chevron" size={12} />
            <strong>{doc?.path.split('/').at(-1) ?? 'ノートを選択'}</strong>
          </div>
          <div className="actions">
            {active && (
              <button
                disabled={running || dirty || connecting}
                onClick={() => {
                  if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
                    report('未保存のノートを保存してから Git の変更を確認してください。');
                    return;
                  }
                  setGitOpen(true);
                }}
              >
                <Icon name="branch" /> 変更と履歴
              </button>
            )}
            {cloudRoot && (
              <button
                disabled={running || dirty || connecting}
                onClick={() => showConnections(cloudRoot)}
              >
                <Icon name="cloud" /> クラウド接続
              </button>
            )}
            {active && (
              <button
                disabled={running || dirty || connecting}
                onClick={() => setOntologyOpen(true)}
              >
                オントロジー
              </button>
            )}
            {connecting && <small>接続を準備中…</small>}
            {active && (
              <button disabled={running || dirty} onClick={() => setNewNote(true)}>
                <Icon name="plus" /> ノートを作成
              </button>
            )}
            {doc && (
              <>
                <button onClick={() => void reconcile()}>再読み込み</button>
                <button disabled={running || !dirty || !!external} onClick={() => void save()}>
                  保存{dirty ? ' •' : ''}
                </button>
              </>
            )}
          </div>
        </header>
        {!doc && status && (
          <p className="hint" role="status">
            {status}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError('')}>閉じる</button>
          </div>
        )}
        {external && (
          <div className="conflict" role="alert">
            <strong>外部でノートが変更されました。未保存の編集を保持しています。</strong>
            <div className="versions">
              <label>
                あなたの編集<pre>{buffer}</pre>
              </label>
              <label>
                ディスク上の最新版<pre>{external.text}</pre>
              </label>
            </div>
            <button onClick={() => load(external)}>ディスク版を表示（下書きは保持）</button>
            <button
              onClick={() => {
                setDoc(external);
                setExternal(undefined);
                setStatus('最新版を基準に、編集内容を確認して保存してください');
              }}
            >
              編集を維持して手動で統合
            </button>
          </div>
        )}
        {doc ? (
          <>
            <div className="doc-toolbar">
              <span>{dirty ? '未保存' : status}</span>
              <div className="actions">
                {/\.csv$/i.test(doc.path) && (
                  <button
                    className={mode === 'table' ? 'selected' : ''}
                    onClick={() => {
                      setBuffer(editor.current?.getText() ?? buffer);
                      setMode('table');
                      setEditorKey((key) => key + 1);
                    }}
                  >
                    表
                  </button>
                )}
                <button
                  className={mode === 'rich' ? 'selected' : ''}
                  disabled={doc.readOnly || !!sourceOnly(buffer) || !doc.path.endsWith('.md')}
                  onClick={() => {
                    setBuffer(editor.current?.getText() ?? buffer);
                    setMode('rich');
                    setEditorKey((k) => k + 1);
                  }}
                >
                  ドキュメント
                </button>
                <button
                  className={mode === 'source' ? 'selected' : ''}
                  onClick={() => {
                    setBuffer(editor.current?.getText() ?? buffer);
                    setMode('source');
                    setEditorKey((k) => k + 1);
                  }}
                >
                  ソース
                </button>
              </div>
            </div>
            {sourceOnly(buffer) && <div className="hint">{sourceOnly(buffer)}</div>}
            {doc.draft && doc.draft.text !== doc.text && (
              <div className="hint">
                復元できる下書きがあります。
                <button
                  onClick={() => {
                    setBuffer(doc.draft!.text);
                    setMode('source');
                    setEditorKey((k) => k + 1);
                    if (doc.draft!.baseHash !== doc.hash) setExternal(doc);
                  }}
                >
                  下書きを復元
                </button>
              </div>
            )}
            <div className="document-scroll">
              <Suspense fallback={<p className="hint">エディタを開いています…</p>}>
                {mode === 'table' ? (
                  <CsvPreview key={editorKey} text={buffer} />
                ) : (
                  <Editor
                    ref={editor}
                    key={editorKey}
                    text={buffer}
                    mode={mode}
                    readOnly={doc.readOnly}
                    onChange={setBuffer}
                  />
                )}
              </Suspense>
            </div>
          </>
        ) : (
          <div className="welcome">
            <img className="welcome-mark" src={appIcon} alt="" width="80" height="80" />
            <h1>ここから、考えを広げよう。</h1>
            <p>
              左のナレッジからノートを開くと、編集を始められます。
              <br />
              新しいノートを作ったり、AIと一緒に整理することもできます。
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                disabled={!active || running || connecting}
                onClick={() => setNewNote(true)}
              >
                <Icon name="plus" />
                新しいノートを作成
              </button>
              <button onClick={() => setAdd(true)}>
                <Icon name="folder" />
                KBフォルダを開く
              </button>
            </div>
            <p className="hint">Markdown ファイルは、あなたのフォルダに保存されます。</p>
          </div>
        )}
        {terminalSpace && (
          <Suspense fallback={<p className="hint">ターミナルを開いています…</p>}>
            <TerminalPanel space={terminalSpace} onClose={() => setTerminalSpace(undefined)} />
          </Suspense>
        )}
        <footer>
          <span role="status">{status || (active ? `${active.name}で作業中` : '')}</span>
          <button
            disabled={!active && !terminalSpace}
            aria-expanded={!!terminalSpace}
            onClick={() => setTerminalSpace((value) => (value ? undefined : active))}
          >
            <Icon name="terminal" /> {terminalSpace ? 'ターミナルを終了' : 'ターミナル'}
          </button>
          <button className="consult" onClick={() => setPanel((p) => !p)}>
            <Icon name="sparkles" /> {panel ? 'AIパネルを閉じる' : 'AIに相談'}
          </button>
        </footer>
      </main>
      {connectionsOpen && connectionTarget && (
        <Connections
          key={connectionTarget.scopeId}
          space={connectionTarget}
          running={running}
          onClose={() => {
            setConnectionsOpen(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {panel && (
        <aside className="agent-panel">
          <div className="agent-heading">
            <h2>
              <Icon name="sparkles" />
              AIに相談
            </h2>
            <button aria-label="AIパネルを閉じる" onClick={() => setPanel(false)}>
              <Icon name="close" />
            </button>
          </div>
          <div className="agent-config">
            <select
              aria-label="エージェント"
              value={agent}
              disabled={running}
              onChange={(e) => setAgent(e.target.value as AgentId)}
            >
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {agentNames[id]}
                </option>
              ))}
            </select>
            <small>{infos.find((i) => i.id === agent)?.version || 'CLIを確認中'}</small>
            {infos.find((i) => i.id === agent)?.available === false && (
              <p role="alert">
                CLI が見つかりません。インストールとネイティブログインを確認してください。
              </p>
            )}
            {infos.find((i) => i.id === agent)?.available &&
              infos.find((i) => i.id === agent)?.tested === false && (
                <small>このCLIバージョンは未検証です。</small>
              )}
            <div className="context-chip">
              {active?.name ?? 'スペース未選択'}
              {doc ? ` / ${doc.path.split('/').at(-1)}` : ''}
            </div>
            <small>保存したノートを参照し、このスペースでツールを実行します。</small>
            <small>{infos.find((i) => i.id === agent)?.detail}</small>
            {active && (
              <SessionControls
                key={`${active.scopeId}:${agent}`}
                scopeId={active.scopeId}
                agent={agent}
                running={running}
                onError={report}
                onReset={() => {
                  if (conversationKey.current !== `${active.scopeId}:${agent}`) return;
                  updateEvents(() => []);
                  setFresh(false);
                }}
              />
            )}
          </div>
          <div className="conversation" aria-live="polite">
            {events.length === 0 && (
              <div className="agent-empty">
                <Icon name="sparkles" size={24} />
                <p>考えを進める、もうひとつの視点。</p>
                <small>このスペースのノートについて相談できます。</small>
                <div className="prompt-suggestions">
                  {['このノートの要点をまとめて', 'この内容から次のアクションを整理して'].map(
                    (suggestion) => (
                      <button
                        key={suggestion}
                        disabled={!doc || running}
                        onClick={() => {
                          setPrompt(suggestion);
                          document
                            .querySelector<HTMLTextAreaElement>('.composer textarea')
                            ?.focus();
                        }}
                      >
                        {suggestion}
                        <Icon name="arrow" size={13} />
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}
            {events.map((event, i) =>
              event.type === 'permission' || event.type === 'question' ? (
                <Request
                  key={`${event.runId}-${i}`}
                  event={event}
                  ended={events.some((e) => e.runId === event.runId && e.type === 'done')}
                  onError={report}
                />
              ) : (
                <div className={`message ${event.type}`} key={`${event.runId}-${i}`}>
                  {event.type === 'tool' ? (
                    <details>
                      <summary>{event.text}</summary>
                      <pre>{event.details}</pre>
                    </details>
                  ) : (
                    <span>{event.text}</span>
                  )}
                </div>
              ),
            )}
          </div>
          <div className="composer">
            <label className="new-session">
              <input
                type="checkbox"
                checked={fresh}
                disabled={running}
                onChange={(e) => setFresh(e.target.checked)}
              />
              新しい会話
            </label>
            <textarea
              aria-label="エージェントへの指示"
              placeholder="このノートから、何を作りますか？"
              value={prompt}
              disabled={running}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="actions">
              {running ? (
                <button onClick={() => void host.cancel().catch(report)}>停止</button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    !active ||
                    connecting ||
                    !prompt.trim() ||
                    !!external ||
                    infos.find((i) => i.id === agent)?.available !== true
                  }
                  onClick={() => void start()}
                >
                  保存して実行 ↗
                </button>
              )}
            </div>
          </div>
        </aside>
      )}
      {ontologyOpen && active && (
        <Suspense fallback={<p className="hint">オントロジーを開いています…</p>}>
          <OntologyPanel
            space={active}
            revision={revision}
            onClose={() => setOntologyOpen(false)}
            onConfigure={() => {
              setOntologyOpen(false);
              setPanel(true);
              const request =
                'この KB のオントロジーを一緒に整理してください。まず既存 CSV とノートを調べ、構築方針と表示設定を提案してください。既存 ID・未知の列・ノートは保持し、別 KB や contents を変更しないでください。irori の表示宣言は .irori/ontology.json、形式は {"schemaVersion":1,"entities":{"path":"ontology/entities.csv","id":"id","label":"label","note":"note","parent":"parentId","group":"group"},"relations":{"path":"ontology/relations.csv","source":"sourceId","target":"targetId","label":"relation"}} です。パスと列名は既存 CSV に合わせられます。note はこの KB 内の Markdown 相対パス、parentId は親 ID、group はサブグラフ名です。note・parent・group の列マッピングと relations は任意で、未使用なら宣言から省略できます。CSV はカンマ区切り、ID は重複させずラベル変更で変えないでください。';
              setPrompt((previous) => (previous ? `${previous}\n\n${request}` : request));
            }}
            onOpen={(relative) => {
              setOntologyOpen(false);
              void open(active, {
                path: relative,
                name: relative.split('/').at(-1)!,
                directory: false,
                note: /\.md$/i.test(relative),
                layer: 'Knowledge_Base',
              });
            }}
          />
        </Suspense>
      )}
      {gitOpen && active && (
        <GitPanel
          spaces={spaces.filter((s) => workspace?.scopeIds.includes(s.scopeId))}
          initialScope={active.scopeId}
          onClose={() => setGitOpen(false)}
          onChanged={() => {
            setRevision((r) => r + 1);
            void reconcile();
          }}
        />
      )}
      {add && (
        <RegisterSpace
          onCancel={() => setAdd(false)}
          onRegistered={(space) => {
            setAdd(false);
            void (async () => {
              await refreshSpaces();
              if (workspace)
                setWorkspace(
                  await host.saveWorkspace(
                    workspace.name,
                    [...workspace.scopeIds, space.scopeId],
                    workspace.id,
                  ),
                );
              setActive(space);
              setDoc(undefined);
              setBuffer('');
            })().catch(report);
          }}
        />
      )}
      {newNote && (
        <Dialog label="ノートを作成" busy={creatingNote} onClose={() => setNewNote(false)}>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              if (active && !creatingNote) {
                setCreatingNote(true);
                void host
                  .createNote(active.scopeId, noteName)
                  .then((d) => {
                    load(d);
                    setNewNote(false);
                    setNoteName('');
                    setRevision((r) => r + 1);
                  })
                  .catch(report)
                  .finally(() => setCreatingNote(false));
              }
            }}
          >
            <h2>ノートを作成</h2>
            <input
              aria-label="ノート名"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              placeholder="ノート名"
              required
            />
            <div className="actions">
              <button type="button" disabled={creatingNote} onClick={() => setNewNote(false)}>
                キャンセル
              </button>
              <button className="primary" disabled={creatingNote}>
                作成
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
