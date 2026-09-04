/**
 * フェーズと担当の設定。
 *
 * この 2 つは形がまったく同じ——キーと名前と色を持ち、並び順に意味があり、
 * 使われていれば消せない。違うのは「何に使われているか」を数える先だけなので、
 * 1 つの部品にして、そこだけ差し替える。
 *
 * どちらも全部のフローに影響する。フェーズの色を変えれば全フローのボックスの色が変わり、
 * 担当を消せばその列が無くなる。だから消す前には使用箇所を見せて断る（サーバ側の
 * 責任だが、画面でも「何件で使われているか」を常に出しておく）。
 *
 * 画面ではなくモーダルにしている。フェーズも担当も 4〜6 個で、対応のように
 * 一覧を絞り込んだり並べ替えたりする対象ではないため。
 */

import { Api, ApiError } from "./api";
import type { LaneInput, PhaseInput } from "./api";
import { $, esc } from "./dom";
import type { DB, EventFlow, EventLane, Lane, Phase } from "./types";
import { closeModal, confirmModal, openModal, showApiError, toast } from "./ui";

/** 選べる色。フェーズと担当で同じ並びを使う。 */
const COLORS = [
  "var(--c1)",
  "var(--c2)",
  "var(--c3)",
  "var(--c4)",
  "var(--c5)",
  "var(--c6)",
  "var(--c7)",
  "var(--c8)",
  "var(--c9)",
  "var(--c10)",
];

/** フェーズと担当の違いを吸収する。 */
interface Kind {
  /** モーダルの見出し。 */
  title: string;
  /** 見出しの下の説明。 */
  lead: string;
  /** 一覧の「使用」列の見出し。 */
  usedLabel: string;
  /** 新しく作るときの既定の名前。 */
  newName: string;
  items: (db: DB) => (Phase | Lane)[];
  /** その項目が何件で使われているか。 */
  usedBy: (db: DB, key: string) => number;
  /** 使われているときに、なぜ消せないかを一言で。 */
  blockedNote: string;
  create: (api: Api, input: PhaseInput | LaneInput) => Promise<unknown>;
  update: (api: Api, key: string, input: PhaseInput | LaneInput) => Promise<unknown>;
  remove: (api: Api, key: string) => Promise<unknown>;
  order: (api: Api, keys: string[]) => Promise<unknown>;
}

const PHASE: Kind = {
  title: "フェーズ設定",
  lead:
    "<b>フェーズは「対応のどのフェーズか」です。</b>" +
    "受信・確認から記録・報告まで、時間とともに進むものを並べてください。<br>" +
    "フェーズは図の列ではありません。ボックスの色とラベルとして出ます" +
    "（列は担当です）。並び順は、フローカードの帯と検証の後戻り判定に使われます。",
  usedLabel: "対応",
  newName: "新しいフェーズ",
  items: (db) => db.phases,
  usedBy: (db, key) => db.tasks.filter((t) => t.phase === key).length,
  blockedNote:
    "対応が割り当てられているフェーズは削除できません。" +
    "先に対応を別のフェーズへ移してください。",
  create: (api, input) => api.createPhase(input),
  update: (api, key, input) => api.updatePhase(key, input),
  remove: (api, key) => api.deletePhase(key),
  order: (api, keys) => api.orderPhases(keys),
};

const LANE: Kind = {
  title: "担当設定",
  lead:
    "<b>担当はフロー図の列です。</b>" +
    "左から右へ、外側から上位へ並べると、エスカレーションが右向き、" +
    "顧客連絡が左向きで揃います。<br>" +
    "顧客・管理職・外部機関・ベンダーなど、フローに出てくる相手を足せます。" +
    "連絡先グループに担当を設定すると、その列へ矢印が伸びます。",
  usedLabel: "使用",
  newName: "新しい担当",
  items: (db) => db.lanes,
  usedBy: (db, key) =>
    db.tasks.filter((t) => t.lane === key).length +
    db.events.reduce(
      (n, e) => n + e.steps.filter((s) => s.lane === key).length,
      0,
    ) +
    db.contactGroups.filter((g) => g.lane === key).length,
  blockedNote:
    "対応・手順・連絡先から使われている担当は削除できません。" +
    "先にそれらを別の担当へ移してください。",
  create: (api, input) => api.createLane(input),
  update: (api, key, input) => api.updateLane(key, input),
  remove: (api, key) => api.deleteLane(key),
  order: (api, keys) => api.orderLanes(keys),
};

export class Settings {
  private readonly api: Api;

  constructor(api: Api) {
    this.api = api;
  }

  openPhases(): void {
    this.open(PHASE);
  }

  openLanes(): void {
    this.open(LANE);
  }

  // -------------------------------------------------------------------------

  private open(k: Kind): void {
    const db = this.api.db;
    const items = k.items(db);

    const rows = items
      .map((it, i) => {
        const n = k.usedBy(db, it.key);
        const swatches = COLORS.map(
          (c) =>
            `<button data-col="${i}" data-c="${esc(c)}" style="background:${esc(c)}"` +
            `${it.color === c ? ' class="on"' : ""}></button>`,
        ).join("");
        return (
          "<tr>" +
          `<td class="num">${i + 1}</td>` +
          '<td><div class="ph-mv">' +
          `<button data-up="${i}"${i === 0 ? " disabled" : ""}>&#9650;</button>` +
          `<button data-dn="${i}"${i === items.length - 1 ? " disabled" : ""}>&#9660;</button>` +
          "</div></td>" +
          `<td><input class="ph-name" data-nm="${i}" value="${esc(it.name)}"></td>` +
          `<td><div class="ph-sw">${swatches}</div></td>` +
          `<td class="num">${n}</td>` +
          `<td><button class="ed-tool sm" data-del="${i}"${n ? " disabled" : ""}>削除</button></td>` +
          "</tr>"
        );
      })
      .join("");

    const preview = items
      .map((it) => `<em style="--pc:${esc(it.color)}">${esc(it.name)}</em>`)
      .join("<i>&#8594;</i>");

    openModal(
      k.title,
      `${items.length} 件`,
      `<p class="ins hint" style="margin:0 0 12px">${k.lead}</p>` +
        '<table class="tbl"><thead><tr><th>#</th><th>並び</th><th>名称</th>' +
        `<th>色</th><th>${k.usedLabel}</th><th></th></tr></thead>` +
        `<tbody>${rows}</tbody></table>` +
        `<div class="ph-preview">${preview}</div>` +
        `<p class="ins hint">${k.blockedNote}</p>`,
      '<div class="fnote">変更はすべてのフローに反映されます。</div>' +
        `<button class="ed-tool" data-x="add">＋ 追加</button>` +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );

    this.bind(k, items);
  }

  private bind(k: Kind, items: (Phase | Lane)[]): void {
    const body = $("mBody");
    const foot = $("mFoot");

    // 名前と色は既存の項目を書き換えるので、その項目の中身を丸ごと送る。
    const save = async (i: number, patch: { name?: string; color?: string }) => {
      const it = items[i];
      await this.run(k, () =>
        k.update(this.api, it.key, {
          name: patch.name ?? it.name,
          color: patch.color ?? it.color,
        }),
      );
    };

    const move = async (from: number, to: number) => {
      const keys = items.map((x) => x.key);
      const [moved] = keys.splice(from, 1);
      keys.splice(to, 0, moved);
      await this.run(k, () => k.order(this.api, keys));
    };

    for (const b of body.querySelectorAll<HTMLElement>("[data-up]")) {
      const i = Number(b.dataset.up);
      b.addEventListener("click", () => void move(i, i - 1));
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-dn]")) {
      const i = Number(b.dataset.dn);
      b.addEventListener("click", () => void move(i, i + 1));
    }
    for (const el of body.querySelectorAll<HTMLInputElement>("[data-nm]")) {
      // 打つたびではなく、欄を離れたときに確定させる。全フローに響く変更なので、
      // 途中の状態を送り続ける意味がない。
      el.addEventListener("change", () => {
        const name = el.value.trim();
        if (!name) {
          el.value = items[Number(el.dataset.nm)].name;
          toast("名前は空にできません", true);
          return;
        }
        void save(Number(el.dataset.nm), { name });
      });
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-col]")) {
      b.addEventListener("click", () =>
        void save(Number(b.dataset.col), { color: b.dataset.c }),
      );
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-del]")) {
      b.addEventListener("click", () => void this.remove(k, items[Number(b.dataset.del)]));
    }

    foot
      .querySelector('[data-x="add"]')
      ?.addEventListener("click", () => void this.add(k, items.length));
    foot.querySelector('[data-x="close"]')?.addEventListener("click", closeModal);
  }

  private async add(k: Kind, at: number): Promise<void> {
    await this.run(k, () =>
      k.create(this.api, {
        name: `${k.newName} ${at + 1}`,
        // 使われていない色から選ぶ。同じ色が 2 つ並ぶと見分けられない。
        color: COLORS[at % COLORS.length],
      }),
    );
    toast("追加しました。名前と色を直してください");
  }

  private async remove(k: Kind, it: Phase | Lane): Promise<void> {
    const ok = await confirmModal({
      title: `${k.title} — 削除`,
      sub: it.name,
      danger: true,
      okLabel: "削除する",
      message: `<p><b>${esc(it.name)}</b> を削除します。取り消せません。</p>`,
    });
    if (!ok) return;
    await this.run(k, () => k.remove(this.api, it.key));
  }

  /** 変更を送り、モーダルを開き直す。失敗しても開き直して、真実を見せる。 */
  private async run(k: Kind, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, k.title);
      else toast(String(e), true);
      await this.api.load();
      return;
    }
    this.open(k);
  }
}

// ---------------------------------------------------------------------------
// フローごとの担当
// ---------------------------------------------------------------------------

/**
 * このフローで「どの列を使い、何と呼ぶか」を決める。
 *
 * 全体の担当は役割で、フローごとに具体的な相手が変わる。一般的なフローの「顧客」は、
 * A 社向けのフローでは「高橋工務店」になる。持ち替えるのは呼び名だけなので、
 * 対応の既定の担当も、フローをまたいだ集計も壊れない。
 */
export class EventLaneSettings {
  private readonly api: Api;
  private readonly onSaved: () => void;

  constructor(api: Api, onSaved: () => void) {
    this.api = api;
    this.onSaved = onSaved;
  }

  open(evt: EventFlow): void {
    const db = this.api.db;
    // いまの並び。指定が無ければ全体をそのまま。
    const current: EventLane[] = evt.lanes?.length
      ? evt.lanes.map((l) => ({ ...l }))
      : db.lanes.map((l) => ({ key: l.key }));

    // 使っていない担当も、あとで足せるように末尾に並べておく。
    const rest = db.lanes
      .filter((l) => !current.some((c) => c.key === l.key))
      .map((l) => ({ key: l.key }));
    const rows: EventLane[] = [...current, ...rest];
    const used = new Set(current.map((c) => c.key));

    // その担当に座っている手順の数。0 でなければ外せない。
    const steps = (key: string) =>
      evt.steps.filter((s) => s.lane === key).length;

    const html = rows
      .map((r, i) => {
        const base = db.lanes.find((l) => l.key === r.key);
        if (!base) return "";
        const n = steps(r.key);
        const on = used.has(r.key);
        return (
          "<tr>" +
          `<td class="num">${on ? i + 1 : "—"}</td>` +
          '<td><div class="ph-mv">' +
          `<button data-up="${i}"${i === 0 ? " disabled" : ""}>&#9650;</button>` +
          `<button data-dn="${i}"${i === rows.length - 1 ? " disabled" : ""}>&#9660;</button>` +
          "</div></td>" +
          '<td><label class="chk"><input type="checkbox" data-use="' +
          `${i}"${on ? " checked" : ""}${n ? " disabled" : ""}>` +
          `<span style="color:${esc(base.color)}">${esc(base.name)}</span></label></td>` +
          '<td><input class="ph-name" data-nm="' +
          `${i}" value="${esc(r.name ?? "")}" placeholder="${esc(base.name)}"></td>` +
          `<td class="num">${n}</td>` +
          "</tr>"
        );
      })
      .join("");

    openModal(
      "このフローの担当",
      evt.title,
      '<p class="ins hint" style="margin:0 0 12px">' +
        "<b>全体の担当は「役割」です。</b>ここではこのフローでの呼び名を決められます。" +
        "一般的なフローの「顧客」を、A 社向けのフローでは「高橋工務店」にする、" +
        "といった使い方です。<br>" +
        "呼び名を空にすると全体の名前に戻ります。使っていない列は外せます" +
        "（手順が座っている列は外せません）。" +
        "担当そのものの追加は「担当設定」で行います。</p>" +
        '<table class="tbl"><thead><tr><th>#</th><th>並び</th><th>使う</th>' +
        "<th>このフローでの呼び名</th><th>手順</th></tr></thead>" +
        `<tbody>${html}</tbody></table>`,
      '<div class="fnote">このフローだけに効きます。</div>' +
        '<button class="ed-tool" data-x="reset">全体に合わせる</button>' +
        '<button class="ed-tool pri" data-x="save">保存する</button>' +
        '<button class="ed-tool" data-x="close">閉じる</button>',
    );

    this.bind(evt, rows);
  }

  private bind(evt: EventFlow, rows: EventLane[]): void {
    const body = $("mBody");
    const foot = $("mFoot");

    for (const b of body.querySelectorAll<HTMLElement>("[data-up]")) {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.up);
        [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
        this.reopen(evt, rows, body);
      });
    }
    for (const b of body.querySelectorAll<HTMLElement>("[data-dn]")) {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.dn);
        [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
        this.reopen(evt, rows, body);
      });
    }

    foot.querySelector('[data-x="save"]')?.addEventListener("click", () => {
      void this.save(evt, this.collect(body, rows));
    });
    foot.querySelector('[data-x="reset"]')?.addEventListener("click", () => {
      void this.save(evt, []);
    });
    foot.querySelector('[data-x="close"]')?.addEventListener("click", closeModal);
  }

  /** 画面の入力を読んで、送る形にする。 */
  private collect(body: HTMLElement, rows: EventLane[]): EventLane[] {
    const out: EventLane[] = [];
    rows.forEach((r, i) => {
      const use = body.querySelector<HTMLInputElement>(`[data-use="${i}"]`);
      if (!use?.checked) return;
      const name =
        body.querySelector<HTMLInputElement>(`[data-nm="${i}"]`)?.value.trim() ??
        "";
      out.push(name ? { key: r.key, name } : { key: r.key });
    });
    return out;
  }

  /**
   * 並べ替えのたびに開き直す。
   *
   * 入力中の呼び名を持ち回る必要があるので、いまの入力を rows に写してから開く。
   */
  private reopen(evt: EventFlow, rows: EventLane[], body: HTMLElement): void {
    rows.forEach((r, i) => {
      const name = body
        .querySelector<HTMLInputElement>(`[data-nm="${i}"]`)
        ?.value.trim();
      if (name !== undefined) r.name = name || undefined;
    });
    // 並びを保ったまま描き直したいので、いったんフローに反映してから開く。
    const used = rows.filter(
      (_, i) => body.querySelector<HTMLInputElement>(`[data-use="${i}"]`)?.checked,
    );
    this.open({ ...evt, lanes: used.length ? used : rows });
  }

  private async save(evt: EventFlow, lanes: EventLane[]): Promise<void> {
    try {
      await this.api.setEventLanes(evt.key, lanes);
      closeModal();
      this.onSaved();
      toast(lanes.length ? "担当を更新しました" : "全体の担当に戻しました");
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "このフローの担当");
      else toast(String(e), true);
    }
  }
}
