// SPDX-License-Identifier: MIT
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');

exports.run = async () => {
  const output = process.env.IRORI_COMPATIBILITY_RESULT;
  assert.ok(output, 'Run through scripts/extension-compatibility/run.mjs');
  try {
    const extension = vscode.extensions.getExtension('irori.compatibility-probe');
    assert.ok(extension, 'The development extension must be discovered by the real host');
    await extension.activate();
    const result = await vscode.commands.executeCommand('iroriCompatibility.run');
    assert.equal(result?.checks?.length, 7, 'Every runtime operation must complete');
    assert.equal(typeof result.vscodeVersion, 'string');
    await fs.writeFile(output, JSON.stringify({ state: 'passed', ...result }, null, 2));
  } catch (error) {
    await fs.writeFile(
      output,
      JSON.stringify(
        { state: 'failed', checks: error.probeChecks ?? [], error: String(error.message) },
        null,
        2,
      ),
    );
    throw error;
  }
};
