"""Bounded organizer-data audit and explicit silver span preparation.

No query clicks are treated as extraction labels. No absent catalog field is
turned into a negative. This provisional split is replaceable by participant 1.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

from .pickle_stream import iter_offers

ATTRIBUTES = ["brand", "model", "color", "ram_gb", "storage_gb", "screen_inches", "battery_mah", "cpu"]
QUERIES = {
    "brand": "Бренд, производитель товара",
    "model": "Модель товара",
    "color": "Цвет товара",
    "ram_gb": "Объём оперативной памяти, ОЗУ, RAM",
    "storage_gb": "Объём встроенной памяти или накопителя, SSD, HDD",
    "screen_inches": "Диагональ экрана в дюймах",
    "battery_mah": "Ёмкость аккумулятора в мАч",
    "cpu": "Модель процессора",
}


def dump_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def key_normalized(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).lower().replace("ё", "е")).strip()


def attribute_for_name(name: str) -> str | None:
    name = key_normalized(name).removesuffix("_search")
    if name in {"бренд", "производитель"}:
        return "brand"
    if name in {"модель", "модель товара"}:
        return "model"
    if name in {"цвет", "цвет корпуса", "основной цвет"}:
        return "color"
    if 'оперативн' in name and 'встроенн' in name:
        return None
    # RAM technology, a maximum supported capacity and a combined RAM/ROM
    # facet are different attributes from the installed RAM capacity.
    if re.search(r"оперативн.*памят|объем озу", name) and not re.search(
            r"тип|стандарт|частот|максималь|встроенн|слот|канал", name):
        return "ram_gb"
    if re.search(r"(?:встроенн.*памят|объем.*(?:ssd|hdd|накопител))", name):
        return "storage_gb"
    if name in {"диагональ экрана", "диагональ дисплея", "диагональ"}:
        return "screen_inches"
    if re.search(r"емкость (?:аккумулятора|батареи)", name):
        return "battery_mah"
    if name in {"процессор", "модель процессора", "тип процессора"}:
        return "cpu"
    return None


def catalog_values(offer: dict) -> dict[str, list[str]]:
    values = collections.defaultdict(list)
    for attr, key in [("brand", "vendor"), ("model", "model")]:
        value = str(offer.get(key, "")).strip()
        if value and value not in {"-", "None", "нет", "не указан"}:
            values[attr].append(value)
    params = offer.get("param", [])
    if isinstance(params, dict):
        params = [params]
    for param in params:
        if not isinstance(param, dict):
            continue
        attr = attribute_for_name(str(param.get("@name", "")))
        value = str(param.get("#text", "")).strip()
        if attr and value and value not in {"-", "Да", "Нет", "None", "не указан"}:
            values[attr].append(value)
    return {k: list(dict.fromkeys(v)) for k, v in values.items()}


def find_spans(text: str, attribute: str, values: list[str]) -> list[dict]:
    """Conservative string alignment, not a runtime rule-based extractor."""
    found = {}
    for value in values:
        pattern = r"(?<!\w)" + re.escape(value).replace(r"\ ", r"\s+") + r"(?!\w)"
        for match in re.finditer(pattern, text, re.IGNORECASE):
            start, end = match.span()
            if attribute in {"ram_gb", "storage_gb", "screen_inches", "battery_mah"}:
                # Bare values require an explicit nearby unit, avoiding 8 in S8.
                units = {
                    "ram_gb": r"\s*(?:ГБ|GB|МБ|MB|ТБ|TB)\b",
                    "storage_gb": r"\s*(?:ГБ|GB|МБ|MB|ТБ|TB)\b",
                    "screen_inches": r'\s*(?:["″]|дюйм\w*|inch\w*)',
                    "battery_mah": r"\s*(?:мА\s*[·*]?\s*ч|mAh)\b",
                }
                if re.fullmatch(r"\d+(?:[.,]\d+)?", value):
                    unit = re.match(units[attribute], text[end:], re.IGNORECASE)
                    if not unit:
                        continue
                    end += unit.end()
            if end > start:
                found[(start, end)] = {"start": start, "end": end, "label": attribute,
                                       "quote": text[start:end], "catalog_value": value}
    # Overlaps for the SAME conditioned attribute are ambiguous: retain longest.
    chosen = []
    for span in sorted(found.values(), key=lambda s: (-(s["end"] - s["start"]), s["start"])):
        if not any(span["start"] < x["end"] and x["start"] < span["end"] for x in chosen):
            chosen.append(span)
    return sorted(chosen, key=lambda x: x["start"])


def group_id(offer: dict, values: dict) -> str:
    model = key_normalized(offer.get("model") or offer.get("name", ""))
    for attr in ["color", "ram_gb", "storage_gb"]:
        for value in values.get(attr, []):
            model = model.replace(key_normalized(value), " ")
    model = re.sub(r"\b\d+\s*(?:gb|гб|tb|тб)\b", " ", model)
    # Variant grouping is approximate and explicitly recorded in the manifest.
    base = key_normalized(str(offer.get("vendor", "")) + " " + model)
    return hashlib.sha256(base.encode()).hexdigest()[:20]


def split_for(group: str, seed: int) -> str:
    bucket = int(hashlib.sha256(f"{seed}:{group}".encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 70 else "dev" if bucket < 85 else "test"


def prepare(source: Path, output: Path, limit: int, seed: int, descriptions: bool = True):
    import pyarrow.parquet as pq

    output.mkdir(parents=True, exist_ok=True)
    audit = {"supervision": "silver_catalog_alignment", "selection": "bounded_catalog_prefix",
             "limit_offers": limit, "seed": seed, "official_schema_available": False,
             "official_split_available": False, "gold_spans_available": False, "files": {}}
    for name in ["sku_desc.parquet", "query_clicks.parquet"]:
        file = pq.ParquetFile(source / name)
        audit["files"][name] = {"rows": file.metadata.num_rows,
                                "row_groups": file.num_row_groups,
                                "schema": str(file.schema_arrow),
                                "size_bytes": (source / name).stat().st_size}
    audit["files"]["skus.pkl"] = {"size_bytes": (source / "skus.pkl").stat().st_size}
    cats = {}
    offers = list(iter_offers(source / "skus.pkl", limit=limit, categories=cats))
    by_id = {str(x["@id"]): x for x in offers}
    if len(by_id) != len(offers):
        raise ValueError("Duplicate SKU IDs in the selected catalog prefix")
    desc = {}
    if descriptions:
        file = pq.ParquetFile(source / "sku_desc.parquet")
        for batch in file.iter_batches(batch_size=2048, columns=["sku_id", "title", "description"]):
            for row in batch.to_pylist():
                pid = str(row["sku_id"])
                if pid in by_id and pid not in desc:
                    desc[pid] = row
    field_counts, attrs, category_counts, skipped = [collections.Counter() for _ in range(4)]
    manifest = {"provisional": True, "selection": "bounded_catalog_prefix",
                "grouping": "normalized vendor/model with known memory/color removed; approximate",
                "seed": seed, "supervision": "silver_catalog_alignment", "products": {}}
    handles = {s: (output / f"{s}.jsonl").open("w", encoding="utf-8") for s in ["train", "dev", "test"]}
    cards_file = (output / "cards.jsonl").open("w", encoding="utf-8")
    annotations_file = (output / "spans.jsonl").open("w", encoding="utf-8")
    try:
        for offer in offers:
            pid = str(offer["@id"])
            cid = str(offer.get("categories", {}).get("categoryId", ""))
            category = str(cats.get(cid, {}).get("#text", cid))
            category_counts[category] += 1
            values = catalog_values(offer)
            group = group_id(offer, values)
            split = split_for(group, seed)
            title = str(offer.get("name", ""))
            card = {"schema_version": "2.0", "product_id": pid, "category_id": cid,
                    "category_name": category, "seller_id": None, "title": title,
                    "description": str(desc.get(pid, {}).get("description") or ""),
                    "seller_attributes": []}
            # Catalog param/vendor/model are target SOURCES, never model inputs.
            cards_file.write(json.dumps(card, ensure_ascii=False) + "\n")
            manifest["products"][pid] = {"split": split, "group_id": group, "category_id": cid}
            for field in ["title", "description"]:
                text = card[field]
                if not text:
                    continue
                for attr, options in values.items():
                    if attr not in ATTRIBUTES:
                        continue
                    spans = find_spans(text, attr, options)
                    if not spans:
                        skipped[attr] += 1
                        continue
                    record = {"product_id": pid, "field": field, "text": text,
                              "category_id": cid, "category_name": category,
                              "attribute_id": attr, "spans": spans, "group_id": group,
                              "supervision": "silver_catalog_alignment", "split": split}
                    handles[split].write(json.dumps(record, ensure_ascii=False) + "\n")
                    annotations_file.write(json.dumps(record, ensure_ascii=False) + "\n")
                    field_counts[f"{split}/{field}"] += 1
                    attrs[attr] += 1
    finally:
        for handle in [*handles.values(), cards_file, annotations_file]:
            handle.close()
    audit.update({"selected_offers": len(offers), "joined_descriptions": len(desc),
                  "categories_in_catalog": len(cats), "selected_categories": dict(category_counts),
                  "examples_by_attribute": dict(attrs), "examples_by_split_field": dict(field_counts),
                  "unmatched_catalog_attribute_fields": dict(skipped),
                  "limitations": ["Prefix selection is biased, not a full-catalog sample.",
                                  "Catalog-derived spans are weak labels, not human gold.",
                                  "No synthetic negatives from absent/unmatched fields.",
                                  "No official mandatory attribute taxonomy was included.",
                                  "Query clicks excluded: relevance is not an extraction label."]})
    dump_json(output / "manifest.json", manifest)
    dump_json(output / "audit.json", audit)
    dump_json(output / "categories.json", cats)
    summary = {k: v for k, v in audit.items() if k not in {"selected_categories", "files"}}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path, default=Path("cu_ws"))
    p.add_argument("--output", type=Path, default=Path("data/participant3"))
    p.add_argument("--limit", type=int, default=5000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--no-descriptions", action="store_true")
    a = p.parse_args()
    prepare(a.source, a.output, a.limit, a.seed, not a.no_descriptions)


if __name__ == "__main__":
    main()
