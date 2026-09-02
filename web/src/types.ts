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
export const VERSION = 1;

export interface DB {
  version: number;
  phases: Phase[];
  tasks: Task[];
  contactGroups: ContactGroup[];
  events: EventFlow[];
}

/** 対応の段階。フロー図の 1 列。 */
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
  label: string;
  note: string;
  tier: Tier;
}

/** 担当。誰がその手順をやるか。空は未指定。 */
export type Tier = "" | "t1" | "t2" | "t3";

/** 連絡先のカテゴリ。管理職・Tier2・顧客別など。 */
export interface ContactGroup {
  key: string;
  name: string;
  kind: ContactKind;
  note: string;
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
  /** 並び順が実施順。 */
  steps: Step[];
  updatedAt: string;
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
  /** Go 側は TaskKey。json タグが task。 */
  task: string;
  title: string;
  detail: string;
  sla: string;
  escalate: boolean;
  tier: Tier;
  /** 参照する ContactGroup のキー。 */
  contacts: string[];
  /** 表示条件。複数あれば AND。空なら常に表示。 */
  conditions: Condition[];
  /** あればこの手順は判断ステップになる。 */
  decision?: Decision | null;
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
}

/** 「それがどこで使われているか」1 件分。削除を断られたときに返る。 */
export interface Usage {
  kind: "task" | "step";
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

/** 担当の表示名。viewer 側（internal/export/viewer.js の TIER）と揃える。 */
export const TIER_LABEL: Record<Exclude<Tier, "">, string> = {
  t1: "Tier1",
  t2: "Tier2",
  t3: "Tier3・CSIRT",
};

/** 連絡先の区分の表示名。 */
export const KIND_LABEL: Record<ContactKind, string> = {
  esc: "エスカレーション先",
  internal: "社内",
  customer: "お客様",
  external: "外部機関・ベンダー",
};
