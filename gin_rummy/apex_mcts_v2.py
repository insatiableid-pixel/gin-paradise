"""
ApexMCTSv2: Refined ApexMCTS with opponent-model-weighted world sampling.

Directive 50 refinement: the v2 bot uses the same Apex discard/knock logic
and the same MC draw search structure as ApexMCTS (Report 49 champion),
but samples worlds using the opponent model's weight[] instead of uniform
shuffling. Cards the opponent is more likely to hold are less likely to
appear as early stock draws, producing more realistic world evaluations.

The original ApexMCTS remains unchanged as the Report 49 baseline for
direct comparison.
"""

from gin_rummy.apex_mcts import ApexMCTS, SEARCH_WORLDS, SEARCH_DEPTH, OVERRIDE_MARGIN
from gin_rummy.draw_search import evaluate_draw_choice, INFO_PENALTY
import random


class ApexMCTSv2(ApexMCTS):
    """
    ApexMCTS with opponent-model-weighted world sampling.

    Identical to ApexMCTS except:
    - evaluate_draw_choice is called with use_weighted_worlds=True
    - This causes the draw search to use the opponent model's weight[]
      to bias card placement in sampled worlds

    All discard, knock, and fallback logic is inherited unchanged.
    """

    def __init__(self, name="ApexMCTSv2", seed=None,
                 num_worlds=SEARCH_WORLDS,
                 rollout_depth=SEARCH_DEPTH,
                 info_penalty=INFO_PENALTY,
                 override_margin=OVERRIDE_MARGIN):
        super().__init__(
            name=name,
            seed=seed,
            num_worlds=num_worlds,
            rollout_depth=rollout_depth,
            info_penalty=info_penalty,
            override_margin=override_margin,
        )

    def draw_decision(self, top_discard, hand, game_state):
        """
        Monte Carlo search-backed draw decision with weighted worlds.

        Same logic as ApexMCTS.draw_decision, but passes
        use_weighted_worlds=True to evaluate_draw_choice.
        """
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state['turn_number']
        self.my_score = game_state.get('my_score', 0)
        self.opp_score = game_state.get('opp_score', 0)

        for c in game_state.get('discard_pile', []):
            self.discard_pile_cards.add(c)
            if c not in self.hand:
                self.model.set_discard(c)

        # Step 1: Get Apex's heuristic answer
        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)

        # Step 2: Run the MC draw search with WEIGHTED worlds
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand=hand,
            top_discard=top_discard,
            opponent_model=self.model,
            game_state=game_state,
            num_worlds=self._num_worlds,
            rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty,
            rng=self._search_rng,
            use_weighted_worlds=True,
        )

        self._search_count += 1

        # Step 3: If search was skipped, fall back to Apex
        if diag.get('skipped'):
            self._skip_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Step 4: Check if search disagrees with sufficient margin
        margin = diag.get('margin', 0.0)
        search_decision = should_take

        if search_decision == apex_decision:
            # Agreement
            self._agree_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Disagreement: only override if margin is strong enough
        abs_margin = abs(margin)
        if abs_margin >= self._override_margin:
            self._override_count += 1
            if search_decision:
                self._last_discard = None
            return search_decision
        else:
            # Weak disagreement: defer to Apex
            self._fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision
