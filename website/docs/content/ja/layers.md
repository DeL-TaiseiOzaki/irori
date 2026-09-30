---
title: 3つの層
description: AI への指示、書きためる知識、元になる資料を分けて扱います。
---

## Schema・Knowledge・Contents

| 層        | 役割                               | 例                                  |
| --------- | ---------------------------------- | ----------------------------------- |
| Schema    | AI が仕事を進めるための指示や設定  | `AGENTS.md`、スキル、ルール、フック |
| Knowledge | 自分たちが書き、更新していくノート | Markdown、オントロジーの CSV        |
| Contents  | ノートの元になる資料               | PDF、Office ファイル、Google Drive  |

資料を読み、Knowledge に理解を書き、Schema に仕事の進め方を置くのが基本です。

## フォルダとの関係

この3つは表示と役割の区分です。決まったフォルダ名がすべての hibachi に必須になるわけではありません。既存のノートを開くために移動する必要もありません。

トップレベルの隠しファイルや隠しフォルダ、`AGENTS.md` などは Schema として扱われます。Contents の場所は hibachi の宣言に従い、それ以外の知識用ファイルが Knowledge に表示されます。

おすすめの構成は[irori-templete](https://github.com/DeL-TaiseiOzaki/irori-templete)を参照できます。新規 hibachi を作る操作だけで、そのテンプレート全体がコピーされるわけではありません。

## AI が使うもの

hibachi agent は、その hibachi の Schema とノートを使って働きます。接続済みの Contents も、そのフォルダにアクセスできる範囲で利用できます。

別の hibachi も使う依頼は[irori agent](irori-mode.md)に渡します。具体的な設定は[Schema の設定](schema.md)、資料の接続は[Google Drive](drive.md)を参照してください。
