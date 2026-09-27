import { useEffect, useState } from 'react';
import type { AgentId, AgentModels } from '../domain/types';
import { agentModel } from '../domain/conversation';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

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

const other = '\u0000other';

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
  const [list, setList] = useState<AgentModels>();
  const [typing, setTyping] = useState<string>();
  useEffect(() => {
    let live = true;
    setList(undefined);
    setTyping(undefined);
    void readModels(agent)
      .then((next) => live && setList(next))
      .catch((error) => live && setList({ models: [], custom: true, error: String(error) }));
    return () => {
      live = false;
    };
  }, [agent]);
  const models = list?.models ?? [];
  const listed = models.some((model) => model.id === value);
  const title =
    list?.error ??
    t('このCLIのモデル（既定はCLIの設定）', "This CLI's model (the default is the CLI's setting)");
  if (typing !== undefined) {
    const valid = !typing.trim() || agentModel.safeParse(typing.trim()).success;
    const commit = () => {
      if (!valid) return;
      onChange(typing.trim());
      setTyping(undefined);
    };
    return (
      <label className="composer-pill model-pill" title={title}>
        <Icon name="cpu" size={13} />
        <input
          aria-label={t('モデル名', 'Model name')}
          aria-invalid={!valid}
          placeholder={t('モデル名', 'Model name')}
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
              setTyping(undefined);
            }
          }}
        />
      </label>
    );
  }
  return (
    <label className="composer-pill model-pill" title={title}>
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
