/**
 * 分岐の見せ方。
 *
 * 「存在するのとき」とだけ書かれていても、どの質問への答えなのか分からない。
 * だから分岐は 3 つに分けて示す——どの判断か（質問）、どの答えか（色つきの行）、
 * その下に属する手順（縦線で囲われた範囲）。ここはその材料を作る。
 */

import { blocksOf } from "./layout";
import type { Condition, Decision, EventFlow, Lane, Step } from "./types";

/** 答えの色。判断ごとにずらして使うので、同じ画面で色が重なりにくい。 */
export const OPTION_COLORS = [
  "#ffb02e",
  "#4aa8ff",
  "#ff5c8a",
  "#2ee6a8",
  "#a97bff",
  "#5ad1e6",
];

/** 判断とその出現順を返す。色をずらすのに順番を使う。 */
export function decisionOf(
  evt: EventFlow,
  key: string,
): { decision: Decision | null; index: number } {
  let n = 0;
  for (const st of evt.steps) {
    if (!st.decision) continue;
    if (st.decision.key === key) return { decision: st.decision, index: n };
    n++;
  }
  return { decision: null, index: 0 };
}

/** その判断が何番目の手順にあるか（1 始まり）。無ければ null。 */
export function decisionStepNo(evt: EventFlow, key: string): number | null {
  for (let i = 0; i < evt.steps.length; i++) {
    if (evt.steps[i].decision?.key === key) return i + 1;
  }
  return null;
}

/** 答えの表示名。判断が見つからなければ値をそのまま返す。 */
export function optLabel(evt: EventFlow, c: Condition): string {
  const d = decisionOf(evt, c.key).decision;
  if (!d) return c.value;
  return d.options.find((o) => o.value === c.value)?.label ?? c.value;
}

/** 答えの色。 */
export function optColor(evt: EventFlow, c: Condition): string {
  const r = decisionOf(evt, c.key);
  if (!r.decision) return "var(--dec)";
  let i = 0;
  r.decision.options.forEach((o, ix) => {
    if (o.value === c.value) i = ix;
  });
  return OPTION_COLORS[(i + r.index) % OPTION_COLORS.length];
}

/** 条件を文にする。ツールチップに出して、辿れるようにする。 */
export function condSentence(evt: EventFlow, st: Step): string {
  return (
    (st.conditions ?? [])
      .map((c) => {
        const d = decisionOf(evt, c.key).decision;
        return `${d ? `「${d.label}」が` : `${c.key} が`}〈${optLabel(evt, c)}〉`;
      })
      .join(" かつ ") + " のとき"
  );
}

/** 条件の組み合わせを表す文字列。同じ組み合わせをまとめるのに使う。 */
export function condKey(st: Step): string {
  return (st.conditions ?? [])
    .map((c) => `${c.key}=${c.value}`)
    .sort()
    .join("&");
}

/** その手順が参照している判断キー（重複なし・出現順）。 */
export function decKeys(st: Step): string {
  const out: string[] = [];
  for (const c of st.conditions ?? []) {
    if (!out.includes(c.key)) out.push(c.key);
  }
  return out.join("&");
}

// ---------------------------------------------------------------------------
// アウトラインの行
// ---------------------------------------------------------------------------

export interface StepRow {
  type: "step";
  st: Step;
  /** 手順の通し番号（0 始まり）。 */
  i: number;
  /** 分岐ブロックの中か。 */
  deep: boolean;
}

export interface GroupRow {
  type: "grp";
  conds: Condition[];
}

export interface BlockRow {
  type: "block";
  /** この塊が依存している判断キー。 */
  keys: string;
  rows: (StepRow | GroupRow)[];
}

export type OutlineRow = StepRow | BlockRow;

/**
 * アウトラインの行を組み立てる。
 *
 * 塊の切れ目と枝の並び順はフロー図と同じもの（layout.ts の blocksOf）を使う。
 * 枝の中では、答えごとにまとめて見出しを 1 つだけ置く。
 *
 * 以前は「前の行と答えが変わったら見出しを挟む」で作っていた。並びの上で
 * 枝が交互になっていると（外部要請 → 復旧 → 無効化 → 確認）、同じ答えの
 * 見出しが 2 度 3 度と出て、分かれ道が 2 つあるように見えていた。図のほうは
 * 答えごとに列へまとめているので、同じデータが 2 通りに見えていたことになる。
 *
 * 入れ子（同じ枝の中で、さらに別の判断にも依存する手順）は、答えの中で
 * 条件の組み合わせごとに分ける。組み合わせは 1 つにつき 1 度しか出ないので、
 * 見出しが重なることはない。
 */
export function outlineRows(evt: EventFlow, lanes: Lane[]): OutlineRow[] {
  const rows: OutlineRow[] = [];

  for (const b of blocksOf(evt, lanes)) {
    if (b.type === "step" && b.step) {
      rows.push({ type: "step", st: b.step, i: b.index ?? 0, deep: false });
      continue;
    }

    const block: BlockRow = { type: "block", keys: b.key ?? "", rows: [] };
    for (const v of b.order ?? []) {
      // 同じ答えの中を、条件の組み合わせごとにまとめる。出てきた順に置く。
      const byComb = new Map<string, { step: Step; index: number }[]>();
      for (const x of b.byVal?.[v] ?? []) {
        const k = condKey(x.step);
        const list = byComb.get(k);
        if (list) list.push(x);
        else byComb.set(k, [x]);
      }
      for (const list of byComb.values()) {
        block.rows.push({ type: "grp", conds: [...(list[0].step.conditions ?? [])] });
        for (const x of list) {
          block.rows.push({ type: "step", st: x.step, i: x.index, deep: true });
        }
      }
    }
    rows.push(block);
  }

  return rows;
}
