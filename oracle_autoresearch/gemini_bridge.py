"""
Oracle Autoresearch — Gemini CLI Bridge

This module provides a real headless candidate-generation boundary for the
Oracle autoresearch lab by invoking Gemini CLI directly.

Flow:
  1. Read program.md, agent_prompt.md, loop_state.json, and current train.py
  2. Write a durable request artifact to gemini_bridge/requests/
  3. Invoke `gemini` in non-interactive JSON mode
  4. Parse the model's JSON reply into exact string replacements for train.py
  5. Write a durable response artifact to gemini_bridge/responses/

Unlike the legacy Antigravity bridge, this path is fully automatable inside the
current environment as long as Gemini CLI is installed and authenticated.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── Paths ─────────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
PROGRAM_PATH = os.path.join(LAB_DIR, "program.md")
AGENT_PROMPT_PATH = os.path.join(LAB_DIR, "agent_prompt.md")
LOOP_STATE_PATH = os.path.join(LAB_DIR, "loop_state.json")
TRAIN_PY_PATH = os.path.join(LAB_DIR, "train.py")
BRIDGE_DIR = os.path.join(LAB_DIR, "gemini_bridge")
REQUEST_DIR = os.path.join(BRIDGE_DIR, "requests")
RESPONSE_DIR = os.path.join(BRIDGE_DIR, "responses")


@dataclass
class GeminiBridgeRequest:
    request_id: str
    timestamp: str
    program: str
    agent_prompt: str
    agent_prompt_hash: str
    incumbent_score: float
    incumbent_variant: str
    incumbent_params: Dict[str, Any]
    experiment_history_summary: List[Dict[str, Any]]
    constraints: Dict[str, Any]
    param_registry: List[Dict[str, Any]]
    train_py_content: str


@dataclass
class GeminiBridgeResponse:
    request_id: str
    response_id: str
    timestamp: str
    source: str
    model: str
    hypothesis: str
    edits: Dict[str, str]
    param_names: List[str]
    param_changes: Dict[str, Dict[str, Any]]
    rationale: str
    confidence: str
    agent_prompt_hash: str


def ensure_bridge_dirs() -> None:
    os.makedirs(REQUEST_DIR, exist_ok=True)
    os.makedirs(RESPONSE_DIR, exist_ok=True)


def _compute_prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _read_loop_state() -> Dict[str, Any]:
    if not os.path.exists(LOOP_STATE_PATH):
        return {}
    with open(LOOP_STATE_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _summarize_experiment_history(state: Dict[str, Any], limit: int = 15) -> List[Dict[str, Any]]:
    history: List[Dict[str, Any]] = []
    for exp in state.get("experiments", []):
        history.append(
            {
                "id": exp.get("experiment_id"),
                "variant": exp.get("variant_id"),
                "score": exp.get("score"),
                "delta": exp.get("delta_vs_incumbent"),
                "decision": exp.get("decision"),
                "accuracy_vs_best": exp.get("accuracy_vs_best"),
                "knock_rate": exp.get("knock_rate"),
                "overknock_vs_v6": exp.get("overknock_vs_v6"),
            }
        )
    for exp in state.get("agent_experiments", []):
        history.append(
            {
                "id": exp.get("experiment_id"),
                "variant": exp.get("candidate_id"),
                "score": exp.get("score"),
                "delta": exp.get("delta"),
                "decision": exp.get("decision"),
                "strategy": exp.get("generation_strategy"),
                "source": exp.get("candidate_source"),
                "phase": exp.get("phase"),
            }
        )
    history.sort(key=lambda item: item.get("id") or 0)
    return history[-limit:]


def _optimize_train_py_for_prompt(content: str) -> str:
    """Extract only the essential parts of train.py to reduce prompt size."""
    lines = content.splitlines()
    essential = []
    in_target_function = False
    
    # Keep imports and headers
    for line in lines[:30]:
        if "def " in line: break
        essential.append(line)
        
    # Extract the two target functions
    target_funcs = {"compute_eval_weight", "compute_trace_confidence_multiplier"}
    for i, line in enumerate(lines):
        if any(f"def {f}(" in line for f in target_funcs):
            in_target_function = True
            essential.append("\n# ... (skipped code) ...\n")
            essential.append(line)
            continue
        
        if in_target_function:
            if line.startswith("def ") or (line.strip() == "" and i+1 < len(lines) and lines[i+1].startswith("def ")):
                in_target_function = False
            else:
                essential.append(line)
                
    essential.append("\n# ... (rest of file skipped for brevity) ...")
    return "\n".join(essential)


def _extract_current_params(train_content: str) -> Dict[str, Any]:
    from candidate_generator import PARAM_REGISTRY

    params: Dict[str, Any] = {}
    for spec in PARAM_REGISTRY:
        pattern = rf"^{re.escape(spec.name)}\s*=\s*(.+?)(?:\s*#.*)?$"
        for line in train_content.splitlines():
            match = re.match(pattern, line.strip())
            if not match:
                continue
            value_text = match.group(1).strip()
            if value_text == "True":
                params[spec.name] = True
            elif value_text == "False":
                params[spec.name] = False
            else:
                try:
                    params[spec.name] = float(value_text) if "." in value_text else int(value_text)
                except ValueError:
                    params[spec.name] = value_text
            break
    return params


def _build_param_registry_for_request() -> List[Dict[str, Any]]:
    from candidate_generator import PARAM_REGISTRY

    registry: List[Dict[str, Any]] = []
    for spec in PARAM_REGISTRY:
        registry.append(
            {
                "name": spec.name,
                "min_val": spec.min_val,
                "max_val": spec.max_val,
                "step_sizes": spec.step_sizes,
                "param_type": spec.param_type,
                "description": spec.description,
                "group": spec.group,
            }
        )
    return registry


def _extract_first_json_object(text: str) -> str:
    start = text.find("{")
    if start < 0:
        raise ValueError("No JSON object found in Gemini output")

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    raise ValueError("Unterminated JSON object in Gemini output")


def _parse_json_object(text: str, label: str) -> Dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        candidate = candidate.replace("json\n", "", 1).strip()
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    extracted = _extract_first_json_object(text)
    parsed = json.loads(extracted)
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must decode to a JSON object")
    return parsed


def _normalize_edits(raw_edits: Any) -> Dict[str, str]:
    if isinstance(raw_edits, dict):
        return {str(old): str(new) for old, new in raw_edits.items()}

    if isinstance(raw_edits, list):
        normalized: Dict[str, str] = {}
        for item in raw_edits:
            if not isinstance(item, dict):
                raise ValueError("Each list edit must be a JSON object")
            old_text = item.get("old_text")
            new_text = item.get("new_text")
            if not isinstance(old_text, str) or not isinstance(new_text, str):
                raise ValueError("List edits must contain string old_text/new_text")
            normalized[old_text] = new_text
        return normalized

    raise ValueError("edits must be either an object or a list of {old_text,new_text}")


def _normalize_param_names(raw_param_names: Any) -> List[str]:
    if raw_param_names is None:
        return []
    if not isinstance(raw_param_names, list):
        raise ValueError("param_names must be a list")
    return [str(name) for name in raw_param_names]


def _normalize_param_changes(raw_param_changes: Any) -> Dict[str, Dict[str, Any]]:
    if raw_param_changes is None:
        return {}
    if not isinstance(raw_param_changes, dict):
        raise ValueError("param_changes must be a JSON object")
    return {str(key): value for key, value in raw_param_changes.items() if isinstance(value, dict)}


def _extract_model_name(payload: Dict[str, Any], requested_model: Optional[str]) -> str:
    if requested_model:
        return requested_model

    stats = payload.get("stats", {})
    models = stats.get("models", {})
    if not isinstance(models, dict) or not models:
        return "unknown"

    non_router = [name for name, data in models.items() if "main" in (data.get("roles") or {})]
    if non_router:
        return non_router[0]
    return next(iter(models.keys()))


def write_gemini_request(request_id: str) -> Tuple[str, GeminiBridgeRequest]:
    ensure_bridge_dirs()

    program = _read_text(PROGRAM_PATH)
    agent_prompt = _read_text(AGENT_PROMPT_PATH)
    state = _read_loop_state()
    train_py_content = _read_text(TRAIN_PY_PATH)

    request = GeminiBridgeRequest(
        request_id=request_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
        program=program,
        agent_prompt=agent_prompt,
        agent_prompt_hash=_compute_prompt_hash(agent_prompt),
        incumbent_score=state.get("incumbent", {}).get("score", 0.0),
        incumbent_variant=state.get("incumbent", {}).get("variant_id", "unknown"),
        incumbent_params=_extract_current_params(train_py_content),
        experiment_history_summary=_summarize_experiment_history(state),
        constraints={
            "editable_file": "train.py",
            "forbidden_files": ["prepare.py"],
            "loop_owner": "agent_loop.py",
            "promotion_margin": state.get("promotion_policy", {}).get("minimum_margin", 0.005),
            "preferred_edit_style": "exact string replacements against current train.py",
            "max_edit_count": 3,
            "keep_changes_reviewable": True,
        },
        param_registry=_build_param_registry_for_request(),
        train_py_content=train_py_content,
    )

    request_path = os.path.join(REQUEST_DIR, f"request_{request_id}.json")
    with open(request_path, "w", encoding="utf-8") as handle:
        json.dump(asdict(request), handle, indent=2)
    return request_path, request


def build_gemini_prompt(request: GeminiBridgeRequest) -> str:
    context_payload = {
        "request_id": request.request_id,
        "incumbent_score": request.incumbent_score,
        "incumbent_variant": request.incumbent_variant,
        "incumbent_params": request.incumbent_params,
        "recent_experiment_history": request.experiment_history_summary,
        "constraints": request.constraints,
        # "param_registry": request.param_registry, # registry omitted for leaner prompt if mutation surface is narrow
    }

    optimized_train_py = _optimize_train_py_for_prompt(request.train_py_content)

    return (
        "You are the candidate-generation component inside an Oracle autoresearch loop.\n"
        "You must propose exactly one focused candidate edit for train.py.\n\n"
        "Hard rules:\n"
        "- Only propose edits for train.py.\n"
        "- Focus strictly on the extracted helper functions: compute_eval_weight() and compute_trace_confidence_multiplier().\n"
        "- Prefer 1-3 exact string replacements.\n"
        "- Every old_text must appear verbatim in the current train.py snippet shown below.\n"
        "- Return JSON only. No markdown fences, no prose before or after the JSON.\n\n"
        "Return a JSON object with exactly these keys:\n"
        "{\n"
        '  "hypothesis": "short hypothesis",\n'
        '  "edits": {"exact old text": "exact new text"},\n'
        '  "param_names": ["symbol_a"],\n'
        '  "param_changes": {"symbol_a": {"old": 1, "new": 2, "delta": 1}},\n'
        '  "rationale": "why this candidate is worth testing now",\n'
        '  "confidence": "low" | "medium" | "high"\n'
        "}\n\n"
        "Current agent prompt / research priors:\n"
        f"{request.agent_prompt}\n\n"
        "Current loop context:\n"
        f"{json.dumps(context_payload, indent=2)}\n\n"
        "Current train.py target functions:\n"
        "```python\n"
        f"{optimized_train_py}\n"
        "```\n"
    )


def invoke_gemini_bridge(
    request_id: str,
    model: Optional[str] = None,
    approval_mode: str = "plan",
    timeout_sec: float = 300.0,
    max_retries: int = 1,
) -> Tuple[GeminiBridgeResponse, str, str]:
    request_path, request = write_gemini_request(request_id)
    prompt = build_gemini_prompt(request)

    prompt_path = os.path.join(REQUEST_DIR, f"prompt_{request_id}.md")
    with open(prompt_path, "w", encoding="utf-8") as handle:
        handle.write(prompt)

    gemini_exe = shutil.which("gemini")
    if not gemini_exe:
        raise RuntimeError("Gemini CLI was not found on PATH")

    command = [
        gemini_exe,
        "--prompt=",
        "--output-format",
        "json",
        "--approval-mode",
        approval_mode,
    ]
    if model:
        command.extend(["--model", model])

    last_error = None
    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"  [BRIDGE] Retry attempt {attempt}/{max_retries} for {request_id}...")
            time.sleep(2)  # brief backoff

        print(f"  [BRIDGE] Request {request_id} (timeout={timeout_sec}s)...")
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                cwd=ROOT_DIR,
                timeout=max(30, int(timeout_sec)),
            )
            elapsed_sec = time.perf_counter() - started

            raw_output = completed.stdout.strip() or completed.stderr.strip()
            if completed.returncode != 0:
                last_error = f"Gemini CLI failed (code {completed.returncode}): {raw_output[:200]}"
                print(f"  [BRIDGE ERROR] {last_error}")
                continue

            outer_payload = _parse_json_object(raw_output, "Gemini outer output")
            response_text = outer_payload.get("response", "")
            inner_payload = _parse_json_object(str(response_text), "Gemini response payload")

            edits = _normalize_edits(inner_payload.get("edits"))
            if not edits:
                last_error = "Gemini returned no candidate edits"
                print(f"  [BRIDGE ERROR] {last_error}")
                continue

            response = GeminiBridgeResponse(
                request_id=request_id,
                response_id=f"{request_id}_resp",
                timestamp=datetime.now(timezone.utc).isoformat(),
                source="gemini_cli_headless",
                model=_extract_model_name(outer_payload, model),
                hypothesis=str(inner_payload.get("hypothesis", "")).strip(),
                edits=edits,
                param_names=_normalize_param_names(inner_payload.get("param_names")),
                param_changes=_normalize_param_changes(inner_payload.get("param_changes")),
                rationale=str(inner_payload.get("rationale", "")).strip(),
                confidence=str(inner_payload.get("confidence", "medium")).strip().lower() or "medium",
                agent_prompt_hash=request.agent_prompt_hash,
            )

            response_path = os.path.join(RESPONSE_DIR, f"response_{request_id}.json")
            response_payload = {
                **asdict(response),
                "request_path": request_path,
                "prompt_path": prompt_path,
                "cli": {
                    "command": command,
                    "elapsed_sec": round(elapsed_sec, 2),
                    "returncode": completed.returncode,
                    "stderr": completed.stderr.strip(),
                    "stats": outer_payload.get("stats", {}),
                },
                "raw_response": response_text,
            }
            with open(response_path, "w", encoding="utf-8") as handle:
                json.dump(response_payload, handle, indent=2)

            print(f"  [BRIDGE SUCCESS] {request_id} in {elapsed_sec:.1f}s")
            return response, request_path, response_path

        except subprocess.TimeoutExpired:
            last_error = f"Timeout after {timeout_sec}s"
            print(f"  [BRIDGE TIMEOUT] {request_id}: {last_error}")
            continue
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            print(f"  [BRIDGE EXCEPTION] {request_id}: {last_error}")
            continue

    raise RuntimeError(f"Gemini bridge failed after {max_retries} retries. Final error: {last_error}")
