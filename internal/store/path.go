package store

import (
	"os"
	"path/filepath"
)

// DefaultFileName はデータファイルの既定の名前。
const DefaultFileName = "soc-workflow.json"

// ResolvePath はデータファイルの置き場所を決める。
//
//  1. 明示指定（--data）があればそれ
//  2. 実行ファイルの隣。書ければここ（USB などに入れてそのまま持ち運べる）
//  3. 書けなければ OS のユーザーデータ領域
//
// ポータブルに持ち運ぶ使い方と、Program Files のような書けない場所に
// 置く使い方の両方で壊れないようにする。どこを使ったかは起動時に表示する。
func ResolvePath(explicit string) (string, error) {
	if explicit != "" {
		return filepath.Abs(explicit)
	}

	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if writable(dir) {
			return filepath.Join(dir, DefaultFileName), nil
		}
	}

	base, err := os.UserConfigDir()
	if err != nil {
		// 最後の手段。作業ディレクトリに置く。
		return filepath.Abs(DefaultFileName)
	}
	return filepath.Join(base, "soc-workflow", DefaultFileName), nil
}

// writable はそのディレクトリに書けるかを、実際に書いて確かめる。
// 権限だけを見ても、Windows の仮想化などで実態と食い違うことがあるため。
func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".write-test*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}
