# File viewer libraries

> **Last Updated**: 2026-09-26
> **Version Checked**: pdfjs-dist 6.3.289, docx-preview 0.4.1, @jvmr/pptx-to-html 1.1.2, xlsx (SheetJS) 0.20.3

## Overview

irori shows PDF, Word, PowerPoint, spreadsheet and image files on the stage
instead of sending them to the external application. The host only reads bytes:
`viewerBytes` in `HostAPI` checks the extension (`src/domain/viewers.ts`) and
the 100 MiB limit, and resolves the path with the same scope and Drive checks
as the editor. Each format's library runs in the sandboxed renderer and is
loaded only when a file of that format is opened (`src/app/viewers/`).
Nothing is written back; editing stays in the external application.

| Format | Extensions | Library | Output |
| --- | --- | --- | --- |
| PDF | `.pdf` | `pdfjs-dist` | Canvas per page with a selectable text layer, drawn when near the viewport |
| Word | `.docx` | `docx-preview` | DOM built with `createElement`, paged, in a shadow root |
| PowerPoint | `.pptx` | `@jvmr/pptx-to-html` | One HTML string per slide, scaled by irori, in a shadow root |
| Spreadsheet | `.xlsx` `.xlsm` `.xls` `.ods` | `xlsx` (SheetJS) | Displayed cell text (`sheet_to_json` with `raw: false`) in irori's own table |
| Image | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` `.bmp` `.avif` | — | `<img>` from a data URL |

Older binary Office formats (`.doc`, `.ppt`) still open in the external application.

## Constraints & Notes

- **CSP.** The renderer's CSP refuses `fetch`, frames and non-`data:` images.
  pdf.js normally fetches its CMaps (needed by most Japanese PDFs whose fonts are
  not embedded), standard fonts and image-decoder wasm by URL. `PdfView.tsx`
  instead bundles them as lazy `?inline` chunks (`import.meta.glob`) and hands
  them over through pdf.js's `BinaryDataFactory` with `useWorkerFetch: false`;
  `vite.config.ts` lists `.bcmap`, `.pfb` and `.wasm` in `assetsInclude`. The
  scripting sandbox wasm (`quickjs-eval.wasm`) is deliberately not bundled, and
  `isEvalSupported: false` and `enableXfa: false` are set.
- **pdf.js worker.** `GlobalWorkerOptions.workerSrc` points at the worker file
  Vite emits; it runs as a module worker from the packaged `file://` page.
- **Untrusted markup.** `docx-preview` escapes text but copies hyperlink targets;
  `pptx-to-html` produces HTML strings and escapes text. Both outputs pass through
  `safe-dom.ts`, which parses without executing, removes scripts, frames, forms
  and `on*` attributes, keeps `href` only for `http(s):`, `mailto:` and `#`, and
  image sources only for `data:image/`. Link clicks open `http(s)` in the browser
  through `openUrl`; the window never navigates. `renderAltChunks` is off.
- **SheetJS source.** The npm registry's `xlsx` stops at 0.18.5, which has known
  prototype-pollution and ReDoS advisories. SheetJS publishes current releases
  only on its own CDN, so `package.json` pins
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` and the lockfile records
  its integrity. `npm ci` needs that host to be reachable.
- **Packaging.** These are renderer packages: Vite bundles them into `dist/`,
  and `forge.config.cjs` prunes `node_modules` to what the host bundle needs.
  `pdfjs-dist` brings the optional `@napi-rs/canvas` for Node, which the
  renderer never loads and the package never ships.
- **Notices.** `scripts/third-party-notices.ts` also copies licence files kept
  in a package's subfolder that the bundle loaded from, which is how pdf.js's
  `cmaps/`, `standard_fonts/` (Foxit, Liberation) and `wasm/` (OpenJPEG, JBIG2,
  QCMS) licences reach `dist/third-party-notices.txt`.
- **Fidelity.** These are previews, not Office. Word layout follows
  `docx-preview` (fonts embedded in the document are not applied inside the
  shadow root); PowerPoint covers text, pictures, tables, basic shapes and common
  charts, not animations, SmartArt or every theme effect; spreadsheets show values
  as Excel formats them, with merges, but not cell colours, charts or images.
  Spreadsheets parse on the renderer's main thread.

## References

- [PDF.js](https://mozilla.github.io/pdf.js/) and its `getDocument` options
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs)
- [pptx-to-html](https://github.com/javier-mora/pptx-to-html)
- [SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)
