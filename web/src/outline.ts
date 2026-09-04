/**
 * 手順アウトライン。実施順を縦に並べ、分岐を入れ子で見せる。
 *
 * キャンバスは「どのフェーズのどこにあるか」を見せる。こちらは「どの順で、
 * どの条件のときにやるか」を見せる。同じデータを別の軸で並べている。
 */

import { optColor, optLabel, outlineRows, decisionOf, decisionStepNo } from "./branch";
import type { GroupRow, StepRow } from "./branch";
import { $, esc } from "./dom";
import { eventLanes, taskOf } from "./flow";
import { stepContacts } from "./contacts";
import type { DB, EventFlow } from "./types";

export interface OutlineDeps {
  db: DB;
  evt: EventFlow;
  selected: string[];
  onPick: (id: string, e: MouseEvent) => void;
  /** 手順を beforeId の前へ動かす。末尾へ動かすときは null。 */
  onMove: (fromId: string, beforeId: string | null) => void;
}

/** ドラッグ中の手順。行をまたぐので、この場に置く。 */
let dragging: string | null = null;

/**
 * そのフローで確保するラベルの列。
 *
 * 印は疎で、62 手順に対して 15 個ほどしか付かない。全部の列を常に確保すると、
 * ほとんどの行で空の幅を取ることになる。使う印だけ列にする。
 */
interface MarkColumns {
  cust: boolean;
  /** 終了と待ちは同時に起きないので、1 つの列を分け合う。 */
  kind: boolean;
  esc: boolean;
}

function markColumns(db: DB, evt: EventFlow): MarkColumns {
  const cols: MarkColumns = { cust: false, kind: false, esc: false };
  for (const st of evt.steps) {
    if (st.escalate) cols.esc = true;
    if (stepContacts(db, st).some((c) => c.kind === "customer")) cols.cust = true;
    const k = taskOf(db, st.task)?.kind;
    if (k === "close" || k === "wait") cols.kind = true;
  }
  return cols;
}

export function renderOutline(deps: OutlineDeps): void {
  const evt = deps.evt;
  const box = $("olList");
  box.innerHTML = "";
  $("olCount").textContent = `${evt.steps.length} 手順`;

  if (!evt.steps.length) {
    box.innerHTML =
      '<p class="ol-empty">手順がまだありません。<br>' +
      "右の「対応パレット」タブから、キャンバスへドラッグしてください。</p>";
    return;
  }

  const cols = markColumns(deps.db, evt);

  for (const r of outlineRows(evt)) {
    if (r.type === "block") {
      const bl = document.createElement("div");
      bl.className = "ol-branch";
      bl.appendChild(questionEl(evt, r.keys));
      for (const x of r.rows) {
        bl.appendChild(
          x.type === "grp" ? groupEl(evt, x) : stepEl(deps, x, box, cols),
        );
      }
      box.appendChild(bl);
      continue;
    }
    box.appendChild(stepEl(deps, r, box, cols));
  }

  const legend = document.createElement("p");
  legend.className = "ol-legend";
  legend.innerHTML =
    "◆ 判断ステップ。その下の縦線が、この判断で分かれる範囲です。" +
    "灰色の行が質問、色つきの行がその答え。<br>" +
    "<b>！エスカレ</b> この手順でエスカレーションの要否を判断します。" +
    "<b>お客様連絡</b> この手順でお客様へ連絡します。" +
    "<b>N分岐</b> この判断を参照している手順の数です。<br>" +
    "行をドラッグすると順序を入れ替えられます。" +
    "Ctrl＋クリックで複数選択、Shift＋クリックで範囲選択。";
  box.appendChild(legend);
  fitLaneColumn(box);
}

/**
 * 担当の列幅を、このフローで一番長い呼び名にそろえる。
 *
 * 担当は行の右端にあるので、幅が行ごとに違うと、その左にある印が丸ごと
 * 押されてずれる（実測で 32px）。呼び名はフローごとに変えられるので長さは
 * 決め打ちできない。描いてから測って、いちばん長いものに合わせる。
 *
 * 切り詰めない。「高橋工務店」が「高橋工…」になるくらいなら、
 * 列が少し広いほうがよい。
 */
function fitLaneColumn(box: HTMLElement): void {
  requestAnimationFrame(() => {
    const tags = [...box.querySelectorAll<HTMLElement>(".ol-lane .tier")];
    if (!tags.length) return;
    const w = Math.max(...tags.map((t) => t.getBoundingClientRect().width));
    box.style.setProperty("--ol-lane-w", `${Math.ceil(w)}px`);
  });
}

/**
 * 分岐ブロックの見出し。どの手順の、どの質問への答えなのかを書く。
 *
 * これが無いと「存在するのとき」とだけ並び、何の話か分からなくなる。
 */
function questionEl(evt: EventFlow, keys: string): HTMLElement {
  const q = document.createElement("div");
  q.className = "ol-q";

  const parts = keys.split("&").map((k) => {
    const d = decisionOf(evt, k).decision;
    return { no: decisionStepNo(evt, k), label: d ? d.label : k };
  });

  q.innerHTML =
    `<span class="qn">${parts[0].no ?? "?"}</span>` +
    `<b>${parts.map((p) => esc(p.label)).join(" ／ ")}</b>`;
  q.title = parts
    .map((p) => (p.no ? `手順 ${p.no} の判断: ` : "") + p.label)
    .join("\n");
  return q;
}

/** 答えの行。 */
function groupEl(evt: EventFlow, x: GroupRow): HTMLElement {
  const g = document.createElement("div");
  g.className = "ol-grp";
  g.style.setProperty("--oc", optColor(evt, x.conds[0]));
  g.innerHTML =
    x.conds.map((c) => esc(optLabel(evt, c))).join(" かつ ") + " <u>のとき</u>";
  return g;
}

/** 手順の行。 */
function stepEl(
  deps: OutlineDeps,
  r: StepRow,
  box: HTMLElement,
  cols: MarkColumns,
): HTMLElement {
  const { db, evt } = deps;
  const st = r.st;
  const phase = db.phases.find((p) => p.key === taskOf(db, st.task)?.phase);

  const el = document.createElement("div");
  el.className =
    "ol-row" +
    (r.deep ? " d1" : "") +
    (st.decision ? " dec" : "") +
    (deps.selected.includes(st.id)
      ? deps.selected.length > 1
        ? " sel-multi"
        : " sel"
      : "");
  el.style.setProperty("--pc", phase?.color ?? "var(--line)");
  el.draggable = true;
  el.dataset.id = st.id;

  // 数量（SLA と分岐の数）。ラベルとは別のまとまりにして、左側に置く。
  let q = "";
  if (st.decision) {
    const key = st.decision.key;
    const n = evt.steps.filter((x) =>
      (x.conditions ?? []).some((c) => c.key === key),
    ).length;
    if (n) {
      q +=
        `<span class="sla" style="color:var(--dec)"` +
        ` title="この判断を参照している手順が ${n} 件あります">${n}分岐</span>`;
    }
  }
  if (st.sla) q += `<span class="sla">${esc(st.sla)}</span>`;

  // ラベル。そのフローで使うものだけ列を確保し、使わない行には空の枠を置く。
  // そうしないと、行ごとにラベルの位置がずれて、同じ印を縦に追えない。
  const kind = taskOf(db, st.task)?.kind;
  const isCust = stepContacts(db, st).some((c) => c.kind === "customer");
  let f = "";
  if (cols.cust) {
    f += isCust
      ? '<span class="cust" title="この手順でお客様へ連絡します">お客様連絡</span>'
      : '<span class="cust ghost"></span>';
  }
  if (cols.kind) {
    f +=
      kind === "close"
        ? '<span class="fin" title="この経路はここで終わります">終了</span>'
        : kind === "wait"
          ? '<span class="wait" title="自分たちの作業ではありません">待ち</span>'
          : '<span class="fin ghost"></span>';
  }
  if (cols.esc) {
    // キャンバスと同じ言い方にする。記号 1 文字だけだと、何の印か分からない
    // （実際に「！マークは何でしょうか？」と聞かれた）。
    f += st.escalate
      ? '<span class="esc" title="この手順でエスカレーションの要否を判断します">' +
        "！エスカレ</span>"
      : '<span class="esc ghost"></span>';
  }

  // 担当は一番最後、行の右端に置く。
  //
  // アウトラインには列が無いので、「誰がやるか」を読めるのはこのバッジだけ。
  // 先頭に置くと、その右にある可変幅のバッジ（SLA・分岐・エスカレ）の数だけ
  // 左右にずれる。実測で 54px 動いていた。右端に固定すれば、行をまたいで
  // 縦にそろい、「自分の手順はどれか」を目で追える列になる。
  const lane = eventLanes(db, evt).find((l) => l.key === st.lane);
  const laneTag = lane
    ? `<span class="tier" style="--tc:${lane.color}">${esc(lane.name)}</span>`
    : "";

  el.innerHTML =
    `<span class="ol-no">${r.i + 1}</span><span class="ol-pc"></span>` +
    `<span class="ol-t">${esc(st.title)}</span>` +
    `<span class="ol-q">${q}</span>` +
    `<span class="ol-f">${f}</span><span class="ol-lane">${laneTag}</span>`;

  el.addEventListener("click", (e) => deps.onPick(st.id, e));

  el.addEventListener("dragstart", (e) => {
    dragging = st.id;
    el.classList.add("drag");
    e.dataTransfer?.setData("text/plain", `step:${st.id}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragend", () => {
    dragging = null;
    el.classList.remove("drag");
    for (const x of box.querySelectorAll(".ol-row")) x.classList.remove("over");
  });
  el.addEventListener("dragover", (e) => {
    if (dragging) {
      e.preventDefault();
      el.classList.add("over");
    }
  });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragging && dragging !== st.id) deps.onMove(dragging, st.id);
  });

  return el;
}

/**
 * 並べ替えたあとの手順 ID の並びを作る。
 *
 * 実際の入れ替えはサーバが持つ配列に対して行うので、こちらは「こう並べたい」
 * という順番を作るだけにしてある。過不足があればサーバが断る。
 */
export function reorderedIds(
  evt: EventFlow,
  fromId: string,
  beforeId: string | null,
): string[] {
  const ids = evt.steps.map((s) => s.id);
  const from = ids.indexOf(fromId);
  if (from < 0) return ids;

  ids.splice(from, 1);
  const at = beforeId ? ids.indexOf(beforeId) : -1;
  ids.splice(at < 0 ? ids.length : at, 0, fromId);
  return ids;
}
