"""Create portable blind manual review from dev; never read test examples."""
from __future__ import annotations

import collections
import gzip
import json
from pathlib import Path
import random
import sqlite3
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    data = ROOT / 'data/participant3_demo'
    out = ROOT / 'output/manual_review'
    out.mkdir(parents=True, exist_ok=True)
    registry = json.loads((data / 'attribute_registry.json').read_text(encoding='utf-8'))
    queries = registry['attribute_queries']
    cats = json.loads((data / 'categories.json').read_text(encoding='utf-8'))
    priority = ['brand', 'model', 'color', 'ram_gb', 'storage_gb', 'screen_inches', 'battery_mah', 'cpu']
    others = sorted((a for a in queries if a not in priority), key=lambda a:
                    (-registry['attributes'][a]['positive_examples'].get('train', 0), a))
    supported = set((priority + others)[:128])
    hints = collections.defaultdict(set)
    with gzip.open(data / 'dev.jsonl.gz', 'rt', encoding='utf-8') as f:
        for line in f:
            row = json.loads(line)
            if row['attribute_id'] in supported:
                hints[row['product_id']].add(row['attribute_id'])
    db = sqlite3.connect(f'file:{data / "catalog.sqlite"}?mode=ro', uri=True)
    buckets = collections.defaultdict(list)
    for pid, group, title, desc, cat, section in db.execute(
            "SELECT sku,group_id,title,description,category,section FROM products WHERE split='dev'"):
        if len(desc or '') >= 80 and pid in hints:
            buckets[section].append((pid, group, title, desc, cat, section))
    db.close()
    rng = random.Random(42)
    for values in buckets.values():
        rng.shuffle(values)
    preferred = ['10', '8', '4147', '1', '2427', '2687', '3', '34', '53', '32328', '30420', '9375', '54', '37', '2287']
    sections = [s for s in preferred if s in buckets] + sorted(s for s in buckets if s not in preferred)
    cards, groups = [], set()

    def take(section):
        while buckets[section]:
            pid, group, title, desc, cat, sec = buckets[section].pop()
            if group in groups:
                continue
            groups.add(group)
            extras = sorted(hints[pid] - {'brand', 'model', 'color'}, key=lambda a:
                            (0 if a in priority else 1 if queries[a] in ('серия', 'особенности', 'состав комплектации') else 2, a))[:2]
            cards.append({'product_id': pid, 'group_id': group, 'title': title, 'description': desc,
                          'category_id': cat, 'category_name': cats.get(cat, {}).get('#text', cat),
                          'section_id': sec, 'section_name': cats.get(sec, {}).get('#text', sec),
                          'seller_attributes': [], 'requested_attributes': ['brand', 'model', 'color'] + extras})
            return

    for _ in range(2):
        for section in preferred:
            if section in buckets:
                take(section)
    for section in sections:
        if len(cards) >= 50:
            break
        take(section)
    while len(cards) < 50 and any(buckets.values()):
        for section in sections:
            if len(cards) >= 50:
                break
            take(section)
    assert len(cards) == 50
    tasks = {f"{c['product_id']}:{a}": {'status': 'unreviewed', 'spans': [], 'note': ''}
             for c in cards for a in c['requested_attributes']}
    payload = {'dataset_id': 'participant3_manual_dev_v1', 'cards': cards,
               'attribute_names': {a: queries[a] for c in cards for a in c['requested_attributes']}, 'tasks': tasks}
    (out / 'cards.jsonl').write_text(''.join(json.dumps(c, ensure_ascii=False) + '\n' for c in cards), encoding='utf-8')
    (out / 'annotations_template.json').write_text(json.dumps({'dataset_id': payload['dataset_id'], 'tasks': tasks}, ensure_ascii=False, indent=2), encoding='utf-8')
    serialized = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = (ROOT / 'scripts/manual_review_template.html').read_text(encoding='utf-8')
    (out / 'review.html').write_text(template.replace('/*DATA_PLACEHOLDER*/', serialized), encoding='utf-8')
    manifest = {'dataset_id': payload['dataset_id'], 'cards': len(cards), 'tasks': len(tasks),
                'sections': dict(collections.Counter(c['section_name'] for c in cards)),
                'split': 'dev', 'test_used': False, 'independent_test': False,
                'human_verification_done': False, 'source': 'organizer_catalog',
                'selection': 'seed42; descriptions>=80; section diversity; brand/model/color on every card; up to2 silver-supported extra fields',
                'notes': 'Do not train on these cards. Absence and all spans require manual confirmation. Dev was already used for checkpoint selection; this is development audit, not independent test.'}
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (out / 'README.md').write_text(README, encoding='utf-8')
    files = list(out.iterdir()) + [ROOT / 'review_transformer.py']
    archive = ROOT / 'output/transformer_manual_review.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for file in files:
            name = 'review_transformer.py' if file.name == 'review_transformer.py' else f'manual_review/{file.name}'
            z.write(file, name)
    print(json.dumps({'archive': str(archive), 'cards': len(cards), 'tasks': len(tasks),
                      'sections': len(manifest['sections']), 'human_verification_done': False}, ensure_ascii=False))


README = """# Ручная проверка: 50 карточек

Откройте review.html в браузере и разметьте все запрошенные характеристики. Добавляйте все вхождения значений и отличайте отсутствие от неоднозначности. Разметка изначально не подтверждена; сохраняйте annotations.json.

Эти карточки взяты из dev, который уже участвовал в выборе модели. Не переносите их в train и не называйте независимым test. Для команды запуска и оценки смотрите основной README.md в корне проекта; актуальный исходный checkpoint — models/transformer/checkpoint.
"""


if __name__ == '__main__':
    main()
