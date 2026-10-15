/* Общие помощники: экранирование HTML, форматирование чисел и дат, склонения, скачивание файлов. */
(function () {
  'use strict';
  const A = (window.Atlas = window.Atlas || {});

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Любое значение -> безопасный текст для вставки в HTML. */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  /** 1700 -> «1 700», 1.7 -> «1,7» (русская запись). */
  function num(value, digits = 2) {
    if (value == null || Number.isNaN(value)) return '';
    return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits });
  }

  function pct(part, total, digits = 0) {
    if (!total) return '—';
    return `${num((part / total) * 100, digits)}%`;
  }

  /** Склонение: plural(3, ['карточка', 'карточки', 'карточек']) -> «карточки». */
  function plural(n, forms) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
    return forms[2];
  }

  function count(n, forms) {
    return `${num(n, 0)} ${plural(n, forms)}`;
  }

  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const DAY = 24 * 60 * 60 * 1000;

  function time(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function date(ts) {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  /** «только что», «12 мин назад», «сегодня в 13:04», «вчера в 18:20», «12 окт». */
  function ago(ts, now = Date.now()) {
    const diff = now - ts;
    if (diff < 60 * 1000) return 'только что';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} мин назад`;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (ts >= today.getTime()) return `сегодня в ${time(ts)}`;
    if (ts >= today.getTime() - DAY) return `вчера в ${time(ts)}`;
    return date(ts);
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  let counter = 0;
  function uid(prefix = 'id') {
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Строка для сравнения: нижний регистр, ё -> е, лишние пробелы убраны. */
  function fold(text) {
    return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Скачать сгенерированный файл (CSV/JSON) — без сервера. */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  A.util = { esc, num, pct, plural, count, time, date, ago, startOfDay, uid, fold, escapeRe, download, clone, clamp, DAY };
})();
