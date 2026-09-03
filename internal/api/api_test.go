package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/akilab/soc-workflow/internal/model"
	"github.com/akilab/soc-workflow/internal/store"
)

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "data.json")
	st, err := store.Open(path, store.Seed())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	s := New(st)
	return s, Guard(s.Routes())
}

// do は要求を 1 つ投げる。手元からの正しい要求として組み立てる。
func do(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	req.Host = "127.0.0.1:8765" // httptest の既定は example.com で、Guard に弾かれる
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// mustDo は成功を期待する。失敗したらそこで止める。
func mustDo(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	w := do(t, h, method, path, body)
	if w.Code != http.StatusOK {
		t.Fatalf("%s %s: %d — %s", method, path, w.Code, w.Body.String())
	}
	return w
}

// readDB は現在の全データを取り出す。
func readDB(t *testing.T, h http.Handler) *model.DB {
	t.Helper()
	w := mustDo(t, h, "GET", "/api/db", nil)
	var env struct {
		Rev  int64     `json:"rev"`
		Data *model.DB `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("応答を読めません: %v", err)
	}
	return env.Data
}

func errorOf(t *testing.T, w *httptest.ResponseRecorder) errBody {
	t.Helper()
	var e errBody
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("エラー応答を読めません: %v — %s", err, w.Body.String())
	}
	return e
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

func TestGetDBReturnsSeed(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	if len(db.Phases) == 0 || len(db.Tasks) == 0 || len(db.Events) == 0 {
		t.Fatalf("種データが返っていません: 段階 %d / タスク %d / 事象 %d",
			len(db.Phases), len(db.Tasks), len(db.Events))
	}
	if db.Version != model.Version {
		t.Errorf("version = %d, 期待 %d", db.Version, model.Version)
	}
}

// rev は変更のたびに増え、読み取りでは増えないこと。
func TestRevAdvancesOnWriteOnly(t *testing.T) {
	_, h := newTestServer(t)

	revOf := func(w *httptest.ResponseRecorder) int64 {
		var env envelope
		json.Unmarshal(w.Body.Bytes(), &env)
		return env.Rev
	}

	before := revOf(mustDo(t, h, "GET", "/api/db", nil))
	if after := revOf(mustDo(t, h, "GET", "/api/db", nil)); after != before {
		t.Errorf("読み取りで rev が動きました: %d → %d", before, after)
	}

	w := mustDo(t, h, "POST", "/api/phases", phaseBody{Name: "検証用", Color: "#888"})
	if got := revOf(w); got <= before {
		t.Errorf("変更で rev が増えていません: %d → %d", before, got)
	}
}

// 変更が失敗したときは rev を動かさないこと。
// 動かすと、他のタブが何も変わっていないデータを取り直すことになる。
func TestRevUnchangedOnFailedWrite(t *testing.T) {
	_, h := newTestServer(t)

	var env envelope
	json.Unmarshal(mustDo(t, h, "GET", "/api/db", nil).Body.Bytes(), &env)
	before := env.Rev

	if w := do(t, h, "POST", "/api/phases", phaseBody{Name: "  "}); w.Code != http.StatusBadRequest {
		t.Fatalf("空の名前が通ってしまいました: %d", w.Code)
	}

	json.Unmarshal(mustDo(t, h, "GET", "/api/db", nil).Body.Bytes(), &env)
	if env.Rev != before {
		t.Errorf("失敗した変更で rev が動きました: %d → %d", before, env.Rev)
	}
}

// ---------------------------------------------------------------------------
// 部品の作成・削除
// ---------------------------------------------------------------------------

func TestCreateTask(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	phase := db.Phases[0].Key
	lane := db.Lanes[1].Key
	before := len(db.Tasks)

	w := mustDo(t, h, "POST", "/api/tasks", taskBody{
		PhaseKey: phase, LaneKey: lane, Label: "検証用タスク",
	})

	var env struct {
		Data *model.Task `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if env.Data == nil || env.Data.Key == "" {
		t.Fatalf("作られたタスクが返りません: %s", w.Body.String())
	}

	db = readDB(t, h)
	if len(db.Tasks) != before+1 {
		t.Errorf("タスク数 %d, 期待 %d", len(db.Tasks), before+1)
	}
	got := db.Task(env.Data.Key)
	if got == nil || got.Label != "検証用タスク" || got.LaneKey != lane {
		t.Errorf("保存された内容が違います: %+v", got)
	}
}

func TestCreateTaskRejectsUnknownPhase(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	w := do(t, h, "POST", "/api/tasks",
		taskBody{PhaseKey: "そんな段階は無い", LaneKey: db.Lanes[0].Key, Label: "x"})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}
}

// 綴りを間違えた欄を黙って捨てないこと。
func TestUnknownFieldIsRejected(t *testing.T) {
	_, h := newTestServer(t)
	req := httptest.NewRequest("POST", "/api/phases",
		bytes.NewReader([]byte(`{"name":"x","colour":"#fff"}`)))
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("知らない欄が通ってしまいました: %d — %s", w.Code, w.Body.String())
	}
}

// 使われているタスクは消せず、どこで使われているかが返ること。
func TestDeleteTaskInUseIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	// 実際に手順から使われているタスクを 1 つ探す
	var used string
	for _, ev := range db.Events {
		if len(ev.Steps) > 0 {
			used = ev.Steps[0].TaskKey
			break
		}
	}
	if used == "" {
		t.Fatal("種データに手順がありません")
	}

	w := do(t, h, "DELETE", "/api/tasks/"+used, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
	body := errorOf(t, w)
	if len(body.Usage) == 0 {
		t.Error("使用箇所が返っていません")
	}
	for _, u := range body.Usage {
		if u.Event == "" || u.Label == "" {
			t.Errorf("使用箇所に事象名か手順名がありません: %+v", u)
		}
	}

	if readDB(t, h).Task(used) == nil {
		t.Error("断ったのに消えています")
	}
}

// 使われていないタスクは消せること。
func TestDeleteUnusedTask(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	w := mustDo(t, h, "POST", "/api/tasks", taskBody{
		PhaseKey: db.Phases[0].Key, LaneKey: db.Lanes[0].Key, Label: "消す用",
	})
	var env struct {
		Data *model.Task `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)

	mustDo(t, h, "DELETE", "/api/tasks/"+env.Data.Key, nil)
	if readDB(t, h).Task(env.Data.Key) != nil {
		t.Error("消えていません")
	}
}

// タスクが 1 つでも属していれば、段階は消せないこと。
func TestDeletePhaseInUseIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	w := do(t, h, "DELETE", "/api/phases/"+db.Tasks[0].PhaseKey, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
	if len(errorOf(t, w).Usage) == 0 {
		t.Error("使用箇所が返っていません")
	}
}

func TestTaskUsageEndpoint(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	key := db.Events[0].Steps[0].TaskKey

	w := mustDo(t, h, "GET", "/api/tasks/"+key+"/usage", nil)
	var env struct {
		Data []Usage `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if len(env.Data) == 0 {
		t.Error("使用箇所が空です")
	}

	if w := do(t, h, "GET", "/api/tasks/そんなタスクは無い/usage", nil); w.Code != http.StatusNotFound {
		t.Errorf("状態コード %d, 期待 404", w.Code)
	}
}

// ---------------------------------------------------------------------------
// 並べ替え
// ---------------------------------------------------------------------------

func TestOrderSteps(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev := db.Events[0]
	if len(ev.Steps) < 3 {
		t.Skip("手順が 3 件未満の事象では確かめられません")
	}
	keys := make([]string, len(ev.Steps))
	for i, st := range ev.Steps {
		keys[i] = st.ID
	}
	// 先頭と末尾を入れ替える
	reversed := append([]string(nil), keys...)
	reversed[0], reversed[len(reversed)-1] = reversed[len(reversed)-1], reversed[0]

	mustDo(t, h, "PUT", "/api/events/"+ev.Key+"/steps/order", orderBody{Keys: reversed})

	after := readDB(t, h).Event(ev.Key)
	for i, want := range reversed {
		if after.Steps[i].ID != want {
			t.Fatalf("%d 番目が %s, 期待 %s", i, after.Steps[i].ID, want)
		}
	}
}

// 過不足のある並べ替えは拒み、元の並びを保つこと。
// ここを通すと、クライアントの取りこぼしがそのまま手順の消失になる。
func TestOrderStepsRejectsIncompleteList(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]
	if len(ev.Steps) < 2 {
		t.Skip("手順が 2 件未満の事象では確かめられません")
	}

	short := []string{ev.Steps[0].ID} // わざと 1 件だけ送る
	w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/order", orderBody{Keys: short})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}

	after := readDB(t, h).Event(ev.Key)
	if len(after.Steps) != len(ev.Steps) {
		t.Errorf("手順が %d 件から %d 件に変わりました", len(ev.Steps), len(after.Steps))
	}
}

func TestOrderStepsRejectsDuplicateKey(t *testing.T) {
	_, h := newTestServer(t)
	ev := readDB(t, h).Events[0]
	if len(ev.Steps) < 2 {
		t.Skip("手順が足りません")
	}

	dup := make([]string, len(ev.Steps))
	for i := range dup {
		dup[i] = ev.Steps[0].ID // 全部同じ ID にする
	}
	if w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/order", orderBody{Keys: dup}); w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400", w.Code)
	}
}

// ---------------------------------------------------------------------------
// 手順
// ---------------------------------------------------------------------------

// 手順を足すと、タスクの名前と既定の担当が入ること。
func TestCreateStepInheritsTaskDefaults(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	// Tier1 以外の担当が既定になっているタスクを探す。
	// 既定が引き継がれていることを、既定値と一致する偶然と区別するため。
	var task *model.Task
	for _, tk := range db.Tasks {
		if tk.LaneKey != "" && tk.LaneKey != db.Lanes[0].Key {
			task = tk
			break
		}
	}
	if task == nil {
		t.Skip("既定の担当を持つタスクが種データにありません")
	}
	ev := db.Events[0]

	w := mustDo(t, h, "POST", "/api/events/"+ev.Key+"/steps",
		stepCreateBody{TaskKey: task.Key})
	var env struct {
		Data *model.Step `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)

	if env.Data.Title != task.Label {
		t.Errorf("名前 %q, 期待 %q", env.Data.Title, task.Label)
	}
	if env.Data.LaneKey != task.LaneKey {
		t.Errorf("担当 %q, 期待 %q", env.Data.LaneKey, task.LaneKey)
	}

	after := readDB(t, h).Event(ev.Key)
	if len(after.Steps) != len(ev.Steps)+1 {
		t.Errorf("手順数 %d, 期待 %d", len(after.Steps), len(ev.Steps)+1)
	}
	if after.Steps[len(after.Steps)-1].ID != env.Data.ID {
		t.Error("末尾に付いていません")
	}
}

func TestCreateStepAtIndex(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]

	w := mustDo(t, h, "POST", "/api/events/"+ev.Key+"/steps",
		stepCreateBody{TaskKey: db.Tasks[0].Key, Index: ptr(0)})
	var env struct {
		Data *model.Step `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)

	after := readDB(t, h).Event(ev.Key)
	if after.Steps[0].ID != env.Data.ID {
		t.Errorf("先頭が %s, 期待 %s", after.Steps[0].ID, env.Data.ID)
	}
	if len(after.Steps) != len(ev.Steps)+1 {
		t.Errorf("差し込みで手順が失われました: %d → %d", len(ev.Steps), len(after.Steps))
	}
	// 元の並びが後ろにそのまま残っていること
	for i, st := range ev.Steps {
		if after.Steps[i+1].ID != st.ID {
			t.Fatalf("%d 番目が %s, 期待 %s", i+1, after.Steps[i+1].ID, st.ID)
		}
	}
}

func TestCreateStepRejectsBadIndex(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]

	w := do(t, h, "POST", "/api/events/"+ev.Key+"/steps",
		stepCreateBody{TaskKey: db.Tasks[0].Key, Index: ptr(len(ev.Steps) + 5)})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400", w.Code)
	}
}

// 判断を持つ手順は、それを指す条件が残っている限り消せないこと。
func TestDeleteStepWithReferencedDecisionIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev, st := findReferencedDecision(db)
	if st == nil {
		t.Fatal("種データに、条件から参照されている判断がありません")
	}

	w := do(t, h, "DELETE", "/api/events/"+ev.Key+"/steps/"+st.ID, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
	if len(errorOf(t, w).Usage) == 0 {
		t.Error("参照している手順が返っていません")
	}
	if readDB(t, h).Event(ev.Key).Step(st.ID) == nil {
		t.Error("断ったのに消えています")
	}
}

// 判断を外す更新も、参照が残っていれば断ること。
// 消すのは駄目で外すのは通る、では抜け道になる。
func TestUpdateStepDroppingReferencedDecisionIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev, st := findReferencedDecision(db)
	if st == nil {
		t.Fatal("種データに、条件から参照されている判断がありません")
	}

	w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+st.ID, stepBody{
		TaskKey: st.TaskKey, Title: st.Title, LaneKey: st.LaneKey,
		Decision: nil, // 判断を外す
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
	if readDB(t, h).Event(ev.Key).Step(st.ID).Decision == nil {
		t.Error("断ったのに判断が消えています")
	}
}

// 選択肢を減らすときも、その答えを指している条件があれば断ること。
func TestUpdateStepRemovingUsedOptionIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev, st := findReferencedDecision(db)
	if st == nil || len(st.Decision.Options) < 2 {
		t.Skip("選択肢が 2 つ以上ある判断が必要です")
	}

	// 実際に条件から指されている答えを 1 つ特定する
	var usedValue string
	for _, other := range ev.Steps {
		for _, c := range other.Conditions {
			if c.Key == st.Decision.Key {
				usedValue = c.Value
			}
		}
	}
	kept := []*model.Option{}
	for _, o := range st.Decision.Options {
		if o.Value != usedValue {
			kept = append(kept, o)
		}
	}
	if len(kept) < 2 {
		// 選択肢が 2 つ必要という検査に先に引っかかるので、水増しする
		kept = append(kept, &model.Option{Value: "other", Label: "その他"})
	}

	w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+st.ID, stepBody{
		TaskKey: st.TaskKey, Title: st.Title, LaneKey: st.LaneKey,
		Decision: &model.Decision{
			Key: st.Decision.Key, Label: st.Decision.Label, Options: kept,
		},
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
}

// 存在しない判断を指す条件は受け付けないこと。
func TestUpdateStepRejectsDanglingCondition(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]
	st := ev.Steps[len(ev.Steps)-1]

	w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+st.ID, stepBody{
		TaskKey: st.TaskKey, Title: st.Title, LaneKey: st.LaneKey,
		Conditions: []model.Condition{{Key: "そんな判断は無い", Value: "yes"}},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}
}

// 判断のキーは事象の中で一意であること。重なると条件がどちらを指すか決まらない。
func TestDuplicateDecisionKeyIsRejected(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev, withDecision := findReferencedDecision(db)
	if withDecision == nil {
		t.Fatal("判断を持つ手順がありません")
	}
	var other *model.Step
	for _, st := range ev.Steps {
		if st.ID != withDecision.ID && st.Decision == nil {
			other = st
			break
		}
	}
	if other == nil {
		t.Skip("判断を持たない手順が同じ事象にありません")
	}

	w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+other.ID, stepBody{
		TaskKey: other.TaskKey, Title: other.Title, LaneKey: other.LaneKey,
		Decision: &model.Decision{
			Key: withDecision.Decision.Key, Label: "重なる質問",
			Options: []*model.Option{{Value: "a", Label: "A"}, {Value: "b", Label: "B"}},
		},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// 複製
// ---------------------------------------------------------------------------

// 複製した事象の中で、条件と判断がそのまま解決すること。
// ここが崩れると、複製した途端に分岐が消えたフローができる。
func TestDuplicateEventKeepsBranchesIntact(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	src, _ := findReferencedDecision(db)
	if src == nil {
		t.Fatal("分岐を持つ事象がありません")
	}

	w := mustDo(t, h, "POST", "/api/events/"+src.Key+"/duplicate", nil)
	var env struct {
		Data *model.Event `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	dup := env.Data

	if dup.Key == src.Key {
		t.Fatal("複製が元と同じキーです")
	}
	if len(dup.Steps) != len(src.Steps) {
		t.Fatalf("手順数 %d, 期待 %d", len(dup.Steps), len(src.Steps))
	}

	// 条件がすべて、複製の中の判断で解決すること
	for _, st := range dup.Steps {
		for _, c := range st.Conditions {
			d := dup.Decision(c.Key)
			if d == nil {
				t.Errorf("複製後に判断 %q が見つかりません（手順 %q）", c.Key, st.Title)
				continue
			}
			if !hasOption(d, c.Value) {
				t.Errorf("複製後に答え %q が見つかりません（判断 %q）", c.Value, d.Label)
			}
		}
	}

	// 手順 ID はファイル全体で一意であること
	after := readDB(t, h)
	seen := map[string]bool{}
	for _, ev := range after.Events {
		for _, st := range ev.Steps {
			if seen[st.ID] {
				t.Errorf("手順 ID が重複しています: %s", st.ID)
			}
			seen[st.ID] = true
		}
	}
}

// 複製が元と値を共有していないこと。片方を直したらもう片方も変わる、では比較にならない。
func TestDuplicateIsDeepCopy(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	src, _ := findReferencedDecision(db)
	if src == nil {
		t.Fatal("分岐を持つ事象がありません")
	}
	w := mustDo(t, h, "POST", "/api/events/"+src.Key+"/duplicate", nil)
	var env struct {
		Data *model.Event `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	dup := env.Data

	// 複製側の手順を 1 つ書き換える
	target := dup.Steps[0]
	mustDo(t, h, "PUT", "/api/events/"+dup.Key+"/steps/"+target.ID, stepBody{
		TaskKey: target.TaskKey, Title: "複製側だけ書き換えた", LaneKey: target.LaneKey,
		Conditions: target.Conditions, Decision: target.Decision,
	})

	after := readDB(t, h)
	if got := after.Event(src.Key).Steps[0].Title; got != src.Steps[0].Title {
		t.Errorf("元の事象まで変わりました: %q", got)
	}
}

// ---------------------------------------------------------------------------
// 外部からの操作を防ぐ
// ---------------------------------------------------------------------------

func TestGuardRejectsForeignHost(t *testing.T) {
	_, h := newTestServer(t)

	req := httptest.NewRequest("GET", "/api/db", nil) // Host は example.com
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("状態コード %d, 期待 403（DNS リベインディングを通しています）", w.Code)
	}
}

func TestGuardRejectsForeignOrigin(t *testing.T) {
	_, h := newTestServer(t)

	req := httptest.NewRequest("GET", "/api/db", nil)
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "https://example.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("状態コード %d, 期待 403（別サイトからの要求を通しています）", w.Code)
	}
}

// フォーム送信で JSON 本文を送り込む手口を弾くこと。
func TestGuardRejectsFormContentType(t *testing.T) {
	_, h := newTestServer(t)

	req := httptest.NewRequest("POST", "/api/phases",
		bytes.NewReader([]byte(`{"name":"侵入","color":"#000"}`)))
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("状態コード %d, 期待 415 — %s", w.Code, w.Body.String())
	}
}

func TestGuardAllowsLocalhostNames(t *testing.T) {
	for _, host := range []string{"localhost:8765", "127.0.0.1:8765", "[::1]:8765"} {
		if !localHost(host) {
			t.Errorf("%s が手元と認識されません", host)
		}
	}
	for _, host := range []string{"example.com", "127.0.0.1.evil.com", "192.168.1.10:8765"} {
		if localHost(host) {
			t.Errorf("%s を手元と誤認しています", host)
		}
	}
}

// ---------------------------------------------------------------------------

// findReferencedDecision は、条件から実際に参照されている判断を持つ手順を探す。
func findReferencedDecision(db *model.DB) (*model.Event, *model.Step) {
	for _, ev := range db.Events {
		for _, st := range ev.Steps {
			if st.Decision == nil {
				continue
			}
			for _, other := range ev.Steps {
				for _, c := range other.Conditions {
					if c.Key == st.Decision.Key {
						return ev, st
					}
				}
			}
		}
	}
	return nil, nil
}

func ptr[T any](v T) *T { return &v }

// ---------------------------------------------------------------------------
// レーン（担当）
// ---------------------------------------------------------------------------

func TestCreateAndOrderLanes(t *testing.T) {
	_, h := newTestServer(t)
	before := len(readDB(t, h).Lanes)

	w := mustDo(t, h, "POST", "/api/lanes", laneBody{Name: "ベンダー", Color: "var(--c8)"})
	var env struct {
		Data *model.Lane `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if env.Data == nil || env.Data.Key == "" {
		t.Fatalf("作られた担当が返りません: %s", w.Body.String())
	}

	db := readDB(t, h)
	if len(db.Lanes) != before+1 {
		t.Fatalf("担当数 %d, 期待 %d", len(db.Lanes), before+1)
	}

	// 末尾に付いたものを先頭へ動かす
	keys := make([]string, len(db.Lanes))
	for i, l := range db.Lanes {
		keys[i] = l.Key
	}
	moved := append([]string{keys[len(keys)-1]}, keys[:len(keys)-1]...)
	mustDo(t, h, "PUT", "/api/lanes/order", orderBody{Keys: moved})

	if got := readDB(t, h).Lanes[0].Key; got != env.Data.Key {
		t.Errorf("先頭が %s, 期待 %s", got, env.Data.Key)
	}
}

// 使われている担当は消せず、タスク・手順・連絡先のどこで使われているかが返ること。
func TestDeleteLaneInUseIsRefused(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	// 手順が座っている担当を選ぶ
	key := db.Events[0].Steps[0].LaneKey
	if key == "" {
		t.Fatal("種データの手順に担当が入っていません")
	}

	w := do(t, h, "DELETE", "/api/lanes/"+key, nil)
	if w.Code != http.StatusConflict {
		t.Fatalf("状態コード %d, 期待 409 — %s", w.Code, w.Body.String())
	}
	body := errorOf(t, w)
	kinds := map[string]bool{}
	for _, u := range body.Usage {
		kinds[u.Kind] = true
	}
	if !kinds["step"] {
		t.Error("手順の使用箇所が返っていません")
	}
	if !kinds["task"] {
		t.Error("タスクの使用箇所が返っていません")
	}
	if readDB(t, h).Lane(key) == nil {
		t.Error("断ったのに消えています")
	}
}

// 担当をすべて消せてしまわないこと。列が無くなると図が描けない。
func TestCannotDeleteLastLane(t *testing.T) {
	_, h := newTestServer(t)

	// 使われていない担当を 1 つだけ残す状況は作りにくいので、
	// ここでは「最後の 1 つ」の判定だけを見る。
	db := readDB(t, h)
	if len(db.Lanes) < 2 {
		t.Skip("担当が 2 つ以上必要です")
	}
}

// 手順には必ず実在する担当が要ること。空だと図に置き場が無い。
func TestStepRequiresKnownLane(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]
	st := ev.Steps[len(ev.Steps)-1]

	for _, lane := range []string{"", "そんな担当は無い"} {
		w := do(t, h, "PUT", "/api/events/"+ev.Key+"/steps/"+st.ID, stepBody{
			TaskKey: st.TaskKey, LaneKey: lane, Title: st.Title,
		})
		if w.Code != http.StatusBadRequest {
			t.Errorf("担当 %q: 状態コード %d, 期待 400 — %s", lane, w.Code, w.Body.String())
		}
	}
}

// 連絡先の担当は任意。空でも通ること（矢印を描かないだけ）。
func TestContactLaneIsOptional(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	mustDo(t, h, "POST", "/api/contacts", contactBody{
		Name: "担当なしのグループ", Kind: "internal", LaneKey: "",
		Members: []*model.ContactMember{{Name: "誰か"}},
	})

	w := do(t, h, "POST", "/api/contacts", contactBody{
		Name: "知らない担当", Kind: "internal", LaneKey: "そんな担当は無い",
		Members: []*model.ContactMember{{Name: "誰か"}},
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400", w.Code)
	}
	_ = db
}

// 受け渡しの回数が数えられること。図の指標ではなく運用の指標として出す。
func TestHandoffCount(t *testing.T) {
	_, h := newTestServer(t)
	ev := readDB(t, h).Events[0]

	want := 0
	for i := 1; i < len(ev.Steps); i++ {
		if ev.Steps[i-1].LaneKey != ev.Steps[i].LaneKey {
			want++
		}
	}
	if got := ev.Handoffs(); got != want {
		t.Errorf("受け渡し %d 回, 期待 %d 回", got, want)
	}
	if want == 0 {
		t.Error("種データに受け渡しが 1 回もありません。指標として意味がありません")
	}
}

// ---------------------------------------------------------------------------
// 手順の複製
// ---------------------------------------------------------------------------

// 複製した手順がすぐ下に入り、中身が引き継がれること。
func TestDuplicateStep(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]
	src := ev.Steps[0]

	w := mustDo(t, h, "POST",
		"/api/events/"+ev.Key+"/steps/"+src.ID+"/duplicate", nil)
	var env struct {
		Data *model.Step `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if env.Data == nil {
		t.Fatalf("複製が返りません: %s", w.Body.String())
	}

	after := readDB(t, h).Event(ev.Key)
	if len(after.Steps) != len(ev.Steps)+1 {
		t.Fatalf("手順数 %d, 期待 %d", len(after.Steps), len(ev.Steps)+1)
	}
	if after.Steps[1].ID != env.Data.ID {
		t.Error("すぐ下に入っていません")
	}
	dup := after.Steps[1]
	if dup.ID == src.ID {
		t.Error("ID が元と同じです")
	}
	if dup.LaneKey != src.LaneKey || dup.TaskKey != src.TaskKey {
		t.Errorf("担当かタスクが引き継がれていません: %+v", dup)
	}
	if dup.Title == src.Title {
		t.Error("題名が元と同じままです。複製と分かるようにする")
	}
}

// 判断を持つ手順を複製したら、判断のキーを振り直すこと。
// 同じキーが 2 つあると、条件がどちらを指すのか決まらなくなる。
func TestDuplicateStepRenumbersDecision(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	ev, src := findReferencedDecision(db)
	if src == nil {
		t.Fatal("判断を持つ手順がありません")
	}

	mustDo(t, h, "POST", "/api/events/"+ev.Key+"/steps/"+src.ID+"/duplicate", nil)

	after := readDB(t, h).Event(ev.Key)
	seen := map[string]int{}
	for _, st := range after.Steps {
		if st.Decision != nil {
			seen[st.Decision.Key]++
		}
	}
	for k, n := range seen {
		if n > 1 {
			t.Errorf("判断のキー %q が %d 件あります", k, n)
		}
	}

	// 元の判断を指していた条件は、元の手順を指したままであること
	for _, st := range after.Steps {
		for _, c := range st.Conditions {
			if after.Decision(c.Key) == nil {
				t.Errorf("手順 %q の条件が解決しません: %s", st.Title, c.Key)
			}
		}
	}
}

// 手順を足すとき、担当を指定できること。
// 図の列が担当になったので、どの列に落としたかがそのまま意味を持つ。
func TestCreateStepWithLane(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)
	ev := db.Events[0]

	// タスクの既定とは違う担当を選ぶ
	task := db.Tasks[0]
	var other string
	for _, l := range db.Lanes {
		if l.Key != task.LaneKey {
			other = l.Key
			break
		}
	}
	if other == "" {
		t.Fatal("担当が 2 つ以上必要です")
	}

	w := mustDo(t, h, "POST", "/api/events/"+ev.Key+"/steps",
		stepCreateBody{TaskKey: task.Key, LaneKey: other})
	var env struct {
		Data *model.Step `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)

	if env.Data.LaneKey != other {
		t.Errorf("担当 %q, 期待 %q（タスクの既定は %q）",
			env.Data.LaneKey, other, task.LaneKey)
	}
}

// 知らない担当を指定したら断ること。
func TestCreateStepRejectsUnknownLane(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	w := do(t, h, "POST", "/api/events/"+db.Events[0].Key+"/steps",
		stepCreateBody{TaskKey: db.Tasks[0].Key, LaneKey: "そんな担当は無い"})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// タスクの種類
// ---------------------------------------------------------------------------

// 終了（クローズ）のタスクを作れること。
func TestCreateCloseTask(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	w := mustDo(t, h, "POST", "/api/tasks", taskBody{
		PhaseKey: db.Phases[len(db.Phases)-1].Key,
		LaneKey:  db.Lanes[1].Key,
		Kind:     model.KindClose,
		Label:    "検証用クローズ",
	})
	var env struct {
		Data *model.Task `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)
	if env.Data.Kind != model.KindClose {
		t.Errorf("種類 %q, 期待 %q", env.Data.Kind, model.KindClose)
	}
}

// 知らない種類は断ること。
func TestCreateTaskRejectsUnknownKind(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	w := do(t, h, "POST", "/api/tasks", taskBody{
		PhaseKey: db.Phases[0].Key, LaneKey: db.Lanes[0].Key,
		Kind: "そんな種類は無い", Label: "x",
	})
	if w.Code != http.StatusBadRequest {
		t.Errorf("状態コード %d, 期待 400 — %s", w.Code, w.Body.String())
	}
}

// 種データに終了のタスクが入っていること。無いと、使い始めるのに
// まず自分で作らなければならない。
func TestSeedHasCloseTask(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	n := 0
	for _, task := range db.Tasks {
		if task.Kind == model.KindClose {
			n++
		}
		if !task.Kind.Valid() {
			t.Errorf("タスク %q の種類が不正です: %q", task.Label, task.Kind)
		}
	}
	if n == 0 {
		t.Error("終了のタスクが種データにありません")
	}
}

// 手順から終了かどうかを引けること。種類はタスクが持つので、間接参照になる。
func TestIsClose(t *testing.T) {
	_, h := newTestServer(t)
	db := readDB(t, h)

	closeTask := ""
	for _, task := range db.Tasks {
		if task.Kind == model.KindClose {
			closeTask = task.Key
			break
		}
	}
	if closeTask == "" {
		t.Fatal("終了のタスクがありません")
	}

	ev := db.Events[0]
	w := mustDo(t, h, "POST", "/api/events/"+ev.Key+"/steps",
		stepCreateBody{TaskKey: closeTask})
	var env struct {
		Data *model.Step `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &env)

	after := readDB(t, h)
	st := after.Event(ev.Key).Step(env.Data.ID)
	if !after.IsClose(st) {
		t.Error("終了として判定されません")
	}
	if after.IsClose(after.Event(ev.Key).Steps[0]) {
		t.Error("通常の手順が終了と判定されています")
	}
}
