#!/usr/bin/env bash
# items/brand/*.svg から製品アイコンのスプライトを作り、internal/export/brand.js を書く。
#
# UI アイコン（items/fluent）との違いは 3 つ。
#
#   1. 色を残す。製品アイコンは色そのものが目印なので currentColor にしない
#   2. viewBox を 1 つずつ読む。20x20 に揃っていない（385.84x401.32 など）
#   3. id に名前を付け直す。多くのファイルが id="a" のような短い名前を使っていて、
#      1 つのスプライトに並べるとグラデーションの参照先がぶつかる
#
# ここで作るものは**エディタだけ**が読む。書き出す単一 HTML には入れない。
# 配る HTML はランチャーを持たないので、20KB 以上の絵を毎回付けるのは無駄になる。
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$(cd "$SRC/../.." && pwd)/internal/export/brand.js"

{
  printf '/* 製品アイコン。色付きのまま、1 つのスプライトにまとめたもの。\n'
  printf '   出どころと原本は items/brand/（README.md に取得元と扱いを書いてある）。\n'
  printf '   items/brand/*.svg から items/brand/build-brand.sh で生成している。\n'
  printf '   手で直さないこと。足すときは SVG を置いて作り直す。\n'
  printf '\n'
  printf '   エディタだけが読む。書き出す単一 HTML には入れない。 */\n'
  printf 'var BRAND_SPRITE = "<svg id=\\"brand-sprite\\" aria-hidden=\\"true\\" style=\\"position:absolute;width:0;height:0;overflow:hidden\\">'
} > "$OUT"

n=0
for f in "$SRC"/*.svg; do
  [ -e "$f" ] || continue
  id=$(basename "$f" .svg)
  vb=$(grep -o 'viewBox="[^"]*"' "$f" | head -1 | sed -e 's/viewBox="//' -e 's/"//')
  [ -n "$vb" ] || { echo "viewBox が無い: $f" >&2; exit 1; }
  body=$(sed -e 's/<svg[^>]*>//' -e 's#</svg>##' "$f" \
    | tr -d '\n\r' \
    | sed -e "s/id=\"\\([^\"]*\\)\"/id=\"$id-\\1\"/g" \
          -e "s/url(#\\([^)]*\\))/url(#$id-\\1)/g" \
          -e "s/href=\"#\\([^\"]*\\)\"/href=\"#$id-\\1\"/g" \
    | sed -e 's/"/\\"/g')
  printf '<symbol id=\\"br-%s\\" viewBox=\\"%s\\">%s</symbol>' "$id" "$vb" "$body" >> "$OUT"
  n=$((n + 1))
done

printf '</svg>";\n' >> "$OUT"

echo "生成: $OUT"
echo "製品アイコン $n 個 / $(wc -c < "$OUT") バイト"
