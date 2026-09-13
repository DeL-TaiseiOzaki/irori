# Third-party reuse and notices

This preview depends on installed npm packages; exact versions and integrity hashes are pinned in package-lock.json. Do not remove license/notice files from dependencies or the Electron/Chromium distribution when creating installers.

| Reuse | License/notice location |
|---|---|
| React / React DOM | MIT, each package's LICENSE |
| Electron | MIT, node_modules/electron/LICENSE; binary distribution LICENSE and LICENSES.chromium.html |
| Milkdown Crepe and Milkdown packages | MIT, package LICENSE files; ProseMirror/remark dependencies retain their own notices |
| CodeMirror packages | MIT, package LICENSE files |
| Chokidar, cross-spawn, tree-kill, Zod | MIT, package LICENSE files |
| OpenCode SDK, eventsource-parser | MIT, each package LICENSE; the SDK is loaded in the host on demand |
| write-file-atomic | ISC, node_modules/write-file-atomic/LICENSE.md; signal-exit retains its ISC license |
| Claude Agent SDK | `SEE LICENSE IN README.md`; node_modules/@anthropic-ai/claude-agent-sdk/README.md and linked provider terms. Do not describe it as MIT. The controller runs the user's separately installed unmodified Claude Code executable. |
| Node.js development runtime | node_modules/node/node_modules/node-bin-setup and platform binary distribution notices; development dependency, not an independently chosen irori binary-redistribution license |
| TypeScript, Vite, esbuild, tsx, Playwright and types | Development dependencies; preserve each upstream license when distributing relevant files |

No Claudian runtime source or code from claudian-orchestra-template was copied. Their role was reference/design evidence. LayeredKB's older default layer engine was not imported because it encodes the superseded four-layer/path-derived identity model. Its scope/contents regression scenarios were adapted into tests/layeredkb.test.ts, credited below; the new domain implementation follows the current design invariants.

LayeredKB reference: revision `2a2e7e04ee2d393584682669303457211ff7711c`, `src/test/unit/scopes.test.ts`, `src/scopes.ts`, `src/layers.ts` and `.claude/docs/DESIGN.md`. Template reference: `fa74f2a14665459b63ed98566b5f833627d728be`. Both were unchanged at inspection.

## LayeredKB MIT notice (adapted test scenarios)

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

irori is MIT licensed; see [LICENSE](../LICENSE). Electron Forge and its makers are development tools; their package licenses remain installed with the build dependencies. `electron-squirrel-startup` is MIT licensed and ships as a runtime dependency with its notices. The package smoke emits an inventory of actual packaged dependencies, including optional Claude SDK native binary packages. Native-binary redistribution review, signing and provider-distribution review remain release gates.
