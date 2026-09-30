# irori documentation website

The public user guide lives at `docs/ja/` (default) and `docs/en/`, beside the
existing download page. Both languages are authored; no runtime translation or
external search service is involved. `npm run dev:website` serves both sites and
`npm run build:website` emits them together into `dist-website/` for the existing
GitHub Pages workflow.

The `privacy` articles describe the current desktop data flows, full Drive
scope, retained local copies, external CLI/model transfers, and separate
deletion controls. They are review drafts until the publisher name, private
privacy contact, and effective date are confirmed. Do not use them as a final
policy or submit them for OAuth verification with unresolved identity details.
Keep storage claims aligned with the implementation: protecting OAuth
credentials does not encrypt every Drive cache, source copy, note, or history.

The `terms` articles are also review drafts. They summarize the existing MIT
license and connected-service requirements; they do not establish a new legal
agreement or invent publisher commitments. Confirm the publisher details and
approve the final wording before using these links in OAuth Branding. Google's
[current Branding help](https://support.google.com/cloud/answer/15549049?hl=en)
says homepage, privacy, and terms links are required for external production
apps, while its [brand verification guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
still calls terms optional. Preparing the link covers the Console requirement
without treating either draft as completed verification evidence.

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
