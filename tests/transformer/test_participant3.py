import json
import pickle
from pathlib import Path

import pytest

from catalog_ai.participant3.pickle_stream import iter_offers, UnsafePickleError
from catalog_ai.participant3.prepare import find_spans, split_for, group_id
from catalog_ai.participant3.bio import token_labels, decode_spans
from catalog_ai.confidence.policy import ConfidencePolicy, fit_calibrator, choose_threshold
from catalog_ai.resolution import resolve_and_score
from catalog_ai.extractors.transformer import TransformerExtractor


def test_safe_stream_reads_pickle_and_preserves_shared_keys(tmp_path):
    offers = [{"@id": str(i), "name": f"Phone {i}", "vendor": "Acme", "param": []} for i in range(8)]
    path = tmp_path / "catalog.pkl"
    path.write_bytes(pickle.dumps({"yml_catalog": {"shop": {"offers": {"offer": offers}}}}, protocol=4))
    assert list(iter_offers(path, limit=3)) == offers[:3]


def test_executable_pickle_is_rejected(tmp_path):
    class Executable:
        def __reduce__(self):
            return eval, ("1+1",)
    path = tmp_path / "bad.pkl"
    path.write_bytes(pickle.dumps(Executable()))
    with pytest.raises(UnsafePickleError, match="opcode"):
        list(iter_offers(path, limit=1))


def test_missing_unit_is_not_memory_label():
    assert find_spans("Телефон S8", "ram_gb", ["8"]) == []
    assert find_spans("ОЗУ 8 ГБ", "ram_gb", ["8"])[0]["quote"] == "8 ГБ"


def test_grouped_variants_share_split():
    a = {"vendor": "Acme", "model": "Nova 128 GB красный"}
    b = {"vendor": "Acme", "model": "Nova 256 GB синий"}
    ga = group_id(a, {"color": ["красный"]})
    gb = group_id(b, {"color": ["синий"]})
    assert ga == gb
    assert split_for(ga, 42) == split_for(gb, 42)


def test_prompt_and_padding_not_trained_as_outside():
    offsets = [(0, 1), (0, 0), (0, 3), (4, 8), (0, 0)]
    seq = [0, None, 1, 1, None]
    labels = token_labels(offsets, seq, [{"start": 4, "end": 8}])
    assert labels == [-100, -100, 0, 1, -100]


def test_partial_token_masked():
    assert token_labels([(0, 5)], [1], [{"start": 1, "end": 4}]) == [-100]


def test_decode_offsets_unicode_and_ignore_query():
    text = "цвет синий"
    spans = decode_spans(text, [(0, 4), (0, 4), (5, 7), (7, 10)], [0, 1, 1, 1],
                         [1, 0, 1, 2], [0.99, 0.5, 0.8, 0.7])
    assert spans == [{"start": 5, "end": 10, "quote": "синий", "raw_score": 0.7}]


def candidate(value="синий", score=0.99):
    return {"attribute_id": "color", "raw_value": "синий", "value": value,
            "unit": None, "normalization_id": "test_alias", "source": "transformer", "raw_score": score,
            "evidence": [{"field": "title", "start": 0, "end": 5, "quote": "синий"}]}


def test_confidence_default_requires_review():
    out = resolve_and_score({"title": "синий"}, {"attributes": ["color", "brand"]}, [candidate()])
    assert out[0]["status"] == "review" and out[0]["confidence_kind"] == "heuristic"
    assert out[1]["status"] == "missing" and out[1]["confidence"] is None


def test_conflicts_have_no_selected_value():
    out = resolve_and_score({"title": "синий"}, {"attributes": ["color"]}, [candidate(), candidate("blue")])
    assert out[0]["status"] == "review" and out[0]["value"] is None
    assert len(out[0]["alternatives"]) == 2


def test_invalid_evidence_is_rejected_even_high_confidence():
    out = resolve_and_score({"title": "белый"}, {"attributes": ["color"]}, [candidate()],
                            policy=ConfidencePolicy(auto_accept=True))
    assert out[0]["status"] == "missing"


def test_raw_candidate_does_not_bypass_normalization():
    c = candidate()
    del c["normalization_id"]
    assert resolve_and_score({"title": "синий"}, {"attributes": ["color"]}, [c])[0]["status"] == "missing"


def test_silver_cannot_be_called_calibrated():
    examples = [{"method": "transformer", "raw_score": 0.8, "correct": i % 2,
                 "verification": "silver", "split": "calibration"} for i in range(40)]
    with pytest.raises(ValueError, match="human"):
        fit_calibrator(examples, "transformer")


def test_backend_failure_is_not_missing(monkeypatch):
    extractor = object.__new__(TransformerExtractor)
    def broken(*args, **kwargs):
        raise RuntimeError("backend unavailable")
    monkeypatch.setattr(extractor, "_extract", broken)
    result = extractor.extract({"title": "test"})
    assert result["status"] == "error" and "backend unavailable" in result["error"]
    assert result["candidates"] == []


def test_nonfinite_canonical_value_is_rejected():
    c = candidate(float("nan"))
    assert resolve_and_score({"title": "синий"}, {"attributes": ["color"]}, [c])[0]["status"] == "missing"


def test_tiny_support_cannot_claim_95_percent_precision():
    observations = [{"confidence": 0.99, "correct": 1, "verification": "human", "split": "tuning"} for _ in range(2)]
    assert choose_threshold(observations)["threshold"] is None


def test_threshold_uses_independent_tuning_not_test():
    with pytest.raises(ValueError, match="tuning"):
        choose_threshold([{"confidence": 0.99, "correct": 1, "verification": "human", "split": "test"}])


def test_supported_threshold_maximizes_coverage():
    # Synthetic unit-test observations, not measurements on the organizer data.
    observations = [{"confidence": 0.99, "correct": 1, "verification": "human", "split": "tuning"} for _ in range(80)]
    observations += [{"confidence": 0.2, "correct": 0, "verification": "human", "split": "tuning"} for _ in range(20)]
    result = choose_threshold(observations)
    assert result["threshold"] == 0.99 and result["coverage"] == 0.8
    assert result["precision_wilson_lower"] >= 0.95


def test_agreeing_sources_keep_evidence_without_score_inflation():
    second = candidate(score=0.8)
    second["source"] = "rule"
    second["evidence"][0]["field"] = "description"
    result = resolve_and_score({"title": "синий", "description": "синий"}, {"attributes": ["color"]},
                               [candidate(), second])[0]
    assert result["confidence"] == 0.99 and result["source"] == "hybrid"
    assert len(result["evidence"]) == 2
