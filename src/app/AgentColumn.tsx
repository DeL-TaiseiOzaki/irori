import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import {
  agentIds,
  agentNames,
  type AgentAccess,
  type AgentEvent,
  type AgentId,
  type AgentInfo,
  type Document,
  type Space,
} from '../domain/types';
import type { SourceRef } from '../domain/knowledge';
import type { YourAi } from '../domain/you';
import {
  appendConversationEvents,
  isDamaged,
  mergeHeldEvents,
  promptLimit,
  trimConversation,
  withRequests,
  type QueuedMessage,
} from '../domain/conversation';
import { agentAccessLabel, agentAccessOptions } from '../domain/agent-access';
import { retirementNotice, type AgentSkill } from '../domain/skills';
import { t } from '../domain/i18n';
import { useDraft } from './useDraft';
import { useLanguage } from './useLanguage';
import { useResource } from './useResource';
import { AgentLog } from './AgentLog';
import { BrainTile } from './BrainTile';
import { ConversationHistory } from './ConversationHistory';
import { Icon } from './Icon';
import { ModelPicker } from './ModelPicker';
import { SkillPicker } from './SkillPicker';
import { errorText } from './ErrorMessage';

const host = window.irori;

/** Whose conversations a dock column shows: the hibachi on show's agent, or the irori agent. */
export type ColumnOwner = 'hibachi' | 'irori';
/** One column of the agent dock (ADR 021). The first, `main`, stays while the dock is open. */
export interface DockColumn {
  id: string;
  owner: ColumnOwner;
}
/** A conversation open in a column's tabs, with its CLI. */
export type Tab = { id: string; agent: AgentId };

/** What every column of the dock reads from the window around it. */
export interface DockShared {
  infos: AgentInfo[];
  spaces: Space[];
  /** The note open on the stage, which goes with a hibachi agent's instruction. */
  doc?: Document;
  docLayer?: string;
  /** Lines the person wrote in the open note. */
  personLineCount: number;
  gitBusy: boolean;
  connecting: boolean;
  /** The open note changed on disk and waits for the person to settle it. */
  external: boolean;
  runningConversations: Set<string>;
  conversationWaiting: (id: string) => boolean;
  /** Conversations whose next queued instruction is on its way, shared by every column. */
  draining: RefObject<Set<string>>;
  save: () => Promise<boolean>;
  launch: (
    scopeId: string,
    conversationId: string | undefined,
    send: () => Promise<string | null>,
  ) => Promise<string | null>;
  addRun: (runId: string, scopeId: string, conversationId?: string) => void;
  resetRequests: (scopeId: string, runId: string, requests?: AgentEvent[]) => void;
  /** Marks a conversation as on show, so the window leaves its queue to the column. */
  display: (conversationId: string) => () => void;
  report: (error: unknown) => void;
  /** Read the conversation again: back from the Overview, which may have changed it. */
  reload: number;
  /** A queue changed outside the column; `resume` also lets a paused one go on. */
  queueSignal: { n: number; scopeId?: string; resume: boolean };
  /** An owner's conversation list changed (a run began or ended), counted per owner. */
  tabRevisions: Record<string, number>;
  /** The brain's islands are off show (the Overview, routines or the irori agent's Schema is). */
  hidden: boolean;
}

/**
 * One column of the agent dock: a conversation of the hibachi on show or of the
 * irori agent, with its tabs, history, log and composer. Columns run side by
 * side as Claudian's panes do (ADR 020, ADR 021).
 */
export function AgentColumn({
  column,
  number,
  shared,
  space,
  you,
  brains,
  target,
  tabs,
  agent,
  model,
  access,
  skills,
  skillsRetired,
  skillProblems,
  instructionFile,
  sources,
  ownerChoice,
  stage,
  onModel,
  onAccess,
  onAgent,
  onPick,
  onShow,
  onCloseTab,
  onNew,
  onDeleted,
  onSources,
  onOwner,
  onSplit,
  onClose,
  onStatus,
  onCreateYou,
  onStarted,
}: {
  column: DockColumn;
  /** 1 for the first column; later columns keep their own composer drafts. */
  number: number;
  shared: DockShared;
  /** A hibachi column's hibachi: the one on show. */
  space?: Space;
  /** An irori column's agent, once its record is read. */
  you?: YourAi;
  /** The hibachis an irori column hands to its agent: the workspace's. */
  brains: string[];
  /** The conversation on show, once picked. */
  target?: Tab;
  tabs: Tab[];
  agent: AgentId;
  model?: string;
  access: AgentAccess;
  skills: AgentSkill[];
  skillsRetired: Parameters<typeof retirementNotice>[0][];
  skillProblems: { directory: string }[];
  instructionFile?: string;
  /** Files sent as references with the next instruction (a hibachi column's). */
  sources: SourceRef[];
  /** The hibachi agent is on, so the column may show either agent. */
  ownerChoice: boolean;
  /** The first column hides and shows the stage beside the dock. */
  stage?: { hidden: boolean; onToggle: () => void };
  onModel: (model: string) => void;
  onAccess: (access: AgentAccess) => void;
  /** Another CLI is another conversation; `replace` lets an empty one on show give way. */
  onAgent: (agent: AgentId, replace: boolean) => void;
  /** No conversation is on show yet: the host's pick (or a new one) becomes it. */
  onPick: (tab: Tab) => void;
  onShow: (tab: Tab, replace: boolean) => void;
  onCloseTab: (id: string) => void;
  onNew: (replace: boolean) => Promise<void>;
  onDeleted: (id: string) => void;
  onSources: (update: (all: SourceRef[]) => SourceRef[]) => void;
  onOwner: (owner: ColumnOwner) => void;
  onSplit: () => void;
  onClose: () => void;
  /** What the window needs to know: a send under way, and the queue's length. */
  onStatus: (status: { sending: boolean; queued: number }) => void;
  onCreateYou: () => Promise<void>;
  /** An irori column's run began with these hibachis handed to it. */
  onStarted?: (brains: string[]) => void;
}) {
  // The column sits behind a memo boundary, so it follows the language itself.
  useLanguage();
  const irori = column.owner === 'irori';
  const scopeId = irori ? you?.id : space?.scopeId;
  const ready = irori ? you?.state === 'ready' : !!space;
  const {
    infos,
    spaces,
    doc,
    docLayer,
    gitBusy,
    connecting,
    runningConversations,
    draining,
    report,
  } = shared;
  // A hibachi column's draft is kept on the device; the irori agent's lives with the column.
  const draft = useDraft(
    !irori && space
      ? {
          scopeId: space.scopeId,
          kind: 'composer',
          agent,
          ...(number > 1 ? { column: number } : {}),
        }
      : null,
    space?.root,
  );
  const [localText, setLocalText] = useState('');
  const composer = irori
    ? {
        text: localText,
        ready: true,
        pending: false,
        error: '',
        flush: async () => true,
        clear: async (_revision?: string) => {
          setLocalText('');
          return true;
        },
        retry: async () => true,
        snapshot: () => ({ text: localText, record: null as { revision?: string } | null }),
      }
    : draft;
  const prompt = composer.text;
  function setPrompt(value: string) {
    if (irori) setLocalText(value);
    else draft.setText(value);
  }
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  // The conversation's own queue: it waits for that conversation's run alone.
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [conversationError, setConversationError] = useState('');
  // Events kept in the conversation but not sent to the view, and lines that could not be read.
  const [omitted, setOmitted] = useState({ earlier: 0, damaged: 0 });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  // The events on show, as the effect below alone changes them, and those that
  // arrived since they were last shown. The log takes a batch per frame.
  const view = useRef<AgentEvent[]>([]);
  const pending = useRef<AgentEvent[]>([]);
  const flushPending = useRef<() => void>(() => {});
  const hiddenNow = useRef(shared.hidden);
  hiddenNow.current = shared.hidden;
  const [skill, setSkill] = useState('');
  const [personLines, setPersonLines] = useState(false);
  // The open note the person took out of this column's context, as `scopeId:path`.
  const [noteOmitted, setNoteOmitted] = useState('');
  const runningNow = useRef(runningConversations);
  runningNow.current = runningConversations;
  const targetNow = useRef(target);
  targetNow.current = target;
  const shownRunning = !!target && runningConversations.has(target.id);
  const shownWaiting = !!target && shared.conversationWaiting(target.id);
  // Nothing has been said in the conversation on show: a new one can take its place.
  const shownBlank = conversationReady && !events.length && !queued.length && !shownRunning;
  const rows = useResource(() => host.agentConversations(scopeId!), [scopeId], {
    enabled: !!scopeId && ready,
    refresh: scopeId ? (shared.tabRevisions[scopeId] ?? 0) : 0,
  });
  const agentInfo = infos.find((info) => info.id === agent);
  const noteKey = doc ? `${doc.scopeId}:${doc.path}` : '';
  // The open note of this hibachi goes with each instruction unless the person removed it.
  const noteInContext =
    !irori && !!doc && doc.scopeId === space?.scopeId && noteOmitted !== noteKey;
  const personLinesOffered = shared.personLineCount > 0 && noteInContext;
  const referenced =
    !!doc && sources.some((ref) => ref.scopeId === doc.scopeId && ref.path === doc.path);
  const conversation = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onStatus({ sending, queued: queued.length });
  }, [sending, queued.length]);
  useEffect(() => () => onStatus({ sending: false, queued: 0 }), []);
  // A skill choice belongs to one hibachi, even when another declares the same name.
  useEffect(() => setSkill(''), [scopeId]);
  useEffect(() => {
    if (skill && !skills.some((item) => item.name === skill)) setSkill('');
  }, [skill, skills]);
  useEffect(() => {
    if (followConversation.current && conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [events]);
  useEffect(() => {
    if (target) return shared.display(target.id);
  }, [target?.id]);
  // Back on show, the column takes in what arrived while the islands were hidden.
  useEffect(() => {
    if (!shared.hidden) flushPending.current();
  }, [shared.hidden]);

  // The conversation on show: read it, and follow its events.
  useEffect(() => {
    let current = true;
    // The snapshot is on its way: events are held until it lands.
    let reading = true;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (next: AgentEvent[], dropped: number) => {
      view.current = next;
      setEvents(next);
      if (dropped) setOmitted((value) => ({ ...value, earlier: value.earlier + dropped }));
    };
    const flush = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = timer = undefined;
      if (!current || reading || !pending.current.length) return;
      const batch = pending.current;
      pending.current = [];
      const { events: next, dropped } = trimConversation(
        appendConversationEvents(view.current, batch),
      );
      show(next, dropped);
    };
    // One state update per frame while the log is on show; nothing while the islands or
    // the window are hidden, where the batch waits to be taken in on return. A window
    // without frames (throttled in the background) still shows the batch within a moment.
    const schedule = () => {
      if (frame !== undefined || reading || hiddenNow.current || document.hidden) return;
      frame = requestAnimationFrame(flush);
      timer = setTimeout(flush, 250);
    };
    const shown = () => {
      if (!document.hidden) flush();
    };
    view.current = [];
    pending.current = [];
    setEvents([]);
    setQueued([]);
    setQueuePaused(true);
    setConversationReady(false);
    setConversationError('');
    setOmitted({ earlier: 0, damaged: 0 });
    if (scopeId && ready)
      void (async () => {
        if (!target) {
          // The first column shows the host's pick; a later one starts a conversation of its own.
          const value =
            column.id === 'main' ? await host.agentConversation(scopeId, agent) : undefined;
          const id = value?.id ?? (await host.createConversation(scopeId, agent));
          if (current) onPick({ id, agent: value?.summary?.agent ?? agent });
          return;
        }
        const value = await host.agentConversation(scopeId, target.agent, target.id);
        if (!current) return;
        // Events held while the snapshot was read join it, less what it already holds:
        // the host reads the history and then its native record before replying, so
        // some of them are in the snapshot and some arrived after its history was read.
        const held = pending.current;
        pending.current = [];
        reading = false;
        const { events: next, dropped } = trimConversation(
          mergeHeldEvents(withRequests(value), held),
        );
        view.current = next;
        setEvents(next);
        setQueued(value.queued);
        // Only the conversation holding the run knows the requests it waits on.
        if (value.activeRunId) {
          shared.addRun(value.activeRunId, scopeId, target.id);
          shared.resetRequests(scopeId, value.activeRunId, value.requests);
        }
        // Work queued behind the conversation's run goes on when it ends; a queue left
        // without one (after a failure or a restart) waits for the person to resume it.
        setQueuePaused(!value.activeRunId && !runningNow.current.has(target.id));
        setOmitted({ earlier: value.earlier + dropped, damaged: value.damaged });
        setConversationReady(true);
      })().catch((error) => {
        if (current) setConversationError(errorText(error));
      });
    if (!target) return;
    const id = target.id;
    flushPending.current = flush;
    document.addEventListener('visibilitychange', shown);
    const stop = host.onEvent((event) => {
      if (event.type !== 'agent' || event.event.conversationId !== id) return;
      const incoming = event.event;
      // Fragments join in the batch, which stays within the window however long it waits.
      pending.current = trimConversation(
        appendConversationEvents(pending.current, [incoming]),
      ).events;
      schedule();
      // A run that failed or was stopped pauses the queue at once, hidden or not.
      if (incoming.type === 'done' && incoming.outcome !== 'completed') setQueuePaused(true);
    });
    return () => {
      current = false;
      stop();
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', shown);
      flushPending.current = () => {};
    };
  }, [scopeId, ready, target?.id, shared.reload, retry]);

  /** Reads the queue again after a queued instruction started, leaving the log as it is. */
  async function refreshQueue() {
    if (!scopeId || !target) return;
    const id = target.id;
    const value = await host.agentConversation(scopeId, target.agent, id);
    if (targetNow.current?.id === id) setQueued(value.queued);
  }
  // The Overview resumed or added to this owner's queues.
  useEffect(() => {
    const signal = shared.queueSignal;
    if (!signal.n || signal.scopeId !== scopeId || !conversationReady) return;
    void refreshQueue()
      .then(() => {
        if (signal.resume) setQueuePaused(false);
      })
      .catch(report);
  }, [shared.queueSignal.n]);

  function request(message: string) {
    const common = {
      scopeId: scopeId!,
      agent,
      conversationId: target?.id,
      access,
      model,
      prompt: message,
    };
    if (irori) return { ...common, brains };
    return {
      ...common,
      notePath: noteInContext ? doc!.path : undefined,
      sources,
      skill: skill || undefined,
      personLines: (personLines && personLinesOffered) || undefined,
    };
  }
  async function start() {
    if (
      !scopeId ||
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
      if (!(await shared.save())) return;
      const input = request(message);
      // Behind this conversation's run or its queue; its other conversations run beside it (ADR 020).
      if (shownRunning || queued.length) setQueued(await host.queueAgentMessage(input));
      else {
        setQueuePaused(false);
        followConversation.current = true;
        if (irori) onStarted?.(brains);
        await shared.launch(scopeId, target?.id, () => host.start(input));
      }
      if (!(await composer.clear(draftRevision)))
        report(t('指示は送信済みです。', 'The instruction was sent.'));
    } catch (error) {
      report(error);
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  useEffect(() => {
    if (
      !scopeId ||
      !target ||
      !conversationReady ||
      shownRunning ||
      sending ||
      gitBusy ||
      queuePaused ||
      shared.external ||
      !queued.length ||
      submitting.current ||
      draining.current.has(target.id)
    )
      return;
    const conversationId = target.id;
    submitting.current = true;
    draining.current.add(conversationId);
    setSending(true);
    void (async () => {
      if (!(await shared.save())) {
        setQueuePaused(true);
        return;
      }
      try {
        followConversation.current = true;
        await shared.launch(scopeId, conversationId, () =>
          host.startNextQueued(scopeId, conversationId),
        );
        await refreshQueue();
      } catch (error) {
        setQueuePaused(true);
        report(error);
      }
    })().finally(() => {
      submitting.current = false;
      draining.current.delete(conversationId);
      setSending(false);
    });
  }, [
    conversationReady,
    shownRunning,
    sending,
    queued.length,
    queuePaused,
    shared.external,
    gitBusy,
  ]);

  // The hibachis an irori column's log names; the same list across renders keeps the log as it is.
  const handedSpaces = useMemo(
    () => (irori ? spaces.filter((item) => brains.includes(item.scopeId)) : undefined),
    [irori, spaces, brains],
  );
  const kind = irori ? 'irori agent' : 'hibachi agent';
  const ownerName = irori
    ? 'irori agent'
    : space
      ? t(`${space.name} の hibachi agent`, `${space.name}'s hibachi agent`)
      : 'hibachi agent';
  const mark = irori ? (
    <span className="agent-mark irori">
      <span className="overview-orb" aria-hidden="true">
        <Icon name="sparkles" size={13} strokeWidth={2.1} />
      </span>
    </span>
  ) : (
    space && (
      <span className="agent-mark">
        <BrainTile space={space} size={26} radius={8} />
        <span className="agent-sparkle">
          <Icon name="sparkles" size={10} strokeWidth={2.2} />
        </span>
      </span>
    )
  );
  const stageLabel = stage?.hidden
    ? t('本文を表示', 'Show the page')
    : t('本文を隠す', 'Hide the page');
  return (
    <aside className={`agent-panel chrome ${irori ? 'irori-column' : ''}`} aria-label={ownerName}>
      <header className="agent-header">
        {ownerChoice ? (
          <Menu.Root modal={false}>
            <Menu.Trigger
              className="agent-owner"
              aria-label={t(`表示するエージェント: ${kind}`, `Agent shown: ${kind}`)}
              title={ownerName}
              disabled={sending}
            >
              {mark}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                <Menu.Popup className="menu">
                  <Menu.RadioGroup
                    value={column.owner}
                    onValueChange={(value) => {
                      if (value === column.owner) return;
                      void composer.flush().then((saved) => {
                        if (saved) onOwner(value as ColumnOwner);
                      });
                    }}
                  >
                    {(['hibachi', 'irori'] as const).map((owner) => (
                      <Menu.RadioItem key={owner} value={owner} closeOnClick>
                        <Icon name="sparkles" size={14} />
                        {owner === 'hibachi' ? 'hibachi agent' : 'irori agent'}
                        <Menu.RadioItemIndicator className="menu-check">
                          <Icon name="check" size={14} />
                        </Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : (
          mark
        )}
        <label className="agent-picker">
          <select
            aria-label={t('エージェント', 'Agent')}
            value={agent}
            disabled={sending || gitBusy || !conversationReady}
            onChange={(e) => {
              const next = e.target.value as AgentId;
              if (next === agent) return;
              void composer.flush().then((saved) => {
                if (saved) onAgent(next, shownBlank);
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
        {(shownRunning || shownWaiting || queued.length > 0) && (
          <span className={`agent-state ${shownWaiting ? 'waiting' : ''}`} role="status">
            <i />
            {shownWaiting
              ? t('許可待ち', 'Needs approval')
              : shownRunning
                ? t('実行中', 'Running')
                : t(`送信待ち ${queued.length}`, `${queued.length} pending`)}
          </span>
        )}
        <span className="agent-header-space" />
        <button
          className="icon-button"
          aria-label={t('新しい会話', 'New conversation')}
          title={t('新しい会話', 'New conversation')}
          disabled={!ready || sending}
          onClick={() => {
            setHistoryOpen(false);
            void onNew(shownBlank)
              .then(() => textarea.current?.focus())
              .catch(report);
          }}
        >
          <Icon name="squarePen" size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={t('履歴', 'History')}
          title={t('履歴', 'History')}
          aria-pressed={historyOpen}
          disabled={!ready}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          <Icon name="history" size={16} />
        </button>
        <Popover.Root>
          <Popover.Trigger
            className="icon-button agent-settings"
            aria-label={t('会話と接続', 'Conversation and connection')}
            title={t('会話と接続', 'Conversation and connection')}
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
                  <Popover.Close className="icon-button" aria-label={t('閉じる', 'Close')}>
                    <Icon name="close" />
                  </Popover.Close>
                </div>
                <p>
                  {agentNames[agent]}{' '}
                  <span>{agentInfo?.version || t('CLIを確認中', 'Checking the CLI')}</span>
                </p>
                {agentInfo?.available === false && <p role="alert">{agentInfo.detail}</p>}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <button
          className="icon-button"
          aria-label={t('列を追加', 'Add a column')}
          title={t('列を追加', 'Add a column')}
          onClick={onSplit}
        >
          <Icon name="split" size={16} />
        </button>
        {stage && (
          <button
            className="icon-button"
            aria-pressed={stage.hidden}
            aria-label={stageLabel}
            title={stageLabel}
            onClick={stage.onToggle}
          >
            <Icon name={stage.hidden ? 'stageShow' : 'stageHide'} size={16} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={
            column.id === 'main'
              ? t(`${kind} を閉じる`, `Close ${kind}`)
              : t('この列を閉じる', 'Close this column')
          }
          onClick={() => {
            void composer.flush().then((saved) => {
              if (saved) onClose();
            });
          }}
        >
          <Icon name="close" size={16} />
        </button>
        {shownRunning && (
          <span className="agent-progress" aria-hidden="true">
            <span />
          </span>
        )}
      </header>
      {ready && tabs.length > 1 && (
        <div
          className="conversation-tabs"
          role="tablist"
          aria-label={t('開いている会話', 'Open conversations')}
        >
          {tabs.map((tab) => {
            const row = rows.data?.find((item) => item.id === tab.id);
            const title = row && !isDamaged(row) ? row.title : t('新しい会話', 'New conversation');
            const state = shared.conversationWaiting(tab.id)
              ? 'waiting'
              : runningConversations.has(tab.id)
                ? 'running'
                : '';
            const current = tab.id === target?.id;
            return (
              <div key={tab.id} className={`conversation-tab ${current ? 'current' : ''} ${state}`}>
                <button
                  role="tab"
                  aria-selected={current}
                  title={`${title} · ${agentNames[tab.agent]}`}
                  disabled={sending}
                  onClick={() => {
                    if (current) return;
                    void composer.flush().then((saved) => {
                      if (!saved) return;
                      setHistoryOpen(false);
                      onShow(tab, false);
                    });
                  }}
                >
                  {state && (
                    <i
                      role="img"
                      aria-label={
                        state === 'waiting'
                          ? t('許可待ち', 'Needs approval')
                          : t('実行中', 'Running')
                      }
                    />
                  )}
                  <span>{title}</span>
                </button>
                {!state && (
                  <button
                    className="conversation-tab-close"
                    aria-label={t(`${title} のタブを閉じる`, `Close the ${title} tab`)}
                    disabled={sending}
                    onClick={() => onCloseTab(tab.id)}
                  >
                    <Icon name="close" size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!irori && space && (
        <div className="schema-line">
          <Icon name="schema" size={13} />
          <span className="schema-owner">
            {t(`${space.name} の Schema`, `${space.name}'s Schema`)}
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
      {irori && !you && <p className="hint">{t('読み込み中…', 'Loading…')}</p>}
      {irori && you?.state === 'missing' && (
        <div className="your-ai-setup">
          <p className="mono your-ai-path">{you.root}</p>
          <button
            className="ember-button"
            disabled={sending}
            onClick={() => {
              setSending(true);
              void onCreateYou()
                .catch(report)
                .finally(() => setSending(false));
            }}
          >
            <Icon name="sparkles" size={14} />
            {t('irori agent を用意する', 'Set up the irori agent')}
          </button>
        </div>
      )}
      {!irori && !space && (
        <p className="hint">
          {t('このワークスペースに hibachi がありません。', 'This workspace has no hibachi yet.')}
        </p>
      )}
      {agentInfo?.available === false && (
        <p className="agent-connection-error" role="alert">
          {t(
            'CLI が見つかりません（インストールとログインを確認）。',
            'The CLI was not found; check the installation and login.',
          )}
        </p>
      )}
      {ready && !conversationReady && (
        <div className="hint" role="status">
          {conversationError ||
            t('保存した会話を読み込んでいます…', 'Loading the saved conversation…')}
          {conversationError && (
            <button onClick={() => setRetry((value) => value + 1)}>{t('再試行', 'Retry')}</button>
          )}
        </div>
      )}
      {!historyOpen && omitted.earlier > 0 && (
        <div className="hint">
          {t(`以前の ${omitted.earlier} 件を省略`, `${omitted.earlier} earlier events omitted`)}
        </div>
      )}
      {!historyOpen && omitted.damaged > 0 && (
        <div className="hint" role="alert">
          {t(`読み込めない行 ${omitted.damaged}`, `${omitted.damaged} unreadable lines`)}
        </div>
      )}
      {historyOpen && scopeId && (
        <ConversationHistory
          key={scopeId}
          scopeId={scopeId}
          current={target?.id}
          note={!irori && doc?.scopeId === scopeId ? doc.path : undefined}
          onOpen={(row) => {
            setHistoryOpen(false);
            // An empty conversation on show gives way rather than keeping a tab.
            onShow({ id: row.id, agent: row.agent }, shownBlank);
          }}
          onDeleted={onDeleted}
          onError={report}
        />
      )}
      <div
        hidden={historyOpen}
        className="conversation"
        role="log"
        aria-label={
          irori
            ? t('irori agent との会話', 'Conversation with the irori agent')
            : t('会話', 'Conversation')
        }
        aria-live="polite"
        ref={conversation}
        onScroll={() => {
          const element = conversation.current!;
          followConversation.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {events.length === 0 && !irori && space && (
          <div className="agent-empty">
            <p>{t('ノートについて相談する', 'Ask about the note')}</p>
            <div className="prompt-suggestions">
              {[
                t('このノートの要点をまとめて', 'Summarize the key points of this note'),
                t(
                  'この内容から次のアクションを整理して',
                  'Work out the next actions from this content',
                ),
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  disabled={!doc || shownRunning}
                  onClick={() => {
                    setPrompt(suggestion);
                    textarea.current?.focus();
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
          activeRun={shownRunning ? events.at(-1)?.runId : undefined}
          brains={handedSpaces}
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
            {queuePaused && <p>{t('送信待ちを保存しています。', 'Pending sends saved.')}</p>}
            {queued.map((item) => (
              <div key={item.id}>
                <span>{item.prompt}</span>
                <small>{agentAccessLabel(agent, item.access)}</small>
                <button
                  disabled={sending}
                  aria-label={t(`送信待ち ${item.id} を削除`, `Remove pending send ${item.id}`)}
                  onClick={() => {
                    setSending(true);
                    void host
                      .removeQueuedMessage(target!.id, item.id)
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
                disabled={shownRunning || sending || !conversationReady}
                onClick={() => setQueuePaused(false)}
              >
                {t('送信を再開', 'Resume sending')}
              </button>
            )}
          </div>
        )}
        <div className="composer-box">
          <div className="composer-context" aria-label={t('相談の対象', 'Ask about')}>
            {irori ? (
              <span className="context-chip">
                <Icon name="sparkles" size={12} />
                {t(
                  `hibachi ${brains.length}`,
                  `${brains.length} hibachi${brains.length === 1 ? '' : 's'}`,
                )}
              </span>
            ) : (
              <span className="context-chip">
                {space ? (
                  <BrainTile space={space} size={16} radius={5} />
                ) : (
                  <Icon name="folder" size={12} />
                )}
                {space?.name ?? t('スペース未選択', 'No space selected')}
              </span>
            )}
            {noteInContext && (
              <span className="context-chip">
                <Icon
                  name={
                    docLayer === 'contents' ? 'cloud' : docLayer === 'schema' ? 'schema' : 'book'
                  }
                  size={13}
                  className={`layer-icon ${docLayer ?? ''}`}
                />
                <span className="context-chip-label">{doc!.path.split('/').at(-1)}</span>
                <button
                  aria-label={t(
                    `${doc!.path} を相談の対象から外す`,
                    `Remove ${doc!.path} from the context`,
                  )}
                  disabled={sending}
                  onClick={() => setNoteOmitted(noteKey)}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            )}
            {!irori && !!doc && doc.scopeId === space?.scopeId && !noteInContext && (
              <button
                className="context-add"
                aria-label={t(
                  `${doc.path} を相談の対象に戻す`,
                  `Put ${doc.path} back in the context`,
                )}
                disabled={sending}
                onClick={() => setNoteOmitted('')}
              >
                <Icon name="plus" size={13} />
                {doc.path.split('/').at(-1)}
              </button>
            )}
            {!irori &&
              sources.map((source) => {
                const owner = spaces.find((item) => item.scopeId === source.scopeId);
                return (
                  <span className="context-chip reference" key={`${source.scopeId}:${source.path}`}>
                    {owner ? (
                      <BrainTile space={owner} size={16} radius={5} />
                    ) : (
                      <Icon name="cloud" size={12} />
                    )}
                    <span className="context-chip-label">{source.path}</span>
                    <button
                      aria-label={t(
                        `${source.path} を参照から外す`,
                        `Remove ${source.path} from references`,
                      )}
                      onClick={() => onSources((all) => all.filter((ref) => ref !== source))}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                );
              })}
            {!irori && (
              <button
                className="context-add"
                aria-label={t('参照に追加', 'Add as reference')}
                disabled={!doc || sources.length >= 20 || referenced}
                onClick={() => {
                  if (!doc) return;
                  void shared.save().then((saved) => {
                    if (saved)
                      onSources((all) => [...all, { scopeId: doc.scopeId, path: doc.path }]);
                  });
                }}
              >
                <Icon name="plus" size={13} />
                {t('参照', 'Reference')}
              </button>
            )}
          </div>
          <textarea
            ref={textarea}
            aria-label={
              irori
                ? t('irori agent への指示', 'Instruction for the irori agent')
                : t('エージェントへの指示', 'Instruction to the agent')
            }
            placeholder={
              irori
                ? t('irori agent に指示…', 'Instruct the irori agent…')
                : t('ノートについて相談、編集を依頼…', 'Ask about the note, request an edit…')
            }
            value={prompt}
            rows={3}
            disabled={!ready || !composer.ready || sending}
            maxLength={promptLimit}
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
              {!irori && space && (skills.length > 0 || skillsRetired.length > 0) && (
                <SkillPicker
                  key={space.scopeId}
                  scopeId={space.scopeId}
                  skills={skills}
                  value={skill}
                  onChange={setSkill}
                  disabled={sending || gitBusy}
                />
              )}
              <label className="composer-pill">
                <Icon name="shield" size={13} />
                <select
                  aria-label={t('エージェントのアクセス', 'Agent access')}
                  value={access}
                  disabled={sending || gitBusy || agentAccessOptions(agent).length === 1}
                  onChange={(e) => onAccess(e.target.value as AgentAccess)}
                >
                  {agentAccessOptions(agent).map((value) => (
                    <option key={value} value={value}>
                      {agentAccessLabel(agent, value)}
                    </option>
                  ))}
                </select>
              </label>
              <ModelPicker
                agent={agent}
                value={model ?? ''}
                disabled={sending || gitBusy}
                onChange={onModel}
              />
              {personLinesOffered && (
                <label className={`composer-pill toggle ${personLines ? 'pressed' : ''}`}>
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
              {shownRunning && (
                <button
                  className="icon-button stop"
                  aria-label={t('停止', 'Stop')}
                  title={t('停止', 'Stop')}
                  onClick={() => {
                    setQueuePaused(true);
                    // This conversation's run alone; the owner's others go on.
                    void host.cancel(scopeId!, target?.id).catch(report);
                  }}
                >
                  <span className="stop-mark" />
                </button>
              )}
              <button
                className="send-button"
                aria-label={
                  shownRunning || queued.length > 0
                    ? t('送信待ちに追加', 'Add to pending sends')
                    : t('送信', 'Send')
                }
                title={
                  shownRunning || queued.length > 0
                    ? t('送信待ちに追加', 'Add to pending sends')
                    : t('送信', 'Send')
                }
                disabled={
                  !ready ||
                  !conversationReady ||
                  !composer.ready ||
                  !!composer.error ||
                  sending ||
                  gitBusy ||
                  connecting ||
                  !prompt.trim() ||
                  shared.external ||
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
            <button onClick={() => void composer.retry()}>{t('再試行', 'Retry')}</button>
          </div>
        ) : (
          <small className="muted" role="status">
            {!composer.ready
              ? t('下書きを読み込み中…', 'Loading the draft…')
              : composer.pending
                ? t('下書きを保存中…', 'Saving the draft…')
                : prompt && !irori
                  ? t('下書き保存済み', 'Draft saved')
                  : ''}
          </small>
        )}
        {!irori && skillProblems.length > 0 && (
          <small className="muted" role="status">
            {t(
              `読み込めないスキル: ${skillProblems.map((p) => p.directory).join('、')}`,
              `Skills that failed to load: ${skillProblems.map((p) => p.directory).join(', ')}`,
            )}
          </small>
        )}
        {!irori &&
          skillsRetired.map((s) => (
            <small key={s.name} className="muted" role="status">
              {retirementNotice(s)}
            </small>
          ))}
      </div>
    </aside>
  );
}
