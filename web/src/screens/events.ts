/**
 * 事象ウィンドウ。ここが入口。
 *
 * 登録済みの事象を並べ、開くか、作るか、複製するか、書き出すかを選ぶ。
 * タブにしないのは、事象を選んでから編集に入るという流れが一方向だから。
 */

import { Api, ApiError } from "../api";
import { $, esc, onAction } from "../dom";
import { phaseDist, validate } from "../flow";
import type { EventFlow, Severity } from "../types";
import { askModal, confirmModal, openModal, showApiError, toast } from "../ui";

export interface EventsScreenDeps {
  api: Api;
  /** 事象を開く。編集ビューへ移る。 */
  onOpen: (key: string) => void;
}

export class EventsScreen {
  private readonly api: Api;
  private readonly onOpen: (key: string) => void;

  constructor(deps: EventsScreenDeps) {
    this.api = deps.api;
    this.onOpen = deps.onOpen;
    this.bind();
  }

  render(): void {
    const db = this.api.db;
    const grid = $("ewGrid");
    $("ewCount").textContent = `${db.events.length} 件`;

    grid.innerHTML =
      db.events.map((ev) => this.card(ev)).join("") +
      '<button class="ew-new" data-a="new"><u>＋</u>新しい事象を作る</button>';

    $("ewNote").innerHTML =
      "<b>タスクは事象をまたいで再利用される部品です。</b>" +
      "段階・タスク・連絡先を 1 か所で持ち、事象はそれらの組み合わせとして作ります。" +
      "データはこの端末の JSON ファイルにのみ保存され、外部には送信されません。";
  }

  /** 事象 1 件のカード。 */
  private card(ev: EventFlow): string {
    const db = this.api.db;
    const v = validate(ev);
    const dist = phaseDist(db, ev);

    const bar = dist
      .map((d) => `<i style="background:${esc(d.p.color)};flex:${d.n}"></i>`)
      .join("");
    const legend = dist
      .map(
        (d) =>
          `<span><i style="background:${esc(d.p.color)}"></i>${esc(d.p.name)} ${d.n}</span>`,
      )
      .join("");

    return (
      `<div class="ew-card" data-a="open" data-key="${esc(ev.key)}">` +
      `<div class="ew-hd"><span class="sev ${esc(ev.severity)}">${esc(ev.severity)}</span>` +
      `<b>${esc(ev.title)}</b></div>` +
      `<p class="ew-sub">${esc(ev.sub || "（説明なし）")}</p>` +
      `<div class="ew-bar">${bar}</div>` +
      `<div class="ew-dist">${legend}</div>` +
      '<div class="ew-meta">' +
      `<span>${ev.steps.length} 手順</span>` +
      `<span>${v.paths.length} 経路</span>` +
      `<span class="${v.issues.length ? "ng" : "ok"}">` +
      `${v.issues.length ? `検証 ${v.issues.length} 件` : "検証 OK"}</span></div>` +
      '<div class="ew-acts">' +
      `<button data-a="open" data-key="${esc(ev.key)}">開く</button>` +
      `<button data-a="dup" data-key="${esc(ev.key)}">複製</button>` +
      `<button data-a="exp" data-key="${esc(ev.key)}">書き出し</button>` +
      `<button data-a="del" data-key="${esc(ev.key)}" class="dg">削除</button>` +
      "</div></div>"
    );
  }

  private bind(): void {
    // カードは描き直すたびに作り直されるので、親で受ける。
    onAction($("ewGrid"), (action, target, ev) => {
      const key = target.dataset.key ?? "";
      if (action !== "open") ev.stopPropagation();
      switch (action) {
        case "open":
          this.onOpen(key);
          break;
        case "new":
          void this.create();
          break;
        case "dup":
          void this.duplicate(key);
          break;
        case "exp":
          this.showExport(key);
          break;
        case "del":
          void this.remove(key);
          break;
      }
    });

    $("ewExportAll").addEventListener("click", () => this.showExport());
  }

  // -------------------------------------------------------------------------

  private async create(): Promise<void> {
    const v = await askModal({
      title: "新しい事象",
      sub: "対応フローを 1 本作ります",
      okLabel: "作成",
      fields: [
        {
          k: "title",
          label: "事象名",
          required: true,
          placeholder: "ランサムウェアの疑い",
        },
        {
          k: "sub",
          label: "説明",
          placeholder: "大量のファイル暗号化・拡張子変更を検知",
        },
        {
          k: "severity",
          label: "重大度",
          type: "select",
          value: "S2",
          options: [
            { v: "S1", l: "S1 — 重大" },
            { v: "S2", l: "S2 — 高" },
            { v: "S3", l: "S3 — 中" },
          ],
        },
      ],
    });
    if (!v) return;

    try {
      const created = await this.api.createEvent({
        title: v.title,
        sub: v.sub,
        severity: v.severity as Severity,
      });
      toast(`「${v.title}」を作りました`);
      if (created) this.onOpen(created.key);
    } catch (e) {
      this.fail(e, "事象の作成");
    }
  }

  private async duplicate(key: string): Promise<void> {
    try {
      const dup = await this.api.duplicateEvent(key);
      toast(dup ? `「${dup.title}」を作りました` : "複製しました");
    } catch (e) {
      this.fail(e, "事象の複製");
    }
  }

  private async remove(key: string): Promise<void> {
    const ev = this.api.db.events.find((e) => e.key === key);
    if (!ev) return;

    const ok = await confirmModal({
      title: "事象を削除",
      sub: ev.title,
      danger: true,
      okLabel: "削除する",
      message:
        `<p><b>${esc(ev.title)}</b> と、その ${ev.steps.length} 手順を削除します。</p>` +
        "<p class=\"hint\">タスクや連絡先は部品なので消えません。" +
        "この事象での組み合わせだけが失われます。取り消せません。</p>",
    });
    if (!ok) return;

    try {
      await this.api.deleteEvent(key);
      toast(`「${ev.title}」を削除しました`);
    } catch (e) {
      this.fail(e, "事象の削除");
    }
  }

  /** 書き出しのプレビュー。実際に配る HTML をそのまま表示する。 */
  private showExport(key?: string): void {
    const ev = key ? this.api.db.events.find((e) => e.key === key) : undefined;
    const url = this.api.exportUrl(key);

    openModal(
      "書き出し",
      ev ? ev.title : `全 ${this.api.db.events.length} 事象`,
      '<p class="ins hint" style="margin:0 0 12px">下のプレビューは、実際に書き出される HTML を' +
        "そのまま表示しています。外部依存はありません。ファイルをコピーするだけで配れます。</p>" +
        `<iframe class="frame" src="${esc(url)}"></iframe>`,
      `<a class="ed-tool pri" href="${esc(this.api.downloadUrl(key))}" download>保存する</a>` +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}
