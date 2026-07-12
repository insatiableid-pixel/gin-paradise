"""
Oracle Autoresearch Agent-Driven Loop — Directive 108

Directive 108 hardens the multi-lane benchmark into a true Sprint 1
infrastructure layer with:
  - Frozen per-lane targets (consumed, not recomputed)
  - Pareto-aware multi-lane promotion gating
  - Separated proxy-time vs promotion-time evaluation
  - Narrowed editable surface (train.py only)

Still preserved:
  - Real file edits via string replacement
  - Real subprocess benchmarking (300s budget)
  - Real discard restoration from incumbent backup
  - Full provenance logging
  - Resumability via loop_state.json
"""

from __future__ import annotations

import argparse
import copy
import difflib
import json
import os
import random
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── Paths ─────────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
LOOP_STATE_PATH = os.path.join(LAB_DIR, "loop_state.json")
ARTIFACT_DIR = os.path.join(LAB_DIR, "artifacts")
TRAIN_PY_PATH = os.path.join(LAB_DIR, "train.py")
INCUMBENT_BACKUP_PATH = os.path.join(LAB_DIR, "train_incumbent.py")
AGENT_PROMPT_PATH = os.path.join(LAB_DIR, "agent_prompt.md")
CANDIDATE_LOG_DIR = os.path.join(ARTIFACT_DIR, "candidates")
PROVENANCE_LOG_DIR = os.path.join(ARTIFACT_DIR, "provenance")
ROOT_EXECUTION_REPORT_PATH = os.path.join(ROOT_DIR, "ORACLE_AUTORESEARCH_EXECUTION_REPORT.md")

sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, LAB_DIR)

from prepare import prepare_lab
from candidate_generator import CandidateGenerator, GeneratedCandidate, create_generator
from gemini_bridge import invoke_gemini_bridge
from antigravity_bridge import (
    BridgeResponse,
    write_bridge_request,
    read_bridge_response,
    wait_for_response,
)

CURRENT_PHASE = 108

# ── Pareto Promotion Configuration (Directive 108) ───────────────────
PROMOTION_LANE_EPSILON = 0.02    # max allowed per-lane regression
PROMOTION_AGGREGATE_MARGIN = 0.001  # min aggregate improvement


# ── State Management ──────────────────────────────────────────────────

def load_loop_state() -> Dict:
    """Load persistent loop state from disk."""
    with open(LOOP_STATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_loop_state(state: Dict) -> None:
    """Atomically save loop state to disk."""
    tmp_path = LOOP_STATE_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_path, LOOP_STATE_PATH)


# ── Incumbent Management ─────────────────────────────────────────────

def backup_incumbent() -> None:
    """Backup current train.py as the incumbent snapshot."""
    shutil.copy2(TRAIN_PY_PATH, INCUMBENT_BACKUP_PATH)
    print(f"  [BACKUP] Incumbent backed up to {INCUMBENT_BACKUP_PATH}")


def restore_incumbent() -> None:
    """Restore train.py from incumbent backup (discard candidate)."""
    if os.path.exists(INCUMBENT_BACKUP_PATH):
        shutil.copy2(INCUMBENT_BACKUP_PATH, TRAIN_PY_PATH)
        print(f"  [RESTORE] train.py restored from incumbent backup")
    else:
        print(f"  [WARNING] No incumbent backup found — train.py unchanged")


def commit_incumbent(state: Dict) -> None:
    """Copy current train.py to become the new incumbent backup."""
    shutil.copy2(TRAIN_PY_PATH, INCUMBENT_BACKUP_PATH)
    print(f"  [COMMIT] New incumbent committed")


# ── Diff Utilities ────────────────────────────────────────────────────

def compute_diff(original: str, modified: str) -> str:
    """Compute a unified diff between two file contents."""
    original_lines = original.splitlines(keepends=True)
    modified_lines = modified.splitlines(keepends=True)
    diff = difflib.unified_diff(
        original_lines, modified_lines,
        fromfile="train.py (incumbent)",
        tofile="train.py (candidate)",
        lineterm="",
    )
    return "".join(diff)


def console_safe(text: str) -> str:
    """Best-effort console-safe text for Windows shells with legacy encodings."""
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    return text.encode(encoding, errors="backslashreplace").decode(encoding, errors="replace")


def save_candidate_log(
    experiment_id: int,
    hypothesis: str,
    edit_description: str,
    diff_text: str,
    score: Optional[float],
    incumbent_score: float,
    decision: str,
    reason: str,
    elapsed_sec: float,
    error: Optional[str] = None,
    provenance: Optional[Dict] = None,
) -> str:
    """Save a durable log of each candidate experiment with provenance."""
    os.makedirs(CANDIDATE_LOG_DIR, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(CANDIDATE_LOG_DIR, f"candidate_{experiment_id:04d}_{timestamp}.json")

    log_entry = {
        "experiment_id": experiment_id,
        "timestamp": timestamp,
        "hypothesis": hypothesis,
        "edit_description": edit_description,
        "diff_lines": len(diff_text.splitlines()) if diff_text else 0,
        "diff_text": diff_text[:5000] if diff_text else "",
        "score": score,
        "incumbent_score": incumbent_score,
        "delta": round(score - incumbent_score, 4) if score is not None else None,
        "decision": decision,
        "decision_reason": reason,
        "elapsed_sec": round(elapsed_sec, 2),
        "error": error,
        "provenance": provenance,
    }

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(log_entry, f, indent=2)

    return log_path


def save_provenance_log(
    experiment_id: int,
    candidate_source: str,
    candidate_id: str,
    hypothesis: str,
    generation_strategy: str,
    prompt_hash: str,
    param_names: List[str],
    param_changes: Dict,
    diff_text: str,
    score: Optional[float],
    incumbent_score: float,
    decision: str,
    bridge_request_path: str = "",
    bridge_response_path: str = "",
    generation_context: Dict = None,
) -> str:
    """
    Save provenance log proving the candidate's origin.

    Distinguishes between:
      - "gemini_cli_headless": real Gemini CLI boundary crossing
      - "claude_opus_4.6_antigravity": legacy manual external boundary
      - "local_fallback_generator": local Python heuristic
    """
    os.makedirs(PROVENANCE_LOG_DIR, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    log_path = os.path.join(PROVENANCE_LOG_DIR, f"provenance_{experiment_id:04d}_{timestamp}.json")

    provenance_record = {
        "experiment_id": experiment_id,
        "timestamp": timestamp,
        "candidate_source": candidate_source,
        "candidate_id": candidate_id,
        "hypothesis": hypothesis,
        "generation_strategy": generation_strategy,
        "agent_prompt_hash": prompt_hash,
        "param_names": param_names,
        "param_changes": param_changes,
        "generation_context": generation_context or {},
        "diff_text": diff_text[:3000] if diff_text else "",
        "score": score,
        "incumbent_score": incumbent_score,
        "delta": round(score - incumbent_score, 4) if score is not None else None,
        "decision": decision,
        "boundary_proof": {
            "candidate_source": candidate_source,
            "is_real_external_boundary": candidate_source in {
                "claude_opus_4.6_antigravity",
                "gemini_cli_headless",
            },
            "is_local_fallback": candidate_source == "local_fallback_generator",
            "bridge_request_artifact": bridge_request_path,
            "bridge_response_artifact": bridge_response_path,
            "agent_prompt_md_in_request_payload": candidate_source in {
                "claude_opus_4.6_antigravity",
                "gemini_cli_headless",
            },
        },
    }

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(provenance_record, f, indent=2)

    return log_path


# ── Benchmark Execution ──────────────────────────────────────────────

def benchmark_train_py(
    time_budget: float = 300.0,
    tag: str = "agent_candidate",
) -> Dict:
    """
    Run the current train.py as a subprocess benchmark.
    Returns parsed result or error dict.
    """
    python_exe = os.path.join(ROOT_DIR, ".local-python", "3.14", "python.exe")
    if not os.path.exists(python_exe):
        python_exe = sys.executable

    cmd = [
        python_exe, TRAIN_PY_PATH,
        "--time-budget", str(time_budget),
        "--sweep",
        "--tag", tag,
    ]

    print(f"\n  [BENCHMARK] Running: {' '.join(cmd)}")
    start_time = time.perf_counter()

    try:
        result = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            capture_output=False,
            text=True,
            timeout=int(time_budget + 120),
        )
        elapsed = time.perf_counter() - start_time

        if result.returncode != 0:
            return {
                "success": False,
                "error": f"train.py exited with code {result.returncode}",
                "elapsed_sec": elapsed,
            }

        # Read results
        latest_path = os.path.join(ARTIFACT_DIR, "latest_run.json")
        if not os.path.exists(latest_path):
            return {
                "success": False,
                "error": "latest_run.json not produced",
                "elapsed_sec": elapsed,
            }

        with open(latest_path, "r", encoding="utf-8") as f:
            run_result = json.load(f)

        return {
            "success": True,
            "result": run_result,
            "elapsed_sec": elapsed,
        }

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": f"Benchmark timed out after {time_budget + 120}s",
            "elapsed_sec": time.perf_counter() - start_time,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_sec": time.perf_counter() - start_time,
        }


# ── Keep/Discard Logic ───────────────────────────────────────────────

def evaluate_keep_discard(
    score: float,
    incumbent_score: float,
    minimum_margin: float,
    candidate_lane_scores: Optional[Dict[str, float]] = None,
    incumbent_lane_scores: Optional[Dict[str, float]] = None,
    lane_epsilon: float = PROMOTION_LANE_EPSILON,
) -> Tuple[str, str]:
    """
    Pareto-aware promotion gate (Directive 108).

    Requires:
      1. Aggregate score beats incumbent by margin
      2. No single lane regresses by more than epsilon

    Returns (decision, reason) with detailed per-lane reporting.
    """
    delta = score - incumbent_score

    # Check per-lane regression if multi-lane data available
    lane_regression_detail = []
    any_lane_regression = False
    if candidate_lane_scores and incumbent_lane_scores:
        for lane, candidate_lane_score in candidate_lane_scores.items():
            incumbent_lane_score = incumbent_lane_scores.get(lane, 0.0)
            lane_delta = candidate_lane_score - incumbent_lane_score
            lane_regression_detail.append(
                f"{lane}: {candidate_lane_score:.4f} (delta={lane_delta:+.4f})"
            )
            if lane_delta < -lane_epsilon:
                any_lane_regression = True
                lane_regression_detail.append(
                    f"  *** {lane} REGRESSED by {lane_delta:+.4f} (> epsilon {lane_epsilon})"
                )

    lane_detail_str = "; ".join(lane_regression_detail) if lane_regression_detail else "n/a"

    if delta >= minimum_margin:
        if any_lane_regression:
            return "discard", (
                f"aggregate {score:.4f} beats incumbent {incumbent_score:.4f} "
                f"by {delta:+.4f} >= margin {minimum_margin}, "
                f"BUT blocked by per-lane Pareto gate: {lane_detail_str}"
            )
        return "keep", (
            f"aggregate {score:.4f} beats incumbent {incumbent_score:.4f} "
            f"by {delta:+.4f} (>= margin {minimum_margin}); "
            f"lanes: {lane_detail_str}; Pareto gate PASSED"
        )
    elif delta > 0:
        return "discard", (
            f"aggregate {score:.4f} above incumbent {incumbent_score:.4f} "
            f"by {delta:+.4f} but below margin {minimum_margin}; "
            f"lanes: {lane_detail_str}"
        )
    else:
        return "discard", (
            f"aggregate {score:.4f} below incumbent {incumbent_score:.4f} "
            f"by {delta:+.4f}; lanes: {lane_detail_str}"
        )


# ── Apply Candidate Edit ─────────────────────────────────────────────

def apply_candidate_edit_from_edits(
    train_py_content: str,
    edits: Dict[str, str],
) -> Tuple[str, bool, str]:
    """
    Apply edits (dict of {old_text: new_text}) to train.py content.
    Returns (modified_content, success, error_message).
    """
    modified = train_py_content
    applied_count = 0

    for old_text, new_text in edits.items():
        if old_text not in modified:
            return modified, False, f"Target text not found: '{old_text}'"
        modified = modified.replace(old_text, new_text, 1)
        applied_count += 1

    if applied_count == 0:
        return modified, False, "No edits were applied"

    return modified, True, ""


# ── Run Single Candidate (shared by bridge + fallback) ────────────────

def run_single_candidate(
    state: Dict,
    experiment_id: int,
    candidate_id: str,
    hypothesis: str,
    edits: Dict[str, str],
    param_names: List[str],
    param_changes: Dict,
    generation_strategy: str,
    prompt_hash: str,
    candidate_source: str,
    time_budget_per_run: float,
    dry_run: bool,
    bridge_request_path: str = "",
    bridge_response_path: str = "",
    generation_context: Dict = None,
) -> Tuple[str, Optional[float]]:
    """
    Execute one candidate: apply edit, benchmark, keep/discard.
    
    Returns (decision, score).
    """
    timestamp_start = datetime.now(timezone.utc).isoformat()
    if candidate_source == "claude_opus_4.6_antigravity":
        source_label = "ANTIGRAVITY"
    elif candidate_source == "gemini_cli_headless":
        source_label = "GEMINI-CLI"
    else:
        source_label = "LOCAL-FALLBACK"

    print(f"\n{'='*72}")
    print(f"EXPERIMENT #{experiment_id}: {candidate_id}")
    print(f"Source: {source_label}")
    print(f"Strategy: {generation_strategy}")
    print(f"Hypothesis: {console_safe(hypothesis)}")
    print(f"Params: {', '.join(param_names)}")
    print(f"Changes: {json.dumps(param_changes, indent=2)}")
    print(f"Prompt hash: {prompt_hash}")
    if bridge_request_path:
        print(f"Request artifact: {bridge_request_path}")
    if bridge_response_path:
        print(f"Response artifact: {bridge_response_path}")
    print(f"{'='*72}")

    # Step 1: Read current incumbent train.py
    with open(TRAIN_PY_PATH, "r", encoding="utf-8") as f:
        incumbent_content = f.read()

    # Step 2: Backup incumbent
    backup_incumbent()

    # Step 3: Apply edits
    modified_content, edit_ok, edit_error = apply_candidate_edit_from_edits(
        incumbent_content, edits
    )

    provenance_data = {
        "candidate_id": candidate_id,
        "candidate_source": candidate_source,
        "generation_strategy": generation_strategy,
        "agent_prompt_hash": prompt_hash,
        "param_names": param_names,
        "param_changes": param_changes,
        "bridge_request_path": bridge_request_path,
        "bridge_response_path": bridge_response_path,
    }

    if not edit_ok:
        print(f"  [EDIT FAILED] {edit_error}")
        log_path = save_candidate_log(
            experiment_id=experiment_id,
            hypothesis=hypothesis,
            edit_description=json.dumps(edits),
            diff_text="",
            score=None,
            incumbent_score=state["incumbent"]["score"],
            decision="discard",
            reason=f"edit failed: {edit_error}",
            elapsed_sec=0,
            error=edit_error,
            provenance=provenance_data,
        )
        save_provenance_log(
            experiment_id=experiment_id,
            candidate_source=candidate_source,
            candidate_id=candidate_id,
            hypothesis=hypothesis,
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            param_names=param_names,
            param_changes=param_changes,
            diff_text="",
            score=None,
            incumbent_score=state["incumbent"]["score"],
            decision="discard",
            bridge_request_path=bridge_request_path,
            bridge_response_path=bridge_response_path,
        )
        _record_agent_experiment(
            state, experiment_id, candidate_id, hypothesis,
            "discard", f"edit failed: {edit_error}",
            None, state["incumbent"]["score"], 0, log_path, "",
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            candidate_source=candidate_source,
        )
        return "discard", None

    # Step 4: Compute diff
    diff_text = compute_diff(incumbent_content, modified_content)
    diff_lines = len(diff_text.splitlines())
    print(f"  [EDIT] Applied {len(edits)} edit(s), diff is {diff_lines} lines")

    if dry_run:
        print(f"  [DRY RUN] Would write edited train.py and benchmark")
        print(f"  Diff preview:\n{console_safe(diff_text[:1000])}")
        save_provenance_log(
            experiment_id=experiment_id,
            candidate_source=candidate_source,
            candidate_id=candidate_id,
            hypothesis=hypothesis,
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            param_names=param_names,
            param_changes=param_changes,
            diff_text=diff_text,
            score=None,
            incumbent_score=state["incumbent"]["score"],
            decision="dry_run",
            bridge_request_path=bridge_request_path,
            bridge_response_path=bridge_response_path,
        )
        _record_agent_experiment(
            state, experiment_id, candidate_id, hypothesis,
            "dry_run", "dry run — not executed",
            None, state["incumbent"]["score"], 0, "", diff_text,
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            candidate_source=candidate_source,
        )
        return "dry_run", None

    # Step 5: Write the edited train.py
    with open(TRAIN_PY_PATH, "w", encoding="utf-8") as f:
        f.write(modified_content)
    print(f"  [WRITE] Candidate train.py written ({len(modified_content)} bytes)")

    # Step 6: Benchmark
    tag = f"p{CURRENT_PHASE}_{candidate_id}"
    run_output = benchmark_train_py(
        time_budget=time_budget_per_run,
        tag=tag,
    )

    timestamp_end = datetime.now(timezone.utc).isoformat()
    elapsed = run_output.get("elapsed_sec", 0)

    if not run_output["success"]:
        print(f"  [BENCHMARK FAILED] {run_output.get('error', 'unknown')}")
        restore_incumbent()

        log_path = save_candidate_log(
            experiment_id=experiment_id,
            hypothesis=hypothesis,
            edit_description=json.dumps(edits),
            diff_text=diff_text,
            score=None,
            incumbent_score=state["incumbent"]["score"],
            decision="discard",
            reason=f"benchmark failed: {run_output.get('error', 'unknown')}",
            elapsed_sec=elapsed,
            error=run_output.get("error"),
            provenance=provenance_data,
        )
        save_provenance_log(
            experiment_id=experiment_id,
            candidate_source=candidate_source,
            candidate_id=candidate_id,
            hypothesis=hypothesis,
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            param_names=param_names,
            param_changes=param_changes,
            diff_text=diff_text,
            score=None,
            incumbent_score=state["incumbent"]["score"],
            decision="discard",
            bridge_request_path=bridge_request_path,
            bridge_response_path=bridge_response_path,
        )
        _record_agent_experiment(
            state, experiment_id, candidate_id, hypothesis,
            "discard", f"benchmark failed: {run_output.get('error', 'unknown')}",
            None, state["incumbent"]["score"], elapsed, log_path, diff_text,
            generation_strategy=generation_strategy,
            prompt_hash=prompt_hash,
            candidate_source=candidate_source,
        )
        return "discard", None

    # Step 7: Extract score and compare
    result_data = run_output["result"]
    score = result_data["metrics"]["score"]
    incumbent_score = state["incumbent"]["score"]
    margin = state["promotion_policy"]["minimum_margin"]

    # Directive 108: Extract per-lane scores for Pareto gate
    candidate_lane_scores = {}
    incumbent_lane_scores = state["incumbent"].get("lane_scores", {})
    multi_lane_data = result_data.get("multi_lane", {})
    if multi_lane_data:
        lane_results = multi_lane_data.get("lane_results", {})
        for lane_name, lane_data in lane_results.items():
            candidate_lane_scores[lane_name] = lane_data.get("score", 0.0)
        # Use aggregate score for promotion comparison
        agg = multi_lane_data.get("aggregate", {})
        if agg.get("aggregate_score") is not None:
            score = agg["aggregate_score"]

    print(f"  [PARETO] Aggregate score: {score:.4f}")
    print(f"  [PARETO] Per-lane scores: {json.dumps(candidate_lane_scores, indent=2)}")
    if incumbent_lane_scores:
        print(f"  [PARETO] Incumbent lanes: {json.dumps(incumbent_lane_scores, indent=2)}")

    decision, reason = evaluate_keep_discard(
        score, incumbent_score, margin,
        candidate_lane_scores=candidate_lane_scores,
        incumbent_lane_scores=incumbent_lane_scores,
    )

    # Step 8: Keep or discard
    if decision == "keep":
        commit_incumbent(state)
        state["incumbent"] = {
            "score": score,
            "threshold": result_data["metrics"].get("threshold"),
            "variant_id": candidate_id,
            "artifact_path": f"oracle_autoresearch/artifacts/latest_run.json",
            "commit_sha": None,
            "promoted_at": timestamp_end,
            "description": hypothesis,
            "generation_strategy": generation_strategy,
            "prompt_hash": prompt_hash,
            "candidate_source": candidate_source,
            "lane_scores": candidate_lane_scores,
        }
        print(f"\n  *** PROMOTED *** {candidate_id} -> new incumbent (score={score:.4f})")
        print(f"  [PARETO] Per-lane: {json.dumps(candidate_lane_scores)}")
    else:
        restore_incumbent()
        print(f"\n  [DISCARD] {reason}")

    # Step 9: Log
    log_path = save_candidate_log(
        experiment_id=experiment_id,
        hypothesis=hypothesis,
        edit_description=json.dumps(edits),
        diff_text=diff_text,
        score=score,
        incumbent_score=incumbent_score,
        decision=decision,
        reason=reason,
        elapsed_sec=elapsed,
        provenance=provenance_data,
    )

    provenance_path = save_provenance_log(
        experiment_id=experiment_id,
        candidate_source=candidate_source,
        candidate_id=candidate_id,
        hypothesis=hypothesis,
        generation_strategy=generation_strategy,
        prompt_hash=prompt_hash,
        param_names=param_names,
        param_changes=param_changes,
        diff_text=diff_text,
        score=score,
        incumbent_score=incumbent_score,
        decision=decision,
        bridge_request_path=bridge_request_path,
        bridge_response_path=bridge_response_path,
    )

    _record_agent_experiment(
        state, experiment_id, candidate_id, hypothesis,
        decision, reason, score, incumbent_score, elapsed,
        log_path, diff_text,
        generation_strategy=generation_strategy,
        prompt_hash=prompt_hash,
        provenance_path=provenance_path,
        candidate_source=candidate_source,
    )

    return decision, score


# ── Main Agent Loop ──────────────────────────────────────────────────

def run_agent_loop(
    max_experiments: int = 10,
    time_budget_per_run: float = 300.0,
    dry_run: bool = False,
    generator_seed: int = 80,
    bridge_provider: str = "gemini",
    bridge_mode: str = "bridge_then_fallback",
    bridge_timeout: float = 180.0,
    gemini_model: Optional[str] = None,
    gemini_approval_mode: str = "plan",
) -> None:
    """
    Main agent-driven autoresearch loop.

    bridge_mode options:
      - "bridge_only":          Only use bridge-generated candidates
      - "bridge_then_fallback": Try bridge first, fall back to local generator
      - "fallback_only":        Only use local generator (labeled honestly)
    """
    os.chdir(ROOT_DIR)
    prepare_lab(force=False)

    state = load_loop_state()

    # Ensure directories exist
    os.makedirs(CANDIDATE_LOG_DIR, exist_ok=True)
    os.makedirs(PROVENANCE_LOG_DIR, exist_ok=True)

    # Initialize incumbent backup if not present
    if not os.path.exists(INCUMBENT_BACKUP_PATH):
        backup_incumbent()

    print(f"\n{'#'*72}")
    print(f"# ORACLE AUTORESEARCH — Phase {CURRENT_PHASE}")
    print(f"# Incumbent score: {state['incumbent']['score']:.4f}")
    print(f"# Max experiments this run: {max_experiments}")
    print(f"# Time budget per benchmark: {time_budget_per_run}s")
    print(f"# Bridge provider: {bridge_provider}")
    print(f"# Bridge mode: {bridge_mode}")
    print(f"{'#'*72}\n")

    # Check for already-completed candidate IDs
    completed_ids = set()
    for exp in state.get("agent_experiments", []):
        completed_ids.add(exp.get("candidate_id", ""))

    bridge_label = "Gemini CLI" if bridge_provider == "gemini" else "Antigravity"

    # ── Bridge candidates ────────────────────────────────────────
    experiments_run = 0
    bridge_candidates_run = 0
    fallback_candidates_run = 0

    if bridge_mode in ("bridge_only", "bridge_then_fallback"):
        if bridge_provider == "gemini":
            print("  [BRIDGE] Gemini CLI bridge enabled")
            while experiments_run < max_experiments:
                experiment_id = state.get("next_experiment_id", 12)
                request_id = f"gcli_{experiment_id:04d}"
                candidate_id = f"gemini_{request_id}"
                if candidate_id in completed_ids:
                    print(f"  [SKIP] {candidate_id} already completed")
                    state["next_experiment_id"] = experiment_id + 1
                    save_loop_state(state)
                    continue

                try:
                    response, request_path, response_path = invoke_gemini_bridge(
                        request_id=request_id,
                        model=gemini_model,
                        approval_mode=gemini_approval_mode,
                        timeout_sec=bridge_timeout,
                    )
                except Exception as e:
                    print(f"  [BRIDGE ERROR] Gemini CLI request failed: {e}")
                    break

                run_single_candidate(
                    state=state,
                    experiment_id=experiment_id,
                    candidate_id=candidate_id,
                    hypothesis=response.hypothesis,
                    edits=response.edits,
                    param_names=response.param_names,
                    param_changes=response.param_changes,
                    generation_strategy=f"gemini_{response.confidence}",
                    prompt_hash=response.agent_prompt_hash,
                    candidate_source="gemini_cli_headless",
                    time_budget_per_run=time_budget_per_run,
                    dry_run=dry_run,
                    bridge_request_path=request_path,
                    bridge_response_path=response_path,
                    generation_context={
                        "rationale": response.rationale,
                        "confidence": response.confidence,
                        "source": response.source,
                        "model": response.model,
                    },
                )

                experiments_run += 1
                bridge_candidates_run += 1
        else:
            from antigravity_bridge import OUTBOX_DIR, INBOX_DIR
            import glob

            response_files = sorted(glob.glob(os.path.join(OUTBOX_DIR, "response_*.json")))
            print(f"  [BRIDGE] Found {len(response_files)} response(s) in outbox")

            for response_file in response_files:
                if experiments_run >= max_experiments:
                    break

                try:
                    with open(response_file, "r", encoding="utf-8") as f:
                        resp_data = json.load(f)

                    response = BridgeResponse(
                        request_id=resp_data["request_id"],
                        response_id=resp_data["response_id"],
                        timestamp=resp_data["timestamp"],
                        source=resp_data["source"],
                        hypothesis=resp_data["hypothesis"],
                        edits=resp_data["edits"],
                        param_names=resp_data.get("param_names", []),
                        param_changes=resp_data.get("param_changes", {}),
                        rationale=resp_data["rationale"],
                        confidence=resp_data.get("confidence", "medium"),
                    )

                    candidate_id = f"antigravity_{response.response_id}"
                    if candidate_id in completed_ids:
                        print(f"  [SKIP] {candidate_id} already completed")
                        continue

                    request_path = os.path.join(INBOX_DIR, f"request_{response.request_id}.json")
                    response_path = response_file

                    experiment_id = state.get("next_experiment_id", 12)

                    run_single_candidate(
                        state=state,
                        experiment_id=experiment_id,
                        candidate_id=candidate_id,
                        hypothesis=response.hypothesis,
                        edits=response.edits,
                        param_names=response.param_names,
                        param_changes=response.param_changes,
                        generation_strategy=f"antigravity_{response.confidence}",
                        prompt_hash=resp_data.get("agent_prompt_hash", ""),
                        candidate_source="claude_opus_4.6_antigravity",
                        time_budget_per_run=time_budget_per_run,
                        dry_run=dry_run,
                        bridge_request_path=request_path,
                        bridge_response_path=response_path,
                        generation_context={
                            "rationale": response.rationale,
                            "confidence": response.confidence,
                            "source": response.source,
                        },
                    )

                    experiments_run += 1
                    bridge_candidates_run += 1

                except Exception as e:
                    print(f"  [BRIDGE ERROR] Failed to process {response_file}: {e}")
                    continue

    # ── Local fallback candidates ────────────────────────────────
    if bridge_mode in ("bridge_then_fallback", "fallback_only"):
        remaining = max_experiments - experiments_run
        if remaining > 0:
            print(f"\n  [FALLBACK] Initializing local candidate generator...")
            print(f"  [FALLBACK] NOTE: These candidates come from LOCAL Python heuristics,")
            print(f"  [FALLBACK]       NOT from the configured bridge. Labeled honestly.")

            generator = create_generator(seed=generator_seed, max_candidates=remaining * 2)
            queue_status = generator.get_queue_status()
            print(f"  [FALLBACK] Queue: {queue_status['remaining']} candidates ready")

            while experiments_run < max_experiments and generator.has_more():
                candidate = generator.generate_next()
                if candidate is None:
                    print("\n[LOOP] Local generator exhausted.")
                    break

                if candidate.candidate_id in completed_ids:
                    print(f"  [SKIP] {candidate.candidate_id} already completed")
                    continue

                experiment_id = state.get("next_experiment_id", 12)

                decision, score = run_single_candidate(
                    state=state,
                    experiment_id=experiment_id,
                    candidate_id=candidate.candidate_id,
                    hypothesis=candidate.hypothesis,
                    edits=candidate.edits,
                    param_names=candidate.param_names,
                    param_changes=candidate.param_changes,
                    generation_strategy=f"local_fallback_{candidate.generation_strategy}",
                    prompt_hash=candidate.prompt_hash,
                    candidate_source="local_fallback_generator",
                    time_budget_per_run=time_budget_per_run,
                    dry_run=dry_run,
                    generation_context=candidate.generation_context,
                )

                experiments_run += 1
                fallback_candidates_run += 1

    # Final summary
    print(f"\n{'#'*72}")
    print(f"# AGENT LOOP SESSION COMPLETE (Phase {CURRENT_PHASE})")
    print(f"# Experiments run: {experiments_run}")
    print(f"#   Bridge ({bridge_label}): {bridge_candidates_run}")
    print(f"#   Fallback (local):     {fallback_candidates_run}")
    print(f"# Final incumbent: {state['incumbent'].get('variant_id', '?')} (score={state['incumbent']['score']:.4f})")
    print(f"{'#'*72}")

    _write_agent_session_summary(
        state,
        experiments_run,
        bridge_candidates_run,
        fallback_candidates_run,
        bridge_provider=bridge_provider,
    )
    _write_root_execution_report(
        state,
        experiments_this_session=experiments_run,
        bridge_count=bridge_candidates_run,
        fallback_count=fallback_candidates_run,
        bridge_provider=bridge_provider,
        bridge_label=bridge_label,
        time_budget_per_run=time_budget_per_run,
        dry_run=dry_run,
    )


def _record_agent_experiment(
    state: Dict,
    experiment_id: int,
    candidate_id: str,
    hypothesis: str,
    decision: str,
    reason: str,
    score: Optional[float],
    incumbent_score: float,
    elapsed_sec: float,
    log_path: str,
    diff_text: str,
    generation_strategy: str = "unknown",
    prompt_hash: str = "",
    provenance_path: str = "",
    candidate_source: str = "unknown",
) -> None:
    """Record an agent experiment in loop_state.json with provenance."""
    if "agent_experiments" not in state:
        state["agent_experiments"] = []

    record = {
        "experiment_id": experiment_id,
        "candidate_id": candidate_id,
        "hypothesis": hypothesis,
        "decision": decision,
        "decision_reason": reason,
        "score": score,
        "incumbent_score": incumbent_score,
        "delta": round(score - incumbent_score, 4) if score is not None else None,
        "elapsed_sec": round(elapsed_sec, 2),
        "log_path": log_path,
        "diff_lines": len(diff_text.splitlines()) if diff_text else 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "generation_strategy": generation_strategy,
        "prompt_hash": prompt_hash,
        "provenance_path": provenance_path,
        "candidate_source": candidate_source,
        "phase": CURRENT_PHASE,
    }

    state["agent_experiments"].append(record)
    state["next_experiment_id"] = experiment_id + 1
    save_loop_state(state)


def _write_agent_session_summary(
    state: Dict,
    experiments_this_session: int,
    bridge_count: int,
    fallback_count: int,
    bridge_provider: str,
) -> None:
    """Write session summary with boundary metadata."""
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    summary_path = os.path.join(ARTIFACT_DIR, f"{timestamp}-agent_session_summary.json")

    summary = {
        "session_timestamp": timestamp,
        "phase": CURRENT_PHASE,
        "loop_type": "external_bridge_with_local_fallback",
        "bridge_provider": bridge_provider,
        "experiments_this_session": experiments_this_session,
        "bridge_candidates": bridge_count,
        "fallback_candidates": fallback_count,
        "total_agent_experiments": len(state.get("agent_experiments", [])),
        "final_incumbent": state["incumbent"],
        "agent_scoreboard": [
            {
                "id": exp["experiment_id"],
                "candidate": exp["candidate_id"],
                "hypothesis": exp["hypothesis"],
                "score": exp.get("score"),
                "delta": exp.get("delta"),
                "decision": exp["decision"],
                "generation_strategy": exp.get("generation_strategy", "unknown"),
                "candidate_source": exp.get("candidate_source", "unknown"),
                "prompt_hash": exp.get("prompt_hash", ""),
                "phase": exp.get("phase", "unknown"),
            }
            for exp in state.get("agent_experiments", [])
        ],
    }

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSession summary saved: {summary_path}")


def _write_root_execution_report(
    state: Dict,
    experiments_this_session: int,
    bridge_count: int,
    fallback_count: int,
    bridge_provider: str,
    bridge_label: str,
    time_budget_per_run: float,
    dry_run: bool,
) -> None:
    """Write a plain-English execution report to the repo root."""
    scoreboard = state.get("agent_experiments", [])
    recent = scoreboard[-experiments_this_session:] if experiments_this_session > 0 else []
    incumbent = state.get("incumbent", {})
    generated_at = datetime.now().astimezone().isoformat()

    lines = [
        "# Oracle Autoresearch Execution Report",
        "",
        f"- Generated: `{generated_at}`",
        f"- Phase: `{CURRENT_PHASE}`",
        f"- Bridge provider: `{bridge_provider}`",
        f"- Session mode: `{bridge_label}`",
        f"- Dry run: `{'yes' if dry_run else 'no'}`",
        f"- Time budget per benchmark: `{time_budget_per_run}` seconds",
        f"- Experiments this session: `{experiments_this_session}`",
        f"- Bridge candidates this session: `{bridge_count}`",
        f"- Local fallback candidates this session: `{fallback_count}`",
        "",
        "## Incumbent",
        "",
        f"- Variant: `{incumbent.get('variant_id', 'unknown')}`",
        f"- Score: `{incumbent.get('score', 'unknown')}`",
        f"- Threshold: `{incumbent.get('threshold', 'unknown')}`",
        f"- Promoted at: `{incumbent.get('promoted_at', 'unknown')}`",
        "",
        "## Session Results",
        "",
    ]

    if recent:
        for exp in recent:
            lines.extend(
                [
                    f"### Experiment {exp.get('experiment_id', '?')}: `{exp.get('candidate_id', 'unknown')}`",
                    "",
                    f"- Decision: `{exp.get('decision', 'unknown')}`",
                    f"- Score: `{exp.get('score', 'not-run')}`",
                    f"- Delta vs incumbent at run time: `{exp.get('delta', 'n/a')}`",
                    f"- Source: `{exp.get('candidate_source', 'unknown')}`",
                    f"- Strategy: `{exp.get('generation_strategy', 'unknown')}`",
                    f"- Hypothesis: {exp.get('hypothesis', 'Not recorded')}",
                    f"- Log path: `{exp.get('log_path', '')}`",
                    "",
                ]
            )
    else:
        lines.extend(
            [
                "- No experiment records were added in this session.",
                "",
            ]
        )

    lines.extend(
        [
            "## Artifacts",
            "",
            f"- Session summaries: `{ARTIFACT_DIR}`",
            f"- Candidate logs: `{CANDIDATE_LOG_DIR}`",
            f"- Provenance logs: `{PROVENANCE_LOG_DIR}`",
            "",
        ]
    )

    with open(ROOT_EXECUTION_REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Root execution report saved: {ROOT_EXECUTION_REPORT_PATH}")


# ── CLI Entry Point ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Oracle Autoresearch Agent-Driven Loop (Gemini CLI ready)"
    )
    parser.add_argument(
        "--max-experiments",
        type=int,
        default=10,
        help="Maximum experiments to run before stopping (default: 10)",
    )
    parser.add_argument(
        "--time-budget",
        type=float,
        default=300.0,
        help="Time budget per benchmark in seconds (default: 300)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk through candidate edits without running benchmarks",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=80,
        help="Random seed for fallback candidate generator (default: 80)",
    )
    parser.add_argument(
        "--bridge-provider",
        choices=["gemini", "antigravity"],
        default="gemini",
        help="External candidate-generation provider (default: gemini)",
    )
    parser.add_argument(
        "--bridge-mode",
        choices=["bridge_only", "bridge_then_fallback", "fallback_only"],
        default="bridge_then_fallback",
        help="Candidate source mode (default: bridge_then_fallback)",
    )
    parser.add_argument(
        "--bridge-timeout",
        type=float,
        default=300.0,
        help="Timeout in seconds for bridge generation (default: 300)",
    )
    parser.add_argument(
        "--gemini-model",
        default=None,
        help="Optional Gemini model override (default: CLI default)",
    )
    parser.add_argument(
        "--gemini-approval-mode",
        choices=["default", "auto_edit", "yolo", "plan"],
        default="plan",
        help="Gemini CLI approval mode for bridge calls (default: plan)",
    )
    args = parser.parse_args()

    run_agent_loop(
        max_experiments=args.max_experiments,
        time_budget_per_run=args.time_budget,
        dry_run=args.dry_run,
        generator_seed=args.seed,
        bridge_provider=args.bridge_provider,
        bridge_mode=args.bridge_mode,
        bridge_timeout=args.bridge_timeout,
        gemini_model=args.gemini_model,
        gemini_approval_mode=args.gemini_approval_mode,
    )


if __name__ == "__main__":
    main()
