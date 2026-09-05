// Package store はデータの読み書きを受け持つ。
//
// 実体は JSON ファイル 1 つ。全体をメモリに載せ、変更のたびに書き戻す。
// この規模（数十 KB、フロー 100 件でも 1MB 未満）ならこれで足りる。
//
// 保存層は Store インターフェースで切ってある。実データで困ることがあれば、
// 同じインターフェースで別の実装（SQLite など）に差し替えられる。
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/akilab/soc-workflow/internal/model"
)

// Store はデータの入れ物。
type Store interface {
	// Read は読み取り。fn の中で受け取った DB を書き換えてはいけない。
	Read(fn func(*model.DB))
	// Write は変更。fn がエラーを返せば変更は破棄され、保存もされない。
	Write(fn func(*model.DB) error) error
	// Snapshot は今のデータを JSON にして返す。取り消しの記録に使う。
	//
	// 全部で 28KB しかないので、操作ごとの差分ではなく丸ごと控える。
	// 差分と逆操作を作ると、操作の種類ぶんだけ「戻し方」を書くことになり、
	// 1 つ書き忘れると黙って壊れる。丸ごとなら書き戻しは 1 通りしかない。
	Snapshot() ([]byte, error)
	// Restore は Snapshot が返したものを丸ごと書き戻す。
	Restore(raw []byte) error
	// Flush は保存待ちの変更をすぐ書き出す。
	Flush() error
	// Close は保存してからロックを解放する。
	Close() error
	// Path は実際に使っているファイルの場所を返す。
	Path() string
}

// saveDelay は最後の変更から実際に書き出すまでの待ち時間。
// 詳細欄への入力のたびに全体を書き直さないためのまとめ書き。
const saveDelay = 400 * time.Millisecond

// JSONStore は JSON ファイル 1 つで保持する実装。
type JSONStore struct {
	path string
	lock *lockFile

	mu    sync.RWMutex
	db    *model.DB
	dirty bool

	timerMu sync.Mutex
	timer   *time.Timer
	closed  bool
}

var _ Store = (*JSONStore)(nil)

// Open は path のファイルを開く。無ければ seed を初期データとして作る。
// 同じファイルを二重に開かないよう、隣にロックファイルを作る。
func Open(path string, seed []byte) (*JSONStore, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("パスを解決できません: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return nil, fmt.Errorf("保存先を作れません: %w", err)
	}

	lock, err := acquireLock(abs + ".lock")
	if err != nil {
		return nil, err
	}

	s := &JSONStore{path: abs, lock: lock}
	if err := s.load(seed); err != nil {
		lock.release()
		return nil, err
	}
	return s, nil
}

func (s *JSONStore) load(seed []byte) error {
	raw, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		// 初回。種データから始める。
		raw = seed
		if len(raw) == 0 {
			raw = []byte(`{"version":1}`)
		}
	case err != nil:
		return fmt.Errorf("読み込めません: %w", err)
	}

	// 古い版なら、構造体に読み込む前に JSON のまま直す。
	raw, mErr := migrateRaw(raw)
	if mErr != nil {
		return fmt.Errorf("%s: %w", s.path, mErr)
	}

	var db model.DB
	if err := json.Unmarshal(raw, &db); err != nil {
		return fmt.Errorf("JSON として読めません（%s）: %w", s.path, err)
	}
	normalize(&db)
	s.db = &db

	// ファイルが無かった場合はここで作っておく。
	if errors.Is(err, os.ErrNotExist) {
		return s.write()
	}
	return nil
}

// migrate は古い版のデータを現在の形に合わせる。
func normalizeLanes(db *model.DB) {
	if db.Lanes == nil {
		db.Lanes = []*model.Lane{}
	}
}

// normalize は nil のスライスを空スライスにする。
// JSON に null ではなく [] を出したいのと、画面側で null を気にしないで済むように。
func normalize(db *model.DB) {
	normalizeLanes(db)
	if db.Phases == nil {
		db.Phases = []*model.Phase{}
	}
	if db.Tasks == nil {
		db.Tasks = []*model.Task{}
	}
	if db.ContactGroups == nil {
		db.ContactGroups = []*model.ContactGroup{}
	}
	if db.SLAs == nil {
		db.SLAs = []*model.SLA{}
	}
	if db.Events == nil {
		db.Events = []*model.Event{}
	}
	for _, g := range db.ContactGroups {
		if g.Members == nil {
			g.Members = []*model.ContactMember{}
		}
	}
	for _, e := range db.Events {
		if e.Steps == nil {
			e.Steps = []*model.Step{}
		}
		for _, st := range e.Steps {
			if st.Conditions == nil {
				st.Conditions = []model.Condition{}
			}
			if st.Contacts == nil {
				st.Contacts = []string{}
			}
		}
	}
}

// Read は読み取り。
func (s *JSONStore) Read(fn func(*model.DB)) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	fn(s.db)
}

// Write は変更して保存を予約する。
func (s *JSONStore) Write(fn func(*model.DB) error) error {
	s.mu.Lock()
	if err := fn(s.db); err != nil {
		s.mu.Unlock()
		return err
	}
	normalize(s.db)
	s.dirty = true
	s.mu.Unlock()

	s.scheduleSave()
	return nil
}

// Snapshot は今のデータを JSON にして返す。
func (s *JSONStore) Snapshot() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	raw, err := json.Marshal(s.db)
	if err != nil {
		return nil, fmt.Errorf("JSON にできません: %w", err)
	}
	return raw, nil
}

// Restore は控えを丸ごと書き戻す。
//
// 読めない控えで今のデータを潰さないよう、先に解析してから差し替える。
func (s *JSONStore) Restore(raw []byte) error {
	var db model.DB
	if err := json.Unmarshal(raw, &db); err != nil {
		return fmt.Errorf("控えを読めません: %w", err)
	}
	normalize(&db)

	s.mu.Lock()
	s.db = &db
	s.dirty = true
	s.mu.Unlock()

	s.scheduleSave()
	return nil
}

// scheduleSave はまとめ書きのタイマーを引き直す。
func (s *JSONStore) scheduleSave() {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()
	if s.closed {
		return
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(saveDelay, func() {
		if err := s.Flush(); err != nil {
			fmt.Fprintf(os.Stderr, "保存に失敗しました: %v\n", err)
		}
	})
}

// Flush は保存待ちの変更を書き出す。
func (s *JSONStore) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	if err := s.write(); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

// write は実際にファイルへ書く。呼び出し側でロックを取っていること。
//
// 同じディレクトリに一時ファイルを作ってから rename する。
// rename は同一ボリューム内ならほぼ不可分なので、途中で落ちても
// 元のファイルが壊れずに残る。
func (s *JSONStore) write() error {
	raw, err := json.MarshalIndent(s.db, "", "  ")
	if err != nil {
		return fmt.Errorf("JSON にできません: %w", err)
	}
	raw = append(raw, '\n')

	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, filepath.Base(s.path)+".tmp*")
	if err != nil {
		return fmt.Errorf("一時ファイルを作れません: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // rename が成功していれば消えているので実害はない

	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("書き込めません: %w", err)
	}
	// ディスクまで届かせてから差し替える。
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("同期できません: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("閉じられません: %w", err)
	}
	// Windows では既存ファイルへの rename も os.Rename が面倒を見る。
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("差し替えられません: %w", err)
	}
	return nil
}

// Close は保存してロックを解放する。
func (s *JSONStore) Close() error {
	s.timerMu.Lock()
	s.closed = true
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.timerMu.Unlock()

	err := s.Flush()
	if rerr := s.lock.release(); err == nil {
		err = rerr
	}
	return err
}

// Path は使っているファイルの場所を返す。
func (s *JSONStore) Path() string { return s.path }
