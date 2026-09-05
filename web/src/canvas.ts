/**
 * フローキャンバス。列は担当（レーン）、行は手順の順番。
 *
 * フェーズは列にしない。フェーズを列にすると、受信の直後に報告へ飛ぶようなフローで
 * 線が端から端まで伸び、そこからまた戻ってくる。「フェーズは時間とともに一方向へ
 * 進む」という前提が、実際の対応では成り立たないため。
 * 実データで測ると、フェーズを軸にした線は最大 4 列ぶん動くのに対し、担当を軸に
 * すると全 54 本が隣の列までに収まった。受け渡しは Tier1 と Tier2、Tier2 と
 * CSIRT のように、隣り合う責任範囲の間でしか起きないからである。
 *
 * 行が実施順そのものなので、手順の流れを表す線は必ず下へ進み、決して戻らない。
 * 線 i は行 i と行 i+1 のあいだの帯しか通らないので、2 本の線が同じ帯を
 * 共有することがなく、交差は起こり得ない。迂回路の計算は要らない。
 *
 * 線は DOM を実際に測ってから引く。文字の長さも折り返しも先には分からないので、
 * ボックスを置き、次のフレームで測って線を引く。
 *
 * 描き方の規則は書き出し HTML 側（internal/export/viewer.js）と揃える。
 */

import { condSentence, optColor, optLabel } from "./branch";
import { $, dimSource, endCarry, esc, startCarry, undimSource } from "./dom";
import { groupVias, stepContacts, viaMark } from "./contacts";
import { eventLanes, taskOf } from "./flow";
import type { DB, EventFlow, Lane, Step } from "./types";

/** 測るために覚えておく、手順とその要素の対応。手順の順に並ぶ。 */
interface Node {
  el: HTMLElement;
  id: string;
}

/** 連絡の矢印の行き先に置く札。 */
interface Chip {
  /** 何番目の手順から出るか。 */
  i: number;
  el: HTMLElement;
  color: string;
}

export interface CanvasDeps {
  db: DB;
  evt: EventFlow;
  /** 選ばれている手順 ID。 */
  selected: string[];
  onPick: (id: string, e: MouseEvent) => void;
}

let chips: Chip[] = [];

// ---------------------------------------------------------------------------
// 拡大縮小
// ---------------------------------------------------------------------------

/**
 * 図の縮尺。
 *
 * 手順が 17 も並ぶと全体が一度に見えない。読むためではなく、
 * **形を見るため**の縮小が要る（どこで担当が移り、どこで分かれるか）。
 *
 * CSS の zoom で掛ける。transform:scale だと列見出しの position:sticky が
 * 縮尺ぶんずれ、送るほどずれが増えて最後は見出しが画面から出ていく
 * （実測: 110% で 400px 送って 40px）。zoom は組み直しを伴うので、
 * 見出しはそのまま効く。縮めると列が広くなり題名の折り返しが減るが、
 * 全体を見るための縮小なので、これはむしろ都合がよい。
 *
 * 組み直しが起きるということは、縮尺を変えたら線を引き直す必要がある。
 * 呼んだ側が描き直す（screens/edit.ts の bindZoom）。
 *
 * 縮尺は端末ごとの好みなので localStorage に置く（ペインの幅と同じ扱い）。
 */
const ZOOM_KEY = "soc-flow-zoom";
const ZOOM_STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
let zoom = loadZoom();

function loadZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(n) ? n : 100;
  } catch {
    return 100;
  }
}

/** いまの縮尺（％）。 */
export function zoomPercent(): number {
  return zoom;
}

/** 縮尺を決める。段階に無い値は、いちばん近い段階へ寄せる。 */
export function setZoom(percent: number): void {
  zoom = ZOOM_STEPS.reduce((a, b) =>
    Math.abs(b - percent) < Math.abs(a - percent) ? b : a,
  );
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    /* 保存できなくても表示は変えられる */
  }
  applyZoom();
}

/** 1 段階ずらす。dir は +1 で拡大、-1 で縮小。 */
export function stepZoom(dir: 1 | -1): void {
  const i = ZOOM_STEPS.indexOf(zoom);
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  if (next !== zoom) setZoom(next);
}

/** いまの縮尺を図に反映する。描き直しのたびに呼ぶ。 */
export function applyZoom(): void {
  const grid = document.getElementById("cgrid");
  if (grid) grid.style.setProperty("--z", String(zoom / 100));
  const label = document.getElementById("zNow");
  if (label) label.textContent = `${zoom}%`;
  const out = document.getElementById("zOut") as HTMLButtonElement | null;
  const inn = document.getElementById("zIn") as HTMLButtonElement | null;
  if (out) out.disabled = zoom === ZOOM_STEPS[0];
  if (inn) inn.disabled = zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/**
 * 図が実際に何倍で出ているか。
 *
 * 線も落とし先の線も、図の中の座標で引く。measure したものは画面の見かけの
 * 大きさなので、縮尺で割って図の中の値に戻す。縮尺を引数で持ち回らずに
 * ここで測るのは、CSS 側だけで縮尺を変えても座標が狂わないようにするため。
 */
function gridScale(grid: HTMLElement): number {
  const w = grid.offsetWidth;
  if (!w) return 1;
  return grid.getBoundingClientRect().width / w || 1;
}

export function renderCanvas(deps: CanvasDeps): void {
  const { db, evt } = deps;
  const grid = $("cgrid");
  const wires = $("cwires");

  grid.innerHTML = "";
  chips = [];
  clearDropGeometry(); // 置き直したので、測り置きは捨てる
  applyZoom();
  const lanes = eventLanes(db, evt);
  grid.style.gridTemplateColumns = `repeat(${Math.max(lanes.length, 1)}, minmax(160px, 1fr))`;

  // レーンの帯と見出し。全行にまたがる。
  lanes.forEach((l, li) => {
    const bg = document.createElement("div");
    bg.className = "clane" + (li === lanes.length - 1 ? " last" : "");
    bg.style.setProperty("--lc", l.color);
    bg.style.gridColumn = String(li + 1);
    // 1/-1 は使えない。-1 は「明示的に定義された行」の終端を指すが、
    // grid-template-rows を書いていないので全部が暗黙行になり、
    // 見出し行で止まってしまう。終端を数えて入れる。
    bg.style.gridRow = `1 / ${evt.steps.length + 2}`;
    grid.appendChild(bg);

    const h = document.createElement("div");
    h.className = "clane-h";
    h.style.setProperty("--lc", l.color);
    h.style.gridColumn = String(li + 1);
    const n = evt.steps.filter((s) => s.lane === l.key).length;
    h.innerHTML = `${esc(l.name)}<u>${n || ""}</u>`;
    grid.appendChild(h);
  });

  const nodes: (Node | undefined)[] = [];

  evt.steps.forEach((st, i) => {
    const li = Math.max(0, lanes.findIndex((l) => l.key === st.lane));
    const t = taskOf(db, st.task);
    const phase = db.phases.find((p) => p.key === t?.phase);

    const el = document.createElement("div");
    el.className =
      "cnode" +
      (deps.selected.includes(st.id) ? " sel" : "") +
      (t?.kind === "close" ? " close" : "") +
      (t?.kind === "wait" ? " wait" : "");
    el.style.setProperty("--pc", phase?.color ?? "var(--line)");
    el.style.setProperty("--lc", lanes[li]?.color ?? "var(--line)");
    el.style.gridColumn = String(li + 1);
    el.style.gridRow = String(i + 2);
    el.innerHTML = nodeHTML(db, evt, st, i, phase?.name ?? "", lanes[li]?.name ?? "");

    el.addEventListener("click", (e) => deps.onPick(st.id, e));
    // 選ばなくても辿れるように、ホバー中はその手順に繋がる線だけを強調する。
    el.addEventListener("mouseenter", () => hotWires([st.id]));
    el.addEventListener("mouseleave", () => hotWires(deps.selected));

    // 掴んで動かせる。列が担当なので、1 回の操作で担当と順番の両方が決まる。
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", `step:${st.id}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      startCarry(e, el);
      setDragLabel(st.title);
      dimSource(el);
      document.body.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      undimSource(el);
      endCarry();
      setDragLabel("");
      document.body.classList.remove("dragging");
    });

    grid.appendChild(el);
    nodes[i] = { el, id: st.id };

    // 連絡の行き先。エスカレーションも顧客連絡も同じ 1 つの規則で描ける。
    // レーンが設定されていない連絡先（管理職など）には矢印を出さない。
    const byLane = new Map<string, string[]>();
    for (const g of stepContacts(db, st)) {
      if (!g.lane || g.lane === st.lane) continue;
      if (!lanes.some((l) => l.key === g.lane)) continue;
      byLane.set(g.lane, [...(byLane.get(g.lane) ?? []), g.name]);
    }
    for (const [laneKey, names] of byLane) {
      const lane = lanes.find((l) => l.key === laneKey)!;
      const chip = document.createElement("div");
      chip.className = "cct";
      chip.style.setProperty("--lc", lane.color);
      chip.style.gridColumn = String(lanes.indexOf(lane) + 1);
      chip.style.gridRow = String(i + 2);
      chip.innerHTML = names.map((n) => esc(n)).join("<br>");
      chip.title = `${st.title} → ${names.join("、")}`;
      grid.appendChild(chip);
      chips.push({ i, el: chip, color: lane.color });
    }
  });

  if (!evt.steps.length) {
    const empty = document.createElement("div");
    empty.className = "cempty";
    empty.style.gridColumn = `1 / -1`;
    empty.innerHTML =
      "<b>まだ手順がありません</b>右の「対応パレット」タブからドラッグしてください。<br>" +
      "担当の列への配置と接続線は自動で決まります。";
    grid.appendChild(empty);
  }

  grid.appendChild(wires);

  // 置いてもらってから測る。
  requestAnimationFrame(() => paintWires(nodes, deps.selected));
}

/** ボックス 1 つの中身。 */
function nodeHTML(
  db: DB,
  evt: EventFlow,
  st: Step,
  i: number,
  phaseName: string,
  laneName: string,
): string {
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
    flags += '<span class="f-esc" title="エスカレーション判断">エスカレ</span>';
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
        return `<i${d.ico ? ' class="ico"' : ""} style="--vc:${d.c}">${viaMark(d)}</i>`;
      })
      .join("");
    flags += `<span class="f-ct" title="${esc(tip.join("\n"))}">${marks}</span>`;
  }

  if (st.sla) flags += `<span class="f-sla">${esc(st.sla)}</span>`;
  const kind = taskOf(db, st.task)?.kind;
  if (kind === "close") {
    flags += '<span class="f-fin" title="この経路はここで終わります">終了</span>';
  } else if (kind === "wait") {
    flags +=
      '<span class="f-wait" title="自分たちの作業ではありません">待ち</span>';
  }

  // 分類（フェーズ・担当）は手順そのものの性質と別の行に置く。同じ行に並べると
  // 「! エスカレ ［Tier1］」が「Tier1 にエスカレする」と読み違えられる。
  const cls =
    (phaseName ? `<i class="ph">${esc(phaseName)}</i>` : "") +
    (laneName ? `<i class="who">${esc(laneName)}</i>` : "");

  // 対応の補足。「どこを見るか」の手がかりで、深夜の現場で効く。
  // 書き出し HTML のボックスにはずっと出ていたのに、こちらには無かった。
  // 同じ図が 2 か所で違って見えるのを避ける。
  const note = taskOf(db, st.task)?.note ?? "";

  return (
    `<span class="num">${i + 1}</span>` +
    (cls ? `<span class="cls">${cls}</span>` : "") +
    `<b>${esc(st.title)}</b>` +
    (note ? `<span class="t">${esc(note)}</span>` : "") +
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
    const on = ids.includes(p.dataset.a ?? "") || ids.includes(p.dataset.b ?? "");
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

const HEAD = 7; // 矢印の長さ。線の終点をこのぶん手前で止める

function paintWires(nodes: (Node | undefined)[], selected: string[]): void {
  const grid = $("cgrid");
  const wires = $("cwires");
  const box = grid.getBoundingClientRect();
  // 拡大縮小しているときは、測った値が見かけの大きさになる。図の中の座標で
  // 引きたいので割り戻す。viewBox は組んだままの大きさ（clientWidth）なので、
  // これで縮尺を変えても線は引き直さなくてよい。
  const z = gridScale(grid);
  const gx = (v: number) => v / z;

  wires.setAttribute("viewBox", `0 0 ${grid.clientWidth} ${grid.clientHeight}`);

  const seq = nodes.filter((n): n is Node => !!n);
  let out =
    "<defs>" +
    `<marker id="eah"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    `<marker id="eah-hot"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    "</defs>";

  for (let k = 0; k < seq.length - 1; k++) {
    const ra = seq[k].el.getBoundingClientRect();
    const rb = seq[k + 1].el.getBoundingClientRect();
    // 規則: 下から出て、上から入る
    const ax = gx(ra.left - box.left + ra.width / 2);
    const ay = gx(ra.bottom - box.top);
    const bx = gx(rb.left - box.left + rb.width / 2);
    const by = gx(rb.top - box.top) - HEAD;

    let d: string;
    if (Math.abs(ax - bx) < 2) {
      d = `M ${ax} ${ay} L ${bx} ${by}`; // 同じ列。まっすぐ下へ
    } else {
      const my = (ay + by) / 2; // 横へ移るのは行と行のあいだだけ
      d = ortho([[ax, ay], [ax, my], [bx, my], [bx, by]], 10);
    }

    // どの手順どうしを繋いだ線かを持たせておき、強調に使う。
    out +=
      `<path d="${d}" data-a="${esc(seq[k].id)}" data-b="${esc(seq[k + 1].id)}"` +
      ' marker-end="url(#eah)"/>';
  }

  // 連絡の矢印。手順の座っている行の中を横切るだけなので、
  // 行と行のあいだを通る手順の線とはぶつからない。
  for (const c of chips) {
    const src = nodes[c.i];
    if (!src) continue;
    const ra = src.el.getBoundingClientRect();
    const rc = c.el.getBoundingClientRect();
    const y = gx(ra.top - box.top + ra.height / 2);
    const right = rc.left > ra.left;
    const x1 = gx((right ? ra.right : ra.left) - box.left);
    const x2 = gx((right ? rc.left : rc.right) - box.left) + (right ? -3 : 3);
    const dir = right ? 1 : -1;
    out +=
      `<path class="ca" d="M ${x1} ${y} L ${x2} ${y}" style="stroke:${c.color}"/>` +
      `<polygon class="ca" points="${x2 - 6 * dir},${y - 4} ${x2 - 6 * dir},${y + 4} ${x2},${y}"` +
      ` style="fill:${c.color}"/>`;
  }

  wires.innerHTML = out;
  hotWires(selected);
  setHint(seq.length);
}

/**
 * 受け渡しの回数を出す。
 *
 * 図の見た目の指標ではない。受け渡しは 1 回ごとにボールが落ちうる場所なので、
 * 回数が多いフローは図が読みにくいのではなく運用が危ない。
 */
function setHint(steps: number): void {
  const h = $("canvHint");
  h.textContent =
    steps < 2
      ? "右の対応パレットからドラッグして投入"
      : `${steps} 手順`;
  h.style.color = "";
}

/** 選ばれているボックスが見えるところまでスクロールする。 */
export function scrollToSelected(): void {
  const el = document.querySelector(".cnode.sel");
  el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

// ---------------------------------------------------------------------------
// パレットからの投入
// ---------------------------------------------------------------------------

/** 落とす先。どの担当の、何番目に入るか。 */
export interface DropSpot {
  lane: string;
  index: number;
}

/**
 * ドラッグ中の座標から、落とし先を決める。
 *
 * 列が担当になったので、どの列に落としたかがそのまま「誰がやるか」になる。
 * 縦の位置は挿入位置。行が実施順そのものなので、境目に落とせば順番も決まる。
 *
 * レーンの帯は db.lanes の順に並べているので、何番目かがそのまま担当を指す。
 */
/**
 * ドラッグ中に何度も要る寸法を、1 回だけ測って持っておく。
 *
 * dragover は指を動かしているあいだ毎フレーム上がってくる。そのたびに
 * 列 4 つとボックス 17 個を測り直していたので、1 回 3ms かかっていた
 * （実測）。フレームの 2 割を測り直しに使っていたことになり、
 * 「少しブレる」という手触りになっていた。
 *
 * ドラッグ中に図の配置は変わらない。変わるのはキャンバスの送り位置だけ
 * （端まで運ぶと自動で送られる）なので、送り位置が変わったときだけ測り直す。
 * 図を描き直したときは renderCanvas が捨てる。
 */
interface DropGeom {
  box: DOMRect;
  /** 図の縮尺。ここでも測り置きにする（下記のとおり、読むと計算が走るため）。 */
  z: number;
  lanes: { left: number; right: number; width: number }[];
  nodes: { top: number; mid: number; bottom: number }[];
}

let geom: DropGeom | null = null;

/** 測り直しが要ることを伝える。図を描き直したときと、送ったときに呼ぶ。 */
export function clearDropGeometry(): void {
  geom = null;
  lastSpot = " ";
}

function dropGeom(grid: HTMLElement): DropGeom {
  if (geom) return geom;

  // 送られたら測り直す。毎回 scrollTop を読んで比べる形にしていたら、
  // 直前に書いた内容のせいで**読むたびに配置の計算が走り**、かえって
  // 重くなっていた（落とし先が動くとき 1 回 6.3ms）。読まずに、
  // 送られたことを知らせてもらう。
  grid.parentElement?.addEventListener("scroll", clearDropGeometry, {
    once: true,
    passive: true,
  });

  geom = {
    box: grid.getBoundingClientRect(),
    z: gridScale(grid),
    lanes: [...grid.querySelectorAll<HTMLElement>(".clane")].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    }),
    nodes: [...grid.querySelectorAll<HTMLElement>(".cnode")].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, mid: r.top + r.height / 2, bottom: r.bottom };
    }),
  };
  return geom;
}

export function dropSpotAt(lanes: Lane[], x: number, y: number): DropSpot | null {
  const grid = document.getElementById("cgrid");
  if (!grid) return null;
  const g = dropGeom(grid);

  const li = g.lanes.findIndex((l) => x >= l.left && x < l.right);
  if (li < 0 || !lanes[li]) return null;

  // 手順の順に並んだボックスの、上下どちら側に落ちたかで挿入位置を決める。
  let index = g.nodes.length;
  for (let i = 0; i < g.nodes.length; i++) {
    if (y < g.nodes[i].mid) {
      index = i;
      break;
    }
  }
  return { lane: lanes[li].key, index };
}

/**
 * いま運んでいるものの名前。
 *
 * 落とし先の線に書き出す。運んでいる絵は OS が描くので、こちらからは
 * 濃さを保証できない（暗い画面でほとんど見えないという指摘があった）。
 * 何を運んでいるかは、こちらが描く線の側にも書いておく。
 */
let dragLabel = "";

export function setDragLabel(text: string): void {
  dragLabel = text;
}

// ---------------------------------------------------------------------------
// 端まで運んだときの送り
// ---------------------------------------------------------------------------

/**
 * 掴んだまま端へ寄せると、図が送られる。
 *
 * 17 手順のフローでも、下のほうへ運ぶには一度置いてから送り直すしかなかった。
 * 掴んでいるあいだブラウザは自分で送ってくれないので、こちらで送る。
 *
 * 速さは端に近いほど速くする。一定だと、少し送りたいときに行き過ぎる。
 * 指を止めていても送り続ける——端に寄せたまま待つ、という操作がしたいので。
 * dragover は動かしているあいだしか来ないため、送りは別の輪で回す。
 */
const EDGE = 56; // 端とみなす幅
const MAX_STEP = 18; // 1 フレームに送る最大の量

let scrollLoop = 0;
let vx = 0;
let vy = 0;

/** 指の位置から送る速さを決める。キャンバスの上で dragover のたびに呼ぶ。 */
export function edgeScroll(x: number, y: number): void {
  const view = document.getElementById("canvas");
  if (!view) return;
  const r = view.getBoundingClientRect();
  vx = speed(x - r.left, r.right - x);
  vy = speed(y - r.top, r.bottom - y);

  if (!vx && !vy) return;
  if (scrollLoop) return;
  // 落とさずに掴んだまま外へ出ることもあるので、dragend でも必ず止める。
  document.addEventListener("dragend", stopEdgeScroll, { once: true });
  scrollLoop = requestAnimationFrame(stepScroll);
}

export function stopEdgeScroll(): void {
  if (scrollLoop) cancelAnimationFrame(scrollLoop);
  scrollLoop = 0;
  vx = 0;
  vy = 0;
}

/** 端からの距離を、送る量に変える。手前が端なら戻る向き、奥が端なら進む向き。 */
function speed(near: number, far: number): number {
  if (near < EDGE) return -Math.ceil(((EDGE - Math.max(near, 0)) / EDGE) * MAX_STEP);
  if (far < EDGE) return Math.ceil(((EDGE - Math.max(far, 0)) / EDGE) * MAX_STEP);
  return 0;
}

function stepScroll(): void {
  const view = document.getElementById("canvas");
  if (!view || (!vx && !vy)) {
    stopEdgeScroll();
    return;
  }
  view.scrollTop += vy;
  view.scrollLeft += vx;
  // 送ったぶん座標が変わる。scroll の知らせを待たず、自分で捨てる。
  // 送ったのは自分なので、他人から知らせてもらう筋合いがない。
  clearDropGeometry();
  scrollLoop = requestAnimationFrame(stepScroll);
}

/** 直前に示した落とし先。同じところなら画面を触らない。 */
let lastSpot = " ";

/**
 * 落とし先を画面に示す。列を光らせ、入る位置に線を引く。
 *
 * 落とし先が変わっていないあいだは何もしない。指を少し動かしただけで
 * 同じ場所に同じものを書き直すと、そのぶん描き直しが起きる。
 */
export function showDropSpot(lanes: Lane[], spot: DropSpot | null): void {
  const key = spot ? `${spot.lane}:${spot.index}` : "";
  if (key === lastSpot) return;
  lastSpot = key;

  const grid = document.getElementById("cgrid");
  if (!grid) return;

  const cols = [...grid.querySelectorAll<HTMLElement>(".clane")];
  cols.forEach((el, i) => {
    el.classList.toggle("drop", !!spot && lanes[i]?.key === spot.lane);
  });

  let line = grid.querySelector<HTMLElement>(".cdrop");
  if (!spot) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement("div");
    line.className = "cdrop";
    // 名前は運んでいるあいだ変わらないので、線を作るときに 1 度だけ入れる。
    line.innerHTML = dragLabel ? `<b>${esc(dragLabel)}</b>` : "";
    grid.appendChild(line);
  }

  const g = dropGeom(grid);
  // 線は図の中に置くので、測った見かけの値を縮尺で割り戻す（paintWires と同じ）。
  const gx = (v: number) => v / g.z;
  const target = g.nodes[spot.index];
  const prev = g.nodes[spot.index - 1];
  // 入る位置の上の境目。末尾なら最後のボックスの下。
  const y = target
    ? gx(target.top - g.box.top) - 9
    : prev
      ? gx(prev.bottom - g.box.top) + 9
      : 44;

  const li = lanes.findIndex((l) => l.key === spot.lane);
  const lr = g.lanes[li];
  line.style.top = `${y}px`;
  line.style.left = lr ? `${gx(lr.left - g.box.left) + 10}px` : "10px";
  line.style.width = lr ? `${gx(lr.width) - 20}px` : "100%";
}
