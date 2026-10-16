"""Portable prediction and exact-span evaluation for manually reviewed cards."""
from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def span_key(span, card):
    field, start, end = span['field'], span['start'], span['end']
    if field not in ('title', 'description') or type(start) is not int or type(end) is not int:
        raise ValueError('Invalid evidence field or offsets')
    text = card[field]
    if not 0 <= start < end <= len(text) or text[start:end] != span['quote']:
        raise ValueError(f"Evidence does not match text for {card['product_id']}")
    return field, start, end


def metrics(tp, fp, fn):
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    return {'tp': tp, 'fp': fp, 'fn': fn, 'support': tp + fn,
            'precision': precision, 'recall': recall,
            'f1': 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None}


def score(cards, annotations, predictions, allow_partial=False):
    if annotations.get('dataset_id') != 'participant3_manual_dev_v1':
        raise ValueError('Wrong annotation dataset')
    by_id = {c['product_id']: c for c in cards}
    if len(by_id) != len(cards):
        raise ValueError('Duplicate cards')
    pred = {}
    for row in predictions:
        pid = row['product_id']
        if pid not in by_id or pid in pred:
            raise ValueError('Unknown/duplicate prediction card')
        if row.get('status') != 'ok' or row.get('error') or row.get('warnings'):
            raise ValueError(f'Incomplete/failed inference: {pid}')
        if set(row.get('requested_attributes', [])) != set(by_id[pid]['requested_attributes']):
            raise ValueError(f'Prediction attributes do not match: {pid}')
        pred[pid] = row
    if set(pred) != set(by_id):
        raise ValueError('Predictions must cover every card')
    expected = {f"{c['product_id']}:{a}" for c in cards for a in c['requested_attributes']}
    tasks = annotations.get('tasks', {})
    if set(tasks) != expected:
        raise ValueError('Annotation tasks do not match cards')
    counts = collections.defaultdict(collections.Counter)
    states = collections.Counter()
    errors = []
    for task_id, task in tasks.items():
        pid, attr = task_id.split(':', 1)
        card = by_id[pid]
        state = task.get('status', 'unreviewed')
        if state not in ('unreviewed', 'ambiguous', 'present', 'absent'):
            raise ValueError('Invalid review status')
        states[state] += 1
        if state in ('unreviewed', 'ambiguous'):
            continue
        spans = task.get('spans', [])
        if (state == 'present' and not spans) or (state == 'absent' and spans):
            raise ValueError(f'Invalid presence/absence annotation: {task_id}')
        gold = {span_key(s, card) for s in spans}
        found = set()
        for candidate in pred[pid].get('candidates', []):
            if candidate['attribute_id'] == attr:
                if not candidate.get('evidence'):
                    raise ValueError('Prediction missing evidence')
                found.update(span_key(s, card) for s in candidate['evidence'])
        bucket = counts[attr]
        bucket.update(tp=len(gold & found), fp=len(found - gold), fn=len(gold - found),
                      tasks=1, exact_tasks=int(gold == found),
                      absent_tasks=int(state == 'absent'),
                      false_positive_absent_tasks=int(state == 'absent' and bool(found)))
        if gold != found:
            errors.append({'task_id': task_id, 'status': state,
                           'gold': sorted(gold), 'predicted': sorted(found)})
    if states['unreviewed'] and not allow_partial:
        raise ValueError(f"Still unreviewed: {states['unreviewed']}; finish review or use --allow-partial")
    total = sum(counts.values(), collections.Counter())
    result = metrics(total['tp'], total['fp'], total['fn'])
    result.update({k: total[k] for k in ('tasks', 'exact_tasks', 'absent_tasks', 'false_positive_absent_tasks')})
    result.update(task_accuracy=total['exact_tasks'] / total['tasks'] if total['tasks'] else None,
                  review_states=dict(states), incomplete=bool(states['unreviewed']),
                  evaluation_kind='human_reviewed_dev_exact_spans_before_threshold',
                  independent_test=False, test_used=False, normalization_evaluated=False,
                  per_attribute={a: {**metrics(v['tp'], v['fp'], v['fn']), **{k:v[k] for k in
                                 ('tasks', 'exact_tasks', 'absent_tasks', 'false_positive_absent_tasks')}}
                                 for a, v in counts.items()}, errors=errors)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    predict = sub.add_parser('predict')
    predict.add_argument('--checkpoint', default='models/transformer/checkpoint')
    predict.add_argument('--cards', default='manual_review/cards.jsonl')
    predict.add_argument('--output', default='manual_review/predictions.jsonl')
    evaluate = sub.add_parser('score')
    evaluate.add_argument('--cards', default='manual_review/cards.jsonl')
    evaluate.add_argument('--annotations', default='manual_review/annotations.json')
    evaluate.add_argument('--predictions', default='manual_review/predictions.jsonl')
    evaluate.add_argument('--output', default='manual_review/manual_metrics.json')
    evaluate.add_argument('--allow-partial', action='store_true')
    args = parser.parse_args()
    if args.command == 'predict':
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent / 'src'))
        from catalog_ai.extractors.transformer import TransformerExtractor
        extractor = TransformerExtractor(args.checkpoint, max_length=192, stride=48, batch_size=12)
        rows = []
        for card in read_jsonl(args.cards):
            result = extractor.extract(card, requested_attributes=card['requested_attributes'])
            if result['status'] != 'ok' or result.get('warnings'):
                raise RuntimeError(f"Inference incomplete: {card['product_id']}: {result}")
            rows.append({'product_id': card['product_id'], 'requested_attributes': card['requested_attributes'],
                         'confidence_kind': 'uncalibrated', **result})
            print(f"{len(rows)}: {card['product_id']}")
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    else:
        result = score(read_jsonl(args.cards), json.loads(Path(args.annotations).read_text(encoding='utf-8')),
                       read_jsonl(args.predictions), args.allow_partial)
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: v for k, v in result.items() if k not in ('errors', 'per_attribute')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
