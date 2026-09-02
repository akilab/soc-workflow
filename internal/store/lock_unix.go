//go:build !windows

package store

import "syscall"

// processAlive は、その PID のプロセスがまだ動いているかを返す。
// シグナル 0 は実際には何も送らず、届くかどうかだけを確かめる。
func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}
