import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../domain/i18n';
import { agentIds, agentNames, type AgentId } from '../domain/types';
import { agentAccessOptions } from '../domain/agent-access';
import { routineKey, type Routine, type RoutineRef, type SecretList } from '../domain/routines';
import {
  agentDraft,
  draftFromYaml,
  parseRoutine,
  routineSteps,
  runDraft,
  yamlFromDraft,
  type AgentDraft,
  type RoutineDraft,
  type RunDraft,
  type StepDraft,
} from '../domain/routine-file';
import { Dialog } from './Dialog';
import { errorText } from './ErrorMessage';
import { Icon } from './Icon';
import { MagnetTabs } from './obsidian/MagnetTabs';
import { secretInput, validSecretName } from './RoutineKeys';
import { useAction } from './useAction';
import { useResource } from './useResource';

const host = window.irori;

/** A routine the editor opens, or the places a new one can go. */
export type EditorTarget =
  | { kind: 'create'; owners: { id: string; name: string; kind: Routine['owner'] }[] }
  | { kind: 'edit'; ref: RoutineRef; name: string; owner: Routine['owner']; path?: string };

/** One of a few choices as pressed buttons. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="routine-choice" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** The secrets a `run` step receives: stored ones checked, missing ones entered here. */
function StepSecrets({
  names,
  list,
  onChange,
  onEnter,
}: {
  names: string[];
  list?: SecretList;
  onChange: (names: string[]) => void;
  onEnter: (name: string) => void;
}) {
  const [adding, setAdding] = useState('');
  const options = useId();
  const add = () => {
    if (!validSecretName(adding) || names.includes(adding)) return;
    onChange([...names, adding]);
    setAdding('');
  };
  return (
    <div className="routine-draft-secrets" role="group" aria-label={t('シークレット', 'Secrets')}>
      <Icon name="lock" size={13} />
      {names.map((name) => {
        const kept = list?.names.includes(name);
        return (
          <span key={name} className={`routine-chip ${kept ? 'kept' : 'missing'}`}>
            <span className="mono">{name}</span>
            {kept ? (
              <span role="img" aria-label={t('保存済み', 'Stored')} title={t('保存済み', 'Stored')}>
                <Icon name="check" size={12} />
              </span>
            ) : (
              list?.available && (
                <button type="button" onClick={() => onEnter(name)}>
                  {t('値を入力', 'Enter value')}
                </button>
              )
            )}
            <button
              type="button"
              className="routine-chip-remove"
              aria-label={t(`${name} を外す`, `Remove ${name}`)}
              onClick={() => onChange(names.filter((item) => item !== name))}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        );
      })}
      <input
        className="mono"
        aria-label={t('シークレットの名前', 'Secret name')}
        list={options}
        maxLength={64}
        placeholder={t('名前を追加', 'Add a name')}
        autoComplete="off"
        spellCheck={false}
        value={adding}
        onChange={(event) => setAdding(secretInput(event.target.value))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
      />
      <datalist id={options}>
        {list?.names
          .filter((name) => !names.includes(name))
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
      <button
        type="button"
        className="panel-button"
        disabled={!validSecretName(adding) || names.includes(adding) || names.length >= 20}
        onClick={add}
      >
        {t('追加', 'Add')}
      </button>
    </div>
  );
}

function RunFields({
  step,
  files,
  secrets,
  onChange,
  onEnterSecret,
}: {
  step: RunDraft;
  files: string[];
  secrets?: SecretList;
  onChange: (step: RunDraft) => void;
  onEnterSecret: (name: string) => void;
}) {
  const options = useId();
  const mode = step.file !== undefined ? 'file' : 'command';
  return (
    <>
      <div className="routine-draft-run">
        <Choice
          label={t('実行するもの', 'What runs')}
          value={mode}
          options={[
            { value: 'command', label: t('コマンド', 'Command') },
            { value: 'file', label: t('ファイル', 'File') },
          ]}
          onChange={(next) =>
            onChange(
              next === 'file'
                ? { ...step, file: files[0] ?? '', command: undefined }
                : { ...step, file: undefined, command: '' },
            )
          }
        />
        {mode === 'command' ? (
          <input
            className="mono"
            aria-label={t('コマンド', 'Command')}
            placeholder="gh api notifications"
            spellCheck={false}
            value={step.command ?? ''}
            onChange={(event) => onChange({ ...step, command: event.target.value })}
          />
        ) : (
          <>
            <input
              className="mono"
              aria-label={t('ファイル', 'File')}
              placeholder="fetch.js"
              list={options}
              spellCheck={false}
              value={step.file ?? ''}
              onChange={(event) => onChange({ ...step, file: event.target.value })}
            />
            <datalist id={options}>
              {files.map((file) => (
                <option key={file} value={file} />
              ))}
            </datalist>
          </>
        )}
      </div>
      <StepSecrets
        names={step.secrets}
        list={secrets}
        onChange={(names) => onChange({ ...step, secrets: names })}
        onEnter={onEnterSecret}
      />
    </>
  );
}

function AgentFields({
  step,
  owner,
  vaults,
  onChange,
}: {
  step: AgentDraft;
  owner: Routine['owner'];
  vaults: string[];
  onChange: (step: AgentDraft) => void;
}) {
  const accesses = step.cli ? agentAccessOptions(step.cli) : (['default', 'full-access'] as const);
  const handed = step.vaults === undefined ? 'none' : step.vaults === 'all' ? 'all' : 'some';
  const named = Array.isArray(step.vaults) ? step.vaults : [];
  const choices = [...new Set([...vaults, ...named])];
  return (
    <>
      <textarea
        aria-label={t('プロンプト', 'Prompt')}
        placeholder={t('エージェントへの指示', 'What the agent does')}
        rows={4}
        value={step.prompt}
        onChange={(event) => onChange({ ...step, prompt: event.target.value })}
      />
      <div className="routine-draft-options">
        {owner === 'irori' && (
          <label>
            {t('渡す vault', 'Vaults')}
            <select
              value={handed}
              onChange={(event) => {
                const next = event.target.value;
                onChange({
                  ...step,
                  vaults: next === 'none' ? undefined : next === 'all' ? 'all' : named,
                });
              }}
            >
              <option value="none">{t('なし', 'None')}</option>
              <option value="all">{t('すべて', 'All')}</option>
              <option value="some" disabled={!choices.length}>
                {t('選ぶ', 'Choose')}
              </option>
            </select>
          </label>
        )}
        <label>
          {t('アクセス', 'Access')}
          <select
            value={step.access}
            onChange={(event) =>
              onChange({ ...step, access: event.target.value as AgentDraft['access'] })
            }
          >
            {accesses.map((access) => (
              <option key={access} value={access}>
                {access === 'full-access'
                  ? t('フルアクセス', 'Full access')
                  : t('標準', 'Standard')}
              </option>
            ))}
          </select>
        </label>
        <label>
          CLI
          <select
            value={step.cli ?? ''}
            onChange={(event) => {
              const cli = (event.target.value || undefined) as AgentId | undefined;
              // A CLI without full access takes the standard mode.
              const access =
                cli && !agentAccessOptions(cli).includes(step.access) ? 'default' : step.access;
              onChange({ ...step, cli, access, model: cli ? step.model : undefined });
            }}
          >
            <option value="">{t('パネルの選択', "The panel's")}</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>
                {agentNames[id]}
              </option>
            ))}
          </select>
        </label>
        {step.cli && (
          <label>
            {t('モデル', 'Model')}
            <input
              className="mono"
              spellCheck={false}
              value={step.model ?? ''}
              onChange={(event) => onChange({ ...step, model: event.target.value || undefined })}
            />
          </label>
        )}
      </div>
      {handed === 'some' && (
        <div className="routine-draft-vaults" role="group" aria-label={t('渡す vault', 'Vaults')}>
          {choices.map((name) => (
            <label key={name} className="routine-chip">
              <input
                type="checkbox"
                checked={named.includes(name)}
                onChange={(event) =>
                  onChange({
                    ...step,
                    vaults: event.target.checked
                      ? [...named, name]
                      : named.filter((item) => item !== name),
                  })
                }
              />
              {name}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

function StepCard({
  index,
  count,
  step,
  owner,
  vaults,
  files,
  secrets,
  onChange,
  onMove,
  onRemove,
  onEnterSecret,
}: {
  index: number;
  count: number;
  step: StepDraft;
  owner: Routine['owner'];
  vaults: string[];
  files: string[];
  secrets?: SecretList;
  onChange: (step: StepDraft) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onEnterSecret: (name: string) => void;
}) {
  const label = t(`ステップ ${index + 1}`, `Step ${index + 1}`);
  return (
    <li className={`routine-draft-step ${step.kind}`} aria-label={label}>
      <div className="routine-draft-step-head">
        <span className="routine-step-number">{index + 1}</span>
        <Icon
          name={step.kind === 'agent' ? 'sparkles' : 'terminal'}
          size={13}
          className={step.kind === 'agent' ? 'routine-step-agent' : undefined}
        />
        <strong>
          {step.kind === 'run'
            ? t('プログラム', 'Program')
            : owner === 'irori'
              ? 'irori agent'
              : 'vault agent'}
        </strong>
        <span className="routine-space" />
        <button
          type="button"
          className="icon-button"
          aria-label={t(`${label}を上へ`, `Move ${label} up`)}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <Icon name="up" size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t(`${label}を下へ`, `Move ${label} down`)}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <Icon name="down" size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t(`${label}を削除`, `Delete ${label}`)}
          onClick={onRemove}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {step.kind === 'run' ? (
        <RunFields
          step={step}
          files={files}
          secrets={secrets}
          onChange={onChange}
          onEnterSecret={onEnterSecret}
        />
      ) : (
        <AgentFields step={step} owner={owner} vaults={vaults} onChange={onChange} />
      )}
    </li>
  );
}

/** The name a `routine.yaml` gives, for a routine made from its text. */
function nameIn(text: string) {
  const read = draftFromYaml(text);
  return 'draft' in read ? read.draft.name.trim() : '';
}

/**
 * Makes a routine or edits its `routine.yaml`: a form of its steps, or the text
 * itself. A save names the version it read; the form keeps the text's comments.
 */
export function RoutineEditor({
  target,
  vaults,
  secrets,
  onEnterSecret,
  onClose,
  onSaved,
  onDeleted,
}: {
  target: EditorTarget;
  /** The workspace's vaults, by name, for the irori agent's steps. */
  vaults: string[];
  secrets?: SecretList;
  onEnterSecret: (name: string) => void;
  onClose: () => void;
  onSaved: (ref: RoutineRef) => void;
  onDeleted: (ref: RoutineRef) => void;
}) {
  const editing = target.kind === 'edit' ? target : undefined;
  const source = useResource(
    () => (editing ? host.routineSource(editing.ref) : Promise.resolve(undefined)),
    [editing ? routineKey(editing.ref) : 'new'],
  );
  const [owner, setOwner] = useState(target.kind === 'create' ? target.owners[0]?.id : undefined);
  const kind =
    target.kind === 'edit'
      ? target.owner
      : (target.owners.find((item) => item.id === owner)?.kind ?? 'irori');
  // The text the form was read from, so a save from the form changes only what the person did.
  const [base, setBase] = useState<string>();
  const [draft, setDraft] = useState<RoutineDraft>();
  const [text, setText] = useState<string>();
  const [view, setView] = useState<'form' | 'yaml'>();
  const [unfit, setUnfit] = useState('');
  const [version, setVersion] = useState<string>();
  const { busy, error, setError, run } = useAction();
  // 削除 asks once more: the second press deletes.
  const [removing, setRemoving] = useState(false);
  const loaded = editing ? source.data : { text: '', version: '', files: [] };
  if (loaded && base === undefined) {
    // The first render with the text decides how it opens.
    const read = editing
      ? draftFromYaml(loaded.text)
      : { draft: { name: '', steps: [agentDraft()] } };
    setBase(loaded.text);
    setText(loaded.text);
    if ('draft' in read) {
      setDraft(read.draft);
      setView('form');
    } else {
      setUnfit(read.problem);
      setView('yaml');
    }
  }
  const current = useMemo(
    () => (view === 'form' && draft ? yamlFromDraft(draft, kind, base || undefined) : (text ?? '')),
    [view, draft, kind, base, text],
  );
  const parsed = useMemo(() => parseRoutine(current, kind), [current, kind]);
  const problem = 'problem' in parsed ? parsed.problem : undefined;
  // What a save reported stands until the person changes the routine.
  useEffect(() => setError(''), [current]);
  const name = view === 'form' ? (draft?.name.trim() ?? '') : nameIn(current);
  const read = version ?? loaded?.version;
  const steps = draft?.steps ?? [];
  const setSteps = (next: StepDraft[]) => setDraft((value) => value && { ...value, steps: next });
  const label = editing ? editing.name : t('新しいルーティン', 'New routine');

  function show(next: 'form' | 'yaml') {
    setUnfit('');
    if (next === 'yaml') {
      setText(current);
      return setView('yaml');
    }
    const back = draftFromYaml(current);
    if ('problem' in back) return setUnfit(back.problem);
    setBase(current);
    setDraft(back.draft);
    setView('form');
  }

  async function save() {
    if (!editing) {
      const ref = await host.createRoutine(owner!, name, current);
      onSaved(ref);
      return onClose();
    }
    const saved = await host.saveRoutineSource(editing.ref, current, read!);
    onSaved(editing.ref);
    if (!saved.problem) return onClose();
    // Written, but it cannot run yet: the editor stays on what was saved.
    setVersion(saved.version);
    setText(current);
    setBase(current);
    if (view === 'form') {
      const back = draftFromYaml(current);
      if ('draft' in back) setDraft(back.draft);
    }
    setError(saved.problem);
  }

  return createPortal(
    <Dialog label={label} busy={busy} onClose={onClose}>
      <form
        className="modal routine-editor"
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          if (!view || (editing && !read)) return;
          void run(save);
        }}
      >
        <header className="routine-editor-head">
          {view === 'form' && draft ? (
            <input
              className="routine-editor-name"
              aria-label={t('名前', 'Name')}
              placeholder={t('名前', 'Name')}
              maxLength={120}
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          ) : (
            <h2>{name || label}</h2>
          )}
          {view && (
            <MagnetTabs
              className="routine-editor-views"
              label={t('編集の表示', 'Editor view')}
              value={view}
              onValueChange={show}
              options={[
                { value: 'form', label: t('フォーム', 'Form') },
                { value: 'yaml', label: 'YAML' },
              ]}
            />
          )}
        </header>
        {target.kind === 'create' ? (
          target.owners.length > 1 && (
            <label className="routine-editor-owner">
              {t('置き場所', 'Location')}
              <select
                value={owner}
                disabled={busy}
                onChange={(event) => setOwner(event.target.value)}
              >
                {target.owners.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <p className="routine-editor-path">
            <span className="routine-path mono">{editing?.path}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t('フォルダを開く', 'Open the folder')}
              title={t('フォルダを開く', 'Open the folder')}
              onClick={() =>
                host.revealRoutine(editing!.ref).catch((reason) => setError(errorText(reason)))
              }
            >
              <Icon name="folderOpen" size={14} />
            </button>
          </p>
        )}
        {source.error && (
          <p className="routine-problem" role="alert">
            {source.error}
          </p>
        )}
        {unfit && (
          <p className="routine-problem" role="alert">
            {t('フォームで開けません: ', 'The form cannot open it: ') + unfit}
          </p>
        )}
        {view === 'form' && draft && (
          <>
            <ol className="routine-draft-steps">
              {steps.map((step, index) => (
                <StepCard
                  key={index}
                  index={index}
                  count={steps.length}
                  step={step}
                  owner={kind}
                  vaults={vaults}
                  files={loaded?.files ?? []}
                  secrets={secrets}
                  onChange={(next) => setSteps(steps.map((item, i) => (i === index ? next : item)))}
                  onMove={(by) => {
                    const next = [...steps];
                    [next[index], next[index + by]] = [next[index + by], next[index]];
                    setSteps(next);
                  }}
                  onRemove={() => setSteps(steps.filter((_, i) => i !== index))}
                  onEnterSecret={onEnterSecret}
                />
              ))}
            </ol>
            <div
              className="routine-draft-add"
              role="group"
              aria-label={t('ステップを追加', 'Add a step')}
            >
              <button
                type="button"
                className="panel-button"
                disabled={steps.length >= routineSteps}
                onClick={() => setSteps([...steps, agentDraft()])}
              >
                <Icon name="plus" size={13} />
                {t('エージェント', 'Agent')}
              </button>
              <button
                type="button"
                className="panel-button"
                disabled={steps.length >= routineSteps}
                onClick={() => setSteps([...steps, runDraft()])}
              >
                <Icon name="plus" size={13} />
                {t('プログラム', 'Program')}
              </button>
            </div>
          </>
        )}
        {view === 'yaml' && (
          <textarea
            className="mono routine-editor-text"
            aria-label="routine.yaml"
            spellCheck={false}
            autoFocus
            rows={18}
            value={text ?? ''}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {error ? (
          <p className="routine-problem" role="alert">
            {error}
          </p>
        ) : (
          problem && <p className="routine-editor-problem">{problem}</p>
        )}
        <div className="actions">
          {editing && (
            <>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!removing) return setRemoving(true);
                  void run(async () => {
                    await host.deleteRoutine(editing.ref);
                    onDeleted(editing.ref);
                    onClose();
                  }).finally(() => setRemoving(false));
                }}
                onBlur={() => setRemoving(false)}
              >
                <Icon name="trash" size={13} />
                {removing ? t('削除する', 'Delete it') : t('削除', 'Delete')}
              </button>
              <span className="routine-space" />
            </>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            {/* After a save that still cannot run, the file is written: closing keeps it. */}
            {version ? t('閉じる', 'Close') : t('キャンセル', 'Cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !view || (editing ? !read : !name || !owner)}
          >
            {editing ? t('保存', 'Save') : t('作成', 'Create')}
          </button>
        </div>
      </form>
    </Dialog>,
    document.body,
  );
}
