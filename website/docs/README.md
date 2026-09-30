# irori documentation website

The public user guide lives at `docs/ja/` (default) and `docs/en/`, beside the
existing download page. Both languages are authored; no runtime translation or
external search service is involved. `npm run dev:website` serves both sites and
`npm run build:website` emits them together into `dist-website/` for the existing
GitHub Pages workflow.

## Design

Reference sites, consulted on 2026-09-30:

- [Obsidian Help](https://obsidian.md/help/Home): a short path from installation
  to the first note, with concepts and task guides separate.
- [VS Code documentation](https://code.visualstudio.com/docs): persistent topic
  navigation and feature guides alongside getting started.
- [Orca Note documentation](https://www.orca-studio.com/orcanote-docs/index.html):
  documentation search, a theme control and an article outline. Here, Orca means
  Orca Note, the knowledge app.

The guide uses irori's three layers as its characteristic visual: a compact
Schema / Knowledge / Contents diagram on the introduction. The palette is white
`#ffffff`, navigation grey `#f4f6f8`, graphite `#15171a`, ink `#242930`, ember
`#a85416`, with the existing violet and teal layer colours. Geist carries English
and interface text, Japanese uses the system's Japanese sans-serif, and Geist
Mono is reserved for code. Light is the initial theme; dark is available.

Layout: a quiet header, a persistent left topic navigation, a left-aligned
article of at most 72 characters per line, and an outline on the right. On small
screens navigation becomes a disclosure and the outline collapses above the
article. Typography, whitespace and the layer diagram carry the identity;
repeated badges, promotional copy and decorative animation are omitted.

## Authoring

Add a slug to `navigation.ts` and matching Markdown files under
`content/ja/` and `content/en/`. Each file starts with YAML `title` and
`description`. Use relative `<slug>.md` links between guides, ordinary Markdown,
and level-two headings for article sections. Corresponding sections must have
the same order in both languages: their stable `section-N` anchors preserve the
reading location when switching languages. Build validation checks language
parity, metadata, section parity and internal links.

`build.tsx` renders full HTML with React Markdown and GFM during Vite
configuration. Generated `ja/`, `en/` and `index.html` are ignored. The page text,
navigation and language switch work without JavaScript. JavaScript adds local
full-text search (including Japanese substrings), keyboard navigation, theme
persistence and anchor preservation when switching languages. URLs use relative
paths so direct links work under the `/irori/` GitHub Pages subpath.

Verify with `npm run build:website` and `xvfb-run -a npm run test:website`.
The website smoke includes both language editions, direct links, internal links,
article anchors, search, keyboard controls, themes, mobile navigation and a
JavaScript-disabled reader. Screenshots are in ignored `test-results/`.
