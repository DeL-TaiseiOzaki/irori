import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parse } from 'yaml';
import {
  BookOpen,
  Search,
  Menu,
  ArrowUpRight,
  ChevronRight,
  SunMoon,
  FileText,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { Plugin } from 'vite';
import { groups, pages, languages, labels, type Language, type SearchEntry } from './navigation';

const site = 'https://irori-ai.com/';
interface Article extends SearchEntry {
  body: string;
  group: string;
  sections: string[];
}
const filename = (language: Language, slug: string) =>
  `docs/${language}/${slug === 'index' ? '' : `${slug}/`}index.html`;
const relative = (from: string, to: string) => {
  const result = path.posix.relative(path.posix.dirname(from), to);
  return result || './';
};
const href = (from: string, language: Language, slug: string) =>
  relative(from, filename(language, slug)).replace(/index\.html$/, '') || './';
const plain = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function readArticles(root: string): Article[] {
  const source = path.join(root, 'docs/content');
  const articles = languages.flatMap((language) =>
    pages.map(({ slug, group }) => {
      const raw = readFileSync(path.join(source, language, `${slug}.md`), 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
      if (!match) throw Error(`Missing metadata: ${language}/${slug}`);
      const metadata: unknown = parse(match[1]);
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        !('title' in metadata) ||
        !('description' in metadata) ||
        typeof metadata.title !== 'string' ||
        typeof metadata.description !== 'string'
      )
        throw Error(`Invalid title or description: ${language}/${slug}`);
      const body = match[2];
      const prose = body.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
      const sections = [...prose.matchAll(/^## (.+)$/gm)].map((heading) => heading[1]);
      if (!sections.length || /^# /m.test(prose))
        throw Error(`Use level-two sections: ${language}/${slug}`);
      return {
        language,
        slug,
        group,
        title: metadata.title,
        description: metadata.description,
        body,
        sections,
        text: plain(body),
      };
    }),
  );
  for (const article of articles) {
    const translation = articles.find(
      (other) => other.language !== article.language && other.slug === article.slug,
    )!;
    if (translation.sections.length !== article.sections.length)
      throw Error(`Section parity failed: ${article.slug}`);
    const prose = article.body.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target)) continue;
      if (target.startsWith('screens/')) {
        readFileSync(path.join(root, 'public', target));
        continue;
      }
      const [slugPath, hash] = target.split('#');
      const slug = slugPath ? slugPath.replace(/\.md$/, '') : article.slug;
      const destination = articles.find(
        (other) => other.language === article.language && other.slug === slug,
      );
      if (
        !destination ||
        (hash && !destination.sections.some((_, i) => hash === `section-${i + 1}`))
      )
        throw Error(`Broken guide link: ${article.language}/${article.slug} -> ${target}`);
    }
  }
  return articles;
}

function Document({ article, articles }: { article: Article; articles: Article[] }) {
  const { language, slug } = article;
  const l = labels[language];
  const file = filename(language, slug);
  const local = articles.filter((item) => item.language === language);
  const group = groups.find((item) => item.id === article.group)!;
  const index = pages.findIndex((item) => item.slug === slug);
  const previous = local[index - 1];
  const next = local[index + 1];
  const steps = [
    ['installation', l.step1, l.step1Body],
    ['workspaces', l.step2, l.step2Body],
    ['quickstart', l.step3, l.step3Body],
  ] as const;
  let section = 0;
  const guide = (target: string) => {
    if (/^[a-z]+:/i.test(target)) return target;
    const [name, hash] = target.split('#');
    return (name ? href(file, language, name.replace(/\.md$/, '')) : '') + (hash ? `#${hash}` : '');
  };
  return (
    <html lang={language} data-theme="light">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={article.description} />
        <meta name="color-scheme" content="light dark" />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={`${article.title} | irori ${l.docs}`} />
        <meta property="og:description" content={article.description} />
        <meta property="og:image" content={`${site}og-image.png`} />
        <link rel="canonical" href={site + file.replace(/index\.html$/, '')} />
        {languages.map((lang) => (
          <link
            key={lang}
            rel="alternate"
            hrefLang={lang}
            href={site + filename(lang, slug).replace(/index\.html$/, '')}
          />
        ))}
        <title>{`${article.title} | irori ${l.docs}`}</title>
        <link rel="icon" href={relative(file, '../assets/irori-icon-256.png')} type="image/png" />
        <link rel="stylesheet" href="/docs/style.css" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('irori-docs-theme')==='dark'?'dark':'light'}catch{}document.documentElement.classList.add('js');",
          }}
        />
      </head>
      <body data-language={language} data-slug={slug}>
        <a className="skip" href="#main">
          {l.skip}
        </a>
        <header className="docs-header">
          <a className="docs-brand" href={relative(file, 'index.html')} aria-label="irori">
            <img
              src={relative(file, '../assets/irori-icon-256.png')}
              alt=""
              width="32"
              height="32"
            />
            <span>irori</span>
          </a>
          <a className="docs-wordmark" href={href(file, language, 'index')}>
            {l.docs}
          </a>
          <button
            className="search-trigger js-only"
            id="search-open"
            type="button"
            aria-label={l.search}
            aria-haspopup="dialog"
          >
            <Search size={17} />
            <span>{l.search}</span>
            <kbd id="search-shortcut">Ctrl K</kbd>
          </button>
          <nav className="header-actions" aria-label={l.docs}>
            <a className="download-link" href={relative(file, 'index.html') + '#download'}>
              {l.download}
              <ArrowUpRight size={14} />
            </a>
            <a
              className="language-switch"
              href={href(file, language === 'ja' ? 'en' : 'ja', slug)}
              hrefLang={language === 'ja' ? 'en' : 'ja'}
              lang={language === 'ja' ? 'en' : 'ja'}
            >
              {language === 'ja' ? 'English' : '日本語'}
            </a>
            <button
              className="theme-toggle js-only"
              type="button"
              aria-label={l.theme}
              title={l.theme}
            >
              <SunMoon size={19} />
            </button>
          </nav>
        </header>
        <div className="docs-layout">
          <details className="sidebar" id="guide-navigation" open>
            <summary>
              <Menu size={18} />
              {l.navigation}
              <ChevronRight size={16} />
            </summary>
            <nav className="sidebar-inner" aria-label={l.navigation}>
              {groups.map((item) => (
                <section className="nav-group" key={item.id}>
                  <h2>{item[language]}</h2>
                  {local
                    .filter((page) => page.group === item.id)
                    .map((page) => (
                      <a
                        key={page.slug}
                        href={href(file, language, page.slug)}
                        aria-current={page.slug === slug ? 'page' : undefined}
                      >
                        {page.title}
                      </a>
                    ))}
                </section>
              ))}
              <a className="sidebar-source" href="https://github.com/DeL-TaiseiOzaki/irori">
                GitHub
                <ArrowUpRight size={14} />
              </a>
            </nav>
          </details>
          <main id="main" tabIndex={-1}>
            <div className="article-heading">
              <nav
                className="breadcrumbs"
                aria-label={language === 'ja' ? '現在の位置' : 'Breadcrumb'}
              >
                <a href={href(file, language, 'index')}>
                  <BookOpen size={15} />
                  {l.docs}
                </a>
                <ChevronRight size={13} />
                <span>{group[language]}</span>
              </nav>
              <h1>{article.title}</h1>
              <p className="article-description">{article.description}</p>
            </div>
            <details className="mobile-outline">
              <summary>{l.outline}</summary>
              <Outline article={article} />
            </details>
            {slug === 'index' && (
              <div className="layer-diagram" aria-label="Schema, Knowledge, Contents">
                <div className="diagram-caption">
                  <Layers size={16} />
                  <span>hibachi</span>
                  <span className="diagram-file">my-knowledge/</span>
                </div>
                <div className="diagram-row schema">
                  <Sparkles size={17} />
                  <strong>Schema</strong>
                  <span>{l.schema}</span>
                  <code>AGENTS.md</code>
                </div>
                <div className="diagram-row knowledge">
                  <BookOpen size={17} />
                  <strong>Knowledge</strong>
                  <span>{l.knowledge}</span>
                  <code>notes.md</code>
                </div>
                <div className="diagram-row contents">
                  <FileText size={17} />
                  <strong>Contents</strong>
                  <span>{l.contents}</span>
                  <code>sources.pdf</code>
                </div>
              </div>
            )}
            <article className="article-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => {
                    const id = `section-${++section}`;
                    return (
                      <h2 id={id}>
                        {children}
                        <a
                          className="heading-anchor"
                          href={`#${id}`}
                          aria-label={
                            language === 'ja' ? 'この節へのリンク' : 'Link to this section'
                          }
                        >
                          #
                        </a>
                      </h2>
                    );
                  },
                  a: ({ href: target = '', children }) => <a href={guide(target)}>{children}</a>,
                  img: ({ src = '', alt }) => (
                    <img
                      className="guide-screenshot"
                      src={relative(file, src)}
                      alt={alt}
                      loading="lazy"
                      width="1440"
                      height="873"
                    />
                  ),
                  table: ({ children }) => (
                    <div className="table-scroll">
                      <table>{children}</table>
                    </div>
                  ),
                }}
              >
                {article.body}
              </ReactMarkdown>
            </article>
            {slug === 'index' && (
              <section className="guide-path" aria-label={l.navigation}>
                {steps.map(([target, title, body], i) => (
                  <a href={href(file, language, target)} key={target}>
                    <span className="step-number">{i + 1}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{body}</p>
                    </div>
                    <ChevronRight size={17} />
                  </a>
                ))}
              </section>
            )}
            <nav
              className="article-pagination"
              aria-label={language === 'ja' ? '記事の移動' : 'Article navigation'}
            >
              {previous ? (
                <a href={href(file, language, previous.slug)}>
                  <small>{l.previous}</small>
                  <strong>{previous.title}</strong>
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a href={href(file, language, next.slug)}>
                  <small>{l.next}</small>
                  <strong>
                    {next.title}
                    <ChevronRight size={16} />
                  </strong>
                </a>
              )}
            </nav>
            <footer className="article-footer">
              <span>{l.preview}</span>
              <a href={href(file, language, 'privacy')}>{l.privacy}</a>
              <a href={href(file, language, 'terms')}>{l.terms}</a>
              <a
                href={`https://github.com/DeL-TaiseiOzaki/irori/blob/main/website/docs/content/${language}/${slug}.md`}
              >
                {l.edit}
                <ArrowUpRight size={13} />
              </a>
            </footer>
          </main>
          <aside className="outline-rail" aria-label={l.outline}>
            <div>
              <h2>{l.outline}</h2>
              <Outline article={article} />
              <a
                className="outline-feedback"
                href="https://github.com/DeL-TaiseiOzaki/irori/issues"
              >
                {l.feedback}
                <ArrowUpRight size={13} />
              </a>
            </div>
          </aside>
        </div>
        <dialog id="search-dialog" aria-labelledby="search-label">
          <form method="dialog" className="search-heading">
            <label id="search-label" htmlFor="search-input">
              <Search size={19} />
              {l.search}
            </label>
            <button type="submit" aria-label={l.close}>
              Esc
            </button>
          </form>
          <input
            id="search-input"
            type="search"
            placeholder={l.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-controls="search-results"
          />
          <p id="search-status" role="status">
            {l.searchHint}
          </p>
          <ul id="search-results" aria-label={l.results} />
          <footer className="search-footer">{l.searchKeys}</footer>
        </dialog>
        <script type="module" src="/docs/main.ts" />
      </body>
    </html>
  );
}

function Outline({ article }: { article: Article }) {
  return (
    <nav>
      {article.sections.map((title, i) => (
        <a key={i} href={`#section-${i + 1}`}>
          {plain(title)}
        </a>
      ))}
    </nav>
  );
}

export function documentation(root: string) {
  const source = path.join(root, 'docs/content');
  let articles: Article[] = [];
  function generate() {
    articles = readArticles(root);
    for (const article of articles) {
      const destination = path.join(root, filename(article.language, article.slug));
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(
        destination,
        '<!doctype html>\n' +
          renderToStaticMarkup(<Document article={article} articles={articles} />),
      );
    }
    writeFileSync(
      path.join(root, 'docs/index.html'),
      '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0;url=./ja/"><title>irori ドキュメント</title><link rel="canonical" href="' +
        site +
        'docs/ja/"></head><body><a href="./ja/">日本語ドキュメント</a> / <a href="./en/">English documentation</a></body></html>',
    );
  }
  generate();
  const plugin: Plugin = {
    name: 'irori-documentation',
    resolveId(id) {
      if (id === 'virtual:irori-docs-search') return '\0irori-docs-search';
    },
    load(id) {
      if (id === '\0irori-docs-search')
        return `export default ${JSON.stringify(articles.map(({ body: _body, sections: _sections, group: _group, ...entry }) => entry))}`;
    },
    configureServer(server) {
      server.watcher.add(source);
      server.watcher.on('change', (file) => {
        if (!file.startsWith(source)) return;
        try {
          generate();
          const data = server.moduleGraph.getModuleById('\0irori-docs-search');
          if (data) server.moduleGraph.invalidateModule(data);
          server.ws.send({ type: 'full-reload' });
        } catch (error) {
          server.config.logger.error(String(error));
        }
      });
    },
  };
  return {
    plugin,
    inputs: [
      path.join(root, 'docs/index.html'),
      ...articles.map((article) => path.join(root, filename(article.language, article.slug))),
    ],
  };
}
