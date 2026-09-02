package api

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Guard はブラウザ越しの外部からの操作を防ぐ。
//
// ローカルで動くサーバは、利用者のブラウザから見れば普通の Web サイトと同じ。
// 別のタブで開いた悪意あるページが 127.0.0.1 に向けて要求を投げれば、
// それは利用者本人の要求として届く。認証を持たない以上、防ぐのはここしかない。
//
// 対応フローは「どこを見ていて、どこを見ていないか」を含む。
// 読み取られるだけでも困る種類のデータなので、GET も含めて全部を通す。
//
// 3 つを見る。
//
//	Host    … DNS リベインディング対策。攻撃者のドメインを 127.0.0.1 に解決させて
//	           同一オリジンとして話しかけてくる手口を、名前で弾く
//	Origin  … 別サイトからの要求を弾く。ブラウザが必ず付けるので偽装できない
//	Content-Type … フォーム送信（text/plain で JSON 本文を送れてしまう）を弾く
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !localHost(r.Host) {
			http.Error(w, "このアドレスでは受け付けません", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !localOrigin(origin) {
			http.Error(w, "別のサイトからの要求は受け付けません", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			ct := r.Header.Get("Content-Type")
			if ct != "" && !strings.HasPrefix(ct, "application/json") {
				http.Error(w, "本文は application/json で送ってください",
					http.StatusUnsupportedMediaType)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// localHost は Host ヘッダが手元を指しているかを見る。
func localHost(host string) bool {
	name, _, err := net.SplitHostPort(host)
	if err != nil {
		name = host // ポートが無い場合
	}
	name = strings.Trim(strings.ToLower(name), "[]")
	if name == "localhost" || strings.HasSuffix(name, ".localhost") {
		return true
	}
	if ip := net.ParseIP(name); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// localOrigin は Origin が手元を指しているかを見る。
func localOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return localHost(u.Host)
}
