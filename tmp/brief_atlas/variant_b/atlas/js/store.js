/* Состояние продукта: карточки, решения по характеристикам, словари, настройки экранов.
   Всё сохраняется в localStorage браузера; «Восстановить исходный набор» возвращает начальные данные.

   Главные правила:
   — статус карточки и состояние отдельной характеристики — разные шкалы;
   — показатели автоматизации считаются из тех же карточек и пересчитываются после каждого действия;
   — поле, исправленное человеком, не считается принятым автоматически и не получает старую оценку модели;
   — отклонение кандидата не означает, что характеристики нет: для этого есть отдельное действие. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, schema, extractor, dictionaries, seed } = A;

  const STORAGE_KEY = 'atlas.state.v1';
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  let state = null;
  let undoStack = [];
  const listeners = new Set();

  const defaultUi = () => ({
    catalog: { q: '', categories: [], statuses: [], problemsOnly: false, sort: 'attention' },
    selection: [],
    lastCardId: null,
    activeField: {},
    analytics: { period: '30', category: 'all' },
    dict: { type: 'all', q: '', preview: 'Смартфон Apple iPhone 15 128GB Midnight, 6,1″, корпус из алюминия. Объём 1700 мл, 10W.' },
    approaches: { sku: '30074402' },
  });

  // -------------------------------------------------------------------------------------------
  // Производные значения
  // -------------------------------------------------------------------------------------------

  const DECISION_STATE = { auto: 'auto', accepted: 'accepted', corrected: 'corrected', absent: 'absent' };

  function fieldState(attrId, field) {
    if (!field) return 'nodata';
    if (field.decision) return DECISION_STATE[field.decision.type];
    const kind = extractor.assess(attrId, field).kind;
    if (kind === 'conflict') return 'conflict';
    if (kind === 'nodata') return 'nodata';
    return 'pending';
  }

  function cardStatus(card) {
    if (card.pipeline === 'new') return 'new';
    if (card.pipeline === 'processing') return 'processing';
    const states = Object.entries(card.fields).map(([attr, f]) => fieldState(attr, f));
    if (states.includes('conflict')) return 'conflict';
    if (states.some((s) => !schema.FIELD_STATES[s].resolved)) return 'review';
    return 'ready';
  }

  function cardProgress(card) {
    const category = schema.category(card.category);
    const total = category ? category.attrs.length : 0;
    if (card.pipeline !== 'done') return { resolved: 0, total, filled: 0 };
    let resolved = 0;
    let filled = 0;
    for (const [attr, f] of Object.entries(card.fields)) {
      const s = fieldState(attr, f);
      if (schema.FIELD_STATES[s].resolved) resolved += 1;
      if (['auto', 'accepted', 'corrected'].includes(s)) filled += 1;
    }
    return { resolved, total, filled };
  }

  // Причина внимания — самая важная нерешённая проблема карточки, коротко для списка каталога.
  const ATTENTION_ORDER = ['conflict', 'reject', 'complete', 'normalize', 'accept', 'nodata'];

  function attention(card) {
    if (card.pipeline === 'new') return { kind: 'new', text: 'Ещё не обработана — запустите обработку' };
    if (card.pipeline === 'processing') return { kind: 'processing', text: 'Система извлекает характеристики…' };
    const open = [];
    for (const [attr, f] of Object.entries(card.fields)) {
      if (f.decision) continue;
      open.push({ attr, a: extractor.assess(attr, f) });
    }
    if (!open.length) return null;
    open.sort((x, y) => ATTENTION_ORDER.indexOf(x.a.kind) - ATTENTION_ORDER.indexOf(y.a.kind));
    const { attr, a } = open[0];
    const name = schema.attr(attr).name;
    const texts = {
      conflict: () => `${name}: ${[a.proposal, ...(a.rivals || [])].map((c) => c.display).join(' или ')}`,
      reject: () => (a.proposal.compat ? `${name}: «${a.proposal.display}» — совместимое устройство` : `${name}: значение взято из артикула`),
      complete: () => `${name}: найден один цвет из ${a.suggestion.value.length}`,
      normalize: () => `${name}: написано иначе, чем в каталоге`,
      accept: () => `${name}: ждёт подтверждения`,
      nodata: () => `${name}: нет данных в тексте`,
    };
    const more = open.length - 1;
    return { kind: a.kind, attr, text: texts[a.kind]() + (more ? ` · ещё ${util.count(more, ['поле', 'поля', 'полей'])}` : '') };
  }

  /** Показатели автоматизации по набору карточек. Применимые поля — характеристики категорий обработанных карточек. */
  function metrics(cards) {
    const m = { cards: cards.length, processed: 0, unprocessed: 0, applicable: 0, prepared: 0, auto: 0, accepted: 0, corrected: 0, absent: 0, pending: 0, conflict: 0, nodata: 0 };
    const statuses = { new: 0, processing: 0, conflict: 0, review: 0, ready: 0 };
    for (const card of cards) {
      statuses[cardStatus(card)] += 1;
      if (card.pipeline !== 'done') {
        m.unprocessed += 1;
        continue;
      }
      m.processed += 1;
      for (const [attr, f] of Object.entries(card.fields)) {
        m.applicable += 1;
        if (f.candidates.length) m.prepared += 1;
        m[fieldState(attr, f)] += 1;
      }
    }
    m.human = m.accepted + m.corrected + m.absent;
    m.waiting = m.pending + m.conflict + m.nodata;
    m.statuses = statuses;
    return m;
  }

  // -------------------------------------------------------------------------------------------
  // Обработка: текст -> кандидаты -> автоматические решения
  // -------------------------------------------------------------------------------------------

  /** Повторная обработка сохраняет решения человека и отклонённые кандидаты. */
  function runExtraction(card, entries, at) {
    const previous = card.fields || {};
    const found = extractor.extract(card.input, card.category, entries);
    const fields = {};
    for (const [attr, candidates] of Object.entries(found)) {
      const old = previous[attr];
      const rejectedKeys = new Set(old ? old.candidates.filter((c) => c.rejected).map((c) => c.key) : []);
      for (const c of candidates) {
        if (rejectedKeys.has(c.key)) {
          const was = old.candidates.find((x) => x.key === c.key);
          c.rejected = true;
          c.rejectedAt = was.rejectedAt;
        }
      }
      const field = { candidates, decision: null };
      if (old && old.decision && old.decision.by === 'user') field.decision = old.decision;
      fields[attr] = field;
    }
    card.fields = fields;
    card.pipeline = 'done';
    card.processedAt = card.processedAt || at;
    applyAutoPolicy(card, at);
    // то же автоматическое решение, что и раньше, — сохраняем его исходное время (для аналитики по дням)
    for (const [attr, f] of Object.entries(fields)) {
      const old = previous[attr] && previous[attr].decision;
      if (old && old.by === 'system' && f.decision && f.decision.by === 'system' && extractor.valueKey(old.value) === extractor.valueKey(f.decision.value)) {
        f.decision.at = old.at;
      }
    }
    touchReady(card, at);
  }

  /** Автоматически принимается только значение, явно подтверждённое текстом, с оценкой модели не ниже порога. */
  function applyAutoPolicy(card, at) {
    for (const [attr, f] of Object.entries(card.fields)) {
      if (f.decision) continue;
      const a = extractor.assess(attr, f);
      if (a.kind === 'accept' && a.proposal.score >= schema.AUTO_THRESHOLD) {
        f.decision = { type: 'auto', by: 'system', value: a.proposal.value, display: a.proposal.display, candidateId: a.proposal.id, score: a.proposal.score, at };
      }
    }
  }

  function touchReady(card, at) {
    const ready = cardStatus(card) === 'ready';
    if (ready && !card.readyAt) card.readyAt = at;
    if (!ready) card.readyAt = null;
  }

  // -------------------------------------------------------------------------------------------
  // Решения по характеристике
  // -------------------------------------------------------------------------------------------

  function applyDecision(card, attrId, action, at, entries) {
    const field = card.fields[attrId];
    if (!field) return { error: 'Характеристика не найдена' };
    const findCandidate = (id) => field.candidates.find((c) => c.id === id);
    switch (action.type) {
      case 'accept': {
        const a = extractor.assess(attrId, field);
        const candidate = action.candidateId ? findCandidate(action.candidateId) : a.proposal;
        if (!candidate) return { error: 'Нет значения для принятия' };
        field.decision = { type: 'accepted', by: 'user', value: candidate.value, display: candidate.display, candidateId: candidate.id, score: candidate.score, at };
        break;
      }
      case 'correct': {
        const parsed = extractor.parseUserValue(attrId, action.text, entries);
        if (parsed.error) return { error: parsed.error };
        const key = extractor.valueKey(parsed.value);
        const same = field.candidates.find((c) => !c.rejected && c.key === key);
        // ввели то же, что предлагала система — это подтверждение, а не исправление
        field.decision = same
          ? { type: 'accepted', by: 'user', value: same.value, display: same.display, candidateId: same.id, score: same.score, at }
          : { type: 'corrected', by: 'user', value: parsed.value, display: extractor.display(attrId, parsed.value), candidateId: null, score: null, at };
        break;
      }
      case 'reject': {
        const candidate = action.candidateId ? findCandidate(action.candidateId) : extractor.assess(attrId, field).proposal;
        if (!candidate) return { error: 'Нет предложения для отклонения' };
        candidate.rejected = true;
        candidate.rejectedAt = at;
        if (field.decision && field.decision.candidateId === candidate.id) field.decision = null;
        break;
      }
      case 'absent':
        field.decision = { type: 'absent', by: 'user', value: null, display: '', candidateId: null, score: null, at };
        break;
      case 'reopen':
        field.decision = null;
        break;
      case 'restore': {
        const candidate = findCandidate(action.candidateId);
        if (candidate) {
          candidate.rejected = false;
          delete candidate.rejectedAt;
        }
        break;
      }
      default:
        return { error: 'Неизвестное действие' };
    }
    touchReady(card, at);
    return { ok: true };
  }

  /** Довести карточку до конца по рекомендациям (используется только для исторических данных набора). */
  function finishCard(card, at, entries) {
    let guard = 0;
    for (const attr of Object.keys(card.fields)) {
      while (!card.fields[attr].decision && guard < 200) {
        guard += 1;
        const a = extractor.assess(attr, card.fields[attr]);
        const t = at();
        if (a.kind === 'nodata') applyDecision(card, attr, { type: 'absent' }, t, entries);
        else if (a.kind === 'reject') applyDecision(card, attr, { type: 'reject' }, t, entries);
        else if (a.kind === 'complete') applyDecision(card, attr, { type: 'accept', candidateId: a.suggestion.id }, t, entries);
        else applyDecision(card, attr, { type: 'accept' }, t, entries);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Исходный набор
  // -------------------------------------------------------------------------------------------

  function cardId(sku) {
    return `c${sku}`;
  }

  function makeCard({ sku, title, description, seller, category, source, createdAt, categoryGuess }) {
    return {
      id: cardId(sku),
      sku,
      title,
      input: { title, description: description || '', seller: (seller || []).map(([name, value]) => ({ name, value })) },
      category,
      categoryGuess: categoryGuess || null,
      source,
      createdAt,
      pipeline: 'new',
      processedAt: null,
      readyAt: null,
      exportedAt: null,
      fields: {},
    };
  }

  function seedState() {
    const now = Date.now();
    const entries = dictionaries.seedEntries();
    const cards = seed.cards.map((spec, i) => {
      const createdAt = now - (spec.daysAgo || 0) * util.DAY - (spec.hoursAgo || 0) * HOUR - (spec.daysAgo ? 3 * HOUR + i * 7 * MINUTE : 0);
      const card = makeCard({ ...spec, createdAt });
      if (spec.state === 'done') {
        const processedAt = createdAt + 4 * MINUTE;
        runExtraction(card, entries, processedAt);
        let step = 0;
        const at = () => {
          step += 1;
          return Math.min(now - 10 * MINUTE, processedAt + HOUR + step * 23 * MINUTE);
        };
        for (const act of spec.actions || []) {
          const t = Math.min(now - 10 * MINUTE, processedAt + (act.hours || 1) * HOUR);
          if (act.do === 'correct') applyDecision(card, act.attr, { type: 'correct', text: act.value }, t, entries);
          else applyDecision(card, act.attr, { type: act.do }, t, entries);
        }
        if (spec.finish) finishCard(card, at, entries);
      }
      return card;
    });
    const ui = defaultUi();
    ui.lastCardId = cardId(seed.lastCardSku);
    return { version: 1, seededAt: now, cards, dict: entries, ui };
  }

  // -------------------------------------------------------------------------------------------
  // Хранение
  // -------------------------------------------------------------------------------------------

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* хранилище недоступно (приватный режим) — работаем без сохранения */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.cards)) {
          parsed.ui = { ...defaultUi(), ...parsed.ui, catalog: { ...defaultUi().catalog, ...(parsed.ui || {}).catalog } };
          return parsed;
        }
      }
    } catch (e) {
      /* повреждённые данные — начинаем с исходного набора */
    }
    return null;
  }

  function init() {
    state = load() || seedState();
    // карточки, которые «обрабатывались» в момент закрытия страницы, дообрабатываем сразу
    for (const card of state.cards.filter((c) => c.pipeline === 'processing')) runExtraction(card, state.dict, Date.now());
    state.ui.selection = state.ui.selection.filter((id) => state.cards.some((c) => c.id === id));
    save();
  }

  function emit() {
    save();
    for (const fn of listeners) fn();
  }

  function snapshot(label, cardIds, extra = {}) {
    const cards = cardIds.map((id) => {
      const card = state.cards.find((c) => c.id === id);
      return { id, data: card ? util.clone(card) : null, index: state.cards.findIndex((c) => c.id === id) };
    });
    undoStack.push({ label, cards, dict: extra.dict ? util.clone(state.dict) : null, at: Date.now() });
    if (undoStack.length > 50) undoStack.shift();
  }

  // -------------------------------------------------------------------------------------------
  // Публичные действия
  // -------------------------------------------------------------------------------------------

  const api = {
    init,
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit,
    fieldState,
    cardStatus,
    cardProgress,
    attention,
    metrics,

    card(id) {
      return state.cards.find((c) => c.id === id) || null;
    },

    canUndo() {
      return undoStack.length > 0;
    },
    lastUndoLabel() {
      return undoStack.length ? undoStack[undoStack.length - 1].label : '';
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      for (const snap of entry.cards) {
        const at = state.cards.findIndex((c) => c.id === snap.id);
        if (snap.data && at >= 0) state.cards[at] = snap.data;
        else if (snap.data && at < 0) state.cards.splice(Math.max(0, Math.min(snap.index, state.cards.length)), 0, snap.data);
        else if (!snap.data && at >= 0) state.cards.splice(at, 1);
      }
      if (entry.dict) state.dict = entry.dict;
      emit();
      return entry.label;
    },

    decide(cardId, attrId, action, label) {
      const card = api.card(cardId);
      if (!card) return { error: 'Карточка не найдена' };
      const before = util.clone(card);
      const result = applyDecision(card, attrId, action, Date.now(), state.dict);
      if (result.error) {
        const at = state.cards.findIndex((c) => c.id === cardId);
        state.cards[at] = before;
        return result;
      }
      undoStack.push({ label, cards: [{ id: cardId, data: before, index: state.cards.indexOf(card) }], at: Date.now() });
      if (undoStack.length > 50) undoStack.shift();
      emit();
      return result;
    },

    /** Массово принять поля, где значение прямо подтверждено текстом (рекомендация «принять»). */
    acceptConfirmed(cardIds) {
      snapshot('Принятие подтверждённых значений', cardIds);
      let count = 0;
      const now = Date.now();
      for (const id of cardIds) {
        const card = api.card(id);
        if (!card || card.pipeline !== 'done') continue;
        for (const [attr, f] of Object.entries(card.fields)) {
          if (f.decision) continue;
          if (extractor.assess(attr, f).kind === 'accept') {
            applyDecision(card, attr, { type: 'accept' }, now, state.dict);
            count += 1;
          }
        }
      }
      if (!count) undoStack.pop();
      emit();
      return count;
    },

    /** Обработка: «Новое поступление» -> «Обрабатывается» -> результат. Карточки обрабатываются по очереди. */
    process(cardIds, onDone) {
      const targets = cardIds.map((id) => api.card(id)).filter((c) => c && c.pipeline !== 'processing');
      if (!targets.length) return 0;
      snapshot('Обработка карточек', targets.map((c) => c.id));
      targets.forEach((c) => {
        c.pipeline = 'processing';
      });
      emit();
      targets.forEach((card, i) => {
        setTimeout(() => {
          const live = api.card(card.id);
          if (!live || live.pipeline !== 'processing') return;
          runExtraction(live, state.dict, Date.now());
          emit();
          if (i === targets.length - 1 && onDone) onDone(targets.length);
        }, 900 + i * 450);
      });
      return targets.length;
    },

    /** Повторно извлечь характеристики (например, после правки словаря). Решения человека сохраняются. */
    reprocess(cardId) {
      const card = api.card(cardId);
      if (!card) return;
      snapshot('Повторная обработка', [cardId]);
      runExtraction(card, state.dict, Date.now());
      emit();
    },

    /** Применить текущие словари ко всем обработанным карточкам. Решения людей не трогаются. */
    reprocessAll() {
      const ids = state.cards.filter((c) => c.pipeline === 'done').map((c) => c.id);
      snapshot('Повторная обработка каталога', ids);
      const now = Date.now();
      for (const id of ids) runExtraction(api.card(id), state.dict, now);
      emit();
      return ids.length;
    },

    rename(cardId, title) {
      const card = api.card(cardId);
      const clean = String(title || '').replace(/\s+/g, ' ').trim();
      if (!card || !clean) return { error: 'Название не может быть пустым' };
      snapshot('Изменение названия', [cardId]);
      card.title = clean;
      emit();
      return { ok: true };
    },

    changeCategory(cardId, categoryId) {
      const card = api.card(cardId);
      if (!card || !schema.category(categoryId) || card.category === categoryId) return;
      snapshot('Смена категории', [cardId]);
      card.category = categoryId;
      if (card.pipeline === 'done') runExtraction(card, state.dict, Date.now());
      emit();
    },

    remove(cardIds) {
      snapshot(cardIds.length > 1 ? 'Удаление карточек' : 'Удаление карточки', cardIds);
      state.cards = state.cards.filter((c) => !cardIds.includes(c.id));
      state.ui.selection = state.ui.selection.filter((id) => !cardIds.includes(id));
      emit();
    },

    /** Импорт строк: каждая становится карточкой со статусом «Новое поступление». */
    importRows(rows, source) {
      const now = Date.now();
      const created = rows.map((row, i) => {
        const guess = row.category ? null : extractor.detectCategory(row.title, row.description);
        return makeCard({
          sku: row.sku,
          title: row.title,
          description: row.description,
          seller: [],
          category: row.category || (guess && guess.id) || null,
          categoryGuess: guess,
          source,
          createdAt: now + i,
        });
      });
      state.cards.unshift(...created);
      undoStack.push({ label: 'Импорт товаров', cards: created.map((c) => ({ id: c.id, data: null, index: 0 })), at: now });
      emit();
      return created;
    },

    /** Карточка из свободного текста: черновик уже проверен пользователем на экране создания. */
    createFromDraft(draft) {
      const now = Date.now();
      const sku = draft.sku || api.nextSku();
      const card = makeCard({ sku, title: draft.title, description: draft.input.description, seller: [], category: draft.category, source: draft.source, createdAt: now, categoryGuess: draft.guess });
      card.input = util.clone(draft.input);
      runExtraction(card, state.dict, now);
      // правки пользователя в черновике — это его решения
      for (const [attr, edit] of Object.entries(draft.edits || {})) {
        if (!card.fields[attr]) continue;
        if (edit.absent) applyDecision(card, attr, { type: 'absent' }, now, state.dict);
        else if (edit.reject) applyDecision(card, attr, { type: 'reject' }, now, state.dict);
        else applyDecision(card, attr, { type: 'correct', text: edit.text }, now, state.dict);
      }
      state.cards.unshift(card);
      undoStack.push({ label: 'Создание карточки', cards: [{ id: card.id, data: null, index: 0 }], at: now });
      emit();
      return card;
    },

    nextSku() {
      const used = new Set(state.cards.map((c) => c.sku));
      let n = 14000001;
      while (used.has(String(n))) n += 1;
      return String(n);
    },

    markExported(cardIds) {
      const now = Date.now();
      for (const id of cardIds) {
        const card = api.card(id);
        if (card) card.exportedAt = now;
      }
      emit();
    },

    // --- словари --------------------------------------------------------------------------------
    saveEntry(entry) {
      snapshot(entry.id ? 'Изменение записи словаря' : 'Новая запись словаря', [], { dict: true });
      if (entry.id) {
        const i = state.dict.findIndex((e) => e.id === entry.id);
        if (i >= 0) state.dict[i] = entry;
      } else {
        state.dict.unshift({ ...entry, id: util.uid(entry.type) });
      }
      emit();
    },
    deleteEntry(id) {
      snapshot('Удаление записи словаря', [], { dict: true });
      state.dict = state.dict.filter((e) => e.id !== id);
      emit();
    },

    // --- интерфейс ------------------------------------------------------------------------------
    setUi(patch, silent) {
      Object.assign(state.ui, patch);
      if (silent) save();
      else emit();
    },
    setCatalog(patch) {
      state.ui.catalog = { ...state.ui.catalog, ...patch };
      emit();
    },

    reset() {
      state = seedState();
      undoStack = [];
      emit();
    },
  };

  A.store = api;
})();
