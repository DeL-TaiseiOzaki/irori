import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAnswers, AgentEvent, Space } from '../domain/types';
import { agentNames } from '../domain/types';
import {
  eventTarget,
  logItems,
  taskStateWords,
  type LogStep,
  type RunTask,
} from '../domain/agent-log';
import { t } from '../domain/i18n';
import { Icon } from './Icon';
import { BrainTile } from './BrainTile';
import { useLanguage } from './useLanguage';

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

/** How long a reply still arriving may show its last parsed text before it is parsed again. */
const streamingParseInterval = 150;

/**
 * A reply still being streamed is parsed a few times a second rather than at
 * every fragment; once it has settled, its text renders exactly as it stands.
 */
function StreamingMarkdown({ text, live }: { text: string; live: boolean }) {
  const [shown, setShown] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!live || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setShown(latest.current);
    }, streamingParseInterval);
  }, [text, live]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <AgentMarkdown text={live ? shown : text} />;
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
        {done ? t('回答済み', 'Answered') : t('終了', 'Ended')}
      </div>
    );
  const target = eventTarget(event.details);
  return (
    <div className="request" role="group" aria-label={t('許可の要求', 'Permission request')}>
      {brain && (
        <span className="request-brain">
          <BrainTile space={brain} size={16} radius={5} />
          {t(`${brain.name} の hibachi agent から`, `From ${brain.name}'s hibachi agent`)}
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
              placeholder={t('1行ずつ入力', 'One per line')}
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

// The log's parts are memoised: a fragment of the reply still arriving changes
// one message, and the hundreds before it keep their rendered form. Each reads
// the language itself, since a language change reaches it through no prop.
const Step = memo(function Step({
  event,
  result,
  running,
  brain,
}: {
  event: AgentEvent;
  /** The call's result, when the CLI reported it apart from the call. */
  result?: AgentEvent;
  running: boolean;
  /** The brain a sub-agent's step works in. */
  brain?: Space;
}) {
  useLanguage();
  const target = useMemo(() => eventTarget(event.details), [event.details]);
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
      {result && (
        <>
          <small className="step-result">
            {result.cut
              ? t(
                  `結果（保存は先頭 1 MiB / ${(result.cut / 1048576).toFixed(1)} MiB）`,
                  `Result (first 1 MiB of ${(result.cut / 1048576).toFixed(1)} MiB kept)`,
                )
              : t('結果', 'Result')}
          </small>
          <pre>{result.details}</pre>
        </>
      )}
    </details>
  );
});

const Steps = memo(function Steps({
  steps,
  running,
  brains,
}: {
  steps: LogStep[];
  /** The step among these being taken now, if any. */
  running?: AgentEvent;
  brains: Space[];
}) {
  return (
    <div className="steps">
      {steps.map(({ key, event, result }) => (
        <Step
          key={key}
          event={event}
          result={result}
          brain={brainOf(brains, event)}
          running={event === running}
        />
      ))}
    </div>
  );
});

const TaskList = memo(function TaskList({ tasks, brains }: { tasks: RunTask[]; brains: Space[] }) {
  useLanguage();
  return (
    <ul className="task-list" aria-label={t('hibachi への依頼', 'Hand-offs to hibachis')}>
      {tasks.map((task) => {
        const brain = brains.find((space) => space.scopeId === task.scopeId);
        return (
          <li key={task.id} className={`task ${task.state}`}>
            {brain && <BrainTile space={brain} size={22} radius={7} />}
            <span className="task-text">
              <small>
                {brain
                  ? t(`${brain.name} の hibachi agent`, `${brain.name}'s hibachi agent`)
                  : t('hibachi agent', 'A hibachi agent')}
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
});

const Report = memo(function Report({ event, brain }: { event: AgentEvent; brain?: Space }) {
  useLanguage();
  return (
    <div className={`message report ${event.delegate?.state ?? ''}`}>
      <span className="report-from">
        {brain && <BrainTile space={brain} size={16} radius={5} />}
        {brain
          ? t(`${brain.name} の hibachi agent から`, `From ${brain.name}'s hibachi agent`)
          : t('報告', 'Report')}
      </span>
      <AgentMarkdown text={event.text} />
    </div>
  );
});

const Message = memo(function Message({ event, live }: { event: AgentEvent; live: boolean }) {
  return (
    <div className={`message ${event.type}`}>
      {event.type === 'done' && (
        <Icon name={event.outcome === 'completed' ? 'checkCircle' : 'close'} size={13} />
      )}
      {event.type === 'text' ? (
        <StreamingMarkdown text={event.text} live={live} />
      ) : (
        <span>{event.text}</span>
      )}
    </div>
  );
});

const none: Space[] = [];
function brainOf(brains: Space[], event: AgentEvent) {
  return event.delegate
    ? brains.find((space) => space.scopeId === event.delegate!.scopeId)
    : undefined;
}

/**
 * One brain's conversation: the person's messages, and for each run the agent's
 * words, its steps as a timeline, its requests and how it ended. Your AI's
 * conversation also shows each run's hand-offs as a task list, and the brains'
 * reports. Items are keyed by their events, so the log keeps its nodes — and the
 * details the person opened — as new events arrive and the oldest leave.
 */
export const AgentLog = memo(function AgentLog({
  events,
  activeRun,
  brains = none,
  onError,
}: {
  events: AgentEvent[];
  /** The run still in progress, whose latest step is the one being taken. */
  activeRun?: string;
  /** The brains your AI hands work to, for their names and tiles. */
  brains?: Space[];
  onError: (e: unknown) => void;
}) {
  useLanguage();
  const items = useMemo(() => logItems(events, activeRun), [events, activeRun]);
  const last = events.at(-1);
  // The newest event of the run in progress: a step being taken, or a reply still arriving.
  const current = last && activeRun && last.runId === activeRun ? last : undefined;
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <div className="message user" key={item.key}>
                <span>{item.event.text}</span>
              </div>
            );
          case 'label':
            return (
              <div className="agent-label" key={item.key}>
                <Icon name="sparkles" size={12} />
                {item.event.agent ? agentNames[item.event.agent] : 'AI'}
              </div>
            );
          case 'tasks':
            return <TaskList key={item.key} tasks={item.tasks} brains={brains} />;
          case 'report':
            return <Report key={item.key} event={item.event} brain={brainOf(brains, item.event)} />;
          case 'steps':
            return (
              <Steps
                key={item.key}
                steps={item.steps}
                running={
                  current?.type === 'tool' && item.steps.some((step) => step.event === current)
                    ? current
                    : undefined
                }
                brains={brains}
              />
            );
          case 'request':
            return (
              <AgentRequest
                key={item.key}
                event={item.event}
                ended={item.ended}
                brain={brainOf(brains, item.event)}
                onError={onError}
              />
            );
          case 'message':
            return (
              <Message
                key={item.key}
                event={item.event}
                live={item.event.type === 'text' && item.event === current}
              />
            );
        }
      })}
    </>
  );
});
