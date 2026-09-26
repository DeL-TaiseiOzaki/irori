import { useEffect, useRef, useState } from 'react';
import type { Space } from '../domain/types';
import type { YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import { AgentLog, runTasks } from './AgentLog';
import { Icon } from './Icon';
import type { BrainAi } from './useBrainAi';

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
  onCreate,
  onShow,
  onSend,
  onStop,
  onError,
}: {
  you?: YourAi;
  brains: Space[];
  ai: BrainAi;
  onCreate: () => Promise<void>;
  /** Opens the Your AI screen: its folder and the brains' sub-agent definitions. */
  onShow: () => void;
  onSend: (prompt: string) => Promise<void>;
  onStop: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
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
        <h2>{t('あなたの AI', 'Your AI')}</h2>
        <p>
          {t(
            'あなた専用のエージェントです。Brain ごとのサブエージェントに仕事を渡し、報告をまとめます。Claude Code で動きます。',
            'Your own agent. It hands work to a sub-agent for each brain and gathers their reports. It runs on Claude Code.',
          )}
        </p>
        <p className="mono your-ai-path" title={you.root}>
          {you.root}
        </p>
        <button className="ember-button" disabled={busy} onClick={() => void act(onCreate)}>
          <Icon name="sparkles" size={14} />
          {t('あなたの AI を用意する', 'Set up your AI')}
        </button>
        <small className="hint">
          {t(
            'このフォルダに AGENTS.md と brain-agents スキルを書きます。既存のファイルは上書きしません。',
            'Writes AGENTS.md and the brain-agents skill into this folder. Existing files are never overwritten.',
          )}
        </small>
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
        <span>
          <strong>{t('あなたの AI', 'Your AI')}</strong>
          <button className="your-ai-schema" onClick={onShow}>
            {t('Claude Code · あなたの Schema', 'Claude Code · your Schema')}
          </button>
        </span>
        <span className="overview-space" />
        {ai.running && (
          <button
            className="panel-button"
            disabled={busy}
            onClick={() => void act(onStop)}
            aria-label={t('あなたの AI を停止', 'Stop your AI')}
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
      <div
        className="conversation your-ai-log"
        role="log"
        aria-label={t('あなたの AI との会話', 'Conversation with your AI')}
        aria-live="polite"
        ref={log}
      >
        {ai.error && (
          <p className="hint" role="alert">
            {ai.error}
          </p>
        )}
        {!ai.events.length && (
          <div className="agent-empty">
            <p>
              {t(
                'Brain をまたぐ仕事を頼めます。あなたの AI が Brain ごとに分けて渡します。',
                'Ask for work across your brains. Your AI splits it and hands each part to a brain.',
              )}
            </p>
          </div>
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
          {t(`全体（${brains.length} Brain）`, `Overview (${brains.length} brains)`)}
        </span>
        {ai.queued.length > 0 && (
          <small className="your-ai-queued">
            <Icon name="clock" size={12} />
            {t(`送信待ち ${ai.queued.length}`, `${ai.queued.length} pending`)}
          </small>
        )}
        <textarea
          aria-label={t('あなたの AI への指示', 'Instruction for your AI')}
          placeholder={t('あなたの AI に指示…', 'Instruct your AI…')}
          rows={3}
          value={text}
          maxLength={32000}
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
          <small>
            <Icon name="sparkles" size={12} />
            Claude Code
          </small>
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
