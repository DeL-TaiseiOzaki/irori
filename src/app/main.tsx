import { classify } from '../domain/scopes';
import { useDraft, flushDrafts } from './useDraft';
import { NoteActionDialog, noteActionsApply, TrashNotes, type NoteAction } from './NoteActions';
import {
  CloudEntryDialog,
  entryActions,
  actionLabel,
  type EntryAction,
  type EntryChange,
} from './CloudEntryActions';
import type { SearchTarget } from '../editor/search-navigation';
import type { NoteAuthorship, SourceRef } from '../domain/knowledge';
import { appendConversationEvent, type QueuedMessage } from '../domain/conversation';
import { agentAccessOptions, agentAccessLabel, agentAccessDetail } from '../domain/agent-access';
import { Dialog } from './Dialog';
import { SkillPicker } from './SkillPicker';
import { retirementNotice } from '../domain/skills';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import {
  applyLanguage,
  applyMarkdownFont,
  applyTheme,
  chooseEditorAssistance,
  currentEditorAssistance,
  layoutStorage,
  loadDeviceSettings,
  watchSystemTheme,
} from './device-settings';
import { useLanguage } from './useLanguage';
import { t } from '../domain/i18n';
import { CloudRecoveryDialog } from './CloudRecovery';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
} from 'react-resizable-panels';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentEvent,
  AgentAccess,
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
// Panels only some sessions open. Loading them on first use keeps their code,
// and the libraries they alone pull in, out of the first paint. Each keeps its
// own name so the panels below read the same as before.
const GitPanelView = lazy(() => import('./GitPanel').then((m) => ({ default: m.GitPanel })));
function GitPanel(props: ComponentProps<typeof GitPanelView>) {
  return (
    <Suspense fallback={null}>
      <GitPanelView {...props} />
    </Suspense>
  );
}
const ConnectionsView = lazy(() =>
  import('./Connections').then((m) => ({ default: m.Connections })),
);
function Connections(props: ComponentProps<typeof ConnectionsView>) {
  return (
    <Suspense fallback={null}>
      <ConnectionsView {...props} />
    </Suspense>
  );
}
const SearchPanelView = lazy(() =>
  import('./SearchPanel').then((m) => ({ default: m.SearchPanel })),
);
function SearchPanel(props: ComponentProps<typeof SearchPanelView>) {
  return (
    <Suspense fallback={null}>
      <SearchPanelView {...props} />
    </Suspense>
  );
}
const BacklinksPanelView = lazy(() =>
  import('./SearchPanel').then((m) => ({ default: m.BacklinksPanel })),
);
function BacklinksPanel(props: ComponentProps<typeof BacklinksPanelView>) {
  return (
    <Suspense fallback={null}>
      <BacklinksPanelView {...props} />
    </Suspense>
  );
}
const KnowledgePanelView = lazy(() =>
  import('./KnowledgePanel').then((m) => ({ default: m.KnowledgePanel })),
);
function KnowledgePanel(props: ComponentProps<typeof KnowledgePanelView>) {
  return (
    <Suspense fallback={null}>
      <KnowledgePanelView {...props} />
    </Suspense>
  );
}
import type { EditorHandle } from '../editor/Editor';
import './tokens.css';
import './style.css';
import './shell.css';
import './stage.css';
import './agent-panel.css';
import { Startup, RegisterSpace } from './Startup';
import { appIcon } from './branding';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { agentIds, agentNames } from '../domain/types';
import { AgentLog } from './AgentLog';
import { BrainPanel, type BrainMode } from './BrainPanel';
import { BrainTile } from './BrainTile';
import { AiToggle, Crumbs, fileCrumbs, NoteInfo, NoteMenu, StageButton } from './NoteBar';
import { Rail, type BrainAiState } from './Rail';
import { Settings } from './Settings';
import { StatusBar } from './StatusBar';
const host = window.irori;
function SessionControls({
  scopeId,
  agent,
  access,
  running,
  onReset,
  onError,
}: {
  scopeId: string;
  agent: AgentId;
  access: AgentAccess;
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
          ? t('会話の状態を確認中…', 'Checking the conversation state…')
          : session.state === 'saved'
            ? (session.access ?? 'default') === access
              ? t(
                  '次の実行で前回の会話を引き継ぎます。履歴はこの端末に保存されます。',
                  'The next run continues the previous conversation. History is saved on this device.',
                )
              : t(
                  'アクセス設定が変わるため、次の実行で新しい会話を始めます。表示履歴は残ります。',
                  'Because the access setting changed, the next run starts a new conversation. The displayed history remains.',
                )
            : session.state === 'empty'
              ? t('次の実行で新しい会話を始めます。', 'The next run starts a new conversation.')
              : session.detail}
      </small>
      {session && session.state !== 'empty' && (
        <>
          <button disabled={running || resetting} onClick={() => void reset()}>
            {t('会話の継続をリセット', 'Reset conversation continuation')}
          </button>
          <small>
            {t(
              'このスペース・エージェントの継続を解除します。ノートと保存した履歴は残ります。',
              'This clears continuation for this space and agent. Notes and saved history remain.',
            )}
          </small>
        </>
      )}
    </div>
  );
}
/** A backlink points at a link on the line, a search hit at matching text; the notice says which. */
type Navigation = SearchTarget & { link?: boolean };
function navigationNotice(target: Navigation, found: boolean) {
  const what = t(target.link ? 'リンク' : '一致箇所', target.link ? 'link' : 'matching text');
  if (found)
    return t(
      `${target.line} 行目の${what}を選択しました。`,
      `Selected the ${what} on line ${target.line}.`,
    );
  return t(
    `${what}を安全に特定できませんでした。ファイルの更新、または表示されない Markdown 記法が含まれる可能性があります。${
      target.link ? `${target.line} 行目を確認してください。` : '再検索して確認してください。'
    }`,
    `Could not safely locate the ${what}. The file may have changed, or it may contain Markdown syntax that isn’t shown. ${
      target.link ? `Check line ${target.line}.` : 'Search again to check.'
    }`,
  );
}
/** A set of scope IDs with one added or removed, unchanged when nothing changes. */
function mark(all: string[], scopeId: string, value: boolean) {
  return value === all.includes(scopeId)
    ? all
    : value
      ? [...all, scopeId]
      : all.filter((id) => id !== scopeId);
}
function App() {
  // Interface text is chosen while rendering, so a language change re-renders
  // the whole tree from here; component state, drafts and the editor are kept.
  useLanguage();
  const [editorAssistance, setEditorAssistance] = useState(currentEditorAssistance);
  const [savingAssistance, setSavingAssistance] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  // An editable Drive folder the next note goes into, instead of the active KB.
  const [cloudNoteTarget, setCloudNoteTarget] = useState<{ scopeId: string; directory: string }>();
  // A file or folder of an editable Drive folder being renamed, moved or deleted.
  const [entryAction, setEntryAction] = useState<{
    space: CloudRoot;
    entry: Entry;
    action: EntryAction;
  }>();
  const [workspace, setWorkspace] = useState<WorkspaceProfile>(),
    [startup, setStartup] = useState(true);
  const [connectionsOpen, setConnectionsOpen] = useState(false),
    [connecting, setConnecting] = useState(false);
  const [cloudRoot, setCloudRoot] = useState<CloudRoot>(),
    [connectionTarget, setConnectionTarget] = useState<CloudRoot>();
  // The brain panel shows its files or, in place of them, its changes.
  const [brainMode, setBrainMode] = useState<BrainMode>('files');
  const gitOpen = brainMode === 'changes';
  const [recovering, setRecovering] = useState(false);
  const [noteAction, setNoteAction] = useState<NoteAction>();
  const [gitReview, setGitReview] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitDetailTarget, setGitDetailTarget] = useState<HTMLDivElement | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [backlinks, setBacklinks] = useState<{ scopeId: string; path: string }>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<Navigation>();
  const [searchNotice, setSearchNotice] = useState('');
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [skill, setSkill] = useState('');
  const [personLines, setPersonLines] = useState(false);
  const [accessSelection, setAccessSelection] = useState<{ owner: string; value: AgentAccess }>();
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
  // The workspace's brains in the order its owner chose.
  const workspaceSpaces = (workspace?.scopeIds ?? []).flatMap((id) =>
    spaces.filter((space) => space.scopeId === id),
  );
  const accessOwner = `${workspace?.id ?? ''}:${active?.scopeId ?? ''}:${agent}`;
  const access = accessSelection?.owner === accessOwner ? accessSelection.value : 'default';
  useEffect(() => setAccessSelection(undefined), [workspace?.id, active?.scopeId, agent]);
  const [events, setEvents] = useState<AgentEvent[]>([]),
    [runningScopes, setRunningScopes] = useState<string[]>([]),
    [waitingScopes, setWaitingScopes] = useState<string[]>([]),
    [fresh, setFresh] = useState(false);
  const [skillRevision, setSkillRevision] = useState(0);
  const [authorship, setAuthorship] = useState<NoteAuthorship>();
  const skillRead = useResource(() => host.skills(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: skillRevision,
  });
  const skills = skillRead.data?.skills ?? [];
  const skillsRetired = skillRead.data?.retired ?? [];
  const skillProblems = skillRead.error
    ? [{ directory: '.agents/skills', message: skillRead.error }]
    : (skillRead.data?.problems ?? []);
  const notesRead = useResource(() => host.notesDeclaration(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  const notesDeclared = notesRead.data ?? null;
  // The brain's top level, shared by its three sections and the AI panel's Schema line.
  const rootsRead = useResource(() => host.entries(active!.scopeId, ''), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  const roots =
    rootsRead.data || rootsRead.error
      ? { entries: rootsRead.data ?? [], error: rootsRead.error }
      : undefined;
  // The branch and changes shown beside the brain; Git itself reads without locking.
  const gitRead = useResource(() => host.gitStatus(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  // Drive folders' upload state changes without file events, so it is polled.
  const connectionsRead = useResource(
    () => host.cloudConnections(active!.scopeId),
    [active?.scopeId],
    { enabled: !!active && !startup, refresh: revision, interval: 5000 },
  );
  const connections = connectionsRead.data ?? [];
  const uploads = connections.reduce((sum, connection) => sum + (connection.pending ?? 0), 0);
  const defaultNoteDirectory = notesDeclared?.newNoteDirectory ?? 'Knowledge_Base/Notes';
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
  // A run belongs to one space. Every space's run is tracked so the explorer can
  // mark them, while the panel's controls follow the selected space alone.
  function markRunning(scopeId: string, value: boolean) {
    setRunningScopes((all) => mark(all, scopeId, value));
  }
  // A run waits for the person while a permission or question is open.
  function markWaiting(scopeId: string, value: boolean) {
    setWaitingScopes((all) => mark(all, scopeId, value));
  }
  function aiState(scopeId: string): BrainAiState {
    return waitingScopes.includes(scopeId)
      ? 'waiting'
      : runningScopes.includes(scopeId)
        ? 'running'
        : 'idle';
  }
  const running = !!active && runningScopes.includes(active.scopeId);
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
          markRunning(active.scopeId, !!value.activeRunId);
          const last = value.events.at(-1);
          markWaiting(
            active.scopeId,
            !!value.activeRunId &&
              last?.runId === value.activeRunId &&
              (last.type === 'permission' || last.type === 'question'),
          );
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
  // A skill choice belongs to one space, even when another space declares the same name.
  useEffect(() => setSkill(''), [active?.scopeId]);
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
  // Who typed which line of the open note. A Drive file is outside the KB's Git
  // history and has no record; a failure here leaves the note unmarked rather than unopenable.
  useEffect(() => {
    if (!doc || doc.workspaceId || doc.cloud) return setAuthorship(undefined);
    let current = true;
    const { scopeId, path, text } = doc;
    void host
      .noteAuthorship(scopeId, path, text)
      .then((value) => current && setAuthorship(value))
      .catch(() => current && setAuthorship(undefined));
    return () => {
      current = false;
    };
  }, [doc?.scopeId, doc?.path, doc?.hash, doc?.workspaceId]);
  const personLineCount = authorship?.lines.filter(Boolean).length ?? 0;
  // Offered only for a note of the active space that has such lines to name.
  const personLinesOffered = personLineCount > 0 && !!active && doc?.scopeId === active.scopeId;
  const editor = useRef<EditorHandle>(null);
  const current = useRef({ doc, buffer, external });
  current.current = { doc, buffer, external };
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const organizing = useRef(false);
  const reconciliation = useRef(0);
  const dirty = !!doc && buffer !== doc.text;
  const report = (e: unknown) => setError(String(e));
  function openDaily() {
    if (!active) return;
    const scopeId = active.scopeId;
    void save()
      .then(async (saved) => {
        if (!saved) return;
        load(await host.dailyNote(scopeId));
        setRevision((value) => value + 1);
      })
      .catch(report);
  }
  async function followLink(href: string) {
    const from = current.current.doc;
    const space = spaces.find((item) => item.scopeId === from?.scopeId);
    if (!from || !space) return;
    setSearchNotice('');
    try {
      const target = await host.resolveLink(space.scopeId, from.path, href);
      if (target.kind === 'external') await host.openUrl(target.url);
      else if (target.kind === 'file')
        await open(space, {
          path: target.path,
          name: target.path.split('/').at(-1)!,
          directory: false,
          note: target.note,
          layer: classify(space, target.path),
        });
      // The note stays open, so the answer belongs beside it rather than in the
      // status line the window shows only when nothing is open.
      else if (target.kind === 'missing')
        setSearchNotice(
          t(
            `リンク先のファイルがまだありません: ${target.path}`,
            `The linked file doesn’t exist yet: ${target.path}`,
          ),
        );
      else if (target.kind === 'anchor')
        setSearchNotice(
          t('このノート内の見出しへのリンクです。', 'This links to a heading in this note.'),
        );
      else setSearchNotice(target.reason);
    } catch (error) {
      report(error);
    }
  }
  function load(next: Document, navigation?: Navigation) {
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
    setStatus(
      next.readOnly
        ? t('クラウド資料・読み取り専用', 'Cloud material · Read-only')
        : next.cloud
          ? t('Google Drive の資料・編集できます', 'Google Drive material · editable')
          : t('この端末に保存済み', 'Saved on this device'),
    );
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
      ) {
        report(e);
        return false;
      }
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
        if (incoming.scopeId) {
          markRunning(incoming.scopeId, incoming.type !== 'done');
          markWaiting(
            incoming.scopeId,
            incoming.type === 'permission' || incoming.type === 'question',
          );
        }
        if (conversationKey.current !== `${incoming.scopeId}:${incoming.agent}`) return;
        eventRevision.current++;
        updateEvents((all) => {
          const next = appendConversationEvent(all, incoming).slice(-400);
          const last = next.at(-1)!;
          return [...next.slice(0, -1), { ...last, text: last.text.slice(-200000) }];
        });
        if (incoming.type === 'done') {
          setSkillRevision((value) => value + 1);
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
  function closeNewNote() {
    setNewNote(false);
    setCloudNoteTarget(undefined);
  }
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
          setStatus(
            saved.cloud
              ? t(
                  '保存しました。Google Drive へ自動で送信されます。',
                  'Saved. It is uploaded to Google Drive automatically.',
                )
              : t('この端末に保存済み', 'Saved on this device'),
          );
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
  // rclone learns of a change made in Drive elsewhere only by polling, so a Drive
  // document at rest is read again now and then; the change would otherwise show
  // only when a save ran into it. A failed check ends the checks until the document
  // changes, so an unreachable folder is reported once rather than every tick.
  useEffect(() => {
    if (!doc?.cloud || dirty) return;
    const timer = setInterval(async () => {
      if ((await reconcile()) === false) clearInterval(timer);
    }, 25000);
    return () => clearInterval(timer);
  }, [doc, dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Ctrl+` opens and closes the terminal, from inside it too.
      if (e.ctrlKey && e.key === '`' && !startup) {
        e.preventDefault();
        if (terminalSpace || active) setTerminalSpace((value) => (value ? undefined : active));
        return;
      }
      if ((e.target as HTMLElement).closest('.terminal-panel')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !startup && !searchOpen) {
        e.preventDefault();
        if (workspaceSpaces.length && !connecting) setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  async function selectSpace(space: Space) {
    if (gitBusy) return false;
    if (!(await composer.flush())) return false;
    if (!(await save())) return false;
    if (sending || queued.length || connecting) return false;
    if (active?.scopeId !== space.scopeId) {
      setActive(space);
      setDoc(undefined);
      setBuffer('');
      setExternal(undefined);
      setStatus('');
    }
    return true;
  }
  async function open(space: Space, entry: Entry, navigation?: Navigation) {
    if (gitBusy) return false;
    try {
      if (!(await composer.flush())) return false;
      if (entry.blocked) {
        setStatus(entry.blocked);
        return false;
      }
      if (!(await save())) return false;
      if ((sending || queued.length > 0) && space.scopeId !== active?.scopeId) {
        setError(
          t(
            '送信待ちを完了してからスペースを切り替えてください。',
            'Finish the pending send before switching spaces.',
          ),
        );
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
    markRunning(active!.scopeId, true);
    await host.start({
      scopeId: active!.scopeId,
      agent,
      access,
      prompt: message,
      notePath,
      newSession,
      sources: selectedSources,
      skill: skill || undefined,
      personLines: (personLines && personLinesOffered) || undefined,
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
            access,
            prompt: message,
            notePath,
            sources,
            skill: skill || undefined,
            personLines: (personLines && personLinesOffered) || undefined,
          }),
        );
      } else {
        setQueuePaused(false);
        await sendTurn(message, notePath, fresh);
      }
      if (!(await composer.clear(draftRevision)))
        report(
          t(
            '指示は受け付けられましたが、入力欄の下書きを消去できませんでした。再送信せず、保存を再試行してください。',
            'The instruction was accepted, but the composer draft could not be cleared. Do not resend; retry saving instead.',
          ),
        );
      setFresh(false);
    } catch (e) {
      if (!running) markRunning(active!.scopeId, false);
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
        markRunning(active!.scopeId, true);
        followConversation.current = true;
        await host.startQueuedMessage(active!.scopeId, agent, next.id);
        setQueued((all) => all.filter((item) => item.id !== next.id));
      } catch (error) {
        markRunning(active!.scopeId, false);
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
    setBrainMode('files');
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
      // Drive folders belong to KBs; a workspace's own connections from before
      // that are moved into a KB from its connection dialog, and are not mounted.
      const nextIds = available.map((space) => space.scopeId);
      for (const previousId of workspace ? [...workspace.scopeIds, workspace.id] : []) {
        if (
          (previousId === workspace?.id || !nextIds.includes(previousId)) &&
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
              setStatus(
                t(
                  '接続できないクラウドがあります。「クラウド接続」で確認できます。',
                  'A cloud could not connect. Check it from "Cloud connection".',
                ),
              );
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
  // The open document and the references follow a moved entry and leave with a deleted one.
  async function entryChanged(change: EntryChange) {
    const under = (ref: SourceRef) =>
      ref.scopeId === change.scopeId &&
      (ref.path === change.from || ref.path.startsWith(`${change.from}/`));
    const follow = (ref: SourceRef): SourceRef | undefined =>
      change.action === 'delete'
        ? undefined
        : { scopeId: ref.scopeId, path: change.to + ref.path.slice(change.from.length) };
    const open = current.current.doc;
    if (open && under(open)) {
      const next = follow(open);
      const reopened =
        next &&
        (await (
          open.workspaceId
            ? host.cloudRead(open.workspaceId, next.path)
            : host.read(open.scopeId, next.path)
        ).catch((error) => {
          report(error);
          return undefined;
        }));
      if (reopened) load(reopened);
      else {
        current.current = { doc: undefined, buffer: '', external: undefined };
        setDoc(undefined);
        setBuffer('');
        setExternal(undefined);
      }
    }
    setSources((all) =>
      all.flatMap((ref) => {
        if (!under(ref)) return [ref];
        const moved = follow(ref);
        return moved ? [moved] : [];
      }),
    );
    setRevision((value) => value + 1);
    setStatus(
      change.action === 'delete'
        ? t('Google Drive のゴミ箱に移しました。', "Moved to Google Drive's trash.")
        : change.action === 'rename'
          ? t('名前を変更しました。', 'Renamed.')
          : t('移動しました。', 'Moved.'),
    );
  }
  // Pane sizes are the user's, not the stylesheet's: the group remembers each
  // layout per set of visible panes.
  // The identifiers must describe the panes actually on screen: the group stores
  // a layout per configuration, and a set that is only partly rendered would be
  // written under one name and looked for under another.
  const islandPanes = useMemo(
    () => (panel ? ['brain', 'stage', 'assistant'] : ['brain', 'stage']),
    [panel],
  );
  const documentPanes = useMemo(
    () => (terminalSpace ? ['document', 'terminal'] : ['document']),
    [terminalSpace],
  );
  const islandLayout = useDefaultLayout({
    id: 'irori-islands',
    panelIds: islandPanes,
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
  // A run, a send, queued work or a connection keeps the brain on show.
  const brainLocked = running || sending || queued.length > 0 || connecting;
  const docSpace =
    doc && !doc.workspaceId ? spaces.find((s) => s.scopeId === doc.scopeId) : undefined;
  const docLayer = doc?.cloud
    ? 'contents'
    : docSpace && doc
      ? classify(docSpace, doc.path)
      : undefined;
  const agentInfo = infos.find((i) => i.id === agent);
  const waiting = !!active && waitingScopes.includes(active.scopeId);
  const instructionFile = (agent === 'claude' ? ['CLAUDE.md', 'AGENTS.md'] : ['AGENTS.md']).find(
    (name) => roots?.entries.some((entry) => entry.path === name),
  );
  const referenced =
    !!doc && sources.some((ref) => ref.scopeId === doc.scopeId && ref.path === doc.path);
  function leaveWorkspace() {
    if (doc && (editor.current?.getText() ?? buffer) !== doc.text) {
      report(
        t('未保存のノートを保存してから移動してください。', 'Save the unsaved note before moving.'),
      );
      return;
    }
    void flushDrafts()
      .then(() => setStartup(true))
      .catch(report);
  }
  function newNoteIn(space: Space) {
    void selectSpace(space).then((selected) => {
      if (selected) {
        setNoteDirectory(
          doc?.scopeId === space.scopeId
            ? doc.path.split('/').slice(0, -1).join('/')
            : defaultNoteDirectory,
        );
        setNewNote(true);
      }
    });
  }
  function switchView(next: 'rich' | 'source' | 'table') {
    setBuffer(editor.current?.getText() ?? buffer);
    setMode(next);
    setEditorKey((key) => key + 1);
  }
  function openMaterials() {
    void save().then((saved) => {
      if (saved) setKnowledgeOpen(true);
    });
  }
  return (
    <div
      className={`app ${panel ? 'panel-open' : ''} ${gitOpen ? 'source-control-open' : ''} ${terminalSpace ? 'terminal-open' : ''}`}
    >
      <a className="skip-to-editor" href="#editor-main">
        {t('編集領域へ移動', 'Skip to editor')}
      </a>
      <div className="app-body">
        <Rail
          spaces={workspaceSpaces}
          activeId={active?.scopeId}
          aiState={aiState}
          locked={brainLocked || gitBusy}
          homeDisabled={dirty || running || connecting || !!terminalSpace || gitBusy}
          addDisabled={running || dirty || connecting}
          searchDisabled={!workspaceSpaces.length || connecting}
          onHome={leaveWorkspace}
          onSelect={(space) => void selectSpace(space)}
          onAdd={() => setAdd(true)}
          onSearch={() => setSearchOpen(true)}
          settings={<Settings onRecover={() => setRecovering(true)} onError={report} />}
        />
        <PaneGroup
          className="islands"
          orientation="horizontal"
          defaultLayout={islandLayout.defaultLayout}
          onLayoutChanged={islandLayout.onLayoutChanged}
        >
          <Pane id="brain" className="brain-pane" defaultSize={280} minSize={220} maxSize={480}>
            {active ? (
              <BrainPanel
                space={active}
                roots={roots}
                mode={brainMode}
                onModeChange={(next) => {
                  if (next === 'files') {
                    setBrainMode('files');
                    setGitReview(false);
                  } else
                    void save().then((saved) => {
                      if (saved) setBrainMode('changes');
                    });
                }}
                filesDisabled={gitBusy}
                changesDisabled={brainLocked || gitBusy}
                changes={gitRead.data?.available ? gitRead.data.changes.length : undefined}
                selected={doc}
                revision={revision}
                locked={brainLocked || gitBusy}
                daily={!!notesDeclared?.daily}
                dirty={dirty}
                connections={connections}
                onOpen={(space, entry) => void open(space, entry)}
                onRefresh={() => setRevision((value) => value + 1)}
                onDaily={openDaily}
                onNewNote={() => newNoteIn(active)}
                onGraph={() => setOntologyOpen(true)}
                onConnect={() => showConnections(active)}
                onTrash={() => {
                  void save().then((saved) => {
                    if (saved) setTrashOpen(true);
                  });
                }}
                onMaterials={openMaterials}
                onSearch={() => setSearchOpen(true)}
                onCreateIn={(space, entry) => {
                  setCloudNoteTarget({ scopeId: space.scopeId, directory: entry.path });
                  setNewNote(true);
                }}
                onEntryAction={(space, entry, action) => setEntryAction({ space, entry, action })}
              >
                <GitPanel
                  space={active}
                  detailTarget={gitDetailTarget}
                  onReviewChange={setGitReview}
                  onBusyChange={setGitBusy}
                  revision={revision}
                  beforeAction={async () => {
                    if (brainLocked) {
                      report(
                        t(
                          '実行が終わってから Git を操作してください。',
                          'Operate Git after the run finishes.',
                        ),
                      );
                      return false;
                    }
                    return save();
                  }}
                  onChanged={() => {
                    setRevision((r) => r + 1);
                    void reconcile();
                  }}
                />
              </BrainPanel>
            ) : (
              <section className="brain-panel brain-empty chrome">
                <p>
                  {t(
                    'このワークスペースに Brain がありません。',
                    'This workspace has no brain yet.',
                  )}
                </p>
                <button className="solid-button" onClick={() => setAdd(true)}>
                  <Icon name="plus" size={14} />
                  {t('Brain を追加', 'Add a brain')}
                </button>
              </section>
            )}
          </Pane>
          <PaneSeparator
            className="island-handle"
            aria-label={t('Brain パネルの幅', 'Brain panel width')}
          />
          <Pane id="stage" className="stage-pane" minSize={360}>
            <main id="editor-main" className="stage on-stage" tabIndex={-1}>
              <div className="stage-top" hidden={gitReview}>
                <header className="stage-bar">
                  {doc?.workspaceId ? (
                    <Crumbs
                      items={[{ icon: 'cloud', label: `${workspace?.name} · Drive` }]}
                      here={doc.path.split('/').at(-1)}
                      title={doc.path}
                    />
                  ) : doc && docLayer ? (
                    <Crumbs
                      space={docSpace}
                      {...fileCrumbs(docSpace, docLayer, doc.path)}
                      title={doc.path}
                    />
                  ) : (
                    <Crumbs
                      space={active}
                      items={[]}
                      here={active ? t('ホーム', 'Home') : t('ようこそ', 'Welcome')}
                    />
                  )}
                  <div className="stage-actions">
                    {connecting && (
                      <small className="stage-note">
                        {t('接続を準備中…', 'Preparing connection…')}
                      </small>
                    )}
                    {doc &&
                      (doc.readOnly ? (
                        <span className="save-state" role="status" title={status}>
                          <Icon name="lock" size={13} />
                          {t('読み取り専用', 'Read-only')}
                        </span>
                      ) : dirty ? (
                        <button
                          className="save-state pending"
                          disabled={!!external}
                          title={t('保存（Ctrl+S）', 'Save (Ctrl+S)')}
                          onClick={() => void save()}
                        >
                          <i />
                          {t('保存', 'Save')}
                        </button>
                      ) : (
                        <span className="save-state" role="status" title={status}>
                          <Icon name="check" size={13} strokeWidth={2.4} />
                          {t('保存済み', 'Saved')}
                        </span>
                      ))}
                    {doc && <span className="stage-divider" aria-hidden="true" />}
                    {doc && !doc.workspaceId && (
                      <StageButton
                        icon="link"
                        label={t('リンク元', 'Backlinks')}
                        onClick={() => setBacklinks({ scopeId: doc.scopeId, path: doc.path })}
                      />
                    )}
                    {doc && (
                      <NoteInfo
                        label={t(
                          'ノートの情報（名前・場所・人の行・記録）',
                          'Note details (name, location, human lines, records)',
                        )}
                      >
                        <h3>{doc.path.split('/').at(-1)}</h3>
                        <dl>
                          <dt>{t('場所', 'Location')}</dt>
                          <dd className="mono">{doc.path}</dd>
                          <dt>Brain</dt>
                          <dd>{docSpace?.name ?? workspace?.name}</dd>
                          {docLayer && (
                            <>
                              <dt>{t('層', 'Layer')}</dt>
                              <dd>{fileCrumbs(docSpace, docLayer, doc.path).items[0].label}</dd>
                            </>
                          )}
                        </dl>
                        {personLineCount > 0 && (
                          <p className="authorship" role="status">
                            <Icon name="penLine" size={13} />
                            {t(
                              `人が書いた・直した行: ${personLineCount} 行。`,
                              `Lines a person wrote or edited: ${personLineCount}.`,
                            )}
                            {mode === 'source'
                              ? t(
                                  '左端の印が該当行です。',
                                  'The mark on the left edge shows those lines.',
                                )
                              : t(
                                  'ソース表示で行ごとに示します。',
                                  'Switch to source view to see them line by line.',
                                )}
                          </p>
                        )}
                        <small>{status}</small>
                      </NoteInfo>
                    )}
                    {doc && (
                      <NoteMenu>
                        {noteActionsApply(doc) && docLayer === 'Knowledge_Base' && (
                          <>
                            <Menu.Item onClick={() => setNoteAction('move')}>
                              <Icon name="penLine" size={14} />
                              {t('名前・場所', 'Name & location')}
                            </Menu.Item>
                            <Menu.Item onClick={() => setNoteAction('trash')}>
                              <Icon name="trash" size={14} />
                              {t('削除', 'Delete')}
                            </Menu.Item>
                          </>
                        )}
                        {doc.cloud &&
                          !doc.readOnly &&
                          entryActions.map((action) => (
                            <Menu.Item
                              key={action}
                              onClick={() => {
                                const space = doc.workspaceId ? cloudRoot : docSpace;
                                if (space)
                                  setEntryAction({
                                    space,
                                    entry: {
                                      path: doc.path,
                                      name: doc.path.split('/').at(-1)!,
                                      directory: false,
                                      note: /\.md$/i.test(doc.path),
                                      layer: 'contents',
                                      writable: true,
                                    },
                                    action,
                                  });
                              }}
                            >
                              <Icon name={action === 'delete' ? 'trash' : 'penLine'} size={14} />
                              {actionLabel(action)}
                            </Menu.Item>
                          ))}
                        <Menu.Item disabled={gitBusy} onClick={() => void reconcile()}>
                          <Icon name="refresh" size={14} />
                          {t('再読み込み', 'Reload')}
                        </Menu.Item>
                        {dirty && (
                          <Menu.Item disabled={!!external} onClick={() => void save()}>
                            <Icon name="check" size={14} />
                            {t('保存', 'Save')}
                          </Menu.Item>
                        )}
                        {(/\.csv$/i.test(doc.path) || mode !== 'table') && (
                          <Menu.Separator className="menu-separator" />
                        )}
                        {/\.csv$/i.test(doc.path) && (
                          <Menu.RadioGroup
                            value={mode}
                            onValueChange={(value) => switchView(value as 'source' | 'table')}
                          >
                            <Menu.RadioItem value="table" closeOnClick>
                              <Icon name="table" size={14} />
                              {t('表', 'Table')}
                              <Menu.RadioItemIndicator className="menu-check">
                                <Icon name="check" size={14} />
                              </Menu.RadioItemIndicator>
                            </Menu.RadioItem>
                            <Menu.RadioItem value="source" closeOnClick>
                              <Icon name="code" size={14} />
                              {t('ソース', 'Source')}
                              <Menu.RadioItemIndicator className="menu-check">
                                <Icon name="check" size={14} />
                              </Menu.RadioItemIndicator>
                            </Menu.RadioItem>
                          </Menu.RadioGroup>
                        )}
                        {mode !== 'table' && (
                          <Menu.CheckboxItem
                            checked={editorAssistance}
                            disabled={savingAssistance}
                            title={t(
                              '色分け・行番号・折りたたみ・補完などの表示をまとめて切り替えます',
                              'Toggles syntax highlighting, line numbers, folding, and completion together',
                            )}
                            onCheckedChange={(next) => {
                              const previous = editorAssistance;
                              setEditorAssistance(next);
                              setSavingAssistance(true);
                              void chooseEditorAssistance(next)
                                .catch((error) => {
                                  setEditorAssistance(previous);
                                  report(error);
                                })
                                .finally(() => setSavingAssistance(false));
                            }}
                          >
                            <Icon name="code" size={14} />
                            {t('コード支援', 'Code assistance')}
                            <Menu.CheckboxItemIndicator className="menu-check">
                              <Icon name="check" size={14} />
                            </Menu.CheckboxItemIndicator>
                          </Menu.CheckboxItem>
                        )}
                        {active && (
                          <>
                            <Menu.Separator className="menu-separator" />
                            <Menu.Item onClick={openMaterials}>
                              <Icon name="archive" size={14} />
                              {t('資料と成果物', 'Materials and outputs')}
                            </Menu.Item>
                          </>
                        )}
                      </NoteMenu>
                    )}
                    {doc && <span className="stage-divider" aria-hidden="true" />}
                    <AiToggle open={panel} onToggle={() => setPanel((p) => !p)} />
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
                    <button onClick={() => setError('')}>{t('閉じる', 'Close')}</button>
                  </div>
                )}
                {external && (
                  <div className="conflict" role="alert">
                    <strong>
                      {t(
                        '外部でノートが変更されました。未保存の編集を保持しています。',
                        'The note changed outside irori. Your unsaved edits are kept.',
                      )}
                    </strong>
                    <div className="versions">
                      <label>
                        {t('あなたの編集', 'Your edit')}
                        <pre>{buffer}</pre>
                      </label>
                      <label>
                        {t('ディスク上の最新版', 'Latest version on disk')}
                        <pre>{external.text}</pre>
                      </label>
                    </div>
                    <button onClick={() => load(external)}>
                      {t('ディスク版を表示（下書きは保持）', 'Show the disk version (keep draft)')}
                    </button>
                    <button
                      onClick={() => {
                        setDoc(external);
                        setExternal(undefined);
                        setStatus(
                          t(
                            '最新版を基準に、編集内容を確認して保存してください',
                            'Review your edit against the latest version and save',
                          ),
                        );
                      }}
                    >
                      {t('編集を維持して手動で統合', 'Keep the edit and merge manually')}
                    </button>
                  </div>
                )}
                {doc?.draft && doc.draft.text !== doc.text && (
                  <div className="hint">
                    {t('復元できる下書きがあります。', 'A recoverable draft is available.')}
                    <button
                      onClick={() => {
                        setBuffer(doc.draft!.text);
                        setMode(/\.md$/i.test(doc.path) ? 'rich' : 'source');
                        setEditorKey((k) => k + 1);
                        if (doc.draft!.baseHash !== doc.hash) setExternal(doc);
                      }}
                    >
                      {t('下書きを復元', 'Restore draft')}
                    </button>
                  </div>
                )}
              </div>
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
                      <div className="document-scroll">
                        {searchNotice && (
                          <p className="hint" role="status">
                            {searchNotice}
                          </p>
                        )}
                        <Suspense
                          fallback={
                            <p className="hint">
                              {t('エディタを開いています…', 'Opening the editor…')}
                            </p>
                          }
                        >
                          {mode === 'table' ? (
                            <CsvPreview key={editorKey} text={buffer} />
                          ) : (
                            <Editor
                              ref={editor}
                              key={editorKey}
                              text={buffer}
                              mode={mode}
                              filename={doc.path}
                              assistance={editorAssistance}
                              readOnly={doc.readOnly}
                              onChange={setBuffer}
                              onError={report}
                              searchTarget={searchTarget}
                              authorship={authorship}
                              onFollowLink={(href) => void followLink(href)}
                              onSearchResult={(found) => {
                                if (searchTarget)
                                  setSearchNotice(navigationNotice(searchTarget, found));
                              }}
                              onUpload={
                                doc.readOnly
                                  ? undefined
                                  : async (file) =>
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
                    ) : (
                      <div className="welcome">
                        {active ? (
                          <BrainTile space={active} size={64} radius={18} />
                        ) : (
                          <img
                            className="welcome-mark"
                            src={appIcon}
                            alt=""
                            width="64"
                            height="64"
                          />
                        )}
                        <h1>
                          {t('ここから、考えを広げよう。', "Let's expand your thinking from here.")}
                        </h1>
                        <p>
                          {t(
                            '左のナレッジからノートを開くと、編集を始められます。',
                            'Open a note from the Knowledge on the left to start editing.',
                          )}
                          <br />
                          {t(
                            '新しいノートを作ったり、AIと一緒に整理することもできます。',
                            'You can also create a new note or organize it together with AI.',
                          )}
                        </p>
                        <div className="welcome-actions">
                          <ArrowFillButton
                            disabled={!active || running || connecting}
                            onClick={() => {
                              setNoteDirectory(defaultNoteDirectory);
                              setNewNote(true);
                            }}
                          >
                            {t('新しいノートを作成', 'Create a new note')}
                          </ArrowFillButton>
                          {notesDeclared?.daily && (
                            <button
                              className="stage-text-button framed"
                              disabled={!active || running || connecting}
                              onClick={openDaily}
                            >
                              <Icon name="calendar" size={15} />
                              {t('今日のノート', "Today's note")}
                            </button>
                          )}
                          <button className="stage-text-button framed" onClick={() => setAdd(true)}>
                            <Icon name="folder" size={15} />
                            {t('KBフォルダを開く', 'Open a KB folder')}
                          </button>
                        </div>
                        <p className="hint">
                          {t(
                            'Markdown ファイルは、あなたのフォルダに保存されます。',
                            'Markdown files are saved to your folder.',
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </Pane>
                {terminalSpace && (
                  <>
                    <PaneSeparator
                      className="drawer-handle"
                      aria-label={t('ターミナルの高さ', 'Terminal height')}
                    />
                    <Pane id="terminal" className="terminal-pane" defaultSize={240} minSize={120}>
                      <Suspense
                        fallback={
                          <p className="hint">
                            {t('ターミナルを開いています…', 'Opening the terminal…')}
                          </p>
                        }
                      >
                        <TerminalPanel
                          space={terminalSpace}
                          onClose={() => setTerminalSpace(undefined)}
                        />
                      </Suspense>
                    </Pane>
                  </>
                )}
              </PaneGroup>
            </main>
          </Pane>
          {panel && (
            <>
              <PaneSeparator
                className="island-handle"
                aria-label={t('AIパネルの幅', 'AI panel width')}
              />
              <Pane
                id="assistant"
                className="assistant-pane"
                defaultSize={352}
                minSize={300}
                maxSize={620}
              >
                <aside
                  className="agent-panel chrome"
                  aria-label={active ? t(`${active.name} の AI`, `${active.name}'s AI`) : 'AI'}
                >
                  <header className="agent-header">
                    <label
                      className="agent-picker"
                      title={t('この Brain の AI', "This brain's AI")}
                    >
                      {active && (
                        <span className="agent-mark">
                          <BrainTile space={active} size={26} radius={8} />
                          <span className="agent-sparkle">
                            <Icon name="sparkles" size={10} strokeWidth={2.2} />
                          </span>
                        </span>
                      )}
                      <select
                        aria-label={t('エージェント', 'Agent')}
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
                      <Icon name="chevronDown" size={12} className="agent-picker-caret" />
                    </label>
                    {(running || waiting || queued.length > 0) && (
                      <span className={`agent-state ${waiting ? 'waiting' : ''}`} role="status">
                        <i />
                        {waiting
                          ? t('許可待ち', 'Needs approval')
                          : running
                            ? t('実行中', 'Running')
                            : t(`送信待ち ${queued.length}`, `${queued.length} pending`)}
                      </span>
                    )}
                    <span className="agent-header-space" />
                    <button
                      className="icon-button"
                      aria-label={t('新しい会話', 'New conversation')}
                      title={t(
                        '次の送信から新しい会話',
                        'Starts a new conversation from the next send',
                      )}
                      aria-pressed={fresh}
                      disabled={running || sending || queued.length > 0}
                      onClick={() => {
                        setFresh((value) => !value);
                        document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                      }}
                    >
                      <Icon name="squarePen" size={16} />
                    </button>
                    <Popover.Root>
                      <Popover.Trigger
                        className="icon-button agent-settings"
                        aria-label={t('会話と接続の設定', 'Conversation and connection settings')}
                        title={t('会話と接続の設定', 'Conversation and connection settings')}
                      >
                        <Icon name="more" size={16} />
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
                              <Popover.Title render={<strong />}>
                                {t('会話と接続', 'Conversation and connection')}
                              </Popover.Title>
                              <Popover.Close
                                className="icon-button"
                                aria-label={t('会話の設定を閉じる', 'Close conversation settings')}
                              >
                                <Icon name="close" />
                              </Popover.Close>
                            </div>
                            <p>
                              {agentNames[agent]}{' '}
                              <span>
                                {agentInfo?.version || t('CLIを確認中', 'Checking the CLI')}
                              </span>
                            </p>
                            <p>{agentInfo?.detail}</p>
                            {agentInfo?.available && agentInfo.tested === false && (
                              <p>
                                {t(
                                  'このCLIバージョンは未検証です。',
                                  'This CLI version is untested.',
                                )}
                              </p>
                            )}
                            {active && (
                              <SessionControls
                                key={`${active.scopeId}:${agent}`}
                                scopeId={active.scopeId}
                                agent={agent}
                                access={access}
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
                    <button
                      className="icon-button"
                      aria-label={t('AIパネルを閉じる', 'Close AI panel')}
                      onClick={() => setPanel(false)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                    {running && (
                      <span className="agent-progress" aria-hidden="true">
                        <span />
                      </span>
                    )}
                  </header>
                  {active && (
                    <div className="schema-line">
                      <Icon name="schema" size={13} />
                      <span className="schema-owner">
                        {t(`${active.name} の Schema`, `${active.name}'s Schema`)}
                      </span>
                      <span className="mono">
                        {instructionFile ?? t('指示ファイルなし', 'No instruction file')}
                      </span>
                      <i aria-hidden="true" />
                      <span>
                        {t(
                          `スキル ${skills.length}`,
                          `${skills.length} skill${skills.length === 1 ? '' : 's'}`,
                        )}
                      </span>
                    </div>
                  )}
                  {agentInfo?.available === false && (
                    <p className="agent-connection-error" role="alert">
                      {t(
                        'CLI が見つかりません。インストールとネイティブログインを確認してください。',
                        'The CLI was not found. Check the installation and native login.',
                      )}
                    </p>
                  )}
                  {!conversationReady && (
                    <div className="hint" role="status">
                      {conversationError ||
                        t('保存した会話を読み込んでいます…', 'Loading the saved conversation…')}
                      {conversationError && (
                        <button onClick={() => setHistoryReload((value) => value + 1)}>
                          {t('再試行', 'Retry')}
                        </button>
                      )}
                    </div>
                  )}
                  {historyTruncated && (
                    <div className="hint">
                      {t(
                        '保存上限により、古い履歴や長い出力の一部を省略しています。',
                        'Older history and part of long output are omitted due to the save limit.',
                      )}
                    </div>
                  )}
                  <div
                    className="conversation"
                    role="log"
                    aria-label={t('会話', 'Conversation')}
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
                        <p>{t('ノートについて相談する', 'Ask about the note')}</p>
                        <div className="prompt-suggestions">
                          {[
                            t(
                              'このノートの要点をまとめて',
                              'Summarize the key points of this note',
                            ),
                            t(
                              'この内容から次のアクションを整理して',
                              'Work out the next actions from this content',
                            ),
                          ].map((suggestion) => (
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
                          ))}
                        </div>
                      </div>
                    )}
                    <AgentLog
                      events={events}
                      activeRun={running ? events.at(-1)?.runId : undefined}
                      onError={report}
                    />
                  </div>
                  <div className="composer">
                    {queued.length > 0 && (
                      <div className="message-queue" aria-label={t('送信待ち', 'Pending send')}>
                        <strong>
                          <Icon name="clock" size={13} />
                          {t(`送信待ち ${queued.length} 件`, `${queued.length} pending`)}
                        </strong>
                        {queuePaused && (
                          <p>
                            {t(
                              '送信待ちはこの端末に保存されています。内容を確認して再開してください。',
                              'Pending sends are saved on this device. Review them and resume.',
                            )}
                          </p>
                        )}
                        {queued.map((item) => (
                          <div key={item.id}>
                            <span>{item.prompt}</span>
                            <small>{agentAccessLabel(agent, item.access)}</small>
                            <button
                              disabled={sending}
                              aria-label={t(
                                `送信待ち ${item.id} を削除`,
                                `Remove pending send ${item.id}`,
                              )}
                              onClick={() => {
                                setSending(true);
                                void host
                                  .removeQueuedMessage(active!.scopeId, agent, item.id)
                                  .then(setQueued)
                                  .catch(report)
                                  .finally(() => setSending(false));
                              }}
                            >
                              {t('取消', 'Cancel')}
                            </button>
                          </div>
                        ))}
                        {queuePaused && (
                          <button
                            className="queue-resume"
                            disabled={running || sending || !conversationReady}
                            onClick={() => setQueuePaused(false)}
                          >
                            {t('送信を再開', 'Resume sending')}
                          </button>
                        )}
                      </div>
                    )}
                    {fresh && (
                      <p className="new-session" role="status">
                        {t(
                          '次の送信から新しい会話を始めます。',
                          'The next send starts a new conversation.',
                        )}
                        <button onClick={() => setFresh(false)}>{t('取り消す', 'Undo')}</button>
                      </p>
                    )}
                    <div className="composer-box">
                      <div className="composer-context" aria-label={t('相談の対象', 'Ask about')}>
                        <span className="context-chip" title={active?.root}>
                          {active ? (
                            <BrainTile space={active} size={16} radius={5} />
                          ) : (
                            <Icon name="folder" size={12} />
                          )}
                          {active?.name ?? t('スペース未選択', 'No space selected')}
                        </span>
                        {doc?.scopeId === active?.scopeId && doc && (
                          <span className="context-chip" title={doc.path}>
                            <Icon
                              name={
                                docLayer === 'contents'
                                  ? 'cloud'
                                  : docLayer === 'schema'
                                    ? 'schema'
                                    : 'book'
                              }
                              size={13}
                              className={`layer-icon ${docLayer ?? ''}`}
                            />
                            {doc.path.split('/').at(-1)}
                          </span>
                        )}
                        {sources.map((source) => {
                          const owner = spaces.find((space) => space.scopeId === source.scopeId);
                          return (
                            <span
                              className="context-chip reference"
                              key={`${source.scopeId}:${source.path}`}
                              title={source.path}
                            >
                              {owner ? (
                                <BrainTile space={owner} size={16} radius={5} />
                              ) : (
                                <Icon name="cloud" size={12} />
                              )}
                              <span className="context-chip-label">
                                {owner ? '' : 'Drive / '}
                                {source.path}
                              </span>
                              <button
                                aria-label={t(
                                  `${source.path} を参照から外す`,
                                  `Remove ${source.path} from references`,
                                )}
                                onClick={() =>
                                  setSources((all) => all.filter((ref) => ref !== source))
                                }
                              >
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          );
                        })}
                        <button
                          className="context-add"
                          aria-label={t('参照に追加', 'Add as reference')}
                          disabled={!doc || sources.length >= 20 || referenced}
                          title={t(
                            '開いているノートを参照に追加',
                            'Add the open note as a reference',
                          )}
                          onClick={() => {
                            if (!doc) return;
                            void save().then((saved) => {
                              if (saved)
                                setSources((all) => [
                                  ...all,
                                  { scopeId: doc.scopeId, path: doc.path },
                                ]);
                            });
                          }}
                        >
                          <Icon name="plus" size={13} />
                          {t('参照', 'Reference')}
                        </button>
                      </div>
                      <textarea
                        aria-label={t('エージェントへの指示', 'Instruction to the agent')}
                        placeholder={t(
                          'ノートについて相談、編集を依頼…',
                          'Ask about the note, request an edit…',
                        )}
                        value={prompt}
                        rows={3}
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
                      <div className="composer-actions">
                        <div className="composer-selects">
                          {active && (skills.length > 0 || skillsRetired.length > 0) && (
                            <SkillPicker
                              key={active.scopeId}
                              scopeId={active.scopeId}
                              skills={skills}
                              value={skill}
                              onChange={setSkill}
                              disabled={sending || gitBusy}
                            />
                          )}
                          <label className="composer-pill" title={agentAccessDetail(agent, access)}>
                            <Icon name="shield" size={13} />
                            <select
                              aria-label={t('エージェントのアクセス', 'Agent access')}
                              aria-describedby="agent-access-detail"
                              value={access}
                              disabled={
                                sending || gitBusy || agentAccessOptions(agent).length === 1
                              }
                              onChange={(e) =>
                                setAccessSelection({
                                  owner: accessOwner,
                                  value: e.target.value as AgentAccess,
                                })
                              }
                            >
                              {agentAccessOptions(agent).map((value) => (
                                <option key={value} value={value}>
                                  {agentAccessLabel(agent, value)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {personLinesOffered && (
                            <label
                              className={`composer-pill toggle ${personLines ? 'pressed' : ''}`}
                              title={t(
                                '開いているノートで、人が書いた・直した行をエージェントに伝えます',
                                'Tells the agent which lines in the open note a person wrote or edited',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={personLines}
                                disabled={sending || gitBusy}
                                onChange={(e) => setPersonLines(e.target.checked)}
                              />
                              <Icon name="penLine" size={13} />
                              {t('人の行を伝える', "Share the person's lines")}
                            </label>
                          )}
                        </div>
                        <div className="composer-send">
                          {running && (
                            <button
                              className="icon-button stop"
                              aria-label={t('停止', 'Stop')}
                              title={t('停止', 'Stop')}
                              onClick={() => {
                                setQueuePaused(true);
                                void host.cancel(active!.scopeId).catch(report);
                              }}
                            >
                              <span className="stop-mark" />
                            </button>
                          )}
                          <button
                            className="send-button"
                            aria-label={
                              running || queued.length
                                ? t('送信待ちに追加', 'Add to pending sends')
                                : t('送信', 'Send')
                            }
                            title={
                              running || queued.length
                                ? t('送信待ちに追加（Enter）', 'Add to pending sends (Enter)')
                                : t('送信（Enter）', 'Send (Enter)')
                            }
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
                              agentInfo?.available !== true
                            }
                            onClick={() => void start()}
                          >
                            <Icon name="up" size={17} strokeWidth={2.2} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {composer.error ? (
                      <div className="hint" role="alert">
                        {composer.error}
                        <button onClick={() => void composer.retry()}>
                          {t('下書き保存を再試行', 'Retry saving draft')}
                        </button>
                      </div>
                    ) : (
                      <small className="muted" role="status">
                        {!composer.ready
                          ? t('下書きを読み込み中…', 'Loading the draft…')
                          : composer.pending
                            ? t('下書きを保存中…', 'Saving the draft…')
                            : prompt
                              ? t(
                                  '未送信の下書きをこの端末に保存済み',
                                  'The unsent draft is saved on this device',
                                )
                              : ''}
                      </small>
                    )}
                    {skillProblems.length > 0 && (
                      <small className="muted" role="status">
                        {t(
                          `読み込めないスキル: ${skillProblems.map((p) => p.directory).join('、')}`,
                          `Skills that failed to load: ${skillProblems.map((p) => p.directory).join(', ')}`,
                        )}
                      </small>
                    )}
                    {skillsRetired.map((s) => (
                      <small key={s.name} className="muted" role="status">
                        {retirementNotice(s)}
                      </small>
                    ))}
                    <small id="agent-access-detail" className="muted access-detail" role="status">
                      {t(
                        `${agentAccessDetail(agent, access)} 次に送る指示に適用します。 この KB の contents に編集可で接続した Google Drive フォルダは、エージェントも変更できます。`,
                        `${agentAccessDetail(agent, access)} Applies to the next instruction sent. Google Drive folders connected as editable in this KB's contents can be changed by agents too.`,
                      )}
                    </small>
                  </div>
                </aside>
              </Pane>
            </>
          )}
        </PaneGroup>
      </div>
      <StatusBar
        workspace={workspace?.name ?? t('ワークスペース', 'Workspace')}
        space={active}
        git={gitRead.data}
        uploads={uploads}
        running={runningScopes.length}
        waiting={waitingScopes.length}
        status={status}
        workspaceDisabled={dirty || running || connecting || !!terminalSpace || gitBusy}
        terminalOpen={!!terminalSpace}
        terminalDisabled={!active && !terminalSpace}
        onWorkspace={leaveWorkspace}
        onAi={() => setPanel(true)}
        onTerminal={() => setTerminalSpace((value) => (value ? undefined : active))}
      />
      {connectionsOpen && connectionTarget && (
        <Connections
          key={connectionTarget.scopeId}
          space={connectionTarget}
          workspaceId={workspace?.id}
          running={running}
          onClose={() => {
            setConnectionsOpen(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {recovering && <CloudRecoveryDialog onClose={() => setRecovering(false)} />}
      {noteAction && doc && (
        <NoteActionDialog
          key={`${doc.scopeId}:${doc.path}:${noteAction}`}
          doc={doc}
          action={noteAction}
          onClose={() => setNoteAction(undefined)}
          onBusyChange={(busy) => {
            reconciliation.current++;
            organizing.current = busy;
            if (!busy) void reconcile();
          }}
          beforeChange={async () => {
            if (running || sending || queued.length || gitBusy || connecting)
              throw Error(
                t(
                  '実行・Git 操作・接続が完了してからノートを整理してください。',
                  'Organize notes after the run, Git operation, and connection finish.',
                ),
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
                  ref.scopeId === previous.scopeId && ref.path === previous.path
                    ? { scopeId: next.scopeId, path: next.path }
                    : ref,
                ),
              );
            } else {
              current.current = { doc: undefined, buffer: '', external: undefined };
              setDoc(undefined);
              setBuffer('');
              setExternal(undefined);
              setSources((all) =>
                all.filter((ref) => ref.scopeId !== previous.scopeId || ref.path !== previous.path),
              );
            }
            setRevision((value) => value + 1);
            setStatus(
              notice ??
                (next
                  ? t('ノートの場所を変更しました。', 'The note has moved.')
                  : t(
                      'ノートを復元用に保管しました。「削除したノートを復元」から戻せます。',
                      'The note is kept for restoring. Bring it back from "Restore deleted notes".',
                    )),
            );
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
            if (!target)
              throw Error(
                t(
                  'この KB をワークスペースに追加してから開いてください。',
                  'Add this KB to the workspace before opening it.',
                ),
              );
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
                t(
                  'ファイルを開けませんでした。編集中のノートや実行・接続の状態を確認してください。',
                  'Could not open the file. Check the note being edited and the run/connection state.',
                ),
              );
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {backlinks && (
        <BacklinksPanel
          {...backlinks}
          onOpen={async (hit) => {
            const space = spaces.find((item) => item.scopeId === backlinks.scopeId);
            const opened =
              space &&
              (await open(
                space,
                {
                  path: hit.path,
                  name: hit.path.split('/').at(-1)!,
                  directory: false,
                  note: true,
                  layer: 'Knowledge_Base',
                },
                // No label — an image, a reference definition — still opens the note
                // and says so, since the line is known but the link is not selectable.
                {
                  query: hit.label ?? '',
                  line: hit.line,
                  preview: hit.preview,
                  column: hit.column,
                  link: true,
                },
              ));
            if (!opened)
              throw Error(
                t(
                  'ノートを開けませんでした。編集中のノートや実行・接続の状態を確認してください。',
                  'Could not open the note. Check the note being edited and the run/connection state.',
                ),
              );
            setBacklinks(undefined);
          }}
          onClose={() => setBacklinks(undefined)}
        />
      )}
      {knowledgeOpen && active && (
        <KnowledgePanel
          key={active.scopeId}
          space={active}
          doc={doc}
          cloudOwner={active.scopeId}
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
              throw Error(
                t(
                  'この資料のスペースをワークスペースに追加してから開いてください。',
                  'Add this material’s space to the workspace before opening it.',
                ),
              );
            const opened = target ? await open(target, entry) : await openCloud(cloudRoot!, entry);
            if (!opened)
              throw Error(
                t(
                  'ファイルを開けませんでした。編集中のノートや実行・接続の状態を確認してください。',
                  'Could not open the file. Check the note being edited and the run/connection state.',
                ),
              );
            setKnowledgeOpen(false);
          }}
          onClose={() => setKnowledgeOpen(false)}
        />
      )}
      {ontologyOpen && active && (
        <Suspense
          fallback={
            <p className="hint">{t('オントロジーを開いています…', 'Opening the ontology…')}</p>
          }
        >
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
        <Dialog label={t('ノートを作成', 'Create note')} busy={creatingNote} onClose={closeNewNote}>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              if ((active || cloudNoteTarget) && !creatingNote) {
                setCreatingNote(true);
                void (async () => {
                  if (!(await save()))
                    throw Error(
                      t(
                        '現在のノートを保存してから作成してください。',
                        'Save the current note before creating a new one.',
                      ),
                    );
                  return cloudNoteTarget
                    ? host.createCloudNote(
                        cloudNoteTarget.scopeId,
                        cloudNoteTarget.directory,
                        noteName,
                      )
                    : host.createNote(active!.scopeId, noteName, noteDirectory);
                })()
                  .then((d) => {
                    load(d);
                    closeNewNote();
                    setNoteName('');
                    setRevision((r) => r + 1);
                  })
                  .catch(report)
                  .finally(() => setCreatingNote(false));
              }
            }}
          >
            <h2>{t('ノートを作成', 'Create note')}</h2>
            <input
              aria-label={t('ノート名', 'Note name')}
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              placeholder={t('ノート名', 'Note name')}
              required
            />
            {cloudNoteTarget ? (
              <p className="mount-preview">
                {t('保存先（Google Drive）', 'Destination (Google Drive)')}:{' '}
                {cloudNoteTarget.directory}/
              </p>
            ) : (
              <label>
                {t(
                  '保存先フォルダー（KB 内の相対パス）',
                  'Destination folder (path relative to the KB)',
                )}
                <input
                  aria-label={t('保存先フォルダー', 'Destination folder')}
                  value={noteDirectory}
                  onChange={(event) => setNoteDirectory(event.target.value)}
                  maxLength={4096}
                  placeholder={defaultNoteDirectory}
                />
              </label>
            )}
            <div className="actions">
              <button type="button" disabled={creatingNote} onClick={closeNewNote}>
                {t('キャンセル', 'Cancel')}
              </button>
              <button className="primary" disabled={creatingNote}>
                {t('作成', 'Create')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {entryAction && (
        <CloudEntryDialog
          key={`${entryAction.space.scopeId}:${entryAction.entry.path}:${entryAction.action}`}
          space={entryAction.space}
          entry={entryAction.entry}
          action={entryAction.action}
          beforeChange={async () => {
            if (running || sending || queued.length || gitBusy || connecting)
              throw Error(
                t(
                  '実行・Git 操作・接続が完了してから資料を整理してください。',
                  'Organize materials after the run, Git operation and connection finish.',
                ),
              );
            return save();
          }}
          onBusyChange={(busy) => {
            reconciliation.current++;
            organizing.current = busy;
            if (!busy) void reconcile();
          }}
          onDone={entryChanged}
          onClose={() => setEntryAction(undefined)}
        />
      )}
      {trashOpen && active && (
        <TrashNotes
          scopeId={active.scopeId}
          onClose={() => setTrashOpen(false)}
          onRestored={(next, notice) => {
            setTrashOpen(false);
            load(next);
            setStatus(
              notice ??
                t(
                  'ノートを元の場所に復元しました。',
                  'The note was restored to its original location.',
                ),
            );
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
      <h1>{t('画面の描画でエラーが発生しました', 'The screen failed to render')}</h1>
      <p>
        {t(
          '保存済みのノートには影響しません。未保存の編集は失われることがあります。再表示しても直らない場合は、アプリを再起動してください。',
          'Saved notes are unaffected. Unsaved edits may be lost. If re-displaying does not fix it, restart the app.',
        )}
      </p>
      <pre>{String(error)}</pre>
      <button className="primary" onClick={resetErrorBoundary}>
        {t('再表示', 'Show again')}
      </button>
    </div>
  );
}
// The device record carries the appearance and pane sizes, so it is read before
// the first render rather than applied over one.
watchSystemTheme();
void loadDeviceSettings().finally(() => {
  applyTheme();
  applyMarkdownFont();
  applyLanguage();
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary FallbackComponent={AppCrash}>
      <App />
    </ErrorBoundary>,
  );
});
