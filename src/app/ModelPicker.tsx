import { useEffect, useState } from 'react';
import type { AgentId, AgentModels } from '../domain/types';
import { agentEffort, agentModel } from '../domain/conversation';
import { effortChoices, keptEffort } from '../domain/agent-effort';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
import { Icon, type IconName } from './Icon';

const host = window.irori;
// The host keeps each list per CLI version; this keeps the window from asking again.
const lists = new Map<AgentId, Promise<AgentModels>>();
function readModels(agent: AgentId) {
  let list = lists.get(agent);
  if (!list) {
    list = host.agentModels(agent).then((value) => {
      if (value.error) lists.delete(agent);
      return value;
    });
    lists.set(agent, list);
    list.catch(() => lists.delete(agent));
  }
  return list;
}

/** The list `agent`'s CLI offers, read again when the CLI changes; undefined while it is read. */
function useModels(agent: AgentId) {
  const [list, setList] = useState<AgentModels>();
  useEffect(() => {
    let live = true;
    setList(undefined);
    void readModels(agent)
      .then((next) => live && setList(next))
      .catch((error) => live && setList({ models: [], custom: true, error: errorText(error) }));
    return () => {
      live = false;
    };
  }, [agent]);
  return list;
}

const other = '\u0000other';

/** A name typed in where the CLI lists none; Escape keeps the earlier choice. */
function TypedPill({
  icon,
  label,
  initial,
  valid,
  disabled,
  onCommit,
  onCancel,
}: {
  icon: IconName;
  label: string;
  initial: string;
  valid: (value: string) => boolean;
  disabled?: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [typing, setTyping] = useState(initial);
  const ok = !typing.trim() || valid(typing.trim());
  const commit = () => {
    if (ok) onCommit(typing.trim());
  };
  return (
    <label className="composer-pill model-pill">
      <Icon name={icon} size={13} />
      <input
        aria-label={label}
        aria-invalid={!ok}
        placeholder={label}
        value={typing}
        autoFocus
        maxLength={200}
        disabled={disabled}
        onChange={(event) => setTyping(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </label>
  );
}

/**
 * The model a CLI runs with: its own default (no model passed), one the
 * installed CLI lists, or a name typed in where the CLI lists none.
 */
export function ModelPicker({
  agent,
  value,
  disabled,
  onChange,
}: {
  agent: AgentId;
  /** '' for the CLI's default. */
  value: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  const list = useModels(agent);
  const [typing, setTyping] = useState<string>();
  useEffect(() => setTyping(undefined), [agent]);
  const models = list?.models ?? [];
  const listed = models.some((model) => model.id === value);
  if (typing !== undefined)
    return (
      <TypedPill
        icon="cpu"
        label={t('モデル名', 'Model name')}
        initial={typing}
        valid={(name) => agentModel.safeParse(name).success}
        disabled={disabled}
        onCommit={(name) => {
          onChange(name);
          setTyping(undefined);
        }}
        onCancel={() => setTyping(undefined)}
      />
    );
  return (
    <label className="composer-pill model-pill">
      <Icon name="cpu" size={13} />
      <select
        aria-label={t('モデル', 'Model')}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === other) setTyping(listed ? '' : value);
          else onChange(event.target.value);
        }}
      >
        <option value="">{t('CLI の既定', 'CLI default')}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.default ? t(`${model.label}（既定）`, `${model.label} (default)`) : model.label}
          </option>
        ))}
        {value && !listed && <option value={value}>{value}</option>}
        {list?.custom && <option value={other}>{t('その他…', 'Other…')}</option>}
      </select>
    </label>
  );
}

/**
 * How much a CLI thinks: its own default (no level passed), a level the CLI
 * lists for the chosen model, or one typed in where the CLI names its levels
 * elsewhere (OpenCode's variants). Not shown for a CLI that takes no level.
 */
export function EffortPicker({
  agent,
  model,
  value,
  disabled,
  onChange,
}: {
  agent: AgentId;
  /** '' for the CLI's default model. */
  model: string;
  /** '' for the CLI's default level. */
  value: string;
  disabled?: boolean;
  onChange: (effort: string) => void;
}) {
  const list = useModels(agent);
  const [typing, setTyping] = useState<string>();
  useEffect(() => setTyping(undefined), [agent]);
  const choices = list && effortChoices(list, model);
  // A level the newly chosen model does not take goes back to the default.
  const kept = choices ? keptEffort(choices, value) : value;
  useEffect(() => {
    if (kept !== value) onChange(kept);
  }, [kept, value, onChange]);
  if (!choices || (!choices.levels.length && !choices.custom)) return null;
  if (typing !== undefined)
    return (
      <TypedPill
        icon="effort"
        label={t('思考量', 'Effort')}
        initial={typing}
        valid={(level) => agentEffort.safeParse(level).success}
        disabled={disabled}
        onCommit={(level) => {
          onChange(level);
          setTyping(undefined);
        }}
        onCancel={() => setTyping(undefined)}
      />
    );
  const listed = choices.levels.includes(kept);
  return (
    <label className="composer-pill model-pill" title={t('思考量', 'Effort')}>
      <Icon name="effort" size={13} />
      <select
        aria-label={t('思考量', 'Effort')}
        value={kept}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === other) setTyping(listed ? '' : kept);
          else onChange(event.target.value);
        }}
      >
        <option value="">
          {choices.default
            ? t(`思考量: 既定（${choices.default}）`, `Effort: default (${choices.default})`)
            : t('思考量: 既定', 'Effort: default')}
        </option>
        {choices.levels.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
        {kept && !listed && <option value={kept}>{kept}</option>}
        {choices.custom && <option value={other}>{t('その他…', 'Other…')}</option>}
      </select>
    </label>
  );
}
