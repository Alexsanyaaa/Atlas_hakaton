"""Create UNREVIEWED tasks including unknown/absent attribute cases.

Exclude all groups used by ANY listed training/checkpoint-selection run. Do not
touch test. Human annotators supply verified spans and explicit absence labels.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
from pathlib import Path

from .prepare import dump_json


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=Path("data/participant3"))
    p.add_argument("--runs", nargs="+", type=Path, required=True)
    p.add_argument("--output", type=Path, default=Path("outputs/participant3"))
    p.add_argument("--limit", type=int, default=60)
    a = p.parse_args()
    manifest = json.loads((a.data / "manifest.json").read_text())["products"]
    excluded = set()
    for run in a.runs:
        info = json.loads((run / "data_manifest.json").read_text())
        for pid in info["train_product_ids"] + info["dev_product_ids"]:
            excluded.add(manifest[pid]["group_id"])
    silver = {}
    with (a.data / "dev.jsonl").open() as source:
        for line in source:
            row = json.loads(line)
            if row["field"] == "title":
                silver[(row["product_id"], row["attribute_id"])] = row["spans"]
    cards = []
    with (a.data / "cards.jsonl").open() as source:
        for line in source:
            row = json.loads(line)
            info = manifest[row["product_id"]]
            if info["split"] == "dev" and info["group_id"] not in excluded:
                cards.append(row)
    random.Random(42).shuffle(cards)
    selected, used, counts = [], set(), collections.Counter()
    attributes = ["brand", "model", "color"]
    for card in cards:
        pid = card["product_id"]
        group = manifest[pid]["group_id"]
        if group in used:
            continue
        used.add(group)
        attr = attributes[len(selected) % len(attributes)]
        counts[attr] += 1
        selected.append({"task_id": hashlib.sha256(f"{pid}:title:{attr}".encode()).hexdigest()[:16],
                         "product_id": pid, "group_id": group, "field": "title", "text": card["title"],
                         "attribute_id": attr, "suggested_silver_spans": silver.get((pid, attr), []),
                         "verified_spans": None, "is_absent": None, "verification": "unreviewed",
                         "proposed_split": "calibration_candidate",
                         "instructions": "Проверьте все значения целевого атрибута в исходном тексте; запишите точные [start,end). Отсутствие значения подтвердите отдельно. Предложения из каталога могут быть ошибочны."})
        if len(selected) >= a.limit:
            break
    a.output.mkdir(parents=True, exist_ok=True)
    with (a.output / "review_queue.jsonl").open("w", encoding="utf-8") as target:
        for row in selected:
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
    dump_json(a.output / "review_queue_manifest.json", {
        "tasks": len(selected), "by_attribute": dict(counts), "test_used": False,
        "excluded_run_groups": [str(x) for x in a.runs], "human_verification_done": False,
        "includes_cases_without_silver_span": sum(not x["suggested_silver_spans"] for x in selected),
        "note": "Not calibration observations yet. Need human spans/absence, candidate correctness, and independent threshold/evaluation split."})
    print(f"Created {len(selected)} unreviewed tasks")


if __name__ == "__main__":
    main()
