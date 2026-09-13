import { detectDefaultShell } from 'default-shell';
import which from 'which';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { agentEnv } from '../agents/process';
import type { TerminalShell } from '../domain/types';

// Detect executables, not terminal windows (Windows Terminal/iTerm are separate frontends).
export async function detectShells(): Promise<TerminalShell[]> {
  const defaultShell = detectDefaultShell();
  const windows = process.platform === 'win32';
  const candidates: [string, string][] = windows
    ? [
        ['pwsh.exe', 'PowerShell 7'],
        [
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
          'PowerShell 7',
        ],
        ['powershell.exe', 'Windows PowerShell'],
        [
          path.join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          'Windows PowerShell',
        ],
        [defaultShell, 'Command Prompt'],
        ['cmd.exe', 'Command Prompt'],
        [
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
          'Git Bash',
        ],
      ]
    : [
        defaultShell,
        ...(await readFile('/etc/shells', 'utf8').catch(() => '')).split(/\r?\n/),
        'zsh',
        'bash',
        'fish',
        'sh',
      ]
        .filter((file) => file && !file.startsWith('#'))
        .map((file) => [file.trim(), path.basename(file.trim())]);
  const env = agentEnv();
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
  const found = new Map<string, TerminalShell>();
  for (const [file, name] of candidates) {
    const executable = await which(file, { nothrow: true, path: searchPath });
    if (!executable) continue;
    try {
      await access(executable, constants.X_OK);
      const id = await realpath(executable);
      const key = windows ? id.toLowerCase() : id;
      if (!found.has(key)) found.set(key, { id, name });
    } catch {
      /* A listed shell may have been uninstalled. */
    }
  }
  return [...found.values()];
}
