---
title: 3つの層
description: AI への指示、書きためる知識、元になる資料を分けて扱います。
---

## Schema・Knowledge・Contents

| 層        | 役割                               | 例                                                                                |
| --------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Schema    | AI への指示や設定（任意）          | `AGENTS.md`、スキル、ルール、フック                                               |
| Knowledge | 自分たちが書き、更新していくノート | Markdown、CSV の表                                                                |
| Contents  | ノートの元になる資料               | PDF、Office ファイル、このコンピューターや同期アプリのフォルダ、GitHub リポジトリ |

資料を読み、Knowledge に理解を書きます。Schema は **設定 → エージェント → vault agent** で vault agent をオンにしたときだけ表示されます。

## フォルダとの関係

この3つは表示と役割の区分です。決まったフォルダ名がすべての vault に必須になるわけではありません。既存のノートを開くために移動する必要もありません。

トップレベルの隠しファイルや隠しフォルダ、`AGENTS.md` などは Schema として扱われます。Contents の場所は vault の宣言に従い、それ以外の知識用ファイルが Knowledge に表示されます。

vault の設定の **層** では、Knowledge と Contents のそれぞれについて、画面に出す名前（**表示名**）と **フォルダ** を決めます。Knowledge で **vault のルート** を選ぶと、ノートはリポジトリの直下に `AGENTS.md` と並びます。

## vault が持つ層を選ぶ

すべての vault が資料つきのナレッジベースとは限りません。vault の設定の **層** にある **この vault が持つ層** で、Knowledge と Contents をそれぞれ持つかどうかを選べます。Schema はすべての vault にあります。

| 層の組み合わせ                | 例                                             |
| ----------------------------- | ---------------------------------------------- |
| Schema + Knowledge + Contents | 資料つきのナレッジベース（初期状態）           |
| Schema + Knowledge            | ノートやアイデアだけを置く場所                 |
| Schema + Contents             | コードなどの作業用ワークスペース（ノートなし） |

これは例であり、vault の種類ではありません。使い方に合う組み合わせを選んでください。

外した層は表示されず、新しいノートや接続を受け付けず、vault agent にも伝えられません。ファイルは動かず、選び直すと元の状態に戻ります。Knowledge を外すと、Contents 以外のファイルは Schema のファイル表示に並びます。Contents を外す前に、その vault のフォルダとリポジトリの接続を解除してください。コードは、そのフォルダや GitHub リポジトリを Contents に接続したときに Contents になります。vault の直下に置いたファイルは Schema に並びます。

エージェントは `irori set <vault> --layers schema,contents` で同じ選択をします。

## 層のフォルダ名を変える

フォルダの名前を変えると、irori はフォルダを移し、ノートのリンク・コメント・下書き・接続したフォルダを新しい場所に合わせます。リンクを更新できなかったファイルがあれば、その数が表示されます。名前は vault の `.irori/scope.json` に入るので、その vault を開く人には同じ名前で表示されます。別のコンピューターでの変更を Pull すると、すぐに反映されます。

おすすめの構成は[irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete)を参照できます。新規 vault を作る操作だけで、そのテンプレート全体がコピーされるわけではありません。

## AI が使うもの

vault agent（任意）は、その vault の Schema とノートを使って働きます。接続済みの Contents も、そのフォルダにアクセスできる範囲で利用できます。エージェントが作業中のファイルや結果を置く作業フォルダは、Contents に `work` として表示されます（[AI エージェント](agents.md)を参照）。

別の vault も使う依頼は[irori agent](irori-mode.md)に渡します。具体的な設定は[Schema の設定](schema.md)、資料の接続は[同期フォルダ](sync-folders.md)と[Contents の GitHub リポジトリ](git.md#section-6)を参照してください。
