# Metrics Reference

This document provides mathematical and algorithmic definitions for all metrics computed by Pearl Evaluation Lab.

## 1. Word Error Rate (WER)
Word Error Rate measures the acoustic transcription discrepancy using normalized Levenshtein sequence edit distance:

$$\text{WER} = \min\left(1.0, \frac{S + D + I}{N}\right)$$

Where:
- $S$ = Substitutions
- $D$ = Deletions
- $I$ = Insertions
- $N$ = Number of words in the ground-truth reference

## 2. Character Error Rate (CER)
Similar to WER, computed over character sequences:

$$\text{CER} = \min\left(1.0, \frac{\text{Levenshtein}(C_{\text{ref}}, C_{\text{hyp}})}{|C_{\text{ref}}|}\right)$$

## 3. Latency Metrics
- **Time to First Token (TTFT)**: Elapsed milliseconds from end-of-user-utterance to first generated LLM token.
- **Total Turn Latency**: Complete round-trip turn time.
- **Percentiles (P50, P90, P95, P99)**: Computed using linear interpolation:
  $$P_k = (n - 1) \times \frac{k}{100}$$
- **SLA Target**: Default target is $P_{95} \le 800\text{ms}$.

## 4. Persona Psychological Metrics
- **Buying Intent ($\Delta \text{Intent}$)**: Tracks prospect commitment shift on a scale from $0.0$ to $1.0$.
- **Patience Depletion**: Models caller attention span per turn, triggering natural hangup when patience drops to zero.
- **Meeting Scheduled**: Binary flag set when prospect agrees to demo slot.
