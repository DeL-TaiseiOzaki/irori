---
title: Installation
description: Install irori on Windows or Mac and prepare the tools you need.
---

## Supported computers

| OS                   | Download          |
| -------------------- | ----------------- |
| Windows 11, x64      | `.exe` installer  |
| macOS, Apple silicon | `.dmg` disk image |

There are no Windows ARM or Intel Mac distributions. On Linux, [run from source](https://github.com/DeL-TaiseiOzaki/irori/blob/main/docs/DEVELOPMENT.md).

## Install on Windows

1. Get the Windows installer from the [download site](https://irori-ai.com/#download).
2. Open the `.exe` and follow the installation steps.
3. Open irori from the Start menu.

The current preview is unsigned. If SmartScreen appears, verify the download source and choose **More info → Run anyway**.

## Install on Mac

1. Get the Apple silicon build from the [download site](https://irori-ai.com/#download).
2. Open the `.dmg` and move irori to **Applications**.
3. Open irori from Applications.

If macOS blocks the first launch, choose **System Settings → Privacy & Security → Open Anyway**.

## Prepare Git and AI

Install [Git](https://git-scm.com/downloads). AI agents support Claude Code, Codex, OpenCode, Pi, and Hermes Agent. Install and authenticate your chosen CLI first. You do not need an irori account or an irori-specific API key.

The app notifies you when a new build is available. Choose **Update and restart** to install it. Continue with the [quickstart](quickstart.md).
