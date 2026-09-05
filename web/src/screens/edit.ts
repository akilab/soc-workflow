/**
 * 編集ビュー。左に手順アウトライン、中央にフローキャンバス、右にインスペクタ／パレット。
 *
 * 同じフローを 2 つの軸で同時に見せている。アウトラインは「どの順で、どの条件のときに」、
 * キャンバスは「どのフェーズのどこにあるか」。設計しているときはこの 2 つを行き来する。
 *
 * テストモードは、書き出し HTML と同じ viewer をそのまま起動する。
 * 「テストで見えているものが、そのまま配布物になる」を仕組みで保証している。
 */

import { Api, ApiError, stepInput } from "../api";
import {
  applyZoom,
  clearDropGeometry,
  dropSpotAt,
  edgeScroll,
  renderCanvas,
  scrollToSelected,
  setZoom,
  showDropSpot,
  stepZoom,
  stopEdgeScroll,
} from "../canvas";
import { optColor, optLabel } from "../branch";
import { SLASettings } from "../sla";
import { changedDetail, diffFrom, diffSummary } from "../derive";
import type { StepDiff } from "../derive";
import { $, $as, esc } from "../dom";
import { eventLanes, eventOf, validate } from "../flow";
import { Inspector } from "../inspector";
import { renderOutline, reorderedIds } from "../outline";
import { Palette } from "../palette";
import { Selection } from "../select";
import { EventLaneSettings } from "../settings";
import type { DropSpot } from "../canvas";
import type { EventFlow } from "../types";
import {
  closeModal,
  openModal,
  showApiError,
  surfaceFoot,
  toast,
} from "../ui";

type Mode = "edit" | "run";

/** 左右のペースの幅。利用者が動かしたら覚える。 */
interface PaneWidths {
  left: number;
  right: number;
}

const WIDTH_KEY = "soc-flow-panes";

/**
 * ペインの幅の下限・上限。
 *
 * 下限は測って決めた。手順アウトラインの行は「番号・題名・数量・ラベル・担当」
 * で、題名以外は幅が文言で決まるため縮まない。印を全部使うフロー
 * （ランサムウェアの疑い）では、題名以外だけで 253px、行の隙間と左右の余白を
 * 足して 312px を占める。
 *
 * 実測（そのフローでの題名の幅と行の高さ）:
 *   400px … 90px / 68px（3 行に折り返す）
 *   440px … 91〜102px / 50px（2 行に収まる）
 *   460px … 111〜122px / 50px
 * 440 を採る。ここで行の高さが落ち着き、印の少ないフローでは題名に
 * 140〜170px 残る。
 *
 * 以前の下限は 190px、既定は 290px だった。どちらも足りておらず、印の多い
 * フローでは題名の幅が 0 になって 1 文字ずつ縦に折り返していた。
 * ラベルを固定幅の列にそろえたときに、必要な幅が増えたことを見落としていた。
 *
 * 想定は 24 インチ・FullHD。1920px なら 440 + 324 + 仕切り 14 を引いても
 * キャンバスに 1107px 残り、横スクロールは出ない。
 */
const PANE_LIMITS = {
  // 下限は実測。印を Fluent の Badge にして幅が増えたので取り直した
  // （440px では担当バッジが 14px はみ出して横スクロールが出ていた）。
  left: { min: 460, max: 620 },
  right: { min: 300, max: 560 },
};

const DEFAULT_WIDTHS: PaneWidths = { left: 460, right: 324 };

export interface EditScreenDeps {
  api: Api;
  /** フロー一覧へ戻る。 */
  onBack: () => void;
}

export class EditScreen {
  private readonly api: Api;
  private readonly onBack: () => void;
  private readonly sel = new Selection();
  private readonly inspector: Inspector;
  private readonly palette: Palette;
  private readonly laneSettings: EventLaneSettings;
  private readonly slaSettings: SLASettings;

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
    this.slaSettings = new SLASettings(this.api);
    this.palette = new Palette({
      api: this.api,
      event: () => this.evt,
      onChanged: () => toast("手順を追加しました"),
    });
    this.bind();
  }

  /** いま開いているフロー。消えていれば undefined。 */
  private get evt(): EventFlow | undefined {
    return eventOf(this.api.db, this.eventKey);
  }

  /** フローを開く。 */
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
      toast("このフローは無くなりました", true);
      this.onBack();
      return undefined;
    }
    this.sel.prune(evt);
    this.applyWidths();

    $("edTitle").textContent = evt.title;
    $("crumbNow").textContent = evt.title;
    this.renderMeta(evt);

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
    this.renderDiffBadge(evt);
    return evt;
  }

  /**
   * 「共通との違い」ボタン。顧客別フローのときだけ出す。
   *
   * 元が更新されていれば、開かなくても分かるように印を付ける。
   * 気づかないまま古い前提で直すのが一番まずい。
   */
  private renderDiffBadge(evt: EventFlow): void {
    const b = $as<HTMLButtonElement>("btnDiff");
    const d = diffFrom(this.api.db, evt);
    b.hidden = !d;
    if (!d) return;

    b.classList.toggle("warn", d.outdated);
    b.innerHTML =
      '<svg class="ic"><use href="#ic-branch"/></svg>共通との違い' +
      `<u>${esc(diffSummary(d))}</u>`;
    b.title = d.outdated
      ? "元のフローがこのあと更新されています"
      : `「${d.base?.title ?? ""}」との違いを見る`;
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
    const word = r.issues.length ? `検証 ${r.issues.length} 件` : "検証 OK";
    b.innerHTML =
      `<svg class="ic"><use href="#ic-${r.issues.length ? "warn" : "check"}"/></svg>` +
      esc(word);
    b.classList.toggle("warn", r.issues.length > 0);
  }

  /**
   * 見出しの下のメタの帯。
   *
   * 開いた瞬間に「このフローが何なのか」が 1 行で分かるようにする。
   * Defender でインシデントを開いたときの
   * 「低 │ Active │ 未割り当て │ 最終更新時刻」と同じ役割。
   */
  private renderMeta(evt: EventFlow): void {
    const db = this.api.db;
    const r = validate(db, evt);
    const d = diffFrom(db, evt);

    const cell = (ico: string, text: string, cls = "") =>
      `<span class="${cls}"><svg class="ic"><use href="#ic-${ico}"/></svg>${esc(text)}</span>`;

    let html =
      `<span><span class="sev ${esc(evt.severity)}">${esc(evt.severity)}</span></span>` +
      cell("list", `${evt.steps.length} 手順`) +
      cell("branch", `${r.paths.length} 経路`) +
      (r.issues.length
        ? cell("warn", `検証 ${r.issues.length} 件`, "ng")
        : cell("check", "検証 OK", "ok"));

    if (d?.base) {
      html += cell(
        "branch",
        `${d.base.title} から作成・${diffSummary(d)}` + (d.outdated ? "（元が更新）" : ""),
        d.outdated ? "ng" : "",
      );
    }
    // 「いつの版か」は、書き出して配ったものと見比べるときに効く。
    html += cell("clock", `最終更新 ${fmtWhen(evt.updatedAt)}`);

    $("edMeta").innerHTML = html;
  }

  // -------------------------------------------------------------------------
  // テスト
  // -------------------------------------------------------------------------

  private setMode(m: Mode): void {
    // テストへ移る前に、打ちかけの文字を送り切る。
    // 送る前に viewer を立ち上げると、書きかけの内容が反映されない。
    if (m === "run") void this.inspector.flush();
    this.mode = m;
    for (const b of document.querySelectorAll<HTMLElement>(".ed-tabs button")) {
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
    // storageKey を渡さない＝テストの進捗は保存しない。編集中の下書きを汚さないため。
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

    // 重さは絵と地の色で示し、言葉も頭に残す（色だけに頼らない）。
    const html = r.issues.length
      ? r.issues
          .map((i) => {
            const err = i.lv === "err";
            return (
              `<div class="msgbar ${err ? "err" : "wrn"}">` +
              `<svg class="ic lg"><use href="#ic-${err ? "alert" : "warn"}"/></svg>` +
              `<div><b><u>${err ? "エラー" : "注意"}</u>${esc(i.t)}</b>` +
              `<span>${esc(i.d)}</span></div></div>`
            );
          })
          .join("")
      : '<div class="msgbar ok"><svg class="ic lg"><use href="#ic-check"/></svg>' +
        "<div><b>問題は見つかりませんでした</b>" +
        "<span>手順の抜け・行き止まり・参照できない判断は見当たりません。" +
        "配ってよい状態です。</span></div></div>";

    openModal("検証", evt.title, html);
  }

  /**
   * 共通フローとの違い。
   *
   * 顧客ごとに手順そのものが変わるので、「この顧客だけ何をしているのか」が
   * 分からないと、共通を直したときに何を見直せばよいか決められない。
   */
  private showDiff(): void {
    const evt = this.evt;
    if (!evt) return;
    const db = this.api.db;
    const d = diffFrom(db, evt);
    if (!d) return;

    if (!d.base) {
      openModal(
        "共通との違い",
        evt.title,
        '<p class="cfm">元にしたフローが見つかりません。' +
          "データファイルを直接編集した場合に起きます。</p>",
      );
      return;
    }

    const WORD: Record<StepDiff["kind"], string> = {
      same: "同じ",
      changed: "変更",
      added: "追加",
      removed: "削除",
    };

    let no = 0;
    const rows = d.rows
      .map((r) => {
        const st = r.kind === "removed" ? r.base : r.step;
        // 番号はこのフローでの実施順。削除された手順にはこのフローでの位置が無い。
        const n = r.kind === "removed" ? "—" : String(++no);
        const why =
          r.kind === "changed"
            ? changedDetail(db, r)
            : r.kind === "added"
              ? "このフローのために足された手順です"
              : r.kind === "removed"
                ? "共通にはありますが、このフローでは実施しません"
                : "";
        return (
          `<tr class="d-${r.kind}"><td class="num">${n}</td>` +
          `<td><span class="tag">${WORD[r.kind]}</span></td>` +
          `<td><b>${esc(st.title)}</b>` +
          (why ? `<span class="why">${esc(why)}</span>` : "") +
          "</td></tr>"
        );
      })
      .join("");

    // 「元が更新された」は手を打つかどうかの判断を求めるものなので、
    // 検証と同じ帯で出す。ふつうの説明文に混ぜると読み飛ばされる。
    const head =
      // 手を打つかどうかを問うものが先。説明はそのあとでよい。
      (d.outdated
        ? '<div class="msgbar wrn"><svg class="ic lg"><use href="#ic-warn"/></svg>' +
          "<div><b>元のフローが、このあと更新されています</b>" +
          "<span>取り込むかどうかは、下の違いを見て決めてください。" +
          "見たうえで今のままでよければ、「確認した」を押すと印が消えます。" +
          "</span></div></div>"
        : "") +
      '<p class="ins hint" style="margin:10px 0 12px">' +
      `「<b>${esc(d.base.title)}</b>」を元にしています。${esc(diffSummary(d))}。` +
      (d.reordered ? "手順の前後関係も変えてあります。" : "") +
      "</p>";

    openModal(
      "共通との違い",
      evt.title,
      head +
        '<table class="tbl difftbl"><thead><tr>' +
        "<th>#</th><th>状態</th><th>手順</th></tr></thead>" +
        `<tbody>${rows}</tbody></table>`,
      (d.outdated
        ? '<button class="ed-tool" id="diffAck">確認した</button>'
        : "") + '<button class="ed-tool pri" data-x="close">閉じる</button>',
    );

    surfaceFoot()
      .querySelector("#diffAck")
      ?.addEventListener("click", () => void this.ackDiff(evt.key));
  }

  private async ackDiff(key: string): Promise<void> {
    try {
      await this.api.reviewedEvent(key);
      closeModal();
      toast("確認しました");
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "確認を記録できませんでした");
      else throw e;
    }
  }

  private showPaths(): void {
    const evt = this.evt;
    if (!evt) return;
    const r = validate(this.api.db, evt);

    // 目標時間の合計は出さない。手順ごとの目標を足した数は「この経路の重さ」
    // でしかなく、1 営業日の手順が 2 つあるだけで 16 時間を超える。実データの
    // 4 経路がすべて同じ 16 時間 45 分を並べていて、読む人には何も伝わって
    // いなかった。約束した時間は SLA として別に持つ（sla.ts）。
    const rows = r.paths
      .map((p, i) => {
        const keys = Object.keys(p.answers);
        const chips = keys.length
          ? keys
              .map((k) => {
                const c = { key: k, value: p.answers[k] };
                return (
                  `<em style="--c:${optColor(evt, c)}">` +
                  `${esc(optLabel(evt, c))}</em>`
                );
              })
              .join("")
          : '<em style="--c:var(--faint)">分岐なし</em>';
        return (
          `<tr><td class="num">${i + 1}</td>` +
          `<td><div class="pathkey">${chips}</div></td>` +
          `<td class="num">${p.count}</td>` +
          "</tr>"
        );
      })
      .join("");

    openModal(
      "経路一覧",
      `${evt.title} — ${r.paths.length} 経路`,
      '<p class="ins hint" style="margin:0 0 12px">分岐の全組み合わせです。' +
        "対応者は 1 本しか辿りませんが、設計する側は全部を見る必要があります。</p>" +
        '<table class="tbl"><thead><tr><th>#</th><th>回答の組み合わせ</th>' +
        "<th>手順数</th></tr></thead>" +
        `<tbody>${rows}</tbody></table>`,
    );
  }

  private showExport(): void {
    const evt = this.evt;
    if (!evt) return;
    openModal(
      "エクスポート",
      evt.title,
      '<p class="ins hint" style="margin:0 0 12px">下のプレビューは、実際に書き出される HTML を' +
        "そのまま表示しています。外部依存はありません。ファイルをコピーするだけで配れます。</p>" +
        `<iframe class="frame" src="${esc(this.api.exportUrl(this.eventKey))}"></iframe>`,
      `<a class="ed-tool pri" href="${esc(this.api.downloadUrl(this.eventKey))}" download>保存する</a>` +
        '<button class="ed-tool" data-x="close">閉じる</button>',
      // プレビューは中身そのものに幅が要るので、広く開く。
      true,
    );
  }

  // -------------------------------------------------------------------------
  // 配線
  // -------------------------------------------------------------------------

  private bind(): void {
    // 道筋の「フロー」と、その下の戻る矢印。どちらも同じ場所へ帰る。
    for (const id of ["btnBack", "btnBack2"]) {
      $(id).addEventListener("click", () => {
        void this.inspector.flush().then(() => {
          this.stopRun();
          this.onBack();
        });
      });
    }
    $("btnLanes").addEventListener("click", () => {
      const evt = this.evt;
      if (evt) this.laneSettings.open(evt);
    });
    $("btnSLAs").addEventListener("click", () => {
      const evt = this.evt;
      if (evt) this.slaSettings.openForEvent(evt);
    });
    $("btnDiff").addEventListener("click", () => this.showDiff());
    $("btnCheck").addEventListener("click", () => this.showCheck());
    $("btnPaths").addEventListener("click", () => this.showPaths());
    $("btnExport").addEventListener("click", () => this.showExport());

    for (const b of document.querySelectorAll<HTMLElement>(".ed-tabs button")) {
      b.addEventListener("click", () => this.setMode(b.dataset.mode as Mode));
    }

    for (const b of document.querySelectorAll<HTMLElement>("#paneRight .tabs button")) {
      b.addEventListener("click", () => this.setTab(b.dataset.tab ?? "ins"));
    }

    this.bindDrop();
    this.bindSplitters();
    this.bindZoom();

    // 窓の大きさが変わると座標が変わる。線を引き直す。
    window.addEventListener("resize", () => {
      if (this.mode === "edit" && this.evt) this.render();
    });
  }

  /**
   * 図の拡大縮小。
   *
   * 線は図の中の座標で引いてあるので、縮尺を変えても引き直さなくてよい。
   * Ctrl＋ホイールも受ける（図を見ながら手を離さずに変えられる）。
   * Ctrl を押していないホイールは、そのまま縦の送りに任せる。
   */
  private bindZoom(): void {
    // 縮尺を変えると組み直しが起きるので、線は引き直す。
    const change = (f: () => void) => {
      f();
      if (this.mode === "edit" && this.evt) this.render();
    };
    $("zOut").addEventListener("click", () => change(() => stepZoom(-1)));
    $("zIn").addEventListener("click", () => change(() => stepZoom(1)));
    $("zNow").addEventListener("click", () => change(() => setZoom(100)));
    $("canvas").addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault(); // ブラウザ自身の拡大に持っていかれないようにする
        change(() => stepZoom(e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
    applyZoom();
  }

  /**
   * パレットからキャンバスへ落とせるようにする。
   *
   * 落とした列がそのまま担当になり、落とした高さが挿入位置になる。
   * 列がフェーズだった頃は、どこに落としても結果が同じだった（フェーズは対応が
   * 決めるので）。軸を担当に変えたことで、置く動作そのものが意味を持つ。
   */
  private bindDrop(): void {
    const canvas = $("canvas");

    const spotFrom = (e: DragEvent) =>
      dropSpotAt(eventLanes(this.api.db, this.evt), e.clientX, e.clientY);

    // 落とし先の判定に使う寸法は、キャンバスに入ってきたときに測り直す。
    // dragover のたびに測ると、指を動かすあいだずっと配置の計算が走る。
    canvas.addEventListener("dragenter", () => clearDropGeometry());

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
      // 端へ寄せているあいだは図を送る。掴んだまま下まで運べるようにする。
      edgeScroll(e.clientX, e.clientY);
    });
    canvas.addEventListener("dragleave", (e) => {
      // 中の要素をまたぐたびに発火するので、本当に外へ出たときだけ消す。
      if (canvas.contains(e.relatedTarget as Node | null)) return;
      showDropSpot(eventLanes(this.api.db, this.evt), null);
      clearDropGeometry();
      stopEdgeScroll();
    });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const spot = spotFrom(e);
      showDropSpot(eventLanes(this.api.db, this.evt), null);
      clearDropGeometry();
      stopEdgeScroll();
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
   * 送るのは 2 つに分かれる。担当は手順の中身なので更新、順番はフローの中の
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
   * どこを広げたいかは作業のフェーズで変わるので、固定にしない。
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
            this.widths.left = clampPane("left", start.left + (ev.clientX - x0));
          } else {
            this.widths.right = clampPane(
              "right",
              start.right - (ev.clientX - x0),
            );
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
   * 「対応を選んで置く」と「内容を書く」は別の作業なので、画面を分ける。
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

/**
 * ペインの幅を範囲に収める。
 *
 * 下限は 3 か所（ドラッグ中・保存済みの読み込み・既定）で使う。
 * 別々に書くと、下限を上げたときに読み込み側だけ古いままになり、
 * 「前に狭くしたときの幅」が残り続ける。1 か所にまとめる。
 */
/** 「2026年9月5日 11:40」。秒までは要らない。 */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

function clampPane(side: keyof typeof PANE_LIMITS, v: number): number {
  const { min, max } = PANE_LIMITS[side];
  return Math.max(min, Math.min(max, v));
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
      // 下限を上げたので、前に狭くしてあった幅はここで引き上げられる。
      return {
        left: clampPane("left", Number(v.left) || DEFAULT_WIDTHS.left),
        right: clampPane("right", Number(v.right) || DEFAULT_WIDTHS.right),
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
