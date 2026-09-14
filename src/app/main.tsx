import { KnowledgePanel } from './KnowledgePanel';
import { SearchPanel } from './SearchPanel';
import type { SourceRef } from '../domain/knowledge';
import { appendConversationEvent, type QueuedMessage } from '../domain/conversation';
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
            ? '次の実行で前回の会話を引き継ぎます。履歴はこの端末に保存されます。'
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
            このスペース・エージェントの継続を解除します。ノートと保存した履歴は残ります。
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
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sources, setSources] = useState<SourceRef[]>([]);
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
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const eventRevision = useRef(0);
  const [add, setAdd] = useState(false),
    [noteName, setNoteName] = useState(''),
    [newNote, setNewNote] = useState(false);
  const conversationKey = useRef('');
  function updateEvents(update: (events: AgentEvent[]) => AgentEvent[]) {
    setEvents(update);
  }
  useEffect(() => {
    let current = true;
    conversationKey.current = `${active?.scopeId ?? ''}:${agent}`;
    setEvents([]);
    setQueued([]);
    setQueuePaused(true);
    setFresh(false);
    setConversationReady(false);
    setConversationError('');
    setHistoryTruncated(false);
    if (active)
      void (async () => {
        // A renderer reload stops native work. If its final events race the read, reread
        // the host snapshot instead of overwriting newer events with an older result.
        while (current) {
          const revision = eventRevision.current;
          const value = await host.agentConversation(active.scopeId, agent);
          if (!current) return;
          if (revision !== eventRevision.current) continue;
          setEvents(value.events);
          setQueued(value.queued);
          setRunning(!!value.activeRunId);
          setHistoryTruncated(value.truncated);
          setConversationReady(true);
          return;
        }
      })().catch((error) => {
        if (current) setConversationError(String(error));
      });
    return () => {
      current = false;
    };
  }, [active?.scopeId, agent, historyReload]);
  const conversation = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  useEffect(() => {
    if (followConversation.current && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [events, panel]);
  const editor = useRef<EditorHandle>(null);
  const current = useRef({ doc, buffer, external });
  current.current = { doc, buffer, external };
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const dirty = !!doc && buffer !== doc.text;
  const report = (e: unknown) => setError(String(e));
  function load(next: Document) {
    setDoc(next);
    setBuffer(next.text);
    setExternal(undefined);
    setMode(/\.csv$/i.test(next.path) ? 'table' : /\.md$/i.test(next.path) ? 'rich' : 'source');
    setEditorKey((k) => k + 1);
    setStatus(next.readOnly ? 'クラウド資料・読み取り専用' : 'この端末に保存済み');
  }
  async function refreshSpaces() {
    const list = await host.spaces();
    setSpaces(list);
    setActive((a) => a ?? list[0]);
  }
  async function reconcile() {
    if (saving.current) await saving.current;
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
        if (conversationKey.current !== `${incoming.scopeId}:${incoming.agent}`) return;
        eventRevision.current++;
        updateEvents((all) => {
          const next = appendConversationEvent(all, incoming).slice(-400);
          const last = next.at(-1)!;
          return [...next.slice(0, -1), { ...last, text: last.text.slice(-200000) }];
        });
        if (incoming.type === 'done') {
          setRunning(false);
          if (incoming.outcome !== 'completed') setQueuePaused(true);
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
  async function save(): Promise<boolean> {
    if (saving.current) {
      if (!(await saving.current)) return false;
      return save();
    }
    const now = current.current;
    if (!now.doc || now.doc.readOnly) return true;
    if (now.external) return false;
    const text = editor.current?.getText() ?? now.buffer;
    if (text === now.doc.text) return true;
    const operation = (async () => {
      try {
        const saved = await host.save({ ...now.doc!, text });
        if (
          current.current.doc?.scopeId === saved.scopeId &&
          current.current.doc?.path === saved.path
        ) {
          const latest = editor.current?.getText() ?? current.current.buffer;
          current.current = { ...current.current, doc: saved, buffer: latest };
          setDoc(saved);
          setBuffer(latest);
          setStatus('この端末に保存済み');
        }
        return true;
      } catch (e) {
        report(e);
        return false;
      }
    })();
    saving.current = operation;
    const success = await operation;
    saving.current = undefined;
    if (!success) void reconcile();
    return success;
  }
  useEffect(() => {
    if (!dirty || doc?.readOnly || external || gitOpen) return;
    const timer = setTimeout(() => {
      void save();
    }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, buffer, doc, external, gitOpen]);
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
  async function selectSpace(space: Space) {
    if (!(await save())) return false;
    if (running || queued.length || connecting) return false;
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
        return false;
      }
      if (!(await save())) return false;
      if ((running || sending || queued.length > 0) && space.scopeId !== active?.scopeId) {
        setError('実行を停止してからスペースを切り替えてください。');
        return false;
      }
      if (/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(entry.path)) {
        const next = await host.read(space.scopeId, entry.path);
        setActive(space);
        load(next);
      } else await host.openExternal(space.scopeId, entry.path);
      return true;
    } catch (e) {
      report(e);
      return false;
    }
  }
  async function sendTurn(
    message: string,
    notePath?: string,
    newSession = false,
    selectedSources = sources,
  ) {
    setError('');
    followConversation.current = true;
    setRunning(true);
    await host.start({
      scopeId: active!.scopeId,
      agent,
      prompt: message,
      notePath,
      newSession,
      sources: selectedSources,
    });
  }
  async function start() {
    if (!active || !conversationReady || submitting.current || !prompt.trim()) return;
    submitting.current = true;
    setSending(true);
    const message = prompt;
    try {
      if (!(await save())) return;
      const notePath = doc?.scopeId === active.scopeId ? doc.path : undefined;
      if (running || queued.length) {
        setQueued(
          await host.queueAgentMessage({
            scopeId: active.scopeId,
            agent,
            prompt: message,
            notePath,
            sources,
          }),
        );
      } else {
        setQueuePaused(false);
        await sendTurn(message, notePath, fresh);
      }
      setPrompt((value) => (value === message ? '' : value));
      setFresh(false);
    } catch (e) {
      if (!running) setRunning(false);
      report(e);
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  useEffect(() => {
    if (
      !conversationReady ||
      running ||
      sending ||
      queuePaused ||
      external ||
      !queued.length ||
      submitting.current
    )
      return;
    const next = queued[0];
    submitting.current = true;
    setSending(true);
    void (async () => {
      if (!(await save())) {
        setQueuePaused(true);
        return;
      }
      try {
        setRunning(true);
        followConversation.current = true;
        await host.startQueuedMessage(active!.scopeId, agent, next.id);
        setQueued((all) => all.filter((item) => item.id !== next.id));
      } catch (error) {
        setRunning(false);
        setQueuePaused(true);
        report(error);
      }
    })().finally(() => {
      submitting.current = false;
      setSending(false);
    });
  }, [conversationReady, running, sending, queued, queuePaused, external]);
  async function openWorkspace(profile: WorkspaceProfile) {
    setSources([]);
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
      return false;
    }
    if (connecting || !(await save())) return false;
    try {
      if (/\.(md|txt|csv|json|ya?ml|toml|ts|js|css)$/i.test(entry.path))
        load(await host.cloudRead(root.scopeId, entry.path));
      else await host.openCloudFile(root.scopeId, entry.path);
      return true;
    } catch (error) {
      report(error);
      return false;
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
        <button
          className="workspace-search"
          disabled={
            !spaces.some((space) => workspace?.scopeIds.includes(space.scopeId)) || connecting
          }
          onClick={() => setSearchOpen(true)}
        >
          <Icon name="search" /> KB内を検索
        </button>
        <LayerExplorer
          spaces={spaces.filter((space) => workspace?.scopeIds.includes(space.scopeId))}
          activeId={active?.scopeId}
          selected={doc}
          revision={revision}
          locked={running || sending || queued.length > 0 || connecting}
          onSelect={(space) => {
            void selectSpace(space);
          }}
          onOpen={(space, entry) => void open(space, entry)}
          onConnect={(space) => {
            void selectSpace(space).then((selected) => {
              if (selected) showConnections(space);
            });
          }}
          onNote={(space) => {
            void selectSpace(space).then((selected) => {
              if (selected) setNewNote(true);
            });
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
                disabled={running || queued.length > 0 || connecting}
                onClick={() => {
                  void save().then((saved) => {
                    if (saved) setGitOpen(true);
                  });
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
              <button
                disabled={connecting}
                onClick={() => {
                  void save().then((saved) => {
                    if (saved) setNewNote(true);
                  });
                }}
              >
                <Icon name="plus" /> ノートを作成
              </button>
            )}
            {doc && (
              <>
                <button onClick={() => void reconcile()}>再読み込み</button>
                <button disabled={!dirty || !!external} onClick={() => void save()}>
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
              <span>{dirty ? '保存待ち' : status}</span>
              <div className="actions">
                <button
                  disabled={
                    sources.length >= 20 ||
                    sources.some((ref) => ref.scopeId === doc.scopeId && ref.path === doc.path)
                  }
                  onClick={() => {
                    void save().then((saved) => {
                      if (saved)
                        setSources((all) => [...all, { scopeId: doc.scopeId, path: doc.path }]);
                    });
                  }}
                >
                  参照に追加
                </button>
                {active && (
                  <button
                    onClick={() => {
                      void save().then((saved) => {
                        if (saved) setKnowledgeOpen(true);
                      });
                    }}
                  >
                    資料と成果物
                  </button>
                )}
              </div>
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
                {!/\.md$/i.test(doc.path) && (
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
                )}
              </div>
            </div>
            {doc.draft && doc.draft.text !== doc.text && (
              <div className="hint">
                復元できる下書きがあります。
                <button
                  onClick={() => {
                    setBuffer(doc.draft!.text);
                    setMode(/\.md$/i.test(doc.path) ? 'rich' : 'source');
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
                    onError={report}
                    onUpload={async (file) =>
                      host.saveImage(
                        doc.scopeId,
                        doc.path,
                        new Uint8Array(await file.arrayBuffer()),
                      )
                    }
                    resolveImage={(url) => host.readImage(doc.scopeId, doc.path, url)}
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
              disabled={running || sending || queued.length > 0}
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
            {sources.length > 0 && (
              <div className="selected-sources" aria-label="選択した参照資料">
                {sources.map((source) => (
                  <div key={`${source.scopeId}:${source.path}`}>
                    <span>
                      {spaces.find((space) => space.scopeId === source.scopeId)?.name ?? 'Drive'} /{' '}
                      {source.path}
                    </span>
                    <button
                      aria-label={`${source.path} を参照から外す`}
                      onClick={() => setSources((all) => all.filter((ref) => ref !== source))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <small>ノートは自動保存され、このスペースで会話が続きます。</small>
            <small>{infos.find((i) => i.id === agent)?.detail}</small>
            {active && (
              <SessionControls
                key={`${active.scopeId}:${agent}`}
                scopeId={active.scopeId}
                agent={agent}
                running={running || sending || queued.length > 0 || !conversationReady}
                onError={report}
                onReset={() => {
                  if (conversationKey.current !== `${active.scopeId}:${agent}`) return;
                  setFresh(false);
                }}
              />
            )}
          </div>
          {!conversationReady && (
            <div className="hint" role="status">
              {conversationError || '保存した会話を読み込んでいます…'}
              {conversationError && (
                <button onClick={() => setHistoryReload((value) => value + 1)}>再試行</button>
              )}
            </div>
          )}
          {historyTruncated && (
            <div className="hint">保存上限により、古い履歴や長い出力の一部を省略しています。</div>
          )}
          <div
            className="conversation"
            aria-live="polite"
            ref={conversation}
            onScroll={() => {
              const element = conversation.current!;
              followConversation.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
          >
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
                <div
                  className={`message ${event.role === 'user' ? 'user' : event.type}`}
                  key={`${event.runId}-${i}`}
                >
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
          {queued.length > 0 && (
            <div className="message-queue" aria-label="送信待ち">
              <strong>送信待ち {queued.length} 件</strong>
              {queuePaused && (
                <p>送信待ちはこの端末に保存されています。内容を確認して再開してください。</p>
              )}
              {queued.map((item) => (
                <div key={item.id}>
                  <span>{item.prompt}</span>
                  <button
                    disabled={sending}
                    aria-label={`送信待ち ${item.id} を削除`}
                    onClick={() => {
                      setSending(true);
                      void host
                        .removeQueuedMessage(active!.scopeId, agent, item.id)
                        .then(setQueued)
                        .catch(report)
                        .finally(() => setSending(false));
                    }}
                  >
                    取消
                  </button>
                </div>
              ))}
              {queuePaused && (
                <button
                  disabled={running || sending || !conversationReady}
                  onClick={() => setQueuePaused(false)}
                >
                  送信を再開
                </button>
              )}
            </div>
          )}
          <div className="composer">
            <label className="new-session">
              <input
                type="checkbox"
                checked={fresh}
                disabled={running || sending || queued.length > 0}
                onChange={(e) => setFresh(e.target.checked)}
              />
              新しい会話
            </label>
            <textarea
              aria-label="エージェントへの指示"
              placeholder="このノートから、何を作りますか？"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  void start();
                }
              }}
            />
            <div className="actions">
              {running && (
                <button
                  onClick={() => {
                    setQueuePaused(true);
                    void host.cancel().catch(report);
                  }}
                >
                  停止
                </button>
              )}
              <button
                className="primary"
                disabled={
                  !active ||
                  !conversationReady ||
                  sending ||
                  connecting ||
                  !prompt.trim() ||
                  !!external ||
                  infos.find((i) => i.id === agent)?.available !== true
                }
                onClick={() => void start()}
              >
                {running || queued.length ? '送信待ちに追加' : '送信'}
              </button>
            </div>
          </div>
        </aside>
      )}
      {searchOpen && (
        <SearchPanel
          spaces={spaces.filter((space) => workspace?.scopeIds.includes(space.scopeId))}
          initialScopeId={active?.scopeId}
          beforeSearch={save}
          onOpen={async (scopeId, hit) => {
            const target = spaces.find(
              (space) => space.scopeId === scopeId && workspace?.scopeIds.includes(space.scopeId),
            );
            if (!target) throw Error('この KB をワークスペースに追加してから開いてください。');
            const opened = await open(target, {
              path: hit.path,
              name: hit.path.split('/').at(-1)!,
              directory: false,
              note: /\.md$/i.test(hit.path),
              layer: 'Knowledge_Base',
            });
            if (!opened)
              throw Error(
                'ファイルを開けませんでした。編集中のノートや実行・接続の状態を確認してください。',
              );
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {knowledgeOpen && active && (
        <KnowledgePanel
          key={active.scopeId}
          space={active}
          doc={doc}
          cloudOwner={cloudRoot?.scopeId}
          sourceNames={Object.fromEntries([
            ...spaces
              .filter((item) => workspace?.scopeIds.includes(item.scopeId))
              .map((item) => [item.scopeId, item.name]),
            ...(cloudRoot ? [[cloudRoot.scopeId, `${cloudRoot.name} / Drive`]] : []),
          ])}
          onOpen={async (source) => {
            const target = spaces.find(
              (item) =>
                item.scopeId === source.scopeId && workspace?.scopeIds.includes(item.scopeId),
            );
            const entry: Entry = {
              path: source.path,
              name: source.path.split('/').at(-1)!,
              directory: false,
              note: /\.md$/i.test(source.path),
              layer: 'Knowledge_Base',
            };
            if (!target && cloudRoot?.scopeId !== source.scopeId)
              throw Error('この資料のスペースをワークスペースに追加してから開いてください。');
            const opened = target ? await open(target, entry) : await openCloud(cloudRoot!, entry);
            if (!opened)
              throw Error(
                'ファイルを開けませんでした。編集中のノートや実行・接続の状態を確認してください。',
              );
            setKnowledgeOpen(false);
          }}
          onClose={() => setKnowledgeOpen(false)}
        />
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
