
import os
import sys

# Ensure we can import from the current directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from prepare import load_train_spots, load_eval_spots

def audit_spots(name, spots):
    print(f"\n--- Auditing {name} ({len(spots)} spots) ---")
    
    my_scores = [s.my_score for s in spots]
    opp_scores = [s.opp_score for s in spots]
    diffs = [s.my_score - s.opp_score for s in spots]
    
    print(f"My Score:  min={min(my_scores):3d}, max={max(my_scores):3d}, avg={sum(my_scores)/len(my_scores):5.1f}")
    print(f"Opp Score: min={min(opp_scores):3d}, max={max(opp_scores):3d}, avg={sum(opp_scores)/len(opp_scores):5.1f}")
    print(f"Score Diff: min={min(diffs):3d}, max={max(diffs):3d}, avg={sum(diffs)/len(diffs):5.1f}")
    
    # Distribution of diffs
    buckets = [-50, -25, -10, 0, 10, 25, 50]
    counts = [0] * (len(buckets) + 1)
    for d in diffs:
        found = False
        for i, b in enumerate(buckets):
            if d < b:
                counts[i] += 1
                found = True
                break
        if not found:
            counts[-1] += 1
            
    print("\nScore Difference Distribution:")
    labels = [" < -50"] + [f" {buckets[i]} to {buckets[i+1]}" for i in range(len(buckets)-1)] + [" > 50"]
    # Adjust labels to be more accurate
    labels = [f"d < {buckets[0]}"]
    for i in range(len(buckets)-1):
        labels.append(f"{buckets[i]} <= d < {buckets[i+1]}")
    labels.append(f"d >= {buckets[-1]}")
    
    for label, count in zip(labels, counts):
        print(f"  {label:15s}: {count:5d} ({100*count/len(spots):4.1f}%)")

if __name__ == "__main__":
    train_spots = load_train_spots()
    eval_spots = load_eval_spots()
    
    audit_spots("Training Spots", train_spots)
    audit_spots("Evaluation Spots", eval_spots)
