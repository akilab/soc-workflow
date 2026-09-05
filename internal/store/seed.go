package store

import _ "embed"

// seedJSON は、データファイルがまだ無いときに使う初期データ。
// バイナリに埋め込むので、exe 1 つで最初から動く。
//
// 中身はダミーで、実運用の手順ではない。実データを入れるときは
// フローを消してから作り直すか、フェーズと対応だけ残して使う。
// 元は mock/soc-flow-editor-mock.html の種データで、
// scratchpad の export_seed.js で書き出している。
//
//go:embed seed.json
var seedJSON []byte

// Seed は初期データを返す。
func Seed() []byte { return seedJSON }

// Empty は何も入っていないデータを返す。--empty で使う。
//
// 自分たちのフローを一から作るときは、ダミーが混ざっていないほうがよい。
// 消して回るのは手間なうえ、消し忘れたダミーが実データと並ぶと、
// どちらが本物か分からなくなる（対応フローは「どこを見ているか」の情報を
// 含むので、これは配布事故に直結する）。
func Empty() []byte { return []byte(`{"version":2}`) }
