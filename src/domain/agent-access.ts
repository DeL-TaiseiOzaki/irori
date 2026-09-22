import { agentNames, type AgentAccess, type AgentId } from './types';

export function agentAccessOptions(agent: AgentId): AgentAccess[] {
  return agent === 'pi' ? ['default'] : ['default', 'full-access'];
}

export function requireAgentAccess(agent: AgentId, access: AgentAccess = 'default'): AgentAccess {
  if (!agentAccessOptions(agent).includes(access))
    throw Error(
      `${agentNames[agent]} はこのアクセス設定に対応していません。CLIの設定を使用してください。`,
    );
  return access;
}

export function agentAccessLabel(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access') return 'フルアクセス';
  return agent === 'codex' || agent === 'claude' ? '標準（必要時に承認）' : 'CLIの設定';
}

export function agentAccessDetail(agent: AgentId, access: AgentAccess = 'default') {
  if (access === 'full-access')
    return agent === 'codex'
      ? 'ファイル・ネットワークの制限と実行承認を外します。OS・管理者の制限は有効です。'
      : agent === 'claude'
        ? 'Claude Codeの通常のツール承認を省略します。明示的な権限ルール・管理者の制限は有効です。'
        : 'この会話のOpenCodeツール権限を許可に設定します。OS・管理者の制限は有効です。';
  if (agent === 'codex')
    return '作業フォルダへの書き込みは可能です。追加のアクセスが必要な場合に承認を求めます。';
  if (agent === 'claude')
    return 'Claude Codeの標準の権限モードです。CLIの許可ルールを使い、必要な承認をここに表示します。';
  if (agent === 'opencode')
    return 'OpenCodeの権限設定を使い、ask要求をここに表示します。標準では多くのツールが承認なしで動きます。';
  return 'Piのネイティブ設定を使います。標準のツール実行には承認ダイアログがありません。';
}
