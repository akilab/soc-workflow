/**
 * 起動。
 *
 * データを取ってきて、画面を出す。
 * 画面の切り替えは body の class で行う（app.css の body.screen-* に対応）。
 * ルータは持たない。画面は 4 つで、遷移も一方向なので、表示の出し分けで足りる。
 */

import "./app.css";

import { Api, ApiError } from "./api";
import { $, $as } from "./dom";
import { ContactsScreen } from "./screens/contacts";
import { EditScreen } from "./screens/edit";
import { EventsScreen } from "./screens/events";
import { TasksScreen } from "./screens/tasks";
import { Settings } from "./settings";
import { closeModal, showApiError, toast } from "./ui";

type Screen = "events" | "edit" | "contacts" | "tasks";

class App {
  private readonly api = new Api();
  private readonly events: EventsScreen;
  private readonly edit: EditScreen;
  private readonly contacts: ContactsScreen;
  private readonly tasks: TasksScreen;
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
    // 一覧系の画面には「戻る」を持たせない。左の帯がいつでも出ているので、
    // 戻るのではなく行き先を選べばよい。
    this.contacts = new ContactsScreen({ api: this.api });
    this.settings = new Settings(this.api);
    this.tasks = new TasksScreen({
      api: this.api,
      onPhases: () => this.settings.openPhases(),
    });

    // データが入れ替わったら描き直す。書き込みのたびに api が呼ぶ。
    this.api.onChange = () => this.render();
    this.api.onHistory = () => this.syncUndo();
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
    else if (this.screen === "contacts") this.contacts.render();
    else if (this.screen === "tasks") this.tasks.render();
    else this.events.render();
  }

  private show(screen: Screen): void {
    this.screen = screen;
    document.body.className = `screen-${screen}`;
    this.syncRail(screen);
    this.render();
  }

  private openEvent(key: string): void {
    this.screen = "edit";
    this.syncRail("edit");
    this.edit.open(key); // body の class は編集ビュー側が決める（テストで切り替わるため）
  }

  /**
   * 左の帯の現在地。
   *
   * フローを編集しているあいだも「フロー」を光らせたままにする。
   * 編集はフローの中にいる状態で、別の場所へ移ったわけではない。
   */
  private syncRail(screen: Screen): void {
    const at = screen === "edit" ? "events" : screen;
    for (const b of document.querySelectorAll<HTMLElement>("#appRail button")) {
      b.classList.toggle("on", b.dataset.nav === at);
    }
  }

  private bindGlobal(): void {
    for (const b of document.querySelectorAll<HTMLElement>("#appRail button")) {
      b.addEventListener("click", () => this.show(b.dataset.nav as Screen));
    }
    $("ewPhases").addEventListener("click", () => this.settings.openPhases());
    $("ewLanes").addEventListener("click", () => this.settings.openLanes());
    $("mClose").addEventListener("click", closeModal);
    $("mask").addEventListener("click", (e) => {
      if (e.target === $("mask")) closeModal(); // 外側を押したら閉じる
    });
    $("btnUndo").addEventListener("click", () => void this.stepHistory(true));
    $("btnRedo").addEventListener("click", () => void this.stepHistory(false));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      // 入力欄の中では、ブラウザ自身の取り消し（打った文字を戻す）に任せる。
      // ここで横取りすると、1 文字消したいだけなのに手順ごと戻ってしまう。
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      // ダイアログが開いているあいだも触らない。裏側のデータが
      // 入れ替わると、いま書いている内容が何に対するものか分からなくなる。
      if ($("mask").classList.contains("on")) return;

      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        void this.stepHistory(true);
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        void this.stepHistory(false);
      }
    });
  }

  /**
   * 1 手戻す（または進める）。
   *
   * 送る前に保存待ちの入力を出しきる。入力は 400ms 止まってから送られるので、
   * 打った直後に取り消すと、戻したあとに古い入力が届いて元へ戻ってしまう。
   */
  private async stepHistory(back: boolean): Promise<void> {
    try {
      // 出しきるのが先。打った直後の Ctrl+Z は、まだ送っていない入力が
      // 履歴に載っていないので、順序を逆にすると黙って空振りする。
      await this.edit.flush();
      if (!(back ? this.api.history.undo : this.api.history.redo)) return;

      const label = await this.api.stepHistory(back);
      toast(back ? `${label}を取り消しました` : `${label}をやり直しました`);
    } catch (e) {
      if (e instanceof ApiError) {
        showApiError(e, back ? "取り消せませんでした" : "やり直せませんでした");
      } else throw e;
    }
  }

  /** ボタンの出し分け。何が戻るのかは説明に出す。 */
  private syncUndo(): void {
    const h = this.api.history;
    const set = (id: string, label: string, verb: string, keys: string) => {
      const b = $as<HTMLButtonElement>(id);
      b.disabled = !label;
      b.title = label ? `${label}を${verb}（${keys}）` : `${verb}操作はありません`;
    };
    set("btnUndo", h.undo, "取り消す", "Ctrl+Z");
    set("btnRedo", h.redo, "やり直す", "Ctrl+Shift+Z");
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
