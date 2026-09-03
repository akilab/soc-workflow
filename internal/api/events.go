package api

// 事象と、その中の手順。
//
// 手順は事象の中にしか存在しない。だから URL も事象の下にぶら下げる
// （/api/events/{key}/steps/{id}）。手順 ID だけで引ける平らな入り口にすると、
// どの事象のものかを毎回探すことになり、取り違えたときに気づけない。

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/akilab/soc-workflow/internal/model"
)

// ---------------------------------------------------------------------------
// 事象
// ---------------------------------------------------------------------------

// eventBody は事象そのものの属性。手順は含めない。
//
// 手順を含めると、事象名を直しただけの要求で手順が丸ごと置き換わる。
// クライアントの持っている配列が古ければ、それがそのまま消失になる。
type eventBody struct {
	Title    string         `json:"title"`
	Sub      string         `json:"sub"`
	Severity model.Severity `json:"severity"`
}

func (b eventBody) check() error {
	if strings.TrimSpace(b.Title) == "" {
		return errf(http.StatusBadRequest, "事象の名前が空です")
	}
	if !b.Severity.Valid() {
		return errf(http.StatusBadRequest, "重大度の値が不正です: %s", b.Severity)
	}
	return nil
}

func (s *Server) createEvent(w http.ResponseWriter, r *http.Request) {
	var in eventBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		if err := in.check(); err != nil {
			return nil, err
		}
		ev := &model.Event{
			Key:      uniqueKey("ev", func(k string) bool { return db.Event(k) != nil }),
			Title:    in.Title,
			Sub:      in.Sub,
			Severity: in.Severity,
			Steps:    []*model.Step{},
		}
		touch(ev)
		db.Events = append(db.Events, ev)
		return ev, nil
	})
}

func (s *Server) updateEvent(w http.ResponseWriter, r *http.Request) {
	var in eventBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		ev := db.Event(key)
		if ev == nil {
			return nil, notFound("事象", key)
		}
		if err := in.check(); err != nil {
			return nil, err
		}
		ev.Title, ev.Sub, ev.Severity = in.Title, in.Sub, in.Severity
		touch(ev)
		return ev, nil
	})
}

func (s *Server) deleteEvent(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		if db.Event(key) == nil {
			return nil, notFound("事象", key)
		}
		// 事象を指しているものは無いので、確認は要らない。
		db.Events = remove(db.Events, func(x *model.Event) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderEvents(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		next, err := reorder(db.Events, in.Keys, func(e *model.Event) string { return e.Key })
		if err != nil {
			return nil, err
		}
		db.Events = next
		return nil, nil
	})
}

// duplicateEvent は事象を丸ごと複製する。案 A と案 B を並べて比べるための操作。
func (s *Server) duplicateEvent(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		src := db.Event(key)
		if src == nil {
			return nil, notFound("事象", key)
		}

		dup := &model.Event{
			Key:      uniqueKey("ev", func(k string) bool { return db.Event(k) != nil }),
			Title:    src.Title + "（複製）",
			Sub:      src.Sub,
			Severity: src.Severity,
			Steps:    make([]*model.Step, 0, len(src.Steps)),
		}
		nextID := stepIDGen(db)
		for _, st := range src.Steps {
			dup.Steps = append(dup.Steps, copyStep(st, nextID()))
		}
		touch(dup)
		db.Events = append(db.Events, dup)
		return dup, nil
	})
}

// copyStep は手順を値ごと複製する。
//
// 判断のキーはそのまま持っていく。条件が指すのは同じ事象の中の判断なので
// （Event.Decision は事象の内側しか探さない）、複製先でもそのまま解決する。
// 一方、手順 ID は振り直す。今は誰も参照していないが、ファイル全体で
// 一意にしておけば、あとで「別の手順から参照する」機能を足しても壊れない。
func copyStep(src *model.Step, id string) *model.Step {
	dst := *src // 値のコピー。文字列と bool はこれで済む
	dst.ID = id

	dst.Contacts = append([]string(nil), src.Contacts...)
	dst.Conditions = append([]model.Condition(nil), src.Conditions...)

	if src.Decision != nil {
		d := *src.Decision
		d.Options = make([]*model.Option, len(src.Decision.Options))
		for i, o := range src.Decision.Options {
			opt := *o
			d.Options[i] = &opt
		}
		dst.Decision = &d
	}
	return &dst
}

// ---------------------------------------------------------------------------
// 手順
// ---------------------------------------------------------------------------

// stepCreateBody は手順の追加。参照するタスクと、入れる位置だけを受け取る。
//
// 中身は渡さない。パレットからタスクを置くと、そのタスクの名前と既定の担当が
// 入った手順ができ、細かいところはインスペクタで直す——という画面の流れに合わせる。
type stepCreateBody struct {
	TaskKey string `json:"task"`
	// Index は挿入位置。省略すると末尾に付く。
	Index *int `json:"index,omitempty"`
}

func (s *Server) createStep(w http.ResponseWriter, r *http.Request) {
	var in stepCreateBody
	if !decode(w, r, &in) {
		return
	}
	evKey := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("事象", evKey)
		}
		task := db.Task(in.TaskKey)
		if task == nil {
			return nil, errf(http.StatusBadRequest, "知らないタスクです: %s", in.TaskKey)
		}

		st := &model.Step{
			ID:         stepIDGen(db)(),
			TaskKey:    task.Key,
			Title:      task.Label,   // この事象での言い方は、まずタスク名から始める
			LaneKey:    task.LaneKey, // 担当はタスクの既定値を初期値にする
			Contacts:   []string{},
			Conditions: []model.Condition{},
		}

		at := len(ev.Steps)
		if in.Index != nil {
			at = *in.Index
			if at < 0 || at > len(ev.Steps) {
				return nil, errf(http.StatusBadRequest,
					"挿入位置が範囲外です: %d（手順は %d 件）", at, len(ev.Steps))
			}
		}
		ev.Steps = insert(ev.Steps, at, st)
		touch(ev)
		return st, nil
	})
}

// stepBody は手順の中身。更新のときに丸ごと置き換える。
type stepBody struct {
	TaskKey    string            `json:"task"`
	LaneKey    string            `json:"lane"`
	Title      string            `json:"title"`
	Detail     string            `json:"detail"`
	SLA        string            `json:"sla"`
	Escalate   bool              `json:"escalate"`
	Contacts   []string          `json:"contacts"`
	Conditions []model.Condition `json:"conditions"`
	Decision   *model.Decision   `json:"decision"`
}

func (s *Server) updateStep(w http.ResponseWriter, r *http.Request) {
	var in stepBody
	if !decode(w, r, &in) {
		return
	}
	evKey, id := r.PathValue("key"), r.PathValue("id")
	s.mutate(w, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("事象", evKey)
		}
		st := ev.Step(id)
		if st == nil {
			return nil, notFound("手順", id)
		}
		if err := checkStep(db, ev, st, in); err != nil {
			return nil, err
		}

		st.TaskKey, st.Title, st.Detail, st.SLA = in.TaskKey, in.Title, in.Detail, in.SLA
		st.LaneKey, st.Escalate = in.LaneKey, in.Escalate
		st.Contacts = strs(in.Contacts)
		st.Conditions = conds(in.Conditions)
		st.Decision = in.Decision
		touch(ev)
		return st, nil
	})
}

// checkStep は手順の中身を検査する。
//
// 参照が全部解決すること、そして——この手順が持っている判断を消したり
// 選択肢を減らしたりするときは、それを指している条件が無いこと。
// 判断を黙って消すと、他の手順が「決して表示されない」状態になり、
// フロー図の上では何も起きていないように見えてしまう。
func checkStep(db *model.DB, ev *model.Event, cur *model.Step, in stepBody) error {
	if strings.TrimSpace(in.Title) == "" {
		return errf(http.StatusBadRequest, "手順の名前が空です")
	}
	if db.Task(in.TaskKey) == nil {
		return errf(http.StatusBadRequest, "知らないタスクです: %s", in.TaskKey)
	}
	// 担当は図のどの列に座るかを決める。空だと行き場が無いので必須。
	if db.Lane(in.LaneKey) == nil {
		return errf(http.StatusBadRequest, "知らない担当です: %s", in.LaneKey)
	}
	for _, k := range in.Contacts {
		if db.ContactGroup(k) == nil {
			return errf(http.StatusBadRequest, "知らない連絡先グループです: %s", k)
		}
	}

	// 条件が指す判断と選択肢が、この事象の中に存在すること。
	// 判断はこの手順自身が持ち替える途中なので、更新後の姿で照合する。
	after := decisionsAfter(ev, cur, in.Decision)
	for _, c := range in.Conditions {
		d, found := after[c.Key]
		if !found {
			return errf(http.StatusBadRequest, "知らない判断を条件が指しています: %s", c.Key)
		}
		if !hasOption(d, c.Value) {
			return errf(http.StatusBadRequest,
				"判断「%s」に無い答えを条件が指しています: %s", d.Label, c.Value)
		}
	}

	if in.Decision != nil {
		if err := checkDecision(ev, cur, in.Decision); err != nil {
			return err
		}
	}

	// この手順が持っていた判断（や選択肢）を失うことで、
	// 壊れる条件が他の手順に残っていないかを見る。
	if lost := lostReferences(ev, cur, in.Decision); len(lost) > 0 {
		return conflict(
			fmt.Sprintf("この判断は %d か所の条件から参照されています。先に条件を外してください", len(lost)),
			lost,
		)
	}
	return nil
}

func checkDecision(ev *model.Event, cur *model.Step, d *model.Decision) error {
	if strings.TrimSpace(d.Key) == "" {
		return errf(http.StatusBadRequest, "判断のキーが空です")
	}
	if strings.TrimSpace(d.Label) == "" {
		return errf(http.StatusBadRequest, "判断の質問文が空です")
	}
	if len(d.Options) < 2 {
		return errf(http.StatusBadRequest, "判断には選択肢が 2 つ以上必要です")
	}

	seen := map[string]bool{}
	for _, o := range d.Options {
		if o == nil || strings.TrimSpace(o.Value) == "" {
			return errf(http.StatusBadRequest, "選択肢の値が空です")
		}
		if seen[o.Value] {
			return errf(http.StatusBadRequest, "選択肢の値が重複しています: %s", o.Value)
		}
		seen[o.Value] = true
	}

	// 判断のキーは事象の中で一意。条件はキーだけで判断を引くため。
	for _, other := range ev.Steps {
		if other == cur || other.Decision == nil {
			continue
		}
		if other.Decision.Key == d.Key {
			return errf(http.StatusBadRequest,
				"判断のキーが「%s」と重複しています: %s", other.Title, d.Key)
		}
	}
	return nil
}

func (s *Server) deleteStep(w http.ResponseWriter, r *http.Request) {
	evKey, id := r.PathValue("key"), r.PathValue("id")
	s.mutate(w, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("事象", evKey)
		}
		st := ev.Step(id)
		if st == nil {
			return nil, notFound("手順", id)
		}
		// 判断を持つ手順を消すと、それを指している条件が宙に浮く。
		if lost := lostReferences(ev, st, nil); len(lost) > 0 {
			return nil, conflict(
				fmt.Sprintf("この手順の判断は %d か所の条件から参照されています。先に条件を外してください", len(lost)),
				lost,
			)
		}
		ev.Steps = remove(ev.Steps, func(x *model.Step) bool { return x.ID == id })
		touch(ev)
		return nil, nil
	})
}

func (s *Server) orderSteps(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	evKey := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("事象", evKey)
		}
		next, err := reorder(ev.Steps, in.Keys, func(st *model.Step) string { return st.ID })
		if err != nil {
			return nil, err
		}
		ev.Steps = next
		touch(ev)
		return nil, nil
	})
}

// ---------------------------------------------------------------------------
// 判断の参照を調べる道具
// ---------------------------------------------------------------------------

// decisionsAfter は、cur の判断を next に差し替えたあとの、事象内の判断一覧を返す。
func decisionsAfter(ev *model.Event, cur *model.Step, next *model.Decision) map[string]*model.Decision {
	out := map[string]*model.Decision{}
	for _, st := range ev.Steps {
		if st == cur || st.Decision == nil {
			continue
		}
		out[st.Decision.Key] = st.Decision
	}
	if next != nil {
		out[next.Key] = next
	}
	return out
}

// lostReferences は、cur の判断を next に差し替えた（nil なら失う）ことで
// 行き先を失う条件を、他の手順の中から探す。
func lostReferences(ev *model.Event, cur *model.Step, next *model.Decision) []Usage {
	if cur.Decision == nil {
		return nil // もともと判断を持っていなければ、失うものは無い
	}
	oldKey := cur.Decision.Key

	// 差し替え後も同じキーで、選択肢も減っていなければ、壊れるものは無い。
	survives := func(value string) bool {
		if next == nil || next.Key != oldKey {
			return false
		}
		return hasOption(next, value)
	}

	var out []Usage
	for _, st := range ev.Steps {
		if st == cur {
			continue
		}
		for _, c := range st.Conditions {
			if c.Key == oldKey && !survives(c.Value) {
				out = append(out, Usage{
					Kind: "step", Key: st.ID, Label: st.Title,
					Event: ev.Key, EventTitle: ev.Title,
				})
				break
			}
		}
	}
	return out
}

func hasOption(d *model.Decision, value string) bool {
	for _, o := range d.Options {
		if o != nil && o.Value == value {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------

// stepIDGen は、まだ使われていない手順 ID を次々に払い出す関数を返す。
//
// 払い出した分も「使用済み」に加える。複製のように何個も続けて作る場面では、
// まだ DB に繋がっていない手順を数えられず、同じ ID を配ってしまうため。
func stepIDGen(db *model.DB) func() string {
	used := map[string]bool{}
	for _, ev := range db.Events {
		for _, st := range ev.Steps {
			used[st.ID] = true
		}
	}
	return func() string {
		id := uniqueKey("st", func(k string) bool { return used[k] })
		used[id] = true
		return id
	}
}

// touch は事象の更新時刻を今にする。
// 手順を直しても事象を直したことになるので、手順側の操作からも呼ぶ。
func touch(ev *model.Event) { ev.UpdatedAt = time.Now() }

// insert は at の位置に v を差し込む。
func insert[T any](items []T, at int, v T) []T {
	items = append(items, v)
	copy(items[at+1:], items[at:])
	items[at] = v
	return items
}

// strs / conds は nil を空配列にそろえる。JSON に null を出さないため。
func strs(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func conds(in []model.Condition) []model.Condition {
	if in == nil {
		return []model.Condition{}
	}
	return in
}
