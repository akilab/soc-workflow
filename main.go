// SOC Workflow — SOC のインシデント対応フローを作り、試し、配るためのツール。
//
// 単一の実行ファイルで動く。データは JSON ファイル 1 つ。
// 実行ファイルとデータファイルをコピーすれば、そのまま別の環境で使える。
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/akilab/soc-workflow/internal/model"
	"github.com/akilab/soc-workflow/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "エラー:", err)
		os.Exit(1)
	}
}

func run() error {
	dataPath := flag.String("data", "", "データファイルの場所（既定: 実行ファイルの隣）")
	flag.Parse()

	path, err := store.ResolvePath(*dataPath)
	if err != nil {
		return err
	}

	st, err := store.Open(path, store.Seed())
	if err != nil {
		return err
	}
	defer st.Close()

	fmt.Println("SOC Workflow")
	fmt.Println("データ:", st.Path())

	st.Read(func(db *model.DB) {
		steps := 0
		for _, e := range db.Events {
			steps += len(e.Steps)
		}
		members := 0
		for _, g := range db.ContactGroups {
			members += len(g.Members)
		}
		fmt.Printf("  フェーズ %d / タスク %d / 連絡先 %d グループ・%d 名 / 事象 %d・手順 %d\n",
			len(db.Phases), len(db.Tasks), len(db.ContactGroups), members,
			len(db.Events), steps)
	})

	return nil
}
