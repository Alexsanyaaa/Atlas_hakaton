/* Adding data: bulk CSV/JSON import, a TXT file, pasted text. TXT and text build a draft card from free text. */
(function () {
  const A = ATLAS.app, M = ATLAS.model, E = ATLAS.engine;
  const { esc, icon, on, nf } = A;
  const ui = (A.ui.add = { tab: "csv",
    imp: { phase: "empty" },
    txt: { phase: "empty" },
    paste: { phase: "empty", text: "" } });
  const MAX_BYTES = 2 * 1024 * 1024;
  const TARGETS = [["name", "Название товара", true], ["description", "Описание", false], ["category", "Категория", false], ["sku", "Артикул (SKU)", false]];
  const GUESS = { name: /наимен|назван|title|name|товар/i, description: /описан|descr|текст/i, category: /катег|categ|раздел/i, sku: /артикул|sku|код|id/i };

  /* --------------------------------------------------------- parsing */
  function parseCSV(text) {
    const first = text.split(/\r?\n/)[0] || "";
    const delim = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (ch === '"') q = false;
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = "";
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else f += ch;
    }
    row.push(f);
    if (row.some((x) => x.trim())) rows.push(row);
    if (q) throw new Error("В файле не закрыта кавычка — проверьте строку с описанием.");
    if (rows.length < 2) throw new Error("В файле нет строк с товарами: нужна строка заголовков и хотя бы одна строка данных.");
    const headers = rows[0].map((h, i) => h.trim() || `Колонка ${i + 1}`);
    const width = headers.length;
    const bad = rows.slice(1).findIndex((r) => r.length !== width);
    if (bad >= 0) throw new Error(`Строка ${bad + 2}: ${rows[bad + 1].length} значений вместо ${width}. Возможно, в тексте есть разделитель «${delim === "\t" ? "табуляция" : delim}» без кавычек.`);
    return { headers, rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()]))) };
  }
  function parseJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const pos = (String(e.message).match(/position (\d+)/) || [])[1];
      const line = pos ? text.slice(0, +pos).split("\n").length : null;
      throw new Error(`Файл не похож на JSON${line ? ` — ошибка в строке ${line}` : ""}. Проверьте запятые, кавычки и скобки.`);
    }
    if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray);
    if (!Array.isArray(data) || !data.length) throw new Error("В JSON нет списка товаров. Ожидается массив объектов: [{\"title\": …, \"description\": …}].");
    if (!data.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new Error("Каждый товар в JSON должен быть объектом с полями.");
    const headers = [...new Set(data.flatMap((x) => Object.keys(x)))];
    return { headers, rows: data.map((x) => Object.fromEntries(headers.map((h) => [h, x[h] == null ? "" : String(x[h]).trim()]))) };
  }
  function guessMap(headers) {
    const map = {};
    for (const [k] of TARGETS) map[k] = headers.find((h) => GUESS[k].test(h) && !Object.values(map).includes(h)) || "";
    return map;
  }
  function matchCategory(name) {
    if (!name) return null;
    const f = E.fold(name);
    const c = Object.values(ATLAS.CATEGORIES).find((x) => E.fold(x.name) === f || x.words.some((w) => f.includes(E.fold(w))));
    return c ? c.key : null;
  }
  function validate(imp) {
    const skus = new Set(A.S.cards.map((c) => c.sku));
    const seen = new Set();
    return imp.rows.map((r, i) => {
      const name = imp.map.name ? r[imp.map.name] : "";
      const sku = imp.map.sku ? r[imp.map.sku] : "";
      const catRaw = imp.map.category ? r[imp.map.category] : "";
      const problems = [], notes = [];
      if (!name) problems.push("нет названия");
      if (sku && skus.has(sku)) problems.push(`артикул ${sku} уже есть в каталоге`);
      else if (sku && seen.has(sku)) problems.push(`артикул ${sku} повторяется в файле`);
      if (sku) seen.add(sku);
      const cat = matchCategory(catRaw);
      if (catRaw && !cat) notes.push(`категория «${catRaw}» не найдена — определим по тексту`);
      if (!imp.map.description || !r[imp.map.description]) notes.push("без описания — характеристики только из названия");
      return { i, line: i + 2, name, sku, cat, problems, notes };
    });
  }

  /* --------------------------------------------------------- import tab */
  function importTab() {
    const imp = ui.imp;
    const drop = `<div class="drop" data-drop="imp">${icon("upload")}<b>Перетащите файл CSV или JSON сюда</b>
      <span class="muted small">CSV с разделителем «;» или «,» и строкой заголовков, либо JSON-массив товаров. До 2 МБ.</span>
      <div class="d-actions"><label class="btn primary">Выбрать файл<input type="file" accept=".csv,.json,text/csv,application/json" data-on="imp-file" hidden></label>
        <button class="btn" data-act="imp-sample" data-k="csv">Взять пример CSV</button><button class="btn" data-act="imp-sample" data-k="json">Взять пример JSON</button></div></div>`;
    if (imp.phase === "empty") return `<div class="stack">${drop}<p class="muted small">После загрузки вы увидите первые строки, сопоставите колонки с полями карточки и подтвердите импорт. Новые товары появятся в каталоге со статусом «Новое поступление».</p></div>`;
    if (imp.phase === "loading") return `<div class="section"><span class="spinner"></span> Читаю файл «${esc(imp.fileName)}»…</div>`;
    if (imp.phase === "error") return `<div class="stack"><div class="notice bad"><b>Файл «${esc(imp.fileName)}» не удалось прочитать</b>${esc(imp.error)}</div>${drop}</div>`;
    if (imp.phase === "done") return `<div class="notice ok"><b>Добавлено товаров: ${imp.added}</b>${imp.processing ? "Система обрабатывает их — статусы обновятся в каталоге." : "Они в каталоге со статусом «Новое поступление»."}</div>
      <div class="d-actions" style="margin-top:12px"><button class="btn primary" data-act="imp-show">Показать в каталоге</button><button class="btn" data-act="imp-reset">Загрузить ещё файл</button></div>`;
    const v = validate(imp);
    const good = v.filter((x) => !x.problems.length);
    const bad = v.filter((x) => x.problems.length);
    const notes = v.filter((x) => x.notes.length && !x.problems.length);
    const sel = (k) => `<select data-on="imp-map" data-k="${k}"><option value="">— не загружать —</option>${imp.headers.map((h) => `<option ${imp.map[k] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>`;
    return `<div class="stack">
      <div class="d-actions" style="justify-content:space-between;align-items:center"><span>${icon("file")} <b>${esc(imp.fileName)}</b> <span class="muted">${nf(imp.rows.length)} ${M.plural(imp.rows.length, "строка", "строки", "строк")}</span></span>
        <button class="btn ghost" data-act="imp-reset">Выбрать другой файл</button></div>
      <div class="section"><h2>Сопоставьте колонки</h2><p class="lead">Укажите, в какой колонке файла какое поле карточки. Обязательно только название: категорию система определит по тексту, артикул создаст сама.</p>
        <div class="map-grid">${TARGETS.map(([k, label, req]) => `<label class="fld">${label}${req ? " (обязательно)" : ""}${sel(k)}</label>`).join("")}</div></div>
      <div class="preview-tbl"><table><thead><tr><th>Строка</th>${imp.headers.map((h) => `<th>${esc(h)}</th>`).join("")}<th>Проверка</th></tr></thead><tbody>
        ${v.slice(0, 12).map((x) => `<tr class="${x.problems.length ? "err" : ""}"><td class="num">${x.line}</td>${imp.headers.map((h) => `<td title="${esc(imp.rows[x.i][h])}">${esc(imp.rows[x.i][h])}</td>`).join("")}
          <td>${x.problems.length ? `<span class="st-conflict">${esc(x.problems.join("; "))}</span>` : x.notes.length ? `<span class="muted">${esc(x.notes.join("; "))}</span>` : '<span class="st-accepted">готово</span>'}</td></tr>`).join("")}
      </tbody></table></div>
      ${v.length > 12 ? `<p class="muted small">Показаны первые 12 строк из ${v.length}.</p>` : ""}
      ${!imp.map.name ? `<div class="notice bad"><b>Не выбрана колонка с названием</b>Без названия товар нельзя показать в каталоге. Выберите колонку выше.</div>` : ""}
      ${bad.length && imp.map.name ? `<div class="notice warn"><b>${bad.length} ${M.plural(bad.length, "строка не будет импортирована", "строки не будут импортированы", "строк не будут импортированы")}</b>${bad.map((x) => `Строка ${x.line}: ${esc(x.problems.join("; "))}.`).join(" ")}</div>` : ""}
      ${notes.length && imp.map.name ? `<p class="muted small">Замечания не мешают импорту: ${notes.length} ${M.plural(notes.length, "строка", "строки", "строк")} без категории из справочника или без описания.</p>` : ""}
      <label class="check"><input type="checkbox" data-on="imp-proc" ${imp.processNow ? "checked" : ""}> Сразу обработать: система подготовит характеристики после импорта</label>
      <div class="d-actions"><button class="btn primary big" data-act="imp-go" ${imp.map.name && good.length ? "" : "disabled"}>Импортировать ${good.length} ${M.plural(good.length, "товар", "товара", "товаров")}</button>
        <button class="btn" data-act="imp-reset">Отмена</button></div>
    </div>`;
  }

  /* --------------------------------------------------------- text -> draft card */
  function splitText(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 1 && lines[0].length <= 120) return { title: lines[0], description: lines.slice(1).join("\n") };
    return { title: E.suggestTitle(text), description: text.trim() };
  }
  function makeDraft(text, category) {
    const parts = splitText(text);
    const res = E.process({ ...parts, seller: [] }, A.S.dict, { category });
    return { ...parts, text, category: res.category, detected: !category, fields: res.fields.map((f) => {
      const top = f.candidates.find((c) => c.flag !== "compat" && c.flag !== "article") || null;
      return { key: f.key, name: f.name, kind: f.kind, unit: f.unit, proposal: top ? top.value : "", value: top ? top.value : "", cand: top, rec: f.rec };
    }) };
  }
  function runDraft(mode) {
    const st = ui[mode];
    const text = (st.text || "").trim();
    if (!text) { st.error = "Вставьте описание товара — хотя бы пару предложений."; st.phase = mode === "paste" ? "empty" : "edit"; A.render(); return; }
    if (text.length < 15) { st.error = "Текст слишком короткий: по нескольким словам нельзя определить товар и его характеристики."; st.phase = mode === "paste" ? "empty" : "edit"; A.render(); return; }
    st.error = ""; st.phase = "processing"; st.step = 0;
    A.render();
    const tick = () => {
      st.step++;
      if (st.step < 3) { A.render(); setTimeout(tick, 380); return; }
      try { st.draft = makeDraft(text, null); st.phase = "draft"; }
      catch (e) { st.phase = "failed"; st.error = String(e.message || e); }
      A.render();
    };
    setTimeout(tick, 380);
  }
  function processing(st) {
    const steps = ["Определяю категорию товара", "Ищу характеристики в тексте", "Привожу значения к виду каталога"];
    return `<div class="section"><h2>Формирую карточку</h2><ul class="steps-run" style="margin-top:10px">${steps.map((s, i) =>
      `<li class="${i < st.step ? "done" : i === st.step ? "now" : ""}">${i < st.step ? `<span class="st-accepted">${icon("check")}</span>` : i === st.step ? '<span class="spinner"></span>' : icon("new")}${s}</li>`).join("")}</ul></div>`;
  }
  function draftView(mode) {
    const st = ui[mode];
    const d = st.draft;
    const cats = ATLAS.GROUPS.map((g) => `<optgroup label="${esc(g)}">${Object.values(ATLAS.CATEGORIES).filter((x) => x.group === g)
      .map((x) => `<option value="${x.key}" ${d.category === x.key ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("");
    const found = d.fields.filter((f) => f.proposal).length;
    const head = `<div class="stack"><label class="fld">Название карточки<input type="text" data-on="dr-title" data-mode="${mode}" value="${esc(d.title)}"></label>
      <label class="fld">Категория<select data-on="dr-cat" data-mode="${mode}">${d.category ? "" : '<option value="">Выберите категорию</option>'}${cats}</select></label>
      <div class="src-block"><div class="src-label">Исходный текст</div><div class="src-text small" style="max-height:220px;overflow:auto">${esc(d.text)}</div></div>
      <button class="btn ghost" data-act="dr-back" data-mode="${mode}">${icon("back")}Изменить текст</button></div>`;
    if (!d.category) {
      return `<div class="notice warn"><b>Категорию определить не удалось</b>В тексте нет признаков товара из каталога. Выберите категорию — система подберёт для неё характеристики. Значения, которых нет в тексте, останутся пустыми.</div>
        <div class="two" style="margin-top:14px">${head}<div class="section"><p class="muted">Характеристики появятся после выбора категории.</p></div></div>`;
    }
    const rows = d.fields.map((f, i) => `<div class="draft-row"><span class="dn">${esc(f.name)}</span>
      <input type="text" data-on="dr-val" data-mode="${mode}" data-i="${i}" value="${esc(f.value)}" placeholder="${f.proposal ? "" : "в тексте нет — оставлено пустым"}" aria-label="${esc(f.name)}">
      <span class="dq">${f.cand ? `из текста: <b>«${esc(f.cand.raw)}»</b>${f.cand.raw !== f.proposal ? ` → ${esc(f.proposal)}` : ""}` : "не найдено"}${f.value !== f.proposal ? " · изменено вами" : ""}</span></div>`).join("");
    return `${found < d.fields.length ? `<div class="notice ${found ? "" : "warn"}"><b>Найдено ${found} из ${d.fields.length} характеристик</b>${found ? "Остальных нет в тексте — они останутся пустыми, пока вы их не заполните. Система не подставляет значения из других товаров." : "В тексте нет значений для этой категории. Карточку можно создать и заполнить вручную."}</div>` : `<div class="notice ok"><b>Найдены все ${found} характеристик</b>Проверьте значения перед созданием карточки.</div>`}
      <div class="two" style="margin-top:14px">${head}<div class="section"><h2>Характеристики</h2><p class="lead small">Исправьте значения прямо здесь. Изменённые вами поля сохранятся как ручное решение, остальные — как предложения системы для проверки.</p>
        <div class="draft-fields">${rows}</div></div></div>
      <div class="d-actions" style="margin-top:14px"><button class="btn primary big" data-act="dr-create" data-mode="${mode}">Создать карточку</button>
        <button class="btn" data-act="dr-cancel" data-mode="${mode}">Отмена</button></div>`;
  }
  function doneView(mode) {
    const st = ui[mode];
    return `<div class="notice ok"><b>Карточка «${esc(st.createdName)}» создана</b>Она в каталоге. Откройте проверку, чтобы подтвердить предложения системы.</div>
      <div class="d-actions" style="margin-top:12px"><a class="btn primary" href="#/card/${st.createdId}">Открыть проверку</a><button class="btn" data-act="dr-cancel" data-mode="${mode}">Создать ещё одну</button></div>`;
  }

  function txtTab() {
    const st = ui.txt;
    if (st.phase === "processing") return processing(st);
    if (st.phase === "draft") return draftView("txt");
    if (st.phase === "done") return doneView("txt");
    if (st.phase === "loading") return `<div class="section"><span class="spinner"></span> Читаю «${esc(st.fileName)}»…</div>`;
    const drop = `<div class="drop" data-drop="txt">${icon("file")}<b>Перетащите файл .txt с описанием товара</b>
      <span class="muted small">Обычный текст в кодировке UTF-8. Бренд, модель и категорию заранее указывать не нужно.</span>
      <div class="d-actions"><label class="btn primary">Выбрать файл<input type="file" accept=".txt,text/plain" data-on="txt-file" hidden></label>
      <button class="btn" data-act="txt-sample">Взять пример TXT</button></div></div>`;
    if (st.phase === "edit") {
      return `<div class="stack"><div class="d-actions" style="justify-content:space-between"><span>${icon("file")} <b>${esc(st.fileName)}</b></span><button class="btn ghost" data-act="txt-reset">Выбрать другой файл</button></div>
        <label class="fld">Содержимое файла — можно поправить перед формированием<textarea rows="9" data-on="txt-text">${esc(st.text)}</textarea></label>
        ${st.error ? `<div class="notice bad">${esc(st.error)}</div>` : ""}
        <div class="d-actions"><button class="btn primary big" data-act="txt-run">Сформировать карточку</button></div></div>`;
    }
    return `<div class="stack">${st.phase === "error" ? `<div class="notice bad"><b>Файл «${esc(st.fileName)}» не подходит</b>${esc(st.error)}</div>` : ""}${drop}</div>`;
  }

  function pasteTab() {
    const st = ui.paste;
    if (st.phase === "processing") return processing(st);
    if (st.phase === "draft") return draftView("paste");
    if (st.phase === "done") return doneView("paste");
    return `<div class="stack"><label class="fld">Описание товара в свободной форме<textarea rows="10" data-on="paste-text" placeholder="Например: «Кофемашина Philips EP3246, автоматическая, давление 15 бар, резервуар 1,8 л…»">${esc(st.text)}</textarea></label>
      ${st.error ? `<div class="notice bad">${esc(st.error)}</div>` : ""}
      <div class="d-actions" style="align-items:center"><button class="btn primary big" data-act="paste-run">Сформировать карточку</button>
        <span class="muted small">Или вставьте пример:</span>${ATLAS.SAMPLES.texts.map((t, i) => `<button class="btn ghost" data-act="paste-sample" data-i="${i}">${esc(t.label)}</button>`).join("")}</div></div>`;
  }

  A.views.add = {
    render() {
      const tab = (k, title, sub) => `<button role="tab" aria-selected="${ui.tab === k}" data-act="add-tab" data-k="${k}">${title}<small>${sub}</small></button>`;
      return `<div class="page-head"><div><h1>Добавить товары</h1><p class="sub">Три способа: файл с партией товаров, текстовый файл с описанием одного товара или просто вставленный текст.</p></div></div>
        <div class="tabs" role="tablist">${tab("csv", "Импорт CSV или JSON", "много товаров из файла")}${tab("txt", "Загрузить TXT", "карточка из текстового файла")}${tab("paste", "Вставить текст", "карточка из описания")}</div>
        <div role="tabpanel">${ui.tab === "csv" ? importTab() : ui.tab === "txt" ? txtTab() : pasteTab()}</div>`;
    },
    after() {
      for (const z of document.querySelectorAll("[data-drop]")) {
        z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("over"); });
        z.addEventListener("dragleave", () => z.classList.remove("over"));
        z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) (z.dataset.drop === "imp" ? readImport : readTxt)(f); });
      }
    },
  };

  /* --------------------------------------------------------- handlers */
  function readFile(file, onText, onErr) {
    if (file.size > MAX_BYTES) return onErr(`Файл весит ${(file.size / 1048576).toFixed(1)} МБ — больше 2 МБ. Разбейте его на части.`);
    if (!file.size) return onErr("Файл пустой.");
    const r = new FileReader();
    r.onload = () => {
      const t = String(r.result || "");
      if (/\u0000/.test(t) || (t.match(/�/g) || []).length > 3) return onErr("Это не текстовый файл или он не в кодировке UTF-8. Сохраните его как текст UTF-8 и попробуйте снова.");
      onText(t.replace(/^﻿/, ""));
    };
    r.onerror = () => onErr("Браузер не смог прочитать файл.");
    r.readAsText(file, "utf-8");
  }
  function readImport(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    Object.assign(ui.imp, { phase: "loading", fileName: file.name });
    A.render();
    if (!["csv", "json"].includes(ext)) { Object.assign(ui.imp, { phase: "error", error: `Формат .${ext} не поддерживается. Загрузите CSV или JSON.` }); A.render(); return; }
    readFile(file, (t) => loadImportText(file.name, ext, t), (err) => { Object.assign(ui.imp, { phase: "error", error: err }); A.render(); });
  }
  function loadImportText(name, ext, text) {
    try {
      const { headers, rows } = ext === "json" ? parseJSON(text) : parseCSV(text);
      Object.assign(ui.imp, { phase: "preview", fileName: name, headers, rows, map: guessMap(headers), processNow: true });
    } catch (e) { Object.assign(ui.imp, { phase: "error", fileName: name, error: e.message }); }
    A.render();
  }
  function readTxt(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    Object.assign(ui.txt, { phase: "loading", fileName: file.name, error: "" });
    A.render();
    if (ext !== "txt") { Object.assign(ui.txt, { phase: "error", error: `Нужен файл .txt, а выбран .${ext}. Для таблиц используйте импорт CSV или JSON.` }); A.render(); return; }
    readFile(file, (t) => { Object.assign(ui.txt, { phase: "edit", text: t }); A.render(); }, (err) => { Object.assign(ui.txt, { phase: "error", error: err }); A.render(); });
  }

  on("click", "add-tab", (el) => { ui.tab = el.dataset.k; A.render(); });
  on("change", "imp-file", (el) => { if (el.files[0]) readImport(el.files[0]); });
  on("click", "imp-sample", (el) => {
    const s = ATLAS.SAMPLES[el.dataset.k];
    Object.assign(ui.imp, { phase: "loading", fileName: s.name });
    A.render();
    setTimeout(() => loadImportText(s.name, el.dataset.k, s.text), 350);
  });
  on("change", "imp-map", (el) => { ui.imp.map[el.dataset.k] = el.value; A.render(); });
  on("change", "imp-proc", (el) => { ui.imp.processNow = el.checked; });
  on("click", "imp-reset", () => { ui.imp = { phase: "empty" }; A.render(); });
  on("click", "imp-show", () => { A.ui.catalog = { ...A.defaultCatalogUi(), sort: "recent" }; A.go("#/catalog"); });
  on("click", "imp-go", () => {
    const imp = ui.imp;
    const ok = validate(imp).filter((x) => !x.problems.length);
    const t = A.now();
    const ids = [];
    for (const x of ok) {
      const r = imp.rows[x.i];
      const c = M.newCard(A.S, { name: x.name, sku: x.sku || undefined, category: x.cat,
        text: { title: x.name, description: imp.map.description ? r[imp.map.description] : "", seller: [] }, origin: "import", t });
      A.S.cards.unshift(c);
      ids.push(c.id);
    }
    A.undo.push({ label: `Импорт: ${ids.length} товаров`, items: [{ added: ids, eventIds: [] }] });
    A.save();
    imp.added = ids.length;
    imp.processing = imp.processNow;
    imp.phase = "done";
    A.toast(`Импортировано товаров: ${ids.length}`, true);
    if (imp.processNow) A.processCards(ids); else A.render();
  });

  on("change", "txt-file", (el) => { if (el.files[0]) readTxt(el.files[0]); });
  on("click", "txt-sample", () => { Object.assign(ui.txt, { phase: "edit", fileName: ATLAS.SAMPLES.txt.name, text: ATLAS.SAMPLES.txt.text, error: "" }); A.render(); });
  on("click", "txt-reset", () => { ui.txt = { phase: "empty" }; A.render(); });
  on("input", "txt-text", (el) => { ui.txt.text = el.value; });
  on("click", "txt-run", () => runDraft("txt"));
  on("input", "paste-text", (el) => { ui.paste.text = el.value; });
  on("click", "paste-sample", (el) => { ui.paste.text = ATLAS.SAMPLES.texts[+el.dataset.i].text; ui.paste.error = ""; A.render(); });
  on("click", "paste-run", () => runDraft("paste"));

  on("input", "dr-title", (el) => { ui[el.dataset.mode].draft.title = el.value; });
  on("input", "dr-val", (el) => {
    const f = ui[el.dataset.mode].draft.fields[+el.dataset.i];
    f.value = el.value;
    const q = el.parentElement.querySelector(".dq");
    if (q) q.innerHTML = (f.cand ? `из текста: <b>«${esc(f.cand.raw)}»</b>${f.cand.raw !== f.proposal ? ` → ${esc(f.proposal)}` : ""}` : "не найдено") + (f.value !== f.proposal ? " · изменено вами" : "");
  });
  on("change", "dr-cat", (el) => {
    const st = ui[el.dataset.mode];
    const title = st.draft.title;
    st.draft = makeDraft(st.draft.text, el.value);
    st.draft.title = title;
    A.render();
  });
  on("click", "dr-back", (el) => { const st = ui[el.dataset.mode]; st.phase = el.dataset.mode === "paste" ? "empty" : "edit"; A.render(); });
  on("click", "dr-cancel", (el) => {
    if (el.dataset.mode === "paste") ui.paste = { phase: "empty", text: "" }; else ui.txt = { phase: "empty" };
    A.render();
  });
  on("click", "dr-create", (el) => {
    const mode = el.dataset.mode;
    const d = ui[mode].draft;
    if (!d.title.trim()) { A.toast("Укажите название карточки"); return; }
    const t = A.now();
    const c = M.newCard(A.S, { name: d.title.trim(), category: d.category, text: { title: d.title.trim(), description: d.description, seller: [] }, origin: "text", t });
    // processing uses the edited title too, so quotes point into the card's own text
    M.processCard(A.S, c, t, { category: d.category });
    for (const df of d.fields) {
      const f = c.fields.find((x) => x.key === df.key);
      if (!f) continue;
      const v = df.value.trim();
      if (v && v !== df.proposal) M.correct(A.S, c, f.key, v, t);
    }
    A.S.cards.unshift(c);
    A.undo.push({ label: `Создана карточка «${c.name}»`, items: [{ added: [c.id], eventIds: A.S.events.filter((e) => e.cardId === c.id).map((e) => e.id) }] });
    A.save();
    Object.assign(ui[mode], { phase: "done", createdId: c.id, createdName: c.name });
    A.toast("Карточка создана", true);
    A.render();
  });
})();
