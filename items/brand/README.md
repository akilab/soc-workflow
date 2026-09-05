# 製品アイコン（色付き）

ランチャー（左上の点の集まり）で使う、Microsoft 各サービスのアイコン。
UI アイコン（`items/fluent`）とは扱いが違うので、置き場所を分けてある。

| | UI アイコン | 製品アイコン |
| --- | --- | --- |
| 場所 | `items/fluent` | ここ |
| 色 | `currentColor`（置いた場所の文字色を拾う） | **元の色のまま** |
| 大きさ | 20x20 に揃える | ファイルごとにばらばら（viewBox を読む） |
| 使う場所 | 画面全体 | ランチャーのマスと、その選択欄だけ |
| 書き出す HTML | 入る | **入らない**（配る HTML にランチャーは無い） |

## 足すとき

1. SVG をこのフォルダに置く。ファイル名がそのまま名前になる（`entra.svg` → `entra`）
2. `bash items/brand/build-brand.sh` を実行する
   → `internal/export/brand.js` が作り直される（**手で編集しないこと**）
3. `web/src/links.ts` の `ICONS` に 1 行足す（`brand:` にファイル名を書く）
4. `internal/api/parts.go` の `linkIcons` にも同じ名前を足す（サーバ側の検査）
5. `go run ./cmd/build-web` で配る

## いま置いてあるもの

`defender` `intune` `teams` `outlook` `copilot` `azure` `m365`

[homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons)（Apache-2.0）
から取得した。**足りていないもの**: Entra ID、Sentinel、Logic Apps。
[msicons.com](https://msicons.com/) などから SVG を落として、ここへ置けば増やせる。

## 扱いの注意

**中身は Microsoft の製品ロゴで、商標である。** リポジトリの license は
配布元のものであって、ロゴそのものの権利とは別。この道具の中で
「その製品を開くリンク」を指すために使う分には問題ないが、次はしない。

- 自分たちの製品やサービスの目印として使う
- 改変する（色を変える、形を変える、他の絵と組み合わせる）
- Microsoft の推奨・提携を思わせる出し方をする

社外へ配るものに載せるときは、その都度確認すること。書き出す単一 HTML に
入れていないのは、そこが**社外へ配るもの**だからでもある。
