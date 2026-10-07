import type { AgentEvent } from './types';
import { eventKey } from './conversation';
import { t } from './i18n';

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

/** Every request of the list that `requestEnded` would call over, found in one pass from the end. */
export function endedRequests(events: AgentEvent[]) {
  const ended = new Set<AgentEvent>();
  const doneRuns = new Set<string>();
  const resolved = new Set<string>();
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (
      (event.type === 'permission' || event.type === 'question') &&
      (doneRuns.has(event.runId) ||
        (!!event.requestId && resolved.has(`${event.runId}\0${event.requestId}`)))
    )
      ended.add(event);
    if (event.type === 'done') doneRuns.add(event.runId);
    if (event.resolved) resolved.add(`${event.runId}\0${event.resolved}`);
  }
  return ended;
}

export type TaskState = 'working' | 'waiting' | 'reported' | 'failed' | 'stopped';
export function taskStateWords(state: TaskState) {
  return {
    working: t('作業中', 'Working'),
    waiting: t('許可待ち', 'Needs approval'),
    reported: t('完了', 'Done'),
    failed: t('失敗', 'Failed'),
    stopped: t('中断', 'Stopped'),
  }[state];
}
export interface RunTask {
  id: string;
  scopeId: string;
  label: string;
  state: TaskState;
}

/**
 * The hand-offs of one run of your AI, each with its brain, what it was asked
 * and how far it is: a request it waits on, a report, or still working.
 */
export function runTasks(
  events: AgentEvent[],
  runId: string,
  active: boolean,
  ended = endedRequests(events),
): RunTask[] {
  const tasks = new Map<string, { scopeId: string; label: string; state: TaskState }>();
  for (const event of events) {
    const delegate = event.delegate;
    if (event.runId !== runId || !delegate) continue;
    const task = tasks.get(delegate.task);
    if (delegate.state === 'started')
      tasks.set(delegate.task, { scopeId: delegate.scopeId, label: event.text, state: 'working' });
    else if (task && (delegate.state === 'reported' || delegate.state === 'failed'))
      task.state = delegate.state;
    else if (
      task &&
      (event.type === 'permission' || event.type === 'question') &&
      !ended.has(event)
    )
      task.state = 'waiting';
  }
  for (const task of tasks.values())
    if (!active && (task.state === 'working' || task.state === 'waiting')) task.state = 'stopped';
  return [...tasks.entries()].map(([id, task]) => ({ id, ...task }));
}

export interface LogStep {
  key: string;
  event: AgentEvent;
  /** The call's result, when the CLI reported it apart from the call. */
  result?: AgentEvent;
}
/** One thing the log shows, keyed so it keeps its place while the window slides. */
export type LogItem =
  | { kind: 'user'; key: string; event: AgentEvent }
  | { kind: 'label'; key: string; event: AgentEvent }
  | { kind: 'tasks'; key: string; runId: string; tasks: RunTask[] }
  | { kind: 'report'; key: string; event: AgentEvent }
  | { kind: 'steps'; key: string; steps: LogStep[] }
  | { kind: 'request'; key: string; event: AgentEvent; ended: boolean }
  | { kind: 'message'; key: string; event: AgentEvent };

/**
 * The log's items in one pass over the events: the person's messages, each
 * run's label, words, steps as a timeline, requests and end, and your AI's
 * hand-offs as a task list. Lookups that used to run per item — a request's
 * end, a run's tasks, a call's result — are made once for the whole list.
 */
export function logItems(events: AgentEvent[], activeRun?: string): LogItem[] {
  const ended = endedRequests(events);
  const items: LogItem[] = [];
  const listed = new Set<string>();
  const used = new Set<string>();
  // A tool call's later reports (its result, or a CLI's progress updates) join its step.
  const calls = new Map<string, AgentEvent>();
  const results = new Map<AgentEvent, AgentEvent>();
  const joined = new Set<AgentEvent>();
  for (const event of events) {
    if (event.type !== 'tool' || !event.call) continue;
    const key = `${event.runId}:${event.call}`;
    const call = calls.get(key);
    if (!call) {
      if (!event.result) calls.set(key, event);
      continue;
    }
    joined.add(event);
    if (event.result) results.set(call, event);
  }
  let steps: LogStep[] = [];
  const flushSteps = () => {
    if (!steps.length) return;
    items.push({ kind: 'steps', key: `steps-${steps[0].key}`, steps });
    steps = [];
  };
  let labelled = '';
  events.forEach((event, index) => {
    if (event.resolved) return;
    let key = eventKey(event, index);
    // A record repeating an id (two files joined by hand) still gets a key of its own.
    if (used.has(key)) key = `${key}~${index}`;
    used.add(key);
    if (event.type !== 'tool') flushSteps();
    if (event.role === 'user') {
      labelled = '';
      items.push({ kind: 'user', key, event });
      return;
    }
    // The agent names itself once at the start of each reply.
    if (labelled !== event.runId && event.type !== 'status' && event.type !== 'done') {
      labelled = event.runId;
      items.push({ kind: 'label', key: `label-${key}`, event });
    }
    if (event.delegate?.state === 'started') {
      // A run's hand-offs show once, as a list that follows their progress.
      if (!listed.has(event.runId)) {
        listed.add(event.runId);
        items.push({
          kind: 'tasks',
          key: `tasks-${key}`,
          runId: event.runId,
          tasks: runTasks(events, event.runId, event.runId === activeRun, ended),
        });
      }
      return;
    }
    if (event.delegate && event.type === 'status') {
      items.push({ kind: 'report', key, event });
      return;
    }
    if (event.type === 'tool') {
      if (!joined.has(event)) steps.push({ key, event, result: results.get(event) });
    } else if (event.type === 'permission' || event.type === 'question')
      items.push({ kind: 'request', key, event, ended: ended.has(event) });
    else items.push({ kind: 'message', key, event });
  });
  flushSteps();
  return items;
}
