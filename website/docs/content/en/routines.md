---
title: Routines
description: Run programs and give instructions to AI in a defined sequence, and keep those routines.
---

## Prepare a routine

A routine is a folder containing `routine.yaml` and the files it needs. Put vault jobs in `.irori/routines/<name>/`, or workspace jobs in `routines/<name>/` of the irori agent's default folder (`~/irori/you`). Workspace jobs stay there even when a workspace chooses another folder for the irori agent.

**New routine** on the routines page makes one from a form: its name, its place, and its steps. **YAML** switches to the text itself. **Ask the irori agent** on the same page puts “Write a routine:” in the irori agent's instruction box instead; finish the request and send it. The irori agent writes the routine with its `write-routine` skill and checks that irori can read it. Here is a vault example.

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

You can also ask the irori agent to run a routine, such as “run Daily mail”. irori asks you before it starts. The irori agent starts only a routine reviewed on this device and unchanged since; otherwise it tells you what to do on the routines page, such as reviewing the routine or entering a missing secret. It never sees the routine's secrets or what its programs print. Vault agents and a routine's own agent steps cannot start routines.

**Stop** ends the current step and skips later ones. Closing the workspace tab a routine started from does not stop it. There is no automatic schedule, and routines do not run while irori is closed.

## Write steps

`run` executes a program and `agent` gives instructions to AI. Up to 20 steps run in order and stop at the first failure. Agent steps require `access` and `prompt`. A vault routine uses `agent: vault`; an irori agent routine uses `agent: irori`.

Turn on **JavaScript** under **Routines** in the settings to run JavaScript files. Use, for example, `- run: collect.js` or `- run: [gh, api, notifications]`. For Python files, turn on **Python** in the same place: irori downloads uv and runs them with `uv run --script`. A routine that needs either shows **Add JavaScript** or **Add Python** on its row. Add a program step's secrets in the editor and enter their values there, from the routine's row, or under **Secrets** at the top of the page. Values are sealed with this user account's operating-system keychain and given only to the program steps that name them. irori does not hand them to agents, but cannot stop a program running as the same user, an agent with a shell in full access included, from reading them.

A secret's value in a step's output shows as `***` in the run record. A step that refreshes a token writes `NAME=value` lines to the file `IRORI_SECRETS_OUT` names, and later runs use the new values. Only the secrets the step names are written back; any other line fails the step.

Each step receives `IRORI_WORK` for temporary work, `IRORI_STATE` for persistent state, and `IRORI_ROUTINE` for the routine's folder.

## Check results

Results show each step's status, output or AI report, and changed files. Each routine keeps its last 20 runs. **Conversation** opens an AI step's conversation.

If irori exits during a run, its result becomes **Unknown** next time. It is never automatically repeated; check what happened before choosing to run it again.

## Edit, delete, and move routines

The pencil, **Edit**, on a routine's row opens its editor. **Open the folder** there shows the routine's folder in the system's file manager, where a program step's files go. A changed routine is reviewed again before it runs.

**Delete** in the editor, pressed again as **Delete it**, moves the routine's folder to the system trash. Its review, run history and `IRORI_STATE` on this device go with it, so a routine made later in the same folder starts unreviewed. A running routine is not deleted.

A vault's routines travel with the vault's repository. The irori agent's routines are part of the [environment saved on GitHub](settings.md#section-6). Routine secrets are saved there too only with a passphrase of 12 characters or more, which seals them. A restored routine is reviewed before its first run on the new device.
