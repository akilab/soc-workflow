/**
 * フローキャンバス。段階を列にして、手順をボックスとして並べ、接続線を引く。
 *
 * 線は DOM を実際に測ってから引く。文字の長さも折り返しも先には分からないので、
 * 描いてもらってから位置を読む。だから描画は 2 段——ボックスを置き、
 * 次のフレームで測って線を引く。
 *
 * 接続線の規則は書き出し HTML 側（internal/export/viewer.js）と揃える。
 * 右から出て左から入る。同じ列に戻るときは、間にすき間があればそこを通し、
 * 無ければ下へ迂回する。
 */

import { condSentence, optColor, optLabel } from "./branch";
import { $, esc } from "./dom";
import { groupVias, stepContacts, viaMark } from "./contacts";
import { taskOf } from "./flow";
import type { DB, EventFlow, Step } from "./types";

/** 測るために覚えておく、手順とその要素の対応。手順の順に並ぶ。 */
interface Node {
  el: HTMLElement;
  id: string;
}

export interface CanvasDeps {
  db: DB;
  evt: EventFlow;
  /** 選ばれている手順 ID。 */
  selected: string[];
  onPick: (id: string, e: MouseEvent) => void;
}

/**
 * 列の最小幅。段階の数から決めるので、列が減れば横スクロールも減る。
 * 列幅 166 + 列間 32 + 左右のレーン 22×2。
 */
function gridMinWidth(db: DB): string {
  const n = db.phases.length;
  return `${n * 166 + (n - 1) * 32 + 44}px`;
}

export function renderCanvas(deps: CanvasDeps): void {
  const { db, evt } = deps;
  const grid = $("cgrid");
  const wires = $("cwires");

  grid.innerHTML = "";
  grid.appendChild(wires);
  grid.style.minWidth = gridMinWidth(db);

  const nodes: (Node | undefined)[] = [];

  for (const p of db.phases) {
    const col = document.createElement("div");
    col.className = "ccol";
    col.dataset.p = p.key;
    col.style.setProperty("--pc", p.color);

    const cnt = evt.steps.filter((s) => taskOf(db, s.task)?.phase === p.key).length;
    col.innerHTML = `<h2>${esc(p.name)}<u>${cnt || ""}</u></h2>`;

    evt.steps.forEach((st, i) => {
      const t = taskOf(db, st.task);
      if (!t || t.phase !== p.key) return;

      const el = document.createElement("div");
      el.className = "cnode" + (deps.selected.includes(st.id) ? " sel" : "");
      el.style.setProperty("--pc", p.color);
      el.innerHTML = nodeHTML(db, evt, st, i);

      el.addEventListener("click", (e) => deps.onPick(st.id, e));
      // 選ばなくても辿れるように、ホバー中はその手順に繋がる線だけを強調する。
      el.addEventListener("mouseenter", () => hotWires([st.id]));
      el.addEventListener("mouseleave", () => hotWires(deps.selected));

      col.appendChild(el);
      nodes[i] = { el, id: st.id };
    });

    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = "ここに入ります";
    col.appendChild(ghost);

    grid.appendChild(col);
  }

  if (!evt.steps.length) {
    const empty = document.createElement("div");
    empty.className = "cempty";
    empty.innerHTML =
      "<b>まだ手順がありません</b>右の「タスクパレット」タブからドラッグしてください。<br>" +
      "段階の列への配置と接続線は自動で決まります。";
    grid.appendChild(empty);
  }

  // 置いてもらってから測る。
  requestAnimationFrame(() => paintWires(nodes, deps.selected));
}

/** ボックス 1 つの中身。 */
function nodeHTML(db: DB, evt: EventFlow, st: Step, i: number): string {
  const t = taskOf(db, st.task);
  let flags = "";

  if (st.decision) {
    flags += '<span class="f-dec" title="判断ステップ">&#9670; 判断</span>';
  }
  if ((st.conditions ?? []).length) {
    const c0 = st.conditions[0];
    flags +=
      `<span class="f-cond" style="color:${optColor(evt, c0)}"` +
      ` title="${esc(condSentence(evt, st))}">&#8888; ${esc(optLabel(evt, c0))}` +
      `${st.conditions.length > 1 ? " 他" : ""}</span>`;
  }
  if (st.escalate) {
    flags += '<span class="f-esc" title="エスカレーション判断">! エスカレ</span>';
  }

  const groups = stepContacts(db, st);
  if (groups.length) {
    const vias = new Set<string>();
    const tip: string[] = [];
    for (const g of groups) {
      for (const v of groupVias(g)) vias.add(v);
      tip.push(`${g.name}（${(g.members ?? []).length} 名）`);
    }
    const marks = [...vias]
      .map((v) => {
        const d = VIA[v] ?? { m: "?", c: "#7d8798" };
        return (
          `<i${d.ico ? ' class="ico"' : ""} style="--vc:${d.c}">` +
          `${viaMark(d)}</i>`
        );
      })
      .join("");
    flags += `<span class="f-ct" title="${esc(tip.join("\n"))}">${marks}</span>`;
  }

  if (st.sla) flags += `<span class="f-sla">${esc(st.sla)}</span>`;

  // 担当はタイトルの上に置く。「自分の手順か」を先に判断できるようにするため。
  // 手順の性質（判断・条件・エスカレ・SLA）とは別の種類の情報なので行を分ける。
  const tier =
    st.tier && TIER[st.tier]
      ? `<span class="who" style="--tc:${TIER[st.tier].c}" title="この手順の担当">` +
        `${TIER[st.tier].l.replace("・CSIRT", "")}</span>`
      : "";

  return (
    `<span class="num">${i + 1}</span>${tier}` +
    `<b>${esc(st.title)}</b><span class="tk">${esc(t?.label ?? "")}</span>` +
    (flags ? `<span class="flags">${flags}</span>` : "")
  );
}

/**
 * 指定した手順に繋がる線だけを強調する。
 * 線は描き直すたびに作り直されるので、描画のあとと、選択・ホバーのたびに呼ぶ。
 */
export function hotWires(ids: string[]): void {
  const wires = document.getElementById("cwires");
  if (!wires) return;

  wires.classList.toggle("focus", ids.length > 0);
  for (const p of wires.querySelectorAll<SVGPathElement>("path[data-a]")) {
    const on =
      ids.includes(p.dataset.a ?? "") || ids.includes(p.dataset.b ?? "");
    p.classList.toggle("hot", on);
    p.setAttribute("marker-end", `url(#${on ? "eah-hot" : "eah"})`);
  }
}

/** 角を丸めた折れ線を描く。 */
function ortho(pts: [number, number][], r: number): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const v1x = cx - px;
    const v1y = cy - py;
    const v2x = nx - cx;
    const v2y = ny - cy;
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L ${cx - (v1x / l1) * rr} ${cy - (v1y / l1) * rr}`;
    d += ` Q ${cx} ${cy} ${cx + (v2x / l2) * rr} ${cy + (v2y / l2) * rr}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/**
 * markerUnits の既定は strokeWidth なので、強調で線を太くすると矢印も膨らむ。
 * userSpaceOnUse にして、線の太さに関わらず同じ大きさにする。強調は色だけで足りる。
 */
const ARROW =
  ' viewBox="0 0 10 8" refX="9.5" refY="4" markerUnits="userSpaceOnUse"' +
  ' markerWidth="8" markerHeight="6.5" orient="auto"';

function paintWires(nodes: (Node | undefined)[], selected: string[]): void {
  const grid = $("cgrid");
  const wires = $("cwires");
  const box = grid.getBoundingClientRect();

  wires.setAttribute("viewBox", `0 0 ${grid.clientWidth} ${grid.clientHeight}`);

  const seq = nodes.filter((n): n is Node => !!n);
  if (seq.length < 2) {
    wires.innerHTML = "";
    grid.style.paddingBottom = "16px";
    setHint(0);
    return;
  }

  let maxBottom = 0;
  for (const n of seq) {
    maxBottom = Math.max(maxBottom, n.el.getBoundingClientRect().bottom - box.top);
  }

  /**
   * 同じ列の 2 つのボックスの間に、線を通せるすき間があればその y を返す。
   * 無ければ null（＝下へ迂回する）。書き出し HTML 側と同じ規則。
   */
  function gapLane(a: HTMLElement, b: HTMLElement): number | null {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.left - rb.left) > 2) return null;

    const up = ra.top < rb.top ? ra : rb;
    const low = ra.top < rb.top ? rb : ra;
    const gap = low.top - up.bottom;
    if (gap < 12) return null;

    const y = up.bottom + gap / 2 - box.top;
    for (const n of seq) {
      if (n.el === a || n.el === b) continue;
      const r = n.el.getBoundingClientRect();
      if (Math.abs(r.left - ra.left) > 2) continue;
      if (r.top - box.top < y && r.bottom - box.top > y) return null; // 他のボックスに当たる
    }
    return y;
  }

  let out =
    "<defs>" +
    `<marker id="eah"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    `<marker id="eah-hot"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    "</defs>";

  let back = 0;
  for (let k = 0; k < seq.length - 1; k++) {
    const ra = seq[k].el.getBoundingClientRect();
    const rb = seq[k + 1].el.getBoundingClientRect();
    const x1 = ra.right - box.left;
    const y1 = ra.top - box.top + ra.height / 2;
    const x2 = rb.left - box.left - 5;
    const y2 = rb.top - box.top + rb.height / 2;

    let d: string;
    if (x2 > x1 + 10) {
      // 素直に右へ進む。
      const dx = Math.max(24, (x2 - x1) * 0.45);
      d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    } else {
      // 戻る線。左右のレーンの内側に収める。外へ出すと切れる。
      const gx = Math.min(grid.clientWidth - 8, x1 + 18);
      const hx = Math.max(6, x2 - 18);
      const gy = gapLane(seq[k].el, seq[k + 1].el);
      if (gy !== null) {
        d = ortho([[x1, y1], [gx, y1], [gx, gy], [hx, gy], [hx, y2], [x2, y2]], 9);
      } else {
        const ch = maxBottom + 20 + back * 12;
        back++;
        d = ortho([[x1, y1], [gx, y1], [gx, ch], [hx, ch], [hx, y2], [x2, y2]], 10);
      }
    }

    // どの手順どうしを繋いだ線かを持たせておき、強調に使う。
    out +=
      `<path d="${d}" data-a="${esc(seq[k].id)}" data-b="${esc(seq[k + 1].id)}"` +
      ' marker-end="url(#eah)"/>';
  }

  wires.innerHTML = out;
  hotWires(selected);
  grid.style.paddingBottom = `${back ? 34 + back * 13 : 16}px`;
  wires.setAttribute("viewBox", `0 0 ${grid.clientWidth} ${grid.clientHeight}`);
  setHint(back);
}

/**
 * ここで数えているのは「下へ迂回した線」。
 * 検証の「前の段階への後戻り」とは別の指標なので、文言を分けてある。
 */
function setHint(back: number): void {
  const h = $("canvHint");
  h.textContent =
    back > 5
      ? `迂回する線が ${back} 本 — 並び順を見直してください`
      : "右のタスクパレットからドラッグして投入";
  h.style.color = back > 5 ? "var(--s2)" : "";
}

/** 選ばれているボックスが見えるところまでスクロールする。 */
export function scrollToSelected(): void {
  const el = document.querySelector(".cnode.sel");
  el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}
