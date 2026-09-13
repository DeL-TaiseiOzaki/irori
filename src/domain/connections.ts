import { z } from 'zod';

export function mountNameError(name: string): string | undefined {
  if (!name.trim()) return 'フォルダ名を入力してください。';
  if (name !== name.trim() || /[. ]$/.test(name))
    return '名前の前後の空白や末尾のピリオドは使用できません。';
  if (name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name))
    return 'フォルダ名にパス区切りや使用できない文字が含まれています。';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    return 'この名前はWindowsで予約されています。';
  if (new TextEncoder().encode(name).length > 200)
    return 'フォルダ名はUTF-8で200バイト以内にしてください。';
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
    access: z.literal('read-only'),
  })
  .strict();
