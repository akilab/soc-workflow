package store

import (
	"encoding/json"
	"fmt"

	"github.com/akilab/soc-workflow/internal/model"
)

// migrateRaw は古い版のデータを、いまの形に直してから返す。
//
// 構造体に読み込む前に、JSON のまま直している。消えた欄（版 1 の tier）は
// 構造体に読み込んだ時点で失われてしまうため、そこから作り直せなくなる。
func migrateRaw(raw []byte) ([]byte, error) {
	var head struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, fmt.Errorf("JSON として読めません: %w", err)
	}

	if head.Version > model.Version {
		return nil, fmt.Errorf("このデータは新しい版です（データ %d / このアプリ %d）。"+
			"アプリを更新してください", head.Version, model.Version)
	}
	if head.Version == model.Version {
		return raw, nil
	}

	var db map[string]any
	if err := json.Unmarshal(raw, &db); err != nil {
		return nil, fmt.Errorf("JSON として読めません: %w", err)
	}

	// 版が離れていても順に通す。1 → 3 のときも 1→2、2→3 と適用される。
	if head.Version < 2 {
		migrate1to2(db)
	}

	db["version"] = model.Version
	out, err := json.Marshal(db)
	if err != nil {
		return nil, fmt.Errorf("移行したデータを書き出せません: %w", err)
	}
	return out, nil
}

// v1Lanes は版 1 の tier をレーンに置き換えるときの既定。
//
// 顧客を左端に置く。フローに出てくる相手を左から右へ「外側 → 内側 → 上位」の
// 順に並べると、エスカレーションが右へ、顧客連絡が左へ、という向きで揃う。
// 色は段階が使っていないもの（c3 / c7 / c9 / c10）から選ぶ。
// 段階は c1・c2・c4・c5・c6 を使っており、レーンと段階は同じ画面に同時に出る。
var v1Lanes = []map[string]any{
	{"key": "customer", "name": "顧客", "color": "var(--c3)"},
	{"key": "tier1", "name": "Tier1", "color": "var(--c10)"},
	{"key": "tier2", "name": "Tier2", "color": "var(--c7)"},
	{"key": "tier3", "name": "Tier3・CSIRT", "color": "var(--c9)"},
}

// v1TierToLane は版 1 の tier 値の対応。
// 未指定（空）は Tier1 に寄せる。版 1 の手順はすべて受信から始まるため。
var v1TierToLane = map[string]string{
	"":   "tier1",
	"t1": "tier1",
	"t2": "tier2",
	"t3": "tier3",
}

// migrate1to2 は担当を Tier（固定 3 値）から Lane（設定可能）へ移す。
//
// 図の列が段階から担当に変わったことに伴う移行。
// 連絡先グループの lane は空のままにしておく。「管理職（夜間一次連絡）」が
// どのレーンかは機械的には決まらず、当てずっぽうで結びつけると
// 誤った矢印が描かれる。空なら矢印を描かないので、画面で割り当ててもらう。
func migrate1to2(db map[string]any) {
	if _, ok := db["lanes"]; !ok {
		lanes := make([]any, len(v1Lanes))
		for i, l := range v1Lanes {
			lanes[i] = l
		}
		db["lanes"] = lanes
	}

	for _, t := range items(db["tasks"]) {
		moveTierToLane(t)
	}
	for _, ev := range items(db["events"]) {
		for _, st := range items(ev["steps"]) {
			moveTierToLane(st)
		}
	}
	for _, g := range items(db["contactGroups"]) {
		if _, ok := g["lane"]; !ok {
			g["lane"] = ""
		}
	}
}

// moveTierToLane は tier 欄を lane 欄に置き換える。
func moveTierToLane(m map[string]any) {
	tier, _ := m["tier"].(string)
	delete(m, "tier")
	lane, ok := v1TierToLane[tier]
	if !ok {
		lane = "tier1" // 知らない値。捨てずに既定へ寄せる
	}
	m["lane"] = lane
}

// items は JSON の配列を、要素がオブジェクトのものだけ取り出す。
// 壊れた要素があっても移行全体を止めない。
func items(v any) []map[string]any {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, e := range arr {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}
