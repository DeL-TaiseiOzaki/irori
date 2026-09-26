import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { AgentAnswers, AgentEvent, Space } from '../domain/types';
import { agentNames } from '../domain/types';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { BrainTile } from './BrainTile';

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
  brain,
  onError,
}: {
  event: AgentEvent;
  ended: boolean;
  /** The brain whose sub-agent asks, when your AI handed work to it. */
  brain?: Space;
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
      {brain && (
        <span className="request-brain">
          <BrainTile space={brain} size={16} radius={5} />
          {t(`${brain.name} の AI から`, `From ${brain.name}'s AI`)}
        </span>
      )}
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
 * A request is over once it was answered — here or in another view — or
 * declined, or its run ended. Other events of the run say nothing: a sub-agent
 * of another brain works on meanwhile, and the message announcing a tool call
 * can arrive after the request it raised.
 */
export function requestEnded(events: AgentEvent[], index: number) {
  const { runId, requestId } = events[index];
  return events
    .slice(index + 1)
    .some(
      (event) =>
        event.runId === runId &&
        (event.type === 'done' || (!!requestId && event.resolved === requestId)),
    );
}

function Step({
  event,
  running,
  brain,
}: {
  event: AgentEvent;
  running: boolean;
  /** The brain a sub-agent's step works in. */
  brain?: Space;
}) {
  const target = eventTarget(event.details);
  return (
    <details className="step">
      <summary>
        <Icon
          name={running ? 'loader' : 'checkCircle'}
          size={15}
          className={running ? 'step-icon running' : 'step-icon'}
        />
        {brain && <BrainTile space={brain} size={14} radius={4} className="step-brain" />}
        <span className="step-verb">{event.text}</span>
        {target && <span className="step-target">{target}</span>}
      </summary>
      <pre>{event.details}</pre>
    </details>
  );
}

export type TaskState = 'working' | 'waiting' | 'reported' | 'failed' | 'stopped';

/**
 * The hand-offs of one run of your AI, each with its brain, what it was asked
 * and how far it is: a request it waits on, a report, or still working.
 */
export function runTasks(events: AgentEvent[], runId: string, active: boolean) {
  const tasks = new Map<string, { scopeId: string; label: string; state: TaskState }>();
  events.forEach((event, index) => {
    const delegate = event.delegate;
    if (event.runId !== runId || !delegate) return;
    const task = tasks.get(delegate.task);
    if (delegate.state === 'started')
      tasks.set(delegate.task, { scopeId: delegate.scopeId, label: event.text, state: 'working' });
    else if (task && (delegate.state === 'reported' || delegate.state === 'failed'))
      task.state = delegate.state;
    else if (
      task &&
      (event.type === 'permission' || event.type === 'question') &&
      !requestEnded(events, index)
    )
      task.state = 'waiting';
  });
  for (const task of tasks.values())
    if (!active && (task.state === 'working' || task.state === 'waiting')) task.state = 'stopped';
  return [...tasks.entries()].map(([id, task]) => ({ id, ...task }));
}

export function taskStateWords(state: TaskState) {
  return {
    working: t('作業中', 'Working'),
    waiting: t('許可待ち', 'Needs approval'),
    reported: t('完了', 'Done'),
    failed: t('失敗', 'Failed'),
    stopped: t('中断', 'Stopped'),
  }[state];
}

function TaskList({ tasks, brains }: { tasks: ReturnType<typeof runTasks>; brains: Space[] }) {
  return (
    <ul className="task-list" aria-label={t('Brain への依頼', 'Hand-offs to brains')}>
      {tasks.map((task) => {
        const brain = brains.find((space) => space.scopeId === task.scopeId);
        return (
          <li key={task.id} className={`task ${task.state}`}>
            {brain && <BrainTile space={brain} size={22} radius={7} />}
            <span className="task-text">
              <small>
                {brain
                  ? t(`${brain.name} の AI`, `${brain.name}'s AI`)
                  : t('Brain の AI', 'A brain')}
              </small>
              <span>{task.label}</span>
            </span>
            <span className={`task-state ${task.state}`}>
              {task.state === 'working' ? (
                <Icon name="loader" size={12} className="spin" />
              ) : task.state === 'reported' ? (
                <Icon name="check" size={12} />
              ) : (
                <i />
              )}
              {taskStateWords(task.state)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One brain's conversation: the person's messages, and for each run the agent's
 * words, its steps as a timeline, its requests and how it ended. Your AI's
 * conversation also shows each run's hand-offs as a task list, and the brains'
 * reports.
 */
export function AgentLog({
  events,
  activeRun,
  brains = [],
  onError,
}: {
  events: AgentEvent[];
  /** The run still in progress, whose latest step is the one being taken. */
  activeRun?: string;
  /** The brains your AI hands work to, for their names and tiles. */
  brains?: Space[];
  onError: (e: unknown) => void;
}) {
  const brainOf = (event: AgentEvent) =>
    event.delegate ? brains.find((space) => space.scopeId === event.delegate!.scopeId) : undefined;
  const listed = new Set<string>();
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
            brain={brainOf(event)}
            running={event.runId === activeRun && event === events.at(-1)}
          />
        ))}
      </div>,
    );
  };
  events.forEach((event, i) => {
    if (event.resolved) return;
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
    if (event.delegate?.state === 'started') {
      // A run's hand-offs show once, as a list that follows their progress.
      if (!listed.has(event.runId)) {
        listed.add(event.runId);
        items.push(
          <TaskList
            key={`tasks-${key}`}
            tasks={runTasks(events, event.runId, event.runId === activeRun)}
            brains={brains}
          />,
        );
      }
      return;
    }
    if (event.delegate && event.type === 'status') {
      const brain = brainOf(event);
      items.push(
        <div className={`message report ${event.delegate.state}`} key={key}>
          <span className="report-from">
            {brain && <BrainTile space={brain} size={16} radius={5} />}
            {brain ? t(`${brain.name} の AI から`, `From ${brain.name}'s AI`) : t('報告', 'Report')}
          </span>
          <AgentMarkdown text={event.text} />
        </div>,
      );
      return;
    }
    if (event.type === 'tool') steps.push(event);
    else if (event.type === 'permission' || event.type === 'question')
      items.push(
        <AgentRequest
          key={key}
          event={event}
          ended={requestEnded(events, i)}
          brain={brainOf(event)}
          onError={onError}
        />,
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
