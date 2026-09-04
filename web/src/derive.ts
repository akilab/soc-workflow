/**
 * 共通フローと、そこから作った顧客別フローの違い。
 *
 * 顧客ごとに手順そのものが変わる（やることが増減し、SLA も報告先も違う）ので、
 * 共通を元に顧客別を作る形にしてある。ただし元の変更は自動では伝わらない。
 * 伝わってしまうと「どこを見ていて、どこを見ていないか」が黙って変わる。
 * だから代わりに、違いを見せて、取り込むかは人が決める。
 *
 * 対応付けは Step.from（元のどの手順から来たか）で取る。手順 ID は写すと
 * 振り直されるので、これが無いと題名の一致などで推測することになり、
 * 題名を変えたとたんに「別の手順」に見えてしまう。
 */

import { taskOf } from "./flow";
import type { DB, EventFlow, Step } from "./types";

/** 手順 1 つの違い。 */
export type StepDiff =
  | { kind: "same"; step: Step; base: Step }
  | { kind: "changed"; step: Step; base: Step; fields: string[] }
  | { kind: "added"; step: Step }
  | { kind: "removed"; base: Step };

export interface FlowDiff {
  /** 元にした事象。見つからなければ undefined。 */
  base?: EventFlow;
  rows: StepDiff[];
  added: number;
  changed: number;
  removed: number;
  /** 両方に残っている手順の前後関係が変わっているか。 */
  reordered: boolean;
  /** 元が、最後に確認した時点より新しいか。 */
  outdated: boolean;
}

/** 見比べる欄と、その日本語。順番はそのまま画面に出る順。 */
const FIELDS: { key: keyof Step; label: string }[] = [
  { key: "title", label: "題名" },
  { key: "detail", label: "詳細" },
  { key: "sla", label: "SLA" },
  { key: "lane", label: "担当" },
  { key: "task", label: "タスク" },
  { key: "escalate", label: "エスカレ" },
  { key: "contacts", label: "連絡先" },
  { key: "conditions", label: "表示条件" },
  { key: "decision", label: "判断" },
];

/** 中身が同じかどうか。配列と入れ子があるので JSON に落として比べる。 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function diffFrom(db: DB, evt: EventFlow): FlowDiff | null {
  if (!evt.base) return null;
  const base = db.events.find((e) => e.key === evt.base);
  if (!base) {
    // 元が消えていた場合。サーバは元の削除を断るので普通は起きないが、
    // ファイルを手で直された場合に黙って落ちないようにしておく。
    return {
      rows: [],
      added: 0,
      changed: 0,
      removed: 0,
      reordered: false,
      outdated: false,
    };
  }

  const byID = new Map(base.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const rows: StepDiff[] = [];

  for (const st of evt.steps) {
    const src = st.from ? byID.get(st.from) : undefined;
    if (!src) {
      rows.push({ kind: "added", step: st });
      continue;
    }
    seen.add(src.id);
    const fields = FIELDS.filter((f) => !same(st[f.key], src[f.key])).map(
      (f) => f.label,
    );
    rows.push(
      fields.length
        ? { kind: "changed", step: st, base: src, fields }
        : { kind: "same", step: st, base: src },
    );
  }

  // 元にしかない手順は「この顧客ではやらない」もの。元の並びのまま末尾へまとめる。
  //
  // 元の位置に差し込む案もあったが、派生側で並べ替えられていると
  // 「どこに無いのか」が決まらない。まとめて出すほうが曖昧さがない。
  for (const src of base.steps) {
    if (!seen.has(src.id)) rows.push({ kind: "removed", base: src });
  }

  return {
    base,
    rows,
    added: rows.filter((r) => r.kind === "added").length,
    changed: rows.filter((r) => r.kind === "changed").length,
    removed: rows.filter((r) => r.kind === "removed").length,
    reordered: reordered(base, evt),
    outdated: isOutdated(evt, base),
  };
}

/**
 * 両方に残っている手順の前後関係が変わっているか。
 *
 * 手順は「実施順」そのものなので、順番が違えば中身が同じでも違うフロー。
 * 欄の比較では出てこないので、別に見る。
 */
function reordered(base: EventFlow, evt: EventFlow): boolean {
  const rank = new Map(base.steps.map((s, i) => [s.id, i]));
  let prev = -1;
  for (const st of evt.steps) {
    const i = st.from ? rank.get(st.from) : undefined;
    if (i === undefined) continue;
    if (i < prev) return true;
    prev = i;
  }
  return false;
}

/** 元が、最後に確認した時点より新しいか。 */
export function isOutdated(evt: EventFlow, base: EventFlow): boolean {
  if (!evt.baseSyncedAt) return true;
  return new Date(base.updatedAt) > new Date(evt.baseSyncedAt);
}

/** その事象を元にした事象。 */
export function derivedOf(db: DB, key: string): EventFlow[] {
  return db.events.filter((e) => e.base === key);
}

/**
 * 違いを一言でまとめる。カードやボタンに出す。
 *
 * 「同じ」も言う。違いが 0 件のときに何も出ないと、
 * 調べていないのか本当に同じなのか分からない。
 */
export function diffSummary(d: FlowDiff): string {
  const parts: string[] = [];
  if (d.added) parts.push(`追加 ${d.added}`);
  if (d.changed) parts.push(`変更 ${d.changed}`);
  if (d.removed) parts.push(`削除 ${d.removed}`);
  if (d.reordered) parts.push("並び順");
  return parts.length ? parts.join(" / ") : "共通と同じ";
}

/** 変更された手順で、実際に何が違うのかを一行で。 */
export function changedDetail(db: DB, r: StepDiff): string {
  if (r.kind !== "changed") return "";
  const say = (s: Step, f: string): string => {
    switch (f) {
      case "題名":
        return s.title;
      case "SLA":
        return s.sla || "なし";
      case "担当":
        return db.lanes.find((l) => l.key === s.lane)?.name ?? s.lane;
      case "タスク":
        return taskOf(db, s.task)?.label ?? s.task;
      case "エスカレ":
        return s.escalate ? "要" : "不要";
      case "連絡先":
        return (
          (s.contacts ?? [])
            .map((k) => db.contactGroups.find((g) => g.key === k)?.name ?? k)
            .join("、") || "なし"
        );
      default:
        return "";
    }
  };
  // 詳細・条件・判断は長いので、変わったことだけを言う。
  return r.fields
    .map((f) => {
      const a = say(r.base, f);
      const b = say(r.step, f);
      return a || b ? `${f}: ${a} → ${b}` : `${f}が違います`;
    })
    .join(" / ");
}
