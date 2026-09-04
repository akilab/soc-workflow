package api

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/akilab/soc-workflow/internal/model"
)

// histOf は応答に添えられた取り消し／やり直しの状態を取り出す。
func histOf(t *testing.T, body []byte) histState {
	t.Helper()
	var env struct {
		History histState `json:"history"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatal(err)
	}
	return env.History
}

func stepCount(t *testing.T, h http.Handler, key string) int {
	t.Helper()
	db := readDB(t, h)
	for _, e := range db.Events {
		if e.Key == key {
			return len(e.Steps)
		}
	}
	t.Fatalf("事象が見つかりません: %s", key)
	return 0
}

// 削除を取り消すと手順が戻る。やり直すとまた消える。
func TestUndoRedoDeleteStep(t *testing.T) {
	_, h := newTestServer(t)

	db := readDB(t, h)
	ev := db.Events[0]
	id := ev.Steps[0].ID
	title := ev.Steps[0].Title
	before := len(ev.Steps)

	mustDo(t, h, "DELETE", "/api/events/"+ev.Key+"/steps/"+id, nil)
	if got := stepCount(t, h, ev.Key); got != before-1 {
		t.Fatalf("削除後の手順数 = %d, want %d", got, before-1)
	}

	w := mustDo(t, h, "POST", "/api/undo", nil)
	if got := stepCount(t, h, ev.Key); got != before {
		t.Fatalf("取り消し後の手順数 = %d, want %d", got, before)
	}
	// 中身まで戻っていること。件数だけ合っていても意味がない。
	db = readDB(t, h)
	for _, e := range db.Events {
		if e.Key != ev.Key {
			continue
		}
		if e.Steps[0].ID != id || e.Steps[0].Title != title {
			t.Fatalf("戻った手順 = %s/%s, want %s/%s",
				e.Steps[0].ID, e.Steps[0].Title, id, title)
		}
	}
	// 何が戻ったかを返していること。
	var res struct {
		Data struct {
			Label string `json:"label"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Data.Label != "手順の削除" {
		t.Fatalf("label = %q, want 手順の削除", res.Data.Label)
	}

	mustDo(t, h, "POST", "/api/redo", nil)
	if got := stepCount(t, h, ev.Key); got != before-1 {
		t.Fatalf("やり直し後の手順数 = %d, want %d", got, before-1)
	}
}

// 取り消せるものが無ければ 409。押せないことを画面が知る前に
// 連打されても、静かに何かが起きたりしない。
func TestUndoEmpty(t *testing.T) {
	_, h := newTestServer(t)

	w := do(t, h, "POST", "/api/undo", nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409 — %s", w.Code, w.Body.String())
	}
	if h := histOf(t, mustDo(t, h, "GET", "/api/db", nil).Body.Bytes()); h.Undo != "" || h.Redo != "" {
		t.Fatalf("最初の履歴 = %+v, want 空", h)
	}
}

// 取り消したあとに別の変更をすると、やり直せる先は消える。
// 分岐した履歴を持つと「どちらへ進むのか」が説明できなくなる。
func TestNewChangeClearsRedo(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]

	mustDo(t, h, "DELETE", "/api/events/"+ev.Key+"/steps/"+ev.Steps[0].ID, nil)
	mustDo(t, h, "POST", "/api/undo", nil)

	w := mustDo(t, h, "GET", "/api/db", nil)
	if got := histOf(t, w.Body.Bytes()).Redo; got != "手順の削除" {
		t.Fatalf("取り消し直後の redo = %q, want 手順の削除", got)
	}

	w = mustDo(t, h, "POST", "/api/phases", phaseBody{Name: "検証", Color: "#888"})
	if got := histOf(t, w.Body.Bytes()); got.Redo != "" || got.Undo != "段階の追加" {
		t.Fatalf("新しい変更のあと = %+v, want {Undo:段階の追加 Redo:}", got)
	}
}

// 同じ手順への続けての変更は 1 手にまとまる。
// 入力のたびに保存されるので、まとめないと一文戻すのに何十回も押すことになる。
func TestCoalesceSameTarget(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]
	st := ev.Steps[0]
	orig := st.Title
	path := "/api/events/" + ev.Key + "/steps/" + st.ID

	put := func(title string) {
		t.Helper()
		mustDo(t, h, "PUT", path, stepBody{
			TaskKey: st.TaskKey, LaneKey: st.LaneKey, Title: title,
			Detail: st.Detail, SLA: st.SLA, Escalate: st.Escalate,
			Contacts: st.Contacts, Conditions: st.Conditions, Decision: st.Decision,
		})
	}
	put("あ")
	put("あい")
	put("あいう")

	// 1 回の取り消しで、3 回ぶん戻って元の題名に戻る。
	mustDo(t, h, "POST", "/api/undo", nil)
	got := readDB(t, h)
	for _, e := range got.Events {
		if e.Key != ev.Key {
			continue
		}
		if e.Steps[0].Title != orig {
			t.Fatalf("題名 = %q, want %q", e.Steps[0].Title, orig)
		}
	}
	// これ以上戻るものは無い。まとまっていなければ 2 手残っているはず。
	if w := do(t, h, "POST", "/api/undo", nil); w.Code != http.StatusConflict {
		t.Fatalf("まとまっていない: 2 回目の取り消しが %d", w.Code)
	}
}

// 別の手順への変更はまとまらない。まとめると、直したつもりのない
// 手順まで一緒に戻ってしまう。
func TestNoCoalesceDifferentTarget(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]

	put := func(st *model.Step, title string) {
		t.Helper()
		mustDo(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+st.ID, stepBody{
			TaskKey: st.TaskKey, LaneKey: st.LaneKey, Title: title,
			Detail: st.Detail, SLA: st.SLA, Escalate: st.Escalate,
			Contacts: st.Contacts, Conditions: st.Conditions, Decision: st.Decision,
		})
	}
	put(ev.Steps[0], "ひとつめ")
	put(ev.Steps[1], "ふたつめ")

	mustDo(t, h, "POST", "/api/undo", nil)
	mustDo(t, h, "POST", "/api/undo", nil) // 2 手あるはず

	got := readDB(t, h)
	for _, e := range got.Events {
		if e.Key != ev.Key {
			continue
		}
		if e.Steps[0].Title != ev.Steps[0].Title || e.Steps[1].Title != ev.Steps[1].Title {
			t.Fatalf("戻りきっていない: %q / %q",
				e.Steps[0].Title, e.Steps[1].Title)
		}
	}
}

// 間があけば別の手になる。手が止まったところが区切り。
func TestCoalesceWindowExpires(t *testing.T) {
	var h history
	h.push("手順の変更", "g", []byte(`{"v":1}`))
	// 窓の外にする。時刻を直接動かして待たない（テストが遅くなるだけ）。
	h.undo[0].at = time.Now().Add(-histWindow - time.Second)
	h.push("手順の変更", "g", []byte(`{"v":2}`))

	if len(h.undo) != 2 {
		t.Fatalf("手数 = %d, want 2", len(h.undo))
	}
}

// 断られた変更は手数を増やさない。押しても何も変わらない手ができてしまう。
func TestRejectedChangeNotRecorded(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	// 使用中の段階は消せない。
	used := db.Tasks[0].PhaseKey
	if w := do(t, h, "DELETE", "/api/phases/"+used, nil); w.Code != http.StatusConflict {
		t.Fatalf("使用中の段階の削除が %d — %s", w.Code, w.Body.String())
	}
	if w := do(t, h, "POST", "/api/undo", nil); w.Code != http.StatusConflict {
		t.Fatalf("断られた変更が記録されている: undo が %d", w.Code)
	}
}

// 手数の上限を超えたら古いものから捨てる。
func TestHistoryCap(t *testing.T) {
	var h history
	for i := 0; i < histMax+10; i++ {
		h.push("段階の変更", "", []byte(`{}`))
	}
	if len(h.undo) != histMax {
		t.Fatalf("手数 = %d, want %d", len(h.undo), histMax)
	}
}

// 変更するルートには必ず言葉が要る。
//
// ルートを足したときに actionLabel へ書き忘れると、その操作だけ黙って
// 取り消せなくなる。気づけないので、ルート表そのものを読んで確かめる。
func TestEveryMutatingRouteHasLabel(t *testing.T) {
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`mux\.HandleFunc\("((?:POST|PUT|DELETE) [^"]+)"`)
	ms := re.FindAllStringSubmatch(string(src), -1)
	if len(ms) < 20 {
		t.Fatalf("ルートを読み取れていない（%d 件）。正規表現が合っていない可能性がある", len(ms))
	}

	// 履歴そのものを動かすルートは記録しない。
	skip := map[string]bool{"POST /api/undo": true, "POST /api/redo": true}

	for _, m := range ms {
		pat := m[1]
		if skip[pat] {
			continue
		}
		if actionLabel[pat] == "" {
			t.Errorf("actionLabel に %q がありません", pat)
		}
	}

	// 逆向きも見る。使われない言葉が残っていると、直したつもりが直っていない。
	live := map[string]bool{}
	for _, m := range ms {
		live[m[1]] = true
	}
	for pat := range actionLabel {
		if !live[pat] {
			t.Errorf("actionLabel の %q に対応するルートがありません", pat)
		}
	}
}
