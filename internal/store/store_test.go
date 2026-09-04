package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/akilab/soc-workflow/internal/model"
)

// 初回は種データから作られること。
func TestOpenCreatesFromSeed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")

	st, err := Open(path, Seed())
	if err != nil {
		t.Fatalf("開けません: %v", err)
	}
	defer st.Close()

	var tasks, events int
	st.Read(func(db *model.DB) {
		tasks, events = len(db.Tasks), len(db.Events)
		if db.Version != model.Version {
			t.Errorf("version = %d, 期待 %d", db.Version, model.Version)
		}
	})
	if tasks == 0 || events == 0 {
		t.Errorf("種データが読めていません: 対応 %d / フロー %d", tasks, events)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("ファイルが作られていません: %v", err)
	}
}

// 変更が保存され、開き直しても残っていること。
func TestWriteAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")

	st, err := Open(path, Seed())
	if err != nil {
		t.Fatal(err)
	}
	err = st.Write(func(db *model.DB) error {
		db.Events = append(db.Events, &model.Event{
			Key: "new", Title: "新しいフロー", Severity: model.S2,
		})
		return nil
	})
	if err != nil {
		t.Fatalf("書けません: %v", err)
	}
	if err := st.Close(); err != nil { // Close が保存も済ませる
		t.Fatalf("閉じられません: %v", err)
	}

	st2, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()

	var found bool
	st2.Read(func(db *model.DB) { found = db.Event("new") != nil })
	if !found {
		t.Error("保存したフローが読み戻せません")
	}
}

// fn がエラーを返したら変更が捨てられること。
func TestWriteRollbackOnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	st, _ := Open(path, Seed())
	defer st.Close()

	var before int
	st.Read(func(db *model.DB) { before = len(db.Events) })

	wantErr := os.ErrInvalid
	if err := st.Write(func(db *model.DB) error { return wantErr }); err != wantErr {
		t.Fatalf("エラーが返りません: %v", err)
	}

	var after int
	st.Read(func(db *model.DB) { after = len(db.Events) })
	if before != after {
		t.Errorf("フロー数が変わっています: %d → %d", before, after)
	}
}

// 同じファイルは二重に開けないこと。
func TestLockPreventsSecondOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")

	st, err := Open(path, Seed())
	if err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path, Seed()); err == nil {
		t.Error("二重に開けてしまいました")
	}

	// 閉じれば開けるようになる
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	st2, err := Open(path, Seed())
	if err != nil {
		t.Fatalf("閉じたあとに開けません: %v", err)
	}
	st2.Close()
}

// 死んだプロセスのロックが残っていても開けること。
func TestStaleLockIsReclaimed(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")

	// あり得ない PID を書いたロックを置いておく
	if err := os.WriteFile(path+".lock", []byte("999999999\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	st, err := Open(path, Seed())
	if err != nil {
		t.Fatalf("古いロックを回収できません: %v", err)
	}
	st.Close()
}

// 書き出した JSON が読み直せる形であること（null ではなく空配列になる）。
func TestSavedJSONHasEmptyArraysNotNull(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	st, _ := Open(path, []byte(`{"version":1}`))
	st.Close()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var probe struct {
		Phases        []json.RawMessage `json:"phases"`
		Tasks         []json.RawMessage `json:"tasks"`
		ContactGroups []json.RawMessage `json:"contactGroups"`
		Events        []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("書き出した JSON が読めません: %v", err)
	}
	for name, v := range map[string][]json.RawMessage{
		"phases": probe.Phases, "tasks": probe.Tasks,
		"contactGroups": probe.ContactGroups, "events": probe.Events,
	} {
		if v == nil {
			t.Errorf("%s が null です（空配列であるべき）", name)
		}
	}
}

// 新しい版のデータは開かないこと。
func TestRefusesNewerVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	if err := os.WriteFile(path, []byte(`{"version":9999}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, nil); err == nil {
		t.Error("新しい版のデータを開いてしまいました")
	}
}

// 種データが model と食い違っていないこと（参照が全部解決すること）。
func TestSeedIsConsistent(t *testing.T) {
	var db model.DB
	if err := json.Unmarshal(Seed(), &db); err != nil {
		t.Fatalf("種データが読めません: %v", err)
	}

	if len(db.Lanes) == 0 {
		t.Fatal("担当が 1 つもありません。フロー図の列が作れません")
	}
	for _, task := range db.Tasks {
		if db.Phase(task.PhaseKey) == nil {
			t.Errorf("対応 %q が知らないフェーズ %q を指しています", task.Key, task.PhaseKey)
		}
		if db.Lane(task.LaneKey) == nil {
			t.Errorf("対応 %q が知らない担当 %q を指しています", task.Key, task.LaneKey)
		}
	}
	for _, g := range db.ContactGroups {
		// 空は「矢印を描かない」の意味なので許す。
		if g.LaneKey != "" && db.Lane(g.LaneKey) == nil {
			t.Errorf("連絡先 %q が知らない担当 %q を指しています", g.Key, g.LaneKey)
		}
	}
	for _, ev := range db.Events {
		for _, st := range ev.Steps {
			if db.Lane(st.LaneKey) == nil {
				t.Errorf("%s / 手順 %q が知らない担当 %q を指しています",
					ev.Key, st.Title, st.LaneKey)
			}
			if db.Task(st.TaskKey) == nil {
				t.Errorf("%s / 手順 %q が知らない対応 %q を指しています",
					ev.Key, st.Title, st.TaskKey)
			}
			for _, key := range st.Contacts {
				if db.ContactGroup(key) == nil {
					t.Errorf("%s / 手順 %q が知らない連絡先 %q を指しています",
						ev.Key, st.Title, key)
				}
			}
			for _, c := range st.Conditions {
				if ev.Decision(c.Key) == nil {
					t.Errorf("%s / 手順 %q の条件が知らない判断 %q を指しています",
						ev.Key, st.Title, c.Key)
				}
			}
		}
	}
}
