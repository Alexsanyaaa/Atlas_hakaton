# Участник № 3: извлечение характеристик трансформером

Актуальный комплект короткого GPU-запуска: [README_RX9070XT.md](README_RX9070XT.md). Подготовлены 39 999 товаров и 195 912 положительных примеров из 87 разделов, общий словарь включает 394 поддержанные данными характеристики; быстрый режим выбирает до 128. Целевая среда — Windows 11 с WSL2 Ubuntu 24.04 и RX 9070 XT, а не нативный Windows ROCm. Ниже сохранена документация первоначальных CPU-пилотов; их данные и метрики относятся к прежнему срезу из 5000 товаров.

Код использует локальные файлы `cu_ws/`, не отправляет карточки во внешние API. Область участника № 3: token classification, общий resolver, confidence и воспроизводимые артефакты обучения. Конвертер организаторского формата в `catalog_ai.participant3` — временный локальный адаптер до общего split/разметки участников № 1/2.

## Что находится в комплекте данных

- `skus.pkl`: YML-подобный каталог с `vendor`, `model`, `name`, категориями и `param`.
- `sku_desc.parquet`: 1 177 200 строк `sku_id/title/description`.
- `query_clicks.parquet`: 30 991 350 поисковых кликов. Они **не являются разметкой извлекаемых атрибутов** и не используются как gold.

Пользователь подтвердил, что других файлов нет. Отдельного списка обязательных атрибутов, span/BIO-разметки и официального train/dev/test не предоставлено. Нельзя называть каталог готовым ручным эталоном.

## Установка

Проверенное локальное окружение: Python 3.12, PyTorch 2.8.0+cpu, Transformers 4.57.6. Требуется Python >=3.11.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -e '.[test]'
```

После локальной установки зафиксированные CPU-зависимости находятся в `requirements-participant3-cpu.lock.txt`; для их повторного получения используйте `--extra-index-url https://download.pytorch.org/whl/cpu`. На GPU **сначала** установите CUDA/ROCm-совместимый PyTorch, затем пакет проекта. CPU-lock не подходит как GPU-окружение. Точный backend и GPU проверяются перед обучением.

## Подготовка пилотных данных

```bash
.venv/bin/python -m catalog_ai.participant3.prepare --source cu_ws --limit 5000 --output data/participant3
```

Читается ограниченный префикс каталога, а описания присоединяются потоковыми parquet-batch. Не выполняется обычный `pickle.load` для 1,5-ГБ файла: простой pickle-интерпретатор разрешает только контейнеры и скаляры, отклоняет GLOBAL/REDUCE и другие исполняемые инструкции. Reader требует конечные лимиты; memo сохраняется для корректных ссылок, поэтому **это не полнофайловый парсер с константной памятью**. Для большой выгрузки нужен подготовленный № 1 потоковый JSONL/Parquet.

Выход: `cards.jsonl`, `spans.jsonl`, `train/dev/test.jsonl`, `manifest.json`, `audit.json`, `categories.json`. Все метки имеют `supervision=silver_catalog_alignment`. Совпадения из `vendor/model/param` ищутся в оригинальном title/description; каталог с целевыми значениями не подаётся модели. Отсутствующие и несовпавшие значения не превращаются автоматически в отрицательную разметку.

Группы строятся по нормализованным vendor/model с удалением известных вариантов памяти/цвета. Это приближение, требующее аудита № 1. Split 70/15/15 детерминирован хешем группы и seed=42. Он **временный**, выборка из префикса смещена, закрытый test адаптер создал только для будущего прогона; в текущем пилоте он не используется.

## Почему модель получает название атрибута

В каталоге нет полной BIO-разметки всех атрибутов. Чтобы не объявлять неизвестные характеристики отсутствующими, используется **attribute-conditioned BIO**: первая последовательность BERT сообщает конкретный атрибут и категорию, вторая содержит исходный текст. Head предсказывает `O/B-VALUE/I-VALUE`; атрибут известен из запроса. Только поля с найденным подтверждением включаются в этот слабый обучающий набор.

Special/query/padding токены имеют label=-100. Позиции текста берутся из fast tokenizer, последовательность 1. Окна без полностью попавшего размеченного span не используются как придуманные отрицательные примеры; частично пересечённые токены игнорируются. На инференсе запрашиваемые атрибуты берутся из схемы, gold-значения модели не передаются.

Это отличается от многоклассового BIO в первоначальном ТЗ; изменение связано с фактической неполнотой разметки. № 2 может использовать те же spans и атрибут как CRF-признак либо подготовить полностью размеченный общий набор для обычного BIO. Сравнение архитектур требует одинаковых train/eval ID, разметки и бюджета данных.

## Обучение

Локальная машина имеет i5-10210U, около 8 ГБ RAM и не имеет доступной CUDA. Для реального CPU-пилота выбран компактный русский encoder `cointegrated/rubert-tiny2`; обновляются и энкодер, и новая классификационная голова. Это **не результат обучения ruBERT-base**.

```bash
HF_HUB_DISABLE_XET=1 TOKENIZERS_PARALLELISM=false .venv/bin/python -u -m catalog_ai.training.transformer --config configs/participant3_cpu.yaml
```

На машине команды с CUDA:

```bash
.venv/bin/python -u -m catalog_ai.training.transformer --config configs/transformer.yaml
```

Для CPU-проверки именно ruBERT-base есть отдельные конфиги `participant3_rubert_cpu.yaml` (минимальный прогон) и `participant3_rubert_pilot.yaml` (увеличенный пилот): разморожены два последних слоя энкодера и head, остальные веса заморожены. Это частичное дообучение, его нельзя приравнивать к полному GPU-обучению. Фактические результаты этих запусков указаны в отчёте отдельно от tiny2.

`configs/transformer.yaml` сохраняет основной `ai-forever/ruBert-base` и его фиксированную ревизию. CPU-конфиг использует длину 96, GPU-конфиг — 256 и окна. Batch/mixed precision подбираются по реальной памяти. Для полного исследования заменить пилотные файлы данными/manifest участников № 1/2 и провести ручную проверку меток.

У проверенной ревизии ruBERT-base опубликован только `pytorch_model.bin`; GPU-конфиг явно использует `weights_only=True` и PyTorch >=2.6. Сохранённая после обучения модель всегда использует safetensors. У tiny2 исходный safetensors есть. Произвольные pickle-объекты каталога этим загрузчиком не читаются.

Скрипт сохраняет лучший checkpoint по dev silver span-F1, tokenizer, данные запуска, SHA256 train/dev, список использованных ID, историю loss/F1, изменение параметра энкодера, время и проверку повторной загрузки. Он не обучает калибровку по silver и не использует test. Метрика — строгий **span-F1 на слабой условной разметке**, не качество заполнения всего каталога на ручном gold.

## Инференс и интеграция

```bash
.venv/bin/python -m catalog_ai.extractors.transformer --checkpoint models/participant3_cpu/checkpoint --input data/participant3/cards.jsonl --output outputs/participant3/candidates.jsonl --limit 10 --attributes brand model color --max-length 96
```

Для GPU checkpoint замените путь на `models/transformer/checkpoint`. `--limit 0` обрабатывает весь вход; прогнозы по 5000 карточкам на CPU не запускать случайно как короткое демо.

```python
from catalog_ai.extractors.transformer import TransformerExtractor
extractor = TransformerExtractor("models/participant3_cpu/checkpoint", device="cpu", max_length=96)
result = extractor.extract(card, schema=None, requested_attributes=["brand", "model", "color"])
```

Возвращается контракт v2 в JSON-совместимых словарях: `candidates/status/usage/latency/error/warnings`. Pydantic-вход поддержан через model_dump. Candidate содержит `attribute_id`, `raw_value`, `source=transformer`, `extractor_id`, `raw_score`, `features`, `evidence`. Все `[start,end)` ссылаются на исходное поле, `raw_score` — минимум вероятностей токенов span, **не калиброванная confidence**. Не используются rules/LLM fallback или справочник для достраивания параметров.

Далее № 2 нормализует и семантически проверяет кандидатов. Только после этого вызывается `catalog_ai.resolution.resolve_and_score(card, schema, validated, method, policy)`. Он принимает плоские validated-кандидаты с `value/unit/normalization_id`. По умолчанию политика оставляет непустые значения на review. Конфликт не разрешается голосованием: value=null, варианты сохраняются. Несовпадающая evidence отклоняется. Механическая проверка подстроки в resolver не заменяет семантический validator № 2.

При наличии общего `contracts.py` № 1 может обернуть словари в свои типы: отдельных конкурирующих классов ProductCard/Gold здесь не введено.

## Калибровка

`fit_calibrator` допускает только human-verified observations со split=calibration, требует оба класса и достаточный support. Порог и качество калибровки измеряются на отдельных данных. Текущий комплект таких меток не содержит, поэтому сохранённого calibrator и заявления о вероятностной надёжности **нет**. Самооценка LLM и raw marginal/softmax разных методов напрямую не сравниваются.

`choose_threshold` использует отдельные human-verified tuning observations и нижнюю границу Wilson precision, сохраняя support/coverage. Если подходящего порога нет, возвращает threshold=null. По двум удачным примерам достигнутые 95% не объявляются. `ConfidencePolicy.from_file` загружает безопасную стартовую политику из `configs/thresholds.yaml`.

Для обновления очереди ручной проверки исключаются группы всех выполненных запусков:

```bash
.venv/bin/python -m catalog_ai.participant3.review_queue --runs models/participant3_cpu models/participant3_rubert_cpu models/participant3_rubert_pilot
```

Очередь включает и случаи без найденного catalog span; это всё ещё непроверенные задачи, а не искусственные отрицательные метки.

## Проверки и дальнейшая передача

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m pip check
```

№ 1 нужны официальный список обязательных атрибутов либо согласованная категория/таксономия, проверенное разбиение и общий evaluator; № 2 — подготовка проверенных spans и semantic grounding. № 3 уже предоставляет обучающий/инференсный модуль, resolver и безопасную политику confidence. Перед передачей прочитайте `reports/transformer_experiment.md` и `reports/confidence.md` с фактическими результатами и ограничениями.

Первичные источники моделей: [ruBERT-base](https://huggingface.co/ai-forever/ruBert-base), [ruBERT-tiny2](https://huggingface.co/cointegrated/rubert-tiny2). Большие исходные данные и веса не включаются в Git; локальные артефакты сохраняются в игнорируемых data/models/outputs.

Исходники и отчёты можно передать одним архивом, который намеренно не содержит веса и датасет:

```bash
.venv/bin/python -m catalog_ai.participant3.package
```

Checkpoint копировать отдельно всей папкой, включая config/tokenizer/task_metadata; он хранится в safetensors. Каталог в текущей среде не инициализирован как Git-репозиторий, поэтому созданного коммита/ветки пока нет.
