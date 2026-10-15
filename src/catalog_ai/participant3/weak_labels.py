"""Conservative catalog-to-text alignment; never an inference fallback.

Registry IDs for new fields preserve the exact normalized catalog field name.
They are provisional, rather than pretending that root guidance is gold BIO.
"""
from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation

from .prepare import attribute_for_name, key_normalized, QUERIES

EXCLUDED_NAME = re.compile(
    r'страна|гаранти|продавец|потратить|бонус|акци|подборк|скидк|рассроч|цена|стоимость|'
    r'рейтинг|отзыв|преимуществ|обратите внимание|описание|ссылка|фотограф|изображени|'
    r'срок службы|код товара|артикул продавца|штрихкод|рекомендаци|уникальн|важная информац', re.I)
EMPTY_VALUES = {'', '-', 'none', 'null', 'нет', 'да', 'не указан', 'не указано', 'есть', 'отсутствует', 'n/a', 'другие', 'другое', 'разные'}
UNIT_PATTERN = (
    r'(?:мА\s*[·*]?\s*ч|mAh|А\s*[·*]?\s*ч|Ah|Вт\s*[·*]?\s*ч|Wh|'
    r'ГБ|GB|МБ|MB|ТБ|TB|GiB|TiB|ГГц|GHz|МГц|MHz|кГц|kHz|Гц|Hz|'
    r'кВт|kW|Вт|W|ВА|VA|мВ|mV|В|V|мА|mA|А|A|'
    r'кг|kg|мг|mg|г|g|мм²|mm2|см²|cm2|м²|m2|мм|mm|см|cm|км|km|м|m|'
    r'мл|ml|л|l|Па|Pa|кПа|kPa|бар|bar|дБ|dB|Ом|ohm|К|K|'
    r'мин|minutes?|час\w*|hours?|сек\w*|seconds?|шт\.?|pcs|%|°C|°С|'
    r'дюйм\w*|inch\w*|["″])'
)
UNIT_AFTER = re.compile(r'\s*' + UNIT_PATTERN + r'(?![\w])', re.I)
NUMERIC = re.compile(r'[+-]?\d+(?:[.,]\d+)?')


def normalized_name(name):
    return key_normalized(name).removesuffix('_search')


def descriptor(name):
    name = normalized_name(name)
    if not name or len(name) > 140 or EXCLUDED_NAME.search(name):
        return None
    known = attribute_for_name(name)
    if known:
        return {'attribute_id': known, 'name': QUERIES[known], 'catalog_names': [name],
                'origin': 'existing_project_id'}
    ident = 'catalog_' + hashlib.sha256(name.encode()).hexdigest()[:12]
    return {'attribute_id': ident, 'name': name, 'catalog_names': [name],
            'origin': 'provisional_exact_catalog_name'}


def targets(offer, allowed_names):
    result = {}
    for attr, key in [('brand', 'vendor'), ('model', 'model')]:
        value = str(offer.get(key) or '').strip()
        if key_normalized(value) not in EMPTY_VALUES:
            result.setdefault(attr, {'name': QUERIES[attr], 'values': []})['values'].append((value, ''))
    fields = offer.get('param', [])
    if isinstance(fields, dict):
        fields = [fields]
    for field in fields:
        if not isinstance(field, dict):
            continue
        name = normalized_name(field.get('@name', ''))
        if name not in allowed_names:
            continue
        desc = descriptor(name)
        if not desc:
            continue
        raw = field.get('#text')
        if not isinstance(raw, (str, int, float)):
            continue
        value = str(raw).strip()
        if key_normalized(value) in EMPTY_VALUES or len(value) > 180:
            continue
        attr = desc['attribute_id']
        result.setdefault(attr, {'name': desc['name'], 'values': []})['values'].append(
            (value, str(field.get('@unit') or '').strip()))
    for entry in result.values():
        entry['values'] = list(dict.fromkeys(entry['values']))
        # Catalog facets can contain both coarse ranges and exact search values.
        # Prefer exact candidates over facet ranges; conflicting concrete scalar
        # values (e.g. 4 GB and 5 GB RAM) are not training targets.
        precise = [x for x in entry['values'] if not re.search(r'\d\s*[-–]\s*\d|\bот\s+\d|\bдо\s+\d', x[0], re.I)]
        if precise:
            entry['values'] = precise
        numeric = set()
        for value, unit in entry['values']:
            m = re.fullmatch(r'([\d.,]+)\s*([A-Za-zА-Яа-я·²"″]*)', value)
            if m:
                try:
                    number = format(Decimal(m[1].replace(',', '.')).normalize(), 'f')
                    u = re.sub(r'\s+', '', m[2] or unit).lower()
                    u = {'гб': 'gb', 'мб': 'mb', 'тб': 'tb', 'вт': 'w', 'ма·ч': 'mah', 'мач': 'mah'}.get(u, u)
                    numeric.add((number, u))
                except InvalidOperation:
                    pass
        entry['conflicting_numeric_targets'] = len(numeric) > 1
    result = {attr: e for attr, e in result.items() if not e['conflicting_numeric_targets']}
    return result


def canonical_unit(unit):
    u = re.sub(r'[\s·*]', '', unit).lower().rstrip('.')
    return {'гб': 'gb', 'мб': 'mb', 'тб': 'tb', 'вт': 'w', 'квт': 'kw', 'в': 'v', 'а': 'a',
            'мач': 'mah', 'ач': 'ah', 'втч': 'wh', 'мм': 'mm', 'см': 'cm', 'м': 'm',
            'кг': 'kg', 'г': 'g', 'мл': 'ml', 'л': 'l', 'ггц': 'ghz', 'мгц': 'mhz',
            'гц': 'hz', 'к': 'k', 'дб': 'db', 'ом': 'ohm', 'па': 'pa', 'кпа': 'kpa',
            'бар': 'bar', '"': 'inch', '″': 'inch', 'дюйма': 'inch', 'дюймов': 'inch',
            'дюйм': 'inch'}.get(u, u)


def _numeric_pattern(value):
    try:
        normalized = format(Decimal(value.replace(',', '.')).normalize(), 'f')
    except InvalidOperation:
        return None
    if '.' in normalized:
        whole, fractional = normalized.split('.', 1)
        return re.escape(whole) + r'[.,]' + re.escape(fractional) + r'0*'
    return re.escape(normalized) + r'(?:[.,]0+)?'


def aligned_spans(text, attribute_id, name, options):
    spans = {}
    for raw, unit_hint in options:
        numeric = bool(NUMERIC.fullmatch(raw))
        if numeric:
            value_pattern = _numeric_pattern(raw)
            if value_pattern is None:
                continue
        else:
            if len(raw) < 3 and attribute_id not in {'brand', 'model'}:
                continue
            if len(raw) < 2:
                continue
            value_pattern = re.escape(raw).replace(r'\ ', r'\s+')
            value_pattern = value_pattern.replace('ё', '[её]').replace('Ё', '[ЕЁ]')
        if numeric and Decimal(raw.replace(',', '.')) == 0:
            continue  # zero-valued catalog facets are often missing-value sentinels
        pattern = r'(?<![\w.,])' + value_pattern + r'(?![\d.,])' if numeric else r'(?<!\w)' + value_pattern + r'(?!\w)'
        for match in re.finditer(pattern, text, re.I):
            start, end = match.span()
            if text.rfind('<', 0, start) > text.rfind('>', 0, start):
                continue  # never learn values from an HTML tag or its attributes
            if numeric:
                unit = UNIT_AFTER.match(text, end)
                # Numeric catalog values require a unit in source, or an exact
                # field label just before the value. No naked model-number hits.
                anchor = re.search(re.escape(normalized_name(name)) + r'\s*[:=]?\s*$',
                                   key_normalized(text[max(0, start - len(name) - 8):start]))
                if not unit and not anchor:
                    continue
                expected = unit_hint or {'ram_gb': 'GB', 'storage_gb': 'GB',
                                         'screen_inches': 'inch', 'battery_mah': 'mAh'}.get(attribute_id, '')
                if unit and expected and canonical_unit(unit.group().strip()) != canonical_unit(expected):
                    continue
                if unit and not expected and not anchor:
                    continue
                if unit:
                    end = unit.end()
                if attribute_id in {'ram_gb', 'storage_gb'}:
                    before = key_normalized(text[max(0, start - 70):start])
                    ram = list(re.finditer(r'оперативн|озу|\bram\b', before))
                    storage = list(re.finditer(r'встроенн|накопител|\bssd\b|\bhdd\b|хранилищ', before))
                    latest_ram = ram[-1].start() if ram else -1
                    latest_storage = storage[-1].start() if storage else -1
                    if attribute_id == 'ram_gb' and latest_ram <= latest_storage:
                        continue
                    if attribute_id == 'storage_gb' and latest_ram > latest_storage:
                        continue
            spans[(start, end)] = {'start': start, 'end': end, 'label': attribute_id,
                                   'quote': text[start:end], 'catalog_value': raw,
                                   'catalog_unit': unit_hint}
    chosen = []
    for span in sorted(spans.values(), key=lambda s: (-(s['end'] - s['start']), s['start'])):
        if not any(span['start'] < x['end'] and x['start'] < span['end'] for x in chosen):
            chosen.append(span)
    return sorted(chosen, key=lambda s: s['start'])


def variant_key(offer):
    brand = key_normalized(offer.get('vendor') or '')
    model = key_normalized(offer.get('model') or '')
    if model in EMPTY_VALUES or len(model) < 2:
        model = key_normalized(offer.get('name') or '')
    for attr, entry in targets(offer, {'цвет', 'цвет корпуса', 'основной цвет'}).items():
        if attr == 'color':
            for value, _ in entry['values']:
                model = re.sub(r'(?<!\w)' + re.escape(key_normalized(value)) + r'(?!\w)', ' ', model)
    model = re.sub(r'\b\d+(?:[.,]\d+)?\s*(?:гб|gb|тб|tb|gib|tib)\b', ' ', model)
    model = re.sub(r'\b\d+\s*/\s*\d+\b', ' ', model)
    model = re.sub(r'[^\w]+', ' ', model).strip()
    return hashlib.sha256((brand + '|' + model).encode()).hexdigest()[:24]
