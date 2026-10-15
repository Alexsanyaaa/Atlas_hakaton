from __future__ import annotations

import math
from pathlib import Path
from dataclasses import dataclass, field


@dataclass
class ConfidencePolicy:
    thresholds: dict = field(default_factory=dict)
    calibrators: dict = field(default_factory=dict)
    auto_accept: bool = False
    version: str = "participant3-heuristic-v1"

    @classmethod
    def from_file(cls, path):
        import yaml
        data = yaml.safe_load(Path(path).read_text())
        return cls(**{k: data[k] for k in ["thresholds", "calibrators", "auto_accept", "version"] if k in data})

    def score(self, candidate: dict, method: str):
        raw = candidate.get("raw_score")
        if raw is None:
            return None, "none"
        raw = float(raw)
        if not math.isfinite(raw) or not 0 <= raw <= 1:
            raise ValueError("raw_score must be finite and in [0, 1]")
        key = f"{method}/{candidate['attribute_id']}"
        calibrator = self.calibrators.get(key) or self.calibrators.get(method)
        if calibrator:
            z = calibrator["coef"] * raw + calibrator["intercept"]
            score = 1 / (1 + math.exp(-max(-40.0, min(40.0, z))))
            return score, "calibrated"
        return raw, "heuristic"

    def threshold(self, method: str, attribute: str) -> float:
        return float(self.thresholds.get(f"{method}/{attribute}", 0.95))


def fit_calibrator(examples: list[dict], method: str, minimum=40) -> dict:
    """Platt fit on explicitly human-verified CALIBRATION data only.

    Threshold tuning and reliability evaluation must use separate observations.
    Silver labels from the organizer adapter are deliberately not accepted.
    """
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    selected = [x for x in examples if x["method"] == method]
    if len(selected) < minimum:
        raise ValueError(f"At least {minimum} verified calibration observations required")
    if any(x.get("verification") != "human" or x.get("split") != "calibration" for x in selected):
        raise ValueError("Only human-verified calibration observations are allowed; no silver/test")
    x = np.asarray([r["raw_score"] for r in selected], dtype=float).reshape(-1, 1)
    y = np.asarray([r["correct"] for r in selected], dtype=int)
    if not np.isfinite(x).all() or (x < 0).any() or (x > 1).any() or set(y) != {0, 1}:
        raise ValueError("Need finite scores in [0,1] and both correct/incorrect examples")
    model = LogisticRegression(random_state=42).fit(x, y)
    return {"coef": float(model.coef_[0, 0]), "intercept": float(model.intercept_[0]),
            "support": len(selected), "verification": "human", "method": method}


def choose_threshold(observations, target_precision=0.95, minimum_support=40):
    """Maximize observed coverage under a Wilson lower-bound precision criterion.

    These are estimates on tuning observations, NOT an independent guarantee.
    Input confidence can be calibrated or explicitly heuristic; never test data.
    """
    if not 0 < target_precision <= 1:
        raise ValueError("target_precision must be in (0,1]")
    if any(r.get("verification") != "human" or r.get("split") != "tuning" for r in observations):
        raise ValueError("Thresholds require human-verified tuning data, not calibration/test/silver")
    if any(not math.isfinite(r["confidence"]) or not 0 <= r["confidence"] <= 1
           or r["correct"] not in (0, 1) for r in observations):
        raise ValueError("Invalid confidence/correctness observation")
    best = {"threshold": None, "reason": "no_supported_threshold", "support": 0,
            "coverage": 0.0, "target_precision": target_precision}
    z = 1.96
    for threshold in sorted({r["confidence"] for r in observations}):
        selected = [r for r in observations if r["confidence"] >= threshold]
        n = len(selected)
        if n < minimum_support:
            continue
        precision = sum(r["correct"] for r in selected) / n
        lower = (precision + z*z/(2*n) - z*math.sqrt(precision*(1-precision)/n + z*z/(4*n*n))) / (1+z*z/n)
        if lower >= target_precision and n > best["support"]:
            best = {"threshold": threshold, "reason": "tuning_wilson_lower_bound",
                    "support": n, "coverage": n / len(observations),
                    "precision": precision, "precision_wilson_lower": lower,
                    "target_precision": target_precision}
    return best
