---
title: インストール
description: Windows または Mac に irori を入れ、使う道具を準備します。
---

## 対応するパソコン

| OS                   | 配布ファイル            |
| -------------------- | ----------------------- |
| Windows 11・x64      | `.exe` インストーラー   |
| macOS・Apple Silicon | `.dmg` ディスクイメージ |

Windows ARM と Intel Mac の配布版はありません。Linux では[ソースから実行](https://github.com/DeL-TaiseiOzaki/irori/blob/main/docs/DEVELOPMENT.md)できます。

## Windows に入れる

1. [ダウンロードサイト](https://irori-ai.com/#download)で Windows 版を入手します。
2. `.exe` を開き、インストールを進めます。
3. スタートメニューから irori を開きます。

現在の検証版は未署名です。SmartScreen が表示された場合は、配布元を確認して **詳細情報 → 実行** を選びます。

## Mac に入れる

1. [ダウンロードサイト](https://irori-ai.com/#download)で Apple Silicon 版を入手します。
2. `.dmg` を開き、irori を **Applications** に移します。
3. Applications から irori を開きます。

初回の起動が止められた場合は、**システム設定 → プライバシーとセキュリティ → このまま開く** を選びます。

## Git と AI を準備する

[Git](https://git-scm.com/downloads)をインストールします。AI は Claude Code・Codex・OpenCode・Pi・Hermes Agent に対応しています。使う CLI を先にインストールし、その CLI で認証を済ませます。irori 専用のアカウントや API キーは必要ありません。

新しい版が出るとアプリが知らせます。**更新して再起動** で更新できます。次は[クイックスタート](quickstart.md)へ進んでください。
