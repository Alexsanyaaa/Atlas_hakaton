/* The initial catalog: deterministic, realistic, several categories. Built once, then the state is saved locally.
   Six prepared hard cases (ids h1..h6) carry the situations the review screen has to handle. */
window.ATLAS = window.ATLAS || {};

ATLAS.seed = (function () {
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const P = (name, value) => ({ name, value });

  /* ------------------------------------------------------------ generators per category */
  function gens(r) {
    const pick = (a) => a[Math.floor(r() * a.length)];
    const maybe = (p) => r() < p;
    const dec = (v) => String(v).replace(".", ",");
    const inch = (v) => (Number.isInteger(v) ? (v % 10 === 1 && v % 100 !== 11 ? "дюйм" : [2, 3, 4].includes(v % 10) && ![12, 13, 14].includes(v % 100) ? "дюйма" : "дюймов") : "дюйма");
    return {
      smartphone: () => {
        const [b, m] = pick([["Samsung", "Galaxy A35"], ["Samsung", "Galaxy A55"], ["Samsung", "Galaxy S24"], ["Xiaomi", "Redmi Note 13"],
          ["HONOR", "X8b"], ["HONOR", "200"], ["realme", "C67"], ["Xiaomi", "POCO X6"], ["Apple", "iPhone 15"]]);
        const [ram, st] = pick([[6, 128], [8, 256], [8, 128], [12, 256]]);
        const scr = pick([6.6, 6.7, 6.1, 6.78]);
        const bat = pick([5000, 4500, 5200]);
        const col = pick(["черный", "синий", "зелёный", "белый", "фиолетовый"]);
        return { title: `Смартфон ${b} ${m} ${ram}/${st} ГБ, ${col}`,
          description: `${b} ${m} — смартфон с экраном ${dec(scr)} дюйма и частотой обновления 120 Гц. ` +
            `Аккумулятор ${bat} мАч, зарядка через USB Type-C.` + (maybe(0.5) ? " Есть слот для карт microSD до 1 ТБ." : "") +
            (maybe(0.4) ? ` Корпус защищён по стандарту IP67.` : ""),
          seller: [P("Цвет", col), ...(maybe(0.6) ? [P("Диагональ", `${dec(maybe(0.2) ? Math.round((scr + 0.07) * 100) / 100 : scr)}"`)] : [])] };
      },
      laptop: () => {
        const [b, m, w] = pick([["Lenovo", "IdeaPad Slim 3 15IRU8", 1.62], ["ASUS", "Vivobook 15 X1504VA", 1.7], ["HP", "15s-fq5104ci", 1.69],
          ["Acer", "Aspire 5 A515-58M", 1.78], ["MSI", "Modern 14 C12MO", 1.4], ["Apple", "MacBook Air 13 M3", 1.24]]);
        const cpu = b === "Apple" ? "Apple M3" : pick(["Intel Core i5-1335U", "Intel Core i7-1355U", "AMD Ryzen 5 7530U", "Intel Core i3-1215U"]);
        const [ram, ssd] = pick([[8, 512], [16, 512], [16, 1024]]);
        const scr = b === "Apple" ? 13.6 : pick([15.6, 14]);
        const col = pick(["серый", "серебристый", "черный"]);
        return { title: `Ноутбук ${b} ${m} ${dec(scr)}" ${cpu} ${ram}/${ssd === 1024 ? "1 ТБ" : ssd + " ГБ"}`,
          description: `Ноутбук на процессоре ${cpu} с ${ram} ГБ оперативной памяти и SSD-накопителем ${ssd === 1024 ? "1 ТБ" : ssd + " ГБ"}. ` +
            `Экран ${dec(scr)} ${inch(scr)} с матовым покрытием. ` + (maybe(0.7) ? `Корпус ${col === "черный" ? "чёрного" : col === "серый" ? "серого" : "серебристого"} цвета, ноутбук весит ${dec(w)} кг.` : `Ноутбук весит ${dec(w)} кг.`),
          seller: maybe(0.5) ? [P("Цвет", col)] : [] };
      },
      tv: () => {
        const [b, m, plat] = pick([["Samsung", "UE55DU7100U", "Tizen"], ["LG", "55UT80006LA", "webOS"], ["Haier", "55 Smart TV S5", "Android TV"],
          ["Hisense", "55A6N", "VIDAA"], ["TCL", "55P755", "Google TV"], ["Xiaomi", "TV A 43 2025", "Google TV"], ["Sony", "KD-55X75WL", "Google TV"]]);
        const scr = m.match(/\d{2}/) ? +m.match(/\d{2}/)[0] : 55;
        const res = scr >= 50 ? "4K UHD" : pick(["4K UHD", "Full HD"]);
        const hz = pick([60, 60, 120]);
        const snd = pick([20, 20, 24, 30]);
        const vesa = scr >= 55 ? "300×300" : "200×200";
        return { title: `Телевизор ${b} ${m} ${scr}" ${res === "4K UHD" ? "4K UHD" : "Full HD"}`,
          description: `Экран ${scr} ${inch(scr)} с разрешением ${res === "4K UHD" ? "3840×2160" : "1920×1080"} и частотой обновления ${hz} Гц. ` +
            (plat === "VIDAA" ? "Собственная платформа VIDAA. " : `Платформа ${plat}. `) +
            `Акустическая система мощностью ${snd} Вт. Потребляемая мощность ${pick([95, 110, 140])} Вт. ` + (maybe(0.7) ? `Крепление VESA ${vesa}.` : ""),
          seller: [] };
      },
      headphones: () => {
        const [b, m, type, anc, hrs] = pick([["Sony", "WH-1000XM5", "полноразмерные", true, 30], ["JBL", "Tune 520BT", "накладные", false, 57],
          ["Marshall", "Major IV", "накладные", false, 80], ["Sennheiser", "Momentum 4 Wireless", "полноразмерные", true, 60],
          ["Xiaomi", "Redmi Buds 6", "внутриканальные", true, 38]]);
        const col = pick(["черный", "белый", "бежевый", "синий"]);
        return { title: `Наушники ${b} ${m}, ${col}`,
          description: `${type[0].toUpperCase() + type.slice(1)} беспроводные наушники с подключением по Bluetooth 5.3. ` +
            (anc ? "Активное шумоподавление подстраивается под окружение. " : "") + `Время работы ${hrs} ч без подзарядки.`,
          seller: maybe(0.5) ? [P("Цвет", col)] : [] };
      },
      fridge: () => {
        const [b, m] = pick([["Bosch", "KGN39VI21R"], ["LG", "GA-B509CQSL"], ["Beko", "B3RCNK402HX"], ["Indesit", "ITS 4180 W"],
          ["Haier", "C2F637CWRG"], ["ATLANT", "ХМ-4621-101"]]);
        const h = pick([186, 196, 203, 201]), vol = pick([302, 384, 364, 419]);
        const nf = pick(["Full No Frost", "No Frost", null]);
        const col = pick(["белый", "серебристый", "бежевый"]);
        return { title: `Холодильник ${b} ${m} ${col}`,
          description: `Двухкамерный холодильник с общим объёмом ${vol} л. ` + (nf ? `Система ${nf} избавляет от разморозки. ` : "Капельная система разморозки. ") +
            `Высота ${h} см, ширина 60 см. Класс энергопотребления ${pick(["A+", "A++"])}.`,
          seller: [P("Цвет", maybe(0.18) ? pick(["белый", "серебристый", "бежевый"].filter((x) => x !== col)) : col)] };
      },
      washer: () => {
        const [b, m] = pick([["Haier", "HW60-BP12929A"], ["LG", "F2J3HS2W"], ["Bosch", "WAN28282OE"], ["Indesit", "IWSB 5085"], ["Weissgauff", "WM 4947 DC"], ["Candy", "CS4 1061DE"]]);
        const load = pick([6, 7, 8, 9]), spin = pick([1000, 1200, 1400]), depth = pick([40, 45, 55]);
        return { title: `Стиральная машина ${b} ${m}`,
          description: `Стиральная машина с фронтальной загрузкой, максимальная загрузка белья ${load} кг. Скорость отжима ${spin} об/мин. ` +
            `Глубина ${depth} см подойдёт для узких ниш. Класс энергопотребления ${pick(["A+++", "A++", "A"])}. Цвет корпуса белый.`,
          seller: [] };
      },
      vacuum: () => {
        const [b, m, type] = pick([["Dyson", "V12 Detect Slim", "вертикальный"], ["Xiaomi", "Robot Vacuum S10", "робот-пылесос"], ["Kitfort", "KT-5181", "вертикальный"],
          ["Philips", "XB2125/09", "с контейнером"], ["Polaris", "PVCS 4000", "вертикальный"], ["Tefal", "X-Force Flex 8.60", "вертикальный"]]);
        const suc = pick([150, 185, 200, 120]), dust = pick([0.35, 0.5, 0.8, 1.5]), mins = pick([40, 60, 70]);
        const col = pick(["серый", "черный", "белый"]);
        return { title: `Пылесос ${b} ${m}`,
          description: `${type === "робот-пылесос" ? "Робот-пылесос" : type[0].toUpperCase() + type.slice(1) + " пылесос"} с мощностью всасывания ${suc} Вт. Объём контейнера для пыли ${dec(dust)} л. ` +
            `Работает ${mins} минут без подзарядки.` + (maybe(0.5) ? ` Цвет корпуса ${col}.` : ""),
          seller: [] };
      },
      kettle: () => {
        const [b, m] = pick([["Redmond", "RK-G178"], ["Tefal", "KO 2001"], ["Kitfort", "KT-6603"], ["Xiaomi", "Electric Kettle 2"], ["Polaris", "PWK 1712CGL"], ["Bosch", "TWK 3A011"]]);
        const vol = pick([1.7, 1.5, 1.8]);
        const pw = pick([2200, 2000, 1800]);
        const mat = pick(["нержавеющей стали", "жаропрочного стекла", "пластика"]);
        const col = pick(["белый", "черный", "серебристый"]);
        return { title: `Чайник ${b} ${m}`,
          description: `Электрический чайник объёмом ${dec(vol)} л, мощность ${pw} Вт. Корпус выполнен из ${mat}. Цвет ${col}.`,
          seller: maybe(0.4) ? [P("Объем", `${dec(maybe(0.25) ? vol + 0.2 : vol)} л`)] : [] };
      },
      coffee: () => {
        const [b, m, type] = pick([["Philips", "EP2231/40", "автоматическая"], ["Krups", "EA810B", "автоматическая"], ["Polaris", "PCM 1527E", "рожковая"],
          ["De'Longhi", "Dedica EC685", "рожковая"], ["Kitfort", "KT-7121", "рожковая"]]);
        const col = pick(["черный", "серебристый", "белый"]);
        return { title: `Кофемашина ${b} ${m}`,
          description: `${type[0].toUpperCase() + type.slice(1)} кофемашина с давлением помпы 15 бар. Резервуар для воды ёмкостью ${dec(pick([1.8, 1.1, 1.5]))} л. ` +
            `Мощность ${pick([1350, 1450, 1500])} Вт. Корпус ${col === "черный" ? "чёрного" : col === "белый" ? "белого" : "серебристого"} цвета.`,
          seller: [] };
      },
      sofa: () => {
        const [b, m] = pick([["Hoff", "Майами"], ["Шатура", "Ливорно"], ["Askona", "Hoffman"], ["Hoff", "Честер"], ["Шатура", "Бергамо"]]);
        const w = pick([210, 220, 236, 198]), d = pick([95, 102, 89]), h = pick([88, 90, 82]);
        const mat = pick(["велюр", "рогожка", "экокожа", "шенилл"]);
        const mech = pick(["еврокнижка", "дельфин", "аккордеон"]);
        const col = pick(["серый", "бежевый", "зелёный", "синий"]);
        const dims = maybe(0.5) ? `Габариты ${w}×${d}×${h} см (Ш×Г×В).` : `Ширина ${w} см, глубина ${d} см, высота ${h} см.`;
        return { title: `Диван ${b} ${m} прямой, ${col}`,
          description: `Прямой диван с механизмом трансформации ${mech}. ${dims} Обивка — ${mat}.` + (maybe(0.4) ? ` Вес ${pick([62, 74, 81])} кг.` : ""),
          seller: [P("Цвет", col)] };
      },
      mattress: () => {
        const [b, m] = pick([["Askona", "Balance Forma"], ["Ormatek", "Optima Classic"], ["Hoff", "Comfort Sleep"], ["Askona", "Compact Mini"]]);
        const [w, l] = pick([[160, 200], [140, 200], [90, 200], [180, 200]]);
        const h = pick([18, 20, 22, 24]);
        const block = pick(["независимые пружины", "беспружинный"]);
        const firm = pick(["средней жёсткости", "жёсткий", "мягкий"]);
        return { title: `Матрас ${b} ${m} ${w}×${l}`,
          description: `${block === "беспружинный" ? "Беспружинный" : "Пружинный"} матрас ${firm}. ${block === "беспружинный" ? "" : "Блок на независимых пружинах. "}Высота ${h} см.`,
          seller: [] };
      },
      chair: () => {
        const [b, m] = pick([["Бюрократ", "CH-695N"], ["Chairman", "696"], ["Бюрократ", "MC-201"], ["Chairman", "Home 106"]]);
        const mat = pick(["сетка", "экокожа", "текстиль"]);
        const col = pick(["черный", "серый", "синий"]);
        return { title: `Кресло офисное ${b} ${m}, ${col}`,
          description: `Офисное кресло, обивка — ${mat}. ` +
            `Максимальная нагрузка ${pick([100, 120, 150])} кг. Высота ${pick([112, 120, 125])} см в верхнем положении.`,
          seller: [P("Цвет", col)] };
      },
      chandelier: () => {
        const [b, m] = pick([["Citilux", "Эдем CL143152"], ["Lightstar", "Cigno Collo 751"], ["Eglo", "Montefio 97814"], ["Arte Lamp", "Pegasus A2112"]]);
        const n = pick([3, 5, 6, 8]);
        const sock = pick(["E14", "E27"]);
        const shade = pick(["стекла", "пластика", "металла"]);
        const col = pick(["белый", "золотистый", "черный", "бронзовый"]);
        return { title: `Люстра ${b} ${m}`,
          description: `Люстра на ${n} ламп с цоколем ${sock}. Мощность лампы — 60 Вт. Плафоны из ${shade}. Цвет арматуры ${col}.`,
          seller: maybe(0.5) ? [P("Высота", `${pick([45, 52, 60])} см`)] : [] };
      },
      lamp: () => {
        const [b, m] = pick([["Xiaomi", "Mi LED Desk Lamp 1S"], ["Eglo", "Basic 9228"], ["Arte Lamp", "Desk A5810LT"], ["Citilux", "CL803010"]]);
        const led = b === "Xiaomi";
        return { title: `Лампа настольная ${b} ${m}`,
          description: `Настольная лампа ${led ? "со светодиодным источником света, мощность 9 Вт" : "под лампу с цоколем E27"}. Высота ${pick([40, 45, 52])} см. ` +
            (maybe(0.6) ? `Цвет ${pick(["белый", "черный"])}.` : ""),
          seller: [] };
      },
      faucet: () => {
        const [b, m] = pick([["Grohe", "Eurosmart 33281003"], ["Hansgrohe", "Logis 71400000"], ["Lemark", "Comfort LM3061C"], ["Iddis", "Kitchen K56SBJ"]]);
        const type = pick(["для кухни", "для раковины", "для ванны"]);
        return { title: `Смеситель ${b} ${m} ${type}`,
          description: `Однорычажный смеситель ${type}. Корпус из латуни, покрытие хром. Керамический картридж 35 мм.`,
          seller: maybe(0.5) ? [P("Цвет", "серебристый")] : [] };
      },
      drill: () => {
        const [b, m] = pick([["Makita", "DF333DWYE"], ["DeWalt", "DCD777S2T"], ["Metabo", "PowerMaxx BS 12"], ["Интерскол", "ДА-12ЭР-02"], ["Bosch", "GSR 180-LI"]]);
        const v = pick([12, 18]), tq = pick([30, 40, 65]), rpm = pick([1500, 1700, 1750]);
        return { title: `Дрель-шуруповёрт аккумуляторная ${b} ${m}`,
          description: `Шуруповёрт с напряжением аккумулятора ${v} В. Максимальный крутящий момент ${tq} Н·м, скорость вращения ${rpm} об/мин. ` +
            (maybe(0.6) ? `Весит ${dec(pick([1.1, 1.3, 1.6]))} кг.` : ""),
          seller: [] };
      },
      case: () => {
        const [b, m] = pick([["Spigen", "Ultra Hybrid"], ["Deppa", "Gel Color"], ["uBear", "Touch Mag Case"], ["Spigen", "Liquid Air"]]);
        const dev = pick(["Apple iPhone 15", "Samsung Galaxy A55", "Xiaomi Redmi Note 13", "Apple iPhone 15 Pro"]);
        const mat = pick(["силикона", "поликарбоната", "экокожи"]);
        const col = pick(["прозрачный", "черный", "синий"]);
        return { title: `Чехол ${b} ${m} для ${dev}, ${col}`,
          description: `Чехол выполнен из ${mat}, защищает углы и камеру. Совместим с беспроводной зарядкой.`,
          seller: [] };
      },
    };
  }

  /* ------------------------------------------------------------ prepared hard cases */
  const HARD = [
    { id: "h1", sku: "4100101", category: "smartphone",
      title: "Смартфон Xiaomi Redmi 13C 128 ГБ, зелёный",
      description: "Redmi 13C получил экран 6,74 дюйма с частотой 90 Гц и аккумулятор 5000 мАч. Смартфон оснащён 4 ГБ оперативной памяти и 128 ГБ встроенной. Разъём USB Type-C.",
      seller: [P("ОЗУ", "5 ГБ"), P("Цвет", "зеленый")], note: "одновременно 4 и 5 ГБ RAM" },
    { id: "h2", sku: "4100102", category: "coffee",
      title: "Кофемашина De'Longhi Magnifica S ECAM22.110.SB",
      description: "Автоматическая кофемашина с давлением помпы 15 бар и встроенной кофемолкой. Резервуар для воды 1,8 л. Мощность 1450 Вт. Корпус серебристый и белый.",
      seller: [], note: "«серебристый и белый», предложен только белый" },
    { id: "h3", sku: "4100103", category: "kettle",
      title: "Чайник Polaris PWK 1725CGLD",
      description: "Электрический чайник объёмом 1700 мл, мощностью 2,2 кВт. Корпус выполнен из нержавеющей стали чёрного цвета.",
      seller: [], note: "часть артикула предложена как цвет; разные обозначения единиц",
      inject: { color: { flag: "article", from: "title", find: "GLD", value: "золотистый", score: 0.71, first: true } } },
    { id: "h4", sku: "4100104", category: "case",
      title: "Чехол Deppa Sky Case для Samsung Galaxy A55, прозрачный",
      description: "Прозрачный чехол из поликарбоната с усиленными углами. Совместим с беспроводной зарядкой.",
      seller: [], note: "бренд совместимого устройства",
      inject: { brand: { compatFirst: true } } },
    { id: "h5", sku: "4100105", category: "sofa",
      title: "Диван Hoff Атланта прямой, бежевый",
      description: "Прямой диван с механизмом трансформации еврокнижка. Ширина 228 см, глубина 98 см, высота 90 см. Обивка — рогожка.",
      seller: [P("Цвет", "бежевый")], note: "вес действительно отсутствует" },
    { id: "h6", sku: "4100106", category: "fridge",
      title: "Холодильник ATLANT ХМ-4624-101 NL белый",
      description: "Двухкамерный холодильник с общим объёмом 357 л и системой No Frost в морозильной камере. Высота 1,97 м, ширина 59,5 см. Класс энергопотребления A+.",
      seller: [P("Цвет", "белый")], note: "1,97 м и 197 см — одна единица" },
  ];

  function applyInject(card, inj) {
    for (const [key, spec] of Object.entries(inj || {})) {
      const f = card.fields.find((x) => x.key === key);
      if (!f) continue;
      if (spec.compatFirst) {
        f.candidates.sort((a, b) => (b.flag === "compat") - (a.flag === "compat"));
      } else {
        const text = card.text[spec.from];
        const start = text.indexOf(spec.find);
        f.candidates.unshift({ source: spec.from, sourceLabel: "Заголовок", param: null, start, end: start + spec.find.length,
          raw: spec.find, value: spec.value, norm: spec.value, flag: spec.flag, score: spec.score, rejected: false });
      }
      f.rec = ATLAS.engine.recommend(f, f.candidates);
      Object.assign(f, { state: "pending", value: null, decidedBy: null, score: null, decidedAt: null });
    }
  }

  /* ------------------------------------------------------------ build */
  function build(dict) {
    const r = rng(20261015);
    const G = gens(r);
    const DAY = 86400000;
    const now = Date.now();
    const state = { version: 1, dict: ATLAS.model.clone(dict), cards: [], events: [], skuSeq: 4100200, createdAt: now };
    const counts = { smartphone: 12, laptop: 8, tv: 8, headphones: 7, fridge: 7, washer: 6, vacuum: 7, kettle: 7, coffee: 6,
                     sofa: 8, mattress: 7, chair: 6, chandelier: 8, lamp: 5, faucet: 6, drill: 6, case: 7 };
    const jobs = [];
    for (const [cat, n] of Object.entries(counts)) for (let i = 0; i < n; i++) jobs.push(cat);
    jobs.sort(() => r() - 0.5);
    const seenTitles = new Set();
    jobs.forEach((cat, i) => {
      let p = G[cat]();
      for (let k = 0; k < 4 && seenTitles.has(p.title); k++) p = G[cat]();
      seenTitles.add(p.title);
      const age = Math.floor(r() * 44) + 1;
      const t0 = now - age * DAY - Math.floor(r() * DAY * 0.6);
      const card = ATLAS.model.newCard(state, { name: p.title, category: cat, text: { title: p.title, description: p.description, seller: p.seller },
                                                origin: "catalog", t: t0 });
      const isNew = i < 9;
      if (isNew) {
        card.createdAt = now - Math.floor(r() * DAY * 1.5);
        card.updatedAt = card.createdAt;
        state.cards.push(card);
        return;
      }
      ATLAS.model.processCard(state, card, t0);
      // people review most older cards; recent ones are still waiting
      let reviewed = age > 6 ? r() < 0.82 : r() < 0.25;
      if (age <= 20 && card.fields.some((f) => f.state === "conflict")) reviewed = false;   // fresh conflicts are still in the queue
      if (reviewed) humanPass(state, card, t0 + DAY * (0.15 + r() * Math.min(age - 0.5, 3)), r);
      else if (r() < 0.3) partialPass(state, card, t0 + DAY * 0.3, r);
      state.cards.push(card);
    });
    for (const h of HARD) {
      const t0 = now - DAY * (0.4 + HARD.indexOf(h) * 0.1);
      const card = ATLAS.model.newCard(state, { name: h.title, sku: h.sku, category: h.category,
        text: { title: h.title, description: h.description, seller: h.seller }, origin: "catalog", t: t0 });
      card.id = h.id;
      ATLAS.model.processCard(state, card, t0);
      applyInject(card, h.inject);
      card.hardCase = h.note;
      state.cards.push(card);
    }
    state.events.sort((a, b) => a.t - b.t);
    return state;
  }

  /* decisions a person made earlier: follow the recommendation, sometimes overrule it */
  function humanPass(state, card, t, r) {
    const M = ATLAS.model;
    for (const f of card.fields) {
      if (M.FIELD_STATE[f.state].decided) continue;
      t += 40000 + r() * 90000;
      const code = f.rec.code;
      if (code === "accept" || code === "normalize") {
        if (r() < 0.12) M.correct(state, card, f.key, M.proposal(f).value, t); else M.accept(state, card, f.key, t);
      } else if (code === "complete") M.correct(state, card, f.key, f.rec.suggest, t);
      else if (code === "conflict") {
        const cs = f.candidates.filter((c) => !c.rejected);
        M.choose(state, card, f.key, f.candidates.indexOf(cs[Math.floor(r() * cs.length)]), t);
      } else if (code === "reject") {
        M.rejectCandidate(state, card, f.key, t);
        t += 30000;
        if (M.proposal(f)) M.accept(state, card, f.key, t); else M.confirmAbsent(state, card, f.key, t);
      } else M.confirmAbsent(state, card, f.key, t);
    }
  }

  function partialPass(state, card, t, r) {
    const M = ATLAS.model;
    for (const f of card.fields) {
      if (f.state === "pending" && f.rec.code === "accept" && r() < 0.6) { t += 60000; M.accept(state, card, f.key, t); }
    }
  }

  return { build, HARD };
})();
