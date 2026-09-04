/**
 * フローそのものを扱う計算。画面にも DOM にも依存しない。
 *
 * モックの editorJs から移したもの。中身は変えていない。
 * ここが変わると「検証 OK」の意味が変わるので、直すときは意図を持って直す。
 */

import type { Condition, DB, EventFlow, Lane, Phase, Step, Task } from "./types";

/** 判断への回答。キーは Decision.key、値は Option.value。 */
export type Answers = Record<string, string>;

/** 1 本の経路。 */
export interface FlowPath {
  answers: Answers;
  /** その経路で実施する手順の数。 */
  count: number;
  /** 自分たちが動く時間の合計（分）。待ちは含まない。 */
  minutes: number;
  /**
   * 待っている時間の合計（分）。
   *
   * 作業時間と分けて数える。顧客の返答を待つ 1 営業日を作業時間に足すと、
   * 「この経路は 9 時間かかる」という数字が実態を表さなくなる。
   * どちらも経過時間ではあるので、両方出して読む側に判断させる。
   */
  waitMinutes: number;
}

/** 検証で見つかった問題。 */
export interface Issue {
  lv: "err" | "wrn";
  /** 何が起きているか。 */
  t: string;
  /** なぜ困るのか、どうすればよいか。 */
  d: string;
}

export interface Validation {
  issues: Issue[];
  paths: FlowPath[];
  /** 担当の受け渡しの回数。 */
  handoffs: number;
}

/** 担当が切り替わる回数を数える。 */
export function countHandoffs(evt: EventFlow): number {
  let n = 0;
  for (let i = 1; i < evt.steps.length; i++) {
    if (evt.steps[i - 1].lane !== evt.steps[i].lane) n++;
  }
  return n;
}

/** フェーズごとの手順数。フローカードの帯に使う。 */
export interface PhaseCount {
  p: Phase;
  n: number;
}

// ---------------------------------------------------------------------------

/**
 * そのフローで使う担当を解決して返す。
 *
 * フローが指定していなければ全体の担当をそのまま返す。指定していれば、その並びで
 * 呼び名だけを差し替えて返す。呼ぶ側は全体とフローの違いを気にしなくてよい。
 *
 * 返すのは複製。全体の Lane をそのまま返して名前を書き換えると、
 * 1 つのフローの呼び名が全体に漏れる。
 */
export function eventLanes(db: DB, evt: EventFlow | undefined): Lane[] {
  if (!evt?.lanes?.length) return db.lanes.map((l) => ({ ...l }));
  return evt.lanes
    .map((el) => {
      const base = db.lanes.find((l) => l.key === el.key);
      if (!base) return null; // 消された担当を指している。黙って落とす
      return { ...base, name: el.name || base.name };
    })
    .filter((l): l is Lane => !!l);
}

/** キーから対応を引く。 */
export function taskOf(db: DB, key: string): Task | undefined {
  return db.tasks.find((t) => t.key === key);
}

/** キーからフローを引く。 */
export function eventOf(db: DB, key: string): EventFlow | undefined {
  return db.events.find((e) => e.key === key);
}

/**
 * その対応を使っているフロー。
 *
 * 対応はフローをまたいで再利用される部品なので、「どこで使われているか」は
 * パレットでも対応一覧でも要る。数え方が 2 か所でずれないように 1 つにする。
 */
export function eventsUsingTask(db: DB, key: string): EventFlow[] {
  return db.events.filter((e) => e.steps.some((s) => s.task === key));
}

/** フェーズごとに、そのフローが何手順を持っているか。フェーズの並び順で返す。 */
export function phaseDist(db: DB, evt: EventFlow): PhaseCount[] {
  const m = new Map<string, number>();
  for (const s of evt.steps) {
    const t = taskOf(db, s.task);
    if (t) m.set(t.phase, (m.get(t.phase) ?? 0) + 1);
  }
  return db.phases
    .filter((p) => m.has(p.key))
    .map((p) => ({ p, n: m.get(p.key)! }));
}

/**
 * SLA の文字列を分に直す。"15分" "即時" "1営業日" などを受ける。
 * 決まった書式を強いると入力が面倒になるので、書かれたものを読む側で解釈する。
 */
export function parseSla(s: string): number {
  if (!s) return 0;
  if (/即時/.test(s)) return 0;
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]) : 0;
  if (/営業日|日/.test(s)) return n * 8 * 60; // 1 営業日 = 8 時間
  if (/時間/.test(s)) return n * 60;
  return n;
}

/** 分を読める形にする。 */
export function fmtMin(m: number): string {
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return `${h} 時間${r ? ` ${r} 分` : ""}`;
}

/**
 * その手順が、この回答の組み合わせで表示されるか。
 *
 * まだ答えていない条件があれば表示しない。
 * 「まだ分からない」と「表示しない」は、経路の数え上げでは同じ扱いになる。
 */
export function visible(st: Step, ans: Answers): boolean {
  const cs: Condition[] = st.conditions ?? [];
  return cs.every((c) => ans[c.key] !== undefined && ans[c.key] === c.value);
}

/**
 * 分岐の組み合わせを数え上げる。
 *
 * 上限 64 本。判断が 6 つ重なると 64 本になり、それ以上は一覧にしても読めない。
 * 数え切れないほど分岐しているなら、フローの側を分けるべきという合図でもある。
 */
export function enumeratePaths(db: DB, evt: EventFlow): FlowPath[] {
  const results: Answers[] = [];

  function walk(from: number, ans: Answers): void {
    if (results.length >= 64) return;
    for (let i = from; i < evt.steps.length; i++) {
      const st = evt.steps[i];
      if (!visible(st, ans)) continue;
      if (st.decision) {
        for (const o of st.decision.options) {
          walk(i + 1, { ...ans, [st.decision.key]: o.value });
        }
        return;
      }
    }
    results.push(ans);
  }
  walk(0, {});

  return results.map((ans) => {
    const steps = evt.steps.filter((st) => visible(st, ans));
    const isWait = (s: Step) => taskOf(db, s.task)?.kind === "wait";
    return {
      answers: ans,
      count: steps.length,
      minutes: steps
        .filter((s) => !isWait(s))
        .reduce((a, s) => a + parseSla(s.sla), 0),
      waitMinutes: steps.filter(isWait).reduce((a, s) => a + parseSla(s.sla), 0),
    };
  });
}

/**
 * フローを検証する。
 *
 * 見るのは「対応者がその通りに辿れるか」。文法ではなく運用の成立を見ている。
 */
export function validate(db: DB, evt: EventFlow): Validation {
  const issues: Issue[] = [];

  // 1. まだ現れていない判断を条件が参照していないか。
  //    対応者は、まだ答えていない質問の結果では分岐できない。
  const seen = new Set<string>();
  evt.steps.forEach((st, i) => {
    for (const c of st.conditions ?? []) {
      if (!seen.has(c.key)) {
        issues.push({
          lv: "err",
          t: `手順 ${i + 1}「${st.title}」の条件が、まだ現れていない判断を参照しています`,
          d:
            `参照キー: ${c.key} — この判断はこの手順より後ろにあるか、存在しません。` +
            "対応者は、まだ答えていない質問の結果で分岐させられません。",
        });
      }
    }
    if (st.decision) seen.add(st.decision.key);
  });

  const paths = enumeratePaths(db, evt);

  // 2. どの経路でも表示されない手順が無いか。
  evt.steps.forEach((st, i) => {
    if (!(st.conditions ?? []).length) return;
    const reachable = paths.some((p) =>
      st.conditions.every((c) => p.answers[c.key] === c.value),
    );
    if (!reachable) {
      issues.push({
        lv: "wrn",
        t: `手順 ${i + 1}「${st.title}」はどの経路でも表示されません`,
        d: "条件の組み合わせが成立しません。条件を見直すか、手順を削除してください。",
      });
    }
  });

  // 3. 答えても何も変わらない判断が無いか。
  for (const st of evt.steps) {
    if (!st.decision) continue;
    const key = st.decision.key;
    const used = evt.steps.some((s) =>
      (s.conditions ?? []).some((c) => c.key === key),
    );
    if (!used) {
      issues.push({
        lv: "wrn",
        t: `判断「${st.decision.label}」の答えが、どの手順にも使われていません`,
        d: "回答しても何も変わりません。分岐が不要なら、判断ステップを解除できます。",
      });
    }
  }

  // 4. 終了より後ろに、同じ経路で実施される手順が残っていないか。
  //    残っていると、対応者は終了を押したあとに「まだ何かある」と迷う。
  //    設計する側としては、終了は経路の最後に置きたい。
  evt.steps.forEach((st, i) => {
    if (taskOf(db, st.task)?.kind !== "close") return;
    const after = evt.steps.slice(i + 1).filter((x) => {
      // 終了と両立しない条件が付いていれば、同じ経路には乗らない
      const cs = x.conditions ?? [];
      if (!cs.length) return true;
      return cs.every((c) =>
        (st.conditions ?? []).every((sc) => sc.key !== c.key || sc.value === c.value),
      );
    });
    if (after.length) {
      issues.push({
        lv: "wrn",
        t: `手順 ${i + 1}「${st.title}」は終了ですが、後ろに ${after.length} 手順あります`,
        d:
          "終了を完了させると、以降は対象外になります。同じ経路で実施したい手順は" +
          "終了より前に置くか、後ろの手順に別の条件を付けてください。",
      });
    }
  });

  // 5. 担当の受け渡しが多すぎないか。
  //
  //    これは図の見た目の指標ではない。受け渡しは 1 回ごとに
  //    「ボールが落ちうる場所」になるので、回数が多いフローは
  //    図が読みにくいのではなく運用が危ない。
  //
  //    列がフェーズだった頃は「前のフェーズへの後戻り」を数えていた。あれは
  //    線が混むことの指標で、軸を担当に変えた時点で意味を失った。
  const handoffs = countHandoffs(evt);
  if (handoffs > 8) {
    issues.push({
      lv: "wrn",
      t: `担当の受け渡しが ${handoffs} 回あります`,
      d:
        "受け渡しは 1 回ごとに引き継ぎ漏れが起きうる場所です。" +
        "同じ担当で続けられる手順がまとまっていないか、見直してください。",
    });
  }

  return { issues, paths, handoffs };
}
