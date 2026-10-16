"""Launch an isolated controlled refinement run; never overwrite old weights."""
from pathlib import Path
from datetime import datetime
import argparse, json, yaml
import os, sys

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT/'src'))


def main():
    p=argparse.ArgumentParser();p.add_argument('--variant',choices=['A','B','C','D'],required=True);p.add_argument('--checkpoint',help='Path to the best existing checkpoint, not checkpoint-last');p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
    root=Path(__file__).resolve().parent
    config=yaml.safe_load((root/f'configs/refinement_v2/{a.variant}.yaml').read_text())
    if a.variant!='D':
        if not a.checkpoint:
            candidates=[]
            paths=list((root/'models').glob('**/checkpoint/task_metadata.json'))
            paths+=list(root.glob('full-*/checkpoint/task_metadata.json'))
            for path in paths:
                if 'refinement_' in str(path):continue
                if json.loads(path.read_text()).get('optimizer_steps')==20000:candidates.append(path.parent)
            if len(candidates)!=1:
                raise SystemExit('Не удалось однозначно найти исходный checkpoint шага 20000. Укажите --checkpoint ПУТЬ/К/checkpoint.')
            a.checkpoint=str(candidates[0])
        checkpoint=Path(a.checkpoint)
        if not checkpoint.is_dir():raise SystemExit(f'Checkpoint не найден: {checkpoint}')
        meta=json.loads((checkpoint/'task_metadata.json').read_text())
        if meta.get('optimizer_steps')!=20000:raise SystemExit('Для контролируемого сравнения нужен лучший исходный checkpoint шага 20000.')
        config.update(model=str(checkpoint.resolve()),revision=None,use_safetensors=True)
    name=f'refinement_{a.variant}_{datetime.now().strftime("%Y%m%d_%H%M%S_%f")}'
    config['output']=f'models/{name}'
    generated=root/f'configs/refinement_v2/{name}.yaml';generated.write_text(yaml.safe_dump(config,allow_unicode=True,sort_keys=False))
    print('Конфигурация:',generated,flush=True);print('Результаты:',config['output'],flush=True)
    if not a.prepare_only:
        from catalog_ai.training.demo import train
        train(config)
if __name__=='__main__':main()
