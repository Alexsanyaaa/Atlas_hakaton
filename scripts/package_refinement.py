"""Build a standalone update archive, preserving original dataset and weights."""
import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
files={root/name for name in ['README.md','train_refinement.py','evaluate_refinement.py','diagnose_refinement.py','compare_refinement.py','verify_refinement_bundle.py','check_gpu.py','scripts/run_refinement_wsl.sh','scripts/setup_rx9070xt_wsl.sh','scripts/rocm_wsl_env.sh','scripts/package_refinement.py','requirements-transformer-demo.txt','output/ИНСТРУКЦИЯ_УЛУЧШЕНИЕ_ТРАНСФОРМЕРА_V2.md','reports/refinement_v2/README.md','reports/refinement_v2/diagnostics.json','reports/refinement_v2/error_tasks.jsonl','reports/refinement_v2/balanced_review.yaml','reports/refinement_v2/precision95_review.yaml','reports/refinement_v2/precision98_review.yaml','reports/refinement_v2/tests.log','reports/refinement_v2/data_validation.json','reports/refinement_v2/trainer_smoke.log','reports/refinement_v2/baseline_challenge/metrics.json','reports/refinement_v2/baseline_challenge/predictions.jsonl']}
files.update((root/'src/catalog_ai').rglob('*.py'))
files.update(root/f'configs/refinement_v2/{v}.yaml' for v in 'ABCD')
files.update((root/'data/participant3_refined').glob('*'))
files.update((root/'tests/transformer').glob('test_*.py'))
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
manifest={'version':'transformer_refinement_v2','contains_weights':False,'contains_test_data':False,'target':'existing WSL RX9070XT environment','files':{str(p.relative_to(root)):digest(p) for p in sorted(files) if p.is_file()}}
mp=root/'refinement_bundle_manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
out=root/'output/transformer_refinement_v2.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(files|{mp}):
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(out) as z:
 if z.testzip():raise RuntimeError('Archive CRC failed')
print(json.dumps({'archive':str(out),'bytes':out.stat().st_size,'files':len(manifest['files'])+1}))
