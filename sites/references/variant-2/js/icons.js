/* Значки: состояния (различаются формой, а не только цветом), иллюстрации категорий и иконки интерфейса.
   Всё — inline SVG с currentColor, поэтому цвет задаёт CSS. */
(function () {
  'use strict';
  const A = window.Atlas;

  const svg = (size, body, cls = '') =>
    `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

  // --- Состояния характеристики ------------------------------------------------------------
  // Форма знака несёт смысл: круг — решение системы, квадрат — решение человека,
  // ромб — противоречие, пунктир — данных нет, перечёркнутый круг — подтверждено отсутствие.
  const GLYPHS = {
    auto: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2l1.9 1.9 3.8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    accepted: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.6" fill="currentColor"/><path d="M5 8.2l2 2 4-4.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    corrected: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.6" fill="currentColor"/><path d="M5 11l.5-2.2 4.6-4.6 1.7 1.7-4.6 4.6z" fill="#fff"/>',
    pending: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.6" fill="currentColor"/>',
    conflict: '<path d="M8 1.4l6.6 6.6L8 14.6 1.4 8z" fill="currentColor"/><path d="M8 4.8v4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.1" r="1" fill="#fff"/>',
    nodata: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 2.1"/>',
    absent: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.8 12.2l8.4-8.4" stroke="currentColor" stroke-width="1.5"/>',
    rejected: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    // статусы карточки
    new: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    processing: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6"/><path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    review: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.7a6.3 6.3 0 0 1 0 12.6z" fill="currentColor"/>',
    ready: '<circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.9 8.2l2 2 4.2-4.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function glyph(name, size = 16) {
    const cls = name === 'processing' ? 'spin' : '';
    return svg(size, GLYPHS[name] || GLYPHS.nodata, cls);
  }

  // --- Иконки интерфейса ---------------------------------------------------------------------
  const line = (d, extra = '') => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const UI = {
    search: '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/>' + line('M10.5 10.5L14 14'),
    upload: line('M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.2c0 .7.6 1.3 1.3 1.3h8.4c.7 0 1.3-.6 1.3-1.3V10'),
    download: line('M8 2.5v8M5 7.5l3 3 3-3M2.5 10v2.2c0 .7.6 1.3 1.3 1.3h8.4c.7 0 1.3-.6 1.3-1.3V10'),
    file: line('M4 1.8h5l3.5 3.5v8.4c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5V2.3c0-.3.2-.5.5-.5zM9 1.8v3.5h3.5M5.8 8.5h4.4M5.8 11h4.4'),
    table: line('M2.5 3h11v10h-11zM2.5 6.3h11M2.5 9.6h11M6.2 3v10'),
    text: line('M3 4h10M3 7h10M3 10h7M3 13h5'),
    left: line('M10 3L5 8l5 5'),
    right: line('M6 3l5 5-5 5'),
    down: line('M3.5 6l4.5 4.5L12.5 6'),
    arrow: line('M2.5 8h11M9.5 4l4 4-4 4'),
    back: line('M13.5 8h-11M6.5 4l-4 4 4 4'),
    undo: line('M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7'),
    close: line('M4 4l8 8M12 4l-8 8'),
    plus: line('M8 3v10M3 8h10'),
    more: '<circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/>',
    trash: line('M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.7 8.7c0 .4.4.8.8.8h5c.4 0 .8-.4.8-.8l.7-8.7'),
    edit: line('M10.6 2.6l2.8 2.8-7.8 7.8H2.8v-2.8z'),
    check: line('M3 8.5l3.2 3.2L13 4.8'),
    refresh: line('M13 3.5v3.3H9.7M12.6 6.6A5 5 0 1 0 13 9'),
    reset: line('M3 3.5v3.3h3.3M3.4 6.6A5 5 0 1 1 3 9'),
    filter: line('M2.5 3.5h11L9.3 8.6v4.3l-2.6-1.2V8.6z'),
    sort: line('M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5'),
    queue: line('M2.5 4h11M2.5 8h11M2.5 12h7'),
    spark: line('M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2'),
    keyboard: line('M1.8 4h12.4v8H1.8zM4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M5 9.5h6'),
    info: '<circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/>' + line('M8 7.3v4') + '<circle cx="8" cy="4.9" r="1" fill="currentColor"/>',
    quote: '<path d="M3 9.5c0-3 1.5-5 4-5.8l.4.9C6 5.3 5.3 6.4 5.2 7.6h1.6v4.6H3zM8.8 9.5c0-3 1.5-5 4-5.8l.4.9c-1.4.7-2.1 1.8-2.2 3h1.6v4.6H8.8z" fill="currentColor"/>',
  };

  function icon(name, size = 16) {
    return svg(size, UI[name] || '');
  }

  // --- Иллюстрации категорий: единый штриховой стиль -------------------------------------------
  const P = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ILLUSTRATIONS = {
    smartphone: P('M14 5.5h12a2.5 2.5 0 0 1 2.5 2.5v24a2.5 2.5 0 0 1-2.5 2.5H14a2.5 2.5 0 0 1-2.5-2.5V8A2.5 2.5 0 0 1 14 5.5z') + P('M17.5 31h5M18 8.5h4'),
    laptop: P('M9 10h22a1.5 1.5 0 0 1 1.5 1.5v14.5h-25V11.5A1.5 1.5 0 0 1 9 10z') + P('M4.5 26h31l-1.8 3.2a1.5 1.5 0 0 1-1.3.8H7.6a1.5 1.5 0 0 1-1.3-.8z') + P('M17.5 28h5'),
    headphones: P('M9.5 25v-5a10.5 10.5 0 0 1 21 0v5') + P('M9.5 22.5h2.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H11a2.5 2.5 0 0 1-2.5-2.5V24a1.5 1.5 0 0 1 1-1.5zM30.5 22.5H28a1.5 1.5 0 0 0-1.5 1.5v5.5A1.5 1.5 0 0 0 28 31h1a2.5 2.5 0 0 0 2.5-2.5V24a1.5 1.5 0 0 0-1-1.5z'),
    fridge: P('M13 4.5h14a2 2 0 0 1 2 2v27a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2v-27a2 2 0 0 1 2-2zM11 15h18M15 8.5v3M15 19v5'),
    washer: P('M10.5 5.5h19a2 2 0 0 1 2 2v25a2 2 0 0 1-2 2h-19a2 2 0 0 1-2-2v-25a2 2 0 0 1 2-2zM8.5 11h23') + '<circle cx="20" cy="22.5" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/>' + P('M15.5 23.5c2-1.6 3.6 1.6 5.6 0s3.1-.6 3.4 0M12.5 8.2h.1M15.5 8.2h.1'),
    kitchen: P('M12 31.5h16l-1.6-12.8a6.4 6.4 0 0 0-12.8 0zM26.8 20.5c3.4 0 5.2 1.6 5.2 4.5s-1.8 4.6-4.4 4.6M13.6 19.5l-4.3-3.3M17 10.5h6M20 10.5V8M11 31.5h18'),
    home: P('M6.5 28.5h27c0-6.5-4.7-11.5-12-11.5h-8c-4 0-7 3.2-7 7.2zM13 17V12.5a1.5 1.5 0 0 1 1.5-1.5H29M29 11v6M10.5 24h.1'),
    furniture: P('M8 18.5v-5a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v5M5.5 18.5h4.5a2 2 0 0 1 2 2V24h16v-3.5a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 1 1.5 1.5v7.5h-32V20a1.5 1.5 0 0 1 1.5-1.5zM8 27.5v3M32 27.5v3'),
    lighting: P('M14 7h12l4.5 11h-21zM20 18v10M14.5 31.5h11M20 28c-2.5 0-5.5 1.3-5.5 3.5M20 28c2.5 0 5.5 1.3 5.5 3.5'),
    accessories: P('M13.5 5h13a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z') + '<rect x="14" y="8.5" width="6" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' + '<circle cx="17" cy="12" r="1.2" fill="currentColor"/>',
    unknown: P('M11 7.5h18a1.5 1.5 0 0 1 1.5 1.5v22a1.5 1.5 0 0 1-1.5 1.5H11A1.5 1.5 0 0 1 9.5 31V9A1.5 1.5 0 0 1 11 7.5zM14 14h12M14 19h12M14 24h7'),
  };

  function illustration(categoryId, size = 40) {
    const body = ILLUSTRATIONS[categoryId] || ILLUSTRATIONS.unknown;
    return `<span class="thumb thumb-${categoryId || 'unknown'}" style="--s:${size}px"><svg width="${Math.round(size * 0.78)}" height="${Math.round(size * 0.78)}" viewBox="0 0 40 40" aria-hidden="true">${body}</svg></span>`;
  }

  // Знак «Атласа»: сетка меридианов — карта характеристик.
  const LOGO = '<svg class="logo" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 3v26M3 16h26M7 9.5c5 3 13 3 18 0M7 22.5c5-3 13-3 18 0M16 3c-4.5 3.5-6.5 8-6.5 13s2 9.5 6.5 13M16 3c4.5 3.5 6.5 8 6.5 13s-2 9.5-6.5 13" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  A.icons = { glyph, icon, illustration, LOGO };
})();
