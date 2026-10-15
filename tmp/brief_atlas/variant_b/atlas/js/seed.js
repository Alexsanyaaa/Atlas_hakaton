/* Исходный набор: 43 карточки из 10 категорий, история решений и подготовленные результаты четырёх подходов.
   Тексты составлены по образцу карточек каталога. Характеристики НЕ записаны здесь заранее —
   их извлекает extractor.js из текста при первом запуске, поэтому данные согласованы между экранами.

   state: 'new' — ещё не обработана; 'done' — обработана.
   actions — решения сотрудников после обработки; finish — сотрудник довёл карточку до конца
   (оставшиеся поля решены по рекомендации, пустые — отмечены как отсутствующие). */
(function () {
  'use strict';
  const A = window.Atlas;

  const cards = [
    // --- Смартфоны -----------------------------------------------------------------------------
    { sku: '30071245', category: 'smartphone', daysAgo: 9, state: 'done', finish: true, source: 'import',
      title: 'Смартфон Samsung Galaxy A55 5G 8/256GB черный',
      description: 'Экран Super AMOLED 6,6 дюйма с частотой 120 Гц. Аккумулятор 5000 мАч, защита корпуса IP67.',
      seller: [['Бренд', 'Samsung']] },
    { sku: '30068810', category: 'smartphone', daysAgo: 2, state: 'done', source: 'import',
      title: 'Смартфон Apple iPhone 15 128GB Blue',
      description: 'Дисплей Super Retina XDR 6,1″, чип A16 Bionic, поддержка 5G и eSIM.',
      seller: [['Цвет', 'голубой']] },
    { sku: '30074402', category: 'smartphone', daysAgo: 1, state: 'done', source: 'import',
      title: 'Смартфон TECNO Spark 20C 128GB серый',
      description: 'Процессор Helio G36, 4 ГБ оперативной памяти, экран 6,6 дюйма, аккумулятор 5000 мАч.',
      seller: [['Оперативная память', '5 ГБ']] },
    { sku: '30069937', category: 'smartphone', daysAgo: 4, state: 'done', source: 'import',
      title: 'Смартфон Xiaomi Redmi Note 13 8/256GB Midnight Black',
      description: 'AMOLED-экран 6,67″, основная камера 108 Мп, NFC. Аккумулятор 5000 мАч с быстрой зарядкой 33 Вт.' },
    { sku: '30066120', category: 'smartphone', daysAgo: 14, state: 'done', finish: true, source: 'import',
      title: 'Смартфон HONOR X8b 8/128GB серебристый',
      description: 'Дисплей 6,7 дюйма, аккумулятор 4500 мАч, работает в сетях 4G.' },
    { sku: '30075511', category: 'smartphone', daysAgo: 0, hoursAgo: 2, state: 'new', source: 'import',
      title: 'Смартфон realme C67 6/128GB зеленый',
      description: 'Экран 6,72 дюйма, аккумулятор 5000 мАч, быстрая зарядка 33 Вт.' },

    // --- Ноутбуки ------------------------------------------------------------------------------
    { sku: '40021877', category: 'laptop', daysAgo: 3, state: 'done', source: 'import',
      title: 'Ноутбук ASUS Vivobook 15 X1504ZA-BQ1144 Intel Core i5-1235U/16Gb/512Gb SSD/15.6"/DOS серебристый',
      description: 'Оперативная память 16 ГБ DDR4 — достаточно для работы с документами и браузером в многозадачном режиме.' },
    { sku: '40019554', category: 'laptop', daysAgo: 6, state: 'done', source: 'import',
      title: 'Ноутбук Apple MacBook Air 13 M3 8/256GB Midnight',
      description: 'Чип Apple M3 с 8-ядерным процессором, до 18 часов работы от аккумулятора.',
      actions: [{ attr: 'screen', do: 'correct', value: '13,6', hours: 20 }] },
    { sku: '40017302', category: 'laptop', daysAgo: 12, state: 'done', finish: true, source: 'import',
      title: 'Ноутбук Lenovo IdeaPad Slim 3 15IRU8 i3-1305U/8/256 Win11 серый',
      description: 'Экран 15,6 дюйма IPS, Full HD.' },
    { sku: '40023160', category: 'laptop', daysAgo: 0, hoursAgo: 3, state: 'new', source: 'import',
      title: 'Ноутбук игровой MSI Thin 15 B13UC-1419XRU Intel Core i5-13420H/16Gb/512Gb SSD/RTX 3050',
      description: 'Экран 15,6 дюйма 144 Гц, Windows 11 Home.' },

    // --- Наушники ------------------------------------------------------------------------------
    { sku: '50011873', category: 'headphones', daysAgo: 10, state: 'done', finish: true, source: 'import',
      title: 'Наушники беспроводные JBL Tune 520BT синие',
      description: 'Bluetooth 5.3, до 57 ч работы без подзарядки, складная конструкция.' },
    { sku: '50012440', category: 'headphones', daysAgo: 5, state: 'done', source: 'import',
      title: 'Гарнитура Sony WH-1000XM5 Black',
      description: 'Активное шумоподавление, мультиточечное соединение, быстрая зарядка: 3 минуты дают 3 часа воспроизведения.' },
    { sku: '50010902', category: 'headphones', daysAgo: 18, state: 'done', finish: true, source: 'import',
      title: 'Наушники Marshall Major IV Bluetooth коричневые',
      description: 'Время работы — более 80 часов, беспроводная зарядка.',
      seller: [['Цвет', 'коричневый']] },

    // --- Холодильники --------------------------------------------------------------------------
    { sku: '60030091', category: 'fridge', daysAgo: 15, state: 'done', finish: true, source: 'import',
      title: 'Холодильник Haier C2F636CWRG белый',
      description: 'Общий объём 364 л, система Total No Frost, класс энергопотребления A+. Высота 190 см.' },
    { sku: '60027715', category: 'fridge', daysAgo: 3, state: 'done', source: 'import',
      title: 'Холодильник АТЛАНТ ХМ 4021-000 белый',
      description: 'Двухкамерный холодильник с капельной системой размораживания. Общий объём 345 л.',
      seller: [['Высота', '195 см'], ['Класс энергопотребления', 'A']] },
    { sku: '60031408', category: 'fridge', daysAgo: 1, state: 'done', source: 'import',
      title: 'Холодильник LG GC-B257JEYV бежевый',
      description: 'Объём 384 л. Технология DoorCooling+ равномерно охлаждает продукты на всех полках.',
      seller: [['Цвет', 'бежевый'], ['Высота', '179 см']] },

    // --- Стиральные машины ---------------------------------------------------------------------
    { sku: '70044120', category: 'washer', daysAgo: 11, state: 'done', finish: true, source: 'import',
      title: 'Стиральная машина Bosch WAN28282GC Serie 4, 8 кг, белая',
      description: 'Скорость отжима 1400 об/мин, класс энергопотребления A+++.' },
    { sku: '70039861', category: 'washer', daysAgo: 2, state: 'done', source: 'import',
      title: 'Стиральная машина Indesit IWSE 6105 (CIS).L',
      description: 'Загрузка до 6 кг, отжим 1000 об/мин, 16 программ стирки.' },
    { sku: '70046637', category: 'washer', daysAgo: 20, state: 'done', finish: true, source: 'import',
      title: 'Стиральная машина LG F2J3HS0W 7 кг белый',
      description: 'Отжим 1200 об/мин, прямой привод Inverter Direct Drive.' },

    // --- Техника для кухни ---------------------------------------------------------------------
    { sku: '80051290', category: 'kitchen', daysAgo: 2, state: 'done', source: 'import',
      title: 'Чайник электрический Kitfort KT-6140 1,7 л белый',
      description: 'Объём 1700 мл, мощность 2200 Вт, корпус из жаропрочного стекла с подсветкой.',
      seller: [['Объём', '1.7 L']] },
    { sku: '80049915', category: 'kitchen', daysAgo: 8, state: 'done', finish: true, source: 'import',
      title: 'Блендер погружной Braun MultiQuick 5 MQ 5235 белый/серый',
      description: 'Мощность 1000 Вт, мерный стакан 600 мл, насадка-измельчитель.' },
    { sku: '80052204', category: 'kitchen', daysAgo: 4, state: 'done', source: 'import',
      title: "Кофемашина De'Longhi Magnifica S ECAM22.110.B черная",
      description: 'Давление 15 бар, мощность 1450 Вт, резервуар для воды 1,8 л, встроенная кофемолка.' },
    { sku: '80047730', category: 'kitchen', daysAgo: 16, state: 'done', finish: true, source: 'import',
      title: 'Мультиварка Redmond RMC-M90 серебристая',
      description: 'Объём чаши 5 л, мощность 860 Вт, 17 автоматических программ. Чаша с антипригарным покрытием.' },
    { sku: '80053318', category: 'kitchen', daysAgo: 0, hoursAgo: 4, state: 'new', source: 'import',
      title: 'Тостер Polaris PET 0720 бежевый',
      description: 'Мощность 750 Вт, 7 режимов обжаривания, поддон для крошек.' },
    { sku: '80050476', category: 'kitchen', daysAgo: 1, state: 'done', source: 'import',
      title: 'Чайник электрический Scarlett SC-EK18P51',
      description: 'Мощность 2200 Вт. Объём 1,7 л. Корпус из нержавеющей стали, скрытый нагревательный элемент.' },

    // --- Техника для дома ----------------------------------------------------------------------
    { sku: '90011507', category: 'home', daysAgo: 1, state: 'done', source: 'import',
      title: 'Робот-пылесос Polaris IQ Home Aqua (PVCR-4105-GR)',
      description: 'Сухая и влажная уборка, мощность всасывания 2200 Па, время работы до 120 минут, управление через приложение.' },
    { sku: '90009843', category: 'home', daysAgo: 13, state: 'done', finish: true, source: 'import',
      title: 'Утюг Philips DST7030/20 7000 Series',
      description: 'Мощность 2800 Вт, паровой удар 250 г/мин, вес 1,5 кг. Цвет: фиолетовый.' },
    { sku: '90012218', category: 'home', daysAgo: 7, state: 'done', finish: true, source: 'import',
      title: 'Пылесос вертикальный Dreame T20 Pro серый',
      description: 'Мощность 450 Вт, вес 1,6 кг, время работы до 90 минут.' },

    // --- Мебель --------------------------------------------------------------------------------
    { sku: '11002456', category: 'furniture', daysAgo: 17, state: 'done', finish: true, source: 'import',
      title: 'Диван-кровать Askona Марсель велюр серый',
      description: 'Механизм еврокнижка. Габариты 220 × 95 × 85 см, каркас из массива сосны.',
      seller: [['Материал обивки', 'велюр']] },
    { sku: '11003310', category: 'furniture', daysAgo: 3, state: 'done', source: 'import',
      title: 'Кресло Stool Group Ричмонд экокожа бежевое',
      description: 'Ножки из металла, высота сиденья 45 см, нагрузка до 120 кг.' },
    { sku: '11001877', category: 'furniture', daysAgo: 21, state: 'done', finish: true, source: 'import',
      title: 'Комод Шатура Капри, 4 ящика, дуб сонома',
      description: 'Материал: ЛДСП. Размеры: 80 × 42 × 85 см.' },
    { sku: '11004102', category: 'furniture', daysAgo: 9, state: 'done', finish: true, source: 'import',
      title: 'Стеллаж Leset Нордик белый',
      description: 'Материал — массив сосны и МДФ. 5 полок, высота 180 см.' },
    { sku: '11005519', category: 'furniture', daysAgo: 0, hoursAgo: 5, state: 'new', source: 'import',
      title: 'Стол обеденный Woodville Айленд раскладной',
      description: 'Столешница из МДФ, ножки — массив бука. Размеры 120 × 80 × 75 см в сложенном виде.' },
    { sku: '11002981', category: 'furniture', daysAgo: 6, state: 'done', source: 'import',
      title: 'Кровать Askona Kim с подъёмным механизмом венге',
      description: 'Спальное место 160 × 200 см. Материал: ЛДСП, обивка отсутствует.' },

    // --- Освещение -----------------------------------------------------------------------------
    { sku: '12007731', category: 'lighting', daysAgo: 1, state: 'done', source: 'import',
      title: 'Лампа настольная Arte Lamp Wanda A7020LT-1WH белый',
      description: 'Цвет корпуса: серебристый и белый. Цоколь E27, максимальная мощность 40 Вт.' },
    { sku: '12006615', category: 'lighting', daysAgo: 5, state: 'done', source: 'import',
      title: 'Люстра потолочная Citilux Альпина CL718A50 хром',
      description: 'Материал: металл, стекло. Цоколь E14, 5 ламп по 60 Вт.' },
    { sku: '12008204', category: 'lighting', daysAgo: 12, state: 'done', finish: true, source: 'import',
      title: 'Лампа светодиодная Gauss Elementary A60 10W E27 4100K',
      description: 'Светодиодная лампа грушевидной формы, срок службы 25 000 часов.' },
    { sku: '12005590', category: 'lighting', daysAgo: 19, state: 'done', finish: true, source: 'import',
      title: 'Торшер Eglo Alamillo черный',
      description: 'Цоколь E27, высота 166 см. Материал: сталь, ткань.' },
    { sku: '12009012', category: 'lighting', daysAgo: 0, hoursAgo: 1, state: 'new', source: 'import',
      title: 'Светодиодная лента Navigator 5 м 4000K 14,4 Вт/м',
      description: 'Влагозащита IP65, питание 12 В.' },

    // --- Аксессуары для телефонов --------------------------------------------------------------
    { sku: '13004410', category: 'accessories', daysAgo: 0, hoursAgo: 6, state: 'done', source: 'import',
      title: 'Защитное стекло для Apple iPhone 15 Pro, Mietubl Full Glue, черная рамка',
      description: 'Олеофобное покрытие, твёрдость 9H, полная проклейка.' },
    { sku: '13003877', category: 'accessories', daysAgo: 2, state: 'done', source: 'import',
      title: 'Чехол-книжка Krutoff Eco Book для Samsung Galaxy A55 черный',
      description: 'Материал: искусственная кожа, внутри микрофибра. Магнитная застёжка.' },
    { sku: '13005102', category: 'accessories', daysAgo: 6, state: 'done', finish: true, source: 'import',
      title: 'Кабель Baseus Superior USB-C — Lightning 1 м белый',
      description: 'Поддержка быстрой зарядки до 20 Вт, передача данных 480 Мбит/с.' },
    { sku: '13005990', category: 'accessories', daysAgo: 0, hoursAgo: 2, state: 'new', source: 'import',
      title: 'Чехол Ugreen для Xiaomi Redmi Note 13 прозрачный',
      description: 'Материал: TPU, усиленные углы.' },
  ];

  // Карточка, на которой «остановился» сотрудник — для кнопки «Продолжить последнюю».
  const lastCardSku = '80051290';

  // ---------------------------------------------------------------------------------------------
  // Четыре подхода: подготовленные результаты NER, трансформера и LLM на четырёх карточках.
  // Это иллюстрация типичного поведения подходов, а не замер качества (см. README).
  // Колонка «Правила и словари» на странице не хранится здесь — она считается тем же извлекателем.
  // v — значение, q — цитата из текста (null — значение дано без подтверждения), note — пояснение.
  // ---------------------------------------------------------------------------------------------
  const approaches = {
    '30074402': {
      ner: {
        brand: { v: 'TECNO', q: 'TECNO' }, model: { v: 'Spark 20C', q: 'Spark 20C' }, color: { v: 'серый', q: 'серый' },
        storage: { v: '128 ГБ', q: '128GB' }, ram: { v: '4 ГБ', q: '4 ГБ оперативной памяти', note: 'Размечает только описание; параметр продавца «5 ГБ» не видит.' },
        screen: { v: '6,6″', q: '6,6 дюйма' }, battery: { v: '5 000 мА·ч', q: '5000 мАч' }, net5g: null,
      },
      transformer: {
        brand: { v: 'TECNO', q: 'TECNO' }, model: { v: 'Spark 20C', q: 'Spark 20C' }, color: { v: 'серый', q: 'серый' },
        storage: { v: '128 ГБ', q: '128GB' }, ram: { v: '4 ГБ', q: '4 ГБ оперативной памяти' },
        screen: { v: '6,6″', q: '6,6 дюйма' }, battery: { v: '5 000 мА·ч', q: '5000 мАч' }, net5g: null,
      },
      llm: {
        brand: { v: 'TECNO', q: 'TECNO' }, model: { v: 'Spark 20C', q: 'Spark 20C' }, color: { v: 'серый', q: 'серый' },
        storage: { v: '128 ГБ', q: '128GB' }, ram: { v: '4 ГБ', q: '4 ГБ оперативной памяти', note: 'Расхождение с параметрами продавца не отмечено.' },
        screen: { v: '6,56″', q: null, note: 'В тексте 6,6 дюйма; значение 6,56″ дано без цитаты.' },
        battery: { v: '5 000 мА·ч', q: '5000 мАч' }, net5g: { v: 'Нет', q: null, note: 'Ответ без подтверждения в тексте.' },
      },
    },
    '80051290': {
      ner: {
        brand: { v: 'Kitfort', q: 'Kitfort' }, model: { v: 'KT-6140', q: 'KT-6140' }, power: { v: '2 200 Вт', q: '2200 Вт' },
        volume: { v: '1,7 л', q: '1,7 л', note: 'Нашла одно упоминание; «1700 мл» не связала с объёмом.' },
        material: null, color: { v: 'белый', q: 'белый' },
      },
      transformer: {
        brand: { v: 'Kitfort', q: 'Kitfort' }, model: { v: 'KT-6140', q: 'KT-6140' }, power: { v: '2 200 Вт', q: '2200 Вт' },
        volume: { v: '1,7 л', q: '1700 мл' }, material: { v: 'стекло', q: 'жаропрочного стекла', note: 'Значение верное, но менее точное, чем «жаропрочное стекло».' },
        color: { v: 'белый', q: 'белый' },
      },
      llm: {
        brand: { v: 'Kitfort', q: 'Kitfort' }, model: { v: 'KT-6140', q: 'KT-6140' }, power: { v: '2 200 Вт', q: '2200 Вт' },
        volume: { v: '1,7 л', q: '1700 мл' }, material: { v: 'жаропрочное стекло', q: 'жаропрочного стекла' },
        color: { v: 'белый', q: 'белый' },
      },
    },
    '13004410': {
      ner: {
        brand: { v: 'Apple', q: 'Apple', note: 'Первый бренд в названии — это совместимое устройство.' },
        model: { v: 'iPhone 15 Pro', q: 'iPhone 15 Pro' }, compat: null,
        material: { v: 'стекло', q: 'стекло' }, color: { v: 'черный', q: 'черная' },
      },
      transformer: {
        brand: { v: 'Mietubl', q: 'Mietubl' }, model: { v: 'Full Glue', q: 'Full Glue' }, compat: { v: 'Apple iPhone 15 Pro', q: 'Apple iPhone 15 Pro' },
        material: { v: 'стекло', q: 'стекло' }, color: { v: 'черный', q: 'черная' },
      },
      llm: {
        brand: { v: 'Mietubl', q: 'Mietubl' }, model: { v: 'Full Glue', q: 'Full Glue' }, compat: { v: 'Apple iPhone 15 Pro', q: 'Apple iPhone 15 Pro' },
        material: { v: 'закалённое стекло', q: null, note: 'В тексте просто «стекло»; уточнение добавлено без цитаты.' },
        color: { v: 'черный', q: 'черная' },
      },
    },
    '12007731': {
      ner: {
        brand: { v: 'Arte Lamp', q: 'Arte Lamp' }, model: { v: 'Wanda', q: 'Wanda' }, socket: { v: 'E27', q: 'E27' },
        power: { v: '40 Вт', q: '40 Вт' }, colortemp: null, material: null,
        color: { v: 'белый', q: 'белый', note: 'Взят цвет из названия; второй цвет из описания пропущен.' },
      },
      transformer: {
        brand: { v: 'Arte Lamp', q: 'Arte Lamp' }, model: { v: 'Wanda A7020LT-1WH', q: 'Wanda A7020LT-1WH' }, socket: { v: 'E27', q: 'E27' },
        power: { v: '40 Вт', q: '40 Вт' }, colortemp: null, material: null,
        color: { v: 'серебристый, белый', q: 'серебристый и белый' },
      },
      llm: {
        brand: { v: 'Arte Lamp', q: 'Arte Lamp' }, model: { v: 'Wanda', q: 'Wanda' }, socket: { v: 'E27', q: 'E27' },
        power: { v: '40 Вт', q: '40 Вт' },
        colortemp: { v: '2700 K', q: null, note: 'В тексте нет; типичное значение подставлено без подтверждения.' },
        material: { v: 'металл', q: null, note: 'В тексте нет; предположение модели.' },
        color: { v: 'серебристый, белый', q: 'серебристый и белый' },
      },
    },
  };

  // Примеры для сценария «Вставить текст» — обычные описания без разметки.
  const textExamples = [
    {
      label: 'Чайник',
      text: 'Чайник электрический Tefal KO6931 Sense\nОбъём 1,5 л, мощность 1800 Вт.\nКорпус из нержавеющей стали, цвет: черный.\nТермометр на корпусе, 5 температурных режимов.',
    },
    {
      label: 'Кресло',
      text: 'Кресло офисное Stool Group Топ\nМатериал обивки: ткань, цвет — серый.\nГабариты 66 × 64 × 112 см, газлифт, крестовина из пластика.',
    },
    {
      label: 'Неизвестный товар',
      text: 'Набор для творчества «Весёлая ферма»\nВ комплекте 12 фигурок и краски, подходит детям от 5 лет.',
    },
  ];

  A.seed = { cards, lastCardSku, approaches, textExamples };
})();
