# Third-party reuse and notices

This preview depends on installed npm packages; exact versions and integrity hashes are pinned in package-lock.json. Do not remove license/notice files from dependencies or the Electron/Chromium distribution when creating installers.

Two kinds of package ship. The packages the host process loads at run time travel under `node_modules` with their own licence files; packaging keeps exactly those the built host requires and their dependencies (`forge.config.cjs`). The renderer's packages are bundled into `dist/` by Vite and do not ship as directories: the build writes `dist/third-party-notices.txt` inside the package, naming every package Rollup loaded a module from, with its version, the licence its package.json declares and the text of its licence files (`scripts/third-party-notices.ts`). Rows marked "bundled" below refer to that file.

| Reuse | License/notice location |
|---|---|
| node-pty, default-shell, which | MIT, each package LICENSE; node-pty ConPTY assets retain upstream notices. Only the target platform's prebuild is packaged; the others cannot be loaded there |
| xterm.js and FitAddon | MIT, bundled |
| rclone 1.75.1 | MIT, assets/rclone-LICENSE.txt; also shipped with the binary in vendor/rclone/LICENSE.txt |
| fflate | MIT, development-only ZIP extraction; package LICENSE |
| React / React DOM, Base UI, lucide-react, react-error-boundary, react-resizable-panels, react-markdown and remark-gfm with their remark, micromark, mdast and hast dependencies | MIT, bundled |
| Electron | MIT, node_modules/electron/LICENSE; binary distribution LICENSE and LICENSES.chromium.html |
| Milkdown Crepe and Milkdown packages, with their ProseMirror, remark and Vue runtime dependencies | MIT, bundled; DOMPurify (`MPL-2.0 OR Apache-2.0`) and d3-ease (`BSD-3-Clause`) are the only non-MIT/ISC entries in the notices |
| CodeMirror and Lezer packages | MIT, bundled |
| React Flow (`@xyflow/react` / `@xyflow/system`) and Dagre | MIT, bundled; graph projection is loaded on demand |
| Papa Parse, Zod | MIT, package LICENSE files — the host loads both — and bundled, so also named in the notices |
| Chokidar, cross-spawn, tree-kill | MIT, package LICENSE files |
| OpenCode SDK, eventsource-parser | MIT, each package LICENSE; the SDK is loaded in the host on demand |
| write-file-atomic | ISC, node_modules/write-file-atomic/LICENSE.md; signal-exit retains its ISC license |
| yaml | ISC, node_modules/yaml/LICENSE; used for standards-compatible skill front matter and has no runtime dependencies |
| Claude Agent SDK | `SEE LICENSE IN README.md`; node_modules/@anthropic-ai/claude-agent-sdk/README.md and linked provider terms. Do not describe it as MIT. The controller runs the user's separately installed unmodified Claude Code executable. The SDK's optional `claude-agent-sdk-<platform>` packages, each carrying a complete Claude Code binary under Anthropic's own terms, are removed while packaging: irori never resolves them, so no Claude Code executable is redistributed. |
| Node.js development runtime | node_modules/node/node_modules/node-bin-setup and platform binary distribution notices; development dependency, not an independently chosen irori binary-redistribution license |
| TypeScript, Vite, esbuild, tsx, Playwright and types | Development dependencies; preserve each upstream license when distributing relevant files |

No Claudian runtime source or code from claudian-orchestra-template was copied. Their role was reference/design evidence. irori-extention's older default layer engine was not imported because it encodes the superseded four-layer/path-derived identity model. Its scope/contents regression scenarios were adapted into tests/irori-extention.test.ts, credited below; the new domain implementation follows the current design invariants.

irori-extention reference: revision `2a2e7e04ee2d393584682669303457211ff7711c`, `src/test/unit/scopes.test.ts`, `src/scopes.ts`, `src/layers.ts` and `.claude/docs/DESIGN.md`. Template reference: `fa74f2a14665459b63ed98566b5f833627d728be`. Both were unchanged at inspection.

## irori-extention MIT notice (adapted test scenarios)

MIT License

Copyright (c) 2026 Taisei Ozaki

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

irori is MIT licensed; see [LICENSE](../LICENSE). Electron Forge and its makers are development tools; their package licenses remain installed with the build dependencies. `electron-squirrel-startup` is MIT licensed and ships as a runtime dependency with its notices. The package smoke emits an inventory of actual packaged dependencies and asserts that no Claude SDK native binary package is among them, that only the packages the built host requires — and what they depend on — are packaged, and that `dist/third-party-notices.txt` is present and names every other production dependency at its installed version. The binaries irori still redistributes are rclone and node-pty's native code for the target platform. Native-binary redistribution review, signing and provider-distribution review remain release gates.
