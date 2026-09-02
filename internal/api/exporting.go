package api

import (
	"fmt"
	"mime"
	"net/http"

	"github.com/akilab/soc-workflow/internal/export"
	"github.com/akilab/soc-workflow/internal/model"
)

// exportOne は事象 1 つ分の単一 HTML を返す。
func (s *Server) exportOne(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")

	var (
		out   []byte
		title string
		err   error
	)
	s.st.Read(func(db *model.DB) {
		ev := db.Event(key)
		if ev == nil {
			err = notFound("事象", key)
			return
		}
		title = ev.Title + " — SOC 対応フロー"
		out, err = export.HTML(db, []*model.Event{ev}, title)
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	sendHTML(w, r, out, title)
}

// exportAll は全事象を 1 つの HTML にまとめて返す。
func (s *Server) exportAll(w http.ResponseWriter, r *http.Request) {
	const title = "SOC 対応フロー"

	var (
		out []byte
		err error
	)
	s.st.Read(func(db *model.DB) {
		out, err = export.HTML(db, db.Events, title)
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	sendHTML(w, r, out, title)
}

// sendHTML は書き出した HTML を返す。
//
// 既定は画面に表示する（エディタのプレビューが iframe で読むため）。
// ?download=1 が付いていれば、保存を促す。
func sendHTML(w http.ResponseWriter, r *http.Request, body []byte, title string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// 書き出した HTML は自己完結していて外部を読まない。それを宣言しておく。
	// 万一データに仕込みが入っていても、外へ出ていく先を持たせない。
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:")

	if r.URL.Query().Get("download") != "" {
		w.Header().Set("Content-Disposition",
			mime.FormatMediaType("attachment",
				map[string]string{"filename": export.FileName(title)}))
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(body)))
	w.Write(body)
}
