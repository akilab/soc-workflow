package export

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/akilab/soc-workflow/internal/model"
	"github.com/akilab/soc-workflow/internal/store"
)

func seedDB(t *testing.T) *model.DB {
	t.Helper()
	var db model.DB
	if err := json.Unmarshal(store.Seed(), &db); err != nil {
		t.Fatalf("種データを読めません: %v", err)
	}
	return &db
}

// 書き出した HTML が外部を一切参照しないこと。
//
// これが崩れると、SOC のネットワーク制限下で開いたときに
// 見た目が壊れたり、動かなかったりする。配布物の前提そのもの。
func TestExportHasNoExternalReferences(t *testing.T) {
	db := seedDB(t)
	out, err := HTML(db, db.Events, "検証")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)

	// SVG の名前空間 URI だけは通す。あれは読みに行く先ではない。
	cleaned := strings.ReplaceAll(s, "http://www.w3.org/2000/svg", "")
	cleaned = strings.ReplaceAll(cleaned, "http://www.w3.org/1999/xhtml", "")

	for _, bad := range []string{"http://", "https://", "//cdn", "@import"} {
		if strings.Contains(cleaned, bad) {
			t.Errorf("外部参照が含まれています: %s", bad)
		}
	}
	// 外部ファイルを読み込むタグが無いこと
	for _, re := range []*regexp.Regexp{
		regexp.MustCompile(`<link[^>]+href`),
		regexp.MustCompile(`<script[^>]+src`),
		regexp.MustCompile(`<img[^>]+src=["']https?:`),
	} {
		if re.MatchString(s) {
			t.Errorf("外部を読み込むタグがあります: %s", re)
		}
	}
}

// データが実際に埋め込まれていること。
func TestExportEmbedsData(t *testing.T) {
	db := seedDB(t)
	ev := db.Events[0]

	out, err := HTML(db, []*model.Event{ev}, ev.Title)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)

	if !strings.Contains(s, "mountViewer(") {
		t.Error("viewer を起動する呼び出しがありません")
	}
	if !strings.Contains(s, "var DATA=") {
		t.Error("データが埋め込まれていません")
	}
	if !strings.Contains(s, ev.Steps[0].Title) {
		t.Errorf("手順の内容が入っていません: %q", ev.Steps[0].Title)
	}

	// 事象を 1 つに絞っても、参照される部品は全部入っていること。
	// 欠けていると、開いた側で段階も担当も引けなくなる。
	if !strings.Contains(s, `"tasks"`) || !strings.Contains(s, `"contactGroups"`) {
		t.Error("タスクか連絡先が入っていません")
	}
	for _, p := range db.Phases {
		if !strings.Contains(s, p.Name) {
			t.Errorf("段階 %q が入っていません", p.Name)
		}
	}
}

// 絞り込んだ事象だけが入っていること。他の事象を巻き込むと、
// 「この事象だけ渡す」つもりが全部渡すことになる。
func TestExportSingleEventExcludesOthers(t *testing.T) {
	db := seedDB(t)
	if len(db.Events) < 2 {
		t.Skip("事象が 2 件以上必要です")
	}

	out, err := HTML(db, []*model.Event{db.Events[0]}, "検証")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)

	var payloadOf struct {
		Events []*model.Event `json:"events"`
	}
	raw := between(s, "var DATA=", ";\nmountViewer")
	if raw == "" {
		t.Fatal("埋め込んだデータを取り出せません")
	}
	if err := json.Unmarshal([]byte(raw), &payloadOf); err != nil {
		t.Fatalf("埋め込んだデータが JSON として読めません: %v", err)
	}
	if len(payloadOf.Events) != 1 {
		t.Fatalf("事象が %d 件入っています。期待 1 件", len(payloadOf.Events))
	}
	if payloadOf.Events[0].Key != db.Events[0].Key {
		t.Errorf("入っている事象が違います: %s", payloadOf.Events[0].Key)
	}
}

// データの中に script の閉じタグがあっても、script を抜け出さないこと。
func TestExportEscapesScriptTag(t *testing.T) {
	db := seedDB(t)
	db.Events = []*model.Event{{
		Key: "x", Title: "検証", Severity: model.S2,
		Steps: []*model.Step{{
			ID: "s1", TaskKey: db.Tasks[0].Key,
			Title:  "閉じタグ入り",
			Detail: "</script><script>alert(1)</script>",
		}},
	}}

	out, err := HTML(db, db.Events, "検証")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)

	// 埋め込まれたデータそのものを取り出して見る。
	// alert(1) が文字列として入っているのは構わない。JSON の中では動かない。
	// 見るべきは、閉じタグが生のまま入っていないかどうか。
	raw := between(s, "var DATA=", ";\nmountViewer")
	if raw == "" {
		t.Fatal("埋め込んだデータを取り出せません")
	}
	closeTag := "<" + "/script>"
	if strings.Contains(raw, closeTag) {
		t.Error("データの中に閉じタグが生のまま入っています。script を抜け出せます")
	}
	escaped := string([]byte{92}) + "u003c" // 92 は円記号。ここで直に書くと Go が解釈してしまう
	if !strings.Contains(raw, escaped) {
		t.Error("不等号が Unicode エスケープされていません")
	}

	// 読み戻せること。エスケープしても JSON として壊れていないこと。
	var back struct {
		Events []*model.Event `json:"events"`
	}
	if err := json.Unmarshal([]byte(raw), &back); err != nil {
		t.Fatalf("エスケープ後のデータが JSON として読めません: %v", err)
	}
	if back.Events[0].Steps[0].Detail != db.Events[0].Steps[0].Detail {
		t.Error("エスケープで内容が変わっています")
	}
}

// タイトルは HTML として解釈されないこと。
func TestExportEscapesTitle(t *testing.T) {
	db := seedDB(t)
	out, err := HTML(db, db.Events, `<img src=x onerror="alert(1)">`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "<img src=x") {
		t.Error("タイトルが素通りしています")
	}
}

func TestFileName(t *testing.T) {
	for in, want := range map[string]string{
		"ランサムウェアの疑い": "ランサムウェアの疑い.html",
		"A社/B社 アラート": "A社-B社 アラート.html",
		`危険:"<>|*?`:  "危険-------.html",
		"":           "soc-flow.html",
	} {
		if got := FileName(in); got != want {
			t.Errorf("FileName(%q) = %q, 期待 %q", in, got, want)
		}
	}
}

// between は a と b に挟まれた部分を返す。
func between(s, a, b string) string {
	i := strings.Index(s, a)
	if i < 0 {
		return ""
	}
	rest := s[i+len(a):]
	j := strings.Index(rest, b)
	if j < 0 {
		return ""
	}
	return rest[:j]
}
