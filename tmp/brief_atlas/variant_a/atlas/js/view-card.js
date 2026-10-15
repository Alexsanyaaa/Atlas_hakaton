/* Review of one card: source text <-> characteristic <-> quote <-> recommendation <-> decision. */
(function () {
  const A = ATLAS.app, M = ATLAS.model, E = ATLAS.engine;
  const { esc, icon, on, nf } = A;
  const ui = (A.ui.review = { cardId: null, key: null, src: 0, editing: false, editingTitle: false, err: "" });
  const SHORT = { accept: "проверьте", normalize: "нормализовать", complete: "дополнить", conflict: "расхождение", reject: "отклонить?", nodata: "нет в тексте", empty: "кандидат отклонён" };

  const fieldOf = (c, key) => c.fields.find((f) => f.key === key);
  const undecided = (f) => !M.FIELD_STATE[f.state].decided;
  const ORDER = { conflict: 0, pending: 1, empty: 2, nodata: 3 };
  function problems(c) {
    return c.fields.filter(undecided).sort((a, b) => ORDER[a.state] - ORDER[b.state] || c.fields.indexOf(a) - c.fields.indexOf(b));
  }
  function srcText(c, id) {
    if (id === "title") return c.text.title || "";
    if (id === "description") return c.text.description || "";
    const i = +id.split(":")[1];
    return String((c.text.seller[i] || {}).value || "");
  }
  function srcLabel(cand) { return cand.param ? `Параметры продавца: ${cand.param}` : cand.sourceLabel; }

  /* --------------------------------------------------------- source pane: thin underlines with field numbers */
  function spanKind(f, cnd) {
    if (cnd.rejected) return "k-rej";
    if (f.state === "conflict" || (undecided(f) && f.rec.code === "reject" && M.proposal(f) === cnd)) return "k-bad";
    if (f.state === "auto") return "k-auto";
    if (f.state === "accepted" || f.state === "corrected") return "k-ok";
    return "k-pend";
  }
  function marked(c, id, text) {
    const spans = [];
    c.fields.forEach((f, i) => f.candidates.forEach((cnd) => {
      if (cnd.source !== id || cnd.start == null || cnd.start < 0) return;
      spans.push({ s: cnd.start, e: cnd.end, f, n: i + 1, kind: spanKind(f, cnd), on: f.key === ui.key });
      for (const o of cnd.others || []) spans.push({ s: o.start, e: o.end, f, n: i + 1, kind: spanKind(f, cnd), on: f.key === ui.key });
    }));
    spans.sort((a, b) => a.s - b.s || b.on - a.on);
    let out = "", pos = 0;
    for (const sp of spans) {
      if (sp.s < pos || sp.e > text.length) continue;
      out += esc(text.slice(pos, sp.s)) + `<span class="ev ${sp.kind} ${sp.on ? "on" : ""}" data-act="pick-field" data-key="${sp.f.key}" title="${esc(sp.f.name)}">${esc(text.slice(sp.s, sp.e))}<sup>${sp.n}</sup></span>`;
      pos = sp.e;
    }
    return out + esc(text.slice(pos));
  }
  function sourcePane(c) {
    const seller = (c.text.seller || []).map((p, i) => `<tr><td>${esc(p.name)}</td><td>${marked(c, "seller:" + i, String(p.value))}</td></tr>`).join("");
    return `<section class="pane p-src" aria-labelledby="h-src"><div class="pane-h"><h2 id="h-src">Исходный текст</h2>
        <span class="muted small">Подчёркнутые фрагменты — найденные значения, номер — характеристика</span></div>
      <div class="pane-b">
        <div class="src-block"><div class="src-label">Заголовок</div><div class="src-text src-title">${marked(c, "title", c.text.title || "")}</div></div>
        <div class="src-block"><div class="src-label">Описание</div><div class="src-text">${c.text.description ? marked(c, "description", c.text.description) : '<span class="muted">Описания нет — продавец передал только заголовок</span>'}</div></div>
        <div class="src-block"><div class="src-label">Параметры продавца</div>${seller ? `<table class="src-params">${seller}</table>` : '<span class="muted small">Продавец не передал параметры</span>'}</div>
      </div></section>`;
  }

  /* --------------------------------------------------------- fields pane */
  function frow(c, f) {
    const i = c.fields.indexOf(f) + 1;
    const prop = M.proposal(f);
    let val;
    if (f.state === "absent") val = `<span class="fv">отсутствует в тексте</span>`;
    else if (M.FIELD_STATE[f.state].decided) val = `<span class="fv">${esc(f.value)}</span>`;
    else if (f.state === "conflict") val = `<span class="fv proposed">${[...new Set(f.candidates.filter((x) => !x.rejected).map((x) => x.value))].map(esc).join(" или ")} <span class="tag">— ${SHORT.conflict}</span></span>`;
    else if (prop) val = `<span class="fv proposed">${esc(prop.value)} <span class="tag">— ${SHORT[f.rec.code] || ""}</span></span>`;
    else val = `<span class="fv"><span class="tag">${SHORT[f.rec.code] || "нет данных"}</span></span>`;
    return `<li><button class="frow" data-act="pick-field" data-key="${f.key}" aria-current="${f.key === ui.key}">
      <span class="st-${f.state}">${icon(A.FIELD_ICON[f.state])}</span><span class="fn">${esc(f.name)}</span><span class="fidx">${i}</span>${val}</button></li>`;
  }
  function fieldsPane(c) {
    const open = problems(c);
    const done = c.fields.filter((f) => !undecided(f));
    return `<section class="pane" aria-labelledby="h-fields"><div class="pane-h"><h2 id="h-fields">Характеристики</h2><span class="muted small">${c.fields.length} полей</span></div>
      ${open.length ? `<div class="fgroup"><span>Требуют решения</span><span>${open.length}</span></div><ul class="fields">${open.map((f) => frow(c, f)).join("")}</ul>` : ""}
      ${done.length ? `<div class="fgroup"><span>Готово</span><span>${done.length}</span></div><ul class="fields">${done.map((f) => frow(c, f)).join("")}</ul>` : ""}
    </section>`;
  }

  /* --------------------------------------------------------- detail: the evidence */
  function quote(c, cnd) {
    const text = srcText(c, cnd.source);
    if (cnd.source.startsWith("seller:")) {
      return `<blockquote><span class="q-val">${esc(text.slice(cnd.start, cnd.end))}</span>${esc(text.slice(cnd.end))}</blockquote>`;
    }
    let a = cnd.start, b = cnd.end;
    const lo = Math.min(a, ...(cnd.others || []).map((o) => o.start));
    while (a > 0 && !/[.!?\n]/.test(text[a - 1]) && cnd.start - a < 110) a--;
    a = Math.min(a, lo);
    while (b < text.length && !/[.!?\n]/.test(text[b]) && b - cnd.end < 110) b++;
    if (b < text.length && /[.!?]/.test(text[b])) b++;
    const marks = [{ s: cnd.start, e: cnd.end, cls: "q-val" }, ...(cnd.others || []).map((o) => ({ s: o.start, e: o.end, cls: "q-other" }))].sort((x, y) => x.s - y.s);
    let out = a > 0 ? "…" : "", pos = a;
    for (const m of marks) { out += esc(text.slice(pos, m.s)) + `<span class="${m.cls}">${esc(text.slice(m.s, m.e))}</span>`; pos = m.e; }
    out += esc(text.slice(pos, b)).trimEnd() + (b < text.length ? "…" : "");
    return `<blockquote>${out}</blockquote>`;
  }

  function evidence(c, f) {
    const list = f.candidates.filter((x) => !x.rejected);
    if (!list.length) {
      return `<div class="evidence k-none"><span class="bracket"></span><div><div class="ev-src"><span>Подтверждение</span></div>
        <p class="ev-none">${f.state === "empty" ? "Все предложенные фрагменты отклонены. Других упоминаний этой характеристики в тексте нет." : "В заголовке, описании и параметрах продавца это значение не встречается."}</p></div></div>`;
    }
    let i = Math.min(ui.src, list.length - 1);
    if (M.FIELD_STATE[f.state].decided && f.value && ui.src === 0) {
      const k = list.findIndex((x) => x.value === f.value);
      if (k > 0) i = k;
    }
    const cnd = list[i];
    const kind = f.state === "conflict" || (undecided(f) && f.rec.code === "reject" && i === 0) ? "k-bad" : M.FIELD_STATE[f.state].decided ? "k-ok" : "";
    const pager = list.length > 1 ? `<span class="ev-pager"><button data-act="src-step" data-d="-1" aria-label="Предыдущий источник" ${i === 0 ? "disabled" : ""}>‹</button>
      <span>${i + 1} из ${list.length}</span><button data-act="src-step" data-d="1" aria-label="Следующий источник" ${i === list.length - 1 ? "disabled" : ""}>›</button></span>` : "";
    return `<div class="evidence ${kind}"><span class="bracket"></span><div>
      <div class="ev-src"><span>${esc(srcLabel(cnd))}${list.length > 1 ? ` · значение «${esc(cnd.value)}»` : ""}</span>${pager}</div>
      ${quote(c, cnd)}
      <div class="score" title="Уверенность модели в этом фрагменте. Это не проверенная точность.">Оценка модели <span class="num">${A.dec2(cnd.score)}</span>
        <span class="track"><i style="width:${Math.round(cnd.score * 100)}%"></i></span><span class="muted">уверенность, не точность</span></div>
    </div></div>`;
  }

  function decidedBox(f) {
    const by = f.decidedAt ? A.when(f.decidedAt) : "";
    const t = { auto: `Принято автоматически ${by}: значение прямо подтверждено текстом, оценка модели ${A.dec2(f.score)} не ниже 0,9.`,
      accepted: `Принято вами ${by}.`, corrected: `Исправлено вами ${by}. Оценка модели к ручному значению не относится.`,
      absent: `Вы подтвердили ${by}, что в тексте этой характеристики нет.` }[f.state];
    return `<div class="decided">${A.fieldMark(f)}<span>${esc(t)}</span></div>`;
  }

  function actions(c, f) {
    const prop = M.proposal(f);
    const code = f.rec.code;
    const b = (act, label, cls = "", extra = "") => `<button class="btn ${cls}" data-act="${act}" data-key="${f.key}" ${extra}>${label}</button>`;
    if (ui.editing) return editForm(f);
    if (M.FIELD_STATE[f.state].decided) {
      return `<div class="d-actions">${b("f-edit", "Исправить значение")}${prop && f.state !== "absent" ? b("f-reject", "Отклонить предложение") : ""}
        ${f.state !== "absent" ? b("f-absent", "Подтвердить отсутствие") : ""}</div>`;
    }
    if (code === "conflict") {
      const opts = f.candidates.map((x, i) => [x, i]).filter(([x]) => !x.rejected);
      const uniq = [];
      for (const [x, i] of opts) if (!uniq.some(([y]) => y.norm === x.norm)) uniq.push([x, i]);
      return `<div class="choice">${uniq.map(([x, i]) => `<button data-act="f-choose" data-key="${f.key}" data-i="${i}"><b>Оставить «${esc(x.value)}»</b>
          <span>${esc(srcLabel(x))}: «${esc(x.raw)}»</span></button>`).join("")}</div>
        <div class="d-actions" style="margin-top:8px">${b("f-edit", "Указать другое значение")}</div>`;
    }
    if (code === "nodata" || code === "empty") {
      return `<div class="d-actions">${b("f-edit", "Указать значение", "primary")}${b("f-absent", "Подтвердить отсутствие")}</div>
        <p class="d-note">«Подтвердить отсутствие» фиксирует, что вы проверили текст и характеристики в нём нет. Это отдельное решение, а не отклонение предложения.</p>`;
    }
    let main = "";
    if (code === "complete") main = b("f-complete", `Дополнить: «${esc(f.rec.suggest)}»`, "primary") + b("f-accept", `Принять только «${esc(prop.value)}»`);
    else if (code === "reject") main = b("f-reject", "Отклонить предложение", "primary") + b("f-accept", "Принять всё равно");
    else main = b("f-accept", `Принять «${esc(prop.value)}»`, "primary");
    return `<div class="d-actions">${main}${b("f-edit", "Исправить")}${code !== "reject" ? b("f-reject", "Отклонить предложение") : ""}</div>
      <p class="d-note">Отклонение убирает только это предложение: если в тексте есть другие варианты, вы увидите следующий. Чтобы отметить, что характеристики нет, используйте «Подтвердить отсутствие» после отклонения.</p>`;
  }

  function editForm(f) {
    const cur = f.value || (M.proposal(f) || {}).value || "";
    const spec = (ATLAS.CATEGORIES[A.card(ui.cardId).category] || { fields: [] }).fields.find((x) => x.key === f.key) || {};
    let input;
    if (spec.kind === "enum") {
      input = `<select data-on="f-edit-val" id="f-edit-input"><option value="">Выберите значение</option>${spec.options.map(([o]) => `<option ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.kind === "num") {
      const n = String(cur).replace(/[^\d,.]/g, "");
      input = `<input type="text" id="f-edit-input" inputmode="decimal" value="${esc(n)}" aria-label="Значение, ${esc(f.unit)}"><span class="muted">${esc(f.unit)}</span>`;
    } else {
      input = `<input type="text" id="f-edit-input" value="${esc(cur)}" aria-label="Значение">`;
    }
    return `<form data-on="f-save" data-key="${f.key}"><label class="fld">Новое значение</label><div class="edit-row">${input}</div>
      ${ui.err ? `<p class="notice bad small" style="margin-top:8px">${esc(ui.err)}</p>` : ""}
      <div class="d-actions" style="margin-top:8px"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" data-act="f-edit-cancel">Отмена</button></div>
      <p class="d-note">Ручное значение сохраняется как ваше решение, без оценки модели.</p></form>`;
  }

  function detail(c, f) {
    const prop = M.proposal(f);
    const decided = M.FIELD_STATE[f.state].decided;
    let big;
    if (f.state === "absent") big = `<span class="v placeholder">Отсутствует в тексте</span>`;
    else if (decided) big = `<span class="v">${esc(f.value)}</span>`;
    else if (f.state === "conflict") big = `<span class="v">${[...new Set(f.candidates.filter((x) => !x.rejected).map((x) => x.value))].map(esc).join(" / ")}</span>`;
    else if (prop) big = `<span class="v">${esc(prop.value)}</span>`;
    else big = `<span class="v placeholder">Значение не найдено</span>`;
    const norm = prop && E.needsNormalize(prop) && !decided ? `<span class="norm">В тексте: <s>${esc(prop.raw)}</s> → в каталоге: <b>${esc(prop.value)}</b></span>` : "";
    const rejected = f.candidates.filter((x) => x.rejected);
    const why = !decided && f.rec.code === "accept" && prop && prop.score < M.AUTO_MIN_SCORE
      ? `<span class="r-text">Автоматически не принято: оценка модели ${A.dec2(prop.score)} ниже порога 0,9.</span>` : "";
    return `<section class="pane detail" aria-labelledby="h-detail"><div class="pane-b">
      <div class="d-head"><div><span class="muted small">Характеристика ${c.fields.indexOf(f) + 1}</span><h2 id="h-detail">${esc(f.name)}</h2></div>${A.fieldMark(f)}</div>
      <div class="d-value">${big}${norm}</div>
      ${decided ? decidedBox(f) : ""}
      ${evidence(c, f)}
      ${decided ? "" : `<div class="rec c-${f.rec.code}">${icon(A.REC_ICON[f.rec.code] || "pending")}<span class="r-title">${esc(f.rec.title)}</span><span class="r-text">${esc(f.rec.text)}</span>${why}</div>`}
      ${actions(c, f)}
      ${rejected.length ? `<div class="cands"><span class="muted">Отклонённые предложения:</span><ul>${rejected.map((x) => `<li class="rej">«${esc(x.raw)}» → ${esc(x.value)} (${esc(srcLabel(x))})</li>`).join("")}</ul></div>` : ""}
    </div></section>`;
  }

  /* --------------------------------------------------------- header */
  function head(c) {
    const list = A.catalogList();
    const pos = list.findIndex((x) => x.id === c.id);
    const prev = pos > 0 ? list[pos - 1] : null, next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;
    const p = M.progress(c);
    const auto = c.fields.filter((f) => f.state === "auto").length;
    const undo = A.lastUndoFor(c.id);
    const cats = ATLAS.GROUPS.map((g) => `<optgroup label="${esc(g)}">${Object.values(ATLAS.CATEGORIES).filter((x) => x.group === g)
      .map((x) => `<option value="${x.key}" ${c.category === x.key ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
    const title = ui.editingTitle
      ? `<form data-on="title-save" class="edit-row"><input type="text" id="title-input" value="${esc(c.name)}" aria-label="Название"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" data-act="title-cancel">Отмена</button></form>`
      : `<h1>${esc(c.name)} <button class="btn ghost small" data-act="title-edit">Изменить название</button></h1>`;
    return `<div class="rv-head"><div class="rv-title">
        <div class="rv-meta"><a class="back" href="#/catalog">${icon("back")}Каталог${pos >= 0 ? `, карточка ${pos + 1} из ${list.length}` : ""}</a>
          ${prev ? `<a class="btn ghost small" href="#/card/${prev.id}">${icon("back")}Предыдущая</a>` : ""}${next ? `<a class="btn ghost small" href="#/card/${next.id}">Следующая${icon("next")}</a>` : ""}</div>
        ${title}
        <div class="rv-meta"><span>Артикул <span class="mono">${esc(c.sku)}</span></span>
          <label>Категория <select data-on="cat-change" aria-label="Категория товара">${c.category ? "" : '<option value="">Не определена</option>'}${cats}</select></label>
          ${A.statusChip(M.status(c))}</div>
      </div>
      <div class="rv-progress">
        <span><b class="num">${p.done}</b> из ${p.total} полей проверено</span>
        <span class="bigbar" role="img" aria-label="${auto} принято автоматически, ${p.done - auto} проверено вами"><i class="a" style="width:${(auto / (p.total || 1)) * 100}%"></i><i class="h" style="width:${((p.done - auto) / (p.total || 1)) * 100}%"></i></span>
        <span class="muted small"><span class="st-auto">${auto} автоматически</span>, <span class="st-accepted">${p.done - auto} вами</span>, ждут решения ${p.total - p.done}</span>
        <div class="rv-actions">${undo ? `<button class="btn" data-act="undo" title="${esc(undo.label)}">${icon("undo")}Отменить последнее</button>` : ""}
          <button class="btn primary" data-act="next-problem">Следующая проблема${icon("next")}</button></div>
      </div></div>`;
  }

  A.views.card = {
    render(id) {
      const c = A.card(id);
      if (!c) return `<div class="empty-state"><h2>Карточка не найдена</h2><p>Возможно, её удалили или восстановили исходный набор.</p><a class="btn" href="#/catalog">Вернуться в каталог</a></div>`;
      if (ui.cardId !== id) Object.assign(ui, { cardId: id, key: null, src: 0, editing: false, editingTitle: false, err: "" });
      if (c.stage !== "done") {
        return `${head({ ...c, fields: [] })}<div class="two"><div class="section">${c.stage === "processing"
          ? `<p><span class="spinner"></span> Система готовит характеристики…</p>`
          : `<h2>Карточка ещё не обработана</h2><p class="lead">Система найдёт в тексте значения характеристик, приведёт их к виду каталога и подготовит предложения для проверки.</p>
             <button class="btn primary big" data-act="process-one" data-id="${c.id}">${icon("play")}Обработать карточку</button>`}</div>${sourcePane(c)}</div>`;
      }
      if (!ui.key || !fieldOf(c, ui.key)) ui.key = (problems(c)[0] || c.fields[0] || {}).key;
      const f = fieldOf(c, ui.key);
      const ready = M.status(c) === "ready";
      return `${head(c)}
        ${ready ? `<div class="notice ok" style="margin-bottom:14px"><b>Карточка готова к выгрузке</b>Все характеристики проверены. Можно перейти к следующей карточке, которая требует внимания.</div>` : ""}
        <div class="rv">${sourcePane(c)}${fieldsPane(c)}${f ? detail(c, f) : '<section class="pane"><div class="pane-b">Для этой категории нет характеристик.</div></section>'}</div>`;
    },
    after(id) {
      const c = A.card(id);
      if (c) { c.lastOpenedAt = A.now(); A.save(); }
      const inp = document.getElementById("f-edit-input") || document.getElementById("title-input");
      if (inp) inp.focus();
    },
  };

  /* --------------------------------------------------------- handlers */
  const cur = () => A.card(ui.cardId);
  function afterDecision(label) {
    const c = cur();
    ui.editing = false; ui.err = ""; ui.src = 0;
    const open = problems(c);
    if (open.length) ui.key = open[0].key;
    A.toast(label, true);
    A.render();
  }
  on("click", "pick-field", (el) => {
    ui.key = el.dataset.key; ui.src = 0; ui.editing = false; ui.err = "";
    A.render();
    // on a narrow screen the evidence is below the list: bring it into view
    if (window.innerWidth < 900) document.querySelector(".detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  on("click", "src-step", (el) => { ui.src = Math.max(0, ui.src + +el.dataset.d); A.render(); });
  on("click", "f-accept", (el) => { const r = A.act(M.accept, cur(), el.dataset.key, A.now()); if (r) afterDecision(r.label); });
  on("click", "f-complete", (el) => {
    const f = fieldOf(cur(), el.dataset.key);
    const r = A.act(M.correct, cur(), f.key, f.rec.suggest, A.now());
    afterDecision(`Дополнено: ${f.name} — ${f.rec.suggest}`);
  });
  on("click", "f-choose", (el) => { const r = A.act(M.choose, cur(), el.dataset.key, +el.dataset.i, A.now()); afterDecision(r.label); });
  on("click", "f-reject", (el) => {
    const key = el.dataset.key;
    const r = A.act(M.rejectCandidate, cur(), key, A.now());
    ui.editing = false; ui.src = 0;
    ui.key = key; // stay on the field: the next candidate or the empty state is shown right here
    A.toast(r.label, true);
    A.render();
  });
  on("click", "f-absent", (el) => { const r = A.act(M.confirmAbsent, cur(), el.dataset.key, A.now()); afterDecision(r.label); });
  on("click", "f-edit", () => { ui.editing = true; ui.err = ""; A.render(); });
  on("click", "f-edit-cancel", () => { ui.editing = false; ui.err = ""; A.render(); });
  on("submit", "f-save", (el) => {
    const c = cur();
    const f = fieldOf(c, el.dataset.key);
    const raw = (document.getElementById("f-edit-input").value || "").trim();
    let value = raw;
    if (!raw) { ui.err = "Введите значение или нажмите «Отмена». Чтобы отметить, что характеристики нет, используйте «Подтвердить отсутствие»."; A.render(); return; }
    if (f.kind === "num") {
      const n = Number(raw.replace(",", "."));
      if (!isFinite(n) || n <= 0) { ui.err = `Нужно число в единицах «${f.unit}», например 1,5`; A.render(); return; }
      value = E.numValue(n, f.unit);
    }
    const r = A.act(M.correct, c, f.key, value, A.now());
    afterDecision(`Исправлено: ${f.name} — ${value}`);
  });
  on("click", "next-problem", () => {
    const c = cur();
    if (c && c.stage === "done") {
      const open = problems(c);
      const idx = open.findIndex((f) => f.key === ui.key);
      const nxt = open[idx + 1] || (idx === -1 ? open[0] : null);
      if (nxt) { ui.key = nxt.key; ui.src = 0; ui.editing = false; A.render(); return; }
    }
    const list = A.catalogList();
    const pos = list.findIndex((x) => x.id === ui.cardId);
    const rest = [...list.slice(pos + 1), ...list.slice(0, Math.max(pos, 0))];
    const nextCard = rest.find((x) => ["conflict", "review"].includes(M.status(x)));
    if (nextCard) A.go(`#/card/${nextCard.id}`);
    else A.toast("В текущем списке больше нет карточек, которые требуют решения");
  });
  on("click", "process-one", (el) => { A.processCards([el.dataset.id]); });
  on("click", "title-edit", () => { ui.editingTitle = true; A.render(); });
  on("click", "title-cancel", () => { ui.editingTitle = false; A.render(); });
  on("submit", "title-save", () => {
    const v = document.getElementById("title-input").value.trim();
    if (!v) return;
    A.act((S, c) => { const u = M.snapshot(S, c, "Изменено название"); c.name = v; c.updatedAt = A.now(); return u; }, cur());
    ui.editingTitle = false;
    A.toast("Название сохранено", true);
    A.render();
  });
  on("change", "cat-change", (el) => {
    const c = cur();
    const key = el.value;
    if (!key || key === c.category) return;
    A.confirmDialog({ title: `Сменить категорию на «${A.catName(key)}»?`,
      text: "Набор характеристик зависит от категории. Система подготовит их заново по тексту карточки, текущие решения по этой карточке будут сброшены. Это можно отменить.",
      ok: "Сменить и подготовить заново" }, () => {
      A.act((S, card) => { const u = M.snapshot(S, card, `Категория: ${A.catName(key)}`); M.processCard(S, card, A.now(), { category: key }); return u; }, c);
      ui.key = null;
      A.toast(`Категория изменена на «${A.catName(key)}»`, true);
      A.render();
    });
    el.value = c.category || "";
  });
})();
