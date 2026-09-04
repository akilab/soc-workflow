/**
 * 編集ビュー。左に手順アウトライン、中央にフローキャンバス、右にインスペクタ／パレット。
 *
 * 同じフローを 2 つの軸で同時に見せている。アウトラインは「どの順で、どの条件のときに」、
 * キャンバスは「どの段階のどこにあるか」。設計しているときはこの 2 つを行き来する。
 *
 * 試走モードは、書き出し HTML と同じ viewer をそのまま起動する。
 * 「試走で見えているものが、そのまま配布物になる」を仕組みで保証している。
 */

import { Api, ApiError, stepInput } from "../api";
import {
  dropSpotAt,
  renderCanvas,
  scrollToSelected,
  showDropSpot,
} from "../canvas";
import { optColor, optLabel } from "../branch";
import { $, esc } from "../dom";
import { eventLanes, eventOf, fmtMin, validate } from "../flow";
import { Inspector } from "../inspector";
import { renderOutline, reorderedIds } from "../outline";
import { Palette } from "../palette";
import { Selection } from "../select";
import { EventLaneSettings } from "../settings";
import type { DropSpot } from "../canvas";
import type { EventFlow } from "../types";
import { openModal, showApiError, toast } from "../ui";

type Mode = "edit" | "run";

/** 左右のペースの幅。利用者が動かしたら覚える。 */
interface PaneWidths {
  left: number;
  right: number;
}

const WIDTH_KEY = "soc-flow-panes";
const DEFAULT_WIDTHS: PaneWidths = { left: 290, right: 324 };

export interface EditScreenDeps {
  api: Api;
  /** 事象一覧へ戻る。 */
  onBack: () => void;
}

export class EditScreen {
  private readonly api: Api;
  private readonly onBack: () => void;
  private readonly sel = new Selection();
  private readonly inspector: Inspector;
  private readonly palette: Palette;
  private readonly laneSettings: EventLaneSettings;

  private eventKey = "";
  private mode: Mode = "edit";
  private viewer: ViewerHandle | null = null;
  private widths: PaneWidths = loadWidths();

  constructor(deps: EditScreenDeps) {
    this.api = deps.api;
    this.onBack = deps.onBack;
    this.inspector = new Inspector({
      api: this.api,
      selected: () => this.sel.ids,
      select: (ids) => {
        this.sel.clear();
        for (const id of ids) this.sel.ids.push(id);
      },
      renderAll: () => this.render(),
      renderFlow: () => this.renderFlow(),
    });
    this.laneSettings = new EventLaneSettings(this.api, () => this.render());
    this.palette = new Palette({
      api: this.api,
      event: () => this.evt,
      onChanged: () => toast("手順を追加しました"),
    });
    this.bind();
  }

  /** いま開いている事象。消えていれば undefined。 */
  private get evt(): EventFlow | undefined {
    return eventOf(this.api.db, this.eventKey);
  }

  /** 事象を開く。 */
  open(key: string): void {
    this.eventKey = key;
    this.sel.clear();
    this.setMode("edit");
  }

  /**
   * 保存待ちの入力を送りきる。
   *
   * 取り消しの前に必ず呼ぶ。入力は 400ms 止まってから送られるので、
   * 打った直後に取り消すと、戻したあとに古い入力が届いて元に戻ってしまう。
   */
  flush(): Promise<void> {
    return this.inspector.flush();
  }

  /** 描き直す。データが入れ替わったときにも呼ばれる。 */
  render(): void {
    const evt = this.renderFlow();
    if (!evt) return;
    this.inspector.render(evt);
    this.palette.render();
  }

  /**
   * アウトラインとキャンバスだけ描き直す。
   *
   * インスペクタに触らないのが要点。文字を打つたびに作り直すと、
   * 入力中の欄からフォーカスが外れる。
   */
  private renderFlow(): EventFlow | undefined {
    const evt = this.evt;
    if (!evt) {
      // 別のタブで消されたなど。黙って空を出さずに戻す。
      toast("この事象は無くなりました", true);
      this.onBack();
      return undefined;
    }
    this.sel.prune(evt);
    this.applyWidths();

    $("edTitle").innerHTML =
      `<span class="sev ${esc(evt.severity)}">${esc(evt.severity)}</span>` +
      `<b>${esc(evt.title)}</b>`;

    renderOutline({
      db: this.api.db,
      evt,
      selected: this.sel.ids,
      onPick: (id, e) => this.pick(id, e, true),
      onMove: (from, before) => void this.move(from, before),
    });

    renderCanvas({
      db: this.api.db,
      evt,
      selected: this.sel.ids,
      onPick: (id, e) => this.pick(id, e, false),
    });

    this.renderCheckBadge(evt);
    return evt;
  }

  // -------------------------------------------------------------------------

  private pick(id: string, e: MouseEvent, fromOutline: boolean): void {
    const evt = this.evt;
    if (!evt) return;
    // 別の手順へ移る前に、打ちかけの文字を送り切る。
    void this.inspector.flush().then(() => {
      this.sel.set(evt, id, e);
      this.setTab("ins");
      this.render();
      if (fromOutline) scrollToSelected();
    });
  }

  private async move(fromId: string, beforeId: string | null): Promise<void> {
    const evt = this.evt;
    if (!evt) return;
    try {
      await this.api.orderSteps(this.eventKey, reorderedIds(evt, fromId, beforeId));
    } catch (e) {
      this.fail(e, "手順の並べ替え");
    }
  }

  private renderCheckBadge(evt: EventFlow): void {
    const r = validate(this.api.db, evt);
    const b = $("btnCheck");
    b.className = "ed-tool" + (r.issues.length ? " warn" : " good");
    b.textContent = r.issues.length ? `検証 ${r.issues.length} 件` : "検証 OK";
  }

  // -------------------------------------------------------------------------
  // 試走
  // -------------------------------------------------------------------------

  private setMode(m: Mode): void {
    // 試走へ移る前に、打ちかけの文字を送り切る。
    // 送る前に viewer を立ち上げると、書きかけの内容が反映されない。
    if (m === "run") void this.inspector.flush();
    this.mode = m;
    for (const b of document.querySelectorAll<HTMLElement>(".ed-modes button")) {
      b.classList.toggle("on", b.dataset.mode === m);
    }
    document.body.className = m === "run" ? "screen-run" : "screen-edit";

    if (m === "run") {
      this.startRun();
      return;
    }
    this.stopRun();
    this.render();
    // 幅が変わっているので、描き終わってからもう一度測って線を引き直す。
    requestAnimationFrame(() => this.render());
  }

  private startRun(): void {
    this.stopRun();
    const db = this.api.db;
    // storageKey を渡さない＝試走の進捗は保存しない。編集中の下書きを汚さないため。
    this.viewer = mountViewer(
      $("runRoot"),
      {
        lanes: db.lanes,
        phases: db.phases,
        tasks: db.tasks,
        contactGroups: db.contactGroups,
        events: db.events,
      },
      { event: this.eventKey },
    );
  }

  private stopRun(): void {
    this.viewer?.destroy();
    this.viewer = null;
    $("runRoot").innerHTML = "";
  }

  // -------------------------------------------------------------------------
  // 検証・経路
  // -------------------------------------------------------------------------

  private showCheck(): void {
    const evt = this.evt;
    if (!evt) return;
    const r = validate(this.api.db, evt);

    const html = r.issues.length
      ? r.issues
          .map(
            (i) =>
              `<div class="issue ${i.lv === "err" ? "err" : "wrn"}">` +
              `<i>${i.lv === "err" ? "エラー" : "注意"}</i>` +
              `<div><b>${esc(i.t)}</b><span>${esc(i.d)}</span></div></div>`,
          )
          .join("")
      : '<p class="okmsg">&#10003; 問題は見つかりませんでした。</p>';

    openModal("検証", evt.title, html);
  }

  private showPaths(): void {
    const evt = this.evt;
    if (!evt) return;
    const r = validate(this.api.db, evt);
    const max = Math.max(0, ...r.paths.map((p) => p.minutes));
    const anyWait = r.paths.some((p) => p.waitMinutes > 0);

    const rows = r.paths
      .map((p, i) => {
        const keys = Object.keys(p.answers);
        const chips = keys.length
          ? keys
              .map((k) => {
                const c = { key: k, value: p.answers[k] };
                const col = optColor(evt, c);
                return `<em style="color:${col};border-color:${col}">${esc(optLabel(evt, c))}</em>`;
              })
              .join("")
          : '<em style="color:var(--faint);border-color:var(--line)">分岐なし</em>';
        return (
          `<tr><td class="num">${i + 1}</td>` +
          `<td><div class="pathkey">${chips}</div></td>` +
          `<td class="num">${p.count}</td>` +
          `<td class="num${p.minutes >= max && max > 0 ? " long" : ""}">${fmtMin(p.minutes)}</td>` +
          (anyWait
            ? `<td class="num">${p.waitMinutes ? fmtMin(p.waitMinutes) : "—"}</td>`
            : "") +
          "</tr>"
        );
      })
      .join("");

    openModal(
      "経路一覧",
      `${evt.title} — ${r.paths.length} 経路`,
      '<p class="ins hint" style="margin:0 0 12px">分岐の全組み合わせです。' +
        "作業の合計が最も長い経路を色付きで示します。" +
        (anyWait
          ? "待ちは自分たちが動く時間ではないので、分けて数えています。"
          : "") +
        "対応者は 1 本しか辿りませんが、設計する側は全部を見る必要があります。</p>" +
        '<table class="tbl"><thead><tr><th>#</th><th>回答の組み合わせ</th>' +
        "<th>手順数</th><th>作業 SLA</th>" +
        (anyWait ? "<th>待ち</th>" : "") +
        "</tr></thead>" +
        `<tbody>${rows}</tbody></table>`,
    );
  }

  private showExport(): void {
    const evt = this.evt;
    if (!evt) return;
    openModal(
      "書き出し",
      evt.title,
      '<p class="ins hint" style="margin:0 0 12px">下のプレビューは、実際に書き出される HTML を' +
        "そのまま表示しています。外部依存はありません。ファイルをコピーするだけで配れます。</p>" +
        `<iframe class="frame" src="${esc(this.api.exportUrl(this.eventKey))}"></iframe>`,
      `<a class="ed-tool pri" href="${esc(this.api.downloadUrl(this.eventKey))}" download>保存する</a>` +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );
  }

  // -------------------------------------------------------------------------
  // 配線
  // -------------------------------------------------------------------------

  private bind(): void {
    $("btnBack").addEventListener("click", () => {
      void this.inspector.flush().then(() => {
        this.stopRun();
        this.onBack();
      });
    });
    $("btnLanes").addEventListener("click", () => {
      const evt = this.evt;
      if (evt) this.laneSettings.open(evt);
    });
    $("btnCheck").addEventListener("click", () => this.showCheck());
    $("btnPaths").addEventListener("click", () => this.showPaths());
    $("btnExport").addEventListener("click", () => this.showExport());

    for (const b of document.querySelectorAll<HTMLElement>(".ed-modes button")) {
      b.addEventListener("click", () => this.setMode(b.dataset.mode as Mode));
    }

    for (const b of document.querySelectorAll<HTMLElement>("#paneRight .tabs button")) {
      b.addEventListener("click", () => this.setTab(b.dataset.tab ?? "ins"));
    }

    this.bindDrop();
    this.bindSplitters();

    // 窓の大きさが変わると座標が変わる。線を引き直す。
    window.addEventListener("resize", () => {
      if (this.mode === "edit" && this.evt) this.render();
    });
  }

  /**
   * パレットからキャンバスへ落とせるようにする。
   *
   * 落とした列がそのまま担当になり、落とした高さが挿入位置になる。
   * 列が段階だった頃は、どこに落としても結果が同じだった（段階はタスクが
   * 決めるので）。軸を担当に変えたことで、置く動作そのものが意味を持つ。
   */
  private bindDrop(): void {
    const canvas = $("canvas");

    const spotFrom = (e: DragEvent) =>
      dropSpotAt(eventLanes(this.api.db, this.evt), e.clientX, e.clientY);

    canvas.addEventListener("dragover", (e) => {
      if (!this.evt) return;
      e.preventDefault();
      if (e.dataTransfer) {
        // ドラッグ元が許した操作に合わせる。ここが食い違うと、ブラウザは
        // 落とすこと自体を許さない。パレットのカードは copy（部品を写して
        // 手順を作る）、キャンバスのボックスとアウトラインの行は move。
        e.dataTransfer.dropEffect =
          e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
      }
      showDropSpot(eventLanes(this.api.db, this.evt), spotFrom(e));
    });
    canvas.addEventListener("dragleave", (e) => {
      // 中の要素をまたぐたびに発火するので、本当に外へ出たときだけ消す。
      if (canvas.contains(e.relatedTarget as Node | null)) return;
      showDropSpot(eventLanes(this.api.db, this.evt), null);
    });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const spot = spotFrom(e);
      showDropSpot(eventLanes(this.api.db, this.evt), null);
      document.body.classList.remove("dragging");

      const data = e.dataTransfer?.getData("text/plain") ?? "";
      if (data.startsWith("task:")) {
        void this.palette.addStep(data.slice(5), spot ?? undefined);
        return;
      }
      if (data.startsWith("step:") && spot) {
        void this.moveStep(data.slice(5), spot);
      }
    });
  }

  /**
   * 落とした場所へ手順を動かす。担当と順番が同時に決まる。
   *
   * 送るのは 2 つに分かれる。担当は手順の中身なので更新、順番は事象の中の
   * 並びなので並べ替え。どちらか片方しか変わっていなければ、その片方だけ送る。
   */
  private async moveStep(id: string, spot: DropSpot): Promise<void> {
    const evt = this.evt;
    if (!evt) return;

    const from = evt.steps.findIndex((s) => s.id === id);
    if (from < 0) return;
    const st = evt.steps[from];

    // 落とした位置は「いまの並びの何番目に割り込むか」。自分より後ろへ動かす
    // ときは、自分が抜けたぶんだけ 1 つ手前になる。
    let to = spot.index;
    if (to > from) to -= 1;

    const laneChanged = st.lane !== spot.lane;
    const moved = to !== from;
    if (!laneChanged && !moved) return; // 同じ場所に戻しただけ

    await this.inspector.flush();
    try {
      if (laneChanged) {
        st.lane = spot.lane;
        await this.api.updateStep(evt.key, id, stepInput(st), { quiet: true });
      }
      if (moved) {
        const ids = evt.steps.map((s) => s.id);
        ids.splice(from, 1);
        ids.splice(to, 0, id);
        await this.api.orderSteps(evt.key, ids);
      } else {
        await this.api.load(); // 担当だけ変えた場合。画面を合わせる
      }
    } catch (e) {
      this.fail(e, "手順の移動");
      await this.api.load();
    }
  }

  /**
   * ペインの幅を掴んで動かせるようにする。
   *
   * 手順名は長さがまちまちで、分岐が深いと横にも伸びる。
   * どこを広げたいかは作業の段階で変わるので、固定にしない。
   */
  private bindSplitters(): void {
    for (const sp of document.querySelectorAll<HTMLElement>(".split")) {
      sp.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const target = sp.dataset.target;
        const x0 = e.clientX;
        const start = { ...this.widths };
        document.body.classList.add("resizing");

        const move = (ev: MouseEvent) => {
          if (target === "left") {
            this.widths.left = clamp(start.left + (ev.clientX - x0), 190, 480);
          } else {
            this.widths.right = clamp(start.right - (ev.clientX - x0), 260, 560);
          }
          this.applyWidths();
        };
        const up = () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          document.body.classList.remove("resizing");
          saveWidths(this.widths);
          this.render(); // 幅が変わったので測り直す
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
    }
  }

  /**
   * 右サイドバーのタブを切り替える。
   *
   * 「タスクを選んで置く」と「内容を書く」は別の作業なので、画面を分ける。
   */
  private setTab(tab: string): void {
    const pane = $("paneRight");
    pane.className = `pane tab-${tab}`;
    for (const b of pane.querySelectorAll<HTMLElement>(".tabs button")) {
      b.classList.toggle("on", b.dataset.tab === tab);
    }
  }

  private applyWidths(): void {
    const b = $("edBody");
    b.style.setProperty("--wl", `${this.widths.left}px`);
    b.style.setProperty("--wr", `${this.widths.right}px`);
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * ペインの幅は localStorage に置く。
 *
 * 使う人ごと・画面ごとの好みで、共有する意味が無い。
 * サーバの JSON に入れると、別の端末で開いたときに窮屈になる。
 */
function loadWidths(): PaneWidths {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PaneWidths>;
      return {
        left: clamp(Number(v.left) || DEFAULT_WIDTHS.left, 190, 480),
        right: clamp(Number(v.right) || DEFAULT_WIDTHS.right, 260, 560),
      };
    }
  } catch {
    // 読めなければ既定でよい
  }
  return { ...DEFAULT_WIDTHS };
}

function saveWidths(w: PaneWidths): void {
  try {
    localStorage.setItem(WIDTH_KEY, JSON.stringify(w));
  } catch {
    // 保存できなくても動作に支障はない
  }
}
