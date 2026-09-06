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
import { layoutFlow } from "./layout";
import type { FlowLayout } from "./layout";
import { milestoneTag } from "./sla";
import type { Condition, DB, EventFlow, Lane, Step } from "./types";

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
  /** 移り先の札を押したとき。そのフローを開く。 */
  onGoto: (eventKey: string) => void;
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

  // 置き方は layout.ts が決める。分岐の枝は横に並び、同じ担当に 2 本以上
  // 並ぶときはその担当の列が割れる。書き出し HTML も同じ規則で描く。
  const L = layoutFlow(evt, lanes);
  grid.style.gridTemplateColumns = `repeat(${Math.max(L.cols, 1)}, minmax(160px, 1fr))`;

  // レーンの帯と見出し。割れた列ぶんをまたぐ。
  lanes.forEach((l, li) => {
    const span = L.need[l.key] ?? 1;
    const bg = document.createElement("div");
    bg.className = "clane" + (li === lanes.length - 1 ? " last" : "");
    bg.style.setProperty("--lc", l.color);
    bg.style.gridColumn = `${(L.base[l.key] ?? 0) + 1} / span ${span}`;
    // 1/-1 は使えない。-1 は「明示的に定義された行」の終端を指すが、
    // grid-template-rows を書いていないので全部が暗黙行になり、
    // 見出し行で止まってしまう。終端を数えて入れる。
    bg.style.gridRow = `1 / ${L.rows + 2}`;
    grid.appendChild(bg);

    const h = document.createElement("div");
    h.className = "clane-h";
    h.style.setProperty("--lc", l.color);
    h.style.gridColumn = `${(L.base[l.key] ?? 0) + 1} / span ${span}`;
    const n = evt.steps.filter((s) => s.lane === l.key).length;
    h.innerHTML = `${esc(l.name)}<u>${n || ""}</u>`;
    grid.appendChild(h);
  });

  // 分岐の帯。どこからどこまでが 1 つの分かれ道かを地色で示す。
  L.bands.forEach((b, bi) => {
    const band = document.createElement("div");
    band.className = "cband";
    // 落とし先の判定で「この帯はどの分かれ道か」を知るために持たせる。
    band.dataset.b = String(bi);
    band.dataset.k = b.key;
    band.style.gridColumn = `1 / span ${Math.max(L.cols, 1)}`;
    band.style.gridRow = `${b.from} / ${b.to + 1}`;
    grid.appendChild(band);
  });

  const nodes: (Node | undefined)[] = [];

  L.placed.forEach((p) => {
    const st = p.step;
    const i = p.index;
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
    el.style.gridColumn = `${p.col + 1} / span ${p.span}`;
    el.style.gridRow = String(p.row);
    // 落とし先の判定で「この箱は手順の何番目か」を知るために持たせる。
    // 枝を横に並べたので、置いた順と配列の順が一致しなくなった。
    el.dataset.i = String(i);
    // 枝の中のボックスは、どの帯のどの枝かも持つ。帯の中へ落としたときに
    // 「落とした列の枝に加わる」を決めるのに使う（dropSpotAt）。
    if (p.value !== undefined) {
      const c = { key: (st.conditions ?? [])[0]?.key ?? "", value: p.value };
      el.dataset.b = String(p.band ?? 0);
      el.dataset.bv = p.value;
      el.dataset.bl = optLabel(evt, c);
      el.dataset.bc = optColor(evt, c);
    }
    el.innerHTML = nodeHTML(db, evt, st, i, phase?.name ?? "", lanes[li]?.name ?? "", p.value);

    el.addEventListener("click", (e) => {
      const go = (e.target as HTMLElement | null)?.closest<HTMLElement>(".f-goto");
      if (go && !go.classList.contains("dead")) {
        e.stopPropagation();
        deps.onGoto(go.dataset.goto ?? "");
        return;
      }
      deps.onPick(st.id, e);
    });
    // 選ばなくても辿れるように、ホバー中はその手順に繋がる線だけを強調する。
    el.addEventListener("mouseenter", () => hotWires([st.id]));
    el.addEventListener("mouseleave", () => hotWires(deps.selected));

    // 掴んで動かせる。列が担当なので、1 回の操作で担当と順番の両方が決まる。
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", `step:${st.id}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      startCarry(e, el);
      // 枝の中の手順は、帯の外へ出すと枝から抜ける。運ぶ前に知らせられるよう、
      // いまどちらにいるかを持たせる。
      setDragLabel(st.title, (st.conditions ?? []).length > 0);
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
      chip.style.gridColumn = String((L.base[lane.key] ?? 0) + 1);
      chip.style.gridRow = String(p.row);
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
  requestAnimationFrame(() => paintWires(L, nodes, deps.selected));
}

/** ボックス 1 つの中身。 */
function nodeHTML(
  db: DB,
  evt: EventFlow,
  st: Step,
  i: number,
  phaseName: string,
  laneName: string,
  /** 分岐の中なら、どの答えの枝か。列の見出しではなくボックスに出す。 */
  value?: string,
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
  // 約束の到達点。判定はしない——「ここまでが約束の範囲」と示すだけ。
  flags += milestoneTag(db, evt, st);
  // 移り先。この経路はここで終わり、続きは相手のフロー。
  // 「終了」と並べても意味が競合しないので、消さずに両方出す。
  if (st.goto) {
    const to = evt.key === st.goto ? null : db.events.find((e) => e.key === st.goto);
    flags +=
      `<span class="f-goto${to ? "" : " dead"}" data-goto="${esc(st.goto)}"` +
      ` title="${esc(to ? `この手順のあと「${to.title}」へ移ります` : `移り先のフローが見つかりません: ${st.goto}`)}">` +
      `&#8594; ${esc(to ? to.title : "移り先が見つかりません")}</span>`;
  }

  const kind = taskOf(db, st.task)?.kind;
  if (kind === "close") {
    flags += '<span class="f-fin" title="この経路はここで終わります">終了</span>';
  } else if (kind === "wait") {
    flags +=
      '<span class="f-wait" title="自分たちの作業ではありません">待ち</span>';
  }

  // 分類（フェーズ・担当）は手順そのものの性質と別の行に置く。同じ行に並べると
  // 「! エスカレ ［Tier1］」が「Tier1 にエスカレする」と読み違えられる。
  // 枝の答え。どの分かれ道の、どちらに属する手順かをボックス自身に持たせる。
  // 列は担当のままなので、答えは列見出しでは示せない。
  let ans = "";
  if (value) {
    const key = (st.conditions ?? [])[0]?.key ?? "";
    const c = { key, value };
    ans = `<i class="ans" style="--bc:${optColor(evt, c)}">${esc(optLabel(evt, c))}</i>`;
  }

  const cls =
    ans +
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

function paintWires(
  L: FlowLayout,
  nodes: (Node | undefined)[],
  selected: string[],
): void {
  const grid = $("cgrid");
  const wires = $("cwires");
  const box = grid.getBoundingClientRect();
  // 拡大縮小しているときは、測った値が見かけの大きさになる。図の中の座標で
  // 引きたいので割り戻す。viewBox は組んだままの大きさ（clientWidth）なので、
  // これで縮尺を変えても線は引き直さなくてよい。
  const z = gridScale(grid);
  const gx = (v: number) => v / z;

  wires.setAttribute("viewBox", `0 0 ${grid.clientWidth} ${grid.clientHeight}`);

  let out =
    "<defs>" +
    `<marker id="eah"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    `<marker id="eah-hot"${ARROW}><path d="M0,0 L10,4 L0,8 z"/></marker>` +
    "</defs>";

  // 繋ぐ組は layout.ts が決める。分岐へ入るときは枝の数だけ分かれ、
  // 出るときは枝の数だけ戻る。
  for (const [from, to] of L.pairs) {
    const na = nodes[from.index];
    const nb = nodes[to.index];
    if (!na || !nb) continue;
    const ra = na.el.getBoundingClientRect();
    const rb = nb.el.getBoundingClientRect();
    // 規則: 下から出て、上から入る
    const ax = gx(ra.left - box.left + ra.width / 2);
    const ay = gx(ra.bottom - box.top);
    const bx = gx(rb.left - box.left + rb.width / 2);
    const by = gx(rb.top - box.top) - HEAD;

    let d: string;
    if (Math.abs(ax - bx) < 2) {
      d = `M ${ax} ${ay} L ${bx} ${by}`; // 同じ列。まっすぐ下へ
    } else {
      // 横へ移るのは行と行のあいだだけ。同じ帯に何本も入るときも高さを
      // 共有する——ずらすと線が何本にも見え、交差も増えた（モックで実測）。
      const my = (ay + by) / 2;
      d = ortho([[ax, ay], [ax, my], [bx, my], [bx, by]], 10);
    }

    // どの手順どうしを繋いだ線かを持たせておき、強調に使う。
    out +=
      `<path d="${d}" data-a="${esc(na.id)}" data-b="${esc(nb.id)}"` +
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
  setHint(L.placed.length);
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
  /**
   * 分岐の帯の中へ落としたときの、その枝の条件。帯の外なら無い。
   *
   * 「落とした列の枝に加わる」を、置く動作だけで表すためのもの。
   * これが無かった頃は、枝の中へ落としても条件の付かない手順が入り、
   * 帯が 2 つに割れていた（どちらの枝でも実施する、という別の意味になる）。
   */
  cond?: Condition;
  /** 落とし先の線を、枝の列の幅で引くための見かけの座標。 */
  cell?: { left: number; width: number; label: string; color: string };
  /**
   * 落とし先の線を引く見かけの高さ。枝の最後へ足すときだけ入る。
   *
   * 配列での位置は帯の次の手順を指すので、そのままだと線が帯の外に出る。
   * 入るのはその枝の続きなので、線はその枝の最後のボックスの下に引く。
   */
  atY?: number;
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
  /** 見かけの上から順。i は手順の配列での位置。 */
  nodes: { top: number; mid: number; bottom: number; i: number }[];
  /** 分岐の帯。落とした先がどの枝かを決めるのに使う。 */
  bands: DropBand[];
}

/** 分岐の帯ひとつぶんの寸法。 */
interface DropBand {
  /** その分かれ道の判断のキー。 */
  key: string;
  top: number;
  bottom: number;
  /**
   * 枝の列。1 つの枝が担当をまたげば、その枝の列は複数になる。
   * 枝どうしは列が飛び飛びに並ぶことがあるので、左端と右端では表せない。
   */
  cells: { value: string; label: string; color: string; left: number; right: number }[];
  /** 帯の中のボックス。枝ごとに縦位置で見る。 */
  nodes: { value: string; mid: number; i: number }[];
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

  const bands: DropBand[] = [];
  for (const el of grid.querySelectorAll<HTMLElement>(".cband")) {
    const r = el.getBoundingClientRect();
    bands[Number(el.dataset.b ?? 0)] = {
      key: el.dataset.k ?? "",
      top: r.top,
      bottom: r.bottom,
      cells: [],
      nodes: [],
    };
  }

  // ボックスは 1 回だけ測り、落とし先の並びと帯の中身の両方に使う。
  // 測る回数が増えると、そのぶん指の動きが遅れる（ここは 1 回 3ms かかっていた）。
  const nodes: DropGeom["nodes"] = [];
  for (const el of grid.querySelectorAll<HTMLElement>(".cnode")) {
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const i = Number(el.dataset.i ?? 0);
    nodes.push({ top: r.top, mid, bottom: r.bottom, i });

    const value = el.dataset.bv;
    const band = value === undefined ? undefined : bands[Number(el.dataset.b ?? 0)];
    if (!band || value === undefined) continue;
    band.nodes.push({ value, mid, i });
    // 同じ枝の同じ列は 1 つでよい。列は行ごとにずれないので、左端で見分ける。
    if (!band.cells.some((c) => c.value === value && c.left === r.left)) {
      band.cells.push({
        value,
        label: el.dataset.bl ?? value,
        color: el.dataset.bc ?? "var(--cur)",
        left: r.left,
        right: r.right,
      });
    }
  }
  for (const b of bands) b?.nodes.sort((a, z) => a.mid - z.mid);

  geom = {
    box: grid.getBoundingClientRect(),
    z: gridScale(grid),
    lanes: [...grid.querySelectorAll<HTMLElement>(".clane")].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    }),
    // 枝を横に並べたので、置いた順は配列の順ではない。落とし先は「見かけの
    // 上から何番目か」で決めるので、測ったあとに縦位置で並べ直す。
    nodes: nodes.sort((a, b) => a.top - b.top),
    bands: bands.filter(Boolean),
  };
  return geom;
}

export function dropSpotAt(lanes: Lane[], x: number, y: number): DropSpot | null {
  const grid = document.getElementById("cgrid");
  if (!grid) return null;
  const g = dropGeom(grid);

  const li = g.lanes.findIndex((l) => x >= l.left && x < l.right);
  if (li < 0 || !lanes[li]) return null;
  const lane = lanes[li].key;

  // 分かれ道の帯の中なら、落とした列の枝に加わる。縦の位置はその枝の中での順。
  // 枝をまたいで数えると、短い枝の下へ落としたときに、隣の長い枝の途中の
  // 位置が返ってしまう。
  const band = g.bands.find((b) => y >= b.top && y < b.bottom);
  const cell = band ? nearestCell(band, x) : undefined;
  if (band && cell) {
    const mine = band.nodes.filter((n) => n.value === cell.value);
    const last = mine[mine.length - 1];
    let index = (last?.i ?? 0) + 1;
    let atY: number | undefined = last ? bottomOf(g, last.i) : undefined;
    for (const n of mine) {
      if (y < n.mid) {
        index = n.i;
        atY = undefined;
        break;
      }
    }
    return {
      lane,
      index,
      atY,
      cond: { key: band.key, value: cell.value },
      cell: {
        left: cell.left,
        width: cell.right - cell.left,
        label: cell.label,
        color: cell.color,
      },
    };
  }

  // 帯の外。上から順に見て、最初に「その箱の真ん中より上」になったところへ入れる。
  // 入れる位置は配列での位置で返す（枝を横に並べたので、見かけの順とは違う）。
  let index = g.nodes.length;
  for (const n of g.nodes) {
    if (y < n.mid) {
      index = n.i;
      break;
    }
  }
  return { lane, index };
}

/** 測り置きの中から、その手順のボックスの下端を引く。 */
function bottomOf(g: DropGeom, i: number): number | undefined {
  return g.nodes.find((n) => n.i === i)?.bottom;
}

/**
 * 指の位置にいちばん近い枝の列。列の中なら 0、隙間なら近いほうへ寄せる。
 *
 * 列と列のあいだ、また枝が使っていない担当の列にも落とせる。そこで「どれでもない」
 * を返すと、帯の中に条件の付かない手順が入って帯が割れる——落とした人から見れば
 * 何も起きていないのに図の意味が変わる。近いほうへ寄せて、線でそれを見せる。
 */
function nearestCell(band: DropBand, x: number): DropBand["cells"][number] | undefined {
  let best: DropBand["cells"][number] | undefined;
  let near = Infinity;
  for (const c of band.cells) {
    const d = x < c.left ? c.left - x : x > c.right ? x - c.right : 0;
    if (d < near) {
      near = d;
      best = c;
    }
  }
  return best;
}

/**
 * いま運んでいるものの名前。
 *
 * 落とし先の線に書き出す。運んでいる絵は OS が描くので、こちらからは
 * 濃さを保証できない（暗い画面でほとんど見えないという指摘があった）。
 * 何を運んでいるかは、こちらが描く線の側にも書いておく。
 */
let dragLabel = "";
/** 運んでいるものが、いま分かれ道の枝の中にあるか。 */
let dragBranched = false;

export function setDragLabel(text: string, branched = false): void {
  dragLabel = text;
  dragBranched = branched;
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
  const key = spot ? `${spot.lane}:${spot.index}:${spot.cond?.value ?? ""}` : "";
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
    grid.appendChild(line);
  }
  // 落とすと条件が変わるなら、そう言う。置いてから図が変わって気づく、では
  // 遅い。落とし先が変わったときだけ書き換える。
  const note = spot.cell
    ? `${spot.cell.label} の枝に入ります`
    : dragBranched
      ? "分かれ道から外れます"
      : "";
  line.innerHTML =
    (dragLabel ? `<b>${esc(dragLabel)}</b>` : "") +
    (note ? `<u>${esc(note)}</u>` : "");
  line.style.setProperty("--brc", spot.cell?.color ?? "var(--s2)");
  line.classList.toggle("br", !!note);

  const g = dropGeom(grid);
  // 線は図の中に置くので、測った見かけの値を縮尺で割り戻す（paintWires と同じ）。
  const gx = (v: number) => v / g.z;
  // 線を引く高さは、入れる位置の箱の上端。配列での位置から、測り置きの中の
  // その箱を引く（並べ直してあるので添字では引けない）。
  const at = g.nodes.findIndex((n) => n.i === spot.index);
  const target = at >= 0 ? g.nodes[at] : undefined;
  const prev = at > 0 ? g.nodes[at - 1] : g.nodes[g.nodes.length - 1];
  // 入る位置の上の境目。末尾なら最後のボックスの下。
  // 枝の続きに足すときは、配列の位置ではなくその枝の最後の下に引く（atY）。
  const y =
    spot.atY !== undefined
      ? gx(spot.atY - g.box.top) + 9
      : target
        ? gx(target.top - g.box.top) - 9
        : prev
          ? gx(prev.bottom - g.box.top) + 9
          : 44;

  // 枝の中なら、線はその枝の列の幅で引く。担当の列いっぱいに引くと、
  // 枝が 2 本並んでいるときにどちらへ入るのか線から読めない。
  const li = lanes.findIndex((l) => l.key === spot.lane);
  const lr = spot.cell ?? g.lanes[li];
  line.style.top = `${y}px`;
  line.style.left = lr ? `${gx(lr.left - g.box.left) + 10}px` : "10px";
  line.style.width = lr ? `${gx(lr.width) - 20}px` : "100%";
}
