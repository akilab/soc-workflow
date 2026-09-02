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
