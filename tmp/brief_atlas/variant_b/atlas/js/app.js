/* Каркас приложения: маршруты, верхняя полоса, делегирование событий, уведомления, окна, выгрузка. */
(function () {
  'use strict';
  const A = window.Atlas;
  const { util, icons, schema, store } = A;
  const { esc } = util;

  const NAV = [
    { route: 'catalog', label: 'Каталог', short: 'Каталог' },
    { route: 'add', label: 'Добавить товары', short: 'Добавить' },
    { route: 'analytics', label: 'Аналитика', short: 'Аналитика' },
    { route: 'dictionaries', label: 'Словари', short: 'Словари' },
    { route: 'approaches', label: 'Четыре подхода', short: 'Подходы' },
  ];

  const actions = {}; // data-act="имя" -> обработчик
  const inputs = {}; // data-input="имя" -> обработчик ввода
  const changes = {}; // data-change="имя" -> обработчик изменения
  const temp = {}; // временное состояние экранов (не сохраняется)
  let menuOpen = false;
  let modalState = null;

  function on(map) {
    Object.assign(actions, map.actions || {});
    Object.assign(inputs, map.inputs || {});
    Object.assign(changes, map.changes || {});
  }

  // --- Маршруты --------------------------------------------------------------------------------

  function parseRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, queryString] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(queryString || ''));
    const name = parts[0] || 'catalog';
    return { name, id: parts[1] ? decodeURIComponent(parts[1]) : null, query };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  const VIEWS = () => ({
    catalog: A.views.catalog,
    card: A.views.review,
    add: A.views.add,
    analytics: A.views.analytics,
    dictionaries: A.views.dictionaries,
    approaches: A.views.approaches,
  });

  // --- Отрисовка ---------------------------------------------------------------------------------

  let lastRouteKey = '';

  function render() {
    const route = parseRoute();
    const view = VIEWS()[route.name] || A.views.catalog;
    const root = document.getElementById('view');

    // сохраняем фокус и курсор, чтобы перерисовка не мешала набирать текст
    const active = document.activeElement;
    const focusId = active && active.id;
    const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const routeKey = `${route.name}/${route.id || ''}`;
    const scroll = window.scrollY;

    renderTopbar(route);
    root.innerHTML = view.render(route);
    document.title = `${view.title ? view.title(route) : 'Атлас'} — Атлас`;

    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        if (selection && 'setSelectionRange' in el) {
          try { el.setSelectionRange(selection[0], selection[1]); } catch (e) { /* тип поля без курсора */ }
        }
      }
    }
    if (routeKey !== lastRouteKey) {
      window.scrollTo(0, 0);
      lastRouteKey = routeKey;
    } else {
      window.scrollTo(0, scroll);
    }
    if (view.mounted) view.mounted(route, root);
    renderModal();
  }

  function renderTopbar(route) {
    const m = store.metrics(store.state.cards);
    const current = route.name === 'card' ? 'catalog' : route.name;
    document.getElementById('topbar').innerHTML = `
      <a class="brand" href="#/catalog" aria-label="Атлас — каталог">${icons.LOGO}<span>Атлас</span></a>
      <nav class="nav" aria-label="Разделы">
        ${NAV.map((n) => `<a href="#/${n.route}" class="${n.route === current ? 'is-active' : ''}" ${n.route === current ? 'aria-current="page"' : ''}><span class="full">${n.label}</span><span class="short" aria-hidden="true">${n.short}</span></a>`).join('')}
      </nav>
      <div class="topbar-right">
        <a class="todo-pill" href="#/catalog" data-act="show-attention" title="Поля, по которым нужно решение человека">
          ${icons.glyph('pending', 14)} <span><span class="long">Ждут решения: </span><b>${util.num(m.waiting, 0)}</b> ${util.plural(m.waiting, ['поле', 'поля', 'полей'])}</span>
        </a>
        <div class="menu">
          <button class="icon-btn" data-act="toggle-menu" aria-haspopup="true" aria-expanded="${menuOpen}" aria-label="Ещё">${icons.icon('more', 18)}</button>
          ${menuOpen ? `
          <div class="menu-pop" role="menu">
            <button role="menuitem" data-act="open-export">${icons.icon('download')}<span>Выгрузить данные<small>CSV или JSON с решениями по каждому полю</small></span></button>
            <button role="menuitem" data-act="ask-reset">${icons.icon('reset')}<span>Восстановить исходный набор<small>Вернуть 43 карточки и словари к начальному состоянию</small></span></button>
          </div>` : ''}
        </div>
      </div>`;
  }

  // --- Уведомления ---------------------------------------------------------------------------------

  function toast(message, opts = {}) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="msg">${esc(message)}</span>${opts.undo ? '<button class="btn btn-sm" data-act="toast-undo">Отменить</button>' : ''}${opts.link ? `<a class="btn btn-sm" href="${opts.link.href}">${esc(opts.link.label)}</a>` : ''}`;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), opts.undo ? 7000 : 4500);
  }

  // --- Модальные окна ------------------------------------------------------------------------------

  function modal(spec) {
    modalState = spec;
    renderModal();
    setTimeout(() => {
      const first = document.querySelector('.modal [autofocus], .modal input, .modal select, .modal textarea, .modal .btn-primary');
      if (first) first.focus();
    }, 0);
  }

  function closeModal() {
    modalState = null;
    renderModal();
  }

  function renderModal() {
    const root = document.getElementById('modal-root');
    if (!modalState) {
      root.innerHTML = '';
      return;
    }
    const s = modalState;
    const body = typeof s.body === 'function' ? s.body() : s.body;
    root.innerHTML = `
      <div class="modal-backdrop" data-act="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head"><h2 id="modal-title">${esc(s.title)}</h2>
            <button class="icon-btn" data-act="modal-close" aria-label="Закрыть">${icons.icon('close', 18)}</button></div>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">${(s.buttons || []).map((b) => `<button class="btn ${b.cls || ''}" data-act="${b.act}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div>
        </div>
      </div>`;
  }

  function refreshModal() {
    if (modalState) renderModal();
  }

  // --- Выгрузка ------------------------------------------------------------------------------------

  const DECISION_NAMES = {
    auto: ['принято автоматически', 'система'],
    accepted: ['подтверждено человеком', 'человек'],
    corrected: ['исправлено человеком', 'человек'],
    absent: ['отсутствует в тексте', 'человек'],
  };

  function exportRows(cards) {
    const rows = [];
    for (const card of cards) {
      const category = schema.category(card.category);
      const status = schema.CARD_STATUSES[store.cardStatus(card)].label;
      for (const attr of category ? category.attrs : []) {
        const f = card.fields[attr];
        const d = f && f.decision;
        const [decision, by] = d ? DECISION_NAMES[d.type] : ['не решено', ''];
        rows.push({
          sku: card.sku, title: card.title, category: category ? category.name : '', status,
          attribute: schema.attr(attr).name, attribute_id: attr,
          value: d && d.type !== 'absent' ? d.display : '',
          decision, decided_by: by,
          // оценка модели — только у значений, которые предложила система; у ручного исправления её нет
          model_score: d && (d.type === 'auto' || d.type === 'accepted') && d.score != null ? d.score : '',
          decided_at: d ? new Date(d.at).toISOString() : '',
        });
      }
    }
    return rows;
  }

  function toCsv(rows) {
    const header = ['SKU', 'Название', 'Категория', 'Статус карточки', 'Характеристика', 'Значение', 'Решение', 'Кто решил', 'Оценка модели', 'Дата решения'];
    const keys = ['sku', 'title', 'category', 'status', 'attribute', 'value', 'decision', 'decided_by', 'model_score', 'decided_at'];
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(';'), ...rows.map((r) => keys.map((k) => cell(typeof r[k] === 'number' ? String(r[k]).replace('.', ',') : r[k])).join(';'))];
    return `﻿${lines.join('\r\n')}`;
  }

  function toJson(cards) {
    return JSON.stringify(cards.map((card) => {
      const category = schema.category(card.category);
      const attributes = {};
      for (const attr of category ? category.attrs : []) {
        const d = card.fields[attr] && card.fields[attr].decision;
        attributes[attr] = d
          ? { name: schema.attr(attr).name, value: d.type === 'absent' ? null : d.value, display: d.display || null, decision: d.type, decided_by: d.by === 'system' ? 'system' : 'human', model_score: d.type === 'auto' || d.type === 'accepted' ? d.score : null, decided_at: new Date(d.at).toISOString() }
          : { name: schema.attr(attr).name, value: null, decision: 'unresolved' };
      }
      return { sku: card.sku, title: card.title, category: card.category, status: store.cardStatus(card), attributes };
    }), null, 2);
  }

  function openExport(preset) {
    const cards = store.state.cards;
    const ready = cards.filter((c) => store.cardStatus(c) === 'ready');
    const selected = store.state.ui.selection.map((id) => store.card(id)).filter(Boolean);
    temp.export = { scope: preset || (selected.length ? 'selected' : 'ready'), format: 'csv' };
    const scopes = () => [
      { id: 'ready', label: `Готовые к выгрузке — ${util.count(ready.length, ['карточка', 'карточки', 'карточек'])}`, hint: 'Все характеристики решены: системой или человеком.', list: ready },
      { id: 'selected', label: `Выбранные в каталоге — ${util.count(selected.length, ['карточка', 'карточки', 'карточек'])}`, hint: 'Нерешённые поля попадут в файл с пометкой «не решено».', list: selected },
      { id: 'all', label: `Весь каталог — ${util.count(cards.length, ['карточка', 'карточки', 'карточек'])}`, hint: 'Включая карточки на проверке.', list: cards },
    ];
    const body = () => {
      const t = temp.export;
      return `<div class="form-grid">
        <div><span class="field-label">Что выгрузить</span><div class="radio-list">
          ${scopes().map((s) => `<label class="${t.scope === s.id ? 'is-on' : ''}"><input type="radio" name="scope" value="${s.id}" data-change="export-scope" ${t.scope === s.id ? 'checked' : ''} ${s.list.length ? '' : 'disabled'}><span><b>${s.label}</b><small>${s.hint}</small></span></label>`).join('')}
        </div></div>
        <div><span class="field-label">Формат</span><div class="seg">
          <button data-act="export-format" data-format="csv" class="${t.format === 'csv' ? 'is-on' : ''}">CSV для Excel</button>
          <button data-act="export-format" data-format="json" class="${t.format === 'json' ? 'is-on' : ''}">JSON</button>
        </div>
        <span class="field-hint">В файле у каждого значения указано, как оно получено: принято автоматически, подтверждено или исправлено человеком. У ручных исправлений оценки модели нет.</span></div>
      </div>`;
    };
    modal({
      title: 'Выгрузка данных',
      body,
      buttons: [{ label: 'Отмена', act: 'modal-close' }, { label: `${icons.icon('download')} Скачать файл`, act: 'export-run', cls: 'btn-primary' }],
    });
    temp.exportScopes = scopes;
  }

  function runExport() {
    const t = temp.export;
    const scope = temp.exportScopes().find((s) => s.id === t.scope);
    if (!scope || !scope.list.length) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (t.format === 'csv') util.download(`atlas_${t.scope}_${stamp}.csv`, toCsv(exportRows(scope.list)), 'text/csv');
    else util.download(`atlas_${t.scope}_${stamp}.json`, toJson(scope.list), 'application/json');
    const readyIds = scope.list.filter((c) => store.cardStatus(c) === 'ready').map((c) => c.id);
    store.markExported(readyIds);
    closeModal();
    toast(`Выгружено: ${util.count(scope.list.length, ['карточка', 'карточки', 'карточек'])}. Готовые карточки отмечены как выгруженные.`);
  }

  // --- Общие действия ------------------------------------------------------------------------------

  on({
    actions: {
      'toggle-menu': () => {
        menuOpen = !menuOpen;
        render();
      },
      'toast-undo': (el) => {
        const label = store.undo();
        el.closest('.toast').remove();
        if (label) toast(`Отменено: ${label.toLowerCase()}`);
      },
      'modal-close': closeModal,
      'modal-backdrop': (el, e) => {
        if (e.target === el) closeModal();
      },
      'open-export': () => {
        menuOpen = false;
        render();
        openExport();
      },
      'export-format': (el) => {
        temp.export.format = el.dataset.format;
        refreshModal();
      },
      'export-run': runExport,
      'ask-reset': () => {
        menuOpen = false;
        render();
        modal({
          title: 'Восстановить исходный набор?',
          body: '<p>Все изменения — решения по характеристикам, импортированные и созданные карточки, правки словарей — будут заменены исходными данными. Действие нельзя отменить.</p>',
          buttons: [{ label: 'Отмена', act: 'modal-close' }, { label: 'Восстановить', act: 'do-reset', cls: 'btn-danger' }],
        });
      },
      'do-reset': () => {
        closeModal();
        store.reset();
        for (const k of Object.keys(temp)) delete temp[k];
        go('#/catalog');
        toast('Исходный набор восстановлен');
      },
      'show-attention': (el, e) => {
        e.preventDefault();
        store.setCatalog({ problemsOnly: true, statuses: [], categories: [], q: '' });
        go('#/catalog');
      },
    },
    changes: {
      'export-scope': (el) => {
        temp.export.scope = el.value;
        refreshModal();
      },
    },
  });

  // --- Делегирование событий ------------------------------------------------------------------------

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (menuOpen && !e.target.closest('.menu')) {
      menuOpen = false;
      renderTopbar(parseRoute());
    }
    if (!el) return;
    const handler = actions[el.dataset.act];
    if (handler) {
      if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
      handler(el, e);
    }
  });

  document.addEventListener('input', (e) => {
    const name = e.target.dataset && e.target.dataset.input;
    if (name && inputs[name]) inputs[name](e.target, e);
  });

  document.addEventListener('change', (e) => {
    const name = e.target.dataset && e.target.dataset.change;
    if (name && changes[name]) changes[name](e.target, e);
  });

  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (el.tagName === 'DETAILS' && el.dataset.dropdown) {
      temp.openDropdown = el.open ? el.dataset.dropdown : temp.openDropdown === el.dataset.dropdown ? null : temp.openDropdown;
      if (el.open) document.querySelectorAll('details[data-dropdown]').forEach((d) => { if (d !== el) d.open = false; });
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalState) {
        closeModal();
        return;
      }
      if (menuOpen) {
        menuOpen = false;
        render();
        return;
      }
      const open = document.querySelector('details[data-dropdown][open]');
      if (open) {
        open.open = false;
        return;
      }
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && !modalState) {
      e.preventDefault();
      const label = store.undo();
      if (label) toast(`Отменено: ${label.toLowerCase()}`);
      return;
    }
    const view = VIEWS()[parseRoute().name];
    if (view && view.keydown && !modalState) view.keydown(e, typing);
  });

  // Перетаскивание файлов: экран «Добавить» сам решает, что принять.
  ['dragover', 'dragleave', 'drop'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const zone = e.target.closest && e.target.closest('[data-drop]');
      if (!zone) {
        if (type !== 'dragleave') e.preventDefault();
        return;
      }
      e.preventDefault();
      if (type === 'dragover') zone.classList.add('is-over');
      if (type === 'dragleave') zone.classList.remove('is-over');
      if (type === 'drop') {
        zone.classList.remove('is-over');
        const handler = actions[zone.dataset.drop];
        if (handler && e.dataTransfer.files.length) handler(zone, e, e.dataTransfer.files[0]);
      }
    });
  });

  window.addEventListener('hashchange', () => {
    closeModalSilently();
    render();
  });

  function closeModalSilently() {
    modalState = null;
  }

  // --- Запуск --------------------------------------------------------------------------------------

  A.app = { on, go, render, toast, modal, closeModal, refreshModal, temp, openExport, parseRoute, exportRows, toCsv };

  // обработчики экранов (их файлы подключены раньше app.js)
  (A.app_pending_handlers || []).forEach(on);

  store.init();
  store.subscribe(render);
  render();
})();
