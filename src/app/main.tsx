import { classify, isPropertyPage } from '../domain/scopes';
import { knowledgeFolder, layerFolder, renamedPath } from '../domain/layers';
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
import { type Conversation, isDamaged } from '../domain/conversation';
import { defaultAgentAccess } from '../domain/agent-access';
import { Dialog } from './Dialog';
import {
  AgentColumn,
  type ColumnOwner,
  type DockColumn,
  type DockShared,
  type Tab,
} from './AgentColumn';
import { Menu } from '@base-ui/react/menu';
import {
  applyLanguage,
  applyMarkdownFont,
  applyTheme,
  chooseEditorAssistance,
  chooseHibachiAgent,
  chooseYourAi,
  currentEditorAssistance,
  currentHibachiAgent,
  currentYourAi,
  layoutStorage,
  loadDeviceSettings,
  watchSystemTheme,
} from './device-settings';
import { useLanguage } from './useLanguage';
import { useChoice } from './useChoice';
import { baseName, parentPath } from '../domain/paths';
import { t } from '../domain/i18n';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { ArrowFillButton } from './obsidian/ArrowFillButton';
import {
  Group as PaneGroup,
  Panel as Pane,
  Separator as PaneSeparator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AgentEvent,
  AgentAccess,
  AgentId,
  AgentInfo,
  CloudConnection,
  Document,
  Entry,
  HibachiGroup,
  Space,
  WorkspaceProfile,
  CloudRoot,
} from '../domain/types';
import { agentIds } from '../domain/types';
import type { AgentSkill, retirementNotice } from '../domain/skills';
import type { YourAi } from '../domain/you';
import { opensInIrori } from '../domain/viewers';
const PageEditor = lazy(() =>
  import('./PageEditor').then((module) => ({ default: module.PageEditor })),
);
const CsvPreview = lazy(() =>
  import('./CsvPreview').then((module) => ({ default: module.CsvPreview })),
);
const FileViewer = lazy(() =>
  import('./FileViewer').then((module) => ({ default: module.FileViewer })),
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
import type { PageEditorHandle } from './PageEditor';
import './tokens.css';
import './style.css';
import './shell.css';
import './stage.css';
import './agent-panel.css';
import './views.css';
import { Startup, RegisterSpace } from './Startup';
import { appIcon } from './branding';
import { Icon } from './Icon';
import { useResource } from './useResource';
import { useStableFunctions } from './useStableFunctions';
import { anyRevision, bumpRevision, noRevisions, scopeRevision } from '../domain/revisions';
import { BrainPanel, type BrainMode } from './BrainPanel';
import { SchemaEditor, SchemaList, type SchemaTarget } from './SchemaSettings';
import { BrainTile } from './BrainTile';
import { BrainHome } from './BrainHome';
import { BrainSettings } from './BrainSettings';
import { AiToggle, Crumbs, fileCrumbs, NoteInfo, NoteMenu } from './NoteBar';
import { NoteComments } from './NoteComments';
import { Backlinks } from './Backlinks';
import { Rail, type BrainAiState } from './Rail';
import { Settings } from './Settings';
import { SchemaDialog } from './SchemaDialog';
import { sharedSchemaId } from '../domain/you';
import { Overview, type OverviewView } from './Overview';
import { YourAiScreen } from './YourAiScreen';
import { StatusBar } from './StatusBar';
import { TerminalDrawer } from './TerminalDrawer';
import { errorText } from './ErrorMessage';
import { categoryChoices } from '../domain/brains';
const host = window.irori;
/** A backlink points at a link on the line, a search hit at matching text; the notice says which. */
type Navigation = SearchTarget & { link?: boolean };
function navigationNotice(target: Navigation, found: boolean) {
  const what = t(target.link ? 'リンク' : '一致箇所', target.link ? 'link' : 'matching text');
  if (found)
    return t(
      `${target.line} 行目の${what}を選択しました。`,
      `Selected the ${what} on line ${target.line}.`,
    );
  return t(`${what}を特定できませんでした。`, `Could not locate the ${what}.`);
}
/** A run in progress: its space, and its conversation once the host has placed it. */
type LiveRun = { scopeId: string; conversationId?: string };
/** The AI chosen for each brain; a brain not chosen yet starts with the last choice. */
type AgentChoice = { last: AgentId; brains: Record<string, AgentId> };
const agentOf = (choice: AgentChoice, scopeId?: string) =>
  (scopeId && choice.brains[scopeId]) || choice.last;
/**
 * The choices survive a reload of the window, so a conversation a reload stopped
 * is found again with its CLI rather than an empty one with the default CLI.
 */
const agentChoiceKey = 'irori.agentChoice';
function savedAgentChoice(): AgentChoice {
  const known = (value: unknown): value is AgentId => agentIds.includes(value as AgentId);
  try {
    const saved = JSON.parse(sessionStorage.getItem(agentChoiceKey) ?? 'null') as AgentChoice;
    if (known(saved?.last))
      return {
        last: saved.last,
        brains: Object.fromEntries(
          Object.entries(saved.brains ?? {}).filter(([, agent]) => known(agent)),
        ),
      };
  } catch {
    // Storage may be unavailable or hold something else; start with the default.
  }
  return { last: 'codex', brains: {} };
}
/** Where a column keeps an owner's conversation and tabs: the first under the owner's id. */
const slot = (columnId: string, scopeId: string) =>
  columnId === 'main' ? scopeId : `${scopeId}#${columnId}`;
/** A column's open tabs; the conversation on show is always among them. */
function openTabs(tabs: Record<string, Tab[]>, shown: Record<string, Tab>, key: string) {
  const open = tabs[key] ?? [];
  const on = shown[key];
  return on && !open.some((tab) => tab.id === on.id) ? [...open, on] : open;
}
const instructionFileOf = (roots: Listing | undefined, agentId: AgentId) =>
  (agentId === 'claude' ? ['CLAUDE.md', 'AGENTS.md'] : ['AGENTS.md']).find((name) =>
    roots?.entries.some((entry) => entry.path === name),
  );
/** The brain's top-level entries as read, or what went wrong reading them. */
type Listing = { entries: Entry[]; error?: string };
/** A file as the tree lists it; a Markdown file is a note unless told otherwise. */
const fileEntry = (path: string, layer: Entry['layer'], note = /\.md$/i.test(path)): Entry => ({
  path,
  name: baseName(path),
  directory: false,
  note,
  layer,
});
const noEntries: Entry[] = [];
const noConnections: CloudConnection[] = [];
const noSkills: AgentSkill[] = [];
const noRetired: Parameters<typeof retirementNotice>[0][] = [];
const noProblems: { directory: string; message?: string }[] = [];
const noSources: SourceRef[] = [];
const noGroups: HibachiGroup[] = [];

/** What a dock column asks of the window; each identity stays the same across renders. */
interface DockActions {
  report: (error: unknown) => void;
  toggleStage: () => void;
  chooseYour: (choice: ReturnType<typeof currentYourAi>) => void;
  remember: (scopeId: string, agent: AgentId) => void;
  newConversation: (
    scopeId: string,
    key: string,
    agent: AgentId,
    replace?: boolean,
  ) => Promise<void>;
  showConversation: (key: string, id: string, agent: AgentId, replace?: boolean) => void;
  closeTab: (key: string, id: string, onNeighbour: (agent: AgentId) => void) => void;
  splitColumn: (after: DockColumn) => void;
  closeColumn: (column: DockColumn) => void;
  createYou: () => Promise<void>;
  setShown: Dispatch<SetStateAction<Record<string, Tab>>>;
  setTabs: Dispatch<SetStateAction<Record<string, Tab[]>>>;
  setSources: Dispatch<SetStateAction<Record<string, SourceRef[]>>>;
  setColumns: Dispatch<SetStateAction<DockColumn[]>>;
  setModelChoice: Dispatch<SetStateAction<Record<string, string>>>;
  setAccessChoice: Dispatch<SetStateAction<Record<string, { agent: AgentId; value: AgentAccess }>>>;
  setYourAccessSelection: Dispatch<
    SetStateAction<{ agent: AgentId; value: AgentAccess } | undefined>
  >;
  setColumnStatus: Dispatch<SetStateAction<Record<string, { sending: boolean; queued: number }>>>;
  setHanded: Dispatch<SetStateAction<string[] | undefined>>;
}

/**
 * One column of the dock with what the window knows about it. Memoised on that
 * data, so the editor's keystrokes (which change none of it) leave the column,
 * its log and its composer as they are.
 */
const DockColumnView = memo(function DockColumnView({
  column,
  owner,
  first,
  shared,
  active,
  you,
  shown,
  tabs,
  agentChoice,
  yourChoice,
  yourAccess,
  accessChoice,
  modelChoice,
  skills,
  skillsRetired,
  skillProblems,
  roots,
  sources,
  hibachiAgent,
  stageHidden,
  workspaceScopeIds,
  workspaceId,
  act,
}: {
  column: DockColumn;
  owner: ColumnOwner;
  /** The first column hides and shows the stage beside the dock. */
  first: boolean;
  shared: DockShared;
  active?: Space;
  you?: YourAi;
  shown: Record<string, Tab>;
  tabs: Record<string, Tab[]>;
  agentChoice: AgentChoice;
  yourChoice: ReturnType<typeof currentYourAi>;
  yourAccess: AgentAccess;
  accessChoice: Record<string, { agent: AgentId; value: AgentAccess }>;
  modelChoice: Record<string, string>;
  skills: AgentSkill[];
  skillsRetired: Parameters<typeof retirementNotice>[0][];
  skillProblems: { directory: string }[];
  roots?: Listing;
  sources: SourceRef[];
  hibachiAgent: boolean;
  stageHidden: boolean;
  workspaceScopeIds: string[];
  workspaceId?: string;
  act: DockActions;
}) {
  const irori = owner === 'irori';
  const scopeId = irori ? you?.id : active?.scopeId;
  const key = scopeId ? slot(column.id, scopeId) : '';
  const target = key ? shown[key] : undefined;
  const columnAgent =
    target?.agent ?? (irori ? yourChoice.agent : agentOf(agentChoice, active?.scopeId));
  const access = irori
    ? yourAccess
    : accessChoice[key]?.agent === columnAgent
      ? accessChoice[key].value
      : defaultAgentAccess(columnAgent);
  const rememberAgent = (next: AgentId) => {
    if (irori) act.chooseYour({ ...yourChoice, agent: next });
    else if (active) act.remember(active.scopeId, next);
  };
  const stage = useMemo(
    () => (first ? { hidden: stageHidden, onToggle: act.toggleStage } : undefined),
    [first, stageHidden, act],
  );
  const dockColumn = useMemo(() => ({ ...column, owner }), [column, owner]);
  return (
    <AgentColumn
      column={dockColumn}
      number={column.id === 'main' ? 1 : Number(column.id)}
      shared={shared}
      space={irori ? undefined : active}
      you={you}
      brains={workspaceScopeIds}
      workspaceId={workspaceId}
      target={target}
      tabs={key ? openTabs(tabs, shown, key) : noTabs}
      agent={columnAgent}
      model={
        irori
          ? yourChoice.models[columnAgent] || undefined
          : active && (modelChoice[`${active.scopeId}:${columnAgent}`] || undefined)
      }
      access={access}
      skills={irori ? noSkills : skills}
      skillsRetired={irori ? noRetired : skillsRetired}
      skillProblems={irori ? noProblems : skillProblems}
      instructionFile={irori ? undefined : instructionFileOf(roots, columnAgent)}
      sources={sources}
      ownerChoice={hibachiAgent}
      stage={stage}
      onModel={(next) => {
        if (irori) {
          const models = { ...yourChoice.models };
          if (next) models[columnAgent] = next;
          else delete models[columnAgent];
          act.chooseYour({ ...yourChoice, models });
        } else if (active)
          act.setModelChoice((all) => ({
            ...all,
            [`${active.scopeId}:${columnAgent}`]: next,
          }));
      }}
      onAccess={(value) => {
        if (irori) act.setYourAccessSelection({ agent: columnAgent, value });
        else
          act.setAccessChoice((all) => ({
            ...all,
            [key]: { agent: columnAgent, value },
          }));
      }}
      onAgent={(next, replace) => {
        if (!scopeId) return;
        rememberAgent(next);
        // Another CLI is another conversation (ADR 017 D2).
        void act.newConversation(scopeId, key, next, replace).catch(act.report);
      }}
      onPick={(tab) => {
        if (!key) return;
        if (irori && column.id === 'main' && tab.agent !== yourChoice.agent)
          act.chooseYour({ ...yourChoice, agent: tab.agent });
        act.setShown((all) => (all[key] ? all : { ...all, [key]: tab }));
      }}
      onShow={(tab, replace) => {
        if (!key) return;
        rememberAgent(tab.agent);
        act.showConversation(key, tab.id, tab.agent, replace);
      }}
      onCloseTab={(id) => key && act.closeTab(key, id, rememberAgent)}
      onNew={async (replace) => {
        if (scopeId) await act.newConversation(scopeId, key, columnAgent, replace);
      }}
      onDeleted={(id) => {
        if (!key) return;
        act.setTabs((all) => ({
          ...all,
          [key]: (all[key] ?? []).filter((tab) => tab.id !== id),
        }));
        // The column shows the owner's next conversation, or a new one.
        if (shown[key]?.id === id) act.setShown(({ [key]: _, ...rest }) => rest);
      }}
      onSources={(update) =>
        act.setSources((all) => ({
          ...all,
          [column.id]: update(all[column.id] ?? []),
        }))
      }
      onOwner={(next) =>
        act.setColumns((all) =>
          all.map((item) => (item.id === column.id ? { ...item, owner: next } : item)),
        )
      }
      onSplit={() => act.splitColumn({ ...column, owner })}
      onClose={() => act.closeColumn(column)}
      onStatus={(status) =>
        act.setColumnStatus((all) =>
          all[column.id]?.sending === status.sending && all[column.id]?.queued === status.queued
            ? all
            : { ...all, [column.id]: status },
        )
      }
      onCreateYou={act.createYou}
      onStarted={act.setHanded}
    />
  );
});
const noTabs: Tab[] = [];
function App() {
  // Interface text is chosen while rendering, so a language change re-renders
  // the whole tree from here; component state, drafts and the editor are kept.
  // The memoised islands and the elements memoised below take the language as a
  // dependency, since nothing else about them changes with it.
  const language = useLanguage();
  const [savingAssistance, setSavingAssistance] = useState(false);
  const [editorAssistance, chooseAssistance] = useChoice(
    currentEditorAssistance,
    (next: boolean) => {
      setSavingAssistance(true);
      return chooseEditorAssistance(next).finally(() => setSavingAssistance(false));
    },
    (error) => report(error),
  );
  const [creatingNote, setCreatingNote] = useState(false);
  // An editable connected folder the next note goes into, instead of the active KB.
  const [cloudNoteTarget, setCloudNoteTarget] = useState<{ scopeId: string; directory: string }>();
  // A file or folder of an editable connected folder being renamed, moved or deleted.
  const [entryAction, setEntryAction] = useState<{
    space: CloudRoot;
    entry: Entry;
    action: EntryAction;
  }>();
  const [workspace, setWorkspace] = useState<WorkspaceProfile>(),
    [startup, setStartup] = useState(true);
  const [connectionsOpen, setConnectionsOpen] = useState(false),
    [connecting, setConnecting] = useState(false);
  // Every Schema from the settings: the shared one, the irori agent's and each hibachi's.
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState<CloudRoot>();
  // The brain panel shows its files or, in place of them, its changes.
  const [brainMode, setBrainMode] = useState<BrainMode>('files');
  const gitOpen = brainMode === 'changes';
  const [brainSettings, setBrainSettings] = useState(false);
  const [noteAction, setNoteAction] = useState<NoteAction>();
  const [gitReview, setGitReview] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitDetailTarget, setGitDetailTarget] = useState<HTMLDivElement | null>(null);
  // What the stage shows: the note, the brain's home, its graph, its materials or a Schema setting.
  const [view, setView] = useState<'note' | 'home' | 'graph' | 'records' | 'schema'>('note');
  const [schemaTarget, setSchemaTarget] = useState<SchemaTarget & { scopeId: string }>();
  const [searchOpen, setSearchOpen] = useState(false);
  // The palette opened from the Overview searches every brain.
  const [searchAll, setSearchAll] = useState(false);
  // The workspace's map, routines, one hibachi, or the irori agent's Schema.
  const [level, setLevel] = useState<'overview' | 'routines' | 'brain' | 'you'>('brain');
  const levelNow = useRef(level);
  levelNow.current = level;
  // Moving between the Overview and a brain is a zoom: the Overview grows away
  // around the chosen brain while the brain's islands settle in, and back.
  const [scene, setScene] = useState<{
    leaving: 'overview' | 'brain';
    origin?: { x: number; y: number };
  }>();
  const sceneTimer = useRef<number | undefined>(undefined);
  function goToLevel(next: typeof level, origin?: { x: number; y: number }) {
    const from = levelNow.current;
    if (from === next) return;
    window.clearTimeout(sceneTimer.current);
    const moving = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (moving && from === 'overview' && next === 'brain') {
      const box = document.querySelector('.app-body > .overview')?.getBoundingClientRect();
      setScene({
        leaving: 'overview',
        origin: origin && box ? { x: origin.x - box.left, y: origin.y - box.top } : undefined,
      });
      sceneTimer.current = window.setTimeout(() => setScene(undefined), 560);
    } else if (moving && from === 'brain' && next === 'overview') {
      setScene({ leaving: 'brain' });
      sceneTimer.current = window.setTimeout(() => setScene(undefined), 480);
    } else setScene(undefined);
    levelNow.current = next;
    setLevel(next);
  }
  const [overviewView, setOverviewView] = useState<OverviewView>('map');
  const [trashOpen, setTrashOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<Navigation>();
  const [searchNotice, setSearchNotice] = useState('');
  // The references each dock column sends with its next instruction.
  const [sources, setSources] = useState<Record<string, SourceRef[]>>({});
  /** Applies a change to every column's references: a moved file follows, a deleted one leaves. */
  function updateSources(update: (all: SourceRef[]) => SourceRef[]) {
    setSources((all) =>
      Object.fromEntries(Object.entries(all).map(([column, refs]) => [column, update(refs)])),
    );
  }
  const [terminalSpace, setTerminalSpace] = useState<Space>();
  // irori mode's own terminal, in the irori agent's folder; a hibachi's opens in its stage.
  const [iroriTerminal, setIroriTerminal] = useState(false);
  // Going home asks first while agents or terminals still run.
  const [askHome, setAskHome] = useState(false),
    [goingHome, setGoingHome] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]),
    [active, setActive] = useState<Space>(),
    [doc, setDoc] = useState<Document>(),
    [buffer, setBuffer] = useState('');
  // The host's file changes, counted per hibachi: a change in one leaves the others' views as they are.
  const [revisions, setRevisions] = useState(noRevisions),
    [editorKey, setEditorKey] = useState(0),
    [mode, setMode] = useState<'rich' | 'source' | 'table'>('rich'),
    [external, setExternal] = useState<Document>();
  // What the views of the hibachi on show, and of the open note's hibachi, follow.
  const revision = scopeRevision(revisions, active?.scopeId);
  const docRevision = scopeRevision(revisions, doc?.scopeId);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [panel, setPanel] = useState(false),
    // Each brain keeps the AI chosen for it; a brain not chosen yet starts with the last choice.
    [agentChoice, setAgentChoice] = useState<AgentChoice>(savedAgentChoice),
    [infos, setInfos] = useState<AgentInfo[]>([]);
  // The workspace's brains in the order its owner chose.
  const workspaceSpaces = useMemo(
    () =>
      (workspace?.scopeIds ?? []).flatMap((id) => spaces.filter((space) => space.scopeId === id)),
    [workspace?.scopeIds, spaces],
  );
  const workspaceScopeIds = useMemo(
    () => workspaceSpaces.map((space) => space.scopeId),
    [workspaceSpaces],
  );
  const agentFor = (scopeId?: string) => agentOf(agentChoice, scopeId);
  // Each hibachi's own agent and its Schema layer are optional (ADR 021).
  const [hibachiAgent, chooseHibachi, setHibachiAgent] = useChoice(
    currentHibachiAgent,
    chooseHibachiAgent,
    (error) => report(error),
  );
  // The agent dock's columns (ADR 021). The first stays while the dock is open; a
  // hibachi column follows the hibachi on show, and shows the irori agent while the
  // hibachi agent is off.
  const [columns, setColumns] = useState<DockColumn[]>([{ id: 'main', owner: 'hibachi' }]);
  const ownerOf = (column: DockColumn): ColumnOwner => (hibachiAgent ? column.owner : 'irori');
  // The conversation each column shows per owner, with its CLI (ADR 017 D4). An owner
  // not in it shows the host's pick: the one running, queued longest, or its latest.
  const [shown, setShown] = useState<Record<string, Tab>>({});
  const shownHere = active ? shown[active.scopeId] : undefined;
  const agent = shownHere?.agent ?? agentFor(active?.scopeId);
  useEffect(() => {
    try {
      sessionStorage.setItem(agentChoiceKey, JSON.stringify(agentChoice));
    } catch {
      // Without storage a reload starts with the default again.
    }
  }, [agentChoice]);
  function remember(scopeId: string, next: AgentId) {
    setAgentChoice((choice) => ({ last: next, brains: { ...choice.brains, [scopeId]: next } }));
  }
  // The conversations a column keeps open as tabs, as Claudian does (ADR 020): the
  // one on show is always among them, and the others may run meanwhile.
  const [tabs, setTabs] = useState<Record<string, Tab[]>>({});
  const tabsOf = (key: string) => openTabs(tabs, shown, key);
  /**
   * Shows a conversation in a column's tabs: in its own tab when it has one, else
   * in a new tab, or with `replace` in place of the conversation on show.
   */
  function showConversation(key: string, id: string, next: AgentId, replace = false) {
    const previous = shown[key];
    setShown((all) => ({ ...all, [key]: { id, agent: next } }));
    setTabs((all) => {
      let open = all[key] ?? [];
      if (previous && !open.some((tab) => tab.id === previous.id)) open = [...open, previous];
      if (!open.some((tab) => tab.id === id)) {
        const tab = { id, agent: next };
        const at = replace && previous ? open.findIndex((item) => item.id === previous.id) : -1;
        open = at < 0 ? [...open, tab] : open.map((item, index) => (index === at ? tab : item));
      }
      return { ...all, [key]: open };
    });
  }
  /** Closes a tab; the run of a conversation never stops with it, so a running one keeps its tab. */
  function closeTab(key: string, id: string, onNeighbour: (agent: AgentId) => void) {
    const open = tabsOf(key);
    const rest = open.filter((tab) => tab.id !== id);
    setTabs((all) => ({ ...all, [key]: rest }));
    if (shown[key]?.id !== id) return;
    const neighbour =
      rest[
        Math.min(
          open.findIndex((tab) => tab.id === id),
          rest.length - 1,
        )
      ];
    if (neighbour) {
      onNeighbour(neighbour.agent);
      setShown((all) => ({ ...all, [key]: neighbour }));
    } else setShown(({ [key]: _, ...others }) => others);
  }
  /**
   * Starts an empty conversation for the owner; nothing is kept before its first
   * instruction. With `replace` it takes the place of the conversation on show.
   */
  async function newConversation(scopeId: string, key: string, next: AgentId, replace = false) {
    showConversation(
      key,
      await host.createConversation(scopeId, next, workspace?.id),
      next,
      replace,
    );
  }
  // Each brain keeps the model chosen for each CLI; '' is the CLI's own default.
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});
  const modelFor = (scopeId: string, agentId: AgentId) =>
    modelChoice[`${scopeId}:${agentId}`] || undefined;
  // Your AI's CLI and models are kept on the device.
  const [yourChoice, setYourChoice] = useState(currentYourAi);
  function chooseYour(next: typeof yourChoice) {
    setYourChoice(next);
    void chooseYourAi(next).catch(report);
  }
  // Your AI's access, kept like a brain composer's choice: for its CLI, until that changes.
  const [yourAccessSelection, setYourAccessSelection] = useState<{
    agent: AgentId;
    value: AgentAccess;
  }>();
  const yourAccess =
    yourAccessSelection?.agent === yourChoice.agent
      ? yourAccessSelection.value
      : defaultAgentAccess(yourChoice.agent);
  // A hibachi column's access, by where it shows: for its CLI, until that changes.
  const [accessChoice, setAccessChoice] = useState<
    Record<string, { agent: AgentId; value: AgentAccess }>
  >({});
  useEffect(() => setAccessChoice({}), [workspace?.id]);
  // Runs in progress by id, and sends on their way to the host by conversation (by
  // space when none is named). An owner's conversations run side by side (ADR 020),
  // so a space is running while any of its runs is.
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRun>>({}),
    [starting, setStarting] = useState<Record<string, string>>({}),
    [waitingScopes, setWaitingScopes] = useState<string[]>([]),
    [waitingRuns, setWaitingRuns] = useState<string[]>([]);
  const runningScopes = useMemo(
    () => [
      ...new Set([
        ...Object.values(liveRuns).map((run) => run.scopeId),
        ...Object.values(starting),
      ]),
    ],
    [liveRuns, starting],
  );
  const runningConversations = useMemo(
    () =>
      new Set([
        ...Object.values(liveRuns).flatMap((run) =>
          run.conversationId ? [run.conversationId] : [],
        ),
        ...Object.keys(starting),
      ]),
    [liveRuns, starting],
  );
  const runningNow = useRef(runningConversations);
  runningNow.current = runningConversations;
  // Runs whose end has come, so a late start reply cannot mark them running again.
  const endedRuns = useRef(new Set<string>());
  const [skillRevision, setSkillRevision] = useState(0);
  const [authorship, setAuthorship] = useState<NoteAuthorship>();
  const skillRead = useResource(() => host.skills(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: skillRevision,
  });
  const skills = skillRead.data?.skills ?? noSkills;
  const skillsRetired = skillRead.data?.retired ?? noRetired;
  const skillProblems = useMemo(
    () =>
      skillRead.error
        ? [{ directory: '.agents/skills', message: skillRead.error }]
        : (skillRead.data?.problems ?? noProblems),
    [skillRead.error, skillRead.data],
  );
  const notesRead = useResource(() => host.notesDeclaration(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  const notesDeclared = notesRead.data ?? null;
  // The open page's declared properties and the person's actor id (ADR 015), read
  // again whenever a note is loaded so an edited declaration takes effect.
  const propertiesRead = useResource(() => host.pageProperties(doc!.scopeId), [doc?.scopeId], {
    enabled: !!doc && !doc.cloud,
    refresh: editorKey,
  });
  // The brain's top level, shared by its three sections and the hibachi agent's Schema line.
  const rootsRead = useResource(() => host.entries(active!.scopeId, ''), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  const roots = useMemo<Listing | undefined>(
    () =>
      rootsRead.data || rootsRead.error
        ? { entries: rootsRead.data ?? noEntries, error: rootsRead.error }
        : undefined,
    [rootsRead.data, rootsRead.error],
  );
  // The branch and changes shown beside the brain; Git itself reads without locking.
  const gitRead = useResource(() => host.gitStatus(active!.scopeId), [active?.scopeId], {
    enabled: !!active,
    refresh: revision,
  });
  // A connected folder's link can go away without file events, so it is polled.
  const connectionsRead = useResource(
    () => host.cloudConnections(active!.scopeId),
    [active?.scopeId],
    { enabled: !!active && !startup, refresh: revision, interval: 5000 },
  );
  const connections = connectionsRead.data ?? noConnections;
  const defaultNoteDirectory =
    notesDeclared?.newNoteDirectory ?? `${knowledgeFolder(active ?? {})}/Notes`;
  const composer = useDraft(
    active ? { scopeId: active.scopeId, kind: 'composer', agent } : null,
    active?.root,
  );
  function setPrompt(value: string | ((previous: string) => string)) {
    composer.setText(typeof value === 'function' ? value(composer.snapshot().text) : value);
  }
  // What each dock column reports: a send under way, and its conversation's queue.
  const [columnStatus, setColumnStatus] = useState<
    Record<string, { sending: boolean; queued: number }>
  >({});
  const sending = Object.values(columnStatus).some((status) => status.sending);
  // Back from the Overview, the columns read their conversations again: the
  // Overview may have sent to them, queued for them or answered them meanwhile.
  const [reload, setReload] = useState(0);
  const shownLevel = useRef(level);
  useEffect(() => {
    if (
      (shownLevel.current === 'overview' || shownLevel.current === 'routines') &&
      level === 'brain'
    )
      setReload((value) => value + 1);
    shownLevel.current = level;
  }, [level]);
  // The Overview changed or resumed an owner's queues; the columns showing them read them again.
  const [queueSignal, setQueueSignal] = useState<DockShared['queueSignal']>({
    n: 0,
    resume: false,
  });
  // Conversations on show in a column: their queues are the column's to send.
  const displayed = useRef(new Map<string, number>());
  function display(conversationId: string) {
    const all = displayed.current;
    all.set(conversationId, (all.get(conversationId) ?? 0) + 1);
    return () => {
      const left = (all.get(conversationId) ?? 1) - 1;
      if (left) all.set(conversationId, left);
      else all.delete(conversationId);
    };
  }
  // Conversations (or spaces) whose next queued instruction is being sent, so it is sent once.
  const draining = useRef(new Set<string>());
  const [add, setAdd] = useState(false),
    [noteName, setNoteName] = useState(''),
    [noteDirectory, setNoteDirectory] = useState('Knowledge_Base/Notes'),
    [newNote, setNewNote] = useState(false);
  // Every run is tracked so the explorer can mark its space and the panel its
  // conversation's tab, while the panel's controls follow the conversation on show.
  function addRun(runId: string, scopeId: string, conversationId?: string) {
    if (endedRuns.current.has(runId)) return;
    setLiveRuns((all) =>
      all[runId] && (!conversationId || all[runId].conversationId === conversationId)
        ? all
        : {
            ...all,
            [runId]: { scopeId, conversationId: conversationId ?? all[runId]?.conversationId },
          },
    );
  }
  /** Follows a run from its events: it runs from its first event until its end. */
  function trackRun(event: AgentEvent) {
    if (!event.scopeId || !event.runId || event.resolved) return;
    if (event.type !== 'done') {
      addRun(event.runId, event.scopeId, event.conversationId);
      return;
    }
    endedRuns.current.add(event.runId);
    setLiveRuns((all) => {
      if (!all[event.runId]) return all;
      const { [event.runId]: _, ...rest } = all;
      return rest;
    });
  }
  /** Shows a send as running until the host has started its run, or refused it. */
  async function launch(
    scopeId: string,
    conversationId: string | undefined,
    send: () => Promise<string | null>,
  ) {
    const key = conversationId ?? scopeId;
    setStarting((all) => ({ ...all, [key]: scopeId }));
    try {
      const runId = await send();
      if (runId) addRun(runId, scopeId, conversationId);
      return runId;
    } finally {
      setStarting(({ [key]: _, ...rest }) => rest);
    }
  }
  // A run waits for the person while a permission or question is open. Each open
  // request names its run and scopes: a sub-agent's request also holds its brain.
  const openRequests = useRef(new Map<string, { runId: string; scopes: string[] }>());
  const [openRequestCount, setOpenRequestCount] = useState(0);
  function showWaiting() {
    setOpenRequestCount(openRequests.current.size);
    const scopes = new Set([...openRequests.current.values()].flatMap((request) => request.scopes));
    setWaitingScopes((all) =>
      all.length === scopes.size && all.every((scopeId) => scopes.has(scopeId)) ? all : [...scopes],
    );
    const runs = new Set([...openRequests.current.values()].map((request) => request.runId));
    setWaitingRuns((all) =>
      all.length === runs.size && all.every((runId) => runs.has(runId)) ? all : [...runs],
    );
  }
  function trackRequests(event: AgentEvent) {
    const open = openRequests.current;
    if ((event.type === 'permission' || event.type === 'question') && event.requestId)
      open.set(event.requestId, {
        runId: event.runId,
        scopes: [event.scopeId!, ...(event.delegate ? [event.delegate.scopeId] : [])],
      });
    if (event.resolved) open.delete(event.resolved);
    if (event.type === 'done')
      for (const [id, request] of open) if (request.runId === event.runId) open.delete(id);
    showWaiting();
  }
  /** What a freshly read conversation says its run waits on replaces what that run held. */
  function resetRequests(scopeId: string, runId: string, requests: AgentEvent[] = []) {
    const open = openRequests.current;
    for (const [id, request] of open) if (request.runId === runId) open.delete(id);
    for (const request of requests) trackRequests({ ...request, scopeId });
    showWaiting();
  }
  // Your AI: its folder on this device, and whether it is working. While it
  // works, the brains handed to it are held, as a brain's own run holds it.
  const [youRevision, setYouRevision] = useState(0);
  const youRead = useResource(() => host.yourAi(), [], { refresh: youRevision });
  const you = youRead.data;
  const yourAiRunning = !!you && runningScopes.includes(you.id);
  // The shared Schema's skills join each hibachi's own in its composer; its own,
  // retired ones among them, win (ADR 027).
  const sharedSkillRead = useResource(() => host.skills(sharedSchemaId), [you?.state], {
    enabled: you?.state === 'ready',
    // The shared Schema lives in the irori agent's folder: a change is reported as the
    // shared Schema's when made from the settings, as the irori agent's otherwise.
    refresh:
      skillRevision + scopeRevision(revisions, sharedSchemaId) + scopeRevision(revisions, you?.id),
  });
  const composerSkills = useMemo(
    () => [
      ...skills,
      ...(sharedSkillRead.data?.skills ?? [])
        .filter((skill) => ![...skills, ...skillsRetired].some((own) => own.name === skill.name))
        .map((skill) => ({ ...skill, shared: true })),
    ],
    [skills, skillsRetired, sharedSkillRead.data],
  );
  // The irori agent's panel shows one of its conversations: the host's pick until one is chosen.
  useEffect(() => {
    if (you?.state !== 'ready' || shown[you.id]) return;
    let live = true;
    const choice = yourChoice.agent;
    void (async () => {
      const value = await host.agentConversation(you.id, choice, undefined, workspace?.id);
      const id = value.id ?? (await host.createConversation(you.id, choice, workspace?.id));
      const next = value.summary?.agent ?? choice;
      if (!live) return;
      if (next !== choice) chooseYour({ ...yourChoice, agent: next });
      setShown((all) => (all[you.id] ? all : { ...all, [you.id]: { id, agent: next } }));
    })().catch(report);
    return () => {
      live = false;
    };
  }, [you?.id, you?.state, !!(you && shown[you.id]), workspace?.id]);
  // The brains handed to your AI's run in progress; unknown after a reload, when
  // the workspace's brains count as handed.
  const [handed, setHanded] = useState<string[]>();
  useEffect(() => {
    if (!yourAiRunning) setHanded(undefined);
  }, [yourAiRunning]);
  function heldByYou(scopeId: string) {
    return yourAiRunning && (handed ?? workspace?.scopeIds ?? []).includes(scopeId);
  }
  // Any run in the hibachi on show holds what irori itself would change there.
  const running = !!active && runningScopes.includes(active.scopeId);
  /** Whether a conversation's run waits for the person's answer. */
  const conversationWaiting = useCallback(
    (id: string) =>
      Object.entries(liveRuns).some(
        ([runId, run]) => run.conversationId === id && waitingRuns.includes(runId),
      ),
    [liveRuns, waitingRuns],
  );
  // The hibachi's conversations, read again when one begins or a run ends, name the
  // tabs; one running without a tab, after a reload or from the Overview, gets one.
  const [tabRevisions, setTabRevisions] = useState<Record<string, number>>({});
  const tabRows = useResource(() => host.agentConversations(active!.scopeId), [active?.scopeId], {
    enabled: !!active && !startup,
    refresh: active ? (tabRevisions[active.scopeId] ?? 0) : 0,
  });
  useEffect(() => {
    if (!active || !tabRows.data) return;
    const open = tabsOf(active.scopeId);
    const anywhere = columns.flatMap((column) => tabsOf(slot(column.id, active.scopeId)));
    const missing = tabRows.data.flatMap((row) =>
      !isDamaged(row) && row.running && !anywhere.some((tab) => tab.id === row.id)
        ? [{ id: row.id, agent: row.agent }]
        : [],
    );
    if (missing.length) setTabs((all) => ({ ...all, [active.scopeId]: [...open, ...missing] }));
  }, [tabRows.data]);
  // A Schema setting belongs to its brain; another brain shows its note instead, and
  // without the hibachi agent there is no Schema to show (ADR 021).
  useEffect(() => {
    if (view === 'schema' && (!hibachiAgent || schemaTarget?.scopeId !== active?.scopeId))
      setView('note');
  }, [active?.scopeId, hibachiAgent]);
  // Who typed which line of the open note. A connected folder's file is outside the KB's
  // Git history and has no record; a failure here leaves the note unmarked rather than unopenable.
  // A note just opened is asked about at once; one being saved again and again (an agent
  // editing it) is asked about once it has stood for half a second.
  const authorshipOf = useRef('');
  useEffect(() => {
    if (!doc || doc.cloud || doc.viewer) {
      authorshipOf.current = '';
      return setAuthorship(undefined);
    }
    let current = true;
    const { scopeId, path, text } = doc;
    const note = `${scopeId}:${path}`;
    const settled = authorshipOf.current === note;
    authorshipOf.current = note;
    const ask = () =>
      void host
        .noteAuthorship(scopeId, path, text)
        .then((value) => current && setAuthorship(value))
        .catch(() => current && setAuthorship(undefined));
    const timer = settled ? setTimeout(ask, 500) : undefined;
    if (!settled) ask();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [doc?.scopeId, doc?.path, doc?.hash]);
  const personLineCount = authorship?.lines.filter(Boolean).length ?? 0;
  const editor = useRef<PageEditorHandle>(null);
  const current = useRef({ doc, buffer, external });
  current.current = { doc, buffer, external };
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const organizing = useRef(false);
  const reconciliation = useRef(0);
  const dirty = !!doc && buffer !== doc.text;
  const report = useCallback((e: unknown) => setError(errorText(e)), []);
  /** Counts a change in one hibachi, or in every one of them when none is named. */
  const bump = useCallback(
    (scopeId?: string) => setRevisions((all) => bumpRevision(all, scopeId)),
    [],
  );

  function openDaily() {
    if (!active) return;
    const scopeId = active.scopeId;
    void save()
      .then(async (saved) => {
        if (!saved) return;
        show(await host.dailyNote(scopeId));
        bump(scopeId);
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
        await open(space, fileEntry(target.path, classify(space, target.path), target.note));
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
    // The stage's save state shows what this document is; the status bar stays quiet.
    setStatus('');
  }
  /** Loads a document the person chose to open, and shows it on the stage. */
  function show(next: Document, navigation?: Navigation) {
    load(next, navigation);
    setView('note');
    goToLevel('brain');
    // A file chosen while only the agents show brings the page back.
    stagePanel.current?.expand();
  }
  async function refreshSpaces() {
    const list = await host.spaces();
    setSpaces(list);
    // The brain on show keeps its place but takes its newest declaration.
    setActive((a) => (a && list.find((space) => space.scopeId === a.scopeId)) ?? a ?? list[0]);
  }
  /** The environment saved on the GitHub account was restored here (ADR 026). */
  async function environmentRestored() {
    await refreshSpaces();
    const profiles = await host.workspaces();
    setWorkspace((open) => (open && profiles.find((item) => item.id === open.id)) ?? open);
    setHibachiAgent(currentHibachiAgent());
    setYourChoice(currentYourAi());
  }
  async function reconcile() {
    const generation = ++reconciliation.current;
    if (organizing.current) return;
    if (saving.current) await saving.current;
    if (generation !== reconciliation.current) return;
    const now = current.current;
    if (!now.doc) return;
    try {
      const disk = await host.read(now.doc.scopeId, now.doc.path);
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
        bump(event.scopeId);
        if (event.scopeId === current.current.doc?.scopeId) void reconcile();
      } else if (event.type === 'hibachis') {
        // The irori agent registered a hibachi; the workspace on show takes it in.
        const joined = event.workspace;
        void refreshSpaces()
          .then(() => {
            if (joined) setWorkspace((open) => (open?.id === joined.id ? joined : open));
          })
          .catch(report);
      } else if (event.type === 'agent') {
        const incoming = event.event;
        if (incoming.scopeId) {
          const scopeId = incoming.scopeId;
          // An answered request says only that it ended; the run goes on.
          trackRun(incoming);
          trackRequests(incoming);
          if (incoming.type === 'done' || incoming.role === 'user')
            setTabRevisions((all) => ({ ...all, [scopeId]: (all[scopeId] ?? 0) + 1 }));
          // The AI that runs in a brain is that brain's hibachi agent from now on.
          if (incoming.agent) {
            const agentId = incoming.agent;
            setAgentChoice((choice) =>
              choice.brains[scopeId] === agentId
                ? choice
                : { ...choice, brains: { ...choice.brains, [scopeId]: agentId } },
            );
          }
        }
        if (incoming.type !== 'done') return;
        setSkillRevision((value) => value + 1);
        // A run may have changed any hibachi: the irori agent's hand-offs reach others, and
        // two hibachis may connect the same folder, whose files no watcher reports. Run ends
        // are rare, so every view reads again; file events stay with their own hibachi.
        bump();
        void reconcile();
        // A run's end sends the next queued instruction of its own conversation; a
        // conversation on show in a column sends its own.
        if (
          incoming.scopeId &&
          incoming.conversationId &&
          incoming.outcome === 'completed' &&
          !displayed.current.has(incoming.conversationId)
        )
          void sendNextQueued(incoming.scopeId, incoming.conversationId);
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
    let text = editor.current?.getText() ?? now.buffer;
    if (text === now.doc.text) return true;
    // A knowledge page names the person as its last change (ADR 015).
    text = editor.current?.stamp?.() ?? text;
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
          setStatus('');
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
  // A connected folder lies outside the hibachi's watched files, and a sync app
  // changes it at any time, so its document at rest is read again now and then; the
  // change would otherwise show only when a save ran into it. A failed check ends the checks until the document
  // changes, so an unreachable folder is reported once rather than every tick.
  useEffect(() => {
    if (!doc?.cloud || dirty) return;
    const timer = setInterval(async () => {
      if ((await reconcile()) === false) clearInterval(timer);
    }, 25000);
    return () => clearInterval(timer);
  }, [doc, dirty]);
  // The terminal of what is on show: a hibachi's in its stage, or irori mode's own.
  const iroriShown = level !== 'brain';
  function toggleTerminal() {
    if (!iroriShown) {
      if (terminalSpace || active) setTerminalSpace((value) => (value ? undefined : active));
    } else if (iroriTerminal || you?.state === 'ready') setIroriTerminal((value) => !value);
  }
  // The shortcuts read the latest render's state; the listener itself is added once.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    // Ctrl+` opens and closes the terminal, from inside it too.
    if (e.ctrlKey && e.key === '`' && !startup) {
      e.preventDefault();
      toggleTerminal();
      return;
    }
    if ((e.target as HTMLElement).closest('.terminal-panel')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void save();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !startup && !searchOpen) {
      e.preventDefault();
      if (workspaceSpaces.length && !connecting) {
        setSearchAll(level === 'overview' || level === 'routines');
        setSearchOpen(true);
      }
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  async function selectSpace(space: Space) {
    if (gitBusy) return false;
    if (!(await composer.flush())) return false;
    if (!(await save())) return false;
    // Another brain's hibachi agent keeps running and its queue keeps going; only a send
    // in flight or a connection being prepared holds the brain on show.
    if (sending || connecting) return false;
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
      if (sending && space.scopeId !== active?.scopeId) {
        setError(
          t('送信中は hibachi を切り替えられません。', "Can't switch hibachis while sending."),
        );
        return false;
      }
      if (opensInIrori(entry.path)) {
        const next = await host.read(space.scopeId, entry.path);
        setActive(space);
        show(next, navigation);
      } else await host.openExternal(space.scopeId, entry.path);
      return true;
    } catch (e) {
      report(e);
      return false;
    }
  }
  /**
   * Sends the next queued instruction of a conversation that is not on show: its
   * run ended while the person looked at another conversation, brain or the
   * Overview. Without a conversation, of the owner's oldest waiting queue. The
   * conversation on show sends its own queue from the effect above.
   */
  async function sendNextQueued(scopeId: string, conversationId?: string) {
    const key = conversationId ?? scopeId;
    // The owner's queues are being resumed one after another: that picks this one up.
    if (draining.current.has(key) || draining.current.has(scopeId)) return null;
    draining.current.add(key);
    try {
      const open = current.current;
      // A note of that brain in conflict must be settled before its AI reads it.
      if (open.doc?.scopeId === scopeId && open.external) return null;
      if (!(await save())) return null;
      return await launch(scopeId, conversationId, () =>
        host.startNextQueued(scopeId, conversationId, workspace?.id),
      );
    } catch (error) {
      report(error);
      return null;
    } finally {
      draining.current.delete(key);
    }
  }
  /** Sends to a brain's hibachi agent from the Overview, or queues behind its run or its waiting queue. */
  async function sendToBrain(scopeId: string, message: string) {
    if (!(await save()))
      throw Error(
        t('編集中のノートを保存できませんでした。', 'Could not save the note being edited.'),
      );
    // The brain's conversation on show, or the host's pick for its CLI.
    const target = shown[scopeId];
    const agentId = target?.agent ?? agentFor(scopeId);
    const value = await host.agentConversation(scopeId, agentId, target?.id);
    const input = {
      scopeId,
      agent: agentId,
      conversationId: value.summary?.agent === agentId || target ? value.id : undefined,
      access: defaultAgentAccess(agentId),
      model: modelFor(scopeId, agentId),
      prompt: message,
    };
    if (behind(input.conversationId, value)) {
      await host.queueAgentMessage(input);
      setQueueSignal((signal) => ({ n: signal.n + 1, scopeId, resume: false }));
      return;
    }
    await launch(scopeId, input.conversationId, () => host.start(input));
  }
  /** Whether a send to this conversation waits behind its own run or queue. */
  function behind(conversationId: string | undefined, value: Conversation) {
    return (
      !!value.activeRunId ||
      value.queued.length > 0 ||
      (!!conversationId &&
        (runningNow.current.has(conversationId) || draining.current.has(conversationId)))
    );
  }
  /**
   * Sends to your AI with the workspace's brains, or queues behind its
   * conversation's run, on the CLI and model chosen for it on this device.
   */
  async function sendToYou(message: string) {
    if (!you) return;
    if (!(await save()))
      throw Error(
        t('編集中のノートを保存できませんでした。', 'Could not save the note being edited.'),
      );
    const brains = workspaceSpaces.map((space) => space.scopeId);
    const target = shown[you.id];
    const agentId = target?.agent ?? yourChoice.agent;
    const input = {
      scopeId: you.id,
      agent: agentId,
      conversationId: target?.id,
      access: yourAccess,
      model: yourChoice.models[agentId] || undefined,
      prompt: message,
      brains,
      workspace: workspace?.id,
    };
    const value = await host.agentConversation(you.id, agentId, target?.id, workspace?.id);
    if (behind(input.conversationId, value)) {
      await host.queueAgentMessage(input);
      setQueueSignal((signal) => ({ n: signal.n + 1, scopeId: you.id, resume: false }));
      return;
    }
    setHanded(brains);
    await launch(you.id, input.conversationId, () => host.start(input));
  }
  /** Resumes a brain's queues from the Overview: each conversation's, behind its own run. */
  async function resumeQueue(scopeId: string) {
    while (await sendNextQueued(scopeId));
    setQueueSignal((signal) => ({ n: signal.n + 1, scopeId, resume: true }));
  }
  async function openWorkspace(profile: WorkspaceProfile) {
    if (gitBusy) return;
    setBrainMode('files');
    setGitReview(false);
    setSources({});
    const available = spaces.filter((space) => profile.scopeIds.includes(space.scopeId));
    // The irori agent keeps a history per workspace: its conversations on show belong to the last one.
    if (you && profile.id !== workspace?.id) {
      const yours = (key: string) => key === you.id || key.startsWith(`${you.id}#`);
      setShown((all) => Object.fromEntries(Object.entries(all).filter(([key]) => !yours(key))));
      setTabs((all) => Object.fromEntries(Object.entries(all).filter(([key]) => !yours(key))));
    }
    setWorkspace(profile);
    setScene(undefined);
    setLevel('brain');
    setActive(available[0]);
    setDoc(undefined);
    setBuffer('');
    setExternal(undefined);
    setStartup(false);
    setConnecting(true);
    try {
      // The folders of hibachis this workspace leaves are disconnected; its own are connected.
      const nextIds = available.map((space) => space.scopeId);
      for (const previousId of workspace?.scopeIds ?? []) {
        if (!nextIds.includes(previousId) && spaces.some((space) => space.scopeId === previousId))
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
          if (
            connection.state !== 'unconfigured' &&
            connection.state !== 'mounted' &&
            connection.state !== 'retired'
          ) {
            await host.connectCloud(id, connection.mountId).catch(() => {
              setStatus(t('接続できないクラウドがあります。', 'A cloud could not connect.'));
            });
          }
        }
    } catch (error) {
      report(error);
    } finally {
      setConnecting(false);
      bump();
    }
  }
  function showConnections(target: CloudRoot) {
    setConnectionTarget(target);
    setConnectionsOpen(true);
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
        (await host.read(open.scopeId, next.path).catch((error) => {
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
    updateSources((all) =>
      all.flatMap((ref) => {
        if (!under(ref)) return [ref];
        const moved = follow(ref);
        return moved ? [moved] : [];
      }),
    );
    bump(change.scopeId);
    setStatus(
      change.action === 'delete'
        ? t('ゴミ箱に移動', 'Moved to trash')
        : change.action === 'rename'
          ? t('名前を変更', 'Renamed')
          : t('移動', 'Moved'),
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
  // The dock's columns keep their widths per set of columns.
  const dockPanes = useMemo(() => columns.map((column) => column.id), [columns]);
  const dockLayout = useDefaultLayout({
    id: 'irori-dock',
    panelIds: dockPanes,
    onlySaveAfterUserInteractions: true,
    storage: layoutStorage,
  });
  // The stage folds away beside the dock, so only the agents show (ADR 021).
  const stagePanel = usePanelRef();
  const dockPanel = usePanelRef();
  const [stageHidden, setStageHidden] = useState(false);
  // A run, a send, queued work or a connection holds what changes the brain on show.
  // Your AI's run holds the brains handed to it as a brain's own run holds it.
  const heldHere = !!active && heldByYou(active.scopeId);
  // The queues of the hibachi columns' conversations, which follow the hibachi on show.
  const queuedHere = columns.reduce(
    (sum, column) =>
      ownerOf(column) === 'hibachi' ? sum + (columnStatus[column.id]?.queued ?? 0) : sum,
    0,
  );
  const brainLocked = running || sending || queuedHere > 0 || connecting || heldHere;
  // Other brains stay open to choose while this one's AI runs.
  const switchLocked = sending || connecting;
  const anyRunning = runningScopes.length > 0;
  const docSpace = doc ? spaces.find((s) => s.scopeId === doc.scopeId) : undefined;
  const docLayer = doc?.cloud
    ? 'contents'
    : docSpace && doc
      ? classify(docSpace, doc.path)
      : undefined;
  // The note's own controls show while the note is what the stage shows.
  const onNote = !!doc && view === 'note';
  /** Opens the dock; with an owner, its first column shows that agent. */
  function openDock(owner?: ColumnOwner) {
    setPanel(true);
    if (owner)
      setColumns((all) =>
        all.map((column) => (column.id === 'main' ? { ...column, owner } : column)),
      );
  }
  function closeDock() {
    stagePanel.current?.expand();
    setPanel(false);
    setStageHidden(false);
  }
  function toggleStage() {
    const pane = stagePanel.current;
    if (!pane) return;
    if (pane.isCollapsed()) pane.expand();
    else
      void save().then((saved) => {
        if (saved) pane.collapse();
      });
  }
  /** Adds a column beside `after`, showing the same agent, and widens the dock for it. */
  function splitColumn(after: DockColumn) {
    const used = columns.map((column) => Number(column.id)).filter(Number.isFinite);
    const id = String(Math.max(1, ...used) + 1);
    if (Number(id) > 64) return;
    const width = dockPanel.current?.getSize().inPixels ?? 0;
    setColumns((all) => {
      const at = all.findIndex((column) => column.id === after.id);
      return [...all.slice(0, at + 1), { id, owner: after.owner }, ...all.slice(at + 1)];
    });
    requestAnimationFrame(() => dockPanel.current?.resize(width + 340));
  }
  function closeColumn(column: DockColumn) {
    if (column.id === 'main') return closeDock();
    setColumns((all) => all.filter((item) => item.id !== column.id));
    setSources(({ [column.id]: _, ...rest }) => rest);
    setColumnStatus(({ [column.id]: _, ...rest }) => rest);
  }
  // Another brain's hibachi agent is running or waiting: the AI summary leads to the Overview.
  const othersActive = runningScopes.some((id) => id !== active?.scopeId);
  function showOverview() {
    if (!workspaceSpaces.length) return;
    goToLevel('overview');
  }
  // The rail, the brain panel, the status bar and the dock's columns are memoised, so
  // a keystroke in the editor re-renders none of them. They take their actions under
  // identities that never change; each still does what the latest render's would.
  const act = useStableFunctions({
    report,
    save,
    launch,
    addRun,
    resetRequests,
    display,
    leaveWorkspace,
    showOverview,
    showRoutines: () => goToLevel('routines'),
    enterBrain: (space: Space) => void enterBrain(space),
    openAdd: () => setAdd(true),
    searchFromRail: () => {
      setSearchAll(level === 'overview' || level === 'routines');
      setSearchOpen(true);
    },
    searchHere: () => {
      setSearchAll(false);
      setSearchOpen(true);
    },
    saveGroups: (groups: HibachiGroup[]) => {
      if (!workspace) return;
      const before = workspace;
      setWorkspace({ ...workspace, groups });
      void host
        .saveWorkspaceGroups(workspace.id, groups)
        .then(setWorkspace)
        .catch((error) => {
          setWorkspace(before);
          report(error);
        });
    },
    changeBrainMode: (next: BrainMode) => {
      if (next === 'files') {
        setBrainMode('files');
        setGitReview(false);
      } else
        void save().then((saved) => {
          if (saved) setBrainMode('changes');
        });
    },
    openEntry: (space: Space, entry: Entry) => void open(space, entry),
    refreshBrain: () => bump(active?.scopeId),
    showHome: () => setView('home'),
    openDaily,
    newNoteHere: () => {
      if (active) newNoteIn(active);
    },
    showGraph: () => setView('graph'),
    connectHere: () => {
      if (active) showConnections(active);
    },
    openTrash: () => {
      void save().then((saved) => {
        if (saved) setTrashOpen(true);
      });
    },
    openMaterials,
    openBrainSettings: () => setBrainSettings(true),
    createIn: (space: Space, entry: Entry) => {
      setCloudNoteTarget({ scopeId: space.scopeId, directory: entry.path });
      setNewNote(true);
    },
    entryAction: (space: Space, entry: Entry, action: EntryAction) =>
      setEntryAction({ space, entry, action }),
    selectSchema: (target: SchemaTarget) => {
      if (!active) return;
      const scopeId = active.scopeId;
      // The note being edited is saved first, as before the graph or materials.
      void save().then((saved) => {
        if (!saved) return;
        setSchemaTarget({ ...target, scopeId });
        setView('schema');
      });
    },
    openSchemaFile: (entry: Entry) => {
      if (active) void open(active, entry);
    },
    gitBeforeAction: async () => {
      if (brainLocked) {
        report(t('実行中は Git を操作できません。', "Can't operate Git while running."));
        return false;
      }
      return save();
    },
    gitChanged: () => {
      bump(active?.scopeId);
      void reconcile();
    },
    setGitReview,
    setGitBusy,
    showAi: () => {
      if (othersActive) showOverview();
      else {
        goToLevel('brain');
        openDock();
      }
    },
    toggleTerminal,
    toggleStage,
    chooseHibachi,
    environmentRestored,
    chooseYour,
    remember,
    newConversation,
    showConversation,
    closeTab,
    splitColumn,
    closeColumn,
    createYou: async () => {
      await host.createYourAi();
      setYouRevision((value) => value + 1);
    },
    setShown,
    setTabs,
    setSources,
    setColumns,
    setModelChoice,
    setAccessChoice,
    setYourAccessSelection,
    setColumnStatus,
    setHanded,
  });
  const hidden = level !== 'brain';
  const dockShared = useMemo<DockShared>(
    () => ({
      infos,
      spaces,
      doc,
      docLayer,
      personLineCount,
      gitBusy,
      connecting,
      external: !!external,
      runningConversations,
      conversationWaiting,
      draining,
      save: act.save,
      launch: act.launch,
      addRun: act.addRun,
      resetRequests: act.resetRequests,
      display: act.display,
      report: act.report,
      reload,
      queueSignal,
      tabRevisions,
      hidden,
    }),
    [
      infos,
      spaces,
      doc,
      docLayer,
      personLineCount,
      gitBusy,
      connecting,
      external,
      runningConversations,
      conversationWaiting,
      act,
      reload,
      queueSignal,
      tabRevisions,
      hidden,
    ],
  );
  // What the rail shows of each brain's AI; the same function while nothing changed.
  const aiState = useMemo(
    () =>
      (scopeId: string): BrainAiState =>
        waitingScopes.includes(scopeId)
          ? 'waiting'
          : runningScopes.includes(scopeId) || heldByYou(scopeId)
            ? 'running'
            : 'idle',
    [waitingScopes, runningScopes, yourAiRunning, handed, workspace?.scopeIds],
  );
  const settings = useMemo(
    () => (
      <Settings
        hibachiAgent={hibachiAgent}
        onHibachiAgent={act.chooseHibachi}
        onRestored={act.environmentRestored}
        onSchema={() => setSchemaOpen(true)}
        onError={act.report}
      />
    ),
    [hibachiAgent, act, language],
  );
  const schemaSelected =
    view === 'schema' && schemaTarget?.scopeId === active?.scopeId ? schemaTarget : undefined;
  const schemaList = useMemo(
    () =>
      hibachiAgent && active ? (
        <SchemaList
          scopeId={active.scopeId}
          revision={revision}
          selected={schemaSelected}
          locked={brainLocked || gitBusy}
          onSelect={act.selectSchema}
          onOpenFile={act.openSchemaFile}
        />
      ) : undefined,
    [hibachiAgent, active, revision, schemaSelected, brainLocked, gitBusy, act, language],
  );
  const gitPanel = useMemo(
    () =>
      active && (
        <GitPanel
          space={active}
          detailTarget={gitDetailTarget}
          onReviewChange={act.setGitReview}
          onBusyChange={act.setGitBusy}
          revision={revision}
          beforeAction={act.gitBeforeAction}
          onChanged={act.gitChanged}
        />
      ),
    [active, gitDetailTarget, revision, act, language],
  );
  /** Shows a brain, from the rail or the Overview: its note, or its hibachi agent. */
  async function enterBrain(
    space: Space,
    options: { ai?: boolean; entry?: Entry; origin?: { x: number; y: number } } = {},
  ) {
    const selected = options.entry ? await open(space, options.entry) : await selectSpace(space);
    if (!selected) return;
    goToLevel('brain', options.origin);
    if (options.ai) openDock(hibachiAgent ? 'hibachi' : 'irori');
  }
  // Home is reachable from anywhere: what still runs is stopped once the person agrees.
  function leaveWorkspace() {
    if (gitBusy || connecting || goingHome) return;
    if (anyRunning || terminalSpace || iroriTerminal) setAskHome(true);
    else void goHome();
  }
  async function goHome() {
    setGoingHome(true);
    try {
      if (!(await save())) {
        setAskHome(false);
        report(t('ノートが未保存です。', 'The note is unsaved.'));
        return;
      }
      await Promise.all(runningScopes.map((scopeId) => host.cancel(scopeId)));
      setTerminalSpace(undefined);
      setIroriTerminal(false);
      await flushDrafts();
      setAskHome(false);
      setStartup(true);
    } catch (error) {
      report(error);
    } finally {
      setGoingHome(false);
    }
  }
  function newNoteIn(space: Space) {
    void selectSpace(space).then((selected) => {
      if (selected) {
        setNoteDirectory(
          doc?.scopeId === space.scopeId ? parentPath(doc.path) : defaultNoteDirectory,
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
      if (saved) setView('records');
    });
  }
  if (startup)
    return (
      <Startup
        spaces={spaces}
        refresh={refreshSpaces}
        hibachiAgent={hibachiAgent}
        onHibachiAgent={act.chooseHibachi}
        onRestored={act.environmentRestored}
        onOpen={(profile) => void openWorkspace(profile)}
      />
    );
  return (
    <div
      className={`app ${panel ? 'panel-open' : ''} ${gitOpen ? 'source-control-open' : ''} ${terminalSpace || iroriTerminal ? 'terminal-open' : ''}`}
    >
      <a className="skip-to-editor" href="#editor-main">
        {t('編集領域へ移動', 'Skip to editor')}
      </a>
      <div className="app-body">
        <Rail
          spaces={workspaceSpaces}
          activeId={level === 'brain' ? active?.scopeId : undefined}
          overview={level === 'overview'}
          routines={level === 'routines'}
          aiState={aiState}
          locked={switchLocked || gitBusy}
          homeDisabled={connecting || gitBusy}
          addDisabled={anyRunning || dirty || connecting}
          searchDisabled={!workspaceSpaces.length || connecting}
          onHome={act.leaveWorkspace}
          onOverview={act.showOverview}
          onRoutines={act.showRoutines}
          onSelect={act.enterBrain}
          onAdd={act.openAdd}
          onSearch={act.searchFromRail}
          groups={workspace?.groups ?? noGroups}
          onGroups={act.saveGroups}
          settings={settings}
        />
        {(level === 'overview' || level === 'routines' || scene?.leaving === 'overview') &&
          workspace && (
            <Overview
              routines={level === 'routines'}
              scene={
                scene?.leaving === 'overview'
                  ? { kind: 'leave', origin: scene.origin }
                  : scene?.leaving === 'brain'
                    ? { kind: 'return' }
                    : undefined
              }
              workspace={workspace}
              spaces={workspaceSpaces}
              view={overviewView}
              revisions={revisions}
              addDisabled={anyRunning || dirty || connecting}
              agentFor={agentFor}
              hibachiAgent={hibachiAgent}
              onView={setOverviewView}
              onSearch={() => {
                setSearchAll(true);
                setSearchOpen(true);
              }}
              onAdd={() => setAdd(true)}
              onConnect={(space) => showConnections(space)}
              onSend={sendToBrain}
              onResume={resumeQueue}
              onStop={(scopeId, conversationId) => host.cancel(scopeId, conversationId)}
              you={you}
              onCreateYou={async () => {
                await host.createYourAi();
                setYouRevision((value) => value + 1);
              }}
              onShowYou={() => {
                if (you?.state === 'ready') goToLevel('you');
              }}
              onSendYou={(prompt) => sendToYou(prompt)}
              yourAgent={yourChoice.agent}
              yourModel={yourChoice.models[yourChoice.agent] ?? ''}
              yourAccess={yourAccess}
              onYourAccess={(value) => setYourAccessSelection({ agent: yourChoice.agent, value })}
              onYourAgent={(next) => {
                if (next === yourChoice.agent) return;
                chooseYour({ ...yourChoice, agent: next });
                // Another CLI is another conversation (ADR 017 D2).
                if (you) void newConversation(you.id, you.id, next).catch(report);
              }}
              yourConversation={you ? shown[you.id]?.id : undefined}
              onShowConversation={(scopeId, id, next) => {
                if (scopeId === you?.id) chooseYour({ ...yourChoice, agent: next });
                else remember(scopeId, next);
                if (id) showConversation(scopeId, id, next);
                else setShown(({ [scopeId]: _, ...rest }) => rest);
              }}
              onYourNew={async () => {
                if (you) await newConversation(you.id, you.id, yourChoice.agent);
              }}
              onYourModel={(next) => {
                const models = { ...yourChoice.models };
                if (next) models[yourChoice.agent] = next;
                else delete models[yourChoice.agent];
                chooseYour({ ...yourChoice, models });
              }}
              onStopYou={async (conversationId) => {
                if (you) await host.cancel(you.id, conversationId);
              }}
              routineChoices={() => ({
                ...Object.fromEntries(
                  workspaceSpaces.map((space) => {
                    const agentId = agentFor(space.scopeId);
                    return [
                      space.scopeId,
                      { agent: agentId, model: modelFor(space.scopeId, agentId) },
                    ];
                  }),
                ),
                ...(you && {
                  [you.id]: {
                    agent: yourChoice.agent,
                    model: yourChoice.models[yourChoice.agent] || undefined,
                  },
                }),
              })}
              onEnter={(space, options) => void enterBrain(space, options)}
              onError={report}
            />
          )}
        {level === 'you' && workspace && you?.state === 'ready' && (
          <YourAiScreen
            you={you}
            agent={yourChoice.agent}
            spaces={workspaceSpaces}
            running={yourAiRunning}
            revision={scopeRevision(revisions, you.id)}
            onBack={() => goToLevel('overview')}
            onAddSkills={async () => {
              try {
                await host.addYourAiSkills();
              } catch (error) {
                report(error);
              }
              setYouRevision((value) => value + 1);
            }}
          />
        )}
        <PaneGroup
          className={`islands ${scene?.leaving === 'overview' ? 'level-enter' : ''} ${scene?.leaving === 'brain' ? 'level-exit' : ''}`}
          inert={level !== 'brain'}
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
                onModeChange={act.changeBrainMode}
                filesDisabled={gitBusy}
                changesDisabled={brainLocked || gitBusy}
                changes={gitRead.data?.available ? gitRead.data.changes.length : undefined}
                selected={doc}
                revision={revision}
                locked={brainLocked || gitBusy}
                daily={!!notesDeclared?.daily}
                dirty={dirty}
                connections={connections}
                onOpen={act.openEntry}
                onRefresh={act.refreshBrain}
                onHome={act.showHome}
                onDaily={act.openDaily}
                onNewNote={act.newNoteHere}
                onGraph={act.showGraph}
                onConnect={act.connectHere}
                onTrash={act.openTrash}
                onMaterials={act.openMaterials}
                onSettings={act.openBrainSettings}
                onSearch={act.searchHere}
                onCreateIn={act.createIn}
                onEntryAction={act.entryAction}
                schema={schemaList}
              >
                {gitPanel}
              </BrainPanel>
            ) : (
              <section className="brain-panel brain-empty chrome">
                <p>
                  {t(
                    'このワークスペースに hibachi がありません。',
                    'This workspace has no hibachi yet.',
                  )}
                </p>
                <button className="solid-button" onClick={() => setAdd(true)}>
                  <Icon name="plus" size={14} />
                  {t('hibachi を追加', 'Add a hibachi')}
                </button>
              </section>
            )}
          </Pane>
          <PaneSeparator
            className="island-handle"
            aria-label={t('hibachi パネルの幅', 'hibachi panel width')}
          />
          <Pane
            id="stage"
            className="stage-pane"
            minSize={360}
            panelRef={stagePanel}
            collapsible={panel}
            collapsedSize={0}
            onResize={(size) => setStageHidden(size.inPixels < 1)}
          >
            <main id="editor-main" className="stage on-stage" tabIndex={-1} inert={stageHidden}>
              <div
                className="stage-top"
                hidden={gitReview || view === 'graph' || view === 'records' || view === 'schema'}
              >
                <header className="stage-bar">
                  {onNote && doc && docLayer ? (
                    <Crumbs
                      space={docSpace}
                      {...fileCrumbs(docSpace, docLayer, doc.path)}
                      onBrain={
                        docSpace && docSpace.scopeId === active?.scopeId
                          ? () => setView('home')
                          : undefined
                      }
                    />
                  ) : (
                    <Crumbs
                      space={active}
                      items={[]}
                      here={active ? t('ホーム', 'Home') : t('ようこそ', 'Welcome')}
                      hereIcon={active ? 'home' : undefined}
                    />
                  )}
                  <div className="stage-actions">
                    {connecting && (
                      <small className="stage-note">
                        {t('接続を準備中…', 'Preparing connection…')}
                      </small>
                    )}
                    {onNote &&
                      doc &&
                      (doc.viewer ? (
                        <span className="save-state" role="status">
                          <Icon name="file" size={13} />
                          {t('表示のみ', 'View only')}
                        </span>
                      ) : doc.readOnly ? (
                        <span className="save-state" role="status">
                          <Icon name="lock" size={13} />
                          {t('読み取り専用', 'Read-only')}
                        </span>
                      ) : dirty ? (
                        <button
                          className="save-state pending"
                          disabled={!!external}
                          onClick={() => void save()}
                        >
                          <i />
                          {t('保存', 'Save')}
                        </button>
                      ) : (
                        <span className="save-state" role="status">
                          <Icon name="check" size={13} strokeWidth={2.4} />
                          {t('保存済み', 'Saved')}
                        </span>
                      ))}
                    {onNote && <span className="stage-divider" aria-hidden="true" />}
                    {onNote && doc && (
                      <Backlinks
                        key={`${doc.scopeId}:${doc.path}`}
                        scopeId={doc.scopeId}
                        path={doc.path}
                        revision={docRevision}
                        onOpen={async (hit) => {
                          const space = docSpace;
                          const opened =
                            space &&
                            (await open(
                              space,
                              fileEntry(hit.path, 'Knowledge_Base', true),
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
                              t('ノートを開けませんでした。', 'Could not open the note.'),
                            );
                        }}
                      />
                    )}
                    {onNote &&
                      doc &&
                      !doc.cloud &&
                      !doc.viewer &&
                      docSpace &&
                      /\.md$/i.test(doc.path) && (
                        <NoteComments
                          key={`comments:${doc.scopeId}:${doc.path}`}
                          scopeId={doc.scopeId}
                          path={doc.path}
                          revision={docRevision}
                          selection={() => editor.current?.selection()}
                          onReveal={(comment) =>
                            !!comment.quote &&
                            view === 'note' &&
                            !!editor.current?.reveal(comment.quote, comment.line)
                          }
                        />
                      )}
                    {onNote && doc && (
                      <NoteInfo label={t('ノートの情報', 'Note details')}>
                        <h3>{baseName(doc.path)}</h3>
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
                              `人が書いた行 ${personLineCount}`,
                              `Human-written lines ${personLineCount}`,
                            )}
                          </p>
                        )}
                        <small>{status}</small>
                      </NoteInfo>
                    )}
                    {onNote && doc && (
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
                                const space = docSpace;
                                if (space)
                                  setEntryAction({
                                    space,
                                    entry: { ...fileEntry(doc.path, 'contents'), writable: true },
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
                        {!doc.viewer && (/\.csv$/i.test(doc.path) || mode !== 'table') && (
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
                        {mode !== 'table' && !doc.viewer && (
                          <Menu.CheckboxItem
                            checked={editorAssistance}
                            disabled={savingAssistance}
                            onCheckedChange={chooseAssistance}
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
                    {onNote && <span className="stage-divider" aria-hidden="true" />}
                    <AiToggle
                      open={panel}
                      name={ownerOf(columns[0]) === 'irori' ? 'irori agent' : 'hibachi agent'}
                      onToggle={() => (panel ? closeDock() : openDock())}
                    />
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
                      {t('外部でノートが変更されました。', 'The note changed outside irori.')}
                    </strong>
                    <div className="versions">
                      <label>
                        {t('あなたの編集', 'Your edit')}
                        <pre>{buffer}</pre>
                      </label>
                      <label>
                        {t('ディスク版', 'Disk version')}
                        <pre>{external.text}</pre>
                      </label>
                    </div>
                    <button onClick={() => load(external)}>
                      {t('ディスク版を表示', 'Show the disk version')}
                    </button>
                    <button
                      onClick={() => {
                        setDoc(external);
                        setExternal(undefined);
                        setStatus(t('要確認', 'Needs review'));
                      }}
                    >
                      {t('編集を維持して手動で統合', 'Keep the edit and merge manually')}
                    </button>
                  </div>
                )}
                {doc?.draft && doc.draft.text !== doc.text && (
                  <div className="hint">
                    {t('下書きあり', 'Draft available')}
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
                  {view === 'records' && active && !gitReview && (
                    <KnowledgePanel
                      key={active.scopeId}
                      space={active}
                      doc={doc}
                      sourceNames={Object.fromEntries([
                        ...spaces
                          .filter((item) => workspace?.scopeIds.includes(item.scopeId))
                          .map((item) => [item.scopeId, item.name]),
                      ])}
                      onOpen={async (source) => {
                        const target = spaces.find(
                          (item) =>
                            item.scopeId === source.scopeId &&
                            workspace?.scopeIds.includes(item.scopeId),
                        );
                        const entry = fileEntry(source.path, 'Knowledge_Base');
                        if (!target)
                          throw Error(
                            t(
                              'このスペースはワークスペースにありません。',
                              "This space isn't in the workspace.",
                            ),
                          );
                        const opened = await open(target, entry);
                        if (!opened)
                          throw Error(
                            t('ファイルを開けませんでした。', 'Could not open the file.'),
                          );
                        setView('note');
                      }}
                      onClose={() => setView('note')}
                    />
                  )}
                  {view === 'schema' &&
                    active &&
                    schemaTarget?.scopeId === active.scopeId &&
                    !gitReview && (
                      <SchemaEditor
                        key={active.scopeId}
                        scopeId={active.scopeId}
                        space={active}
                        target={schemaTarget}
                        locked={brainLocked || gitBusy}
                        revision={revision}
                        onSelect={(target) => {
                          if (target) setSchemaTarget({ ...target, scopeId: active.scopeId });
                          else setView('note');
                        }}
                        onClose={() => setView('note')}
                      />
                    )}
                  {view === 'graph' && active && !gitReview && (
                    <Suspense
                      fallback={
                        <p className="hint">
                          {t('オントロジーを開いています…', 'Opening the ontology…')}
                        </p>
                      }
                    >
                      <OntologyPanel
                        space={active}
                        revision={revision}
                        onClose={() => setView('note')}
                        onConfigure={
                          hibachiAgent
                            ? () => {
                                setView('note');
                                openDock('hibachi');
                                const request =
                                  'この KB のオントロジーを一緒に整理してください。まず既存 CSV とノートを調べ、構築方針と表示設定を提案してください。既存 ID・未知の列・ノートは保持し、別 KB や contents を変更しないでください。irori の表示宣言は .irori/ontology.json、形式は {"schemaVersion":1,"entities":{"path":"ontology/entities.csv","id":"id","label":"label","note":"note","parent":"parentId","group":"group"},"relations":{"path":"ontology/relations.csv","source":"sourceId","target":"targetId","label":"relation"}} です。パスと列名は既存 CSV に合わせられます。note はこの KB 内の Markdown 相対パス、parentId は親 ID、group はサブグラフ名です。note・parent・group の列マッピングと relations は任意で、未使用なら宣言から省略できます。CSV はカンマ区切り、ID は重複させずラベル変更で変えないでください。';
                                setPrompt((previous) =>
                                  previous ? `${previous}\n\n${request}` : request,
                                );
                              }
                            : undefined
                        }
                        onOpen={(relative) => {
                          setView('note');
                          void open(active, fileEntry(relative, 'Knowledge_Base'));
                        }}
                      />
                    </Suspense>
                  )}
                  <div
                    className="note-surface"
                    hidden={
                      gitReview || view === 'graph' || view === 'records' || view === 'schema'
                    }
                  >
                    {doc && (
                      <div className="document-scroll" hidden={view !== 'note'}>
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
                          {doc.viewer ? (
                            <FileViewer
                              key={editorKey}
                              doc={{ ...doc, viewer: doc.viewer }}
                              load={(scopeId, path) => host.viewerBytes(scopeId, path)}
                              onExternal={() =>
                                void host.openExternal(doc.scopeId, doc.path).catch(report)
                              }
                              onLink={(url) => void host.openUrl(url).catch(report)}
                            />
                          ) : mode === 'table' ? (
                            <CsvPreview key={editorKey} text={buffer} />
                          ) : (
                            <PageEditor
                              ref={editor}
                              key={editorKey}
                              page={!doc.cloud && !!docSpace && isPropertyPage(docSpace, doc.path)}
                              properties={propertiesRead.data}
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
                    )}
                    {active && (!doc || view === 'home') ? (
                      <BrainHome
                        space={active}
                        roots={roots}
                        git={gitRead.data}
                        connections={connections}
                        skills={skills}
                        schemaLayer={hibachiAgent}
                        daily={!!notesDeclared?.daily}
                        locked={brainLocked || gitBusy}
                        revision={revision}
                        onOpen={(entry) => void open(active, entry)}
                        onDaily={openDaily}
                        onNewNote={() => newNoteIn(active)}
                        onTerminal={() => setTerminalSpace((value) => value ?? active)}
                        onRefresh={act.refreshBrain}
                        onGraph={() => setView('graph')}
                        onConnect={() => showConnections(active)}
                        onChanges={() => {
                          void save().then((saved) => {
                            if (saved) setBrainMode('changes');
                          });
                        }}
                        onMaterials={openMaterials}
                        onSettings={() => setBrainSettings(true)}
                      />
                    ) : (
                      !doc && (
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
                            <button
                              className="stage-text-button framed"
                              onClick={() => setAdd(true)}
                            >
                              <Icon name="folder" size={15} />
                              {t('KBフォルダを開く', 'Open a KB folder')}
                            </button>
                          </div>
                        </div>
                      )
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
                aria-label={t('エージェントの幅', 'Agents width')}
              />
              <Pane
                id="assistant"
                className="assistant-pane"
                panelRef={dockPanel}
                defaultSize={352}
                minSize={300}
              >
                <PaneGroup
                  className="agent-dock"
                  orientation="horizontal"
                  defaultLayout={dockLayout.defaultLayout}
                  onLayoutChanged={dockLayout.onLayoutChanged}
                >
                  {columns.map((column, index) => {
                    const owner = ownerOf(column);
                    return [
                      index > 0 && (
                        <PaneSeparator
                          key={`${column.id}-handle`}
                          className="island-handle dock-handle"
                          aria-label={t('列の幅', 'Column width')}
                        />
                      ),
                      <Pane
                        key={column.id}
                        id={column.id}
                        className="dock-column-pane"
                        minSize={280}
                      >
                        <DockColumnView
                          key={`${column.id}:${owner}`}
                          column={column}
                          owner={owner}
                          first={index === 0}
                          shared={dockShared}
                          active={active}
                          you={you}
                          shown={shown}
                          tabs={tabs}
                          agentChoice={agentChoice}
                          yourChoice={yourChoice}
                          yourAccess={yourAccess}
                          accessChoice={accessChoice}
                          modelChoice={modelChoice}
                          skills={composerSkills}
                          skillsRetired={skillsRetired}
                          skillProblems={skillProblems}
                          roots={roots}
                          sources={sources[column.id] ?? noSources}
                          hibachiAgent={hibachiAgent}
                          stageHidden={stageHidden}
                          workspaceScopeIds={workspaceScopeIds}
                          workspaceId={workspace?.id}
                          act={act}
                        />
                      </Pane>,
                    ];
                  })}
                </PaneGroup>
              </Pane>
            </>
          )}
        </PaneGroup>
        {iroriTerminal && you && (
          <TerminalDrawer hidden={!iroriShown}>
            <Suspense
              fallback={
                <p className="hint">{t('ターミナルを開いています…', 'Opening the terminal…')}</p>
              }
            >
              <TerminalPanel
                space={{ scopeId: you.id, name: 'irori agent' }}
                onClose={() => setIroriTerminal(false)}
              />
            </Suspense>
          </TerminalDrawer>
        )}
      </div>
      <StatusBar
        workspace={workspace?.name ?? t('ワークスペース', 'Workspace')}
        space={active}
        git={gitRead.data}
        running={runningScopes.length}
        waiting={openRequestCount}
        status={status}
        workspaceDisabled={connecting || gitBusy}
        terminalOpen={iroriShown ? iroriTerminal : !!terminalSpace}
        terminalDisabled={
          iroriShown ? !iroriTerminal && you?.state !== 'ready' : !active && !terminalSpace
        }
        onWorkspace={act.leaveWorkspace}
        onAi={act.showAi}
        onTerminal={act.toggleTerminal}
      />
      {askHome && (
        <Dialog
          label={t('ホームに戻る', 'Go home')}
          busy={goingHome}
          onClose={() => setAskHome(false)}
        >
          <form
            className="modal"
            onSubmit={(event) => {
              event.preventDefault();
              void goHome();
            }}
          >
            <h2>{t('ホームに戻る', 'Go home')}</h2>
            <p>
              {anyRunning && (terminalSpace || iroriTerminal)
                ? t(
                    '実行中のエージェントを停止し、ターミナルを閉じます。',
                    'The running agents stop and the terminals close.',
                  )
                : anyRunning
                  ? t('実行中のエージェントを停止します。', 'The running agents stop.')
                  : t('ターミナルを閉じます。', 'The terminals close.')}
            </p>
            <div className="actions">
              <button type="button" disabled={goingHome} onClick={() => setAskHome(false)}>
                {t('キャンセル', 'Cancel')}
              </button>
              <button className="primary" disabled={goingHome}>
                {t('停止して戻る', 'Stop and go home')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {connectionsOpen && connectionTarget && (
        <Connections
          key={connectionTarget.scopeId}
          space={connectionTarget}
          running={running}
          onClose={() => {
            setConnectionsOpen(false);
            bump(connectionTarget.scopeId);
          }}
        />
      )}
      {brainSettings && active && (
        <BrainSettings
          key={active.scopeId}
          space={active}
          spaces={workspaceSpaces}
          onClose={() => setBrainSettings(false)}
          beforeRename={save}
          onRemoved={() => {
            const removed = active.scopeId;
            setBrainSettings(false);
            void (async () => {
              const [list, profiles] = await Promise.all([host.spaces(), host.workspaces()]);
              const next = profiles.find((profile) => profile.id === workspace?.id);
              setSpaces(list);
              if (next) setWorkspace(next);
              // The next hibachi of the workspace comes on show.
              setActive(
                (next?.scopeIds ?? []).flatMap((id) =>
                  list.filter((space) => space.scopeId === id),
                )[0],
              );
              if (current.current.doc?.scopeId === removed) {
                current.current = { doc: undefined, buffer: '', external: undefined };
                setDoc(undefined);
                setBuffer('');
                setExternal(undefined);
              }
              updateSources((all) => all.filter((ref) => ref.scopeId !== removed));
              setTerminalSpace((space) => (space?.scopeId === removed ? undefined : space));
              bump();
              setStatus(t('hibachi を削除しました。', 'Removed the hibachi.'));
            })().catch(report);
          }}
          onSaved={(next, renamed) => {
            setSpaces((all) => all.map((item) => (item.scopeId === next.scopeId ? next : item)));
            setActive(next);
            setBrainSettings(false);
            const notices = renamed.flatMap((item) => [
              ...(item.notice ? [item.notice] : []),
              ...(item.skipped.length
                ? [
                    t(
                      `${item.skipped.length} 件のファイルのリンクを更新できませんでした。`,
                      `Links in ${item.skipped.length} files could not be updated.`,
                    ),
                  ]
                : []),
            ]);
            if (notices.length) setError(notices.join(' '));
            else setStatus(t('hibachi の設定を保存しました。', "Saved the hibachi's settings."));
            // The note on show follows its folder to the new name.
            const open = current.current.doc;
            for (const item of renamed) {
              const moved =
                open?.scopeId === next.scopeId
                  ? renamedPath(open.path, item.previous, layerFolder(next, item.layer))
                  : undefined;
              if (moved)
                void host
                  .read(next.scopeId, moved)
                  .then((doc) => show(doc))
                  .catch(report);
            }
            if (renamed.length) bump(next.scopeId);
          }}
        />
      )}
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
            if (running || sending || queuedHere || gitBusy || connecting)
              throw Error(
                t('作業中はノートを整理できません。', "Can't organize notes while busy."),
              );
            if (!(await save())) return null;
            return current.current.doc ?? null;
          }}
          onChanged={(next, notice) => {
            const previous = doc;
            if (next) {
              load(next);
              updateSources((all) =>
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
              updateSources((all) =>
                all.filter((ref) => ref.scopeId !== previous.scopeId || ref.path !== previous.path),
              );
            }
            bump(previous.scopeId);
            if (next && next.scopeId !== previous.scopeId) bump(next.scopeId);
            setStatus(
              notice ??
                (next
                  ? t('ノートの場所を変更しました。', 'The note has moved.')
                  : t('削除しました。', 'Deleted.')),
            );
          }}
        />
      )}
      {schemaOpen && (
        <SchemaDialog
          you={you}
          spaces={hibachiAgent ? workspaceSpaces : []}
          // It shows the shared Schema, the irori agent's and every hibachi's: a change in any of them.
          revision={anyRevision(revisions) + youRevision}
          locked={(scopeId) =>
            connecting ||
            (scopeId === you?.id
              ? yourAiRunning
              : scopeId !== sharedSchemaId &&
                (gitBusy || runningScopes.includes(scopeId) || heldByYou(scopeId)))
          }
          onClose={() => setSchemaOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchPanel
          spaces={spaces.filter((space) => workspace?.scopeIds.includes(space.scopeId))}
          initialScopeId={searchAll ? 'all' : active?.scopeId}
          beforeSearch={save}
          onOpen={async (scopeId, hit, query) => {
            const target = spaces.find(
              (space) => space.scopeId === scopeId && workspace?.scopeIds.includes(space.scopeId),
            );
            if (!target)
              throw Error(
                t('この KB はワークスペースにありません。', "This KB isn't in the workspace."),
              );
            const opened = await open(target, fileEntry(hit.path, 'Knowledge_Base'), {
              query,
              line: hit.line,
              preview: hit.preview,
            });
            if (!opened) throw Error(t('ファイルを開けませんでした。', 'Could not open the file.'));
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {add && (
        <RegisterSpace
          categories={categoryChoices(spaces)}
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
                    throw Error(t('現在のノートが未保存です。', 'The current note is unsaved.'));
                  return cloudNoteTarget
                    ? host.createCloudNote(
                        cloudNoteTarget.scopeId,
                        cloudNoteTarget.directory,
                        noteName,
                      )
                    : host.createNote(active!.scopeId, noteName, noteDirectory);
                })()
                  .then((d) => {
                    show(d);
                    closeNewNote();
                    setNoteName('');
                    bump(d.scopeId);
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
                {t('保存先', 'Destination')}: {cloudNoteTarget.directory}/
              </p>
            ) : (
              <label>
                {t('保存先フォルダー', 'Destination folder')}
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
            if (running || sending || queuedHere || gitBusy || connecting)
              throw Error(
                t('作業中は資料を整理できません。', "Can't organize materials while busy."),
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
            show(next);
            setStatus(notice ?? t('復元しました。', 'Restored.'));
            bump(next.scopeId);
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
