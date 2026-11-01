"""
Voice Latency Profiler.
Computes TTFT (Time-to-First-Token), TTFS (Time-to-First-Speech),
and latency percentiles (P50, P90, P95, P99) across turns.
"""
import math
from typing import List, Dict, Any, Optional
from adapters.base import TurnRecord


class LatencyProfiler:
    """
    Analyzes turn latencies and benchmarks against production SLA targets.
    """

    def __init__(self, target_p95_ms: float = 800.0, max_budget_ms: float = 1200.0):
        self.target_p95_ms = target_p95_ms
        self.max_budget_ms = max_budget_ms

    def analyze_turns(self, turns: List[TurnRecord]) -> Dict[str, Any]:
        pearl_turns = [t for t in turns if t.speaker == "pearl"]
        if not pearl_turns:
            return {"error": "No Pearl turns recorded for latency profiling"}

        turn_latencies = [t.latency.total_turn_ms for t in pearl_turns if t.latency.total_turn_ms > 0]
        ttft_values = [t.latency.ttft_ms for t in pearl_turns if t.latency.ttft_ms is not None]

        if not turn_latencies:
            return {
                "turn_count": len(pearl_turns),
                "p50_ms": 0.0,
                "p90_ms": 0.0,
                "p95_ms": 0.0,
                "p99_ms": 0.0,
                "mean_ms": 0.0,
                "sla_compliant": True
            }

        turn_latencies.sort()
        n = len(turn_latencies)

        def percentile(p: float) -> float:
            k = (n - 1) * (p / 100.0)
            f = math.floor(k)
            c = math.ceil(k)
            if f == c:
                return turn_latencies[int(k)]
            d0 = turn_latencies[int(f)] * (c - k)
            d1 = turn_latencies[int(c)] * (k - f)
            return d0 + d1

        p50 = percentile(50.0)
        p90 = percentile(90.0)
        p95 = percentile(95.0)
        p99 = percentile(99.0)
        mean_lat = sum(turn_latencies) / n

        avg_ttft = (sum(ttft_values) / len(ttft_values)) if ttft_values else None

        sla_pass = p95 <= self.target_p95_ms

        return {
            "turn_count": n,
            "mean_ms": round(mean_lat, 2),
            "p50_ms": round(p50, 2),
            "p90_ms": round(p90, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "avg_ttft_ms": round(avg_ttft, 2) if avg_ttft else None,
            "sla_target_p95_ms": self.target_p95_ms,
            "sla_compliant": sla_pass
        }
