from pathlib import Path
import json, shutil
root=Path('/home/alex/desktop/haha');reports=root/'reports'
def load(run,f):return json.loads((root/'models'/run/f).read_text())
run='participant3_rubert_pilot'
s=load(run,'training_summary.json');m=load(run,'best_metrics.json');d=load(run,'data_manifest.json');h=load(run,'training_history.json')
p=reports/'transformer_experiment.md';text=p.read_text()
text=text.replace('Основной ruBERT-base оставлен в `configs/transformer.yaml` для GPU-машины.', 'Полный ruBERT-base оставлен в `configs/transformer.yaml` для GPU-машины; ниже добавлен реально выполненный CPU-пилот с частичной разморозкой этого же checkpoint.')
text=text.replace('3. Запустить основной ruBERT-base на GPU;', '3. После выполненного частичного CPU-пилота запустить ruBERT-base с полным дообучением на GPU;')
rows='\n'.join(f"| {a} | {v['support']} | {v['precision'] if v['precision'] is not None else 'нет данных'} | {v['recall'] if v['recall'] is not None else 'нет данных'} | {v['f1'] if v['f1'] is not None else 'нет данных'} |" for a,v in m['per_attribute'].items())
text+=f'''
## Дополнительно: реально дообученный ai-forever/ruBert-base

Выполнены два запуска выбранной основной модели: короткий smoke (`models/participant3_rubert_cpu`) и увеличенный пилот (`models/participant3_rubert_pilot`). Во втором разморожены **два последних encoder-слоя и head**, {s['trainable_parameters']:,} из {s['total_parameters']:,} параметров. Это настоящее частичное дообучение энкодера, а не обучение одной головы. Проверяемый параметр `{s['encoder_parameter']}` изменился на {s['encoder_max_abs_change']:.8f}. Исходные веса .bin загружены restricted weights_only=True; checkpoint сохранён в safetensors.

Увеличенный CPU-пилот: **{d['train_windows']} train / {d['dev_windows']} dev окон**, {s['optimizer_steps']} optimizer steps, 4 эпохи, batch=2, lr=2e-4, длина 96, {s['elapsed_seconds']:.1f} секунды. Обучение выполнялось с HF_HUB_OFFLINE=1 после скачивания исходного checkpoint. Сохранение/повторная загрузка проверены, logits конечны и повторяются.

Итог exact span-F1 на своей silver dev-подвыборке: **{m['f1']:.4f}**, precision **{m['precision']:.4f}**, recall **{m['recall']:.4f}**, support **{m['support']}**. Короткий первый smoke давал F1=0 и служил только проверкой механики. Нельзя скрывать этот результат или подменять метрики ruBERT-base показателями tiny2.

| Атрибут | Support spans | Precision | Recall | Exact span-F1 |
|---|---:|---:|---:|---:|
{rows}

Бренд и модель на этом малом CPU-обучении распознаются слабо. Это **не готовый production-extractor**. Сравнивать 0.333 у base с 0.596 у tiny2 как рейтинг архитектур нельзя: различаются размер training subset, dev subset, режим разморозки и токенизация. На GPU нужен один проверенный набор и одинаковый протокол. По одному примеру cpu или двум battery нельзя заявлять успешность атрибута.

В `reports/participant3/rubert_pilot/` сохранены manifest/config/history/metrics/summary/reload verification. Отдельный CLI-инференс checkpoint проверяется на dev-карточках в `outputs/participant3/rubert_demo_candidates.jsonl`. Очередь ручной проверки пересобрана с исключением групп **всех трёх** запусков и включает случаи без silver span.

Техническая заметка: Transformers 4.57.6 выдал общий warning про Mistral regex при загрузке ruBERT. Проверено, что фактический backend здесь WordPiece + BertPreTokenizer, tokenizer исходной и сохранённой моделей совпадает, а offsets на русской строке возвращают исходные подстроки. Mistral-specific regex-правка к BERT не применялась.
'''
p.write_text(text)
for source_run,target in [('participant3_rubert_cpu','rubert_smoke'),('participant3_rubert_pilot','rubert_pilot')]:
 dst=reports/'participant3'/target;dst.mkdir(exist_ok=True)
 for f in ['run_config.json','training_summary.json','best_metrics.json','metrics_before.json','data_manifest.json','training_history.json','reload_verification.json']:
  shutil.copyfile(root/'models'/source_run/f,dst/f)
p=reports/'participant3/handoff.md';text=p.read_text().replace('GPU-конфиг ruBERT-base, standalone extractor', 'частичное CPU-дообучение ruBERT-base и полный GPU-конфиг, standalone extractor')
text+='''
Дополнительно: модели ai-forever/ruBert-base действительно дообучены на CPU с разморозкой последних двух encoder-слоёв; основной из этих пилотных checkpoint — models/participant3_rubert_pilot/checkpoint. Его silver span-F1=0.3333, precision=0.28, support=51. Это не заменяет полный GPU-прогон и не сравнимо напрямую с tiny2 из-за разных подвыборок. Все исходные .bin веса загружались weights_only=True, результаты сохранены в safetensors. Очередь ручной проверки исключает группы всех выполненных запусков.
'''
p.write_text(text)
p=reports/'participant3/slides_content.md';text=p.read_text().replace('Основной ruBERT-base требует отдельного GPU-прогона.', 'Дополнительно выполнен частичный CPU-пилот ruBERT-base: два последних слоя + head; полное обучение остаётся для GPU.')
text+='''
## Дополнение для основного ruBERT-base

Частично дообучен: 107 train / 51 dev окон, 216 optimizer steps, 280 секунд CPU, 14,18M обучаемых из 177,72M параметров. Silver exact span-F1 0.333, precision 0.28; слабые brand/model и недостаточная разметка. Другая подвыборка и замороженные слои не позволяют объявить tiny2 лучше base по сравнению этих двух цифр. Полный GPU-прогон и human gold ещё нужны.
'''
p.write_text(text)
p=reports/'confidence.md';text=p.read_text()+'''
Реализован choose_threshold: максимально возможная observed coverage при достаточном support и нижней Wilson-границе precision. Данные только human/tuning; тест, silver и calibration-fit observations для выбора порога запрещены. При недостаточных данных threshold=null. Политика сейчас не разрешает auto_accept. Queues пересобраны с исключением групп всех трёх пилотов; 60 задач включают неизвестные/потенциально отсутствующие значения и ждут проверки.
''';p.write_text(text)
print('Final base-model report updated.')
