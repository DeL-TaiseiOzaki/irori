import assert from 'node:assert/strict';
import test from 'node:test';
import { agentAccessLabel, defaultAgentAccess } from '../src/domain/agent-access';
import { agentIds } from '../src/domain/types';
import { claudeRulePath, shownRequest } from '../src/agents/service';
import { viewDetails } from '../src/agents/conversations';

test('every conversation starts in standard access, and labels say what it means', () => {
  for (const agent of agentIds) assert.equal(defaultAgentAccess(agent), 'default');
  assert.match(agentAccessLabel('pi'), /承認なし|No approvals/);
  assert.match(agentAccessLabel('antigravity'), /編集|edits/);
});

test('read-only folders are spelled as Claude Code permission rules expect', () => {
  assert.equal(claudeRulePath('/Users/me/Drive', 'darwin'), '//Users/me/Drive');
  assert.equal(claudeRulePath('C:\\Users\\me\\Drive', 'win32'), '//c/Users/me/Drive');
});

test('a request too long to show says that part of it is not shown', () => {
  assert.equal(shownRequest('short'), 'short');
  const shown = shownRequest('x'.repeat(viewDetails * 2));
  assert.equal(shown.length, viewDetails);
  assert.match(shown, /表示されていません|not shown/);
});
