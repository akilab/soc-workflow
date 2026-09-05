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
 * 運んでいる絵を、こちらで作って渡す。
 *
 * 何も渡さないと、ブラウザは掴んだ要素をそのまま写して絵にする。この絵は
 * OS 側で薄く合成されるので、暗い画面ではほとんど見えなかった（利用者の指摘）。
 *
 * 別の札を組み立てて渡してみたが、それだと**運んでいるものが元の姿と
 * 別物になる**という指摘をもらった。掴んだものがそのまま付いてくるのが
 * 正しいので、いまは掴んだ要素の複製を渡している。見た目はそのままで、
 * 地と枠と影だけを足して（.dragghost）合成に負けないようにする。
 *
 * 掴んだ位置を絵の中の同じ場所に合わせるので、札の一部を摘まんで持ち上げた
 * ような手触りになる。渡した絵は dragstart が終わった時点で写されるので、
 * そのあとは消してよい。画面の外に置くのは、写すまで見せないため。
 */
export function setDragChip(e: DragEvent, el: HTMLElement): void {
  if (!e.dataTransfer) return;
  const box = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("dragghost");
  ghost.classList.remove("drag");
  // 元の札は伸び縮みする箱の中にいるので、複製にも同じ大きさを持たせる。
  ghost.style.width = `${Math.round(box.width)}px`;
  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, e.clientX - box.left, e.clientY - box.top);
  } catch {
    /* 使えない環境では、ブラウザ既定の絵に任せる */
  }
  setTimeout(() => ghost.remove(), 0);
}
