// Package export は、対応者に配る単一 HTML を作る。
//
// viewer.css と viewer.js はモックから切り出したもの。
// モックでは同じ 2 つを、エディタのテストモードと書き出し HTML の両方が使っていた。
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

// icons.js は UI アイコンの SVG スプライト（Fluent UI System Icons・MIT）。
//
// 書き出し HTML は外部参照ゼロが決めごとなので、アイコンも埋め込むしかない。
// viewer.js より先に読ませる（viewer.js が UI_SPRITE を使う）。
//
//go:embed icons.js
var iconsJS string

// payload は HTML に埋め込むデータ。viewer.js の mountViewer が受け取る形。
//
// 部品（担当・フェーズ・対応・連絡先）は全部入れる。フローを 1 件に絞っても、
// そこから参照されるものが欠けていては読めない。
//
// フローごとの担当（呼び名と使う列）は Event の中に入っているので、
// ここで別に持つ必要はない。
type payload struct {
	Lanes         []*model.Lane         `json:"lanes"`
	Phases        []*model.Phase        `json:"phases"`
	Tasks         []*model.Task         `json:"tasks"`
	ContactGroups []*model.ContactGroup `json:"contactGroups"`
	// SLAs は約束した時間。対応者にとっては「どの工程までを、どのくらいで
	// やらなければならないか」なので、配る HTML にこそ要る。
	SLAs   []*model.SLA   `json:"slas"`
	Events []*model.Event `json:"events"`
	// GotoNames は、同梱していない移り先のフローの名前。
	//
	// 移り先が入っていないとき、札にキー（"ransom"）が出るのでは読めない。
	// 名前だけを持たせて「あちらへ移るが、このファイルには入っていない」と
	// 言えるようにする。中身は入れないので、書き出す範囲は広がらない。
	GotoNames map[string]string `json:"gotoNames,omitempty"`
}

// WithLinked は events に、そこから移れるフローを足したものを返す。
//
// 1 フローだけ書き出すと、移り先が入らず配布物が行き止まりになる。
// 移り先は「調べたら別の事象だった」ときに実際に開くものなので、
// 手元に無ければ意味がない。A→B→C と続くこともあるので、たどれる範囲を
// 全部たどる。
//
// 呼ぶ側は、足したことを画面に出すこと。書き出す範囲が増えるということは、
// 「どこを見ているか」の情報がそれだけ多く出ていくということでもある。
func WithLinked(db *model.DB, events []*model.Event) []*model.Event {
	seen := map[string]bool{}
	out := make([]*model.Event, 0, len(events))
	queue := make([]*model.Event, 0, len(events))

	for _, ev := range events {
		if ev != nil && !seen[ev.Key] {
			seen[ev.Key] = true
			out = append(out, ev)
			queue = append(queue, ev)
		}
	}
	for len(queue) > 0 {
		ev := queue[0]
		queue = queue[1:]
		for _, st := range ev.Steps {
			if st.Goto == "" || seen[st.Goto] {
				continue
			}
			next := db.Event(st.Goto)
			if next == nil {
				continue // 消えている移り先。検証が別に知らせる
			}
			seen[st.Goto] = true
			out = append(out, next)
			queue = append(queue, next)
		}
	}
	return out
}

// gotoNames は、events に入っていない移り先の名前を集める。
func gotoNames(db *model.DB, events []*model.Event) map[string]string {
	in := map[string]bool{}
	for _, ev := range events {
		in[ev.Key] = true
	}
	out := map[string]string{}
	for _, ev := range events {
		for _, st := range ev.Steps {
			if st.Goto == "" || in[st.Goto] {
				continue
			}
			if to := db.Event(st.Goto); to != nil {
				out[st.Goto] = to.Title
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// HTML は events を収めた単一 HTML を返す。
//
// フェーズ・対応・連絡先は全部入れる。events だけを絞っても、
// そこから参照される部品が欠けていては読めないため。
func HTML(db *model.DB, events []*model.Event, title string) ([]byte, error) {
	data, err := json.Marshal(payload{
		Lanes:         db.Lanes,
		Phases:        db.Phases,
		Tasks:         db.Tasks,
		ContactGroups: db.ContactGroups,
		SLAs:          db.SLAs,
		Events:        events,
		GotoNames:     gotoNames(db, events),
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
%s
var DATA=%s;
mountViewer(document.getElementById("root"), DATA, {storageKey:"soc-flow-run/"+location.pathname});
</script>
</body>
</html>
`, html.EscapeString(title), viewerCSS, iconsJS, viewerJS, data)

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
