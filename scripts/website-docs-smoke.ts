import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { pages, languages, labels } from '../website/docs/navigation';

/** Real built HTML, served under a project subpath without an SPA fallback. */
export async function checkDocumentation(page: Page) {
  const output = path.resolve('dist-website');
  const prefix = '/irori/';
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      assert(pathname.startsWith(prefix));
      const suffix = pathname.slice(prefix.length) + (pathname.endsWith('/') ? 'index.html' : '');
      const file = path.resolve(output, suffix);
      assert(file.startsWith(output + path.sep));
      const bytes = await readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}${prefix}`;
  const doc = (language: string, slug = 'index') =>
    `${root}docs/${language}/${slug === 'index' ? '' : slug + '/'}`;
  const broken: string[] = [];
  const responseListener = (response: { url(): string; status(): number }) => {
    if (response.url().startsWith(root) && response.status() >= 400) broken.push(response.url());
  };
  page.on('response', responseListener);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(root);
    await page.getByRole('link', { name: 'Docs', exact: true }).click();
    await page.waitForURL(doc('ja'));
    assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
    await page.locator('#guide-navigation[open]').waitFor();
    await page.screenshot({ path: 'test-results/irori-docs-desktop-ja.png', fullPage: true });
    await page.goto(`${root}docs/`);
    await page.waitForURL(doc('ja'));

    // Every article is complete HTML, with valid headings, assets and local links.
    const links = new Set<string>();
    for (const language of languages) {
      for (const article of pages) {
        await page.goto(doc(language, article.slug));
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(
          await page.title(),
          `${await page.locator('h1').innerText()} | irori ${labels[language].docs}`,
        );
        assert((await page.locator('.article-body').innerText()).length > 150);
        assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 1);
        assert.equal(
          await page.locator('.sidebar [aria-current="page"]').getAttribute('href'),
          './',
        );
        assert(await page.locator('link[rel="alternate"][hreflang="ja"]').count());
        assert(await page.locator('link[rel="alternate"][hreflang="en"]').count());
        const destinations = await page
          .locator('a[href]')
          .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
        destinations.filter((url) => url.startsWith(root)).forEach((url) => links.add(url));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (article.slug === 'daily-notes') {
          assert.equal(
            await page.locator('.article-body h2').count(),
            3,
            'Code examples must not become outline entries',
          );
          assert.equal(await page.locator('.outline-rail nav a').count(), 3);
        }
        if (article.slug === 'quickstart') {
          await page.locator('.guide-screenshot').evaluate(async (img) => {
            await (img as HTMLImageElement).decode();
          });
        }
      }
    }
    const documents = new Map<string, string>();
    for (const link of links) {
      const url = new URL(link);
      const hash = url.hash;
      url.hash = '';
      const target = url.href;
      let html = documents.get(target);
      if (!html) {
        const response = await page.request.get(target);
        assert.equal(response.status(), 200, `Local link: ${link}`);
        html = await response.text();
        documents.set(target, html);
      }
      if (hash) assert(html.includes(`id="${hash.slice(1)}"`), `Missing anchor: ${link}`);
    }

    // Language switching preserves the article and current section in both directions.
    await page.goto(doc('ja', 'agents') + '#section-3');
    await page.getByRole('link', { name: 'English', exact: true }).click();
    await page.waitForURL(doc('en', 'agents') + '#section-3');
    assert.equal(await page.locator('h1').innerText(), 'AI agents');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.getByRole('link', { name: '日本語', exact: true }).click();
    await page.waitForURL(doc('ja', 'agents') + '#section-3');
    await page.goBack();
    await page.waitForURL(doc('en', 'agents') + '#section-3');

    // Japanese substrings and English body text both navigate to the right edition.
    await page.goto(doc('ja'));
    await page.getByRole('button', { name: labels.ja.search }).click();
    await page.locator('#search-input').fill('未送信分');
    await page.locator('#search-results a').first().waitFor();
    assert((await page.locator('#search-results').innerText()).includes('Google Drive'));
    await page.locator('#search-input').fill('存在しない検索語xyz');
    assert.equal(await page.locator('#search-results li').count(), 0);
    assert.equal(await page.locator('#search-status').innerText(), labels.ja.empty);
    await page.locator('#search-input').fill('Google Drive');
    await page.locator('#search-results a').first().waitFor();
    await page.keyboard.press('ArrowDown');
    assert(
      await page
        .locator('#search-results a')
        .first()
        .evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press('Enter');
    await page.waitForURL(doc('ja', 'drive'));
    await page.keyboard.press('Control+k');
    await page.locator('#search-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search-dialog[open]').count(), 0);
    // HTMLDialogElement dispatches close asynchronously; wait for its focus restoration.
    await expect(page.locator('#search-open')).toBeFocused();
    await page.goto(doc('en', 'notes'));
    await page.keyboard.press('Control+k');
    await page.locator('#search-input').fill('not sent to Drive');
    await page.locator('#search-results a').first().waitFor();
    assert(
      (await page.locator('#search-results a').first().getAttribute('href'))?.startsWith(doc('en')),
    );
    await page.screenshot({ path: 'test-results/irori-docs-search-en.png' });
    await page.keyboard.press('Escape');

    // Theme choice survives reloads and language navigation.
    await page.getByRole('button', { name: labels.en.theme }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('link', { name: '日本語', exact: true }).click();
    await page.waitForURL(doc('ja', 'notes'));
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.screenshot({ path: 'test-results/irori-docs-desktop-dark.png', fullPage: true });
    await page.getByRole('button', { name: labels.ja.theme }).click();

    // Mobile disclosure, links, tables and code stay within the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(doc('ja'));
    assert.equal(await page.locator('#guide-navigation[open]').count(), 0);
    await page.locator('#guide-navigation > summary').click();
    await page.locator('.sidebar').getByRole('link', { name: 'ルーティン', exact: true }).click();
    await page.waitForURL(doc('ja', 'routines'));
    assert.equal(await page.locator('#guide-navigation[open]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'test-results/irori-docs-mobile-ja.png', fullPage: true });
    await page.getByRole('link', { name: 'English', exact: true }).click();
    await page.waitForURL(doc('en', 'routines'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: labels.en.search }).click();
    await page.locator('#search-input').fill('routine');
    await page.locator('#search-results a').first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Escape');
    await page.goto(doc('ja'));
    await page.setViewportSize({ width: 320, height: 720 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(broken, []);
    console.log(
      `Documentation smoke passed: ${pages.length * languages.length} static articles, ${links.size} links, project subpath, both locales, anchors, search, keyboard, themes and mobile.`,
    );
  } finally {
    page.off('response', responseListener);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
