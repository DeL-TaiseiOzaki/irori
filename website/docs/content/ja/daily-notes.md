---
title: 今日のノート
description: 日付ごとのノートを、決めた場所とテンプレートで開きます。
---

## 保存先を決める

hibachi の `.irori/notes.json` で、日次ノートの保存先を宣言します。例えば次の設定では、年ごとのフォルダに日付のノートを作ります。

```json
{
  "schemaVersion": 1,
  "newNoteDirectory": "Knowledge_Base/journal",
  "daily": {
    "path": "Knowledge_Base/journal/{{yyyy}}/{{date}}.md",
    "template": ".irori/templates/daily.md"
  }
}
```

`template` は省略できます。保存先は Knowledge の中に置いてください。現在、この宣言を編集する専用の設定画面はありません。

## テンプレートを書く

テンプレートの `{{date}}` は `yyyy-MM-dd` に、`{{yyyy}}`・`{{MM}}`・`{{dd}}` はそれぞれ年・月・日に置き換わります。パソコンのローカル日付を使います。`{{datetime}}` では時刻と UTC オフセットも入れられます。

```markdown
# {{date}}

## 今日の記録

## 次にすること
```

## 今日のノートを開く

宣言がある hibachi では **今日のノート** が表示されます。押すと、その日のファイルを開きます。ファイルがなければテンプレートから作ります。

すでにあるノートにはテンプレートを再適用しません。テンプレートなしでは日付の見出しで始まります。[通常のノート](notes.md)と同じように編集・保存できます。
