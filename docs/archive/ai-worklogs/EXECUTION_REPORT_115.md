# Execution Report 115 - Semantic Surface Expansion

## Objective
Expand the Oracle's semantic mutation surface to overcome the local saturation observed in Campaign R4, while preserving the incumbent's behavior by default.

## Changes Implemented

### 1. Expanded Helper-Function Input Surface
The following game-state features were exposed to the primary mutation targets in `train.py`:
- `turn_number`: current hand turn number
- `n_pickups`: count of known opponent pickups from discard
- `n_discards`: count of known opponent discards
- `n_declines`: count of observed upcard declines

**Target Functions Updated:**
- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

**Preserved Baseline:**
The initial logic in these functions remains identical to the `gemini_gcli_0073` incumbent, ensuring no immediate regression while providing a wider search space for the next campaign.

### 2. Infrastructure Parity
- **Gauntlet Evaluation**: Updated `RealOraclePolicyPlayer` in `gauntlet_eval.py` to pass the new state features to the helper functions, ensuring evaluation always matches the optimized policy.
- **Internal Helpers**: Updated `compute_trace_confidence` in `train.py` to correctly extract and pass the new features.

### 3. Documentation & Prompt Sync
- **`agent_prompt.md`**: Updated to describe the "R5 Objective" (breaking the 0.8010 plateau using newly exposed features) and documented the expanded surface.
- **`program.md` & `README.md`**: Synchronized descriptions of the helper functions and mutation opportunities.

### 4. Established Report-Naming Rule
Formally established the convention:
- Root Directive: `GEMINI_DIRECTIVE_<N>.md`
- Root Report: `EXECUTION_REPORT_<N>.md`
This rule is now documented in `agent_prompt.md`, `program.md`, and `README.md`.

## Verification Results

### 1. Training Smoke Test
Run: `python oracle_autoresearch/train.py --time-budget 60 --tag directive115_smoke`
- **Result**: SUCCESS. The training loop correctly consumed the expanded signatures and produced baseline-consistent results.

### 2. Gauntlet Smoke Test
Run: `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 115`
- **Result**: SUCCESS. RealOracle win rate: 55.0% (consistent with expected baseline performance). The real-policy path successfully exercised the expanded surface.

### 3. Agent Loop Dry Run
Run: `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
- **Result**: SUCCESS. Verified via `prompt_gcli_0088.md` that the Gemini request now contains the updated signatures and the expanded research priors.

## Conclusion
The Oracle research lab is now equipped with a richer semantic surface. The system is stabilized, verified, and ready for the next Gemini campaign (R5) to exploit the new game-state interactions.

**Artifacts:**
- `oracle_autoresearch/train.py` (Updated)
- `oracle_autoresearch/gauntlet_eval.py` (Updated)
- `oracle_autoresearch/agent_prompt.md` (Updated)
- `oracle_autoresearch/program.md` (Updated)
- `oracle_autoresearch/README.md` (Updated)
- `EXECUTION_REPORT_115.md` (New)
