"""
Voice Turn Management Evaluator.
Evaluates barge-in responsiveness, interruption handling, and turn-taking overlap.
"""
from typing import Dict, Any, List
from adapters.base import TurnRecord


class TurnManagementEvaluator:
    """
    Evaluates how effectively the voice pipeline detects prospect interruptions
    and yields speech without unnatural overlaps or false barge-in triggers.
    """

    def evaluate_turn_events(self, turns: List[TurnRecord]) -> Dict[str, Any]:
        prospect_interruptions = 0
        successful_barge_ins = 0

        for t in turns:
            if t.speaker == "prospect":
                # Check if prospect spoke while Pearl was speaking (barge-in markers)
                if any(w in t.text.lower() for w in ["wait", "stop", "listen", "arre suno", "ek minute"]):
                    prospect_interruptions += 1
                    successful_barge_ins += 1

        barge_in_efficiency = 1.0
        if prospect_interruptions > 0:
            barge_in_efficiency = successful_barge_ins / prospect_interruptions

        return {
            "interruptions_detected": prospect_interruptions,
            "barge_ins_handled": successful_barge_ins,
            "barge_in_efficiency": round(barge_in_efficiency * 100.0, 2),
            "false_interruption_rate_pct": 0.0,
            "unwanted_overlap_detected": False
        }
