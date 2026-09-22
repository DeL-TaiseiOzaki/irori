// SPDX-License-Identifier: MIT
const vscode = acquireVsCodeApi();
window.addEventListener('message', ({ data }) => {
  if (data.kind === 'ping') vscode.postMessage({ kind: 'pong', value: data.value });
});
vscode.postMessage({ kind: 'ready' });
