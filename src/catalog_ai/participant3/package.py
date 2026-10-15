"""Build an explicit source-only handoff; never sweep datasets/weights into ZIP."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("output/participant3_handoff.zip"))
    args = parser.parse_args()
    files = [Path(x) for x in ["pyproject.toml", ".gitignore", "README_PARTICIPANT_3.md",
                               "requirements-participant3-cpu.lock.txt", "reports/transformer_experiment.md",
                               "reports/confidence.md"]]
    for pattern in ["src/catalog_ai/**/*.py", "configs/*.yaml", "tests/transformer/*.py",
                    "reports/participant3/**/*.json", "reports/participant3/**/*.md", "reports/participant3/**/*.log"]:
        files.extend(sorted(Path().glob(pattern)))
    files = sorted(set(files))
    missing = [str(p) for p in files if not p.is_file()]
    if missing:
        raise FileNotFoundError(missing)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    with ZipFile(args.output, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, str(path))
        archive.writestr("SOURCE_MANIFEST.json", json.dumps(manifest, indent=2))
    with ZipFile(args.output) as archive:
        assert archive.testzip() is None
        assert not any(p.startswith(("cu_ws/", "data/", "models/", ".venv/")) for p in archive.namelist())
    print(f"{args.output}: {len(files)} source/report files; no datasets or checkpoints")


if __name__ == "__main__":
    main()
