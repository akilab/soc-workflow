/**
 * データの型。internal/model/model.go を手で写したもの。
 *
 * 生成せずに手で書いている。型は 10 個ほどで、変わるのは仕様が動いたときだけ。
 * 生成の仕掛けを持つより、Go 側と並べて読める形にしておくほうが早い。
 *
 * ずれると画面が黙って壊れるので、変えるときは必ず両方を直す。
 * Go 側の json タグがそのままここの名前になる（PhaseKey → phase など）。
 */

/** データの形の版。internal/model.Version と合わせる。 */
export const VERSION = 2;

export interface DB {
  version: number;
  /** フロー図の列。並び順が左からの順。 */
  lanes: Lane[];
  phases: Phase[];
  tasks: Task[];
  contactGroups: ContactGroup[];
  events: EventFlow[];
}

/**
 * 担当。誰がその手順をやるか。フロー図では 1 つの列になる。
 *
 * 固定の 3 段階ではなく設定できる並びにしてある。フローに出てくる相手は
 * 組織によって違い、呼び方も違うため（顧客・管理職・外部機関・ベンダー）。
 */
export interface Lane {
  key: string;
  name: string;
  color: string;
}

/**
 * 対応の段階。受信・確認、情報収集、封じ込め、復旧、記録・報告など。
 *
 * 図の列ではなく、ボックスの色とラベルで表す。段階を列にすると、受信の直後に
 * 報告へ飛ぶようなフローで線が端から端まで伸びて戻ってくる。段階は時間とともに
 * 一方向に進む——という前提が、実際の対応では成り立たないため。
 */
export interface Phase {
  key: string;
  name: string;
  color: string;
}

/** フロー図のボックスの元。事象をまたいで再利用される。 */
export interface Task {
  key: string;
  /** Go 側は PhaseKey。json タグが phase。 */
  phase: string;
  /** 既定の担当。手順に投入するときの初期値になる。 */
  lane: string;
  /** 種類。空なら通常の作業。 */
  kind: TaskKind;
  label: string;
  note: string;
}

/**
 * タスクの種類。作業そのものではなく、フローの中での役割を表す。
 *
 * "close" は終了。完了させると、その経路はそこで終わる。以降の手順は
 * 対象外になる。普通のタスクとして「クローズ」を作ることもできるが、
 * それでは分岐した経路を終わらせられない（後続すべてに否定の条件が要る）。
 */
export type TaskKind = "" | "close" | "wait";

/** タスクの種類の表示名。 */
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  "": "通常の作業",
  close: "終了（クローズ）",
  wait: "待ち・保留",
};

/** 連絡先のカテゴリ。管理職・Tier2・顧客別など。 */
export interface ContactGroup {
  key: string;
  name: string;
  kind: ContactKind;
  note: string;
  /**
   * 連絡の矢印が向かう先。空なら矢印を描かない。
   *
   * これがあるおかげで、エスカレーションと顧客連絡を同じ 1 つの規則で描ける。
   */
  lane: string;
  /** 並び順が連絡順。夜間は 1 番から順に掛ける、をそのまま表す。 */
  members: ContactMember[];
}

export type ContactKind = "esc" | "internal" | "customer" | "external";

/** 連絡相手。手段は欄で持つ（1 人が電話と Teams の両方を持つのは普通）。 */
export interface ContactMember {
  name: string;
  tel: string;
  teams: string;
  elgana: string;
  mail: string;
  note: string;
}

export type Via = "phone" | "teams" | "elgana" | "mail";

/** 1 つの連絡手段と宛先。Go 側の model.Channel。 */
export interface Channel {
  via: Via;
  value: string;
}

/**
 * 事象。対応フロー 1 本。
 *
 * 名前を EventFlow にしてあるのは、DOM の Event と衝突するため。
 * Go 側の型名は Event。
 */
export interface EventFlow {
  key: string;
  title: string;
  sub: string;
  severity: Severity;
  /**
   * この事象が使う担当と、その並び。空なら全体の担当をそのまま使う。
   *
   * 全体の担当は「役割」で、事象ごとに具体的な相手が変わる。一般的なフローの
   * 「顧客」は、A 社向けのフローでは「高橋工務店」になる。持ち替えるのは呼び名
   * だけなので、タスクの既定の担当も事象をまたいだ集計も壊れない。
   */
  lanes?: EventLane[] | null;
  /**
   * 元にした事象。空なら独立したフロー。
   *
   * 顧客ごとに手順そのものが変わるので、共通フローを元に顧客別を作る。
   * 元の変更は自動では伝わらない。伝わってしまうと「どこを見ているか」が
   * 黙って変わる。代わりに、元が新しくなったことを知らせる。
   */
  base?: string;
  /** 元のどの時点まで見たか。元の updatedAt がこれより新しければ古い。 */
  baseSyncedAt?: string;
  /** 並び順が実施順。 */
  steps: Step[];
  updatedAt: string;
}

/** この事象での担当の使い方。 */
export interface EventLane {
  /** 全体の Lane を指す。 */
  key: string;
  /** この事象での呼び名。空なら全体の名前。 */
  name?: string;
}

export type Severity = "S1" | "S2" | "S3";

/**
 * ある事象における 1 つの作業指示。
 *
 * フロー図のボックスは、タスクではなく手順に 1 対 1 で対応する。
 * 1 つの事象で同じタスクを 2 回使うことがあるため。
 */
export interface Step {
  id: string;
  /** Go 側は TaskKey。json タグが task。段階（色）が決まる。 */
  task: string;
  /** 担当。図のどの列に座るかが決まる。 */
  lane: string;
  title: string;
  detail: string;
  sla: string;
  escalate: boolean;
  /** 参照する ContactGroup のキー。 */
  contacts: string[];
  /** 表示条件。複数あれば AND。空なら常に表示。 */
  conditions: Condition[];
  /** あればこの手順は判断ステップになる。 */
  decision?: Decision | null;
  /**
   * 元にした事象の、どの手順から来たか。空ならこの事象で足された手順。
   *
   * 手順 ID は事象をまたいで一意なので、写すと振り直される。
   * それだけでは「共通のこの手順が、ここではこう変わっている」という対応が
   * 取れなくなるため、出どころを覚えておく。
   */
  from?: string;
}

/** 「どの判断の、どの答えのときに表示するか」。 */
export interface Condition {
  key: string;
  value: string;
}

/** 判断ステップが尋ねる質問。key は事象の中で一意。 */
export interface Decision {
  key: string;
  label: string;
  options: Option[];
}

export interface Option {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// API のやりとり
// ---------------------------------------------------------------------------

/** すべての応答の外側。 */
export interface Envelope<T> {
  rev: number;
  data?: T;
  /** 取り消し／やり直しで戻る操作の名前。押せないときは空。 */
  history: HistoryState;
}

/** サーバが覚えている取り消しの状態。すべての応答に添えられる。 */
export interface HistoryState {
  undo: string;
  redo: string;
}

/** 「それがどこで使われているか」1 件分。削除を断られたときに返る。 */
export interface Usage {
  kind: "task" | "step" | "contact" | "event";
  key: string;
  label: string;
  event?: string;
  eventTitle?: string;
}

/** エラー応答。 */
export interface ErrorBody {
  error: string;
  usage?: Usage[];
}

// ---------------------------------------------------------------------------
// 表示のための定数
// ---------------------------------------------------------------------------

/** 連絡先の区分の表示名。 */
export const KIND_LABEL: Record<ContactKind, string> = {
  esc: "エスカレーション先",
  internal: "社内",
  customer: "お客様",
  external: "外部機関・ベンダー",
};
