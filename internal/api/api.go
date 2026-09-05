// Package api は HTTP の入り口。
//
// 読み取りは GET /api/db 一本にしてある。全データが 28KB でメモリに載るので、
// 一覧 API を資源ごとに並べても、クライアントは結局すべてを保持することになる。
// 分割は無駄な往復と、どこまで読み込んだかという状態を増やすだけになる。
//
// 書き込みは資源ごとに分ける。サーバが参照の整合性を確かめられること、
// 失敗が 1 か所に閉じること、そして要求そのものが「何をしたかったか」を
// 表すこと（履歴や取り消しを入れるときに効く）の 3 つが理由。
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/akilab/soc-workflow/internal/model"
	"github.com/akilab/soc-workflow/internal/store"
)

// Server は API のハンドラをまとめたもの。
type Server struct {
	st store.Store

	revMu sync.Mutex
	rev   int64

	hist history
}

// New は Server を作る。
func New(st store.Store) *Server { return &Server{st: st} }

// Routes は API のルーティングを返す。
//
// パターンは Go 1.22 以降の ServeMux の書き方で、メソッドとパス変数を直接書ける。
// ルータを外から持ってこなくて済む。"order" のような固定文字列は "{key}" より
// 優先されるので、並べ替えと更新が衝突することはない。
func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/db", s.getDB)

	mux.HandleFunc("POST /api/undo", s.undo)
	mux.HandleFunc("POST /api/redo", s.redo)

	mux.HandleFunc("GET /api/export.html", s.exportAll)
	mux.HandleFunc("GET /api/events/{key}/export.html", s.exportOne)

	mux.HandleFunc("POST /api/lanes", s.createLane)
	mux.HandleFunc("PUT /api/lanes/order", s.orderLanes)
	mux.HandleFunc("GET /api/lanes/{key}/usage", s.laneUsage)
	mux.HandleFunc("PUT /api/lanes/{key}", s.updateLane)
	mux.HandleFunc("DELETE /api/lanes/{key}", s.deleteLane)

	mux.HandleFunc("POST /api/phases", s.createPhase)
	mux.HandleFunc("PUT /api/phases/order", s.orderPhases)
	mux.HandleFunc("PUT /api/phases/{key}", s.updatePhase)
	mux.HandleFunc("DELETE /api/phases/{key}", s.deletePhase)

	mux.HandleFunc("POST /api/tasks", s.createTask)
	mux.HandleFunc("PUT /api/tasks/order", s.orderTasks)
	mux.HandleFunc("GET /api/tasks/{key}/usage", s.taskUsage)
	mux.HandleFunc("PUT /api/tasks/{key}", s.updateTask)
	mux.HandleFunc("DELETE /api/tasks/{key}", s.deleteTask)

	mux.HandleFunc("POST /api/contacts", s.createContactGroup)
	mux.HandleFunc("PUT /api/contacts/order", s.orderContactGroups)
	mux.HandleFunc("GET /api/contacts/{key}/usage", s.contactUsage)
	mux.HandleFunc("PUT /api/contacts/{key}", s.updateContactGroup)
	mux.HandleFunc("DELETE /api/contacts/{key}", s.deleteContactGroup)

	mux.HandleFunc("POST /api/links", s.createLink)
	mux.HandleFunc("PUT /api/links/order", s.orderLinks)
	mux.HandleFunc("PUT /api/links/{key}", s.updateLink)
	mux.HandleFunc("DELETE /api/links/{key}", s.deleteLink)

	mux.HandleFunc("POST /api/events", s.createEvent)
	mux.HandleFunc("PUT /api/events/order", s.orderEvents)
	mux.HandleFunc("PUT /api/events/{key}", s.updateEvent)
	mux.HandleFunc("DELETE /api/events/{key}", s.deleteEvent)
	mux.HandleFunc("POST /api/events/{key}/duplicate", s.duplicateEvent)
	mux.HandleFunc("POST /api/events/{key}/derive", s.deriveEvent)
	mux.HandleFunc("POST /api/events/{key}/reviewed", s.reviewedEvent)
	mux.HandleFunc("PUT /api/events/{key}/lanes", s.setEventLanes)

	mux.HandleFunc("POST /api/events/{key}/steps", s.createStep)
	mux.HandleFunc("PUT /api/events/{key}/steps/order", s.orderSteps)
	mux.HandleFunc("POST /api/events/{key}/steps/{id}/duplicate", s.duplicateStep)
	mux.HandleFunc("PUT /api/events/{key}/steps/{id}", s.updateStep)
	mux.HandleFunc("DELETE /api/events/{key}/steps/{id}", s.deleteStep)

	return mux
}

// ---------------------------------------------------------------------------
// 応答の形
// ---------------------------------------------------------------------------

// envelope はすべての応答の外側。
//
// rev は変更のたびに増える番号。応答に必ず添えることで、
// 2 つのタブで開いているときに、片方が古いデータのまま画面を出し続けるのを防ぐ。
// 手元の rev と食い違ったら GET /api/db を取り直せばよい。
// 28KB なので取り直しは一瞬で、衝突を解決する仕掛けを持つ必要がない。
//
// history は取り消し／やり直しで戻る操作の名前。押せないときは空。
// すべての応答に添えるので、画面は書き込みのたびにボタンの状態を更新できる
// （そのためだけに問い合わせを増やさない）。
type envelope struct {
	Rev     int64     `json:"rev"`
	Data    any       `json:"data,omitempty"`
	History histState `json:"history"`
}

// errBody はエラー応答。
type errBody struct {
	// Error は人が読むメッセージ。そのまま画面に出せる日本語にする。
	Error string `json:"error"`
	// Usage は削除を断ったときの使用箇所。「黙って消さない」ための情報。
	Usage []Usage `json:"usage,omitempty"`
}

// apiErr は HTTP の状態コードを持つエラー。
// ハンドラは詰め替えずにこれを返し、変換は writeErr の 1 か所だけで行う。
type apiErr struct {
	code  int
	msg   string
	usage []Usage
}

func (e *apiErr) Error() string { return e.msg }

// errf は状態コード付きのエラーを作る。
func errf(code int, format string, a ...any) error {
	return &apiErr{code: code, msg: fmt.Sprintf(format, a...)}
}

// notFound は「そんなものは無い」。
func notFound(what, key string) error {
	return errf(http.StatusNotFound, "%sが見つかりません: %s", what, key)
}

// conflict は「使われているので消せない」。使用箇所を添える。
func conflict(msg string, usage []Usage) error {
	return &apiErr{code: http.StatusConflict, msg: msg, usage: usage}
}

// ---------------------------------------------------------------------------
// 出入り口の道具
// ---------------------------------------------------------------------------

func (s *Server) currentRev() int64 {
	s.revMu.Lock()
	defer s.revMu.Unlock()
	return s.rev
}

func (s *Server) bumpRev() int64 {
	s.revMu.Lock()
	defer s.revMu.Unlock()
	s.rev++
	return s.rev
}

// ok は成功を返す。
func (s *Server) ok(w http.ResponseWriter, rev int64, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	env := envelope{Rev: rev, Data: data, History: s.hist.state()}
	if err := json.NewEncoder(w).Encode(env); err != nil {
		// 書き出し中の失敗は状態コードを送り直せない。記録だけして諦める。
		return
	}
}

// writeErr は apiErr を HTTP に変換する。
// それ以外のエラー（保存に失敗したなど）は 500 にする。
func writeErr(w http.ResponseWriter, err error) {
	var ae *apiErr
	if !errors.As(err, &ae) {
		ae = &apiErr{code: http.StatusInternalServerError, msg: err.Error()}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(ae.code)
	json.NewEncoder(w).Encode(errBody{Error: ae.msg, Usage: ae.usage})
}

// decode は要求の本文を読む。読めなければ 400 を返して false。
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields() // 綴り違いを黙って無視しない
	if err := dec.Decode(dst); err != nil {
		writeErr(w, errf(http.StatusBadRequest, "要求の内容を読めません: %v", err))
		return false
	}
	return true
}

// mutate は「変更して、結果を返す」までをまとめる。
//
// fn がエラーを返せば変更は丸ごと破棄され、rev も上がらない。
// 中途半端に適用された状態が残らないので、ハンドラは検査を好きな順に書ける。
//
// 変更の前に控えを取り、成功したときだけ履歴へ積む。断られた要求で
// 取り消しの手数が増えると、押しても何も変わらない手ができてしまう。
func (s *Server) mutate(w http.ResponseWriter, r *http.Request, fn func(*model.DB) (any, error)) {
	label, group := describe(r)

	var before []byte
	if label != "" {
		var err error
		if before, err = s.st.Snapshot(); err != nil {
			// 控えが取れないなら、取り消せない変更を黙って通さない。
			writeErr(w, errf(http.StatusInternalServerError, "控えを作れません: %v", err))
			return
		}
	}

	var result any
	err := s.st.Write(func(db *model.DB) error {
		var e error
		result, e = fn(db)
		return e
	})
	if err != nil {
		writeErr(w, err)
		return
	}

	s.hist.push(label, group, before)
	s.ok(w, s.bumpRev(), result)
}

// undo と redo は同じ形なので 1 つにしてある。
func (s *Server) undo(w http.ResponseWriter, r *http.Request) { s.stepHistory(w, true) }
func (s *Server) redo(w http.ResponseWriter, r *http.Request) { s.stepHistory(w, false) }

func (s *Server) stepHistory(w http.ResponseWriter, back bool) {
	now, err := s.st.Snapshot()
	if err != nil {
		writeErr(w, errf(http.StatusInternalServerError, "控えを作れません: %v", err))
		return
	}

	e, ok := s.hist.take(back, now)
	if !ok {
		word := "やり直せる操作"
		if back {
			word = "取り消せる操作"
		}
		writeErr(w, errf(http.StatusConflict, "%sがありません", word))
		return
	}

	if err := s.st.Restore(e.snap); err != nil {
		writeErr(w, err)
		return
	}
	// 何が戻ったのかを画面に出せるよう、言葉を返す。
	s.ok(w, s.bumpRev(), map[string]string{"label": e.label})
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

// getDB は全データを返す。これが唯一の読み取り口。
func (s *Server) getDB(w http.ResponseWriter, r *http.Request) {
	var snapshot *model.DB
	s.st.Read(func(db *model.DB) { snapshot = db })
	s.ok(w, s.currentRev(), snapshot)
}
