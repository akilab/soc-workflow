/** DOM を扱う小さな道具。モックで使っていた書き方をそのまま持ってきている。 */

/** id で引く。無ければ例外。取り違えを黙って進めない。 */
export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el;
}

/** id で引いて型を絞る。 */
export function $as<T extends HTMLElement>(id: string): T {
  return $(id) as T;
}

/**
 * HTML に埋め込む文字列を安全にする。
 *
 * 画面はテンプレート文字列で組み立てているので、
 * 利用者が書いた文字（手順名・詳細・連絡先）は必ずここを通す。
 */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 要素を作る。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** 子孫を全部消す。innerHTML = "" より意図がはっきりする。 */
export function clear(node: HTMLElement): void {
  node.textContent = "";
}

/**
 * クリックを親側で受け取る。
 *
 * 一覧のカードは描き直すたびに作り直されるので、1 枚ずつに登録すると
 * 付け外しの管理が要る。親で受けて data-a を見る形にすれば、その必要がない。
 */
export function onAction(
  root: HTMLElement,
  handler: (action: string, target: HTMLElement, ev: MouseEvent) => void,
): void {
  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    const hit = t.closest<HTMLElement>("[data-a]");
    if (!hit || !root.contains(hit)) return;
    handler(hit.dataset.a ?? "", hit, ev);
  });
}

/**
 * 掴んでいる元の札に「運んでいる最中」の印を付ける。
 *
 * ブラウザは dragstart の処理が終わった時点の見た目を写して、それを
 * カーソルに付いてくる絵にする。だから dragstart の中で先に薄くすると、
 * **運んでいる絵まで薄くなる**。実際、対応パレットの札を掴むと
 * 「見えるか見えないか」になっていた（利用者の指摘）。
 *
 * 1 拍おいてから付ければ、絵は元の濃さのまま写り、置いてきた元の札だけが
 * 薄くなる。掴んだ直後に取り消された場合に備えて、dragend 側（undimSource）
 * が先に走ったときは付けない。
 */
export function dimSource(el: HTMLElement): void {
  el.dataset.dragging = "1";
  setTimeout(() => {
    if (el.dataset.dragging) el.classList.add("drag");
  }, 0);
}

export function undimSource(el: HTMLElement): void {
  delete el.dataset.dragging;
  el.classList.remove("drag");
}

/**
 * 運んでいるものを、こちらで描いて持ち回る。
 *
 * ブラウザに絵を渡す仕組み（setDragImage）は使わない。**渡した絵は
 * 必ず薄く合成される**（Chromium は一律に 0.75 を掛ける）ので、こちらから
 * 透過を無くすことができない。実際、濃い地・太い枠・影を足しても
 * 「まだ見にくい」という指摘が続いた。
 *
 * そこで、ブラウザには透明な 1x1 の絵を渡して既定の絵を消し、掴んだ要素の
 * 複製を自分で置いて、指の動きに合わせて動かす。これなら透過は無い。
 *
 * 位置は dragover から取る。dragover は落とせる場所かどうかに関わらず
 * 上がってくるので、画面のどこを通っても追いかけられる。
 */

/** 既定の絵を消すための、透明な 1x1。読み込みは起動時に済ませておく。 */
const BLANK = new Image();
BLANK.src =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
// 読み込みが済んでいない絵を渡すと、ブラウザは既定の絵に戻してしまう。
// data: なのですぐ済むが、起動時に確実に済ませておく。
void BLANK.decode?.().catch(() => {});

let carried: HTMLElement | null = null;
let grabX = 0;
let grabY = 0;

export function startCarry(e: DragEvent, el: HTMLElement): void {
  if (!e.dataTransfer) return;
  const box = el.getBoundingClientRect();
  // 掴んだ場所を覚えておく。札の摘まんだところが指に付いてくる。
  grabX = e.clientX - box.left;
  grabY = e.clientY - box.top;

  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("dragghost");
  ghost.classList.remove("drag");
  // 元の札は伸び縮みする箱の中にいるので、複製にも同じ大きさを持たせる。
  ghost.style.width = `${Math.round(box.width)}px`;
  moveCarry(ghost, e.clientX, e.clientY);
  document.body.appendChild(ghost);
  carried = ghost;

  try {
    e.dataTransfer.setDragImage(BLANK, 0, 0);
  } catch {
    // 消せない環境では、ブラウザ既定の絵と重なる。二重に見えるより
    // 見えないほうが困るので、そのまま両方出しておく。
  }
  document.addEventListener("dragover", follow, true);
}

export function endCarry(): void {
  document.removeEventListener("dragover", follow, true);
  carried?.remove();
  carried = null;
}

function follow(e: DragEvent): void {
  if (carried) moveCarry(carried, e.clientX, e.clientY);
}

function moveCarry(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate(${Math.round(x - grabX)}px, ${Math.round(y - grabY)}px)`;
}
