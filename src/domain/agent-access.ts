import { agentNames, type AgentAccess, type AgentId } from './types';
import { t } from './i18n';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
}

/**
 * A vault agent and the irori agent start in full access wherever the CLI
 * offers it. On Claude Code the irori agent's sub-agents inherit that mode, and
 * its write hook still decides every file write: hooks run before the mode.
 */
export function defaultAgentAccess(agent: AgentId): AgentAccess {
  return agentAccessOptions(agent).includes('full-access') ? 'full-access' : 'default';
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

export function agentAccessLabel(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access') return t('フルアクセス', 'Full access');
  return agent === 'codex' || agent === 'claude'
    ? t('標準（必要時に承認）', 'Standard (asks when needed)')
    : t('CLIの設定', "CLI's settings");
}
