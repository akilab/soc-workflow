package api

// レーン（担当）。フロー図の列になる。
//
// 段階と同じく、名前も色も並び順も設定できる。フローに出てくる相手は
// 組織によって違い、呼び方も違うため（顧客・管理職・外部機関・ベンダー）。
// 並び順は左からの順で、左を「外側」、右を「上位」に置くと、
// エスカレーションが右へ、顧客連絡が左へ、という向きで揃う。

import (
	"net/http"
	"strings"

	"github.com/akilab/soc-workflow/internal/model"
)

type laneBody struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (b laneBody) check() error {
	if strings.TrimSpace(b.Name) == "" {
		return errf(http.StatusBadRequest, "担当の名前が空です")
	}
	return nil
}

func (s *Server) createLane(w http.ResponseWriter, r *http.Request) {
	var in laneBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		if err := in.check(); err != nil {
			return nil, err
		}
		l := &model.Lane{
			Key:   uniqueKey("lane", func(k string) bool { return db.Lane(k) != nil }),
			Name:  in.Name,
			Color: in.Color,
		}
		db.Lanes = append(db.Lanes, l)
		return l, nil
	})
}

func (s *Server) updateLane(w http.ResponseWriter, r *http.Request) {
	var in laneBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		l := db.Lane(key)
		if l == nil {
			return nil, notFound("担当", key)
		}
		if err := in.check(); err != nil {
			return nil, err
		}
		l.Name, l.Color = in.Name, in.Color
		return l, nil
	})
}

func (s *Server) deleteLane(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	s.mutate(w, func(db *model.DB) (any, error) {
		l := db.Lane(key)
		if l == nil {
			return nil, notFound("担当", key)
		}
		// 消すと列が無くなり、そこに座っていた手順の行き場が無くなる。
		if err := refuseIfUsed("担当", l.Name, usingLane(db, key)); err != nil {
			return nil, err
		}
		if len(db.Lanes) <= 1 {
			return nil, errf(http.StatusConflict,
				"担当は 1 つ以上必要です。フロー図の列が無くなります")
		}
		db.Lanes = remove(db.Lanes, func(x *model.Lane) bool { return x.Key == key })
		return nil, nil
	})
}

func (s *Server) orderLanes(w http.ResponseWriter, r *http.Request) {
	var in orderBody
	if !decode(w, r, &in) {
		return
	}
	s.mutate(w, func(db *model.DB) (any, error) {
		next, err := reorder(db.Lanes, in.Keys, func(l *model.Lane) string { return l.Key })
		if err != nil {
			return nil, err
		}
		db.Lanes = next
		return nil, nil
	})
}

func (s *Server) laneUsage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var (
		usage []Usage
		found bool
	)
	s.st.Read(func(db *model.DB) {
		if found = db.Lane(key) != nil; found {
			usage = usingLane(db, key)
		}
	})
	if !found {
		writeErr(w, notFound("担当", key))
		return
	}
	s.ok(w, s.currentRev(), usage)
}
