"""Verify transferred source/data hashes before training; no GPU required."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parent


def main():
    path=ROOT/'training_bundle_manifest.json'
    if not path.exists():
        raise SystemExit('training_bundle_manifest.json is missing; unpack the complete training archive.')
    manifest=json.loads(path.read_text(encoding='utf-8'))
    for relative,expected in manifest['files'].items():
        file=(ROOT/relative).resolve()
        if ROOT not in file.parents or not file.is_file():
            raise SystemExit(f'Missing or invalid file: {relative}')
        h=hashlib.sha256()
        with file.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''):
                h.update(block)
        if h.hexdigest()!=expected:
            raise SystemExit(f'SHA256 mismatch: {relative}')
    print(f'PASS: {len(manifest["files"])} source/data files verified.')


if __name__=='__main__':
    main()
