/**
 * フロー一覧。ここが入口。
 *
 * 登録済みのフローを並べ、開くか、作るか、複製するか、書き出すかを選ぶ。
 * タブにしないのは、フローを選んでから編集に入るという流れが一方向だから。
 */

import { Api, ApiError } from "../api";
import { derivedOf, diffFrom, diffSummary } from "../derive";
import { $, esc, onAction } from "../dom";
import { phaseDist, validate } from "../flow";
import type { EventFlow, Severity } from "../types";
import { askModal, confirmModal, openModal, showApiError, toast } from "../ui";

export interface EventsScreenDeps {
  api: Api;
  /** フローを開く。編集ビューへ移る。 */
  onOpen: (key: string) => void;
}

/** 重大度の言い方。Defender と同じく、記号だけでなく言葉も出す。 */
const SEV_WORD: Record<Severity, string> = { S1: "高", S2: "中", S3: "低" };

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
    $("ewCount").textContent = `${db.events.length} 件のフロー`;

    // 一覧は表にする。カードより上下に並べて比べやすく、Defender の一覧と同じ形。
    grid.innerHTML = db.events.length
      ? '<table class="tbl flowtbl"><thead><tr>' +
        "<th>フロー名</th><th>重大度</th><th>手順</th><th>経路</th>" +
        "<th>フェーズ分布</th><th>検証</th><th>元にしたフロー</th><th></th>" +
        "</tr></thead><tbody>" +
        db.events.map((ev, i) => this.row(ev, i, db.events.length)).join("") +
        "</tbody></table>"
      : '<p class="pal-empty">フローがまだありません。' +
        "上の「作成」から作ってください。</p>";

    // 保存場所の話は下段の状態に常時出しているので、ここでは繰り返さない。
    $("ewNote").innerHTML =
      "<b>対応はフローをまたいで再利用される部品です。</b>" +
      "フェーズ・対応・連絡先を 1 か所で持ち、フローはそれらの組み合わせとして作ります。";
  }

  /** フロー 1 件の行。 */
  private row(ev: EventFlow, i: number, total: number): string {
    const db = this.api.db;
    const last = i === total - 1;
    const v = validate(db, ev);
    const dist = phaseDist(db, ev);

    // フェーズ分布は帯だけにする。
    //
    // 以前は帯の下に凡例（色の点＋フェーズ名＋件数）を並べていたが、
    // 320px のカードでは 2 行に折り返し、カードの高さが揃わない原因になっていた。
    // 帯は同じことを長さで示しているので、名前と件数は帯の説明に持たせる。
    // 色はキャンバスもパレットも同じフェーズ色なので、対応は付く。
    const bar = dist
      .map(
        (d) =>
          `<i style="background:${esc(d.p.color)};flex:${d.n}"` +
          ` title="${esc(d.p.name)} ${d.n} 手順"></i>`,
      )
      .join("");

    const k = esc(ev.key);
    // 重大度は Defender と同じ 3 目盛り。色だけに頼らず言葉も添える。
    const sev =
      '<span class="sevm ' +
      esc(ev.severity) +
      '"><i></i><i></i><i></i></span>' +
      `<span>${SEV_WORD[ev.severity] ?? ""} (${esc(ev.severity)})</span>`;

    return (
      `<tr data-a="open" data-key="${k}">` +
      `<td class="name"><b>${esc(ev.title)}</b>` +
      `<span class="sub">${esc(ev.sub || "（説明なし）")}</span></td>` +
      `<td><span class="sevcell">${sev}</span></td>` +
      `<td class="num">${ev.steps.length}</td>` +
      `<td class="num">${v.paths.length}</td>` +
      `<td><span class="ew-bar">${bar}</span></td>` +
      `<td><span class="state ${v.issues.length ? "ng" : "ok"}">` +
      `<svg class="ic"><use href="#ic-${v.issues.length ? "warn" : "check"}"/></svg>` +
      `${v.issues.length ? `${v.issues.length} 件` : "OK"}</span></td>` +
      `<td>${this.relation(ev)}</td>` +
      '<td class="acts">' +
      // 並び順は作った順で固定だった。よく開くものを上へ動かせるようにする。
      // ドラッグではなく上下のボタンにしたのは、たまに 1 つ動かすだけの
      // 操作だから（手順の並べ替えのように、何度も動かすものではない）。
      `<button data-a="up" data-key="${k}"${i === 0 ? " disabled" : ""} title="上へ">` +
      '<svg class="ic"><use href="#ic-chev-u"/></svg></button>' +
      `<button data-a="down" data-key="${k}"${last ? " disabled" : ""} title="下へ">` +
      '<svg class="ic"><use href="#ic-chev-d"/></svg></button>' +
      // 「開く」は置かない。行そのものが押せるので、同じことを 2 つ並べても
      // 選ぶ手間が増えるだけになる。ここに残すのは、押さないと分からない操作だけ。
      `<button data-a="dup" data-key="${k}" title="複製">` +
      '<svg class="ic"><use href="#ic-copy"/></svg></button>' +
      // 派生の派生は作れないので、元になれるものにだけ出す。
      (ev.base
        ? ""
        : `<button data-a="derive" data-key="${k}" title="顧客別を作る">` +
          '<svg class="ic"><use href="#ic-branch"/></svg></button>') +
      `<button data-a="exp" data-key="${k}" title="エクスポート">` +
      '<svg class="ic"><use href="#ic-export"/></svg></button>' +
      `<button data-a="del" data-key="${k}" class="dg" title="削除">` +
      '<svg class="ic"><use href="#ic-delete"/></svg></button>' +
      "</td></tr>"
    );
  }

  /**
   * 共通フローとの関係。
   *
   * 顧客別は「共通の何を変えたか」が、共通は「どれが自分を元にしているか」が、
   * 一覧の時点で見えていないと、開くまで関係が分からない。
   */
  private relation(ev: EventFlow): string {
    const db = this.api.db;

    if (ev.base) {
      const d = diffFrom(db, ev);
      if (!d) return "";
      const name = d.base ? esc(d.base.title) : "（元のフローがありません）";
      return (
        '<p class="ew-rel">' +
        `<span class="from" title="このフローは「${name}」を元にしています">` +
        `↳ ${name}</span>` +
        `<span class="dif">${esc(diffSummary(d))}</span>` +
        (d.outdated
          ? '<span class="old" title="元のフローがこのあと更新されています。' +
            '取り込むかどうかは、違いを見て決めてください">元が更新されています</span>'
          : "") +
        "</p>"
      );
    }

    const kids = derivedOf(db, ev.key);
    if (!kids.length) return "";
    return (
      '<p class="ew-rel"><span class="base" ' +
      `title="${esc(kids.map((k) => k.title).join("、"))}">` +
      `顧客別 ${kids.length} 件</span></p>`
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
        case "derive":
          void this.derive(key);
          break;
        case "exp":
          this.showExport(key);
          break;
        case "del":
          void this.remove(key);
          break;
        case "up":
          void this.move(key, -1);
          break;
        case "down":
          void this.move(key, 1);
          break;
      }
    });

    $("ewExportAll").addEventListener("click", () => this.showExport());
    $("ewNew").addEventListener("click", () => void this.create());
  }

  // -------------------------------------------------------------------------

  private async create(): Promise<void> {
    const v = await askModal({
      title: "新しいフロー",
      sub: "対応フローを 1 本作ります",
      okLabel: "作成",
      fields: [
        {
          k: "title",
          label: "フロー名",
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
      this.fail(e, "フローの作成");
    }
  }

  /**
   * このフローを元に、顧客別のフローを作る。
   *
   * 複製と分けてあるのは、元をどう見るかが違うから。複製は対等な別物、
   * 顧客別は「共通に対するこの顧客のやり方」で、あとから違いを見られる。
   */
  private async derive(key: string): Promise<void> {
    const ev = this.api.db.events.find((e) => e.key === key);
    if (!ev) return;

    const v = await askModal({
      title: "顧客別のフローを作る",
      sub: ev.title,
      okLabel: "作る",
      fields: [
        {
          k: "title",
          label: "名前",
          value: `${ev.title}（顧客別）`,
          required: true,
          placeholder: "例: 高橋工務店向け",
          hint:
            "いまの中身をそのまま写します。ここから手順を足したり外したりしてください。" +
            "共通との違いは、編集ビューの「共通との違い」でいつでも見られます。",
        },
      ],
    });
    if (!v) return;

    try {
      const made = await this.api.deriveEvent(key, v.title);
      toast(`「${v.title}」を作りました`);
      if (made) this.onOpen(made.key);
    } catch (e) {
      this.fail(e, "顧客別フローの作成");
    }
  }

  /**
   * 並びを 1 つずらす。
   *
   * サーバへは並び全体を送る。「どれとどれを入れ替えたか」ではなく
   * 「こういう並びにしたい」を送るほうが、途中でずれたときに立て直せる。
   */
  private async move(key: string, dir: -1 | 1): Promise<void> {
    const keys = this.api.db.events.map((e) => e.key);
    const at = keys.indexOf(key);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to], keys[at]];
    try {
      await this.api.orderEvents(keys);
    } catch (e) {
      this.fail(e, "フローの並べ替え");
    }
  }

  private async duplicate(key: string): Promise<void> {
    try {
      const dup = await this.api.duplicateEvent(key);
      toast(dup ? `「${dup.title}」を作りました` : "複製しました");
    } catch (e) {
      this.fail(e, "フローの複製");
    }
  }

  private async remove(key: string): Promise<void> {
    const ev = this.api.db.events.find((e) => e.key === key);
    if (!ev) return;

    const ok = await confirmModal({
      title: "フローを削除",
      sub: ev.title,
      danger: true,
      okLabel: "削除する",
      message:
        `<p><b>${esc(ev.title)}</b> と、その ${ev.steps.length} 手順を削除します。</p>` +
        "<p class=\"hint\">対応や連絡先は部品なので消えません。" +
        "このフローでの組み合わせだけが失われます。取り消せません。</p>",
    });
    if (!ok) return;

    try {
      await this.api.deleteEvent(key);
      toast(`「${ev.title}」を削除しました`);
    } catch (e) {
      this.fail(e, "フローの削除");
    }
  }

  /** 書き出しのプレビュー。実際に配る HTML をそのまま表示する。 */
  private showExport(key?: string): void {
    const ev = key ? this.api.db.events.find((e) => e.key === key) : undefined;
    const url = this.api.exportUrl(key);

    openModal(
      "エクスポート",
      ev ? ev.title : `全 ${this.api.db.events.length} フロー`,
      '<p class="ins hint" style="margin:0 0 12px">下のプレビューは、実際に書き出される HTML を' +
        "そのまま表示しています。外部依存はありません。ファイルをコピーするだけで配れます。</p>" +
        `<iframe class="frame" src="${esc(url)}"></iframe>`,
      `<a class="ed-tool pri" href="${esc(this.api.downloadUrl(key))}" download>保存する</a>` +
        '<button class="ed-tool" data-x="close">閉じる</button>',
      // プレビューは中身そのものに幅が要るので、広く開く。
      true,
    );
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}
