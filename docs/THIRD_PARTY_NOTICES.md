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
| Motion (`motion`, `framer-motion`, `motion-dom`, `motion-utils`) | MIT, bundled; used for ObsidianUI tab indicators |
| ObsidianUI Magnet Tabs and Arrow Fill Button | Adapted source in `src/app/obsidian/`; full MIT notice below |
| Geist and Geist Mono variable fonts 1.7.2 (from the `geist` npm package) | SIL Open Font License 1.1; the woff2 files and `OFL.txt` are in `src/app/fonts/`, bundled into `dist/assets/`; full notice below |
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

## ObsidianUI MIT notice (adapted renderer components)

Magnet Tabs and Arrow Fill Button were retrieved from the official
[Magnet Tabs registry](https://www.obsidianui.dev/r/magnet-tabs.json) and
[Arrow Fill Button registry](https://www.obsidianui.dev/r/arrow-fill-button.json)
on 2026-09-22. Upstream repository:
[ObsidianUI at 21d9198](https://gitlab.com/Atharvsinh-codez/ObsidianUI/-/tree/21d9198d14fd663f809cbea9fe124efc9576c003).
The adaptations preserve the visual mechanisms and use irori's tokens,
Base UI keyboard behavior and native button semantics. See
[ADR 007](decisions/007-obsidian-ui.md).

MIT License

Copyright (c) 2026 ObsidianUI

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

## Geist and Geist Mono (SIL Open Font License 1.1)

The renderer bundles `Geist-Variable.woff2` and `GeistMono-Variable.woff2`,
unchanged, from the [`geist`](https://www.npmjs.com/package/geist) package 1.7.2
([vercel/geist-font](https://github.com/vercel/geist-font)). See
[ADR 014](decisions/014-ui-v5.md).

```text
Copyright (c) 2023 Vercel, in collaboration with basement.studio

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
