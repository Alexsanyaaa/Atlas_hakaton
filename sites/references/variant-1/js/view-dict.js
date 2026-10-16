/* Normalization dictionaries: "как встречается в тексте" -> "как сохраняется в каталоге". Used live by processing. */
(function () {
  const A = ATLAS.app, M = ATLAS.model, E = ATLAS.engine;
  const { esc, icon, on, nf } = A;
  const T = ATLAS.DICT_TYPES;
  const ui = (A.ui.dict = { type: "", q: "", editing: null, adding: false, err: "",
    sample: "Чайник Polaris, корпус из нерж. стали чёрного цвета, мощность 2,2 кВт, объём 1700 мл. ОЗУ: 8 Гб" });

  function list() {
    const q = E.fold(ui.q.trim());
    return A.S.dict.filter((d) => (!ui.type || d.type === ui.type) && (!q || E.fold(`${d.from} ${d.to}`).includes(q)));
  }

  function formRow(d) {
    const typeSel = `<select id="dict-type" aria-label="Тип">${Object.entries(T).map(([k, v]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    return `<tr class="editing"><td>${typeSel}</td>
      <td><input type="text" id="dict-from" value="${esc(d.from)}" placeholder="варианты через запятую" aria-label="Как встречается в тексте"></td><td class="arrow">→</td>
      <td><input type="text" id="dict-to" value="${esc(d.to)}" placeholder="значение в каталоге" aria-label="Как сохраняется в каталоге">
        <input type="number" id="dict-factor" step="any" value="${d.factor ?? 1}" aria-label="Множитель" title="Множитель для единиц: 1 кВт = 1000 Вт" style="margin-top:6px;${d.type === "unit" ? "" : "display:none"}"></td>
      <td><div class="rowact"><button class="btn primary" data-act="dict-save">Сохранить</button><button class="btn" data-act="dict-cancel">Отмена</button></div>
        ${ui.err ? `<div class="st-conflict small" style="margin-top:6px">${esc(ui.err)}</div>` : ""}</td></tr>`;
  }

  function preview() {
    const C = E.compile(A.S.dict);
    const text = ui.sample || "";
    const hits = [];
    const tf = E.fold(text);
    for (const [kind, D] of [["Цвета", C.colors], ["Бренды", C.brands], ["Материалы", C.materials]]) {
      if (!D.re) continue;
      for (const m of text.matchAll(D.re)) { const r = D.map.get(E.fold(m[0])); if (r) hits.push({ at: m.index, from: m[0], to: r.to, kind }); }
    }
    for (const m of text.matchAll(C.numRe)) {
      const u = C.units.get(E.fold(m[2]));
      if (u) hits.push({ at: m.index, from: m[0], to: E.numValue(Number(m[1].replace(",", ".")) * u.factor, u.to), kind: "Единицы" });
    }
    for (const [from, to] of C.syn) {
      const re = new RegExp(`(?<![\\p{L}])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s*:)`, "giu");
      for (const m of tf.matchAll(re)) hits.push({ at: m.index, from: text.slice(m.index, m.index + m[0].length), to, kind: "Синоним характеристики" });
    }
    hits.sort((a, b) => a.at - b.at);
    return `<div class="section"><h2>Проверить на примере</h2><p class="lead small">Вставьте фрагмент описания — увидите, как текущие правила его нормализуют.</p>
      <textarea rows="4" data-on="dict-sample">${esc(text)}</textarea>
      ${hits.length ? `<ul class="applied">${hits.map((h) => `<li><span>«${esc(h.from)}»</span><span class="muted">→</span><b>${esc(h.to)}</b><span class="t">${esc(h.kind)}</span></li>`).join("")}</ul>`
        : '<p class="muted" style="margin-top:10px">Ни одно правило не сработало.</p>'}
      <p class="muted small" style="margin-top:10px">Правила применяются при обработке новых карточек и при смене категории. Уже принятые значения не меняются.</p></div>`;
  }

  A.views.dictionaries = {
    render() {
      const rows = list();
      const counts = Object.fromEntries(Object.keys(T).map((k) => [k, A.S.dict.filter((d) => d.type === k).length]));
      const tabs = [["", `Все (${A.S.dict.length})`], ...Object.entries(T).map(([k, v]) => [k, `${v} (${counts[k]})`])];
      return `<div class="page-head"><div><h1>Словари нормализации</h1><p class="sub">Как значение встречается в тексте и как оно сохраняется в каталоге. Система использует эти правила, когда готовит характеристики.</p></div>
          <button class="btn primary" data-act="dict-add">Добавить правило</button></div>
        <div class="dict-layout"><div>
          <div class="toolbar"><div class="seg" role="group" aria-label="Тип словаря">${tabs.map(([k, l]) => `<button aria-pressed="${ui.type === k}" data-act="dict-type" data-k="${k}">${l}</button>`).join("")}</div>
            <label class="search"><span class="sr">Поиск</span>${icon("search")}<input type="search" data-on="dict-q" value="${esc(ui.q)}" placeholder="Найти вариант или значение"></label></div>
          <div class="list"><table class="dict-tbl" style="min-width:640px"><thead><tr><th>Тип</th><th>Как встречается в тексте</th><th></th><th>Как сохраняется в каталоге</th><th></th></tr></thead><tbody>
            ${ui.adding ? formRow({ type: ui.type || "color", from: "", to: "", factor: 1 }) : ""}
            ${rows.map((d) => ui.editing === d.id ? formRow(d) : `<tr><td class="muted small">${T[d.type]}</td><td class="from">${esc(d.from)}</td><td class="arrow">→</td>
              <td class="to">${esc(d.to)}${d.type === "unit" && Number(d.factor) !== 1 ? ` <span class="muted small">× ${String(d.factor).replace(".", ",")}</span>` : ""}</td>
              <td><div class="rowact"><button class="btn ghost" data-act="dict-edit" data-id="${d.id}">Изменить</button><button class="btn ghost" data-act="dict-del" data-id="${d.id}">Удалить</button></div></td></tr>`).join("")}
            ${!rows.length && !ui.adding ? `<tr><td colspan="5"><div class="empty-state">Ничего не найдено. <button class="btn" data-act="dict-add">Добавить правило</button></div></td></tr>` : ""}
          </tbody></table></div><p class="muted small" style="margin-top:8px">Показано правил: ${nf(rows.length)}.</p></div>
          ${preview()}</div>`;
    },
  };

  function commitDict(label, mutate) {
    const before = M.clone(A.S.dict);
    mutate();
    A.undo.push({ label, items: [{ dictBefore: before, eventIds: [] }] });
    A.save();
  }
  // undo for dictionary edits
  const origUndo = A.undoLast;
  A.undoLast = function () {
    const u = A.undo[A.undo.length - 1];
    if (u && u.items[0] && u.items[0].dictBefore) {
      A.undo.pop();
      A.S.dict = u.items[0].dictBefore;
      A.save();
      A.toast(`Отменено: ${u.label}`);
      A.render();
      return;
    }
    origUndo();
  };
  on("click", "undo", () => A.undoLast());

  on("click", "dict-type", (el) => { ui.type = el.dataset.k; A.render(); });
  let t = null;
  on("input", "dict-q", (el) => { clearTimeout(t); t = setTimeout(() => { ui.q = el.value; A.render(); const i = document.querySelector('[data-on="dict-q"]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200); });
  on("input", "dict-sample", (el) => {
    ui.sample = el.value;
    clearTimeout(t);
    t = setTimeout(() => { const pos = el.selectionStart; A.render(); const i = document.querySelector('[data-on="dict-sample"]'); i.focus(); i.setSelectionRange(pos, pos); }, 300);
  });
  on("click", "dict-add", () => { ui.adding = true; ui.editing = null; ui.err = ""; A.render(); document.getElementById("dict-from")?.focus(); });
  on("click", "dict-edit", (el) => { ui.editing = el.dataset.id; ui.adding = false; ui.err = ""; A.render(); });
  on("click", "dict-cancel", () => { ui.editing = null; ui.adding = false; ui.err = ""; A.render(); });
  on("change", "dict-type-sel", () => {});
  document.addEventListener("change", (e) => {
    if (e.target.id === "dict-type") { const f = document.getElementById("dict-factor"); if (f) f.style.display = e.target.value === "unit" ? "" : "none"; }
  });
  on("click", "dict-save", () => {
    const type = document.getElementById("dict-type").value;
    const from = document.getElementById("dict-from").value.trim();
    const to = document.getElementById("dict-to").value.trim();
    const factor = Number(document.getElementById("dict-factor").value) || 1;
    if (!from || !to) { ui.err = "Заполните оба поля: варианты из текста и значение для каталога."; A.render(); return; }
    const vars = from.split(",").map((s) => E.fold(s.trim())).filter(Boolean);
    const clash = A.S.dict.find((d) => d.type === type && d.id !== ui.editing && d.from.split(",").some((v) => vars.includes(E.fold(v.trim()))));
    if (clash) { ui.err = `Вариант уже есть в правиле «${clash.from} → ${clash.to}». Измените то правило или уберите повтор.`; A.render(); return; }
    if (ui.adding) commitDict(`Добавлено правило «${to}»`, () => A.S.dict.unshift({ id: M.uid("d"), type, from, to, ...(type === "unit" ? { factor } : {}) }));
    else commitDict(`Изменено правило «${to}»`, () => Object.assign(A.S.dict.find((d) => d.id === ui.editing), { type, from, to, ...(type === "unit" ? { factor } : {}) }));
    const wasAdding = ui.adding;
    ui.editing = null; ui.adding = false; ui.err = "";
    A.toast(wasAdding ? `Правило добавлено: ${from} → ${to}` : "Правило сохранено", true);
    A.render();
  });
  on("click", "dict-del", (el) => {
    const d = A.S.dict.find((x) => x.id === el.dataset.id);
    commitDict(`Удалено правило «${d.to}»`, () => { A.S.dict = A.S.dict.filter((x) => x.id !== d.id); });
    A.toast(`Удалено правило «${d.from} → ${d.to}»`, true);
    A.render();
  });
})();
