//go:build windows

package store

import "syscall"

// processQueryLimitedInformation は、他プロセスの生死だけを問い合わせるための最小の権限。
const processQueryLimitedInformation = 0x1000

// stillActive は、まだ終了していないプロセスの終了コード（STILL_ACTIVE）。
const stillActive = 259

// processAlive は、その PID のプロセスがまだ動いているかを返す。
// 判断できないときは「動いている」とみなす。ロックを誤って奪うより安全側に倒す。
func processAlive(pid int) bool {
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false // 開けない = もういない
	}
	defer syscall.CloseHandle(h)

	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return true
	}
	return code == stillActive
}
