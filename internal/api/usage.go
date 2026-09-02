package api

import (
	"fmt"
	"net/http"

	"github.com/akilab/soc-workflow/internal/model"
)

// Usage は「それがどこで使われているか」1 件分。
//
// 削除を断るときに添える。タスクやフェーズや連絡先を消すと参照している側が壊れるので、
// 何件あるかだけでなく、どの事象のどの手順かまで返す。
// 「黙って消さない」ためには、消せない理由を画面に出せる形で渡す必要がある。
type Usage struct {
	Kind       string `json:"kind"`                 // "task" | "step"
	Key        string `json:"key"`                  // タスクキー、または手順 ID
	Label      string `json:"label"`                // 人が読む名前
	Event      string `json:"event,omitempty"`      // 手順の場合、属する事象のキー
	EventTitle string `json:"eventTitle,omitempty"` // 同、事象の名前
}

// tasksUsingPhase はそのフェーズに属するタスクを返す。
func tasksUsingPhase(db *model.DB, phaseKey string) []Usage {
	var out []Usage
	for _, t := range db.Tasks {
		if t.PhaseKey == phaseKey {
			out = append(out, Usage{Kind: "task", Key: t.Key, Label: t.Label})
		}
	}
	return out
}

// stepsUsingTask はそのタスクを使っている手順を返す。
func stepsUsingTask(db *model.DB, taskKey string) []Usage {
	return collectSteps(db, func(s *model.Step) bool { return s.TaskKey == taskKey })
}

// stepsUsingContact はその連絡先グループを参照している手順を返す。
func stepsUsingContact(db *model.DB, groupKey string) []Usage {
	return collectSteps(db, func(s *model.Step) bool {
		for _, k := range s.Contacts {
			if k == groupKey {
				return true
			}
		}
		return false
	})
}

// collectSteps は条件に合う手順を、事象の情報を添えて集める。
func collectSteps(db *model.DB, match func(*model.Step) bool) []Usage {
	var out []Usage
	for _, ev := range db.Events {
		for _, st := range ev.Steps {
			if match(st) {
				out = append(out, Usage{
					Kind: "step", Key: st.ID, Label: st.Title,
					Event: ev.Key, EventTitle: ev.Title,
				})
			}
		}
	}
	return out
}

// refuseIfUsed は使用箇所があれば 409 を返す。無ければ nil。
func refuseIfUsed(what, name string, usage []Usage) error {
	if len(usage) == 0 {
		return nil
	}
	return conflict(
		fmt.Sprintf("%s「%s」は %d か所で使われているため削除できません", what, name, len(usage)),
		usage,
	)
}

// ---------------------------------------------------------------------------
// 並べ替えとキー
// ---------------------------------------------------------------------------

// reorder は items を keys の順に並べ替える。
//
// keys が元の集合とちょうど一致しないときは拒む。
// 過不足を黙って補うと、クライアントの取りこぼしがそのままデータの消失になる。
// 順序は配列の並びで表しているので、ここが唯一の防波堤になる。
func reorder[T any](items []T, keys []string, keyOf func(T) string) ([]T, error) {
	if len(keys) != len(items) {
		return nil, errf(http.StatusBadRequest,
			"並べ替えの指定が %d 件、対象が %d 件で一致しません", len(keys), len(items))
	}

	byKey := make(map[string]T, len(items))
	for _, it := range items {
		byKey[keyOf(it)] = it
	}

	out := make([]T, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, k := range keys {
		it, found := byKey[k]
		if !found {
			return nil, errf(http.StatusBadRequest, "並べ替えに知らないキーが含まれています: %s", k)
		}
		if seen[k] {
			return nil, errf(http.StatusBadRequest, "並べ替えにキーが重複しています: %s", k)
		}
		seen[k] = true
		out = append(out, it)
	}
	return out, nil
}

// uniqueKey は使われていないキーを作る。
//
// 乱数ではなく通し番号にしてある。データファイルは人が開いて読むものなので、
// task-45 のほうが 8f3a2c より追いやすい。衝突は線形に探して避ける。
func uniqueKey(prefix string, taken func(string) bool) string {
	for i := 1; ; i++ {
		k := fmt.Sprintf("%s-%d", prefix, i)
		if !taken(k) {
			return k
		}
	}
}
