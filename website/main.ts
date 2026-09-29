import { release } from './release';

const platforms = [
  {
    id: 'windows-x64',
    title: 'Windows',
    detail: 'Windows 11 · x64 (Intel / AMD)',
    file: 'Installer (.exe)',
  },
  {
    id: 'macos-arm64',
    title: 'macOS',
    detail: 'Apple silicon (M series)',
    file: 'Disk image (.dmg)',
  },
] as const;
type PlatformId = (typeof platforms)[number]['id'];

// A hint only: every download stays on the page, and a Mac's architecture is not visible here.
function detectPlatform(): PlatformId | null {
  const agent = navigator.userAgent;
  if (/Windows NT/.test(agent) && !/ARM64/i.test(agent)) return 'windows-x64';
  if (/Macintosh|Mac OS X/.test(agent) && !/iPhone|iPad/.test(agent)) return 'macos-arm64';
  return null;
}
const detected = detectPlatform();

// Static inline marks; manifest values never enter markup.
const icons: Record<PlatformId, string> = {
  'windows-x64':
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.1 10.4 4v7.2H3zM11.4 3.9 21 2.5v8.7h-9.6zM3 12.2h7.4v7.3L3 18.4zM11.4 12.2H21v8.9l-9.6-1.4z"/></svg>',
  'macos-arm64':
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9s-1.8-.8-3-.8C7 7.4 5.6 8.3 4.8 9.7c-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.6-1-2.6-3.8zM14.1 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.3z"/></svg>',
};

const container = document.querySelector<HTMLDivElement>('#downloads')!;
for (const platform of platforms) {
  const item = release.downloads[platform.id];
  const card = document.createElement('article');
  card.className = 'download-card';
  card.dataset.platform = platform.id;
  if (platform.id === detected) card.classList.add('detected');
  card.innerHTML = `<div class="platform-icon">${icons[platform.id]}</div><h3>${platform.title}</h3><p class="architecture">${platform.detail}</p>`;
  if (platform.id === detected) {
    const badge = document.createElement('span');
    badge.className = 'detected-badge';
    badge.textContent = 'Your device';
    card.prepend(badge);
  }
  if (item) {
    const link = document.createElement('a');
    link.className = `button ${platform.id === detected || !detected ? 'ember' : 'ghost'}`;
    link.href = item.url;
    link.textContent = `Download for ${platform.title} ↓`;
    link.setAttribute('aria-label', `Download irori for ${platform.title}, ${platform.detail}`);
    card.append(link);
    const info = document.createElement('p');
    info.className = 'artifact-info';
    info.textContent = `v${release.version} · ${item.size}`;
    const file = document.createElement('p');
    file.className = 'artifact-file';
    file.textContent = platform.file;
    card.append(info, file);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button ghost';
    button.disabled = true;
    // A slot is empty because nothing is published for it, which is not a promise
    // that something is on its way.
    button.textContent = 'Not available';
    card.append(button);
  }
  container.append(card);
}

if (release.version && Object.values(release.downloads).some(Boolean)) {
  document.querySelector('#release-status')!.textContent =
    `Version ${release.version} · testing preview for Windows and Mac. Free, and open source.`;
  document.querySelector('#hero-version-text')!.textContent =
    `v${release.version} preview is out — see what's new`;
  if (release.notes)
    document.querySelector<HTMLAnchorElement>('#hero-version')!.href = release.notes;
}
const heroItem = detected ? release.downloads[detected] : null;
if (detected && heroItem) {
  const platform = platforms.find((entry) => entry.id === detected)!;
  const hero = document.querySelector<HTMLAnchorElement>('#hero-download')!;
  hero.href = heroItem.url;
  hero.textContent = `Download for ${platform.title} ↓`;
  document.querySelector('#hero-meta')!.textContent =
    `v${release.version} · ${heroItem.size} · ${platform.detail} · Other platforms below`;
}
if (release.notes) {
  // Assigned as a URL property; the manifest keeps this link on the published release.
  document.querySelector<HTMLAnchorElement>('#release-notes')!.href = release.notes;
}
