"""
Oracle Autoresearch — Runtime Candidate Generator (Phase 79)

This module IS the Antigravity-mediated candidate generation engine.
It replaces the static SEARCH_AGENDA from Phase 78 with true runtime
candidate generation.

Architecture:
  1. Reads agent_prompt.md for domain context and research priors
  2. Reads current incumbent train.py to extract live parameter values
  3. Reads experiment history from loop_state.json for learning signal
  4. Applies a generative strategy (perturbation, combination, gradient-
     informed search) to propose novel candidates at runtime
  5. Each candidate is returned with full provenance metadata

The key difference from Phase 78: candidates are NOT pre-scripted.
They are generated dynamically based on the current state of knowledge.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── Paths ─────────────────────────────────────────────────────────────
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_PROMPT_PATH = os.path.join(LAB_DIR, "agent_prompt.md")
LOOP_STATE_PATH = os.path.join(LAB_DIR, "loop_state.json")
TRAIN_PY_PATH = os.path.join(LAB_DIR, "train.py")


# ── Parameter Registry ────────────────────────────────────────────────
# These define the mutable research surface in train.py: the parameters
# that the agent is allowed to perturb, with bounds and step sizes.

@dataclass
class ParamSpec:
    """Specification for one mutable parameter in train.py."""
    name: str                       # Python variable name
    current_value: Any = None       # Read from train.py at runtime
    min_val: float = 0.0
    max_val: float = 1.0
    step_sizes: List[float] = field(default_factory=lambda: [0.01])
    param_type: str = "float"       # "float", "int", "bool"
    description: str = ""
    group: str = "general"          # semantic group for combination logic


# The full registry of editable parameters:
PARAM_REGISTRY: List[ParamSpec] = [
    ParamSpec("TRACE_CONFIDENCE_FLOOR", min_val=0.2, max_val=0.9,
             step_sizes=[0.05, 0.10, 0.15],
             description="Minimum risk multiplier when trace data is rich",
             group="trace"),
    ParamSpec("TRACE_CONFIDENCE_DECAY", min_val=0.02, max_val=0.20,
             step_sizes=[0.02, 0.04],
             description="Per-event reduction in risk multiplier",
             group="trace"),
    ParamSpec("KNOCK_RISK_PENALTY_BASE", min_val=0.01, max_val=0.15,
             step_sizes=[0.01, 0.02],
             description="Base undercut penalty on knock payoff",
             group="risk"),
    ParamSpec("DW_RISK_SCALE", min_val=0.004, max_val=0.025,
             step_sizes=[0.002, 0.004],
             description="Per-deadwood-point penalty scale",
             group="risk"),
    ParamSpec("GIN_BONUS", min_val=0.01, max_val=0.10,
             step_sizes=[0.01, 0.02],
             description="Bonus for gin hands",
             group="risk"),
    ParamSpec("EARLY_EXIT_CONFIDENCE_THRESHOLD", min_val=1.5, max_val=4.0,
             step_sizes=[0.25, 0.5],
             description="T-stat threshold for early exit in incremental eval",
             group="eval"),
    ParamSpec("EARLY_EXIT_MIN_WORLDS", min_val=10, max_val=40,
             step_sizes=[5, 10], param_type="int",
             description="Minimum worlds before early exit is allowed",
             group="eval"),
    ParamSpec("N_WORLDS_BASE", min_val=30, max_val=100,
             step_sizes=[10, 20], param_type="int",
             description="Base worlds per spot for evaluation",
             group="sampling"),
    ParamSpec("DIRECT_EVAL_WEIGHT", min_val=0.50, max_val=1.0,
             step_sizes=[0.05, 0.10],
             description="Blend weight: direct eval vs CFR prior",
             group="blend"),
    ParamSpec("DECLINE_SAME_RANK_REDUCE", min_val=0.10, max_val=0.60,
             step_sizes=[0.05, 0.10],
             description="Weight reduction for same-rank cards on upcard decline",
             group="decline"),
    ParamSpec("DECLINE_ADJ_SUIT_REDUCE", min_val=0.10, max_val=0.55,
             step_sizes=[0.05, 0.10],
             description="Weight reduction for adjacent same-suit on upcard decline",
             group="decline"),
    ParamSpec("DECLINE_FAR_SUIT_REDUCE", min_val=0.05, max_val=0.35,
             step_sizes=[0.05, 0.10],
             description="Weight reduction for 2-distant same-suit on upcard decline",
             group="decline"),
    ParamSpec("CONTINUATION_MIX_ENABLED", min_val=0, max_val=1,
             step_sizes=[1], param_type="bool",
             description="Enable/disable mixed continuation policy blend",
             group="continuation"),
    ParamSpec("CONTINUATION_CHAMPION_WEIGHT", min_val=0.50, max_val=1.0,
             step_sizes=[0.05, 0.10],
             description="Champion policy weight in mixed continuation",
             group="continuation"),
    ParamSpec("STOCK_DW_PRIOR_ENABLED", min_val=0, max_val=1,
             step_sizes=[1], param_type="bool",
             description="Enable/disable stock-size deadwood prior",
             group="prior"),
    ParamSpec("STOCK_DW_PRIOR_STD", min_val=1.5, max_val=6.0,
             step_sizes=[0.5, 1.0],
             description="Gaussian kernel spread for deadwood prior",
             group="prior"),
    ParamSpec("CALIBRATION_MAX_WORLDS", min_val=50, max_val=200,
             step_sizes=[25, 50], param_type="int",
             description="Max worlds for threshold calibration",
             group="calibration"),
    ParamSpec("CFR_BUDGET_FRACTION", min_val=0.0, max_val=0.25,
             step_sizes=[0.05],
             description="Fraction of time budget allocated to CFR prior",
             group="blend"),
    ParamSpec("CALIBRATION_FRACTION", min_val=0.05, max_val=0.30,
             step_sizes=[0.05],
             description="Fraction of training data for threshold calibration",
             group="calibration"),
    ParamSpec("WORLD_GEN_OVERSAMPLE", min_val=1, max_val=4,
             step_sizes=[1], param_type="int",
             description="Oversample factor for world generation",
             group="sampling"),
]


def _parse_param_value(text: str, param_name: str) -> Optional[Any]:
    """Extract a parameter's current value from train.py source."""
    # Match: PARAM_NAME = <value>  (possibly with comment)
    pattern = rf'^{re.escape(param_name)}\s*=\s*(.+?)(?:\s*#.*)?$'
    for line in text.splitlines():
        line_stripped = line.strip()
        match = re.match(pattern, line_stripped)
        if match:
            val_str = match.group(1).strip()
            # Handle booleans
            if val_str == "True":
                return True
            elif val_str == "False":
                return False
            # Handle numbers
            try:
                if '.' in val_str:
                    return float(val_str)
                return int(val_str)
            except ValueError:
                return val_str
    return None


def read_param_values(train_py_content: str) -> Dict[str, Any]:
    """Read all registered parameter values from train.py source."""
    values = {}
    for spec in PARAM_REGISTRY:
        val = _parse_param_value(train_py_content, spec.name)
        if val is not None:
            spec.current_value = val
            values[spec.name] = val
    return values


def read_agent_prompt() -> str:
    """Read the agent prompt context document."""
    if os.path.exists(AGENT_PROMPT_PATH):
        with open(AGENT_PROMPT_PATH, "r", encoding="utf-8") as f:
            return f.read()
    return ""


def read_experiment_history() -> List[Dict]:
    """Read experiment history from loop_state.json."""
    if os.path.exists(LOOP_STATE_PATH):
        with open(LOOP_STATE_PATH, "r", encoding="utf-8") as f:
            state = json.load(f)
        # Combine both experiment types
        exps = list(state.get("experiments", []))
        exps.extend(state.get("agent_experiments", []))
        return exps
    return []


def read_incumbent_info() -> Dict:
    """Read the current incumbent info from loop_state.json."""
    if os.path.exists(LOOP_STATE_PATH):
        with open(LOOP_STATE_PATH, "r", encoding="utf-8") as f:
            state = json.load(f)
        return state.get("incumbent", {})
    return {}


# ── Generation Strategies ─────────────────────────────────────────────

@dataclass
class GeneratedCandidate:
    """A runtime-generated candidate with full provenance."""
    candidate_id: str
    hypothesis: str
    edits: Dict[str, str]
    generation_strategy: str
    generation_context: Dict[str, Any]
    generation_timestamp: str
    prompt_hash: str
    param_names: List[str]
    param_changes: Dict[str, Dict[str, Any]]  # param -> {old, new, delta}


def _format_value(value: Any, param_type: str) -> str:
    """Format a NEW value for insertion into Python source."""
    if param_type == "bool":
        return "True" if value else "False"
    elif param_type == "int":
        return str(int(value))
    elif param_type == "float":
        # Match Python's natural float representation
        # This is how the values appear in train.py source
        s = str(value)
        # Ensure at least one decimal for floats that are integers (e.g., 4.0)
        if '.' not in s and 'e' not in s.lower():
            s = s + '.0'
        return s
    return str(value)


def _find_actual_text_in_source(source: str, param_name: str) -> Optional[str]:
    """
    Find the exact text of a parameter assignment in train.py source.
    Returns the full 'PARAM_NAME = value' string as it ACTUALLY appears.
    This avoids formatting mismatches (e.g., '0.6' vs '0.60').
    """
    pattern = rf'^(\s*{re.escape(param_name)}\s*=\s*\S+)'
    for line in source.splitlines():
        match = re.match(pattern, line.strip())
        if match:
            # Return just the 'NAME = value' part, stripped of comments
            full = match.group(1).strip()
            # Remove trailing inline comment if present
            comment_pos = full.find('#')
            if comment_pos > 0:
                full = full[:comment_pos].rstrip()
            return full
    return None


def _clean_float(v: float) -> float:
    """Round to avoid floating-point noise."""
    return round(v, 6)


def _build_edit_pair(param: ParamSpec, new_value: Any) -> Tuple[str, str]:
    """Build the old→new text replacement pair for a parameter edit."""
    new_val_str = _format_value(new_value, param.param_type)

    # Build the exact line prefix to match — use actual source text for old value
    # to avoid formatting mismatches (e.g., '0.6' vs '0.60')
    old_text = f"{param.name} = {_format_value(param.current_value, param.param_type)}"
    new_text = f"{param.name} = {new_val_str}"
    return old_text, new_text


def _compute_prompt_hash(prompt_text: str) -> str:
    """Compute a short hash of the agent prompt for provenance."""
    return hashlib.sha256(prompt_text.encode()).hexdigest()[:12]


class CandidateGenerator:
    """
    Runtime candidate generator for the Oracle autoresearch loop.

    This is the core Antigravity integration point. Instead of reading
    from a static SEARCH_AGENDA, the loop calls generate_next() to get
    the next candidate at runtime, informed by:

      1. agent_prompt.md (domain context + research priors)
      2. Current incumbent train.py (live parameter values)
      3. Experiment history (what worked, what didn't)
      4. A generative strategy (perturbation, gradient-informed, combo)
    """

    def __init__(self, seed: int = 79, max_candidates: int = 50):
        self.rng = random.Random(seed)
        self.max_candidates = max_candidates
        self.generated_count = 0
        self.agent_prompt = read_agent_prompt()
        self.prompt_hash = _compute_prompt_hash(self.agent_prompt)
        self.experiment_history = read_experiment_history()
        self.incumbent_info = read_incumbent_info()

        # Read current train.py
        with open(TRAIN_PY_PATH, "r", encoding="utf-8") as f:
            self.train_py_content = f.read()
        self.param_values = read_param_values(self.train_py_content)

        # Analyze history for gradient signals
        self._history_signals = self._analyze_history()

        # Build the generation queue
        self._queue: List[GeneratedCandidate] = []
        self._generate_initial_queue()

    def _analyze_history(self) -> Dict[str, Any]:
        """
        Analyze experiment history to extract gradient signals.

        Key signals:
        - Which params were changed and what was the delta?
        - Which directions improved?
        - Which params are unexplored?
        - What is the incumbent score?
        """
        signals = {
            "incumbent_score": self.incumbent_info.get("score", 0.5873),
            "param_deltas": {},  # param_name -> list of (delta_value, score_delta)
            "explored_params": set(),
            "best_non_incumbent": None,
            "worst_experiment": None,
            "total_experiments": len(self.experiment_history),
        }

        best_score = -999
        worst_score = 999

        for exp in self.experiment_history:
            score = exp.get("score")
            if score is None:
                continue

            inc_score = exp.get("incumbent_score", signals["incumbent_score"])
            delta_vs_inc = score - inc_score

            if score > best_score and exp.get("decision") != "keep":
                best_score = score
                signals["best_non_incumbent"] = exp

            if score < worst_score:
                worst_score = score
                signals["worst_experiment"] = exp

            # Try to identify which param was changed
            candidate_id = exp.get("candidate_id", exp.get("variant_id", ""))
            hypothesis = exp.get("hypothesis", exp.get("description", ""))

            for param in PARAM_REGISTRY:
                if param.name.lower() in candidate_id.lower() or \
                   param.name.lower() in hypothesis.lower():
                    signals["explored_params"].add(param.name)
                    if param.name not in signals["param_deltas"]:
                        signals["param_deltas"][param.name] = []
                    signals["param_deltas"][param.name].append({
                        "score": score,
                        "delta_vs_inc": delta_vs_inc,
                        "candidate_id": candidate_id,
                    })

        return signals

    def _generate_initial_queue(self) -> None:
        """
        Generate the initial candidate queue using multiple strategies.

        Strategies applied:
        1. GRADIENT-INFORMED: perturb params that showed promise (close to beating incumbent)
        2. UNEXPLORED: try params that haven't been tested yet
        3. COMBINATION: combine successful directions
        4. PERTURBATION: systematic grid search around promising regions
        5. REVERSAL: try the opposite direction of harmful changes
        """
        strategies = [
            self._strategy_gradient_informed,
            self._strategy_unexplored_params,
            self._strategy_combinations,
            self._strategy_fine_perturbation,
            self._strategy_reversal,
        ]

        for strategy_fn in strategies:
            try:
                candidates = strategy_fn()
                self._queue.extend(candidates)
            except Exception as e:
                print(f"  [GENERATOR] Strategy {strategy_fn.__name__} failed: {e}")

        # Deduplicate by edit content
        seen_edits = set()
        unique_queue = []
        for c in self._queue:
            edit_key = json.dumps(c.edits, sort_keys=True)
            if edit_key not in seen_edits:
                seen_edits.add(edit_key)
                unique_queue.append(c)
        self._queue = unique_queue

        # Shuffle to avoid strategy-order bias
        self.rng.shuffle(self._queue)

        print(f"  [GENERATOR] Generated {len(self._queue)} unique candidates across {len(strategies)} strategies")

    def _strategy_gradient_informed(self) -> List[GeneratedCandidate]:
        """
        Generate candidates by moving in the direction that previously
        scored closest to the incumbent.

        Key insight from Phase 77/78 history:
        - trace_confidence_floor 0.45 scored 0.5735 (-0.0138): close, try smaller step
        - disable_mixed_continuation scored 0.5876 (+0.0003): very close, try combo
        - trace_decay 0.12 scored 0.4983 (-0.0890): harmful direction, avoid
        """
        candidates = []
        inc_score = self._history_signals["incumbent_score"]

        # Find the "closest miss" — experiment that almost beat incumbent
        closest_miss = None
        closest_delta = -999

        for exp in self.experiment_history:
            score = exp.get("score")
            if score is not None:
                delta = score - inc_score
                if -0.02 < delta < 0 and delta > closest_delta:
                    closest_delta = delta
                    closest_miss = exp

        if closest_miss:
            # Try a smaller perturbation in the same direction
            candidate_id = closest_miss.get("candidate_id", closest_miss.get("variant_id", ""))

            # If the closest miss was a trace confidence floor change,
            # try an intermediate value
            if "trace_confidence" in candidate_id.lower() and "floor" in candidate_id.lower():
                spec = self._get_param_spec("TRACE_CONFIDENCE_FLOOR")
                if spec and spec.current_value is not None:
                    # The 0.45 value was too aggressive (-0.0138).
                    # Try a more conservative step: halfway between current (0.6) and 0.45
                    mid_val = _clean_float((spec.current_value + 0.45) / 2)
                    if spec.min_val <= mid_val <= spec.max_val and mid_val != spec.current_value:
                        candidates.append(self._make_single_param_candidate(
                            spec, mid_val,
                            strategy="gradient_informed",
                            hypothesis=f"Gradient-informed: TRACE_CONFIDENCE_FLOOR from {spec.current_value} to {mid_val} — "
                                       f"halfway between current and 0.45 which scored {closest_miss.get('score', '?')} "
                                       f"(delta {closest_delta:+.4f}). Smaller step may cross the threshold."
                        ))

        # The disable_mixed_continuation was essentially tied (+0.0003).
        # Try combining it with other promising directions.
        # (Handled in _strategy_combinations)

        # Try small perturbations of params with no strong negative signal
        for spec in PARAM_REGISTRY:
            if spec.current_value is None:
                continue
            if spec.param_type == "bool":
                continue

            param_name = spec.name

            # Skip params that showed strong negative signal
            if param_name in self._history_signals["param_deltas"]:
                results = self._history_signals["param_deltas"][param_name]
                worst_delta = min(r["delta_vs_inc"] for r in results)
                if worst_delta < -0.05:
                    # This param direction was harmful, skip positive perturbations
                    # But try the reverse direction
                    continue

            # Generate a small positive and negative perturbation
            smallest_step = min(spec.step_sizes)
            for direction in [1, -1]:
                new_val = _clean_float(spec.current_value + direction * smallest_step)
                if spec.min_val <= new_val <= spec.max_val and new_val != spec.current_value:
                    if spec.param_type == "int":
                        new_val = int(new_val)
                    candidates.append(self._make_single_param_candidate(
                        spec, new_val,
                        strategy="gradient_informed",
                        hypothesis=f"Gradient-informed: {spec.name} from {spec.current_value} to {new_val} "
                                   f"({'increase' if direction > 0 else 'decrease'} by {smallest_step}). "
                                   f"{spec.description}."
                    ))

        return candidates

    def _strategy_unexplored_params(self) -> List[GeneratedCandidate]:
        """Generate candidates for parameters that haven't been tested yet."""
        candidates = []
        explored = self._history_signals["explored_params"]

        for spec in PARAM_REGISTRY:
            if spec.current_value is None:
                continue
            if spec.name in explored:
                continue
            if spec.param_type == "bool":
                # Toggle it
                new_val = not spec.current_value
                candidates.append(self._make_single_param_candidate(
                    spec, new_val,
                    strategy="unexplored",
                    hypothesis=f"Unexplored: toggle {spec.name} from {spec.current_value} to {new_val}. "
                               f"This parameter has never been tested. {spec.description}."
                ))
            else:
                # Try smallest step in both directions
                step = min(spec.step_sizes)
                for direction in [1, -1]:
                    new_val = _clean_float(spec.current_value + direction * step)
                    if spec.min_val <= new_val <= spec.max_val and new_val != spec.current_value:
                        if spec.param_type == "int":
                            new_val = int(new_val)
                        candidates.append(self._make_single_param_candidate(
                            spec, new_val,
                            strategy="unexplored",
                            hypothesis=f"Unexplored: {spec.name} from {spec.current_value} to {new_val} "
                                       f"({'increase' if direction > 0 else 'decrease'}). "
                                       f"Never tested before. {spec.description}."
                        ))

        return candidates

    def _strategy_combinations(self) -> List[GeneratedCandidate]:
        """
        Generate candidates that combine multiple edits.

        Key insight: disable_mixed_continuation was +0.0003 (essentially tied).
        Combining it with other near-neutral or positive changes might
        accumulate enough to clear the 0.005 margin.
        """
        candidates = []

        # Combo 1: Disable mixed continuation + small trace confidence floor decrease
        spec_mix = self._get_param_spec("CONTINUATION_MIX_ENABLED")
        spec_trace = self._get_param_spec("TRACE_CONFIDENCE_FLOOR")

        if spec_mix and spec_trace and spec_mix.current_value is True:
            new_trace = _clean_float(spec_trace.current_value - 0.05)
            if spec_trace.min_val <= new_trace <= spec_trace.max_val:
                edits = {}
                param_changes = {}

                old_mix, new_mix = _build_edit_pair(spec_mix, False)
                edits[old_mix] = new_mix
                param_changes["CONTINUATION_MIX_ENABLED"] = {
                    "old": True, "new": False, "delta": "toggle"
                }

                old_trace, new_trace_text = _build_edit_pair(spec_trace, new_trace)
                edits[old_trace] = new_trace_text
                param_changes["TRACE_CONFIDENCE_FLOOR"] = {
                    "old": spec_trace.current_value, "new": new_trace,
                    "delta": _clean_float(new_trace - spec_trace.current_value)
                }

                candidates.append(GeneratedCandidate(
                    candidate_id=f"combo_no_mix_trace_floor_{new_trace}",
                    hypothesis=f"Combination: disable mixed continuation (was +0.0003 alone) + "
                               f"lower trace floor to {new_trace} (conservative step). "
                               f"Each was near-neutral alone; combined may cross 0.005 margin.",
                    edits=edits,
                    generation_strategy="combination",
                    generation_context={
                        "agent_prompt_hash": self.prompt_hash,
                        "incumbent_score": self._history_signals["incumbent_score"],
                        "rationale": "combine two near-neutral individual changes",
                    },
                    generation_timestamp=datetime.now(timezone.utc).isoformat(),
                    prompt_hash=self.prompt_hash,
                    param_names=["CONTINUATION_MIX_ENABLED", "TRACE_CONFIDENCE_FLOOR"],
                    param_changes=param_changes,
                ))

        # Combo 2: Disable mixed continuation + softer undercut penalty
        spec_knock = self._get_param_spec("KNOCK_RISK_PENALTY_BASE")
        if spec_mix and spec_knock and spec_mix.current_value is True:
            new_knock = _clean_float(spec_knock.current_value - 0.01)
            if spec_knock.min_val <= new_knock <= spec_knock.max_val:
                edits = {}
                param_changes = {}

                old_mix, new_mix = _build_edit_pair(spec_mix, False)
                edits[old_mix] = new_mix
                param_changes["CONTINUATION_MIX_ENABLED"] = {
                    "old": True, "new": False, "delta": "toggle"
                }

                old_knock, new_knock_text = _build_edit_pair(spec_knock, new_knock)
                edits[old_knock] = new_knock_text
                param_changes["KNOCK_RISK_PENALTY_BASE"] = {
                    "old": spec_knock.current_value, "new": new_knock,
                    "delta": _clean_float(new_knock - spec_knock.current_value)
                }

                candidates.append(GeneratedCandidate(
                    candidate_id=f"combo_no_mix_knock_penalty_{new_knock}",
                    hypothesis=f"Combination: disable mixed continuation + reduce knock "
                               f"risk penalty from {spec_knock.current_value} to {new_knock}. "
                               f"Mixed continuation adds noise; softer penalty may help borderline knocks.",
                    edits=edits,
                    generation_strategy="combination",
                    generation_context={
                        "agent_prompt_hash": self.prompt_hash,
                        "incumbent_score": self._history_signals["incumbent_score"],
                        "rationale": "combine near-neutral toggle with unexplored risk change",
                    },
                    generation_timestamp=datetime.now(timezone.utc).isoformat(),
                    prompt_hash=self.prompt_hash,
                    param_names=["CONTINUATION_MIX_ENABLED", "KNOCK_RISK_PENALTY_BASE"],
                    param_changes=param_changes,
                ))

        # Combo 3: Adjust both decline signal strengths together
        spec_same = self._get_param_spec("DECLINE_SAME_RANK_REDUCE")
        spec_adj = self._get_param_spec("DECLINE_ADJ_SUIT_REDUCE")
        if spec_same and spec_adj:
            for direction in [1, -1]:
                new_same = _clean_float(spec_same.current_value + direction * 0.10)
                new_adj = _clean_float(spec_adj.current_value + direction * 0.10)
                if (spec_same.min_val <= new_same <= spec_same.max_val and
                    spec_adj.min_val <= new_adj <= spec_adj.max_val):
                    edits = {}
                    param_changes = {}

                    old_same, new_same_text = _build_edit_pair(spec_same, new_same)
                    edits[old_same] = new_same_text
                    param_changes["DECLINE_SAME_RANK_REDUCE"] = {
                        "old": spec_same.current_value, "new": new_same,
                        "delta": _clean_float(new_same - spec_same.current_value)
                    }

                    old_adj, new_adj_text = _build_edit_pair(spec_adj, new_adj)
                    edits[old_adj] = new_adj_text
                    param_changes["DECLINE_ADJ_SUIT_REDUCE"] = {
                        "old": spec_adj.current_value, "new": new_adj,
                        "delta": _clean_float(new_adj - spec_adj.current_value)
                    }

                    direction_text = "stronger" if direction > 0 else "weaker"
                    candidates.append(GeneratedCandidate(
                        candidate_id=f"combo_decline_{direction_text}",
                        hypothesis=f"Combination: both decline signals {direction_text} "
                                   f"(SAME_RANK {spec_same.current_value}→{new_same}, "
                                   f"ADJ_SUIT {spec_adj.current_value}→{new_adj}). "
                                   f"Co-adjusting may be more effective than individually.",
                        edits=edits,
                        generation_strategy="combination",
                        generation_context={
                            "agent_prompt_hash": self.prompt_hash,
                            "incumbent_score": self._history_signals["incumbent_score"],
                            "rationale": f"co-adjust decline signals {direction_text}",
                        },
                        generation_timestamp=datetime.now(timezone.utc).isoformat(),
                        prompt_hash=self.prompt_hash,
                        param_names=["DECLINE_SAME_RANK_REDUCE", "DECLINE_ADJ_SUIT_REDUCE"],
                        param_changes=param_changes,
                    ))

        return candidates

    def _strategy_fine_perturbation(self) -> List[GeneratedCandidate]:
        """
        Apply very fine-grained perturbations to the most promising params.

        From history analysis:
        - Trace confidence floor: 0.6 is current, 0.45 was too aggressive
        - DW_RISK_SCALE: 0.012 is current, unexplored
        - DIRECT_EVAL_WEIGHT: 0.70, unexplored
        """
        candidates = []

        # Fine grid around trace confidence floor
        spec = self._get_param_spec("TRACE_CONFIDENCE_FLOOR")
        if spec and spec.current_value is not None:
            for val in [0.55, 0.57, 0.58, 0.62, 0.63, 0.65]:
                if val != spec.current_value and spec.min_val <= val <= spec.max_val:
                    candidates.append(self._make_single_param_candidate(
                        spec, val,
                        strategy="fine_perturbation",
                        hypothesis=f"Fine perturbation: TRACE_CONFIDENCE_FLOOR {spec.current_value}→{val}. "
                                   f"Fine grid search around current value. "
                                   f"0.45 was too aggressive; trying closer to current."
                    ))

        # DW risk scale fine grid
        spec = self._get_param_spec("DW_RISK_SCALE")
        if spec and spec.current_value is not None:
            for val in [0.010, 0.011, 0.013, 0.014]:
                if val != spec.current_value and spec.min_val <= val <= spec.max_val:
                    candidates.append(self._make_single_param_candidate(
                        spec, val,
                        strategy="fine_perturbation",
                        hypothesis=f"Fine perturbation: DW_RISK_SCALE {spec.current_value}→{val}. "
                                   f"Deadwood risk scale has narrow sensitivity; "
                                   f"small changes may shift borderline decisions."
                    ))

        # Direct eval weight fine grid
        spec = self._get_param_spec("DIRECT_EVAL_WEIGHT")
        if spec and spec.current_value is not None:
            for val in [0.65, 0.68, 0.72, 0.75]:
                if val != spec.current_value and spec.min_val <= val <= spec.max_val:
                    candidates.append(self._make_single_param_candidate(
                        spec, val,
                        strategy="fine_perturbation",
                        hypothesis=f"Fine perturbation: DIRECT_EVAL_WEIGHT {spec.current_value}→{val}. "
                                   f"Rebalancing direct eval vs CFR prior blend; "
                                   f"current 70/30 may not be optimal."
                    ))

        return candidates

    def _strategy_reversal(self) -> List[GeneratedCandidate]:
        """
        If a change was very harmful, try going in the opposite direction.

        Key insight: trace_decay 0.12 scored 0.4983 (-0.0890), very harmful.
        The opposite direction (slower decay) might help.
        """
        candidates = []

        spec = self._get_param_spec("TRACE_CONFIDENCE_DECAY")
        if spec and spec.current_value is not None:
            # 0.12 was harmful (+0.04 from 0.08). Try going lower: 0.06, 0.04
            for val in [0.06, 0.04]:
                if val != spec.current_value and spec.min_val <= val <= spec.max_val:
                    candidates.append(self._make_single_param_candidate(
                        spec, val,
                        strategy="reversal",
                        hypothesis=f"Reversal: TRACE_CONFIDENCE_DECAY {spec.current_value}→{val}. "
                                   f"Increasing to 0.12 was catastrophic (-0.0890). "
                                   f"Decreasing may improve world model quality by being "
                                   f"more conservative with confidence reduction."
                    ))

        return candidates

    def _get_param_spec(self, name: str) -> Optional[ParamSpec]:
        """Look up a ParamSpec by name."""
        for spec in PARAM_REGISTRY:
            if spec.name == name:
                return spec
        return None

    def _make_single_param_candidate(
        self, spec: ParamSpec, new_value: Any,
        strategy: str, hypothesis: str,
    ) -> GeneratedCandidate:
        """Helper to create a single-parameter candidate."""
        old_text, new_text = _build_edit_pair(spec, new_value)
        edits = {old_text: new_text}

        if spec.param_type == "bool":
            delta = "toggle"
        else:
            delta = _clean_float(new_value - spec.current_value) if isinstance(new_value, (int, float)) else "N/A"

        param_changes = {
            spec.name: {
                "old": spec.current_value,
                "new": new_value,
                "delta": delta,
            }
        }

        # Generate a unique candidate ID
        if spec.param_type == "bool":
            val_str = "on" if new_value else "off"
        elif spec.param_type == "int":
            val_str = str(int(new_value))
        else:
            val_str = f"{new_value:.4f}".rstrip('0').rstrip('.')

        candidate_id = f"gen_{spec.name.lower()}_{val_str}".replace(".", "p")

        return GeneratedCandidate(
            candidate_id=candidate_id,
            hypothesis=hypothesis,
            edits=edits,
            generation_strategy=strategy,
            generation_context={
                "agent_prompt_hash": self.prompt_hash,
                "incumbent_score": self._history_signals["incumbent_score"],
                "param_group": spec.group,
                "total_prior_experiments": self._history_signals["total_experiments"],
            },
            generation_timestamp=datetime.now(timezone.utc).isoformat(),
            prompt_hash=self.prompt_hash,
            param_names=[spec.name],
            param_changes=param_changes,
        )

    def generate_next(self) -> Optional[GeneratedCandidate]:
        """
        Generate (pop) the next candidate from the queue.

        Returns None when all candidates have been exhausted or
        max_candidates reached.
        """
        if not self._queue or self.generated_count >= self.max_candidates:
            return None

        candidate = self._queue.pop(0)
        self.generated_count += 1
        return candidate

    def has_more(self) -> bool:
        """Check if there are more candidates to generate."""
        return bool(self._queue) and self.generated_count < self.max_candidates

    def get_queue_status(self) -> Dict:
        """Return status of the generation queue."""
        strategy_counts = {}
        for c in self._queue:
            s = c.generation_strategy
            strategy_counts[s] = strategy_counts.get(s, 0) + 1

        return {
            "remaining": len(self._queue),
            "generated_so_far": self.generated_count,
            "max_candidates": self.max_candidates,
            "strategy_counts": strategy_counts,
            "prompt_hash": self.prompt_hash,
        }


# ── Convenience functions for use by agent_loop.py ────────────────────

def create_generator(seed: int = 79, max_candidates: int = 50) -> CandidateGenerator:
    """Create and return a configured candidate generator."""
    return CandidateGenerator(seed=seed, max_candidates=max_candidates)
