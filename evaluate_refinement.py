"""Exact-span diagnostic evaluation including explicitly annotated absence."""
from pathlib import Path
import argparse,json,collections,time
import os,sys

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0,str(ROOT/'src'))


def main():
    import torch
    from transformers import AutoTokenizer,AutoModelForTokenClassification
    from catalog_ai.participant3.refinement import read_rows
    from catalog_ai.participant3.bio import encode_records
    from catalog_ai.training.transformer import evaluate
    from catalog_ai.participant3.diagnostics import counts
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--records',default='data/participant3_refined/challenge.jsonl');p.add_argument('--output',default='reports/refinement_v2/baseline_challenge');p.add_argument('--device',default='cpu');p.add_argument('--threads',type=int,default=2);p.add_argument('--batch-size',type=int,default=4);a=p.parse_args()
    torch.set_num_threads(a.threads);started=time.monotonic();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    rows=list(read_rows(a.records));keys=[(r['product_id'],r['field'],r['attribute_id']) for r in rows]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate diagnostic tasks')
    tok=AutoTokenizer.from_pretrained(a.checkpoint,use_fast=True,local_files_only=True)
    model=AutoModelForTokenClassification.from_pretrained(a.checkpoint,use_safetensors=True,local_files_only=True).to(a.device)
    features=encode_records(rows,tok,256,64)
    metric,pred=evaluate(model,features,tok,torch.device(a.device),a.batch_size)
    gold={ (f['record']['product_id'],f['record']['field'],f['record']['attribute_id'],s['start'],s['end'])
           for f in features for s in f['gold_spans'] };scored={}
    for r in pred:
        k=(r['product_id'],r['field'],r['attribute_id'])
        for s in r['spans']:
            key=(*k,s['start'],s['end']);scored[key]=max(scored.get(key,0),s['raw_score'])
    absent={k for k,r in zip(keys,rows) if r.get('annotation_complete') and not r['spans']}
    absent_fp={k[:3] for k in scored if k[:3] in absent}
    metric={k:v for k,v in metric.items() if k!='latency_batch_amortized_seconds'}
    kind = ('agent_authored_synthetic_challenge_exact_span' if all(
        r.get('supervision','').startswith('agent_authored') for r in rows) else 'silver_conditioned_exact_span')
    metric.update(evaluation_kind=kind,human_gold=False,
                  tasks=len(rows),negative_tasks=len(absent),false_positive_negative_tasks=len(absent_fp),
                  elapsed_seconds=time.monotonic()-started,checkpoint=str(a.checkpoint),test_used=False,
                  threshold_sweep=[{'threshold':t,**counts({k for k,v in scored.items() if v>=t},gold)} for t in [0,.8,.95,.99]])
    (out/'metrics.json').write_text(json.dumps(metric,ensure_ascii=False,indent=2))
    (out/'predictions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in pred))
    print(json.dumps({k:v for k,v in metric.items() if k not in ['per_attribute','threshold_sweep']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
