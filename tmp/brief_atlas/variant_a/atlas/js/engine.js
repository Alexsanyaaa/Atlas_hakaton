/* Local, deterministic processing: text of a product -> category, title, candidate values with quotes,
   a recommendation for every characteristic. Nothing is invented: a value that is not in the text stays empty.
   Dictionaries (colors, brands, units, materials, synonyms) come from the state and are editable. */
window.ATLAS = window.ATLAS || {};

ATLAS.engine = (function () {
  const L = "\\p{L}\\d";
  const fold = (s) => (s || "").toLowerCase().replace(/ё/g, "е");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const split = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const wordRe = (variants, flags = "giu") =>
    new RegExp(`(?<![${L}])(?:${variants.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![${L}])`, flags);

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }

  /* ------------------------------------------------------------ dictionaries */
  function compile(dict) {
    const by = (t) => dict.filter((d) => d.type === t);
    const table = (t) => by(t).flatMap((d) => split(d.from).map((v) => ({ v, to: d.to, id: d.id })));
    const units = new Map();
    for (const d of by("unit")) for (const v of split(d.from)) units.set(fold(v), { to: d.to, factor: Number(d.factor) || 1, id: d.id });
    const unitAlt = [...units.keys()].sort((a, b) => b.length - a.length).map(esc).join("|");
    const syn = new Map();
    for (const d of by("synonym")) for (const v of split(d.from)) syn.set(fold(v), d.to);
    const mk = (rows) => ({ rows, re: rows.length ? wordRe(rows.map((r) => r.v)) : null,
                            map: new Map(rows.map((r) => [fold(r.v), r])) });
    return {
      colors: mk(table("color")), brands: mk(table("brand")), materials: mk(table("material")),
      units, syn,
      numRe: new RegExp(`(?<![${L}.,])(\\d+(?:[.,]\\d+)?)\\s?(${unitAlt})(?![${L}])`, "giu"),
    };
  }

  /* ------------------------------------------------------------ sources */
  function sources(p) {
    const out = [];
    if (p.title) out.push({ id: "title", label: "Заголовок", text: p.title });
    if (p.description) out.push({ id: "description", label: "Описание", text: p.description });
    (p.seller || []).forEach((s, i) => {
      if (s && s.value) out.push({ id: "seller:" + i, label: "Параметры продавца", param: s.name, text: String(s.value) });
    });
    return out;
  }

  const sentenceBounds = (text, a, b) => {
    let s = a;
    while (s > 0 && !/[.!?\n;]/.test(text[s - 1])) s--;
    let e = b;
    while (e < text.length && !/[.!?\n;]/.test(text[e])) e++;
    return [s, e];
  };

  /* ------------------------------------------------------------ values */
  const fmtNum = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return String(r).replace(".", ",");
  };
  const numValue = (v, unit) => (unit === "″" ? `${fmtNum(v)}″` : `${fmtNum(v)} ${unit}`);
  const parseNum = (s) => Number(String(s).replace(",", "."));

  function detectCategory(p) {
    let best = null;
    let bestScore = 0;
    for (const c of Object.values(ATLAS.CATEGORIES)) {
      let sc = 0;
      for (const w of c.words) {
        const re = new RegExp(`(?<![${L}])${esc(fold(w))}`, "gu");
        sc += (fold(p.title).match(re) || []).length * 3 + (fold(p.description).match(re) || []).length;
      }
      if (sc > bestScore) { bestScore = sc; best = c.key; }
    }
    return best;
  }

  function suggestTitle(text) {
    const first = (text || "").split(/\n/).map((s) => s.trim()).find(Boolean) || "";
    const sent = first.split(/(?<=[.!?])\s/)[0];
    let t = sent.length <= 110 ? sent : sent.slice(0, 110).replace(/\s+\S*$/, "");
    return t.replace(/[.!?:;]+$/, "");
  }

  /* ------------------------------------------------------------ extraction per kind */
  function cand(src, start, end, value, norm, extra = {}) {
    return { source: src.id, sourceLabel: src.label, param: src.param || null, start, end,
             raw: src.text.slice(start, end), value, norm, ...extra };
  }

  function extractNumbers(cat, srcs, C, used) {
    const out = {};
    const numFields = cat.fields.filter((f) => f.kind === "num");
    const byUnit = {};
    for (const f of numFields) (byUnit[f.unit] = byUnit[f.unit] || []).push(f);
    for (const src of srcs) {
      const t = src.text;
      const tf = fold(t);
      const mapped = src.param ? mapParam(src.param, cat, C) : null;
      // memory "8/256 ГБ" (phones, laptops)
      if (!src.param && byUnit["ГБ"]) {
        for (const m of t.matchAll(/(?<![\d.,])(\d{1,2})\s?\/\s?(\d{2,4})\s?(ГБ|Гб|GB|Gb|ТБ|TB)(?![\p{L}])/gu)) {
          const ram = cat.fields.find((f) => f.key === "ram");
          const st = cat.fields.find((f) => f.key === "storage");
          const k = (C.units.get(fold(m[3])) || { factor: 1 }).factor;
          const s = m.index, e = m.index + m[0].length;
          used.push([src.id, s, e]);
          if (ram) (out.ram = out.ram || []).push(cand(src, s, e, numValue(+m[1], "ГБ"), "ГБ:" + +m[1], { implied: true, ctx: 1 }));
          if (st) (out.storage = out.storage || []).push(cand(src, s, e, numValue(+m[2] * k, "ГБ"), "ГБ:" + +m[2] * k, { implied: true, ctx: 1 }));
        }
      }
      // sizes "210×95×88 см (Ш×Г×В)" / "160×200"
      const dimKeys = cat.fields.filter((f) => ["width", "depth", "height", "length"].includes(f.key)).map((f) => f.key);
      if (!src.param && dimKeys.length >= 2) {
        const re = /(?<![\d.,])(\d{2,4}(?:[.,]\d+)?)\s?[x×х*]\s?(\d{2,4}(?:[.,]\d+)?)(?:\s?[x×х*]\s?(\d{2,4}(?:[.,]\d+)?))?\s?(см|мм|cm|mm)?/giu;
        for (const m of t.matchAll(re)) {
          const after = tf.slice(m.index + m[0].length, m.index + m[0].length + 18);
          const before = tf.slice(Math.max(0, m.index - 25), m.index);
          if (/vesa/.test(before)) continue;
          const k = m[4] ? (C.units.get(fold(m[4])) || { factor: 1 }).factor : 1;
          let order = null;
          if (m[3] && /ш\s?[x×х*]\s?г\s?[x×х*]\s?в/.test(after)) order = ["width", "depth", "height"];
          else if (m[3] && /ш\s?[x×х*]\s?в\s?[x×х*]\s?г/.test(after)) order = ["width", "height", "depth"];
          else if (!m[3] && dimKeys.includes("length")) order = ["width", "length"];
          if (!order) continue;
          [m[1], m[2], m[3]].forEach((g, i) => {
            const key = order[i];
            if (!g || !key || !dimKeys.includes(key)) return;
            const s = m.index + m[0].indexOf(g, i === 0 ? 0 : m[0].indexOf(m[i]) + m[i].length);
            const v = parseNum(g) * k;
            used.push([src.id, s, s + g.length]);
            (out[key] = out[key] || []).push(cand(src, s, s + g.length, numValue(v, "см"), "см:" + v, { implied: true, ctx: 1 }));
          });
        }
      }
      for (const m of t.matchAll(C.numRe)) {
        const s = m.index, e = m.index + m[0].length;
        if (used.some(([id, a, b]) => id === src.id && s < b && a < e)) continue;
        const u = C.units.get(fold(m[2]));
        if (!u || !byUnit[u.to]) continue;
        const v = parseNum(m[1]) * u.factor;
        const before = tf.slice(Math.max(0, s - 6), s);
        if (/(^|\s)до\s*$/.test(before)) continue;
        let field = null;
        let ctx = 0;
        if (mapped && mapped.kind === "num" && mapped.unit === u.to) { field = mapped; ctx = 1; }
        else if (!src.param) {
          const [a, b] = sentenceBounds(t, s, e);
          let best = 99;
          for (const f of byUnit[u.to]) {
            if (f.exclude && f.exclude.some((x) => tf.slice(Math.max(a, s - 35), s).includes(x))) continue;
            for (const k of f.kw || []) {
              let i = tf.indexOf(k, a);
              while (i >= 0 && i < b) {
                const d = i < s ? s - (i + k.length) : i - e;
                if (d >= 0 && d < best && d <= 45) { best = d; field = f; }
                i = tf.indexOf(k, i + 1);
              }
            }
          }
          ctx = field ? 1 : 0;
          if (!field) {
            const solo = byUnit[u.to].filter((f) => f.solo && !(f.exclude || []).some((x) => tf.slice(Math.max(a, s - 35), s).includes(x)));
            if (byUnit[u.to].length === 1 && solo.length === 1) field = solo[0];
          }
        }
        if (!field) continue;
        used.push([src.id, s, e]);
        (out[field.key] = out[field.key] || []).push(cand(src, s, e, numValue(v, u.to), u.to + ":" + Math.round(v * 1000) / 1000, { ctx }));
      }
    }
    return out;
  }

  function mapParam(name, cat, C) {
    const target = C.syn.get(fold(name).trim()) || name;
    return cat.fields.find((f) => fold(f.name) === fold(target)) ||
      cat.fields.find((f) => fold(target).includes(fold(f.name)) || fold(f.name).includes(fold(target))) || null;
  }

  function dictMatches(D, src) {
    if (!D.re) return [];
    return [...src.text.matchAll(D.re)].map((m) => ({ m, row: D.map.get(fold(m[0])) })).filter((x) => x.row);
  }

  function extractField(f, cat, srcs, C, p) {
    const out = [];
    for (const src of srcs) {
      const t = src.text;
      const tf = fold(t);
      const mapped = src.param ? mapParam(src.param, cat, C) : null;
      if (src.param && mapped !== f) continue;
      if (f.kind === "brand") {
        for (const { m, row } of dictMatches(C.brands, src)) {
          const before = tf.slice(Math.max(0, m.index - 22), m.index);
          const compat = /(для|совместим\S*\s+с|подходит\s+для|подходит\s+к)\s+(\S+\s+)?$/.test(before);
          out.push(cand(src, m.index, m.index + m[0].length, row.to, fold(row.to), compat ? { flag: "compat" } : {}));
        }
      } else if (f.kind === "color") {
        const ms = dictMatches(C.colors, src);
        for (let i = 0; i < ms.length; i++) {
          const { m, row } = ms[i];
          const before = tf.slice(Math.max(0, m.index - 24), m.index);
          if (/подсветк|свечени|индикатор/.test(before)) continue;
          const next = ms[i + 1];
          if (next && next.row.to !== row.to && /^\s*(и|,|\/|или)\s*$/.test(t.slice(m.index + m[0].length, next.m.index))) {
            // two colors in one phrase: the proposal takes one of them, the recommendation completes it
            const both = [row.to, next.row.to];
            out.push(cand(src, next.m.index, next.m.index + next.m[0].length, next.row.to, fold(next.row.to),
              { flag: "partial", suggest: both.join(", "), others: [{ start: m.index, end: m.index + m[0].length, raw: m[0] }] }));
            i++;
            continue;
          }
          out.push(cand(src, m.index, m.index + m[0].length, row.to, fold(row.to)));
        }
        if (src.param && !out.some((c) => c.source === src.id)) out.push(cand(src, 0, t.length, fold(t).trim(), fold(t).trim()));
      } else if (f.kind === "material") {
        for (const { m, row } of dictMatches(C.materials, src)) {
          const [a, b] = sentenceBounds(t, m.index, m.index + m[0].length);
          const near = tf.slice(Math.max(a, m.index - 40), Math.min(b, m.index + m[0].length + 30));
          if (!src.param && f.kw && !f.kw.some((k) => near.includes(k))) continue;
          out.push(cand(src, m.index, m.index + m[0].length, row.to, fold(row.to)));
        }
      } else if (f.kind === "enum") {
        const found = [];
        for (const [canon, aliases] of f.options) {
          const re = wordRe(split(aliases));
          for (const m of t.matchAll(re)) found.push(cand(src, m.index, m.index + m[0].length, canon, fold(canon)));
        }
        for (const c of found) {
          const longer = found.some((o) => o !== c && o.start <= c.start && c.end <= o.end && o.end - o.start > c.end - c.start);
          if (!longer) out.push(c);
        }
      } else if (f.kind === "model" && src.id === "title") {
        const b = dictMatches(C.brands, src)[0];
        if (!b) continue;
        const start = b.m.index + b.m[0].length;
        let rest = t.slice(start);
        const cut = rest.search(/,|\(|\s\d+\s?\/\s?\d+|\s\d+(?:[.,]\d+)?\s?(?:ГБ|GB|Гб|см|мм|л|Вт|кг|дюйм|"|″)(?![\p{L}])/u);
        if (cut >= 0) rest = rest.slice(0, cut);
        const words = rest.trim().split(/\s+/).filter(Boolean);
        const kept = [];
        for (const w of words) {
          if (C.colors.map.has(fold(w)) || kept.length >= 4 || /^[а-яё]/.test(w) || /^\d+[×xх*]\d+/.test(w)) break;
          kept.push(w);
        }
        if (!kept.length) continue;
        const s = start + rest.indexOf(kept[0]);
        const e = s + kept.join(" ").length;
        out.push(cand(src, s, e, t.slice(s, e), fold(t.slice(s, e))));
      } else if (f.kind === "cpu") {
        const re = /(Intel\s+Core\s+(?:Ultra\s+\d+\s+\w+|i\d-\w+)|AMD\s+Ryzen\s+\d\s+\w+|Apple\s+M\d(?:\s(?:Pro|Max))?)/giu;
        for (const m of t.matchAll(re)) out.push(cand(src, m.index, m.index + m[0].length, m[0].replace(/\s+/g, " "), fold(m[0]).replace(/\s+/g, " ")));
      } else if (f.kind === "compat") {
        const re = /для\s+((?:Apple\s+)?(?:iPhone|Samsung|Galaxy|Xiaomi|Redmi|HONOR|Honor|Huawei|realme|POCO)[^,.;()\n]{0,32})/gu;
        for (const m of t.matchAll(re)) {
          const v = m[1].trim();
          const s = m.index + m[0].indexOf(m[1]);
          out.push(cand(src, s, s + v.length, v, fold(v)));
        }
      } else if (f.kind === "count") {
        for (const m of t.matchAll(/(?<![\d])(\d{1,2})\s?(?:ламп|рожк|-рожк)/giu)) {
          out.push(cand(src, m.index, m.index + m[0].length, `${m[1]} шт`, "шт:" + m[1], { implied: true }));
        }
        if (src.param) for (const m of t.matchAll(/^\s*(\d{1,2})\s*(шт)?\s*$/gu)) out.push(cand(src, 0, t.length, `${m[1]} шт`, "шт:" + m[1], { implied: true }));
      } else if (f.kind === "vesa") {
        for (const m of t.matchAll(/VESA[^\d\n]{0,12}(\d{2,3})\s?[x×х*]\s?(\d{2,3})/giu)) {
          const s = m.index + m[0].indexOf(m[1]);
          const raw = t.slice(s, m.index + m[0].length);
          out.push(cand(src, s, m.index + m[0].length, `${m[1]}×${m[2]} мм`, `vesa:${m[1]}x${m[2]}`, { implied: raw.includes("×") }));
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ scoring and recommendation */
  function score(c, f) {
    const base = c.source === "title" ? 0.95 : c.source === "description" ? 0.9 : 0.93;
    let s = base + (c.ctx ? 0.03 : 0) - (f.kind === "num" && !c.ctx ? 0.1 : 0);
    if (needsNormalize(c)) s -= 0.03;
    if (c.flag === "compat") s = 0.8;
    s += (hash(f.key + c.raw + c.source) - 0.6) * 0.06;
    return Math.max(0.5, Math.min(0.99, Math.round(s * 100) / 100));
  }

  function needsNormalize(c) {
    if (c.implied) return false;
    const a = fold(c.raw).replace(/\s+/g, " ").trim();
    const b = fold(c.value).replace(/\s+/g, " ").trim();
    return a !== b;
  }

  const srcName = (c) => (c.param ? `параметрах продавца («${c.param}»)` : c.source === "title" ? "заголовке" : "описании");

  function recommend(f, cands) {
    const real = cands.filter((c) => !c.flag || c.flag === "partial");
    if (!cands.length) return { code: "nodata", title: "Значение не найдено",
      text: "Ни в тексте, ни в параметрах продавца нет этой характеристики. Укажите значение, если знаете его, или подтвердите, что его нет." };
    const top = cands[0];
    if (top.flag === "compat") return { code: "reject", title: "Рекомендуется отклонить",
      text: `«${top.raw}» стоит после слова «для» — это бренд совместимого устройства, а не самого товара.` };
    if (top.flag === "article") return { code: "reject", title: "Рекомендуется отклонить",
      text: `«${top.raw}» — часть артикула, а не цвет товара.` };
    const norms = [...new Set(real.map((c) => c.norm))];
    if (norms.length > 1) {
      const a = real.find((c) => c.norm === norms[0]);
      const b = real.find((c) => c.norm === norms[1]);
      const sellerVsText = (a.param ? 1 : 0) + (b.param ? 1 : 0) === 1;
      return { code: "conflict", title: "Требуется проверка",
        text: `${sellerVsText ? "Описание и параметры продавца расходятся" : "В тексте указаны разные значения"}: «${a.raw}» в ${srcName(a)} и «${b.raw}» в ${srcName(b)}. Выберите верное.` };
    }
    if (top.flag === "partial") return { code: "complete", title: "Рекомендуется дополнить",
      text: `В тексте два цвета («${top.others[0].raw}» и «${top.raw}»), а предложен только один. Сохраните оба: ${top.suggest}.`, suggest: top.suggest };
    if (needsNormalize(top)) return { code: "normalize", title: "Рекомендуется нормализовать",
      text: `В тексте записано «${top.raw}», в каталоге это хранится как «${top.value}».` };
    const n = new Set(real.map((c) => c.source)).size;
    return { code: "accept", title: "Рекомендуется принять",
      text: `Значение прямо указано в ${srcName(top)}${n > 1 ? ` и подтверждено ещё в ${n - 1} ${n - 1 === 1 ? "источнике" : "источниках"}` : ""}.` };
  }

  /* ------------------------------------------------------------ main */
  function process(p, dict, opts = {}) {
    const C = compile(dict);
    const categoryKey = opts.category || p.category || detectCategory(p);
    const cat = ATLAS.CATEGORIES[categoryKey];
    const res = { category: cat ? categoryKey : null, fields: [] };
    if (!cat) return res;
    const srcs = sources(p);
    const used = [];
    const nums = extractNumbers(cat, srcs, C, used);
    for (const f of cat.fields) {
      let cs = f.kind === "num" ? (nums[f.key] || []) : extractField(f, cat, srcs, C, p);
      const seen = new Set();
      cs = cs.filter((c) => { const k = c.source + c.start + c.norm; if (seen.has(k)) return false; seen.add(k); return true; });
      cs.forEach((c) => { c.score = score(c, f); });
      cs.sort((a, b) => (a.flag === "compat") - (b.flag === "compat") || b.score - a.score);
      // a brand mentioned only as "для Samsung" is still proposed, so the person sees and rejects it
      const rec = recommend(f, cs);
      res.fields.push({ key: f.key, name: f.name, kind: f.kind, unit: f.unit || null, candidates: cs, rec });
    }
    return res;
  }

  return { process, detectCategory, suggestTitle, recommend, compile, sources, fold, needsNormalize, numValue };
})();
