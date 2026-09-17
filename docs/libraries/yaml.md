# yaml

> **Last Updated**: 2026-09-17
> **Version Checked**: 2.9.1

## Overview

`yaml` parses the YAML front matter in KB-declared `SKILL.md` files. It replaces
the former line-oriented parser so skill authors can use ordinary YAML quoting,
comments and folded descriptions without irori maintaining a partial YAML
grammar.

## Core Features

The package supports YAML 1.2, checks key uniqueness by default, reports source
locations in parse errors and has no runtime dependencies. irori uses the simple
`parse()` API with the failsafe schema so metadata scalars remain strings:

```ts
parse(source, { schema: 'failsafe', logLevel: 'error', stringKeys: true });
```

Zod then validates the required `name` and `description`; extra metadata remains
available to the YAML parser but is not interpreted by irori.

## Constraints & Notes

- `yaml` is a direct, exactly pinned runtime dependency. Vite and Electron Forge
  mentioning it as an optional peer did not make it available to the app.
- The 16 KiB UTF-8 limit is checked before parsing. YAML parsing does not replace
  irori's scope, alias or package-count checks.
- Parsing is synchronous and appropriate for these bounded files. Syntax and
  duplicate-key errors are surfaced as unreadable skill problems.
- Only `name` and `description` affect irori today. Optional skill resources and
  provider-specific UI metadata remain separate files in the skill package.

## References

- [yaml v2 documentation](https://eemeli.org/yaml/)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [yaml source repository](https://github.com/eemeli/yaml)
