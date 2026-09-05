/**
 * internal/export/viewer.js が定義するグローバル。
 *
 * viewer.js は書き出し HTML にそのまま埋め込まれるので、モジュールにできない
 * （import / export を書くと、素の script タグとして読めなくなる）。
 * だからエディタ側でも script タグで先に読み、グローバルとして使う。
 * ここはその型だけを宣言する。
 *
 * テストモードと書き出し HTML が同じコードを使う、という初日からの決めごとを
 * 保つための形。viewer.js を 2 つ持たない。
 *
 * import を書いた時点でこのファイルはモジュールになり、宣言がグローバルに出なくなる。
 * だから中身は declare global で囲う。
 */

import type { ContactGroup, EventFlow, Lane, Phase, Task } from "./types";

declare global {
  /** mountViewer に渡すデータ。書き出し HTML の DATA と同じ形。 */
  interface ViewerData {
    lanes: Lane[];
    phases: Phase[];
    tasks: Task[];
    contactGroups: ContactGroup[];
    events: EventFlow[];
  }

  interface ViewerOptions {
    /** 進捗の保存先。渡さなければ保存しない（テストは下書きを汚さない）。 */
    storageKey?: string;
    /** 最初に開くフローのキー。 */
    event?: string;
    /** 画面の上に出す注意書き。 */
    note?: string;
  }

  interface ViewerHandle {
    destroy(): void;
  }

  function mountViewer(
    root: HTMLElement,
    data: ViewerData,
    opt?: ViewerOptions,
  ): ViewerHandle;

  /** 明るさを決める。"" は OS の設定に従う。 */
  function applyTheme(t: "" | "light" | "dark"): void;

  /** 保存されている明るさを読み、[data-th] のボタンに動作を付ける。 */
  function initTheme(): void;

  /** いま実際に適用されている明るさ。 */
  function effectiveTheme(): "light" | "dark";

  /** 連絡手段のアイコン（SVG スプライト）を body に差し込む。 */
  function ensureViaSprite(): void;
}

declare global {
  /** 連絡手段の表示定義。viewer.js の VIA。ico があれば SVG、無ければ m の文字。 */
  const VIA: Record<string, { l: string; ico?: string; m: string; c: string }>;

  /** 連絡先の区分の表示定義。viewer.js の KIND。 */
  const KIND: Record<string, { l: string; c: string }>;
}
