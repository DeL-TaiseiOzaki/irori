import { agentNames, type AgentAccess, type AgentId } from './types';
import { t } from './i18n';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
}

/**
 * The access a new conversation starts in: the one the person chose in the
 * settings for every agent, standard unless they chose full access (ADR 009). A
 * vault's notes and connected folders can carry text written by someone else,
 * so full access is never irori's own default. A CLI that offers only its own
 * settings keeps them.
 */
export function defaultAgentAccess(
  agent: AgentId,
  preferred: AgentAccess = 'default',
): AgentAccess {
  return agentAccessOptions(agent).includes(preferred) ? preferred : 'default';
}

/**
 * The access a conversation runs with: the person's choice for it, else what its
 * last run used, else the access new conversations start in (`preferred`, from
 * the settings). Each conversation keeps its own: one never takes another's, and
 * none changes by itself, the settings' choice included.
 */
export function conversationAccess(
  agent: AgentId,
  chosen?: AgentAccess,
  saved?: AgentAccess,
  preferred: AgentAccess = 'default',
): AgentAccess {
  for (const access of [chosen, saved])
    if (access && agentAccessOptions(agent).includes(access)) return access;
  return defaultAgentAccess(agent, preferred);
}

export function requireAgentAccess(agent: AgentId, access: AgentAccess = 'default'): AgentAccess {
  if (!agentAccessOptions(agent).includes(access))
    throw Error(
      t(
        `${agentNames[agent]} はこのアクセス設定に対応していません。CLIの設定を使用してください。`,
        `${agentNames[agent]} does not support this access setting. Use the CLI's settings.`,
      ),
    );
  return access;
}

/** What the standard access means for each CLI, as irori starts it. */
export function agentAccessLabel(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access') return t('フルアクセス', 'Full access');
  if (agent === 'codex' || agent === 'claude')
    return t('標準（必要時に承認）', 'Standard (asks when needed)');
  // Pi has no approvals; Antigravity is started with `--mode accept-edits`.
  if (agent === 'pi') return t('承認なし（Pi）', 'No approvals (Pi)');
  if (agent === 'antigravity') return t('標準（編集は自動で許可）', 'Standard (edits allowed)');
  return t('CLIの設定', "CLI's settings");
}

/**
 * An access in two parts, for a list that names each on one line and says what it
 * does on the next. Together they say what `agentAccessLabel` says in one.
 */
export function agentAccessParts(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access')
    return {
      name: t('フルアクセス', 'Full access'),
      detail: t(
        '承認を求めずにコマンドを実行し、ファイルを変更します',
        'Runs commands and changes files without asking',
      ),
    };
  if (agent === 'codex' || agent === 'claude')
    return {
      name: t('標準', 'Standard'),
      detail: t('必要なときに承認を求めます', 'Asks when it needs to'),
    };
  if (agent === 'pi')
    return {
      name: t('承認なし', 'No approvals'),
      detail: t('Pi には承認の仕組みがありません', 'Pi has no approvals'),
    };
  if (agent === 'antigravity')
    return {
      name: t('標準', 'Standard'),
      detail: t('編集は自動で許可されます', 'Edits are allowed on their own'),
    };
  return {
    name: t('CLI の設定', "CLI's settings"),
    detail: t('CLI 自身の設定に従います', "Follows the CLI's own settings"),
  };
}
