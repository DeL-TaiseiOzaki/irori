import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAnswers, AgentEvent, Question, Space } from '../domain/types';
import { questionsAnswered } from '../domain/questions';
import { MessageAttachments } from './Attachments';
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
import { PathBase } from './path-links';

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

/** What the person chose and wrote for one question, before it is sent. */
interface Draft {
  chosen: string[];
  /** Words of their own, for a question that takes them. */
  own: string;
  /** "Other" is picked among the options, so their words are the answer. */
  other: boolean;
}
const emptyDraft: Draft = { chosen: [], own: '', other: false };
/** The answer each question sends: the labels chosen, and the person's own words. */
function draftAnswers(questions: Question[], drafts: Record<string, Draft>): AgentAnswers {
  return Object.fromEntries(
    questions.map((q) => {
      const draft = drafts[q.id] ?? emptyDraft;
      const own = draft.own.trim();
      // Without options, the words are the answer; with them, only when "Other" is picked.
      const words = !q.options?.length || draft.other ? own : '';
      if (q.multiple) {
        const lines = q.options?.length ? (words ? [words] : []) : words.split('\n');
        return [q.id, [...draft.chosen, ...lines].filter((value) => value.trim())];
      }
      return [q.id, words || draft.chosen[0] || ''];
    }),
  );
}

/** One question: its options with what each means, and a field for the person's own answer. */
function QuestionField({
  question: q,
  number,
  draft,
  onChange,
  onPick,
}: {
  question: Question;
  /** Shown when the request asks more than one question. */
  number?: number;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** A single choice was picked: the request may be answered at once. */
  onPick?: (label: string) => void;
}) {
  const options = q.options ?? [];
  const preview = options.find((o) => o.preview && draft.chosen.includes(o.label))?.preview;
  const ownField = (props: { autoFocus?: boolean }) => {
    const common = {
      'aria-label': options.length ? t(`${q.title}（その他）`, `${q.title} (other)`) : q.title,
      placeholder: options.length
        ? t('自由に入力…', 'Your own answer…')
        : q.multiple
          ? t('1行に1つ', 'One per line')
          : t('回答を入力…', 'Type an answer…'),
      value: draft.own,
      autoFocus: props.autoFocus,
    };
    return q.multiline || (q.multiple && !options.length) ? (
      <textarea
        {...common}
        rows={3}
        onChange={(e) => onChange({ ...draft, own: e.target.value })}
      />
    ) : (
      <input
        {...common}
        type={q.secret ? 'password' : 'text'}
        autoComplete="off"
        onChange={(e) => onChange({ ...draft, own: e.target.value })}
      />
    );
  };
  return (
    <fieldset className="agent-question">
      <legend>
        {number !== undefined && <span className="question-number">{number}</span>}
        {q.header && <span className="question-header">{q.header}</span>}
        <span className="question-title">{q.title}</span>
        {q.optional && <small>{t('任意', 'Optional')}</small>}
      </legend>
      {options.length > 0 && (
        <div
          className={`choices ${q.multiple ? 'multiple' : 'single'}`}
          role={q.multiple ? 'group' : 'radiogroup'}
          aria-label={q.title}
        >
          {options.map((o, index) => {
            const chosen = draft.chosen.includes(o.label);
            return (
              <button
                key={`${index}:${o.label}`}
                type="button"
                className="choice"
                role={q.multiple ? 'checkbox' : 'radio'}
                aria-checked={chosen}
                onClick={() => {
                  if (q.multiple)
                    onChange({
                      ...draft,
                      chosen: chosen
                        ? draft.chosen.filter((v) => v !== o.label)
                        : [...draft.chosen, o.label],
                    });
                  else {
                    onChange({ ...draft, chosen: [o.label], other: false });
                    onPick?.(o.label);
                  }
                }}
              >
                <span className="choice-mark" aria-hidden="true">
                  {chosen && <Icon name="check" size={11} strokeWidth={2.4} />}
                </span>
                <span className="choice-text">
                  <span className="choice-label">{o.label}</span>
                  {o.description && <small className="choice-description">{o.description}</small>}
                </span>
              </button>
            );
          })}
          {q.other && (
            <button
              type="button"
              className="choice"
              role={q.multiple ? 'checkbox' : 'radio'}
              aria-checked={draft.other}
              onClick={() =>
                onChange({
                  ...draft,
                  other: !draft.other || !q.multiple,
                  chosen: q.multiple ? draft.chosen : [],
                })
              }
            >
              <span className="choice-mark" aria-hidden="true">
                {draft.other && <Icon name="check" size={11} strokeWidth={2.4} />}
              </span>
              <span className="choice-text">
                <span className="choice-label">{t('その他', 'Other')}</span>
                <small className="choice-description">
                  {t('自分の言葉で答える', 'Answer in your own words')}
                </small>
              </span>
            </button>
          )}
        </div>
      )}
      {preview && <pre className="choice-preview">{preview}</pre>}
      {(!options.length || (q.other && draft.other)) && ownField({ autoFocus: draft.other })}
    </fieldset>
  );
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const questions = event.questions;
  async function reply(allow: boolean, answers?: AgentAnswers) {
    if (sending) return;
    setSending(true);
    try {
      await host.respond(event.requestId!, allow, answers);
      setDone(true);
    } catch (e) {
      onError(e);
    } finally {
      setSending(false);
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
  const answers = questions ? draftAnswers(questions, drafts) : undefined;
  // One question with one choice to make is answered by making it, as in Claude Code.
  const quick =
    questions?.length === 1 &&
    !questions[0].multiple &&
    !!questions[0].options?.length &&
    !questions[0].options.some((o) => o.preview);
  return (
    <div
      className={`request ${questions ? 'question' : ''}`}
      role="group"
      aria-label={
        questions
          ? t('エージェントからの質問', 'Question from the agent')
          : t('許可の要求', 'Permission request')
      }
    >
      {brain && (
        <span className="request-brain">
          <BrainTile space={brain} size={16} radius={5} />
          {t(`${brain.name} agent から`, `From the ${brain.name} agent`)}
        </span>
      )}
      <strong className="request-title">
        <Icon name={questions ? 'question' : 'shield'} size={16} />
        {event.text}
      </strong>
      {target && <div className="request-target">{target}</div>}
      {questions?.map((q, index) => (
        <QuestionField
          key={q.id}
          question={q}
          number={questions.length > 1 ? index + 1 : undefined}
          draft={drafts[q.id] ?? emptyDraft}
          onChange={(draft) => setDrafts((all) => ({ ...all, [q.id]: draft }))}
          onPick={quick ? (label) => void reply(true, { [q.id]: label }) : undefined}
        />
      ))}
      <details className="request-details">
        <summary>{t('操作の詳細', 'Operation details')}</summary>
        <pre>{event.details}</pre>
      </details>
      <div className="request-actions">
        <button className="panel-button" disabled={sending} onClick={() => void reply(false)}>
          {questions ? t('回答しない', 'Decline') : t('拒否', 'Deny')}
        </button>
        {(!quick || Object.values(drafts).some((draft) => draft.other)) && (
          <button
            className="ember-button"
            disabled={sending || (!!questions && !questionsAnswered(questions, answers!))}
            onClick={() => void reply(true, answers)}
          >
            {questions ? t('回答する', 'Answer') : t('今回のみ許可', 'Allow this time')}
          </button>
        )}
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
    <ul className="task-list" aria-label={t('vault への依頼', 'Hand-offs to vaults')}>
      {tasks.map((task) => {
        const brain = brains.find((space) => space.scopeId === task.scopeId);
        return (
          <li key={task.id} className={`task ${task.state}`}>
            {brain && <BrainTile space={brain} size={22} radius={7} />}
            <span className="task-text">
              <small>{brain ? `${brain.name} agent` : t('vault agent', 'A vault agent')}</small>
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
          ? t(`${brain.name} agent から`, `From the ${brain.name} agent`)
          : t('報告', 'Report')}
      </span>
      <PathBase.Provider value={event.delegate?.scopeId}>
        <AgentMarkdown text={event.text} />
      </PathBase.Provider>
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
  // Which group each step was shown in, so a group outlives its first step.
  const groups = useRef(new Map<string, string>());
  const items = useMemo(() => logItems(events, activeRun, groups.current), [events, activeRun]);
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
                <MessageAttachments attachments={item.event.attachments} />
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
