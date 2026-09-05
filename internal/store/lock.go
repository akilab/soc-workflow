package store

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// lockFile は、同じデータファイルを 2 つのプロセスが同時に触るのを防ぐ。
//
// JSON ファイルは書くたびに全体を差し替えるので、2 つ動くと後勝ちで
// 変更が消える。ローカル単独利用の想定だが、うっかり二重起動することはある。
type lockFile struct {
	path string
}

// acquireLock はロックを取る。既に他のプロセスが握っていればエラーを返す。
func acquireLock(path string) (*lockFile, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err == nil {
		fmt.Fprintf(f, "%d\n", os.Getpid())
		f.Close()
		return &lockFile{path: path}, nil
	}
	if !errors.Is(err, os.ErrExist) {
		return nil, fmt.Errorf("ロックを作れません: %w", err)
	}

	// 前回が異常終了して残ったロックかもしれない。書いてある PID を見る。
	if pid, ok := readPID(path); ok && !processAlive(pid) {
		if rmErr := os.Remove(path); rmErr == nil {
			return acquireLock(path)
		}
	}
	return nil, fmt.Errorf(
		"このデータは別のプロセスが使用中です（%s）。\n"+
			"起動していないのにこの表示が出る場合は、上のファイルを消してから再実行してください", path)
}

func (l *lockFile) release() error {
	if l == nil {
		return nil
	}
	if err := os.Remove(l.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("ロックを解放できません: %w", err)
	}
	return nil
}

func readPID(path string) (int, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, true
}
