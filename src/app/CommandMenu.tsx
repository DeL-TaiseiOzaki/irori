import { useEffect, useId, useState, type KeyboardEvent, type RefObject } from 'react';
import type { AgentCommand, AgentId } from '../domain/types';
import { t } from '../domain/i18n';
import { errorText } from './ErrorMessage';
import { matchCommands } from './command-match';

const host = window.irori;
// The host keeps each folder's list a minute; this keeps the window from asking on every key.
const lists = new Map<string, { at: number; list: Promise<AgentCommand[]> }>();
const keep = 60_000;
function readCommands(scopeId: string, agent: AgentId) {
  const key = `${scopeId}\n${agent}`;
  const kept = lists.get(key);
  if (kept && Date.now() - kept.at < keep) return kept.list;
  const list = host.agentCommands(scopeId, agent);
  lists.set(key, { at: Date.now(), list });
  list.catch(() => lists.delete(key));
  return list;
}

/** The name being typed: a request that is so far `/` and a name, nothing after it. */
const typing = (prompt: string) => /^\/([\w:-]*)$/.exec(prompt)?.[1];

/**
 * The commands and skills the CLI runs as `/name` (ADR 040), offered while the
 * request is `/` and part of a name. Arrows choose, Enter or Tab takes one,
 * Escape closes the list.
 */
export function useCommandMenu({
  scopeId,
  agent,
  prompt,
  setPrompt,
  field,
}: {
  scopeId: string | undefined;
  agent: AgentId;
  prompt: string;
  setPrompt: (text: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const query = scopeId ? typing(prompt) : undefined;
  const [state, setState] = useState<{
    key: string;
    commands?: AgentCommand[];
    error?: string;
  }>();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const key = `${scopeId}\n${agent}`;
  const wanted = query !== undefined && dismissed !== prompt;
  // Each time the list opens it is read again; the host answers from its minute's copy.
  useEffect(() => {
    if (!wanted || !scopeId) return;
    let current = true;
    setState((previous) => (previous?.key === key && previous.commands ? previous : { key }));
    readCommands(scopeId, agent).then(
      (commands) => current && setState({ key, commands }),
      (error) => current && setState({ key, error: errorText(error) }),
    );
    return () => {
      current = false;
    };
  }, [wanted, key]);
  useEffect(() => setActive(0), [query]);
  const loaded = state?.key === key ? state : undefined;
  const matches =
    query !== undefined && loaded?.commands ? matchCommands(loaded.commands, query) : [];
  const open = wanted && (!loaded?.commands || matches.length > 0);
  const choose = (command: AgentCommand) => {
    const text = `/${command.name} `;
    setPrompt(text);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(text.length, text.length);
    });
  };
  const option = (index: number) => `${id}-option-${index}`;
  /** Handles the keys the open list takes; true when the textarea must not act on it. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape') {
      setDismissed(prompt);
      event.preventDefault();
      return true;
    }
    if (!matches.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
      event.preventDefault();
      return true;
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      choose(matches[Math.min(active, matches.length - 1)]);
      event.preventDefault();
      return true;
    }
    return false;
  };
  const menu = open ? (
    <ul className="command-menu" id={id} role="listbox" aria-label={t('コマンド', 'Commands')}>
      {!loaded?.commands ? (
        <li className="command-menu-note" aria-disabled="true">
          {loaded?.error
            ? t(
                `コマンドを読み込めませんでした: ${loaded.error}`,
                `Could not read the commands: ${loaded.error}`,
              )
            : t('コマンドを読み込んでいます…', 'Reading the commands…')}
        </li>
      ) : (
        matches.map((command, index) => (
          <li
            key={command.name}
            id={option(index)}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(command)}
          >
            <span className="command-name">/{command.name}</span>
            {command.hint && <span className="command-hint">{command.hint}</span>}
            {command.skill && <span className="command-tag">{t('スキル', 'Skill')}</span>}
            <span className="command-description">{command.description}</span>
          </li>
        ))
      )}
    </ul>
  ) : null;
  return {
    menu,
    onKeyDown,
    field: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? id : undefined,
      'aria-activedescendant': open && matches.length ? option(active) : undefined,
    },
  };
}
