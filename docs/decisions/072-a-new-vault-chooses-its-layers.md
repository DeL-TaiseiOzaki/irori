# 072 — A new vault chooses its layers, and is asked for no category

Date: 2026-11-24. Status: owner decision; implemented for 0.2.96.
Builds on [ADR 070](070-a-vault-chooses-its-layers.md) (a vault chooses its
layers) and [ADR 071](071-a-vaults-own-files-in-contents.md) (a vault's own
files in Contents). Keeps [ADR 029](029-free-categories.md): a vault may carry a
category of any name, or none.

## Context

After ADR 070 a vault for code took two steps: register it, then open its
settings and leave Knowledge out. Until the second step it was shown as a
knowledge base, its code listed as notes.

The forms that make a vault also asked for a category under a folded
**分類** — personal, team, organization or a name of the vault's own — and wrote
`personal` when nothing was chosen, so nearly every vault said 個人. Asked on
2026-11-24 whether a new vault should choose its layers where it is made, the
owner answered that the choice of personal or organization at creation had
become an empty form and was not needed.

## Decisions

1. **The forms that make a vault offer its layers.** Opening a folder, cloning
   from GitHub, creating a new vault and choosing a folder on an SSH host all
   show **この vault が持つ層**: Schema, always on, and a checkbox each for
   Knowledge and Contents, both on at first. It is the same control as in the
   vault's settings (`LayerChoice`).
2. **The choice goes into the declaration irori writes.** `register` takes the
   layers and writes `layers` into a new `.irori/scope.json`; both layers, as
   always, write no field. A folder that already holds a vault's declaration is
   taken as it is: its name, category and layers are its own, and the form's
   are not applied, as its name never was.
3. **No category is asked, and none is written unless given.** The 分類 field is
   gone from those forms. A new vault carries no category; the vault's settings
   still give it one, of any name, as before. Existing vaults keep theirs.
4. **Agents have the same.** `irori clone`, `irori create` and `irori add` take
   `--layers`, as `irori set` does, and their `--category` stays optional
   without a default. `irori list` and `irori set` name a category only when
   the vault has one.
5. **A vault on an SSH host is declared the same way.** `registerVault` in the
   vault host's protocol carries an optional category and the layers. The host
   program is the one this irori sends, so both ends change together.

## Consequences

- A vault registered by 0.2.96 or later has no 個人 mark unless the person
  gives it a category. Places that show a category already leave it out when
  there is none.
- `host.register`, `host.registerRemote` and `createSpace` take the category as
  optional; callers that pass one are unchanged.
- The start screen's and the SSH form's lists of categories are no longer
  needed there; the settings still offer the workspace's categories.
