// Package model は、SOC Workflow が扱うデータの形を定義する。
//
// このアプリのデータは丸ごと 1 つの JSON ファイルに入る。全体で数十 KB、
// 事象が 100 件に増えても 1 MB に届かないので、起動時に全部読み、
// メモリ上で扱い、変更のたびに書き戻す。詳しい判断の理由は docs/SPEC.md に書いてある。
//
// 順序は「配列の並び」で表す。手順の実施順も、連絡先の連絡順も、フェーズの並びも同じ。
// リレーショナルに持つと sort_order の張り替えが要るが、配列なら入れ替えるだけで済む。
package model

import "time"

// Version はデータの形の版。形を変えたら上げて、読み込み時に移行する。
const Version = 1

// DB はファイルに保存される全体。これがそのまま JSON になる。
type DB struct {
	Version int `json:"version"`

	// 部品 — 事象に属さず、複数の事象から参照される
	Phases        []*Phase        `json:"phases"`        // フロー図の列。並び順が意味を持つ
	Tasks         []*Task         `json:"tasks"`         // フロー図のボックスの元
	ContactGroups []*ContactGroup `json:"contactGroups"` // 連絡先のカテゴリ

	// 事象 — 対応フロー 1 本にあたる
	Events []*Event `json:"events"`
}

// Phase は対応の段階。フロー図の 1 列にあたる。
//
// フェーズは「対応の段階」であって「作業の種類」ではない。
// 段階は時間とともに一方向に進むもの、種類はどの段階でも起こりうるもので、
// 判断やエスカレーションは後者なので列にしない（手順の属性で表す）。
type Phase struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Task はフロー図のボックスになる部品。事象をまたいで再利用される。
type Task struct {
	Key      string `json:"key"`
	PhaseKey string `json:"phase"`
	Label    string `json:"label"`
	Note     string `json:"note"`
	Tier     Tier   `json:"tier"` // 既定の担当。手順に投入するときの初期値になる
}

// Tier は担当。誰がその手順をやるか。
type Tier string

const (
	TierNone Tier = ""
	Tier1    Tier = "t1" // 受信・一次トリアージ・記録
	Tier2    Tier = "t2" // 詳細分析・封じ込め・復旧
	Tier3    Tier = "t3" // Tier3・CSIRT。法令報告や顧客通知など
)

// ContactGroup は連絡先のカテゴリ。管理職・Tier2・顧客別など。
//
// 手順が参照するのは個人ではなくグループ。夜間は管理職の 1 番から順に掛け、
// 繋がらなければ次へ——という運用をそのまま表すため、メンバーは順序を持つ。
type ContactGroup struct {
	Key     string           `json:"key"`
	Name    string           `json:"name"`
	Kind    ContactKind      `json:"kind"`
	Note    string           `json:"note"`
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
	Key       string    `json:"key"`
	Title     string    `json:"title"`
	Sub       string    `json:"sub"`
	Severity  Severity  `json:"severity"`
	Steps     []*Step   `json:"steps"` // 並び順が実施順
	UpdatedAt time.Time `json:"updatedAt"`
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
type Step struct {
	ID       string   `json:"id"`
	TaskKey  string   `json:"task"`   // 参照するタスク。どの列のどのボックスかが決まる
	Title    string   `json:"title"`  // この事象での言い方
	Detail   string   `json:"detail"` // 手順の詳細。<code> で強調できる
	SLA      string   `json:"sla"`    // "15分" "即時" など。任意
	Escalate bool     `json:"escalate"`
	Tier     Tier     `json:"tier"`     // 担当。投入時にタスクの既定値が入る
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
// 件数が小さい（フェーズ 5・タスク 44・連絡先 14 程度）ので、
// 索引を持たずに線形に探す。100 事象に増えても走査は 1ms に満たない。
// ---------------------------------------------------------------------------

// Phase はキーからフェーズを返す。見つからなければ nil。
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

// ---------------------------------------------------------------------------
// 値の妥当性。
// 列挙のような値はここで一括して見る。ハンドラごとに書くと、
// 種類を足したときに直し漏れる場所ができる。
// ---------------------------------------------------------------------------

// Valid は担当として使える値かを返す。空（未指定）も許す。
func (t Tier) Valid() bool {
	switch t {
	case TierNone, Tier1, Tier2, Tier3:
		return true
	}
	return false
}

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
