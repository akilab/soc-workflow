/**
 * フロー図の置き方を決める。
 *
 * v1 までは、手順を配列の順にそのまま縦へ積んでいた。1 行 1 手順なので線が
 * 交差しないことを構造で保証できた代わりに、**分かれ道が図に現れなかった**。
 * 「いいえのとき」の手順が「はいのとき」の 6 手順の下に埋もれ、図を見ても
 * どこで分かれるのか分からない。設計するための図としては、そこがいちばん
 * 見たいところだった。
 *
 * v2 では、分岐の枝を横に並べる。
 *
 *   列 … 担当。ただし同じ担当に枝が 2 本以上並ぶときは、その担当の列を割る
 *   行 … 枝の中での順。枝の長さが違っても、次の手順へはそれぞれの枝の最後から
 *
 * 枝を置く順は **その枝がいちばん左で使う担当の順**。判断の選択肢の順ではない。
 * 選択肢の順に置くと、担当をまたいで左へ戻る枝の横線が、短い枝の下りる線と
 * 交わることがある（実データ 5 フローで 1 か所）。担当の順に置けば横切る相手が
 * いなくなり、交差は 0 になる。モック（mock/branch-layout.html）で線分の
 * 総当たり検査により確かめてある。
 *
 * データの持ち方は変えていない。分岐は今までどおり手順の条件で表す。
 * ここは**読み替えて置き方を決めるだけ**なので、書き出し HTML も同じ規則で
 * 描けば同じ図になる。
 *
 * 入れ子の分岐（枝の中でさらに分かれる）は、外側の枝の中に縦へ並べる。
 * 内側のフォークは図には出ない。実データに無いので、必要になってから考える。
 */

import type { EventFlow, Lane, Step } from "./types";

/** 手順の並びを分けたひとかたまり。 */
export interface Block {
  type: "step" | "branch";
  /** type:"step" のときの手順。 */
  step?: Step;
  index?: number;
  /** type:"branch" のときの、判断のキーと枝。 */
  key?: string;
  /** 枝を置く順（左から右へ）。 */
  order?: string[];
  byVal?: Record<string, { step: Step; index: number }[]>;
}

/** 置き場所が決まった手順 1 つ。 */
export interface Placed {
  step: Step;
  /** 元の配列での位置。番号と、キャンバスの要素の対応に使う。 */
  index: number;
  row: number;
  col: number;
  span: number;
  /** そのかたまりの入口か（前のかたまりから線が入る）。 */
  entry: boolean;
  /** そのかたまりの出口か（次のかたまりへ線が出る）。 */
  exit: boolean;
  /** 分岐の中なら、どの答えの枝か。 */
  value?: string;
  /** 分岐の中なら、何番目の帯か（bands の添字）。落とし先の判定で使う。 */
  band?: number;
  block: Block;
}

export interface FlowLayout {
  blocks: Block[];
  /** 担当ごとの列の数と、左端の位置。 */
  need: Record<string, number>;
  base: Record<string, number>;
  /** 列の総数。 */
  cols: number;
  placed: Placed[];
  /** 行の数（見出しの行を除く）。 */
  rows: number;
  /**
   * 分岐の帯（行の範囲）。地色を敷いて「ここが分かれ道」と示す。
   *
   * key はその分かれ道の判断のキー。帯の中へ手順を落としたときに、
   * その枝の条件を付けるために使う（canvas.ts の落とし先判定）。
   */
  bands: { from: number; to: number; key: string }[];
  /** 線を引く組。 */
  pairs: [Placed, Placed][];
}

/**
 * 手順の並びをかたまりに分ける。条件を持つ手順が続くあいだが 1 つの分岐。
 *
 * アウトラインも同じ分け方を使う（branch.ts の outlineRows）。図と一覧で
 * 枝の切れ目や並び順が違うと、同じデータが 2 通りに見える。
 */
export function blocksOf(evt: EventFlow, lanes: Lane[]): Block[] {
  const laneIndex: Record<string, number> = {};
  lanes.forEach((l, i) => (laneIndex[l.key] = i));

  const out: Block[] = [];
  const steps = evt.steps;
  let i = 0;

  while (i < steps.length) {
    const cs = steps[i].conditions ?? [];
    if (!cs.length) {
      out.push({ type: "step", step: steps[i], index: i });
      i++;
      continue;
    }

    const key = cs[0].key;
    const order: string[] = [];
    const byVal: Record<string, { step: Step; index: number }[]> = {};
    while (i < steps.length) {
      const c = (steps[i].conditions ?? [])[0];
      if (!c || c.key !== key) break;
      if (!byVal[c.value]) {
        byVal[c.value] = [];
        order.push(c.value);
      }
      byVal[c.value].push({ step: steps[i], index: i });
      i++;
    }

    // 枝を置く順は、その枝がいちばん左で使う担当の順。上のコメントの理由。
    order.sort((a, b) => leftmost(byVal[a], laneIndex) - leftmost(byVal[b], laneIndex));
    out.push({ type: "branch", key, order, byVal });
  }
  return out;
}

function leftmost(
  list: { step: Step }[],
  laneIndex: Record<string, number>,
): number {
  return Math.min(...list.map((x) => laneIndex[x.step.lane] ?? 0));
}

/** 置き場所を決める。 */
export function layoutFlow(evt: EventFlow, lanes: Lane[]): FlowLayout {
  const blocks = blocksOf(evt, lanes);

  // 担当ごとに、いくつ列が要るか。同時に並ぶ枝の最大数。
  const need: Record<string, number> = {};
  for (const l of lanes) need[l.key] = 1;
  for (const b of blocks) {
    if (b.type !== "branch") continue;
    const used: Record<string, number> = {};
    for (const v of b.order ?? []) {
      const seen = new Set((b.byVal?.[v] ?? []).map((x) => x.step.lane));
      for (const lk of seen) used[lk] = (used[lk] ?? 0) + 1;
    }
    for (const lk of Object.keys(used)) {
      if (used[lk] > (need[lk] ?? 1)) need[lk] = used[lk];
    }
  }

  const base: Record<string, number> = {};
  let cols = 0;
  for (const l of lanes) {
    base[l.key] = cols;
    cols += need[l.key];
  }

  const placed: Placed[] = [];
  const bands: { from: number; to: number; key: string }[] = [];
  let row = 2; // 1 行目は列の見出し

  for (const b of blocks) {
    if (b.type === "step" && b.step) {
      const lk = b.step.lane;
      placed.push({
        step: b.step,
        index: b.index ?? 0,
        row,
        col: base[lk] ?? 0,
        span: need[lk] ?? 1,
        entry: true,
        exit: true,
        block: b,
      });
      row++;
      continue;
    }

    // 枝ごと・担当ごとの小さい列を割り当てる。
    const slot: Record<string, Record<string, number>> = {};
    const counter: Record<string, number> = {};
    for (const v of b.order ?? []) {
      slot[v] = {};
      const seen = new Set((b.byVal?.[v] ?? []).map((x) => x.step.lane));
      for (const lk of seen) {
        const n = counter[lk] ?? 0;
        slot[v][lk] = Math.min(n, (need[lk] ?? 1) - 1);
        counter[lk] = n + 1;
      }
    }

    const start = row;
    const bi = bands.length;
    let height = 0;
    for (const v of b.order ?? []) {
      const list = b.byVal?.[v] ?? [];
      if (list.length > height) height = list.length;
      list.forEach((x, k) => {
        const lk = x.step.lane;
        placed.push({
          step: x.step,
          index: x.index,
          row: start + k,
          col: (base[lk] ?? 0) + (slot[v][lk] ?? 0),
          span: 1,
          entry: k === 0,
          exit: k === list.length - 1,
          value: v,
          band: bi,
          block: b,
        });
      });
    }
    bands.push({ from: start, to: start + height - 1, key: b.key ?? "" });
    row = start + height;
  }

  return { blocks, need, base, cols, placed, rows: row - 1, bands, pairs: pairsOf(blocks, placed) };
}

/**
 * 線を引く組を決める。
 *
 * かたまりどうしは「前の出口 → 次の入口」で繋ぐ。分岐へ入るときは枝の数だけ
 * 分かれ、分岐から出るときは枝の数だけ戻る。枝の中は順に繋ぐ。
 */
function pairsOf(blocks: Block[], placed: Placed[]): [Placed, Placed][] {
  const out: [Placed, Placed][] = [];
  let prev: Placed[] | null = null;

  for (const b of blocks) {
    const mine = placed.filter((p) => p.block === b);
    const entries = mine.filter((p) => p.entry);
    const exits = mine.filter((p) => p.exit);

    if (prev) {
      for (const a of prev) for (const z of entries) out.push([a, z]);
    }
    prev = exits;

    if (b.type === "branch") {
      for (const v of b.order ?? []) {
        const list = mine.filter((p) => p.value === v).sort((x, y) => x.row - y.row);
        for (let k = 0; k + 1 < list.length; k++) out.push([list[k], list[k + 1]]);
      }
    }
  }
  return out;
}
