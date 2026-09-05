package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	return w
}

// "/" が画面を返すこと。
//
// ここで /index.html に書き換えると、FileServer が "./" に正規化して 301 を返し、
// 往復し続けて画面が一切開かなくなる。一度これを作り込んだので、印を残す。
func TestRootServesPageWithoutRedirect(t *testing.T) {
	w := get(t, "/")

	if w.Code != http.StatusOK {
		t.Fatalf("状態コード %d, 期待 200（リダイレクトの往復になっていませんか）", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "<title>SOC Workflow</title>") {
		t.Error("index.html が返っていません")
	}
	// 画面が読み込むものが揃っていること
	for _, want := range []string{`src="app.js"`, `href="app.css"`, `src="viewer.js"`} {
		if !strings.Contains(body, want) {
			t.Errorf("%s の読み込みがありません", want)
		}
	}
}

// 同梱したファイルが返ること。
func TestServesBundledAssets(t *testing.T) {
	for _, path := range []string{"/app.js", "/app.css", "/viewer.js", "/viewer.css"} {
		w := get(t, path)
		if w.Code != http.StatusOK {
			t.Errorf("%s: 状態コード %d, 期待 200", path, w.Code)
			continue
		}
		if w.Body.Len() == 0 {
			t.Errorf("%s: 中身が空です", path)
		}
	}
}

// 知らないパスは 404。index.html を返して誤魔化さない。
func TestUnknownPathIs404(t *testing.T) {
	for _, path := range []string{"/nope.js", "/api/db", "/deep/なにか"} {
		if w := get(t, path); w.Code != http.StatusNotFound {
			t.Errorf("%s: 状態コード %d, 期待 404", path, w.Code)
		}
	}
}

// 作りかけを何度も読み直すので、古いものが残らないこと。
func TestNoCache(t *testing.T) {
	if got := get(t, "/app.js").Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, 期待 \"no-cache\"", got)
	}
}
