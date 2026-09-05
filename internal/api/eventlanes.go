package api

// フローごとの担当。どの列を使い、このフローでは何と呼ぶか。
//
// 全体の担当は「役割」で、フローごとに具体的な相手が変わる。一般的なフローの
// 「顧客」は、A 社向けのフローでは「高橋工務店」になる。持ち替えるのは呼び名だけで、
// 手順も対応も全体のキーを指したままなので、フローをまたいだ集計は壊れない。

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/akilab/soc-workflow/internal/model"
)

// eventLanesBody はフローが使う担当の並び。
//
// 空の配列を送れば「全体の担当をそのまま使う」に戻る。
type eventLanesBody struct {
	Lanes []*model.EventLane `json:"lanes"`
}

func (s *Server) setEventLanes(w http.ResponseWriter, r *http.Request) {
	var in eventLanesBody
	if !decode(w, r, &in) {
		return
	}
	key := r.PathValue("key")

	s.mutate(w, r, func(db *model.DB) (any, error) {
		ev := db.Event(key)
		if ev == nil {
			return nil, notFound("フロー", key)
		}
		// 前後の空白を落とす。空になれば「全体の名前を使う」に戻る。
		for _, el := range in.Lanes {
			if el != nil {
				el.Name = strings.TrimSpace(el.Name)
			}
		}
		if err := checkEventLanes(db, ev, in.Lanes); err != nil {
			return nil, err
		}
		ev.Lanes = in.Lanes
		touch(ev)
		return ev, nil
	})
}

// checkEventLanes は、その並びでこのフローが成り立つかを見る。
func checkEventLanes(db *model.DB, ev *model.Event, lanes []*model.EventLane) error {
	// 空なら「全体をそのまま使う」。確かめることがない。
	if len(lanes) == 0 {
		return nil
	}

	seen := map[string]bool{}
	for _, el := range lanes {
		if el == nil {
			return errf(http.StatusBadRequest, "担当の指定が空です")
		}
		if db.Lane(el.Key) == nil {
			return errf(http.StatusBadRequest, "知らない担当です: %s", el.Key)
		}
		if seen[el.Key] {
			return errf(http.StatusBadRequest, "担当が重複しています: %s", el.Key)
		}
		seen[el.Key] = true
	}

	// 使っている担当を外そうとしていないか。
	//
	// 外すと、その列に座っていた手順の行き場が無くなる。図に出せない手順が
	// できるくらいなら、先に手順を動かしてもらったほうがよい。
	var orphans []Usage
	for _, st := range ev.Steps {
		if seen[st.LaneKey] {
			continue
		}
		name := st.LaneKey
		if lane := db.Lane(st.LaneKey); lane != nil {
			name = lane.Name
		}
		orphans = append(orphans, Usage{
			Kind: "step", Key: st.ID,
			Label:      fmt.Sprintf("%s（%s）", st.Title, name),
			Event:      ev.Key,
			EventTitle: ev.Title,
		})
	}
	if len(orphans) > 0 {
		return conflict(
			fmt.Sprintf("外そうとしている担当を使っている手順が %d 件あります。"+
				"先に別の担当へ移してください", len(orphans)),
			orphans,
		)
	}
	return nil
}
