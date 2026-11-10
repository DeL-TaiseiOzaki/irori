import { useEffect, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { AgentAccess, AgentId, AgentModels } from '../domain/types';
import { agentAccessLabel, agentAccessOptions, agentAccessParts } from '../domain/agent-access';
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
function useModels(agent: AgentId, wanted: boolean) {
  const [list, setList] = useState<AgentModels>();
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    setList(undefined);
    void readModels(agent)
      .then((next) => live && setList(next))
      .catch((error) => live && setList({ models: [], custom: true, error: errorText(error) }));
    return () => {
      live = false;
    };
  }, [agent, wanted]);
  return wanted ? list : undefined;
}

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
    <label className="composer-typed">
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

const check = (
  <Menu.RadioItemIndicator className="menu-check">
    <Icon name="check" size={14} />
  </Menu.RadioItemIndicator>
);

/**
 * How a conversation runs, set from its column in one menu: the model (the CLI's
 * own default, one the installed CLI lists, or a name typed in where it lists
 * none), how much it thinks (the CLI's default, a level the model takes, or one
 * typed in; left out for a CLI that takes none), and how far it may act without
 * asking. The button names the model and level in use, and says so when the
 * conversation is in full access (ADR 053). The settings can leave either part
 * out (ADR 059).
 */
export function RunSettings({
  agent,
  model,
  effort,
  access,
  show,
  disabled,
  accessDisabled,
  accessNote,
  onModel,
  onEffort,
  onAccess,
}: {
  agent: AgentId;
  /** '' for the CLI's default model. */
  model: string;
  /** '' for the CLI's default level. */
  effort: string;
  access: AgentAccess;
  /** The parts the window shows; with neither there is no button. */
  show: { model: boolean; access: boolean };
  disabled?: boolean;
  /** The access cannot change now, such as during a run. */
  accessDisabled?: boolean;
  /** Why not, under the choices. */
  accessNote?: string;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onAccess: (access: AgentAccess) => void;
}) {
  const list = useModels(agent, show.model);
  const [typing, setTyping] = useState<'model' | 'effort'>();
  useEffect(() => setTyping(undefined), [agent]);
  // "Other…" was chosen: the name is typed once the menu has closed and given the
  // focus back, so that the field keeps it.
  const wanted = useRef<'model' | 'effort'>(undefined);
  const models = list?.models ?? [];
  const chosen = models.find((entry) => entry.id === model);
  const own = models.find((entry) => entry.default);
  const choices = list && effortChoices(list, model);
  // A level the newly chosen model does not take goes back to the default.
  const kept = choices ? keptEffort(choices, effort) : effort;
  useEffect(() => {
    if (kept !== effort) onEffort(kept);
  }, [kept, effort, onEffort]);
  if (!show.model && !show.access) return null;
  // The name being typed takes the button's place. The menu stays mounted beside it:
  // taking it away as it closes would move the focus off the field just shown.
  const typed =
    typing === 'model' ? (
      <TypedPill
        icon="cpu"
        label={t('モデル名', 'Model name')}
        initial={chosen ? '' : model}
        valid={(name) => agentModel.safeParse(name).success}
        disabled={disabled}
        onCommit={(name) => {
          onModel(name);
          setTyping(undefined);
        }}
        onCancel={() => setTyping(undefined)}
      />
    ) : typing === 'effort' ? (
      <TypedPill
        icon="effort"
        label={t('思考量', 'Effort')}
        initial={choices?.levels.includes(kept) ? '' : kept}
        valid={(level) => agentEffort.safeParse(level).success}
        disabled={disabled}
        onCommit={(level) => {
          onEffort(level);
          setTyping(undefined);
        }}
        onCancel={() => setTyping(undefined)}
      />
    ) : undefined;
  const levels = choices && (choices.levels.length > 0 || choices.custom) ? choices : undefined;
  const full = access === 'full-access';
  const options = agentAccessOptions(agent);
  const modelName = model
    ? (chosen?.label ?? model)
    : (own?.label ?? t('既定のモデル', 'Default model'));
  const said = [
    show.model &&
      t(
        `モデル: ${model ? modelName : 'CLI の既定'}`,
        `model: ${model ? modelName : 'CLI default'}`,
      ),
    show.model && levels && t(`思考量: ${kept || '既定'}`, `effort: ${kept || 'default'}`),
    show.access &&
      t(
        `アクセス: ${agentAccessLabel(agent, access)}`,
        `access: ${agentAccessLabel(agent, access)}`,
      ),
  ].filter(Boolean);
  const label = t(`会話の設定（${said.join('、')}）`, `Conversation settings (${said.join(', ')})`);
  return (
    <>
      {typed}
      <Menu.Root
        modal={false}
        onOpenChangeComplete={(open) => {
          if (open || !wanted.current) return;
          setTyping(wanted.current);
          wanted.current = undefined;
        }}
      >
        <Menu.Trigger
          className={`composer-settings ${full ? 'full' : ''}`}
          hidden={!!typed}
          aria-label={label}
          title={t('モデル・思考量・アクセス', 'Model, effort and access')}
        >
          {full && (
            <span className="composer-settings-access">
              <Icon name="shield" size={13} />
              {t('フルアクセス', 'Full access')}
            </span>
          )}
          {show.model ? (
            <span className="composer-settings-model">
              <span>{modelName}</span>
              {kept && <i>{kept}</i>}
            </span>
          ) : (
            !full && (
              <span className="composer-settings-model">
                <Icon name="shield" size={13} />
                <span>{agentAccessParts(agent, access).name}</span>
              </span>
            )
          )}
          <Icon name="chevronDown" size={12} className="composer-settings-caret" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="end" sideOffset={8} collisionPadding={12}>
            <Menu.Popup className="menu run-settings">
              {show.model && (
                <Menu.Group>
                  <Menu.GroupLabel className="menu-label">{t('モデル', 'Model')}</Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={model}
                    disabled={disabled}
                    onValueChange={(value) => onModel(value as string)}
                  >
                    <Menu.RadioItem value="" aria-label={t('CLI の既定', 'CLI default')}>
                      <span className="menu-text">
                        {t('CLI の既定', 'CLI default')}
                        {own && <small>{own.label}</small>}
                      </span>
                      {check}
                    </Menu.RadioItem>
                    {models.map((entry) => (
                      <Menu.RadioItem key={entry.id} value={entry.id} aria-label={entry.label}>
                        <span className="menu-text">{entry.label}</span>
                        {check}
                      </Menu.RadioItem>
                    ))}
                    {model && !chosen && (
                      <Menu.RadioItem value={model} aria-label={model}>
                        <span className="menu-text">{model}</span>
                        {check}
                      </Menu.RadioItem>
                    )}
                  </Menu.RadioGroup>
                  {!list && (
                    <p className="menu-note" role="status">
                      {t('モデルを確認中…', 'Reading the models…')}
                    </p>
                  )}
                  {list?.custom && (
                    <Menu.Item
                      disabled={disabled}
                      onClick={() => {
                        wanted.current = 'model';
                      }}
                    >
                      <span className="menu-text">{t('その他…', 'Other…')}</span>
                    </Menu.Item>
                  )}
                </Menu.Group>
              )}
              {show.model && levels && (
                <Menu.Group>
                  <Menu.GroupLabel className="menu-label">{t('思考量', 'Effort')}</Menu.GroupLabel>
                  <Menu.RadioGroup
                    className="run-settings-levels"
                    value={kept}
                    disabled={disabled}
                    onValueChange={(value) => onEffort(value as string)}
                  >
                    <Menu.RadioItem
                      value=""
                      aria-label={
                        levels.default
                          ? t(`既定（${levels.default}）`, `Default (${levels.default})`)
                          : t('既定', 'Default')
                      }
                    >
                      {t('既定', 'Default')}
                      {levels.default && <small>{levels.default}</small>}
                    </Menu.RadioItem>
                    {levels.levels.map((level) => (
                      <Menu.RadioItem key={level} value={level}>
                        {level}
                      </Menu.RadioItem>
                    ))}
                    {kept && !levels.levels.includes(kept) && (
                      <Menu.RadioItem value={kept}>{kept}</Menu.RadioItem>
                    )}
                  </Menu.RadioGroup>
                  {levels.custom && (
                    <Menu.Item
                      disabled={disabled}
                      onClick={() => {
                        wanted.current = 'effort';
                      }}
                    >
                      <span className="menu-text">{t('その他…', 'Other…')}</span>
                    </Menu.Item>
                  )}
                </Menu.Group>
              )}
              {show.access && (
                <Menu.Group>
                  <Menu.GroupLabel className="menu-label">
                    {t('アクセス', 'Access')}
                  </Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={access}
                    disabled={accessDisabled || options.length === 1}
                    onValueChange={(value) => onAccess(value as AgentAccess)}
                  >
                    {options.map((value) => {
                      const parts = agentAccessParts(agent, value);
                      return (
                        <Menu.RadioItem
                          key={value}
                          value={value}
                          className={`run-settings-access ${value}`}
                          aria-label={agentAccessLabel(agent, value)}
                        >
                          <Icon name="shield" size={14} />
                          <span className="menu-text">
                            {parts.name}
                            <small>{parts.detail}</small>
                          </span>
                          {check}
                        </Menu.RadioItem>
                      );
                    })}
                  </Menu.RadioGroup>
                  {accessNote && <p className="menu-note">{accessNote}</p>}
                </Menu.Group>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}
