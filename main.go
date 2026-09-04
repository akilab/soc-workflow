// SOC Workflow — SOC のインシデント対応フローを作り、試し、配るためのツール。
//
// 単一の実行ファイルで動く。データは JSON ファイル 1 つ。
// 実行ファイルとデータファイルをコピーすれば、そのまま別の環境で使える。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/akilab/soc-workflow/internal/api"
	"github.com/akilab/soc-workflow/internal/model"
	"github.com/akilab/soc-workflow/internal/store"
	"github.com/akilab/soc-workflow/internal/web"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "エラー:", err)
		os.Exit(1)
	}
}

func run() error {
	dataPath := flag.String("data", "", "データファイルの場所（既定: 実行ファイルの隣）")
	addr := flag.String("addr", "127.0.0.1:8765", "待ち受けるアドレス")
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

	// API と画面を同じ入口にまとめる。ServeMux は細かいパターンを優先するので、
	// /api/... は API へ、それ以外は画面へ振り分けられる。
	routes := api.New(st).Routes()
	routes.Handle("/", web.Handler())

	srv := &http.Server{
		Handler:           api.Guard(routes),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("%s を開けません（他のプログラムが使っているかもしれません。"+
			"--addr で変えられます）: %w", *addr, err)
	}

	fmt.Println("SOC Workflow")
	fmt.Println("  データ:", st.Path())
	summarize(st)
	fmt.Println("  URL:   http://" + ln.Addr().String() + "/")
	fmt.Println("終了するには Ctrl+C。")

	// Ctrl+C で止める。止めるときに、書き込み待ちの変更を必ず書き出す。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	fmt.Println("\n終了します。")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	// Close が保存も済ませる（defer と二重に呼んでも壊れない）。
	return st.Close()
}

// summarize は読み込んだデータの中身を 1 行で出す。
// どのファイルを掴んでいるかを、起動のたびに目で確かめられるようにする。
func summarize(st store.Store) {
	st.Read(func(db *model.DB) {
		steps := 0
		for _, e := range db.Events {
			steps += len(e.Steps)
		}
		members := 0
		for _, g := range db.ContactGroups {
			members += len(g.Members)
		}
		fmt.Printf("  中身:   フェーズ %d / 対応 %d / 連絡先 %d グループ・%d 名 / フロー %d・手順 %d\n",
			len(db.Phases), len(db.Tasks), len(db.ContactGroups), members,
			len(db.Events), steps)
	})
}
