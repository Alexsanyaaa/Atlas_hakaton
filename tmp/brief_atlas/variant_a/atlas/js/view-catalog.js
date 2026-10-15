/* Catalog: work queue, search, filters, sort, selection, bulk actions. */
(function () {
  const A = ATLAS.app, M = ATLAS.model;
  const { esc, nf, icon, on } = A;
  const STATUS_OPTS = ["conflict", "review", "new", "processing", "ready"];
  const PROBLEMS = { any: "Есть нерешённые поля", conflict: "Противоречие между источниками", suspicious: "Подозрительное предложение", nodata: "Нет данных в тексте", none: "Без проблем" };
  const SORTS = { attention: "Сначала требующие внимания", recent: "Недавно изменённые", name: "По названию", fill: "Меньше всего заполнено" };

  function queue() {
    const cards = A.S.cards;
    const conflict = cards.filter((c) => M.status(c) === "conflict");
    const review = cards.filter((c) => M.status(c) === "review");
    const fresh = cards.filter((c) => c.stage === "new");
    const last = cards.filter((c) => c.lastOpenedAt && M.status(c) !== "ready").sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    const item = (act, ic, cls, title, n, sub, disabled) =>
      `<button data-act="${act}" ${disabled ? "disabled" : ""}><span class="q-title ${cls}">${icon(ic)}${title}</span>
        ${n != null ? `<span class="q-n">${nf(n)}</span>` : ""}<span class="q-sub">${esc(sub)}</span></button>`;
    return `<div class="queue" aria-label="Что сделать сейчас">
      ${item("q-conflict", "conflict", "st-conflict", "Разобрать противоречия", conflict.length, conflict.length ? "Источники расходятся в значениях" : "Противоречий нет", !conflict.length)}
      ${item("q-review", "pending", "st-pending", "Проверить новые предложения", review.length, review.length ? "Карточки с полями без решения" : "Всё проверено", !review.length)}
      ${item("q-new", "new", "st-new", "Обработать поступления", fresh.length, fresh.length ? "Система подготовит характеристики" : "Новых поступлений нет", !fresh.length)}
      ${item("q-last", "play", "", "Продолжить последнюю карточку", null, last ? last.name : "Вы ещё не открывали карточки", !last)}
    </div>`;
  }

  function filters(u) {
    const groups = ATLAS.GROUPS.map((g) => `<optgroup label="${esc(g)}">${Object.values(ATLAS.CATEGORIES).filter((c) => c.group === g)
      .map((c) => `<option value="${c.key}" ${u.category === c.key ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("");
    return `<div class="toolbar">
      <label class="search"><span class="sr">Поиск</span>${icon("search")}
        <input type="search" data-on="cat-q" value="${esc(u.q)}" placeholder="Название, артикул или бренд"></label>
      <select data-on="cat-f" data-k="category" aria-label="Категория"><option value="">Все категории</option>${groups}
        <option value="__none" ${u.category === "__none" ? "selected" : ""}>Категория не определена</option></select>
      <select data-on="cat-f" data-k="status" aria-label="Статус"><option value="">Любой статус</option>
        ${STATUS_OPTS.map((s) => `<option value="${s}" ${u.status === s ? "selected" : ""}>${M.STATUS[s].label}</option>`).join("")}</select>
      <select data-on="cat-f" data-k="problem" aria-label="Проблемы"><option value="">Любые карточки</option>
        ${Object.entries(PROBLEMS).map(([k, v]) => `<option value="${k}" ${u.problem === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select data-on="cat-f" data-k="sort" aria-label="Сортировка">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${u.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    </div>`;
  }

  function activeChips(u) {
    const chips = [];
    if (u.q) chips.push(["q", `Поиск: «${u.q}»`]);
    if (u.category) chips.push(["category", `Категория: ${u.category === "__none" ? "не определена" : A.catName(u.category)}`]);
    if (u.status) chips.push(["status", `Статус: ${M.STATUS[u.status].label}`]);
    if (u.problem) chips.push(["problem", PROBLEMS[u.problem]]);
    if (!chips.length) return `<div class="active-filters muted">Показаны все карточки каталога</div>`;
    return `<div class="active-filters">${chips.map(([k, t]) => `<button class="fchip" data-act="cat-unset" data-k="${k}" title="Убрать фильтр">${esc(t)}<i>✕</i></button>`).join("")}
      <button class="btn ghost" data-act="cat-reset">Сбросить фильтры</button></div>`;
  }

  function fillBar(c) {
    if (c.stage !== "done") return `<span class="muted small">—</span>`;
    const p = M.progress(c);
    const auto = c.fields.filter((f) => f.state === "auto").length;
    return `<div class="fill"><span class="track"><i class="a" style="width:${(auto / p.total) * 100}%"></i><i class="h" style="width:${((p.done - auto) / p.total) * 100}%"></i></span>
      <span class="n">${p.done} из ${p.total}</span></div>`;
  }

  function whyCell(c) {
    const r = M.reason(c);
    if (!r.text) return `<span class="muted small">${c.exportedAt ? "Выгружено " + A.when(c.exportedAt) : "Все поля проверены"}</span>`;
    const ic = { conflict: "conflict", reject: "reject", complete: "complete", pending: "pending", nodata: "nodata", new: "new" }[r.kind] || "pending";
    const cls = { conflict: "st-conflict", reject: "st-conflict", complete: "st-pending", nodata: "st-nodata" }[r.kind] || "st-pending";
    return `<span class="why"><span class="${cls}">${icon(ic)}</span>${esc(r.text)}</span>`;
  }

  function row(c, sel) {
    const brand = c.fields.find((f) => f.key === "brand");
    const b = brand ? brand.value || (M.proposal(brand) || {}).value : "";
    return `<tr class="${sel ? "sel" : ""}" data-act="open-card" data-id="${c.id}">
      <td class="chk"><input type="checkbox" data-act="cat-sel" data-id="${c.id}" ${sel ? "checked" : ""} aria-label="Выбрать ${esc(c.name)}"></td>
      <td><span class="prod-name">${esc(c.name || "Без названия")}</span><span class="prod-meta"><span class="mono">${esc(c.sku)}</span>${b ? ` · ${esc(b)}` : ""}${c.origin !== "catalog" ? ` · ${c.origin === "import" ? "импорт" : "из текста"}` : ""}</span></td>
      <td>${esc(A.catName(c.category))}</td>
      <td>${A.statusChip(M.status(c))}</td>
      <td>${fillBar(c)}</td>
      <td>${whyCell(c)}</td>
    </tr>`;
  }

  function bulk(u, list) {
    if (!u.selected.length) return "";
    const sel = u.selected.map(A.card).filter(Boolean);
    const fresh = sel.filter((c) => c.stage === "new").length;
    const acceptable = sel.reduce((n, c) => n + c.fields.filter((f) => f.state === "pending" && f.rec.code === "accept").length, 0);
    const ready = sel.filter((c) => M.status(c) === "ready").length;
    return `<div class="bulk" role="region" aria-label="Действия с выбранными">
      <b>Выбрано: ${sel.length}</b>
      <button class="btn" data-act="bulk-process" ${fresh ? "" : "disabled"}>Обработать${fresh ? ` (${fresh})` : ""}</button>
      <button class="btn" data-act="bulk-accept" ${acceptable ? "" : "disabled"} title="Принять только значения, которые прямо подтверждены текстом">Принять подтверждённые текстом${acceptable ? ` (${acceptable})` : ""}</button>
      <button class="btn" data-act="bulk-export" ${ready ? "" : "disabled"}>Выгрузить${ready ? ` (${ready})` : ""}</button>
      <button class="btn" data-act="bulk-delete">Удалить</button>
      <button class="btn" data-act="bulk-clear" style="margin-left:auto">Снять выделение</button>
    </div>`;
  }

  A.views.catalog = {
    render() {
      const u = A.ui.catalog;
      const list = A.catalogList();
      const shown = list.slice(0, u.limit);
      const allSel = shown.length && shown.every((c) => u.selected.includes(c.id));
      return `<div class="page-head"><div><h1>Каталог</h1><p class="sub">${nf(A.S.cards.length)} товаров. Выберите карточку, чтобы проверить характеристики и подтверждения из текста.</p></div>
          <a class="btn primary" href="#/add">${icon("upload")}Добавить товары</a></div>
        ${queue()}
        ${filters(u)}
        ${activeChips(u)}
        ${bulk(u, list)}
        <div class="list">${list.length ? `<table>
          <thead><tr><th class="chk"><input type="checkbox" data-act="cat-selall" ${allSel ? "checked" : ""} aria-label="Выбрать все показанные"></th>
            <th>Товар</th><th>Категория</th><th>Статус</th><th>Заполнение</th><th>Что требует внимания</th></tr></thead>
          <tbody>${shown.map((c) => row(c, u.selected.includes(c.id))).join("")}</tbody></table>
          ${list.length > shown.length ? `<div class="more"><button class="btn" data-act="cat-more">Показать ещё ${Math.min(60, list.length - shown.length)} из ${list.length - shown.length}</button></div>` : ""}`
          : `<div class="empty-state"><b>Под эти условия не подходит ни одна карточка</b><span>Измените запрос или сбросьте фильтры.</span><button class="btn" data-act="cat-reset">Сбросить фильтры</button></div>`}
        </div>
        <p class="muted small" style="margin-top:8px">Показано ${nf(shown.length)} из ${nf(list.length)}. Полоса заполнения: <span class="st-auto">тёмно-зелёная</span> часть принята системой автоматически, <span class="st-accepted">зелёная</span> — проверена человеком.</p>`;
    },
  };

  let qTimer = null;
  on("input", "cat-q", (el) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      A.ui.catalog.q = el.value; A.ui.catalog.limit = 60; A.save(); A.render();
      const inp = document.querySelector('[data-on="cat-q"]');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 220);
  });
  on("change", "cat-f", (el) => { A.ui.catalog[el.dataset.k] = el.value; A.ui.catalog.limit = 60; A.save(); A.render(); });
  on("click", "cat-unset", (el) => { A.ui.catalog[el.dataset.k] = ""; A.save(); A.render(); });
  on("click", "cat-reset", () => { A.ui.catalog = { ...A.defaultCatalogUi(), sort: A.ui.catalog.sort }; A.save(); A.render(); });
  on("click", "cat-more", () => { A.ui.catalog.limit += 60; A.render(); });
  on("click", "open-card", (el, e) => {
    if (e.target.closest("input")) return;
    A.go(`#/card/${el.dataset.id}`);
  });
  on("click", "cat-sel", (el, e) => {
    e.stopPropagation();
    const s = new Set(A.ui.catalog.selected);
    s.has(el.dataset.id) ? s.delete(el.dataset.id) : s.add(el.dataset.id);
    A.ui.catalog.selected = [...s];
    A.render();
  });
  on("click", "cat-selall", () => {
    const u = A.ui.catalog;
    const shown = A.catalogList().slice(0, u.limit).map((c) => c.id);
    const all = shown.every((id) => u.selected.includes(id));
    u.selected = all ? u.selected.filter((id) => !shown.includes(id)) : [...new Set([...u.selected, ...shown])];
    A.render();
  });
  on("click", "bulk-clear", () => { A.ui.catalog.selected = []; A.render(); });
  on("click", "bulk-process", () => {
    const n = A.processCards(A.ui.catalog.selected);
    A.toast(`Запущена обработка: ${n} ${M.plural(n, "карточка", "карточки", "карточек")}`);
  });
  on("click", "bulk-accept", () => {
    const t = A.now();
    const ops = [];
    for (const id of A.ui.catalog.selected) {
      const c = A.card(id);
      if (!c) continue;
      const keys = c.fields.filter((f) => f.state === "pending" && f.rec.code === "accept").map((f) => f.key);
      if (!keys.length) continue;
      ops.push([(S) => {
        const u = M.snapshot(S, c, "");
        for (const k of keys) M.accept(S, c, k, t);
        return u;
      }]);
    }
    const n = A.ui.catalog.selected.reduce((s, id) => s + (A.card(id)?.fields.filter((f) => f.state === "pending" && f.rec.code === "accept").length || 0), 0);
    A.actMany(`Принято значений: ${n}`, ops);
    A.toast(`Принято ${n} ${M.plural(n, "значение", "значения", "значений")}, подтверждённых текстом`, true);
    A.render();
  });
  on("click", "bulk-export", () => A.exportDialog(A.ui.catalog.selected.map(A.card).filter(Boolean)));
  on("click", "bulk-delete", () => {
    const ids = [...A.ui.catalog.selected];
    A.confirmDialog({ title: `Удалить ${ids.length} ${M.plural(ids.length, "карточку", "карточки", "карточек")}?`,
      text: "Карточки и решения по ним будут удалены из каталога. Действие можно отменить сразу после удаления.", ok: "Удалить", danger: true }, () => {
      const items = [];
      for (const id of ids) {
        const i = A.S.cards.findIndex((c) => c.id === id);
        if (i < 0) continue;
        items.push({ cardId: id, before: A.S.cards[i], index: i, deleted: true, eventIds: [] });
        A.S.cards.splice(i, 1);
      }
      A.undo.push({ label: `Удалено карточек: ${items.length}`, items });
      A.ui.catalog.selected = [];
      A.save();
      A.toast(`Удалено карточек: ${items.length}`, true);
      A.render();
    });
  });
  const goFilter = (patch) => { A.ui.catalog = { ...A.defaultCatalogUi(), sort: A.ui.catalog.sort, ...patch }; A.save(); A.render(); };
  on("click", "q-conflict", () => {
    const first = A.S.cards.find((c) => M.status(c) === "conflict");
    goFilter({ status: "conflict" });
    if (first) A.go(`#/card/${first.id}`);
  });
  on("click", "q-review", () => goFilter({ status: "review" }));
  on("click", "q-new", () => {
    goFilter({ status: "new" });
    const ids = A.S.cards.filter((c) => c.stage === "new").map((c) => c.id);
    A.processCards(ids);
  });
  on("click", "q-last", () => {
    const last = A.S.cards.filter((c) => c.lastOpenedAt && M.status(c) !== "ready").sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    if (last) A.go(`#/card/${last.id}`);
  });
})();
