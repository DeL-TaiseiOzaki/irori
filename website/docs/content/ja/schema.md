---
title: Schema の設定
description: AI への指示・スキル・ルール・フック・サブエージェントを、vault ごとに、またはすべてのエージェントに共通のファイルとして整えます。
---

## 設定を開く

vault の Schema は **設定 → エージェント → vault agent** で vault agent をオンにしたときだけ表示されます。

vault の **Schema** にある項目を選ぶと、中央に設定フォームが開きます。各グループの追加操作で新しい項目を作れます。フォルダのアイコンで **ファイルとして表示** に切り替えられます。ファイル表示では、F2 またはメニューの **名前を変更** でファイルやフォルダの名前を変え、**削除** または Delete キーでシステムのゴミ箱に移せます。`.irori` と `.git` は中身ごとそのまま残ります。

| 項目   | 保存するファイル                                |
| ------ | ----------------------------------------------- |
| 指示   | `AGENTS.md`                                     |
| スキル | `.agents/skills/<name>/SKILL.md` と添付ファイル |
| ルール | `.claude/rules/*.md`                            |
| フック | `.claude/settings.json` の `hooks`              |

ルールとフックは Claude Code の形式で書きますが、どの CLI にも届きます。Claude Code は自分で読み込んで実行します。ほかの CLI には、irori がルールを依頼の中で渡し、フックを Claude Code と同じ意味で実行します。CLI によっては実行できないフックがあります（Hermes Agent ではツールの実行前に止める PreToolUse など）。そのようなフックがあると、irori は実行前に一度確認し、フックが変わるまでその答えを使います。何かを止めることのないイベント（PostCompact など）のフックは、実行できないことを知らせるだけです。各 CLI への届き方は、設定のルールとフックの欄に表示されます。

## スキルを作る・使う

スキルには名前、説明、指示を入れます。名前は小文字・数字・ハイフンで、フォルダ名と一致させます。必要なテキストファイルを添付できます。

AI パネルのスキル選択で選んでから送ると、指示がその依頼に添えられます。役割やプロジェクトが定義されている場合は、それらで絞れます。読めないスキルには **要確認** が表示されます。

スキルを選ばなくても、`.agents/skills` のスキルはどの CLI にも届きます。Codex・OpenCode・Antigravity CLI は自分で読み込み、Claude Code と Pi には irori が渡し、Hermes Agent には irori が依頼の中で伝えます。vault のホームの Schema のカードで **スキル** の横にある **到達確認** で、各スキルが各 CLI にどう届くか、同じ名前の個人用スキルが優先されるかを確かめられます。

## ファイルとして共有する

設定は vault 内の普通のファイルなので、[Git](git.md)で共有できます。irori agent の Schema も同じ方法で編集できます。

フックはプログラムを実行する設定です。使う CLI とコマンドの内容を確認してから保存してください。削除操作には確認が表示されます。ここに出るのは `.claude/settings.json` のフックだけです。`env`・`apiKeyHelper`・`.mcp.json`・OpenCode や Pi のプラグイン・接続したフォルダの `.claude` など、実行される設定はほかにもあります。vault のそれらが変わったときは、エージェントの実行前に irori が一覧で確認します。

## 共通 Schema

**共通 Schema** には、irori が動かすすべてのエージェントに向けた指示・スキル・ルール・フックを置きます。irori agent、各 vault agent、ルーティンの AI ステップに、どの CLI でも届きます。**設定 → エージェント → 共通** の **共通 Schema** から開きます。使うには irori agent の用意が必要です。vault や irori agent の Schema が同じことを別に決めていれば、そちらが優先されます。

共通のスキルは、スキルの選択に（共通）と付いて表示されます。共通 Schema は、irori agent の既定のフォルダの `.irori/shared/` に保存されます。ワークスペースで irori agent に別のフォルダを選んでも、保存先は変わりません。[GitHub に保存する環境](settings.md#section-6)にも含まれます。

## サブエージェント

vault では、3つの CLI の形式でサブエージェントを定義できます。`.claude/agents/*.md`・`.codex/agents/*.toml`・`.opencode/agents/*.md` です。irori は3つとも読むため、vault agent が Claude Code・Codex・OpenCode のどれで動いても使えます。定義に書いたモデルは、その定義の形式の CLI でだけ使われます。

`vault-agent` という名前の定義は、その vault のエージェント自身を表します。irori agent はその説明を読み、vault agent は irori agent から渡された仕事でその指示に従います。
