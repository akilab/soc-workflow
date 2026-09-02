/**
 * 手順の選択。
 *
 * 単一選択と複数選択の両方を持つ。複数選択は「まとめて条件を付ける」
 * 「まとめて消す」のためのもので、骨組みを作ってから条件を後付けする
 * という作り方に効く。
 */

import type { EventFlow } from "./types";

export class Selection {
  /** 選ばれている手順 ID。並び順は選んだ順ではなく、手順の順。 */
  ids: string[] = [];

  /** Shift の範囲選択の起点。 */
  private anchor: string | null = null;

  /** ちょうど 1 つ選ばれているときの ID。インスペクタが見る。 */
  get single(): string | null {
    return this.ids.length === 1 ? this.ids[0] : null;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  clear(): void {
    this.ids = [];
    this.anchor = null;
  }

  /**
   * 選ぶ。Ctrl（Mac は Command）で足し引き、Shift で範囲。
   *
   * 範囲は手順の並び順で取る。画面上の見た目ではなく実施順を基準にするのは、
   * まとめて操作したい単位が「連続する手順」だから。
   */
  set(evt: EventFlow, id: string, e?: MouseEvent): void {
    const ids = evt.steps.map((s) => s.id);

    if (e && (e.ctrlKey || e.metaKey)) {
      const i = this.ids.indexOf(id);
      if (i >= 0) this.ids.splice(i, 1);
      else this.ids.push(id);
      this.anchor = id;
      return;
    }

    if (e?.shiftKey && this.anchor && ids.includes(this.anchor)) {
      const a = ids.indexOf(this.anchor);
      const b = ids.indexOf(id);
      this.ids = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      return;
    }

    this.ids = [id];
    this.anchor = id;
  }

  /** 消えた手順を選択から外す。削除や再読み込みのあとに呼ぶ。 */
  prune(evt: EventFlow | undefined): void {
    if (!evt) {
      this.clear();
      return;
    }
    const alive = new Set(evt.steps.map((s) => s.id));
    this.ids = this.ids.filter((id) => alive.has(id));
    if (this.anchor && !alive.has(this.anchor)) this.anchor = null;
  }
}
