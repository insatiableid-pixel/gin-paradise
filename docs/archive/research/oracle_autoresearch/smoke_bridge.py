"""
Bridge Reliability Smoke Test (Directive 112)

This script performs a single deterministic call to the Gemini bridge
to confirm:
1. Gemini CLI responds within timeout
2. Payload optimization works (leaner request)
3. Response parsing works
"""

import sys
import os

# Paths
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(LAB_DIR))
sys.path.insert(0, LAB_DIR)

from gemini_bridge import invoke_gemini_bridge

def main():
    print("=== BRIDGE RELIABILITY SMOKE TEST ===")
    request_id = "smoke_112"
    
    try:
        print(f"Invoking Gemini bridge (id={request_id})...")
        response, req_path, resp_path = invoke_gemini_bridge(
            request_id=request_id,
            timeout_sec=300.0,
            max_retries=1
        )
        
        print("\n--- SMOKE TEST SUCCESS ---")
        print(f"Model:      {response.model}")
        print(f"Hypothesis: {response.hypothesis}")
        print(f"Edits:      {len(response.edits)} replacement(s)")
        print(f"Rationale:  {response.rationale[:100]}...")
        print(f"Artifacts:  {req_path}\n            {resp_path}")
        print("--------------------------")
        
    except Exception as e:
        print(f"\n--- SMOKE TEST FAILED ---")
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
