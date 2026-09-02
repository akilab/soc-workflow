// Package export は、対応者に配る単一 HTML を作る。
//
// viewer.css と viewer.js はモックから切り出したもの。
// モックでは同じ 2 つを、エディタの試走モードと書き出し HTML の両方が使っていた。
// 初日にそう分けておいたので、本開発では書き直すのではなく切り出すだけで済んでいる。
//
// 出来上がる HTML は外部を一切参照しない。CSS も JS もデータもファイルの中にある。
// SOC のネットワーク制限下で、ファイルをコピーするだけで配れるようにするため。
package export

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html"

	"github.com/akilab/soc-workflow/internal/model"
)

//go:embed viewer.css
var viewerCSS string

//go:embed viewer.js
var viewerJS string

// payload は HTML に埋め込むデータ。viewer.js の mountViewer が受け取る形。
type payload struct {
	Phases        []*model.Phase        `json:"phases"`
	Tasks         []*model.Task         `json:"tasks"`
	ContactGroups []*model.ContactGroup `json:"contactGroups"`
	Events        []*model.Event        `json:"events"`
}

// HTML は events を収めた単一 HTML を返す。
//
// 段階・タスク・連絡先は全部入れる。events だけを絞っても、
// そこから参照される部品が欠けていては読めないため。
func HTML(db *model.DB, events []*model.Event, title string) ([]byte, error) {
	data, err := json.Marshal(payload{
		Phases:        db.Phases,
		Tasks:         db.Tasks,
		ContactGroups: db.ContactGroups,
		Events:        events,
	})
	if err != nil {
		return nil, fmt.Errorf("データを書き出せません: %w", err)
	}
	// encoding/json は既定で不等号とアンパサンドを Unicode エスケープに逃がす。
	// そのおかげで、データの中にスクリプトの閉じタグが書かれていても、
	// script 要素を抜け出せない。モック側でも同じ理由で置換していた。

	var b bytes.Buffer
	fmt.Fprintf(&b, `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<style>
%s
</style>
</head>
<body>
<div id="root"></div>
<script>
%s
var DATA=%s;
mountViewer(document.getElementById("root"), DATA, {storageKey:"soc-flow-run/"+location.pathname});
</script>
</body>
</html>
`, html.EscapeString(title), viewerCSS, viewerJS, data)

	return b.Bytes(), nil
}

// FileName は保存するときのファイル名を作る。
func FileName(title string) string {
	safe := make([]rune, 0, len(title))
	for _, r := range title {
		switch r {
		// Windows で使えない文字と、パスに見える文字を落とす。
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			safe = append(safe, '-')
		default:
			safe = append(safe, r)
		}
	}
	if len(safe) == 0 {
		return "soc-flow.html"
	}
	return string(safe) + ".html"
}
