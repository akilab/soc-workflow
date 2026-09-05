/**
 * インスペクタ。選んだ手順の中身を書くところ。
 *
 * # 入力のたびに画面を作り直さない
 *
 * 文字を打つたびに保存すると、応答で全データを取り直すことになる。取り直すと
 * 画面が作り直され、入力中の欄からフォーカスが外れる。これを避けるために、
 *
 *  1. 手元のデータを先に書き換える（画面の見た目はすぐ追いつく）
 *  2. アウトラインとキャンバスだけ描き直す。インスペクタには触らない
 *  3. 400ms のあいだ入力が止まったら、まとめてサーバへ送る（quiet 指定）
 *
 * 構造が変わる操作——条件の追加、判断の解除、連絡先の変更、削除——は
 * その場で送り、全体を描き直す。こちらは入力の途中ではないので作り直してよい。
 *
 * 送る前に画面を離れる操作（別の手順を選ぶ、モードを切り替える、フローを閉じる）が
 * あるので、それらの前に flush() を呼ぶ。
 */

import { Api, ApiError, stepInput as toInput } from "./api";
import type { WriteOptions } from "./api";
import { OPTION_COLORS } from "./branch";
import { $, esc } from "./dom";
import { groupVias, stepContacts, viaMark } from "./contacts";
import { eventLanes, taskOf } from "./flow";
import { milestoneField } from "./sla";
import type { Decision, EventFlow, Severity, Step } from "./types";
import {
  askModal,
  closeModal,
  confirmModal,
  openModal,
  showApiError,
  surfaceBody,
  surfaceFoot,
  toast,
} from "./ui";

/** 入力が止まってから送るまでの待ち時間。サーバ側の書き出しの間隔と揃える。 */
const SAVE_DELAY = 400;

export interface InspectorDeps {
  api: Api;
  /** いま選ばれている手順 ID。 */
  selected: () => string[];
  /** 選択を差し替える。複製したあと、その手順に移るために使う。 */
  select: (ids: string[]) => void;
  /** 全体を描き直す（インスペクタを含む）。 */
  renderAll: () => void;
  /** アウトラインとキャンバスだけ描き直す。入力中に使う。 */
  renderFlow: () => void;
}

export class Inspector {
  private readonly d: InspectorDeps;

  /** 保存待ちのタイマー。 */
  private timer: number | undefined;
  /** 保存待ちの手順。画面を離れるときに送り切るために覚えておく。 */
  private dirty: { eventKey: string; step: Step } | null = null;

  constructor(deps: InspectorDeps) {
    this.d = deps;
  }

  private get db() {
    return this.d.api.db;
  }

  // -------------------------------------------------------------------------
  // 保存
  // -------------------------------------------------------------------------

  /** 保存待ちがあれば送り切る。画面を離れる操作の前に呼ぶ。 */
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const d = this.dirty;
    this.dirty = null;
    if (!d) return;
    await this.send(d.eventKey, d.step, { quiet: true });
  }

  /** 手元を書き換えたあとに呼ぶ。少し待ってから送る。 */
  private queue(eventKey: string, step: Step): void {
    this.dirty = { eventKey, step };
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY);
  }

  private async send(
    eventKey: string,
    st: Step,
    opts?: WriteOptions,
  ): Promise<void> {
    try {
      await this.d.api.updateStep(eventKey, st.id, toInput(st), opts);
      this.setUnsaved(null);
    } catch (e) {
      await this.saveFailed(e, eventKey, st);
    }
  }

  /**
   * 保存に失敗したときの後始末。
   *
   * 失敗には 2 種類あり、扱いを変える必要がある。
   *
   *   サーバに繋がらない（status 0）
   *     … 内容は正しいのに届いていないだけ。手元の編集を消してはいけない。
   *       警告を出したまま残し、再試行できるようにする。
   *   サーバに断られた（4xx）
   *     … 内容が正しくない。手元が間違っているので、取り直して真実を見せる。
   *
   * 以前はどちらの場合も取り直していた。繋がらないときは利用者の書いた内容が
   * 黙って消え、しかも取り直しそのものも失敗して未処理の例外になっていた。
   */
  private async saveFailed(
    e: unknown,
    eventKey: string,
    st: Step,
  ): Promise<void> {
    const offline = e instanceof ApiError && e.status === 0;
    this.fail(e, "手順の保存");

    if (offline) {
      this.setUnsaved({ eventKey, step: st });
      return;
    }
    this.setUnsaved(null);
    try {
      await this.d.api.load();
    } catch {
      // 取り直しも失敗した。画面はそのままにして、警告だけ残す。
      this.setUnsaved({ eventKey, step: st });
    }
  }

  /**
   * 保存できていないことを画面に出しておく。
   *
   * トーストだけだと 2.6 秒で消える。手順を設計している最中に、書いた内容が
   * 保存されていないことに気づけないのは困る。消えない帯を出し、再試行させる。
   */
  private setUnsaved(pending: { eventKey: string; step: Step } | null): void {
    this.unsaved = pending;

    const bar = document.getElementById("insWarn");
    if (!bar) return;
    if (!pending) {
      bar.className = "savewarn";
      bar.innerHTML = "";
      return;
    }
    bar.className = "savewarn on";
    bar.innerHTML =
      "<b>保存できていません</b>" +
      "<span>サーバに繋がりません。書いた内容はこの画面に残っています。" +
      "サーバを確認してから、再試行してください。</span>" +
      '<button id="insRetry">再試行</button>';
    document.getElementById("insRetry")?.addEventListener("click", () => {
      void this.send(pending.eventKey, pending.step, { quiet: true });
    });
  }

  /** 保存できていない変更。あるあいだは警告の帯を出しておく。 */
  private unsaved: { eventKey: string; step: Step } | null = null;

  /** 構造が変わる操作。その場で送り、全体を描き直す。 */
  private async apply(
    eventKey: string,
    st: Step,
    change: () => void,
  ): Promise<void> {
    await this.flush(); // 打ちかけの文字を先に送る
    change();
    await this.send(eventKey, st);
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  render(evt: EventFlow): void {
    const box = $("ins");
    const ids = this.d.selected();

    // 帯はインスペクタの外にあるので描き直しでは消えないが、
    // 再試行のボタンを繋ぎ直すために毎回作り直す。
    this.setUnsaved(this.unsaved);

    if (ids.length > 1) {
      this.renderBulk(evt, box, ids);
      return;
    }
    const st = evt.steps.find((s) => s.id === ids[0]);
    if (!st) {
      this.renderEvent(evt, box);
      return;
    }
    this.renderStep(evt, box, st);
  }

  // --- 手順を選んでいないとき: フローそのもの --------------------------------

  private renderEvent(evt: EventFlow, box: HTMLElement): void {
    box.innerHTML =
      `<label>フロー名</label><input type="text" id="i_title" value="${esc(evt.title)}">` +
      `<label>補足</label><input type="text" id="i_sub" value="${esc(evt.sub)}">` +
      `<label>重大度</label><select id="i_sev">` +
      (["S1", "S2", "S3"] as Severity[])
        .map(
          (v) =>
            `<option value="${v}"${evt.severity === v ? " selected" : ""}>${v}</option>`,
        )
        .join("") +
      "</select>" +
      '<p class="hint">キャンバスのボックス、または左のアウトラインの行を選ぶと、' +
      "その手順の内容を編集できます。<br>手順を足すには「対応パレット」タブへ。" +
      "<br>複製と削除はフロー一覧で行います。</p>";

    const saveEvent = () => {
      void this.d.api
        .updateEvent(
          evt.key,
          { title: evt.title, sub: evt.sub, severity: evt.severity },
          { quiet: true },
        )
        .catch((e: unknown) => this.fail(e, "フローの保存"));
    };
    let t: number | undefined;
    const queued = () => {
      clearTimeout(t);
      t = window.setTimeout(saveEvent, SAVE_DELAY);
    };

    on<HTMLInputElement>("i_title", "input", (el) => {
      evt.title = el.value;
      this.d.renderFlow();
      queued();
    });
    on<HTMLInputElement>("i_sub", "input", (el) => {
      evt.sub = el.value;
      queued();
    });
    on<HTMLSelectElement>("i_sev", "change", (el) => {
      evt.severity = el.value as Severity;
      this.d.renderFlow();
      saveEvent();
    });
  }

  // --- 複数選択 -------------------------------------------------------------

  private renderBulk(evt: EventFlow, box: HTMLElement, ids: string[]): void {
    const picked = evt.steps.filter((s) => ids.includes(s.id));

    box.innerHTML =
      `<div class="bulk"><h4>${picked.length} 手順を選択中</h4>` +
      "<p>まとめて条件を付ける／外す、まとめて削除ができます。" +
      "Ctrl＋クリックで足し引き、Shift＋クリックで範囲選択。</p>" +
      "<ol>" +
      picked
        .map(
          (s) =>
            `<li value="${evt.steps.indexOf(s) + 1}">${esc(s.title)}</li>`,
        )
        .join("") +
      "</ol>" +
      '<div class="act">' +
      '<button id="b_cond">表示条件をまとめて設定する</button>' +
      '<button id="b_del" class="dgr">まとめて削除する</button>' +
      '<button id="b_clr">選択を解除する</button></div></div>';

    on("b_cond", "click", () => void this.bulkCondition(evt, picked));
    on("b_del", "click", () => void this.bulkDelete(evt, picked));
    on("b_clr", "click", () => {
      this.d.select([]);
      this.d.renderAll();
    });
  }

  private async bulkCondition(evt: EventFlow, picked: Step[]): Promise<void> {
    // 選んだ手順のうち一番前のものより、さらに前にある判断だけが使える。
    const first = Math.min(...picked.map((s) => evt.steps.indexOf(s)));
    const priors = evt.steps
      .slice(0, first)
      .map((s) => s.decision)
      .filter((d): d is Decision => !!d);

    if (!priors.length) {
      toast("選択した手順より前に判断がありません", true);
      return;
    }

    const options = [{ v: "", l: "条件なし（常に表示）" }];
    for (const d of priors) {
      for (const o of d.options) {
        options.push({ v: `${d.key}=${o.value}`, l: `${d.label} → ${o.label}` });
      }
    }

    const v = await askModal({
      title: "表示条件をまとめて設定",
      sub: `${picked.length} 手順`,
      okLabel: "設定する",
      fields: [
        {
          k: "cond",
          label: "条件",
          type: "select",
          value: "",
          options,
          hint: "選択した手順の表示条件を、この内容で置き換えます。",
        },
      ],
    });
    if (!v) return;

    const conds = v.cond
      ? [{ key: v.cond.split("=")[0], value: v.cond.split("=")[1] }]
      : [];

    await this.flush();
    try {
      // 1 件ずつ送り、取り直しは最後に 1 回だけ。途中で画面が何度も作り直されない。
      for (const st of picked) {
        st.conditions = conds.map((c) => ({ ...c }));
        await this.d.api.updateStep(evt.key, st.id, toInput(st), { quiet: true });
      }
      await this.d.api.load();
      toast(`${picked.length} 手順の条件を${v.cond ? "設定しました" : "外しました"}`);
    } catch (e) {
      this.fail(e, "条件の設定");
      await this.d.api.load();
    }
  }

  private async bulkDelete(evt: EventFlow, picked: Step[]): Promise<void> {
    // 選択の外から参照されている判断が含まれていないか。
    // サーバも断るが、消す前に何が起きるかを見せる。
    const ids = new Set(picked.map((s) => s.id));
    const breaks: string[] = [];
    for (const s of picked) {
      if (!s.decision) continue;
      for (const x of evt.steps) {
        if (ids.has(x.id)) continue;
        if ((x.conditions ?? []).some((c) => c.key === s.decision!.key)) {
          breaks.push(x.title);
        }
      }
    }

    const ok = await confirmModal({
      title: "手順をまとめて削除",
      sub: `${picked.length} 手順`,
      danger: true,
      okLabel: "削除する",
      message:
        "次の手順を削除します。<ul>" +
        picked.map((s) => `<li>${esc(s.title)}</li>`).join("") +
        "</ul>" +
        (breaks.length
          ? `<p><em>削除する判断を参照している手順が ${breaks.length} 件あります。</em>` +
            "先にそちらの条件を外さないと、削除は断られます。</p>"
          : ""),
    });
    if (!ok) return;

    await this.flush();
    try {
      // 後ろから消す。前から消すと、残りの手順の位置がずれていく。
      for (const st of [...picked].reverse()) {
        await this.d.api.deleteStep(evt.key, st.id, { quiet: true });
      }
      this.d.select([]);
      await this.d.api.load();
      toast("削除しました");
    } catch (e) {
      this.fail(e, "手順の削除");
      await this.d.api.load();
    }
  }

  // --- 手順 1 つ ------------------------------------------------------------

  private renderStep(evt: EventFlow, box: HTMLElement, st: Step): void {
    const db = this.db;
    const task = taskOf(db, st.task);
    const phase = db.phases.find((p) => p.key === task?.phase);

    box.innerHTML =
      `<div class="taskref" style="--pc:${phase?.color ?? "var(--line)"}">` +
      `<b>${esc(task?.label ?? "（不明な対応）")}</b>` +
      `${esc(phase?.name ?? "")} / ${esc(task?.note ?? "")}</div>` +
      `<label>手順のタイトル</label><input type="text" id="s_title" value="${esc(st.title)}">` +
      `<label>詳細</label><textarea id="s_detail">${esc(st.detail)}</textarea>` +
      '<p class="hint">&lt;code&gt; で囲んだ部分は強調表示されます。</p>' +
      '<div class="row"><div><label>担当</label><select id="s_lane">' +
      eventLanes(db, evt)
        .map(
          (l) =>
            `<option value="${esc(l.key)}"${st.lane === l.key ? " selected" : ""}>` +
            `${esc(l.name)}</option>`,
        )
        .join("") +
      "</select></div>" +
      "<div><label>目標時間</label>" +
      `<input type="text" id="s_sla" placeholder="15分 / 即時" value="${esc(st.sla)}"></div></div>` +
      '<p class="hint">担当を変えると、フロー図でこの手順が別の列へ移ります。<br>' +
      "目標時間はこの手順ひとつぶんです。約束した時間（SLA）は別に持ちます。</p>" +
      '<label class="chk" style="margin-top:12px"><input type="checkbox" id="s_esc"' +
      `${st.escalate ? " checked" : ""}>エスカレーション判断が必要</label>` +
      this.contactsHTML(st) +
      this.conditionsHTML(evt, st) +
      this.decisionHTML(st) +
      milestoneField(this.db, st) +
      '<button class="del" id="s_dup">この手順を複製する</button>' +
      '<button class="del" id="s_del">この手順を削除する</button>';

    // --- 文字の入力。手元を書き換え、図だけ更新し、少し待ってから送る ---
    on<HTMLInputElement>("s_title", "input", (el) => {
      st.title = el.value;
      this.d.renderFlow();
      this.queue(evt.key, st);
    });
    on<HTMLTextAreaElement>("s_detail", "input", (el) => {
      st.detail = el.value;
      this.queue(evt.key, st);
    });
    on<HTMLInputElement>("s_sla", "input", (el) => {
      st.sla = el.value;
      this.d.renderFlow();
      this.queue(evt.key, st);
    });

    // --- 選び直し。すぐ送る ---
    // 到達点の印。押したときに付き、× で外す（判断ステップと同じ形）。
    on<HTMLElement>("s_msAdd", "click", () => {
      const first = (this.db.slas ?? [])[0];
      if (!first) return;
      this.apply(evt.key, st, () => {
        st.milestone = first.key;
      });
    });
    on<HTMLElement>("s_msDel", "click", () => {
      this.apply(evt.key, st, () => {
        st.milestone = "";
      });
    });
    on<HTMLSelectElement>("s_ms", "change", (el) => {
      this.apply(evt.key, st, () => {
        st.milestone = el.value;
      });
    });
    on<HTMLSelectElement>("s_lane", "change", (el) => {
      void this.apply(evt.key, st, () => {
        st.lane = el.value;
      });
    });
    on<HTMLInputElement>("s_esc", "change", (el) => {
      void this.apply(evt.key, st, () => {
        st.escalate = el.checked;
      });
    });

    this.bindContacts(evt, st, box);
    this.bindConditions(evt, st, box);
    this.bindDecision(evt, st, box);

    on("s_dup", "click", () => void this.duplicate(evt, st));
    on("s_del", "click", () => void this.remove(evt, st));
  }

  // --- 連絡先 ---------------------------------------------------------------

  private contactsHTML(st: Step): string {
    const groups = stepContacts(this.db, st);
    const rows = groups.length
      ? groups
          .map((g) => {
            const kind = KIND[g.kind];
            const lane = this.db.lanes.find((l) => l.key === g.lane);
            const marks = groupVias(g)
              .map((v) => {
                const d = VIA[v] ?? { m: "?", c: "#7d8798" };
                return `<i${d.ico ? ' class="ico"' : ""} style="--vc:${d.c}">${viaMark(d)}</i>`;
              })
              .join("");
            return (
              '<div class="ct-row">' +
              `<span class="vs">${marks}</span>` +
              `<b>${esc(g.name)}</b>` +
              `<span>${(g.members ?? []).length} 名` +
              (kind ? ` / ${kind.l}` : "") +
              (lane ? ` → ${esc(lane.name)}` : "") +
              "</span>" +
              `<button class="x" data-ctrm="${esc(g.key)}">&times;</button></div>`
            );
          })
          .join("")
      : '<p class="hint" style="margin:0">連絡先はありません。</p>';

    return (
      '<div class="sect ct"><h4>連絡先 <button class="x" id="ct_add">＋</button></h4>' +
      rows +
      '<p class="hint">テストモードと書き出し HTML では、グループのメンバーが' +
      "<b>連絡順に</b>手順の中に表示されます。" +
      "担当が設定されているグループは、フロー図でその列へ矢印が伸びます。" +
      "グループとメンバーの編集は「連絡先」画面で行います。</p></div>"
    );
  }

  private bindContacts(evt: EventFlow, st: Step, box: HTMLElement): void {
    on("ct_add", "click", () => void this.pickContacts(evt, st));
    for (const b of box.querySelectorAll<HTMLElement>("[data-ctrm]")) {
      b.addEventListener("click", () => {
        const key = b.dataset.ctrm!;
        void this.apply(evt.key, st, () => {
          st.contacts = (st.contacts ?? []).filter((k) => k !== key);
        });
      });
    }
  }

  /** 手順で連絡する相手を選ぶ。連絡先そのものの編集は「連絡先」画面。 */
  private async pickContacts(evt: EventFlow, st: Step): Promise<void> {
    const groups = this.db.contactGroups;
    if (!groups.length) {
      toast("連絡先が登録されていません", true);
      return;
    }

    const html =
      '<p class="ins hint" style="margin:0 0 12px">この手順で連絡するグループを選びます。' +
      "メンバーは連絡順に、テストモードと書き出し HTML で手順の中に表示されます。</p>" +
      '<div class="ctpick">' +
      groups
        .map((g) => {
          const kind = KIND[g.kind];
          const ms = g.members ?? [];
          const marks = groupVias(g)
            .map((v) => {
              const d = VIA[v] ?? { m: "?", c: "#7d8798" };
              return `<i${d.ico ? ' class="ico"' : ""} style="--vc:${d.c}">${viaMark(d)}</i>`;
            })
            .join("");
          return (
            '<label class="ctp">' +
            `<input type="checkbox" value="${esc(g.key)}"` +
            `${(st.contacts ?? []).includes(g.key) ? " checked" : ""}>` +
            `<span class="vs">${marks}</span>` +
            `<b>${esc(g.name)}</b>` +
            `<span>${ms.slice(0, 3).map((m) => esc(m.name)).join("、")}` +
            (ms.length > 3 ? ` 他 ${ms.length - 3} 名` : "") +
            "</span>" +
            (kind ? `<em style="--kc:${kind.c}">${kind.l}</em>` : "") +
            "</label>"
          );
        })
        .join("") +
      "</div>";

    openModal(
      "連絡先を選ぶ",
      st.title,
      html,
      '<button class="ed-tool" data-x="cancel">キャンセル</button>' +
        '<button class="ed-tool pri" data-x="ok">決定</button>',
    );

    const foot = surfaceFoot();
    foot
      .querySelector('[data-x="cancel"]')
      ?.addEventListener("click", closeModal);
    foot.querySelector('[data-x="ok"]')?.addEventListener("click", () => {
      const picked: string[] = [];
      for (const g of groups) {
        const cb = surfaceBody().querySelector<HTMLInputElement>(
          `input[value="${CSS.escape(g.key)}"]`,
        );
        if (cb?.checked) picked.push(g.key);
      }
      closeModal();
      void this.apply(evt.key, st, () => {
        st.contacts = picked;
      }).then(() =>
        toast(
          picked.length
            ? `${picked.length} 件の連絡先を設定しました`
            : "連絡先を外しました",
        ),
      );
    });
  }

  // --- 表示条件 -------------------------------------------------------------

  /** この手順より前にある判断だけが、条件に使える。 */
  private priorDecisions(evt: EventFlow, st: Step): Decision[] {
    const at = evt.steps.indexOf(st);
    if (at < 0) return [];
    return evt.steps
      .slice(0, at)
      .map((s) => s.decision)
      .filter((d): d is Decision => !!d);
  }

  private conditionsHTML(evt: EventFlow, st: Step): string {
    const priors = this.priorDecisions(evt, st);

    const rows = (st.conditions ?? [])
      .map((c, ci) => {
        let opts = priors
          .map(
            (d) =>
              `<optgroup label="${esc(d.label)}">` +
              d.options
                .map((o) => {
                  const v = `${d.key}=${o.value}`;
                  const on = c.key === d.key && c.value === o.value;
                  return `<option value="${esc(v)}"${on ? " selected" : ""}>${esc(o.label)}</option>`;
                })
                .join("") +
              "</optgroup>",
          )
          .join("");
        if (!priors.some((d) => d.key === c.key)) {
          opts =
            `<option selected>${esc(`${c.key}=${c.value}`)}（前方に判断がありません）</option>` +
            opts;
        }
        return (
          `<div class="cond"><select data-ci="${ci}">${opts}</select>` +
          `<button class="x" data-rm="${ci}">&times;</button></div>`
        );
      })
      .join("");

    return (
      '<div class="sect"><h4>表示条件（AND）</h4>' +
      (rows || '<p class="hint" style="margin:0 0 7px">常に表示されます。</p>') +
      `<button class="mini" id="c_add"${priors.length ? "" : " disabled"}>` +
      (priors.length ? "＋ 条件を追加" : "この手順より前に判断がありません") +
      "</button></div>"
    );
  }

  private bindConditions(evt: EventFlow, st: Step, box: HTMLElement): void {
    const priors = this.priorDecisions(evt, st);

    on("c_add", "click", () => {
      if (!priors.length) return;
      void this.apply(evt.key, st, () => {
        st.conditions = [
          ...(st.conditions ?? []),
          { key: priors[0].key, value: priors[0].options[0].value },
        ];
      });
    });

    for (const sel of box.querySelectorAll<HTMLSelectElement>("[data-ci]")) {
      sel.addEventListener("change", () => {
        const ci = Number(sel.dataset.ci);
        const [key, value] = sel.value.split("=");
        void this.apply(evt.key, st, () => {
          st.conditions = st.conditions.map((c, i) =>
            i === ci ? { key, value } : c,
          );
        });
      });
    }
    for (const b of box.querySelectorAll<HTMLElement>("[data-rm]")) {
      b.addEventListener("click", () => {
        const ci = Number(b.dataset.rm);
        void this.apply(evt.key, st, () => {
          st.conditions = st.conditions.filter((_, i) => i !== ci);
        });
      });
    }
  }

  // --- 判断ステップ ---------------------------------------------------------

  private decisionHTML(st: Step): string {
    if (!st.decision) {
      return '<button class="mini" id="d_make" style="margin-top:13px">◆ この手順を判断ステップにする</button>';
    }
    const d = st.decision;
    // 回答キーは出さない。画面のどこにも人向けの文字として現れず、利用者に
    // とっての識別子は質問文のほうだから。JSON を直に読むときのために、
    // 見出しの title にだけ入れておく。
    return (
      `<div class="sect" title="回答キー: ${esc(d.key)}">` +
      '<h4>判断ステップ <button class="x" id="d_del">&times;</button></h4>' +
      `<label>質問文</label><input type="text" id="d_label" value="${esc(d.label)}">` +
      '<label>選択肢</label><div id="d_opts">' +
      d.options
        .map(
          (o, oi) =>
            `<div class="opt"><i style="background:${OPTION_COLORS[oi % OPTION_COLORS.length]}"></i>` +
            `<input type="text" data-oi="${oi}" value="${esc(o.label)}">` +
            `<button class="x" data-ormv="${oi}">&times;</button></div>`,
        )
        .join("") +
      '</div><button class="mini" id="d_add">＋ 選択肢を追加</button>' +
      '<p class="hint">判断ステップには完了ボタンを出しません。回答しないと先へ進めません。<br>' +
      "この判断より後ろの手順に、答えごとの表示条件を付けられます。</p></div>"
    );
  }

  private bindDecision(evt: EventFlow, st: Step, box: HTMLElement): void {
    on("d_make", "click", () => {
      void this.apply(evt.key, st, () => {
        st.decision = {
          key: uniqueDecisionKey(evt),
          label: "判定結果はどちらですか？",
          options: [
            { value: "yes", label: "はい" },
            { value: "no", label: "いいえ" },
          ],
        };
      });
    });

    on("d_del", "click", () => void this.removeDecision(evt, st));

    on<HTMLInputElement>("d_label", "input", (el) => {
      if (!st.decision) return;
      st.decision.label = el.value;
      this.d.renderFlow();
      this.queue(evt.key, st);
    });

    on("d_add", "click", () => {
      void this.apply(evt.key, st, () => {
        const d = st.decision!;
        d.options = [
          ...d.options,
          { value: `o${d.options.length + 1}`, label: "新しい選択肢" },
        ];
      });
    });

    for (const inp of box.querySelectorAll<HTMLInputElement>("[data-oi]")) {
      inp.addEventListener("input", () => {
        if (!st.decision) return;
        st.decision.options[Number(inp.dataset.oi)].label = inp.value;
        this.d.renderFlow();
        this.queue(evt.key, st);
      });
    }
    for (const b of box.querySelectorAll<HTMLElement>("[data-ormv]")) {
      b.addEventListener("click", () => {
        const d = st.decision;
        if (!d) return;
        if (d.options.length <= 2) {
          toast("選択肢は 2 つ以上必要です", true);
          return;
        }
        const oi = Number(b.dataset.ormv);
        void this.apply(evt.key, st, () => {
          d.options = d.options.filter((_, i) => i !== oi);
        });
      });
    }
  }

  private async removeDecision(evt: EventFlow, st: Step): Promise<void> {
    const d = st.decision;
    if (!d) return;

    const used = evt.steps.filter((s) =>
      (s.conditions ?? []).some((c) => c.key === d.key),
    );

    if (used.length) {
      const ok = await confirmModal({
        title: "判断ステップを解除",
        sub: d.label,
        danger: true,
        okLabel: "解除する",
        message:
          `この判断を参照している手順が <em>${used.length} 件</em>あります。` +
          "<ul>" +
          used.map((s) => `<li>${esc(s.title)}</li>`).join("") +
          "</ul>" +
          "解除すると、これらは条件なし（常に表示）になります。",
      });
      if (!ok) return;
    }

    await this.flush();
    try {
      // 参照している側の条件を先に外す。判断を先に消すとサーバが断る。
      for (const s of used) {
        s.conditions = s.conditions.filter((c) => c.key !== d.key);
        await this.d.api.updateStep(evt.key, s.id, toInput(s), { quiet: true });
      }
      st.decision = null;
      await this.d.api.updateStep(evt.key, st.id, toInput(st));
    } catch (e) {
      this.fail(e, "判断の解除");
      await this.d.api.load();
    }
  }

  // --- 複製・削除 -----------------------------------------------------------

  private async duplicate(evt: EventFlow, st: Step): Promise<void> {
    await this.flush();
    try {
      const dup = await this.d.api.duplicateStep(evt.key, st.id);
      if (dup) {
        this.d.select([dup.id]);
        this.d.renderAll();
        const inp = document.getElementById("s_title") as HTMLInputElement | null;
        inp?.focus();
        inp?.select();
      }
      toast("複製しました。名称を書き換えてください");
    } catch (e) {
      this.fail(e, "手順の複製");
    }
  }

  private async remove(evt: EventFlow, st: Step): Promise<void> {
    await this.flush();
    const ok = await confirmModal({
      title: "手順を削除",
      sub: st.title,
      danger: true,
      okLabel: "削除する",
      message: `<p><b>${esc(st.title)}</b> を削除します。取り消せません。</p>`,
    });
    if (!ok) return;

    try {
      await this.d.api.deleteStep(evt.key, st.id);
      this.d.select([]);
    } catch (e) {
      this.fail(e, "手順の削除");
    }
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}

// ---------------------------------------------------------------------------

/** そのフローで使われていない判断のキーを作る。 */
function uniqueDecisionKey(evt: EventFlow): string {
  const used = new Set(
    evt.steps.filter((s) => s.decision).map((s) => s.decision!.key),
  );
  for (let i = 1; ; i++) {
    const k = `q${i}`;
    if (!used.has(k)) return k;
  }
}

/** id の要素にひとつだけ処理を付ける。要素が無ければ何もしない。 */
function on<T extends HTMLElement = HTMLElement>(
  id: string,
  type: string,
  fn: (el: T) => void,
): void {
  const el = document.getElementById(id) as T | null;
  el?.addEventListener(type, () => fn(el));
}
