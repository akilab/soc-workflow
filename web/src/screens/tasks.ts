/**
 * タスク一覧画面。
 *
 * タスクは事象をまたいで再利用される部品で、48 件まで増えている。
 * パレットは「置くものを選ぶ」ための場なので、作ることはできても、
 * 直す・片づけるための道具が無かった。この画面がそれを引き受ける。
 *
 * 段階ごとにまとめる。段階はタスクが持つ唯一の分類で、並び順も意味を持つ
 * （受信 → 情報収集 → 封じ込め → 復旧 → 記録・報告）。
 * 段階ごとに見出しを立てれば、行の中に段階のバッジを出さずに済む。
 *
 * 編集はダイアログにする。欄が 5 つ（名前・補足・段階・既定の担当・種類）あり、
 * 行に並べると 1 行が縦に伸びて一覧として読めなくなる。
 * 連絡先・段階設定・担当設定とも同じやり方になる。
 */

import { Api, ApiError, type TaskInput } from "../api";
import { $, $as, esc } from "../dom";
import { eventsUsingTask } from "../flow";
import type { DB, Phase, Task, TaskKind } from "../types";
import { TASK_KIND_LABEL } from "../types";
import { askModal, confirmModal, showApiError, toast } from "../ui";
import type { AskField } from "../ui";

export interface TasksDeps {
  api: Api;
  onBack: () => void;
  /** 段階設定を開く。段階を足したくなる場は、たいていこの画面。 */
  onPhases: () => void;
}

type SortMode = "use" | "def" | "name";
type FilterMode = "all" | "used" | "unused";

export class TasksScreen {
  private readonly api: Api;

  private q = "";
  private sort: SortMode = "use";
  private filter: FilterMode = "all";

  constructor(deps: TasksDeps) {
    this.api = deps.api;

    $("tkBack").addEventListener("click", deps.onBack);
    $("tkPhases").addEventListener("click", deps.onPhases);
    $("tkNew").addEventListener("click", () => void this.createTask());

    const search = $as<HTMLInputElement>("tkSearch");
    search.addEventListener("input", () => {
      this.q = search.value;
      this.render();
    });
    $as<HTMLSelectElement>("tkSort").addEventListener("change", (e) => {
      this.sort = (e.target as HTMLSelectElement).value as SortMode;
      this.render();
    });
    $as<HTMLSelectElement>("tkFilter").addEventListener("change", (e) => {
      this.filter = (e.target as HTMLSelectElement).value as FilterMode;
      this.render();
    });
  }

  private get db(): DB {
    return this.api.db;
  }

  render(): void {
    const box = $("tkList");
    box.innerHTML = "";

    const narrowed = !!this.q.trim() || this.filter !== "all";
    let hit = 0;

    for (const p of this.db.phases) {
      const tasks = this.sorted(
        this.db.tasks.filter((t) => t.phase === p.key && this.match(t)),
      );
      hit += tasks.length;
      // 絞り込み中に空の段階を並べても、結果が読みにくくなるだけ。
      if (narrowed && !tasks.length) continue;
      box.appendChild(this.group(p, tasks));
    }

    if (!hit) {
      box.innerHTML = narrowed
        ? '<p class="pal-empty">条件に合うタスクがありません。</p>'
        : '<p class="pal-empty">タスクがまだありません。' +
          "右上の「＋ 新しいタスク」から作ってください。</p>";
    }

    const total = this.db.tasks.length;
    $("tkCount").textContent = narrowed
      ? `${hit} / ${total} 件`
      : `${total} 件`;

    const used = this.db.tasks.filter(
      (t) => eventsUsingTask(this.db, t.key).length,
    ).length;
    $("tkStat").textContent = `使用中 ${used} / 未使用 ${total - used}`;

    $("tkSort").classList.toggle("on", this.sort !== "use");
    $("tkFilter").classList.toggle("on", this.filter !== "all");
  }

  private match(t: Task): boolean {
    const uses = eventsUsingTask(this.db, t.key).length;
    if (this.filter === "used" && !uses) return false;
    if (this.filter === "unused" && uses) return false;

    const q = this.q.trim().toLowerCase();
    if (!q) return true;
    return `${t.label}\n${t.note}`.toLowerCase().includes(q);
  }

  private sorted(tasks: Task[]): Task[] {
    // 定義順は元の並びそのものなので、複製してから並べ替える。
    return [...tasks].sort((a, b) => {
      if (this.sort === "name") return a.label.localeCompare(b.label, "ja");
      if (this.sort === "use") {
        const d =
          eventsUsingTask(this.db, b.key).length -
          eventsUsingTask(this.db, a.key).length;
        if (d) return d;
      }
      return this.db.tasks.indexOf(a) - this.db.tasks.indexOf(b);
    });
  }

  // -------------------------------------------------------------------------
  // 描く
  // -------------------------------------------------------------------------

  private group(p: Phase, tasks: Task[]): HTMLElement {
    const g = document.createElement("div");
    g.className = "tk-g";
    g.style.setProperty("--pc", p.color);
    g.innerHTML =
      `<h3><span class="dot"></span>${esc(p.name)}<u>${tasks.length}</u>` +
      `<button class="ed-tool sm" data-add>＋ この段階に追加</button></h3>`;
    g.querySelector("[data-add]")!.addEventListener("click", () => {
      void this.createTask(p.key);
    });

    for (const t of tasks) g.appendChild(this.row(t, p));
    if (!tasks.length) {
      g.insertAdjacentHTML(
        "beforeend",
        '<p class="pal-empty">この段階のタスクはまだありません。</p>',
      );
    }
    return g;
  }

  private row(t: Task, p: Phase): HTMLElement {
    const evs = eventsUsingTask(this.db, t.key);
    const lane = this.db.lanes.find((l) => l.key === t.lane);

    const row = document.createElement("div");
    row.className = "rw";
    row.style.setProperty("--pc", p.color);

    // 段階のバッジは出さない。段階ごとに見出しを立てているので重複する。
    const badges =
      (lane
        ? `<span class="badge" style="--bc:${lane.color}">${esc(lane.name)}</span>`
        : '<span class="badge">担当なし</span>') +
      (t.kind
        ? ` <span class="badge" style="--bc:var(--s2)">${esc(TASK_KIND_LABEL[t.kind])}</span>`
        : "");

    row.innerHTML =
      `<div><span class="k">タスク名</span><span class="v">${esc(t.label)}</span></div>` +
      `<div><span class="k">補足</span>` +
      `<span class="v dim">${t.note ? esc(t.note) : "—"}</span></div>` +
      `<div><span class="k">既定の担当 / 種類</span>${badges}</div>` +
      `<div class="use${evs.length ? " on" : ""}"><span class="k">使用</span>` +
      `<b>${evs.length ? `${evs.length} 事象` : "未使用"}</b>` +
      `<span>${
        evs.length
          ? esc(evs.map((e) => e.title).join("、"))
          : "どの事象でも使われていません"
      }</span></div>` +
      '<div class="acts"><button class="ed-tool sm" data-ed>編集</button>' +
      '<button class="ed-tool sm dgr" data-rm' +
      (evs.length
        ? ` disabled title="${evs.length} 事象で使用中のため削除できません"`
        : "") +
      ">削除</button></div>";

    row
      .querySelector("[data-ed]")!
      .addEventListener("click", () => void this.editTask(t));
    if (!evs.length) {
      row
        .querySelector("[data-rm]")!
        .addEventListener("click", () => void this.deleteTask(t));
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // 変更
  // -------------------------------------------------------------------------

  /**
   * 入力欄。作成と編集で同じものを使う。
   *
   * パレットの「新しいタスク」とも同じ形にしてある。同じものを作る場が
   * 2 つあるので、欄の並びや説明が食い違うと迷う。
   */
  private fields(t?: Task, phaseKey?: string): AskField[] {
    return [
      {
        k: "label",
        label: "タスク名",
        value: t?.label,
        required: true,
        placeholder: "例: 端末のネットワーク隔離",
      },
      {
        k: "note",
        label: "補足",
        value: t?.note,
        placeholder: "例: EDR から実行",
      },
      {
        k: "phase",
        label: "段階",
        type: "select" as const,
        value: t?.phase ?? phaseKey ?? this.db.phases[0]?.key ?? "",
        options: this.db.phases.map((p) => ({ v: p.key, l: p.name })),
        hint: "対応のどの段階かです。フロー図では色とラベルで表します。",
      },
      {
        k: "lane",
        label: "既定の担当",
        type: "select" as const,
        value: t?.lane ?? this.db.lanes[0]?.key ?? "",
        options: this.db.lanes.map((l) => ({ v: l.key, l: l.name })),
        hint: "手順に置くときの初期値です。置いたあとの手順は変わりません。",
      },
      {
        k: "kind",
        label: "種類",
        type: "select" as const,
        value: t?.kind ?? "",
        options: [
          { v: "", l: "通常の作業" },
          { v: "close", l: "終了（クローズ）" },
          { v: "wait", l: "待ち・保留" },
        ],
        hint:
          "「終了」は、完了させるとその経路がそこで終わります。" +
          "「待ち」は自分たちの作業ではないので、SLA の合計から分けて数えます。",
      },
    ];
  }

  private toInput(v: Record<string, string>): TaskInput {
    return {
      phase: v.phase,
      lane: v.lane,
      kind: v.kind as TaskKind,
      label: v.label,
      note: v.note,
    };
  }

  private async createTask(phaseKey?: string): Promise<void> {
    const v = await askModal({
      title: "新しいタスク",
      sub: "フロー図のボックスになる部品。事象をまたいで再利用されます",
      okLabel: "作成",
      fields: this.fields(undefined, phaseKey),
    });
    if (!v) return;

    try {
      await this.api.createTask(this.toInput(v));
      toast(`タスク「${v.label}」を作成しました`);
    } catch (e) {
      this.fail(e, "タスクを作れませんでした");
    }
  }

  private async editTask(t: Task): Promise<void> {
    const evs = eventsUsingTask(this.db, t.key);
    const fields = this.fields(t);
    if (evs.length) {
      // 何が響いて何が響かないかを、直す前に書いておく。
      // タスク名を直しても、すでに置いてある手順の題名は変わらない
      // （手順はこの事象での言い方を自分で持っている）。
      fields[0] = {
        ...fields[0],
        hint:
          `${evs.length} 事象で使われています。` +
          "ここで名前を直しても、すでに置いてある手順の題名は変わりません。",
      };
    }

    const v = await askModal({
      title: "タスクを編集",
      sub: t.label,
      okLabel: "保存",
      fields,
    });
    if (!v) return;

    try {
      await this.api.updateTask(t.key, this.toInput(v));
      toast("保存しました");
    } catch (e) {
      this.fail(e, "タスクを保存できませんでした");
    }
  }

  private async deleteTask(t: Task): Promise<void> {
    const ok = await confirmModal({
      title: "タスクを削除",
      sub: t.label,
      danger: true,
      okLabel: "削除する",
      message:
        `「${esc(t.label)}」を削除します。<br>` +
        "どの事象でも使われていないため、影響はありません。",
    });
    if (!ok) return;

    try {
      await this.api.deleteTask(t.key);
      toast("削除しました");
    } catch (e) {
      this.fail(e, "タスクを削除できませんでした");
    }
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else throw e;
  }
}
