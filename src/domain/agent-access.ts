import { agentNames, type AgentAccess, type AgentId } from './types';
import { t } from './i18n';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
}

/**
 * A hibachi agent and the irori agent start in full access wherever the CLI
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

export function agentAccessDetail(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access')
    return agent === 'codex'
      ? t(
          'ファイル・ネットワークの制限と実行承認を外します。',
          'Removes file and network restrictions and command approvals.',
        )
      : agent === 'claude'
        ? t(
            'Claude Codeの通常のツール承認を省略します。',
            "Skips Claude Code's usual tool approvals.",
          )
        : agent === 'hermes'
          ? t(
              'Hermes Agent を --yolo で実行し、危険なコマンドの承認を省略します。',
              'Runs Hermes Agent with --yolo, skipping dangerous-command approvals.',
            )
          : t(
              'この会話のOpenCodeツール権限を許可に設定します。',
              "Sets OpenCode's tool permissions to allow for this conversation.",
            );
  if (agent === 'codex')
    return t(
      '作業フォルダへの書き込みのみ可能で、追加アクセスには承認が必要です。',
      'Can write to the working folder; asks for approval when more access is needed.',
    );
  if (agent === 'claude')
    return t(
      'Claude Codeの許可ルールを使い、必要な承認をここに表示します。',
      "Uses Claude Code's permission rules and shows required approvals here.",
    );
  if (agent === 'opencode')
    return t(
      'OpenCodeの権限設定に従います。標準では多くのツールが承認なしで動きます。',
      "Follows OpenCode's permission settings. By default many tools run without approval.",
    );
  if (agent === 'hermes')
    return t(
      'Hermes Agent の設定に従い、危険なコマンドは既定で拒否されます。',
      "Uses Hermes Agent's settings; dangerous commands are denied by default.",
    );
  return t(
    'Piのネイティブ設定を使います。承認ダイアログはありません。',
    "Uses Pi's native settings; no approval dialog.",
  );
}
