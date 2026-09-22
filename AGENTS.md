# irori contributor contract

irori is the independent Electron / React / TypeScript desktop IDE/ADE. It owns
note editing, knowledge and Drive connections, and execution of local CLI
agents. `irori-extention` ended development on 2026-09-18 and remains a readable
design reference; new VS Code compatibility work belongs in irori.
`irori-templete` is the recommended main-KB repository template under development. Keep each
repository's changes and Git history separate.

Within `KB_design`, follow the [workspace contract](../AGENTS.md); shared agent
skills and runtime configuration live at the workspace root. Load only the
context needed for the task:

- Setup and current features: [README](README.md).
- Resuming development or checking completion: [STATUS](docs/STATUS.md),
  [HANDOFF](docs/HANDOFF.md) and the actual Git diff.
- Host or architecture changes: [initial host decision](docs/decisions/001-initial-host.md).
- Product behavior: relevant [decisions](docs/decisions/) and
  [acceptance backlog](docs/ACCEPTANCE.md). The initial specifications in
  `../docs/irori/` are historical; current decisions and implementation records
  take precedence.

For every new feature, create a dedicated branch from the current integration
branch before implementation. Verify the change, commit and push the feature
branch, then open a pull request targeting `main`. Do not commit or push new
features directly to `main`; leave the PR open unless merging is authorized.
This supersedes older handoff wording about direct commit/push authorization.

`main` and the published preview stay in step. A pull request that changes what
ships, as `scripts/release-policy.ts` decides, advances the version in
`package.json` and `package-lock.json` past the latest published preview. It also
adds `docs/releases/<version>-preview.1.md`; CI enforces both. After merging such
a change, publish it as [DISTRIBUTION](docs/DISTRIBUTION.md) describes, or tell
the owner why it is not published. The owner has authorized agents to publish
previews after an authorized merge. Signing identities, notarization, non-preview
releases and account changes still need separate authorization.

Keep filesystem/process operations behind `src/domain/types.ts`'s `HostAPI`.
Never expose raw IPC, Node access or shell execution to document content.
Use disposable KBs for mutation tests. Keep credentials, provider transcripts
and machine paths out of tracked evidence.

For code changes, `npm run build` and `npm test` are required; also run
`npm run test:ui` for renderer changes. Documentation-only changes need link
and diff checks. Real provider tests use the user's existing CLI account and
may consume its allowance; run them only when agent execution testing is
authorized. Do not bypass provider permissions or modify authentication to
make a test pass. Mocks and model-API chat cannot substitute for a real local
CLI acceptance test.

Respond in Japanese; write code, identifiers, technical documents and commit
messages in English.
