import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Space } from '../domain/types';
import { agentNames } from '../domain/types';
import type { YourAi } from '../domain/you';
import { t } from '../domain/i18n';
import {
  routineKey,
  stepLabel,
  type Routine,
  type RoutineReviewFile,
  type RoutineRun,
  type RoutineRunState,
  type RoutineRuntime,
  type RoutineStep,
  type RoutineStepRun,
  type RunRoutine,
} from '../domain/routines';
import { AgentRequest } from './AgentLog';
import { RoutineEditor, type EditorTarget } from './RoutineEditor';
import { SecretDialog, SecretsDialog } from './RoutineKeys';
import { BrainTile } from './BrainTile';
import { Dialog } from './Dialog';
import { errorText } from './ErrorMessage';
import { hostEvents } from './host-events';
import { Icon } from './Icon';
import { chooseRoutineRuntimes, currentRoutineRuntimes } from './device-settings';
import { openRequest, useBrainAi } from './useBrainAi';
import { useAction } from './useAction';
import { useResource } from './useResource';
import { shortWhen as when } from './display';
import './routines.css';

const host = window.irori;
type Conversation = NonNullable<RoutineStepRun['conversation']>;

const runWords: Record<RoutineRunState, () => string> = {
  running: () => t('実行中', 'Running'),
  succeeded: () => t('成功', 'Succeeded'),
  nothing: () => t('対象なし', 'Nothing to do'),
  failed: () => t('失敗', 'Failed'),
  stopped: () => t('停止', 'Stopped'),
  unknown: () => t('不明', 'Unknown'),
};
const stepWords: Record<RoutineStepRun['state'], () => string> = {
  pending: () => t('未実行', 'Not run'),
  waiting: () => t('待機中', 'Waiting'),
  running: () => t('実行中', 'Running'),
  succeeded: () => t('成功', 'Succeeded'),
  failed: () => t('失敗', 'Failed'),
  stopped: () => t('停止', 'Stopped'),
  unknown: () => t('不明', 'Unknown'),
};

/** An agent step's vaults, access and CLI, as written in `routine.yaml`. */
function agentMeta(step: RoutineStep) {
  if (step.kind !== 'agent') return '';
  const vaults =
    step.vaults === 'all' ? t('すべての vault', 'all vaults') : step.vaults?.join(', ');
  return [
    vaults,
    step.cli && agentNames[step.cli],
    step.access === 'full-access' ? t('フルアクセス', 'Full access') : t('標準', 'Standard'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The request a running agent step waits on, answered here as in its conversation. */
function StepRequest({
  conversation,
  onError,
}: {
  conversation: Conversation;
  onError: (error: unknown) => void;
}) {
  const ai = useBrainAi(conversation.scopeId, conversation.agent, 0, conversation.conversationId);
  const request = openRequest(ai);
  if (!request || request.runId !== conversation.runId) return null;
  return <AgentRequest key={request.requestId} event={request} ended={false} onError={onError} />;
}

function Step({
  index,
  definition,
  record,
  onOpenConversation,
  onError,
}: {
  index: number;
  definition?: RoutineStep;
  record?: RoutineStepRun;
  onOpenConversation: (conversation: Conversation) => void;
  onError: (error: unknown) => void;
}) {
  const kind = record?.kind ?? definition?.kind ?? 'run';
  const label = record?.label ?? (definition ? stepLabel(definition) : '');
  const meta = definition?.kind === kind ? agentMeta(definition) : '';
  const state = record?.state;
  return (
    <li className={`routine-step ${state ?? ''}`}>
      <div className="routine-step-head">
        <span className="routine-step-number">{index + 1}</span>
        <Icon
          name={kind === 'agent' ? 'sparkles' : 'terminal'}
          size={13}
          className={kind === 'agent' ? 'routine-step-agent' : undefined}
        />
        <span className="routine-step-label">
          <span className={kind === 'run' ? 'mono' : undefined}>{label}</span>
          {meta && <small>{meta}</small>}
        </span>
        {state && (
          <span className={`routine-state ${state}`}>
            {(state === 'running' || state === 'waiting') && (
              <Icon name="loader" size={12} className="spin" />
            )}
            {stepWords[state]()}
          </span>
        )}
        {record?.conversation && (
          <button className="routine-link" onClick={() => onOpenConversation(record.conversation!)}>
            {t('会話', 'Conversation')}
          </button>
        )}
      </div>
      {record?.detail && <p className="routine-step-detail">{record.detail}</p>}
      {record?.conversation && state === 'running' && (
        <StepRequest conversation={record.conversation} onError={onError} />
      )}
      {record?.output && (
        <details className="routine-output">
          <summary>{kind === 'agent' ? t('報告', 'Report') : t('出力', 'Output')}</summary>
          <pre tabIndex={0}>
            {record.truncated ? '…\n' : ''}
            {record.output}
          </pre>
        </details>
      )}
    </li>
  );
}

/** A routine opened: its steps as the shown run left them, what changed, and earlier runs. */
function RoutineDetail({
  routine,
  live,
  onOpenConversation,
  onError,
}: {
  routine: Routine;
  live?: RoutineRun;
  onOpenConversation: (conversation: Conversation) => void;
  onError: (error: unknown) => void;
}) {
  const key = routineKey(routine.ref);
  // Earlier runs are read again when the live one ends.
  const runs = useResource(() => host.routineRuns(routine.ref), [key], {
    refresh: live?.endedAt ? Date.parse(live.endedAt) : 0,
  });
  const [picked, setPicked] = useState<string>();
  useEffect(() => setPicked(undefined), [live?.id]);
  const history = runs.data ?? [];
  const chosen = picked ? history.find((run) => run.id === picked) : undefined;
  const current = (chosen && live?.id === chosen.id ? live : chosen) ?? live ?? history[0];
  const count = current?.steps.length ?? routine.steps.length;
  const changed = current?.changes.reduce((sum, item) => sum + item.paths.length, 0) ?? 0;
  return (
    <div className="routine-detail">
      <p className="routine-path mono">{routine.path}</p>
      <ol className="routine-steps">
        {Array.from({ length: count }, (_, index) => (
          <Step
            key={index}
            index={index}
            definition={routine.steps[index]}
            record={current?.steps[index]}
            onOpenConversation={onOpenConversation}
            onError={onError}
          />
        ))}
      </ol>
      {current?.detail && (
        <p className="routine-problem" role="alert">
          {current.detail}
        </p>
      )}
      {changed > 0 && (
        <details className="routine-changes">
          <summary>{t(`変更 ${changed} 件`, `${changed} changed`)}</summary>
          {current!.changes.map((item) => (
            <div key={item.scopeId}>
              <strong>{item.name}</strong>
              <ul>
                {item.paths.map((file) => (
                  <li key={file} className="mono">
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      {history.length > 1 && (
        <div className="routine-history" role="group" aria-label={t('履歴', 'History')}>
          {history.map((run) => (
            <button
              key={run.id}
              aria-pressed={run.id === current?.id}
              onClick={() => setPicked(run.id)}
            >
              <time dateTime={run.startedAt}>{when(run.startedAt)}</time>
              <span className={`routine-state ${run.state}`}>{runWords[run.state]()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewFile({ file, compared }: { file: RoutineReviewFile; compared: boolean }) {
  const status = {
    added: t('追加', 'Added'),
    changed: t('変更', 'Changed'),
    removed: t('削除', 'Removed'),
    same: t('変更なし', 'Unchanged'),
  }[file.status];
  return (
    <section className={`review-file ${file.status}`} aria-label={file.path}>
      <header>
        <span className="mono">{file.path}</span>
        {compared && <small>{status}</small>}
      </header>
      {file.diff ? (
        <pre className="review-diff" tabIndex={0}>
          {file.diff.map((line, index) => (
            <span
              key={index}
              className={
                line.kind === '+'
                  ? 'add'
                  : line.kind === '-'
                    ? 'del'
                    : line.kind === '…'
                      ? 'gap'
                      : ''
              }
            >
              {line.kind === '…' ? '…' : `${line.kind} ${line.text}`}
              {'\n'}
            </span>
          ))}
        </pre>
      ) : file.text !== undefined ? (
        <pre tabIndex={0}>{file.text}</pre>
      ) : (
        file.opaque && (
          <p className="review-opaque">
            {t(`テキストではありません · ${file.size} バイト`, `Not text · ${file.size} bytes`)}
          </p>
        )
      )}
    </section>
  );
}

/** The files as they are now, with what changed since the last review; the run follows the confirmation (D4). */
function ReviewDialog({
  routine,
  onCancel,
  onConfirm,
}: {
  routine: Routine;
  onCancel: () => void;
  onConfirm: (digest: string) => Promise<void>;
}) {
  const review = useResource(() => host.reviewRoutine(routine.ref), [routineKey(routine.ref)]);
  const { busy, error, run } = useAction();
  const data = review.data;
  // Rendered at the document's root, like the other sheets, not inside irori mode's chrome.
  return createPortal(
    <Dialog label={t('ルーティンの確認', 'Review the routine')} busy={busy} onClose={onCancel}>
      <div className="modal routine-review">
        <h2>{routine.name}</h2>
        <p className="routine-path mono">{routine.path}</p>
        <p>
          {t(
            'このルーティンは、あなたの権限でプログラムとエージェントを動かします。',
            'This routine runs programs and agents with your permissions.',
          )}
        </p>
        {!!data?.secrets.length && (
          <p className="review-secrets">
            {t('受け取るシークレット', 'Secrets it receives')}:{' '}
            <span className="mono">{data.secrets.join(', ')}</span>
          </p>
        )}
        {review.loading && <p role="status">{t('読み込み中…', 'Loading…')}</p>}
        {(review.error || data?.problem || error) && (
          <p className="routine-problem" role="alert">
            {error || review.error || data?.problem}
          </p>
        )}
        <div className="review-files">
          {data?.files
            .filter((file) => file.status !== 'same')
            .map((file) => (
              <ReviewFile key={file.path} file={file} compared={data.confirmedBefore} />
            ))}
          {data?.files.some((file) => file.status === 'same') && (
            <p className="review-same">
              {t('変更なし', 'Unchanged')}:{' '}
              <span className="mono">
                {data.files
                  .filter((file) => file.status === 'same')
                  .map((file) => file.path)
                  .join(', ')}
              </span>
            </p>
          )}
        </div>
        <div className="actions">
          <button disabled={busy} onClick={onCancel}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button
            className="primary"
            disabled={busy || !data || !!data.problem}
            onClick={() => void run(() => onConfirm(data!.digest))}
          >
            {t('確認して実行', 'Confirm and run')}
          </button>
        </div>
      </div>
    </Dialog>,
    document.body,
  );
}

function RoutineCard({
  routine,
  live,
  open,
  error,
  onToggle,
  onRun,
  onStop,
  onAddRuntime,
  onEnterSecret,
  onEdit,
  onOpenConversation,
  onError,
}: {
  routine: Routine;
  live?: RoutineRun;
  open: boolean;
  error?: string;
  onToggle: () => void;
  onRun: () => void;
  onStop: () => void;
  onAddRuntime: (runtime: RoutineRuntime) => Promise<unknown>;
  onEnterSecret: (name: string) => void;
  onEdit: () => void;
  onOpenConversation: (conversation: Conversation) => void;
  onError: (error: unknown) => void;
}) {
  const running = live?.state === 'running' || (!!routine.running && !live);
  const last = live ?? routine.last;
  // Python is downloaded, which can take a while; the button waits with it.
  const adding = useAction();
  return (
    <article className={`routine ${running ? 'running' : ''}`} aria-label={routine.name}>
      <header className="routine-head">
        <button className="routine-toggle" aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
          <strong>{routine.name}</strong>
        </button>
        {routine.problem ? (
          <span className="routine-state invalid">{t('無効', 'Invalid')}</span>
        ) : routine.review !== 'reviewed' ? (
          <span className="routine-state review">
            {routine.review === 'changed' ? t('変更あり', 'Changed') : t('未確認', 'Not reviewed')}
          </span>
        ) : null}
        {last && (
          <span className={`routine-state ${last.state}`}>
            {last.state === 'running' && <Icon name="loader" size={12} className="spin" />}
            {runWords[last.state]()}
            <time dateTime={last.startedAt}>{when(last.startedAt)}</time>
          </span>
        )}
        <span className="routine-space" />
        <button
          className="icon-button"
          aria-label={t(`${routine.name} を編集`, `Edit ${routine.name}`)}
          title={t('編集', 'Edit')}
          disabled={running}
          onClick={onEdit}
        >
          <Icon name="penLine" size={14} />
        </button>
        {running ? (
          <button className="panel-button" onClick={onStop}>
            <Icon name="close" size={13} />
            {t('停止', 'Stop')}
          </button>
        ) : (
          <button
            className="solid-button"
            disabled={!!routine.problem || !!routine.needs}
            onClick={onRun}
          >
            <Icon name="play" size={13} />
            {t('実行', 'Run')}
          </button>
        )}
      </header>
      {routine.problem && (
        <p className="routine-problem" role="alert">
          {routine.problem}
        </p>
      )}
      {!routine.problem && routine.needs && (
        <p className="routine-needs">
          {routine.needs.text}
          {routine.needs.runtime && (
            <button
              className="panel-button"
              disabled={adding.busy}
              onClick={() => void adding.run(() => onAddRuntime(routine.needs!.runtime!))}
            >
              <Icon name="plus" size={13} />
              {routine.needs.runtime === 'python'
                ? adding.busy
                  ? t('Python を追加中…', 'Adding Python…')
                  : t('Python を追加', 'Add Python')
                : t('JavaScript を追加', 'Add JavaScript')}
            </button>
          )}
          {routine.needs.secrets?.map((name) => (
            <button key={name} className="panel-button" onClick={() => onEnterSecret(name)}>
              <Icon name="lock" size={13} />
              {t(`${name} を入力`, `Enter ${name}`)}
            </button>
          ))}
        </p>
      )}
      {error && (
        <p className="routine-problem" role="alert">
          {error}
        </p>
      )}
      {open && (
        <RoutineDetail
          routine={routine}
          live={live}
          onOpenConversation={onOpenConversation}
          onError={onError}
        />
      )}
    </article>
  );
}

/** Where a new routine can live: the irori agent's folder once it is set up, and each vault. */
export function routineOwners(you: YourAi | undefined, spaces: Space[]) {
  return [
    ...(you?.state === 'ready'
      ? [{ id: you.id, name: 'irori agent', kind: 'irori' as const }]
      : []),
    ...spaces.map((space) => ({ id: space.scopeId, name: space.name, kind: 'vault' as const })),
  ];
}

/**
 * The rail's routines page (ADR 016): the irori agent's routines and each
 * vault's, started and stopped only here. The page's header offers a new
 * routine and the device's secrets (`sheet`), and asking the irori agent to
 * write a routine.
 */
export function RoutinesView({
  workspaceId,
  spaces,
  you,
  revision,
  sheet,
  onCloseSheet,
  choices,
  onOpenConversation,
  onError,
}: {
  workspaceId: string;
  spaces: Space[];
  you?: YourAi;
  revision: number;
  /** The header's 新しいルーティン or シークレット was pressed. */
  sheet?: 'create' | 'secrets';
  onCloseSheet: () => void;
  /** The CLI and model chosen in each agent's panel, for steps that name none. */
  choices: () => RunRoutine['agents'];
  onOpenConversation: (conversation: Conversation) => void;
  onError: (error: unknown) => void;
}) {
  const [reads, setReads] = useState(0);
  const reread = () => setReads((value) => value + 1);
  // Read again now and then: nothing watches the irori agent's folder, and an agent may edit a routine.
  const list = useResource(() => host.routines(workspaceId), [workspaceId], {
    refresh: revision + reads,
    interval: 5000,
  });
  const [live, setLive] = useState<Record<string, RoutineRun>>({});
  const [open, setOpen] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Routine>();
  // A secret's value to enter: for its name, or `''` for a new one named in the sheet.
  const [entering, setEntering] = useState<string>();
  const [editing, setEditing] = useState<EditorTarget>();
  const secrets = useResource(() => host.secrets(), [], { refresh: reads });
  useEffect(
    () =>
      hostEvents.onEvent((event) => {
        if (event.type !== 'routine') return;
        const key = routineKey(event.run.routine);
        setLive((all) => ({ ...all, [key]: event.run }));
        // A run's end changes the routine's review and last run.
        if (event.run.state !== 'running') reread();
      }),
    [],
  );
  const routines = list.data ?? [];
  async function start(routine: Routine, digest?: string) {
    const key = routineKey(routine.ref);
    setErrors((all) => ({ ...all, [key]: '' }));
    await host.runRoutine(routine.ref, { workspaceId, digest, agents: choices() });
    setOpen(key);
    reread();
  }
  const act = (routine: Routine, action: () => Promise<void>) =>
    action().catch((error) =>
      setErrors((all) => ({ ...all, [routineKey(routine.ref)]: errorText(error) })),
    );
  const groups = [
    ...(you ? [{ id: you.id, space: undefined as Space | undefined }] : []),
    ...spaces.map((space) => ({ id: space.scopeId, space })),
  ]
    .map((group) => ({
      ...group,
      routines: routines.filter((routine) => routine.ref.owner === group.id),
    }))
    .filter((group) => group.routines.length);
  return (
    <section className="routines-view" aria-label={t('ルーティン', 'Routines')}>
      {list.error && (
        <p className="routine-problem" role="alert">
          {list.error}
        </p>
      )}
      {list.loading && <p className="routines-note">{t('読み込み中…', 'Loading…')}</p>}
      {list.data && !routines.length && (
        <p className="routines-empty">{t('ルーティンがありません', 'No routines')}</p>
      )}
      {groups.map((group) => (
        <section
          key={group.id}
          className="routine-group"
          aria-label={group.space?.name ?? 'irori agent'}
        >
          <h2>
            {group.space ? (
              <BrainTile space={group.space} size={20} radius={6} />
            ) : (
              <span className="routine-orb" aria-hidden="true">
                <Icon name="sparkles" size={11} strokeWidth={2.2} />
              </span>
            )}
            {group.space?.name ?? 'irori agent'}
          </h2>
          {group.routines.map((routine) => {
            const key = routineKey(routine.ref);
            return (
              <RoutineCard
                key={key}
                routine={routine}
                live={live[key]}
                open={open === key}
                error={errors[key]}
                onToggle={() => setOpen((value) => (value === key ? undefined : key))}
                onRun={() =>
                  routine.review === 'reviewed'
                    ? act(routine, () => start(routine))
                    : setReviewing(routine)
                }
                onStop={() => act(routine, () => host.stopRoutine(routine.ref))}
                onAddRuntime={(runtime) =>
                  act(routine, async () => {
                    if (runtime === 'python') await host.installPython();
                    await chooseRoutineRuntimes([
                      ...new Set([...currentRoutineRuntimes(), runtime]),
                    ]);
                    reread();
                  })
                }
                onEnterSecret={setEntering}
                onEdit={() =>
                  setEditing({
                    kind: 'edit',
                    ref: routine.ref,
                    name: routine.name,
                    owner: routine.owner,
                    path: routine.path,
                  })
                }
                onOpenConversation={onOpenConversation}
                onError={onError}
              />
            );
          })}
        </section>
      ))}
      {sheet === 'secrets' && (
        <SecretsDialog
          list={secrets.data}
          routines={routines}
          onEnter={(name) => setEntering(name ?? '')}
          onChanged={reread}
          onClose={onCloseSheet}
        />
      )}
      {(sheet === 'create' || editing) && (
        <RoutineEditor
          target={editing ?? { kind: 'create', owners: routineOwners(you, spaces) }}
          vaults={spaces.map((space) => space.name)}
          secrets={secrets.data}
          onEnterSecret={setEntering}
          onClose={() => (editing ? setEditing(undefined) : onCloseSheet())}
          onSaved={(ref) => {
            reread();
            setOpen(routineKey(ref));
          }}
        />
      )}
      {entering !== undefined && (
        <SecretDialog
          name={entering || undefined}
          onClose={() => setEntering(undefined)}
          onSaved={reread}
        />
      )}
      {reviewing && (
        <ReviewDialog
          routine={reviewing}
          onCancel={() => setReviewing(undefined)}
          onConfirm={async (digest) => {
            await start(reviewing, digest);
            setReviewing(undefined);
          }}
        />
      )}
    </section>
  );
}
