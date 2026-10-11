import { execFile } from 'node:child_process';
import { Menu } from 'electron';

/**
 * Voice typing in the C# that PowerShell compiles: Win+H, pressed and released
 * as one chord, opens Windows voice typing in the field that has the focus.
 */
const windowsVoiceTyping = `
Add-Type -Namespace Irori -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
[Irori.Keys]::keybd_event(0x5B, 0, 0, [System.UIntPtr]::Zero)
[Irori.Keys]::keybd_event(0x48, 0, 0, [System.UIntPtr]::Zero)
[Irori.Keys]::keybd_event(0x48, 0, 2, [System.UIntPtr]::Zero)
[Irori.Keys]::keybd_event(0x5B, 0, 2, [System.UIntPtr]::Zero)
`;

/**
 * Starts the operating system's dictation in the field that has the focus, so
 * the person's speech is typed there by the system: macOS 音声入力 through the
 * standard "Start Dictation" action, Windows voice typing through Win+H. irori
 * records nothing itself. False on a system without one irori can start.
 */
export async function startDictation(platform = process.platform): Promise<boolean> {
  if (platform === 'darwin') {
    Menu.sendActionToFirstResponder('startDictation:');
    return true;
  }
  if (platform === 'win32')
    return new Promise((resolve) =>
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowsVoiceTyping,
        ],
        { windowsHide: true, timeout: 10000 },
        (error) => resolve(!error),
      ),
    );
  return false;
}
