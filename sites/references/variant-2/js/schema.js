/* Таксономия: какие характеристики есть у каждой категории, как называются состояния и рекомендации. */
(function () {
  'use strict';
  const A = window.Atlas;

  // kind: number — число с единицей (dim — семейство единиц из словаря), enum — значение из списка или словаря,
  // bool — да/нет, dims — габариты, brand — бренд из словаря, text — свободный текст.
  const ATTRS = {
    brand: { name: 'Бренд', kind: 'brand' },
    model: { name: 'Модель', kind: 'text' },
    color: { name: 'Цвет', kind: 'enum', dict: 'color', multi: true },
    material: { name: 'Материал', kind: 'enum', dict: 'material', multi: true },
    storage: { name: 'Встроенная память', kind: 'number', dim: 'memory', unit: 'ГБ' },
    ram: { name: 'Оперативная память', kind: 'number', dim: 'memory', unit: 'ГБ' },
    screen: { name: 'Диагональ экрана', kind: 'number', dim: 'inch', unit: '″', range: [3, 100] },
    battery: { name: 'Ёмкость аккумулятора', kind: 'number', dim: 'mah', unit: 'мА·ч', range: [300, 40000] },
    net5g: { name: 'Поддержка 5G', kind: 'bool' },
    cpu: { name: 'Процессор', kind: 'text' },
    os: { name: 'Операционная система', kind: 'enum', options: ['Android', 'iOS', 'HarmonyOS', 'Windows 11', 'Windows 10', 'macOS', 'Linux', 'Без ОС'] },
    connection: { name: 'Подключение', kind: 'enum', options: ['Беспроводное (Bluetooth)', 'Проводное'] },
    playtime: { name: 'Время работы', kind: 'number', dim: 'hours', unit: 'ч', range: [1, 300] },
    fridge_volume: { name: 'Общий объём', kind: 'number', dim: 'volume', unit: 'л', range: [30, 1000] },
    height: { name: 'Высота', kind: 'number', dim: 'length', unit: 'см', range: [20, 300] },
    nofrost: { name: 'No Frost', kind: 'bool' },
    energy: { name: 'Класс энергопотребления', kind: 'enum', options: ['A+++', 'A++', 'A+', 'A', 'B', 'C', 'D'] },
    load: { name: 'Максимальная загрузка', kind: 'number', dim: 'mass', unit: 'кг', range: [2, 20] },
    spin: { name: 'Скорость отжима', kind: 'number', dim: 'spin', unit: 'об/мин', range: [400, 2000] },
    power: { name: 'Мощность', kind: 'number', dim: 'power', unit: 'Вт', range: [1, 6000] },
    volume: { name: 'Объём', kind: 'number', dim: 'volume', unit: 'л', range: [0.1, 30] },
    weight: { name: 'Вес', kind: 'number', dim: 'mass', unit: 'кг', range: [0.05, 300] },
    size: { name: 'Габариты (Ш × Г × В)', kind: 'dims', unit: 'см' },
    socket: { name: 'Цоколь', kind: 'enum', options: ['E27', 'E14', 'E40', 'GU10', 'GU5.3', 'G9', 'G4'] },
    colortemp: { name: 'Цветовая температура', kind: 'number', dim: 'temp', unit: 'K', range: [1500, 10000] },
    compat: { name: 'Совместимость', kind: 'text' },
  };

  // keywords — слова, по которым категория определяется из свободного текста (сценарий «Вставить текст»).
  const CATEGORIES = [
    { id: 'smartphone', name: 'Смартфоны', noun: 'Смартфон', group: 'Электроника',
      keywords: ['смартфон', 'мобильный телефон', 'iphone'],
      attrs: ['brand', 'model', 'color', 'storage', 'ram', 'screen', 'battery', 'net5g'] },
    { id: 'laptop', name: 'Ноутбуки', noun: 'Ноутбук', group: 'Электроника',
      keywords: ['ноутбук', 'macbook', 'ультрабук'],
      attrs: ['brand', 'model', 'cpu', 'ram', 'storage', 'screen', 'os', 'color'] },
    { id: 'headphones', name: 'Наушники', noun: 'Наушники', group: 'Электроника',
      keywords: ['наушники', 'гарнитура', 'airpods'],
      attrs: ['brand', 'model', 'connection', 'playtime', 'color'] },
    { id: 'fridge', name: 'Холодильники', noun: 'Холодильник', group: 'Бытовая техника',
      keywords: ['холодильник', 'морозильная камера', 'морозильник'],
      attrs: ['brand', 'model', 'fridge_volume', 'height', 'nofrost', 'energy', 'color'] },
    { id: 'washer', name: 'Стиральные машины', noun: 'Стиральная машина', group: 'Бытовая техника',
      keywords: ['стиральная машина', 'стиральная машинка', 'стирально-сушильная машина'],
      attrs: ['brand', 'model', 'load', 'spin', 'energy', 'color'] },
    { id: 'kitchen', name: 'Техника для кухни', noun: 'Кухонный прибор', group: 'Бытовая техника',
      keywords: ['чайник', 'блендер', 'кофеварка', 'кофемашина', 'мультиварка', 'тостер', 'миксер', 'электрогриль', 'мясорубка', 'соковыжималка', 'микроволновая печь'],
      attrs: ['brand', 'model', 'power', 'volume', 'material', 'color'] },
    { id: 'home', name: 'Техника для дома', noun: 'Прибор для дома', group: 'Бытовая техника',
      keywords: ['пылесос', 'робот-пылесос', 'утюг', 'отпариватель', 'обогреватель', 'вентилятор', 'увлажнитель'],
      attrs: ['brand', 'model', 'power', 'weight', 'color'] },
    { id: 'furniture', name: 'Мебель', noun: 'Мебель', group: 'Мебель',
      keywords: ['диван', 'кресло', 'стул', 'стол', 'шкаф', 'комод', 'кровать', 'стеллаж', 'тумба', 'пуф', 'банкетка'],
      attrs: ['brand', 'model', 'material', 'size', 'color'] },
    { id: 'lighting', name: 'Освещение', noun: 'Светильник', group: 'Освещение',
      keywords: ['люстра', 'светильник', 'лампа', 'бра', 'торшер', 'светодиодная лента', 'прожектор'],
      attrs: ['brand', 'model', 'socket', 'power', 'colortemp', 'material', 'color'] },
    { id: 'accessories', name: 'Аксессуары для телефонов', noun: 'Аксессуар', group: 'Аксессуары',
      keywords: ['чехол', 'чехол-книжка', 'защитное стекло', 'защитная пленка', 'кабель', 'зарядное устройство', 'держатель', 'внешний аккумулятор'],
      attrs: ['brand', 'model', 'compat', 'material', 'color'] },
  ];

  const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // Состояние отдельной характеристики. tone — цвет, glyph — форма знака.
  const FIELD_STATES = {
    auto: { label: 'Принято автоматически', short: 'авто', tone: 'ok', glyph: 'auto', resolved: true },
    accepted: { label: 'Подтверждено человеком', short: 'подтверждено', tone: 'ok', glyph: 'accepted', resolved: true },
    corrected: { label: 'Исправлено человеком', short: 'исправлено', tone: 'ok', glyph: 'corrected', resolved: true },
    absent: { label: 'Отсутствует — подтверждено', short: 'нет в тексте', tone: 'muted', glyph: 'absent', resolved: true },
    pending: { label: 'Ждёт решения', short: 'ждёт решения', tone: 'warn', glyph: 'pending', resolved: false },
    conflict: { label: 'Противоречие', short: 'противоречие', tone: 'bad', glyph: 'conflict', resolved: false },
    nodata: { label: 'Нет данных', short: 'нет данных', tone: 'muted', glyph: 'nodata', resolved: false },
  };

  // Статус всей карточки — отдельная шкала, не смешивается с состоянием поля.
  const CARD_STATUSES = {
    new: { label: 'Новое поступление', tone: 'info', glyph: 'new', order: 2 },
    processing: { label: 'Обрабатывается', tone: 'info', glyph: 'processing', order: 3 },
    conflict: { label: 'Обнаружено противоречие', tone: 'bad', glyph: 'conflict', order: 0 },
    review: { label: 'Требуется проверка', tone: 'warn', glyph: 'review', order: 1 },
    ready: { label: 'Готово к выгрузке', tone: 'ok', glyph: 'ready', order: 4 },
  };

  // Рекомендации системы: что советуем и почему.
  const RECOMMENDATIONS = {
    accept: { label: 'Рекомендуется принять', tone: 'ok', glyph: 'auto' },
    normalize: { label: 'Рекомендуется нормализовать', tone: 'info', glyph: 'pending' },
    complete: { label: 'Рекомендуется дополнить', tone: 'warn', glyph: 'pending' },
    conflict: { label: 'Требуется проверка', tone: 'bad', glyph: 'conflict' },
    reject: { label: 'Рекомендуется отклонить', tone: 'bad', glyph: 'rejected' },
    nodata: { label: 'Данных нет', tone: 'muted', glyph: 'nodata' },
  };

  const SOURCES = { title: 'Название', description: 'Описание', seller: 'Параметры продавца' };

  // Порог автоматического принятия: только явное подтверждение текстом И оценка модели не ниже порога.
  const AUTO_THRESHOLD = 0.9;

  A.schema = {
    ATTRS,
    CATEGORIES,
    FIELD_STATES,
    CARD_STATUSES,
    RECOMMENDATIONS,
    SOURCES,
    AUTO_THRESHOLD,
    category: (id) => byId[id] || null,
    attr: (id) => ATTRS[id],
  };
})();
