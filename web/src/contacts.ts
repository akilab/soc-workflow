/** 連絡先の表示に使う小物。 */

import type { Channel, ContactGroup, ContactMember, DB, Step, Via } from "./types";

/**
 * その人に入力されている連絡手段だけを、表示順に返す。
 *
 * Go 側の (*ContactMember).Channels と同じ順序・同じ判定。
 * ずれると、エディタと書き出し HTML で連絡手段の並びが変わる。
 */
export function memberChannels(m: ContactMember): Channel[] {
  const all: Channel[] = [
    { via: "phone", value: m.tel },
    { via: "teams", value: m.teams },
    { via: "elgana", value: m.elgana },
    { via: "mail", value: m.mail },
  ];
  return all.filter((c) => c.value !== "");
}

/** その手順が参照している連絡先グループ。消えたキーは落とす。 */
export function stepContacts(db: DB, st: Step): ContactGroup[] {
  return (st.contacts ?? [])
    .map((key) => db.contactGroups.find((g) => g.key === key))
    .filter((g): g is ContactGroup => !!g);
}

/** グループの中で使われている連絡手段（重複なし・出現順）。 */
export function groupVias(g: ContactGroup): Via[] {
  const seen = new Set<Via>();
  const out: Via[] = [];
  for (const m of g.members ?? []) {
    for (const c of memberChannels(m)) {
      if (!seen.has(c.via)) {
        seen.add(c.via);
        out.push(c.via);
      }
    }
  }
  return out;
}

/** 連絡手段の印。アイコンがあれば SVG、無ければ頭文字。 */
export function viaMark(v: { ico?: string; m: string }): string {
  return v.ico ? `<svg class="vico"><use href="#${v.ico}"/></svg>` : v.m;
}
