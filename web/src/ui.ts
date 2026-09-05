/**
 * 別の面（パネル・ダイアログ）とトースト。
 *
 * ブラウザ標準の prompt / confirm / alert は使わない。
 * 環境によっては prompt() が例外になる（モックでこれに当たった）うえ、
 * 見た目も画面から浮く。入力も確認も通知も、画面の中で受ける。
 *
 * 面は 2 種類だけ。Microsoft の作法にそろえてある。
 *
 *   パネル（右から出る）… 1 件を見る・直す。背後の一覧が見えたままなので、
 *                        「どれを直しているか」を見失わない。既定はこちら
 *   ダイアログ（中央）  … 短い決断だけ。特に取り消せない操作の確認
 *
 * モーダルは背後を全部隠して操作を止めるので、本当に止めるべきときにだけ使う。
 * 以前は入力も一覧の表示も全部モーダルだった。
 *
 * 呼ぶ側は openModal / askModal / confirmModal のままでよい。
 * どの面に出すかは、ここだけが決めている。
 */

import { $, esc } from "./dom";
import type { ApiError } from "./api";

/** いま開いている面を閉じる関数。Esc と背景クリックが使う。 */
let closeCurrent: (() => void) | null = null;

/**
 * 右のパネルを開く。読むもの・直すものはこちら。
 *
 * wide を立てると広く開く（書き出しのプレビューのように、
 * 中身そのものに幅が要るとき）。
 */
export function openModal(
  title: string,
  sub: string,
  bodyHtml: string,
  footHtml?: string,
  wide = false,
): void {
  $("pTitle").innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
  $("pBody").innerHTML = bodyHtml;
  $("pFoot").innerHTML =
    footHtml ?? '<button class="ed-tool" data-x="close">閉じる</button>';

  const panel = $("panel");
  panel.classList.toggle("wide", wide);
  panel.classList.add("on");
  closeCurrent = closePanel;

  for (const b of $("pFoot").querySelectorAll<HTMLElement>('[data-x="close"]')) {
    b.addEventListener("click", closePanel);
  }
  $("pClose").onclick = closePanel;
  $("pBody").querySelector<HTMLElement>("input,select,textarea,button")?.focus();
}

function closePanel(): void {
  $("panel").classList.remove("on");
  $("pBody").innerHTML = "";
  closeCurrent = null;
}

/** 中央のダイアログ。取り消せない確認だけに使う。 */
function openDialog(title: string, sub: string, bodyHtml: string, footHtml: string): void {
  $("mTitle").innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
  $("mBody").innerHTML = bodyHtml;
  $("mFoot").innerHTML = footHtml;
  $("mask").classList.add("on");
  closeCurrent = closeDialog;
}

function closeDialog(): void {
  $("mask").classList.remove("on");
  $("mBody").innerHTML = "";
  closeCurrent = null;
}

/** どちらの面でも、開いているものを閉じる。Esc と背景クリックから呼ぶ。 */
export function closeModal(): void {
  closeCurrent?.();
}

/** いずれかの面が開いているか。キー操作を横取りしてよいかの判断に使う。 */
export function surfaceOpen(): boolean {
  return closeCurrent !== null;
}

/**
 * openModal で開いた面の中身と足元。
 *
 * 開いたあとにボタンを配線する呼び出し側が使う。
 * 呼ぶ側が要素の id を直に知っていると、面を差し替えるたびに全部壊れる
 * （実際、パネルへ移したときに 4 か所が壊れた）。ここを通す。
 */
export function surfaceBody(): HTMLElement {
  return $("pBody");
}
export function surfaceFoot(): HTMLElement {
  return $("pFoot");
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

export interface AskField {
  /** 受け取った値のキー。 */
  k: string;
  label: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: "text" | "select";
  options?: { v: string; l: string }[];
}

export interface AskOptions {
  title: string;
  sub?: string;
  okLabel?: string;
  fields: AskField[];
}

/** 入力を受け取る。取り消されたら null。 */
export function askModal(o: AskOptions): Promise<Record<string, string> | null> {
  const body = o.fields
    .map((f, i) => {
      if (f.type === "select") {
        const opts = (f.options ?? [])
          .map(
            (op) =>
              `<option value="${esc(op.v)}"${op.v === f.value ? " selected" : ""}>` +
              `${esc(op.l)}</option>`,
          )
          .join("");
        return (
          `<label>${esc(f.label)}</label>` +
          `<select data-f="${i}">${opts}</select>` +
          (f.hint ? `<p class="hint">${esc(f.hint)}</p>` : "")
        );
      }
      return (
        `<label>${esc(f.label)}${f.required ? "" : "（任意）"}</label>` +
        `<input type="text" data-f="${i}" value="${esc(f.value ?? "")}"` +
        ` placeholder="${esc(f.placeholder ?? "")}">` +
        (f.hint ? `<p class="hint">${esc(f.hint)}</p>` : "")
      );
    })
    .join("");

  return new Promise((resolve) => {
    openModal(
      o.title,
      o.sub ?? "",
      `<div class="ins formx">${body}</div>`,
      '<button class="ed-tool" data-x="cancel">キャンセル</button>' +
        `<button class="ed-tool pri" data-x="ok">${esc(o.okLabel ?? "作成")}</button>`,
    );

    const mb = $("pBody");
    const mf = $("pFoot");

    const ok = () => {
      const v: Record<string, string> = {};
      o.fields.forEach((f, i) => {
        const input = mb.querySelector<HTMLInputElement | HTMLSelectElement>(
          `[data-f="${i}"]`,
        );
        v[f.k] = (input?.value ?? "").trim();
      });
      const miss = o.fields.find((f) => f.required && !v[f.k]);
      if (miss) {
        toast(`${miss.label}を入力してください`, true);
        return;
      }
      closeModal();
      resolve(v);
    };

    mf.querySelector('[data-x="ok"]')?.addEventListener("click", ok);
    mf.querySelector('[data-x="cancel"]')?.addEventListener("click", () => {
      closeModal();
      resolve(null);
    });
    mb.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        ok();
      }
    });
    mb.querySelector<HTMLElement>("[data-f]")?.focus();
  });
}

// ---------------------------------------------------------------------------
// 確認
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  sub?: string;
  /** そのまま HTML として入る。呼ぶ側で esc すること。 */
  message: string;
  okLabel?: string;
  danger?: boolean;
}

/**
 * 確認。ここだけは中央のダイアログにする。
 *
 * 削除のように取り消せない操作は、背後の操作を止めて手を止めさせるのが正しい。
 * 逆に言えば、止める必要のないものはパネルに出す。
 */
export function confirmModal(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog(
      o.title,
      o.sub ?? "",
      `<div class="ins"><div class="cfm">${o.message}</div></div>`,
      '<button class="ed-tool" data-x="cancel">キャンセル</button>' +
        `<button class="ed-tool ${o.danger ? "dgr" : "pri"}" data-x="ok">` +
        `${esc(o.okLabel ?? "実行")}</button>`,
    );
    const mf = $("mFoot");
    mf.querySelector('[data-x="ok"]')?.addEventListener("click", () => {
      closeModal();
      resolve(true);
    });
    mf.querySelector('[data-x="cancel"]')?.addEventListener("click", () => {
      closeModal();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

let toastTimer: number | undefined;

export function toast(msg: string, warn = false): void {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast on${warn ? " warn" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.className = `toast${warn ? " warn" : ""}`;
  }, 2600);
}

/**
 * サーバに断られたことを伝える。
 *
 * 使用中で消せない場合は、どこで使われているかまで出す。
 * 件数だけ見せて終わりにすると、利用者は次に何をすればよいか分からない。
 */
export function showApiError(err: ApiError, context: string): void {
  if (err.isInUse && err.usage.length) {
    const rows = err.usage
      .map((u) =>
        u.eventTitle
          ? `<li><b>${esc(u.eventTitle)}</b> — ${esc(u.label)}</li>`
          : `<li>${esc(u.label)}</li>`,
      )
      .join("");
    // 妨げているものによって、直し方が違う。「参照を外す」で済むのは
    // 対応や連絡先の話で、これを元にしたフローは外しようがない。
    const hint = err.usage.every((u) => u.kind === "event")
      ? "これらは、このフローを元にして作られたものです。" +
        "先にそちらを削除するか、別のフローから作り直してください。"
      : "先にこれらの参照を外してください。";
    openModal(
      context,
      "削除できません",
      `<div class="ins"><div class="cfm"><p>${esc(err.message)}</p>` +
        `<ul class="uses">${rows}</ul>` +
        `<p class="hint">${hint}</p></div></div>`,
    );
    return;
  }
  toast(err.message, true);
}
