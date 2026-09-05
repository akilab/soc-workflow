/**
 * 連絡先画面。
 *
 * グループ（カテゴリ）が連絡順のメンバーを持つ、という形をそのまま出す。
 * 「管理職に連絡」は 1 番から順に掛けて、繋がらなければ次へ——という運用が
 * 現にあるので、名簿ではなく順序付きの並びとして扱う。
 *
 * この画面でしか直せないものが 1 つある。グループの「担当」で、この連絡先を
 * フロー図のどの列に置くかを決める。移行してきたデータは 14 グループ中 9 つが
 * これを持っていないため、手順で参照していても図に線が出ない。
 * だから未設定を数えて上に出し、絞り込みでも選べるようにしてある。
 *
 * 画面に出す言葉は「担当なし」に揃えてある。実装では矢印を引く／引かないの話だが、
 * 利用者から見ると担当の列が決まっているかどうかの話なので、そちらの言い方にする。
 */

import { Api, ApiError, type ContactInput } from "../api";
import { groupVias, memberChannels, viaMark } from "../contacts";
import { $, $as, esc } from "../dom";
import type { ContactGroup, ContactKind, ContactMember, Via } from "../types";
import { KIND_LABEL } from "../types";
import { askModal, confirmModal, showApiError, toast } from "../ui";

export interface ContactsDeps {
  api: Api;
}

/** 空のメンバー。欄を増やしたときに入れ忘れないよう、1 か所で作る。 */
function emptyMember(): ContactMember {
  return { name: "", tel: "", teams: "", elgana: "", mail: "", note: "" };
}

export class ContactsScreen {
  private readonly api: Api;

  private q = "";
  private kindF: ContactKind | "all" = "all";
  private viaF: Via | "all" = "all";
  /** "all" ／ "none"（矢印なし）／ 担当のキー */
  private laneF = "all";

  constructor(deps: ContactsDeps) {
    this.api = deps.api;

    $("ctNew").addEventListener("click", () => void this.createGroup());

    const search = $as<HTMLInputElement>("ctSearch");
    search.addEventListener("input", () => {
      this.q = search.value;
      this.renderList();
    });

    $as<HTMLSelectElement>("ctKindF").addEventListener("change", (e) => {
      this.kindF = (e.target as HTMLSelectElement).value as ContactKind | "all";
      this.renderList();
    });
    $as<HTMLSelectElement>("ctViaF").addEventListener("change", (e) => {
      this.viaF = (e.target as HTMLSelectElement).value as Via | "all";
      this.renderList();
    });
    $as<HTMLSelectElement>("ctLaneF").addEventListener("change", (e) => {
      this.laneF = (e.target as HTMLSelectElement).value;
      this.renderList();
    });
  }

  render(): void {
    this.fillLaneFilter();
    this.renderList();
  }

  /** 担当の絞り込みは、そのときの担当設定から作る。 */
  private fillLaneFilter(): void {
    const sel = $as<HTMLSelectElement>("ctLaneF");
    const keep = sel.value || this.laneF;
    sel.innerHTML =
      '<option value="all">すべての担当</option>' +
      '<option value="none">担当なし</option>' +
      this.api.db.lanes
        .map((l) => `<option value="${esc(l.key)}">${esc(l.name)}</option>`)
        .join("");
    // 担当が消えていたら「すべて」に戻す。選べない値が残るほうが分かりにくい。
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "all";
    this.laneF = sel.value;
  }

  private renderList(): void {
    const groups = this.api.db.contactGroups;
    const box = $("ctList");
    box.innerHTML = "";

    let members = 0;
    let hit = 0;
    for (const g of groups) {
      if (!this.match(g)) continue;
      hit++;
      members += g.members.length;
      box.appendChild(this.card(g));
    }

    $("ctCount").textContent =
      hit === groups.length
        ? `${groups.length} グループ・${members} 名`
        : `${hit} / ${groups.length} グループ`;

    const used = groups.filter((g) => this.usedBy(g.key).length).length;
    const noLane = groups.filter((g) => !g.lane).length;
    $("ctStat").innerHTML =
      `使用中 ${used} / 未使用 ${groups.length - used}` +
      (noLane
        ? ` ・ <b class="warn" title="この ${noLane} グループは、どの列に置くかが決まっていないため、` +
          `フロー図に線が出ません">担当なし ${noLane}</b>`
        : "");

    for (const id of ["ctKindF", "ctViaF", "ctLaneF"]) {
      const el = $as<HTMLSelectElement>(id);
      el.classList.toggle("on", el.value !== "all");
    }

    if (!hit) {
      box.innerHTML = groups.length
        ? '<p class="pal-empty">条件に合う連絡先がありません。</p>'
        : '<p class="pal-empty">連絡先がまだありません。' +
          "上の「作成」から作ってください。</p>";
    }
  }

  private match(g: ContactGroup): boolean {
    if (this.kindF !== "all" && g.kind !== this.kindF) return false;
    if (this.viaF !== "all" && !groupVias(g).includes(this.viaF)) return false;
    if (this.laneF === "none" && g.lane) return false;
    if (this.laneF !== "all" && this.laneF !== "none" && g.lane !== this.laneF) {
      return false;
    }

    const q = this.q.trim().toLowerCase();
    if (!q) return true;
    // 電話番号やアカウント名でも引けるようにする。
    // 「あの番号は誰だったか」から辿ることが実際にある。
    const hay = [
      g.name,
      g.note,
      ...g.members.flatMap((m) => [
        m.name,
        m.tel,
        m.teams,
        m.elgana,
        m.mail,
        m.note,
      ]),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  }

  /** この連絡先を参照している手順。 */
  private usedBy(key: string): { ev: string; title: string }[] {
    const out: { ev: string; title: string }[] = [];
    for (const ev of this.api.db.events) {
      for (const st of ev.steps) {
        if ((st.contacts ?? []).includes(key)) {
          out.push({ ev: ev.title, title: st.title });
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // カード
  // -------------------------------------------------------------------------

  private card(g: ContactGroup): HTMLElement {
    const kd = KIND[g.kind] ?? { l: g.kind, c: "var(--line)" };
    const uses = this.usedBy(g.key);
    const evNames = [...new Set(uses.map((u) => u.ev))];
    const lane = this.api.db.lanes.find((l) => l.key === g.lane);

    const card = document.createElement("div");
    card.className = "cg";
    card.style.setProperty("--kc", kd.c);

    // フロー図でこの連絡先を置く列。空だと、手順で参照しても線が引かれない。
    // 黙って線が出ないのが一番たちが悪いので、未設定もはっきり書く。
    const laneTag = lane
      ? `<span class="bdg cg-lane" style="--tc:${lane.color}" ` +
        `title="この連絡先を使う手順から、「${esc(lane.name)}」の列へ線が引かれます">` +
        `→ ${esc(lane.name)}</span>`
      : '<span class="bdg cg-lane none" title="どの列に置くかが決まっていないため、' +
        'フロー図には線が出ません（手順の連絡先一覧には出ます）">担当なし</span>';

    card.innerHTML =
      `<div class="cg-h"><b>${esc(g.name)}</b>` +
      `<span class="bdg kind">${esc(kd.l)}</span>` +
      laneTag +
      `<span class="cnt">${g.members.length} 名</span>` +
      `<span class="bdg use${uses.length ? " on" : ""}">` +
      (uses.length ? `${uses.length} 手順で使用` : "未使用") +
      "</span>" +
      '<span class="sp"></span>' +
      '<button class="ed-tool sm" data-ed>編集</button>' +
      '<button class="ed-tool sm dgr" data-rm' +
      (uses.length
        ? ` disabled title="${uses.length} 手順で使用中のため削除できません"`
        : "") +
      ">削除</button></div>" +
      (g.note ? `<p class="cg-note">${esc(g.note)}</p>` : "") +
      (evNames.length
        ? `<p class="cg-uses">使用: ${esc(evNames.join("、"))}</p>`
        : "") +
      '<div class="cg-mem"><h5>' +
      (g.members.length > 1 ? "メンバー（連絡順）" : "メンバー") +
      "</h5><div data-mem></div>" +
      '<button class="addrow" data-add>' +
      '<svg class="ic"><use href="#ic-add"/></svg>メンバーを追加</button></div>';

    const mem = card.querySelector<HTMLElement>("[data-mem]")!;
    if (!g.members.length) {
      mem.innerHTML =
        '<p class="pal-empty" style="margin:0 0 6px">メンバーがいません。</p>';
    }
    g.members.forEach((m, i) => mem.appendChild(this.memberLine(g, m, i)));

    card
      .querySelector("[data-ed]")!
      .addEventListener("click", () => void this.editGroup(g));
    card
      .querySelector("[data-add]")!
      .addEventListener("click", () => void this.addMember(g));
    if (!uses.length) {
      card
        .querySelector("[data-rm]")!
        .addEventListener("click", () => void this.deleteGroup(g));
    }
    return card;
  }

  private memberLine(
    g: ContactGroup,
    m: ContactMember,
    i: number,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = "mem" + (i === 0 && g.members.length > 1 ? " first" : "");
    el.innerHTML =
      (g.members.length > 1 ? `<span class="no">${i + 1}</span>` : "") +
      `<span class="who">${esc(m.name)}</span>` +
      memberChannels(m)
        .map((ch) => {
          const v = VIA[ch.via] ?? { m: "?", c: "#7d8798", l: ch.via };
          return (
            `<span class="ch" style="--vc:${v.c}" title="${esc(v.l)}">` +
            `<i${v.ico ? ' class="ico"' : ""}>${viaMark(v)}</i>` +
            `${esc(ch.value)}</span>`
          );
        })
        .join("") +
      '<span class="sp"></span>' +
      '<span class="ops rowops">' +
      `<button data-up${i === 0 ? " disabled" : ""} title="上へ">` +
      '<svg class="ic"><use href="#ic-chev-u"/></svg></button>' +
      `<button data-dn${i === g.members.length - 1 ? " disabled" : ""} title="下へ">` +
      '<svg class="ic"><use href="#ic-chev-d"/></svg></button>' +
      '<button data-ed title="編集"><svg class="ic"><use href="#ic-edit"/></svg></button>' +
      '<button data-rm class="dgr" title="削除">' +
      '<svg class="ic"><use href="#ic-delete"/></svg></button></span>' +
      (m.note ? `<span class="mnt">${esc(m.note)}</span>` : "");

    el.querySelector("[data-up]")!.addEventListener("click", () => {
      if (i > 0) void this.swap(g, i, i - 1);
    });
    el.querySelector("[data-dn]")!.addEventListener("click", () => {
      if (i < g.members.length - 1) void this.swap(g, i, i + 1);
    });
    el.querySelector("[data-ed]")!.addEventListener("click", () => {
      void this.editMember(g, i);
    });
    el.querySelector("[data-rm]")!.addEventListener("click", () => {
      void this.deleteMember(g, i);
    });
    return el;
  }

  // -------------------------------------------------------------------------
  // 変更
  // -------------------------------------------------------------------------

  /** グループ 1 つを丸ごと送る。メンバー個別の API は無く、常にこの形になる。 */
  private input(
    g: ContactGroup,
    over: Partial<ContactInput> = {},
  ): ContactInput {
    return {
      name: g.name,
      kind: g.kind,
      note: g.note,
      lane: g.lane,
      members: g.members,
      ...over,
    };
  }

  private async save(
    g: ContactGroup,
    over: Partial<ContactInput>,
    done: string,
  ): Promise<void> {
    try {
      await this.api.updateContactGroup(g.key, this.input(g, over));
      toast(done);
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "連絡先を保存できませんでした");
      else throw e;
    }
  }

  private kindOptions(): { v: string; l: string }[] {
    return (Object.keys(KIND_LABEL) as ContactKind[]).map((k) => ({
      v: k,
      l: KIND_LABEL[k],
    }));
  }

  private laneOptions(): { v: string; l: string }[] {
    return [
      { v: "", l: "（担当なし・図に線を出さない）" },
      ...this.api.db.lanes.map((l) => ({ v: l.key, l: l.name })),
    ];
  }

  private async createGroup(): Promise<void> {
    const v = await askModal({
      title: "新しい連絡先グループ",
      sub: "まずグループを作り、あとからメンバーを足します",
      okLabel: "作成",
      fields: [
        {
          k: "name",
          label: "グループ名",
          required: true,
          placeholder: "例: 管理職",
        },
        {
          k: "kind",
          label: "区分",
          type: "select",
          options: this.kindOptions(),
          value: "internal",
        },
        {
          k: "lane",
          label: "担当",
          type: "select",
          options: this.laneOptions(),
          value: "",
          hint: "この連絡先をフロー図のどの列に置くかです。決めておくと、この連絡先を使う手順からその列へ線が引かれます。",
        },
        { k: "note", label: "補足", placeholder: "任意" },
      ],
    });
    if (!v) return;

    try {
      await this.api.createContactGroup({
        name: v.name,
        kind: v.kind as ContactKind,
        note: v.note,
        lane: v.lane,
        members: [],
      });
      toast("作成しました");
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "連絡先を作れませんでした");
      else throw e;
    }
  }

  private async editGroup(g: ContactGroup): Promise<void> {
    const uses = this.usedBy(g.key);
    const v = await askModal({
      title: "グループを編集",
      sub: g.name,
      okLabel: "保存",
      fields: [
        {
          k: "name",
          label: "グループ名",
          value: g.name,
          required: true,
          hint: uses.length
            ? `${uses.length} 手順から参照されています。ここを直せば全てに反映されます。`
            : undefined,
        },
        {
          k: "kind",
          label: "区分",
          type: "select",
          options: this.kindOptions(),
          value: g.kind,
        },
        {
          k: "lane",
          label: "担当",
          type: "select",
          options: this.laneOptions(),
          value: g.lane,
          hint: g.lane
            ? "この連絡先をフロー図のどの列に置くかです。"
            : "いまは図に線が出ません。列を決めると、この連絡先を使う手順から線が引かれます。",
        },
        { k: "note", label: "補足", value: g.note },
      ],
    });
    if (!v) return;

    await this.save(
      g,
      { name: v.name, kind: v.kind as ContactKind, note: v.note, lane: v.lane },
      "保存しました",
    );
  }

  private async deleteGroup(g: ContactGroup): Promise<void> {
    const ok = await confirmModal({
      title: "グループを削除",
      sub: g.name,
      danger: true,
      okLabel: "削除する",
      message:
        (g.members.length
          ? `「${esc(g.name)}」を、メンバー ${g.members.length} 名ごと削除します。`
          : `「${esc(g.name)}」を削除します。`) +
        "<br>どの手順でも使われていないため、影響はありません。",
    });
    if (!ok) return;

    try {
      await this.api.deleteContactGroup(g.key);
      toast("削除しました");
    } catch (e) {
      if (e instanceof ApiError) showApiError(e, "連絡先を削除できませんでした");
      else throw e;
    }
  }

  private memberFields(m: ContactMember) {
    return [
      { k: "name", label: "名前", value: m.name, required: true },
      { k: "tel", label: "電話", value: m.tel, placeholder: "任意" },
      { k: "teams", label: "Teams", value: m.teams, placeholder: "任意" },
      { k: "elgana", label: "Elgana", value: m.elgana, placeholder: "任意" },
      { k: "mail", label: "メール", value: m.mail, placeholder: "任意" },
      {
        k: "note",
        label: "補足",
        value: m.note,
        placeholder: "任意",
        hint: "入力した手段だけが表示されます。",
      },
    ];
  }

  private toMember(v: Record<string, string>): ContactMember {
    return {
      name: v.name,
      tel: v.tel,
      teams: v.teams,
      elgana: v.elgana,
      mail: v.mail,
      note: v.note,
    };
  }

  private async addMember(g: ContactGroup): Promise<void> {
    const v = await askModal({
      title: "メンバーを追加",
      sub: g.name,
      okLabel: "追加",
      fields: this.memberFields(emptyMember()),
    });
    if (!v) return;
    await this.save(
      g,
      { members: [...g.members, this.toMember(v)] },
      "追加しました",
    );
  }

  private async editMember(g: ContactGroup, i: number): Promise<void> {
    const m = g.members[i];
    const v = await askModal({
      title: "メンバーを編集",
      sub: `${g.name} ／ ${m.name}`,
      okLabel: "保存",
      fields: this.memberFields(m),
    });
    if (!v) return;

    const members = [...g.members];
    members[i] = this.toMember(v);
    await this.save(g, { members }, "保存しました");
  }

  private async deleteMember(g: ContactGroup, i: number): Promise<void> {
    const m = g.members[i];
    const ok = await confirmModal({
      title: "メンバーを削除",
      sub: g.name,
      danger: true,
      okLabel: "削除する",
      message: `「${esc(m.name)}」をこのグループから外します。`,
    });
    if (!ok) return;

    await this.save(
      g,
      { members: g.members.filter((_, x) => x !== i) },
      "削除しました",
    );
  }

  /** 連絡順を 1 つ入れ替える。並びがそのまま「掛ける順番」なので、順序が意味を持つ。 */
  private async swap(g: ContactGroup, a: number, b: number): Promise<void> {
    const members = [...g.members];
    [members[a], members[b]] = [members[b], members[a]];
    await this.save(g, { members }, "連絡順を入れ替えました");
  }
}
