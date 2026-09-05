/**
 * ランチャー。左上の点の集まりから開く、外部の画面への近道。
 *
 * Defender ポータルの同じ位置にあるものに倣っている。SOC の作業は 1 つの画面で
 * 完結しない——Defender で見て、Intune で端末を確認して、Teams で連絡する。
 * その行き来を、対応フローを設計しているこの画面からも始められるようにする。
 *
 * 並べるものは組織ごとに違うので、固定しない。作る・直す・消すができる。
 *
 * **アイコンは自由に指定できない。** ここに並べたものから選ぶ。好きな絵を
 * 持ち込めるようにすると、画面ごとに大きさも太さも色も変わり、並べたときに
 * 揃わなくなる。Microsoft の各サービスは製品そのものの絵ではなく、
 * 同じ体系（Fluent のアイコン）から意味の近いものを当ててある。
 * 製品の絵を使いたくなったら items/ に置いてもらえば差し替えられる。
 */

import { Api, ApiError } from "./api";
import { $, esc, onAction } from "./dom";
import type { AppLink } from "./types";
import { askModal, confirmModal, showApiError, toast } from "./ui";

/** 選べるアイコン。値はスプライトの id、l は選ぶときに出す言葉。 */
export const ICONS: { v: string; l: string }[] = [
  { v: "shield", l: "Defender / セキュリティ" },
  { v: "key", l: "Entra ID / 認証" },
  { v: "device", l: "Intune / 端末" },
  { v: "team", l: "Teams / チャット" },
  { v: "sparkle", l: "Copilot / AI" },
  { v: "flowchart", l: "Logic Apps / 自動化" },
  { v: "mail", l: "Outlook / メール" },
  { v: "cloud", l: "Azure / クラウド" },
  { v: "ticket", l: "チケット" },
  { v: "book", l: "手順書・ナレッジ" },
  { v: "search", l: "検索・ハンティング" },
  { v: "alert", l: "アラート・監視" },
  { v: "people", l: "名簿・組織" },
  { v: "settings", l: "管理・設定" },
  { v: "globe", l: "外部サイト" },
  { v: "link", l: "その他のリンク" },
];

const DEFAULT_ICON = "link";

export class Launcher {
  private readonly api: Api;
  private open = false;

  constructor(api: Api) {
    this.api = api;
    this.bind();
  }

  /** 中身を描き直す。データが入れ替わるたびに呼ばれる。 */
  render(): void {
    const links = this.api.db.links ?? [];
    $("launchGrid").innerHTML =
      links.map((l) => tile(l)).join("") +
      '<button class="lc-new" data-a="new" type="button">' +
      '<svg class="ic lg"><use href="#ic-add"/></svg>新規</button>';
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
      if (e.key === "Escape" && this.open) this.toggle(false);
    });

    onAction($("launchGrid"), (action, target, ev) => {
      ev.stopPropagation();
      const key = target.dataset.key ?? "";
      if (action === "new") {
        void this.create();
      } else if (action === "open") {
        this.openLink(key);
      } else if (action === "edit") {
        void this.edit(key);
      } else if (action === "del") {
        void this.remove(key);
      }
    });
  }

  private toggle(on: boolean): void {
    this.open = on;
    $("launcher").classList.toggle("on", on);
    $("appMenu").classList.toggle("on", on);
    if (on) this.render();
  }

  /**
   * 別のタブで開く。
   *
   * noopener を付けるのは、開いた先から呼び出し元の画面を触られないようにするため
   * （window.opener 経由で書き換えられる。外部の画面を開く以上は必ず付ける）。
   */
  private openLink(key: string): void {
    const l = (this.api.db.links ?? []).find((x) => x.key === key);
    if (!l) return;
    window.open(l.url, "_blank", "noopener,noreferrer");
    this.toggle(false);
  }

  private async create(): Promise<void> {
    const v = await ask("リンクを追加", "この画面から開けるようにします");
    if (!v) return;
    try {
      await this.api.createLink({ name: v.name, url: v.url, icon: v.icon });
      toast(`「${v.name}」を追加しました`);
      this.toggle(true);
    } catch (e) {
      this.fail(e, "リンクの追加");
    }
  }

  private async edit(key: string): Promise<void> {
    const l = (this.api.db.links ?? []).find((x) => x.key === key);
    if (!l) return;
    const v = await ask("リンクを直す", l.name, l);
    if (!v) return;
    try {
      await this.api.updateLink(key, { name: v.name, url: v.url, icon: v.icon });
      toast("直しました");
      this.toggle(true);
    } catch (e) {
      this.fail(e, "リンクの変更");
    }
  }

  private async remove(key: string): Promise<void> {
    const l = (this.api.db.links ?? []).find((x) => x.key === key);
    if (!l) return;
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
      this.fail(e, "リンクの削除");
    }
  }

  private fail(e: unknown, context: string): void {
    if (e instanceof ApiError) showApiError(e, context);
    else toast(String(e), true);
  }
}

/** 1 マス。押すと開き、触れているあいだだけ直す・消すが出る。 */
function tile(l: AppLink): string {
  const k = esc(l.key);
  const icon = ICONS.some((i) => i.v === l.icon) ? l.icon : DEFAULT_ICON;
  return (
    `<div class="lc-t"><button data-a="open" data-key="${k}" type="button"` +
    ` title="${esc(l.url)}">` +
    `<svg class="ic lg"><use href="#ic-${esc(icon)}"/></svg>` +
    `<span>${esc(l.name)}</span></button>` +
    '<span class="lc-ops rowops">' +
    `<button data-a="edit" data-key="${k}" type="button" title="直す">` +
    '<svg class="ic"><use href="#ic-edit"/></svg></button>' +
    `<button data-a="del" data-key="${k}" type="button" class="dgr" title="削除">` +
    '<svg class="ic"><use href="#ic-delete"/></svg></button>' +
    "</span></div>"
  );
}

/** 追加と変更で同じ入力を使う。 */
async function ask(
  title: string,
  sub: string,
  now?: AppLink,
): Promise<{ name: string; url: string; icon: string } | null> {
  const v = await askModal({
    title,
    sub,
    okLabel: now ? "保存する" : "追加する",
    fields: [
      {
        k: "icon",
        label: "アイコン",
        type: "icon",
        value: now?.icon ?? DEFAULT_ICON,
        options: ICONS,
        hint: "決めたものから選びます。並べたときに大きさと太さを揃えるためです。",
      },
      {
        k: "name",
        label: "表示名",
        required: true,
        value: now?.name ?? "",
        placeholder: "Defender ポータル",
      },
      {
        k: "url",
        label: "URL",
        required: true,
        value: now?.url ?? "",
        placeholder: "https://security.microsoft.com/",
        hint: "http:// か https:// で始まるものだけ受け付けます。",
      },
    ],
  });
  if (!v) return null;
  return { name: v.name, url: v.url, icon: v.icon || DEFAULT_ICON };
}
