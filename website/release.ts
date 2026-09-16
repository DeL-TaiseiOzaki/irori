import { z } from 'zod';
import data from './releases.json';

// Chained string checks all run, so a malformed value must fail rather than throw here.
function isPlainHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
// A release entry is enabled only after an actual installer has been published.
const artifact = z.object({
  url: z.string().url().refine(isPlainHttps, 'Installer URLs must use HTTPS without credentials'),
  size: z.string().min(1),
});
export const releaseSchema = z
  .object({
    version: z.string().min(1).nullable(),
    // The published notes page is part of the manifest so it cannot be left on an older release.
    notes: z
      .string()
      .url()
      .refine(isPlainHttps, 'Notes URLs must use HTTPS without credentials')
      .nullable(),
    downloads: z.object({
      'windows-x64': artifact.nullable(),
      'macos-arm64': artifact.nullable(),
    }),
  })
  .refine(
    (value) =>
      value.version !== null || Object.values(value.downloads).every((item) => item === null),
  )
  .refine(
    (value) => (value.version === null) === (value.notes === null),
    'A published version must name its release notes',
  )
  .refine(
    (value) =>
      Object.entries(value.downloads).every(
        ([platform, item]) =>
          !item ||
          new URL(item.url).pathname
            .toLowerCase()
            .endsWith(platform === 'windows-x64' ? '.exe' : '.dmg'),
      ),
    'Installer extension must match its platform',
  );
export const release = releaseSchema.parse(data);
