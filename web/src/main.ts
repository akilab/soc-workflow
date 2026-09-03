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
import { EditScreen } from "./screens/edit";
import { EventsScreen } from "./screens/events";
import { Settings } from "./settings";
import { closeModal } from "./ui";

type Screen = "events" | "edit";

class App {
  private readonly api = new Api();
  private readonly events: EventsScreen;
  private readonly edit: EditScreen;
  private readonly settings: Settings;

  /** いま出ている画面。データが入れ替わったとき、どちらを描き直すかを決める。 */
  private screen: Screen = "events";

  constructor() {
    this.events = new EventsScreen({
      api: this.api,
      onOpen: (key) => this.openEvent(key),
    });
    this.edit = new EditScreen({
      api: this.api,
      onBack: () => this.show("events"),
    });
    this.settings = new Settings(this.api);

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
    if (this.screen === "edit") this.edit.render();
    else this.events.render();
  }

  private show(screen: Screen): void {
    this.screen = screen;
    document.body.className = `screen-${screen}`;
    this.render();
  }

  private openEvent(key: string): void {
    this.screen = "edit";
    this.edit.open(key); // body の class は編集ビュー側が決める（試走で切り替わるため）
  }

  private bindGlobal(): void {
    $("ewPhases").addEventListener("click", () => this.settings.openPhases());
    $("ewLanes").addEventListener("click", () => this.settings.openLanes());
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
