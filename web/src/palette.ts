/**
 * 対応パレット。フロー図に置く部品を選ぶところ。
 *
 * 対応はフローをまたいで再利用される部品なので、「どれがよく使われているか」
 * 「このフローではもう使っているか」が見えると選びやすい。使用回数を出し、
 * 既定では使用の多い順に並べる。
 *
 * インスペクタとはタブで分ける。「対応を選んで置く」と「内容を書く」は
 * 別の作業で、同時に見たいものが違う。
 */

import { Api, ApiError } from "./api";
import type { StepPlacement } from "./api";
import { $, $as, esc } from "./dom";
import { eventsUsingTask } from "./flow";
import type { DB, EventFlow, Phase, Task, TaskKind } from "./types";
import { askModal, showApiError, toast } from "./ui";

type SortMode = "use" | "def" | "name";
type FilterMode = "all" | "here" | "unused";

export interface PaletteDeps {
  api: Api;
  /** いま開いているフロー。 */
  event: () => EventFlow | undefined;
  /** 手順を足したあとに呼ばれる。 */
  onChanged: () => void;
}

export class Palette {
  private readonly d: PaletteDeps;

  private query = "";
  private sort: SortMode = "use";
  private filter: FilterMode = "all";
  /** 畳んでいるフェーズ。フェーズごとにまとめて出すので、要らないフェーズは閉じられる。 */
  private collapsed = new Set<string>();

  constructor(deps: PaletteDeps) {
    this.d = deps;
    this.bind();
  }

  private get db(): DB {
    return this.d.api.db;
  }

  // -------------------------------------------------------------------------
  // 数える
  // -------------------------------------------------------------------------

  /** その対応を使っているフローの数。 */
  private usedInEvents(key: string): number {
    return eventsUsingTask(this.db, key).length;
  }

  /** いま開いているフローで、その対応を何回使っているか。 */
  private usedHere(key: string): number {
    return (this.d.event()?.steps ?? []).filter((s) => s.task === key).length;
  }

  private sorted(tasks: Task[]): Task[] {
    const order = new Map(this.db.tasks.map((t, i) => [t.key, i]));
    return [...tasks].sort((a, b) => {
      if (this.sort === "name") return a.label.localeCompare(b.label, "ja");
      if (this.sort === "use") {
        const d = this.usedInEvents(b.key) - this.usedInEvents(a.key);
        if (d) return d;
        const h = this.usedHere(b.key) - this.usedHere(a.key);
        if (h) return h;
      }
      return (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
    });
  }

  private matches(t: Task): boolean {
    if (this.filter === "here" && !this.usedHere(t.key)) return false;
    if (this.filter === "unused" && this.usedInEvents(t.key)) return false;
    const q = this.query.trim().toLowerCase();
    if (!q) return true;
    return `${t.label} ${t.note ?? ""}`.toLowerCase().includes(q);
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  render(): void {
    const box = $("palList");
    box.innerHTML = "";

    const narrowed = !!this.query.trim() || this.filter !== "all";
    let hit = 0;

    for (const p of this.db.phases) {
      const tasks = this.sorted(
        this.db.tasks.filter((t) => t.phase === p.key && this.matches(t)),
      );
      hit += tasks.length;
      // 絞り込み中に空のフェーズを出しても邪魔になるだけ
      if (narrowed && !tasks.length) continue;
      box.appendChild(this.group(p, tasks, narrowed));
    }

    if (!hit) {
      box.innerHTML = `<p class="pal-empty">${esc(this.emptyMessage())}</p>`;
    }

    $("tabPalNo").textContent = narrowed
      ? `${hit}/${this.db.tasks.length}`
      : String(this.db.tasks.length);
    $("palSort").classList.toggle("on", this.sort !== "use");
    $("palFilter").classList.toggle("on", this.filter !== "all");
  }

  private emptyMessage(): string {
    if (this.query.trim()) return `「${this.query}」に一致する対応はありません。`;
    if (this.filter === "here") return "このフローではまだ対応を使っていません。";
    if (this.filter === "unused") return "未使用の対応はありません。";
    return "対応がありません。";
  }

  /** フェーズごとのまとまり。 */
  private group(p: Phase, tasks: Task[], narrowed: boolean): HTMLElement {
    const g = document.createElement("div");
    g.className = "pal-g";
    g.style.setProperty("--pc", p.color);
    g.innerHTML =
      `<h4><span>${esc(p.name)}<u>${tasks.length}</u></span>` +
      `<button title="${esc(p.name)} に新しい対応を作る">` +
      '<svg class="ic"><use href="#ic-add"/></svg></button></h4>';

    g.querySelector("h4 span")?.addEventListener("click", () => {
      if (narrowed) return; // 絞り込み中は畳まない。畳むと結果が見えなくなる
      if (this.collapsed.has(p.key)) this.collapsed.delete(p.key);
      else this.collapsed.add(p.key);
      this.render();
    });
    g.querySelector("h4 button")?.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.createTask(p.key);
    });

    if (!this.collapsed.has(p.key) || narrowed) {
      for (const t of tasks) g.appendChild(this.card(t, p));
      if (!tasks.length) {
        const empty = document.createElement("p");
        empty.className = "pal-empty";
        empty.textContent = "対応なし";
        g.appendChild(empty);
      }
    }
    return g;
  }

  /** 対応 1 枚。 */
  private card(t: Task, p: Phase): HTMLElement {
    const here = this.usedHere(t.key);
    const all = this.usedInEvents(t.key);
    const lane = this.db.lanes.find((l) => l.key === t.lane);

    const el = document.createElement("div");
    el.className = "pal-t";
    el.draggable = true;
    el.dataset.k = t.key;
    el.style.setProperty("--pc", p.color);
    el.innerHTML =
      "<b>" +
      (t.kind === "close"
        ? '<i class="k-fin" title="この経路はここで終わります">終了</i>'
        : t.kind === "wait"
          ? '<i class="k-wait" title="自分たちの作業ではありません">待ち</i>'
          : "") +
      `${esc(t.label)}</b><span class="nt">${esc(t.note ?? "")}</span>` +
      '<span class="use">' +
      (here ? `<span class="bdg u-in">使用中 ${here}</span>` : "") +
      `<span class="u-all">${all}フロー</span></span>` +
      '<button class="add" title="末尾に追加">' +
      '<svg class="ic"><use href="#ic-add"/></svg></button>';
    el.title =
      t.label +
      (t.note ? `（${t.note}）` : "") +
      `\n既定の担当: ${lane?.name ?? "未設定"}` +
      `\nこのフローで ${here} 回 / 全体で ${all} フローが使用` +
      "\n\nキャンバスの列へドラッグすると、その担当で入ります。";

    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", `task:${t.key}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      el.classList.add("drag");
      document.body.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("drag");
      document.body.classList.remove("dragging");
    });

    el.querySelector(".add")?.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.addStep(t.key);
    });
    return el;
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  /** 末尾に足す。担当は対応の既定値。 */
  async addStep(taskKey: string, at?: StepPlacement): Promise<void> {
    const evt = this.d.event();
    if (!evt) return;
    try {
      await this.d.api.createStep(evt.key, taskKey, at);
      this.d.onChanged();
    } catch (e) {
      this.fail(e, "手順の追加");
    }
  }

  private async createTask(phaseKey: string): Promise<void> {
    const db = this.db;
    if (!db.lanes.length) {
      toast("担当が登録されていません", true);
      return;
    }

    const v = await askModal({
      title: "新しい対応",
      sub: "フロー図のボックスになる部品。フローをまたいで再利用されます",
      okLabel: "作成",
      fields: [
        {
          k: "label",
          label: "対応名",
          required: true,
          placeholder: "例: 端末のネットワーク隔離",
        },
        { k: "note", label: "補足", placeholder: "例: EDR から実行" },
        {
          k: "phase",
          label: "フェーズ",
          type: "select",
          value: phaseKey,
          options: db.phases.map((p) => ({ v: p.key, l: p.name })),
        },
        {
          k: "lane",
          label: "既定の担当",
          type: "select",
          value: db.lanes[0].key,
          options: db.lanes.map((l) => ({ v: l.key, l: l.name })),
          hint: "手順に置くときの初期値です。手順ごとに変えられます。",
        },
        {
          k: "kind",
          label: "種類",
          type: "select",
          value: "",
          options: [
            { v: "", l: "通常の作業" },
            { v: "close", l: "終了（クローズ）" },
            { v: "wait", l: "待ち・保留" },
          ],
          hint:
            "「終了」は、完了させるとその経路がそこで終わります。" +
            "「待ち」は自分たちの作業ではないので、SLA の合計から分けて数えます。",
        },
      ],
    });
    if (!v) return;

    try {
      await this.d.api.createTask({
        phase: v.phase,
        lane: v.lane,
        kind: v.kind as TaskKind,
        label: v.label,
        note: v.note,
      });
      this.collapsed.delete(v.phase); // 作ったフェーズは開いておく
      toast(`対応「${v.label}」を作成しました`);
    } catch (e) {
      this.fail(e, "対応の作成");
    }
  }

  // -------------------------------------------------------------------------

  private bind(): void {
    $as<HTMLInputElement>("palSearch").addEventListener("input", (e) => {
      this.query = (e.target as HTMLInputElement).value;
      this.render();
    });
    $as<HTMLSelectElement>("palSort").addEventListener("change", (e) => {
      this.sort = (e.target as HTMLSelectElement).value as SortMode;
      this.render();
    });
    $as<HTMLSelectElement>("palFilter").addEventListener("change", (e) => {
      this.filter = (e.target as HTMLSelectElement).value as FilterMode;
      this.render();
    });
    $("palNew").addEventListener("click", () => {
      void this.createTask(this.db.phases[0]?.key ?? "");
    });
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}
