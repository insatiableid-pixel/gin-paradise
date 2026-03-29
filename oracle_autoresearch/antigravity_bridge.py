"""
Oracle Autoresearch — Antigravity Bridge (Phase 80)

This module implements the real request/response boundary between the
Oracle autoresearch loop and Claude Opus 4.6 running in Antigravity.

HONEST STATUS:
  - Claude Opus 4.6 in Antigravity CANNOT be programmatically invoked
    from Python subprocess or API call within this environment.
  - The bridge therefore uses a FILE-BASED INBOX/OUTBOX protocol:
    1. The loop writes a REQUEST artifact (.json) to the inbox/ directory
    2. Claude running in Antigravity reads the request, reasons about it,
       and writes a RESPONSE artifact (.json) to the outbox/ directory
    3. The loop reads the response and extracts the candidate edit

  - This is a REAL external boundary: the candidate edit originates from
    Claude's reasoning, not from local Python heuristics.
  - The boundary is NOT fully automated: it requires an active Antigravity
    session to process requests. True overnight unattended operation would
    require a programmatic Claude API integration that does not exist in
    this environment.

Protocol:
  REQUEST  → inbox/request_{id}.json
  RESPONSE → outbox/response_{id}.json

  Request schema:
    {
      "request_id": str,
      "timestamp": str,
      "agent_prompt": str,          # Full agent_prompt.md content
      "incumbent_score": float,
      "incumbent_params": dict,     # Current train.py parameter values
      "experiment_history": list,   # Summarized history
      "constraints": dict,          # What can/cannot be edited
      "param_registry": list,       # Available parameters with bounds
    }

  Response schema:
    {
      "request_id": str,
      "response_id": str,
      "timestamp": str,
      "source": "claude_opus_4.6_antigravity",
      "hypothesis": str,
      "edits": dict,                # {old_text: new_text} for train.py
      "param_changes": dict,        # {param_name: {old, new, delta}}
      "rationale": str,
      "confidence": str,            # "low", "medium", "high"
    }
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# ── Paths ─────────────────────────────────────────────────────────────
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
BRIDGE_DIR = os.path.join(LAB_DIR, "antigravity_bridge")
INBOX_DIR = os.path.join(BRIDGE_DIR, "inbox")
OUTBOX_DIR = os.path.join(BRIDGE_DIR, "outbox")
AGENT_PROMPT_PATH = os.path.join(LAB_DIR, "agent_prompt.md")
LOOP_STATE_PATH = os.path.join(LAB_DIR, "loop_state.json")
TRAIN_PY_PATH = os.path.join(LAB_DIR, "train.py")


@dataclass
class BridgeRequest:
    """A request to Claude Opus 4.6 in Antigravity for candidate generation."""
    request_id: str
    timestamp: str
    agent_prompt: str
    agent_prompt_hash: str
    incumbent_score: float
    incumbent_params: Dict[str, Any]
    experiment_history_summary: List[Dict]
    constraints: Dict[str, Any]
    param_registry: List[Dict[str, Any]]


@dataclass
class BridgeResponse:
    """A response from Claude Opus 4.6 in Antigravity containing a candidate edit."""
    request_id: str
    response_id: str
    timestamp: str
    source: str  # Must be "claude_opus_4.6_antigravity"
    hypothesis: str
    edits: Dict[str, str]  # {old_text: new_text}
    param_names: List[str]
    param_changes: Dict[str, Dict[str, Any]]
    rationale: str
    confidence: str


def ensure_bridge_dirs() -> None:
    """Create the bridge directories if they don't exist."""
    os.makedirs(INBOX_DIR, exist_ok=True)
    os.makedirs(OUTBOX_DIR, exist_ok=True)


def _compute_prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def _read_agent_prompt() -> str:
    if os.path.exists(AGENT_PROMPT_PATH):
        with open(AGENT_PROMPT_PATH, "r", encoding="utf-8") as f:
            return f.read()
    return ""


def _read_loop_state() -> Dict:
    if os.path.exists(LOOP_STATE_PATH):
        with open(LOOP_STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _read_train_py() -> str:
    with open(TRAIN_PY_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _summarize_experiment_history(state: Dict) -> List[Dict]:
    """Create a compact summary of experiment history for the request."""
    summaries = []
    for exp in state.get("experiments", []):
        summaries.append({
            "id": exp.get("experiment_id"),
            "variant": exp.get("variant_id"),
            "score": exp.get("score"),
            "delta": exp.get("delta_vs_incumbent"),
            "decision": exp.get("decision"),
        })
    for exp in state.get("agent_experiments", []):
        summaries.append({
            "id": exp.get("experiment_id"),
            "variant": exp.get("candidate_id"),
            "score": exp.get("score"),
            "delta": exp.get("delta"),
            "decision": exp.get("decision"),
            "strategy": exp.get("generation_strategy", "unknown"),
            "phase": exp.get("phase", "unknown"),
        })
    return summaries


def _extract_current_params(train_content: str) -> Dict[str, Any]:
    """Extract current parameter values from train.py."""
    import re
    from candidate_generator import PARAM_REGISTRY

    params = {}
    for spec in PARAM_REGISTRY:
        pattern = rf'^{re.escape(spec.name)}\s*=\s*(.+?)(?:\s*#.*)?$'
        for line in train_content.splitlines():
            match = re.match(pattern, line.strip())
            if match:
                val_str = match.group(1).strip()
                if val_str == "True":
                    params[spec.name] = True
                elif val_str == "False":
                    params[spec.name] = False
                else:
                    try:
                        params[spec.name] = float(val_str) if '.' in val_str else int(val_str)
                    except ValueError:
                        params[spec.name] = val_str
                break
    return params


def _build_param_registry_for_request() -> List[Dict]:
    """Build a serializable param registry for the request payload."""
    from candidate_generator import PARAM_REGISTRY
    registry = []
    for spec in PARAM_REGISTRY:
        registry.append({
            "name": spec.name,
            "min_val": spec.min_val,
            "max_val": spec.max_val,
            "step_sizes": spec.step_sizes,
            "param_type": spec.param_type,
            "description": spec.description,
            "group": spec.group,
        })
    return registry


# ── Public API ────────────────────────────────────────────────────────

def write_bridge_request(request_id: str) -> str:
    """
    Compose and write a candidate-generation request for Claude in Antigravity.
    
    Returns the path to the written request file.
    """
    ensure_bridge_dirs()

    agent_prompt = _read_agent_prompt()
    state = _read_loop_state()
    train_content = _read_train_py()
    current_params = _extract_current_params(train_content)
    history_summary = _summarize_experiment_history(state)
    param_registry = _build_param_registry_for_request()

    request = BridgeRequest(
        request_id=request_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
        agent_prompt=agent_prompt,
        agent_prompt_hash=_compute_prompt_hash(agent_prompt),
        incumbent_score=state.get("incumbent", {}).get("score", 0.5873),
        incumbent_params=current_params,
        experiment_history_summary=history_summary,
        constraints={
            "editable_file": "train.py",
            "forbidden_files": ["prepare.py", "program.md"],
            "promotion_margin": state.get("promotion_policy", {}).get("minimum_margin", 0.005),
            "time_budget_sec": 300,
            "edit_type": "string_replacement",
            "edit_format": "dict of {old_text: new_text}",
        },
        param_registry=param_registry,
    )

    request_path = os.path.join(INBOX_DIR, f"request_{request_id}.json")
    with open(request_path, "w", encoding="utf-8") as f:
        json.dump(asdict(request), f, indent=2)

    print(f"  [BRIDGE] Request written: {request_path}")
    return request_path


def read_bridge_response(request_id: str) -> Optional[BridgeResponse]:
    """
    Read a response from Claude in Antigravity.
    
    Returns BridgeResponse if a response file exists, None otherwise.
    """
    ensure_bridge_dirs()
    response_path = os.path.join(OUTBOX_DIR, f"response_{request_id}.json")

    if not os.path.exists(response_path):
        return None

    with open(response_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return BridgeResponse(
        request_id=data["request_id"],
        response_id=data["response_id"],
        timestamp=data["timestamp"],
        source=data["source"],
        hypothesis=data["hypothesis"],
        edits=data["edits"],
        param_names=data.get("param_names", []),
        param_changes=data.get("param_changes", {}),
        rationale=data["rationale"],
        confidence=data.get("confidence", "medium"),
    )


def wait_for_response(
    request_id: str,
    timeout_sec: float = 60.0,
    poll_interval_sec: float = 2.0,
) -> Optional[BridgeResponse]:
    """
    Poll for a response from Claude in Antigravity.
    
    This is used when the Antigravity session is active and expected to
    write a response file promptly.
    """
    start = time.time()
    while time.time() - start < timeout_sec:
        response = read_bridge_response(request_id)
        if response is not None:
            print(f"  [BRIDGE] Response received for request {request_id}")
            return response
        time.sleep(poll_interval_sec)

    print(f"  [BRIDGE] Timeout waiting for response to request {request_id}")
    return None
