import { KnowledgePanel } from './KnowledgePanel';
import { SearchPanel } from './SearchPanel';
import { classify } from '../domain/scopes';
import { useDraft, flushDrafts } from './useDraft';
import { UpdateNotice } from './UpdateNotice';
import { NoteActions, TrashNotes } from './NoteActions';
import type { SearchTarget } from '../editor/search-navigation';
import type { SourceRef } from '../domain/knowledge';
import { appendConversationEvent, type QueuedMessage } from '../domain/conversation';
import { Dialog } from './Dialog';
import { Popover } from '@base-ui/react/popover';
import { AgentMarkdown } from './AgentMarkdown';
import { applyTheme, layoutStorage, loadDeviceSettings, watchSystemTheme } from './device-settings';
import { Appearance } from './Appearance';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
} from 'react-resizable-panels';
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { appIcon, appVersion } from './branding';
import { Icon } from './Icon';
import { useResource } from './useResource';
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
  const [gitReview, setGitReview] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitDetailTarget, setGitDetailTarget] = useState<HTMLDivElement | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchTarget>();
  const [searchNotice, setSearchNotice] = useState('');
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [skill, setSkill] = useState('');
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
    [fresh, setFresh] = useState(false);
  const skillRead = useResource(() => host.skills(active!.scopeId), [active?.scopeId, running], {
    enabled: !!active,
  });
  const skills = skillRead.data?.skills ?? [];
  const skillProblems = skillRead.error
    ? [{ directory: '.agents/skills', message: skillRead.error }]
    : (skillRead.data?.problems ?? []);
  const composer = useDraft(
    active ? { scopeId: active.scopeId, kind: 'composer', agent } : null,
    active?.root,
  );
  const prompt = composer.text;
  function setPrompt(value: string | ((previous: string) => string)) {
    composer.setText(typeof value === 'function' ? value(composer.snapshot().text) : value);
  }
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
    [noteDirectory, setNoteDirectory] = useState('Knowledge_Base/Notes'),
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
  // A skill that disappeared, or a space that does not declare it, must not be sent.
  useEffect(() => {
    if (!skillRead.loading && skill && !skills.some((s) => s.name === skill)) setSkill('');
  }, [skill, skills, skillRead.loading]);
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
  const organizing = useRef(false);
  const reconciliation = useRef(0);
  const dirty = !!doc && buffer !== doc.text;
  const report = (e: unknown) => setError(String(e));
  function load(next: Document, navigation?: SearchTarget) {
    reconciliation.current++;
    current.current = { doc: next, buffer: next.text, external: undefined };
    setSearchTarget(navigation);
    setSearchNotice('');
    setDoc(next);
    setBuffer(next.text);
    setExternal(undefined);
    setMode(
      /\.csv$/i.test(next.path) && !navigation
        ? 'table'
        : /\.md$/i.test(next.path)
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
    const generation = ++reconciliation.current;
    if (organizing.current) return;
    if (saving.current) await saving.current;
    if (generation !== reconciliation.current) return;
    const now = current.current;
    if (!now.doc) return;
    try {
      const disk = now.doc.workspaceId
        ? await host.cloudRead(now.doc.workspaceId, now.doc.path)
        : await host.read(now.doc.scopeId, now.doc.path);
      if (
        generation !== reconciliation.current ||
        organizing.current ||
        current.current.doc?.hash !== now.doc.hash ||
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
      if (
        !organizing.current &&
        generation === reconciliation.current &&
        current.current.doc?.hash === now.doc.hash &&
        current.current.doc?.scopeId === now.doc.scopeId &&
        current.current.doc?.path === now.doc.path
      )
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
      await flushDrafts();
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
    if (!dirty || doc?.readOnly || external || gitBusy) return;
    const timer = setTimeout(() => {
      void save();
    }, 1000);
    return () => clearTimeout(timer);
  }, [dirty, buffer, doc, external, gitBusy]);
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
    if (gitBusy) return false;
    if (!(await composer.flush())) return false;
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
  async function open(space: Space, entry: Entry, navigation?: SearchTarget) {
    if (gitBusy) return false;
    try {
      if (!(await composer.flush())) return false;
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
        load(next, navigation);
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
      skill: skill || undefined,
    });
  }
  async function start() {
    if (
      !active ||
      !conversationReady ||
      !composer.ready ||
      composer.error ||
      submitting.current ||
      gitBusy ||
      !prompt.trim()
    )
      return;
    submitting.current = true;
    setSending(true);
    const message = prompt;
    try {
      if (!(await composer.flush())) return;
      const draftRevision = composer.snapshot().record?.revision;
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
            skill: skill || undefined,
          }),
        );
      } else {
        setQueuePaused(false);
        await sendTurn(message, notePath, fresh);
      }
      if (!(await composer.clear(draftRevision)))
        report(
          '指示は受け付けられましたが、入力欄の下書きを消去できませんでした。再送信せず、保存を再試行してください。',
        );
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
      gitBusy ||
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
  }, [conversationReady, running, sending, queued, queuePaused, external, gitBusy]);
  async function openWorkspace(profile: WorkspaceProfile) {
    if (gitBusy) return;
    setGitOpen(false);
    setGitReview(false);
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
    if (gitBusy) return false;
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
  // Pane sizes are the user's, not the stylesheet's: the group remembers each
  // layout per set of visible panes.
  // The identifiers must describe the panes actually on screen: the group stores
  // a layout per configuration, and a set that is only partly rendered would be
  // written under one name and looked for under another.
  const workspacePanes = useMemo(
    () => (panel ? ['explorer', 'workspace', 'assistant'] : ['explorer', 'workspace']),
    [panel],
  );
  const documentPanes = useMemo(
    () => (terminalSpace ? ['document', 'terminal'] : ['document']),
    [terminalSpace],
  );
  const workspaceLayout = useDefaultLayout({
    id: 'irori-workspace',
    panelIds: workspacePanes,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  const documentLayout = useDefaultLayout({
    id: 'irori-document',
    panelIds: documentPanes,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  if (startup)
    return (
      <Startup
        spaces={spaces}
        refresh={refreshSpaces}
        onOpen={(profile) => void openWorkspace(profile)}
      />
    );
  return (
    <div
      className={`app ${panel ? 'panel-open' : ''} ${gitOpen ? 'source-control-open' : ''} ${terminalSpace ? 'terminal-open' : ''}`}
    >
      <a className="skip-to-editor" href="#editor-main">
        編集領域へ移動
      </a>
      <PaneGroup
        className="workspace-panes"
        orientation="horizontal"
        defaultLayout={workspaceLayout.defaultLayout}
        onLayoutChanged={workspaceLayout.onLayoutChanged}
      >
        <Pane id="explorer" className="explorer-pane" defaultSize={400} minSize={260} maxSize={560}>
          <aside className="sidebar">
            <div className="brand">
              <img className="brand-icon" src={appIcon} alt="" width="40" height="40" />
              irori<span className="preview">{appVersion} Preview</span>
              <Appearance onError={report} />
            </div>
            <UpdateNotice check={host.checkForUpdates} open={host.openUpdatePage} />
            <button
              className="workspace-switch"
              disabled={dirty || running || connecting || !!terminalSpace || gitBusy}
              onClick={() => {
                if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
                  report('未保存のノートを保存してから移動してください。');
                  return;
                }
                void flushDrafts()
                  .then(() => setStartup(true))
                  .catch(report);
              }}
            >
              <Icon name="grid" />
              <span>
                <small>ワークスペース</small>
                {workspace?.name ?? 'ワークスペース'}
              </span>
              <Icon name="chevron" className="rotated" size={13} />
            </button>
            <ToggleGroup
              className="workspace-views"
              aria-label="ワークスペースの表示"
              value={[gitOpen ? 'source-control' : 'notes']}
              onValueChange={(next) => {
                const selected = next[0];
                if (!selected) return;
                if (selected === 'notes') {
                  setGitOpen(false);
                  setGitReview(false);
                } else {
                  void save().then((saved) => {
                    if (saved) setGitOpen(true);
                  });
                }
              }}
            >
              <Toggle value="notes" disabled={gitBusy}>
                <Icon name="folder" /> ノート
              </Toggle>
              <Toggle
                value="source-control"
                disabled={
                  !active || running || sending || queued.length > 0 || connecting || gitBusy
                }
              >
                <Icon name="branch" /> ソース管理
              </Toggle>
            </ToggleGroup>
            {gitOpen && active && (
              <GitPanel
                spaces={spaces.filter((s) => workspace?.scopeIds.includes(s.scopeId))}
                initialScope={active.scopeId}
                detailTarget={gitDetailTarget}
                onReviewChange={setGitReview}
                onBusyChange={setGitBusy}
                revision={revision}
                beforeAction={async () => {
                  if (running || sending || queued.length > 0 || connecting) {
                    report('実行が終わってから Git を操作してください。');
                    return false;
                  }
                  return save();
                }}
                onClose={() => {
                  setGitOpen(false);
                  setGitReview(false);
                }}
                onChanged={() => {
                  setRevision((r) => r + 1);
                  void reconcile();
                }}
              />
            )}
            <div className="explorer-content" hidden={gitOpen}>
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
                    if (selected) {
                      setNoteDirectory(
                        doc?.scopeId === space.scopeId
                          ? doc.path.split('/').slice(0, -1).join('/')
                          : 'Knowledge_Base/Notes',
                      );
                      setNewNote(true);
                    }
                  });
                }}
                onRefresh={() => setRevision((value) => value + 1)}
              />
              {active && (
                <button
                  className="workspace-search workspace-trash"
                  disabled={running || sending || gitBusy || connecting}
                  onClick={() => {
                    void save().then((saved) => {
                      if (saved) setTrashOpen(true);
                    });
                  }}
                >
                  削除したノートを復元
                </button>
              )}
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
            </div>
          </aside>
        </Pane>
        <PaneSeparator className="pane-handle" aria-label="サイドバーの幅" />
        <Pane id="workspace" className="workspace-pane" minSize={360}>
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
                {cloudRoot && (
                  <button
                    disabled={running || dirty || connecting || gitBusy}
                    onClick={() => showConnections(cloudRoot)}
                  >
                    <Icon name="cloud" /> クラウド接続
                  </button>
                )}
                {active && (
                  <button
                    disabled={running || dirty || connecting || gitBusy}
                    onClick={() => setOntologyOpen(true)}
                  >
                    オントロジー
                  </button>
                )}
                {connecting && <small>接続を準備中…</small>}
                {active && (
                  <button
                    disabled={connecting || gitBusy}
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
                    <button disabled={gitBusy} onClick={() => void reconcile()}>
                      再読み込み
                    </button>
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
            <PaneGroup
              className="document-panes"
              orientation="vertical"
              defaultLayout={documentLayout.defaultLayout}
              onLayoutChanged={documentLayout.onLayoutChanged}
            >
              <Pane id="document" className="document-pane" minSize={180}>
                <div className="git-detail-slot" ref={setGitDetailTarget} hidden={!gitReview} />
                <div className="note-surface" hidden={gitReview}>
                  {doc ? (
                    <>
                      <div className="doc-toolbar">
                        <span>{dirty ? '保存待ち' : status}</span>
                        <div className="actions">
                          {!doc.readOnly &&
                            /\.md$/i.test(doc.path) &&
                            spaces.some(
                              (space) =>
                                space.scopeId === doc.scopeId &&
                                classify(space, doc.path) === 'Knowledge_Base',
                            ) && (
                              <NoteActions
                                key={`${doc.scopeId}:${doc.path}`}
                                doc={doc}
                                onBusyChange={(busy) => {
                                  reconciliation.current++;
                                  organizing.current = busy;
                                  if (!busy) void reconcile();
                                }}
                                beforeChange={async () => {
                                  if (running || sending || queued.length || gitBusy || connecting)
                                    throw Error(
                                      '実行・Git 操作・接続が完了してからノートを整理してください。',
                                    );
                                  if (!(await save())) return null;
                                  return current.current.doc ?? null;
                                }}
                                onChanged={(next, notice) => {
                                  const previous = doc;
                                  if (next) {
                                    load(next);
                                    setSources((all) =>
                                      all.map((ref) =>
                                        ref.scopeId === previous.scopeId &&
                                        ref.path === previous.path
                                          ? { scopeId: next.scopeId, path: next.path }
                                          : ref,
                                      ),
                                    );
                                  } else {
                                    current.current = {
                                      doc: undefined,
                                      buffer: '',
                                      external: undefined,
                                    };
                                    setDoc(undefined);
                                    setBuffer('');
                                    setExternal(undefined);
                                    setSources((all) =>
                                      all.filter(
                                        (ref) =>
                                          ref.scopeId !== previous.scopeId ||
                                          ref.path !== previous.path,
                                      ),
                                    );
                                  }
                                  setRevision((value) => value + 1);
                                  setStatus(
                                    notice ??
                                      (next
                                        ? 'ノートの場所を変更しました。参照元のリンクは必要に応じて更新してください。'
                                        : 'ノートを復元用に保管しました。「削除したノートを復元」から戻せます。'),
                                  );
                                }}
                              />
                            )}
                          <button
                            disabled={
                              sources.length >= 20 ||
                              sources.some(
                                (ref) => ref.scopeId === doc.scopeId && ref.path === doc.path,
                              )
                            }
                            onClick={() => {
                              void save().then((saved) => {
                                if (saved)
                                  setSources((all) => [
                                    ...all,
                                    { scopeId: doc.scopeId, path: doc.path },
                                  ]);
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
                        {searchNotice && (
                          <p className="hint" role="status">
                            {searchNotice}
                          </p>
                        )}
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
                              searchTarget={searchTarget}
                              onSearchResult={(found) =>
                                setSearchNotice(
                                  found
                                    ? `${searchTarget?.line} 行目の一致箇所を選択しました。`
                                    : '一致箇所を安全に特定できませんでした。ファイルの更新、または表示されない Markdown 記法が含まれる可能性があります。再検索して確認してください。',
                                )
                              }
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
                </div>
              </Pane>
              {terminalSpace && (
                <>
                  <PaneSeparator className="pane-handle" aria-label="ターミナルの高さ" />
                  <Pane id="terminal" className="terminal-pane" defaultSize={300} minSize={120}>
                    <Suspense fallback={<p className="hint">ターミナルを開いています…</p>}>
                      <TerminalPanel
                        space={terminalSpace}
                        onClose={() => setTerminalSpace(undefined)}
                      />
                    </Suspense>
                  </Pane>
                </>
              )}
            </PaneGroup>
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
        </Pane>
        {panel && (
          <>
            <PaneSeparator className="pane-handle" aria-label="AIパネルの幅" />
            <Pane
              id="assistant"
              className="assistant-pane"
              defaultSize={380}
              minSize={280}
              maxSize={620}
            >
              <aside className="agent-panel">
                <div className="agent-heading">
                  <h2>
                    <Icon name="sparkles" />
                    AIに相談
                  </h2>
                  <div className="actions">
                    <button
                      aria-label="新しい会話"
                      title="次の送信から新しい会話"
                      aria-pressed={fresh}
                      disabled={running || sending || queued.length > 0}
                      onClick={() => {
                        setFresh((value) => !value);
                        document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                      }}
                    >
                      <Icon name="plus" />
                    </button>
                    <Popover.Root>
                      <Popover.Trigger
                        className="agent-settings"
                        aria-label="会話と接続の設定"
                        title="会話と接続の設定"
                      >
                        •••
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
                          {/* Opening with the pointer left the close button focused.
                              Keyboard users still get the default focus move. */}
                          <Popover.Popup
                            className="agent-settings-sheet"
                            initialFocus={(interaction) => interaction === 'keyboard'}
                          >
                            <div className="agent-settings-heading">
                              <Popover.Title render={<strong />}>会話と接続</Popover.Title>
                              <Popover.Close aria-label="会話の設定を閉じる">
                                <Icon name="close" />
                              </Popover.Close>
                            </div>
                            <p>
                              {agentNames[agent]}{' '}
                              <span>
                                {infos.find((i) => i.id === agent)?.version || 'CLIを確認中'}
                              </span>
                            </p>
                            <p>{infos.find((i) => i.id === agent)?.detail}</p>
                            {infos.find((i) => i.id === agent)?.available &&
                              infos.find((i) => i.id === agent)?.tested === false && (
                                <p>このCLIバージョンは未検証です。</p>
                              )}
                            {active && (
                              <SessionControls
                                key={`${active.scopeId}:${agent}`}
                                scopeId={active.scopeId}
                                agent={agent}
                                running={
                                  running || sending || queued.length > 0 || !conversationReady
                                }
                                onError={report}
                                onReset={() => {
                                  if (conversationKey.current !== `${active.scopeId}:${agent}`)
                                    return;
                                  setFresh(false);
                                }}
                              />
                            )}
                          </Popover.Popup>
                        </Popover.Positioner>
                      </Popover.Portal>
                    </Popover.Root>
                    <button aria-label="AIパネルを閉じる" onClick={() => setPanel(false)}>
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
                {infos.find((i) => i.id === agent)?.available === false && (
                  <p className="agent-connection-error" role="alert">
                    CLI が見つかりません。インストールとネイティブログインを確認してください。
                  </p>
                )}
                {!conversationReady && (
                  <div className="hint" role="status">
                    {conversationError || '保存した会話を読み込んでいます…'}
                    {conversationError && (
                      <button onClick={() => setHistoryReload((value) => value + 1)}>再試行</button>
                    )}
                  </div>
                )}
                {historyTruncated && (
                  <div className="hint">
                    保存上限により、古い履歴や長い出力の一部を省略しています。
                  </div>
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
                      <p>ノートについて相談する</p>
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
                        ) : event.role === 'user' ? (
                          <span>{event.text}</span>
                        ) : (
                          <AgentMarkdown text={event.text} />
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
                  {fresh && (
                    <p className="new-session" role="status">
                      次の送信から新しい会話を始めます。
                      <button onClick={() => setFresh(false)}>取り消す</button>
                    </p>
                  )}
                  <div className="composer-context" aria-label="相談の対象">
                    <span className="context-chip" title={active?.name}>
                      <Icon name="folder" size={12} />
                      {active?.name ?? 'スペース未選択'}
                    </span>
                    {doc?.scopeId === active?.scopeId && doc && (
                      <span className="context-chip" title={doc.path}>
                        <Icon name="file" size={12} />
                        {doc.path.split('/').at(-1)}
                      </span>
                    )}
                  </div>
                  {sources.length > 0 && (
                    <div className="selected-sources" aria-label="選択した参照資料">
                      {sources.map((source) => (
                        <div key={`${source.scopeId}:${source.path}`}>
                          <span title={source.path}>
                            {spaces.find((space) => space.scopeId === source.scopeId)?.name ??
                              'Drive'}{' '}
                            / {source.path}
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
                  <textarea
                    aria-label="エージェントへの指示"
                    placeholder="ノートについて相談、編集を依頼…"
                    value={prompt}
                    disabled={!composer.ready || sending}
                    maxLength={100000}
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
                  {composer.error ? (
                    <div className="hint" role="alert">
                      {composer.error}
                      <button onClick={() => void composer.retry()}>下書き保存を再試行</button>
                    </div>
                  ) : (
                    <small className="muted" role="status">
                      {!composer.ready
                        ? '下書きを読み込み中…'
                        : composer.pending
                          ? '下書きを保存中…'
                          : prompt
                            ? '未送信の下書きをこの端末に保存済み'
                            : ''}
                    </small>
                  )}
                  {skillProblems.length > 0 && (
                    <small className="muted" role="status">
                      読み込めないスキル: {skillProblems.map((p) => p.directory).join('、')}
                    </small>
                  )}
                  <div className="composer-actions">
                    <div className="composer-selects">
                      {skills.length > 0 && (
                        <select
                          aria-label="スキル"
                          className="composer-skill"
                          value={skill}
                          title={
                            skills.find((s) => s.name === skill)?.description ?? 'スキルを使わない'
                          }
                          disabled={sending || gitBusy}
                          onChange={(e) => setSkill(e.target.value)}
                        >
                          <option value="">スキルなし</option>
                          {skills.map((s) => (
                            <option key={s.name} value={s.name} title={s.description}>
                              {s.name} — {s.description}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        aria-label="エージェント"
                        value={agent}
                        disabled={running || sending || queued.length > 0 || gitBusy}
                        onChange={(e) => {
                          const next = e.target.value as AgentId;
                          void composer.flush().then((saved) => {
                            if (saved) setAgent(next);
                          });
                        }}
                      >
                        {agentIds.map((id) => (
                          <option key={id} value={id}>
                            {agentNames[id]}
                          </option>
                        ))}
                      </select>
                    </div>
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
                          !composer.ready ||
                          !!composer.error ||
                          sending ||
                          gitBusy ||
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
                </div>
              </aside>
            </Pane>
          </>
        )}
      </PaneGroup>
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
      {searchOpen && (
        <SearchPanel
          spaces={spaces.filter((space) => workspace?.scopeIds.includes(space.scopeId))}
          initialScopeId={active?.scopeId}
          beforeSearch={save}
          onOpen={async (scopeId, hit, query) => {
            const target = spaces.find(
              (space) => space.scopeId === scopeId && workspace?.scopeIds.includes(space.scopeId),
            );
            if (!target) throw Error('この KB をワークスペースに追加してから開いてください。');
            const opened = await open(
              target,
              {
                path: hit.path,
                name: hit.path.split('/').at(-1)!,
                directory: false,
                note: /\.md$/i.test(hit.path),
                layer: 'Knowledge_Base',
              },
              { query, line: hit.line, preview: hit.preview },
            );
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
                void (async () => {
                  if (!(await save())) throw Error('現在のノートを保存してから作成してください。');
                  return host.createNote(active.scopeId, noteName, noteDirectory);
                })()
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
            <label>
              保存先フォルダー（KB 内の相対パス）
              <input
                aria-label="保存先フォルダー"
                value={noteDirectory}
                onChange={(event) => setNoteDirectory(event.target.value)}
                maxLength={4096}
                placeholder="Knowledge_Base/Notes"
              />
            </label>
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
      {trashOpen && active && (
        <TrashNotes
          scopeId={active.scopeId}
          onClose={() => setTrashOpen(false)}
          onRestored={(next, notice) => {
            setTrashOpen(false);
            load(next);
            setStatus(notice ?? 'ノートを元の場所に復元しました。');
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
// A render failure used to leave an empty window. The boundary keeps the failure
// visible and recoverable without restarting the application.
function AppCrash({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="app-crash" role="alert">
      <h1>画面の描画でエラーが発生しました</h1>
      <p>
        保存済みのノートには影響しません。未保存の編集は失われることがあります。再表示しても直らない場合は、アプリを再起動してください。
      </p>
      <pre>{String(error)}</pre>
      <button className="primary" onClick={resetErrorBoundary}>
        再表示
      </button>
    </div>
  );
}
// The device record carries the theme and the pane sizes, so it is read before
// the first render rather than applied over one.
watchSystemTheme();
void loadDeviceSettings().finally(() => {
  applyTheme();
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary FallbackComponent={AppCrash}>
      <App />
    </ErrorBoundary>,
  );
});
