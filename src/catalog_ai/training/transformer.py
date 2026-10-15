"""Real encoder fine-tuning with bounded CPU pilot and GPU configuration support."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from collections import Counter
from pathlib import Path

from catalog_ai.participant3.bio import ID2LABEL, LABEL2ID, load_records, encode_records, collate, decode_spans
from catalog_ai.participant3.prepare import dump_json


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def evaluate(model, features, tokenizer, device, batch_size=8):
    import torch
    model.eval()
    pred, gold = set(), set()
    losses, predictions, elapsed = [], [], []
    with torch.no_grad():
        for offset in range(0, len(features), batch_size):
            group = features[offset:offset + batch_size]
            batch = {k: v.to(device) for k, v in collate(group, tokenizer).items()}
            if device.type == "cuda":
                torch.cuda.synchronize()
            started = time.perf_counter()
            outputs = model(**batch)
            if device.type == "cuda":
                torch.cuda.synchronize()
            elapsed.append((time.perf_counter() - started) / len(group))
            losses.append(float(outputs.loss))
            probs = outputs.logits.softmax(-1).cpu()
            scores, labels = probs.max(-1)
            for j, feature in enumerate(group):
                r = feature["record"]
                key = (r["product_id"], r["field"], r["attribute_id"])
                spans = decode_spans(r["text"], feature["offsets"], feature["sequence_ids"],
                                    labels[j].tolist(), scores[j].tolist())
                for span in spans:
                    pred.add((*key, span["start"], span["end"]))
                for span in feature["gold_spans"]:
                    gold.add((*key, span["start"], span["end"]))
                predictions.append({"product_id": r["product_id"], "field": r["field"],
                                    "attribute_id": r["attribute_id"], "spans": spans,
                                    "supervision": r["supervision"]})
    attrs = sorted({x[2] for x in gold | pred})
    def counts(p, g):
        tp = len(p & g)
        return {"tp": tp, "fp": len(p - g), "fn": len(g - p), "support": len(g),
                "precision": tp / len(p) if p else None,
                "recall": tp / len(g) if g else None,
                "f1": 2 * tp / (len(p) + len(g)) if p or g else None}
    metrics = counts(pred, gold)
    metrics["per_attribute"] = {a: counts({x for x in pred if x[2] == a}, {x for x in gold if x[2] == a}) for a in attrs}
    metrics.update({"loss": sum(losses) / len(losses) if losses else None,
                    "examples": len(features), "latency_batch_amortized_seconds": elapsed,
                    "evaluation_kind": "silver_conditioned_exact_span_before_threshold",
                    "not_human_gold": True, "not_full_card_attribute_metric": True})
    return metrics, predictions


def train(config):
    import numpy as np
    import torch
    from transformers import AutoTokenizer, AutoModelForTokenClassification

    random.seed(config["seed"])
    np.random.seed(config["seed"])
    torch.manual_seed(config["seed"])
    torch.set_num_threads(config.get("threads", 2))
    device = torch.device(config.get("device", "cuda" if torch.cuda.is_available() else "cpu"))
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but not available; CPU pilot uses a separate config")
    output = Path(config["output"])
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    model_id = config["model"]
    load_args = {"revision": config.get("revision"), "trust_remote_code": False}
    tokenizer = AutoTokenizer.from_pretrained(model_id, use_fast=True, **load_args)
    if not tokenizer.is_fast:
        raise ValueError("A fast tokenizer with original offsets is required")
    model = AutoModelForTokenClassification.from_pretrained(
        model_id, num_labels=3, id2label=ID2LABEL, label2id=LABEL2ID,
        use_safetensors=config.get("use_safetensors", True), weights_only=True,
        **load_args).to(device)
    last_layers = config.get("train_encoder_last_n_layers")
    if last_layers is not None:
        layers = model.base_model.encoder.layer
        if not 1 <= last_layers <= len(layers):
            raise ValueError("train_encoder_last_n_layers out of range")
        for parameter in model.base_model.parameters():
            parameter.requires_grad_(False)
        for layer in layers[-last_layers:]:
            for parameter in layer.parameters():
                parameter.requires_grad_(True)
    train_records = load_records(config["train"], config["max_train_examples"], config["fields"], config["seed"])
    dev_records = load_records(config["dev"], config["max_dev_examples"], config["fields"], config["seed"] + 1)
    train_groups = {x["group_id"] for x in train_records}
    if train_groups & {x["group_id"] for x in dev_records}:
        raise ValueError("Train/dev group leakage")
    features = encode_records(train_records, tokenizer, config["max_length"], config["stride"])
    dev = encode_records(dev_records, tokenizer, config["max_length"], config["stride"])
    if not features or not dev:
        raise ValueError("No aligned train/dev windows")
    dump_json(output / "run_config.json", config)
    dump_json(output / "data_manifest.json", {
        "train_sha256": file_hash(config["train"]), "dev_sha256": file_hash(config["dev"]),
        "train_windows": len(features), "dev_windows": len(dev),
        "train_examples_by_attribute": dict(Counter(r["attribute_id"] for r in train_records)),
        "dev_examples_by_attribute": dict(Counter(r["attribute_id"] for r in dev_records)),
        "train_product_ids": sorted({r["product_id"] for r in train_records}),
        "dev_product_ids": sorted({r["product_id"] for r in dev_records}),
        "supervision": "silver_catalog_alignment", "provisional_split": True,
        "annotation_mode": "attribute_conditioned_BIO", "test_used": False})
    # Verify encoder changes, not only the freshly initialized classification head.
    encoder_name, encoder_parameter = next((n, p) for n, p in model.named_parameters()
                                          if "attention.self.query.weight" in n and p.requires_grad)
    initial = encoder_parameter.detach().cpu().clone()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),
                                 lr=config["learning_rate"], weight_decay=0.01)
    amp = device.type == "cuda" and config.get("mixed_precision", True)
    amp_dtype = torch.bfloat16 if amp and torch.cuda.is_bf16_supported() else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=amp and amp_dtype == torch.float16)
    history, step, best = [], 0, -1.0
    if config.get("evaluate_before", True):
        before, _ = evaluate(model, dev, tokenizer, device, config["batch_size"])
        dump_json(output / "metrics_before.json", before)
        print(json.dumps({"event": "before", "f1": before["f1"], "loss": before["loss"]}), flush=True)
    for epoch in range(config["epochs"]):
        epoch_start = time.perf_counter()
        order = list(range(len(features)))
        random.Random(config["seed"] + epoch).shuffle(order)
        model.train()
        optimizer.zero_grad(set_to_none=True)
        losses = []
        batches = [order[i:i + config["batch_size"]] for i in range(0, len(order), config["batch_size"])]
        for batch_index, indices in enumerate(batches):
            group = [features[i] for i in indices]
            batch = {k: v.to(device) for k, v in collate(group, tokenizer).items()}
            accum = config.get("gradient_accumulation", 1)
            # The final accumulation group may be shorter.
            group_size = min(accum, len(batches) - (batch_index // accum) * accum)
            with torch.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp):
                result = model(**batch)
                loss = result.loss / group_size
            if not torch.isfinite(loss):
                raise FloatingPointError("Non-finite training loss")
            scaler.scale(loss).backward()
            losses.append(float(result.loss.detach()))
            if (batch_index + 1) % accum == 0 or batch_index == len(batches) - 1:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                step += 1
                if step % 10 == 0:
                    print(json.dumps({"event": "train", "epoch": epoch + 1, "step": step,
                                      "loss": losses[-1]}), flush=True)
        metrics, predictions = evaluate(model, dev, tokenizer, device, config["batch_size"])
        event = {"epoch": epoch + 1, "steps": step, "train_loss": sum(losses) / len(losses),
                 "dev_loss": metrics["loss"], "dev_silver_span_f1": metrics["f1"],
                 "epoch_seconds": time.perf_counter() - epoch_start}
        history.append(event)
        print(json.dumps(event), flush=True)
        score = metrics["f1"] if metrics["f1"] is not None else -1
        if score > best:
            best = score
            model.save_pretrained(output / "checkpoint", safe_serialization=True)
            tokenizer.save_pretrained(output / "checkpoint")
            dump_json(output / "checkpoint" / "task_metadata.json", {
                "annotation_mode": "attribute_conditioned_BIO",
                "supervision": "silver_catalog_alignment", "fields": config["fields"],
                "max_length": config["max_length"], "stride": config["stride"],
                "base_model": model_id, "base_revision": config.get("revision"),
                "train_encoder_last_n_layers": last_layers,
                "train_examples_by_attribute": dict(Counter(r["attribute_id"] for r in train_records)),
                "requires_human_review": True})
            dump_json(output / "best_metrics.json", metrics)
            with (output / "dev_predictions.jsonl").open("w", encoding="utf-8") as handle:
                for row in predictions:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    delta = float((encoder_parameter.detach().cpu() - initial).abs().max())
    if delta == 0:
        raise RuntimeError("Encoder parameters did not change")
    dump_json(output / "training_history.json", history)
    dump_json(output / "training_summary.json", {
        "device": str(device), "model": model_id, "model_commit": getattr(model.config, "_commit_hash", None),
        "torch_version": torch.__version__, "encoder_parameter": encoder_name,
        "encoder_max_abs_change": delta, "optimizer_steps": step,
        "trainable_parameters": sum(p.numel() for p in model.parameters() if p.requires_grad),
        "total_parameters": sum(p.numel() for p in model.parameters()),
        "train_encoder_last_n_layers": last_layers,
        "elapsed_seconds": time.perf_counter() - started,
        "peak_cuda_bytes": torch.cuda.max_memory_allocated() if device.type == "cuda" else None,
        "evaluation": "silver dev only; not final gold metrics", "checkpoint_selection": "dev silver span F1"})
    # Check the exact saved BEST checkpoint independently of the last epoch.
    restored = AutoModelForTokenClassification.from_pretrained(output / "checkpoint", use_safetensors=True).to(device)
    restored.eval()
    sample = {k: v.to(device) for k, v in collate(dev[:1], tokenizer).items() if k != "labels"}
    with torch.no_grad():
        a = restored(**sample).logits.cpu()
        b = AutoModelForTokenClassification.from_pretrained(output / "checkpoint", use_safetensors=True).to(device).eval()(**sample).logits.cpu()
    if not torch.allclose(a, b, atol=1e-6):
        raise AssertionError("Checkpoint reload mismatch")
    dump_json(output / "reload_verification.json", {"same_logits": True, "finite": bool(torch.isfinite(a).all())})
    return output


def main():
    import yaml
    p = argparse.ArgumentParser()
    p.add_argument("--config", type=Path, required=True)
    a = p.parse_args()
    train(yaml.safe_load(a.config.read_text()))


if __name__ == "__main__":
    main()
