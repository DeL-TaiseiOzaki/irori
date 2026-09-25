import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { AgentAnswers, AgentEvent } from '../domain/types';
import { agentNames } from '../domain/types';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

const host = window.irori;
// A reply is Markdown, but its renderer is the heaviest thing a session that
// never opens the assistant would otherwise load. The reply's own text is the
// fallback, so nothing disappears while that code arrives.
const RenderedMarkdown = lazy(() =>
  import('./AgentMarkdown').then((m) => ({ default: m.AgentMarkdown })),
);
function AgentMarkdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<span>{text}</span>}>
      <RenderedMarkdown text={text} />
    </Suspense>
  );
}

/** The file or command a tool or a request is about, read from its JSON details. */
export function eventTarget(details?: string) {
  if (!details) return '';
  try {
    const value = JSON.parse(details) as Record<string, unknown>;
    const input = (value.input ?? value) as Record<string, unknown>;
    for (const key of [
      'file_path',
      'path',
      'filePath',
      'notebook_path',
      'command',
      'pattern',
      'url',
    ])
      if (typeof input[key] === 'string') return input[key] as string;
    if (Array.isArray(input.changes) && typeof input.changes[0]?.path === 'string')
      return input.changes[0].path as string;
  } catch {
    // Details that are not JSON name nothing more than the event's own text.
  }
  return '';
}

/** A permission or a question from a run, answered here or wherever else it shows. */
export function AgentRequest({
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
    return (
      <div className="request resolved">
        <Icon name="checkCircle" size={13} />
        {done ? t('回答済み', 'Answered') : t('要求は終了しました', 'The request has ended')}
      </div>
    );
  const target = eventTarget(event.details);
  return (
    <div className="request" role="group" aria-label={t('許可の要求', 'Permission request')}>
      <strong className="request-title">
        <Icon name="shield" size={16} />
        {event.text}
      </strong>
      {target && <div className="request-target">{target}</div>}
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
              placeholder={t('複数の回答は1行ずつ入力', 'Enter multiple answers, one per line')}
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
      <details className="request-details">
        <summary>{t('操作の詳細', 'Operation details')}</summary>
        <pre>{event.details}</pre>
      </details>
      <div className="request-actions">
        <button className="panel-button" onClick={() => void reply(false)}>
          {t('拒否', 'Deny')}
        </button>
        <button className="ember-button" onClick={() => void reply(true)}>
          {event.questions ? t('回答する', 'Answer') : t('今回のみ許可', 'Allow this time')}
        </button>
      </div>
    </div>
  );
}

/**
 * A request is over once its run ended or moved on: an answer given in another
 * view is not offered again here.
 */
export function requestEnded(events: AgentEvent[], index: number) {
  const { runId } = events[index];
  return events.slice(index + 1).some((event) => event.runId === runId);
}

function Step({ event, running }: { event: AgentEvent; running: boolean }) {
  const target = eventTarget(event.details);
  return (
    <details className="step">
      <summary>
        <Icon
          name={running ? 'loader' : 'checkCircle'}
          size={15}
          className={running ? 'step-icon running' : 'step-icon'}
        />
        <span className="step-verb">{event.text}</span>
        {target && <span className="step-target">{target}</span>}
      </summary>
      <pre>{event.details}</pre>
    </details>
  );
}

/**
 * One brain's conversation: the person's messages, and for each run the agent's
 * words, its steps as a timeline, its requests and how it ended.
 */
export function AgentLog({
  events,
  activeRun,
  onError,
}: {
  events: AgentEvent[];
  /** The run still in progress, whose latest step is the one being taken. */
  activeRun?: string;
  onError: (e: unknown) => void;
}) {
  const items: ReactNode[] = [];
  let steps: AgentEvent[] = [];
  let labelled = '';
  const flushSteps = (key: string) => {
    if (!steps.length) return;
    const group = steps;
    steps = [];
    items.push(
      <div className="steps" key={`steps-${key}`}>
        {group.map((event, i) => (
          <Step
            key={i}
            event={event}
            running={event.runId === activeRun && event === events.at(-1)}
          />
        ))}
      </div>,
    );
  };
  events.forEach((event, i) => {
    const key = `${event.runId}-${i}`;
    if (event.type !== 'tool') flushSteps(key);
    if (event.role === 'user') {
      labelled = '';
      items.push(
        <div className="message user" key={key}>
          <span>{event.text}</span>
        </div>,
      );
      return;
    }
    // The agent names itself once at the start of each reply.
    if (labelled !== event.runId && event.type !== 'status' && event.type !== 'done') {
      labelled = event.runId;
      items.push(
        <div className="agent-label" key={`label-${key}`}>
          <Icon name="sparkles" size={12} />
          {event.agent ? agentNames[event.agent] : 'AI'}
        </div>,
      );
    }
    if (event.type === 'tool') steps.push(event);
    else if (event.type === 'permission' || event.type === 'question')
      items.push(
        <AgentRequest key={key} event={event} ended={requestEnded(events, i)} onError={onError} />,
      );
    else
      items.push(
        <div className={`message ${event.type}`} key={key}>
          {event.type === 'done' && (
            <Icon name={event.outcome === 'completed' ? 'checkCircle' : 'close'} size={13} />
          )}
          {event.type === 'text' ? <AgentMarkdown text={event.text} /> : <span>{event.text}</span>}
        </div>,
      );
  });
  flushSteps('end');
  return <>{items}</>;
}
