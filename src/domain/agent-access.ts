import { agentNames, type AgentAccess, type AgentId } from './types';
import { t } from './i18n';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
}

/**
 * Every conversation starts in the CLI's standard access. Full access is the
 * person's choice for a conversation, never a default: a vault's notes and
 * connected folders can carry text written by someone else.
 */
export function defaultAgentAccess(_agent: AgentId): AgentAccess {
  return 'default';
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
