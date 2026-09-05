/**
 * ランチャー。左上の点の集まりから開く、外部の画面への近道。
 *
 * Defender ポータルの同じ位置にあるものに倣っている。SOC の作業は 1 つの画面で
 * 完結しない——Defender で見て、Intune で端末を確認して、Teams で連絡する。
 * その行き来を、対応フローを設計しているこの画面からも始められるようにする。
 *
 * 並べるものは組織ごとに違うので、固定しない。作る・直す・消すができる。
 *
 * 追加と変更の入力は、右のパネルではなく**この面の中で切り替える**。3 欄の
 * 入力に、背後を暗くして作業を止めるほどの重さはない。目線も左上で始まって
 * 左上で終わる（Defender のワッフルも、開いた先で右パネルは出さない）。
 * 消すときだけは中央のダイアログで手を止める——取り消せないため。
 *
 * **アイコンは自由に指定できない。** ここに並べたものから選ぶ。好きな絵を
 * 持ち込めるようにすると、画面ごとに大きさも太さも色も変わり、並べたときに
 * 揃わなくなる。
 *
 * Microsoft の各サービスは、色付きの製品アイコンを出す（items/brand）。
 * ここだけは単色にしない——ランチャーは「どのサービスか」を絵で見分ける場所で、
 * 実物と同じ絵が並んでいるほうが速い。それ以外（チケット・手順書など）は
 * 画面のほかの部分と同じ単色のアイコンにしてある。
 */

import { Api, ApiError } from "./api";
import { $, $as, esc, onAction } from "./dom";
import type { AppLink } from "./types";
import { confirmModal, showApiError, toast } from "./ui";

/**
 * 選べるアイコン。
 *
 * v はサーバに保存する名前。brand があれば色付きの製品アイコン
 * （items/brand のスプライト）を出し、無ければ UI と同じ単色のアイコンを出す。
 *
 * 製品アイコンがまだ無いもの（Entra ID・Sentinel・Logic Apps）は、単色の
 * まま置いてある。items/brand に SVG を足して brand: を書けば色付きになる。
 */
export const ICONS: { v: string; l: string; icon: string; brand?: string }[] = [
  { v: "defender", l: "Defender", icon: "shield", brand: "defender" },
  { v: "intune", l: "Intune", icon: "device", brand: "intune" },
  { v: "teams", l: "Teams", icon: "team", brand: "teams" },
  { v: "outlook", l: "Outlook", icon: "mail", brand: "outlook" },
  { v: "copilot", l: "Copilot", icon: "sparkle", brand: "copilot" },
  { v: "azure", l: "Azure", icon: "cloud", brand: "azure" },
  { v: "m365", l: "Microsoft 365", icon: "grid", brand: "m365" },
  { v: "entra", l: "Entra ID / 認証", icon: "key" },
  { v: "sentinel", l: "Sentinel / SIEM", icon: "alert" },
  { v: "logicapps", l: "Logic Apps / 自動化", icon: "flowchart" },
  { v: "ticket", l: "チケット", icon: "ticket" },
  { v: "book", l: "手順書・ナレッジ", icon: "book" },
  { v: "search", l: "検索・ハンティング", icon: "search" },
  { v: "people", l: "名簿・組織", icon: "people" },
  { v: "settings", l: "管理・設定", icon: "settings" },
  { v: "globe", l: "外部サイト", icon: "globe" },
  { v: "link", l: "その他のリンク", icon: "link" },
];

const DEFAULT_ICON = "link";

/**
 * アイコン 1 つぶんの絵。
 *
 * 製品アイコンは色を持っているので、文字色を拾わせない（.bic）。
 * 単色のアイコンはこれまでどおり文字色を拾う（.ic）。
 */
export function iconHTML(v: string, big = false): string {
  const it = ICONS.find((i) => i.v === v) ?? ICONS[ICONS.length - 1];
  const size = big ? " lg" : "";
  return it.brand
    ? `<svg class="bic${size}"><use href="#br-${esc(it.brand)}"/></svg>`
    : `<svg class="ic${size}"><use href="#ic-${esc(it.icon)}"/></svg>`;
}

export class Launcher {
  private readonly api: Api;
  private open = false;

  /** いま出しているもの。一覧か、入力か。 */
  private view: "grid" | "form" = "grid";
  /** 直しているリンク。追加のときは null。 */
  private editing: AppLink | null = null;
  /** 入力の途中の値。描き直しても消えないよう、ここに持つ。 */
  private draft = { icon: DEFAULT_ICON, name: "", url: "" };
  private error = "";

  constructor(api: Api) {
    this.api = api;
    this.bind();
  }

  /** 中身を描き直す。データが入れ替わるたびに呼ばれる。 */
  render(): void {
    if (this.view === "form") this.renderForm();
    else this.renderGrid();
  }

  private renderGrid(): void {
    const links = this.api.db.links ?? [];
    $("launchHead").innerHTML =
      "<h2>リンク集</h2><p>この画面から開く先。別のタブで開きます。</p>";
    const body = $("launchBody");
    body.className = "lc-grid";
    body.innerHTML =
      links.map((l) => tile(l)).join("") +
      '<button class="lc-new" data-a="new" type="button">' +
      '<svg class="ic lg"><use href="#ic-add"/></svg>新規</button>';
  }

  private renderForm(): void {
    const d = this.draft;
    $("launchHead").innerHTML =
      '<h2><button class="lc-back" data-a="back" type="button" title="一覧へ戻る">' +
      '<svg class="ic"><use href="#ic-back"/></svg></button>' +
      `${this.editing ? "リンクを直す" : "リンクを追加"}</h2>` +
      `<p>${this.editing ? esc(this.editing.name) : "この画面から開けるようにします"}</p>`;

    const body = $("launchBody");
    body.className = "lc-form";
    body.innerHTML =
      "<label>アイコン</label>" +
      '<div class="icpick">' +
      ICONS.map(
        (i) =>
          `<button type="button" data-a="icon" data-key="${esc(i.v)}"` +
          `${i.v === d.icon ? ' class="on"' : ""} title="${esc(i.l)}">` +
          `${iconHTML(i.v, true)}</button>`,
      ).join("") +
      "</div>" +
      '<label for="lcName">表示名</label>' +
      `<input id="lcName" type="text" value="${esc(d.name)}" placeholder="Defender">` +
      '<label for="lcUrl">URL</label>' +
      `<input id="lcUrl" type="text" value="${esc(d.url)}"` +
      ' placeholder="https://security.microsoft.com/">' +
      (this.error ? `<p class="lc-err">${esc(this.error)}</p>` : "") +
      '<div class="lc-foot">' +
      '<button class="ed-tool sm" data-a="back" type="button">キャンセル</button>' +
      '<button class="ed-tool sm pri" data-a="save" type="button">' +
      `${this.editing ? "保存する" : "追加する"}</button></div>`;

    $as<HTMLInputElement>("lcName").focus();
  }

  private bind(): void {
    $("appMenu").addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(!this.open);
    });

    // 外を押したら閉じる。ランチャーは「開いたまま作業する」面ではない。
    document.addEventListener("click", (e) => {
      if (!this.open) return;
      if (!$("launcher").contains(e.target as Node)) this.toggle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.open) return;
      // 入力の途中なら、まず一覧へ戻る。いきなり閉じると打った内容が消える。
      if (this.view === "form") this.toGrid();
      else this.toggle(false);
    });

    // 打った内容は、描き直しても消えないよう手元に写しておく。
    const body = $("launchBody");
    body.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === "lcName") this.draft.name = t.value;
      if (t.id === "lcUrl") this.draft.url = t.value;
    });
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.view === "form") {
        e.preventDefault();
        void this.save();
      }
    });

    onAction($("launcher"), (action, target, ev) => {
      ev.stopPropagation();
      const key = target.dataset.key ?? "";
      switch (action) {
        case "new":
          this.toForm(null);
          break;
        case "open":
          this.openLink(key);
          break;
        case "edit":
          this.toForm(this.find(key));
          break;
        case "del":
          void this.remove(key);
          break;
        case "icon":
          this.draft.icon = key;
          for (const b of body.querySelectorAll(".icpick .on")) {
            b.classList.remove("on");
          }
          target.classList.add("on");
          break;
        case "back":
          this.toGrid();
          break;
        case "save":
          void this.save();
          break;
      }
    });
  }

  private find(key: string): AppLink | null {
    return (this.api.db.links ?? []).find((x) => x.key === key) ?? null;
  }

  private toggle(on: boolean): void {
    this.open = on;
    if (!on) this.view = "grid";
    $("launcher").classList.toggle("on", on);
    $("appMenu").classList.toggle("on", on);
    if (on) this.render();
  }

  private toForm(l: AppLink | null): void {
    this.editing = l;
    this.error = "";
    this.draft = {
      icon: l?.icon ?? DEFAULT_ICON,
      name: l?.name ?? "",
      url: l?.url ?? "",
    };
    this.view = "form";
    this.render();
  }

  private toGrid(): void {
    this.view = "grid";
    this.editing = null;
    this.error = "";
    this.render();
  }

  /**
   * 別のタブで開く。
   *
   * noopener を付けるのは、開いた先から呼び出し元の画面を触られないようにするため
   * （window.opener 経由で書き換えられる。外部の画面を開く以上は必ず付ける）。
   */
  private openLink(key: string): void {
    const l = this.find(key);
    if (!l) return;
    window.open(l.url, "_blank", "noopener,noreferrer");
    this.toggle(false);
  }

  /**
   * 追加と変更。
   *
   * 断られた理由は、この面の中に出す。閉じてから知らせても直しようがない。
   */
  private async save(): Promise<void> {
    const name = this.draft.name.trim();
    const url = this.draft.url.trim();
    if (!name) {
      this.fail("表示名を入れてください");
      return;
    }
    if (!/^https?:\/\//.test(url)) {
      this.fail("URL は http:// か https:// で始めてください");
      return;
    }

    try {
      const input = { name, url, icon: this.draft.icon };
      if (this.editing) {
        await this.api.updateLink(this.editing.key, input);
        toast("直しました");
      } else {
        await this.api.createLink(input);
        toast(`「${name}」を追加しました`);
      }
      this.toGrid();
    } catch (e) {
      this.fail(e instanceof ApiError ? e.message : String(e));
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.render();
  }

  private async remove(key: string): Promise<void> {
    const l = this.find(key);
    if (!l) return;
    // 消すのは取り消せないので、ここだけは中央のダイアログで手を止める。
    const ok = await confirmModal({
      title: "リンクを削除",
      sub: l.name,
      danger: true,
      okLabel: "削除する",
      message:
        `<p><b>${esc(l.name)}</b> を一覧から外します。</p>` +
        '<p class="hint">開く先の画面には何も起きません。' +
        "入れ直せば元に戻ります。</p>",
    });
    if (!ok) return;
    try {
      await this.api.deleteLink(key);
      toast("削除しました");
      this.toggle(true);
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "リンクの削除");
      else toast(String(e), true);
    }
  }
}

/** 1 マス。押すと開き、触れているあいだだけ直す・消すが出る。 */
function tile(l: AppLink): string {
  const k = esc(l.key);
  const icon = ICONS.some((i) => i.v === l.icon) ? l.icon : DEFAULT_ICON;
  return (
    `<div class="lc-t"><button data-a="open" data-key="${k}" type="button"` +
    ` title="${esc(l.url)}">` +
    iconHTML(icon, true) +
    `<span>${esc(l.name)}</span></button>` +
    '<span class="lc-ops rowops">' +
    `<button data-a="edit" data-key="${k}" type="button" title="直す">` +
    '<svg class="ic"><use href="#ic-edit"/></svg></button>' +
    `<button data-a="del" data-key="${k}" type="button" class="dgr" title="削除">` +
    '<svg class="ic"><use href="#ic-delete"/></svg></button>' +
    "</span></div>"
  );
}
