import { z } from 'zod';
import { t } from './i18n';

// A name must be usable on every file system irori mounts on: Windows refuses
// these characters and names, and drops a trailing dot or space.
const forbiddenCharacters = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const reservedNames = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
export function mountNameError(name: string): string | undefined {
  if (!name.trim()) return t('フォルダ名を入力してください。', 'Enter a folder name.');
  if (name !== name.trim() || /[. ]$/.test(name))
    return t(
      '名前の前後の空白や末尾のピリオドは使用できません。',
      'The name cannot start or end with a space or end with a period.',
    );
  if (name === '.' || name === '..' || forbiddenCharacters.test(name))
    return t(
      'フォルダ名にパス区切りや使用できない文字が含まれています。',
      'The folder name contains a path separator or a character that is not allowed.',
    );
  if (reservedNames.test(name))
    return t('この名前はWindowsで予約されています。', 'This name is reserved on Windows.');
  if (new TextEncoder().encode(name).length > 200)
    return t(
      'フォルダ名はUTF-8で200バイト以内にしてください。',
      'Keep the folder name within 200 bytes in UTF-8.',
    );
  return undefined;
}
/** Why `name` cannot name a file or folder inside a connected Drive folder, or undefined. */
export function entryNameError(name: string): string | undefined {
  if (!name.trim()) return t('名前を入力してください。', 'Enter a name.');
  if (name !== name.trim() || /[. ]$/.test(name))
    return t(
      '名前の前後の空白や末尾のピリオドは使用できません。',
      'The name cannot start or end with a space or end with a period.',
    );
  if (name === '.' || name === '..' || forbiddenCharacters.test(name))
    return t(
      '名前にパス区切りや使用できない文字が含まれています。',
      'The name contains a path separator or a character that is not allowed.',
    );
  if (reservedNames.test(name))
    return t('この名前はWindowsで予約されています。', 'This name is reserved on Windows.');
  if (new TextEncoder().encode(name).length > 200)
    return t(
      '名前はUTF-8で200バイト以内にしてください。',
      'Keep the name within 200 bytes in UTF-8.',
    );
  return undefined;
}
export const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
export const mountName = z
  .string()
  .refine((value) => !mountNameError(value), 'Invalid mountpoint name');
export const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const cloudDeclaration = z
  .object({
    schemaVersion: z.literal(1),
    mountId: z.uuid(),
    scopeId: z.uuid(),
    provider: z.literal('google-drive'),
    folderId: providerId,
    parentId: providerId,
    driveId: providerId.optional(),
    folderName: z.string().max(1024),
    contentsRoot: z.string().min(1).max(4096),
    name: mountName,
    access: z.enum(['read-only', 'read-write']),
  })
  .strict();
