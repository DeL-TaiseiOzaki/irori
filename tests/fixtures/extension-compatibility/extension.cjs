// SPDX-License-Identifier: MIT
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const waitFor = async (read, accepts, label) => {
  const until = Date.now() + 15000;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < until);
  throw Error(`Timed out: ${label}`);
};

exports.activate = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('iroriCompatibility.run', async () => {
      const checks = [];
      const step = async (name, run) => {
        await run();
        checks.push(name);
      };
      const folder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(folder && folder.uri.scheme === 'file', 'A disposable local workspace is required');
      const uri = vscode.Uri.joinPath(folder.uri, 'sample.iroriprobe');
      const original = await fs.readFile(uri.fsPath, 'utf8');
      assert.equal(original, 'before\n', 'Refuse a workspace that is not the probe fixture');
      const document = await vscode.workspace.openTextDocument(uri);
      const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      try {
        await step('command-workspace-edit-save', async () => {
          await vscode.window.showTextDocument(document);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(uri, new vscode.Range(0, 0, 0, 6), 'after');
          assert.equal(await vscode.workspace.applyEdit(edit), true);
          assert.equal(await document.save(), true);
          assert.equal(await fs.readFile(uri.fsPath, 'utf8'), 'after\n');
        });
        await step('language-completion-diagnostics', async () => {
          assert.equal(document.languageId, 'irori-probe');
          const provider = vscode.languages.registerCompletionItemProvider('irori-probe', {
            provideCompletionItems: () => [new vscode.CompletionItem('probe-completion')],
          });
          const diagnostics = vscode.languages.createDiagnosticCollection('irori-probe');
          try {
            const result = await vscode.commands.executeCommand(
              'vscode.executeCompletionItemProvider',
              uri,
              new vscode.Position(0, 0),
            );
            assert.ok(result.items.some((item) => item.label === 'probe-completion'));
            diagnostics.set(uri, [
              new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'probe diagnostic'),
            ]);
            assert.ok(
              vscode.languages
                .getDiagnostics(uri)
                .some((item) => item.message === 'probe diagnostic'),
            );
          } finally {
            diagnostics.dispose();
            provider.dispose();
          }
        });
        await step('configuration-memento-secret-roundtrip', async () => {
          const configuration = vscode.workspace.getConfiguration('iroriCompatibility');
          await configuration.update('probe', 'saved', vscode.ConfigurationTarget.Global);
          await waitFor(
            () => vscode.workspace.getConfiguration('iroriCompatibility').get('probe'),
            (value) => value === 'saved',
            'configuration update',
          );
          await context.globalState.update('probe', 'saved');
          assert.equal(context.globalState.get('probe'), 'saved');
          await context.secrets.store('probe', 'synthetic-only');
          assert.equal(await context.secrets.get('probe'), 'synthetic-only');
          await context.secrets.delete('probe');
        });
        await step('theme-contribution-selection', async () => {
          await vscode.workspace
            .getConfiguration('workbench')
            .update('colorTheme', 'irori Probe Light', vscode.ConfigurationTarget.Global);
          await waitFor(
            () => vscode.window.activeColorTheme.kind,
            (kind) => kind === vscode.ColorThemeKind.Light,
            'light theme contribution',
          );
        });
        await step('native-node-child', async () => {
          const { stdout } = await promisify(execFile)(
            process.execPath,
            ['-e', 'process.stdout.write("probe-child")'],
            { env: nodeEnv, cwd: folder.uri.fsPath, timeout: 15000 },
          );
          assert.equal(stdout, 'probe-child');
        });
        await step('native-terminal', async () => {
          const marker = vscode.Uri.joinPath(folder.uri, 'terminal-probe.txt');
          const terminal = vscode.window.createTerminal({
            name: 'irori compatibility probe',
            cwd: folder.uri,
            shellPath: process.execPath,
            shellArgs: [
              '-e',
              'require("node:fs").writeFileSync(process.argv[1], "probe-terminal")',
              marker.fsPath,
            ],
            env: { ELECTRON_RUN_AS_NODE: '1' },
          });
          try {
            await waitFor(
              () => fs.readFile(marker.fsPath, 'utf8').catch(() => ''),
              (text) => text === 'probe-terminal',
              'native terminal output',
            );
          } finally {
            terminal.dispose();
          }
        });
        await step('webview-resource-message-roundtrip', async () => {
          const panel = vscode.window.createWebviewPanel(
            'iroriCompatibility',
            'Compatibility probe',
            vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [context.extensionUri] },
          );
          let received;
          const listener = panel.webview.onDidReceiveMessage((message) => {
            received = message;
          });
          try {
            const script = panel.webview.asWebviewUri(
              vscode.Uri.joinPath(context.extensionUri, 'webview.js'),
            );
            panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource};"></head><body><p>Compatibility probe</p><script src="${script}"></script></body></html>`;
            await waitFor(
              () => received,
              (value) => value?.kind === 'ready',
              'webview script resource',
            );
            await panel.webview.postMessage({ kind: 'ping', value: 'probe-message' });
            await waitFor(
              () => received,
              (value) => value?.kind === 'pong',
              'webview reply',
            );
            assert.equal(received.value, 'probe-message');
          } finally {
            listener.dispose();
            panel.dispose();
          }
        });
        return { checks, app: vscode.env.appName, vscodeVersion: vscode.version };
      } catch (error) {
        error.probeChecks = checks;
        throw error;
      }
    }),
  );
};
