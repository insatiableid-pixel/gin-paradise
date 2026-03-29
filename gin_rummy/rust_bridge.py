"""
Python bridge to the Rust gin-core engine via subprocess.

Provides a drop-in replacement for gin_rummy.meld functions
backed by the Rust engine, used for:
  1. Cross-validation (parity testing between Python and Rust)
  2. Performance benchmarking
  3. Production use when PyO3 is not available

Usage:
    from gin_rummy.rust_bridge import RustBridge

    bridge = RustBridge()
    dw = bridge.compute_deadwood([0, 4, 8, 12, 16, 20, 24, 28, 32, 36])
    melds, dw_cards, dw_val = bridge.best_meld_arrangement([0, 4, 8, ...])
    results = bridge.batch_compute_deadwood([hand1, hand2, ...])
"""

import json
import os
import subprocess
import sys
from typing import List, Tuple, Optional


class RustBridge:
    """Subprocess bridge to the Rust gin-core engine."""

    def __init__(self, bridge_path: Optional[str] = None):
        if bridge_path is None:
            # Default: look for the release binary relative to this file
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            bridge_path = os.path.join(base, "gin-core", "target", "release", "gin_bridge.exe")
            if not os.path.exists(bridge_path):
                # Try debug build
                bridge_path = os.path.join(base, "gin-core", "target", "debug", "gin_bridge.exe")

        if not os.path.exists(bridge_path):
            raise FileNotFoundError(
                f"Rust bridge binary not found at {bridge_path}. "
                "Run 'cargo build --release --bin gin_bridge' in gin-core/ first."
            )

        self._bridge_path = bridge_path
        self._process = None
        self._start()

    def _start(self):
        """Start the bridge subprocess."""
        self._process = subprocess.Popen(
            [self._bridge_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )

    def _send(self, cmd: dict) -> dict:
        """Send a command and receive the response."""
        if self._process is None or self._process.poll() is not None:
            self._start()

        line = json.dumps(cmd) + "\n"
        self._process.stdin.write(line.encode("utf-8"))
        self._process.stdin.flush()
        response = self._process.stdout.readline().decode("utf-8").strip()
        return json.loads(response)

    def compute_deadwood(self, cards: List[int]) -> int:
        """Compute minimum deadwood for a hand."""
        result = self._send({"cmd": "deadwood", "cards": cards})
        return result["deadwood"]

    def best_meld_arrangement(self, cards: List[int]) -> Tuple[list, list, int]:
        """Find optimal meld arrangement. Returns (melds, deadwood_cards, deadwood_value)."""
        result = self._send({"cmd": "best_meld", "cards": cards})
        melds = [tuple(m) for m in result["melds"]]
        return melds, result["deadwood_cards"], result["deadwood_value"]

    def batch_compute_deadwood(self, hands: List[List[int]]) -> List[int]:
        """Compute deadwood for many hands in a single call."""
        result = self._send({"cmd": "batch_deadwood", "hands": hands})
        return result["results"]

    def batch_best_meld_arrangement(self, hands: List[List[int]]) -> list:
        """Best meld arrangement for many hands."""
        result = self._send({"cmd": "batch_best_meld", "hands": hands})
        return result["results"]

    def close(self):
        """Shut down the bridge subprocess."""
        if self._process and self._process.poll() is None:
            self._process.stdin.close()
            self._process.wait(timeout=5)

    def __del__(self):
        self.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
