"""Inference after training. Keeps raw scores explicit, with exact evidence."""
from pathlib import Path
import argparse
import json
import os
import sys

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0,str(ROOT/'src'))


def main():
    from catalog_ai.extractors.transformer import TransformerExtractor
    p=argparse.ArgumentParser()
    p.add_argument('--checkpoint',default='models/rx9070xt_demo/checkpoint')
    p.add_argument('--input',default='data/participant3_demo/demo_cards.jsonl')
    p.add_argument('--output',default='outputs/demo_predictions.jsonl')
    p.add_argument('--attributes',nargs='+',default=['brand','model','color'])
    p.add_argument('--limit',type=int,default=5)
    a=p.parse_args()
    extractor=TransformerExtractor(a.checkpoint,max_length=192,stride=48,batch_size=12)
    output=Path(a.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    errors=0
    with Path(a.input).open(encoding='utf-8') as f,output.open('w',encoding='utf-8') as target:
        for i,line in enumerate(f):
            if i>=a.limit:
                break
            card=json.loads(line)
            result=extractor.extract(card,requested_attributes=a.attributes)
            row={'product_id':card['product_id'],'title':card['title'],**result,
                 'confidence_kind':'uncalibrated','automatic_acceptance':False}
            errors+=result['status']=='error'
            target.write(json.dumps(row,ensure_ascii=False)+'\n')
            print(json.dumps(row,ensure_ascii=False))
    if errors:
        raise SystemExit(f'{errors} inference errors; see {output}')


if __name__=='__main__':
    main()
