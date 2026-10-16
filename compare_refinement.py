"""Collect measured results; never invent metrics for unrun configurations."""
import argparse,json,csv
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runs',nargs='+',required=True);p.add_argument('--output',default='reports/refinement_v2/comparison.csv');a=p.parse_args()
rows=[]
for run in a.runs:
    path=Path(run);config=json.loads((path/'run_config.json').read_text());metric=json.loads((path/'best_metrics.json').read_text());summary=json.loads((path/'training_summary.json').read_text())
    row={'run':str(path),'variant':config.get('experiment_variant','baseline'),'dev_dataset_sha256':json.loads((path/'data_manifest.json').read_text())['dev_sha256'],'silver_f1':metric['f1'],'silver_precision':metric['precision'],'silver_recall':metric['recall'],'seconds':summary['elapsed_seconds'],'steps':summary['optimizer_steps'],'challenge_f1':'','challenge_negative_fp':''}
    cp=path/'challenge/metrics.json'
    if cp.exists():
        m=json.loads(cp.read_text());row.update(challenge_f1=m['f1'],challenge_negative_fp=m['false_positive_negative_tasks'])
    rows.append(row)
# A mixed evaluation dataset would make the table misleading.
if len({r['dev_dataset_sha256'] for r in rows})>1:raise SystemExit('Нельзя сравнивать dev F1: разные версии разметки. Переоцените модели на одной версии dev.')
out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
with out.open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
print(out)
