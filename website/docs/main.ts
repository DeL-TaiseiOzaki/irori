import entries from 'virtual:irori-docs-search';
import { labels, type Language } from './navigation';

const language = document.body.dataset.language as Language;
const l = labels[language];
const articles = entries.filter((entry) => entry.language === language);
const root = new URL(document.body.dataset.slug === 'index' ? '../' : '../../', location.href);
const dialog = document.querySelector<HTMLDialogElement>('#search-dialog')!;
const input = document.querySelector<HTMLInputElement>('#search-input')!;
const results = document.querySelector<HTMLUListElement>('#search-results')!;
const status = document.querySelector<HTMLParagraphElement>('#search-status')!;
const normal = (value: string) => value.normalize('NFKC').toLocaleLowerCase(language);

function search() {
  const query = input.value.trim();
  const terms = normal(query).split(/\s+/).filter(Boolean);
  results.replaceChildren();
  if (!terms.length) {
    status.textContent = l.searchHint;
    return;
  }
  const matches = articles
    .map((article) => {
      const fields = [article.title, article.description, article.text].map(normal);
      const score = terms.every((term) => fields.some((field) => field.includes(term)))
        ? terms.reduce(
            (sum, term) => sum + (fields[0].includes(term) ? 6 : fields[1].includes(term) ? 3 : 1),
            0,
          )
        : 0;
      return { article, score };
    })
    .filter((match) => match.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  status.textContent = matches.length
    ? `${matches.length} ${language === 'ja' ? '件の記事' : 'articles'}`
    : l.empty;
  for (const { article } of matches) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = new URL(
      `${language}/${article.slug === 'index' ? '' : `${article.slug}/`}`,
      root,
    ).href;
    const title = document.createElement('strong');
    title.textContent = article.title;
    const excerpt = document.createElement('span');
    const offset = Math.max(0, normal(article.text).indexOf(terms[0]) - 35);
    excerpt.textContent = (offset ? '…' : '') + article.text.slice(offset, offset + 115) + '…';
    link.append(title, excerpt);
    row.append(link);
    results.append(row);
  }
}
function openSearch() {
  if (!dialog.open) dialog.showModal();
  input.focus();
  input.select();
}
document.querySelector('#search-open')!.addEventListener('click', openSearch);
dialog.addEventListener('close', () =>
  document.querySelector<HTMLButtonElement>('#search-open')!.focus(),
);
input.addEventListener('input', search);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (dialog.open) dialog.close();
    else openSearch();
  }
});
dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    dialog.close();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const links = [...results.querySelectorAll('a')];
  if (!links.length) return;
  event.preventDefault();
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next =
    event.key === 'ArrowDown'
      ? (current + 1) % links.length
      : current <= 0
        ? links.length - 1
        : current - 1;
  links[next].focus();
});
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (
    event.target === dialog &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    dialog.close();
});
if (/Mac|iPhone|iPad/.test(navigator.userAgent))
  document.querySelector('#search-shortcut')!.textContent = '⌘ K';

document.querySelector('.theme-toggle')!.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('irori-docs-theme', theme);
  } catch {
    /* Still works when storage is disabled. */
  }
});
document
  .querySelector<HTMLAnchorElement>('.language-switch')!
  .addEventListener('click', (event) => {
    const link = event.currentTarget as HTMLAnchorElement;
    link.hash = location.hash;
  });

const navigation = document.querySelector<HTMLDetailsElement>('#guide-navigation')!;
const wide = matchMedia('(min-width: 1000px)');
const setNavigation = () => {
  navigation.open = wide.matches;
};
setNavigation();
wide.addEventListener('change', setNavigation);
const activeLink = navigation.querySelector<HTMLElement>('[aria-current="page"]');
if (wide.matches && activeLink) activeLink.scrollIntoView({ block: 'nearest' });

const observer = new IntersectionObserver(
  (intersections) => {
    const heading = intersections.find((item) => item.isIntersecting);
    if (!heading) return;
    for (const link of document.querySelectorAll('.outline-rail a[href^="#"]')) {
      if (link.getAttribute('href') === `#${heading.target.id}`)
        link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  },
  { rootMargin: '-80px 0px -55% 0px' },
);
document.querySelectorAll('.article-body h2').forEach((heading) => observer.observe(heading));
