from pathlib import Path

root = Path('/home/alex/desktop/haha/output/team')
report = '/home/alex/desktop/haha/output/research/Ресурсы_и_план_обучения.md'
marker='## Общие правила команды: контракт v2'
files=sorted(root.glob('*.md'))
base=files[0].read_text().split(marker,1)[1]
old='LLM zero-shot и few-shot — два режима одной четвёртой ветки. Обязательная таблица содержит минимум пять строк: `rules`, `ner`, `transformer`, `llm_zero`, `llm_few`.'
new='LLM zero-shot, few-shot и SFT/QLoRA — три эксперимента одной четвёртой ветки. По уточнению пользователя LLM требуется также дообучить. Обязательная таблица содержит минимум шесть строк: `rules`, `ner`, `transformer`, `llm_zero`, `llm_few`, `llm_sft`.'
assert old in base
base=base.replace(old,new)
base=base.replace('| № 4 | `llm`: zero-shot и few-shot |','| № 4 | `llm`: zero-shot, few-shot и SFT/QLoRA |')
base=base.replace('variant (для LLM: zero/few)', 'variant (для LLM: zero/few/sft), base_revision и adapter_revision при SFT')
base=base.replace('у LLM выполнены zero-shot/few-shot запросы.', 'у LLM выполнены zero-shot/few-shot запросы и короткий SFT forward/backward.')
base=base.replace('все четыре подхода имеют измерения на dev.', 'все четыре подхода, включая дообученную LLM, имеют измерения на dev.')
base+='''
### Выбранные ресурсы и оборудование

Общий план команды: CPU i5-10600 + 32 ГБ RAM для данных/EDA/rules/CRF; отдельная GPU 8–16 ГБ для ruBERT; наиболее вместительная GPU, предпочтительно 16 ГБ, для Qwen 4B QLoRA. Точная вместимость определяется коротким training run. Несколько GPU на разных компьютерах автоматически не суммируются. Позднее доступно 12-дневное окно облачных вычислений; это не утверждение о точном дедлайне хакатона или квоте GPU-часов.

Выбранные checkpoints: `ai-forever/ruBert-base` для № 3, `Qwen/Qwen3-4B-Instruct-2507` для № 4; резерв для 8 ГБ — `Qwen/Qwen3-1.7B` с отключённым thinking. Веса локальные, выполнение не зависит от регионального доступа к API после скачивания. Доступ конкретных российских сетей нужно проверить самим участникам.

Новый общий материал с первичными источниками, рабочими ссылками датасетов, ревизиями моделей, аппаратными оговорками и конфигами: [Ресурсы и план обучения]('''+report+'''). Для CRF/ruBERT использовать одни проверенные train-span; LLM SFT строится из тех же train-карточек, а test остаётся закрытым. Zero/few запускаются без task-adapter, sft — с сохранённым адаптером и тем же контрольным prompt. Этот блок дополняет контракт данных v2; версия ТЗ — 3.
'''

extras={
1:'''## Исследованные ресурсы для твоего подхода

Твои первичные материалы: [WDC-PAVE](https://webdatacommons.org/structureddata/wdc-pave/), [Wikidata labels/aliases](https://www.wikidata.org/wiki/Help:Data_access), [Pint](https://pint.readthedocs.io/en/stable/). Практический старт — справочник организатора и train-алиасы. В общей подборке даны проверенные рабочие пути WDC; не копируй устаревшую ссылку train, возвращающую 404. MAVE использовать с учётом CC BY-NC 4.0 и условий исходного Amazon text. Организуй шесть benchmark-строк с новой llm_sft, учти отдельный training-data budget и качество до/после адаптера. GPU для твоей ветки не нужна.

''',
2:'''## Исследованные ресурсы для твоего подхода

Основной инструмент: [sklearn-crfsuite tutorial](https://sklearn-crfsuite.readthedocs.io/en/latest/tutorial.html); ручная span-разметка: [Label Studio NER](https://labelstud.io/templates/named_entity.html). Для внешней отладки доступны WDC-PAVE, в том числе преобразованный авторами MAVE-формат с evidence; ссылки в общей подборке. MAVE — англоязычный вспомогательный набор с CC BY-NC 4.0, а NEREL не размечает атрибуты ваших товаров. Старт CRF: lbfgs, c1/c2=0.1, max_iterations=100, затем настройка только по dev. Работай на CPU. Передай те же проверенные train-span № 3 и карточки/доказательства № 4 для SFT.

''',
3:'''## Выбранная модель и исследованные материалы

Основной checkpoint: **`ai-forever/ruBert-base`**, ревизия `05f37a2ca9e333fd18f30cd0c96c68d274793c69`. Это русскоязычный энкодер с 178M параметров, Apache-2.0; максимум позиций по config — 512. [Карточка модели](https://huggingface.co/ai-forever/ruBert-base), [token-classification training](https://huggingface.co/docs/transformers/tasks/token_classification).

Начни на отдельной GPU 8 ГБ с max_length=256, microbatch=4 (при OOM уменьшать), gradient accumulation=4, lr=2e-5, до 3 эпох с выбором по dev. Это стартовые настройки, вместимость и время ещё не измерены. Используй окна для длинных карточек и те же проверенные span, что CRF. Добавь `llm_sft` как самостоятельный method для confidence/thresholds: base+adapter могут требовать новой калибровки. Подробный план и источники — в общей подборке.

''',
4:'''## Выбранная LLM и исследованные материалы

Основной checkpoint для **реального дообучения**: **`Qwen/Qwen3-4B-Instruct-2507`**, ревизия `cdbee75f17c01a7cc42f958dc650907174af0554`, Apache-2.0, локальные открытые веса, non-thinking. [Официальная карточка](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), [PEFT QLoRA](https://huggingface.co/docs/peft/developer_guides/quantization), [TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer). Для GPU 8 ГБ резерв — Qwen3-1.7B; для основной 4B-ветки предпочесть машину с 16 ГБ и короткий контекст.

Новое обязательное требование пользователя: выполнить **SFT через QLoRA**, сохранив zero-shot/few-shot как исходные контрольные прогоны. Раздел 6 общей подборки содержит формат данных, стартовый конфиг, проверки loss mask, адаптера и загрузки. Обучение выбранной LLM ещё не выполнено; твой агент должен реализовать и запустить его на данных команды.

'''}

sft_section='''### 2а. Дообучить выбранную LLM через SFT/QLoRA

Используй train-карточки и проверенные исходные цитаты, полученные № 1/2. Формат prompt-completion: инструкция/схема/текст → JSON кандидатов. Не учи confidence из самооценки LLM. Неполную разметку нельзя превращать в отрицательный пример; спорные targets проверить или исключить из loss.

Для 16 ГБ старт: 4-bit NF4, double quantization, LoRA r=16/alpha=32/dropout=0.05, target_modules=all-linear, max_length=1024, microbatch=1, accumulation=16, lr=1e-4, 2 эпохи, gradient checkpointing, packing=false и completion-only loss. BF16 только при поддержке GPU, иначе FP16. Это проектная конфигурация; сначала 20–50 steps и измерение peak VRAM, доли обрезанных targets и скорости. Если JSON-ответ не помещается, переоформи пример/окна, не обрезай supervised ответ молча. Подробности в общей подборке.

Сохрани адаптер, tokenizer, base revision, конфиг, hash train и training log. Проверь trainable parameters, что loss исключает prompt, checkpoint выбирается только по dev, и что новая загрузка base+adapter работает. Zero/few должны запускаться без этого адаптера, `llm_sft` — с ним. В кэше учитывать adapter revision; одинаковый текст с разными адаптерами — разные ключи.

Сравни `llm_zero`, `llm_few` и `llm_sft` на одинаковом закрытом наборе, а для SFT сначала используй контрольный zero-shot prompt. Дообучение не отменяет проверку JSON, evidence, канона и конфликта источников. Отчитай реальный расход VRAM, обучение и inference отдельно. Основная функция загрузки/инференса должна работать с локальными весами без обязательного API.

'''

for i,p in enumerate(files,1):
 role=p.read_text().split(marker,1)[0]
 role=role.replace('Версия 2.', 'Версия 3.').replace('`llm_zero`, `llm_few`', '`llm_zero`, `llm_few`, `llm_sft`')
 role=role.replace('Гибрид, если готов, — шестая строка.', 'Гибрид, если готов, — дополнительная седьмая строка.')
 role=role.replace('LLM few-shot используют только train', 'LLM few-shot и SFT используют только train')
 role=role.replace('LLM zero-shot/few-shot на одинаковом наборе', 'LLM zero-shot/few-shot и SFT на одинаковом наборе')
 role=role.replace('llm_zero и llm_few без утечки test', 'llm_zero, llm_few и llm_sft без утечки test')
 role=role.replace('Вероятности токенов аггрегируй', 'Вероятности токенов агрегируй')
 if i==4:
  role=role.replace('LLM zero-shot/few-shot, интеграция', 'LLM zero-shot/few-shot и дообучение, интеграция')
  role=role.replace('**LLM в zero-shot и few-shot режимах**', '**LLM в zero-shot, few-shot и SFT/QLoRA режимах**')
  role=role.replace('общая таблица пяти экспериментальных режимов', 'общая таблица шести экспериментальных режимов')
  role=role.replace('### 3. Структурированный ответ и доказательства', sft_section+'### 3. Структурированный ответ и доказательства')
  role=role.replace('вариант zero/few и список/содержание demonstrations', 'вариант zero/few/sft, adapter revision и список/содержание demonstrations')
  role=role.replace('Кэш zero-shot не подходит few-shot.', 'Кэш zero-shot не подходит few-shot или SFT с адаптером.')
  role=role.replace('--output outputs/llm_few.jsonl --mode llm --variant few\n', '--output outputs/llm_few.jsonl --mode llm --variant few\npython -m catalog_ai.cli predict --input data/processed/benchmark.jsonl --output outputs/llm_sft.jsonl --mode llm --variant sft\n')
  role=role.replace('варианта zero/few', 'варианта zero/few/sft').replace('выбор rules/NER/transformer/LLM и zero/few', 'выбор rules/NER/transformer/LLM и zero/few/sft')
  role=role.replace('всех пяти прогонов', 'всех шести прогонов').replace('всех пяти экспериментальных режимов', 'всех шести экспериментальных режимов')
  role=role.replace('LLM-zero/LLM-few;', 'LLM-zero/LLM-few/LLM-SFT;')
  role=role.replace('LLM zero/few,', 'LLM zero/few/SFT,')
  role=role.replace('`src/catalog_ai/extractors/llm.py`, `prompts/`', '`src/catalog_ai/extractors/llm.py`, `src/catalog_ai/training/llm.py`, `models/llm_adapter/`, `prompts/`')
  role=role.replace('LLM zero-shot и few-shot действительно запущены', 'LLM zero-shot, few-shot и SFT действительно запущены')
  role=role.replace('два варианта LLM', 'три варианта LLM')
  role=role.replace('Твоя ветка — LLM zero-shot и few-shot,', 'Твоя ветка — локальная Qwen3-4B-Instruct-2507 с zero-shot, few-shot и обязательным SFT/QLoRA,')
  role=role.replace('llm-zero/llm-few с общей нормализацией', 'llm-zero/llm-few/llm-sft с общей нормализацией')
  role=role.replace('используй train-only few-shot.', 'используй train-only few-shot и SFT. Реализуй обучение по разделу 6 общей подборки и сохрани проверенный адаптер.')
  role=role.replace('- [ ] JSON и evidence проверяются;', '- [ ] SFT обновил LoRA-параметры, адаптер сохранён и независимо загружается; контрольные режимы запускаются без него.\n- [ ] JSON и evidence проверяются;')
 # Insert researched recommendations immediately after title.
 title,rest=role.split('\n',1)
 role=title+'\n\n'+extras[i]+rest.lstrip('\n')
 p.write_text(role+marker+base)
