import { agentNames, type AgentAccess, type AgentId } from './types';
import { t } from './i18n';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
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
          'ファイル・ネットワークの制限と実行承認を外します。OS・管理者の制限は有効です。',
          'Removes file and network restrictions and command approvals. OS and administrator restrictions still apply.',
        )
      : agent === 'claude'
        ? t(
            'Claude Codeの通常のツール承認を省略します。明示的な権限ルール・管理者の制限は有効です。',
            "Skips Claude Code's usual tool approvals. Explicit permission rules and administrator restrictions still apply.",
          )
        : t(
            'この会話のOpenCodeツール権限を許可に設定します。OS・管理者の制限は有効です。',
            "Sets OpenCode's tool permissions to allow for this conversation. OS and administrator restrictions still apply.",
          );
  if (agent === 'codex')
    return t(
      '作業フォルダへの書き込みは可能です。追加のアクセスが必要な場合に承認を求めます。',
      'Can write to the working folder. Asks for approval when more access is needed.',
    );
  if (agent === 'claude')
    return t(
      'Claude Codeの標準の権限モードです。CLIの許可ルールを使い、必要な承認をここに表示します。',
      "Claude Code's standard permission mode. Uses the CLI's permission rules and shows required approvals here.",
    );
  if (agent === 'opencode')
    return t(
      'OpenCodeの権限設定を使い、ask要求をここに表示します。標準では多くのツールが承認なしで動きます。',
      "Uses OpenCode's permission settings and shows its ask requests here. By default many tools run without approval.",
    );
  return t(
    'Piのネイティブ設定を使います。標準のツール実行には承認ダイアログがありません。',
    "Uses Pi's native settings. Standard tool runs have no approval dialog.",
  );
}
