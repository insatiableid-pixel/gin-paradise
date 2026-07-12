"""
Phase 71 Runner: Rust Core Foundation Sprint

Builds the Rust core, validates parity with Python, and benchmarks both engines.
Produces phase71_results.json with comprehensive data.
"""

import json
import os
import random
import subprocess
import sys
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from gin_rummy.card import make_card, deadwood_value as py_dw_value, rank, suit
from gin_rummy.meld import (
    best_meld_arrangement as py_best_meld,
    compute_deadwood as py_compute_dw,
    find_all_melds as py_find_melds,
    clear_cache,
)

GIN_CORE_DIR = os.path.join(PROJECT_ROOT, "gin-core")
BRIDGE_PATH = os.path.join(GIN_CORE_DIR, "target", "release", "gin_bridge.exe")


def build_rust():
    """Build the Rust crate (release mode)."""
    print("Building Rust gin-core (release)...")
    env = os.environ.copy()
    env["PATH"] = os.path.expandvars(r"%USERPROFILE%\.cargo\bin") + ";" + r"C:\msys64\mingw64\bin" + ";" + env.get("PATH", "")
    result = subprocess.run(
        ["cargo", "build", "--release"],
        cwd=GIN_CORE_DIR,
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  BUILD FAILED:\n{result.stderr}")
        return False
    print("  Build successful.")
    return True


def build_bridge():
    """Build the bridge binary."""
    print("Building bridge binary...")
    env = os.environ.copy()
    env["PATH"] = os.path.expandvars(r"%USERPROFILE%\.cargo\bin") + ";" + r"C:\msys64\mingw64\bin" + ";" + env.get("PATH", "")
    result = subprocess.run(
        ["cargo", "build", "--release", "--bin", "gin_bridge"],
        cwd=GIN_CORE_DIR,
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        print(f"  Bridge build FAILED:\n{result.stderr}")
        return False
    print("  Bridge binary built.")
    return True


def run_rust_tests():
    """Run Rust test suite."""
    print("Running Rust tests...")
    env = os.environ.copy()
    env["PATH"] = os.path.expandvars(r"%USERPROFILE%\.cargo\bin") + ";" + r"C:\msys64\mingw64\bin" + ";" + env.get("PATH", "")
    result = subprocess.run(
        ["cargo", "test"],
        cwd=GIN_CORE_DIR,
        capture_output=True, text=True, env=env,
    )
    # Count passing tests
    output = result.stdout + result.stderr
    passed = output.count("ok")
    failed = output.count("FAILED")
    print(f"  Rust tests: passed={passed}, failed={failed}")
    return result.returncode == 0, output


def generate_hands(n, seed=71):
    """Generate n random 10-card hands."""
    rng = random.Random(seed)
    hands = []
    for _ in range(n):
        deck = list(range(52))
        rng.shuffle(deck)
        hands.append(deck[:10])
    return hands


def generate_edge_cases():
    """Generate hand-crafted edge cases for parity validation."""
    cases = []

    # Gin hands
    cases.append(("gin_all_runs", [
        make_card(0, 0), make_card(1, 0), make_card(2, 0), make_card(3, 0),
        make_card(4, 1), make_card(5, 1), make_card(6, 1),
        make_card(7, 3), make_card(8, 3), make_card(9, 3),
    ]))

    # Junk hand
    cases.append(("junk_scattered", [
        make_card(0, 0), make_card(2, 1), make_card(4, 2), make_card(6, 3),
        make_card(8, 0), make_card(10, 1), make_card(12, 2),
        make_card(1, 3), make_card(5, 0), make_card(9, 1),
    ]))

    # Overlapping meld choice
    cases.append(("overlap_run_vs_set", [
        make_card(4, 0), make_card(5, 0), make_card(6, 0),
        make_card(6, 1), make_card(6, 2),
        make_card(12, 3), make_card(0, 1), make_card(2, 2),
        make_card(8, 3), make_card(10, 0),
    ]))

    # Four of a kind
    cases.append(("four_of_a_kind", [
        make_card(12, 0), make_card(12, 1), make_card(12, 2), make_card(12, 3),
        make_card(0, 0), make_card(2, 1), make_card(4, 2),
        make_card(6, 3), make_card(8, 0), make_card(10, 1),
    ]))

    # Near gin (DW = 1)
    cases.append(("near_gin_dw1", [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),
        make_card(5, 1), make_card(6, 1), make_card(7, 1),
        make_card(9, 0), make_card(9, 1), make_card(9, 2),
        make_card(0, 3),
    ]))

    # Long run (7 cards same suit)
    cases.append(("long_run", [
        make_card(2, 2), make_card(3, 2), make_card(4, 2), make_card(5, 2),
        make_card(6, 2), make_card(7, 2), make_card(8, 2),
        make_card(0, 0), make_card(12, 1), make_card(11, 3),
    ]))

    return cases


def validate_parity(bridge_proc, num_random=5000):
    """Validate exact parity between Python and Rust on random + edge case hands."""
    print(f"\n=== Parity Validation ===")
    mismatches = []
    total = 0

    # Edge cases
    edge_cases = generate_edge_cases()
    for name, hand in edge_cases:
        py_dw = py_compute_dw(hand)
        clear_cache()

        rust_resp = send_bridge(bridge_proc, {"cmd": "deadwood", "cards": hand})
        rust_dw = rust_resp["deadwood"]

        if py_dw != rust_dw:
            mismatches.append({"name": name, "hand": hand, "py_dw": py_dw, "rust_dw": rust_dw})
            print(f"  MISMATCH [{name}]: Python={py_dw}, Rust={rust_dw}")
        total += 1

    # Random hands
    random_hands = generate_hands(num_random, seed=71)
    for i, hand in enumerate(random_hands):
        py_melds, py_dw_cards, py_dw = py_best_meld(hand)
        clear_cache()

        rust_resp = send_bridge(bridge_proc, {"cmd": "best_meld", "cards": hand})
        rust_dw = rust_resp["deadwood_value"]

        if py_dw != rust_dw:
            mismatches.append({
                "idx": i, "hand": hand,
                "py_dw": py_dw, "rust_dw": rust_dw,
                "py_melds": [list(m) for m in py_melds],
                "rust_melds": rust_resp["melds"],
            })
            if len(mismatches) <= 10:
                print(f"  MISMATCH [random #{i}]: Python={py_dw}, Rust={rust_dw}")
        total += 1

    match_rate = (total - len(mismatches)) / total * 100
    print(f"\n  Total tested:  {total}")
    print(f"  Mismatches:    {len(mismatches)}")
    print(f"  Parity rate:   {match_rate:.1f}%")

    return {
        "total_tested": total,
        "mismatches": len(mismatches),
        "parity_rate": match_rate,
        "mismatch_details": mismatches[:20],  # Cap for report size
    }


def benchmark_comparison(bridge_proc, num_hands=10000):
    """Benchmark Python vs Rust on the same hands."""
    print(f"\n=== Benchmark: Python vs Rust ({num_hands} hands) ===")
    hands = generate_hands(num_hands, seed=42)

    # Python benchmark
    clear_cache()
    py_start = time.perf_counter()
    py_total_dw = 0
    for hand in hands:
        py_total_dw += py_compute_dw(hand)
    py_elapsed = time.perf_counter() - py_start
    clear_cache()

    print(f"\n  Python compute_deadwood:")
    print(f"    Time:       {py_elapsed*1000:.1f}ms")
    print(f"    Per hand:   {py_elapsed*1e6/num_hands:.1f}us")
    print(f"    Throughput: {num_hands/py_elapsed:.0f} hands/sec")

    # Rust benchmark (via bridge, single calls)
    rust_start = time.perf_counter()
    rust_total_dw = 0
    for hand in hands:
        resp = send_bridge(bridge_proc, {"cmd": "deadwood", "cards": hand})
        rust_total_dw += resp["deadwood"]
    rust_single_elapsed = time.perf_counter() - rust_start

    print(f"\n  Rust compute_deadwood (single calls via bridge):")
    print(f"    Time:       {rust_single_elapsed*1000:.1f}ms")
    print(f"    Per hand:   {rust_single_elapsed*1e6/num_hands:.1f}us")
    print(f"    Throughput: {num_hands/rust_single_elapsed:.0f} hands/sec")

    # Rust benchmark (batch mode)
    batch_size = 1000
    rust_batch_start = time.perf_counter()
    rust_batch_dw = 0
    for i in range(0, num_hands, batch_size):
        batch = hands[i:i+batch_size]
        resp = send_bridge(bridge_proc, {"cmd": "batch_deadwood", "hands": batch})
        rust_batch_dw += sum(resp["results"])
    rust_batch_elapsed = time.perf_counter() - rust_batch_start

    print(f"\n  Rust compute_deadwood (batch mode, {batch_size}/batch):")
    print(f"    Time:       {rust_batch_elapsed*1000:.1f}ms")
    print(f"    Per hand:   {rust_batch_elapsed*1e6/num_hands:.1f}us")
    print(f"    Throughput: {num_hands/rust_batch_elapsed:.0f} hands/sec")

    # Speedup calculation
    single_speedup = py_elapsed / rust_single_elapsed if rust_single_elapsed > 0 else 0
    batch_speedup = py_elapsed / rust_batch_elapsed if rust_batch_elapsed > 0 else 0

    print(f"\n  Speedup (single calls): {single_speedup:.1f}x")
    print(f"  Speedup (batch mode):   {batch_speedup:.1f}x")

    # Now also benchmark best_meld_arrangement
    clear_cache()
    py_meld_start = time.perf_counter()
    for hand in hands:
        py_best_meld(hand)
    py_meld_elapsed = time.perf_counter() - py_meld_start
    clear_cache()

    rust_meld_start = time.perf_counter()
    for hand in hands:
        send_bridge(bridge_proc, {"cmd": "best_meld", "cards": hand})
    rust_meld_elapsed = time.perf_counter() - rust_meld_start

    meld_speedup = py_meld_elapsed / rust_meld_elapsed if rust_meld_elapsed > 0 else 0

    print(f"\n  Python best_meld_arrangement: {py_meld_elapsed*1000:.1f}ms")
    print(f"  Rust best_meld_arrangement:   {rust_meld_elapsed*1000:.1f}ms")
    print(f"  Speedup:                      {meld_speedup:.1f}x")

    # Pure Rust benchmark (from binary)
    print(f"\n  Note: Pure Rust (no FFI) numbers from 'cargo run --release --bin benchmark':")
    print(f"  (See rust_benchmark_output.txt for latest full results)")

    return {
        "num_hands": num_hands,
        "python_compute_dw_ms": py_elapsed * 1000,
        "rust_single_compute_dw_ms": rust_single_elapsed * 1000,
        "rust_batch_compute_dw_ms": rust_batch_elapsed * 1000,
        "python_best_meld_ms": py_meld_elapsed * 1000,
        "rust_single_best_meld_ms": rust_meld_elapsed * 1000,
        "speedup_single": round(single_speedup, 2),
        "speedup_batch": round(batch_speedup, 2),
        "speedup_best_meld": round(meld_speedup, 2),
        "dw_match": py_total_dw == rust_total_dw,
    }


def send_bridge(proc, cmd):
    """Send a command to the bridge subprocess and get response."""
    line = json.dumps(cmd) + "\n"
    proc.stdin.write(line.encode("utf-8"))
    proc.stdin.flush()
    response = proc.stdout.readline().decode("utf-8").strip()
    return json.loads(response)


def main():
    print("=" * 60)
    print("Phase 71: Rust Core Foundation Sprint")
    print("=" * 60)

    results = {
        "phase": 71,
        "title": "Rust Core Foundation Sprint",
    }

    # Step 1: Check Rust toolchain
    print("\n--- Task A: Rust Toolchain ---")
    env = os.environ.copy()
    env["PATH"] = os.path.expandvars(r"%USERPROFILE%\.cargo\bin") + ";" + r"C:\msys64\mingw64\bin" + ";" + env.get("PATH", "")

    rustc = subprocess.run(["rustc", "--version"], capture_output=True, text=True, env=env)
    cargo = subprocess.run(["cargo", "--version"], capture_output=True, text=True, env=env)
    results["toolchain"] = {
        "rustc": rustc.stdout.strip() if rustc.returncode == 0 else "NOT FOUND",
        "cargo": cargo.stdout.strip() if cargo.returncode == 0 else "NOT FOUND",
        "available": rustc.returncode == 0 and cargo.returncode == 0,
    }
    print(f"  rustc: {results['toolchain']['rustc']}")
    print(f"  cargo: {results['toolchain']['cargo']}")

    if not results["toolchain"]["available"]:
        print("  BLOCKED: Rust toolchain not available.")
        results["status"] = "BLOCKED_NO_TOOLCHAIN"
        with open("phase71_results.json", "w") as f:
            json.dump(results, f, indent=2)
        return

    # Step 2: Build
    print("\n--- Task B/C/D: Build Rust Core ---")
    if not build_rust():
        results["status"] = "BUILD_FAILED"
        with open("phase71_results.json", "w") as f:
            json.dump(results, f, indent=2)
        return

    if not build_bridge():
        results["status"] = "BRIDGE_BUILD_FAILED"
        with open("phase71_results.json", "w") as f:
            json.dump(results, f, indent=2)
        return

    # Step 3: Run Rust tests
    print("\n--- Rust Unit Tests ---")
    tests_ok, test_output = run_rust_tests()
    results["rust_tests_pass"] = tests_ok

    # Step 4: Start bridge
    print("\n--- Task E: Python Integration (Subprocess Bridge) ---")
    bridge_proc = subprocess.Popen(
        [BRIDGE_PATH],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    # Quick smoke test
    smoke = send_bridge(bridge_proc, {"cmd": "deadwood", "cards": [0, 4, 8, 12, 16, 20, 24, 28, 32, 36]})
    print(f"  Bridge smoke test: deadwood = {smoke['deadwood']}")
    results["bridge_working"] = "deadwood" in smoke

    # Step 5: Parity validation
    parity = validate_parity(bridge_proc, num_random=5000)
    results["parity"] = parity

    # Step 6: Benchmark
    benchmark = benchmark_comparison(bridge_proc, num_hands=10000)
    results["benchmark"] = benchmark

    # Cleanup
    bridge_proc.stdin.close()
    bridge_proc.wait(timeout=5)

    # Step 7: Summary
    print("\n" + "=" * 60)
    print("Phase 71 Summary")
    print("=" * 60)
    print(f"  Rust toolchain:     {'OK' if results['toolchain']['available'] else 'NO'}")
    print(f"  Rust tests:         {'OK' if results['rust_tests_pass'] else 'NO'}")
    print(f"  Bridge working:     {'OK' if results['bridge_working'] else 'NO'}")
    print(f"  Parity rate:        {parity['parity_rate']:.1f}%")
    print(f"  Speedup (single):   {benchmark['speedup_single']:.1f}x")
    print(f"  Speedup (batch):    {benchmark['speedup_batch']:.1f}x")
    print(f"  DW values match:    {'OK' if benchmark['dw_match'] else 'NO'}")

    results["status"] = "SUCCESS" if (
        results["rust_tests_pass"]
        and results["bridge_working"]
        and parity["parity_rate"] == 100.0
    ) else "PARTIAL"

    with open("phase71_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results saved to phase71_results.json")


if __name__ == "__main__":
    main()
