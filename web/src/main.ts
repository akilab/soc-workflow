/**
 * 起動。
 *
 * データを取ってきて、画面を出す。
 * 画面の切り替えは body の class で行う（app.css の body.screen-* に対応）。
 * ルータは持たない。画面は 4 つで、遷移も一方向なので、表示の出し分けで足りる。
 */

import "./app.css";

import { Api, ApiError } from "./api";
import { $ } from "./dom";
import { EventsScreen } from "./screens/events";
import { closeModal, toast } from "./ui";

type Screen = "events" | "edit" | "tasks" | "contacts";

class App {
  private readonly api = new Api();
  private readonly events: EventsScreen;

  constructor() {
    this.events = new EventsScreen({
      api: this.api,
      onOpen: (key) => this.openEvent(key),
    });

    // データが入れ替わったら描き直す。書き込みのたびに api が呼ぶ。
    this.api.onChange = () => this.render();
  }

  async start(): Promise<void> {
    initTheme();
    ensureViaSprite();
    this.bindGlobal();

    try {
      await this.api.load();
    } catch (e) {
      this.showFatal(e);
      return;
    }
    this.show("events");
  }

  private render(): void {
    this.events.render();
  }

  private show(screen: Screen): void {
    document.body.className = `screen-${screen}`;
    this.render();
  }

  private openEvent(key: string): void {
    // 編集ビューはこれから移植する。今は開けることだけ確かめられればよい。
    const ev = this.api.db.events.find((e) => e.key === key);
    toast(ev ? `「${ev.title}」— 編集ビューは移植中です` : "事象が見つかりません");
  }

  private bindGlobal(): void {
    $("mClose").addEventListener("click", closeModal);
    $("mask").addEventListener("click", (e) => {
      if (e.target === $("mask")) closeModal(); // 外側を押したら閉じる
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  /**
   * 起動できなかったとき。
   *
   * サーバが落ちている・別のプロセスが掴んでいる、といった状況では
   * 画面が空のまま何も言わないのが一番困る。理由を出して手を止める。
   */
  private showFatal(e: unknown): void {
    const msg = e instanceof ApiError ? e.message : String(e);
    document.body.className = "screen-events";
    $("ewGrid").innerHTML =
      '<div class="ew-card"><div class="ew-hd"><b>データを読み込めません</b></div>' +
      `<p class="ew-sub">${escapeText(msg)}</p>` +
      '<p class="ew-sub">サーバが動いているか確認してから、再読み込みしてください。</p></div>';
  }
}

function escapeText(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

void new App().start();
