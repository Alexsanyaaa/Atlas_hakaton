/* Добавление товаров — три равноправных способа:
   А. Импорт CSV/JSON: файл -> предпросмотр -> сопоставление колонок -> проверка -> импорт.
   Б. Файл TXT: обычное описание товара -> правка -> черновик карточки.
   В. Вставка текста: то же без файла.
   Для TXT и текста ничего заранее не требуется: категория, название и характеристики предлагаются из текста. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store, extractor, seed } = A;
  const { esc } = util;
  A.views = A.views || {};

  const MODES = {
    import: { title: 'Импорт CSV / JSON', hint: 'Много товаров из таблицы или выгрузки', icon: 'table' },
    txt: { title: 'Файл TXT', hint: 'Описание одного товара обычным текстом', icon: 'file' },
    text: { title: 'Вставить текст', hint: 'Скопированное описание — без файла и подготовки', icon: 'text' },
  };
  const TARGETS = {
    title: { label: 'Название', required: true, names: ['название', 'наименование', 'title', 'name', 'товар', 'product_name'] },
    sku: { label: 'SKU', required: true, names: ['sku', 'артикул', 'код', 'id', 'product_id', 'sku_id', 'код товара'] },
    description: { label: 'Описание', required: false, names: ['описание', 'description', 'desc', 'текст', 'text'] },
    category: { label: 'Категория', required: false, names: ['категория', 'category', 'раздел', 'category_name', 'группа'] },
  };
  const MAX_IMPORT = 5 * 1024 * 1024;
  const MAX_TXT = 300 * 1024;

  const st = () => {
    const t = A.app.temp;
    t.add = t.add || {
      mode: 'import',
      import: { step: 'pick' },
      txt: { step: 'pick' },
      text: { step: 'edit', text: '' },
    };
    return t.add;
  };

  // --- Разбор файлов --------------------------------------------------------------------------

  function parseCsv(text) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delimiter = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const clean = rows.filter((r) => r.some((c) => c.trim()));
    if (!clean.length) throw new Error('Файл пустой.');
    const headers = clean[0].map((h, i) => h.trim() || `Колонка ${i + 1}`);
    if (headers.length < 2) throw new Error('Не удалось разделить строки на колонки. Используйте разделитель «;» или «,».');
    const data = clean.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
    if (!data.length) throw new Error('В файле есть только строка заголовков — товаров нет.');
    return { headers, rows: data, delimiter };
  }

  function parseJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Это не корректный JSON: ${e.message}.`);
    }
    if (!Array.isArray(data)) data = data && (data.items || data.products || data.data);
    if (!Array.isArray(data)) throw new Error('В JSON ожидается список товаров: [{"sku": …, "title": …}, …] или {"items": […]}.');
    const rows = data.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (!rows.length) throw new Error('Список товаров пуст.');
    const headers = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))];
    return { headers, rows: rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] == null ? '' : typeof r[h] === 'object' ? JSON.stringify(r[h]) : String(r[h]).trim()]))) };
  }

  function guessMapping(headers) {
    const mapping = {};
    for (const [target, spec] of Object.entries(TARGETS)) {
      const found = headers.find((h) => spec.names.includes(util.fold(h)));
      mapping[target] = found || '';
    }
    return mapping;
  }

  function categoryFromText(value) {
    const v = util.fold(value);
    if (!v) return null;
    const direct = schema.CATEGORIES.find((c) => [c.id, c.name, c.noun].some((x) => util.fold(x) === v));
    if (direct) return direct.id;
    const guess = extractor.detectCategory(value);
    return guess ? guess.id : null;
  }

  /** Проверка строк: обязательные поля, повторы SKU, SKU уже в каталоге, нераспознанная категория. */
  function validate(imp) {
    const m = imp.mapping;
    const existing = new Set(store.state.cards.map((c) => c.sku));
    const seen = new Map();
    return imp.rows.map((r, i) => {
      const title = m.title ? r[m.title] : '';
      const sku = m.sku ? r[m.sku] : '';
      const errors = [];
      const warnings = [];
      if (!title) errors.push('нет названия');
      if (!sku) errors.push('нет SKU');
      else if (seen.has(sku)) errors.push(`SKU повторяет строку ${seen.get(sku) + 2}`);
      else if (existing.has(sku)) errors.push('такой SKU уже есть в каталоге');
      if (sku && !seen.has(sku)) seen.set(sku, i);
      const rawCategory = m.category ? r[m.category] : '';
      let category = categoryFromText(rawCategory);
      if (rawCategory && !category) warnings.push(`категория «${rawCategory}» не распознана — определим по тексту`);
      if (!category && title) {
        const g = extractor.detectCategory(title, m.description ? r[m.description] : '');
        category = g ? g.id : null;
        if (!g) warnings.push('категорию не удалось определить — выберите её в карточке');
      }
      return { index: i, title, sku, description: m.description ? r[m.description] : '', category, errors, warnings };
    });
  }

  function readFile(file, onText, onError) {
    const reader = new FileReader();
    reader.onerror = () => onError('Не удалось прочитать файл. Попробуйте выбрать его ещё раз.');
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      try {
        onText(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), 'UTF-8');
      } catch (e) {
        // файлы из Блокнота Windows часто в кодировке Windows-1251
        onText(new TextDecoder('windows-1251').decode(bytes), 'Windows-1251 (перекодировано)');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // --- Черновик карточки из текста ------------------------------------------------------------------

  function makeDraft(raw, source, categoryOverride) {
    const input = extractor.splitText(raw);
    const guess = extractor.detectCategory(input.title, input.description);
    const category = categoryOverride || (guess && guess.id) || '';
    const found = category ? extractor.extract({ ...input, seller: [] }, category, store.state.dict) : {};
    const values = {};
    for (const [attr, candidates] of Object.entries(found)) {
      const a = extractor.assess(attr, { candidates, decision: null });
      const best = a.kind === 'complete' ? a.suggestion : a.kind === 'reject' ? a.next || null : a.proposal || null;
      // в черновике значение показываем с единицей («1 800 Вт») — так его можно поправить одной строкой
      const shown = best ? best.display.replace(/ /g, ' ') : '';
      values[attr] = { initial: shown, value: shown, kind: a.kind, candidates, best };
    }
    const titleTooLong = input.title.length > 110;
    return {
      source, raw, input, guess, category,
      title: titleTooLong ? input.title.slice(0, 110).replace(/\s+\S*$/, '') : input.title,
      titleReason: titleTooLong ? 'Первая строка текста, сокращённая до 110 символов' : 'Первая строка текста',
      values,
    };
  }

  function draftStats(d) {
    const attrs = Object.keys(d.values);
    const found = attrs.filter((a) => d.values[a].best);
    return { total: attrs.length, found: found.length, missing: attrs.filter((a) => !d.values[a].best) };
  }

  // --- Отрисовка ---------------------------------------------------------------------------------------

  function steps(list, current) {
    const i = list.indexOf(current);
    return `<ol class="steps">${list.map((s, k) => `<li class="${k < i ? 'is-done' : k === i ? 'is-current' : ''}"><span class="n">${k < i ? '✓' : k + 1}</span>${s}</li>`).join('')}</ol>`;
  }

  function alert(tone, glyph, title, text) {
    return `<div class="alert t-${tone}" role="${tone === 'bad' ? 'alert' : 'status'}"><span>${icons.glyph(glyph)}</span><div><strong>${title}</strong>${text ? `<p>${text}</p>` : ''}</div></div>`;
  }

  function dropZone(id, accept, title, hint, error, loading) {
    return `
      <div class="drop ${error ? 'is-error' : ''}" data-drop="${id}-drop">
        <span class="drop-ico">${icons.icon('upload', 32)}</span>
        <strong>${loading ? 'Читаем файл…' : title}</strong>
        <span class="drop-hint">${hint}</span>
        <label class="btn btn-primary" ${loading ? 'aria-disabled="true"' : ''}>${icons.icon('file')} Выбрать файл
          <input type="file" accept="${accept}" data-change="${id}-file" class="sr-only"></label>
      </div>`;
  }

  function renderImport() {
    const imp = st().import;
    const flow = ['Файл', 'Колонки и проверка', 'Готово'];
    if (imp.step === 'pick') {
      return `${steps(flow, 'Файл')}
        ${dropZone('import', '.csv,.json,text/csv,application/json', 'Перетащите файл .csv или .json сюда', 'Нужны колонки с названием и SKU; описание и категория — по желанию. Кодировка UTF-8 или Windows-1251, разделитель «;» или «,». Пример файлов — в папке <span class="mono">atlas/samples</span>.', imp.error, imp.loading)}
        ${imp.error ? alert('bad', 'conflict', 'Файл не подходит', esc(imp.error)) : ''}`;
    }
    if (imp.step === 'map') {
      const rows = validate(imp);
      const ok = rows.filter((r) => !r.errors.length);
      const bad = rows.filter((r) => r.errors.length);
      const warn = ok.filter((r) => r.warnings.length);
      const missing = Object.entries(TARGETS).filter(([k, s]) => s.required && !imp.mapping[k]);
      const preview = rows.slice(0, 6);
      const mappedCols = Object.values(imp.mapping).filter(Boolean);
      return `${steps(flow, 'Колонки и проверка')}
        <p style="margin:0 0 14px">${icons.icon(imp.format === 'json' ? 'file' : 'table')} <b>${esc(imp.file.name)}</b> · ${util.count(imp.rows.length, ['строка', 'строки', 'строк'])} · ${util.count(imp.headers.length, ['колонка', 'колонки', 'колонок'])} · кодировка ${esc(imp.encoding)}
          <button class="link-btn" data-act="import-restart" style="margin-left:10px">Выбрать другой файл</button></p>
        <div class="section-title">Какая колонка что означает</div>
        <div class="mapping">
          ${Object.entries(TARGETS).map(([k, s]) => `
            <label><span class="field-label">${s.label}${s.required ? ' <span class="req" title="обязательно">*</span>' : ''}</span>
              <select class="select" data-change="import-map" data-target="${k}" aria-label="Колонка для поля ${s.label}">
                <option value="">— ${s.required ? 'выберите колонку' : 'нет в файле'} —</option>
                ${imp.headers.map((h) => `<option value="${esc(h)}" ${imp.mapping[k] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
              </select></label>`).join('')}
        </div>
        ${missing.length ? alert('bad', 'conflict', `Не выбрана обязательная колонка: ${missing.map(([, s]) => s.label).join(', ')}`, 'Без неё строки нельзя превратить в карточки.') : ''}
        <div class="section-title" style="margin-top:6px">Предпросмотр — первые ${preview.length} из ${rows.length}</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>#</th>${imp.headers.map((h) => `<th class="${mappedCols.includes(h) ? 'is-mapped' : ''}">${esc(h)}${mappedCols.includes(h) ? ` → ${Object.entries(imp.mapping).filter(([, v]) => v === h).map(([k]) => TARGETS[k].label).join(', ')}` : ''}</th>`).join('')}<th>Проверка</th></tr></thead>
          <tbody>${preview.map((r) => `<tr class="${r.errors.length ? 'row-bad' : ''}"><td>${r.index + 2}</td>${imp.headers.map((h) => `<td class="${mappedCols.includes(h) ? 'is-mapped' : ''}"><span class="cell-clip" title="${esc(imp.rows[r.index][h])}">${esc(imp.rows[r.index][h]) || '<span class="muted">—</span>'}</span></td>`).join('')}
            <td class="${r.errors.length ? 'cell-error' : ''}">${r.errors.length ? `${icons.glyph('rejected', 14)} ${esc(r.errors.join(', '))}` : r.warnings.length ? `<span class="t-warn">${icons.glyph('pending', 14)}</span> ${esc(r.warnings[0])}` : `<span class="t-ok">${icons.glyph('auto', 14)}</span> ${r.category ? esc(schema.category(r.category).name) : ''}`}</td></tr>`).join('')}</tbody>
        </table></div>
        ${!missing.length ? `
          ${bad.length ? alert('warn', 'pending', `${util.count(bad.length, ['строка будет пропущена', 'строки будут пропущены', 'строк будут пропущены'])}`, `<ul>${bad.slice(0, 6).map((r) => `<li>Строка ${r.index + 2}: ${esc(r.errors.join(', '))}</li>`).join('')}${bad.length > 6 ? `<li>…и ещё ${bad.length - 6}</li>` : ''}</ul>`) : ''}
          ${warn.length ? alert('info', 'pending', `${util.count(warn.length, ['строка требует внимания', 'строки требуют внимания', 'строк требуют внимания'])} после импорта`, `<ul>${warn.slice(0, 4).map((r) => `<li>Строка ${r.index + 2}: ${esc(r.warnings.join('; '))}</li>`).join('')}</ul>`) : ''}` : ''}
        <div class="form-foot">
          <button class="btn" data-act="import-restart">${icons.icon('back')} Назад</button>
          <button class="btn btn-primary btn-lg" data-act="import-confirm" ${missing.length || !ok.length ? 'disabled' : ''}>${icons.icon('check')} Импортировать ${util.count(ok.length, ['товар', 'товара', 'товаров'])}</button>
        </div>`;
    }
    const r = imp.result;
    return `${steps(flow, 'Готово')}
      ${alert('ok', 'ready', `Добавлено ${util.count(r.ids.length, ['товар', 'товара', 'товаров'])} со статусом «Новое поступление»`, `${r.skipped ? `Пропущено строк с ошибками: ${r.skipped}. ` : ''}Теперь запустите обработку — система извлечёт характеристики и подготовит предложения.`)}
      <div class="actions">
        <button class="btn btn-primary" data-act="import-process" ${r.processable ? '' : 'disabled'}>${icons.icon('refresh')} Обработать ${r.processable ? util.count(r.processable, ['карточку', 'карточки', 'карточек']) : ''}</button>
        <button class="btn" data-act="import-show">Показать в каталоге</button>
        <button class="btn btn-ghost" data-act="import-restart">Импортировать ещё файл</button>
      </div>
      ${r.processable < r.ids.length ? `<p class="field-hint">${r.ids.length - r.processable} без категории — выберите её в карточке, затем обработайте.</p>` : ''}`;
  }

  function processingView(s) {
    const labels = ['Определяем категорию', 'Ищем бренд и модель', 'Извлекаем характеристики', 'Сверяем со словарями'];
    return `<div class="panel panel-pad" aria-live="polite"><strong>Формируем карточку…</strong>
      <ul class="processing-steps">${labels.map((l, i) => `<li class="${i < s.progress ? 'is-done' : i === s.progress ? 'is-now' : ''}">${i < s.progress ? `<span class="t-ok">${icons.glyph('auto')}</span>` : i === s.progress ? icons.glyph('processing') : icons.glyph('nodata')} ${l}</li>`).join('')}</ul></div>`;
  }

  function draftMarked(d) {
    // подчёркиваем в тексте найденные значения
    const text = d.raw;
    const offset = text.indexOf(d.input.title);
    const descStart = d.input.description ? text.indexOf(d.input.description, offset + d.input.title.length) : -1;
    const spans = [];
    for (const v of Object.values(d.values)) {
      for (const c of v.candidates) {
        for (const e of c.evidences) {
          const base = e.field === 'title' ? offset : descStart;
          if (base >= 0) spans.push([base + e.start, base + e.end]);
        }
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let html = '';
    let pos = 0;
    for (const [a, b] of spans) {
      if (a < pos) continue;
      html += esc(text.slice(pos, a)) + `<span class="ev is-on">${esc(text.slice(a, b))}</span>`;
      pos = b;
    }
    return html + esc(text.slice(pos));
  }

  function draftView(s) {
    const d = s.draft;
    const stats = draftStats(d);
    const unknown = !d.category;
    return `
      <div class="draft">
        <section class="panel">
          <div class="col-title"><h2>Исходный текст</h2><button class="link-btn" data-act="draft-back">Изменить текст</button></div>
          <div class="source-block"><p class="source-text">${draftMarked(d)}</p></div>
        </section>
        <section class="panel panel-pad">
          <h2 style="font-size:16px;margin-bottom:12px">Черновик карточки</h2>
          <div class="form-grid">
            <label><span class="field-label">Название</span>
              <input id="draft-title" class="input ${d.title ? '' : 'is-error'}" value="${esc(d.title)}" data-input="draft-title">
              <span class="field-hint">${d.title ? esc(d.titleReason) : 'Введите название — без него карточку не создать'}</span></label>
            <label><span class="field-label">Категория</span>
              <select class="select ${unknown ? 'is-error' : ''}" data-change="draft-category">
                <option value="" ${unknown ? 'selected' : ''}>— выберите категорию —</option>
                ${schema.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === d.category ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
              <span class="field-hint">${d.guess && d.guess.id === d.category ? `Определена ${esc(d.guess.reason)}` : d.category ? 'Выбрана вручную' : ''}</span></label>
          </div>
          ${unknown ? alert('warn', 'nodata', 'Категорию определить не удалось', 'В тексте нет слов, по которым понятно, что это за товар. Выберите категорию — тогда система поймёт, какие характеристики искать.') : stats.found === stats.total
            ? alert('ok', 'ready', `Найдены все ${stats.total} характеристик`, 'Проверьте значения и создайте карточку.')
            : alert('info', 'pending', `Найдено ${stats.found} из ${stats.total} характеристик — частичный результат`, `Не найдено в тексте: ${esc(stats.missing.map((a) => schema.attr(a).name.toLowerCase()).join(', '))}. Их можно заполнить сейчас или позже на проверке. Подставлять значения «по аналогии» система не будет.`)}
          ${unknown ? '' : `
          <table class="draft-fields">
            ${Object.entries(d.values).map(([attr, v]) => {
              const spec = schema.attr(attr);
              const e = v.best && v.best.evidences[0];
              const note = !v.best ? '<span class="src">не найдено в тексте</span>'
                : v.kind === 'conflict' ? `<span class="src t-bad">${icons.glyph('conflict', 12)} в тексте есть и другие значения — проверьте</span>`
                  : `<span class="src">из текста: «${esc(e.quote)}»</span>`;
              return `<tr><td class="fname">${esc(spec.name)}</td><td>
                <input class="input" id="draft-${attr}" value="${esc(v.value)}" placeholder="${v.best ? '' : 'не указано'}" data-input="draft-value" data-attr="${attr}" aria-label="${esc(spec.name)}">
                ${note}</td></tr>`;
            }).join('')}
          </table>`}
          <div class="form-foot">
            <button class="btn" data-act="draft-back">${icons.icon('back')} Изменить текст</button>
            <button class="btn btn-primary btn-lg" data-act="draft-create" ${d.title && d.category ? '' : 'disabled'}>${icons.icon('check')} Создать карточку</button>
          </div>
        </section>
      </div>`;
  }

  function createdView(s) {
    const card = store.card(s.createdId);
    if (!card) return alert('warn', 'nodata', 'Карточка была удалена', '');
    const p = store.cardProgress(card);
    const m = store.metrics([card]);
    return `${alert('ok', 'ready', `Карточка создана: ${esc(card.title)}`, `Принято автоматически: ${m.auto} · исправлено вами в черновике: ${m.corrected} · ждут решения: ${m.waiting}. Решено ${p.resolved} из ${p.total} полей.`)}
      <div class="actions">
        <a class="btn btn-primary" href="#/card/${card.id}">${icons.icon('arrow')} Открыть проверку</a>
        <button class="btn" data-act="text-again">Создать ещё одну</button>
      </div>`;
  }

  function renderTxt() {
    const s = st().txt;
    const flow = ['Файл', 'Текст', 'Черновик', 'Готово'];
    if (s.step === 'pick') {
      return `${steps(flow, 'Файл')}
        ${dropZone('txt', '.txt,text/plain', 'Перетащите файл .txt с описанием товара', 'Подойдёт обычный текст: название в первой строке, дальше — описание в свободной форме. Бренд, модель и категорию указывать заранее не нужно.', s.error, s.loading)}
        ${s.error ? alert('bad', 'conflict', 'Файл не подходит', esc(s.error)) : ''}`;
    }
    if (s.step === 'edit') return `${steps(flow, 'Текст')}${textEditor('txt', s)}`;
    if (s.step === 'processing') return `${steps(flow, 'Черновик')}${processingView(s)}`;
    if (s.step === 'draft') return `${steps(flow, 'Черновик')}${draftView(s)}`;
    return `${steps(flow, 'Готово')}${createdView(s)}`;
  }

  function textEditor(kind, s) {
    const len = (s.text || '').trim().length;
    return `
      <div class="panel panel-pad">
        ${kind === 'txt' ? `<p style="margin:0 0 12px">${icons.icon('file')} <b>${esc(s.file.name)}</b> · ${esc(s.file.encoding)} <button class="link-btn" data-act="txt-restart" style="margin-left:10px">Выбрать другой файл</button></p>` : ''}
        <label class="field-label" for="${kind}-text">${kind === 'txt' ? 'Содержимое файла — можно исправить перед формированием' : 'Описание товара'}</label>
        <textarea id="${kind}-text" class="textarea ${s.error ? 'is-error' : ''}" data-input="${kind}-text" placeholder="${kind === 'text' ? 'Вставьте текст как есть, например:\nЧайник электрический Tefal KO6931\nОбъём 1,5 л, мощность 1800 Вт, корпус из нержавеющей стали…' : ''}">${esc(s.text || '')}</textarea>
        <div class="form-foot" style="margin-top:10px">
          <div class="examples">${kind === 'text' ? `Примеры: ${seed.textExamples.map((ex, i) => `<button class="btn btn-sm" data-act="text-example" data-i="${i}">${esc(ex.label)}</button>`).join('')}` : ''}
            <span class="char-count">${util.count(len, ['символ', 'символа', 'символов'])}</span></div>
          <button class="btn btn-primary btn-lg" data-act="${kind}-run" ${len ? '' : 'disabled'}>${icons.icon('spark')} Сформировать карточку</button>
        </div>
        ${!len ? '<span class="field-hint">Поле пустое — вставьте описание, чтобы продолжить.</span>' : ''}
        ${s.error ? alert('bad', 'conflict', 'Не получилось сформировать карточку', esc(s.error)) : ''}
      </div>`;
  }

  function renderText() {
    const s = st().text;
    const flow = ['Текст', 'Черновик', 'Готово'];
    if (s.step === 'edit') return `${steps(flow, 'Текст')}${textEditor('text', s)}`;
    if (s.step === 'processing') return `${steps(flow, 'Черновик')}${processingView(s)}`;
    if (s.step === 'draft') return `${steps(flow, 'Черновик')}${draftView(s)}`;
    return `${steps(flow, 'Готово')}${createdView(s)}`;
  }

  function render(route) {
    const s = st();
    if (route.query.mode && MODES[route.query.mode]) s.mode = route.query.mode;
    return `
    <div class="page">
      <div class="page-head"><div><h1>Добавить товары</h1>
        <p class="sub">Три способа — выберите тот, в котором у вас данные. Результат одинаковый: карточка с характеристиками и цитатами на проверку.</p></div></div>
      <div class="panel modes" role="tablist" aria-label="Способ добавления">
        ${Object.entries(MODES).map(([id, m]) => `
          <button class="mode ${s.mode === id ? 'is-active' : ''}" role="tab" aria-selected="${s.mode === id}" data-act="add-mode" data-mode="${id}">
            <span class="mode-ico">${icons.icon(m.icon, 18)}</span><span><strong>${m.title}</strong><small>${m.hint}</small></span></button>`).join('')}
      </div>
      ${s.mode === 'import' ? renderImport() : s.mode === 'txt' ? renderTxt() : renderText()}
    </div>`;
  }

  // --- Действия ------------------------------------------------------------------------------------------

  function handleImportFile(file) {
    const imp = st().import;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'json'].includes(ext)) {
      Object.assign(imp, { error: `Файл «${file.name}» не поддерживается. Нужен .csv или .json — например, таблица, сохранённая как CSV.`, loading: false });
      A.app.render();
      return;
    }
    if (file.size > MAX_IMPORT) {
      Object.assign(imp, { error: 'Файл больше 5 МБ. Разбейте его на части.', loading: false });
      A.app.render();
      return;
    }
    Object.assign(imp, { error: '', loading: true });
    A.app.render();
    readFile(file, (text, encoding) => {
      setTimeout(() => {
        try {
          const parsed = ext === 'json' ? parseJson(text) : parseCsv(text);
          Object.assign(imp, { step: 'map', loading: false, error: '', file: { name: file.name }, encoding, format: ext, headers: parsed.headers, rows: parsed.rows, mapping: guessMapping(parsed.headers) });
        } catch (e) {
          Object.assign(imp, { loading: false, error: e.message });
        }
        A.app.render();
      }, 350);
    }, (message) => {
      Object.assign(imp, { loading: false, error: message });
      A.app.render();
    });
  }

  function handleTxtFile(file) {
    const s = st().txt;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'txt') {
      Object.assign(s, { error: `Файл «${file.name}» не подходит: нужен обычный текст .txt. Для таблиц используйте «Импорт CSV / JSON».`, loading: false });
      A.app.render();
      return;
    }
    if (file.size > MAX_TXT) {
      Object.assign(s, { error: 'Файл слишком большой для описания одного товара (больше 300 КБ).', loading: false });
      A.app.render();
      return;
    }
    Object.assign(s, { error: '', loading: true });
    A.app.render();
    readFile(file, (text, encoding) => {
      setTimeout(() => {
        if (!text.trim()) Object.assign(s, { loading: false, error: 'Файл пустой — в нём нет текста.' });
        else Object.assign(s, { step: 'edit', loading: false, error: '', file: { name: file.name, encoding: `кодировка ${encoding}` }, text });
        A.app.render();
      }, 350);
    }, (message) => {
      Object.assign(s, { loading: false, error: message });
      A.app.render();
    });
  }

  function runDraft(kind) {
    const s = st()[kind];
    const text = (s.text || '').trim();
    if (!text) return;
    if (text.length < 8 || !/\p{L}{2,}/u.test(text)) {
      s.error = 'Слишком мало текста: нужно хотя бы название товара (например, «Чайник Tefal KO6931»).';
      A.app.render();
      return;
    }
    s.error = '';
    s.step = 'processing';
    s.progress = 0;
    A.app.render();
    const tick = () => {
      if (s.step !== 'processing') return;
      s.progress += 1;
      if (s.progress >= 4) {
        s.draft = makeDraft(s.text, kind === 'txt' ? 'txt' : 'text');
        s.step = 'draft';
      }
      A.app.render();
      if (s.step === 'processing') setTimeout(tick, 280);
    };
    setTimeout(tick, 280);
  }

  /** Набор текста: без полной перерисовки, чтобы не сбивать прокрутку длинного описания. */
  function typed(kind, el) {
    const s = st()[kind];
    const hadError = Boolean(s.error);
    s.text = el.value;
    s.error = '';
    if (hadError) {
      A.app.render();
      return;
    }
    const len = el.value.trim().length;
    const button = document.querySelector(`[data-act="${kind}-run"]`);
    if (button) button.disabled = !len;
    const counter = document.querySelector('.char-count');
    if (counter) counter.textContent = util.count(len, ['символ', 'символа', 'символов']);
  }

  function currentFlow() {
    const s = st();
    return s.mode === 'txt' ? s.txt : s.text;
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'add-mode': (el) => {
        st().mode = el.dataset.mode;
        history.replaceState(null, '', `#/add?mode=${el.dataset.mode}`);
        A.app.render();
      },
      'import-drop': (el, e, file) => handleImportFile(file),
      'txt-drop': (el, e, file) => handleTxtFile(file),
      'import-restart': () => {
        st().import = { step: 'pick' };
        A.app.render();
      },
      'import-confirm': () => {
        const imp = st().import;
        const rows = validate(imp);
        const ok = rows.filter((r) => !r.errors.length);
        const created = store.importRows(ok.map((r) => ({ sku: r.sku, title: r.title, description: r.description, category: r.category })), 'import');
        imp.step = 'done';
        imp.result = { ids: created.map((c) => c.id), skipped: rows.length - ok.length, processable: created.filter((c) => c.category).length };
        A.app.temp.freshIds = imp.result.ids;
        A.app.render();
      },
      'import-process': () => {
        const imp = st().import;
        const ids = imp.result.ids.filter((id) => store.card(id) && store.card(id).category);
        store.process(ids, (n) => A.app.toast(`Обработано: ${util.count(n, ['карточка', 'карточки', 'карточек'])}`));
        A.app.temp.freshIds = ids;
        store.setCatalog({ statuses: [], categories: [], q: '', problemsOnly: false, sort: 'newest' });
        A.app.go('#/catalog');
      },
      'import-show': () => {
        store.setCatalog({ statuses: ['new'], categories: [], q: '', problemsOnly: false, sort: 'newest' });
        A.app.go('#/catalog');
      },
      'txt-restart': () => {
        st().txt = { step: 'pick' };
        A.app.render();
      },
      'txt-run': () => runDraft('txt'),
      'text-run': () => runDraft('text'),
      'text-example': (el) => {
        const s = st().text;
        s.text = seed.textExamples[Number(el.dataset.i)].text;
        s.error = '';
        A.app.render();
      },
      'draft-back': () => {
        const s = currentFlow();
        s.step = 'edit';
        A.app.render();
      },
      'draft-create': () => {
        const s = currentFlow();
        const d = s.draft;
        if (!d.title || !d.category) return;
        const edits = {};
        for (const [attr, v] of Object.entries(d.values)) {
          const value = v.value.trim();
          if (value === v.initial) continue;
          if (!value && v.best) edits[attr] = { reject: true };
          else if (value) edits[attr] = { text: value };
        }
        const card = store.createFromDraft({ title: d.title, category: d.category, source: d.source, guess: d.guess, input: { ...d.input, seller: [] }, edits });
        s.step = 'done';
        s.createdId = card.id;
        A.app.render();
      },
      'text-again': () => {
        const s = st();
        if (s.mode === 'txt') s.txt = { step: 'pick' };
        else s.text = { step: 'edit', text: '' };
        A.app.render();
      },
    },
    inputs: {
      'txt-text': (el) => typed('txt', el),
      'text-text': (el) => typed('text', el),
      'draft-title': (el) => {
        currentFlow().draft.title = el.value;
        A.app.render();
      },
      'draft-value': (el) => {
        currentFlow().draft.values[el.dataset.attr].value = el.value;
      },
    },
    changes: {
      'import-file': (el) => {
        if (el.files[0]) handleImportFile(el.files[0]);
        el.value = '';
      },
      'txt-file': (el) => {
        if (el.files[0]) handleTxtFile(el.files[0]);
        el.value = '';
      },
      'import-map': (el) => {
        st().import.mapping[el.dataset.target] = el.value;
        A.app.render();
      },
      'draft-category': (el) => {
        const s = currentFlow();
        const keepTitle = s.draft.title;
        s.draft = makeDraft(s.draft.raw, s.draft.source, el.value || null);
        s.draft.title = keepTitle;
        if (!el.value) s.draft.category = '';
        A.app.render();
      },
    },
  });

  A.views.add = { render, title: () => 'Добавить товары', parseCsv, parseJson };
})();
