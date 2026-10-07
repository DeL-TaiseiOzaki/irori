import { useEffect, useRef, useState } from 'react';
import { agentIds, agentNames, type AgentAccess, type AgentId, type Space } from '../domain/types';
import { agentAccessLabel, agentAccessOptions } from '../domain/agent-access';
import type { YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import { AgentLog } from './AgentLog';
import { runTasks } from '../domain/agent-log';
import { Icon } from './Icon';
import type { BrainAi } from './useBrainAi';
import { ModelPicker } from './ModelPicker';
import { ConversationHistory } from './ConversationHistory';
import { promptLimit, type ConversationSummary } from '../domain/conversation';

/** The latest run of a conversation, and whether it is still going. */
export function latestRun(ai: BrainAi) {
  const last = ai.events.at(-1);
  return last ? { runId: last.runId, active: ai.running } : undefined;
}

/** Your AI's hand-offs still under way, for the map's lines. */
export function openTasks(ai: BrainAi) {
  const run = latestRun(ai);
  return run && run.active
    ? runTasks(ai.events, run.runId, true).filter(
        (task) => task.state === 'working' || task.state === 'waiting',
      )
    : [];
}

/**
 * Your AI beside the Overview: set it up once, then talk to it; it hands work
 * to each brain's sub-agent, and the hand-offs and reports show in its log.
 */
export function YourAiPanel({
  you,
  brains,
  ai,
  agent,
  model,
  access,
  onAgent,
  onModel,
  onAccess,
  seed,
  conversationId,
  onOpenConversation,
  onDeletedConversation,
  onNew,
  onCreate,
  onShow,
  onSend,
  onStop,
  onError,
}: {
  you?: YourAi;
  brains: Space[];
  ai: BrainAi;
  /** The CLI your AI runs on; each hands a brain's work to its hibachi agent. */
  agent: AgentId;
  /** '' for the CLI's default. */
  model: string;
  /** Full access by default where the CLI offers it, as for a hibachi agent. */
  access: AgentAccess;
  onAgent: (agent: AgentId) => void;
  onModel: (model: string) => void;
  onAccess: (access: AgentAccess) => void;
  /** Words to put in the message box, for the person to finish; each new `key` places them. */
  seed?: { text: string; key: number };
  /** The conversation on show (ADR 017 D4): the irori agent's own, never a hibachi's. */
  conversationId?: string;
  onOpenConversation: (row: ConversationSummary) => void;
  onDeletedConversation: (id: string) => void;
  /** Starts an empty conversation on the same CLI. */
  onNew: () => Promise<void>;
  onCreate: () => Promise<void>;
  /** Opens the Your AI screen: its folder and the brains' sub-agent definitions. */
  onShow: () => void;
  onSend: (prompt: string) => Promise<void>;
  /** Stops the run of the conversation on show; the irori agent's others go on. */
  onStop: (conversationId?: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Placed words replace an empty box or follow what is there, with the caret after them.
  useEffect(() => {
    if (!seed) return;
    setText((value) => (value.trim() ? `${value.trimEnd()}\n${seed.text}` : seed.text));
    requestAnimationFrame(() => {
      const field = box.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }, [seed?.key]);
  // The latest words, hand-offs and reports stay in view.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [ai.events.length, ai.events.at(-1)?.text]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!you) return <p className="hint your-ai-loading">{t('読み込み中…', 'Loading…')}</p>;
  if (you.state === 'missing')
    return (
      <div className="your-ai-setup">
        <span className="overview-orb large" aria-hidden="true">
          <Icon name="sparkles" size={24} strokeWidth={2} />
        </span>
        <h2>{t('irori agent', 'irori agent')}</h2>
        <p className="mono your-ai-path">{you.root}</p>
        <button className="ember-button" disabled={busy} onClick={() => void act(onCreate)}>
          <Icon name="sparkles" size={14} />
          {t('irori agent を用意する', 'Set up the irori agent')}
        </button>
      </div>
    );
  const run = latestRun(ai);
  const behind = ai.running || ai.queued.length > 0;
  const send = async () => {
    if (!text.trim() || busy) return;
    if (await act(() => onSend(text))) setText('');
  };
  return (
    <>
      <header className="overview-ai-head your-ai-head">
        <span className="overview-orb" aria-hidden="true">
          <Icon name="sparkles" size={15} strokeWidth={2.1} />
        </span>
        <span className="your-ai-title">
          <strong>{t('irori agent', 'irori agent')}</strong>
          <button className="your-ai-schema" onClick={onShow}>
            {t(`${agentNames[agent]} · あなたの Schema`, `${agentNames[agent]} · your Schema`)}
          </button>
        </span>
        <span className="overview-space" />
        <button
          className="icon-button"
          aria-label={t('新しい会話', 'New conversation')}
          title={t('新しい会話', 'New conversation')}
          disabled={busy}
          onClick={() => {
            setHistory(false);
            void act(onNew);
          }}
        >
          <Icon name="squarePen" size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={t('履歴', 'History')}
          title={t('履歴', 'History')}
          aria-pressed={history}
          onClick={() => setHistory((value) => !value)}
        >
          <Icon name="history" size={15} />
        </button>
        {ai.running && (
          <button
            className="panel-button"
            disabled={busy}
            onClick={() => void act(() => onStop(ai.id))}
            aria-label={t('irori agent を停止', 'Stop the irori agent')}
          >
            <Icon name="close" size={13} />
            {t('停止', 'Stop')}
          </button>
        )}
        {ai.running && (
          <span className="agent-progress" aria-hidden="true">
            <span />
          </span>
        )}
      </header>
      {history && (
        <ConversationHistory
          scopeId={you.id}
          current={conversationId}
          onOpen={(row) => {
            setHistory(false);
            onOpenConversation(row);
          }}
          onDeleted={onDeletedConversation}
          onError={onError}
        />
      )}
      <div
        hidden={history}
        className="conversation your-ai-log"
        role="log"
        aria-label={t('irori agent との会話', 'Conversation with the irori agent')}
        aria-live="polite"
        ref={log}
      >
        {ai.error && (
          <p className="hint" role="alert">
            {ai.error}
          </p>
        )}
        <AgentLog
          events={ai.events}
          activeRun={run?.active ? run.runId : undefined}
          brains={brains}
          onError={onError}
        />
      </div>
      <form
        className="overview-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <span className="context-chip your-ai-scope">
          <Icon name="map" size={12} />
          {t(`すべての hibachi（${brains.length}）`, `All hibachis (${brains.length})`)}
        </span>
        {ai.queued.length > 0 && (
          <small className="your-ai-queued">
            <Icon name="clock" size={12} />
            {t(`送信待ち ${ai.queued.length}`, `${ai.queued.length} pending`)}
          </small>
        )}
        <textarea
          ref={box}
          aria-label={t('irori agent への指示', 'Instruction for the irori agent')}
          placeholder={t('指示…', 'Instruction…')}
          rows={3}
          value={text}
          maxLength={promptLimit}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <footer>
          <span className="composer-selects your-ai-selects">
            <label className="composer-pill">
              <Icon name="sparkles" size={12} />
              <select
                aria-label={t('irori agent の CLI', "The irori agent's CLI")}
                value={agent}
                disabled={busy}
                onChange={(event) => onAgent(event.target.value as AgentId)}
              >
                {agentIds.map((id) => (
                  <option key={id} value={id}>
                    {agentNames[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="composer-pill">
              <Icon name="shield" size={12} />
              <select
                aria-label={t('irori agent のアクセス', "The irori agent's access")}
                value={access}
                disabled={busy || agentAccessOptions(agent).length === 1}
                onChange={(event) => onAccess(event.target.value as AgentAccess)}
              >
                {agentAccessOptions(agent).map((value) => (
                  <option key={value} value={value}>
                    {agentAccessLabel(agent, value)}
                  </option>
                ))}
              </select>
            </label>
            <ModelPicker agent={agent} value={model} disabled={busy} onChange={onModel} />
          </span>
          <button
            type="submit"
            className="ember-button"
            disabled={!text.trim() || busy}
            aria-label={behind ? t('送信待ちに追加', 'Add to queue') : t('送信', 'Send')}
            title={behind ? t('送信待ちに追加', 'Add to queue') : t('送信', 'Send')}
          >
            <Icon name={behind ? 'clock' : 'up'} size={15} strokeWidth={2.2} />
          </button>
        </footer>
      </form>
    </>
  );
}
