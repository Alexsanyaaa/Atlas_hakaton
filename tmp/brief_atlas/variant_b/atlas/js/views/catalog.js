/* Каталог: что требует внимания, сколько работы взяла система, поиск, фильтры и массовые действия. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store } = A;
  const { esc } = util;
  A.views = A.views || {};

  const SORTS = {
    attention: 'Сначала требующие внимания',
    newest: 'Сначала новые',
    progress: 'Сначала менее заполненные',
    title: 'По названию',
  };
  const ATTENTION_RANK = ['conflict', 'reject', 'complete', 'normalize', 'accept', 'nodata'];

  function brandOf(card) {
    const f = card.fields && card.fields.brand;
    if (!f) return '';
    if (f.decision && f.decision.display) return f.decision.display;
    const c = f.candidates.find((x) => !x.rejected && !x.compat);
    return c ? c.display : '';
  }

  /** Карточки после поиска и фильтров — та же логика используется для «следующей карточки» на экране проверки. */
  function filtered() {
    const f = store.state.ui.catalog;
    const words = util.fold(f.q).split(' ').filter(Boolean);
    const list = store.state.cards.filter((card) => {
      if (words.length) {
        const hay = util.fold(`${card.title} ${card.sku} ${brandOf(card)}`);
        if (!words.every((w) => hay.includes(w))) return false;
      }
      if (f.categories.length && !f.categories.includes(card.category || 'none')) return false;
      const status = store.cardStatus(card);
      if (f.statuses.length && !f.statuses.includes(status)) return false;
      if (f.problemsOnly && !['conflict', 'review'].includes(status)) return false;
      return true;
    });
    const rank = (card) => {
      const a = store.attention(card);
      return schema.CARD_STATUSES[store.cardStatus(card)].order * 10 + (a ? Math.max(0, ATTENTION_RANK.indexOf(a.kind)) : 9);
    };
    const share = (card) => {
      const p = store.cardProgress(card);
      return p.total ? p.resolved / p.total : 0;
    };
    const sorters = {
      attention: (a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt,
      newest: (a, b) => b.createdAt - a.createdAt,
      progress: (a, b) => share(a) - share(b) || rank(a) - rank(b),
      title: (a, b) => a.title.localeCompare(b.title, 'ru'),
    };
    return list.sort(sorters[f.sort] || sorters.attention);
  }

  function hasFilters() {
    const f = store.state.ui.catalog;
    return Boolean(f.q || f.categories.length || f.statuses.length || f.problemsOnly);
  }

  /** Первая карточка с работой — для быстрых переходов. */
  function openFirst(statuses) {
    store.setCatalog({ statuses, categories: [], q: '', problemsOnly: false, sort: 'attention' });
    const first = filtered()[0];
    if (first) A.app.go(`#/card/${first.id}`);
  }

  // --- Части экрана ------------------------------------------------------------------------------

  function overview(m) {
    const segs = [
      ['auto', m.auto, 'Принято автоматически'],
      ['accepted', m.accepted, 'Подтверждено человеком'],
      ['corrected', m.corrected, 'Исправлено человеком'],
      ['absent', m.absent, 'Отсутствует — подтверждено'],
      ['waiting', m.waiting, 'Ждут решения'],
    ];
    const total = m.applicable || 1;
    const pct = m.applicable ? Math.round((m.auto / m.applicable) * 100) : 0;
    const cards = store.state.cards;
    const conflicts = cards.filter((c) => store.cardStatus(c) === 'conflict');
    const review = cards.filter((c) => store.cardStatus(c) === 'review');
    const fresh = cards.filter((c) => c.pipeline === 'new');
    const last = store.card(store.state.ui.lastCardId);
    const lastOpen = last && last.pipeline === 'done' ? store.cardProgress(last) : null;
    const lastLeft = lastOpen ? lastOpen.total - lastOpen.resolved : 0;

    const queueItem = (act, glyph, tone, title, sub, count, disabled) => `
      <button class="queue-item" data-act="${act}" ${disabled ? 'disabled' : ''} aria-label="${esc(title)}: ${count}">
        <span class="t-${tone}">${icons.glyph(glyph, 18)}</span>
        <span style="min-width:0"><strong>${title}</strong><small>${sub}</small></span>
        <span class="queue-count">${count}</span>
        ${icons.icon('right')}
      </button>`;

    return `
    <section class="panel overview" aria-label="Сводка">
      <div>
        <h2 class="section-title">Сколько работы берёт система</h2>
        <div class="auto-head">
          <span class="auto-pct num">${pct}%</span>
          <p><b>${util.num(m.auto, 0)} из ${util.num(m.applicable, 0)}</b> применимых полей приняты автоматически — без участия человека.
          ${m.waiting ? `Ещё <b>${util.num(m.waiting, 0)}</b> ${util.plural(m.waiting, ['поле ждёт', 'поля ждут', 'полей ждут'])} решения.` : 'Нерешённых полей нет.'}</p>
        </div>
        <div class="stackbar" role="img" aria-label="${segs.map((s) => `${s[2]}: ${s[1]}`).join(', ')}">
          ${segs.map(([k, v]) => (v ? `<span class="seg-${k}" style="width:${(v / total) * 100}%" title="${v}"></span>` : '')).join('')}
        </div>
        <ul class="legend">
          ${segs.map(([k, v, label]) => `<li><span class="swatch seg-${k}"></span>${label} <b>${util.num(v, 0)}</b></li>`).join('')}
        </ul>
        <details class="how">
          <summary>${icons.icon('info')} Как считается</summary>
          <ul>
            <li><b>Применимые поля</b> — характеристики категории у обработанных карточек: ${util.count(m.processed, ['карточка', 'карточки', 'карточек'])} → ${util.count(m.applicable, ['поле', 'поля', 'полей'])}.${m.unprocessed ? ` ${util.count(m.unprocessed, ['карточка ещё не обработана', 'карточки ещё не обработаны', 'карточек ещё не обработаны'])} и в расчёт не ${m.unprocessed === 1 ? 'входит' : 'входят'}.` : ''}</li>
            <li><b>Подготовлено системой</b> — ${util.num(m.prepared, 0)} ${util.plural(m.prepared, ['поле', 'поля', 'полей'])}: система нашла значение в тексте и показала цитату. У остальных ${util.num(m.applicable - m.prepared, 0)} значения в тексте нет.</li>
            <li><b>Принято автоматически</b> — значение прямо подтверждено текстом и оценка модели не ниже ${util.num(schema.AUTO_THRESHOLD)}. Одной оценки недостаточно: противоречия, нормализация и неполные значения всегда идут к человеку.</li>
            <li><b>Проверено человеком</b> — подтверждено, исправлено или отмечено как отсутствующее. Если человек изменил автоматическое решение, поле больше не считается автоматическим.</li>
            <li><b>Процент автоматизации</b> = принятые автоматически ÷ применимые поля = ${util.num(m.auto, 0)} ÷ ${util.num(m.applicable, 0)}.</li>
          </ul>
        </details>
      </div>
      <div>
        <h2 class="section-title">С чего начать</h2>
        <div class="queue">
          ${queueItem('quick-conflicts', 'conflict', 'bad', 'Разобрать противоречия', 'Значения в разных местах текста не совпадают', conflicts.length, !conflicts.length)}
          ${queueItem('quick-review', 'review', 'warn', 'Проверить новые предложения', 'Система нашла значения, нужно ваше решение', review.length, !review.length)}
          ${queueItem('quick-process', 'new', 'info', 'Обработать новые поступления', fresh.length ? 'Извлечь характеристики из текста' : 'Новых поступлений нет', fresh.length, !fresh.length)}
          ${last ? queueItem('quick-last', 'pending', 'muted', 'Продолжить последнюю карточку', `${esc(last.title)}${lastOpen ? ` · ${lastLeft ? `осталось ${util.count(lastLeft, ['поле', 'поля', 'полей'])}` : 'всё решено'}` : ''}`, lastLeft || '✓', false) : ''}
        </div>
      </div>
    </section>`;
  }

  function dropdown(id, label, options, selected) {
    const open = A.app.temp.openDropdown === id;
    const n = selected.length;
    return `
      <details class="dropdown" data-dropdown="${id}" ${open ? 'open' : ''}>
        <summary class="btn">${icons.icon('filter')} ${label}${n ? ` <span class="badge-count">${n}</span>` : ''} ${icons.icon('down')}</summary>
        <div class="dropdown-pop" role="group" aria-label="${label}">
          ${options.map((o) => `
            <label><input type="checkbox" data-change="filter-${id}" value="${o.id}" ${selected.includes(o.id) ? 'checked' : ''}>
              ${o.glyph ? `<span class="t-${o.tone}">${icons.glyph(o.glyph)}</span>` : ''}<span>${esc(o.label)}</span><span class="count">${o.count}</span></label>`).join('')}
        </div>
      </details>`;
  }

  function toolbar(all) {
    const f = store.state.ui.catalog;
    const catCounts = {};
    const stCounts = {};
    for (const c of all) {
      catCounts[c.category || 'none'] = (catCounts[c.category || 'none'] || 0) + 1;
      const s = store.cardStatus(c);
      stCounts[s] = (stCounts[s] || 0) + 1;
    }
    const categories = schema.CATEGORIES.filter((c) => catCounts[c.id]).map((c) => ({ id: c.id, label: c.name, count: catCounts[c.id] }));
    if (catCounts.none) categories.push({ id: 'none', label: 'Категория не определена', count: catCounts.none });
    const statuses = Object.entries(schema.CARD_STATUSES).sort((a, b) => a[1].order - b[1].order)
      .map(([id, s]) => ({ id, label: s.label, glyph: s.glyph, tone: s.tone, count: stCounts[id] || 0 }));
    return `
    <div class="toolbar">
      <div class="search">${icons.icon('search')}
        <input id="catalog-search" class="input" type="search" placeholder="Название, SKU или бренд" value="${esc(f.q)}" data-input="catalog-search" aria-label="Поиск по названию, SKU или бренду">
      </div>
      ${dropdown('category', 'Категория', categories, f.categories)}
      ${dropdown('status', 'Статус', statuses, f.statuses)}
      <button class="toggle ${f.problemsOnly ? 'is-on' : ''}" data-act="toggle-problems" aria-pressed="${f.problemsOnly}">${icons.glyph('review')} Только требующие внимания</button>
      <select id="catalog-sort" class="select sort" data-change="catalog-sort" aria-label="Сортировка">
        ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>`;
  }

  function chips(count, total) {
    const f = store.state.ui.catalog;
    const items = [];
    if (f.q) items.push(`<span class="chip">Поиск: «${esc(f.q)}» <button data-act="clear-filter" data-kind="q" aria-label="Убрать поиск">${icons.icon('close', 14)}</button></span>`);
    for (const id of f.categories) {
      const name = id === 'none' ? 'Категория не определена' : schema.category(id).name;
      items.push(`<span class="chip">${esc(name)} <button data-act="clear-filter" data-kind="category" data-value="${id}" aria-label="Убрать фильтр ${esc(name)}">${icons.icon('close', 14)}</button></span>`);
    }
    for (const id of f.statuses) {
      items.push(`<span class="chip">${schema.CARD_STATUSES[id].label} <button data-act="clear-filter" data-kind="status" data-value="${id}" aria-label="Убрать фильтр">${icons.icon('close', 14)}</button></span>`);
    }
    if (f.problemsOnly) items.push(`<span class="chip">Требуют внимания <button data-act="clear-filter" data-kind="problems" aria-label="Убрать фильтр">${icons.icon('close', 14)}</button></span>`);
    return `<div class="chips">
      <span class="result-count">${count === total ? `Показаны все ${util.count(total, ['карточка', 'карточки', 'карточек'])}` : `Найдено ${count} из ${total}`}</span>
      ${items.join('')}
      ${items.length ? '<button class="link-btn" data-act="reset-filters">Сбросить все</button>' : ''}
    </div>`;
  }

  function bulkbar(selected) {
    if (!selected.length) return '';
    const cards = selected.map((id) => store.card(id)).filter(Boolean);
    const canProcess = cards.filter((c) => c.pipeline === 'new' && c.category).length;
    const canAccept = cards.reduce((n, c) => n + (c.pipeline === 'done' ? Object.entries(c.fields).filter(([a, f]) => !f.decision && A.extractor.assess(a, f).kind === 'accept').length : 0), 0);
    return `
    <div class="bulkbar" role="region" aria-label="Действия с выбранными">
      <b>Выбрано: ${cards.length}</b>
      <button class="btn btn-sm" data-act="bulk-process" ${canProcess ? '' : 'disabled'}>${icons.icon('refresh')} Обработать${canProcess ? ` (${canProcess})` : ''}</button>
      <button class="btn btn-sm" data-act="bulk-accept" ${canAccept ? '' : 'disabled'} title="Принять поля, где значение прямо подтверждено текстом">${icons.icon('check')} Принять подтверждённые текстом${canAccept ? ` (${canAccept})` : ''}</button>
      <button class="btn btn-sm" data-act="bulk-export">${icons.icon('download')} Выгрузить</button>
      <button class="btn btn-sm btn-danger" data-act="bulk-delete">${icons.icon('trash')} Удалить</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-act="clear-selection">Снять выделение</button>
    </div>`;
  }

  function row(card, selected) {
    const status = store.cardStatus(card);
    const st = schema.CARD_STATUSES[status];
    const category = schema.category(card.category);
    const p = store.cardProgress(card);
    const a = store.attention(card);
    const brand = brandOf(card);
    const reasonTone = a ? { conflict: 'bad', reject: 'bad', complete: 'warn', normalize: 'info', accept: 'warn', nodata: 'muted', new: 'info', processing: 'info' }[a.kind] : 'ok';
    const reasonGlyph = a ? { conflict: 'conflict', reject: 'rejected', complete: 'pending', normalize: 'pending', accept: 'pending', nodata: 'nodata', new: 'new', processing: 'processing' }[a.kind] : 'ready';
    const fresh = (A.app.temp.freshIds || []).includes(card.id);
    let reason = a ? esc(a.text) : '<span class="muted">Все поля решены</span>';
    if (!card.category) reason = 'Категория не определена — выберите её в карточке';
    return `
    <div class="lrow item ${selected ? 'is-selected' : ''} ${fresh ? 'is-fresh' : ''}" data-act="open-card" data-id="${card.id}" role="row">
      <label class="check" data-stop><input type="checkbox" data-change="select-card" data-id="${card.id}" ${selected ? 'checked' : ''} aria-label="Выбрать ${esc(card.title)}"></label>
      ${icons.illustration(card.category, 44)}
      <div style="min-width:0">
        <a class="prod-title" href="#/card/${card.id}" data-stop>${esc(card.title)}</a>
        <div class="prod-meta"><span class="mono">${esc(card.sku)}</span>${brand ? ` · ${esc(brand)}` : ''}${card.exportedAt ? ` · <span class="exported">${icons.icon('download', 12)} выгружено ${util.date(card.exportedAt)}</span>` : ''}</div>
      </div>
      <div class="cat-cell">${category ? esc(category.name) : '<span class="muted">не определена</span>'}</div>
      <div class="cell-status"><span class="pill t-${st.tone}">${icons.glyph(st.glyph, 14)}${st.label}</span></div>
      <div class="cell-progress">${card.pipeline === 'done'
        ? `<div class="progress"><span>${p.resolved} из ${p.total} полей</span><div class="bar"><span style="width:${p.total ? (p.resolved / p.total) * 100 : 0}%"></span></div></div>`
        : `<div class="progress"><span class="muted">${card.pipeline === 'processing' ? 'извлечение…' : 'не обработана'}</span><div class="bar"><span style="width:0"></span></div></div>`}</div>
      <div class="cell-reason"><div class="reason"><span class="t-${reasonTone}">${icons.glyph(reasonGlyph, 15)}</span><span>${reason}</span></div></div>
      <span class="chev">${icons.icon('right')}</span>
    </div>`;
  }

  // --- Экран ---------------------------------------------------------------------------------------

  function render() {
    const all = store.state.cards;
    const list = filtered();
    const selected = store.state.ui.selection;
    const m = store.metrics(all);
    const categories = new Set(all.map((c) => c.category).filter(Boolean));
    const allVisibleSelected = list.length > 0 && list.every((c) => selected.includes(c.id));
    return `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Каталог</h1>
          <p class="sub">${util.count(all.length, ['карточка', 'карточки', 'карточек'])} · ${util.count(categories.size, ['категория', 'категории', 'категорий'])} · готово к выгрузке: ${m.statuses.ready}</p>
        </div>
        <div class="page-actions">
          <button class="btn" data-act="open-export">${icons.icon('download')} Выгрузить</button>
          <a class="btn btn-primary" href="#/add">${icons.icon('plus')} Добавить товары</a>
        </div>
      </div>
      ${overview(m)}
      ${toolbar(all)}
      ${chips(list.length, all.length)}
      ${bulkbar(selected)}
      <div class="panel ledger" role="table" aria-label="Карточки каталога">
        <div class="lrow head" role="row">
          <label class="check"><input type="checkbox" data-change="select-all" ${allVisibleSelected ? 'checked' : ''} aria-label="Выбрать все показанные"></label>
          <span></span><span>Товар</span><span class="cat-cell">Категория</span><span>Статус карточки</span><span>Решено</span><span>Что требует внимания</span><span></span>
        </div>
        ${list.length ? list.map((c) => row(c, selected.includes(c.id))).join('') : `
          <div class="empty">
            <h3>${hasFilters() ? 'Ничего не найдено' : 'Каталог пуст'}</h3>
            <p>${hasFilters() ? 'По этим условиям карточек нет. Измените запрос или сбросьте фильтры.' : 'Добавьте товары из файла или из текста описания.'}</p>
            ${hasFilters() ? '<button class="btn" data-act="reset-filters">Сбросить фильтры</button>' : '<a class="btn btn-primary" href="#/add">Добавить товары</a>'}
          </div>`}
      </div>
    </div>`;
  }

  // --- Действия ------------------------------------------------------------------------------------

  function setSelection(ids) {
    store.setUi({ selection: [...new Set(ids)] });
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'open-card': (el, e) => {
        if (e.target.closest('[data-stop]')) return;
        A.app.go(`#/card/${el.dataset.id}`);
      },
      'toggle-problems': () => store.setCatalog({ problemsOnly: !store.state.ui.catalog.problemsOnly }),
      'clear-filter': (el) => {
        const f = store.state.ui.catalog;
        const { kind, value } = el.dataset;
        if (kind === 'q') store.setCatalog({ q: '' });
        if (kind === 'category') store.setCatalog({ categories: f.categories.filter((x) => x !== value) });
        if (kind === 'status') store.setCatalog({ statuses: f.statuses.filter((x) => x !== value) });
        if (kind === 'problems') store.setCatalog({ problemsOnly: false });
      },
      'reset-filters': () => {
        A.app.temp.openDropdown = null;
        store.setCatalog({ q: '', categories: [], statuses: [], problemsOnly: false });
      },
      'clear-selection': () => setSelection([]),
      'bulk-process': () => {
        const ids = store.state.ui.selection.filter((id) => {
          const c = store.card(id);
          return c && c.pipeline === 'new' && c.category;
        });
        const n = store.process(ids, (done) => A.app.toast(`Обработано: ${util.count(done, ['карточка', 'карточки', 'карточек'])}`));
        if (n) A.app.toast(`Запущена обработка: ${util.count(n, ['карточка', 'карточки', 'карточек'])}`);
      },
      'bulk-accept': () => {
        const n = store.acceptConfirmed(store.state.ui.selection);
        A.app.toast(n ? `Принято ${util.count(n, ['значение', 'значения', 'значений'])}, подтверждённых текстом` : 'Нет полей с рекомендацией «принять»', { undo: n > 0 });
      },
      'bulk-export': () => A.app.openExport('selected'),
      'bulk-delete': () => {
        const n = store.state.ui.selection.length;
        A.app.modal({
          title: `Удалить ${util.count(n, ['карточку', 'карточки', 'карточек'])}?`,
          body: '<p>Карточки и решения по их характеристикам будут удалены из каталога. Сразу после удаления действие можно отменить.</p>',
          buttons: [{ label: 'Отмена', act: 'modal-close' }, { label: 'Удалить', act: 'bulk-delete-confirm', cls: 'btn-danger' }],
        });
      },
      'bulk-delete-confirm': () => {
        const ids = [...store.state.ui.selection];
        A.app.closeModal();
        store.remove(ids);
        A.app.toast(`Удалено: ${util.count(ids.length, ['карточка', 'карточки', 'карточек'])}`, { undo: true });
      },
      'quick-conflicts': () => openFirst(['conflict']),
      'quick-review': () => openFirst(['review']),
      'quick-process': () => {
        const ids = store.state.cards.filter((c) => c.pipeline === 'new' && c.category).map((c) => c.id);
        store.setCatalog({ statuses: [], categories: [], q: '', problemsOnly: false, sort: 'newest' });
        const n = store.process(ids, (done) => A.app.toast(`Обработано: ${util.count(done, ['карточка', 'карточки', 'карточек'])}. Результаты — в списке.`));
        if (n) A.app.toast(`Обработка запущена: ${util.count(n, ['карточка', 'карточки', 'карточек'])}`);
      },
      'quick-last': () => {
        const id = store.state.ui.lastCardId;
        if (store.card(id)) A.app.go(`#/card/${id}`);
      },
    },
    inputs: {
      'catalog-search': (el) => store.setCatalog({ q: el.value }),
    },
    changes: {
      'catalog-sort': (el) => store.setCatalog({ sort: el.value }),
      'filter-category': (el) => {
        const f = store.state.ui.catalog;
        store.setCatalog({ categories: el.checked ? [...f.categories, el.value] : f.categories.filter((x) => x !== el.value) });
      },
      'filter-status': (el) => {
        const f = store.state.ui.catalog;
        store.setCatalog({ statuses: el.checked ? [...f.statuses, el.value] : f.statuses.filter((x) => x !== el.value) });
      },
      'select-card': (el) => {
        const sel = store.state.ui.selection;
        setSelection(el.checked ? [...sel, el.dataset.id] : sel.filter((x) => x !== el.dataset.id));
      },
      'select-all': (el) => {
        const ids = filtered().map((c) => c.id);
        const sel = store.state.ui.selection;
        setSelection(el.checked ? [...sel, ...ids] : sel.filter((x) => !ids.includes(x)));
      },
    },
  });

  A.views.catalog = { render, filtered, brandOf, title: () => 'Каталог' };
})();
