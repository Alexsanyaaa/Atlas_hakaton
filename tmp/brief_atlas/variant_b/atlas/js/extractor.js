/* Локальное извлечение характеристик из текста: шаблоны + словари, как в ветке «Правила и словари».
   Детерминировано: один и тот же текст всегда даёт один и тот же результат.
   Если значение в тексте не найдено — характеристика остаётся пустой (ничего не подставляется «по аналогии»).

   Результат по каждой характеристике — список кандидатов. У кандидата:
     value      — значение в виде каталога (число в единице хранения, строка, список цветов);
     evidences  — где именно в тексте оно найдено (поле, позиция, цитата, шаблон);
     score      — оценка модели: как часто такой шаблон был прав на обучающих данных (не точность!).
   Отдельно assess() объясняет, что делать с полем: принять, нормализовать, дополнить, проверить, отклонить. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, schema } = A;

  const LB = '(?<![\\p{L}\\p{N}])';
  const RB = '(?![\\p{L}\\p{N}])';
  const NUM = '(\\d+(?:[.,]\\d+)?)';
  const NUM_THOUSANDS = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+(?:[.,]\\d+)?)';
  const SENTENCE_END = /[.;!?](?:\s|$)|\n/;

  // Оценка модели по шаблону. Порядок величин взят из калибровки ветки rules на обучающей части каталога:
  // значение из названия или подписанного поля верно почти всегда, «число с единицей без подписи» — заметно реже.
  const SCORE = {
    title_pair: 0.99, title_unit: 0.95, title_dict: 0.93, title_token: 0.96, title_spec: 0.88,
    seller: 0.95, labelled: 0.94, context: 0.87, context_after: 0.9, mention: 0.84, unit_only: 0.74,
    model_after_brand: 0.91, brand_first: 0.97, brand_later: 0.85, brand_compat: 0.35, article_code: 0.41,
  };

  const PATTERN_NAMES = {
    title_pair: 'пара «память/накопитель» в названии', title_unit: 'число с единицей в названии',
    title_dict: 'слово из словаря в названии', title_token: 'обозначение в названии', title_spec: 'спецификация в названии',
    seller: 'параметр продавца', labelled: 'подписанное значение в описании', context: 'значение рядом с подписью',
    context_after: 'значение перед подписью', mention: 'упоминание в описании', unit_only: 'число с единицей без подписи',
    model_after_brand: 'текст после бренда', brand_first: 'бренд в начале названия', brand_later: 'бренд в названии',
    brand_compat: 'бренд после «для»', article_code: 'код в артикуле',
  };

  const FIELD_ORDER = { title: 0, seller: 1, description: 2 };
  const COLOR_CODES = { BK: 'черный', WH: 'белый', GR: 'серый', GY: 'серый', RD: 'красный', BL: 'синий', BU: 'синий', SL: 'серебристый', GD: 'золотистый' };

  // ---------------------------------------------------------------------------------------------
  // Индекс словарей: строится из текущих записей (их можно редактировать на странице «Словари»).
  // ---------------------------------------------------------------------------------------------

  /** «черный» -> черный, черная, черное, черные, черного, черную … — чтобы «бежевое кресло» тоже нашлось. */
  function adjectiveForms(word) {
    const m = word.match(/^([а-яё-]+?)(ый|ий|ой)$/i);
    if (!m) return [word];
    const [, stem, end] = m;
    const soft = end === 'ий' && !/[кгхжшчщ]$/i.test(stem);
    const endings = soft
      ? ['ий', 'яя', 'ее', 'ие', 'его', 'юю', 'их', 'ей']
      : ['ый', 'ий', 'ой', 'ая', 'ое', 'ые', 'ого', 'ую', 'ых', 'ом'];
    return endings.map((e) => stem + e);
  }

  /** Фраза словаря -> кусок регулярного выражения; «е» в словаре совпадает и с «ё» в тексте. */
  function phrasePattern(phrase) {
    return util.escapeRe(phrase).replace(/е/g, '[её]');
  }

  function phraseRegex(phrases) {
    const unique = [...new Set(phrases.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!unique.length) return null;
    return new RegExp(`${LB}(?:${unique.map(phrasePattern).join('|')})${RB}`, 'giu');
  }

  /** Вариант — другое слово («Midnight» -> черный), а не грамматическая форма («жаропрочного стекла»)? */
  function isAlias(variant, canonical) {
    const a = util.fold(variant);
    const b = util.fold(canonical);
    if (a === b) return false;
    const n = Math.min(5, a.length, b.length);
    return a.slice(0, n) !== b.slice(0, n);
  }

  function buildIndex(entries) {
    const idx = { lookup: { color: new Map(), material: new Map(), brand: new Map() }, re: {}, units: {}, unitRe: {}, synonyms: {}, synonymRe: {} };

    for (const type of ['color', 'material', 'brand']) {
      const lookup = idx.lookup[type];
      for (const e of entries.filter((x) => x.type === type)) {
        const add = (variant, alias) => {
          const forms = type === 'brand' ? [variant] : variant.split(' ').length === 1 ? adjectiveForms(variant) : [variant];
          for (const form of forms) {
            const key = util.fold(form);
            if (!lookup.has(key)) lookup.set(key, { canonical: e.canonical, alias, entryId: e.id });
          }
        };
        add(e.canonical, false);
        for (const v of e.variants || []) add(v, isAlias(v, e.canonical));
      }
      idx.re[type] = phraseRegex([...lookup.keys()]);
    }

    for (const e of entries.filter((x) => x.type === 'unit')) {
      const { dim, factor } = e.meta || {};
      if (!dim) continue;
      idx.units[dim] = idx.units[dim] || new Map();
      for (const token of [e.canonical, ...(e.variants || [])]) {
        idx.units[dim].set(util.fold(token), { canonical: e.canonical, factor: Number(factor) || 1 });
      }
    }
    for (const [dim, map] of Object.entries(idx.units)) {
      const tokens = [...map.keys()].sort((a, b) => b.length - a.length).map(util.escapeRe);
      idx.unitRe[dim] = tokens.join('|');
    }

    for (const e of entries.filter((x) => x.type === 'synonym')) {
      const attr = e.meta && e.meta.attr;
      if (!attr) continue;
      idx.synonyms[attr] = idx.synonyms[attr] || [];
      idx.synonyms[attr].push(util.fold(e.canonical), ...(e.variants || []).map(util.fold));
    }
    for (const [attr, list] of Object.entries(idx.synonyms)) idx.synonymRe[attr] = phraseRegex(list);
    return idx;
  }

  // ---------------------------------------------------------------------------------------------
  // Поля исходного текста
  // ---------------------------------------------------------------------------------------------

  function makeFields(input) {
    const fields = [];
    if (input.title) fields.push({ key: 'title', kind: 'title', label: 'Название', text: input.title });
    if (input.description) fields.push({ key: 'description', kind: 'description', label: 'Описание', text: input.description });
    (input.seller || []).forEach((p, i) => {
      if (p && p.name && p.value != null && String(p.value).trim()) {
        fields.push({ key: `seller:${i}`, kind: 'seller', label: `Параметры продавца · ${p.name}`, name: p.name, text: String(p.value) });
      }
    });
    return fields;
  }

  function sellerMatches(field, attrId, idx) {
    const names = idx.synonyms[attrId] || [];
    const name = util.fold(field.name);
    return names.some((n) => name === n || name.startsWith(`${n} `) || name.endsWith(` ${n}`));
  }

  function hit(attrId, field, start, end, value, pattern, extra = {}) {
    return {
      attr: attrId, value, field: field.key, kind: field.kind, label: field.label,
      start, end, quote: field.text.slice(start, end), pattern, score: extra.score ?? SCORE[pattern],
      unitToken: extra.unitToken || null, converted: !!extra.converted, alias: !!extra.alias,
      compat: !!extra.compat, articleCode: extra.articleCode || null,
    };
  }

  function parseNum(text) {
    return parseFloat(String(text).replace(/[  ]/g, '').replace(',', '.'));
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  // ---------------------------------------------------------------------------------------------
  // Числа с единицами
  // ---------------------------------------------------------------------------------------------

  const TITLE_UNIT_ATTRS = new Set(['screen', 'battery', 'power', 'volume', 'fridge_volume', 'load', 'colortemp', 'spin']);
  const UNIT_ONLY_ATTRS = new Set(['screen', 'battery', 'power', 'volume', 'fridge_volume', 'spin', 'colortemp']);
  const THOUSANDS_DIMS = new Set(['mah', 'power', 'spin', 'temp', 'volume']);

  function valueRegex(dim, idx) {
    const units = idx.unitRe[dim];
    if (!units) return null;
    const number = THOUSANDS_DIMS.has(dim) ? NUM_THOUSANDS : NUM;
    return new RegExp(`(?<![\\p{L}\\p{N}.,])${number}\\s*-?\\s*(${units})(?![\\p{L}\\p{N}])`, 'giu');
  }

  function unitInfo(dim, token, idx) {
    return idx.units[dim] && idx.units[dim].get(util.fold(token));
  }

  function numberFromMatch(spec, m, idx) {
    const info = unitInfo(spec.dim, m[2], idx);
    if (!info) return null;
    const value = round(parseNum(m[1]) * info.factor);
    if (spec.range && (value < spec.range[0] || value > spec.range[1])) return null;
    return { value, unitToken: util.fold(m[2]), converted: info.factor !== 1 };
  }

  /** Подписанное значение: «Оперативная память: 8 ГБ», «Экран 6,6 дюйма», «8 ГБ оперативной памяти». */
  function labelledNumbers(attrId, spec, field, idx, taken) {
    const out = [];
    const labelRe = idx.synonymRe[attrId];
    const re = valueRegex(spec.dim, idx);
    if (!labelRe || !re) return out;
    labelRe.lastIndex = 0;
    let lm;
    while ((lm = labelRe.exec(field.text))) {
      const windowText = field.text.slice(lm.index + lm[0].length, lm.index + lm[0].length + 45);
      re.lastIndex = 0;
      let vm;
      while ((vm = re.exec(windowText))) {
        const gap = windowText.slice(0, vm.index);
        if (SENTENCE_END.test(gap)) break;
        const parsed = numberFromMatch(spec, vm, idx);
        if (!parsed) continue;
        const start = lm.index + lm[0].length + vm.index;
        if (taken.has(start)) break;
        taken.add(start);
        const pattern = gap.replace(/[\s:—–-]/g, '').length === 0 ? 'labelled' : 'context';
        out.push(hit(attrId, field, start, start + vm[0].length, parsed.value, pattern, parsed));
        break;
      }
    }
    // «8 ГБ оперативной памяти», «57 ч работы»
    re.lastIndex = 0;
    let vm;
    while ((vm = re.exec(field.text))) {
      if (taken.has(vm.index)) continue;
      const after = field.text.slice(vm.index + vm[0].length, vm.index + vm[0].length + 40);
      const lmAfter = new RegExp(`^\\s{0,2}(?:${(idx.synonyms[attrId] || []).map(phrasePattern).join('|')})`, 'iu').exec(after);
      if (!lmAfter || !(idx.synonyms[attrId] || []).length) continue;
      const parsed = numberFromMatch(spec, vm, idx);
      if (!parsed) continue;
      taken.add(vm.index);
      out.push(hit(attrId, field, vm.index, vm.index + vm[0].length, parsed.value, 'context_after', parsed));
    }
    return out;
  }

  function numberHits(attrId, spec, fields, idx) {
    const out = [];
    const re = valueRegex(spec.dim, idx);
    if (!re) return out;
    for (const field of fields) {
      const taken = new Set();
      if (field.kind === 'seller') {
        if (!sellerMatches(field, attrId, idx)) continue;
        const m = new RegExp(`${NUM_THOUSANDS}\\s*(${idx.unitRe[spec.dim]})?`, 'iu').exec(field.text);
        if (!m) continue;
        const info = m[2] ? unitInfo(spec.dim, m[2], idx) : { factor: 1 };
        const value = round(parseNum(m[1]) * info.factor);
        if (spec.range && (value < spec.range[0] || value > spec.range[1])) continue;
        out.push(hit(attrId, field, m.index, m.index + m[0].length, value, 'seller',
          { unitToken: m[2] ? util.fold(m[2]) : null, converted: info.factor !== 1 }));
        continue;
      }
      if (field.kind === 'title') {
        if (!TITLE_UNIT_ATTRS.has(attrId)) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(field.text))) {
          const parsed = numberFromMatch(spec, m, idx);
          if (parsed) out.push(hit(attrId, field, m.index, m.index + m[0].length, parsed.value, 'title_unit', parsed));
        }
        continue;
      }
      out.push(...labelledNumbers(attrId, spec, field, idx, taken));
      if (UNIT_ONLY_ATTRS.has(attrId)) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(field.text))) {
          if (taken.has(m.index)) continue;
          const parsed = numberFromMatch(spec, m, idx);
          if (parsed) out.push(hit(attrId, field, m.index, m.index + m[0].length, parsed.value, 'unit_only', parsed));
        }
      }
    }
    return out;
  }

  /** Память: «8/256GB» в названии — сразу RAM и встроенная; «16Gb/512Gb SSD» у ноутбуков; подписи в описании. */
  function memoryHits(attrId, fields, idx, categoryId) {
    const spec = schema.attr(attrId);
    const out = [];
    const units = idx.unitRe.memory;
    if (!units) return out;
    for (const field of fields) {
      if (field.kind !== 'title') {
        const generic = field.kind === 'seller'
          ? numberHits(attrId, spec, [field], idx)
          : labelledNumbers(attrId, spec, field, idx, new Set());
        out.push(...generic);
        continue;
      }
      const text = field.text;
      const pairs = [];
      const pairRe = new RegExp(`(?<![\\p{L}\\p{N}.,])(\\d{1,2})\\s*[/+]\\s*(\\d{1,4})\\s*(${units})?(?![\\p{L}\\p{N}])`, 'giu');
      let m;
      while ((m = pairRe.exec(text))) {
        const info = m[3] ? unitInfo('memory', m[3], idx) : null;
        let storage = parseNum(m[2]);
        if (storage < 16) {
          if (!info || info.factor === 1) continue;
          storage *= info.factor;
        } else if (info) {
          storage *= info.factor;
        }
        pairs.push([m.index, m.index + m[0].length]);
        const ram = parseNum(m[1]);
        if (attrId === 'ram') out.push(hit(attrId, field, m.index, m.index + m[0].length, ram, 'title_pair'));
        if (attrId === 'storage') out.push(hit(attrId, field, m.index, m.index + m[0].length, round(storage), 'title_pair', { unitToken: m[3] ? util.fold(m[3]) : null }));
      }
      const re = valueRegex('memory', idx);
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = m.index + m[0].length;
        if (pairs.some(([a, b]) => start < b && end > a)) continue;
        const parsed = numberFromMatch(spec, m, idx);
        if (!parsed) continue;
        const before = util.fold(text.slice(Math.max(0, start - 8), start));
        const after = util.fold(text.slice(end, end + 8));
        let target;
        let pattern = 'title_unit';
        if (/^\s*(ram|озу|оперативн)/.test(after)) target = 'ram';
        else if (/(ssd|hdd|emmc|накопител)/.test(after) || /(ssd|hdd|emmc|накопител)\s*$/.test(before)) target = 'storage';
        else if (parsed.value >= 32) target = 'storage';
        else if (categoryId === 'laptop' && parsed.value <= 64) { target = 'ram'; pattern = 'title_spec'; }
        if (target === attrId) out.push(hit(attrId, field, start, end, parsed.value, pattern, parsed));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Цвета, материалы, бренды — по словарям
  // ---------------------------------------------------------------------------------------------

  const JOINER = /^\s*(?:[/,&+]|-|и|and)?\s*$/iu;

  /** Соседние слова из словаря склеиваются: «белый/серый», «серебристый и белый» — одно значение из двух цветов. */
  function dictGroups(type, text, idx, from = 0, to = text.length) {
    const re = idx.re[type];
    const groups = [];
    if (!re) return groups;
    re.lastIndex = from;
    let m;
    while ((m = re.exec(text)) && m.index < to) {
      const info = idx.lookup[type].get(util.fold(m[0]));
      if (!info) continue;
      const last = groups[groups.length - 1];
      if (last && JOINER.test(text.slice(last.end, m.index))) {
        last.end = m.index + m[0].length;
        if (!last.values.includes(info.canonical)) last.values.push(info.canonical);
        last.alias = last.alias || info.alias;
      } else {
        groups.push({ start: m.index, end: m.index + m[0].length, values: [info.canonical], alias: info.alias });
      }
    }
    return groups;
  }

  function dictHits(attrId, type, fields, idx) {
    const out = [];
    for (const field of fields) {
      if (field.kind === 'seller') {
        if (!sellerMatches(field, attrId, idx)) continue;
        const groups = dictGroups(type, field.text, idx);
        if (groups.length) {
          const g = { start: groups[0].start, end: groups[groups.length - 1].end, values: [...new Set(groups.flatMap((x) => x.values))], alias: groups.some((x) => x.alias) };
          out.push(hit(attrId, field, g.start, g.end, g.values, 'seller', { alias: g.alias }));
        }
        continue;
      }
      if (field.kind === 'title') {
        for (const g of dictGroups(type, field.text, idx)) {
          out.push(hit(attrId, field, g.start, g.end, g.values, 'title_dict', { alias: g.alias, score: type === 'material' ? 0.9 : SCORE.title_dict }));
        }
        continue;
      }
      // в описании — только подписанное значение: «Цвет корпуса: серебристый и белый»
      const labelRe = idx.synonymRe[attrId];
      if (!labelRe) continue;
      labelRe.lastIndex = 0;
      let lm;
      while ((lm = labelRe.exec(field.text))) {
        const from = lm.index + lm[0].length;
        const rest = field.text.slice(from);
        const stop = rest.search(SENTENCE_END);
        const to = from + (stop === -1 ? Math.min(rest.length, 80) : stop);
        const groups = dictGroups(type, field.text, idx, from, to);
        if (!groups.length || groups[0].start - from > 18) continue;
        const g = groups[0];
        out.push(hit(attrId, field, g.start, g.end, g.values, 'labelled', { alias: g.alias, score: 0.92 }));
      }
    }
    return out;
  }

  /** «PVCR-4105-GR»: код цвета в конце артикула. Используется, только если цвета словами в тексте нет. */
  function articleColorHits(fields) {
    const out = [];
    const re = new RegExp(`(?<![\\p{L}\\p{N}])([A-Z0-9]+(?:[-_.][A-Z0-9]+)*)[-_](${Object.keys(COLOR_CODES).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    for (const field of fields.filter((f) => f.kind === 'title')) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(field.text))) {
        const codeStart = m.index + m[0].length - m[2].length;
        out.push(hit('color', field, codeStart, m.index + m[0].length, [COLOR_CODES[m[2]]], 'article_code',
          { articleCode: { code: m[2], token: m[0] } }));
      }
    }
    return out;
  }

  const COMPAT_BEFORE = /(?:для|for|под|совместим\p{L}*\s+с)\s+$/iu;

  function brandHits(fields, idx) {
    const out = [];
    const re = idx.re.brand;
    if (!re) return out;
    for (const field of fields) {
      if (field.kind === 'seller') {
        if (!sellerMatches(field, 'brand', idx)) continue;
        re.lastIndex = 0;
        const m = re.exec(field.text);
        const info = m && idx.lookup.brand.get(util.fold(m[0]));
        const value = info ? info.canonical : field.text.trim();
        out.push(hit('brand', field, m ? m.index : 0, m ? m.index + m[0].length : field.text.length, value, 'seller', { alias: info ? info.alias : false }));
        continue;
      }
      if (field.kind === 'title') {
        re.lastIndex = 0;
        let m;
        let firstSeen = false;
        while ((m = re.exec(field.text))) {
          const info = idx.lookup.brand.get(util.fold(m[0]));
          if (!info) continue;
          const compat = COMPAT_BEFORE.test(field.text.slice(Math.max(0, m.index - 30), m.index));
          const pattern = compat ? 'brand_compat' : firstSeen ? 'brand_later' : 'brand_first';
          if (!compat) firstSeen = true;
          out.push(hit('brand', field, m.index, m.index + m[0].length, info.canonical, pattern, { alias: info.alias, compat }));
        }
        continue;
      }
      // описание: только «Бренд: …», «Производитель: …»
      const labelRe = idx.synonymRe.brand;
      if (!labelRe) continue;
      labelRe.lastIndex = 0;
      let lm;
      while ((lm = labelRe.exec(field.text))) {
        re.lastIndex = lm.index + lm[0].length;
        const m = re.exec(field.text);
        if (!m || m.index - (lm.index + lm[0].length) > 4) continue;
        const info = idx.lookup.brand.get(util.fold(m[0]));
        out.push(hit('brand', field, m.index, m.index + m[0].length, info.canonical, 'labelled', { alias: info.alias, score: 0.9 }));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Модель и совместимость: текст после бренда до первого «стоп-слова»
  // ---------------------------------------------------------------------------------------------

  const STOP_WORDS = new Set(['для', 'с', 'со', 'и', 'в', 'из', 'на', 'под', 'без', 'цвет', 'bluetooth', 'wi-fi', 'wifi', '5g', '4g', 'lte', 'nfc', 'dual', 'sim', 'артикул']);
  const CPU_START = /^(intel|amd|core|ryzen|athlon|celeron|pentium|snapdragon|helio|dimensity|kirin|i[3579]-?\d*|m[1-4])$/i;

  function modelTokens(text, from, idx) {
    const tokenRe = /\S+/g;
    tokenRe.lastIndex = from;
    const tokens = [];
    let m;
    while ((m = tokenRe.exec(text)) && tokens.length < 4) {
      let token = m[0];
      const start = m.index;
      if (/^[(\[«"|—–-]/.test(token)) break;
      const trailing = /[,;)]$/.test(token);
      token = token.replace(/[,;)]+$/, '');
      const folded = util.fold(token);
      if (!token || STOP_WORDS.has(folded)) break;
      if (CPU_START.test(token.split(/[/-]/)[0])) break; // «Intel», «i5-1235U», «i5/8/512», «M3»
      if (/^\d{1,2}[/+]\d/.test(token)) break; // 8/256GB
      if (/^\d+(?:[.,]\d+)?(?:gb|гб|tb|тб|л|мл|вт|w|см|мм|м|кг|мач|mah|"|″|k|к|ч)$/i.test(token)) break;
      if (/^\d+[.,]\d+$/.test(token)) break; // 1,7 л
      const next = text.slice(start + m[0].length).trimStart().split(/\s/)[0] || '';
      if (/^\d+$/.test(token) && /^(?:gb|гб|tb|тб|л|мл|вт|w|см|мм|м|кг|мач|mah|ч|ящик\p{L}*|полок|шт)$/iu.test(next.replace(/[,.]$/, ''))) break;
      if (idx.lookup.color.has(folded) || idx.lookup.material.has(folded)) break;
      tokens.push({ token, start, end: start + token.length });
      if (trailing) break;
    }
    return tokens;
  }

  function modelHits(fields, brandList, idx) {
    const title = fields.find((f) => f.kind === 'title');
    const brand = brandList.find((h) => h.kind === 'title' && !h.compat);
    if (!title || !brand) return [];
    const tokens = modelTokens(title.text, brand.end, idx);
    if (!tokens.length) return [];
    const start = tokens[0].start;
    const end = tokens[tokens.length - 1].end;
    return [hit('model', title, start, end, title.text.slice(start, end), 'model_after_brand')];
  }

  function compatHits(fields, idx) {
    const out = [];
    const re = idx.re.brand;
    if (!re) return out;
    for (const field of fields.filter((f) => f.kind !== 'seller')) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(field.text))) {
        if (!COMPAT_BEFORE.test(field.text.slice(Math.max(0, m.index - 30), m.index))) continue;
        const info = idx.lookup.brand.get(util.fold(m[0]));
        const tokens = modelTokens(field.text, m.index + m[0].length, idx);
        const end = tokens.length ? tokens[tokens.length - 1].end : m.index + m[0].length;
        const model = field.text.slice(m.index + m[0].length, end).trim();
        const value = `${info.canonical}${model ? ` ${model}` : ''}`;
        out.push(hit('compat', field, m.index, end, value, field.kind === 'title' ? 'title_token' : 'mention', { score: field.kind === 'title' ? 0.94 : 0.85 }));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Остальные характеристики: процессор, ОС, подключение, 5G, No Frost, класс, цоколь, габариты
  // ---------------------------------------------------------------------------------------------

  const CPU_PATTERNS = [
    [/(?:intel\s+)?core\s+ultra\s+([579])\s+(\d{3}[a-z]{0,2})/iu, (m) => `Intel Core Ultra ${m[1]} ${m[2].toUpperCase()}`],
    [/(?:intel\s+)?(?:core\s+)?(?<![\p{L}\p{N}])(i[3579])[- ](\d{4,5}[a-z]{0,2})(?![\p{L}\p{N}])/iu, (m) => `Intel Core ${m[1].toLowerCase()}-${m[2].toUpperCase()}`],
    [/(?:amd\s+)?ryzen\s+([3579])\s+(\d{4}[a-z]{0,2})/iu, (m) => `AMD Ryzen ${m[1]} ${m[2].toUpperCase()}`],
    [/(?:apple\s+)?(?<![\p{L}\p{N}])(m[1-4])(?:\s+(pro|max))?(?![\p{L}\p{N}])/iu, (m) => `Apple ${m[1].toUpperCase()}${m[2] ? ` ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : ''}`],
  ];

  const OS_PATTERNS = [
    [/android(?:\s*\d+)?/iu, 'Android'],
    [/(?<![\p{L}\p{N}])iOS(?![\p{L}\p{N}])/u, 'iOS'],
    [/harmony\s*os/iu, 'HarmonyOS'],
    [/(?<![\p{L}\p{N}])(?:windows\s*11|win\s*11|w11)(?:\s*(?:home|pro))?(?![\p{L}\p{N}])/iu, 'Windows 11'],
    [/(?<![\p{L}\p{N}])(?:windows\s*10|win\s*10)(?![\p{L}\p{N}])/iu, 'Windows 10'],
    [/(?<![\p{L}\p{N}])macos(?![\p{L}\p{N}])/iu, 'macOS'],
    [/(?<![\p{L}\p{N}])(?:free\s*dos|dos|без\s+ос)(?![\p{L}\p{N}])/iu, 'Без ОС'],
    [/(?<![\p{L}\p{N}])linux(?![\p{L}\p{N}])/iu, 'Linux'],
  ];

  function patternHits(attrId, fields, patterns, idx, scores) {
    const out = [];
    for (const field of fields) {
      if (field.kind === 'seller' && !sellerMatches(field, attrId, idx)) continue;
      for (const [re, make] of patterns) {
        const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
        let m;
        while ((m = global.exec(field.text))) {
          const value = typeof make === 'function' ? make(m) : make;
          const alias = util.fold(m[0]) !== util.fold(value);
          const pattern = field.kind === 'seller' ? 'seller' : field.kind === 'title' ? scores.title : scores.description;
          out.push(hit(attrId, field, m.index, m.index + m[0].length, value, pattern, { alias }));
        }
      }
    }
    return out;
  }

  function boolHits(attrId, fields, rules) {
    const out = [];
    for (const field of fields.filter((f) => f.kind !== 'seller')) {
      for (const [re, value, scoreTitle, scoreDesc] of rules) {
        const global = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
        let m;
        while ((m = global.exec(field.text))) {
          const pattern = field.kind === 'title' ? 'title_token' : 'mention';
          out.push(hit(attrId, field, m.index, m.index + m[0].length, value, pattern, { score: field.kind === 'title' ? scoreTitle : scoreDesc }));
        }
      }
    }
    return out;
  }

  function energyHits(fields, idx) {
    const out = [];
    for (const field of fields) {
      if (field.kind === 'seller') {
        if (!sellerMatches(field, 'energy', idx)) continue;
        const m = /(?<![\p{L}\p{N}])([A-GА-В]\+{0,3})(?![\p{L}\p{N}+])/u.exec(field.text);
        if (m) out.push(hit('energy', field, m.index, m.index + m[0].length, latin(m[1]), 'seller'));
        continue;
      }
      if (field.kind === 'title') {
        const re = /(?<![\p{L}\p{N}])(A\+{1,3})(?![\p{L}\p{N}+])/gu;
        let m;
        while ((m = re.exec(field.text))) out.push(hit('energy', field, m.index, m.index + m[0].length, m[1], 'title_token', { score: 0.9 }));
        continue;
      }
      const labelRe = idx.synonymRe.energy;
      if (!labelRe) continue;
      labelRe.lastIndex = 0;
      let lm;
      while ((lm = labelRe.exec(field.text))) {
        const from = lm.index + lm[0].length;
        const m = /^[\s:—–-]{0,4}([A-GА-В]\+{0,3})(?![\p{L}\p{N}+])/u.exec(field.text.slice(from));
        if (m) out.push(hit('energy', field, from + m[0].length - m[1].length, from + m[0].length, latin(m[1]), 'labelled'));
      }
    }
    return out;
  }

  function latin(text) {
    return text.replace(/А/g, 'A').replace(/В/g, 'B');
  }

  function socketHits(fields, idx) {
    const re = /(?<![\p{L}\p{N}])(E27|E14|E40|GU10|GU5[.,]3|G9|G4)(?![\p{L}\p{N}])/giu;
    const out = [];
    for (const field of fields) {
      if (field.kind === 'seller' && !sellerMatches(field, 'socket', idx)) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(field.text))) {
        const value = m[1].toUpperCase().replace(',', '.');
        const pattern = field.kind === 'seller' ? 'seller' : field.kind === 'title' ? 'title_token' : 'mention';
        out.push(hit('socket', field, m.index, m.index + m[0].length, value, pattern, { score: field.kind === 'description' ? 0.92 : undefined }));
      }
    }
    return out;
  }

  function sizeHits(fields, idx) {
    const out = [];
    const re = new RegExp(`(?<![\\p{L}\\p{N}.,])${NUM}\\s*[xхX×*]\\s*${NUM}\\s*[xхX×*]\\s*${NUM}\\s*(см|мм|cm|mm|м)?(?![\\p{L}\\p{N}])`, 'giu');
    for (const field of fields) {
      if (field.kind === 'seller' && !sellerMatches(field, 'size', idx)) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(field.text))) {
        const unit = util.fold(m[4] || 'см');
        const factor = unit === 'мм' || unit === 'mm' ? 0.1 : unit === 'м' ? 100 : 1;
        const value = [m[1], m[2], m[3]].map((x) => round(parseNum(x) * factor));
        let pattern = null;
        if (field.kind === 'seller') pattern = 'seller';
        else if (field.kind === 'title' && m[4]) pattern = 'title_unit';
        else if (field.kind === 'description') {
          const before = util.fold(field.text.slice(Math.max(0, m.index - 28), m.index));
          if ((idx.synonyms.size || []).some((s) => before.includes(s))) pattern = 'labelled';
        }
        if (pattern) out.push(hit('size', field, m.index, m.index + m[0].length, value, pattern, { converted: factor !== 1, unitToken: unit, score: pattern === 'title_unit' ? 0.85 : undefined }));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Сборка: попадания -> кандидаты
  // ---------------------------------------------------------------------------------------------

  function valueKey(value) {
    if (Array.isArray(value)) return [...value].sort().join('|');
    if (typeof value === 'number') return String(round(value));
    return util.fold(value);
  }

  function display(attrId, value) {
    const spec = schema.attr(attrId);
    if (value == null || value === '') return '';
    if (spec.kind === 'number') {
      if (spec.dim === 'memory') return value >= 1024 && value % 1024 === 0 ? `${util.num(value / 1024)} ТБ` : `${util.num(value)} ГБ`;
      if (spec.dim === 'inch') return `${util.num(value)}″`;
      return `${util.num(value)} ${spec.unit}`;
    }
    if (spec.kind === 'dims') return `${value.map((v) => util.num(v, 1)).join(' × ')} см`;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  function group(attrId, hits) {
    const byKey = new Map();
    for (const h of hits) {
      const key = valueKey(h.value);
      if (!byKey.has(key)) {
        byKey.set(key, { id: `${attrId}:${key}`, attr: attrId, key, value: h.value, display: display(attrId, h.value), evidences: [], compat: false, articleCode: null, rejected: false });
      }
      const c = byKey.get(key);
      if (c.evidences.some((e) => e.field === h.field && e.start === h.start)) continue;
      c.evidences.push({ field: h.field, kind: h.kind, label: h.label, start: h.start, end: h.end, quote: h.quote, pattern: h.pattern, score: h.score, unitToken: h.unitToken, converted: h.converted, alias: h.alias });
      c.compat = c.compat || h.compat;
      c.articleCode = c.articleCode || h.articleCode;
    }
    const candidates = [...byKey.values()].map((c) => {
      c.evidences.sort((a, b) => FIELD_ORDER[a.kind] - FIELD_ORDER[b.kind] || b.score - a.score || a.start - b.start);
      const best = c.evidences.reduce((a, b) => (b.score > a.score ? b : a));
      const kinds = new Set(c.evidences.map((e) => e.kind));
      c.score = Math.min(0.99, round(best.score + 0.02 * (kinds.size - 1)));
      c.pattern = best.pattern;
      if (c.compat && c.evidences.some((e) => e.pattern !== 'brand_compat')) c.compat = false;
      return c;
    });
    if (attrId === 'brand') {
      // бренд — в порядке появления в названии: так видно, когда первым стоит бренд совместимого устройства
      const pos = (c) => {
        const t = c.evidences.find((e) => e.kind === 'title');
        return t ? t.start : 1000 + FIELD_ORDER[c.evidences[0].kind];
      };
      candidates.sort((a, b) => pos(a) - pos(b));
    } else {
      candidates.sort((a, b) => b.score - a.score || FIELD_ORDER[a.evidences[0].kind] - FIELD_ORDER[b.evidences[0].kind]);
    }
    return candidates;
  }

  function attrHits(attrId, fields, idx, categoryId, brandList) {
    const spec = schema.attr(attrId);
    switch (attrId) {
      case 'brand': return brandList;
      case 'model': return modelHits(fields, brandList, idx);
      case 'ram':
      case 'storage': return memoryHits(attrId, fields, idx, categoryId);
      case 'color': {
        const words = dictHits('color', 'color', fields, idx);
        return words.length ? words : articleColorHits(fields);
      }
      case 'material': return dictHits('material', 'material', fields, idx);
      case 'cpu': return patternHits('cpu', fields, CPU_PATTERNS, idx, { title: 'title_token', description: 'mention' });
      case 'os': return patternHits('os', fields, OS_PATTERNS, idx, { title: 'title_token', description: 'mention' });
      case 'connection':
        return boolHits('connection', fields, [
          [/беспроводн\p{L}*|bluetooth/iu, 'Беспроводное (Bluetooth)', 0.93, 0.86],
          [/(?<!бес)проводн\p{L}*/iu, 'Проводное', 0.93, 0.86],
        ]);
      case 'net5g':
        return boolHits('net5g', fields, [
          [/(?<![\p{L}\p{N}])5G(?![\p{L}\p{N}])(?![-\s]*(?:не|нет))/u, 'Да', 0.96, 0.9],
        ]).filter((h) => !(h.kind === 'description' && /без\s+5G|не\s+поддерживает\s+5G/iu.test(fields.find((f) => f.key === h.field).text)));
      case 'nofrost':
        return boolHits('nofrost', fields, [
          [/(?:total\s+)?no\s*frost|ноу\s*фрост/iu, 'Да', 0.95, 0.92],
          [/капельн\p{L}*\s+(?:систем\p{L}*\s+)?(?:размораживани\p{L}*)?/iu, 'Нет', 0.88, 0.86],
        ]);
      case 'energy': return energyHits(fields, idx);
      case 'socket': return socketHits(fields, idx);
      case 'size': return sizeHits(fields, idx);
      case 'compat': return compatHits(fields, idx);
      default:
        if (spec.kind === 'number') return numberHits(attrId, spec, fields, idx);
        return [];
    }
  }

  /**
   * Главная функция. input = { title, description, seller: [{ name, value }] }.
   * Возвращает { attrId: [candidates] } для всех характеристик категории.
   */
  function extract(input, categoryId, entries) {
    const category = schema.category(categoryId);
    if (!category) return {};
    const idx = buildIndex(entries);
    const fields = makeFields(input);
    const brandList = brandHits(fields, idx);
    const result = {};
    for (const attrId of category.attrs) result[attrId] = group(attrId, attrHits(attrId, fields, idx, categoryId, brandList));
    return result;
  }

  /** Категория по ключевым словам: самое раннее совпадение в названии, затем во всём тексте. */
  function detectCategory(title, description = '') {
    for (const text of [title, `${title}\n${description}`]) {
      const folded = util.fold(text);
      let best = null;
      for (const c of schema.CATEGORIES) {
        for (const kw of c.keywords) {
          const m = new RegExp(`${LB}${util.escapeRe(kw)}`, 'iu').exec(folded);
          if (m && (!best || m.index < best.index || (m.index === best.index && kw.length > best.kw.length))) {
            best = { id: c.id, index: m.index, kw };
          }
        }
      }
      if (best) return { id: best.id, keyword: best.kw, reason: `по слову «${best.kw}» в ${text === title ? 'первой строке' : 'тексте'}` };
    }
    return null;
  }

  /** Свободный текст -> название, описание и параметры «Ключ: значение» из отдельных строк. */
  function splitText(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
    const firstIndex = lines.findIndex(Boolean);
    if (firstIndex === -1) return { title: '', description: '' };
    const title = lines[firstIndex].replace(/\s+/g, ' ');
    const description = lines.slice(firstIndex + 1).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { title, description };
  }

  // ---------------------------------------------------------------------------------------------
  // Рекомендация: что делать с полем и почему. Оценка модели — не единственный аргумент.
  // ---------------------------------------------------------------------------------------------

  const WHERE = { title: 'в названии', description: 'в описании', seller: 'в параметрах продавца' };
  const SOURCE = { title: 'Название', description: 'Описание', seller: 'Параметры продавца' };

  function isSuperset(big, small) {
    return Array.isArray(big) && Array.isArray(small) && big.length > small.length && small.every((v) => big.includes(v));
  }

  function quotes(c) {
    return [...new Set(c.evidences.map((e) => `«${e.quote}»`))].join(', ');
  }

  function assess(attrId, field) {
    const spec = schema.attr(attrId);
    const active = (field.candidates || []).filter((c) => !c.rejected);
    const rejected = (field.candidates || []).filter((c) => c.rejected);
    if (!active.length) {
      return {
        kind: 'nodata',
        reason: rejected.length
          ? `Предложение «${rejected[rejected.length - 1].display}» отклонено. Других вариантов в тексте нет — внесите значение вручную или подтвердите, что характеристики в тексте нет.`
          : 'В названии, описании и параметрах продавца упоминаний не найдено. Внесите значение вручную или подтвердите, что характеристики в тексте нет.',
      };
    }
    const top = active[0];
    const next = active.find((c) => c !== top && !c.compat && !c.articleCode);
    if (top.compat) {
      return {
        kind: 'reject', proposal: top, next,
        reason: `«${top.evidences[0].quote}» стоит после «для» — это бренд совместимого устройства, а не производитель товара.${next ? ` Производитель, вероятно, «${next.display}».` : ''}`,
      };
    }
    if (top.articleCode) {
      return {
        kind: 'reject', proposal: top,
        reason: `Цвет получен из кода «${top.articleCode.code}» в артикуле ${top.articleCode.token}. Словами цвет в тексте не указан, а буквы в артикуле чаще обозначают серию или модификацию.`,
      };
    }
    if (spec.multi) {
      const sup = active.find((c) => c !== top && isSuperset(c.value, top.value));
      if (sup) {
        return {
          kind: 'complete', proposal: top, suggestion: sup,
          reason: `${SOURCE[sup.evidences[0].kind]}: «${sup.evidences[0].quote}». Предложено только «${top.display}» — рекомендуется дополнить до «${sup.display}».`,
        };
      }
    }
    const rivals = active.filter((c) => c !== top && !c.compat && !c.articleCode && !(spec.multi && isSuperset(top.value, c.value)));
    if (rivals.length) {
      const r = rivals[0];
      const a = SOURCE[top.evidences[0].kind];
      const b = SOURCE[r.evidences[0].kind];
      const who = a === b ? `Разные места текста (${a.toLowerCase()})` : `${a} и ${b.toLowerCase()}`;
      return {
        kind: 'conflict', proposal: top, rivals,
        reason: `${who} расходятся: «${top.display}» и «${r.display}». Сверьте с исходным текстом и выберите верное значение.`,
      };
    }
    const tokens = new Set(top.evidences.map((e) => e.unitToken).filter(Boolean));
    const converted = top.evidences.some((e) => e.converted);
    const alias = top.evidences.every((e) => e.alias);
    if (converted || tokens.size > 1) {
      return {
        kind: 'normalize', proposal: top,
        reason: `В тексте записано по-разному: ${quotes(top)}. Это одно значение — в каталоге оно хранится как «${top.display}».`,
      };
    }
    if (alias) {
      return {
        kind: 'normalize', proposal: top,
        reason: `В тексте: ${quotes(top)}. По словарю это «${top.display}» — так значение записывается в каталоге.`,
      };
    }
    const places = [...new Set(top.evidences.map((e) => e.kind))];
    return {
      kind: 'accept', proposal: top,
      reason: places.length > 1
        ? `Значение подтверждено в ${places.length} местах: ${places.map((p) => SOURCE[p].toLowerCase()).join(' и ')}.`
        : `Значение прямо указано ${WHERE[places[0]]}: «${top.evidences[0].quote}».`,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Ручной ввод: строка от пользователя -> значение каталога
  // ---------------------------------------------------------------------------------------------

  function parseUserValue(attrId, text, entries) {
    const spec = schema.attr(attrId);
    const raw = String(text || '').trim();
    if (!raw) return { error: 'Введите значение или подтвердите, что характеристики в тексте нет.' };
    const idx = buildIndex(entries);
    if (spec.kind === 'number') {
      const m = new RegExp(`^${NUM_THOUSANDS}\\s*(${idx.unitRe[spec.dim] || '$^'})?$`, 'iu').exec(raw);
      if (!m) return { error: `Нужно число${spec.unit ? `, например «12 ${spec.unit}»` : ''}.` };
      const info = m[2] ? unitInfo(spec.dim, m[2], idx) : { factor: 1 };
      const value = round(parseNum(m[1]) * info.factor);
      if (spec.range && (value < spec.range[0] || value > spec.range[1])) {
        return { error: `Значение вне допустимого диапазона: ${util.num(spec.range[0])}–${util.num(spec.range[1])} ${spec.unit}.` };
      }
      return { value };
    }
    if (spec.kind === 'dims') {
      const nums = raw.match(/\d+(?:[.,]\d+)?/g);
      if (!nums || nums.length !== 3) return { error: 'Нужно три числа: ширина × глубина × высота, в сантиметрах.' };
      return { value: nums.map((n) => round(parseNum(n))) };
    }
    if (spec.kind === 'bool') {
      const f = util.fold(raw);
      if (['да', 'есть', 'yes'].includes(f)) return { value: 'Да' };
      if (['нет', 'no'].includes(f)) return { value: 'Нет' };
      return { error: 'Выберите «Да» или «Нет».' };
    }
    if (spec.dict) {
      const parts = raw.split(/\s*(?:,|\/|\sи\s)\s*/).filter(Boolean);
      const values = parts.map((p) => (idx.lookup[spec.dict].get(util.fold(p)) || { canonical: util.fold(p) }).canonical);
      return { value: [...new Set(values)] };
    }
    if (spec.kind === 'brand') {
      const info = idx.lookup.brand.get(util.fold(raw));
      return { value: info ? info.canonical : raw };
    }
    if (spec.options) {
      const option = spec.options.find((o) => util.fold(o) === util.fold(raw));
      return { value: option || raw };
    }
    return { value: raw.replace(/\s+/g, ' ') };
  }

  /** Как подставить значение в поле ввода при исправлении. */
  function editText(attrId, value) {
    const spec = schema.attr(attrId);
    if (value == null) return '';
    if (spec.kind === 'number') return util.num(value, 3).replace(/ /g, ' ');
    if (spec.kind === 'dims') return value.map((v) => util.num(v, 1)).join(' × ');
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  A.extractor = { extract, assess, detectCategory, splitText, display, parseUserValue, editText, buildIndex, valueKey, PATTERN_NAMES, SOURCE, WHERE };
})();
