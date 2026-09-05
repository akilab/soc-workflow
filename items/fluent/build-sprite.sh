#!/usr/bin/env bash
# items/fluent/*.svg から SVG スプライトを作り、internal/export/icons.js を書く。
#
# 書き出し HTML は外部参照ゼロが決めごとなので、アイコンは埋め込むしかない。
# 既存の連絡手段アイコン（viewer.js の VIA_SPRITE）と同じやり方にそろえる。
set -eu
SRC="D:/Projects/soc-workflow/items/fluent"
OUT="D:/Projects/soc-workflow/internal/export/icons.js"

{
  printf '/* Fluent UI System Icons（MIT · Microsoft）から取り込んだ UI アイコン。\n'
  printf '   出どころと原本は items/fluent/（LICENSE.txt 同梱）。\n'
  printf '   items/fluent/*.svg から items/fluent/build-sprite.sh で生成している。\n'
  printf '   手で直さないこと。アイコンを足すときは取得しなおして作り直す。\n'
  printf '\n'
  printf '   すべて 20x20 の regular。fill を currentColor にしてあるので、\n'
  printf '   置いた場所の文字色をそのまま拾う（明暗の切り替えにも追従する）。 */\n'
  printf 'var UI_SPRITE = "<svg id=\\"ui-sprite\\" aria-hidden=\\"true\\" style=\\"position:absolute;width:0;height:0;overflow:hidden\\">'
} > "$OUT"

for f in "$SRC"/*.svg; do
  id=$(basename "$f" .svg)
  # <svg ...> と </svg> を外し、fill を currentColor に、改行を潰す
  body=$(sed -e 's/<svg[^>]*>//' -e 's#</svg>##' "$f" \
    | tr -d '\n\r' \
    | sed -e 's/fill="#212121"/fill="currentColor"/g' -e 's/fill="none"//g' \
    | sed -e 's/"/\\"/g')
  printf '<symbol id=\\"ic-%s\\" viewBox=\\"0 0 20 20\\">%s</symbol>' "$id" "$body" >> "$OUT"
done

printf '</svg>";\n' >> "$OUT"

echo "生成: $OUT"
echo "アイコン $(ls "$SRC"/*.svg | wc -l) 個 / $(wc -c < "$OUT") バイト"
