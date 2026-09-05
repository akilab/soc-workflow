/**
 * API クライアント。
 *
 * 読み取りは GET /api/db の 1 本で全部持ってくる（27.7 KB）。
 * 画面はここが抱えている db を見て描く。手元にあるので描画は即座に済む。
 *
 * 書き込みは資源ごと。応答の rev が飛んでいたら（＝別のタブが書いた）取り直す。
 * 取り直しても一瞬なので、衝突を解決する仕掛けは持たない。
 */

import type {
  AppLink,
  ContactGroup,
  EventSLA,
  SLA,
  ContactKind,
  ContactMember,
  Condition,
  DB,
  Decision,
  Envelope,
  ErrorBody,
  EventFlow,
  EventLane,
  HistoryState,
  Lane,
  Phase,
  Severity,
  Step,
  Task,
  TaskKind,
  Usage,
} from "./types";

/** サーバが断ったときに投げる。画面はこれを捕まえてメッセージを出す。 */
export class ApiError extends Error {
  readonly status: number;
  /** 削除を断られたときの使用箇所。無ければ空。 */
  readonly usage: Usage[];

  constructor(status: number, message: string, usage: Usage[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.usage = usage;
  }

  /** 使われているので消せない、という断り方かどうか。 */
  get isInUse(): boolean {
    return this.status === 409;
  }
}

/** 並べ替えの要求。 */
interface OrderBody {
  keys: string[];
}

/**
 * 書き込みの指定。
 *
 * quiet を立てると、送ったあとに全データを取り直さない。
 * 手元をすでに書き換えてある場合に使う。取り直すと onChange が走って画面が
 * 作り直され、入力中の欄からフォーカスが外れてしまう。
 */
export interface WriteOptions {
  quiet?: boolean;
}

/** フローを作る／直すときに送る中身。手順は含まない。 */
export interface EventInput {
  title: string;
  sub: string;
  severity: Severity;
}

export interface TaskInput {
  phase: string;
  lane: string;
  kind: TaskKind;
  label: string;
  note: string;
}

export interface PhaseInput {
  name: string;
  color: string;
}

export interface SLAInput {
  name: string;
  minutes: number;
  note: string;
}

export interface LinkInput {
  name: string;
  url: string;
  icon: string;
}

export interface LaneInput {
  name: string;
  color: string;
}

export interface ContactInput {
  name: string;
  kind: ContactKind;
  note: string;
  lane: string;
  members: ContactMember[];
}

/**
 * 手順を、サーバへ送る形にする。
 *
 * 手元の Step から、更新で送ってよい欄だけを取り出す。id と、サーバが決める
 * ものは含めない。インスペクタからもキャンバスからも使う。
 */
export function stepInput(st: Step): StepInput {
  return {
    task: st.task,
    lane: st.lane,
    title: st.title,
    detail: st.detail,
    sla: st.sla,
    milestone: st.milestone ?? "",
    escalate: st.escalate,
    contacts: st.contacts ?? [],
    conditions: st.conditions ?? [],
    decision: st.decision ?? null,
  };
}

/** 手順をどこへ置くか。どちらも省略できる。 */
export interface StepPlacement {
  /** 挿入位置。省略すると末尾。 */
  index?: number;
  /** 担当。省略すると対応の既定値。 */
  lane?: string;
}

/** 手順の中身。更新のときに丸ごと置き換える。 */
export interface StepInput {
  task: string;
  lane: string;
  title: string;
  detail: string;
  sla: string;
  milestone: string;
  escalate: boolean;
  contacts: string[];
  conditions: Condition[];
  decision: Decision | null;
}

export class Api {
  /** 手元のデータ。load() を呼ぶまでは空。 */
  db: DB = {
    version: 0,
    lanes: [],
    phases: [],
    tasks: [],
    contactGroups: [],
    events: [],
  };

  /** サーバから最後に受け取った版。 */
  rev = -1;

  /**
   * 取り消し／やり直しで戻る操作の名前。押せないときは空。
   *
   * 応答すべてに添えられているので、書き込みのたびに自動で新しくなる。
   * ボタンの状態を知るためだけに問い合わせを増やさない。
   */
  history: HistoryState = { undo: "", redo: "" };

  /** 履歴の状態が変わったときに呼ばれる。ボタンの出し分けに使う。 */
  onHistory: ((h: HistoryState) => void) | null = null;

  /** データが入れ替わったときに呼ばれる。画面の描き直しに使う。 */
  onChange: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // 読み取り
  // -------------------------------------------------------------------------

  /** 全データを取り直す。 */
  async load(): Promise<DB> {
    const env = await this.request<DB>("GET", "/api/db");
    this.db = env.data!;
    this.rev = env.rev;
    this.onChange?.();
    return this.db;
  }

  // -------------------------------------------------------------------------
  // フロー
  // -------------------------------------------------------------------------

  createEvent(input: EventInput) {
    return this.write<EventFlow>("POST", "/api/events", input);
  }

  updateEvent(key: string, input: EventInput, opts?: WriteOptions) {
    return this.write<EventFlow>("PUT", `/api/events/${enc(key)}`, input, opts);
  }

  deleteEvent(key: string) {
    return this.write<null>("DELETE", `/api/events/${enc(key)}`);
  }

  /**
   * このフローが使う担当と、その呼び名を決める。
   *
   * 空を送れば「全体の担当をそのまま使う」に戻る。使っている担当を外そうと
   * すると、行き場を失う手順を添えて断られる。
   */
  setEventLanes(key: string, lanes: EventLane[]) {
    return this.write<EventFlow>("PUT", `/api/events/${enc(key)}/lanes`, {
      lanes,
    });
  }

  duplicateEvent(key: string) {
    return this.write<EventFlow>("POST", `/api/events/${enc(key)}/duplicate`);
  }

  /** このフローを元にした顧客別のフローを作る。 */
  deriveEvent(key: string, title: string) {
    return this.write<EventFlow>("POST", `/api/events/${enc(key)}/derive`, {
      title,
    });
  }

  /** 元との違いを見たことにする。元が更新されたという印を消す。 */
  reviewedEvent(key: string) {
    return this.write<EventFlow>("POST", `/api/events/${enc(key)}/reviewed`);
  }

  orderEvents(keys: string[]) {
    return this.write<null>("PUT", "/api/events/order", { keys } as OrderBody);
  }

  // -------------------------------------------------------------------------
  // 手順
  // -------------------------------------------------------------------------

  /**
   * 手順を足す。中身はサーバが対応から写す。
   *
   * index を省くと末尾。lane を省くと対応の既定の担当になる。
   * キャンバスへ落としたときは、落とした列がそのまま担当になる。
   */
  createStep(eventKey: string, task: string, at?: StepPlacement) {
    const body: { task: string; index?: number; lane?: string } = { task };
    if (at?.index !== undefined) body.index = at.index;
    if (at?.lane) body.lane = at.lane;
    return this.write<Step>("POST", `/api/events/${enc(eventKey)}/steps`, body);
  }

  updateStep(
    eventKey: string,
    id: string,
    input: StepInput,
    opts?: WriteOptions,
  ) {
    return this.write<Step>(
      "PUT",
      `/api/events/${enc(eventKey)}/steps/${enc(id)}`,
      input,
      opts,
    );
  }

  deleteStep(eventKey: string, id: string, opts?: WriteOptions) {
    return this.write<null>(
      "DELETE",
      `/api/events/${enc(eventKey)}/steps/${enc(id)}`,
      undefined,
      opts,
    );
  }

  /** 手順を複製し、すぐ下に差し込む。判断のキーはサーバが振り直す。 */
  duplicateStep(eventKey: string, id: string) {
    return this.write<Step>(
      "POST",
      `/api/events/${enc(eventKey)}/steps/${enc(id)}/duplicate`,
    );
  }

  orderSteps(eventKey: string, keys: string[]) {
    return this.write<null>(
      "PUT",
      `/api/events/${enc(eventKey)}/steps/order`,
      { keys } as OrderBody,
    );
  }

  // -------------------------------------------------------------------------
  // 部品
  // -------------------------------------------------------------------------

  createTask(input: TaskInput) {
    return this.write<Task>("POST", "/api/tasks", input);
  }

  updateTask(key: string, input: TaskInput) {
    return this.write<Task>("PUT", `/api/tasks/${enc(key)}`, input);
  }

  deleteTask(key: string) {
    return this.write<null>("DELETE", `/api/tasks/${enc(key)}`);
  }

  orderTasks(keys: string[]) {
    return this.write<null>("PUT", "/api/tasks/order", { keys } as OrderBody);
  }

  /** どのフローのどの手順で使われているか。消す前に見せるためのもの。 */
  async taskUsage(key: string): Promise<Usage[]> {
    const env = await this.request<Usage[]>(
      "GET",
      `/api/tasks/${enc(key)}/usage`,
    );
    return env.data ?? [];
  }

  createLane(input: LaneInput) {
    return this.write<Lane>("POST", "/api/lanes", input);
  }

  updateLane(key: string, input: LaneInput) {
    return this.write<Lane>("PUT", `/api/lanes/${enc(key)}`, input);
  }

  deleteLane(key: string) {
    return this.write<null>("DELETE", `/api/lanes/${enc(key)}`);
  }

  orderLanes(keys: string[]) {
    return this.write<null>("PUT", "/api/lanes/order", { keys } as OrderBody);
  }

  async laneUsage(key: string): Promise<Usage[]> {
    const env = await this.request<Usage[]>("GET", `/api/lanes/${enc(key)}/usage`);
    return env.data ?? [];
  }

  createPhase(input: PhaseInput) {
    return this.write<Phase>("POST", "/api/phases", input);
  }

  updatePhase(key: string, input: PhaseInput) {
    return this.write<Phase>("PUT", `/api/phases/${enc(key)}`, input);
  }

  deletePhase(key: string) {
    return this.write<null>("DELETE", `/api/phases/${enc(key)}`);
  }

  orderPhases(keys: string[]) {
    return this.write<null>("PUT", "/api/phases/order", { keys } as OrderBody);
  }

  createSLA(input: SLAInput) {
    return this.write<SLA>("POST", "/api/slas", input);
  }

  updateSLA(key: string, input: SLAInput) {
    return this.write<SLA>("PUT", `/api/slas/${enc(key)}`, input);
  }

  deleteSLA(key: string) {
    return this.write<null>("DELETE", `/api/slas/${enc(key)}`);
  }

  orderSLAs(keys: string[]) {
    return this.write<null>("PUT", "/api/slas/order", { keys } as OrderBody);
  }

  /** このフローだけの目標時間を差し替える。標準に戻すものは外して送る。 */
  setEventSLAs(key: string, slas: EventSLA[]) {
    return this.write<EventFlow>("PUT", `/api/events/${enc(key)}/slas`, { slas });
  }

  createLink(input: LinkInput) {
    return this.write<AppLink>("POST", "/api/links", input);
  }

  updateLink(key: string, input: LinkInput) {
    return this.write<AppLink>("PUT", `/api/links/${enc(key)}`, input);
  }

  deleteLink(key: string) {
    return this.write<null>("DELETE", `/api/links/${enc(key)}`);
  }

  createContactGroup(input: ContactInput) {
    return this.write<ContactGroup>("POST", "/api/contacts", input);
  }

  updateContactGroup(key: string, input: ContactInput) {
    return this.write<ContactGroup>("PUT", `/api/contacts/${enc(key)}`, input);
  }

  deleteContactGroup(key: string) {
    return this.write<null>("DELETE", `/api/contacts/${enc(key)}`);
  }

  orderContactGroups(keys: string[]) {
    return this.write<null>("PUT", "/api/contacts/order", {
      keys,
    } as OrderBody);
  }

  async contactUsage(key: string): Promise<Usage[]> {
    const env = await this.request<Usage[]>(
      "GET",
      `/api/contacts/${enc(key)}/usage`,
    );
    return env.data ?? [];
  }

  // -------------------------------------------------------------------------
  // 取り消し・やり直し
  // -------------------------------------------------------------------------

  /**
   * 1 手戻す（または進める）。戻った操作の名前を返す。
   *
   * サーバは操作の前の全データを控えているので、戻し方は 1 通りしかない。
   * 戻したあとは全部取り直す（quiet にしない）。手元のどこが変わるか
   * 分からない以上、部分的に描き直す判断ができない。
   */
  async stepHistory(back: boolean): Promise<string> {
    const env = await this.request<{ label: string }>(
      "POST",
      back ? "/api/undo" : "/api/redo",
    );
    this.rev = env.rev;
    await this.load();
    return env.data?.label ?? "";
  }

  // -------------------------------------------------------------------------
  // 書き出し
  // -------------------------------------------------------------------------

  /** プレビューの iframe に読ませる URL。 */
  exportUrl(eventKey?: string): string {
    return eventKey
      ? `/api/events/${enc(eventKey)}/export.html`
      : "/api/export.html";
  }

  /** 保存を促す URL。 */
  downloadUrl(eventKey?: string): string {
    return `${this.exportUrl(eventKey)}?download=1`;
  }

  // -------------------------------------------------------------------------
  // 中身
  // -------------------------------------------------------------------------

  /**
   * 変更を送り、手元のデータを揃える。
   *
   * rev が 1 つだけ進んでいれば、変わったのは自分の変更だけ。手元の db に
   * 反映すれば足りるが、今は素直に取り直している。localhost で 27.7 KB なので
   * 体感できる差が出ない。速さが要るところ（入力のたびの保存など）だけ、
   * あとから手元反映に切り替える。
   */
  private async write<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: WriteOptions,
  ): Promise<T | null> {
    const env = await this.request<T>(method, path, body);
    const result = env.data ?? null;
    if (opts?.quiet) {
      // 手元はすでに書き換えてある。rev だけ合わせて、画面はそのままにする。
      this.rev = env.rev;
      return result;
    }
    await this.load();
    return result;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Envelope<T>> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      // Content-Type を必ず付ける。サーバはこれを見て、フォームを装った
      // 別サイトからの要求を弾いている（internal/api/guard.go）。
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, `サーバに繋がりません: ${String(e)}`);
    }

    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      let usage: Usage[] = [];
      try {
        const err = (await res.json()) as ErrorBody;
        if (err.error) msg = err.error;
        if (err.usage) usage = err.usage;
      } catch {
        // JSON で返らないエラー（Guard の 403 など）はそのまま状態コードを見せる
      }
      throw new ApiError(res.status, msg, usage);
    }

    const env = (await res.json()) as Envelope<T>;
    if (env.history) {
      this.history = env.history;
      this.onHistory?.(env.history);
    }
    return env;
  }
}

/** パスに入れる値を安全にする。キーに日本語や記号が入っても壊れないように。 */
function enc(s: string): string {
  return encodeURIComponent(s);
}
