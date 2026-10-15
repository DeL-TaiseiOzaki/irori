---
title: Routines
description: Run programs and give instructions to AI in a defined sequence.
---

## Prepare a routine

A routine is a folder containing `routine.yaml` and the files it needs. Put vault jobs in `.irori/routines/<name>/`, or workspace jobs in `routines/<name>/` inside the irori agent's folder.

**New routine** on the routines page makes one from a form: its name, its place, and its steps. **YAML** switches to the text itself. Here is a vault example.

```yaml
name: Review notes
steps:
  - agent: vault
    access: default
    prompt: |
      Read the notes and write a short review in Knowledge_Base/review.md.
```

## Review and run

Open **Routines** in the left rail, between irori mode and the vaults, and choose **Run**. The page also holds **Secrets**, with the agent panel beside it. On the first run and after a file changes, irori shows the contents or diff for review. Choose **Confirm and run** to start.

**Stop** ends the current step and skips later ones. There is no automatic schedule, and routines do not run while irori is closed.

## Write steps

`run` executes a program and `agent` gives instructions to AI. Up to 20 steps run in order and stop at the first failure. Agent steps require `access` and `prompt`. A vault routine uses `agent: vault`; an irori agent routine uses `agent: irori`.

Turn on **JavaScript** under **Routines** in the settings to run JavaScript files. Use, for example, `- run: collect.js` or `- run: [gh, api, notifications]`. Python is not supported yet. Add a program step's secrets in the editor and enter their values there, from the routine's row, or under **Secrets** at the top of the page; values are stored with the operating system's keychain.

Each step receives `IRORI_WORK` for temporary work, `IRORI_STATE` for persistent state, and `IRORI_ROUTINE` for the routine's folder.

## Check results

Results show each step's status, output or AI report, and changed files. Each routine keeps its last 20 runs. **Conversation** opens an AI step's conversation.

If irori exits during a run, its result becomes **Unknown** next time. It is never automatically repeated; check what happened before choosing to run it again.
