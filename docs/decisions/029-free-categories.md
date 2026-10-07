# 029 — A hibachi's category is any name

Date: 2026-10-08. Status: owner request; implemented for 0.1.87.
Amends [ADR 014](014-ui-v5.md) D2 and its brain identity section, where the
category was one of personal, team and organization and the Overview map
grouped brains by it.

## Context

On 2026-10-07 the owner said that three categories are too few and that people
should be able to set up categories freely. The category was a closed set in
every layer: the `scope.json` schema, the HostAPI requests, the `irori`
command, the registration select and the settings segments, the icons and the
Overview's rows.

## Decisions

1. **A category is a short name of the KB's own.** `.irori/scope.json` keeps it
   as written: one line of 1–40 characters, without control characters or
   leading and trailing spaces (`categoryText`). It stays optional.
2. **The three presets remain** as `personal`, `team` and `organization`, shown
   in the reader's language with their own icons. A preset's name typed in
   Japanese or English (`チーム`, `Team`, `team`) is stored as the preset, so
   two devices in different languages share one category. Any other name is
   shown as written with a tag icon.
3. **One field picks or names a category.** Registration and the hibachi
   settings offer the presets and the categories the workspace's hibachis
   already carry, and accept a new name. In the settings an empty field is no
   category; at registration it is `personal`, as before.
4. **The irori mode map does not group by category.** On 2026-10-08 the owner
   said the hibachis there need not be shown by category. The map lays them out
   in the workspace's order, four to a row, without category areas or their
   legend entry; the rail's named groups (0.1.69) are how a person arranges
   hibachis. A hibachi's column still shows its category beside its name.
5. `irori add|create|clone --category` takes any such name and maps preset names
   the same way.

## Consequences

- A `scope.json` with a category other than the presets cannot be opened by
  irori 0.1.86 and earlier, as a declaration without one could not be opened by
  0.1.39 and earlier.
- A pulled declaration with a new category is accepted by the same check as
  any other change that keeps the identity (ADR 028).
- irori-templete reads `category` for its lint and init rules. Its ADR 007
  ([irori-templete #14](https://github.com/DeL-TaiseiOzaki/irori-templete/pull/14))
  gives a category outside the presets the personal discipline.
