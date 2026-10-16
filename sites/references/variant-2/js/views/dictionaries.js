/* Словари нормализации: «как встречается в тексте → как сохраняется в каталоге».
   Извлечение использует текущую версию словарей, поэтому правка сразу видна в предпросмотре,
   а к карточкам применяется при обработке. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store, extractor, dictionaries } = A;
  const { esc } = util;
  A.views = A.views || {};

  const TYPES = dictionaries.TYPES;

  function entries() {
    const f = store.state.ui.dict;
    const q = util.fold(f.q);
    return store.state.dict.filter((e) => {
      if (f.type !== 'all' && e.type !== f.type) return false;
      if (!q) return true;
      return util.fold([e.canonical, ...(e.variants || []), e.note || ''].join(' ')).includes(q);
    });
  }

  function canonicalCell(e) {
    let note = e.note ? `<span class="dict-note">${esc(e.note)}</span>` : '';
    if (e.type === 'unit' && e.meta) {
      const dim = dictionaries.DIMENSIONS[e.meta.dim];
      const factor = Number(e.meta.factor) || 1;
      note = `<span class="dict-note">${dim ? esc(dim.name) : ''}${factor !== 1 ? ` · хранится в «${esc(dim.base)}», ×${util.num(factor, 4)}` : ''}</span>${note}`;
    }
    if (e.type === 'synonym' && e.meta) note = `<span class="dict-note">характеристика каталога</span>${note}`;
    return `<span class="canonical">${esc(e.canonical)}</span>${note}`;
  }

  // --- Предпросмотр: что словари найдут в примере текста --------------------------------------------

  function preview(text) {
    const idx = extractor.buildIndex(store.state.dict);
    const hits = [];
    for (const type of ['brand', 'color', 'material']) {
      const re = idx.re[type];
      if (!re) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const info = idx.lookup[type].get(util.fold(m[0]));
        if (info) hits.push({ start: m.index, end: m.index + m[0].length, from: m[0], to: info.canonical, type, same: util.fold(m[0]) === util.fold(info.canonical) });
      }
    }
    for (const [dim, units] of Object.entries(idx.unitRe)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}.,])(\\d+(?:[.,]\\d+)?)\\s*(${units})(?![\\p{L}\\p{N}])`, 'giu');
      let m;
      while ((m = re.exec(text))) {
        const info = idx.units[dim].get(util.fold(m[2]));
        const value = parseFloat(m[1].replace(',', '.')) * info.factor;
        const base = dictionaries.DIMENSIONS[dim] ? dictionaries.DIMENSIONS[dim].base : info.canonical;
        hits.push({ start: m.index, end: m.index + m[0].length, from: m[0], to: `${util.num(value, 3)} ${base}`, type: 'unit', same: false });
      }
    }
    for (const [attr, re] of Object.entries(idx.synonymRe)) {
      if (!re) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) hits.push({ start: m.index, end: m.index + m[0].length, from: m[0], to: schema.attr(attr) ? schema.attr(attr).name : attr, type: 'synonym', same: false });
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    let pos = -1;
    for (const h of hits) {
      if (h.start >= pos) {
        kept.push(h);
        pos = h.end;
      }
    }
    let html = '';
    let at = 0;
    for (const h of kept) {
      html += esc(text.slice(at, h.start)) + `<span class="ev is-on" title="${esc(TYPES[h.type].one)} → ${esc(h.to)}">${esc(text.slice(h.start, h.end))}</span>`;
      at = h.end;
    }
    html += esc(text.slice(at));
    return { html, hits: kept };
  }

  function render() {
    const f = store.state.ui.dict;
    const list = entries();
    const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, store.state.dict.filter((e) => e.type === t).length]));
    const p = preview(f.preview || '');
    return `
    <div class="page">
      <div class="page-head">
        <div><h1>Словари</h1><p class="sub">Как значение из текста приводится к виду каталога. Изменения применяются к новым карточкам и при повторной обработке.</p></div>
        <div class="page-actions">
          <button class="btn" data-act="dict-apply" title="Повторно извлечь характеристики во всех обработанных карточках; решения людей сохранятся">${icons.icon('refresh')} Применить к каталогу</button>
          <button class="btn btn-primary" data-act="dict-add">${icons.icon('plus')} Добавить запись</button>
        </div>
      </div>
      <div class="filters-row">
        <div class="seg" role="group" aria-label="Тип словаря">
          <button class="${f.type === 'all' ? 'is-on' : ''}" data-act="dict-type" data-type="all">Все <span class="muted">${store.state.dict.length}</span></button>
          ${Object.entries(TYPES).map(([t, v]) => `<button class="${f.type === t ? 'is-on' : ''}" data-act="dict-type" data-type="${t}">${v.name} <span class="${f.type === t ? '' : 'muted'}">${counts[t]}</span></button>`).join('')}
        </div>
        <div class="search" style="max-width:340px">${icons.icon('search')}
          <input id="dict-search" class="input" type="search" placeholder="Найти: Midnight, мл, велюр…" value="${esc(f.q)}" data-input="dict-search" aria-label="Поиск по словарям"></div>
      </div>
      <div class="dict-layout">
        <section class="panel" aria-label="Записи словаря">
          <div class="dict-row head"><span>Тип</span><span>Как встречается в тексте</span><span class="arrow"></span><span>Как сохраняется в каталоге</span><span></span></div>
          ${list.length ? list.map((e) => `
            <div class="dict-row">
              <span class="dict-type">${TYPES[e.type].one}</span>
              <span class="variants">${(e.variants || []).length ? e.variants.map((v) => `<span class="variant">${esc(v)}</span>`).join('') : '<span class="muted" style="font-size:13px">только каноническая форма</span>'}</span>
              <span class="arrow muted">${icons.icon('arrow')}</span>
              <span>${canonicalCell(e)}</span>
              <span class="row-actions">
                <button class="icon-btn" data-act="dict-edit" data-id="${e.id}" aria-label="Изменить запись ${esc(e.canonical)}" title="Изменить">${icons.icon('edit')}</button>
                <button class="icon-btn" data-act="dict-delete" data-id="${e.id}" aria-label="Удалить запись ${esc(e.canonical)}" title="Удалить">${icons.icon('trash')}</button>
              </span>
            </div>`).join('') : `<div class="empty"><h3>Ничего не найдено</h3><p>Измените запрос или тип словаря.</p><button class="btn" data-act="dict-clear">Сбросить</button></div>`}
        </section>
        <section class="panel panel-pad sticky" aria-label="Проверка на примере">
          <h2 style="font-size:16px">Проверить на примере</h2>
          <p class="muted" style="margin:4px 0 10px;font-size:13.5px">Вставьте фрагмент описания — увидите, что словари в нём распознают.</p>
          <textarea id="dict-preview" class="textarea" style="min-height:110px" data-input="dict-preview" aria-label="Пример текста">${esc(f.preview || '')}</textarea>
          <div class="preview-out">
            <p class="source-text" style="margin:0 0 10px">${p.html || '<span class="muted">Пусто</span>'}</p>
            ${p.hits.length ? p.hits.map((h) => `
              <div class="preview-hit"><span class="from">${esc(h.from)}<span class="kind">${TYPES[h.type].one}</span></span><span class="muted">${icons.icon('arrow')}</span><b>${esc(h.to)}</b></div>`).join('')
              : '<p class="muted">Совпадений нет. Добавьте запись — и она сразу появится здесь.</p>'}
          </div>
        </section>
      </div>
    </div>`;
  }

  // --- Окно записи -----------------------------------------------------------------------------------

  function openEditor(entry) {
    const t = A.app.temp;
    t.dictEdit = entry
      ? { id: entry.id, type: entry.type, canonical: entry.canonical, variants: (entry.variants || []).join(', '), note: entry.note || '', dim: entry.meta && entry.meta.dim, factor: entry.meta && entry.meta.factor, attr: entry.meta && entry.meta.attr, error: '' }
      : { id: null, type: store.state.ui.dict.type === 'all' ? 'color' : store.state.ui.dict.type, canonical: '', variants: '', note: '', dim: 'volume', factor: 1, attr: 'color', error: '' };
    A.app.modal({
      title: entry ? 'Изменить запись словаря' : 'Новая запись словаря',
      body: editorBody,
      buttons: [{ label: 'Отмена', act: 'modal-close' }, { label: 'Сохранить', act: 'dict-save', cls: 'btn-primary' }],
    });
  }

  function editorBody() {
    const d = A.app.temp.dictEdit;
    return `<div class="form-grid">
      <label><span class="field-label">Тип</span>
        <select class="select" data-change="dict-field" data-field="type" ${d.id ? 'disabled' : ''}>${Object.entries(TYPES).map(([t, v]) => `<option value="${t}" ${d.type === t ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <label><span class="field-label">Как встречается в тексте</span>
        <input class="input" data-input="dict-field" data-field="variants" value="${esc(d.variants)}" placeholder="Например: Midnight, midnight black">
        <span class="field-hint">Несколько вариантов — через запятую. Регистр и «ё» не важны.</span></label>
      <label><span class="field-label">Как сохраняется в каталоге</span>
        ${d.type === 'synonym'
          ? `<select class="select" data-change="dict-field" data-field="attr">${Object.entries(schema.ATTRS).map(([id, a]) => `<option value="${id}" ${d.attr === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`
          : `<input class="input ${d.error && !d.canonical ? 'is-error' : ''}" data-input="dict-field" data-field="canonical" value="${esc(d.canonical)}" placeholder="Например: черный">`}</label>
      ${d.type === 'unit' ? `
        <div class="mapping" style="grid-template-columns:1fr 1fr;margin:0">
          <label><span class="field-label">Величина</span><select class="select" data-change="dict-field" data-field="dim">${Object.entries(dictionaries.DIMENSIONS).map(([k, v]) => `<option value="${k}" ${d.dim === k ? 'selected' : ''}>${v.name} (${v.base})</option>`).join('')}</select></label>
          <label><span class="field-label">Множитель к «${esc((dictionaries.DIMENSIONS[d.dim] || {}).base || '')}»</span><input class="input" data-input="dict-field" data-field="factor" value="${esc(d.factor)}" inputmode="decimal"></label>
        </div>` : ''}
      <label><span class="field-label">Примечание</span><input class="input" data-input="dict-field" data-field="note" value="${esc(d.note)}" placeholder="Необязательно"></label>
      ${d.error ? `<div class="field-error" role="alert">${icons.glyph('conflict', 14)} ${esc(d.error)}</div>` : ''}
    </div>`;
  }

  function saveEditor() {
    const d = A.app.temp.dictEdit;
    const variants = d.variants.split(',').map((v) => v.trim()).filter(Boolean);
    const canonical = d.type === 'synonym' ? schema.attr(d.attr).name : d.canonical.trim();
    if (!canonical) {
      d.error = 'Укажите, как значение сохраняется в каталоге.';
      A.app.refreshModal();
      return;
    }
    const factor = parseFloat(String(d.factor).replace(',', '.'));
    if (d.type === 'unit' && !(factor > 0)) {
      d.error = 'Множитель должен быть положительным числом, например 0,001 для «мл → л».';
      A.app.refreshModal();
      return;
    }
    // один и тот же вариант не может вести к двум разным значениям
    const others = store.state.dict.filter((e) => e.type === d.type && e.id !== d.id);
    for (const v of [canonical, ...variants]) {
      const clash = others.find((e) => [e.canonical, ...(e.variants || [])].some((x) => util.fold(x) === util.fold(v)) && util.fold(e.canonical) !== util.fold(canonical));
      if (clash && d.type !== 'synonym') {
        d.error = `«${v}» уже есть в записи «${clash.canonical}». Уберите вариант оттуда или отредактируйте ту запись.`;
        A.app.refreshModal();
        return;
      }
    }
    const meta = d.type === 'unit' ? { dim: d.dim, factor } : d.type === 'synonym' ? { attr: d.attr } : undefined;
    store.saveEntry({ id: d.id, type: d.type, canonical, variants, note: d.note.trim(), ...(meta ? { meta } : {}) });
    A.app.closeModal();
    A.app.toast(d.id ? `Запись «${canonical}» обновлена` : `Добавлено: ${variants.length ? `${variants.join(', ')} → ` : ''}${canonical}`, { undo: true });
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'dict-type': (el) => store.setUi({ dict: { ...store.state.ui.dict, type: el.dataset.type } }),
      'dict-clear': () => store.setUi({ dict: { ...store.state.ui.dict, type: 'all', q: '' } }),
      'dict-add': () => openEditor(null),
      'dict-edit': (el) => openEditor(store.state.dict.find((e) => e.id === el.dataset.id)),
      'dict-delete': (el) => {
        const e = store.state.dict.find((x) => x.id === el.dataset.id);
        store.deleteEntry(el.dataset.id);
        A.app.toast(`Запись «${e.canonical}» удалена`, { undo: true });
      },
      'dict-save': saveEditor,
      'dict-apply': () => {
        const n = store.reprocessAll();
        A.app.toast(`Характеристики извлечены заново в ${util.count(n, ['карточке', 'карточках', 'карточках'])}; решения людей сохранены`, { undo: true });
      },
    },
    inputs: {
      'dict-search': (el) => store.setUi({ dict: { ...store.state.ui.dict, q: el.value } }),
      'dict-preview': (el) => store.setUi({ dict: { ...store.state.ui.dict, preview: el.value } }),
      'dict-field': (el) => {
        A.app.temp.dictEdit[el.dataset.field] = el.value;
        A.app.temp.dictEdit.error = '';
      },
    },
    changes: {
      'dict-field': (el) => {
        A.app.temp.dictEdit[el.dataset.field] = el.value;
        A.app.temp.dictEdit.error = '';
        A.app.refreshModal();
      },
    },
  });

  A.views.dictionaries = { render, title: () => 'Словари' };
})();
