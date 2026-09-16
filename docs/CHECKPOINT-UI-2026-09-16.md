# Checkpoint — renderer UI work, 2026-09-15/16

Source-only work. No installer, release or website change: the published Windows
preview remains `v0.1.5-preview.1`, recorded in [CHECKPOINT](CHECKPOINT.md).

## What the owner asked for

Make the UI carry its weight, and stop hand-writing what a library does better.
The work then continued into what that exposed: first the defects it surfaced,
then the three items recorded as open in
[UI findings](UI-FINDINGS-2026-09-15.md).

## Merged into `main`

Each pull request was verified locally, passed CI on its own head, and was merged
after that. `main` at `7f2e922accf561190c98b97cd66ab852590716b0` passed
[CI 34996781058](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34996781058)
as merged, including all three package platforms.

| PR                                                      | Implementation commit                                                                  | CI                                                                               | Subject                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [#9](https://github.com/DeL-TaiseiOzaki/irori/pull/9)   | `d980085735c99f08389679edbc7e119a168b80c6`                                             | [34941284194](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34941284194) | Design tokens, dark palette, lucide icons, resizable panes, Base UI popup behaviour ([ADR 003](decisions/003-ui-foundation.md))    |
| [#10](https://github.com/DeL-TaiseiOzaki/irori/pull/10) | `c03c0fad4b53b03d1eca63fd92d914b1885f1874`                                             | [34948062969](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34948062969) | Markdown assistant replies, Japanese Crepe chrome, toggle groups, error boundary ([ADR 004](decisions/004-ui-library-adoption.md)) |
| [#11](https://github.com/DeL-TaiseiOzaki/irori/pull/11) | `549ffa058e972c70ce2745627dad14432def8e19`, `47f10dbb43c096d86cec5438e26051820a78522a` | [34950931985](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34950931985) | Findings recorded; popover focus; commit diff no longer discarded                                                                  |
| [#12](https://github.com/DeL-TaiseiOzaki/irori/pull/12) | `150a32c18420ef6c8315edda4041f39a35af36c5`                                             | [34985665911](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34985665911) | Status read dependency, in-place review refresh, silent click, format gate                                                         |
| [#13](https://github.com/DeL-TaiseiOzaki/irori/pull/13) | `0d9a842f3efbf90c9183934d3016c534a643a029`                                             | [34989535229](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34989535229) | Coalesced repeated reads of the file under review                                                                                  |
| [#14](https://github.com/DeL-TaiseiOzaki/irori/pull/14) | `135e573b5c5d4f39967048a4e0fa8e33ee5935f5`                                             | [34991729278](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34991729278) | `openUrl`, validated twice, for links in a reply                                                                                   |
| [#15](https://github.com/DeL-TaiseiOzaki/irori/pull/15) | `0a19b3a0ca4ffd21014f8dfb78ef4106a57ed18e`                                             | [34995919294](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/34995919294) | Appearance choice and device settings; two persistence faults fixed                                                                |

## Defects found and fixed along the way

Three of these were shipped behaviour, not test noise:

- A commit diff was discarded by the changes view's generation counter, leaving
  `差分を読み込み中…` with nothing left to complete it. CI reproduced it.
- A status read skipped while a merge draft was unsaved never happened, because
  the condition was not a dependency, so the panel kept reporting the old
  unresolved count after the conflict was resolved.
- Pane sizes were never restored: browser storage is not kept between sessions on
  a file URL, and the layout was written under the rendered panel identifiers
  while being read under a fixed list. [ADR 003](decisions/003-ui-foundation.md)
  is corrected in place.

One platform limit is worth carrying forward: `nativeTheme.themeSource` does not
reach `prefers-color-scheme` in this Linux environment, so the renderer resolves
the theme itself into `data-theme`. Following a dark desktop would otherwise have
shown the light palette.

## State at this checkpoint

Local verification on `main`: build, typecheck, `npm run format:check`,
**141 behaviour tests (134 passed, seven environment-gated skips)** and all
**twelve Electron UI suites** under Xvfb. `git-ui-smoke` was additionally run six
times consecutively while its intermittent failures were being tracked down.

Nothing from [UI findings](UI-FINDINGS-2026-09-15.md) is left open. The single
deliberate exception is that Markdown documents are outside the formatting gate,
so `prettier --check .` still fails on them by design.

## Next

Product behaviour changes deferred on purpose, in the order they were prioritised
with the owner: split the assistant panel into conversation and activity
surfaces, show an agent's edits as a reviewable diff in the note, then a ⌘K
command palette. Each needs its own branch and its own acceptance evidence; none
of them is started.

An owner device check is still outstanding from the previous delivery: install
the 0.1.5 EXE over 0.1.4 on Windows. This session did not touch it.
