/**
 * SLA。「検知から○○まで○分以内」という約束。
 *
 * 手順ひとつずつの目標時間とは別に持つ。手順の目標を全部足した数は
 * 「この経路の重さ」でしかなく、約束した時間ではない。実データで測ると、
 * 1 営業日の手順が 2 つあるだけで合計は 16 時間 45 分になり、初動の 15 分が
 * その中に埋もれていた。数字はあるのに使い道が無い、という状態だった。
 *
 * 面は 2 つ。
 *
 *   SLA 設定  … SOC がサービスとして掲げる標準。フローをまたいで共有する
 *   フローの SLA … このフローだけの上書き。顧客ごとに違う約束を持つ
 *
 * 担当（Lane / EventLane）と同じ形にしてある。役割で参照して、フローで束ねる。
 *
 * **時間の判定はしない。** 一度は経路ごとに積み上げて超過を出す作りにしたが、
 * 実務では「初動 2 時間」程度しか約束が無く、厳密な計算をしながらフローを
 * 作ることはない、という指摘を受けて外した。計算が要らないどころか、
 * **計算があると邪魔**で、道具が使われなくなる。約束は書いて示すもので、
 * 検算するものではない。
 */

import { Api, ApiError } from "./api";
import { esc } from "./dom";
import { fmtMin, parseSla, slaTarget } from "./flow";
import type { EventFlow, EventSLA, SLA } from "./types";
import {
  closeModal,
  confirmModal,
  openModal,
  showApiError,
  surfaceBody,
  surfaceFoot,
  toast,
} from "./ui";

export class SLASettings {
  private readonly api: Api;

  constructor(api: Api) {
    this.api = api;
  }

  // -------------------------------------------------------------------------
  // 全体の SLA（SOC の標準）
  // -------------------------------------------------------------------------

  open(): void {
    const db = this.api.db;
    const items = db.slas ?? [];

    const rows = items
      .map((x, i) => {
        const used = this.usedBy(x.key);
        return (
          "<tr>" +
          `<td class="num">${i + 1}</td>` +
          '<td><div class="ph-mv rowops">' +
          `<button data-up="${i}"${i === 0 ? " disabled" : ""} title="上へ">` +
          '<svg class="ic"><use href="#ic-chev-u"/></svg></button>' +
          `<button data-dn="${i}"${i === items.length - 1 ? " disabled" : ""} title="下へ">` +
          '<svg class="ic"><use href="#ic-chev-d"/></svg></button>' +
          "</div></td>" +
          `<td><input class="ph-name" data-nm="${i}" value="${esc(x.name)}"></td>` +
          `<td><input class="ph-name sla-t" data-mn="${i}" value="${esc(fmtMin(x.minutes))}"` +
          ' placeholder="2時間 / 30分"></td>' +
          `<td class="num">${used}</td>` +
          '<td><div class="rowops">' +
          `<button class="dgr" data-del="${i}"${used ? " disabled" : ""}` +
          ` title="${used ? `${used} 手順で使用中のため削除できません` : "削除"}">` +
          '<svg class="ic"><use href="#ic-delete"/></svg></button></div></td>' +
          "</tr>"
        );
      })
      .join("");

    openModal(
      "SLA 設定",
      `${items.length} 件`,
      '<p class="ins hint" style="margin:0 0 12px">' +
        "<b>SLA は「検知から○○まで、何分以内」という約束です。</b>" +
        "手順ひとつずつの目標時間とは別のものとして持ちます。<br>" +
        "どの手順までが約束の範囲かは、その手順に<b>到達点の印</b>を付けて示します" +
        "（手順のインスペクタの下のほう）。印を付けると図に出ます。<br>" +
        "<b>時間の判定はしません。</b>約束を書いておくためのもので、" +
        "目標時間を足して超過を出すことはしません。<br>" +
        "顧客ごとに違う約束は、フローごとに上書きできます（編集ビューの「SLA」）。" +
        "</p>" +
        (items.length
          ? '<table class="tbl"><thead><tr><th>#</th><th>並び</th><th>名称</th>' +
            "<th>目標</th><th>到達点</th><th></th></tr></thead>" +
            `<tbody>${rows}</tbody></table>`
          : '<p class="pal-empty">まだありません。下の「＋ 追加」から作ってください。</p>') +
        '<p class="ins hint">到達点にしている手順がある SLA は削除できません。' +
        "先に手順側の印を外してください。</p>",
      '<div class="fnote">変更はすべてのフローに反映されます。</div>' +
        '<button class="ed-tool" data-x="add">＋ 追加</button>' +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );

    this.bind(items);
  }

  /** その SLA を到達点にしている手順の数。 */
  private usedBy(key: string): number {
    return this.api.db.events.reduce(
      (n, e) => n + e.steps.filter((s) => s.milestone === key).length,
      0,
    );
  }

  private bind(items: SLA[]): void {
    const body = surfaceBody();
    const foot = surfaceFoot();

    const save = async (i: number, patch: Partial<SLA>) => {
      const it = items[i];
      await this.run(() =>
        this.api.updateSLA(it.key, {
          name: patch.name ?? it.name,
          minutes: patch.minutes ?? it.minutes,
          note: it.note,
        }),
      );
    };

    for (const el of body.querySelectorAll<HTMLInputElement>("[data-nm]")) {
      el.addEventListener("change", () => {
        void save(Number(el.dataset.nm), { name: el.value });
      });
    }
    // 目標は「2時間」「30分」のように書かれたものを読む。手順の目標時間と
    // 同じ読み方にしてある（書式を強いると入力が面倒になる）。
    for (const el of body.querySelectorAll<HTMLInputElement>("[data-mn]")) {
      el.addEventListener("change", () => {
        const m = parseSla(el.value);
        if (m <= 0) {
          toast("目標時間を読み取れません。「2時間」「30分」のように入れてください", true);
          el.value = fmtMin(items[Number(el.dataset.mn)].minutes);
          return;
        }
        void save(Number(el.dataset.mn), { minutes: m });
      });
    }

    const move = async (from: number, to: number) => {
      const keys = items.map((x) => x.key);
      const [moved] = keys.splice(from, 1);
      keys.splice(to, 0, moved);
      await this.run(() => this.api.orderSLAs(keys));
    };
    for (const b of body.querySelectorAll<HTMLElement>("[data-up]")) {
      const i = Number(b.dataset.up);
      b.addEventListener("click", () => void move(i, i - 1));
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-dn]")) {
      const i = Number(b.dataset.dn);
      b.addEventListener("click", () => void move(i, i + 1));
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-del]")) {
      b.addEventListener("click", () => void this.remove(items[Number(b.dataset.del)]));
    }

    foot.querySelector('[data-x="add"]')?.addEventListener("click", () => {
      void this.run(() =>
        this.api.createSLA({
          name: `新しい SLA ${(this.api.db.slas ?? []).length + 1}`,
          minutes: 60,
          note: "",
        }),
      );
    });
  }

  private async remove(x: SLA): Promise<void> {
    const ok = await confirmModal({
      title: "SLA を削除",
      sub: x.name,
      danger: true,
      okLabel: "削除する",
      message:
        `<p><b>${esc(x.name)}</b> を削除します。</p>` +
        '<p class="hint">フローごとの上書きも一緒に消えます。' +
        "手順に付けた到達点の印は、先に外しておく必要があります。</p>",
    });
    if (!ok) return;
    await this.run(() => this.api.deleteSLA(x.key));
  }

  /** 変更したら開き直す。中身が変わったのに古い表を見せない。 */
  private async run(f: () => Promise<unknown>): Promise<void> {
    try {
      await f();
      this.open();
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "SLA の変更");
      else toast(String(e), true);
    }
  }

  // -------------------------------------------------------------------------
  // フローごとの上書き（顧客別の約束）
  // -------------------------------------------------------------------------

  openForEvent(evt: EventFlow): void {
    const all = this.api.db.slas ?? [];
    const now = new Map((evt.slas ?? []).map((o) => [o.key, o.minutes]));

    const rows = all
      .map((x, i) => {
        const over = now.get(x.key);
        const used = evt.steps.some((s) => s.milestone === x.key);
        return (
          `<tr><td class="num">${i + 1}</td>` +
          `<td><b>${esc(x.name)}</b>` +
          (x.note ? `<span class="why">${esc(x.note)}</span>` : "") +
          "</td>" +
          `<td class="num">${esc(fmtMin(x.minutes))}</td>` +
          `<td><input class="ph-name sla-t" data-k="${esc(x.key)}"` +
          ` value="${over ? esc(fmtMin(over)) : ""}" placeholder="標準のまま"></td>` +
          `<td>${
            used
              ? '<span class="state ok"><svg class="ic"><use href="#ic-check"/></svg>あり</span>'
              : '<span class="state">—</span>'
          }</td></tr>`
        );
      })
      .join("");

    openModal(
      "このフローの SLA",
      evt.title,
      '<p class="ins hint" style="margin:0 0 12px">' +
        "<b>顧客ごとに違う約束をしているときだけ入れてください。</b>" +
        "空にすると標準（SOC の SLA 設定）に戻ります。<br>" +
        "「到達点」は、このフローの手順に印が付いているかどうかです。" +
        "印が無い SLA は、このフローでは測れません。</p>" +
        (all.length
          ? '<table class="tbl"><thead><tr><th>#</th><th>SLA</th><th>標準</th>' +
            "<th>このフロー</th><th>到達点</th></tr></thead>" +
            `<tbody>${rows}</tbody></table>`
          : '<p class="pal-empty">SLA がまだ定義されていません。' +
            "フロー一覧の「SLA 設定」から作ってください。</p>"),
      '<div class="fnote">このフローだけに効きます。</div>' +
        '<button class="ed-tool pri" data-x="save">保存する</button>' +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );

    surfaceFoot()
      .querySelector('[data-x="save"]')
      ?.addEventListener("click", () => void this.saveForEvent(evt));
  }

  private async saveForEvent(evt: EventFlow): Promise<void> {
    const out: EventSLA[] = [];
    for (const el of surfaceBody().querySelectorAll<HTMLInputElement>("[data-k]")) {
      const raw = el.value.trim();
      if (!raw) continue; // 空は「標準のまま」
      const m = parseSla(raw);
      if (m <= 0) {
        toast(`「${raw}」を読み取れません。「2時間」「30分」のように入れてください`, true);
        return;
      }
      out.push({ key: el.dataset.k ?? "", minutes: m });
    }
    try {
      await this.api.setEventSLAs(evt.key, out);
      closeModal();
      toast(out.length ? `${out.length} 件を上書きしました` : "標準に戻しました");
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "SLA の変更");
      else toast(String(e), true);
    }
  }
}

/**
 * 到達点の印。インスペクタの下のほうに置く。
 *
 * ほとんどの手順には要らない印なので、欄として常に出さない。判断ステップと
 * 同じで、押したときだけ現れる形にしてある（利用者の指摘——「ほとんどの項目に
 * 不要な項目になるのが気になる」）。
 */
export function milestoneField(
  db: { slas?: SLA[] },
  st: { milestone?: string },
): string {
  const all = db.slas ?? [];
  if (!all.length) return ""; // 約束が 1 つも無ければ、印の付けようがない

  if (!st.milestone) {
    return (
      '<button class="mini" id="s_msAdd" style="margin-top:13px">' +
      "&#9873; この手順を SLA の到達点にする</button>"
    );
  }

  const opts = all
    .map(
      (x) =>
        `<option value="${esc(x.key)}"${x.key === st.milestone ? " selected" : ""}>` +
        `${esc(x.name)}（${esc(fmtMin(x.minutes))}）</option>`,
    )
    .join("");
  return (
    '<div class="sect ms"><h4>SLA の到達点 ' +
    '<button class="x" id="s_msDel" title="外す">&times;</button></h4>' +
    `<select id="s_ms">${opts}</select>` +
    '<p class="hint">この手順に「ここまでが約束の範囲」という印が付きます。' +
    "図とアウトラインに出ます。時間の判定はしません。</p></div>"
  );
}

/** 図やアウトラインに出す、到達点の印。 */
export function milestoneTag(
  db: { slas?: SLA[] },
  evt: EventFlow,
  st: { milestone?: string },
): string {
  if (!st.milestone) return "";
  const x = (db.slas ?? []).find((y) => y.key === st.milestone);
  if (!x) return "";
  return (
    `<span class="f-ms" title="${esc(x.name)} — ここまでが約束の範囲です">` +
    `&#9873; ${esc(x.name)} ${esc(fmtMin(slaTarget(evt, x)))}</span>`
  );
}
