"""Reproduce saved silver predictions and fit EXPLORATORY review thresholds.

No automatic acceptance is authorized by this module. A group-disjoint dev
partition is a diagnostic check, not an independent test: dev selected weights.
"""
from __future__ import annotations
import argparse, collections, hashlib, json, math
from pathlib import Path
from catalog_ai.participant3.refinement import read_rows, repair_record
from catalog_ai.participant3.bio import encode_records
from catalog_ai.training.demo import balanced_records


def counts(pred,gold):
    tp=len(pred&gold);fp=len(pred-gold);fn=len(gold-pred)
    return {'tp':tp,'fp':fp,'fn':fn,'support':len(gold),
            'precision':tp/len(pred) if pred else None,'recall':tp/len(gold) if gold else None,
            'f1':2*tp/(len(pred)+len(gold)) if pred or gold else None}


def wilson(tp,n):
    if not n:return 0.0
    z=1.96;p=tp/n
    return (p+z*z/(2*n)-z*math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n)


def select_threshold(scored,gold,target=None,minimum=200):
    # A sorted sweep handles tied scores together; avoids quadratic scans.
    grouped=collections.defaultdict(list)
    for key,score in scored.items():grouped[score].append(key in gold)
    n=tp=0;best=None
    for score,ys in sorted(grouped.items(),reverse=True):
        n+=len(ys);tp+=sum(ys)
        f1=2*tp/(n+len(gold)) if n+len(gold) else 0
        row={'threshold':score,'selected':n,'precision':tp/n,'recall':tp/len(gold) if gold else None,
             'f1':f1,'candidate_coverage':n/len(scored),'precision_wilson_lower':wilson(tp,n)}
        if target is None:
            if best is None or f1>best['f1']:best=row
        elif n>=minimum and row['precision_wilson_lower']>=target:
            if best is None or n>best['selected']:best=row
    return best or {'threshold':None,'reason':'no_supported_threshold'}


def run(run_dir,source,output):
    from transformers import AutoTokenizer
    run_dir,source,output=map(Path,(run_dir,source,output));output.mkdir(parents=True,exist_ok=True)
    config=json.loads((run_dir/'run_config.json').read_text())
    meta=json.loads((run_dir/'checkpoint/task_metadata.json').read_text())
    tokenizer=AutoTokenizer.from_pretrained(run_dir/'checkpoint',local_files_only=True,use_fast=True)
    records=balanced_records(source/'dev.jsonl.gz',config['max_dev_examples'],config['fields'],config['seed']+1,set(meta['attribute_queries']))
    by_key={(r['product_id'],r['field'],r['attribute_id']):r for r in records}
    brands={(r['product_id'],r['field']):r['spans'] for r in records if r['attribute_id']=='brand'}
    gold=set();groups={};windows=0
    for i,r in enumerate(records):
        k=(r['product_id'],r['field'],r['attribute_id']);groups[k]=r['group_id']
        features=encode_records([r],tokenizer,config['max_length'],config['stride']);windows+=len(features)
        for f in features:
            gold.update((*k,s['start'],s['end']) for s in f['gold_spans'])
        if i%3000==0:print(json.dumps({'event':'reproduce_gold','records':i}),flush=True)
    scored={};pred_keys=set()
    for r in read_rows(run_dir/'dev_predictions.jsonl'):
        k=(r['product_id'],r['field'],r['attribute_id']);pred_keys.add(k)
        if k not in by_key:raise ValueError('Predictions differ from reproduced dev selection')
        for s in r['spans']:
            pos=(*k,s['start'],s['end'])
            if by_key[k]['text'][s['start']:s['end']]!=s['quote']:raise ValueError('Invalid prediction evidence')
            scored[pos]=max(scored.get(pos,0),s['raw_score'])
    metric=counts(set(scored),gold)
    original=json.loads((run_dir/'best_metrics.json').read_text())
    if any(metric[k]!=original[k] for k in ['tp','fp','fn','support']):raise ValueError(f'Reproduction mismatch: {metric}')
    tasks=[]
    gold_tasks=collections.defaultdict(set);pred_tasks=collections.defaultdict(set)
    for x in gold:gold_tasks[x[:3]].add(x)
    for x in scored:pred_tasks[x[:3]].add(x)
    for k in sorted(pred_keys):
        g,p=gold_tasks[k],pred_tasks[k]
        if g==p:continue
        r=by_key[k]
        near=any(x[-2]<y[-1] and y[-2]<x[-1] for x in p-g for y in g-p)
        updated,reasons=repair_record(r,brands.get((r['product_id'],r['field']),()))
        tasks.append({'product_id':k[0],'field':k[1],'attribute_id':k[2],'group_id':r['group_id'],
                      'category_name':r.get('category_name'),'text':r['text'],'error_type':'boundary_or_partial' if near else 'extra_or_missing',
                      'label_suspect_reasons':reasons,'verification':'unreviewed',
                      'gold':[{'start':x[-2],'end':x[-1],'quote':r['text'][x[-2]:x[-1]]} for x in sorted(g)],
                      'predicted':[{'start':x[-2],'end':x[-1],'quote':r['text'][x[-2]:x[-1]],'raw_score':scored[x]} for x in sorted(p)]})
    from catalog_ai.participant3.refinement import write_rows
    write_rows(output/'error_tasks.jsonl',tasks)
    def partition(k):return int(hashlib.sha256(groups[k[:3]].encode()).hexdigest()[:8],16)%2
    tune={k:v for k,v in scored.items() if partition(k)==0};check={k:v for k,v in scored.items() if partition(k)==1}
    tg={k for k in gold if partition(k)==0};cg={k for k in gold if partition(k)==1}
    variants={}
    for name,target in [('balanced_review',None),('precision95_review',.95),('precision98_review',.98)]:
        selected=select_threshold(tune,tg,target)
        t=selected.get('threshold')
        selected['diagnostic_check']=counts({k for k,v in check.items() if t is not None and v>=t},cg)
        selected['automatic_acceptance']=False;variants[name]=selected
    attrs={}
    for a in sorted({k[2] for k in gold}):
        ap={k:v for k,v in tune.items() if k[2]==a};ag={k for k in tg if k[2]==a}
        if len(ag)>=25:
            r=select_threshold(ap,ag)
            t=r.get('threshold');r['diagnostic_check']=counts({k for k,v in check.items() if k[2]==a and t is not None and v>=t},{k for k in cg if k[2]==a})
            attrs[a]=r
    grid=[]
    for t in [0,.5,.7,.8,.9,.95,.97,.98,.99,.995,.999]:
        grid.append({'threshold':t,**counts({k for k,v in scored.items() if v>=t},gold)})
    summary={'reproduced_best_metrics':metric,'encoded_windows':windows,'error_tasks':len(tasks),
             'error_types':dict(collections.Counter(x['error_type'] for x in tasks)),
             'suspect_label_tasks':sum(bool(x['label_suspect_reasons']) for x in tasks),
             'threshold_variants':variants,'per_attribute_exploratory':attrs,'threshold_sweep_silver':grid,
             'verification':'silver_only','human_verified':False,'automatic_acceptance':False,
             'calibrated':False,'test_used':False,'partition':'group hash mod2 within already-used dev',
             'limitations':['positive-conditioned windows only; absence not evaluated','checkpoint selected on this dev; diagnostic split is not independent','thresholds apply only to this checkpoint and these silver labels; refit after retraining','no guarantee of 95/98% precision on real traffic']}
    (output/'diagnostics.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    import yaml
    for name,variant in variants.items():
        t=variant.get('threshold');policy={'version':f'refinement-v2-{name}-exploratory','auto_accept':False,'calibrators':{},
             'thresholds':{f'transformer/{a}':t for a in meta['attribute_queries']} if t is not None else {},
             'supported_threshold_found':t is not None,'reason':'Silver diagnostic review threshold, not a calibrated probability; auto-acceptance disabled.'}
        (output/f'{name}.yaml').write_text(yaml.safe_dump(policy,allow_unicode=True,sort_keys=False))
    print(json.dumps({k:v for k,v in summary.items() if k not in ['per_attribute_exploratory','threshold_sweep_silver']},ensure_ascii=False,indent=2),flush=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('--run',default='models/transformer');p.add_argument('--source',default='data/participant3_demo');p.add_argument('--output',default='reports/refinement_v2');a=p.parse_args();run(a.run,a.source,a.output)
if __name__=='__main__':main()
