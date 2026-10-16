/* Automation (what the system does by itself) and analytics (operations + model quality, kept apart). */
(function () {
  const A = ATLAS.app, M = ATLAS.model;
  const { esc, icon, on, nf, pct } = A;
  const DAY = 86400000;
  const ui = (A.ui.stats = { group: "", period: 30, category: "" });

  const inGroup = (c, g) => !g || (A.cat(c.category) && A.cat(c.category).group === g);
  const inCat = (c, k) => !k || (k.startsWith("g:") ? inGroup(c, k.slice(2)) : c.category === k);
  const share = (a, b) => (b ? a / b : 0);

  function bar(rows, { max, fmt = nf, unit = "" } = {}) {
    const m = max || Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.v, 0)));
    return `<div class="hbars">${rows.map((r) => {
      const tot = r.parts.reduce((s, p) => s + p.v, 0);
      return `<div class="hbar"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="tr" role="img" aria-label="${esc(r.label)}: ${esc(r.title || fmt(tot) + unit)}">${r.parts.map((p) => `<i class="${p.cls}" style="width:${(p.v / m) * 100}%" title="${esc(p.name)}: ${fmt(p.v)}${unit}"></i>`).join("")}</span>
        <span class="val">${esc(r.value != null ? r.value : fmt(tot) + unit)}</span></div>`;
    }).join("")}</div>`;
  }

  /* --------------------------------------------------------- automation */
  function automation() {
    const cards = A.S.cards.filter((c) => inGroup(c, ui.group));
    const s = M.fieldStats(cards);
    const all = cards.length, done = s.cards;
    const ready = cards.filter((c) => M.status(c) === "ready").length;
    const seg = (v, cls, name) => (v ? `<i class="${cls}" style="width:${share(v, s.total) * 100}%" title="${name}: ${nf(v)}"></i>` : "");
    const waitNoConf = s.waiting - s.conflict;
    const byCat = Object.values(ATLAS.CATEGORIES).map((k) => {
      const cs = cards.filter((c) => c.category === k.key);
      const st = M.fieldStats(cs);
      return { k, st };
    }).filter((x) => x.st.total).sort((a, b) => b.st.automation - a.st.automation);
    const groups = ["", ...ATLAS.GROUPS].map((g) => `<button aria-pressed="${ui.group === g}" data-act="au-group" data-g="${esc(g)}">${g || "Все"}</button>`).join("");
    return `<div class="page-head"><div><h1>Автоматизация</h1><p class="sub">Какую часть работы система берёт на себя и что остаётся человеку. Все числа считаются по тем же карточкам, что в каталоге, и меняются после каждого решения.</p></div>
        <div class="seg" role="group" aria-label="Группа категорий">${groups}</div></div>
      <div class="section">
        <div class="headline"><span class="pct num">${pct(s.automation)}</span>
          <div><p class="frac"><b>${nf(s.auto)}</b> из <b>${nf(s.total)}</b> полей приняты системой автоматически, без участия человека.</p>
          <p class="muted">Считаем по всем характеристикам обработанных карточек (${nf(done)} ${M.plural(done, "карточка", "карточки", "карточек")}). Поле, которое человек затем исправил или отклонил, перестаёт считаться автоматическим.</p></div></div>
        <div class="dist" role="img" aria-label="Распределение полей по решениям">${seg(s.auto, "c-auto", "Принято автоматически")}${seg(s.accepted, "c-acc", "Принято человеком")}${seg(s.corrected, "c-cor", "Исправлено человеком")}${seg(s.absent, "c-abs", "Подтверждено отсутствие")}${seg(s.conflict, "c-conf", "Противоречие")}${seg(waitNoConf, "c-wait", "Ждут решения")}</div>
        <div class="legend">
          <span><i class="c-auto"></i>Принято автоматически: <b class="num">${nf(s.auto)}</b></span>
          <span><i class="c-acc"></i>Принято человеком: <b class="num">${nf(s.accepted)}</b></span>
          <span><i class="c-cor"></i>Исправлено: <b class="num">${nf(s.corrected)}</b></span>
          <span><i class="c-abs"></i>Подтверждено отсутствие: <b class="num">${nf(s.absent)}</b></span>
          <span><i class="c-conf"></i>Противоречия: <b class="num">${nf(s.conflict)}</b></span>
          <span><i class="c-wait"></i>Ждут решения: <b class="num">${nf(waitNoConf)}</b></span>
        </div>
      </div>
      <div class="section"><h2>Путь поля от текста до выгрузки</h2>
        <div class="flow">
          <div><span class="fl-step">1</span><span class="fl-n">${nf(all)}</span><span class="fl-k">карточек в каталоге</span><span class="fl-s">из них обработано системой ${nf(done)}</span></div>
          <div><span class="fl-step">2</span><span class="fl-n">${nf(s.prepared)}</span><span class="fl-k">полей подготовлено системой</span><span class="fl-s">из ${nf(s.total)}: для остальных в тексте нет значения</span></div>
          <div><span class="fl-step">3</span><span class="fl-n">${nf(s.auto)}</span><span class="fl-k">принято автоматически</span><span class="fl-s">${pct(share(s.auto, s.prepared))} подготовленных</span></div>
          <div><span class="fl-step">4</span><span class="fl-n">${nf(s.human)}</span><span class="fl-k">проверено человеком</span><span class="fl-s">принято ${nf(s.accepted)}, исправлено ${nf(s.corrected)}, нет в тексте ${nf(s.absent)}</span></div>
          <div><span class="fl-step">5</span><span class="fl-n">${nf(ready)}</span><span class="fl-k">карточек готово к выгрузке</span><span class="fl-s">ждут решения ${nf(s.waiting)} ${M.plural(s.waiting, "поле", "поля", "полей")}</span></div>
        </div></div>
      <div class="section"><h2>Как система решает, что принять самой</h2>
        <div class="rules">
          <div><b>Принимается автоматически, если одновременно</b><ul><li>значение прямо написано в тексте или параметрах продавца;</li><li>оценка модели не ниже 0,9;</li><li>источники не противоречат друг другу, а значение не требует нормализации.</li></ul></div>
          <div><b>Всегда идёт человеку</b><ul><li>расхождение описания и параметров продавца;</li><li>часть артикула или бренд совместимого устройства;</li><li>найден не весь набор значений (например, один из двух цветов);</li><li>значения нет в тексте.</li></ul></div>
          <div><b>Что не считается автоматизацией</b><ul><li>поле, исправленное человеком после системы;</li><li>предложение, которое человек принял вручную;</li><li>скорость обработки: она не равна сэкономленному времени сотрудника.</li></ul></div>
        </div></div>
      <div class="section"><h2>По категориям</h2><p class="lead">Доля полей, принятых автоматически. Тёмная часть — автоматически, светлая — проверено человеком, штриховка — ждёт решения.</p>
        ${bar(byCat.map(({ k, st }) => ({ label: k.name, value: `${pct(st.automation)}`, parts: [
          { v: st.auto, cls: "c-auto", name: "Автоматически" }, { v: st.human, cls: "c-acc", name: "Человеком" }, { v: st.waiting, cls: "c-wait", name: "Ждут решения" }] })), { max: Math.max(...byCat.map((x) => x.st.total)), unit: " полей" })}
        <p class="muted small" style="margin-top:8px">Длина полосы — число полей в категории; число справа — доля автоматически принятых.</p></div>`;
  }

  /* --------------------------------------------------------- analytics */
  function analytics() {
    const t0 = ui.period ? A.now() - ui.period * DAY : 0;
    const cards = A.S.cards.filter((c) => inCat(c, ui.category));
    const ids = new Set(cards.map((c) => c.id));
    const ev = A.S.events.filter((e) => e.t >= t0 && (ids.has(e.cardId) || (!ui.category && !A.card(e.cardId))));
    const human = ev.filter((e) => e.by === "human");
    const st = { ready: 0, open: 0, fresh: 0 };
    for (const c of cards) { const s = M.status(c); if (s === "ready") st.ready++; else if (s === "new" || s === "processing") st.fresh++; else st.open++; }
    // when a card became ready = its last decision
    const readyAt = cards.filter((c) => M.status(c) === "ready").map((c) => Math.max(...c.fields.map((f) => f.decidedAt || 0))).filter((t) => t >= t0);
    const days = ui.period || Math.max(7, Math.ceil((A.now() - Math.min(...A.S.cards.map((c) => c.createdAt))) / DAY));
    const step = days > 45 ? 7 : 1;
    const nb = Math.ceil(days / step);
    const bins = Array(nb).fill(0);
    for (const t of readyAt) { const i = nb - 1 - Math.floor((A.now() - t) / (DAY * step)); if (i >= 0 && i < nb) bins[i]++; }
    const bmax = Math.max(1, ...bins);
    const byCat = {};
    for (const e of human) {
      const k = e.category || "—";
      byCat[k] = byCat[k] || { n: 0, cards: new Set() };
      byCat[k].n++; byCat[k].cards.add(e.cardId);
    }
    const work = Object.entries(byCat).map(([k, v]) => ({ k, n: v.n, per: v.n / v.cards.size })).sort((a, b) => b.n - a.n).slice(0, 10);
    const byField = {};
    for (const e of human) if (e.action === "correct" || e.action === "reject" || e.action === "absent") {
      const k = e.field;
      byField[k] = byField[k] || { correct: 0, reject: 0, absent: 0 };
      byField[k][e.action]++;
    }
    const fields = Object.entries(byField).map(([k, v]) => ({ k, ...v, n: v.correct + v.reject + v.absent })).sort((a, b) => b.n - a.n).slice(0, 10);
    const probs = Object.values(ATLAS.CATEGORIES).map((k) => {
      const cs = cards.filter((c) => c.category === k.key && c.stage === "done");
      const conf = cs.filter((c) => M.status(c) === "conflict").length;
      const rev = cs.filter((c) => M.status(c) === "review").length;
      return { k, n: cs.length, conf, rev, sh: share(conf + rev, cs.length) };
    }).filter((x) => x.n && (!ui.category || x.n)).sort((a, b) => b.sh - a.sh).slice(0, 10);
    const fs = M.fieldStats(cards);
    const autoEv = ev.filter((e) => e.action === "auto").length;
    const catOpts = ATLAS.GROUPS.map((g) => `<optgroup label="${esc(g)}"><option value="g:${esc(g)}" ${ui.category === "g:" + g ? "selected" : ""}>Вся группа «${esc(g)}»</option>${Object.values(ATLAS.CATEGORIES).filter((c) => c.group === g)
      .map((c) => `<option value="${c.key}" ${ui.category === c.key ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("");
    const periods = [[7, "7 дней"], [30, "30 дней"], [90, "90 дней"], [0, "Всё время"]];
    const axisLabel = (i) => { const d = new Date(A.now() - (nb - 1 - i) * step * DAY); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); };
    return `<div class="page-head"><div><h1>Аналитика</h1><p class="sub">Работа с каталогом и качество моделей — отдельно. Операционные показатели считаются по решениям в Атласе за выбранный период.</p></div></div>
      <div class="filters-line"><div class="seg" role="group" aria-label="Период">${periods.map(([v, l]) => `<button aria-pressed="${ui.period === v}" data-act="an-period" data-v="${v}">${l}</button>`).join("")}</div>
        <select data-on="an-cat" aria-label="Категория"><option value="">Все категории</option>${catOpts}</select>
        ${ui.category ? `<button class="btn ghost" data-act="an-reset">Сбросить категорию</button>` : ""}</div>

      <h2 style="margin:6px 0 10px">Работа с каталогом</h2>
      <div class="section"><div class="kv">
        <div><b>${nf(st.ready)}</b><span>карточек готово к выгрузке</span></div>
        <div><b>${nf(st.open)}</b><span>требуют проверки</span></div>
        <div><b>${nf(st.fresh)}</b><span>новых, ещё не обработаны</span></div>
        <div><b>${nf(readyAt.length)}</b><span>стали готовыми за период</span></div>
        <div><b>${nf(human.length)}</b><span>ручных решений за период</span></div>
        <div><b>${pct(fs.automation)}</b><span>полей принято автоматически (${nf(fs.auto)} из ${nf(fs.total)})</span></div></div></div>
      <div class="section"><div class="chart-title">Сколько карточек стали готовыми к выгрузке</div><div class="chart-unit">Карточек за ${step === 7 ? "неделю" : "день"}; карточка считается готовой в момент последнего решения по её полям</div>
        <div class="vbars" role="img" aria-label="Готовые карточки по ${step === 7 ? "неделям" : "дням"}">${bins.map((v, i) => `<i style="height:${(v / bmax) * 100}%" title="${axisLabel(i)}: ${v}"></i>`).join("")}</div>
        <div class="vaxis"><span>${axisLabel(0)}</span><span>${axisLabel(Math.floor(nb / 2))}</span><span>${axisLabel(nb - 1)}</span></div></div>
      <div class="grid2" style="margin-top:16px">
        <div class="section"><div class="chart-title">Где больше всего ручной работы</div><div class="chart-unit">Ручных решений за период по категориям; в скобках — в среднем на карточку</div>
          ${work.length ? bar(work.map((w) => ({ label: A.catName(w.k), value: `${nf(w.n)} (${w.per.toFixed(1).replace(".", ",")})`, parts: [{ v: w.n, cls: "c-acc", name: "Ручных решений" }] }))) : '<p class="muted">За период ручных решений нет.</p>'}</div>
        <div class="section"><div class="chart-title">Какие характеристики чаще исправляют и отклоняют</div><div class="chart-unit">Решений за период, где человек не согласился с системой или значения не нашлось</div>
          ${fields.length ? bar(fields.map((f) => ({ label: f.k, value: nf(f.n), parts: [{ v: f.correct, cls: "c-cor", name: "Исправлено" }, { v: f.reject, cls: "c-conf", name: "Отклонено" }, { v: f.absent, cls: "c-abs", name: "Подтверждено отсутствие" }] })))
            + `<div class="legend" style="margin-top:10px"><span><i class="c-cor"></i>исправлено</span><span><i class="c-conf"></i>отклонено предложение</span><span><i class="c-abs"></i>значения нет в тексте</span></div>` : '<p class="muted">За период исправлений и отклонений нет.</p>'}</div>
        <div class="section"><div class="chart-title">Какие категории создают больше проблем</div><div class="chart-unit">Доля обработанных карточек, где сейчас есть противоречие или поля без решения</div>
          ${bar(probs.map((p) => ({ label: p.k.name, value: pct(p.sh), parts: [{ v: p.conf / p.n, cls: "c-conf", name: "Противоречие" }, { v: p.rev / p.n, cls: "c-wait", name: "Требует проверки" }] })), { max: 1, fmt: pct })}
          <div class="legend" style="margin-top:10px"><span><i class="c-conf"></i>противоречие</span><span><i class="c-wait"></i>требует проверки</span><span class="muted">полоса целиком — 100 % карточек категории</span></div></div>
        <div class="section"><div class="chart-title">Доля автоматизации</div><div class="chart-unit">Поля, принятые системой, от всех полей обработанных карточек</div>
          <div class="headline" style="margin-top:6px"><span class="pct num" style="font-size:2.6rem">${pct(fs.automation)}</span><p>${nf(fs.auto)} из ${nf(fs.total)} полей. За период система приняла автоматически ${nf(autoEv)} ${M.plural(autoEv, "значение", "значения", "значений")}, людьми принято ${nf(human.length)} ${M.plural(human.length, "решение", "решения", "решений")}.</p></div>
          <p style="margin-top:10px"><a href="#/automation">Подробнее о том, что считается автоматизацией</a></p></div>
      </div>

      <h2 style="margin:26px 0 10px">Качество моделей</h2>
      <div class="section quality"><p class="lead">Отдельная оценка извлечения на отложенной выборке карточек каталога М.Видео, которых модели не видели при обучении. Эталон — характеристики каталога. Эти числа не зависят от фильтров выше.</p>
        <div style="overflow-x:auto"><table class="q-tbl"><thead><tr><th>Подход и выборка</th><th class="n">Карточек</th><th class="n">Precision</th><th class="n">Recall</th><th class="n">F1</th><th>Что важно знать</th></tr></thead><tbody>
          <tr><td>NER на CRF, весь каталог (8 доменов, 195 характеристик)</td><td class="n">78 414</td><td class="n">0,943</td><td class="n">0,279</td><td class="n">0,431</td><td class="small">Recall ограничен текстом: только 29 % значений каталога есть в тексте карточек. По значениям, которые в тексте есть, F1 = 0,905.</td></tr>
          <tr><td>Правила и словари, весь каталог</td><td class="n">78 414</td><td class="n">0,786</td><td class="n">0,211</td><td class="n">0,333</td><td class="small">Тот же эталон и те же карточки.</td></tr>
          <tr><td>NER на CRF, 4 категории электроники</td><td class="n">3 245</td><td class="n">0,974</td><td class="n">0,367</td><td class="n">0,533</td><td class="small">Отдельная модель с подробной схемой (46 характеристик); macro-F1 по характеристикам 0,548.</td></tr>
          <tr><td>Дообученный трансформер, LLM</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="small">На этой выборке не оценивались.</td></tr>
        </tbody></table></div>
        <div class="rules" style="margin-top:12px">
          <div><b>Оценка модели в карточке — не точность</b><ul><li>Это уверенность модели в конкретном фрагменте. Измеренная точность — Precision в таблице выше.</li></ul></div>
          <div><b>Скорость — техническая метрика</b><ul><li>Обработка занимает 2–6 мс на карточку на обычном процессоре. Это не доказанное сокращение рабочего времени сотрудника.</li></ul></div>
        </div></div>`;
  }

  A.views.automation = { render: automation };
  A.views.analytics = { render: analytics };
  on("click", "au-group", (el) => { ui.group = el.dataset.g; A.render(); });
  on("click", "an-period", (el) => { ui.period = +el.dataset.v; A.render(); });
  on("change", "an-cat", (el) => { ui.category = el.value; A.render(); });
  on("click", "an-reset", () => { ui.category = ""; A.render(); });
})();
