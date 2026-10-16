/* Четыре подхода к одной задаче: правила и словари, NER на CRF, дообученный трансформер, LLM.
   Колонка «Правила и словари» считается тем же извлекателем, что и весь продукт.
   Остальные три колонки — подготовленные примеры типичного поведения (см. seed.js и README), не замер качества. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store, extractor, seed } = A;
  const { esc } = util;
  A.views = A.views || {};

  const APPROACHES = [
    { id: 'rules', name: 'Правила и словари', tag: 'шаблоны + словари' },
    { id: 'ner', name: 'NER на CRF', tag: 'разметка слов в тексте' },
    { id: 'transformer', name: 'Дообученный трансформер', tag: 'нейросеть, понимает контекст' },
    { id: 'llm', name: 'LLM', tag: 'большая языковая модель' },
  ];

  const HOW = [
    ['Как читает текст', [
      'Ищет знакомые шаблоны: «8/256GB», «Цвет: …», слова из словарей.',
      'Помечает каждое слово: «это бренд», «это объём памяти». Учится на размеченных примерах.',
      'Читает предложение целиком и выделяет фрагмент-ответ с учётом контекста.',
      'Читает описание как человек и отвечает по инструкции.',
    ]],
    ['Что нужно для запуска', [
      'Шаблоны и словари; калибровка уверенности по размеченным карточкам. Без видеокарты.',
      'Разметка слов в обучающих карточках и обучение на обычном процессоре.',
      'Разметка и дообучение готовой модели, желательно с видеокартой.',
      'Без обучения: инструкция и несколько примеров. Платный сервис или мощная локальная модель.',
    ]],
    ['Сильная сторона', [
      'Предсказуемо и быстро; у каждого значения есть цитата.',
      'Находит значения в новых формулировках, если похожие были в обучении.',
      'Лучше всех различает контекст: «для Samsung» — не бренд товара.',
      'Справляется с новыми категориями и необычными формулировками без подготовки.',
    ]],
    ['Где ошибается', [
      'Не видит формы записи, которых нет в шаблонах и словарях.',
      'Путает похожие сущности, сам не приводит единицы к виду каталога.',
      'Нужны данные и время на обучение; медленнее правил.',
      'Может назвать правдоподобное значение, которого в тексте нет.',
    ]],
    ['Чем подтверждает значение', [
      'Всегда: цитата и шаблон, по которому найдено.',
      'Размеченный фрагмент текста.',
      'Фрагмент текста и уверенность модели.',
      'Цитату нужно отдельно запрашивать — и проверять, что она есть в тексте.',
    ]],
  ];

  const COMPARE = [
    ['Качество на общем наборе', [
      ['F1 0,918 · точность 0,975 · полнота 0,867', 'measured', 'проверочная часть каталога, 81 912 карточек'],
      ['Ещё не измерено', 'none', 'нет прогона на общем наборе'],
      ['Ещё не измерено', 'none', 'нет прогона на общем наборе'],
      ['Ещё не измерено', 'none', 'нет прогона на общем наборе'],
    ]],
    ['Скорость', [
      ['≈ 0,2 мс на карточку, обычный процессор', 'measured', 'техническая скорость, не время сотрудника'],
      ['Миллисекунды на карточку, процессор', 'expected', ''],
      ['Десятки миллисекунд, лучше с видеокартой', 'expected', ''],
      ['Секунды на карточку, зависит от сервиса', 'expected', ''],
    ]],
    ['Стоимость работы', [
      ['Только сервер', 'expected', ''],
      ['Только сервер', 'expected', ''],
      ['Видеокарта для обучения, желательно и для работы', 'expected', ''],
      ['Оплата за каждую карточку или мощный сервер', 'expected', ''],
    ]],
    ['Нужно ли обучение', [
      ['Словари и калибровка по обучающей части: ≈ 6 минут на процессоре', 'measured', ''],
      ['Да: разметка слов и обучение', 'expected', ''],
      ['Да: разметка и дообучение, часы на видеокарте', 'expected', ''],
      ['Нет: инструкция и 3–5 примеров', 'expected', ''],
    ]],
  ];

  // короткие подписи карточек для переключателя
  const LABELS = { 30074402: 'Смартфон TECNO', 80051290: 'Чайник Kitfort', 13004410: 'Защитное стекло Mietubl', 12007731: 'Лампа Arte Lamp' };

  function cardOptions() {
    return Object.keys(seed.approaches).map((sku) => store.state.cards.find((c) => c.sku === sku)).filter(Boolean);
  }

  /** Результат правил на исходном тексте — тем же извлекателем, без учёта решений сотрудников. */
  function rulesResult(card) {
    const found = extractor.extract(card.input, card.category, store.state.dict);
    const out = {};
    for (const [attr, candidates] of Object.entries(found)) {
      const a = extractor.assess(attr, { candidates, decision: null });
      if (!a.proposal) {
        out[attr] = null;
        continue;
      }
      const notes = { conflict: 'Нашли противоречие — отдаст человеку', reject: 'Сами рекомендуют отклонить', complete: `Есть полный вариант: ${a.suggestion && a.suggestion.display}`, normalize: 'Приведено к виду каталога' };
      out[attr] = { v: a.proposal.display, q: a.proposal.evidences[0].quote, note: notes[a.kind] || '' };
    }
    return out;
  }

  function cell(approach, attr, r, picked) {
    const on = picked && picked.approach === approach && picked.attr === attr;
    if (!r) return `<td><span class="cell ${on ? 'is-on' : ''}" data-act="ap-pick" data-approach="${approach}" data-attr="${attr}"><span class="gap">— не найдено</span></span></td>`;
    return `<td><span class="cell ${on ? 'is-on' : ''}" data-act="ap-pick" data-approach="${approach}" data-attr="${attr}">
      <span class="cv">${esc(r.v)}</span>
      ${r.q ? `<span class="muted" style="font-size:12.5px">«${esc(r.q)}»</span>` : `<span class="flag t-bad">${icons.glyph('conflict', 12)} нет цитаты в тексте</span>`}
      ${r.note ? `<span class="muted" style="font-size:12.5px">${esc(r.note)}</span>` : ''}
    </span></td>`;
  }

  function sourceWithQuote(card, quote) {
    const parts = [['Название', card.input.title], ['Описание', card.input.description], ...card.input.seller.map((p) => [`Параметры продавца · ${p.name}`, String(p.value)])];
    return parts.filter(([, t]) => t).map(([label, text]) => {
      let html = esc(text);
      if (quote) {
        const i = text.indexOf(quote);
        if (i >= 0) html = `${esc(text.slice(0, i))}<span class="ev is-on">${esc(quote)}</span>${esc(text.slice(i + quote.length))}`;
      }
      return `<div style="margin-bottom:8px"><div class="source-label">${esc(label)}</div><p class="source-text">${html}</p></div>`;
    }).join('');
  }

  function render() {
    const options = cardOptions();
    const sku = store.state.ui.approaches.sku;
    const card = options.find((c) => c.sku === sku) || options[0];
    const prepared = seed.approaches[card.sku];
    const results = { rules: rulesResult(card), ner: prepared.ner, transformer: prepared.transformer, llm: prepared.llm };
    const attrs = schema.category(card.category).attrs;
    const picked = A.app.temp.apPick && A.app.temp.apPick.sku === card.sku ? A.app.temp.apPick : null;
    const pickedResult = picked ? results[picked.approach][picked.attr] : null;
    const summary = APPROACHES.map((ap) => {
      const r = results[ap.id];
      const found = attrs.filter((a) => r[a]).length;
      const noQuote = attrs.filter((a) => r[a] && !r[a].q).length;
      return { found, noQuote };
    });
    const diffRow = (attr) => {
      const values = APPROACHES.map((ap) => results[ap.id][attr]).filter(Boolean).map((r) => util.fold(r.v));
      return new Set(values).size > 1 || (values.length > 0 && values.length < APPROACHES.length);
    };

    return `
    <div class="page">
      <div class="page-head"><div><h1>Четыре подхода к одной задаче</h1>
        <p class="sub">Все четыре читают одно и то же описание и должны вернуть одни и те же характеристики. Разница — в том, как они это делают, что им нужно и как они подтверждают ответ.</p></div></div>

      <section class="panel" style="margin-bottom:18px;overflow-x:auto" aria-label="Как работают подходы">
        <div class="approach-grid">
          <div class="rh ch"></div>
          ${APPROACHES.map((ap) => `<div class="ch"><strong>${ap.name}</strong><small>${ap.tag}</small></div>`).join('')}
          ${HOW.map(([label, cols]) => `<div class="rh">${label}</div>${cols.map((c) => `<div>${esc(c)}</div>`).join('')}`).join('')}
        </div>
      </section>

      <h2 class="section-title">На одной карточке</h2>
      <div class="filters-row">
        <div class="seg" role="group" aria-label="Карточка для сравнения">
          ${options.map((c) => `<button class="${c.sku === card.sku ? 'is-on' : ''}" data-act="ap-card" data-sku="${c.sku}">${esc(LABELS[c.sku] || c.title)}</button>`).join('')}
        </div>
        <a class="link-btn" href="#/card/${card.id}">Открыть карточку на проверке ${icons.icon('arrow')}</a>
      </div>
      <div class="dict-layout" style="margin-bottom:18px">
        <section class="panel" style="overflow-x:auto">
          <table class="cmp">
            <thead><tr><th>Характеристика</th>${APPROACHES.map((ap, i) => `<th>${ap.name}<br><span style="text-transform:none;letter-spacing:0;font-weight:400">найдено ${summary[i].found} из ${attrs.length}${summary[i].noQuote ? ` · без цитаты: ${summary[i].noQuote}` : ''}</span></th>`).join('')}</tr></thead>
            <tbody>${attrs.map((attr) => `<tr class="${diffRow(attr) ? 'is-diff' : ''}"><td class="attr">${esc(schema.attr(attr).name)}</td>${APPROACHES.map((ap) => cell(ap.id, attr, results[ap.id][attr], picked)).join('')}</tr>`).join('')}</tbody>
          </table>
          <p class="muted" style="margin:0;padding:10px 12px;font-size:13px">«≠» — подходы ответили по-разному или кто-то не нашёл значение. Нажмите на ячейку, чтобы увидеть, откуда взят ответ.
            Ответы NER, трансформера и LLM — подготовленные примеры типичного поведения подходов, а не замер качества.</p>
        </section>
        <section class="panel panel-pad sticky" aria-label="Исходный текст карточки">
          <h2 style="font-size:16px;margin-bottom:8px">Исходный текст</h2>
          ${picked ? `<p style="margin:0 0 10px;font-size:14px"><b>${esc(APPROACHES.find((a) => a.id === picked.approach).name)}</b> · ${esc(schema.attr(picked.attr).name)}:
            ${pickedResult ? (pickedResult.q ? 'подчёркнут фрагмент, на который опирается ответ.' : '<span class="t-bad">цитаты нет — значение не подтверждено текстом.</span>') : 'значение не найдено.'}</p>` : '<p class="muted" style="margin:0 0 10px;font-size:13.5px">Выберите ячейку в таблице.</p>'}
          ${sourceWithQuote(card, pickedResult && pickedResult.q)}
        </section>
      </div>

      <h2 class="section-title">Сравнение</h2>
      <section class="panel" style="overflow-x:auto">
        <table class="cmp">
          <thead><tr><th></th>${APPROACHES.map((ap) => `<th>${ap.name}</th>`).join('')}</tr></thead>
          <tbody>${COMPARE.map(([label, cols]) => `<tr><td class="attr">${label}</td>${cols.map(([text, kind, note]) => `<td>${esc(text)}<br>${kind === 'measured' ? '<span class="tag-measured">замер</span>' : kind === 'expected' ? '<span class="tag-expected">ожидание</span>' : '<span class="tag-expected">нет данных</span>'}${note ? ` <span class="muted" style="font-size:12.5px">${esc(note)}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        <p class="muted" style="margin:0;padding:10px 12px;font-size:13px">«Замер» — измерено командой на общем наборе. «Ожидание» — оценка команды до эксперимента: заменится замером после прогона подхода на тех же 81 912 карточках.</p>
      </section>
    </div>`;
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'ap-card': (el) => {
        A.app.temp.apPick = null;
        store.setUi({ approaches: { sku: el.dataset.sku } });
      },
      'ap-pick': (el) => {
        A.app.temp.apPick = { sku: store.state.ui.approaches.sku, approach: el.dataset.approach, attr: el.dataset.attr };
        A.app.render();
      },
    },
  });

  A.views.approaches = { render, title: () => 'Четыре подхода' };
})();
