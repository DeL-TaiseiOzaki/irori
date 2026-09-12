# irori contributor contract

This is an independent repository. Do not modify or combine the histories of the two sibling reference repositories.

Read README.md, docs/STATUS.md and docs/decisions/001-initial-host.md before continuing substantial work. Product requirements live in ../docs/irori when this checkout is inside KB_design; docs/ACCEPTANCE.md preserves the implementation backlog here.

Communicate with the user in Japanese. Write identifiers, technical documents and commit messages in English. Keep filesystem/process operations behind src/domain/types.ts's HostAPI. Never expose raw IPC, Node access, or shell execution to document content. Never substitute mocked/model-API chat for a real local CLI acceptance test.

Use disposable KBs for mutation tests. Keep credentials, provider transcripts and machine paths out of tracked evidence. npm run build and npm test are required for code changes; use npm run test:ui for renderer changes. Real provider tests are opt-in and use the user's existing CLI account; run them only when agent execution testing is authorized. They may consume the native account's allowance. Do not bypass provider permissions or modify authentication to make a test pass.
