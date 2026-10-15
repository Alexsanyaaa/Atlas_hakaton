/* Аналитика: операционные показатели работы с каталогом отдельно от качества моделей.
   Все цифры считаются из тех же карточек, что и каталог, и меняются после каждого решения. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store } = A;
  const { esc } = util;
  A.views = A.views || {};

  const PERIODS = { 7: '7 дней', 30: '30 дней', all: 'Всё время' };

  // Замер полной версии ветки «Правила и словари» (Python) на проверочной части каталога.
  const QUALITY = {
    context: 'Проверочная часть каталога: 81 912 карточек, которые не использовались при настройке. Правильный ответ — значения из параметров каталога.',
    overall: { p: 0.975, r: 0.867, f1: 0.918 },
    byCategory: [
      ['Смартфоны', 1850, 0.985, 0.91, 0.946],
      ['Ноутбуки', 535, 0.974, 0.666, 0.791],
      ['Планшеты', 309, 0.981, 0.766, 0.86],
      ['Остальные товары (бренд, модель, цвет)', 79218, 0.974, 0.869, 0.918],
    ],
  };

  function scopeCards() {
    const f = store.state.ui.analytics;
    return store.state.cards.filter((c) => f.category === 'all' || c.category === f.category);
  }

  function since() {
    const p = store.state.ui.analytics.period;
    return p === 'all' ? 0 : util.startOfDay(Date.now()) - (Number(p) - 1) * util.DAY;
  }

  /** События решений за период: кто принял решение и какое. */
  function decisionEvents(cards, from) {
    const events = [];
    for (const card of cards) {
      for (const [attr, f] of Object.entries(card.fields || {})) {
        if (f.decision && f.decision.at >= from) events.push({ attr, category: card.category, type: f.decision.type, by: f.decision.by, at: f.decision.at });
        for (const c of f.candidates) if (c.rejected && c.rejectedAt >= from) events.push({ attr, category: card.category, type: 'rejected', by: 'user', at: c.rejectedAt });
      }
    }
    return events;
  }

  // --- Графики ------------------------------------------------------------------------------------

  function dailyChart(events, from) {
    const today = util.startOfDay(Date.now());
    const firstDay = from ? util.startOfDay(from) : Math.min(today - 29 * util.DAY, ...events.map((e) => util.startOfDay(e.at)));
    const days = [];
    for (let d = firstDay; d <= today; d += util.DAY) days.push(d);
    const buckets = days.map((d) => ({ d, auto: 0, human: 0 }));
    for (const e of events) {
      if (e.type === 'rejected') continue;
      const i = Math.round((util.startOfDay(e.at) - firstDay) / util.DAY);
      if (i < 0 || i >= buckets.length) continue;
      if (e.by === 'system') buckets[i].auto += 1;
      else buckets[i].human += 1;
    }
    const max = Math.max(4, ...buckets.map((b) => b.auto + b.human));
    const step = max <= 10 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20;
    const top = Math.ceil(max / step) * step;
    const W = 1000;
    const H = 230;
    const left = 44;
    const bottom = 30;
    const plotW = W - left - 8;
    const plotH = H - bottom - 14;
    const bw = plotW / buckets.length;
    const y = (v) => 14 + plotH - (v / top) * plotH;
    let svg = '';
    for (let v = 0; v <= top; v += step) svg += `<line class="grid" x1="${left}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const every = buckets.length > 14 ? Math.ceil(buckets.length / 10) : 1;
    buckets.forEach((b, i) => {
      const x = left + i * bw + bw * 0.18;
      const w = bw * 0.64;
      if (b.auto) svg += `<rect x="${x}" y="${y(b.auto)}" width="${w}" height="${y(0) - y(b.auto)}" fill="var(--ok)"><title>${util.date(b.d)}: автоматически ${b.auto}</title></rect>`;
      if (b.human) svg += `<rect x="${x}" y="${y(b.auto + b.human)}" width="${w}" height="${y(b.auto) - y(b.auto + b.human)}" fill="var(--accent)"><title>${util.date(b.d)}: людьми ${b.human}</title></rect>`;
      if (i % every === 0 || i === buckets.length - 1) svg += `<text x="${left + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle">${util.date(b.d)}</text>`;
    });
    svg += `<line class="axis" x1="${left}" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}"/>`;
    svg += `<text x="4" y="10" style="font-size:11px">полей</text>`;
    const totalAuto = buckets.reduce((s, b) => s + b.auto, 0);
    const totalHuman = buckets.reduce((s, b) => s + b.human, 0);
    return { svg: `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Решения по полям по дням: автоматически ${totalAuto}, людьми ${totalHuman}">${svg}</svg>`, totalAuto, totalHuman };
  }

  function hbars(rows, series, unit) {
    const max = Math.max(1, ...rows.map((r) => series.reduce((s, k) => s + r[k.key], 0)));
    if (!rows.length) return '<p class="muted">За выбранный период данных нет.</p>';
    return `<div class="hbar-list">${rows.map((r) => {
      const total = series.reduce((s, k) => s + r[k.key], 0);
      return `<div class="hbar"><span>${esc(r.label)}</span>
        <span class="track" role="img" aria-label="${esc(r.label)}: ${series.map((k) => `${k.label} ${r[k.key]}`).join(', ')}">${series.map((k) => (r[k.key] ? `<span style="width:${(r[k.key] / max) * 100}%;background:${k.color}" title="${k.label}: ${r[k.key]}"></span>` : '')).join('')}</span>
        <span class="val">${total} ${unit}</span></div>`;
    }).join('')}</div>
    <ul class="legend" style="margin-top:12px">${series.map((k) => `<li><span class="swatch" style="background:${k.color}"></span>${k.label}</li>`).join('')}</ul>`;
  }

  // --- Экран ----------------------------------------------------------------------------------------

  function render() {
    const f = store.state.ui.analytics;
    const cards = scopeCards();
    const from = since();
    const m = store.metrics(cards);
    const events = decisionEvents(cards, from);
    const readyInPeriod = cards.filter((c) => c.readyAt && c.readyAt >= from).length;
    const daily = dailyChart(events, from);
    const st = m.statuses;
    const remaining = st.conflict + st.review + st.new + st.processing;

    // ручная работа по категориям: сделано людьми за период + ждёт сейчас
    const byCat = schema.CATEGORIES.map((c) => {
      const cc = cards.filter((x) => x.category === c.id);
      if (!cc.length) return null;
      const mm = store.metrics(cc);
      const done = events.filter((e) => e.category === c.id && e.by === 'user').length;
      return { id: c.id, label: c.name, done, waiting: mm.waiting, cards: cc.length, m: mm };
    }).filter(Boolean);
    const manual = [...byCat].sort((a, b) => b.done + b.waiting - (a.done + a.waiting)).filter((r) => r.done + r.waiting > 0);

    // что исправляют и отклоняют
    const byAttr = {};
    for (const e of events) {
      if (!['corrected', 'rejected'].includes(e.type)) continue;
      byAttr[e.attr] = byAttr[e.attr] || { label: schema.attr(e.attr).name, corrected: 0, rejected: 0 };
      byAttr[e.attr][e.type] += 1;
    }
    const fixes = Object.values(byAttr).sort((a, b) => b.corrected + b.rejected - (a.corrected + a.rejected)).slice(0, 8);
    const reviewed = events.filter((e) => e.by === 'user' && ['accepted', 'corrected', 'rejected'].includes(e.type));
    const acceptedAsIs = reviewed.filter((e) => e.type === 'accepted').length;

    const segs = [['conflict', st.conflict], ['review', st.review], ['new', st.new + st.processing], ['ready', st.ready]];
    const segColor = { conflict: 'var(--bad)', review: '#d29a3c', new: 'var(--accent)', ready: 'var(--ok)' };
    const segLabel = { conflict: 'Противоречие', review: 'Требуется проверка', new: 'Новые и в обработке', ready: 'Готово к выгрузке' };

    return `
    <div class="page">
      <div class="page-head"><div><h1>Аналитика</h1><p class="sub">Как идёт работа с каталогом и где система экономит ручной труд. Качество моделей — отдельным блоком ниже.</p></div></div>
      <div class="filters-row">
        <div class="seg" role="group" aria-label="Период">${Object.entries(PERIODS).map(([k, v]) => `<button class="${f.period === k ? 'is-on' : ''}" data-act="an-period" data-period="${k}" aria-pressed="${f.period === k}">${v}</button>`).join('')}</div>
        <select class="select" style="width:auto" data-change="an-category" aria-label="Категория">
          <option value="all">Все категории</option>
          ${schema.CATEGORIES.map((c) => `<option value="${c.id}" ${f.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        <span class="muted" style="font-size:13.5px">Период влияет на решения и готовые карточки; остаток работы — на текущий момент.</span>
      </div>

      <div class="an-grid">
        <section class="panel chart-card wide">
          <h2>Сколько карточек готово и сколько осталось</h2>
          <p class="q">Статус каждой карточки на текущий момент, карточек</p>
          <div class="kpi-line">
            <span><span class="big num">${st.ready}</span> <span class="cap">из ${cards.length} готовы к выгрузке</span></span>
            <span><span class="big num">${remaining}</span> <span class="cap">осталось: противоречия — ${st.conflict}, проверка — ${st.review}, новые — ${st.new + st.processing}</span></span>
            <span><span class="big num">${readyInPeriod}</span> <span class="cap">стали готовыми за ${f.period === 'all' ? 'всё время' : `последние ${PERIODS[f.period]}`}</span></span>
          </div>
          <div class="stackbar" role="img" aria-label="${segs.map(([k, v]) => `${segLabel[k]}: ${v}`).join(', ')}">
            ${segs.map(([k, v]) => (v ? `<span style="width:${(v / Math.max(1, cards.length)) * 100}%;background:${segColor[k]}" title="${segLabel[k]}: ${v}"></span>` : '')).join('')}
          </div>
          <ul class="legend">${segs.map(([k, v]) => `<li><span class="swatch" style="background:${segColor[k]}"></span>${segLabel[k]} <b>${v}</b></li>`).join('')}</ul>
        </section>

        <section class="panel chart-card wide">
          <h2>Кто принимает решения по полям</h2>
          <p class="q">Решения за день, полей: <span class="t-ok">■</span> система приняла автоматически · <span class="t-info">■</span> сотрудник подтвердил, исправил или отметил отсутствие</p>
          ${daily.svg}
          <p style="margin:10px 0 0;color:var(--ink-2)">За период: <b>${daily.totalAuto}</b> ${util.plural(daily.totalAuto, ['решение', 'решения', 'решений'])} принято системой, <b>${daily.totalHuman}</b> — людьми.
            Сейчас в каталоге автоматизировано <b>${util.pct(m.auto, m.applicable)}</b> применимых полей (${m.auto} из ${m.applicable}).</p>
        </section>

        <section class="panel chart-card">
          <h2>Где больше всего ручной работы</h2>
          <p class="q">Решения сотрудников за период и поля, которые ждут решения сейчас, полей</p>
          ${hbars(manual.map((r) => ({ label: r.label, done: r.done, waiting: r.waiting })), [
            { key: 'done', label: 'Сделано людьми', color: 'var(--accent)' },
            { key: 'waiting', label: 'Ждёт решения', color: '#d29a3c' },
          ], 'п.')}
        </section>

        <section class="panel chart-card">
          <h2>Какие характеристики чаще исправляют и отклоняют</h2>
          <p class="q">За период, решений. ${reviewed.length ? `Из ${reviewed.length} проверенных человеком предложений без изменений принято ${acceptedAsIs} (${util.pct(acceptedAsIs, reviewed.length)}).` : ''}</p>
          ${hbars(fixes, [
            { key: 'corrected', label: 'Исправлено человеком', color: 'var(--accent)' },
            { key: 'rejected', label: 'Предложение отклонено', color: 'var(--bad)' },
          ], '')}
        </section>

        <section class="panel chart-card wide">
          <h2>Какие категории создают больше проблем</h2>
          <p class="q">Текущее состояние. Доля автоматизации — поля, принятые системой, от всех применимых полей категории.</p>
          <div class="table-wrap"><table class="metric-table">
            <thead><tr><th>Категория</th><th class="n">Карточек</th><th class="n">С противоречием</th><th class="n">На проверке</th><th class="n">Полей ждут решения</th><th class="n">Исправлено людьми</th><th class="n">Автоматизация</th></tr></thead>
            <tbody>${[...byCat].sort((a, b) => (b.m.waiting / Math.max(1, b.m.applicable)) - (a.m.waiting / Math.max(1, a.m.applicable))).map((r) => `
              <tr><td>${esc(r.label)}</td><td class="n">${r.cards}</td><td class="n">${r.m.statuses.conflict || '—'}</td><td class="n">${r.m.statuses.review || '—'}</td>
              <td class="n">${r.m.waiting}</td><td class="n">${r.m.corrected || '—'}</td>
              <td class="n">${r.m.applicable ? `${util.pct(r.m.auto, r.m.applicable)} <span class="muted">(${r.m.auto}/${r.m.applicable})</span>` : '<span class="muted">не обработаны</span>'}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>
      </div>

      <section class="quality" aria-label="Качество моделей">
        <h2>Качество извлечения — оценка моделей</h2>
        <p class="lead">Этот блок не про работу сотрудников, а про то, насколько часто система права. ${QUALITY.context}</p>
        <div class="table-wrap"><table class="metric-table">
          <thead><tr><th>Подход</th><th class="n">Точность (Precision)</th><th class="n">Полнота (Recall)</th><th class="n">F1</th><th>Статус</th></tr></thead>
          <tbody>
            <tr><td><b>Правила и словари</b> — полная версия</td><td class="n">${util.num(QUALITY.overall.p, 3)}</td><td class="n">${util.num(QUALITY.overall.r, 3)}</td><td class="n"><b>${util.num(QUALITY.overall.f1, 3)}</b></td><td><span class="tag-measured">замер</span> 81 912 карточек</td></tr>
            ${['NER на CRF', 'Дообученный трансформер', 'LLM'].map((n) => `<tr><td>${n}</td><td class="n muted">—</td><td class="n muted">—</td><td class="n muted">—</td><td><span class="tag-expected">не измерено</span> ещё нет прогона на общем наборе</td></tr>`).join('')}
          </tbody></table></div>
        <div class="section-title" style="margin-top:16px">Правила и словари по категориям каталога</div>
        <div class="table-wrap"><table class="metric-table">
          <thead><tr><th>Категория</th><th class="n">Карточек в проверке</th><th class="n">Точность</th><th class="n">Полнота</th><th class="n">F1</th></tr></thead>
          <tbody>${QUALITY.byCategory.map(([n, c, p, r, f1]) => `<tr><td>${n}</td><td class="n">${util.num(c, 0)}</td><td class="n">${util.num(p, 3)}</td><td class="n">${util.num(r, 3)}</td><td class="n">${util.num(f1, 3)}</td></tr>`).join('')}</tbody>
        </table></div>
        <ul class="notes">
          <li><b>Точность</b> — доля верных среди значений, которые система заполнила. <b>Полнота</b> — доля найденных среди всех значений, известных по каталогу. <b>F1</b> объединяет обе.</li>
          <li><b>Оценка модели у поля — не точность.</b> Это доля верных решений такого же типа на обучающих данных. На проверочной части значения с оценкой не ниже 0,99 оказались верны в 99,8% случаев — поэтому оценке можно доверять, но решение всё равно опирается на цитату.</li>
          <li><b>0,2 мс на карточку</b> — техническая скорость извлечения на обычном процессоре. Это не время сотрудника: экономию рабочего времени этот показатель не доказывает.</li>
          <li>Категории полной версии (смартфоны, ноутбуки, планшеты, остальные товары) отличаются от рабочих категорий этого каталога: замер сделан на всём каталоге магазина.</li>
        </ul>
      </section>
    </div>`;
  }

  A.app_pending_handlers = A.app_pending_handlers || [];
  A.app_pending_handlers.push({
    actions: {
      'an-period': (el) => store.setUi({ analytics: { ...store.state.ui.analytics, period: el.dataset.period } }),
    },
    changes: {
      'an-category': (el) => store.setUi({ analytics: { ...store.state.ui.analytics, category: el.value } }),
    },
  });

  A.views.analytics = { render, title: () => 'Аналитика' };
})();
