package store

import _ "embed"

// seedJSON は、データファイルがまだ無いときに使う初期データ。
// バイナリに埋め込むので、exe 1 つで最初から動く。
//
// 中身はダミーで、実運用の手順ではない。実データを入れるときは
// 事象を消してから作り直すか、フェーズとタスクだけ残して使う。
// 元は mock/soc-flow-editor-mock.html の種データで、
// scratchpad の export_seed.js で書き出している。
//
//go:embed seed.json
var seedJSON []byte

// Seed は初期データを返す。
func Seed() []byte { return seedJSON }
