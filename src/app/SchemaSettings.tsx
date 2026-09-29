import { useEffect, useState, type ReactNode } from 'react';
import type { Document, Entry, Space } from '../domain/types';
import { t } from '../domain/i18n';
import { retiredFile, skillFile, skillName, skillsRoot, type SkillListing } from '../domain/skills';
import {
  attachmentPath,
  claudeSettingsFile,
  hookEvents,
  instructionsFile,
  readHooks,
  readSkillText,
  ruleFileName,
  rulesRoot,
  writeHooks,
  writeSkillText,
  type HookEntry,
  type SchemaSettings,
} from '../domain/schema-settings';
import { Dialog } from './Dialog';
import { errorText } from './ErrorMessage';
import { Icon, type IconName } from './Icon';
import { Crumbs } from './NoteBar';
import { StageView } from './StageView';
import { useResource } from './useResource';
import './schema-settings.css';

const host = window.irori;

export type SchemaKind = 'instructions' | 'skill' | 'rule' | 'hook';
/** One item of the Schema settings; without a key, a new one of that kind. */
export type SchemaTarget = { kind: SchemaKind; key?: string };

type SchemaData = {
  settings: SchemaSettings;
  skills: SkillListing;
  hooks: HookEntry[];
  hooksError?: string;
};

async function loadSchema(scopeId: string): Promise<SchemaData> {
  const [settings, skills] = await Promise.all([
    host.schemaSettings(scopeId),
    host.skills(scopeId),
  ]);
  let hooks: HookEntry[] = [];
  let hooksError: string | undefined;
  try {
    if (settings.claudeSettings)
      hooks = readHooks((await host.readSchemaFile(scopeId, claudeSettingsFile)).text);
  } catch (error) {
    hooksError = errorText(error);
  }
  return { settings, skills, hooks, hooksError };
}

const kinds: Record<SchemaKind, { icon: IconName; name: () => string; one: () => string }> = {
  instructions: {
    icon: 'schema',
    name: () => t('指示', 'Instructions'),
    one: () => t('指示', 'instructions'),
  },
  skill: { icon: 'sparkles', name: () => t('スキル', 'Skills'), one: () => t('スキル', 'a skill') },
  rule: { icon: 'shield', name: () => t('ルール', 'Rules'), one: () => t('ルール', 'a rule') },
  hook: { icon: 'zap', name: () => t('フック', 'Hooks'), one: () => t('フック', 'a hook') },
};

const folderOf = (file: string) => file.split('/').slice(0, -1).join('/');
const instructionsLabel = (file: string) => (file === instructionsFile ? file : folderOf(file));
const hookLabel = (hook: HookEntry) =>
  hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event;
const skillPath = (name: string, file = skillFile) => `${skillsRoot}/${name}/${file}`;

/** The Schema section as settings: what the agent reads, grouped by what it is. */
export function SchemaList({
  scopeId,
  space,
  revision,
  selected,
  locked,
  onSelect,
  onOpenFile,
}: {
  scopeId: string;
  /** The hibachi, or none for the irori agent's folder. */
  space?: Space;
  revision: number;
  selected?: SchemaTarget;
  locked: boolean;
  onSelect: (target: SchemaTarget) => void;
  onOpenFile: (entry: Entry) => void;
}) {
  const data = useResource(() => loadSchema(scopeId), [scopeId], {
    refresh: revision,
  });
  if (!data.data)
    return data.error ? (
      <small className="tree-error" role="alert">
        {data.error}
      </small>
    ) : (
      <small className="tree-empty">{t('読み込み中…', 'Loading…')}</small>
    );
  const { settings, skills, hooks, hooksError } = data.data;
  const broken = skills.problems
    .map((problem) => ({ name: problem.directory.split('/')[2], message: problem.message }))
    .filter((problem) => problem.name);
  type Item = { key: string; label: string; title?: string; badge?: string; file?: string };
  const groups: { kind: SchemaKind; items: Item[]; error?: string; note?: string }[] = [
    {
      kind: 'instructions',
      items: settings.instructions.map((file) => ({
        key: file,
        label: instructionsLabel(file),
        title: file,
      })),
      note: settings.incomplete
        ? t(
            '上限に達したため、一部のフォルダは調べていません。',
            'A limit was reached, so some folders were not checked.',
          )
        : undefined,
    },
    {
      kind: 'skill',
      items: [
        ...skills.skills.map((skill) => ({
          key: skill.name,
          label: skill.name,
          title: skill.description,
        })),
        ...broken.map((problem) => ({
          key: problem.name,
          label: problem.name,
          title: problem.message,
          badge: t('要確認', 'Check'),
        })),
        ...skills.retired.map((skill) => ({
          key: skill.name,
          label: skill.name,
          title: skill.reason,
          badge: t('退役', 'Retired'),
          file: skill.path,
        })),
      ].sort((left, right) => left.label.localeCompare(right.label)),
    },
    {
      kind: 'rule',
      items: settings.rules.map((file) => ({
        key: file,
        label: file.split('/').at(-1)!,
        title: file,
      })),
    },
    {
      kind: 'hook',
      items: hooks.map((hook, index) => ({
        key: String(index),
        label: hookLabel(hook),
        title: hook.command || hook.type,
      })),
      error: hooksError,
    },
  ];
  return (
    <div className="schema-list">
      {groups.map((group) => (
        <div
          key={group.kind}
          className="schema-group"
          role="group"
          aria-label={t(
            `Schema の${kinds[group.kind].name()}`,
            `Schema ${kinds[group.kind].name().toLowerCase()}`,
          )}
        >
          <div className="schema-group-heading">
            <span>{kinds[group.kind].name()}</span>
            <button
              className="section-action"
              aria-label={t(`${kinds[group.kind].one()}を追加`, `Add ${kinds[group.kind].one()}`)}
              title={t(`${kinds[group.kind].one()}を追加`, `Add ${kinds[group.kind].one()}`)}
              disabled={locked || (group.kind === 'hook' && !!group.error)}
              onClick={() => onSelect({ kind: group.kind })}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          {group.error && (
            <small className="tree-error" role="alert">
              {group.error}
            </small>
          )}
          {!group.items.length && !group.error && (
            <small className="tree-empty">{t('まだありません', 'None yet')}</small>
          )}
          {group.items.map((item) => {
            const current = selected?.kind === group.kind && selected.key === item.key;
            return (
              <button
                key={`${item.key}-${item.badge ?? ''}`}
                className={`tree-row ${current ? 'selected' : ''}`}
                aria-current={current ? 'page' : undefined}
                title={item.title}
                onClick={() =>
                  item.file
                    ? onOpenFile({
                        path: item.file,
                        name: retiredFile,
                        directory: false,
                        layer: 'schema',
                        note: true,
                      })
                    : onSelect({ kind: group.kind, key: item.key })
                }
              >
                <Icon name={kinds[group.kind].icon} size={15} className="tree-icon" />
                <span className="filename">{item.label}</span>
                {item.badge && <span className="badge">{item.badge}</span>}
              </button>
            );
          })}
          {group.note && <small className="tree-empty">{group.note}</small>}
        </div>
      ))}
    </div>
  );
}

function ConfirmDelete({
  what,
  detail,
  onConfirm,
  onClose,
}: {
  what: string;
  detail: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = t(`${what}を削除`, `Delete ${what}`);
  return (
    <Dialog label={label} busy={busy} onClose={onClose}>
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          onConfirm().then(onClose, (reason) => {
            setError(errorText(reason));
            setBusy(false);
          });
        }}
      >
        <h2>{label}</h2>
        <p>{detail}</p>
        <p className="hint">
          {t(
            'ファイルを削除します。Git に記録済みなら変更パネルから戻せます。',
            'The files are deleted. If Git has them, the Changes view can bring them back.',
          )}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('キャンセル', 'Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('削除する', 'Delete')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The text field every form uses for a file's body. */
function TextField({
  label,
  value,
  rows = 16,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  rows?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="schema-field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        className="schema-text"
        value={value}
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/**
 * The stage view that edits one Schema setting. Each save writes the file
 * behind it through the host, checked against the version this form read.
 */
export function SchemaEditor({
  scopeId,
  space,
  target,
  locked,
  revision,
  onSelect,
  onClose,
}: {
  scopeId: string;
  /** The hibachi, or none for the irori agent's folder. */
  space?: Space;
  target: SchemaTarget;
  locked: boolean;
  revision: number;
  /** Shows another item, or none after a deletion. */
  onSelect: (target?: SchemaTarget) => void;
  onClose: () => void;
}) {
  const data = useResource(() => loadSchema(scopeId), [scopeId], {
    refresh: revision,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<{
    what: string;
    detail: string;
    run: () => Promise<void>;
  }>();
  useEffect(() => {
    setError('');
    setNotice('');
  }, [target.kind, target.key]);
  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const done = await action();
      if (done) setNotice(done);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  const title = target.key
    ? target.kind === 'hook'
      ? data.data?.hooks[Number(target.key)]
        ? hookLabel(data.data.hooks[Number(target.key)])
        : kinds.hook.name()
      : target.kind === 'instructions'
        ? instructionsLabel(target.key)
        : target.key.split('/').at(-1)!
    : t(`${kinds[target.kind].one()}を追加`, `Add ${kinds[target.kind].one()}`);
  const shared = {
    scopeId,
    space,
    target,
    data: data.data,
    disabled: locked || busy,
    run,
    onSelect,
    onDelete: (what: string, detail: string, action: () => Promise<void>) =>
      setDeleting({ what, detail, run: action }),
  };
  return (
    <StageView
      label={t('Schema の設定', 'Schema settings')}
      className="schema-view"
      busy={busy}
      crumbs={
        <Crumbs
          space={space}
          items={[
            ...(space
              ? []
              : [{ icon: 'sparkles' as const, label: t('irori agent', 'irori agent') }]),
            { icon: 'schema', label: 'Schema', className: 'layer schema' },
            { label: kinds[target.kind].name(), className: 'folder' },
          ]}
          here={title}
        />
      }
      onClose={onClose}
    >
      <div className="schema-form">
        {locked && (
          <p className="hint" role="status">
            {space
              ? t(
                  '実行・Git 操作・接続の間は Schema を変更できません。',
                  'The Schema cannot change during a run, a Git operation or a connection.',
                )
              : t(
                  'irori agent の実行中は Schema を変更できません。',
                  'The Schema cannot change while the irori agent runs.',
                )}
          </p>
        )}
        {!data.data ? (
          <p className={data.error ? 'error' : 'hint'} role={data.error ? 'alert' : undefined}>
            {data.error ?? t('読み込み中…', 'Loading…')}
          </p>
        ) : target.kind === 'instructions' ? (
          <InstructionsForm key={target.key ?? ''} {...shared} data={data.data} />
        ) : target.kind === 'skill' ? (
          <SkillForm key={target.key ?? ''} {...shared} data={data.data} />
        ) : target.kind === 'rule' ? (
          <RuleForm key={target.key ?? ''} {...shared} data={data.data} />
        ) : (
          // A hook is known by its place in the file, so the form follows the hook it shows.
          <HookForm
            key={`${target.key ?? ''}:${JSON.stringify(data.data.hooks[Number(target.key)] ?? null)}`}
            {...shared}
            data={data.data}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="hint" role="status">
            {notice}
          </p>
        )}
      </div>
      {deleting && (
        <ConfirmDelete
          what={deleting.what}
          detail={deleting.detail}
          onConfirm={deleting.run}
          onClose={() => setDeleting(undefined)}
        />
      )}
    </StageView>
  );
}

type FormProps = {
  scopeId: string;
  space?: Space;
  target: SchemaTarget;
  data: SchemaData;
  disabled: boolean;
  run: (action: () => Promise<string | void>) => Promise<void>;
  onSelect: (target?: SchemaTarget) => void;
  onDelete: (what: string, detail: string, action: () => Promise<void>) => void;
};

const saved = () => t('保存しました。', 'Saved.');

/** Reads one file for a form; a missing key means a new file, which starts empty. */
function useSettingFile(scopeId: string, path?: string) {
  const [doc, setDoc] = useState<Document | null>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!path) return setDoc(null);
    let live = true;
    host.readSchemaFile(scopeId, path).then(
      (value) => live && setDoc(value),
      (reason) => live && setError(errorText(reason)),
    );
    return () => {
      live = false;
    };
  }, [scopeId, path]);
  return { doc, setDoc, error };
}

function Loading({ error }: { error: string }) {
  return (
    <p className={error ? 'error' : 'hint'} role={error ? 'alert' : undefined}>
      {error || t('読み込み中…', 'Loading…')}
    </p>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="schema-actions">{children}</div>;
}

function DeleteButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="stage-text-button danger"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="trash" size={14} />
      {t('削除', 'Delete')}
    </button>
  );
}

function InstructionsForm({
  scopeId,
  space,
  target,
  data,
  disabled,
  run,
  onSelect,
  onDelete,
}: FormProps) {
  const { doc, setDoc, error } = useSettingFile(scopeId, target.key);
  const [text, setText] = useState<string>();
  const choices = [
    ...(data.settings.instructions.includes(instructionsFile) ? [] : ['']),
    ...data.settings.folders,
  ];
  const [folder, setFolder] = useState(choices[0] ?? '');
  if (doc === undefined) return <Loading error={error} />;
  const value = text ?? doc?.text ?? '';
  const where = target.key ?? (folder ? `${folder}/${instructionsFile}` : instructionsFile);
  return (
    <form
      className="schema-card"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const next = await host.writeSchemaFile(scopeId, where, value, doc?.hash ?? null);
          if (!target.key) return onSelect({ kind: 'instructions', key: where });
          setDoc(next);
          setText(undefined);
          return saved();
        });
      }}
    >
      {!target.key && (
        <label className="schema-field">
          <span>{t('場所', 'Location')}</span>
          <select
            aria-label={t('場所', 'Location')}
            value={folder}
            disabled={disabled || !choices.length}
            onChange={(event) => setFolder(event.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice ||
                  (space
                    ? t('hibachi 全体（AGENTS.md）', 'The whole hibachi (AGENTS.md)')
                    : t('irori agent（AGENTS.md）', 'The irori agent (AGENTS.md)'))}
              </option>
            ))}
          </select>
          {!choices.length && (
            <small>
              {t('どのフォルダにも既に指示があります。', 'Every folder already has instructions.')}
            </small>
          )}
        </label>
      )}
      <TextField
        label={t('指示（Markdown）', 'Instructions (Markdown)')}
        value={value}
        disabled={disabled}
        onChange={setText}
      />
      <Actions>
        {/* The irori agent's AGENTS.md marks its folder as set up, so it stays. */}
        {target.key && space && (
          <DeleteButton
            disabled={disabled}
            onClick={() =>
              onDelete(t('指示', 'the instructions'), target.key!, async () => {
                await host.writeSchemaFile(scopeId, target.key!, null, doc!.hash);
                onSelect(undefined);
              })
            }
          />
        )}
        <button
          className="solid-button"
          disabled={
            disabled || (!!target.key && text === undefined) || (!target.key && !choices.length)
          }
        >
          <Icon name="check" size={14} />
          {target.key ? t('保存', 'Save') : t('作成', 'Create')}
        </button>
      </Actions>
    </form>
  );
}

function RuleForm({ scopeId, target, disabled, run, onSelect, onDelete }: FormProps) {
  const { doc, setDoc, error } = useSettingFile(scopeId, target.key);
  const [text, setText] = useState<string>();
  const [name, setName] = useState(target.key?.split('/').at(-1) ?? '');
  if (doc === undefined) return <Loading error={error} />;
  const value = text ?? doc?.text ?? '';
  const filename = /\.md$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
  const valid = ruleFileName(filename);
  const renamed = !!target.key && filename !== target.key.split('/').at(-1);
  return (
    <form
      className="schema-card"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const where = `${rulesRoot}/${filename}`;
          if (!target.key || renamed) {
            await host.writeSchemaFile(scopeId, where, value, null);
            if (target.key) await host.writeSchemaFile(scopeId, target.key, null, doc!.hash);
            return onSelect({ kind: 'rule', key: where });
          }
          setDoc(await host.writeSchemaFile(scopeId, where, value, doc!.hash));
          setText(undefined);
          return saved();
        });
      }}
    >
      <label className="schema-field">
        <span>{t('ファイル名', 'File name')}</span>
        <input
          aria-label={t('ファイル名', 'File name')}
          value={name}
          disabled={disabled}
          aria-invalid={!!name && !valid}
          placeholder="writing-style.md"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <TextField
        label={t('ルール（Markdown）', 'Rule (Markdown)')}
        value={value}
        disabled={disabled}
        onChange={setText}
      />
      <Actions>
        {target.key && (
          <DeleteButton
            disabled={disabled}
            onClick={() =>
              onDelete(t('ルール', 'the rule'), target.key!, async () => {
                await host.writeSchemaFile(scopeId, target.key!, null, doc!.hash);
                onSelect(undefined);
              })
            }
          />
        )}
        <button
          className="solid-button"
          disabled={disabled || !valid || (!!target.key && text === undefined && !renamed)}
        >
          <Icon name="check" size={14} />
          {target.key ? t('保存', 'Save') : t('作成', 'Create')}
        </button>
      </Actions>
    </form>
  );
}

function HookForm({ scopeId, target, data, disabled, run, onSelect, onDelete }: FormProps) {
  const index = target.key === undefined ? undefined : Number(target.key);
  const current = index === undefined ? undefined : data.hooks[index];
  const [event, setEvent] = useState(current?.event ?? hookEvents[0]);
  const [matcher, setMatcher] = useState(current?.matcher ?? '');
  const [command, setCommand] = useState(current?.command ?? '');
  if (index !== undefined && !current) return <Loading error="" />;
  const editable = !current || current.type === 'command';
  const write = async (next: HookEntry[]) => {
    const file = data.settings.claudeSettings
      ? await host.readSchemaFile(scopeId, claudeSettingsFile)
      : undefined;
    // The form edits what the list showed; a file changed since then is re-read, not overwritten.
    if (JSON.stringify(readHooks(file?.text)) !== JSON.stringify(data.hooks))
      throw Error(
        t(
          'CONFLICT: .claude/settings.json が変更されています。',
          'CONFLICT: .claude/settings.json has changed.',
        ),
      );
    await host.writeSchemaFile(
      scopeId,
      claudeSettingsFile,
      writeHooks(file?.text, next),
      file?.hash ?? null,
    );
  };
  const entry: HookEntry = {
    event,
    ...(matcher.trim() ? { matcher: matcher.trim() } : {}),
    type: current?.type ?? 'command',
    command: command.trim(),
    extra: current?.extra ?? {},
  };
  return (
    <form
      className="schema-card"
      onSubmit={(submit) => {
        submit.preventDefault();
        void run(async () => {
          const next = [...data.hooks];
          if (index === undefined) next.push(entry);
          else next[index] = entry;
          await write(next);
          // A hook's place in the list follows its event, so the saved one is found again.
          const found = writeHooks(undefined, next);
          const at = readHooks(found).findIndex(
            (hook) => JSON.stringify(hook) === JSON.stringify(entry),
          );
          onSelect(at >= 0 ? { kind: 'hook', key: String(at) } : undefined);
          return saved();
        });
      }}
    >
      <label className="schema-field">
        <span>{t('タイミング', 'Event')}</span>
        <select
          aria-label={t('タイミング', 'Event')}
          value={event}
          disabled={disabled}
          onChange={(change) => setEvent(change.target.value)}
        >
          {[...new Set([...hookEvents, event])].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="schema-field">
        <span>{t('対象（matcher・任意）', 'Matcher (optional)')}</span>
        <input
          aria-label={t('対象（matcher・任意）', 'Matcher (optional)')}
          value={matcher}
          disabled={disabled}
          placeholder="Edit|Write"
          onChange={(change) => setMatcher(change.target.value)}
        />
        <small>
          {t('ツール名の正規表現（空欄で全一致）', 'Regex of tool names (empty = all)')}
        </small>
      </label>
      {editable ? (
        <label className="schema-field">
          <span>{t('コマンド', 'Command')}</span>
          <input
            aria-label={t('コマンド', 'Command')}
            className="mono"
            value={command}
            disabled={disabled}
            placeholder="npm run format"
            onChange={(change) => setCommand(change.target.value)}
          />
        </label>
      ) : (
        <p className="hint">
          {t(
            `type: ${current!.type} のフックはファイルとして編集してください。`,
            `Edit a hook of type ${current!.type} as a file.`,
          )}
        </p>
      )}
      <Actions>
        {index !== undefined && (
          <DeleteButton
            disabled={disabled}
            onClick={() =>
              onDelete(t('フック', 'the hook'), hookLabel(current!), async () => {
                await write(data.hooks.filter((_, position) => position !== index));
                onSelect(undefined);
              })
            }
          />
        )}
        <button className="solid-button" disabled={disabled || !editable || !command.trim()}>
          <Icon name="check" size={14} />
          {index === undefined ? t('作成', 'Create') : t('保存', 'Save')}
        </button>
      </Actions>
    </form>
  );
}

function SkillForm({ scopeId, target, data, disabled, run, onSelect, onDelete }: FormProps) {
  const { doc, setDoc, error } = useSettingFile(
    scopeId,
    target.key ? skillPath(target.key) : undefined,
  );
  const [form, setForm] = useState<{ name: string; description: string; body: string }>();
  useEffect(() => {
    if (doc === undefined || form) return;
    const read = doc ? readSkillText(doc.text) : undefined;
    // The host's YAML reading is the authority when the package is valid.
    const listed = data.skills.skills.find((skill) => skill.name === target.key);
    setForm({
      name: target.key ?? '',
      description: listed?.description ?? read?.description ?? '',
      body: read?.body ?? '',
    });
  }, [doc]);
  if (doc === undefined || !form) return <Loading error={error} />;
  const nameValid = skillName.safeParse(form.name).success;
  const description = form.description.trim();
  const valid = nameValid && !!description && description.length <= 400 && !!form.body.trim();
  const change = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  return (
    <>
      <form
        className="schema-card"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const text = writeSkillText(doc?.text, { ...form, description });
            if (!target.key) {
              await host.writeSchemaFile(scopeId, skillPath(form.name), text, null);
              return onSelect({ kind: 'skill', key: form.name });
            }
            if (form.name !== target.key) {
              await host.moveSkill(scopeId, target.key, form.name);
              await host.writeSchemaFile(scopeId, skillPath(form.name), text, doc!.hash);
              return onSelect({ kind: 'skill', key: form.name });
            }
            setDoc(await host.writeSchemaFile(scopeId, skillPath(form.name), text, doc!.hash));
            return saved();
          });
        }}
      >
        <label className="schema-field">
          <span>{t('名前', 'Name')}</span>
          <input
            aria-label={t('名前', 'Name')}
            value={form.name}
            disabled={disabled}
            aria-invalid={!!form.name && !nameValid}
            placeholder="weekly-review"
            onChange={(event) => change({ name: event.target.value })}
          />
          <small>
            {t(
              '半角小文字・数字・ハイフン（変更でフォルダも変わります）',
              'Lowercase letters, digits and hyphens (renaming also renames the folder)',
            )}
          </small>
        </label>
        <label className="schema-field">
          <span>{t('説明', 'Description')}</span>
          <input
            aria-label={t('説明', 'Description')}
            value={form.description}
            disabled={disabled}
            maxLength={400}
            onChange={(event) => change({ description: event.target.value })}
          />
          <small>{t('400 文字まで', 'Up to 400 characters')}</small>
        </label>
        <TextField
          label={t('手順（Markdown）', 'Instructions (Markdown)')}
          value={form.body}
          disabled={disabled}
          onChange={(body) => change({ body })}
        />
        <Actions>
          {target.key && (
            <DeleteButton
              disabled={disabled}
              onClick={() =>
                onDelete(
                  t('スキル', 'the skill'),
                  t(
                    `${skillsRoot}/${target.key}/ とその中のファイルすべて`,
                    `${skillsRoot}/${target.key}/ and every file in it`,
                  ),
                  async () => {
                    await host.moveSkill(scopeId, target.key!, null);
                    onSelect(undefined);
                  },
                )
              }
            />
          )}
          <button className="solid-button" disabled={disabled || !valid}>
            <Icon name="check" size={14} />
            {target.key ? t('保存', 'Save') : t('作成', 'Create')}
          </button>
        </Actions>
      </form>
      {target.key ? (
        <Attachments
          scopeId={scopeId}
          skill={target.key}
          files={data.settings.attachments[target.key] ?? []}
          disabled={disabled}
          run={run}
          onDelete={onDelete}
        />
      ) : null}
    </>
  );
}

/** The other files of a skill package: scripts, templates, references. */
function Attachments({
  scopeId,
  skill,
  files,
  disabled,
  run,
  onDelete,
}: {
  scopeId: string;
  skill: string;
  files: string[];
  disabled: boolean;
  run: FormProps['run'];
  onDelete: FormProps['onDelete'];
}) {
  // The file being edited: an existing one's path, or '' for a new one.
  const [open, setOpen] = useState<string>();
  const [doc, setDoc] = useState<Document>();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    setDoc(undefined);
    if (!open) return;
    let live = true;
    host.readSchemaFile(scopeId, skillPath(skill, open)).then(
      (value) => {
        if (!live) return;
        setDoc(value);
        setText(value.text);
      },
      (reason) => live && setError(errorText(reason)),
    );
    return () => {
      live = false;
    };
  }, [open, skill]);
  const valid = attachmentPath(name.trim());
  async function importFile(file: File) {
    if (file.size > 2 * 1024 * 1024)
      throw Error(
        t('2 MiB までのテキストファイルを選んでください。', 'Choose a text file up to 2 MiB.'),
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let value: string;
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      value = '\0';
    }
    if (value.includes('\0'))
      throw Error(t('テキストファイルだけを添付できます。', 'Only text files can be attached.'));
    setName(file.name);
    setText(value);
  }
  return (
    <section className="schema-card" aria-label={t('添付ファイル', 'Attached files')}>
      <div className="schema-card-heading">
        <h3>{t('添付ファイル', 'Attached files')}</h3>
        <button
          type="button"
          className="stage-text-button small framed"
          disabled={disabled}
          onClick={() => {
            setOpen('');
            setName('');
            setText('');
          }}
        >
          <Icon name="plus" size={13} />
          {t('ファイルを追加', 'Add a file')}
        </button>
      </div>
      {files.length ? (
        <ul className="schema-files">
          {files.map((file) => (
            <li key={file}>
              <button
                type="button"
                className={`stage-text-button small ${open === file ? 'framed' : ''}`}
                aria-current={open === file ? 'true' : undefined}
                onClick={() => setOpen(file)}
              >
                <Icon name="file" size={13} />
                <span className="mono">{file}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t('添付ファイルはありません。', 'No attached files.')}</p>
      )}
      {open === '' && (
        <form
          className="schema-attachment"
          aria-label={t('新しい添付ファイル', 'New attached file')}
          onSubmit={(event) => {
            event.preventDefault();
            const file = name.trim();
            void run(async () => {
              await host.writeSchemaFile(scopeId, skillPath(skill, file), text, null);
              setOpen(file);
              return t(`${file} を追加しました。`, `Added ${file}.`);
            });
          }}
        >
          <label className="schema-field">
            <span>{t('ファイル名（フォルダも可）', 'File name (may include folders)')}</span>
            <input
              aria-label={t('ファイル名（フォルダも可）', 'File name (may include folders)')}
              className="mono"
              value={name}
              disabled={disabled}
              aria-invalid={!!name && !valid}
              placeholder="scripts/run.py"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="schema-import">
            <span className="stage-text-button small framed">
              <Icon name="folderOpen" size={13} />
              {t('ディスクから読み込む', 'Import from disk')}
            </span>
            <input
              type="file"
              aria-label={t('添付するファイル', 'File to attach')}
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file).catch((reason) => setError(errorText(reason)));
              }}
            />
            <small>{t('テキストファイルのみ・2 MiB まで', 'Text files only, up to 2 MiB')}</small>
          </label>
          <TextField
            label={t('内容', 'Contents')}
            value={text}
            rows={12}
            disabled={disabled}
            onChange={setText}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Actions>
            <button type="button" className="stage-text-button" onClick={() => setOpen(undefined)}>
              {t('キャンセル', 'Cancel')}
            </button>
            <button className="solid-button" disabled={disabled || !valid}>
              <Icon name="plus" size={14} />
              {t('追加', 'Add')}
            </button>
          </Actions>
        </form>
      )}
      {open && (
        <form
          className="schema-attachment"
          aria-label={open}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setDoc(
                (await host.writeSchemaFile(scopeId, doc!.path, text, doc!.hash)) ?? undefined,
              );
              return saved();
            });
          }}
        >
          {!doc ? (
            <Loading error={error} />
          ) : (
            <>
              <TextField
                label={open}
                value={text}
                rows={12}
                disabled={disabled}
                onChange={setText}
              />
              <Actions>
                <DeleteButton
                  disabled={disabled}
                  onClick={() =>
                    onDelete(t('添付ファイル', 'the attached file'), doc.path, async () => {
                      await host.writeSchemaFile(scopeId, doc.path, null, doc.hash);
                      setOpen(undefined);
                    })
                  }
                />
                <button className="solid-button" disabled={disabled || text === doc.text}>
                  <Icon name="check" size={14} />
                  {t('保存', 'Save')}
                </button>
              </Actions>
            </>
          )}
        </form>
      )}
    </section>
  );
}
