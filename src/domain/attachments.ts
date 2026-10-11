import { z } from 'zod';

/**
 * Files the person attaches to an instruction: kept in irori's data directory,
 * named in the request by their path, and shown with the message that sent them.
 */
export const attachmentLimit = 10;
/** The largest file one attachment may be. */
export const attachmentByteLimit = 25 * 1024 * 1024;
/** Images a model is shown as pictures, not only told the path of. */
const imageTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
/** The largest image handed to a model inline; a larger one goes by its path alone. */
export const inlineImageByteLimit = 5 * 1024 * 1024;

export const attachmentRef = z.object({
  id: z.uuid(),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => value === attachmentName(value)),
  size: z.number().int().min(0).max(attachmentByteLimit),
});
export type AttachmentRef = z.infer<typeof attachmentRef>;

/** A file name safe to keep: no folders, no control characters, no leading dot. */
export function attachmentName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(-255);
  return clean || 'attachment';
}

/** The image type a model takes the file as, when it is one. */
export function attachmentImageType(name: string) {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return extension ? imageTypes[extension] : undefined;
}

/** A size as the person reads it. */
export function attachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
