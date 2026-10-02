---
title: Troubleshooting
description: What to check when startup, AI, saving, or connections do not work.
---

## The app will not start

Check that you have the Windows 11 x64 or Apple silicon Mac build. The preview is unsigned; see [installation](installation.md) for the first-launch steps.

If it was already installed, record the error and app version. Report the situation below before deleting application data to try again.

## AI is unavailable

Check that the chosen CLI starts from a terminal and is authenticated. irori uses that CLI; installing the app does not install it for you.

Answer any permission request or question waiting in the panel. Use **Resume sending** if the queue is paused. See [AI agents](agents.md) for model and access settings, and [conversations](conversations.md) for resume conditions.

## Saving or folder connections fail

For a save conflict, check whether another app or agent changed the same file. Compare the incoming text with your draft and preserve needed text before resolving it.

For a connected folder, check its state and that the original folder still exists, then use **Reconnect** or **Choose folder again**. Check syncing in the service's own app. See [synced folders](sync-folders.md).

## Report a problem

Include the following in [GitHub Issues](https://github.com/DeL-TaiseiOzaki/irori/issues):

- irori version and operating system
- Actions taken and expected result
- The message actually displayed
- Whether it can be reproduced

Leave out note contents, credentials, and OAuth URLs. The [implementation status](https://github.com/DeL-TaiseiOzaki/irori/blob/main/docs/STATUS.md) records the scope of existing verification.
