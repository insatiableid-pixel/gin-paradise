param(
    [int]$MaxExperiments = 12,
    [double]$TimeBudget = 300.0,
    [string]$GeminiModel = "",
    [string]$BridgeMode = "bridge_then_fallback",
    [double]$BridgeTimeout = 300.0,
    [string]$GeminiApprovalMode = "plan",
    [int]$Seed = 80,
    [switch]$DryRun
)

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".local-python\3.14\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

$args = @(
    (Join-Path $PSScriptRoot "agent_loop.py"),
    "--bridge-provider", "gemini",
    "--bridge-mode", $BridgeMode,
    "--max-experiments", $MaxExperiments,
    "--time-budget", $TimeBudget,
    "--bridge-timeout", $BridgeTimeout,
    "--gemini-approval-mode", $GeminiApprovalMode,
    "--seed", $Seed
)

if ($GeminiModel) {
    $args += @("--gemini-model", $GeminiModel)
}

if ($DryRun) {
    $args += "--dry-run"
}

& $python @args
