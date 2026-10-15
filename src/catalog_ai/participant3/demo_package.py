"""Pack prepared demo data plus portable Windows/AMD training tools."""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path


def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):
            h.update(block)
    return h.hexdigest()


def build(base):
    data=base/'data/participant3_demo'
    summary=json.loads((data/'dataset_complete.json').read_text(encoding='utf-8'))
    files=set()
    for name in ['train_transformer.py','predict_demo.py','check_gpu.py','verify_training_bundle.py',
                 'requirements-transformer-demo.txt','README_RX9070XT.md','pyproject.toml',
                 'configs/rx9070xt_demo.yaml','scripts/setup_rx9070xt_wsl.sh',
                 'scripts/run_rx9070xt_wsl.sh','scripts/rocm_wsl_env.sh',
                 'configs/rx9070xt_full.yaml','scripts/run_rx9070xt_full_wsl.sh',
                 'output/ИНСТРУКЦИЯ_ПОЛНОЕ_ОБУЧЕНИЕ_RX9070.md']:
        files.add(base/name)
    files.update((base/'src/catalog_ai').rglob('*.py'))
    for name in ['train.jsonl.gz','dev.jsonl.gz','test.jsonl.gz','product_splits.jsonl.gz',
                 'attribute_registry.json','categories.json','demo_cards.jsonl','dataset_complete.json',
                 'catalog_complete.json','descriptions_complete.json']:
        files.add(data/name)
    for name in ['reports/participant3/demo_dataset_report.md','reports/participant3/demo_verification.json',
                 'reports/participant3/demo_training_smoke.log',
                 'output/team/Основные_характеристики_96_разделов.md']:
        path=base/name
        if path.exists():
            files.add(path)
    manifest={'format':'portable_transformer_demo_v1','target':'Windows 11 + WSL2 Ubuntu 24.04 / AMD RX 9070 XT / ROCm 7.2.1 + ROCDXG / FP16',
              'dataset_selection':summary['selection'],'dataset_supervision':summary['supervision'],
              'files':{str(path.relative_to(base)).replace('\\','/'):sha256(path) for path in sorted(files)}}
    manifest_path=base/'training_bundle_manifest.json'
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    output=base/'output/transformer_rx9070xt_demo.zip'
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for path in sorted(files|{manifest_path}):
            archive.write(path,path.relative_to(base))
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('ZIP CRC verification failed')
    print(json.dumps({'zip':str(output),'bytes':output.stat().st_size,'files':len(files)+1,
                      'products':summary['products'],'examples':summary['positive_examples_by_split']},ensure_ascii=False))


if __name__=='__main__':
    build(Path.cwd())
