from pathlib import Path
import collections
import gzip
import hashlib
import json
import math

from catalog_ai.participant3.full_corpus import digest
from catalog_ai.participant3.prepare import dump_json,key_normalized
from catalog_ai.participant3.demo_package import build

base=Path.cwd()
data=base/'data/participant3_demo'
summary=json.loads((data/'dataset_complete.json').read_text())
assert 'descriptions >=80' in summary['split_policy']
registry=json.loads((data/'attribute_registry.json').read_text())
cats=json.loads((data/'categories.json').read_text())
members={}
group_splits={}
with gzip.open(data/'product_splits.jsonl.gz','rt',encoding='utf-8') as f:
    for line in f:
        row=json.loads(line)
        sku=row['product_id']
        assert sku not in members
        members[sku]=row
        group=row['group_id']
        assert group_splits.setdefault(group,row['split'])==row['split']
assert len(members)==summary['products']
counts=collections.Counter()
attribute_counts=collections.defaultdict(collections.Counter)
fingerprints=set()
text_splits={}
spans=0
for split in ['train','dev','test']:
    with gzip.open(data/f'{split}.jsonl.gz','rt',encoding='utf-8') as f:
        for line in f:
            row=json.loads(line)
            assert row['split']==split
            assert members[row['product_id']]['group_id']==row['group_id']
            assert members[row['product_id']]['split']==split
            attr=row['attribute_id']
            assert attr in registry['attribute_queries']
            assert row['attribute_name']==registry['attribute_queries'][attr]
            assert row['supervision']=='silver_catalog_alignment'
            assert row['spans']
            for span in row['spans']:
                assert 0<=span['start']<span['end']<=len(row['text'])
                assert row['text'][span['start']:span['end']]==span['quote']
                assert span['label']==attr
                spans+=1
            key=hashlib.sha256(json.dumps([attr,row['text'],[(s['start'],s['end']) for s in row['spans']]],ensure_ascii=False).encode()).hexdigest()
            assert key not in fingerprints
            fingerprints.add(key)
            if row['field']=='title' or len(row['text'].strip())>=80:
                text_key=(row['field'],hashlib.sha256(key_normalized(row['text']).encode()).hexdigest())
                assert text_splits.setdefault(text_key,split)==split
            counts[split]+=1
            attribute_counts[attr][split]+=1
assert dict(counts)==summary['positive_examples_by_split']
assert all(n>0 for n in counts.values())
for attr in registry['attribute_queries']:
    assert dict(attribute_counts[attr])==registry['attributes'][attr]['positive_examples']
    assert attribute_counts[attr]['train']>=20
for name,expected in summary['sha256'].items():
    assert digest(data/name)==expected
catalog=json.loads((data/'catalog_complete.json').read_text())
descriptions=json.loads((data/'descriptions_complete.json').read_text())
assert digest(base/'cu_ws/skus.pkl')==catalog['source_sha256']
assert digest(base/'cu_ws/sku_desc.parquet')==descriptions['source_sha256']
demo=[json.loads(line) for line in (data/'demo_cards.jsonl').read_text().splitlines()]
assert all(members[row['product_id']]['split']=='dev' for row in demo)
smoke=json.loads((base/'models/demo_training_smoke/training_summary.json').read_text())
reload=json.loads((base/'models/demo_training_smoke/reload_verification.json').read_text())
assert smoke['optimizer_steps']==2 and smoke['encoder_max_abs_change']>0 and reload['finite']
verification={
    'status':'PASS','unit_tests_passed':29,'prepared_products':len(members),
    'positive_examples':dict(counts),'exact_evidence_spans_checked':spans,
    'cross_split_group_overlap':0,'duplicate_conditioned_examples':0,
    'cross_split_normalized_titles_or_descriptions_ge80':0,
    'prepared_file_hashes_verified':True,'original_catalog_and_description_hashes_unchanged':True,
    'demo_cards_are_dev_only':True,'cpu_end_to_end_optimizer_steps':2,
    'cpu_encoder_max_abs_change':smoke['encoder_max_abs_change'],
    'saved_checkpoint_reload_finite':True,'amd_gpu_tested_here':False,
    'gpu_check_required_on_target':'check_gpu.py (real FP16 backward)',
    'not_a_quality_benchmark':'CPU smoke only verifies mechanics; actual GPU quality is not measured yet.'}
dump_json(base/'reports/participant3/demo_verification.json',verification)
roots={cid:c for cid,c in cats.items() if not c.get('@parentId')}
sections_with_products=sum(summary['products_by_section'].get(cid,0)>0 for cid in roots)
sections_with_examples=sum(summary['positive_examples_by_section'].get(cid,0)>0 for cid in roots)
names=[(sum(c.values()),a,registry['attributes'][a]['name']) for a,c in attribute_counts.items()]
names.sort(reverse=True)
lines=['# Подготовленные данные для короткого GPU-обучения','',
       f'Источник: первые **{summary["products"]:,}** уникальных SKU каталога. Выборка ограничена началом файла и не считается репрезентативной по всему набору.'.replace(',',' '),'',
       f'Положительных attribute-conditioned примеров: **{sum(counts.values()):,}**.'.replace(',',' '),
       f'Train / dev / test: **{counts["train"]} / {counts["dev"]} / {counts["test"]}**.',
       f'Характеристик с не менее чем 20 train-примерами: **{len(attribute_counts)}**.',
       f'Разделов с товарами: **{sections_with_products}/96**; с готовыми положительными примерами: **{sections_with_examples}/96**.',
       f'Категорий с товарами в исходном срезе: **{len(catalog["categories"])}**.',
       f'Карточек со связанной строкой title/description: **{descriptions["matched_skus"]}**.', '',
       'Данные охватывают разные товары, не только электронику. Наличие категории в дереве не гарантирует достаточную разметку. Для быстрого запуска конфиг выбирает до 128 характеристик и до 30000 train-пар, балансируя характеристики и разделы. Остальные подготовленные данные сохранены для следующих запусков.', '',
       '## Что проверено','',
       f'- Проверены все {spans} фрагмента: значение совпадает с исходным срезом текста.',
       '- Группы моделей/вариантов, одинаковые нормализованные названия и описания от 80 символов не пересекают split.',
       '- Одинаковые пары текст/характеристика/позиции удалены; группы SKU согласованы с каждым примером.',
       '- Все hash подготовленных файлов совпадают; hash исходных skus.pkl и sku_desc.parquet не изменились.',
       '- 29 тестов прошли. Полный CPU smoke выполнил два шага encoder fine-tuning, сохранил и загрузил checkpoint. Это проверка кода, не качества.',
       '- RX 9070 XT на этой машине отсутствует. На целевом Windows 11 установка выполняет отдельный FP16 backward probe.', '',
       '## Частые поддержанные характеристики','',
       '| ID | Название для вопроса модели | Положительных примеров во всех частях |',
       '|---|---|---|']
for total,attr,name in names[:30]:
    lines.append(f'| `{attr}` | {name.replace("|","/")} | {total} |')
lines += ['', '## Покрытие всех разделов','',
          '| Раздел — ID | Товаров в срезе | Готовых положительных пар |',
          '|---|---|---|']
for cid,category in sorted(roots.items(),key=lambda x:x[1]['#text'].casefold()):
    lines.append(f'| {category["#text"]} — `{cid}` | {summary["products_by_section"].get(cid,0)} | {summary["positive_examples_by_section"].get(cid,0)} |')
lines += ['', '## Ограничения','',
          'Разметка автоматически получена из параметров каталога. Противоречия и неточности возможны; ручного gold и проверенных отрицательных пар нет. Значение отбрасывается при неподтверждённом совпадении, отсутствии нужной единицы, конфликтующих конкретных числовых target-значениях или недостаточном train-support. Приближённая группировка вариантов требует дальнейшей проверки.', '',
          'Названия новых полей сохраняются со стабильными проектными ID; требуется дальнейшее согласование смысловых синонимов и вложенных/множественных значений с участниками 1 и 2. Текущие dev-метрики будут silver exact span-F1 по положительным парам, а не итоговым качеством заполнения каталога.', '',
          'Лучший и последний GPU checkpoint появятся только после запуска на целевом ПК. Архив содержит данные и код, а не уже обученные на RX 9070 XT веса. Предыдущие tiny/base CPU модели в архив не включены.']
(base/'reports/participant3/demo_dataset_report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(verification,ensure_ascii=False),flush=True)
build(base)
