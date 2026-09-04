package api

import (
	"net/http"
	"sync"
	"time"
)

// 取り消し／やり直し。
//
// このアプリは「考えるための道具」なので、試してから戻せることに意味がある。
// 戻せないと、消してみる・並べ替えてみるという試し方をしなくなる。
//
// 記録するのは操作の差分ではなく、操作の *前* の全データ（28KB）。
// 差分と逆操作を作ると、操作の種類ぶんだけ「戻し方」を書くことになり、
// 1 つ書き忘れると黙って壊れる。丸ごとなら書き戻しは 1 通りしかない。
// 50 手ぶんで 1.4MB。持っていて困る量ではない。
//
// 記録はメモリだけに置く。プロセスを終えたら消える。
// ファイルに残すと「前回いじった内容」がデータと別の場所に残り、
// 対応フローの機密性の扱いが二重になる。取り消しは今この場での操作だけでよい。

// histMax は覚えておく手数。
const histMax = 50

// histWindow は同じところへの連続した変更を 1 手にまとめる時間。
//
// 詳細欄は入力が止まるたびに（400ms）保存される。1 文字ずつ 1 手にすると、
// 一文を戻すのに何十回も押すことになる。手が止まっている間だけ区切る。
const histWindow = 3 * time.Second

type histEntry struct {
	// label は取り消したときに出す言葉。「何が戻ったのか」を伝える。
	label string
	// snap はこの操作を行う前の全データ。
	snap []byte
	// group は「同じところへの続きの操作」を見分ける鍵。空ならまとめない。
	group string
	at    time.Time
}

type history struct {
	mu   sync.Mutex
	undo []histEntry // 古い順。末尾が直前の操作
	redo []histEntry
}

// histState は画面に出す状態。押せるかどうかと、何が戻るのか。
type histState struct {
	Undo string `json:"undo"`
	Redo string `json:"redo"`
}

func (h *history) state() histState {
	h.mu.Lock()
	defer h.mu.Unlock()
	var s histState
	if n := len(h.undo); n > 0 {
		s.Undo = h.undo[n-1].label
	}
	if n := len(h.redo); n > 0 {
		s.Redo = h.redo[n-1].label
	}
	return s
}

// push は変更が成功したときに、その前の状態を記録する。
func (h *history) push(label, group string, before []byte) {
	if label == "" {
		return // 記録しないと決めた操作
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	// 同じところへの続きの操作なら、前の控えをそのまま残す。
	// そうすると、まとめて 1 手前の状態まで戻る。
	if n := len(h.undo); n > 0 && group != "" {
		last := &h.undo[n-1]
		if last.group == group && time.Since(last.at) < histWindow {
			last.at = time.Now()
			last.label = label
			h.redo = nil
			return
		}
	}

	h.undo = append(h.undo, histEntry{
		label: label, snap: before, group: group, at: time.Now(),
	})
	if len(h.undo) > histMax {
		h.undo = h.undo[len(h.undo)-histMax:]
	}
	// 新しい操作をしたら、やり直せる先は無くなる。
	h.redo = nil
}

// take は取り消し（またはやり直し）の 1 手を取り出し、
// いまの状態を反対側へ積む。
func (h *history) take(fromUndo bool, now []byte) (histEntry, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	from, to := &h.undo, &h.redo
	if !fromUndo {
		from, to = &h.redo, &h.undo
	}
	n := len(*from)
	if n == 0 {
		return histEntry{}, false
	}
	e := (*from)[n-1]
	*from = (*from)[:n-1]

	// 反対側には「いまの状態」を積む。言葉は同じものを使う。
	// 「手順を削除」を取り消したら、やり直しも「手順を削除」で正しい。
	*to = append(*to, histEntry{label: e.label, snap: now, at: time.Now()})
	return e, true
}

// ---------------------------------------------------------------------------
// 何をしたか
// ---------------------------------------------------------------------------

// actionLabel は route ごとの言葉。取り消したときにそのまま画面へ出す。
//
// 鍵は ServeMux が実際に合わせたパターン（r.Pattern）なので、
// パスを自分で解析する必要がなく、ルートを増やしたときの取りこぼしも
// テストで見つけられる（TestEveryMutatingRouteHasLabel）。
var actionLabel = map[string]string{
	"POST /api/lanes":         "担当の追加",
	"PUT /api/lanes/{key}":    "担当の変更",
	"DELETE /api/lanes/{key}": "担当の削除",
	"PUT /api/lanes/order":    "担当の並べ替え",

	"POST /api/phases":         "フェーズの追加",
	"PUT /api/phases/{key}":    "フェーズの変更",
	"DELETE /api/phases/{key}": "フェーズの削除",
	"PUT /api/phases/order":    "フェーズの並べ替え",

	"POST /api/tasks":         "対応の追加",
	"PUT /api/tasks/{key}":    "対応の変更",
	"DELETE /api/tasks/{key}": "対応の削除",
	"PUT /api/tasks/order":    "対応の並べ替え",

	"POST /api/contacts":         "連絡先の追加",
	"PUT /api/contacts/{key}":    "連絡先の変更",
	"DELETE /api/contacts/{key}": "連絡先の削除",
	"PUT /api/contacts/order":    "連絡先の並べ替え",

	"POST /api/events":                 "フローの作成",
	"PUT /api/events/{key}":            "フローの変更",
	"DELETE /api/events/{key}":         "フローの削除",
	"POST /api/events/{key}/duplicate": "フローの複製",
	"POST /api/events/{key}/derive":    "顧客別フローの作成",
	"POST /api/events/{key}/reviewed":  "共通との違いの確認",
	"PUT /api/events/order":            "フローの並べ替え",
	"PUT /api/events/{key}/lanes":      "このフローの担当の変更",

	"POST /api/events/{key}/steps":                "手順の追加",
	"PUT /api/events/{key}/steps/{id}":            "手順の変更",
	"DELETE /api/events/{key}/steps/{id}":         "手順の削除",
	"POST /api/events/{key}/steps/{id}/duplicate": "手順の複製",
	"PUT /api/events/{key}/steps/order":           "手順の並べ替え",
}

// describe は要求から「何をしたか」と「まとめる単位」を決める。
//
// まとめるのは PUT（同じものを直し続ける操作）だけ。
// 追加・削除・複製はそれぞれ 1 手として残す。消したものを戻したいときに、
// 直前の入力とまとめられていると戻しすぎる。
func describe(r *http.Request) (label, group string) {
	label = actionLabel[r.Pattern]
	if label == "" || r.Method != http.MethodPut {
		return label, ""
	}
	return label, r.Pattern + "\x00" + r.PathValue("key") + "\x00" + r.PathValue("id")
}
