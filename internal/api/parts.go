package api

// 事象に属さず、複数の事象から使われる部品——フェーズ・タスク・連絡先。
//
// この 3 つは形が似ている。作る・直す・並べ替える・消す（使用中なら断る）。
// 消すときに何を調べるかだけが違う。

import (
	"net/http"
	"strings"

	"github.com/akilab/soc-workflow/internal/model"
)

// orderBody は並べ替えの要求。並びをキーの配列で受け取る。
type orderBody struct {
	Keys []string `json:"keys"`
}

// ---------------------------------------------------------------------------
// フェーズ（対応の段階＝フロー図の列）
// ---------------------------------------------------------------------------

type phaseBody struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (b phaseBody) check() error {
	if strings.TrimSpace(b.Name) == "" {
		return errf(http.StatusBadRequest, "段階の名前が空です")
	}
	return nil
}

func (s *Server) createPhase(w http.ResponseWriter, r *http.Request) {
	var in phaseBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		if err := in.check(); err != nil {
			return nil, err
		}
		p := &model.Phase{
			Key:   uniqueKey("phase", func(k string) bool { return db.Phase(k) != nil }),
			Name:  in.Name,
			Color: in.Color,
		}
		db.Phases = append(db.Phases, p)
		return p, nil
	})
}

func (s *Server) updatePhase(w http.ResponseWriter, r *http.Request) {
	var in phaseBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		p := db.Phase(key)
		if p == nil {
			return nil, notFound("段階", key)
		}
		if err := in.check(); err != nil {
			return nil, err
		}
		p.Name, p.Color = in.Name, in.Color
		return p, nil
	})
}

func (s *Server) deletePhase(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		p := db.Phase(key)
		if p == nil {
			return nil, notFound("段階", key)
		}
		if err := refuseIfUsed("段階", p.Name, tasksUsingPhase(db, key)); err != nil {
			return nil, err
		}
		db.Phases = remove(db.Phases, func(x *model.Phase) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderPhases(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		next, err := reorder(db.Phases, in.Keys, func(p *model.Phase) string { return p.Key })
		if err != nil {
			return nil, err
		}
		db.Phases = next
		return nil, nil
	})
}

// ---------------------------------------------------------------------------
// タスク（フロー図のボックスの元。事象をまたいで再利用される）
// ---------------------------------------------------------------------------

type taskBody struct {
	PhaseKey string         `json:"phase"`
	LaneKey  string         `json:"lane"`
	Kind     model.TaskKind `json:"kind"`
	Label    string         `json:"label"`
	Note     string         `json:"note"`
}

func (b taskBody) check(db *model.DB) error {
	if strings.TrimSpace(b.Label) == "" {
		return errf(http.StatusBadRequest, "タスクの名前が空です")
	}
	if db.Phase(b.PhaseKey) == nil {
		return errf(http.StatusBadRequest, "知らない段階です: %s", b.PhaseKey)
	}
	// 既定の担当。手順に投入するときの初期値になるので、実在する必要がある。
	if db.Lane(b.LaneKey) == nil {
		return errf(http.StatusBadRequest, "知らない担当です: %s", b.LaneKey)
	}
	if !b.Kind.Valid() {
		return errf(http.StatusBadRequest, "タスクの種類が不正です: %s", b.Kind)
	}
	return nil
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var in taskBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		if err := in.check(db); err != nil {
			return nil, err
		}
		t := &model.Task{
			Key:      uniqueKey("task", func(k string) bool { return db.Task(k) != nil }),
			PhaseKey: in.PhaseKey, LaneKey: in.LaneKey, Kind: in.Kind,
			Label: in.Label, Note: in.Note,
		}
		db.Tasks = append(db.Tasks, t)
		return t, nil
	})
}

func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	var in taskBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		t := db.Task(key)
		if t == nil {
			return nil, notFound("タスク", key)
		}
		if err := in.check(db); err != nil {
			return nil, err
		}
		// 担当はタスクの既定値。すでに使われている手順には波及させない。
		// 事象ごとに担当を変えているものを、部品側の変更で上書きしてしまうため。
		// 段階（色）は波及する。あちらはタスクそのものの性質だから。
		t.PhaseKey, t.LaneKey, t.Label, t.Note = in.PhaseKey, in.LaneKey, in.Label, in.Note
		// 種類は流れの扱いを変える。使われている手順にも波及する（そのための種類）。
		t.Kind = in.Kind
		return t, nil
	})
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		t := db.Task(key)
		if t == nil {
			return nil, notFound("タスク", key)
		}
		if err := refuseIfUsed("タスク", t.Label, stepsUsingTask(db, key)); err != nil {
			return nil, err
		}
		db.Tasks = remove(db.Tasks, func(x *model.Task) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderTasks(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		next, err := reorder(db.Tasks, in.Keys, func(t *model.Task) string { return t.Key })
		if err != nil {
			return nil, err
		}
		db.Tasks = next
		return nil, nil
	})
}

// taskUsage は削除する前に「どこで使われているか」を見るためのもの。
// 消してよいか確かめてから消す、という手順を画面側で踏めるようにする。
func (s *Server) taskUsage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var (
		usage []Usage
		found bool
	)
	s.st.Read(func(db *model.DB) {
		if found = db.Task(key) != nil; found {
			usage = stepsUsingTask(db, key)
		}
	})
	if !found {
		writeErr(w, notFound("タスク", key))
		return
	}
	s.ok(w, s.currentRev(), usage)
}

// ---------------------------------------------------------------------------
// 連絡先グループ
// ---------------------------------------------------------------------------

// contactBody はグループ 1 つ分。メンバーはまとめて置き換える。
//
// メンバーは順序を持つだけの単純な並びで、他から参照されない。
// 編集ダイアログもグループ単位で開くので、メンバー個別の API は要らない。
type contactBody struct {
	Name string            `json:"name"`
	Kind model.ContactKind `json:"kind"`
	Note string            `json:"note"`

	// LaneKey は連絡の矢印が向かう先。空なら矢印を描かない。
	// 「管理職」のように対応する列が無いグループもあるので、必須にしない。
	LaneKey string `json:"lane"`

	Members []*model.ContactMember `json:"members"`
}

func (b contactBody) check(db *model.DB) error {
	if strings.TrimSpace(b.Name) == "" {
		return errf(http.StatusBadRequest, "連絡先グループの名前が空です")
	}
	if !b.Kind.Valid() {
		return errf(http.StatusBadRequest, "連絡先の区分が不正です: %s", b.Kind)
	}
	if b.LaneKey != "" && db.Lane(b.LaneKey) == nil {
		return errf(http.StatusBadRequest, "知らない担当です: %s", b.LaneKey)
	}
	for i, m := range b.Members {
		if m == nil {
			return errf(http.StatusBadRequest, "%d 番目のメンバーが空です", i+1)
		}
		if strings.TrimSpace(m.Name) == "" {
			return errf(http.StatusBadRequest, "%d 番目のメンバーの名前が空です", i+1)
		}
	}
	return nil
}

func (s *Server) createContactGroup(w http.ResponseWriter, r *http.Request) {
	var in contactBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		if err := in.check(db); err != nil {
			return nil, err
		}
		g := &model.ContactGroup{
			Key:     uniqueKey("cg", func(k string) bool { return db.ContactGroup(k) != nil }),
			Name:    in.Name,
			Kind:    in.Kind,
			Note:    in.Note,
			LaneKey: in.LaneKey,
			Members: members(in.Members),
		}
		db.ContactGroups = append(db.ContactGroups, g)
		return g, nil
	})
}

func (s *Server) updateContactGroup(w http.ResponseWriter, r *http.Request) {
	var in contactBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		g := db.ContactGroup(key)
		if g == nil {
			return nil, notFound("連絡先グループ", key)
		}
		if err := in.check(db); err != nil {
			return nil, err
		}
		g.Name, g.Kind, g.Note, g.LaneKey = in.Name, in.Kind, in.Note, in.LaneKey
		g.Members = members(in.Members)
		return g, nil
	})
}

func (s *Server) deleteContactGroup(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		g := db.ContactGroup(key)
		if g == nil {
			return nil, notFound("連絡先グループ", key)
		}
		if err := refuseIfUsed("連絡先グループ", g.Name, stepsUsingContact(db, key)); err != nil {
			return nil, err
		}
		db.ContactGroups = remove(db.ContactGroups,
			func(x *model.ContactGroup) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderContactGroups(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		next, err := reorder(db.ContactGroups, in.Keys,
			func(g *model.ContactGroup) string { return g.Key })
		if err != nil {
			return nil, err
		}
		db.ContactGroups = next
		return nil, nil
	})
}

func (s *Server) contactUsage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var (
		usage []Usage
		found bool
	)
	s.st.Read(func(db *model.DB) {
		if found = db.ContactGroup(key) != nil; found {
			usage = stepsUsingContact(db, key)
		}
	})
	if !found {
		writeErr(w, notFound("連絡先グループ", key))
		return
	}
	s.ok(w, s.currentRev(), usage)
}

// ---------------------------------------------------------------------------

// members は nil を空配列にそろえる。JSON に null を出さないため。
func members(in []*model.ContactMember) []*model.ContactMember {
	if in == nil {
		return []*model.ContactMember{}
	}
	return in
}

// remove は条件に合う要素を取り除く。
func remove[T any](items []T, match func(T) bool) []T {
	out := items[:0]
	for _, it := range items {
		if !match(it) {
			out = append(out, it)
		}
	}
	return out
}
