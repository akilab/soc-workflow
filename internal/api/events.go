package api

// フローと、その中の手順。
//
// 手順はフローの中にしか存在しない。だから URL もフローの下にぶら下げる
// （/api/events/{key}/steps/{id}）。手順 ID だけで引ける平らな入り口にすると、
// どのフローのものかを毎回探すことになり、取り違えたときに気づけない。

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/akilab/soc-workflow/internal/model"
)

// ---------------------------------------------------------------------------
// フロー
// ---------------------------------------------------------------------------

// eventBody はフローそのものの属性。手順は含めない。
//
// 手順を含めると、フロー名を直しただけの要求で手順が丸ごと置き換わる。
// クライアントの持っている配列が古ければ、それがそのまま消失になる。
type eventBody struct {
	Title    string         `json:"title"`
	Sub      string         `json:"sub"`
	Severity model.Severity `json:"severity"`
}

func (b eventBody) check() error {
	if strings.TrimSpace(b.Title) == "" {
		return errf(http.StatusBadRequest, "フローの名前が空です")
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(key)
		if ev == nil {
			return nil, notFound("フロー", key)
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(key)
		if ev == nil {
			return nil, notFound("フロー", key)
		}
		// これを元にしたフローがあるなら消せない。消すと派生側が
		// 「何と比べればよいのか」を失い、違いを見せられなくなる。
		if d := db.Derived(key); len(d) > 0 {
			usage := make([]Usage, 0, len(d))
			for _, x := range d {
				usage = append(usage, Usage{Kind: "event", Key: x.Key, Label: x.Title})
			}
			return nil, &apiErr{
				code:  http.StatusConflict,
				msg:   fmt.Sprintf("「%s」を元にしたフローが %d 件あります", ev.Title, len(d)),
				usage: usage,
			}
		}
		db.Events = remove(db.Events, func(x *model.Event) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderEvents(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, r, func(db *model.DB) (any, error) {
		next, err := reorder(db.Events, in.Keys, func(e *model.Event) string { return e.Key })
		if err != nil {
			return nil, err
		}
		db.Events = next
		return nil, nil
	})
}

// duplicateEvent はフローを丸ごと複製する。案 A と案 B を並べて比べるための操作。
func (s *Server) duplicateEvent(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, r, func(db *model.DB) (any, error) {
		src := db.Event(key)
		if src == nil {
			return nil, notFound("フロー", key)
		}

		// 複製は元と対等な別のフロー。ただし元にしたフロー（BaseKey）は引き継ぐ
		// ——「A 社向け」を複製したら「B 社向け」も同じ共通フローの派生になる。
		// 手順の FromID は copyStep が値ごと写すので、そのまま残る。
		dup := cloneEvent(db, src, src.Title+"（複製）")
		dup.BaseKey, dup.BaseSyncedAt = src.BaseKey, src.BaseSyncedAt
		db.Events = append(db.Events, dup)
		return dup, nil
	})
}

// deriveEvent は、このフローを元にしたフローを作る。
//
// 複製と違うのは、元をどう見るか。複製は対等な別物、派生は「共通に対する
// この顧客のやり方」で、共通との違いをあとから見られる。
func (s *Server) deriveEvent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, r, func(db *model.DB) (any, error) {
		src := db.Event(key)
		if src == nil {
			return nil, notFound("フロー", key)
		}
		// 派生の派生は作らせない。何と比べているのかが人にも辿れなくなる。
		if src.BaseKey != "" {
			return nil, errf(http.StatusConflict,
				"「%s」自体が別のフローを元にしています。元のフローから作ってください", src.Title)
		}

		title := strings.TrimSpace(in.Title)
		if title == "" {
			title = src.Title + "（顧客別）"
		}

		ev := cloneEvent(db, src, title)
		ev.BaseKey = src.Key
		ev.BaseSyncedAt = src.UpdatedAt
		// どの手順から来たかを覚える。これが無いと、あとで違いを取れない。
		for i, st := range src.Steps {
			ev.Steps[i].FromID = st.ID
		}
		db.Events = append(db.Events, ev)
		return ev, nil
	})
}

// reviewedEvent は「元との違いを見た」ことにする。
//
// 元が更新されると派生側に印が出る。取り込むかどうかは人が決めるので、
// 見た結果「取り込まなくてよい」という判断もありうる。その意思を残す口。
func (s *Server) reviewedEvent(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(key)
		if ev == nil {
			return nil, notFound("フロー", key)
		}
		base := db.Event(ev.BaseKey)
		if base == nil {
			return nil, errf(http.StatusConflict, "「%s」は他のフローを元にしていません", ev.Title)
		}
		ev.BaseSyncedAt = base.UpdatedAt
		touch(ev)
		return ev, nil
	})
}

// cloneEvent はフローを丸ごと写す。複製と派生で共通の部分。
func cloneEvent(db *model.DB, src *model.Event, title string) *model.Event {
	ev := &model.Event{
		Key:      uniqueKey("ev", func(k string) bool { return db.Event(k) != nil }),
		Title:    title,
		Sub:      src.Sub,
		Severity: src.Severity,
		Steps:    make([]*model.Step, 0, len(src.Steps)),
	}
	// フローごとの担当（呼び名と使う列）も写す。写さないと、呼び名を決めた
	// フローを複製したとたんに全体の呼び名へ戻ってしまう。
	for _, l := range src.Lanes {
		cp := *l
		ev.Lanes = append(ev.Lanes, &cp)
	}
	nextID := stepIDGen(db)
	for _, st := range src.Steps {
		ev.Steps = append(ev.Steps, copyStep(st, nextID()))
	}
	touch(ev)
	return ev
}

// copyStep は手順を値ごと複製する。
//
// 判断のキーはそのまま持っていく。条件が指すのは同じフローの中の判断なので
// （Event.Decision はフローの内側しか探さない）、複製先でもそのまま解決する。
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

// stepCreateBody は手順の追加。参照する対応と、置き場所だけを受け取る。
//
// 中身は渡さない。パレットから対応を置くと、その対応の名前と既定の担当が
// 入った手順ができ、細かいところはインスペクタで直す——という画面の流れに合わせる。
type stepCreateBody struct {
	TaskKey string `json:"task"`
	// Index は挿入位置。省略すると末尾に付く。
	Index *int `json:"index,omitempty"`
	// LaneKey は担当。省略すると対応の既定値を使う。
	//
	// 図の列が担当になったので、どの列に落としたかがそのまま意味を持つ。
	// 「このフローでは Tier1 がやる」を、置く動作だけで表せる。
	LaneKey string `json:"lane,omitempty"`
}

func (s *Server) createStep(w http.ResponseWriter, r *http.Request) {
	var in stepCreateBody
	if !decode(w, r, &in) {
		return
	}
	evKey := r.PathValue("key")
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("フロー", evKey)
		}
		task := db.Task(in.TaskKey)
		if task == nil {
			return nil, errf(http.StatusBadRequest, "知らない対応です: %s", in.TaskKey)
		}

		lane := in.LaneKey
		if lane == "" {
			lane = task.LaneKey // 指定が無ければ対応の既定値
		}
		if db.Lane(lane) == nil {
			return nil, errf(http.StatusBadRequest, "知らない担当です: %s", lane)
		}

		st := &model.Step{
			ID:         stepIDGen(db)(),
			TaskKey:    task.Key,
			Title:      task.Label, // このフローでの言い方は、まず対応名から始める
			LaneKey:    lane,
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

// duplicateStep は手順を複製し、すぐ下に差し込む。
//
// 似た手順を書くとき、毎回一から入力しなくて済むようにする。
// 判断を持つ手順を複製する場合は、判断のキーを振り直す。同じキーが 2 つあると、
// 条件がどちらを指すのか決まらなくなるため。複製した側は、キーが変わったことで
// どの条件からも参照されない状態になる（元の手順の条件はそのまま生きる）。
func (s *Server) duplicateStep(w http.ResponseWriter, r *http.Request) {
	evKey, id := r.PathValue("key"), r.PathValue("id")
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("フロー", evKey)
		}
		at := -1
		for i, st := range ev.Steps {
			if st.ID == id {
				at = i
				break
			}
		}
		if at < 0 {
			return nil, notFound("手順", id)
		}

		dup := copyStep(ev.Steps[at], stepIDGen(db)())
		dup.Title = ev.Steps[at].Title + "（複製）"
		if dup.Decision != nil {
			dup.Decision.Key = uniqueDecisionKey(ev)
		}
		ev.Steps = insert(ev.Steps, at+1, dup)
		touch(ev)
		return dup, nil
	})
}

// uniqueDecisionKey は、そのフローで使われていない判断のキーを作る。
func uniqueDecisionKey(ev *model.Event) string {
	used := map[string]bool{}
	for _, st := range ev.Steps {
		if st.Decision != nil {
			used[st.Decision.Key] = true
		}
	}
	for i := 1; ; i++ {
		k := fmt.Sprintf("q%d", i)
		if !used[k] {
			return k
		}
	}
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("フロー", evKey)
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
		return errf(http.StatusBadRequest, "知らない対応です: %s", in.TaskKey)
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

	// 条件が指す判断と選択肢が、このフローの中に存在すること。
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

	// 判断のキーはフローの中で一意。条件はキーだけで判断を引くため。
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("フロー", evKey)
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
	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(evKey)
		if ev == nil {
			return nil, notFound("フロー", evKey)
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

// decisionsAfter は、cur の判断を next に差し替えたあとの、フロー内の判断一覧を返す。
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

// touch はフローの更新時刻を今にする。
// 手順を直してもフローを直したことになるので、手順側の操作からも呼ぶ。
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
