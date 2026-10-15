/* Проверка карточки — главный экран.
   Связь: исходный текст -> характеристика -> цитата -> рекомендация -> решение человека.
   Выбранная характеристика подсвечивает свои цитаты в тексте; панель справа показывает цитату крупно,
   объясняет рекомендацию и даёт действия: принять, исправить, отклонить предложение, подтвердить отсутствие. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store, extractor } = A;
  const { esc } = util;
  A.views = A.views || {};

  const SOURCE_NAMES = { seed: 'импорт CSV', import: 'импорт файла', text: 'вставленный текст', txt: 'файл TXT' };
  const CONTEXT = 70;

  // временное состояние экрана: редактирование, выбранный кандидат, номер источника
  const ui = () => {
    A.app.temp.review = A.app.temp.review || { pick: {}, src: {}, editing: null, editError: '', editTitle: false, changed: null };
    return A.app.temp.review;
  };

  function currentCard(route) {
    return store.card(route.id);
  }

  function attrsOf(card) {
    const category = schema.category(card.category);
    return category ? category.attrs.filter((a) => card.fields[a]) : [];
  }

  function openAttrs(card) {
    return attrsOf(card).filter((a) => !schema.FIELD_STATES[store.fieldState(a, card.fields[a])].resolved);
  }

  function activeAttr(card, route) {
    const attrs = attrsOf(card);
    const wanted = route.query.f || store.state.ui.activeField[card.id];
    if (wanted && attrs.includes(wanted)) return wanted;
    return openAttrs(card)[0] || attrs[0] || null;
  }

  function fieldText(card, key) {
    if (key === 'title') return card.input.title;
    if (key === 'description') return card.input.description;
    const i = Number(key.split(':')[1]);
    return card.input.seller[i] ? String(card.input.seller[i].value) : '';
  }

  /** Кандидат, который сейчас показан в панели: выбранный вручную, иначе предложение системы. */
  function shownCandidate(card, attr) {
    const field = card.fields[attr];
    const picked = ui().pick[`${card.id}|${attr}`];
    const active = field.candidates.filter((c) => !c.rejected);
    if (picked) {
      const c = active.find((x) => x.id === picked);
      if (c) return c;
    }
    if (field.decision && field.decision.candidateId) {
      const c = field.candidates.find((x) => x.id === field.decision.candidateId);
      if (c) return c;
    }
    const a = extractor.assess(attr, field);
    if (a.kind === 'complete') return a.suggestion;
    return a.proposal || null;
  }

  // --- Исходный текст с отметками ----------------------------------------------------------------

  function markText(card, key, active, shown) {
    const text = fieldText(card, key);
    if (!text) return '';
    const marks = [];
    for (const [attr, f] of Object.entries(card.fields)) {
      for (const c of f.candidates) {
        if (c.rejected) continue;
        c.evidences.forEach((e) => {
          if (e.field === key && e.end > e.start) marks.push({ start: e.start, end: e.end, attr });
        });
      }
    }
    // номера источников активной характеристики — те же, что в панели «Источник 1 из N»
    const numbered = shown ? shown.evidences.map((e, i) => ({ ...e, n: i + 1 })).filter((e) => e.field === key) : [];
    const cuts = new Set([0, text.length]);
    marks.forEach((m) => { cuts.add(m.start); cuts.add(m.end); });
    const points = [...cuts].sort((a, b) => a - b);
    let html = '';
    for (let i = 0; i < points.length - 1; i += 1) {
      const [a, b] = [points[i], points[i + 1]];
      const covering = marks.filter((m) => m.start <= a && m.end >= b);
      const piece = esc(text.slice(a, b));
      if (!covering.length) {
        html += piece;
        continue;
      }
      const isOn = covering.some((m) => m.attr === active);
      const attr = isOn ? active : covering[0].attr;
      const names = [...new Set(covering.map((m) => schema.attr(m.attr).name))].join(', ');
      html += `<span class="ev ${isOn ? 'is-on' : ''}" data-act="pick-field" data-attr="${attr}" title="${esc(names)}">${piece}</span>`;
      for (const e of numbered) if (e.end === b && isOn) html += `<sup class="ev-n">${e.n}</sup>`;
    }
    return html;
  }

  function sourceColumn(card, active, shown) {
    const seller = card.input.seller || [];
    return `
    <section class="panel col-source" aria-label="Исходный текст">
      <div class="col-title"><h2>Исходный текст</h2><span class="muted" style="font-size:13px">подчёркнуто — найдено системой</span></div>
      <div class="source-block"><div class="source-label">Название</div>
        <p class="source-text source-title">${markText(card, 'title', active, shown)}</p></div>
      <div class="source-block"><div class="source-label">Описание</div>
        ${card.input.description ? `<p class="source-text">${markText(card, 'description', active, shown)}</p>` : '<p class="empty-source">Описания нет</p>'}</div>
      <div class="source-block"><div class="source-label">Параметры продавца</div>
        ${seller.length ? `<table class="params">${seller.map((p, i) => `<tr><td>${esc(p.name)}</td><td>${markText(card, `seller:${i}`, active, shown)}</td></tr>`).join('')}</table>` : '<p class="empty-source">Продавец параметров не передал</p>'}</div>
    </section>`;
  }

  // --- Список характеристик -----------------------------------------------------------------------

  function fieldValueText(attr, field, state) {
    const d = field.decision;
    if (d) return d.type === 'absent' ? { text: 'нет в тексте', cls: 'is-empty' } : { text: d.display, cls: '' };
    const a = extractor.assess(attr, field);
    if (state === 'conflict') return { text: [a.proposal, ...(a.rivals || [])].map((c) => c.display).join(' / '), cls: 'is-proposal' };
    if (state === 'nodata') return { text: 'нет данных', cls: 'is-empty' };
    return { text: `${a.proposal.display}?`, cls: 'is-proposal' };
  }

  function fieldRow(card, attr, active) {
    const field = card.fields[attr];
    const state = store.fieldState(attr, field);
    const st = schema.FIELD_STATES[state];
    const v = fieldValueText(attr, field, state);
    const changed = ui().changed === `${card.id}|${attr}`;
    return `
      <button class="frow ${attr === active ? 'is-active' : ''} ${changed ? 'is-changed' : ''}" data-act="pick-field" data-attr="${attr}" aria-pressed="${attr === active}">
        <span class="glyph t-${st.tone}">${icons.glyph(st.glyph)}</span>
        <span style="min-width:0"><span class="fname">${esc(schema.attr(attr).name)}</span><span class="fval ${v.cls}" style="display:block">${esc(v.text)}</span></span>
        <span class="fstate t-${st.tone}">${st.short}</span>
      </button>`;
  }

  function fieldsColumn(card, active) {
    const attrs = attrsOf(card);
    const open = attrs.filter((a) => !schema.FIELD_STATES[store.fieldState(a, card.fields[a])].resolved);
    const done = attrs.filter((a) => !open.includes(a));
    return `
    <section class="panel fields" aria-label="Характеристики">
      <div class="col-title"><h2>Характеристики</h2><span class="muted" style="font-size:13px"><kbd>↑</kbd> <kbd>↓</kbd> переход</span></div>
      ${open.length ? `<div class="fgroup"><div class="fgroup-title"><span>Нужно решение</span><span>${open.length}</span></div>${open.map((a) => fieldRow(card, a, active)).join('')}</div>` : ''}
      ${done.length ? `<div class="fgroup"><div class="fgroup-title"><span>Решено</span><span>${done.length}</span></div>${done.map((a) => fieldRow(card, a, active)).join('')}</div>` : ''}
    </section>`;
  }

  // --- Панель решения -----------------------------------------------------------------------------

  function quoteBlock(card, attr, candidate) {
    if (!candidate) return '';
    const key = `${card.id}|${attr}`;
    const n = candidate.evidences.length;
    const i = Math.min(ui().src[key] || 0, n - 1);
    const e = candidate.evidences[i];
    const text = fieldText(card, e.field);
    let from = Math.max(0, e.start - CONTEXT);
    let to = Math.min(text.length, e.end + CONTEXT);
    if (from > 0) { const sp = text.indexOf(' ', from); if (sp !== -1 && sp < e.start) from = sp + 1; }
    if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > e.end) to = sp; }
    const label = e.kind === 'seller' ? `${esc(e.label.replace('Параметры продавца · ', ''))}: ` : '';
    return `
      <figure class="quote">
        <span class="qmark">${icons.icon('quote', 16)}</span>
        <blockquote>${label}${from > 0 ? '<span class="q-cut">…</span>' : ''}${esc(text.slice(from, e.start))}<span class="q-val">${esc(text.slice(e.start, e.end))}</span>${esc(text.slice(e.end, to))}${to < text.length ? '<span class="q-cut">…</span>' : ''}</blockquote>
        <figcaption>
          <span><b>${esc(e.kind === 'seller' ? 'Параметры продавца' : schema.SOURCES[e.kind])}</b>${e.kind === 'seller' ? '' : ` · ${esc(extractor.PATTERN_NAMES[e.pattern] || e.pattern)}`}</span>
          ${n > 1 ? `<span class="src-nav"><button data-act="src-prev" data-attr="${attr}" ${i === 0 ? 'disabled' : ''} aria-label="Предыдущий источник">${icons.icon('left', 14)}</button>Источник ${i + 1} из ${n}<button data-act="src-next" data-attr="${attr}" ${i === n - 1 ? 'disabled' : ''} aria-label="Следующий источник">${icons.icon('right', 14)}</button></span>` : '<span>Источник 1 из 1</span>'}
        </figcaption>
      </figure>`;
  }

  function factsBlock(attr, field, candidate) {
    const d = field.decision;
    const rows = [];
    if (candidate) {
      const raw = [...new Set(candidate.evidences.map((e) => e.quote))];
      const differs = raw.some((r) => util.fold(r) !== util.fold(candidate.display));
      if (differs) {
        rows.push(['В тексте', raw.map((r) => `<span class="mono">${esc(r)}</span>`).join(', ')]);
        rows.push(['В каталоге', `<b>${esc(candidate.display)}</b>`]);
      } else {
        rows.push(['Значение', `<b>${esc(candidate.display)}</b>`]);
      }
      const places = [...new Set(candidate.evidences.map((e) => schema.SOURCES[e.kind]))];
      rows.push(['Источник', esc(places.join(', '))]);
    }
    if (d && d.type === 'corrected') {
      rows.push(['Решение', `<b>${esc(d.display)}</b> — введено человеком`]);
      rows.push(['Оценка модели', '<span class="muted">нет — значение введено вручную</span>']);
    } else if (candidate) {
      rows.push(['Оценка модели', `<span class="score"><span class="num">${util.num(candidate.score)}</span><span class="bar"><span style="width:${candidate.score * 100}%"></span></span></span><span class="score-note">Насколько часто такой способ находки был верен на обучающих данных. Это не гарантия — смотрите на цитату.</span>`]);
    }
    if (!rows.length) return '';
    return `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  function recoBlock(a) {
    const r = schema.RECOMMENDATIONS[a.kind];
    return `<div class="reco t-${r.tone}"><span>${icons.glyph(r.glyph)}</span><div><strong>${r.label}</strong><p>${esc(a.reason)}</p></div></div>`;
  }

  function candidatesBlock(card, attr, field, shown, a) {
    const list = field.candidates;
    if (list.length < 2 && !list.some((c) => c.rejected)) return '';
    const decided = Boolean(field.decision);
    return `<div class="cands"><div class="section-title">Варианты из текста</div>
      ${list.map((c) => {
        const where = [...new Set(c.evidences.map((e) => schema.SOURCES[e.kind]))].join(', ');
        const note = c.compat ? ' · совместимое устройство' : c.articleCode ? ' · код в артикуле' : a && a.suggestion === c ? ' · полное значение' : '';
        if (c.rejected) {
          return `<div class="cand is-rejected"><span class="t-bad">${icons.glyph('rejected')}</span><span><span class="cv">${esc(c.display)}</span><small>отклонено · ${esc(where)}</small></span>
            <button class="link-btn" data-act="restore-cand" data-attr="${attr}" data-cand="${esc(c.id)}">Вернуть</button></div>`;
        }
        return `<label class="cand ${shown && shown.id === c.id ? 'is-picked' : ''}">
          <input type="radio" name="cand-${attr}" data-change="pick-cand" data-attr="${attr}" value="${esc(c.id)}" ${shown && shown.id === c.id ? 'checked' : ''} ${decided ? 'disabled' : ''}>
          <span><span class="cv">${esc(c.display)}</span><small>${esc(where)}${note}</small></span>
          <span class="num muted" title="Оценка модели">${util.num(c.score)}</span></label>`;
      }).join('')}</div>`;
  }

  function editForm(card, attr, field, shown) {
    const spec = schema.attr(attr);
    const start = field.decision && field.decision.value != null ? extractor.editText(attr, field.decision.value) : shown ? extractor.editText(attr, shown.value) : '';
    const err = ui().editError;
    let control;
    if (spec.kind === 'bool') {
      control = `<select id="edit-value" class="select" data-change="noop">${['Да', 'Нет'].map((o) => `<option ${start === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else {
      const options = spec.options || (spec.dict ? [...new Set(store.state.dict.filter((e) => e.type === spec.dict).map((e) => e.canonical))] : spec.kind === 'brand' ? store.state.dict.filter((e) => e.type === 'brand').map((e) => e.canonical) : []);
      control = `<input id="edit-value" class="input ${err ? 'is-error' : ''}" value="${esc(start)}" autocomplete="off" ${options.length ? 'list="edit-options"' : ''} aria-describedby="edit-help">
        ${options.length ? `<datalist id="edit-options">${options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}
        ${spec.unit ? `<span class="unit-tag">${esc(spec.unit)}</span>` : ''}`;
    }
    const help = spec.kind === 'number' ? `Число в единицах «${spec.unit}». Можно с единицей: «1700 мл», «1 ТБ».`
      : spec.multi ? 'Несколько значений — через запятую: «серебристый, белый».'
        : spec.kind === 'dims' ? 'Три числа в сантиметрах: «80 × 42 × 85».' : 'Значение в том виде, как оно должно быть в каталоге.';
    return `<form class="edit-form" data-act="noop" onsubmit="return false">
      <label class="field-label" for="edit-value">Исправить: ${esc(spec.name.toLowerCase())}</label>
      <div class="edit-row">${control}</div>
      <span id="edit-help" class="field-hint">${help}</span>
      ${err ? `<div class="field-error" role="alert">${icons.glyph('conflict', 14)} ${esc(err)}</div>` : ''}
      <div class="actions" style="margin-top:10px">
        <button class="btn btn-primary btn-sm" data-act="save-edit" data-attr="${attr}">Сохранить исправление <kbd>↵</kbd></button>
        <button class="btn btn-sm" data-act="cancel-edit">Отмена <kbd>Esc</kbd></button>
      </div>
    </form>`;
  }

  function decidedBlock(field, attr) {
    const d = field.decision;
    const st = schema.FIELD_STATES[store.fieldState(attr, field)];
    const when = util.ago(d.at);
    const text = {
      auto: [`Принято автоматически · ${when}`, `Значение прямо подтверждено текстом, оценка модели ${util.num(d.score)} — не ниже порога ${util.num(schema.AUTO_THRESHOLD)}.`],
      accepted: [`Подтверждено человеком · ${when}`, 'Значение предложила система, решение принял сотрудник.'],
      corrected: [`Исправлено человеком · ${when}`, 'Значение введено вручную. Оценка модели к нему не относится.'],
      absent: [`Характеристики в тексте нет · ${when}`, 'Отсутствие подтверждено человеком — поле не будет считаться пропущенным.'],
    }[d.type];
    return `<div class="decided"><span class="t-${st.tone}">${icons.glyph(st.glyph)}</span><div><strong>${text[0]}</strong><p>${text[1]}</p></div></div>`;
  }

  function decisionPanel(card, attr) {
    const field = card.fields[attr];
    const spec = schema.attr(attr);
    const state = store.fieldState(attr, field);
    const st = schema.FIELD_STATES[state];
    const editing = ui().editing === `${card.id}|${attr}`;
    const shown = shownCandidate(card, attr);
    const a = field.decision ? null : extractor.assess(attr, field);
    const quoted = shown && (!field.decision || field.decision.type !== 'absent' || shown);

    let body = '';
    if (field.decision) body += decidedBlock(field, attr);
    if (quoted && shown) body += quoteBlock(card, attr, shown);
    else if (!field.decision) body += `<div class="no-quote">${icons.glyph('nodata')} В названии, описании и параметрах продавца нет упоминания характеристики «${esc(spec.name.toLowerCase())}».</div>`;
    body += factsBlock(attr, field, shown);
    if (a) body += recoBlock(a);
    body += candidatesBlock(card, attr, field, shown, a);
    if (editing) body += editForm(card, attr, field, shown);

    const val = (c) => `«${esc(c.display)}»`;
    let buttons = '';
    let secondary = '';
    if (!editing) {
      if (field.decision) {
        buttons = `<button class="btn" data-act="reopen" data-attr="${attr}">${icons.icon('undo')} Пересмотреть решение</button>
          <button class="btn" data-act="start-edit" data-attr="${attr}">${icons.icon('edit')} Исправить <kbd>E</kbd></button>`;
      } else if (a.kind === 'nodata') {
        buttons = `<button class="btn btn-primary" data-act="start-edit" data-attr="${attr}">${icons.icon('edit')} Ввести значение <kbd>E</kbd></button>
          <button class="btn" data-act="absent" data-attr="${attr}">${icons.glyph('absent')} Подтвердить: в тексте нет <kbd>X</kbd></button>`;
      } else {
        const target = shown || a.proposal;
        if (a.kind === 'reject') {
          buttons = `<button class="btn btn-danger" data-act="reject" data-attr="${attr}" data-cand="${esc(target.id)}">${icons.glyph('rejected')} Отклонить ${val(target)} <kbd>R</kbd></button>
            <button class="btn" data-act="accept" data-attr="${attr}" data-cand="${esc(target.id)}">Принять всё равно <kbd>A</kbd></button>
            <button class="btn" data-act="start-edit" data-attr="${attr}">${icons.icon('edit')} Исправить <kbd>E</kbd></button>`;
        } else if (a.kind === 'complete' && (!shown || shown.id === a.suggestion.id)) {
          buttons = `<button class="btn btn-primary" data-act="accept" data-attr="${attr}" data-cand="${esc(a.suggestion.id)}">${icons.icon('plus')} Дополнить до ${val(a.suggestion)} <kbd>A</kbd></button>
            <button class="btn" data-act="accept" data-attr="${attr}" data-cand="${esc(a.proposal.id)}">Принять только ${val(a.proposal)}</button>
            <button class="btn" data-act="start-edit" data-attr="${attr}">${icons.icon('edit')} Исправить <kbd>E</kbd></button>`;
        } else {
          const label = a.kind === 'normalize' ? `Принять в виде каталога ${val(target)}` : `Принять ${val(target)}`;
          buttons = `<button class="btn btn-primary" data-act="accept" data-attr="${attr}" data-cand="${esc(target.id)}">${icons.icon('check')} ${label} <kbd>A</kbd></button>
            <button class="btn" data-act="start-edit" data-attr="${attr}">${icons.icon('edit')} Исправить <kbd>E</kbd></button>
            <button class="btn btn-danger" data-act="reject" data-attr="${attr}" data-cand="${esc(target.id)}">${icons.glyph('rejected')} Отклонить ${val(target)} <kbd>R</kbd></button>`;
        }
        secondary = `<div class="actions-secondary"><span class="muted">Если неверно всё, что нашла система:</span>
          <button class="link-btn" data-act="absent" data-attr="${attr}">Подтвердить, что характеристики в тексте нет <kbd>X</kbd></button></div>`;
      }
    }

    return `
    <section class="panel decision" aria-label="Решение по характеристике" aria-live="polite">
      <div class="dp-head">
        <div><h2>${esc(spec.name)}</h2><div class="sub">${esc(schema.category(card.category).name)} · ${spec.unit ? `единица каталога: ${esc(spec.unit)}` : spec.multi ? 'можно несколько значений' : 'одно значение'}</div></div>
        <span class="pill t-${st.tone}">${icons.glyph(st.glyph, 14)}${st.label}</span>
      </div>
      ${body}
      ${buttons ? `<div class="actions">${buttons}</div>` : ''}
      ${secondary}
      <div class="next-hint">${icons.icon('keyboard')} <kbd>N</kbd> следующая проблема · <kbd>Ctrl</kbd>+<kbd>Z</kbd> отменить последнее действие</div>
    </section>`;
  }

  // --- Шапка и навигация ----------------------------------------------------------------------------

  function listContext(card) {
    const list = A.views.catalog.filtered();
    const i = list.findIndex((c) => c.id === card.id);
    return { list, i };
  }

  function nextProblemCard(card) {
    const { list, i } = listContext(card);
    const ordered = i >= 0 ? [...list.slice(i + 1), ...list.slice(0, i)] : list;
    return ordered.find((c) => c.id !== card.id && ['conflict', 'review'].includes(store.cardStatus(c)));
  }

  function header(card) {
    const status = store.cardStatus(card);
    const st = schema.CARD_STATUSES[status];
    const p = store.cardProgress(card);
    const { list, i } = listContext(card);
    const prev = i > 0 ? list[i - 1] : null;
    const next = i >= 0 ? list[i + 1] : list[0];
    const f = store.state.ui.catalog;
    const filterNote = f.q || f.categories.length || f.statuses.length || f.problemsOnly ? ' (с учётом фильтров каталога)' : '';
    const editingTitle = ui().editTitle === card.id;
    return `
    <div class="review-bar">
      <div class="crumbs"><a href="#/catalog">${icons.icon('back')} Каталог</a><span>/</span><span>${esc(schema.category(card.category) ? schema.category(card.category).name : 'Без категории')}</span><span>/</span><span class="mono">${esc(card.sku)}</span></div>
      <span class="spacer"></span>
      <span>${i >= 0 ? `${i + 1} из ${list.length}` : 'вне списка'}${filterNote}</span>
      <button class="btn btn-sm" data-act="goto-card" data-id="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'}>${icons.icon('left')} Предыдущая</button>
      <button class="btn btn-sm" data-act="goto-card" data-id="${next ? next.id : ''}" ${next ? '' : 'disabled'}>Следующая ${icons.icon('right')}</button>
      <button class="btn btn-sm" data-act="undo" ${store.canUndo() ? '' : 'disabled'} title="${store.canUndo() ? `Отменить: ${esc(store.lastUndoLabel())}` : 'Нечего отменять'}">${icons.icon('undo')} Отменить</button>
    </div>
    <section class="panel card-head">
      ${icons.illustration(card.category, 56)}
      <div style="min-width:0">
        ${editingTitle ? `
          <div class="title-edit"><input id="title-input" class="input" value="${esc(card.title)}" aria-label="Название карточки">
            <button class="btn btn-primary btn-sm" data-act="save-title">Сохранить</button><button class="btn btn-sm" data-act="cancel-title">Отмена</button></div>`
          : `<h1 class="card-title">${esc(card.title)} <button class="icon-btn" data-act="edit-title" aria-label="Изменить название" title="Изменить название">${icons.icon('edit')}</button></h1>`}
        <div class="card-meta">
          <span class="pill t-${st.tone}">${icons.glyph(st.glyph, 14)}${st.label}</span>
          <label>Категория:
            <select class="select" data-change="card-category" aria-label="Категория карточки">
              ${card.category ? '' : '<option value="" selected>не определена</option>'}
              ${schema.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === card.category ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select></label>
          <span>Источник: ${SOURCE_NAMES[card.source] || card.source} · ${util.ago(card.createdAt)}</span>
          ${card.exportedAt ? `<span>${icons.icon('download', 14)} выгружено ${util.ago(card.exportedAt)}</span>` : ''}
          ${card.pipeline === 'done' ? '<button class="link-btn" data-act="reprocess" title="Извлечь заново с текущими словарями; решения человека сохранятся">Обработать заново</button>' : ''}
        </div>
      </div>
      <div class="card-progress">
        ${card.pipeline === 'done' ? `
          <span class="label">Решено <b>${p.resolved} из ${p.total}</b> · заполнено значений: ${p.filled}</span>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.resolved}"><span style="width:${p.total ? (p.resolved / p.total) * 100 : 0}%"></span></div>
          <button class="btn btn-primary" data-act="next-problem">Следующая проблема ${icons.icon('arrow')} <kbd>N</kbd></button>` : ''}
      </div>
    </section>`;
  }

  function notProcessed(card) {
    if (card.pipeline === 'processing') {
      return `<section class="panel panel-pad"><div class="alert t-info"><span>${icons.glyph('processing')}</span><div><strong>Система извлекает характеристики</strong><p>Это займёт пару секунд — страница обновится сама.</p></div></div></section>`;
    }
    return `<section class="panel panel-pad">
      <div class="alert t-info"><span>${icons.glyph('new')}</span><div><strong>Новое поступление — ещё не обработано</strong>
        <p>${card.category ? 'Запустите обработку: система найдёт характеристики в тексте и подготовит предложения с цитатами.' : 'Категория не определена: выберите её в шапке карточки, чтобы система знала, какие характеристики искать.'}</p></div></div>
      <div class="actions"><button class="btn btn-primary" data-act="process-one" ${card.category ? '' : 'disabled'}>${icons.icon('refresh')} Обработать карточку</button></div>
      <hr class="divider">
      <div class="source-label">Название</div><p class="source-text source-title">${esc(card.input.title)}</p>
      ${card.input.description ? `<div class="source-label" style="margin-top:12px">Описание</div><p class="source-text">${esc(card.input.description)}</p>` : ''}
    </section>`;
  }

  function render(route) {
    const card = currentCard(route);
    if (!card) {
      return `<div class="page"><div class="panel empty"><h3>Карточка не найдена</h3><p>Возможно, она была удалена.</p><a class="btn" href="#/catalog">Вернуться в каталог</a></div></div>`;
    }
    if (card.pipeline !== 'done') return `<div class="page">${header(card)}${notProcessed(card)}</div>`;
    const active = activeAttr(card, route);
    const shown = active ? shownCandidate(card, active) : null;
    const status = store.cardStatus(card);
    const nextCard = nextProblemCard(card);
    const banner = status === 'ready' ? `
      <div class="banner-ready"><span class="t-ok">${icons.glyph('ready', 20)}</span>
        <div><strong>Карточка готова к выгрузке</strong><p>Все ${store.cardProgress(card).total} характеристик решены — системой или человеком.</p></div>
        ${nextCard ? `<button class="btn btn-ok" data-act="goto-card" data-id="${nextCard.id}">Следующая карточка с проблемами ${icons.icon('arrow')}</button>` : '<a class="btn" href="#/catalog">В каталог</a>'}
      </div>` : '';
    return `
    <div class="page">
      ${header(card)}
      ${banner}
      <div class="review-grid">
        ${sourceColumn(card, active, shown)}
        ${fieldsColumn(card, active)}
        ${active ? decisionPanel(card, active) : ''}
      </div>
    </div>`;
  }

  function mounted(route) {
    const card = currentCard(route);
    if (!card) return;
    if (store.state.ui.lastCardId !== card.id) store.setUi({ lastCardId: card.id }, true);
    const r = ui();
    if (r.editing) {
      const input = document.getElementById('edit-value');
      if (input && document.activeElement !== input) {
        input.focus();
        if (input.select) input.select();
      }
    }
    if (r.editTitle === card.id) {
      const t = document.getElementById('title-input');
      if (t && document.activeElement !== t) t.focus();
    }
    if (r.changed) setTimeout(() => { r.changed = null; }, 1800);
    // на узком экране панель решения ниже списка — показываем её после выбора характеристики
    if (r.scrollPanel) {
      r.scrollPanel = false;
      const panel = document.querySelector('.decision');
      if (panel && window.innerWidth <= 820) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // --- Действия -------------------------------------------------------------------------------------

  function cardFromRoute() {
    return store.card(A.app.parseRoute().id);
  }

  function setActive(card, attr) {
    const r = ui();
    r.editing = null;
    r.editError = '';
    r.scrollPanel = true;
    store.state.ui.activeField[card.id] = attr;
    const hash = `#/card/${card.id}?f=${attr}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    A.app.render();
  }

  /** После решения — к следующему нерешённому полю этой карточки. */
  function afterDecision(card, attr, message) {
    const fresh = store.card(card.id);
    const r = ui();
    r.changed = `${card.id}|${attr}`;
    r.editing = null;
    r.editError = '';
    delete r.pick[`${card.id}|${attr}`];
    const open = openAttrs(fresh);
    const next = open.find((a) => a !== attr);
    if (next) store.state.ui.activeField[card.id] = next;
    history.replaceState(null, '', `#/card/${card.id}${next ? `?f=${next}` : `?f=${attr}`}`);
    A.app.render();
    A.app.toast(message, { undo: true });
  }

  function decide(attr, action, label, message) {
    const card = cardFromRoute();
    if (!card) return;
    const result = store.decide(card.id, attr, action, `${label}: ${schema.attr(attr).name.toLowerCase()}`);
    if (result.error) {
      ui().editError = result.error;
      A.app.render();
      return;
    }
    afterDecision(card, attr, message);
  }

  function candidateOf(card, attr, id) {
    return card.fields[attr].candidates.find((c) => c.id === id);
  }

  function nextProblem() {
    const card = cardFromRoute();
    if (!card) return;
    const route = A.app.parseRoute();
    const current = activeAttr(card, route);
    const open = openAttrs(card);
    const attrs = attrsOf(card);
    const after = attrs.slice(attrs.indexOf(current) + 1).find((a) => open.includes(a)) || open.find((a) => a !== current);
    if (after) {
      setActive(card, after);
      return;
    }
    const nextCard = nextProblemCard(card);
    if (nextCard) A.app.go(`#/card/${nextCard.id}`);
    else A.app.toast('Нерешённых проблем в списке больше нет');
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'pick-field': (el) => {
        const card = cardFromRoute();
        if (card) setActive(card, el.dataset.attr);
      },
      'goto-card': (el) => {
        if (el.dataset.id) A.app.go(`#/card/${el.dataset.id}`);
      },
      'next-problem': nextProblem,
      undo: () => {
        const label = store.undo();
        if (label) A.app.toast(`Отменено: ${label.toLowerCase()}`);
      },
      'src-prev': (el) => {
        const card = cardFromRoute();
        const key = `${card.id}|${el.dataset.attr}`;
        ui().src[key] = Math.max(0, (ui().src[key] || 0) - 1);
        A.app.render();
      },
      'src-next': (el) => {
        const card = cardFromRoute();
        const key = `${card.id}|${el.dataset.attr}`;
        ui().src[key] = (ui().src[key] || 0) + 1;
        A.app.render();
      },
      accept: (el) => {
        const card = cardFromRoute();
        const c = candidateOf(card, el.dataset.attr, el.dataset.cand);
        decide(el.dataset.attr, { type: 'accept', candidateId: el.dataset.cand }, 'Принятие', `Принято «${c ? c.display : ''}» · ${schema.attr(el.dataset.attr).name}`);
      },
      reject: (el) => {
        const card = cardFromRoute();
        const c = candidateOf(card, el.dataset.attr, el.dataset.cand);
        decide(el.dataset.attr, { type: 'reject', candidateId: el.dataset.cand }, 'Отклонение',
          `Предложение «${c ? c.display : ''}» отклонено. Это не значит, что характеристики нет — поле осталось открытым.`);
      },
      absent: (el) => decide(el.dataset.attr, { type: 'absent' }, 'Отметка «нет в тексте»', `${schema.attr(el.dataset.attr).name}: подтверждено, что в тексте нет`),
      reopen: (el) => decide(el.dataset.attr, { type: 'reopen' }, 'Пересмотр', `${schema.attr(el.dataset.attr).name}: решение снято, поле снова ждёт проверки`),
      'restore-cand': (el) => decide(el.dataset.attr, { type: 'restore', candidateId: el.dataset.cand }, 'Возврат варианта', 'Отклонённый вариант возвращён'),
      'start-edit': (el) => {
        const card = cardFromRoute();
        ui().editing = `${card.id}|${el.dataset.attr}`;
        ui().editError = '';
        A.app.render();
      },
      'cancel-edit': () => {
        ui().editing = null;
        ui().editError = '';
        A.app.render();
      },
      'save-edit': (el) => {
        const input = document.getElementById('edit-value');
        const attr = el.dataset.attr;
        decide(attr, { type: 'correct', text: input ? input.value : '' }, 'Исправление', `${schema.attr(attr).name}: сохранено «${input ? input.value.trim() : ''}»`);
      },
      'edit-title': (el, e) => {
        e.stopPropagation();
        ui().editTitle = cardFromRoute().id;
        A.app.render();
      },
      'cancel-title': () => {
        ui().editTitle = false;
        A.app.render();
      },
      'save-title': () => {
        const card = cardFromRoute();
        const input = document.getElementById('title-input');
        const result = store.rename(card.id, input ? input.value : '');
        if (result.error) {
          A.app.toast(result.error);
          return;
        }
        ui().editTitle = false;
        A.app.render();
        A.app.toast('Название обновлено', { undo: true });
      },
      reprocess: () => {
        const card = cardFromRoute();
        store.reprocess(card.id);
        A.app.toast('Характеристики извлечены заново; решения человека сохранены', { undo: true });
      },
      'process-one': () => {
        const card = cardFromRoute();
        store.process([card.id], () => A.app.toast('Карточка обработана'));
      },
    },
    changes: {
      'pick-cand': (el) => {
        const card = cardFromRoute();
        ui().pick[`${card.id}|${el.dataset.attr}`] = el.value;
        ui().src[`${card.id}|${el.dataset.attr}`] = 0;
        A.app.render();
      },
      'card-category': (el) => {
        const card = cardFromRoute();
        if (!el.value) return;
        store.changeCategory(card.id, el.value);
        A.app.toast(`Категория: ${schema.category(el.value).name}. Характеристики пересчитаны.`, { undo: true });
      },
    },
  });

  function keydown(e, typing) {
    const route = A.app.parseRoute();
    const card = store.card(route.id);
    if (!card || card.pipeline !== 'done') return;
    const r = ui();
    if (typing) {
      if (e.target.id === 'edit-value' && e.key === 'Enter') {
        e.preventDefault();
        document.querySelector('[data-act="save-edit"]').click();
      }
      if (e.target.id === 'edit-value' && e.key === 'Escape') {
        r.editing = null;
        A.app.render();
      }
      if (e.target.id === 'title-input' && e.key === 'Enter') document.querySelector('[data-act="save-title"]').click();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const attr = activeAttr(card, route);
    const press = (act) => {
      const btn = document.querySelector(`.decision [data-act="${act}"]`);
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    };
    const key = e.key.toLowerCase();
    if (key === 'a' || key === 'ф') press('accept');
    else if (key === 'e' || key === 'у') press('start-edit');
    else if (key === 'r' || key === 'к') press('reject');
    else if (key === 'x' || key === 'ч') press('absent');
    else if (key === 'n' || key === 'т') {
      e.preventDefault();
      nextProblem();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const attrs = [...document.querySelectorAll('.fields .frow')].map((b) => b.dataset.attr);
      const i = attrs.indexOf(attr);
      const next = attrs[Math.max(0, Math.min(attrs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next && next !== attr) {
        e.preventDefault();
        setActive(card, next);
      }
    }
  }

  A.views.review = {
    render,
    mounted,
    keydown,
    title: (route) => {
      const card = store.card(route.id);
      return card ? card.title : 'Карточка';
    },
  };
})();
