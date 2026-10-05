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

左のレールの irori mode と hibachi の間にある **ルーティン** を開き、対象の **実行** を押します。この画面に実行環境とシークレットの設定もまとまり、横にはエージェントのパネルがあります。初回とファイル変更後には、中身や差分の確認が開きます。**確認して実行** で始まります。

動作中の **停止** は、そのステップを止め、後のステップを実行しません。自動スケジュールはなく、irori を閉じている間は動きません。

## ステップを書く

`run` はプログラムを実行し、`agent` は AI に指示します。最大20ステップを順番に実行し、失敗した時点で止まります。AI のステップには `access` と `prompt` が必要です。hibachi のルーティンは `agent: hibachi`、irori agent のルーティンは `agent: irori` を使います。

JavaScript ファイルを動かすときは、ルーティン画面の **実行環境** で **この端末で JavaScript を使用** を有効にします。例えば `- run: collect.js`、または `- run: [gh, api, notifications]` と書けます。Python はまだ使えません。必要なシークレットはルーティンの行から入力し、この画面の **シークレット** で管理します。値は OS のキーチェーンで保護して保存します。

各ステップは一時作業用の `IRORI_WORK`、継続状態用の `IRORI_STATE`、ルーティンの場所を示す `IRORI_ROUTINE` を使えます。

## 結果を確認する

実行結果には各ステップの状態、出力や AI の報告、変更したファイルが表示されます。履歴はルーティンごとに直近20件が残ります。AI ステップの **会話** から、その仕事の会話を開けます。

実行中にアプリが終了すると、その結果は次回 **不明** になります。自動で再実行しないため、結果を確認してから次の実行を選んでください。
