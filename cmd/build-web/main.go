// build-web はフロントエンドを 1 つの JS と 1 つの CSS にまとめる。
//
// バンドラは esbuild を Go の API から呼ぶ。esbuild 自体が Go で書かれているので、
// Node も npm も node_modules も要らない。フロントエンドを触るのに必要な道具が
// Go だけで済み、「実行ファイルをコピーすれば動く」という方針が開発側にも通る。
//
//	go run ./cmd/build-web          まとめる
//	go run ./cmd/build-web -dev     ソースマップ付き・圧縮なし
//
// 出力先の internal/web/dist は embed でバイナリに入る。生成物だがコミットする。
// そうしないと、フロントエンドを組み立てないと go build が通らなくなる。
//
// このプログラムだけが esbuild に依存する。出荷するバイナリは標準ライブラリだけで動く
// （go list -deps . で確かめられる）。
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
)

const (
	entry  = "web/src/main.ts"
	outDir = "internal/web/dist"
)

// copies は、まとめずにそのまま置くファイル。
//
// viewer の CSS と JS は internal/export が正本。エディタの試走モードは
// 書き出し HTML と同じものを使う必要があるので、複製ではなくコピーで持ってくる。
// 手で 2 か所を直す状況を作らない。
var copies = map[string]string{
	"web/index.html":             "index.html",
	"internal/export/viewer.css": "viewer.css",
	"internal/export/viewer.js":  "viewer.js",
}

func main() {
	dev := flag.Bool("dev", false, "ソースマップを付け、圧縮しない")
	flag.Parse()

	if err := run(*dev); err != nil {
		fmt.Fprintln(os.Stderr, "エラー:", err)
		os.Exit(1)
	}
}

func run(dev bool) error {
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("%s が見つかりません。リポジトリの直下で実行してください", entry)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	opts := api.BuildOptions{
		EntryPoints: []string{entry},
		Bundle:      true,
		Outdir:      outDir,
		EntryNames:  "app",
		Format:      api.FormatIIFE, // モジュールとして読み込ませない。script タグ 1 つで済む
		Target:      api.ES2020,     // 現行の Chromium 系 / Firefox に合わせる
		Charset:     api.CharsetUTF8,
		Write:       true,
		LogLevel:    api.LogLevelWarning,
	}
	if dev {
		opts.Sourcemap = api.SourceMapLinked
	} else {
		opts.MinifyWhitespace = true
		opts.MinifyIdentifiers = true
		opts.MinifySyntax = true
	}

	result := api.Build(opts)
	for _, m := range result.Warnings {
		fmt.Fprintf(os.Stderr, "警告: %s\n", format(m))
	}
	if len(result.Errors) > 0 {
		for _, m := range result.Errors {
			fmt.Fprintf(os.Stderr, "  %s\n", format(m))
		}
		return fmt.Errorf("まとめられません（%d 件）", len(result.Errors))
	}

	for src, name := range copies {
		if err := copyFile(src, filepath.Join(outDir, name)); err != nil {
			return err
		}
	}

	return report()
}

func format(m api.Message) string {
	if m.Location == nil {
		return m.Text
	}
	return fmt.Sprintf("%s:%d:%d %s",
		m.Location.File, m.Location.Line, m.Location.Column, m.Text)
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("%s を読めません: %w", src, err)
	}
	if err := os.WriteFile(dst, b, 0o644); err != nil {
		return fmt.Errorf("%s を書けません: %w", dst, err)
	}
	return nil
}

// report は何がどれだけ出来たかを表示する。
func report() error {
	entries, err := os.ReadDir(outDir)
	if err != nil {
		return err
	}
	var total int64
	fmt.Println(outDir)
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		total += info.Size()
		fmt.Printf("  %-14s %6.1f KB\n", e.Name(), float64(info.Size())/1024)
	}
	fmt.Printf("  %-14s %6.1f KB\n", "合計", float64(total)/1024)
	return nil
}
