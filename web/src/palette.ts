/**
 * タスクパレット。フロー図に置く部品を選ぶところ。
 *
 * タスクは事象をまたいで再利用される部品なので、「どれがよく使われているか」
 * 「この事象ではもう使っているか」が見えると選びやすい。使用回数を出し、
 * 既定では使用の多い順に並べる。
 *
 * インスペクタとはタブで分ける。「タスクを選んで置く」と「内容を書く」は
 * 別の作業で、同時に見たいものが違う。
 */

import { Api, ApiError } from "./api";
import type { StepPlacement } from "./api";
import { $, $as, esc } from "./dom";
import type { DB, EventFlow, Phase, Task } from "./types";
import { askModal, showApiError, toast } from "./ui";

type SortMode = "use" | "def" | "name";
type FilterMode = "all" | "here" | "unused";

export interface PaletteDeps {
  api: Api;
  /** いま開いている事象。 */
  event: () => EventFlow | undefined;
  /** 手順を足したあとに呼ばれる。 */
  onChanged: () => void;
}

export class Palette {
  private readonly d: PaletteDeps;

  private query = "";
  private sort: SortMode = "use";
  private filter: FilterMode = "all";
  /** 畳んでいる段階。段階ごとにまとめて出すので、要らない段階は閉じられる。 */
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

  /** そのタスクを使っている事象の数。 */
  private usedInEvents(key: string): number {
    return this.db.events.filter((e) => e.steps.some((s) => s.task === key))
      .length;
  }

  /** いま開いている事象で、そのタスクを何回使っているか。 */
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
      // 絞り込み中に空の段階を出しても邪魔になるだけ
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
    if (this.query.trim()) return `「${this.query}」に一致するタスクはありません。`;
    if (this.filter === "here") return "この事象ではまだタスクを使っていません。";
    if (this.filter === "unused") return "未使用のタスクはありません。";
    return "タスクがありません。";
  }

  /** 段階ごとのまとまり。 */
  private group(p: Phase, tasks: Task[], narrowed: boolean): HTMLElement {
    const g = document.createElement("div");
    g.className = "pal-g";
    g.style.setProperty("--pc", p.color);
    g.innerHTML =
      `<h4><span>${esc(p.name)}<u>${tasks.length}</u></span>` +
      `<button title="${esc(p.name)} に新しいタスクを作る">＋</button></h4>`;

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
        empty.textContent = "タスクなし";
        g.appendChild(empty);
      }
    }
    return g;
  }

  /** タスク 1 枚。 */
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
      `<b>${esc(t.label)}</b><span class="nt">${esc(t.note ?? "")}</span>` +
      '<span class="use">' +
      (here ? `<span class="u-in">使用中 ${here}</span>` : "") +
      `<span class="u-all">${all}事象</span></span>` +
      '<button class="add" title="末尾に追加">+</button>';
    el.title =
      t.label +
      (t.note ? `（${t.note}）` : "") +
      `\n既定の担当: ${lane?.name ?? "未設定"}` +
      `\nこの事象で ${here} 回 / 全体で ${all} 事象が使用` +
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

  /** 末尾に足す。担当はタスクの既定値。 */
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
      title: "新しいタスク",
      sub: "フロー図のボックスになる部品。事象をまたいで再利用されます",
      okLabel: "作成",
      fields: [
        {
          k: "label",
          label: "タスク名",
          required: true,
          placeholder: "例: 端末のネットワーク隔離",
        },
        { k: "note", label: "補足", placeholder: "例: EDR から実行" },
        {
          k: "phase",
          label: "段階",
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
      ],
    });
    if (!v) return;

    try {
      await this.d.api.createTask({
        phase: v.phase,
        lane: v.lane,
        label: v.label,
        note: v.note,
      });
      this.collapsed.delete(v.phase); // 作った段階は開いておく
      toast(`タスク「${v.label}」を作成しました`);
    } catch (e) {
      this.fail(e, "タスクの作成");
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
