---
title: 同期フォルダ
description: Google Drive・Dropbox・Box・iCloud・OneDrive のアプリが同期するフォルダを、hibachi の資料として使います。
---

## 仕組み

各サービスの公式アプリは、クラウドのフォルダをこのコンピューターに同期します。irori はその中のフォルダを hibachi の Contents に表示し、ノートとして編集し、hibachi agent に渡します。irori はクラウドに直接接続しません。同期はサービスのアプリが行います。

## 準備

使うサービスのアプリを入れて、ログインします。

| サービス | アプリ | 主な場所 |
| --- | --- | --- |
| Google Drive | [パソコン版 Google ドライブ](https://www.google.com/drive/download/) | Mac: `~/Library/CloudStorage/GoogleDrive-…`、Windows: `G:\マイドライブ` |
| Dropbox | [Dropbox](https://www.dropbox.com/install) | `~/Dropbox` |
| Box | [Box Drive](https://www.box.com/resources/downloads) | `~/Box` |
| iCloud Drive | Mac 標準・[Windows 用 iCloud](https://support.apple.com/ja-jp/103232) | Finder の iCloud Drive |
| OneDrive | Windows 標準・[Mac 版](https://www.microsoft.com/microsoft-365/onedrive/download) | `~/OneDrive` |

使うフォルダは、ファイルをこのコンピューターにも保存しておく設定にします（Google ドライブの **ミラーリング**、各サービスのオフライン設定など）。クラウドにだけあるファイルは、ダウンロードされるまで読めないことがあります。

## フォルダを接続する

1. hibachi の **接続** を開き、**このコンピューター** を選びます。
2. **フォルダを選ぶ** から、同期フォルダの中のフォルダを選びます。
3. Contents に表示する名前を確認し、**登録して接続** を押します。

ワークスペースを開くと自動で接続し、irori を終了するか別のワークスペースに切り替えると Contents から外れます。元のフォルダとファイルはそのまま残ります。別のコンピューターでは、**フォルダを選び直す** でそのコンピューターの同じフォルダを選びます。

## 注意

- 一つのフォルダを複数の同期サービスで同時に同期しないでください。競合やデータの破損の原因になります。
- hibachi 自体や、hibachi を含むフォルダは接続できません。
- irori で削除したファイルは、システムのごみ箱に移ります。クラウド側の履歴やごみ箱は各サービスの機能です。
- AI に渡したファイルは、使う CLI とその提供者に送られます。[AI エージェント](agents.md)を確認してください。
- 会社のアカウントでは、管理者が同期アプリを制限している場合があります。

Google アカウントで直接つなぐ [Google Drive 接続](drive.md)は、招待したテストユーザー向けです。
