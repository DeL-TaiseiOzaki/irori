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

外した層は表示されず、新しいノートや接続を受け付けず、vault agent にも伝えられません。ファイルは動かず、選び直すと元の状態に戻ります。Contents を外す前に、その vault のフォルダとリポジトリの接続を解除してください。

Schema と Contents のフォルダ以外にある、vault 自身のファイルは、Knowledge がある vault では Knowledge に、ない vault では Contents に並びます。そのため、コードのリポジトリはそのまま Schema + Contents の vault になります。Contents に並んだファイルは、開く・保存・作成・名前の変更・移動・削除ができ、vault の Git の履歴にも残ります。Contents のフォルダは、これまでどおり外のフォルダやリポジトリを接続する場所で、vault 自身のファイルの下にフォルダ名つきで表示されます。Knowledge も Contents もない vault では、vault 自身のファイルは Schema に並びます。

両方の層がある vault でも、ノートの横にコードを置けます。Contents の行の **vault 直下のファイルも** をオンにすると、Knowledge はそのフォルダの中だけになります。このとき Knowledge のフォルダは vault のルートではなく、名前のあるフォルダである必要があります。

エージェントは `irori set <vault> --layers schema,contents` と `--own contents` で同じ選択をします。

## 層のフォルダ名を変える

フォルダの名前を変えると、irori はフォルダを移し、ノートのリンク・コメント・下書き・接続したフォルダを新しい場所に合わせます。リンクを更新できなかったファイルがあれば、その数が表示されます。名前は vault の `.irori/scope.json` に入るので、その vault を開く人には同じ名前で表示されます。別のコンピューターでの変更を Pull すると、すぐに反映されます。

おすすめの構成は[irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete)を参照できます。新規 vault を作る操作だけで、そのテンプレート全体がコピーされるわけではありません。

## AI が使うもの

vault agent（任意）は、その vault の Schema とノートを使って働きます。接続済みの Contents も、そのフォルダにアクセスできる範囲で利用できます。エージェントが作業中のファイルや結果を置く作業フォルダは、Contents に `work` として表示されます（[AI エージェント](agents.md)を参照）。

別の vault も使う依頼は[irori agent](irori-mode.md)に渡します。具体的な設定は[Schema の設定](schema.md)、資料の接続は[同期フォルダ](sync-folders.md)と[Contents の GitHub リポジトリ](git.md#section-6)を参照してください。
