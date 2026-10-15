"""Bounded-time GPU demo training; test.jsonl is never opened here."""
from __future__ import annotations

import argparse
import collections
import gc
import gzip
import json
import math
import random
import platform
import time
from pathlib import Path

from catalog_ai.participant3.bio import encode_records, collate, ID2LABEL, LABEL2ID
from catalog_ai.participant3.prepare import dump_json
from catalog_ai.training.transformer import evaluate, file_hash


def open_text(path):
    return gzip.open(path, 'rt', encoding='utf-8') if str(path).endswith('.gz') else Path(path).open(encoding='utf-8')


def optimizer_step_limit(config, train_windows):
    """Bound the progress estimate by the steps actually available in all epochs."""
    batches = math.ceil(train_windows / config['batch_size'])
    per_epoch = math.ceil(batches / config['gradient_accumulation'])
    return min(config['max_steps'], per_epoch * config['epochs'])


def quotas(counts, maximum):
    """Water-fill scarce strata first, with a strict total cap."""
    remaining = min(maximum, sum(counts.values()))
    result = {}
    pending = dict(counts)
    while pending and remaining:
        cap = remaining // len(pending)
        if not cap:
            for key in sorted(pending)[:remaining]:
                result[key] = 1
            break
        small = [k for k, n in pending.items() if n <= cap]
        if small:
            for key in small:
                result[key] = pending.pop(key)
                remaining -= result[key]
        else:
            for key in sorted(pending):
                n = cap + (1 if remaining % len(pending) and key in sorted(pending)[:remaining % len(pending)] else 0)
                result[key] = n
            break
    return result


def balanced_records(path, maximum, fields, seed, allowed_attributes=None):
    counts = collections.Counter()
    with open_text(path) as f:
        for line in f:
            row = json.loads(line)
            if row['field'] in fields and (allowed_attributes is None or row['attribute_id'] in allowed_attributes):
                counts[(row['attribute_id'], row.get('section_id', ''))] += 1
    attr_counts = collections.Counter()
    for (attr, _), n in counts.items():
        attr_counts[attr] += n
    attr_quotas = quotas(attr_counts, maximum)
    targets = {}
    for attr, count in attr_quotas.items():
        targets.update(quotas({k: n for k, n in counts.items() if k[0] == attr}, count))
    rng = random.Random(seed)
    buckets, seen = collections.defaultdict(list), collections.Counter()
    with open_text(path) as f:
        for line in f:
            row = json.loads(line)
            key = (row['attribute_id'], row.get('section_id', ''))
            cap = targets.get(key, 0)
            if row['field'] not in fields or not cap:
                continue
            seen[key] += 1
            bucket = buckets[key]
            if len(bucket) < cap:
                bucket.append(row)
            else:
                index = rng.randrange(seen[key])
                if index < cap:
                    bucket[index] = row
    result = [row for key in sorted(buckets) for row in buckets[key]]
    rng.shuffle(result)
    assert len(result) <= maximum
    return result


def train(config):
    import numpy as np
    import torch
    from transformers import AutoTokenizer, AutoModelForTokenClassification

    for key in ['max_train_examples','max_dev_examples','max_steps','max_seconds','batch_size',
                'gradient_accumulation','eval_steps','save_steps']:
        if config[key] <= 0:
            raise ValueError(f'{key} must be positive')

    started = time.monotonic()
    seed = config['seed']
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    device = torch.device(config.get('device', 'cuda'))
    if platform.system()=='Windows' and torch.version.hip:
        raise RuntimeError('Native Windows ROCm 7.2.1 does not support ML training. Run this bundle inside WSL2 Ubuntu; see README_RX9070XT.md.')
    if device.type == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('GPU недоступна. Для AMD нужны драйвер AMD и PyTorch ROCm, для NVIDIA — PyTorch CUDA; не CPU wheel.')
    torch.set_num_threads(config.get('threads', 4))
    output = Path(config['output'])
    if any((output / name).exists() for name in ['checkpoint','checkpoint-last']) and not config.get('allow_overwrite', False):
        raise FileExistsError('Checkpoint already exists; choose another output directory')
    output.mkdir(parents=True, exist_ok=True)
    if device.type == 'cuda' and not torch.version.hip:
        torch.backends.cuda.matmul.allow_tf32 = True
    if device.type == 'cuda':
        print(json.dumps({'event': 'gpu', 'name': torch.cuda.get_device_name(),
                          'backend': 'ROCm/HIP' if torch.version.hip else 'CUDA',
                          'vram_gb': torch.cuda.get_device_properties(0).total_memory / 2**30}), flush=True)
    for name in ['train', 'dev', 'registry']:
        if not Path(config[name]).is_file():
            raise FileNotFoundError(config[name])
    registry = json.loads(Path(config['registry']).read_text(encoding='utf-8'))
    queries = registry['attribute_queries']
    priority = [a for a in ['brand','model','color','ram_gb','storage_gb','screen_inches','battery_mah','cpu'] if a in queries]
    others = sorted((a for a in queries if a not in priority),
                    key=lambda a:(-registry['attributes'][a]['positive_examples'].get('train',0),a))
    allowed = set((priority+others)[:config.get('max_attributes',len(queries))])
    print(json.dumps({'event': 'loading_balanced_examples', 'train_cap': config['max_train_examples'],
                      'dev_cap': config['max_dev_examples']}), flush=True)
    records = balanced_records(config['train'], config['max_train_examples'], config['fields'], seed, allowed)
    dev_records = balanced_records(config['dev'], config['max_dev_examples'], config['fields'], seed + 1, allowed)
    if {r['group_id'] for r in records} & {r['group_id'] for r in dev_records}:
        raise ValueError('Train/dev group leakage')
    load = {'trust_remote_code': False, 'revision': config.get('revision')}
    tokenizer = AutoTokenizer.from_pretrained(config['model'], use_fast=True, **load)
    features = encode_records(records, tokenizer, config['max_length'], config['stride'])
    dev = encode_records(dev_records, tokenizer, config['max_length'], config['stride'])
    if not features or not dev:
        raise ValueError('No aligned train/dev features')
    # A very long description must not dominate this deliberately short pilot.
    rng = random.Random(seed)
    if len(features) > config.get('max_train_windows', 48000):
        features = rng.sample(features, config.get('max_train_windows', 48000))
    if len(dev) > config.get('max_dev_windows', 2000):
        dev = random.Random(seed+1).sample(dev, config.get('max_dev_windows', 2000))
    train_records_used = {id(f['record']): f['record'] for f in features}.values()
    support = dict(collections.Counter(r['attribute_id'] for r in train_records_used))
    task_queries = {a: queries[a] for a in support}
    model = AutoModelForTokenClassification.from_pretrained(
        config['model'], num_labels=3, id2label=ID2LABEL, label2id=LABEL2ID,
        use_safetensors=config.get('use_safetensors', False), weights_only=True,
        attn_implementation=config.get('attn_implementation','eager'), **load).to(device)
    if config.get('gradient_checkpointing', True):
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    dump_json(output/'run_config.json', config)
    dump_json(output/'data_manifest.json', {
        'train_sha256': file_hash(config['train']), 'dev_sha256': file_hash(config['dev']),
        'registry_sha256': file_hash(config['registry']), 'train_windows': len(features), 'dev_windows': len(dev),
        'train_examples_by_attribute': support, 'test_used': False,
        'annotation_mode': 'attribute_conditioned_BIO', 'supervision': 'silver_catalog_alignment',
        'train_product_ids': sorted({f['record']['product_id'] for f in features}),
        'dev_product_ids': sorted({f['record']['product_id'] for f in dev})})
    name, encoder = next((n, p) for n, p in model.named_parameters() if 'attention.self.query.weight' in n)
    initial = encoder.detach().cpu().clone()
    optimizer = torch.optim.AdamW(model.parameters(), lr=config['learning_rate'], weight_decay=0.01)
    amp = device.type == 'cuda' and config.get('mixed_precision', True)
    dtype = torch.bfloat16 if config.get('precision') == 'bf16' else torch.float16
    scaler = torch.amp.GradScaler('cuda', enabled=amp and dtype == torch.float16)
    max_steps = optimizer_step_limit(config, len(features))
    max_seconds = config['max_seconds']
    accum, batch_size = config['gradient_accumulation'], config['batch_size']
    best, step, bad, last_eval = -1.0, 0, 0, -1
    history = []
    stopped = 'epochs_completed'
    print(json.dumps({'event': 'features_ready', 'train_windows': len(features), 'dev_windows': len(dev),
                      'attributes': len(support), 'preparation_seconds': round(time.monotonic()-started, 1),
                      'step_limit': max_steps, 'time_limit_seconds': max_seconds}), flush=True)

    def save(path):
        model.save_pretrained(path, safe_serialization=True)
        tokenizer.save_pretrained(path)
        dump_json(path/'task_metadata.json', {
            'annotation_mode': 'attribute_conditioned_BIO', 'supervision': 'silver_catalog_alignment',
            'base_model': config['model'], 'base_revision': config.get('revision'),
            'attribute_queries': task_queries, 'train_examples_by_attribute': support,
            'fields': config['fields'], 'max_length': config['max_length'], 'stride': config['stride'],
            'optimizer_steps': step, 'requires_human_review': True, 'calibrated': False})

    def validate():
        nonlocal best, bad, last_eval
        metrics, predictions = evaluate(model, dev, tokenizer, device, config.get('eval_batch_size', batch_size))
        score = metrics['f1'] if metrics['f1'] is not None else -1
        event = {'event': 'evaluation', 'step': step, 'silver_span_f1': score,
                 'precision': metrics['precision'], 'recall': metrics['recall'], 'support': metrics['support']}
        history.append(event)
        print(json.dumps(event), flush=True)
        if score > best:
            best, bad = score, 0
            save(output/'checkpoint')
            dump_json(output/'best_metrics.json', metrics)
            with (output/'dev_predictions.jsonl').open('w', encoding='utf-8') as f:
                for row in predictions:
                    f.write(json.dumps(row, ensure_ascii=False)+'\n')
        else:
            bad += 1
        last_eval = step
        model.train()

    optimizer.zero_grad(set_to_none=True)
    training_started = time.monotonic()
    stop = False
    try:
        for epoch in range(config['epochs']):
            order = list(range(len(features)))
            random.Random(seed+epoch).shuffle(order)
            n_batches = math.ceil(len(order)/batch_size)
            model.train()
            for b in range(n_batches):
                items = [features[i] for i in order[b*batch_size:(b+1)*batch_size]]
                batch = {k:v.to(device) for k,v in collate(items, tokenizer).items()}
                group_size = min(accum, n_batches - (b//accum)*accum)
                with torch.autocast(device_type=device.type, dtype=dtype, enabled=amp):
                    result = model(**batch)
                    loss = result.loss / group_size
                if not torch.isfinite(loss):
                    raise FloatingPointError('Non-finite loss')
                scaler.scale(loss).backward()
                if (b+1)%accum and b != n_batches-1:
                    continue
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                step += 1
                if step % config.get('log_steps',25) == 0:
                    elapsed = time.monotonic()-training_started
                    print(json.dumps({'event':'train','epoch':epoch+1,'step':step,'loss':float(result.loss.detach()),
                                      'elapsed_seconds':round(time.monotonic()-started,1),
                                      'estimated_remaining_seconds':round((max_steps-step)*elapsed/step),
                                      'peak_vram_gb':torch.cuda.max_memory_allocated()/2**30 if device.type=='cuda' else None}),flush=True)
                if step % config['save_steps'] == 0:
                    save(output/'checkpoint-last')
                if step % config['eval_steps'] == 0:
                    validate()
                if step >= max_steps or time.monotonic()-started >= max_seconds or bad >= config['early_stopping_patience']:
                    stopped = ('epochs_completed' if max_steps < config['max_steps'] else 'max_steps') if step>=max_steps else ('time_budget' if time.monotonic()-started>=max_seconds else 'early_stopping')
                    stop = True
                    break
            if stop:
                break
            if last_eval != step:
                validate()
    except KeyboardInterrupt:
        stopped = 'user_interrupt'
        print(json.dumps({'event':'interrupted','step':step,'saving_trained_weights':step>0}),flush=True)
    if not step:
        raise RuntimeError('No optimizer step; no trained checkpoint exists')
    save(output/'checkpoint-last')
    if last_eval != step:
        validate()
    delta = float((encoder.detach().cpu()-initial).abs().max())
    if not delta:
        raise RuntimeError('Encoder did not change')
    dump_json(output/'training_history.json',history)
    dump_json(output/'training_summary.json',{'optimizer_steps':step,'planned_optimizer_steps':max_steps,'stop_reason':stopped,
              'elapsed_seconds':time.monotonic()-started,'encoder_parameter':name,'encoder_max_abs_change':delta,
              'best_dev_silver_span_f1':best,'not_human_gold':True,'test_used':False,
              'model':config['model'],'gpu':torch.cuda.get_device_name() if device.type=='cuda' else None})
    del optimizer, model, result, loss, batch
    gc.collect()
    if device.type=='cuda':
        torch.cuda.empty_cache()
    restored = AutoModelForTokenClassification.from_pretrained(output/'checkpoint', use_safetensors=True).to(device).eval()
    sample = {k:v.to(device) for k,v in collate(dev[:1],tokenizer).items() if k!='labels'}
    with torch.no_grad():
        logits = restored(**sample).logits
    if not torch.isfinite(logits).all():
        raise RuntimeError('Saved checkpoint produced non-finite logits')
    dump_json(output/'reload_verification.json',{'finite':True,'checkpoint':'checkpoint','inference_shape':list(logits.shape)})
    print(json.dumps({'event':'done','checkpoint':str(output/'checkpoint'),'steps':step,'stop_reason':stopped}),flush=True)


def main():
    import yaml
    p=argparse.ArgumentParser()
    p.add_argument('--config',type=Path,default=Path('configs/rx9070xt_demo.yaml'))
    a=p.parse_args()
    train(yaml.safe_load(a.config.read_text(encoding='utf-8')))


if __name__=='__main__':
    main()
