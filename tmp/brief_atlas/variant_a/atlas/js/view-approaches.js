/* Four approaches to the same task, on one card at a time. */
(function () {
  const A = ATLAS.app;
  const { esc, icon, on } = A;
  const D = ATLAS.APPROACHES;
  const ui = (A.ui.ap = { card: "h1" });
  const MARK = {
    ok: ["check", "st-accepted", "совпадает"], diff: ["complete", "st-pending", "частично"], wrong: ["reject", "st-conflict", "ошибка"],
    miss: ["nodata", "st-nodata", "не найдено"], extra: ["conflict", "st-conflict", "нет в тексте"],
  };

  A.views.approaches = {
    render() {
      const cd = D.cards[ui.card];
      const c = A.card(ui.card);
      const names = [...Object.keys(cd.truth), ...new Set(Object.values(cd.results).flatMap((r) => Object.keys(r)).filter((k) => !(k in cd.truth)))];
      const cell = (m, f) => {
        const r = cd.results[m.key][f];
        if (!r) return `<td class="cell"><span class="m st-nodata">${icon("nodata")}—</span></td>`;
        const [v, src, mk] = r;
        const [ic, cls, word] = MARK[mk];
        return `<td class="cell"><span class="m ${cls}">${icon(ic)}${v ? esc(v) : word}</span>${src ? `<span class="src">${esc(src)}</span>` : ""}</td>`;
      };
      const sum = (m) => {
        const vals = Object.values(cd.results[m.key]);
        const k = (x) => vals.filter((v) => v[2] === x).length;
        return `<td>${k("ok")} совпало${k("diff") ? `, ${k("diff")} частично` : ""}${k("miss") ? `, ${k("miss")} не найдено` : ""}${k("wrong") ? `, ${k("wrong")} ошибка` : ""}${k("extra") ? `, ${k("extra")} лишнее` : ""}</td>`;
      };
      const chips = Object.keys(D.cards).map((id) => {
        const x = A.card(id);
        return `<button aria-pressed="${ui.card === id}" data-act="ap-card" data-id="${id}">${esc(x ? x.name.replace(/,.*$/, "") : id)}</button>`;
      }).join("");
      return `<div class="page-head"><div><h1>Четыре подхода</h1><p class="sub">Команда решает одну задачу четырьмя способами. Ниже — как каждый подход справляется с одной и той же карточкой и чем они различаются в работе.</p></div></div>
        <div class="ap-grid">${D.methods.map((m) => `<div><h3>${esc(m.name)}</h3><p class="ap-how">${esc(m.how)}</p>
          <p class="ap-good"><b>Сильная сторона.</b> ${esc(m.good)}</p><p class="ap-bad"><b>Слабая сторона.</b> ${esc(m.bad)}</p></div>`).join("")}</div>

        <div class="section" style="margin-top:16px"><h2>Одна карточка — четыре результата</h2>
          <p class="lead">Выберите товар. В таблице — что нашёл каждый подход, откуда взято значение и совпадает ли оно с проверенным. Результаты подготовлены заранее для сравнения.</p>
          <div class="seg" role="group" aria-label="Карточка" style="flex-wrap:wrap">${chips}</div>
          ${c ? `<div class="src-block" style="margin-top:14px"><div class="src-label">Текст карточки</div><div class="src-text"><b>${esc(c.text.title)}</b>. ${esc(c.text.description)}${(c.text.seller || []).length ? ` <span class="muted">Параметры продавца: ${c.text.seller.map((p) => `${esc(p.name)} — ${esc(p.value)}`).join("; ")}.</span>` : ""}</div>
            <p style="margin-top:6px"><a href="#/card/${c.id}">Открыть эту карточку на проверке</a></p></div>` : ""}
          <div class="list" style="margin-top:14px"><table class="ap-res" style="min-width:820px"><thead><tr><th>Характеристика</th><th>Проверенное значение</th>${D.methods.map((m) => `<th>${esc(m.name)}</th>`).join("")}</tr></thead>
            <tbody>${names.map((f) => `<tr><td><b>${esc(f)}</b></td><td>${f in cd.truth ? esc(cd.truth[f]) : '<span class="muted">нет в тексте</span>'}</td>${D.methods.map((m) => cell(m, f)).join("")}</tr>`).join("")}
            <tr class="ap-sum"><td>Итого</td><td></td>${D.methods.map(sum).join("")}</tr></tbody></table></div>
          <div class="legend" style="margin-top:10px">${Object.values(MARK).map(([ic, cls, w]) => `<span class="${cls}">${icon(ic)}${w}</span>`).join("")}</div></div>

        <div class="section"><h2>Сравнение по качеству, скорости, стоимости и обучению</h2>
          <p class="lead">У каждого числа указано, где и как оно получено. «Ожидание» — оценка, а не результат эксперимента.</p>
          <div style="overflow-x:auto"><table class="cmp" style="min-width:760px"><thead><tr><th></th>${D.methods.map((m) => `<th>${esc(m.name)}</th>`).join("")}</tr></thead><tbody>
            ${[["quality", "Качество"], ["speed", "Скорость"], ["cost", "Стоимость"], ["training", "Обучение"]].map(([k, l]) =>
              `<tr><th>${l}</th>${D.methods.map((m) => `<td>${esc(m[k].v)}<span class="ctx">${esc(m[k].ctx)}</span></td>`).join("")}</tr>`).join("")}
          </tbody></table></div></div>`;
    },
  };
  on("click", "ap-card", (el) => { ui.card = el.dataset.id; A.render(); });
})();
