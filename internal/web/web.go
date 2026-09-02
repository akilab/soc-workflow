// Package web はフロントエンドをバイナリに同梱して配る。
//
// dist の中身は cmd/build-web が作る生成物だが、リポジトリに入れてある。
// そうしないと、フロントエンドを組み立てないと go build が通らなくなる。
// 「実行ファイル 1 つで動く」を、開発する側でも成り立たせておきたい。
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed dist
var dist embed.FS

// Handler は画面を返すハンドラ。
//
// 知らないパスは index.html を返す……ようなことはしない。
// 画面の切り替えは body の class で行っていて URL を持たないので、
// 存在しないパスは素直に 404 にする。打ち間違いが黙って通ると気づけない。
func Handler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // embed 済みなので、ここに来るならビルドが壊れている
	}
	files := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 手元で動かす道具で、作りかけを何度も読み直す。
		// 古い app.js が残って「直したのに変わらない」になるのを防ぐ。
		w.Header().Set("Cache-Control", "no-cache")

		// "/" は FileServer が index.html を返す。
		// ここで /index.html に書き換えてはいけない。FileServer は /index.html を
		// "./" に正規化して 301 を返すので、書き換えると往復し続けて画面が開かない。
		//
		// dist の中のものだけを返す。/../ のような指定は FileServer が弾く。
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}
