package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/akilab/soc-workflow/internal/model"
)

// testdata/v1.json は版 1 の種データそのもの。
// 実際に使われていたファイルが開けなくなっていないかを、これで確かめる。
func loadV1(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "v1.json"))
	if err != nil {
		t.Fatalf("版 1 のデータを読めません: %v", err)
	}
	return raw
}

// 版 1 のファイルがそのまま開けること。
func TestOpenMigratesV1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(path, loadV1(t), 0o644); err != nil {
		t.Fatal(err)
	}

	st, err := Open(path, nil)
	if err != nil {
		t.Fatalf("版 1 のデータを開けません: %v", err)
	}
	defer st.Close()

	st.Read(func(db *model.DB) {
		if db.Version != model.Version {
			t.Errorf("version = %d, 期待 %d", db.Version, model.Version)
		}
		if len(db.Lanes) == 0 {
			t.Fatal("担当が作られていません")
		}
		// 版 1 には担当の列が無かったので、既定の 4 本が入る
		want := []string{"customer", "tier1", "tier2", "tier3"}
		for i, k := range want {
			if i >= len(db.Lanes) || db.Lanes[i].Key != k {
				t.Errorf("担当 %d 番目が違います: %v", i, db.Lanes)
				break
			}
		}

		// すべての手順と対応に、実在する担当が入っていること
		for _, tk := range db.Tasks {
			if db.Lane(tk.LaneKey) == nil {
				t.Errorf("対応 %q の担当が解決しません: %q", tk.Label, tk.LaneKey)
			}
		}
		for _, ev := range db.Events {
			for _, s := range ev.Steps {
				if db.Lane(s.LaneKey) == nil {
					t.Errorf("手順 %q の担当が解決しません: %q", s.Title, s.LaneKey)
				}
			}
		}
	})
}

// 版 1 の tier の値が、正しい担当に対応づくこと。
func TestMigrateMapsTierToLane(t *testing.T) {
	raw, err := migrateRaw(loadV1(t))
	if err != nil {
		t.Fatal(err)
	}

	// 元データの tier を数え、移行後の担当の数と突き合わせる
	var before struct {
		Events []struct {
			Steps []struct {
				Tier string `json:"tier"`
			} `json:"steps"`
		} `json:"events"`
	}
	if err := json.Unmarshal(loadV1(t), &before); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{}
	for _, ev := range before.Events {
		for _, s := range ev.Steps {
			want[v1TierToLane[s.Tier]]++
		}
	}

	var after model.DB
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, ev := range after.Events {
		for _, s := range ev.Steps {
			got[s.LaneKey]++
		}
	}

	for k, n := range want {
		if got[k] != n {
			t.Errorf("担当 %s が %d 件, 期待 %d 件", k, got[k], n)
		}
	}
	if len(got) != len(want) {
		t.Errorf("担当の種類が %d, 期待 %d", len(got), len(want))
	}
}

// 移行後のデータに、消えたはずの tier が残っていないこと。
func TestMigrateDropsTier(t *testing.T) {
	raw, err := migrateRaw(loadV1(t))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"tier"`) {
		t.Error("移行後も tier が残っています")
	}
}

// 連絡先の担当は空のまま。当てずっぽうで結びつけると誤った矢印が描かれる。
func TestMigrateLeavesContactLaneEmpty(t *testing.T) {
	raw, err := migrateRaw(loadV1(t))
	if err != nil {
		t.Fatal(err)
	}
	var db model.DB
	if err := json.Unmarshal(raw, &db); err != nil {
		t.Fatal(err)
	}
	for _, g := range db.ContactGroups {
		if g.LaneKey != "" {
			t.Errorf("連絡先 %q に担当が入っています: %q", g.Name, g.LaneKey)
		}
	}
}

// すでにいまの版なら、何も変えずに返すこと。
func TestMigrateIsNoOpOnCurrentVersion(t *testing.T) {
	raw, err := migrateRaw(Seed())
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(Seed()) {
		t.Error("いまの版のデータが書き換えられました")
	}
}

// 新しい版は開かないこと。
func TestMigrateRefusesNewerVersion(t *testing.T) {
	if _, err := migrateRaw([]byte(`{"version":9999}`)); err == nil {
		t.Error("新しい版のデータを受け入れてしまいました")
	}
}
