"""Verify the separate v2 bundle, without changing v1 manifests or checkpoints."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent
manifest=json.loads((root/'refinement_bundle_manifest.json').read_text(encoding='utf-8'))
for name,expected in manifest['files'].items():
    path=root/name
    if not path.is_file():raise SystemExit(f'Missing: {name}')
    h=hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda:handle.read(1048576),b''):h.update(block)
    if h.hexdigest()!=expected:raise SystemExit(f'Checksum mismatch: {name}')
print(f"PASS: {len(manifest['files'])} refinement source/data files verified.")
