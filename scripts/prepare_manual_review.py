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


README = '''# Ручная проверка трансформера: 50 карточек

Набор из проверочной части dev. Тестовая часть не используется. Это набор для поиска ошибок и доработки, а не независимая итоговая оценка. Эти карточки не добавлять в обучение.

## 1. Разметить карточки

Откройте review.html обычным браузером в Windows. Python для разметки не нужен. Для каждого поля подтвердите значения, их отсутствие или неоднозначность. Выделите мышкой точное значение в названии/описании и нажмите «Добавить выделение». Добавьте ВСЕ вхождения и все значения: например, «серебристый» и «белый», а также повторения в названии и описании. Отмечайте характеристику самого товара, а не совместимого устройства. Не используйте внешние характеристики или догадки. Поле «Модель» отделяйте от бренда, сохраняйте обозначение/серию, если они составляют имя модели. При сомнении ставьте «Неоднозначно» и оставляйте пояснение.

Разметка изначально пустая: ни одного ответа не подтверждено автоматически. Вывод модели не показывается, чтобы не подсказывать разметчику ответы. Прогресс сохраняется локально, если браузер разрешает localStorage; регулярно нажимайте «Скачать разметку». JSON можно загрузить обратно через «Загрузить разметку». Итоговый файл называется annotations.json. Проверьте число завершённых задач перед оценкой.

## 2. Перенести комплект на обучающий ПК

Распакуйте transformer_manual_review.zip в папку проекта transformer_rx9070xt_demo. Рядом с train_transformer.py появится review_transformer.py, а также папка manual_review. Веса модели остаются в прежней папке models/rx9070xt_demo/checkpoint.

Если архив лежит в Windows Downloads, внутри Ubuntu выполните, заменив ВАШЕ_ИМЯ:

```bash
cd "$HOME/transformer_rx9070xt_demo"
unzip "/mnt/c/Users/ВАШЕ_ИМЯ/Downloads/transformer_manual_review.zip" -d .
source scripts/rocm_wsl_env.sh
.venv-wsl/bin/python review_transformer.py predict
```

Команда проверяет все 50 карточек на вашей обученной модели и сохраняет manual_review/predictions.jsonl. Здесь обученного GPU-чекпоинта нет: предсказания нужно получить на вашем ПК. При предупреждении о неподдерживаемом поле оценка остановится; не считайте его отсутствующим значением.

## 3. Посчитать качество

Скопируйте скачанный из браузера annotations.json в manual_review внутри проекта. Затем в Ubuntu:

```bash
cd "$HOME/transformer_rx9070xt_demo"
.venv-wsl/bin/python review_transformer.py score
```

Результат: manual_review/manual_metrics.json. Показатели: точность, полнота, F1 по точным позициям в тексте, доля полностью правильных задач, количество ответов на полях с подтверждённым отсутствием, список ошибок. Неоднозначные задачи исключены, их число явно указано. По умолчанию незавершённая разметка запрещена. Для явно предварительной оценки используйте `score --allow-partial`.

Показатель считает все вхождения в двух полях. Одна характеристика, встретившаяся дважды, даёт два фрагмента. Это оценка извлечения, а не нормализации или полного заполнения карточки. Значения confidence пока не калиброваны; порог к предсказаниям не применяется.

## 4. Что прислать для следующего шага

annotations.json, predictions.jsonl, manual_metrics.json. По ним можно разобрать ошибки. Для второго обучения нужны отдельные размеченные карточки из train: подтверждённое отсутствие и все значения. Разметку из этого dev-набора не переносим в train.
'''


if __name__ == '__main__':
    main()
