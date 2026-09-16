import { release } from './release';

const platforms = [
  {
    id: 'windows-x64',
    title: 'Windows',
    architecture: 'Intel / AMD（64 ビット）',
    label: 'WINDOWS',
  },
  {
    id: 'macos-arm64',
    title: 'Mac',
    architecture: 'Apple シリコン（M シリーズ）',
    label: 'MACOS',
  },
  {
    id: 'macos-x64',
    title: 'Mac',
    architecture: 'Intel プロセッサ',
    label: 'MACOS',
  },
] as const;
const container = document.querySelector<HTMLDivElement>('#downloads')!;
for (const platform of platforms) {
  const item = release.downloads[platform.id];
  const card = document.createElement('article');
  card.className = 'download-card';
  card.dataset.platform = platform.id;
  // Only static local labels enter markup. Manifest values are assigned as text/URL properties.
  card.innerHTML = `<div class="platform-icon">${platform.label}</div><h3>${platform.title}</h3><p class="architecture">${platform.architecture}</p>`;
  if (item) {
    const link = document.createElement('a');
    link.className = 'button primary';
    link.href = item.url;
    link.textContent = `${platform.title} 用をダウンロード ↓`;
    link.setAttribute('aria-label', `${platform.title} ${platform.architecture} 用をダウンロード`);
    card.append(link);
    const info = document.createElement('p');
    info.className = 'artifact-info';
    info.textContent = `v${release.version} · ${item.size}`;
    card.append(info);
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.disabled = true;
    // A slot is empty because nothing is published for it, which is not a promise
    // that something is on its way.
    button.textContent = '未公開';
    card.append(button);
  }
  container.append(card);
}
if (Object.values(release.downloads).some(Boolean)) {
  document.querySelector('#release-status')!.textContent =
    `v${release.version} 開発プレビュー — 実機での動作確認用です。`;
}
if (release.notes) {
  // Assigned as a URL property; the manifest keeps this link on the published release.
  document.querySelector<HTMLAnchorElement>('#release-notes')!.href = release.notes;
}
