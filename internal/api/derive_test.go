package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/akilab/soc-workflow/internal/model"
)

func decodeEvent(t *testing.T, body []byte) *model.Event {
	t.Helper()
	var env struct {
		Data *model.Event `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatal(err)
	}
	if env.Data == nil {
		t.Fatalf("事象が返っていません: %s", body)
	}
	return env.Data
}

func eventByKey(t *testing.T, h http.Handler, key string) *model.Event {
	t.Helper()
	for _, e := range readDB(t, h).Events {
		if e.Key == key {
			return e
		}
	}
	t.Fatalf("事象が見つかりません: %s", key)
	return nil
}

// 派生を作ると、元と手順の出どころが残る。
func TestDeriveEvent(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]

	w := mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive",
		map[string]string{"title": "高橋工務店向け"})
	ev := decodeEvent(t, w.Body.Bytes())

	if ev.Title != "高橋工務店向け" {
		t.Fatalf("題名 = %q", ev.Title)
	}
	if ev.BaseKey != src.Key {
		t.Fatalf("元 = %q, want %q", ev.BaseKey, src.Key)
	}
	if ev.BaseSyncedAt.IsZero() {
		t.Fatal("見た時点が入っていません")
	}
	if len(ev.Steps) != len(src.Steps) {
		t.Fatalf("手順数 = %d, want %d", len(ev.Steps), len(src.Steps))
	}
	for i, st := range ev.Steps {
		if st.FromID != src.Steps[i].ID {
			t.Fatalf("%d 番目の出どころ = %q, want %q", i+1, st.FromID, src.Steps[i].ID)
		}
		if st.ID == src.Steps[i].ID {
			t.Fatalf("%d 番目の手順 ID が振り直されていません: %s", i+1, st.ID)
		}
	}
}

// 題名を省くと既定の名前が付く。空の題名で作れてしまうと一覧で見分けられない。
func TestDeriveDefaultTitle(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]

	w := mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive",
		map[string]string{"title": "   "})
	if got := decodeEvent(t, w.Body.Bytes()).Title; got != src.Title+"（顧客別）" {
		t.Fatalf("題名 = %q", got)
	}
}

// 派生の派生は作らせない。何と比べているのかが辿れなくなる。
func TestDeriveFromDerivedRefused(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]

	w := mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive", map[string]string{})
	ev := decodeEvent(t, w.Body.Bytes())

	if w := do(t, h, "POST", "/api/events/"+ev.Key+"/derive", map[string]string{}); w.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409 — %s", w.Code, w.Body.String())
	}
}

// 元にされている事象は消せない。消すと派生が比べる先を失う。
func TestDeleteBaseRefused(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]
	mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive", map[string]string{"title": "A社"})

	w := do(t, h, "DELETE", "/api/events/"+src.Key, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409 — %s", w.Code, w.Body.String())
	}
	// どれが妨げているかを返すこと。理由を画面に出せないと直しようがない。
	var body errBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Usage) != 1 || body.Usage[0].Label != "A社" || body.Usage[0].Kind != "event" {
		t.Fatalf("使用箇所 = %+v", body.Usage)
	}
}

// 元が更新されたら「見た時点」より新しくなる。確認すると追いつく。
func TestReviewedCatchesUp(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]
	ev := decodeEvent(t, mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive",
		map[string]string{"title": "A社"}).Body.Bytes())

	// 元をいじる。
	mustDo(t, h, "PUT", "/api/events/"+src.Key, eventBody{
		Title: src.Title + "・改", Sub: src.Sub, Severity: src.Severity,
	})

	base := eventByKey(t, h, src.Key)
	got := eventByKey(t, h, ev.Key)
	if !base.UpdatedAt.After(got.BaseSyncedAt) {
		t.Fatal("元を変えたのに、派生が古くなったと分からない")
	}

	mustDo(t, h, "POST", "/api/events/"+ev.Key+"/reviewed", nil)
	got = eventByKey(t, h, ev.Key)
	if got.BaseSyncedAt.Before(base.UpdatedAt) {
		t.Fatalf("確認しても追いついていない: %v < %v", got.BaseSyncedAt, base.UpdatedAt)
	}
}

// 元にしていない事象では「確認」できない。
func TestReviewedWithoutBase(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]
	if w := do(t, h, "POST", "/api/events/"+src.Key+"/reviewed", nil); w.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", w.Code)
	}
}

// 複製は元にした事象も出どころも引き継ぐ。
// 「A 社向け」を複製して「B 社向け」を作る使い方ができる。
func TestDuplicateKeepsBase(t *testing.T) {
	_, h := newTestServer(t)
	src := readDB(t, h).Events[0]
	a := decodeEvent(t, mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive",
		map[string]string{"title": "A社"}).Body.Bytes())

	b := decodeEvent(t, mustDo(t, h, "POST", "/api/events/"+a.Key+"/duplicate", nil).Body.Bytes())
	if b.BaseKey != src.Key {
		t.Fatalf("複製の元 = %q, want %q", b.BaseKey, src.Key)
	}
	for i, st := range b.Steps {
		if st.FromID != a.Steps[i].FromID {
			t.Fatalf("%d 番目の出どころ = %q, want %q", i+1, st.FromID, a.Steps[i].FromID)
		}
	}
}

// 呼び名を決めた事象を写すと、呼び名も付いてくる。
// これが抜けていると、複製したとたんに全体の呼び名へ戻る。
func TestCloneKeepsEventLanes(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	src := db.Events[0]

	// その事象が実際に使っている担当だけを、名前を変えて渡す。
	used := map[string]bool{}
	for _, st := range src.Steps {
		used[st.LaneKey] = true
	}
	var lanes []model.EventLane
	for _, l := range db.Lanes {
		if !used[l.Key] {
			continue
		}
		name := ""
		if l.Key == "customer" {
			name = "高橋工務店"
		}
		lanes = append(lanes, model.EventLane{Key: l.Key, Name: name})
	}
	mustDo(t, h, "PUT", "/api/events/"+src.Key+"/lanes",
		map[string]any{"lanes": lanes})

	ev := decodeEvent(t, mustDo(t, h, "POST", "/api/events/"+src.Key+"/derive",
		map[string]string{"title": "A社"}).Body.Bytes())

	if len(ev.Lanes) != len(lanes) {
		t.Fatalf("担当 = %d 件, want %d", len(ev.Lanes), len(lanes))
	}
	for _, l := range ev.Lanes {
		if l.Key == "customer" && l.Name != "高橋工務店" {
			t.Fatalf("呼び名 = %q, want 高橋工務店", l.Name)
		}
	}
}
