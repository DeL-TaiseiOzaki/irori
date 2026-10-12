// Writes website/releases.json from a published preview, so the download page offers exactly
// what GitHub serves. website.yml runs it before every build; the committed file is only the
// default for local builds and tests.
// Usage: tsx website/manifest.ts [tag]   (the latest published preview when no tag is named)
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestPreview } from '../scripts/release-policy';
import { releaseSchema } from './release';

export interface PublishedRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface PublishedAsset {
  name: string;
  size: number;
  state: string;
  browser_download_url: string;
}

export function sizeLabel(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

export function manifestFor(release: PublishedRelease, assets: PublishedAsset[]) {
  const version = /^v(\d+\.\d+\.\d+)-preview\.\d+$/.exec(release.tag_name)?.[1];
  if (!version) throw new Error(`${release.tag_name} is not a preview tag`);
  if (release.draft || !release.prerelease)
    throw new Error(`${release.tag_name} is not a published prerelease`);
  const installer = (name: string) => {
    const asset = assets.find((item) => item.name === name && item.state === 'uploaded');
    return asset ? { url: asset.browser_download_url, size: sizeLabel(asset.size) } : null;
  };
  const downloads = {
    'windows-x64': installer(`irori-${version}-windows-x64-Setup.exe`),
    'macos-arm64': installer(`irori-${version}-macos-arm64.dmg`),
  };
  if (!downloads['windows-x64'] && !downloads['macos-arm64'])
    throw new Error(`${release.tag_name} has no uploaded installer`);
  return releaseSchema.parse({ version, notes: release.html_url, downloads });
}

async function api(route: string) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('Set GITHUB_REPOSITORY');
  const token = process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repo}/${route}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${route}`);
  return response.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let tag: string | undefined = process.argv[2];
  if (!tag) {
    const releases: PublishedRelease[] = await api('releases?per_page=100');
    tag = latestPreview(releases.filter((item) => !item.draft).map((item) => item.tag_name))?.tag;
    if (!tag) throw new Error('No published preview exists');
  }
  const release = await api(`releases/tags/${tag}`);
  // The release's own assets endpoint: GitHub's release list has served a new release
  // without its files for over half an hour.
  const assets: PublishedAsset[] = await api(`releases/${release.id}/assets?per_page=100`);
  const manifest = manifestFor(release, assets);
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'releases.json');
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`website/releases.json now offers ${tag}:`);
  console.log(JSON.stringify(manifest, null, 2));
}
