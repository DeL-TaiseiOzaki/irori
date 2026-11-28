import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The CI groups use the same scripts and local ordering as the full suite.
export const uiSmokeGroups = [
  [
    'scripts/ui-smoke.ts',
    'scripts/dock-ui-smoke.ts',
    'scripts/cloud-ui-smoke.ts',
    'scripts/explorer-ui-smoke.ts',
    'scripts/vault-split-ui-smoke.ts',
    'scripts/stage-columns-ui-smoke.ts',
    'scripts/harness-ui-smoke.ts',
    'scripts/skills-ui-smoke.ts',
    'scripts/layers-ui-smoke.ts',
    'scripts/git-ui-smoke.ts',
    'scripts/submodules-ui-smoke.ts',
    'scripts/knowledge-ui-smoke.ts',
    'scripts/ontology-ui-smoke.ts',
    'scripts/terminal-ui-smoke.ts',
  ],
  [
    'scripts/windows-ui-smoke.ts',
    'scripts/tab-menu-ui-smoke.ts',
    'scripts/search-ui-smoke.ts',
    'scripts/links-ui-smoke.ts',
    'scripts/markdown-ui-smoke.ts',
    'scripts/images-ui-smoke.ts',
    'scripts/updates-ui-smoke.ts',
    'scripts/daily-workflow-ui-smoke.ts',
    'scripts/editor-assistance-ui-smoke.ts',
    'scripts/language-ui-smoke.ts',
    'scripts/brain-settings-ui-smoke.ts',
    'scripts/vault-layers-ui-smoke.ts',
    'scripts/schema-settings-ui-smoke.ts',
    'scripts/shared-schema-ui-smoke.ts',
    'scripts/overview-ui-smoke.ts',
    'scripts/your-ai-ui-smoke.ts',
    'scripts/viewers-ui-smoke.ts',
  ],
  [
    'scripts/find-in-file-ui-smoke.ts',
    'scripts/properties-ui-smoke.ts',
    'scripts/routines-ui-smoke.ts',
    'scripts/comments-ui-smoke.ts',
    'scripts/conversations-ui-smoke.ts',
    'scripts/irori-threads-ui-smoke.ts',
    'scripts/session-board-ui-smoke.ts',
    'scripts/brain-ai-ui-smoke.ts',
    'scripts/rail-groups-ui-smoke.ts',
    'scripts/account-ui-smoke.ts',
    'scripts/window-items-ui-smoke.ts',
    'scripts/remote-hosts-ui-smoke.ts',
  ],
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const group = uiSmokeGroups[Number(args[0]) - 1];
  if (args.length > 0 && (args.length !== 1 || !/^[1-9]$/.test(args[0]) || !group)) {
    throw new Error('Usage: npm run test:ui -- [1|2|3]');
  }

  for (const script of group ?? uiSmokeGroups.flat()) {
    console.log(`Running ${script}`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
