---
title: ルーティン
description: プログラムの実行と AI への指示を、決めた順番で動かします。
---

## ルーティンを用意する

ルーティンは `routine.yaml` と必要なファイルを入れたフォルダです。hibachi の仕事は `.irori/routines/<name>/` に、全体の仕事は irori agent のフォルダの `routines/<name>/` に置きます。

hibachi の例です。

```yaml
name: Review notes
steps:
  - agent: hibachi
    access: default
    prompt: |
      Read the notes and write a short review in Knowledge_Base/review.md.
```

## 確認して実行する

**irori mode → ルーティン** から対象の **実行** を押します。初回とファイル変更後には、中身や差分の確認が開きます。**確認して実行** で始まります。

初回利用時には、プログラムによるファイルの読み取りと外部サービスへの送信の説明にも確認を求めます。AI のステップは、その CLI のデータ利用が未確認なら確認します。これらの説明は、ルーティンのファイル確認や個々のツールの承認とは別です。[プライバシーとデータの扱い](privacy.md)を参照してください。

動作中の **停止** は、そのステップを止め、後のステップを実行しません。自動スケジュールはなく、irori を閉じている間は動きません。

## ステップを書く

`run` はプログラムを実行し、`agent` は AI に指示します。最大20ステップを順番に実行し、失敗した時点で止まります。AI のステップには `access` と `prompt` が必要です。hibachi のルーティンは `agent: hibachi`、irori agent のルーティンは `agent: irori` を使います。

JavaScript ファイルを動かすときは、設定で **JavaScript** を追加します。例えば `- run: collect.js`、または `- run: [gh, api, notifications]` と書けます。現在は Python とシークレットには対応していません。

各ステップは一時作業用の `IRORI_WORK`、継続状態用の `IRORI_STATE`、ルーティンの場所を示す `IRORI_ROUTINE` を使えます。

## 結果を確認する

実行結果には各ステップの状態、出力や AI の報告、変更したファイルが表示されます。履歴はルーティンごとに直近20件が残ります。AI ステップの **会話** から、その仕事の会話を開けます。

実行中にアプリが終了すると、その結果は次回 **不明** になります。自動で再実行しないため、結果を確認してから次の実行を選んでください。
