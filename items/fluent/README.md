# UI アイコン

[Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)（MIT · Microsoft）から、
このアプリで使うものだけを取り込んだもの。原本は `*.svg`、ライセンスは `LICENSE.txt`。

すべて **20x20 の regular**。この画面の文字は 12〜14px なので、20px の線幅が合う。

## 足すとき

1. `build-sprite.sh` の中の一覧に追記して取得しなおすか、目的の SVG を直接ここへ置く
2. `bash items/fluent/build-sprite.sh` を実行する
   → `internal/export/icons.js` が作り直される（**手で編集しないこと**）
3. `go run ./cmd/build-web` でエディタ側へ配る

## なぜ埋め込むのか

書き出した単一 HTML は外部参照ゼロが決めごとなので、CDN も Web フォントも使えない。
SVG スプライトにして `fill="currentColor"` にしてあるので、置いた場所の文字色を拾い、
明暗の切り替えにもそのまま追従する。
