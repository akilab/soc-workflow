// Package model は、SOC Workflow が扱うデータの形を定義する。
//
// このアプリのデータは丸ごと 1 つの JSON ファイルに入る。全体で数十 KB、
// 事象が 100 件に増えても 1 MB に届かないので、起動時に全部読み、
// メモリ上で扱い、変更のたびに書き戻す。詳しい判断の理由は docs/SPEC.md に書いてある。
//
// 順序は「配列の並び」で表す。手順の実施順も、連絡先の連絡順も、
// レーンの並びも段階の並びも同じ。リレーショナルに持つと sort_order の
// 張り替えが要るが、配列なら入れ替えるだけで済む。
//
// # 手順を分類する 2 つの軸
//
// 手順には「誰がやるか（Lane）」と「対応のどの段階か（Phase）」の 2 つがある。
// このうち Lane を図の列にし、Phase は色とラベルで表す。
//
// 逆にしていた時期がある。段階を列にすると、受信の直後に報告へ飛ぶような
// フローで線が端から端まで伸び、そこからまた戻ってくる。段階は時間とともに
// 一方向に進む——という前提が、実際の対応では成り立たないためだった。
// 実データで測ると、段階を軸にした線は最大 4 列ぶん動くのに対し、
// 担当を軸にすると全 54 本が「隣の列まで」に収まる。受け渡しは Tier1 と Tier2、
// Tier2 と CSIRT のように、隣り合う責任範囲の間でしか起きないからである。
package model

import "time"

// Version はデータの形の版。形を変えたら上げて、読み込み時に移行する。
//
//	1: 最初の形。手順の担当は Tier（t1/t2/t3 の固定値）で、図の列は段階だった。
//	2: 担当を Lane（設定可能）にし、図の列を担当に変えた。段階は色とラベルになった。
const Version = 2

// DB はファイルに保存される全体。これがそのまま JSON になる。
type DB struct {
	Version int `json:"version"`

	// 部品 — 事象に属さず、複数の事象から参照される
	Lanes         []*Lane         `json:"lanes"`         // フロー図の列。並び順が左からの順
	Phases        []*Phase        `json:"phases"`        // 対応の段階。色とラベルで表す
	Tasks         []*Task         `json:"tasks"`         // フロー図のボックスの元
	ContactGroups []*ContactGroup `json:"contactGroups"` // 連絡先のカテゴリ

	// 事象 — 対応フロー 1 本にあたる
	Events []*Event `json:"events"`
}

// Lane は担当。誰がその手順をやるか。フロー図では 1 つの列になる。
//
// 固定の 3 段階ではなく、設定できる並びにしてある。顧客・管理職・外部機関・
// ベンダーなど、フローに出てくる相手は組織によって違い、呼び方も違うため。
// 連絡先グループと同じ考え方。
type Lane struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Phase は対応の段階。受信・確認、情報収集、封じ込め、復旧、記録・報告など。
//
// 図の列ではなく、ボックスの色とラベルで表す。段階は列にすると破綻するが
// （package のコメント参照）、分類としては要る。「いま情報収集ばかりしていて
// 封じ込めが薄い」といった偏りは、設計する側が見たい情報である。
type Phase struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Task はフロー図のボックスになる部品。事象をまたいで再利用される。
type Task struct {
	Key      string   `json:"key"`
	PhaseKey string   `json:"phase"`
	LaneKey  string   `json:"lane"` // 既定の担当。手順に投入するときの初期値になる
	Kind     TaskKind `json:"kind"` // 種類。空なら通常の作業
	Label    string   `json:"label"`
	Note     string   `json:"note"`
}

// TaskKind はタスクの種類。作業そのものではなく、フローの中での役割を表す。
//
// 空（通常）以外は、単に「そういう作業」ではなく流れの扱いが変わる。
// 種類を増やすときは、増やす意味があるか——つまり流れの扱いが変わるか——を
// 確かめてから足す。見た目だけの区別なら、段階や担当で足りる。
type TaskKind string

const (
	// KindNormal は通常の作業。
	KindNormal TaskKind = ""

	// KindClose は終了。ここで対応が終わる。
	//
	// 普通のタスクとして「クローズ」を作ることもできるが、それでは分岐した
	// 経路を終わらせられない。誤検知なら 3 手順で閉じ、真検知なら本格対応へ——
	// という形を書くには、後続すべてに「誤検知ではないとき」という条件を
	// 付けて回るしかなくなる。終了を種類として持てば、そこで切れる。
	KindClose TaskKind = "close"

	// KindWait は待ち。自分の作業ではなく、何かが起きるのを待っている状態。
	//
	// 顧客の返答待ち、営業時間まで待つ、スキャンの完了待ち——SOC では珍しくない。
	// 作業として並ぶと、対応者は「止まっているのか進めるのか」が分からなくなる。
	// SLA の合計も、待ち時間を作業時間に足すと数字が意味を失うので分けて数える。
	KindWait TaskKind = "wait"
)

// Valid はタスクの種類として使える値かを返す。
func (k TaskKind) Valid() bool {
	switch k {
	case KindNormal, KindClose, KindWait:
		return true
	}
	return false
}

// ContactGroup は連絡先のカテゴリ。管理職・Tier2・顧客別など。
//
// 手順が参照するのは個人ではなくグループ。夜間は管理職の 1 番から順に掛け、
// 繋がらなければ次へ——という運用をそのまま表すため、メンバーは順序を持つ。
type ContactGroup struct {
	Key  string      `json:"key"`
	Name string      `json:"name"`
	Kind ContactKind `json:"kind"`
	Note string      `json:"note"`

	// LaneKey は連絡の矢印が向かう先。空なら矢印を描かない。
	//
	// これがあるおかげで、エスカレーションと顧客連絡を同じ 1 つの規則で描ける。
	// 「Tier2 アナリスト」に繋がる手順からは Tier2 の列へ、「A社」に繋がる
	// 手順からは顧客の列へ、同じ形の矢印が伸びる。
	LaneKey string `json:"lane"`

	Members []*ContactMember `json:"members"` // 並び順が連絡順
}

// ContactKind は連絡先の区分。
type ContactKind string

const (
	KindEscalation ContactKind = "esc"      // エスカレーション先
	KindInternal   ContactKind = "internal" // 社内
	KindCustomer   ContactKind = "customer" // お客様。参照する手順に顧客連絡のマークが付く
	KindExternal   ContactKind = "external" // 外部機関・ベンダー
)

// ContactMember はグループに属する連絡相手。
//
// 連絡手段は欄で持つ。1 人が電話と Teams の両方を持つのは普通なので、
// 「手段と宛先」の可変リストにするより、入力も表示も単純になる。
// 空でない欄だけが画面に出る。
type ContactMember struct {
	Name   string `json:"name"`
	Tel    string `json:"tel"`
	Teams  string `json:"teams"`
	Elgana string `json:"elgana"`
	Mail   string `json:"mail"`
	Note   string `json:"note"`
}

// Channels は入力されている連絡手段だけを、表示順に返す。
func (m *ContactMember) Channels() []Channel {
	var out []Channel
	for _, c := range []Channel{
		{Via: ViaPhone, Value: m.Tel},
		{Via: ViaTeams, Value: m.Teams},
		{Via: ViaElgana, Value: m.Elgana},
		{Via: ViaMail, Value: m.Mail},
	} {
		if c.Value != "" {
			out = append(out, c)
		}
	}
	return out
}

// Channel は 1 つの連絡手段と宛先。
type Channel struct {
	Via   Via    `json:"via"`
	Value string `json:"value"`
}

// Via は連絡手段。
type Via string

const (
	ViaPhone  Via = "phone"
	ViaTeams  Via = "teams"
	ViaElgana Via = "elgana"
	ViaMail   Via = "mail"
)

// Event は事象。対応フロー 1 本にあたる。
type Event struct {
	Key      string   `json:"key"`
	Title    string   `json:"title"`
	Sub      string   `json:"sub"`
	Severity Severity `json:"severity"`

	// Lanes はこの事象が使う担当と、その並び。空なら全体の担当をそのまま使う。
	//
	// 全体の担当は「役割」で、事象ごとに具体的な相手が変わる。一般的なフローの
	// 「顧客」は、A 社向けのフローでは「高橋工務店」になる。役割を持ち替えるのは
	// 呼び名だけで、タスクの既定の担当も事象をまたいだ集計も全体のキーを指したまま
	// なので壊れない。
	//
	// 使う列を選べるようにもしてある。ある事象では CSIRT が出てこない、という
	// ことは普通にあり、空の列が並ぶと図が横に伸びるだけになる。
	Lanes []*EventLane `json:"lanes,omitempty"`

	Steps     []*Step   `json:"steps"` // 並び順が実施順。そのまま図の行になる
	UpdatedAt time.Time `json:"updatedAt"`
}

// EventLane はこの事象での担当の使い方。
type EventLane struct {
	Key  string `json:"key"`            // 全体の Lane を指す
	Name string `json:"name,omitempty"` // この事象での呼び名。空なら全体の名前
}

// Severity は重大度。
type Severity string

const (
	S1 Severity = "S1"
	S2 Severity = "S2"
	S3 Severity = "S3"
)

// Step はある事象における 1 つの作業指示。
//
// フロー図のボックスは、タスクではなく手順に 1 対 1 で対応する。
// 1 つの事象で同じタスクを 2 回使うことがあるため（隔離を復旧の前後で行う、など）。
//
// 図では、配列の位置がそのまま行になり、LaneKey が列になる。
// 行が実施順そのものなので、手順の流れを表す線は必ず下へ進み、決して戻らない。
// 線 i は行 i と行 i+1 のあいだの帯だけを通るので、2 本の線が同じ帯を
// 共有することがなく、交差は起こり得ない。
type Step struct {
	ID      string `json:"id"`
	TaskKey string `json:"task"`   // 参照するタスク。段階（色）が決まる
	LaneKey string `json:"lane"`   // 担当。図のどの列に座るかが決まる
	Title   string `json:"title"`  // この事象での言い方
	Detail  string `json:"detail"` // 手順の詳細。<code> で強調できる
	SLA     string `json:"sla"`    // "15分" "即時" など。任意

	Escalate bool     `json:"escalate"`
	Contacts []string `json:"contacts"` // 参照する ContactGroup のキー

	// Conditions は表示条件。複数ある場合は AND で結合する。
	// 空なら常に表示。回答がまだ無い条件が残っていれば「まだ分からない」として表示は残す。
	Conditions []Condition `json:"conditions"`

	// Decision があれば、この手順は判断ステップになる。
	// 対応者に選択肢を尋ね、答えが以降の手順の Conditions を解決する。
	Decision *Decision `json:"decision,omitempty"`
}

// Condition は「どの判断の、どの答えのときに表示するか」。
type Condition struct {
	Key   string `json:"key"`   // Decision.Key を指す
	Value string `json:"value"` // Option.Value を指す
}

// Decision は判断ステップが尋ねる質問。
type Decision struct {
	Key     string    `json:"key"`   // 回答の保存先。Condition.Key から参照される
	Label   string    `json:"label"` // 質問文
	Options []*Option `json:"options"`
}

// Option は判断の選択肢。
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// ---------------------------------------------------------------------------
// 参照を引くための小さなヘルパー。
// 件数が小さい（レーン 4・段階 5・タスク 44・連絡先 14 程度）ので、
// 索引を持たずに線形に探す。100 事象に増えても走査は 1ms に満たない。
// ---------------------------------------------------------------------------

// Lane はキーからレーンを返す。見つからなければ nil。
func (d *DB) Lane(key string) *Lane {
	for _, l := range d.Lanes {
		if l.Key == key {
			return l
		}
	}
	return nil
}

// Phase はキーから段階を返す。見つからなければ nil。
func (d *DB) Phase(key string) *Phase {
	for _, p := range d.Phases {
		if p.Key == key {
			return p
		}
	}
	return nil
}

// Task はキーからタスクを返す。見つからなければ nil。
func (d *DB) Task(key string) *Task {
	for _, t := range d.Tasks {
		if t.Key == key {
			return t
		}
	}
	return nil
}

// ContactGroup はキーから連絡先グループを返す。見つからなければ nil。
func (d *DB) ContactGroup(key string) *ContactGroup {
	for _, g := range d.ContactGroups {
		if g.Key == key {
			return g
		}
	}
	return nil
}

// Event はキーから事象を返す。見つからなければ nil。
func (d *DB) Event(key string) *Event {
	for _, e := range d.Events {
		if e.Key == key {
			return e
		}
	}
	return nil
}

// Step はキーから手順を返す。見つからなければ nil。
func (e *Event) Step(id string) *Step {
	for _, s := range e.Steps {
		if s.ID == id {
			return s
		}
	}
	return nil
}

// Decision は、この事象の中でそのキーを持つ判断を返す。見つからなければ nil。
func (e *Event) Decision(key string) *Decision {
	for _, s := range e.Steps {
		if s.Decision != nil && s.Decision.Key == key {
			return s.Decision
		}
	}
	return nil
}

// IsClose は、その手順が対応を終わらせるものかを返す。
// 種類はタスクが持つので、手順からはタスクを引いて判断する。
func (d *DB) IsClose(st *Step) bool {
	t := d.Task(st.TaskKey)
	return t != nil && t.Kind == KindClose
}

// EventLanes は、その事象で使う担当を解決して返す。
//
// 事象が指定していなければ全体の担当をそのまま返す。指定していれば、
// その並びで、呼び名だけを差し替えて返す。呼び出し側は全体と事象の違いを
// 気にせず、返ってきた並びをそのまま列にすればよい。
//
// 返すのは複製。全体の Lane をそのまま返して名前を書き換えると、
// 1 つの事象の呼び名が全体に漏れる。
func (d *DB) EventLanes(ev *Event) []Lane {
	if ev == nil || len(ev.Lanes) == 0 {
		out := make([]Lane, 0, len(d.Lanes))
		for _, l := range d.Lanes {
			out = append(out, *l)
		}
		return out
	}

	out := make([]Lane, 0, len(ev.Lanes))
	for _, el := range ev.Lanes {
		base := d.Lane(el.Key)
		if base == nil {
			continue // 消された担当を指している。黙って落とす
		}
		l := *base
		if el.Name != "" {
			l.Name = el.Name
		}
		out = append(out, l)
	}
	return out
}

// IsWait は、その手順が待ちかを返す。
func (d *DB) IsWait(st *Step) bool {
	t := d.Task(st.TaskKey)
	return t != nil && t.Kind == KindWait
}

// Handoffs は担当の受け渡しが何回あるかを数える。
//
// 受け渡しは 1 回ごとに「ボールが落ちうる場所」になる。回数が多いフローは、
// 図が読みにくいのではなく運用が危ない。図の見た目の指標ではなく、
// フローそのものの質を測る指標として出す。
func (e *Event) Handoffs() int {
	n := 0
	for i := 1; i < len(e.Steps); i++ {
		if e.Steps[i-1].LaneKey != e.Steps[i].LaneKey {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------------------
// 値の妥当性。
// 列挙のような値はここで一括して見る。ハンドラごとに書くと、
// 種類を足したときに直し漏れる場所ができる。
// ---------------------------------------------------------------------------

// Valid は連絡先の区分として使える値かを返す。
func (k ContactKind) Valid() bool {
	switch k {
	case KindEscalation, KindInternal, KindCustomer, KindExternal:
		return true
	}
	return false
}

// Valid は重大度として使える値かを返す。
func (s Severity) Valid() bool {
	switch s {
	case S1, S2, S3:
		return true
	}
	return false
}

// Valid は連絡手段として使える値かを返す。
func (v Via) Valid() bool {
	switch v {
	case ViaPhone, ViaTeams, ViaElgana, ViaMail:
		return true
	}
	return false
}
