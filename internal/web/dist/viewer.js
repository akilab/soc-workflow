/* 連絡手段・区分・担当の定義。書き出しHTMLにもそのまま埋め込まれる。
   Teams / Elgana はロゴが使えないので頭文字のバッジで表す。色は識別用の便宜的なもの。 */
var VIA = {
  /* ico がある手段は SVG、無い手段は m の文字でバッジを描く。
     Teams はブランドのロゴ（items/Teams.svg）。
     メールは提供された汎用アイコン（items/Mail）、電話は自前の単色アイコン。
     items/Outlook.svg も同梱してあるので、メールを Outlook にしたい場合は
     sprite に symbol を足して mail の ico を差し替える。ただし
     「メールで連絡」と「Outlook で連絡」は意味が違うので既定にはしていない。
     Elgana はロゴの SVG が未提供のため、当面はブランド色の文字バッジ。 */
  teams:  {l:"Teams",  ico:"ico-teams", m:"T",        c:"#6264A7"},
  elgana: {l:"Elgana", ico:"",          m:"E",        c:"#e63a28"},
  mail:   {l:"メール",  ico:"ico-mail",  m:"\u2709",  c:"#4aa8ff"},
  phone:  {l:"電話",    ico:"ico-phone", m:"\u260E",  c:"#ff6b6b"}
};
/* アイコンの中身。書き出し HTML でも外部を読まないよう、sprite ごと埋め込む。 */
var VIA_SPRITE = "<svg id=\"via-sprite\" aria-hidden=\"true\" style=\"position:absolute;width:0;height:0;overflow:hidden\"><symbol id=\"ico-teams\" viewBox=\"0 0 17 17\"><g clip-path=\"url(#clip0_1967_29308)\"><path d=\"M8.43555 7.19922H13.63C15.0644 7.19922 16.2272 8.36457 16.2272 9.80209V14.1402C16.2272 15.5777 15.0644 16.7431 13.63 16.7431C12.1956 16.7431 11.0328 15.5777 11.0328 14.1402V9.80209C11.0328 8.36457 9.86995 7.19922 8.43555 7.19922Z\" fill=\"url(#paint0_radial_1967_29308)\"/><path d=\"M2.37598 8.9349C2.37598 7.49738 3.5388 6.33203 4.9732 6.33203H8.43616C9.87056 6.33203 11.0334 7.49738 11.0334 8.9349V14.1406C11.0334 15.5782 12.1962 16.7435 13.6306 16.7435L6.70464 16.7435C4.31398 16.7435 2.37598 14.8012 2.37598 12.4053V8.9349Z\" fill=\"url(#paint1_radial_1967_29308)\"/><path d=\"M2.37598 8.9349C2.37598 7.49738 3.5388 6.33203 4.9732 6.33203H8.43616C9.87056 6.33203 11.0334 7.49738 11.0334 8.9349V14.1406C11.0334 15.5782 12.1962 16.7435 13.6306 16.7435L6.70464 16.7435C4.31398 16.7435 2.37598 14.8012 2.37598 12.4053V8.9349Z\" fill=\"url(#paint2_linear_1967_29308)\" fill-opacity=\"0.7\"/><path d=\"M2.37598 8.9349C2.37598 7.49738 3.5388 6.33203 4.9732 6.33203H8.43616C9.87056 6.33203 11.0334 7.49738 11.0334 8.9349V14.1406C11.0334 15.5782 12.1962 16.7435 13.6306 16.7435L6.70464 16.7435C4.31398 16.7435 2.37598 14.8012 2.37598 12.4053V8.9349Z\" fill=\"url(#paint3_radial_1967_29308)\" fill-opacity=\"0.7\"/><path d=\"M13.1985 6.3303C14.3939 6.3303 15.3629 5.35917 15.3629 4.16124C15.3629 2.96332 14.3939 1.99219 13.1985 1.99219C12.0032 1.99219 11.0342 2.96332 11.0342 4.16124C11.0342 5.35917 12.0032 6.3303 13.1985 6.3303Z\" fill=\"url(#paint4_radial_1967_29308)\"/><path d=\"M13.1985 6.3303C14.3939 6.3303 15.3629 5.35917 15.3629 4.16124C15.3629 2.96332 14.3939 1.99219 13.1985 1.99219C12.0032 1.99219 11.0342 2.96332 11.0342 4.16124C11.0342 5.35917 12.0032 6.3303 13.1985 6.3303Z\" fill=\"url(#paint5_radial_1967_29308)\" fill-opacity=\"0.46\"/><path d=\"M13.1985 6.3303C14.3939 6.3303 15.3629 5.35917 15.3629 4.16124C15.3629 2.96332 14.3939 1.99219 13.1985 1.99219C12.0032 1.99219 11.0342 2.96332 11.0342 4.16124C11.0342 5.35917 12.0032 6.3303 13.1985 6.3303Z\" fill=\"url(#paint6_radial_1967_29308)\" fill-opacity=\"0.4\"/><path d=\"M6.70464 5.46355C8.13904 5.46355 9.30185 4.2982 9.30185 2.86068C9.30185 1.42316 8.13904 0.257812 6.70464 0.257812C5.27024 0.257812 4.10742 1.42316 4.10742 2.86068C4.10742 4.2982 5.27024 5.46355 6.70464 5.46355Z\" fill=\"url(#paint7_radial_1967_29308)\"/><path d=\"M6.70464 5.46355C8.13904 5.46355 9.30185 4.2982 9.30185 2.86068C9.30185 1.42316 8.13904 0.257812 6.70464 0.257812C5.27024 0.257812 4.10742 1.42316 4.10742 2.86068C4.10742 4.2982 5.27024 5.46355 6.70464 5.46355Z\" fill=\"url(#paint8_radial_1967_29308)\" fill-opacity=\"0.6\"/><path d=\"M6.70464 5.46355C8.13904 5.46355 9.30185 4.2982 9.30185 2.86068C9.30185 1.42316 8.13904 0.257812 6.70464 0.257812C5.27024 0.257812 4.10742 1.42316 4.10742 2.86068C4.10742 4.2982 5.27024 5.46355 6.70464 5.46355Z\" fill=\"url(#paint9_radial_1967_29308)\" fill-opacity=\"0.5\"/><path d=\"M6.16361 8.5H2.05136C1.27439 8.5 0.644531 9.13123 0.644531 9.90989V14.0311C0.644531 14.8098 1.27439 15.441 2.05136 15.441H6.16361C6.94058 15.441 7.57044 14.8098 7.57044 14.0311V9.90989C7.57044 9.13123 6.94058 8.5 6.16361 8.5Z\" fill=\"url(#paint10_radial_1967_29308)\"/><path d=\"M6.16361 8.5H2.05136C1.27439 8.5 0.644531 9.13123 0.644531 9.90989V14.0311C0.644531 14.8098 1.27439 15.441 2.05136 15.441H6.16361C6.94058 15.441 7.57044 14.8098 7.57044 14.0311V9.90989C7.57044 9.13123 6.94058 8.5 6.16361 8.5Z\" fill=\"url(#paint11_radial_1967_29308)\" fill-opacity=\"0.7\"/><path d=\"M5.61393 10.7157H4.55465V13.9545H3.66086V10.7157H2.60156V9.98828H5.61393V10.7157Z\" fill=\"white\"/></g><defs><radialGradient id=\"paint0_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(16.1392 8.14228) scale(5.83439 14.4326)\"><stop stop-color=\"#A98AFF\"/><stop offset=\"0.14\" stop-color=\"#8C75FF\"/><stop offset=\"0.565\" stop-color=\"#5F50E2\"/><stop offset=\"0.9\" stop-color=\"#3C2CB8\"/></radialGradient><radialGradient id=\"paint1_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(5.2756 13.1879 -13.3083 5.34698 2.72768 5.63793)\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#85C2FF\"/><stop offset=\"0.69\" stop-color=\"#7588FF\"/><stop offset=\"1\" stop-color=\"#6459FE\"/></radialGradient><linearGradient id=\"paint2_linear_1967_29308\" x1=\"7.82741\" y1=\"6.33203\" x2=\"7.82741\" y2=\"16.7435\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0.801159\" stop-color=\"#6864F6\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#5149DE\"/></linearGradient><radialGradient id=\"paint3_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(-3.29407 7.65582 -6.13219 -2.64999 10.8169 5.98498)\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#BD96FF\"/><stop offset=\"0.686685\" stop-color=\"#BD96FF\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"paint4_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(13.1985 3.5415) rotate(-90) scale(4.33811 5.4635)\"><stop offset=\"0.268201\" stop-color=\"#6868F7\"/><stop offset=\"1\" stop-color=\"#3923B1\"/></radialGradient><radialGradient id=\"paint5_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(2.3679 1.99487 -2.87909 3.43235 11.4097 3.0958)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0.270711\" stop-color=\"#A1D3FF\"/><stop offset=\"0.813393\" stop-color=\"#A1D3FF\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"paint6_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(2.75309 -2.45463 6.00831 6.76822 14.9223 3.01971)\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#E3ACFD\"/><stop offset=\"0.816041\" stop-color=\"#9FA2FF\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"paint7_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(6.70464 2.117) rotate(-90) scale(5.20574 6.55624)\"><stop offset=\"0.268201\" stop-color=\"#8282FF\"/><stop offset=\"1\" stop-color=\"#3923B1\"/></radialGradient><radialGradient id=\"paint8_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(2.84147 2.39384 -3.45489 4.1188 4.55813 1.58217)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0.270711\" stop-color=\"#A1D3FF\"/><stop offset=\"0.813393\" stop-color=\"#A1D3FF\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"paint9_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(3.3037 -2.94556 7.20998 8.12187 8.77319 1.49083)\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#E3ACFD\"/><stop offset=\"0.816041\" stop-color=\"#9FA2FF\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"paint10_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientTransform=\"matrix(6.9259 6.94098 -6.9259 6.94098 0.644531 8.5)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0.046875\" stop-color=\"#688EFF\"/><stop offset=\"0.946875\" stop-color=\"#230F94\"/></radialGradient><radialGradient id=\"paint11_radial_1967_29308\" cx=\"0\" cy=\"0\" r=\"1\" gradientUnits=\"userSpaceOnUse\" gradientTransform=\"translate(4.10749 12.6646) rotate(90) scale(4.85869 5.65769)\"><stop offset=\"0.570647\" stop-color=\"#6965F6\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#8F8FFF\"/></radialGradient><clipPath id=\"clip0_1967_29308\"><rect width=\"17\" height=\"17\" fill=\"white\"/></clipPath></defs></symbol><symbol id=\"ico-phone\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M3.6 1.8h2.5l1.3 3.2-1.6 1.1a9.6 9.6 0 0 0 4.1 4.1l1.1-1.6 3.2 1.3v2.5a1.8 1.8 0 0 1-2 1.8A12.5 12.5 0 0 1 1.8 3.8a1.8 1.8 0 0 1 1.8-2z\"/></symbol><symbol id=\"ico-mail\" viewBox=\"0 0 48 48\"><path d=\"M43 16.976V33.75C43 36.6495 40.6495 39 37.75 39H10.25C7.35049 39 4.99976 36.6495 4.99976 33.75V16.976L23.3976 27.0953C23.7727 27.3016 24.2273 27.3016 24.6024 27.0953L43 16.976ZM37.75 9C40.6074 9 42.9316 11.2828 42.9985 14.1241L24 24.5734L5.00176 14.124L5.00437 14.0336C5.11786 11.2344 7.42298 9 10.25 9H37.75Z\" fill=\"currentColor\"/></symbol></svg>";
/* ---------- 明るさの切り替え ----------
   昼夜どちらでも使うので、明示的な選択を localStorage に覚える。
   選んでいなければ OS の設定に従う。書き出した HTML でも同じ仕組みが動く。 */
var THEME_KEY = "soc-flow-theme";
function effectiveTheme(){
  var t = document.documentElement.getAttribute("data-theme");
  if(t) return t;
  return (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
}
function applyTheme(t){
  var r = document.documentElement;
  if(t) r.setAttribute("data-theme", t); else r.removeAttribute("data-theme");
  try{ t ? localStorage.setItem(THEME_KEY, t) : localStorage.removeItem(THEME_KEY); }catch(e){}
  updateThemeButtons();
}
function updateThemeButtons(){
  var dark = effectiveTheme() === "dark";
  Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function(b){
    b.textContent = dark ? "\u263E ダーク" : "\u2600 ライト";
    b.title = "明るさを切り替える（現在: " + (dark ? "ダーク" : "ライト") + "）";
  });
}
function initTheme(){
  var t = "";
  try{ var v = localStorage.getItem(THEME_KEY); if(v === "light" || v === "dark") t = v; }catch(e){}
  applyTheme(t);
  Array.prototype.forEach.call(document.querySelectorAll("[data-th]"), function(b){
    if(b.dataset.thBound) return;
    b.dataset.thBound = "1";
    b.addEventListener("click", function(){
      applyTheme(effectiveTheme() === "dark" ? "light" : "dark");
    });
  });
}
function ensureViaSprite(){
  inject("via-sprite", VIA_SPRITE);
  /* UI アイコン（icons.js）。書き出し HTML でもエディタでも、
     viewer.js より先に読み込まれている。無くても致命的ではないので、
     読めていなければ黙って飛ばす（連絡手段のアイコンは出したい）。 */
  if(typeof UI_SPRITE !== "undefined") inject("ui-sprite", UI_SPRITE);
  /* 製品アイコン（brand.js）。エディタだけが読む。配る HTML には入れていない
     ので、ここでも「あれば入れる」だけにしておく。 */
  if(typeof BRAND_SPRITE !== "undefined") inject("brand-sprite", BRAND_SPRITE);
}
function inject(id, markup){
  if(!markup || document.getElementById(id)) return;
  var d = document.createElement("div");
  d.innerHTML = markup;
  document.body.insertBefore(d.firstChild, document.body.firstChild);
}
/* UI アイコン 1 つ。置いた場所の文字色を拾う。 */
function icon(name, cls){
  return '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true">'
    + '<use href="#ic-' + name + '"/></svg>';
}
/* 手段のバッジ中身。SVG があればそれ、無ければ文字。 */
function viaMark(v){
  return v.ico ? '<svg class="vico"><use href="#' + v.ico + '"/></svg>' : v.m;
}
var KIND = {
  esc:      {l:"エスカレ先", c:"#ffb02e"},
  internal: {l:"社内",       c:"#7d8798"},
  customer: {l:"お客様",     c:"#ff5c8a"},
  external: {l:"外部",       c:"#a97bff"}
};

function mountViewer(root, DATA, opt){
  opt = opt || {};
  ensureViaSprite();
  var uid = "v" + Math.floor(Math.random()*1e9).toString(36);
  var phaseByKey = {}, taskByKey = {}, groupByKey = {}, laneByKey = {}, laneIndex = {};
  /* フローごとの担当を解決する。指定が無ければ全体をそのまま使う。
     呼び名だけを差し替えた複製を返す。全体のものを書き換えると、
     1 つのフローの呼び名が他のフローへ漏れる。 */
  function lanesOf(ev){
    var all = DATA.lanes || [];
    if(!ev || !ev.lanes || !ev.lanes.length){ return all.slice(); }
    var out = [];
    ev.lanes.forEach(function(el){
      for(var i=0;i<all.length;i++){
        if(all[i].key !== el.key) continue;
        var l = {key:all[i].key, name:el.name || all[i].name, color:all[i].color};
        out.push(l);
        return;
      }
    });
    return out;
  }
  /* いま描いているフローの担当。select() のたびに入れ替える。 */
  var lanes = [];
  function useLanes(ev){
    lanes = lanesOf(ev);
    laneByKey = {}; laneIndex = {};
    lanes.forEach(function(l, i){ laneByKey[l.key] = l; laneIndex[l.key] = i; });
  }
  DATA.phases.forEach(function(p){ phaseByKey[p.key] = p; });
  DATA.tasks.forEach(function(t){ taskByKey[t.key] = t; });
  (DATA.contactGroups || []).forEach(function(g){ groupByKey[g.key] = g; });

  /* メンバーが持っている連絡手段のうち、入力されているものだけを並べる。
     1 人が電話と Teams の両方を持つのは普通なので、手段は欄で持つ。 */
  function channels(m){
    var out = [];
    [["phone", m.tel], ["teams", m.teams], ["elgana", m.elgana], ["mail", m.mail]]
      .forEach(function(p){ if(p[1]) out.push({via:p[0], value:p[1]}); });
    return out;
  }

  var events = DATA.events;
  var solo = events.length < 2;

  root.innerHTML =
    '<div class="v-top">'
    + '<h1>SOC <b>対応フロー</b></h1>'
    + '<div class="v-now" data-e="now">左の一覧から、対応するフローを選んでください。</div>'
    + '<button class="v-btn v-th" data-th type="button"></button>'
    + '<div class="v-meters">'
    +   '<div class="v-meter"><div class="k">経過時間</div><div class="val" data-e="elapsed">--:--</div></div>'
    +   '<div class="v-meter"><div class="k">進捗</div><div class="val" data-e="prog">0 / 0</div>'
    +     '<div class="v-bar"><i data-e="progbar"></i></div></div>'
    + '</div></div>'
    + '<div class="v-main' + (solo ? ' solo' : '') + '">'
    +   '<aside class="v-card v-evs"><h3>対応フロー</h3><div data-e="evlist"></div>'
    +     '<div class="v-legend">'
    +       '<span><i style="color:var(--cur)">&#9654;</i>現在</span>'
    +       '<span><i style="color:var(--ok)">&#10003;</i>完了</span>'
    +       '<span><i style="color:var(--skip)">&#8212;</i>対象外</span></div></aside>'
    +   '<div class="v-stage"><div class="v-grid" data-e="grid">'
    +     '<svg class="v-wires" data-e="wires"></svg></div></div>'
    + '</div>'
    + '<div class="v-steps"><header>'
    +   '<h2 data-e="stitle">対応手順<small>フローを選択してください</small></h2>'
    +   '<div class="v-acts"><button class="v-btn p" data-e="copy">作業ログをコピー</button>'
    +     '<button class="v-btn" data-e="reset">リセット</button></div></header>'
    +   '<div data-e="slist"><p class="v-empty">フローを選択してください。</p></div>'
    +   '<p class="v-note">' + (opt.note || "内容はダミーです。進捗はこのブラウザにのみ保存され、外部には送信されません。") + '</p>'
    + '</div>';

  function $(k){ return root.querySelector('[data-e="' + k + '"]'); }
  initTheme();
  var grid = $("grid"), wires = $("wires");

  var cur = null, answers = {}, done = {}, startedAt = null, timer = null;
  var nodes = [];               // step index -> ボックス要素
  var chips = [];               // {i, el} 連絡の矢印の行き先に置く札
  var KEY = opt.storageKey || "";

  function save(){
    if(!KEY) return;
    try{ localStorage.setItem(KEY, JSON.stringify({cur:cur, answers:answers, done:done, startedAt:startedAt})); }catch(e){}
  }
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  /* 表示条件は AND。未回答の条件が残っていれば null（＝まだ分からない）。 */
  function visible(st){
    var cs = st.conditions || [];
    if(!cs.length) return true;
    var unknown = false;
    for(var i=0;i<cs.length;i++){
      var a = answers[cs[i].key];
      if(a === undefined){ unknown = true; continue; }
      if(a !== cs[i].value) return false;
    }
    return unknown ? null : true;
  }
  /* 終了（クローズ）の対応を使っている手順か。 */
  function isClose(st){
    var tk = taskByKey[st.task];
    return !!tk && tk.kind === "close";
  }
  /* 待ちの対応を使っている手順か。 */
  function isWait(st){
    var tk = taskByKey[st.task];
    return !!tk && tk.kind === "wait";
  }

  /* 完了した終了はどこか。無ければ -1。
     ここより後ろの手順は、この対応では実施しない。
     完了で切るのは、終了が「閉じる」という作業そのものだから。
     押す前は、その先に何があるかを見られるようにしておく。 */
  function closedAt(ev){
    for(var i=0;i<ev.steps.length;i++){
      if(done[i] && visible(ev.steps[i]) !== false && isClose(ev.steps[i])) return i;
    }
    return -1;
  }

  /* その手順を実施するか。true / false / undefined（まだ分からない）。 */
  function shown(ev, i, cutAt){
    if(cutAt >= 0 && i > cutAt) return false;
    return visible(ev.steps[i]);
  }

  function currentIndex(ev){
    var cutAt = closedAt(ev);
    for(var i=0;i<ev.steps.length;i++){ if(shown(ev, i, cutAt) !== false && !done[i]) return i; }
    return -1;
  }
  function findEvent(k){ for(var i=0;i<events.length;i++) if(events[i].key===k) return events[i]; return null; }

  /* ---- フローリスト ---- */
  var evlist = $("evlist");
  events.forEach(function(ev){
    var b = document.createElement("button");
    b.className = "v-ev"; b.dataset.k = ev.key;
    b.innerHTML = '<span class="sev ' + ev.severity + '">' + ev.severity + '</span>'
      + '<span><b>' + esc(ev.title) + '</b><span class="sub">' + esc(ev.sub) + '</span></span>';
    b.addEventListener("click", function(){ select(ev.key); });
    evlist.appendChild(b);
  });

  /* ---- キャンバス ----
     列は担当（レーン）、行は手順の順番。手順 1 つにつきボックス 1 つ。
     フェーズは列ではなく、ボックスの左のバーとラベルで表す。 */
  function buildGrid(ev){
    useLanes(ev);
    grid.innerHTML = "";
    nodes = []; chips = [];
    grid.style.gridTemplateColumns = "repeat(" + Math.max(lanes.length, 1) + ", minmax(148px, 1fr))";

    lanes.forEach(function(l, li){
      var bg = document.createElement("div");
      bg.className = "v-lane" + (li === lanes.length - 1 ? " last" : "");
      bg.style.setProperty("--lc", l.color);
      bg.style.gridColumn = (li + 1);
      /* 1/-1 は使えない。-1 は「明示的に定義された行」の終端を指すが、
         grid-template-rows を書いていないので全部が暗黙行になり、
         見出し行で止まってしまう。終端を数えて入れる。 */
      bg.style.gridRow = "1 / " + (ev.steps.length + 2);
      grid.appendChild(bg);

      var h = document.createElement("div");
      h.className = "v-lane-h";
      h.style.setProperty("--lc", l.color);
      h.style.gridColumn = (li + 1);
      h.textContent = l.name;
      grid.appendChild(h);
    });

    ev.steps.forEach(function(st, i){
      var li = laneIndex[st.lane];
      if(li === undefined) li = 0;
      var tk = taskByKey[st.task], ph = tk ? phaseByKey[tk.phase] : null;

      var ln = lanes[li];
      var el = document.createElement("div");
      el.className = "v-node" + (isClose(st) ? " close" : "") + (isWait(st) ? " wait" : "");
      if(isClose(st)) el.dataset.close = "1";
      if(isWait(st)) el.dataset.wait = "1";
      el.style.setProperty("--pc", ph ? ph.color : "var(--line)");
      el.style.setProperty("--lc", ln ? ln.color : "var(--line)");
      el.style.gridColumn = (li + 1);
      el.style.gridRow = (i + 2);
      /* 分類（フェーズ・担当）はタイトルの上。列が担当を表してはいるが、
         縦に長いフローでは列見出しがページと一緒にスクロールして見えなくなる。 */
      el.innerHTML = '<span class="mk"></span>'
        + '<span class="cls">'
        + (ph ? '<i class="ph">' + esc(ph.name) + '</i>' : '')
        + (ln ? '<i class="who">' + esc(ln.name) + '</i>' : '')
        + '</span>'
        /* 手順の題名を出す。対応名ではない。
           対応はフローをまたぐ部品で、名前も一般的なもの（「ログの収集」）。
           手順はこのフローでの言い方を持つ（「侵入経路を特定する」）。
           ここが tk.label だったので、種データ 62 手順のうち 59 で、
           編集画面と書き出し HTML が違う言葉を出していた。
           同じページの下の手順一覧は st.title を出しているので、そことも
           食い違っていた。元の対応名は手順一覧の分類行に出る。 */
        + '<span class="n">' + esc(st.title) + '</span>'
        /* 補足が無いときは行そのものを出さない。空の span でも margin が残る。
           エディタ側（canvas.ts）と同じ条件にしてある。 */
        + (tk && tk.note ? '<span class="t">' + esc(tk.note) + '</span>' : '')
        + (st.decision ? '<span class="dec">&#9670;</span>' : '')
        + (isClose(st) ? '<span class="fin">終了</span>' : '')
        + (isWait(st) ? '<span class="wt">待ち</span>' : '');
      el.addEventListener("click", function(){
        var rows = $("slist").querySelectorAll(".v-s");
        if(rows[i]) rows[i].scrollIntoView({behavior:"smooth", block:"center"});
      });
      grid.appendChild(el);
      nodes[i] = el;

      /* 連絡の行き先。エスカレーションも顧客連絡も、同じ 1 つの規則で描ける。
         レーンが設定されていない連絡先（管理職など）には矢印を出さない。 */
      var byLane = {};
      (st.contacts || []).forEach(function(k){
        var g = groupByKey[k];
        if(!g || !g.lane || g.lane === st.lane) return;
        if(laneIndex[g.lane] === undefined) return;
        (byLane[g.lane] = byLane[g.lane] || []).push(g);
      });
      Object.keys(byLane).forEach(function(lk){
        var chip = document.createElement("div");
        chip.className = "v-ct";
        chip.style.setProperty("--lc", laneByKey[lk].color);
        chip.style.gridColumn = (laneIndex[lk] + 1);
        chip.style.gridRow = (i + 2);
        chip.innerHTML = byLane[lk].map(function(g){ return esc(g.name); }).join("<br>");
        grid.appendChild(chip);
        chips.push({i:i, el:chip, color:laneByKey[lk].color});
      });
    });

    grid.appendChild(wires);
  }

  /* ---- 接続線 ----
     行が実施順そのものなので、線は必ず下へ進む。線 i は行 i と行 i+1 の
     あいだの帯しか通らないので、2 本の線が同じ帯を共有することがなく、
     交差は起こり得ない。迂回路の計算は要らない。 */
  function ortho(pts, r){
    var d = "M " + pts[0][0] + " " + pts[0][1];
    for(var i=1;i<pts.length-1;i++){
      var px=pts[i-1][0], py=pts[i-1][1], cx=pts[i][0], cy=pts[i][1], nx=pts[i+1][0], ny=pts[i+1][1];
      var v1x=cx-px, v1y=cy-py, v2x=nx-cx, v2y=ny-cy;
      var l1=Math.hypot(v1x,v1y)||1, l2=Math.hypot(v2x,v2y)||1;
      var rr=Math.min(r, l1/2, l2/2);
      d += " L " + (cx-v1x/l1*rr) + " " + (cy-v1y/l1*rr);
      d += " Q " + cx + " " + cy + " " + (cx+v2x/l2*rr) + " " + (cy+v2y/l2*rr);
    }
    return d + " L " + pts[pts.length-1][0] + " " + pts[pts.length-1][1];
  }

  /* 横向きの小さな三角。marker は色をなぞれないので、その場で描く。
     dir は +1 が右、-1 が左。 */
  function headH(x, y, dir, color){
    return '<polygon class="ca" points="' + (x-6*dir) + ',' + (y-4) + ' ' + (x-6*dir) + ',' + (y+4)
      + ' ' + x + ',' + y + '" style="fill:' + color + '"/>';
  }

  function paint(ev, ci){
    nodes.forEach(function(el){
      if(!el) return;
      el.className = "v-node" + (el.dataset.close ? " close" : "")
        + (el.dataset.wait ? " wait" : "");
      el.querySelector(".mk").textContent = "";
    });
    var box = grid.getBoundingClientRect();
    wires.setAttribute("viewBox", "0 0 " + grid.clientWidth + " " + grid.clientHeight);

    var cutAt = closedAt(ev);
    var seq = [];
    ev.steps.forEach(function(st, i){
      var el = nodes[i]; if(!el) return;
      var vis = shown(ev, i, cutAt), mk = el.querySelector(".mk");
      if(vis === false){ el.classList.add("skip"); mk.innerHTML = "&#8212;"; return; }
      if(done[i]){ el.classList.add("done"); mk.innerHTML = "&#10003;"; }
      else if(i === ci){ el.classList.add("cur"); mk.innerHTML = "&#9654;"; }
      seq.push({i:i, el:el, done:!!done[i], known:vis===true});
    });

    var HEAD = 7;
    var out = '<defs>'
      + '<marker id="ah_'+uid+'" viewBox="0 0 10 8" refX="9.5" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="6.5" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="var(--cur)"/></marker>'
      + '<marker id="ahd_'+uid+'" viewBox="0 0 10 8" refX="9.5" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="6.5" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="var(--ok)"/></marker>'
      + '<marker id="ahp_'+uid+'" viewBox="0 0 10 8" refX="9.5" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="6.5" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="var(--faint)"/></marker>'
      + '</defs>';

    for(var k=0;k<seq.length-1;k++){
      var a = seq[k], b = seq[k+1];
      var ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      /* 規則: 下から出て、上から入る */
      var ax = ra.left - box.left + ra.width/2, ay = ra.bottom - box.top;
      var bx = rb.left - box.left + rb.width/2, by = rb.top - box.top - HEAD;
      var d;

      if(Math.abs(ax - bx) < 2){
        d = "M " + ax + " " + ay + " L " + bx + " " + by;      /* 同じ列。まっすぐ下へ */
      }else if(b.i === a.i + 1){
        var my = (ay + by) / 2;                                 /* 隣り合う行。行間で横へ移る */
        d = ortho([[ax,ay],[ax,my],[bx,my],[bx,by]], 10);
      }else{
        /* あいだに対象外の手順がある。真下を通ると重なるので、
           ボックスの脇（レーンの余白）を降りる。横へ移るのは行間だけ。 */
        var gx = Math.min(grid.clientWidth - 5, ra.right - box.left + 8);
        d = ortho([[ax,ay],[ax,ay+9],[gx,ay+9],[gx,by-9],[bx,by-9],[bx,by]], 8);
      }

      /* 状態は色と線種の両方で示す（色だけに頼らない） */
      var st2 = a.done && b.done ? "done" : (a.known && b.known ? "" : "pend");
      var mk2 = st2==="done" ? "ahd_"+uid : (st2==="pend" ? "ahp_"+uid : "ah_"+uid);
      out += '<path class="w ' + st2 + '" d="' + d + '" marker-end="url(#' + mk2 + ')" />';

      var probe = document.createElementNS("http://www.w3.org/2000/svg","path");
      probe.setAttribute("d", d); wires.appendChild(probe);
      var pt = probe.getPointAtLength(probe.getTotalLength()/2);
      wires.removeChild(probe);
      out += '<circle class="' + st2 + '" cx="' + pt.x + '" cy="' + pt.y + '" r="10" />'
           + '<text class="' + st2 + '" x="' + pt.x + '" y="' + pt.y + '">' + (k+2) + '</text>';
    }

    /* 連絡の矢印。手順の座っている行の中を横切るだけなので、
       行と行のあいだを通る手順の線とはぶつからない。 */
    chips.forEach(function(c){
      var src = nodes[c.i];
      if(!src || src.classList.contains("skip")){ c.el.style.visibility = "hidden"; return; }
      c.el.style.visibility = "";
      var ra = src.getBoundingClientRect(), rc = c.el.getBoundingClientRect();
      var y = ra.top - box.top + ra.height/2;
      var right = rc.left > ra.left;
      var x1 = (right ? ra.right : ra.left) - box.left;
      var x2 = (right ? rc.left - 3 : rc.right + 3) - box.left;
      out += '<path class="ca" d="M ' + x1 + ' ' + y + ' L ' + x2 + ' ' + y
           + '" style="stroke:' + c.color + '"/>'
           + headH(x2, y, right ? 1 : -1, c.color);
    });

    wires.innerHTML = out;
  }

  function condLabel(ev, c){
    for(var i=0;i<ev.steps.length;i++){
      var d = ev.steps[i].decision;
      if(d && d.key === c.key){
        for(var j=0;j<d.options.length;j++) if(d.options[j].value===c.value) return d.options[j].label;
      }
    }
    return c.value;
  }

  function render(){
    var ev = findEvent(cur); if(!ev) return;
    var ci = currentIndex(ev);
    var cutAt = closedAt(ev);
    $("stitle").innerHTML = esc(ev.title) + '<small>' + esc(ev.sub) + '　—　重大度 ' + ev.severity + '</small>';
    $("now").innerHTML = ci>=0
      ? '次にやること: <b>' + esc(ev.steps[ci].title) + '</b>'
      : (cutAt >= 0
         ? 'この対応は<b>' + esc(ev.steps[cutAt].title) + '</b>で終了しました。'
         : 'すべての手順が完了しました。');

    var list = $("slist"); list.innerHTML = "";
    var n = 0, total = 0, fin = 0;
    ev.steps.forEach(function(st, i){
      var vis = shown(ev, i, cutAt), isCur = (i === ci);
      var tk = taskByKey[st.task] || {label:"?", phase:""};
      var ph = phaseByKey[tk.phase] || {name:"", color:"var(--line)"};
      var row = document.createElement("div");
      row.className = "v-s" + (vis===false ? " skipped" : "") + (done[i] ? " done" : "") + (isCur ? " current" : "");
      row.style.setProperty("--pc", ph.color);
      if(vis !== false){ n++; total++; if(done[i]) fin++; }
      var mark = vis===false ? "&#8212;" : (done[i] ? "&#10003;" : n);

      var cts = (st.contacts || []).map(function(k){ return groupByKey[k]; })
                 .filter(function(g){ return !!g; });
      var tags = "";
      if(isCur) tags += '<span class="tag now">現在</span>';
      if(isClose(st)) tags += '<span class="tag close">終了</span>';
      if(isWait(st)) tags += '<span class="tag wait">待ち</span>';
      /* 「担当」と書いておかないと、隣の「エスカレ判断」と並んだときに
         エスカレ先だと読み違えられる。 */
      var ln = laneByKey[st.lane];
      if(ln)
        tags += '<span class="tag tier" style="--tc:' + ln.color + '">担当 '
              + esc(ln.name) + '</span>';
      if(st.sla) tags += '<span class="tag sla">SLA ' + esc(st.sla) + '</span>';
      if(st.escalate) tags += '<span class="tag esc">エスカレ判断</span>';
      if(cts.some(function(g){ return g.kind === "customer"; }))
        tags += '<span class="tag cust">お客様連絡</span>';
      (st.conditions||[]).forEach(function(c){
        /* どの質問への答えなのかをツールチップに持たせる */
        var q = "";
        for(var z=0; z<ev.steps.length; z++){
          var d0 = ev.steps[z].decision;
          if(d0 && d0.key === c.key){ q = d0.label; break; }
        }
        tags += '<span class="tag cond"'
          + (q ? ' title="「' + esc(q) + '」が〈' + esc(condLabel(ev, c)) + '〉のとき"' : '')
          + '>' + esc(condLabel(ev, c)) + ' のとき</span>';
      });

      row.innerHTML = '<div class="chk">' + mark + '</div><div class="bd">'
        + '<div class="ttl">' + esc(st.title) + tags + '</div>'
        + '<div class="path"><i>&#9679;</i> ' + esc(ph.name) + ' / ' + esc(tk.label) + '</div>'
        + '<div class="dsc">' + (vis===false
             ? (cutAt >= 0 && i > cutAt
                ? "この対応は上で終了しました。ここから先は実施しません。"
                : "この対応では対象外です。")
             : (st.detail||"")) + '</div>'
        + ((vis !== false && cts.length)
           ? '<div class="v-contacts"><b>連絡先</b>' + cts.map(function(g){
               var kd = KIND[g.kind], ms = g.members || [];
               return '<div class="v-cg">'
                 + '<div class="v-cgh"><span class="nm">' + esc(g.name) + '</span>'
                   + (kd ? '<em style="--kc:' + kd.c + '">' + kd.l + '</em>' : '')
                   + (ms.length > 1 ? '<u>連絡順に上から ' + ms.length + ' 名</u>' : '')
                 + '</div>'
                 + (g.note ? '<p class="v-cgn">' + esc(g.note) + '</p>' : '')
                 + ms.map(function(m, mi){
                     var chs = channels(m);
                     return '<div class="v-cm' + (mi === 0 && ms.length > 1 ? " first" : "") + '">'
                       + (ms.length > 1 ? '<span class="no">' + (mi+1) + '</span>' : '')
                       + '<span class="who">' + esc(m.name) + '</span>'
                       + chs.map(function(ch){
                           var v = VIA[ch.via] || {l:ch.via, m:"?", c:"#7d8798"};
                           return '<span class="ch" style="--vc:' + v.c + '" title="' + esc(v.l) + '">'
                             + '<i' + (v.ico ? ' class="ico"' : '') + '>' + viaMark(v) + '</i>'
                             + esc(ch.value) + '</span>';
                         }).join("")
                       + (m.note ? '<span class="mnt">' + esc(m.note) + '</span>' : '')
                       + '</div>';
                   }).join("")
                 + '</div>';
             }).join("") + '</div>'
           : "")
        + '</div>';

      var chk = row.querySelector(".chk");
      if(vis !== false && !st.decision){
        chk.addEventListener("click", function(){ done[i] = !done[i]; save(); render(); });
      }
      var bd = row.querySelector(".bd");
      if(vis !== false && st.decision){
        var ask = document.createElement("div");
        ask.className = "v-ask";
        ask.innerHTML = '<p>' + esc(st.decision.label) + '</p><div class="opts"></div>';
        var opts = ask.querySelector(".opts");
        st.decision.options.forEach(function(o){
          var b = document.createElement("button");
          b.textContent = o.label;
          if(answers[st.decision.key] === o.value) b.className = "on";
          b.addEventListener("click", function(){
            answers[st.decision.key] = o.value; done[i] = true; save(); render();
          });
          opts.appendChild(b);
        });
        bd.appendChild(ask);
      }else if(isCur && vis !== false){
        var g = document.createElement("button");
        g.className = "v-godone"; g.textContent = "この手順を完了にする";
        g.addEventListener("click", function(){ done[i] = true; save(); render(); });
        bd.appendChild(g);
      }
      list.appendChild(row);
    });

    $("prog").textContent = fin + " / " + total;
    $("progbar").style.width = (total ? fin/total*100 : 0) + "%";
    paint(ev, ci);
  }

  function tick(){
    if(!startedAt) return;
    var s = Math.floor((Date.now()-startedAt)/1000);
    $("elapsed").textContent =
      String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0");
  }

  function select(key, restore){
    if(cur !== key){ answers = {}; done = {}; startedAt = Date.now(); }
    cur = key;
    Array.prototype.forEach.call(evlist.querySelectorAll(".v-ev"), function(b){
      b.classList.toggle("on", b.dataset.k === key);
    });
    if(!startedAt) startedAt = Date.now();
    if(!timer) timer = setInterval(tick, 1000);
    buildGrid(findEvent(key));
    render(); save(); tick();
  }

  $("reset").addEventListener("click", function(){
    answers = {}; done = {}; startedAt = Date.now(); save(); render(); tick();
  });
  $("copy").addEventListener("click", function(){
    var ev = findEvent(cur); if(!ev) return;
    var lines = ["■ " + ev.title + "（重大度 " + ev.severity + "）",
                 "経過: " + $("elapsed").textContent, ""];
    ev.steps.forEach(function(st){
      if(!st.decision) return;
      var a = answers[st.decision.key]; if(a === undefined) return;
      var l = a;
      st.decision.options.forEach(function(o){ if(o.value===a) l = o.label; });
      lines.push("判断: " + st.decision.label + " → " + l);
    });
    lines.push("");
    var n = 0;
    ev.steps.forEach(function(st, i){
      if(visible(st) === false){
        var why = (st.conditions||[]).map(function(c){ return condLabel(ev,c) + " のとき"; }).join(" かつ ");
        lines.push("  --  " + st.title + "（" + why + "／条件不一致のためスキップ）");
        return;
      }
      n++;
      var head = "  " + (done[i] ? "[x]" : "[ ]") + " " + n + ". " + st.title;
      if(laneByKey[st.lane]) head += "［" + laneByKey[st.lane].name + "］";
      if(st.sla) head += "（SLA " + st.sla + "）";
      lines.push(head);
      (st.contacts || []).forEach(function(k){
        var g = groupByKey[k]; if(!g) return;
        lines.push("        連絡先: " + g.name
          + ((g.members||[]).length > 1 ? "（連絡順）" : ""));
        (g.members || []).forEach(function(m, mi){
          var cs = channels(m).map(function(ch){
            return (VIA[ch.via] || {l:ch.via}).l + " " + ch.value; }).join(" / ");
          lines.push("          " + ((g.members.length > 1) ? (mi+1) + ". " : "- ")
            + m.name + (cs ? "  " + cs : ""));
        });
      });
    });
    var txt = lines.join("\n");
    var btn = $("copy"), old = btn.textContent;
    function ok(){ btn.textContent = "コピーしました"; setTimeout(function(){ btn.textContent = old; }, 1600); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(ok).catch(function(){ ok(); });
    }else{ ok(); }
  });

  var ro = new ResizeObserver(function(){ if(cur) render(); });
  ro.observe(grid);

  var boot = opt.event || (events[0] && events[0].key);
  if(KEY){
    try{
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if(s && s.cur && findEvent(s.cur)){
        answers = s.answers || {}; done = s.done || {}; startedAt = s.startedAt || Date.now();
        boot = s.cur;
        select(boot, true);
        return { destroy: function(){ clearInterval(timer); ro.disconnect(); } };
      }
    }catch(e){}
  }
  if(boot) select(boot);
  return { destroy: function(){ clearInterval(timer); ro.disconnect(); } };
}
