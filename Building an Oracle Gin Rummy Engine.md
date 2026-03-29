This is a superb engineering and research problem. The progression from Apex to ApexMCTS proves you have a rigorous evaluation pipeline and a healthy skepticism of small-sample noise. The discovery that the draw decision is highly exploitable, while discard heuristics feel “maxed out,” perfectly mirrors the historical development of imperfect-information AIs in games like Mahjong and Poker.

I am going to give you a candid, first-principles assessment. You have reached the ceiling of what decoupled heuristic logic and proxy metrics can achieve. To bridge the gap to an oracle-track solver (analogous to PioSolver or eXtremeGammon), you must fundamentally transition the engine’s core paradigm from **Deadwood Minimization via Perfect-Information Sampling** to **Match Equity Maximization via Belief-State Resolving.**

Here is the exact research diagnosis and roadmap.

---

### **1\. Executive Assessment & Diagnosis**

Your current engine, ApexMCTS, has successfully harvested the low-hanging fruit of imperfect-information search by tackling the highest information-leak action in the game: taking a discard. However, under the hood, ApexMCTS is fundamentally a **Perfect Information Monte Carlo (PIMC)** agent using a **heuristic proxy objective** (deadwood).

**What the engine likely gets wrong:**

1. **PIMC Strategy Fusion:** Because your MCTS samples hidden worlds and plays them out, the simulated rollout agents "know" the opponent's exact cards during the rollout. This is mathematically flawed. It makes the search systematically overvalue speculative draws because it assumes it can perfectly dodge the opponent's melds. Your manual "information-revelation penalty" is the telltale proof of this: a true oracle naturally avoids leaking information because the negative Expected Value (EV) of the opponent narrowing your range falls natively out of the search.  
2. **The "Optimal Discard" Illusion:** Your discard CFR failed because you restricted the action space to "Apex’s top candidates" and lacked a rigorous belief-state objective. Apex’s discard logic is only near-optimal *against bots that don't track belief states*. An oracle will use discards as offensive weapons—throwing a mathematically "unsafe" card early to pollute your negative inference, or intentionally holding high deadwood to perfectly block your known meld avenues.  
3. **The Deadwood Proxy:** Deadwood is linearly additive; Gin is a step-function bounded by match score. Reducing deadwood from 30 to 20 is mathematically different from reducing it from 12 to 8\. Furthermore, optimizing for expected deadwood inherently fails at asymmetric scorelines (e.g., trailing 80-20), where playing for a high-variance Gin is vastly superior to knocking for 2 points.  
4. **Decoupled Draw and Discard:** By using search for the draw but heuristics for the discard, you truncate the search space. The true EV of drawing a specific card is strictly tied to the combinatorial properties of the discard you intend to make *after* drawing it.

**Distance to Oracle:**

Qualitatively, ApexMCTS is the mid-1990s backgammon equivalent of bolting a 2-ply search onto a hand-crafted piece-value evaluator. It is a dominant heuristic engine, but it lacks a unified, game-theoretic understanding of Information Hiding, Blockers, and Match Equity.

---

### **2\. Best Next Architecture**

Abandon vanilla AlphaZero (it assumes perfect information and will hallucinate) and monolithic full-game CFR (the state space destroys exact card-blocking effects when abstracted).

The target architecture is **Continual Resolving over Public Belief States**—inspired by DeepStack/ReBeL (Poker) and Suphx (Mahjong).

* **Representation:** The engine must no longer evaluate "My Hand." It must evaluate the **Public Belief State (PBS)**: \[Public Action Sequence \+ Wall Depth \+ Match Score \+ Belief Distribution over Opponent's Hand\].  
* **What it should predict:** **Expected Match Equity (EME)**. The absolute probability of winning the overarching match, bounded \[0, 1\]. Action values ($Q$-values) simply become the Expected Match Equity of taking that action. Deadwood becomes merely an internal mechanic used at terminal nodes.  
* **The Core Loop:**  
  1. **Belief Tracker:** A fast Bayesian inference module or Transformer sequence model that ingests the public history and outputs the 52-dimensional probability distribution of the opponent's hand. (Crucially, it handles *negative inference*: "They passed the 7♣, so their probability of holding 7♠/7♦ plummets").  
  2. **Neural Value Evaluator:** A neural network V(PBS, Private Hand) \-\> EME.  
  3. **Depth-Limited IS-Search:** At your turn, you construct a local subgame using the PBS, run a bounded search (e.g., Information-Set MCTS or CFR) for 2–3 plies, and use the Neural Evaluator at the leaf nodes. Both Draw and Discard are evaluated in the same tree.

---

### **3\. Representative-Situation / Solver-Style Framework**

You are completely right that Gin should be studied in high-leverage spots. In poker, spots are defined by Position, SPR, and Board Texture.

**The Gin Rummy Canonical Axes:**

1. **Wall Depth (Phase):** Early (\>40), Mid (20-30), Endgame (\<12).  
2. **Information Texture:** Wet Board (many specific discards taken), Dry Board (mostly stock draws).  
3. **Score Asymmetry (ICM):** The leverage dictated by the match score.

**The Gin Equivalent of "BTN vs BB SRP":**

* **The Early Speculator (Wet, Early):** Opponent takes the very first upcard (e.g., 8♠). How drastically do you warp your starting discard range? Do you hold the 8♣ purely to starve them, bleeding deadwood in the process?  
* **The Mid-Game Pivot (Dry, Mid):** Wall is at 25\. Neither player has touched the discard pile. What is the mathematically optimal threshold for breaking a pair vs holding high deadwood?  
* **The Endgame Wall (The "River"):** Wall \< 10\. Information is incredibly dense. Both players are likely under 10 deadwood. Do you knock for 8 points and risk an undercut, or play purely defensive discards to force a wall game?  
* **The Asymmetric Push:** You are leading 92 to 40\. The solver calculates the exact threshold where offensive knocking becomes mathematically \-EV compared to pure blocker defense.

**Product Value:** You can absolutely build an "Endgame Solver" right now. When the wall hits 10 cards, the remaining hidden combinations are small enough that you can solve the rest of the hand to a Nash Equilibrium in real-time, assuming a decent belief prior. This alone is a massive feature.

---

### **4\. Critical Situations Benchmark (CSB)**

Stop relying exclusively on 1,000 full-game duplicate rollouts for research iteration; the signal-to-noise ratio is too low for micro-improvements because 80% of Gin moves are trivial or forced.

**How to construct it honestly:**

1. **Mining via Disagreement:** Run a heavy, deep-search version of your engine against your fast baseline. Save states where the Deep Search disagrees violently with the Heuristic (e.g., Heuristic says Draw Stock, Search says Draw Discard; or Heuristic says Knock, Search says Play).  
2. **Mining via Variance:** Flag nodes where the Expected Value of the top two candidate actions are within 0.5% of each other. These are the high-leverage inflection points.  
3. **Storage:** You **MUST store both**.  
   * *The Public State \+ Belief Prior:* So the engine can initialize its knowledge correctly without cheating.  
   * *The True Hidden State:* So the duplicate runner can instantly and deterministically resolve the exact objective EV of the engine's policy.  
4. **Usage:** Initialize Bot A (Action X) and Bot B (Action Y) at the critical node. Play out the *exact same remaining wall* 1,000 times for both branches.

---

### **5\. Concrete 3-Stage Oracle Roadmap**

Here is the staged roadmap, preserving your rigorous duplicate benchmark at every step.

#### **Stage 1: The Match Equity Paradigm (Near Term, 1-3 Months)**

* **Goal:** Decouple from deadwood. Shift the objective to EME.  
* **Deliverable:** Train a supervised Neural Network on millions of ApexMCTS self-play games. Input: \[Public State \+ Private Hand \+ Score\]. Output: Final Match Winner \[0,1\]. Replace the deadwood leaf evaluation in your MCTS with this network.  
* **Expected Risk:** Momentary EV loss as the bot unlearns heuristic quirks and network smoothing misses immediate tactical knocks.  
* **Benchmark:** Duplicate matchups in highly asymmetric score scenarios (e.g., starting games at 85-20). The neural engine should drastically outperform the deadwood engine by understanding when to play defensively.

#### **Stage 2: Oracle Distillation & Belief Tracking (Medium Term, 3-6 Months)**

* **Goal:** Solve PIMC strategy fusion and eradicate the manual info-penalty hack.  
* **Deliverable:** Train a Bayesian Belief Tracker (Sequence Model). Instead of random PIMC sampling, upgrade to Information-Set MCTS (IS-MCTS) and sample exclusively from this rigorous posterior distribution.  
* **Expected Risk:** High computational overhead for maintaining the belief state at runtime.  
* **Benchmark:** The CSB "Mid-Game Pivot" suite. It should crush ApexMCTS by finding un-intuitive sacrificial discards to secure wall games or safe knocks.

#### **Stage 3: Subgame Resolving (Long Term, 6-12 Months)**

* **Goal:** True Game-Theoretic pseudo-optimality.  
* **Deliverable:** Build the true "PioSolver" backend. Rip out MCTS. Implement Continual Resolving. When faced with a decision, establish the belief ranges, and run a CFR-based subgame search just 2–3 plies deep, querying the Value Net at the leaves. Both Draw and Discard are evaluated simultaneously.  
* **Expected Risk:** Extreme mathematical and engineering complexity in passing correct counterfactual bounds down the tree.  
* **Benchmark:** Zero exploitability metrics. Endgame Undercut rates should plummet to near zero against heuristic bots.

---

### **6\. Biggest Traps to Avoid**

1. **STOP optimizing Apex heuristics.** Every hour spent writing "if deadwood \< 5 and wall \< 10, then knock" is an hour stolen from building the Match Equity architecture. You are overfitting to a local maximum.  
2. **DO NOT try full-game CFR again.** Even with abstractions, Gin's tree is too deep. CFR is only viable in Gin as an online *subgame solver* (solving the current turn and the next few plies).  
3. **DO NOT restrict search action spaces to heuristic candidates.** If you eventually return to policy networks or CFR, they *must* be allowed to evaluate "bad" discards. Game-theoretic play requires the freedom to balance ranges with non-obvious plays.  
4. **BEWARE of PIMC Information Leakage in Rollouts.** Double-check that your current MCTS isn't accidentally "playing" the opponent's sampled hand perfectly against your own hidden cards during the rollout. This generates false EV and breeds overconfidence.

You are sitting on a goldmine with your stable engine loop and duplicate pipeline. Shift your mathematical foundation from the tactical proxy (deadwood/PIMC) to the strategic reality (Match Equity over a Belief State), and you will have your PioSolver.

