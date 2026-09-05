// Package model は、SOC Workflow が扱うデータの形を定義する。
//
// このアプリのデータは丸ごと 1 つの JSON ファイルに入る。全体で数十 KB、
// フローが 100 件に増えても 1 MB に届かないので、起動時に全部読み、
// メモリ上で扱い、変更のたびに書き戻す。詳しい判断の理由は docs/SPEC.md に書いてある。
//
// 順序は「配列の並び」で表す。手順の実施順も、連絡先の連絡順も、
// レーンの並びもフェーズの並びも同じ。リレーショナルに持つと sort_order の
// 張り替えが要るが、配列なら入れ替えるだけで済む。
//
// # 手順を分類する 2 つの軸
//
// 手順には「誰がやるか（Lane）」と「対応のどのフェーズか（Phase）」の 2 つがある。
// このうち Lane を図の列にし、Phase は色とラベルで表す。
//
// 逆にしていた時期がある。フェーズを列にすると、受信の直後に報告へ飛ぶような
// フローで線が端から端まで伸び、そこからまた戻ってくる。フェーズは時間とともに
// 一方向に進む——という前提が、実際の対応では成り立たないためだった。
// 実データで測ると、フェーズを軸にした線は最大 4 列ぶん動くのに対し、
// 担当を軸にすると全 54 本が「隣の列まで」に収まる。受け渡しは Tier1 と Tier2、
// Tier2 と CSIRT のように、隣り合う責任範囲の間でしか起きないからである。
package model

import "time"

// Version はデータの形の版。形を変えたら上げて、読み込み時に移行する。
//
//	1: 最初の形。手順の担当は Tier（t1/t2/t3 の固定値）で、図の列はフェーズだった。
//	2: 担当を Lane（設定可能）にし、図の列を担当に変えた。フェーズは色とラベルになった。
const Version = 2

// DB はファイルに保存される全体。これがそのまま JSON になる。
type DB struct {
	Version int `json:"version"`

	// 部品 — フローに属さず、複数のフローから参照される
	Lanes         []*Lane         `json:"lanes"`         // フロー図の列。並び順が左からの順
	Phases        []*Phase        `json:"phases"`        // 対応のフェーズ。色とラベルで表す
	Tasks         []*Task         `json:"tasks"`         // フロー図のボックスの元
	ContactGroups []*ContactGroup `json:"contactGroups"` // 連絡先のカテゴリ
	SLAs          []*SLA          `json:"slas"`          // 約束した時間。SOC の標準

	// フロー — 対応フロー 1 本にあたる
	Events []*Event `json:"events"`

	// Links は左上のランチャーに並べる、外部の画面への近道。
	//
	// フローの中身ではなく、この道具を使う人の作業環境の話。それでも
	// localStorage ではなくここに置くのは、SOC の中で「対応のときに開く画面」は
	// 人ではなくチームで決まっているため。端末を変えても、担当者が代わっても
	// 同じものが並んでいてほしい。
	Links []*AppLink `json:"links"`
}

// SLA は「検知から○○まで○分以内」という約束。
//
// 手順ひとつずつの目標時間とは別のものとして持つ。手順の目標を全部足した数は
// 「この経路の重さ」でしかなく、約束した時間ではない。実際、1 営業日の手順が
// 2 つあるだけで合計は 16 時間を超え、初動の 15 分が見えなくなっていた。
//
// 測る範囲は「フローの始まりから、印を付けた手順まで」。手順側に
// Step.Milestone で印を付ける。始まりを揃えるのは、SLA が普通
// 「検知から○○まで」と起点を共有して語られるため。区間に切ると、
// 「初動 2 時間」と「一次報告 30 分」のように**範囲が重なるもの**を持てない。
//
// SOC がサービスとして掲げる標準をここに置き、顧客ごとに違う約束は
// フロー側（Event.SLAs）で上書きする。担当（Lane / EventLane）と同じ形。
type SLA struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Minutes int    `json:"minutes"` // 目標。分で持つ
	Note    string `json:"note"`
}

// EventSLA は、このフローでの約束の上書き。
//
// 顧客別のフローで「標準は 2 時間だが、この顧客とは 1 時間で合意している」を
// 表す。ここに無い SLA は標準のまま。
type EventSLA struct {
	Key     string `json:"key"`     // 全体の SLA を指す
	Minutes int    `json:"minutes"` // このフローでの目標
}

// AppLink はランチャーの 1 マス。外部の画面をひとつ指す。
//
// アイコンは自由に指定できない。決めた一覧（web/src/links.ts）から選ぶ。
// 好きな絵を持ち込めるようにすると、画面ごとに大きさも太さも色も変わり、
// 並べたときに揃わなくなる。
type AppLink struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	// URL は http か https のみ。javascript: のような形は受け付けない。
	URL  string `json:"url"`
	Icon string `json:"icon"`
}

// Lane は担当。誰がその手順をやるか。フロー図では 1 つの列になる。
//
// 固定の 3 フェーズではなく、設定できる並びにしてある。顧客・管理職・外部機関・
// ベンダーなど、フローに出てくる相手は組織によって違い、呼び方も違うため。
// 連絡先グループと同じ考え方。
type Lane struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Phase は対応のフェーズ。受信・確認、情報収集、封じ込め、復旧、記録・報告など。
//
// 図の列ではなく、ボックスの色とラベルで表す。フェーズは列にすると破綻するが
// （package のコメント参照）、分類としては要る。「いま情報収集ばかりしていて
// 封じ込めが薄い」といった偏りは、設計する側が見たい情報である。
type Phase struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// Task はフロー図のボックスになる部品。フローをまたいで再利用される。
type Task struct {
	Key      string   `json:"key"`
	PhaseKey string   `json:"phase"`
	LaneKey  string   `json:"lane"` // 既定の担当。手順に投入するときの初期値になる
	Kind     TaskKind `json:"kind"` // 種類。空なら通常の作業
	Label    string   `json:"label"`
	Note     string   `json:"note"`
}

// TaskKind は対応の種類。作業そのものではなく、フローの中での役割を表す。
//
// 空（通常）以外は、単に「そういう作業」ではなく流れの扱いが変わる。
// 種類を増やすときは、増やす意味があるか——つまり流れの扱いが変わるか——を
// 確かめてから足す。見た目だけの区別なら、フェーズや担当で足りる。
type TaskKind string

const (
	// KindNormal は通常の作業。
	KindNormal TaskKind = ""

	// KindClose は終了。ここで対応が終わる。
	//
	// 普通の対応として「クローズ」を作ることもできるが、それでは分岐した
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

// Valid は対応の種類として使える値かを返す。
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

// Event はフロー。対応フロー 1 本にあたる。
type Event struct {
	Key      string   `json:"key"`
	Title    string   `json:"title"`
	Sub      string   `json:"sub"`
	Severity Severity `json:"severity"`

	// Lanes はこのフローが使う担当と、その並び。空なら全体の担当をそのまま使う。
	//
	// 全体の担当は「役割」で、フローごとに具体的な相手が変わる。一般的なフローの
	// 「顧客」は、A 社向けのフローでは「高橋工務店」になる。役割を持ち替えるのは
	// 呼び名だけで、対応の既定の担当もフローをまたいだ集計も全体のキーを指したまま
	// なので壊れない。
	//
	// 使う列を選べるようにもしてある。あるフローでは CSIRT が出てこない、という
	// ことは普通にあり、空の列が並ぶと図が横に伸びるだけになる。
	Lanes []*EventLane `json:"lanes,omitempty"`

	// SLAs はこのフローだけの約束の時間。空なら全体の標準をそのまま使う。
	// 顧客別のフローで個別に合意した時間を持つためにある。
	SLAs []*EventSLA `json:"slas,omitempty"`

	// BaseKey は、このフローの元にしたフロー。空なら独立したフロー。
	//
	// 顧客ごとに手順そのものが変わる（やることが増減し、SLA も報告先も違う）ため、
	// 共通フローを元に顧客別を作る形にしてある。
	//
	// 元の変更が自動で伝わることは **しない**。対応フローは「どこを見ていて、
	// どこを見ていないか」を表すもので、それが黙って変わるのは危険だから。
	// 代わりに、元が新しくなったことを知らせて、取り込むかは人が決める。
	BaseKey string `json:"base,omitempty"`

	// BaseSyncedAt は、元のフローのどの時点まで見たか。
	// 元の UpdatedAt がこれより新しければ「元が更新されている」と出す。
	BaseSyncedAt time.Time `json:"baseSyncedAt,omitempty"`

	Steps     []*Step   `json:"steps"` // 並び順が実施順。そのまま図の行になる
	UpdatedAt time.Time `json:"updatedAt"`
}

// Derived は、このフローを元にして作られたフロー。
func (d *DB) Derived(key string) []*Event {
	var out []*Event
	for _, e := range d.Events {
		if e.BaseKey == key {
			out = append(out, e)
		}
	}
	return out
}

// EventLane はこのフローでの担当の使い方。
type EventLane struct {
	Key  string `json:"key"`            // 全体の Lane を指す
	Name string `json:"name,omitempty"` // このフローでの呼び名。空なら全体の名前
}

// Severity は重大度。
type Severity string

const (
	S1 Severity = "S1"
	S2 Severity = "S2"
	S3 Severity = "S3"
)

// Step はあるフローにおける 1 つの作業指示。
//
// フロー図のボックスは、対応ではなく手順と 1 対 1 で結びつく。
// 1 つのフローで同じ対応を 2 回使うことがあるため（隔離を復旧の前後で行う、など）。
//
// 図では、配列の位置がそのまま行になり、LaneKey が列になる。
// 行が実施順そのものなので、手順の流れを表す線は必ず下へ進み、決して戻らない。
// 線 i は行 i と行 i+1 のあいだの帯だけを通るので、2 本の線が同じ帯を
// 共有することがなく、交差は起こり得ない。
type Step struct {
	ID      string `json:"id"`
	TaskKey string `json:"task"`   // 参照する対応。フェーズ（色）が決まる
	LaneKey string `json:"lane"`   // 担当。図のどの列に座るかが決まる
	Title   string `json:"title"`  // このフローでの言い方
	Detail  string `json:"detail"` // 手順の詳細。<code> で強調できる
	SLA     string `json:"sla"`    // 目標時間。"15分" "即時" など。任意

	// Milestone は、この手順が「どの SLA の到達点か」。空なら到達点ではない。
	// ここに印が付いた手順までの目標時間を足したものが、その SLA の実績になる。
	Milestone string `json:"milestone,omitempty"`

	Escalate bool     `json:"escalate"`
	Contacts []string `json:"contacts"` // 参照する ContactGroup のキー

	// Conditions は表示条件。複数ある場合は AND で結合する。
	// 空なら常に表示。回答がまだ無い条件が残っていれば「まだ分からない」として表示は残す。
	Conditions []Condition `json:"conditions"`

	// Decision があれば、この手順は判断ステップになる。
	// 対応者に選択肢を尋ね、答えが以降の手順の Conditions を解決する。
	Decision *Decision `json:"decision,omitempty"`

	// FromID は、元にしたフローのどの手順から来たか（Event.BaseKey を参照する側）。
	//
	// 手順 ID はフローをまたいで一意なので、複製すると振り直される。
	// それだけでは「共通のこの手順が、顧客別ではこう変わっている」という
	// 対応が取れなくなるため、出どころを覚えておく。
	// 空なら、その顧客のために足された手順。
	FromID string `json:"from,omitempty"`
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
// 件数が小さい（レーン 4・フェーズ 5・対応 44・連絡先 14 程度）ので、
// 索引を持たずに線形に探す。100 フローに増えても走査は 1ms に満たない。
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

// Phase はキーからフェーズを返す。見つからなければ nil。
func (d *DB) Phase(key string) *Phase {
	for _, p := range d.Phases {
		if p.Key == key {
			return p
		}
	}
	return nil
}

// Task はキーから対応を返す。見つからなければ nil。
// SLA はキーから約束を引く。無ければ nil。
func (d *DB) SLA(key string) *SLA {
	for _, x := range d.SLAs {
		if x.Key == key {
			return x
		}
	}
	return nil
}

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

// Event はキーからフローを返す。見つからなければ nil。
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

// Decision は、このフローの中でそのキーを持つ判断を返す。見つからなければ nil。
func (e *Event) Decision(key string) *Decision {
	for _, s := range e.Steps {
		if s.Decision != nil && s.Decision.Key == key {
			return s.Decision
		}
	}
	return nil
}

// IsClose は、その手順が対応を終わらせるものかを返す。
// 種類は対応が持つので、手順からは対応を引いて判断する。
func (d *DB) IsClose(st *Step) bool {
	t := d.Task(st.TaskKey)
	return t != nil && t.Kind == KindClose
}

// EventLanes は、そのフローで使う担当を解決して返す。
//
// フローが指定していなければ全体の担当をそのまま返す。指定していれば、
// その並びで、呼び名だけを差し替えて返す。呼び出し側は全体とフローの違いを
// 気にせず、返ってきた並びをそのまま列にすればよい。
//
// 返すのは複製。全体の Lane をそのまま返して名前を書き換えると、
// 1 つのフローの呼び名が全体に漏れる。
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
