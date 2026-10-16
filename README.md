<div align="center">

<img src="assets/irori-icon.png" alt="" width="112" height="112">

# irori

**ノートから、次の仕事へ。**

知識を書きためるノートと、その続きを進めるローカルの AI エージェントを、ひとつの画面にまとめたデスクトップアプリです。

**日本語** | [English](README.en.md)

<a href="https://del-taiseiozaki.github.io/irori/"><img src="https://img.shields.io/badge/%E2%AC%87%20%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89-irori%20for%20Windows%20%26%20Mac-c2410c?style=for-the-badge" alt="irori をダウンロード"></a>

[![Release](https://img.shields.io/github/v/release/DeL-TaiseiOzaki/irori?include_prereleases&label=release)](https://github.com/DeL-TaiseiOzaki/irori/releases)
[![CI](https://github.com/DeL-TaiseiOzaki/irori/actions/workflows/app.yml/badge.svg)](https://github.com/DeL-TaiseiOzaki/irori/actions/workflows/app.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey.svg)](#ダウンロード)

[ダウンロード](https://del-taiseiozaki.github.io/irori/) ・
[ドキュメント](https://del-taiseiozaki.github.io/irori/docs/ja/) ・
[リリースノート](https://github.com/DeL-TaiseiOzaki/irori/releases) ・
[はじめかた](#はじめかた) ・
[フィードバック](#フィードバック) ・
[開発に参加する](#開発に参加する)

<img src="docs/images/readme/ja-note-and-ai.png" alt="irori の画面。左に vault のファイル（Schema・Knowledge・Contents）、中央にノート、右に AI パネル。" width="860">

</div>

---

irori は、Markdown のノートを中心に仕事を進めるための **知識の IDE / ADE** です。

ノートを置いたフォルダを **vault**（知識ベース。旧 hibachi）として開くと、ノートの編集、資料の閲覧、Git での記録、Google Drive の資料までをひとつの画面で扱えます。そのうえで、パソコンに入っている **Claude Code・Codex・OpenCode・Pi・Hermes Agent** を、その vault の中でそのまま動かし、ノートの続きを頼めます。

ノートはいつでも手元のフォルダにある普通の Markdown ファイルです。AI は各 CLI の認証と設定をそのまま使うため、irori 独自のアカウントや API キーは要りません。

## ダウンロード

**[ダウンロードサイト](https://del-taiseiozaki.github.io/irori/)** からインストーラーを入手してください。

| プラットフォーム | ファイル |
| --- | --- |
| **Windows 11**（x64） | インストーラー `.exe` |
| **macOS**（Apple Silicon） | ディスクイメージ `.dmg` |

- 現在は **検証版（preview）** で、配布用の署名はありません。
  - Windows では「発行元を確認できません」という警告が出ます。
  - Mac では初回の起動が止められます。「システム設定 → プライバシーとセキュリティ」で「このまま開く」を一度押してください。
- 一度入れれば、新しい版が出たときにアプリが知らせてくれます。「更新して再起動」を押すだけで更新できます。
- Windows ARM 版と Intel Mac には対応していません。Linux ではソースから実行できます（[開発ガイド](docs/DEVELOPMENT.md)）。

## はじめかた

1. **準備する。** [Git](https://git-scm.com/downloads) を入れます。AI を使う場合は、使いたい CLI（`claude` / `codex` / `opencode` / `pi`）もインストールしてログインしておきます。ノートを書くだけなら CLI は要りません。
2. **vault を追加する。** 起動画面の **KBフォルダを開く** で手元のフォルダを選ぶか、**GitHub から取得** でリポジトリをクローンします。既存のファイルは移動しません。
3. **ワークスペースを作る。** 使う vault にチェックを入れて **ワークスペースを作成** を押します。個人・チーム・組織の vault を自由に組み合わせられます。
4. **書いて、頼む。** ノートを開いて書き、右上の **AIに相談** から AI に続きを依頼します。AI が許可を求めたときは、パネルに確認が表示されます。

## 主な機能

**vault とワークスペース**
- vault は **Knowledge**（ノート）と **Contents**（資料）で整理されます。vault agent をオンにすると **Schema**（AI への指示やスキル）の層も表示されます（**設定 → エージェント**）。
- vault パネルの **横に vault を開く** で、別の vault を横に並べられます。Knowledge どうしでファイルやフォルダをドラッグして移動でき、リンクが切れるときは件数を示して確認します。
- 複数のワークスペースを画面上端のタブで同時に開けます。**＋** かレールのロゴで起動画面に戻り、別のワークスペースを開くと新しいタブになります。裏のタブの AI は動き続け、タブを閉じるとそのタブだけの AI が止まります。
- **irori mode**（旧「全体」）で、ワークスペース内の vault を vault map か並べた表示で見渡せます。検索もすべての vault をまたいでできます。
- どの層のファイルやフォルダも、右クリック（または「…」）で開く・パスをコピー・相対パスをコピー・ファイルマネージャーで表示ができます。
- Knowledge と Contents のファイル一覧は、エクスプローラーや Finder のように使えます。右クリックか「…」から、フォルダや任意のファイルを作る・ほかの場所から追加する・名前の変更・移動・削除ができます。ドラッグで移動、Finder やエクスプローラーからファイルやフォルダをドロップして追加。Knowledge では移動してもリンクが書き換わります。
- vault ごとに名前・分類・アイコン・色を設定できます。同じ画面から vault を削除できます。フォルダは残すか、ゴミ箱に移すかを選べます。

**ノート**
- 見たまま編集できる Markdown エディタです。自動で保存し、画像を貼り付けるとノートの隣の `_assets/` に入ります。
- 相対リンクをたどったり、参照元（バックリンク）を一覧したりできます。名前や場所を変えると、リンクも一緒に書き換わります。
- Markdown ファイルにコメントを残せます。選択した箇所か、ノート全体へ。コメントは vault の `.irori/comments/` に Git で共有され、vault agent と irori agent が読みます。
- **今日のノート** を、決めた場所とテンプレートで開けます。
- CSV は表で表示できます。オントロジーは階層やグラフとして表示できます。

**AI エージェント**
- 右側の AI パネルには会話を何列でも並べられ、幅も自由に広げられます。本文を隠してエージェントだけを表示することもできます。
- **vault agent**（各 vault の AI、オプション）：Claude Code・Codex・OpenCode・Pi・Hermes Agent を、その vault の Schema を読み込んだ状態で起動します。複数の vault agent を同時に動かせます。モデルは、入っている CLI が示す一覧から選べます（Hermes Agent は名前を入力）。
- **irori agent**（旧「あなたの AI」）：irori mode で、vault をまたぐ仕事を頼めます。どの CLI でも動きます。依頼を vault ごとに分け、各 vault の agent に渡します。Claude Code・Codex・OpenCode では irori が定義するサブエージェント（`vault-<名前>`）、Pi と Hermes Agent では `irori call` を使います。結果はまとめて報告します。vault agent と同じくフルアクセスで始まり、自分の Schema も同じ設定画面で編集できます。
- **irori の操作をエージェントにも**：irori agent と vault agent は `irori` コマンドで、ノートの移動（リンクやコメントも追従）・ゴミ箱・コメント・索引の更新・vault の設定を、画面と同じように行えます。vault agent が扱えるのは自分の vault だけです。
- **ほかのツールから移る**：Obsidian・orca・エディタなどを使っていた場合は、irori agent に「移りたい」と頼んでください。Obsidian の vault やフォルダを調べ、どれを vault・Knowledge・Contents にするか、Git やワークスペースをどうするかを聞き取ってから、計画どおりに設定します。
- 許可の扱いは各 CLI の設定に従います。vault agent は、CLI が対応していればフルアクセスで始まり、標準（CLI の設定・必要なときに承認）に切り替えられます。
- 会話は vault ごと・irori agent ごとにいくつでも持て、この PC に丸ごと残ります。**新しい会話** と **履歴**（名前の変更・ピン留め・アーカイブ・削除）があります。同じ vault の会話はタブで開き、それぞれ同時に実行できます。実行中の会話への指示は送信待ちとして予約でき、再起動しても残ります（[CONVERSATIONS](docs/CONVERSATIONS.md)）。
- 指示にはファイルを添付でき（クリップ・ドロップ・画像の貼り付け）、画像はエージェントにそのまま見せます。マイクで OS の音声入力を起動できます。エージェントからの質問は選択肢として表示されます（[ADR 032](docs/decisions/032-chat-attachments-dictation-questions.md)）。
- vault ごとに作業フォルダがあり、エージェントは下書き・中間ファイル・試しのスクリプトをそこに置きます。既定は vault の `.irori/work`（Git の対象外）で、vault の設定の **作業フォルダ** でほかのフォルダに変えられます（[ADR 042](docs/decisions/042-waiting-folders-and-work-folders.md)）。
- 返答に出てきたファイルのパスはリンクになり、押すとそのファイルがメインの画面で開きます（行番号があればその行）。インラインコードのパスと、Claude Code・Codex が書くファイルへのリンクのどちらも対象です。
- **ルーティン**：左のレールの irori mode と vault の間にある **ルーティン** で、手順をフォームで作り、シークレットを管理し、決めた手順を「実行」できます。手順はフォルダの `routine.yaml` に保存され（irori agent の `routines/` か vault の `.irori/routines/`）、プログラムの実行と AI エージェントへの指示を順に並べます。プログラムは JavaScript と、Python を追加すれば `.py` も動きます。初めて動かすときと中身が変わったときは、ファイルを確認してから動きます（[ROUTINES](docs/ROUTINES.md)）。

**資料**
- PDF・Word（.docx）・PowerPoint（.pptx）・Excel などのスプレッドシート（.xlsx/.xlsm/.xls/.ods）・画像を、外部アプリに切り替えず画面内で表示します。表示専用で、編集は元のアプリで行います。
- Google Drive・Dropbox・Box・iCloud・OneDrive のアプリが同期するフォルダを、vault の Contents として接続できます。irori からも、その vault agent からも編集できます。Google Drive は[パソコン版 Google ドライブ](https://www.google.com/drive/download/)を使います。ドライブの準備が irori の起動より遅れても、フォルダが現れると自動で接続します。

**記録と道具**
- **変更** タブで差分の確認・コミット・履歴の閲覧ができます。強制的な上書きや自動の stash は行いません。
- vault のフォルダで開く内蔵ターミナルがあります。
- テーマ（システムに合わせる・いろり・ライト・ダーク）、Markdown のフォント、ノートの左右の余白（標準・小・最小）、表示言語（日本語 / English）を切り替えられます。
- **設定 → アカウント**（起動画面の **設定** からも開けます）に、irori が使う GitHub アカウント（GitHub CLI `gh` のログイン）を表示します。**環境を保存** で、GitHub にある vault・ワークスペース・表示と AI の設定・irori agent のルーティンを、そのアカウントの非公開リポジトリ `irori-settings` に保存します。別の PC では起動画面の **GitHub から環境を復元** で、まとめて取得できます。

<div align="center">
<img src="docs/images/readme/ja-overview.png" alt="irori mode の画面。irori agent と、チーム・組織に分かれた 3 つの vault を vault map に表示している。" width="860">
</div>

## 現在の状態

irori は **検証版（preview）** です。main に入った変更は検証版としてすぐに公開しています。

- Windows 11 / macOS の実機での受け入れ確認（インストール、日本語入力、CLI 連携、Google Drive）を続けています。まずは使い捨てのフォルダやコピーでお試しください。
- 配布用の署名（Windows の署名、Apple の Developer ID・notarization）は未対応です。

詳しい進み具合は [STATUS](docs/STATUS.md)、確認済みの範囲は [ACCEPTANCE](docs/ACCEPTANCE.md) にあります。

## フィードバック

- 不具合の報告や要望は [GitHub Issues](https://github.com/DeL-TaiseiOzaki/irori/issues) へお願いします。
- 報告には、画面に表示されているバージョン・OS・実際のメッセージを添えてください。
- ノートの本文、認証情報、OAuth の URL は載せないでください。

## 開発に参加する

ソースからの実行、検証の手順、設計の記録は **[開発ガイド（docs/DEVELOPMENT.md）](docs/DEVELOPMENT.md)** にまとめています。

```sh
git clone https://github.com/DeL-TaiseiOzaki/irori.git
cd irori
npm ci
npm run setup:electron
npm run build
npm start
```

- Node.js 24.15 以上（24.x）または 26 以上が必要です。
- コントリビューターの取り決めは [AGENTS.md](AGENTS.md) にあります。
- 開発を引き継ぐ場合は [HANDOFF](docs/HANDOFF.md) から始めてください。

## 関連プロジェクト

- [irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete)：irori で使う vault（知識ベース）のおすすめテンプレートです。

## ライセンス

[MIT License](LICENSE)。依存ライブラリはそれぞれのライセンスに従います（[THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md)）。
