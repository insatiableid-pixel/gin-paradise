"""
Oracle Autoresearch Continuous Loop Runner — Phase 77

The outer loop that Antigravity (or any agent) can invoke to run a continuous,
honest, restartable ablation campaign over train.py variants.

Design:
  - Reads loop_state.json for incumbent, campaign, and experiment history
  - Pops the next variant from the campaign queue
  - Applies the variant's knob configuration to train.py's global constants
  - Runs a single 300-second benchmark via train.py's main pipeline
  - Records keep/discard decision in loop_state.json
  - Commits kept improvements on the oracle-autoresearch branch
  - Loops until the campaign queue is empty or interrupted

Resumability:
  - All state is in loop_state.json + experiment log files
  - On restart, completed variants are skipped; queue picks up where it left off

Antigravity entry path:
  - Agent executes: python oracle_autoresearch/loop_runner.py
  - Or agent executes: python oracle_autoresearch/loop_runner.py --max-experiments 3
  - No further directives needed per iteration
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import random
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

# Ensure we can import from the project root
sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, LAB_DIR)

from prepare import (
    ARTIFACT_DIR as PREP_ARTIFACT_DIR,
    SpotRecord,
    evaluate_probabilities,
    load_eval_spots,
    load_manifest,
    load_train_spots,
    prepare_lab,
    score_actions,
    _evaluate_actions_from_entries,
)

# ── Variant Definitions ───────────────────────────────────────────────
# Each variant defines which Phase 75 components are ON/OFF
# Plus any knob overrides relative to the current train.py

VARIANT_DEFINITIONS = {
    "phase74_baseline_repro": {
        "description": "Phase 74 baseline: no Phase 75 components, early-exit ON, CFR 10%",
        "cli_args": ["--no-p75-model", "--tag", "p77_phase74_baseline_repro"],
        "p75_components": {
            "upcard_decline": False,
            "stock_dw_prior": False,
            "mixed_continuation": False,
            "trace_confidence": False,
        },
    },
    "upcard_decline_only": {
        "description": "Phase 74 base + upcard decline signal only",
        "cli_args": ["--tag", "p77_upcard_decline_only"],
        "p75_components": {
            "upcard_decline": True,
            "stock_dw_prior": False,
            "mixed_continuation": False,
            "trace_confidence": False,
        },
        "train_py_overrides": {
            "STOCK_DW_PRIOR_ENABLED": False,
            "CONTINUATION_MIX_ENABLED": False,
            "TRACE_CONFIDENCE_FLOOR": 1.0,  # effectively disable trace scaling
            "TRACE_CONFIDENCE_DECAY": 0.0,
        },
    },
    "stock_dw_prior_only": {
        "description": "Phase 74 base + stock-size deadwood prior only",
        "cli_args": ["--tag", "p77_stock_dw_prior_only"],
        "p75_components": {
            "upcard_decline": False,
            "stock_dw_prior": True,
            "mixed_continuation": False,
            "trace_confidence": False,
        },
        "train_py_overrides": {
            "STOCK_DW_PRIOR_ENABLED": True,
            "CONTINUATION_MIX_ENABLED": False,
            "TRACE_CONFIDENCE_FLOOR": 1.0,
            "TRACE_CONFIDENCE_DECAY": 0.0,
            "DECLINE_SAME_RANK_REDUCE": 0.0,
            "DECLINE_ADJ_SUIT_REDUCE": 0.0,
            "DECLINE_FAR_SUIT_REDUCE": 0.0,
        },
    },
    "mixed_continuation_only": {
        "description": "Phase 74 base + mixed continuation policy only",
        "cli_args": ["--tag", "p77_mixed_continuation_only"],
        "p75_components": {
            "upcard_decline": False,
            "stock_dw_prior": False,
            "mixed_continuation": True,
            "trace_confidence": False,
        },
        "train_py_overrides": {
            "STOCK_DW_PRIOR_ENABLED": False,
            "CONTINUATION_MIX_ENABLED": True,
            "TRACE_CONFIDENCE_FLOOR": 1.0,
            "TRACE_CONFIDENCE_DECAY": 0.0,
            "DECLINE_SAME_RANK_REDUCE": 0.0,
            "DECLINE_ADJ_SUIT_REDUCE": 0.0,
            "DECLINE_FAR_SUIT_REDUCE": 0.0,
        },
    },
    "trace_confidence_only": {
        "description": "Phase 74 base + trace-confidence scaling only",
        "cli_args": ["--tag", "p77_trace_confidence_only"],
        "p75_components": {
            "upcard_decline": False,
            "stock_dw_prior": False,
            "mixed_continuation": False,
            "trace_confidence": True,
        },
        "train_py_overrides": {
            "STOCK_DW_PRIOR_ENABLED": False,
            "CONTINUATION_MIX_ENABLED": False,
            "TRACE_CONFIDENCE_FLOOR": 0.6,
            "TRACE_CONFIDENCE_DECAY": 0.08,
            "DECLINE_SAME_RANK_REDUCE": 0.0,
            "DECLINE_ADJ_SUIT_REDUCE": 0.0,
            "DECLINE_FAR_SUIT_REDUCE": 0.0,
        },
    },
    "full_p75_bundle": {
        "description": "Full Phase 75 bundle (all components ON) — reproduction",
        "cli_args": ["--tag", "p77_full_p75_bundle"],
        "p75_components": {
            "upcard_decline": True,
            "stock_dw_prior": True,
            "mixed_continuation": True,
            "trace_confidence": True,
        },
        # No overrides — uses train.py defaults (all P75 components enabled)
    },
}


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


def get_next_variant(state: Dict) -> Optional[str]:
    """Pop the next variant from the campaign queue."""
    remaining = state["campaign"]["variants_remaining"]
    if not remaining:
        return None
    return remaining[0]


def mark_variant_complete(state: Dict, variant_id: str) -> None:
    """Move a variant from remaining to completed."""
    remaining = state["campaign"]["variants_remaining"]
    if variant_id in remaining:
        remaining.remove(variant_id)
    completed = state["campaign"]["variants_completed"]
    if variant_id not in completed:
        completed.append(variant_id)


# ── Train.py Knob Patching ────────────────────────────────────────────

def apply_train_py_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    """
    Apply knob overrides to train.py's global constants at import time.
    Returns the original values for restoration.
    
    This works by importing train as a module and monkey-patching the globals.
    """
    import importlib
    # Ensure we reimport with fresh state
    if "train" in sys.modules:
        importlib.reload(sys.modules["train"])
    else:
        import train  # noqa: F401
    
    train_module = sys.modules["train"]
    originals = {}
    for key, value in overrides.items():
        if hasattr(train_module, key):
            originals[key] = getattr(train_module, key)
            setattr(train_module, key, value)
            print(f"  [OVERRIDE] {key}: {originals[key]} -> {value}")
        else:
            print(f"  [WARNING] train.py has no attribute '{key}', skipping")
    return originals


def restore_train_py_overrides(originals: Dict[str, Any]) -> None:
    """Restore train.py globals to original values."""
    if "train" not in sys.modules:
        return
    train_module = sys.modules["train"]
    for key, value in originals.items():
        setattr(train_module, key, value)


# ── Experiment Execution ──────────────────────────────────────────────

def run_variant_subprocess(
    variant_id: str,
    variant_def: Dict,
    time_budget: float = 300.0,
) -> Dict:
    """
    Run a single variant as a subprocess call to train.py.
    
    For variants that need knob overrides, we use --no-p75-model and then
    apply specific components. For simplicity in the subprocess approach,
    variants that need component-level toggling are run in-process instead.
    
    Returns the parsed result JSON.
    """
    python_exe = os.path.join(ROOT_DIR, ".local-python", "3.14", "python.exe")
    if not os.path.exists(python_exe):
        python_exe = sys.executable

    train_py = os.path.join(LAB_DIR, "train.py")
    
    cli_args = variant_def.get("cli_args", [])
    cmd = [python_exe, train_py, "--time-budget", str(time_budget), "--sweep"] + cli_args

    print(f"\n{'='*72}")
    print(f"RUNNING VARIANT: {variant_id}")
    print(f"Description: {variant_def['description']}")
    print(f"Command: {' '.join(cmd)}")
    print(f"{'='*72}\n")

    start_time = time.perf_counter()
    
    result = subprocess.run(
        cmd,
        cwd=ROOT_DIR,
        capture_output=False,
        text=True,
        timeout=int(time_budget + 120),  # generous timeout
    )
    
    elapsed = time.perf_counter() - start_time
    
    if result.returncode != 0:
        return {
            "success": False,
            "error": f"train.py exited with code {result.returncode}",
            "elapsed_sec": elapsed,
        }
    
    # Read latest_run.json for results
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


def run_variant_inprocess(
    variant_id: str,
    variant_def: Dict,
    time_budget: float = 300.0,
) -> Dict:
    """
    Run a variant in-process by patching train.py globals before calling main().
    
    This is needed for variants that toggle individual Phase 75 components,
    since the CLI only has --no-p75-model (all or nothing).
    """
    import importlib
    
    # Force-reimport train module
    if "train" in sys.modules:
        del sys.modules["train"]
    
    os.chdir(ROOT_DIR)
    
    # Temporarily modify sys.argv for argparse
    original_argv = sys.argv[:]
    cli_args = variant_def.get("cli_args", [])
    sys.argv = ["train.py", "--time-budget", str(time_budget), "--sweep"] + cli_args
    
    try:
        import train as train_module
        
        # Apply overrides if present
        overrides = variant_def.get("train_py_overrides", {})
        originals = {}
        
        if overrides:
            for key, value in overrides.items():
                if hasattr(train_module, key):
                    originals[key] = getattr(train_module, key)
                    setattr(train_module, key, value)
                    print(f"  [OVERRIDE] {key}: {originals[key]} -> {value}")
        
        print(f"\n{'='*72}")
        print(f"RUNNING VARIANT (in-process): {variant_id}")
        print(f"Description: {variant_def['description']}")
        print(f"Active overrides: {list(overrides.keys()) if overrides else 'none'}")
        print(f"{'='*72}\n")
        
        start_time = time.perf_counter()
        train_module.main()
        elapsed = time.perf_counter() - start_time
        
        # Read latest_run.json
        latest_path = os.path.join(ARTIFACT_DIR, "latest_run.json")
        with open(latest_path, "r", encoding="utf-8") as f:
            run_result = json.load(f)
        
        return {
            "success": True,
            "result": run_result,
            "elapsed_sec": elapsed,
        }
    
    except Exception as exc:
        import traceback
        return {
            "success": False,
            "error": f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
            "elapsed_sec": time.perf_counter() - start_time if 'start_time' in dir() else 0,
        }
    
    finally:
        # Restore
        sys.argv = original_argv
        if "train" in sys.modules and originals:
            train_mod = sys.modules["train"]
            for key, value in originals.items():
                setattr(train_mod, key, value)


def run_variant(
    variant_id: str,
    variant_def: Dict,
    time_budget: float = 300.0,
) -> Dict:
    """
    Dispatch to subprocess or in-process depending on variant needs.
    
    Variants with train_py_overrides MUST run in-process (monkey-patching).
    Variants using only CLI flags can run as subprocess.
    """
    has_overrides = bool(variant_def.get("train_py_overrides"))
    
    if has_overrides:
        return run_variant_inprocess(variant_id, variant_def, time_budget)
    else:
        return run_variant_subprocess(variant_id, variant_def, time_budget)


# ── Keep/Discard Logic ────────────────────────────────────────────────

def evaluate_keep_discard(
    score: float,
    incumbent_score: float,
    minimum_margin: float,
) -> Tuple[str, str]:
    """
    Apply the promotion rule.
    
    Returns (decision, reason):
      - ("keep", reason) if score beats incumbent by margin
      - ("discard", reason) if not
    """
    delta = score - incumbent_score
    
    if delta >= minimum_margin:
        return "keep", f"score {score:.4f} beats incumbent {incumbent_score:.4f} by {delta:+.4f} (>= margin {minimum_margin})"
    elif delta > 0:
        return "discard", f"score {score:.4f} above incumbent {incumbent_score:.4f} by {delta:+.4f} but below margin {minimum_margin}"
    else:
        return "discard", f"score {score:.4f} below incumbent {incumbent_score:.4f} by {delta:+.4f}"


# ── Git Integration ───────────────────────────────────────────────────

def git_commit_promotion(
    variant_id: str,
    score: float,
    experiment_id: int,
) -> Optional[str]:
    """
    Commit the current train.py state on the oracle-autoresearch branch.
    Returns the commit SHA, or None if git ops fail.
    """
    try:
        # Ensure we're on the right branch
        branch_name = "oracle-autoresearch"
        
        # Check if branch exists
        result = subprocess.run(
            ["git", "branch", "--list", branch_name],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )
        
        if branch_name not in result.stdout:
            # Create branch from current HEAD
            subprocess.run(
                ["git", "checkout", "-b", branch_name],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
            )
        else:
            subprocess.run(
                ["git", "checkout", branch_name],
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
            )
        
        # Stage and commit
        subprocess.run(
            ["git", "add", "oracle_autoresearch/train.py", "oracle_autoresearch/loop_state.json"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )
        
        commit_msg = f"[autoresearch] Promote {variant_id} (exp #{experiment_id}, score={score:.4f})"
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )
        
        # Get SHA
        sha_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
        )
        
        return sha_result.stdout.strip() if sha_result.returncode == 0 else None
    
    except Exception as exc:
        print(f"  [GIT WARNING] Could not commit: {exc}")
        return None


# ── Main Loop ─────────────────────────────────────────────────────────

def run_loop(
    max_experiments: int = 100,
    time_budget_per_run: float = 300.0,
    dry_run: bool = False,
) -> None:
    """
    Main continuous loop.
    
    1. Load state
    2. Pop next variant
    3. Run benchmark
    4. Keep/discard
    5. Update state
    6. Repeat
    """
    os.chdir(ROOT_DIR)
    
    # Ensure lab is prepared
    prepare_lab(force=False)
    
    state = load_loop_state()
    print(f"\n{'#'*72}")
    print(f"# ORACLE AUTORESEARCH CONTINUOUS LOOP — Phase 77")
    print(f"# Campaign: {state['campaign']['name']}")
    print(f"# Incumbent: {state['incumbent']['variant_id']} (score={state['incumbent']['score']:.4f})")
    print(f"# Variants remaining: {len(state['campaign']['variants_remaining'])}")
    print(f"# Experiments completed: {len(state['experiments'])}")
    print(f"# Max experiments this run: {max_experiments}")
    print(f"{'#'*72}\n")
    
    experiments_run = 0
    
    while experiments_run < max_experiments:
        variant_id = get_next_variant(state)
        if variant_id is None:
            print("\n[LOOP] Campaign complete — no more variants in queue.")
            break
        
        if variant_id not in VARIANT_DEFINITIONS:
            print(f"\n[LOOP ERROR] Unknown variant '{variant_id}', skipping.")
            mark_variant_complete(state, variant_id)
            save_loop_state(state)
            continue
        
        variant_def = VARIANT_DEFINITIONS[variant_id]
        experiment_id = state["next_experiment_id"]
        
        print(f"\n{'='*72}")
        print(f"EXPERIMENT #{experiment_id}: {variant_id}")
        print(f"{'='*72}")
        
        # Record pre-experiment state
        timestamp_start = datetime.now(timezone.utc).isoformat()
        
        if dry_run:
            print(f"  [DRY RUN] Would run: {variant_def['description']}")
            mark_variant_complete(state, variant_id)
            state["next_experiment_id"] = experiment_id + 1
            save_loop_state(state)
            experiments_run += 1
            continue
        
        # Run the experiment
        run_output = run_variant(variant_id, variant_def, time_budget_per_run)
        
        timestamp_end = datetime.now(timezone.utc).isoformat()
        
        if not run_output["success"]:
            # Record failed experiment
            experiment_record = {
                "experiment_id": experiment_id,
                "variant_id": variant_id,
                "description": variant_def["description"],
                "timestamp_start": timestamp_start,
                "timestamp_end": timestamp_end,
                "elapsed_sec": run_output.get("elapsed_sec", 0),
                "success": False,
                "error": run_output.get("error", "unknown"),
                "decision": "discard",
                "decision_reason": "experiment failed",
                "score": None,
                "delta_vs_incumbent": None,
            }
            state["experiments"].append(experiment_record)
            mark_variant_complete(state, variant_id)
            state["next_experiment_id"] = experiment_id + 1
            save_loop_state(state)
            
            print(f"\n  [FAILED] {run_output.get('error', 'unknown')}")
            experiments_run += 1
            continue
        
        # Extract score
        result_data = run_output["result"]
        score = result_data["metrics"]["score"]
        incumbent_score = state["incumbent"]["score"]
        
        # Find the artifact file that was written
        artifact_path = None
        latest_path = os.path.join(ARTIFACT_DIR, "latest_run.json")
        if os.path.exists(latest_path):
            # Find the most recent timestamped file
            artifact_files = sorted([
                f for f in os.listdir(ARTIFACT_DIR)
                if f.startswith("2026") and f.endswith(".json")
            ])
            if artifact_files:
                artifact_path = os.path.join("oracle_autoresearch", "artifacts", artifact_files[-1])
        
        # Keep/discard decision
        margin = state["promotion_policy"]["minimum_margin"]
        decision, reason = evaluate_keep_discard(score, incumbent_score, margin)
        
        # Record full experiment
        experiment_record = {
            "experiment_id": experiment_id,
            "variant_id": variant_id,
            "description": variant_def["description"],
            "p75_components": variant_def.get("p75_components", {}),
            "timestamp_start": timestamp_start,
            "timestamp_end": timestamp_end,
            "elapsed_sec": run_output["elapsed_sec"],
            "success": True,
            "score": score,
            "threshold": result_data["metrics"].get("threshold", None),
            "delta_vs_incumbent": round(score - incumbent_score, 4),
            "decision": decision,
            "decision_reason": reason,
            "artifact_path": artifact_path,
            "accuracy_vs_best": result_data["metrics"].get("accuracy_vs_best"),
            "knock_rate": result_data["metrics"].get("knock_rate"),
            "overknock_vs_v6": result_data["metrics"].get("overknock_vs_v6"),
            "false_positive_rate": result_data["metrics"].get("false_positive_rate"),
            "undercut_rate_when_knock": result_data["metrics"].get("undercut_rate_when_knock"),
            "avg_regret_points": result_data["metrics"].get("avg_regret_points"),
        }
        
        if decision == "keep":
            # Promote new incumbent
            commit_sha = git_commit_promotion(variant_id, score, experiment_id)
            
            state["incumbent"] = {
                "score": score,
                "threshold": result_data["metrics"].get("threshold"),
                "variant_id": variant_id,
                "artifact_path": artifact_path,
                "commit_sha": commit_sha,
                "promoted_at": timestamp_end,
                "description": variant_def["description"],
            }
            experiment_record["commit_sha"] = commit_sha
            
            print(f"\n  *** PROMOTED *** {variant_id} -> new incumbent (score={score:.4f})")
        else:
            print(f"\n  [DISCARD] {reason}")
        
        state["experiments"].append(experiment_record)
        mark_variant_complete(state, variant_id)
        state["next_experiment_id"] = experiment_id + 1
        save_loop_state(state)
        
        experiments_run += 1
        
        # Print progress summary
        print(f"\n--- Loop Progress ---")
        print(f"  Experiments completed: {len(state['experiments'])}")
        print(f"  Variants remaining: {len(state['campaign']['variants_remaining'])}")
        print(f"  Current incumbent: {state['incumbent']['variant_id']} (score={state['incumbent']['score']:.4f})")
    
    # Print final summary
    print(f"\n{'#'*72}")
    print(f"# LOOP SESSION COMPLETE")
    print(f"# Experiments run this session: {experiments_run}")
    print(f"# Total experiments: {len(state['experiments'])}")
    print(f"# Final incumbent: {state['incumbent']['variant_id']} (score={state['incumbent']['score']:.4f})")
    print(f"# Variants remaining: {len(state['campaign']['variants_remaining'])}")
    print(f"{'#'*72}")
    
    # Generate session summary
    _write_session_summary(state, experiments_run)


def _write_session_summary(state: Dict, experiments_this_session: int) -> None:
    """Write a human-readable session summary to the artifacts directory."""
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    summary_path = os.path.join(ARTIFACT_DIR, f"{timestamp}-session_summary.json")
    
    summary = {
        "session_timestamp": timestamp,
        "experiments_this_session": experiments_this_session,
        "total_experiments": len(state["experiments"]),
        "final_incumbent": state["incumbent"],
        "campaign_status": {
            "name": state["campaign"]["name"],
            "variants_remaining": len(state["campaign"]["variants_remaining"]),
            "variants_completed": state["campaign"]["variants_completed"],
        },
        "experiment_scoreboard": [
            {
                "id": exp["experiment_id"],
                "variant": exp["variant_id"],
                "score": exp.get("score"),
                "delta": exp.get("delta_vs_incumbent"),
                "decision": exp["decision"],
            }
            for exp in state["experiments"]
        ],
    }
    
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nSession summary saved: {summary_path}")


# ── CLI Entry Point ───────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Oracle Autoresearch Continuous Loop (Phase 77)"
    )
    parser.add_argument(
        "--max-experiments",
        type=int,
        default=100,
        help="Maximum experiments to run before stopping (default: 100)",
    )
    parser.add_argument(
        "--time-budget",
        type=float,
        default=300.0,
        help="Time budget per experiment in seconds (default: 300)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk through the campaign without running experiments",
    )
    parser.add_argument(
        "--reset-campaign",
        action="store_true",
        help="Reset campaign queue (re-queue all variants)",
    )
    args = parser.parse_args()
    
    if args.reset_campaign:
        state = load_loop_state()
        all_variants = list(VARIANT_DEFINITIONS.keys())
        state["campaign"]["variants_remaining"] = all_variants
        state["campaign"]["variants_completed"] = []
        save_loop_state(state)
        print(f"Campaign reset. {len(all_variants)} variants queued.")
        return
    
    run_loop(
        max_experiments=args.max_experiments,
        time_budget_per_run=args.time_budget,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
