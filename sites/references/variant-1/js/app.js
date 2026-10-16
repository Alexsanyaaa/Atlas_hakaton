/* App core: state + persistence, router, header, undo, toast, modal, export, icons, shared helpers. */
window.ATLAS = window.ATLAS || {};

ATLAS.app = (function () {
  const M = ATLAS.model;
  const KEY = "atlas.state.v1";
  const UI_KEY = "atlas.ui.v1";
  const app = { S: null, views: {}, undo: [], ui: {} };

  /* ------------------------------------------------------------ state */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.version === 1 && Array.isArray(s.cards)) return s;
      }
    } catch (e) { /* storage blocked: work in memory */ }
    return ATLAS.seed.build(ATLAS.DEFAULT_DICT);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(app.S)); } catch (e) { /* quota or blocked */ }
    try { localStorage.setItem(UI_KEY, JSON.stringify({ catalog: { ...app.ui.catalog, selected: [] } })); } catch (e) { /* ignore */ }
  }
  function resetAll() {
    app.S = ATLAS.seed.build(ATLAS.DEFAULT_DICT);
    app.undo = [];
    app.ui.catalog = defaultCatalogUi();
    save();
    toast("Исходный набор восстановлен: все изменения сброшены");
    go("#/catalog");
  }
  const defaultCatalogUi = () => ({ q: "", category: "", status: "", problem: "", sort: "attention", limit: 60, selected: [] });

  /* ------------------------------------------------------------ helpers */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (n) => Number(n).toLocaleString("ru-RU");
  const pct = (x) => `${Math.round(x * 100)} %`;
  const dec2 = (x) => (x == null ? "—" : x.toFixed(2).replace(".", ","));
  const now = () => Date.now();
  const card = (id) => app.S.cards.find((c) => c.id === id);
  const cat = (k) => ATLAS.CATEGORIES[k];
  const catName = (k) => (cat(k) ? cat(k).name : "Категория не определена");
  function when(t) {
    const d = new Date(t);
    const diff = (now() - t) / 86400000;
    if (diff < 1 && new Date().getDate() === d.getDate()) return `сегодня, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    if (diff < 2) return "вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }

  const ICONS = {
    check: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.6 8.2 7 10.5l4.4-4.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    auto: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.9 8.2 7 10.3l4.1-4.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    pencil: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m5 11 .5-2 4-4 1.5 1.5-4 4z" fill="#fff"/>',
    pending: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
    conflict: '<path d="M8 1.6 15 14H1z" fill="currentColor"/><path d="M8 6v3.6M8 11.3v.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
    nodata: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 2"/><path d="M5.2 8h5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    absent: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m3.8 12.2 8.4-8.4" stroke="currentColor" stroke-width="1.5"/>',
    reject: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="m5.5 5.5 5 5m0-5-5 5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
    empty: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    new: '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/>',
    processing: '<path d="M8 2a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    search: '<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m11 11 3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    back: '<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    next: '<path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    undo: '<path d="M5 4 2 7l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 7H10a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    upload: '<path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2 11v3h12v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M2 11v3h12v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    file: '<path d="M4 1.5h5l3.5 3.5v9.5H4z M9 1.5V5h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    play: '<path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/>',
    complete: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.5v7M4.5 8h7" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>',
    normalize: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 6.5h6l-1.6-1.6M11.5 9.5h-6l1.6 1.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const icon = (name, cls = "") => `<svg viewBox="0 0 16 16" aria-hidden="true" class="${cls}">${ICONS[name] || ""}</svg>`;
  const FIELD_ICON = { auto: "auto", accepted: "check", corrected: "pencil", absent: "absent", pending: "pending", conflict: "conflict", nodata: "nodata", empty: "empty" };
  const REC_ICON = { accept: "check", normalize: "normalize", complete: "complete", conflict: "conflict", reject: "reject", nodata: "nodata", empty: "empty" };
  function statusChip(st) {
    return `<span class="chip st-${st}">${icon(st === "ready" ? "check" : st === "conflict" ? "conflict" : st === "review" ? "pending" : st)}${esc(M.STATUS[st].label)}</span>`;
  }
  function fieldMark(f) {
    return `<span class="mark st-${f.state}">${icon(FIELD_ICON[f.state])}${esc(M.FIELD_STATE[f.state].label)}</span>`;
  }

  /* ------------------------------------------------------------ catalog filter (shared by catalog and card navigation) */
  function catalogList() {
    const u = app.ui.catalog;
    const q = ATLAS.engine.fold(u.q.trim());
    let list = app.S.cards.filter((c) => {
      if (u.category && c.category !== u.category && !(u.category === "__none" && !c.category)) return false;
      const st = M.status(c);
      if (u.status && st !== u.status) return false;
      if (u.problem) {
        const has = (pred) => c.fields.some(pred);
        if (u.problem === "any" && !["conflict", "review", "new"].includes(st)) return false;
        if (u.problem === "conflict" && !has((f) => f.state === "conflict")) return false;
        if (u.problem === "suspicious" && !has((f) => f.state === "pending" && ["reject", "complete"].includes(f.rec.code))) return false;
        if (u.problem === "nodata" && !has((f) => f.state === "nodata" || f.state === "empty")) return false;
        if (u.problem === "none" && st !== "ready") return false;
      }
      if (q) {
        const brand = (c.fields.find((f) => f.key === "brand") || {});
        const hay = ATLAS.engine.fold([c.name, c.sku, brand.value, (M.proposal(brand) || {}).value, c.text.title].join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const by = {
      attention: (a, b) => M.STATUS[M.status(a)].order - M.STATUS[M.status(b)].order || b.updatedAt - a.updatedAt,
      recent: (a, b) => b.updatedAt - a.updatedAt,
      name: (a, b) => a.name.localeCompare(b.name, "ru"),
      fill: (a, b) => M.progress(a).share - M.progress(b).share || b.updatedAt - a.updatedAt,
    };
    return list.sort(by[u.sort] || by.attention);
  }

  /* ------------------------------------------------------------ actions with undo */
  function act(fn, ...args) {
    const before = app.S.events.length;
    const rec = fn(app.S, ...args);
    if (!rec) return null;
    rec.eventIds = app.S.events.slice(before).map((e) => e.id);
    app.undo.push({ label: rec.label, items: [rec] });
    save();
    return rec;
  }
  function actMany(label, list) {
    const items = [];
    for (const [fn, ...args] of list) {
      const before = app.S.events.length;
      const rec = fn(app.S, ...args);
      if (rec) { rec.eventIds = app.S.events.slice(before).map((e) => e.id); items.push(rec); }
    }
    if (items.length) app.undo.push({ label, items });
    save();
    return items.length;
  }
  function undoLast() {
    const u = app.undo.pop();
    if (!u) return;
    for (const rec of u.items.slice().reverse()) {
      const ids = new Set(rec.eventIds || []);
      app.S.events = app.S.events.filter((e) => !ids.has(e.id));
      if (rec.deleted) app.S.cards.splice(Math.min(rec.index, app.S.cards.length), 0, rec.before);
      else if (rec.added) app.S.cards = app.S.cards.filter((c) => !rec.added.includes(c.id));
      else {
        const i = app.S.cards.findIndex((c) => c.id === rec.cardId);
        if (i >= 0) app.S.cards[i] = rec.before;
      }
    }
    save();
    toast(`Отменено: ${u.label}`);
    render();
  }
  const lastUndoFor = (cardId) => {
    const u = app.undo[app.undo.length - 1];
    return u && u.items.some((r) => r.cardId === cardId) ? u : null;
  };

  /* processing of new cards: visible "Обрабатывается", then the real local processing */
  function processCards(ids) {
    const list = ids.map(card).filter((c) => c && c.stage === "new");
    if (!list.length) return 0;
    for (const c of list) c.stage = "processing";
    save();
    render();
    list.forEach((c, i) => setTimeout(() => {
      const fresh = card(c.id);
      if (!fresh || fresh.stage !== "processing") return;
      M.processCard(app.S, fresh, now());
      save();
      if (i === list.length - 1) toast(`Обработано карточек: ${list.length}. Проверьте предложения системы.`);
      render();
    }, 700 + i * 260));
    return list.length;
  }

  /* ------------------------------------------------------------ export */
  function exportCards(cards, format) {
    const rows = [];
    for (const c of cards) for (const f of c.fields) {
      if (!M.FIELD_STATE[f.state].decided) continue;
      rows.push({
        sku: c.sku, product: c.name, category: catName(c.category), characteristic: f.name,
        value: f.state === "absent" ? "" : f.value,
        decision: f.decidedBy === "auto" ? "автоматически" : "человек",
        action: { auto: "принято автоматически", accepted: "принято", corrected: "исправлено", absent: "подтверждено отсутствие" }[f.state],
        model_score: f.state === "auto" || f.state === "accepted" ? f.score : "",
        decided_at: f.decidedAt ? new Date(f.decidedAt).toISOString() : "",
      });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    let blob, name;
    if (format === "csv") {
      const head = Object.keys(rows[0] || { sku: "" });
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const text = [head.join(";"), ...rows.map((r) => head.map((h) => q(r[h])).join(";"))].join("\r\n");
      blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
      name = `atlas-export-${stamp}.csv`;
    } else {
      const data = cards.map((c) => ({ sku: c.sku, name: c.name, category: catName(c.category),
        characteristics: rows.filter((r) => r.sku === c.sku).map(({ sku, product, category, ...r }) => r) }));
      blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      name = `atlas-export-${stamp}.json`;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    const t = now();
    for (const c of cards) c.exportedAt = t;
    save();
    return { name, rows: rows.length };
  }

  function exportDialog(cards) {
    const ready = cards.filter((c) => M.status(c) === "ready");
    const skipped = cards.length - ready.length;
    modal(`<h2>Выгрузить подтверждённые данные</h2>
      <p>${ready.length ? `Будут выгружены ${nf(ready.length)} ${M.plural(ready.length, "карточка", "карточки", "карточек")} в статусе «Готово к выгрузке».` : "Среди выбранных нет карточек, готовых к выгрузке."}
      ${skipped ? ` ${nf(skipped)} ${M.plural(skipped, "карточка ещё не проверена", "карточки ещё не проверены", "карточек ещё не проверены")} и в выгрузку не попадут.` : ""}</p>
      <p class="muted small">Для каждого значения указано, кто принял решение: система автоматически или человек. У исправленных вручную значений оценка модели не сохраняется.</p>
      <div class="dlg-actions"><button class="btn" data-act="modal-close">Отмена</button>
      <button class="btn" data-act="export-go" data-format="csv" ${ready.length ? "" : "disabled"}>${icon("download")}CSV для Excel</button>
      <button class="btn primary" data-act="export-go" data-format="json" ${ready.length ? "" : "disabled"}>${icon("download")}JSON</button></div>`);
    app.pendingExport = ready.map((c) => c.id);
  }

  /* ------------------------------------------------------------ toast / modal */
  let toastTimer = null;
  function toast(text, withUndo = false) {
    const el = document.getElementById("toast");
    el.innerHTML = `<span>${esc(text)}</span>${withUndo ? `<button class="btn" data-act="undo">${icon("undo")}Отменить</button>` : ""}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, withUndo ? 7000 : 4000);
  }
  function modal(html) {
    const el = document.getElementById("modal");
    el.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
    el.hidden = false;
    const f = el.querySelector("button.primary, button, input, textarea");
    if (f) f.focus();
  }
  function closeModal() { document.getElementById("modal").hidden = true; }
  function confirmDialog({ title, text, ok, danger }, onOk) {
    app.onConfirm = onOk;
    modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dlg-actions"><button class="btn" data-act="modal-close">Отмена</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-act="confirm-ok">${esc(ok)}</button></div>`);
  }

  /* ------------------------------------------------------------ header */
  const NAV = [["catalog", "Каталог"], ["add", "Добавить"], ["automation", "Автоматизация"], ["analytics", "Аналитика"],
               ["dictionaries", "Словари"], ["approaches", "Четыре подхода"]];
  function renderHeader(route) {
    const n = app.S.cards.length;
    document.getElementById("nav").innerHTML = NAV.map(([k, label]) =>
      `<a href="#/${k}" ${route === k || (route === "card" && k === "catalog") ? 'aria-current="page"' : ""}>${label}${k === "catalog" ? `<span class="cnt">${nf(n)}</span>` : ""}</a>`).join("");
    const fs = M.fieldStats(app.S.cards);
    document.getElementById("bar-tools").innerHTML =
      `<button class="waiting" data-act="go-waiting" title="Показать карточки, где есть поля без решения">Ждут решения: <b>${nf(fs.waiting)}</b> ${M.plural(fs.waiting, "поле", "поля", "полей")}</button>
       <button class="menu-btn" data-act="menu" aria-label="Ещё" aria-haspopup="true">⋯</button>`;
  }

  /* ------------------------------------------------------------ router */
  function parse() {
    const h = location.hash.replace(/^#\/?/, "");
    const [route, ...rest] = h.split("/");
    return { route: route || "catalog", arg: rest.join("/") };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render() {
    const { route, arg } = parse();
    const view = app.views[route] || app.views.catalog;
    renderHeader(route);
    const el = document.getElementById("view");
    el.innerHTML = view.render(arg);
    if (view.after) view.after(arg);
  }

  /* ------------------------------------------------------------ events: one delegated handler per type */
  const handlers = { click: {}, input: {}, change: {}, submit: {}, keydown: {} };
  function on(type, name, fn) { handlers[type][name] = fn; }
  function dispatch(type, e) {
    const el = e.target.closest(`[data-${type === "click" ? "act" : "on"}]`);
    if (!el) return;
    const name = type === "click" ? el.dataset.act : el.dataset.on;
    const fn = handlers[type][name];
    if (fn) fn(el, e);
  }

  function start() {
    app.S = load();
    let ui = {};
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || "{}"); } catch (e) { /* ignore */ }
    app.ui.catalog = { ...defaultCatalogUi(), ...(ui.catalog || {}), selected: [] };
    // cards left "processing" by a closed tab finish now
    for (const c of app.S.cards) if (c.stage === "processing") M.processCard(app.S, c, now());
    save();
    ["click", "input", "change", "keydown"].forEach((t) => document.addEventListener(t, (e) => dispatch(t, e)));
    document.addEventListener("submit", (e) => { e.preventDefault(); dispatch("submit", e); });
    document.addEventListener("click", (e) => {
      const pop = document.querySelector(".menu-pop");
      if (pop && !e.target.closest(".menu-pop") && !e.target.closest('[data-act="menu"]')) pop.remove();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); const p = document.querySelector(".menu-pop"); if (p) p.remove(); }
    });
    window.addEventListener("hashchange", () => { render(); document.getElementById("view").focus({ preventScroll: true }); window.scrollTo(0, 0); });
    if (!location.hash) location.hash = "#/catalog"; else render();
  }

  /* ------------------------------------------------------------ shared click handlers */
  on("click", "undo", () => undoLast());
  on("click", "modal-close", () => closeModal());
  on("click", "confirm-ok", () => { closeModal(); if (app.onConfirm) app.onConfirm(); });
  on("click", "go-waiting", () => { app.ui.catalog = { ...app.ui.catalog, status: "", problem: "any", q: "", category: "" }; go("#/catalog"); });
  on("click", "menu", (el) => {
    const old = document.querySelector(".menu-pop");
    if (old) { old.remove(); return; }
    const d = document.createElement("div");
    d.className = "menu-pop";
    d.innerHTML = `<button data-act="export-all">Выгрузить все готовые карточки</button>
      <button data-act="reset-ask">Восстановить исходный набор</button>
      <div class="hint">Изменения сохраняются в этом браузере. Восстановление вернёт каталог, словари и историю к исходному состоянию.</div>`;
    document.body.appendChild(d);
  });
  on("click", "export-all", () => { document.querySelector(".menu-pop")?.remove(); exportDialog(app.S.cards); });
  on("click", "export-go", (el) => {
    const list = (app.pendingExport || []).map(card).filter(Boolean);
    const r = exportCards(list, el.dataset.format);
    closeModal();
    toast(`Выгружено: ${r.rows} ${M.plural(r.rows, "значение", "значения", "значений")} из ${list.length} ${M.plural(list.length, "карточки", "карточек", "карточек")} (${r.name})`);
    render();
  });
  on("click", "reset-ask", () => {
    document.querySelector(".menu-pop")?.remove();
    confirmDialog({ title: "Восстановить исходный набор?", text: "Все решения, импортированные и созданные карточки, правки словарей будут удалены. Отменить это нельзя.", ok: "Восстановить", danger: true }, resetAll);
  });

  Object.assign(app, { start, render, go, save, act, actMany, undoLast, lastUndoFor, processCards, exportCards, exportDialog, toast, modal,
    closeModal, confirmDialog, on, esc, nf, pct, dec2, now, card, cat, catName, when, icon, statusChip, fieldMark, FIELD_ICON, REC_ICON,
    catalogList, defaultCatalogUi });
  return app;
})();
