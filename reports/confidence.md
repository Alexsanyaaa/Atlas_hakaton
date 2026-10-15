# Confidence: состояние участника № 3

Реализованы `ConfidencePolicy`, `fit_calibrator` и общий `resolve_and_score`. Методы `rules`, `ner`, `transformer`, `llm_zero`, `llm_few`, `llm_sft` могут иметь разные calibration maps/пороги. Ни raw softmax, ни CRF marginals, ни самооценка LLM не выдаются за проверенную вероятность.

Сейчас calibrator не обучался: в комплекте нет human gold. `configs/thresholds.yaml` задаёт auto_accept=false. Нормализованное непротиворечивое значение возвращается review; конфликт — review/value=null/alternatives; отсутствие кандидата — missing/confidence=null. Невалидная цитата, NaN или отсутствие normalization_id отклоняются. Проверка подстроки не доказывает смысл и не заменяет grounding участника № 2.

`fit_calibrator` требует human-verified calibration observations, достаточное число примеров и оба класса, не допускает silver и test. Структура одной будущей записи: method, attribute_id, raw_score, correct (0/1), verification=human, split=calibration. Калибровка логистическая; полученные coef/intercept/support сохранять в JSON, а качество проверять на других объектах. Пороги выбираются по отдельной tuning/dev части. Версию, датасет и support фиксировать.

Очередь outputs/participant3/review_queue.jsonl содержит 60 НЕПРОВЕРЕННЫХ задач из ранее неиспользованных dev-групп. Рецензент должен проверить все значения целевого атрибута и отдельно отсутствие; предложенный catalog span может быть ошибочным. Эти задачи пока нельзя называть калибровочными наблюдениями или gold. Данные выбора checkpoint не использовать как независимую финальную оценку калибровки.

Для методов с малым support сохранять heuristic и review. В итоговом отчёте нужны reliability bins/support, precision–coverage и размер каждого сегмента. Числа 0.95 в коде — стартовый ориентир конфигурации, не достигнутая precision. Показатель span-F1 на silver dev не доказывает правильность confidence.

Реализован choose_threshold: максимально возможная observed coverage при достаточном support и нижней Wilson-границе precision. Данные только human/tuning; тест, silver и calibration-fit observations для выбора порога запрещены. При недостаточных данных threshold=null. Политика сейчас не разрешает auto_accept. Queues пересобраны с исключением групп всех трёх пилотов; 60 задач включают неизвестные/потенциально отсутствующие значения и ждут проверки.
