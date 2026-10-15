from pathlib import Path
import json,shutil,statistics,hashlib,zipfile
root=Path('/home/alex/desktop/haha')
p=root/'models/participant3_cpu'
load=lambda f:json.loads((p/f).read_text())
s=load('training_summary.json');m=load('best_metrics.json');b=load('metrics_before.json');d=load('data_manifest.json');h=load('training_history.json')
a=json.loads((root/'data/participant3/audit.json').read_text())
reports=root/'reports';reports.mkdir(exist_ok=True)
for f in ['training_summary.json','best_metrics.json','metrics_before.json','data_manifest.json','training_history.json','reload_verification.json']:
 shutil.copyfile(p/f,reports/'participant3'/f)
shutil.copyfile(root/'data/participant3/audit.json',reports/'participant3/data_audit.json')
def fmt(x):return 'нет данных' if x is None else f'{x:.4f}'
rows='\n'.join(f"| {attr} | {v['support']} | {fmt(v['precision'])} | {fmt(v['recall'])} | {fmt(v['f1'])} |" for attr,v in m['per_attribute'].items())
epochs='\n'.join(f"| {x['epoch']} | {x['steps']} | {x['train_loss']:.4f} | {x['dev_loss']:.4f} | {x['dev_silver_span_f1']:.4f} |" for x in h)
text=f'''# Участник № 3: фактически выполненный эксперимент

Дата: 14 октября 2026 года. Данные локальные, исходные файлы не изменены, внешним LLM не передавались.

## Результат

Реализован и реально дообучен attribute-conditioned token classifier на **{s['model']}**. Это компактный CPU-резерв, а не основной ai-forever/ruBert-base. Веса энкодера и новой головы обновлялись: {s['trainable_parameters']:,} обучаемых параметров, {s['optimizer_steps']} шагов AdamW, максимальное изменение проверенного параметра attention.query = {s['encoder_max_abs_change']:.8f}. Повторная загрузка сохранённого checkpoint дала те же logits; значения конечны.

Основной ruBERT-base оставлен в `configs/transformer.yaml` для GPU-машины. На текущем компьютере i5-10210U, около 8 ГБ RAM, PyTorch {s['torch_version']} и CUDA не доступна. Именно поэтому здесь выполнен небольшой CPU-пилот. Локальный запуск занял {s['elapsed_seconds']:.1f} секунды с учётом загрузки модели и проверок. Peak VRAM не измеряется, поскольку GPU не использовалась.

## Что выяснено о данных

В комплекте только три файла: YML-подобный каталог в pickle, {a['files']['sku_desc.parquet']['rows']:,} описаний и {a['files']['query_clicks.parquet']['rows']:,} кликов. Каталог содержит {a['categories_in_catalog']:,} категорий в метаданных. Пользователь подтвердил, что отдельной официальной схемы/обязательных полей/ручной span-разметки/split нет.

Для безопасного старта обработан префикс **{a['selected_offers']} товаров**, описания присоединились у {a['joined_descriptions']}. Это смещённая выборка, не случайная выборка всего каталога. Для полного исследования необходимо получить репрезентативную потоковую выгрузку № 1, включая достаточный support смартфонов/ноутбуков и редких атрибутов.

Полный пилотный адаптер создал {sum(a['examples_by_attribute'].values()):,} положительных слабых пар «поле–атрибут». Вендор/модель/param используются для поиска соответствующей цитаты, а не как вход модели. Клики исключены из задачи извлечения. Не найденное в тексте значение не превращается в выдуманный span или подтверждённое отсутствие.

Ни один результат ниже не является оценкой на ручном gold. String alignment создаёт смещение в пользу буквально упомянутых значений и не оценивает все истинные отрицательные случаи.

## Модель и разметка

BERT получает пару «название нужного атрибута и категория» + «исходное поле». Head предсказывает O/B-VALUE/I-VALUE. Так неизвестные остальные атрибуты не объявляются отсутствующими, а существующие неполные catalog labels не превращаются в полную BIO-разметку. Query/special/padding токены исключены из loss. Исходные offsets проверяются; длинные тексты поддерживаются окнами.

Локальный training subset: {d['train_windows']} окон, dev: {d['dev_windows']} окон; длина 96, batch 8, 4 эпохи, lr=2e-4, seed=42. В пилоте обучались только title. На title+description предусмотрен GPU-конфиг с длиной 256. Для CRF-сравнения № 2 необходимо использовать тот же проверенный набор/условный атрибут либо перейти на общую полностью размеченную BIO-выборку.

## Измерения на silver dev

До обучения новая случайная head дала exact span-F1 **{b['f1']:.4f}**, после обучения **{m['f1']:.4f}**. Это сравнение до/после одной модели, не сравнение с rules или CRF. Checkpoint выбран по той же dev-метрике, поэтому она не является независимой финальной оценкой.

| Атрибут | Support spans | Precision | Recall | Exact span-F1 |
|---|---:|---:|---:|---:|
{rows}
| Micro | {m['support']} | {fmt(m['precision'])} | {fmt(m['recall'])} | {fmt(m['f1'])} |

Для RAM, storage и screen в этой небольшой dev-подвыборке нет достаточного support. Нельзя объявлять по ней решение готовым для смартфонов/ноутбуков. Доля карточек, заполненных корректно, per-attribute canonical F1 и качество на новых категориях ещё не измерены.

| Эпоха | Optimizer steps | Train loss | Dev loss | Dev silver span-F1 |
|---|---:|---:|---:|---:|
{epochs}

Закрытый test не использовался. Детерминированный split задан хешем группы vendor/model после удаления известных вариантов цвета/памяти. Группировка приближённая; подробный manifest и используемые ID/SHA256 сохранены. В train/dev проверяется отсутствие пересечения групп.

## Инференс и ошибки

Отдельный CLI загрузил сохранённый checkpoint и обработал пять dev-карточек с запросами brand/model/color; для демонстрации description намеренно пуст, поскольку CPU-модель училась только на title. Выход: `outputs/participant3/demo_candidates.jsonl`. Все цитаты соответствуют исходному тексту. Но совпадение цитаты не гарантирует правильный атрибут: в демонстрации встречаются ошибочный brand=MacBook и фрагменты длинной модели. Поэтому механическая проверка evidence дополняется semantic validator № 2, а auto_accept по умолчанию выключен.

Нормализация и знания о модели не подмешиваются в извлекатель. Иначе были бы скрыты ошибки standalone transformer. Сбой модели имеет status=error и не маскируется пустым успешным результатом.

## Confidence и готовность к интеграции

Возвращается raw_score (минимум token softmax), помеченный как эвристический. Resolver работает для всех методов, требует нормализацию и проверенную evidence, сохраняет конфликты и возвращает review до появления проверенной политики. Нет ручных calibration labels — нет обученного calibrator и заявления о вероятностной точности. Подробнее `reports/confidence.md`.

Создана очередь **56 задач** для ручной проверки на новых группах, не использовавшихся в обучении или выборе checkpoint: `outputs/participant3/review_queue.jsonl`. Это не готовая калибровочная выборка: нужно проверить spans/отсутствия, получить корректность кандидатов и отдельно выделить данные выбора порога/оценки. Тест не затрагивался.

Команды и интерфейсы — в `README_PARTICIPANT_3.md`. Исходный каталог читается ограниченным pickle-интерпретатором без GLOBAL/REDUCE, но memo растёт: текущий адаптер предназначен для пилотного префикса, не для загрузки всего 1,5-ГБ каталога на слабом ноутбуке.

## Что требуется для завершения основной оценки

1. Согласовать с № 1 обязательную таксономию и репрезентативный split; текущие ID атрибутов — проектные, не официально полученный список.
2. № 2 проверяет исходные spans, отрицания/совместимость, конфликты и недостающие аннотации.
3. Запустить основной ruBERT-base на GPU; официальный checkpoint имеет только pytorch_model.bin, конфиг использует restricted weights_only=True с PyTorch >=2.6. Выход после обучения — safetensors.
4. Сравнить с rules/CRF/LLM на одних gold ID, отдельно качество до порога и selective precision/coverage.
5. По достаточной независимой ручной разметке калибровать confidence и выбирать пороги. Только затем разрешать auto_accept.
'''
(reports/'transformer_experiment.md').write_text(text)
(reports/'confidence.md').write_text('''# Confidence: состояние участника № 3

Реализованы `ConfidencePolicy`, `fit_calibrator` и общий `resolve_and_score`. Методы `rules`, `ner`, `transformer`, `llm_zero`, `llm_few`, `llm_sft` могут иметь разные calibration maps/пороги. Ни raw softmax, ни CRF marginals, ни самооценка LLM не выдаются за проверенную вероятность.

Сейчас calibrator не обучался: в комплекте нет human gold. `configs/thresholds.yaml` задаёт auto_accept=false. Нормализованное непротиворечивое значение возвращается review; конфликт — review/value=null/alternatives; отсутствие кандидата — missing/confidence=null. Невалидная цитата, NaN или отсутствие normalization_id отклоняются. Проверка подстроки не доказывает смысл и не заменяет grounding участника № 2.

`fit_calibrator` требует human-verified calibration observations, достаточное число примеров и оба класса, не допускает silver и test. Структура одной будущей записи: method, attribute_id, raw_score, correct (0/1), verification=human, split=calibration. Калибровка логистическая; полученные coef/intercept/support сохранять в JSON, а качество проверять на других объектах. Пороги выбираются по отдельной tuning/dev части. Версию, датасет и support фиксировать.

Очередь outputs/participant3/review_queue.jsonl содержит 56 НЕПРОВЕРЕННЫХ задач из ранее неиспользованных dev-групп. Рецензент должен проверить все значения целевого атрибута и отдельно отсутствие; предложенный catalog span может быть ошибочным. Эти задачи пока нельзя называть калибровочными наблюдениями или gold. Данные выбора checkpoint не использовать как независимую финальную оценку калибровки.

Для методов с малым support сохранять heuristic и review. В итоговом отчёте нужны reliability bins/support, precision–coverage и размер каждого сегмента. Числа 0.95 в коде — стартовый ориентир конфигурации, не достигнутая precision. Показатель span-F1 на silver dev не доказывает правильность confidence.
''')
(reports/'participant3/handoff.md').write_text('''# Передача участника № 3

Готово: фактический аудит данных, ограниченный безопасный адаптер, условная BIO-подготовка без подачи catalog targets модели, настоящее CPU-дообучение ruBERT-tiny2, сохранённый проверенный checkpoint, GPU-конфиг ruBERT-base, standalone extractor, общий resolver и политика confidence. Читайте README_PARTICIPANT_3.md и reports/transformer_experiment.md.

№ 1: data/participant3/manifest.json — только временный prefix split. Нужен общий официальный/согласованный список обязательных атрибутов, репрезентативная выгрузка и evaluator canonical values. Query clicks — не extraction gold. Не включать большие приватные файлы в Git/архив исходников.

№ 2: data/participant3/spans.jsonl — слабые совпадения, не ручной gold. Источник/поле/позиции сохранены, unknown не превращён в отсутствие. Для общего CRF-сравнения согласовать attribute-conditioned постановку либо дать полную BIO-разметку. Normalize/semantic grounding остаются в вашей области. Перед resolver кандидат должен иметь value, unit, normalization_id и проверенную evidence. Review queue: outputs/participant3/review_queue.jsonl.

№ 4: подключить TransformerExtractor.extract(card, schema, requested_attributes); выход — словари контракта v2. При необходимости конвертируйте в ваши общие Pydantic-типы. Артефакт CPU models/participant3_cpu/checkpoint; для основной GPU-модели — configs/transformer.yaml. Модель не использует rules/LLM fallback. Не маркировать review как автоматически заполненное значение. Checkpoint и tokenizer нужно переносить целиком вместе с task_metadata.json. Сохранённый CPU checkpoint не является обученным ruBERT-base.

Git-репозитория в текущей папке нет, поэтому ветка/коммит не создавались. Создан общий Python-каркас; при интеграции сохраните зависимости других участников. source-only архив содержит код/конфиги/отчёты, но не исходные данные и веса.
''')
(reports/'participant3/slides_content.md').write_text(f'''# Материал участника № 3 для защиты

## Слайд: метод и фактический запуск

Русский BERT-энкодер + token-classification head, условие на конкретный атрибут. Каталожные значения применяются только при подготовке слабой span-разметки, не подаются модели. Реальный CPU-пилот: ruBERT-tiny2, {d['train_windows']} train / {d['dev_windows']} dev окон, {s['optimizer_steps']} optimizer steps, {s['elapsed_seconds']:.1f} сек. Проверено изменение параметров энкодера и загрузка checkpoint. Основной ruBERT-base требует отдельного GPU-прогона.

## Слайд: результат и границы вывода

Exact span-F1 на выбранном silver dev: {b['f1']:.3f} → {m['f1']:.3f}; precision {m['precision']:.3f}, recall {m['recall']:.3f}, support {m['support']}. Это НЕ gold-качество каталога и НЕ сравнение с CRF/rules. Недостаточно RAM/storage/screen примеров; только положительные условные пары. Есть ложные бренды и неполные модели. Автопринятие выключено, требуются semantic grounding и ручной gold. Тест не использовался.
''')
print('Reports generated. Model checkpoint:',p/'checkpoint')
