import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentEvent,
  AgentId,
  AgentInfo,
  Category,
  Document,
  Entry,
  Space,
} from '../domain/types';
const Editor = lazy(() =>
  import('../editor/Editor').then((module) => ({ default: module.Editor })),
);
import type { EditorHandle } from '../editor/Editor';
import { sourceOnly } from '../editor/preservation';
import './style.css';
const host = window.irori;
const labels = { personal: '個人', team: 'チーム', organization: '組織' };
function Tree({
  space,
  directory = '',
  revision,
  open,
}: {
  space: Space;
  directory?: string;
  revision: number;
  open: (entry: Entry) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void host
      .entries(space.scopeId, directory)
      .then((e) => {
        if (active) {
          setEntries(e);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [space.scopeId, directory, revision]);
  return (
    <div className="tree">
      {error && <small role="alert">{error}</small>}
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            className={`tree-row ${entry.blocked ? 'muted' : ''}`}
            title={entry.blocked ?? entry.path}
            onClick={() =>
              entry.directory && !entry.blocked
                ? setExpanded((v) =>
                    v.includes(entry.path) ? v.filter((p) => p !== entry.path) : [...v, entry.path],
                  )
                : open(entry)
            }
          >
            <span>
              {entry.directory
                ? expanded.includes(entry.path)
                  ? '⌄'
                  : '›'
                : entry.note
                  ? '▤'
                  : '◻'}
            </span>
            <span className="filename">{entry.name.replace(/\.md$/, '')}</span>
            {entry.layer === 'schema' && <span className="badge">ルール</span>}
            {entry.layer === 'contents' && <span className="badge">未接続</span>}
          </button>
          {entry.directory && expanded.includes(entry.path) && (
            <Tree space={space} directory={entry.path} revision={revision} open={open} />
          )}
        </div>
      ))}
    </div>
  );
}
function Request({
  event,
  ended,
  onError,
}: {
  event: AgentEvent;
  ended: boolean;
  onError: (e: unknown) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
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
        <label key={q.id}>
          {q.title}
          {q.options && (
            <div className="choices">
              {q.options.map((o) => (
                <button key={o} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label={q.title}
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          />
        </label>
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
function App() {
  const [spaces, setSpaces] = useState<Space[]>([]),
    [active, setActive] = useState<Space>(),
    [doc, setDoc] = useState<Document>(),
    [buffer, setBuffer] = useState('');
  const [revision, setRevision] = useState(0),
    [editorKey, setEditorKey] = useState(0),
    [mode, setMode] = useState<'rich' | 'source'>('rich'),
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
    [folder, setFolder] = useState(''),
    [name, setName] = useState(''),
    [category, setCategory] = useState<Category>('personal'),
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
    setMode(/\.md$/i.test(next.path) && !sourceOnly(next.text) ? 'rich' : 'source');
    setEditorKey((k) => k + 1);
    setStatus('この端末に保存済み');
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
      const disk = await host.read(now.doc.scopeId, now.doc.path);
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
      } else {
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
    if (!doc) return;
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
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
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
      setActive(space);
      if (/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(entry.path))
        load(await host.read(space.scopeId, entry.path));
      else await host.openExternal(space.scopeId, entry.path);
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
      updateEvents((all) => [...all, { runId: 'user', type: 'status', text: `あなた: ${prompt}` }]);
      setPrompt('');
      setFresh(false);
    } catch (e) {
      setRunning(false);
      report(e);
    }
  }
  return (
    <div className={`app ${panel ? 'panel-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="hearth">▪</span>irori<span className="preview">preview</span>
        </div>
        <div className="space-list">
          {(['personal', 'team', 'organization'] as Category[]).map((group) => (
            <section key={group}>
              <h2>{labels[group]}</h2>
              {spaces
                .filter((s) => s.category === group)
                .map((space) => (
                  <div className="space" key={space.scopeId}>
                    <button
                      className={`space-title ${active?.scopeId === space.scopeId ? 'active' : ''}`}
                      disabled={dirty || running}
                      onClick={() => {
                        if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
                          setError('未保存のノートを保存してから移動してください。');
                          return;
                        }
                        setActive(space);
                        setDoc(undefined);
                        setBuffer('');
                      }}
                    >
                      <span>⌄</span>
                      {space.name}
                    </button>
                    <Tree
                      space={space}
                      revision={revision}
                      open={(entry) => void open(space, entry)}
                    />
                  </div>
                ))}
            </section>
          ))}
        </div>
        <button className="add-space" disabled={running || dirty} onClick={() => setAdd(true)}>
          ＋ スペースを追加
        </button>
      </aside>
      <main>
        <header>
          <div>
            {active?.name ?? 'ようこそ'}{' '}
            <span className="muted">
              / {doc?.path.split('/').slice(0, -1).join(' / ') ?? 'ナレッジ'}
            </span>
          </div>
          <div className="actions">
            {active && (
              <button disabled={running || dirty} onClick={() => setNewNote(true)}>
                ノートを作成
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
                <button
                  className={mode === 'rich' ? 'selected' : ''}
                  disabled={!!sourceOnly(buffer) || !doc.path.endsWith('.md')}
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
                <Editor
                  ref={editor}
                  key={editorKey}
                  text={buffer}
                  mode={mode}
                  onChange={setBuffer}
                />
              </Suspense>
            </div>
          </>
        ) : (
          <div className="welcome">
            <span className="welcome-mark">▪</span>
            <h1>知識を育てる場所。</h1>
            <p>
              ノートを書き、エージェントと考える。
              <br />
              あなたの KB を開いて、はじめましょう。
            </p>
            <button className="primary" onClick={() => setAdd(true)}>
              KBフォルダを開く
            </button>
            <p className="hint">Markdown ファイルは、あなたのフォルダに保存されます。</p>
          </div>
        )}
        <footer>
          <span>{status}</span>
          <button className="consult" onClick={() => setPanel((p) => !p)}>
            ✧ {panel ? 'AIパネルを閉じる' : 'AIに相談'}
          </button>
        </footer>
      </main>
      {panel && (
        <aside className="agent-panel">
          <div className="agent-heading">
            <h2>AIに相談</h2>
            <button onClick={() => setPanel(false)}>×</button>
          </div>
          <div className="agent-config">
            <select
              aria-label="エージェント"
              value={agent}
              disabled={running}
              onChange={(e) => setAgent(e.target.value as AgentId)}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
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
          </div>
          <div className="conversation" aria-live="polite">
            {events.length === 0 && (
              <p className="muted">このノートを整理したり、内容をもとに成果物を作成できます。</p>
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
      {add && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void host
                .register(folder, name, category)
                .then((s) => {
                  setActive(s);
                  setDoc(undefined);
                  setBuffer('');
                  setAdd(false);
                  setFolder('');
                  setName('');
                  return refreshSpaces();
                })
                .catch(report);
            }}
          >
            <h2>スペースを追加</h2>
            <label>
              KBフォルダ
              <div className="actions">
                <input
                  aria-label="KBフォルダ"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() =>
                    void host
                      .chooseFolder()
                      .then((p) => {
                        if (p) {
                          setFolder(p);
                          if (!name) setName(p.split(/[/\\]/).at(-1) ?? 'My KB');
                        }
                      })
                      .catch(report)
                  }
                >
                  選択
                </button>
              </div>
            </label>
            <label>
              スペース名
              <input
                aria-label="スペース名"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              種類
              <select
                aria-label="スペースの種類"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {Object.entries(labels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              初回は識別情報を .irori/scope.json に作成し、contents を Git
              の対象外にします。既存ノートは移動しません。登録済み KB
              は保存された名前・種類を使用します。
            </p>
            <div className="actions">
              <button type="button" onClick={() => setAdd(false)}>
                キャンセル
              </button>
              <button className="primary" type="submit">
                登録して開く
              </button>
            </div>
          </form>
        </div>
      )}
      {newNote && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              if (active)
                void host
                  .createNote(active.scopeId, noteName)
                  .then((d) => {
                    load(d);
                    setNewNote(false);
                    setNoteName('');
                    setRevision((r) => r + 1);
                  })
                  .catch(report);
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
              <button type="button" onClick={() => setNewNote(false)}>
                キャンセル
              </button>
              <button className="primary">作成</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
