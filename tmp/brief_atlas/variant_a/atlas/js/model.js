/* Cards, fields, decisions, metrics. One state object; every number on every page is computed from it. */
window.ATLAS = window.ATLAS || {};

ATLAS.model = (function () {
  const AUTO_MIN_SCORE = 0.9;
  const STATUS = {
    new: { label: "Новое поступление", order: 1 },
    processing: { label: "Обрабатывается", order: 2 },
    conflict: { label: "Обнаружено противоречие", order: 0 },
    review: { label: "Требуется проверка", order: 3 },
    ready: { label: "Готово к выгрузке", order: 4 },
  };
  const FIELD_STATE = {
    auto: { label: "Принято автоматически", decided: true },
    accepted: { label: "Принято", decided: true },
    corrected: { label: "Исправлено", decided: true },
    absent: { label: "Отсутствует в тексте", decided: true },
    pending: { label: "Ждёт решения", decided: false },
    conflict: { label: "Противоречие", decided: false },
    nodata: { label: "Нет данных", decided: false },
    empty: { label: "Кандидат отклонён", decided: false },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let seq = 0;
  const uid = (p) => p + Date.now().toString(36) + (++seq).toString(36);

  /* ------------------------------------------------------------ building */
  function fieldFrom(f) {
    const top = f.candidates[0];
    const out = { key: f.key, name: f.name, kind: f.kind, unit: f.unit, candidates: f.candidates.map((c) => ({ ...c, rejected: false })),
                  rec: f.rec, state: "pending", value: null, decidedBy: null, decidedAt: null, score: null };
    if (f.rec.code === "nodata") out.state = "nodata";
    else if (f.rec.code === "conflict") out.state = "conflict";
    else if (f.rec.code === "accept" && top && top.score >= AUTO_MIN_SCORE) {
      Object.assign(out, { state: "auto", value: top.value, decidedBy: "auto", score: top.score });
    }
    return out;
  }

  function processCard(state, card, t, opts = {}) {
    const res = ATLAS.engine.process({ ...card.text, category: opts.category || card.category }, state.dict, { category: opts.category || card.category });
    card.category = res.category;
    card.fields = res.fields.map(fieldFrom);
    card.stage = "done";
    card.processedAt = t;
    card.updatedAt = t;
    if (!card.name) card.name = card.text.title || ATLAS.engine.suggestTitle(card.text.description);
    for (const f of card.fields) if (f.state === "auto") {
      f.decidedAt = t;
      logEvent(state, { t, cardId: card.id, category: card.category, field: f.name, action: "auto", by: "system" });
    }
    return card;
  }

  function newCard(state, { name, sku, category, text, origin, t }) {
    const id = uid("c");
    return { id, sku: sku || nextSku(state), name: name || "", category: category || null, text, origin: origin || "catalog",
             stage: "new", fields: [], createdAt: t, updatedAt: t, processedAt: null, lastOpenedAt: null, exportedAt: null };
  }

  function nextSku(state) {
    state.skuSeq = (state.skuSeq || 4100000) + 1;
    return String(state.skuSeq);
  }

  function logEvent(state, e) {
    state.events.push({ id: uid("e"), ...e });
  }

  /* ------------------------------------------------------------ derived */
  function status(card) {
    if (card.stage === "new") return "new";
    if (card.stage === "processing") return "processing";
    if (card.fields.some((f) => f.state === "conflict")) return "conflict";
    if (card.fields.some((f) => !FIELD_STATE[f.state].decided)) return "review";
    return "ready";
  }

  function progress(card) {
    const total = card.fields.length;
    const done = card.fields.filter((f) => FIELD_STATE[f.state].decided).length;
    return { done, total, share: total ? done / total : 0 };
  }

  function proposal(f) {
    return ((f && f.candidates) || []).find((c) => !c.rejected) || null;
  }

  function reason(card) {
    const st = status(card);
    if (st === "new") return { kind: "new", text: "Ещё не обработана — запустите обработку" };
    if (st === "processing") return { kind: "new", text: "Система готовит характеристики" };
    const conflict = card.fields.find((f) => f.state === "conflict");
    if (conflict) {
      const vals = [...new Set(conflict.candidates.filter((c) => !c.rejected).map((c) => c.value))].slice(0, 2);
      return { kind: "conflict", text: `${conflict.name}: ${vals.join(" или ")}` };
    }
    const pend = card.fields.filter((f) => f.state === "pending");
    const special = pend.find((f) => ["reject", "complete"].includes(f.rec.code));
    if (special) return { kind: special.rec.code, text: `${special.name}: ${special.rec.code === "reject" ? "подозрительное предложение" : "предложен один из двух цветов"}` };
    if (pend.length) return { kind: "pending", text: `${pend.length} ${plural(pend.length, "предложение ждёт", "предложения ждут", "предложений ждут")} решения` };
    const empty = card.fields.filter((f) => f.state === "nodata" || f.state === "empty");
    if (empty.length) return { kind: "nodata", text: `Нет данных: ${empty.map((f) => f.name.toLowerCase()).slice(0, 2).join(", ")}${empty.length > 2 ? "…" : ""}` };
    return { kind: "ready", text: "" };
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  /* fields: total / prepared by the system / accepted automatically / checked by a person / waiting */
  function fieldStats(cards) {
    const s = { cards: 0, total: 0, prepared: 0, auto: 0, accepted: 0, corrected: 0, absent: 0, waiting: 0, conflict: 0 };
    for (const c of cards) {
      if (c.stage !== "done") continue;
      s.cards++;
      for (const f of c.fields) {
        s.total++;
        if (f.candidates.length) s.prepared++;
        if (f.state === "auto") s.auto++;
        else if (f.state === "accepted") s.accepted++;
        else if (f.state === "corrected") s.corrected++;
        else if (f.state === "absent") s.absent++;
        else { s.waiting++; if (f.state === "conflict") s.conflict++; }
      }
    }
    s.human = s.accepted + s.corrected + s.absent;
    s.automation = s.total ? s.auto / s.total : 0;
    return s;
  }

  /* ------------------------------------------------------------ decisions (each returns an undo record) */
  function snapshot(state, card, label) {
    return { cardId: card.id, before: clone(card), eventsLen: state.events.length, label };
  }

  function decide(state, card, f, patch, action, t) {
    Object.assign(f, patch, { decidedAt: t });
    card.updatedAt = t;
    logEvent(state, { t, cardId: card.id, category: card.category, field: f.name, action, by: "human" });
  }

  function accept(state, card, key, t) {
    const f = card.fields.find((x) => x.key === key);
    const c = proposal(f);
    if (!c) return null;
    const u = snapshot(state, card, `Принято: ${f.name}`);
    decide(state, card, f, { state: "accepted", value: c.value, decidedBy: "human", score: c.score }, "accept", t);
    return u;
  }

  function choose(state, card, key, idx, t) {
    const f = card.fields.find((x) => x.key === key);
    const c = f.candidates[idx];
    const u = snapshot(state, card, `Выбрано значение: ${f.name}`);
    decide(state, card, f, { state: "accepted", value: c.value, decidedBy: "human", score: c.score }, "resolve", t);
    return u;
  }

  function correct(state, card, key, value, t) {
    const f = card.fields.find((x) => x.key === key);
    const u = snapshot(state, card, `Исправлено: ${f.name}`);
    // a manual value never keeps the model's score
    decide(state, card, f, { state: "corrected", value, decidedBy: "human", score: null }, "correct", t);
    return u;
  }

  function rejectCandidate(state, card, key, t) {
    const f = card.fields.find((x) => x.key === key);
    const c = proposal(f);
    if (!c) return null;
    const u = snapshot(state, card, `Отклонён кандидат: ${f.name}`);
    c.rejected = true;
    const rest = f.candidates.filter((x) => !x.rejected);
    if (rest.length) {
      f.rec = ATLAS.engine.recommend(f, rest);
      f.state = f.rec.code === "conflict" ? "conflict" : "pending";
    } else {
      f.state = "empty";
      f.rec = { code: "empty", title: "Других вариантов нет",
        text: "Отклонённое предложение не значит, что характеристики нет. Укажите значение вручную или подтвердите, что в тексте его нет." };
    }
    f.value = null; f.decidedBy = null; f.score = null;
    card.updatedAt = t;
    logEvent(state, { t, cardId: card.id, category: card.category, field: f.name, action: "reject", by: "human" });
    return u;
  }

  function confirmAbsent(state, card, key, t) {
    const f = card.fields.find((x) => x.key === key);
    const u = snapshot(state, card, `Подтверждено отсутствие: ${f.name}`);
    decide(state, card, f, { state: "absent", value: null, decidedBy: "human", score: null }, "absent", t);
    return u;
  }

  function undo(state, u) {
    const i = state.cards.findIndex((c) => c.id === u.cardId);
    if (i >= 0) state.cards[i] = u.before;
    else state.cards.unshift(u.before);
    state.events.length = u.eventsLen;
  }

  return { STATUS, FIELD_STATE, AUTO_MIN_SCORE, processCard, newCard, status, progress, proposal, reason, fieldStats,
           accept, choose, correct, rejectCandidate, confirmAbsent, undo, snapshot, logEvent, plural, clone, uid };
})();
