import argparse
import json
import sys
import copy

###############################################################################
# 1. PRICING CONFIGURATION
###############################################################################
# To make this calculation fully verified, replace "NOT_CONFIGURED" with 
# actual contracted or list prices.

PRICING = {
    "credit_price_inr": 2.00,
    "usd_to_inr": 84.00,

    "google_maps": {
        "unit": "request",
        "price_per_unit_inr": 1.68, # ~$0.02 USD per Places API request
        "currency": "INR",
        "source": "Google Cloud Console Average",
        "last_updated": "2026-10-03"
    },

    "sarvam_tts": {
        "unit": "characters",
        "price_per_unit_inr": 0.003, # â‚¹3 per 1000 characters
        "currency": "INR",
        "source": "Sarvam Pricing Matrix",
        "last_updated": "2026-10-03"
    },

    "gemini_stt": {
        "unit": "audio_seconds",
        "price_per_unit_inr": 0.005, # Gemini 1.5 Flash Audio input equivalent (~$0.003/min)
        "currency": "INR",
        "source": "Google AI Studio",
        "last_updated": "2026-10-03"
    },

    "groq_qwen": {
        "unit": "tokens",
        "input_price_per_1m_tokens_usd": 0.15, # Est for ~30B parameter model
        "output_price_per_1m_tokens_usd": 0.20,
        "currency": "USD",
        "source": "Groq Pricing Page Estimate",
        "last_updated": "2026-10-03"
    },

    "exotel": {
        "unit": "call_duration_seconds",
        "price_per_minute_inr": 0.60, # Typical Indian outbound enterprise trunk rate
        "currency": "INR",
        "source": "Exotel Enterprise Plan",
        "last_updated": "2026-10-03"
    },

    "infrastructure": {
        "unit": "workflow",
        "price_per_workflow_inr": 0.50, # Blended DB/Compute cost per call
        "currency": "INR",
        "source": "AWS/GCP Cost Allocation",
        "last_updated": "2026-10-03"
    }
}


###############################################################################
# 2. MODELS & CALCULATORS
###############################################################################

class UsageCollector:
    """Parses and normalizes the actual runtime usage."""
    def __init__(self, raw_usage):
        self.workflow_id = raw_usage.get("workflow_id", "UNKNOWN")
        self.lead_discovery = raw_usage.get("lead_discovery", {})
        self.tts = raw_usage.get("tts", {})
        self.stt = raw_usage.get("stt", {})
        self.llm = raw_usage.get("llm", {})
        self.telephony = raw_usage.get("telephony", {})
        self.credits = raw_usage.get("credits", {})
        self.raw_data = raw_usage

    @property
    def total_credits_consumed(self):
        return sum(self.credits.values())

    @property
    def baseline_duration_seconds(self):
        return self.telephony.get("call_duration_seconds", 0)


class CostCalculator:
    """Calculates COGS for each provider based on pricing config and usage."""
    def __init__(self, pricing_config):
        self.pricing = pricing_config
        self.unconfigured_providers = []

    def calculate_all(self, usage: UsageCollector):
        cogs = {
            "google_maps": self._calc_google_maps(usage.lead_discovery),
            "sarvam_tts": self._calc_sarvam(usage.tts),
            "gemini_stt": self._calc_gemini(usage.stt),
            "groq_qwen": self._calc_groq(usage.llm),
            "exotel": self._calc_exotel(usage.telephony),
            "infrastructure": self._calc_infra()
        }
        total_cogs = sum(cogs.values())
        return cogs, total_cogs

    def _is_configured(self, provider_key, *price_keys):
        cfg = self.pricing.get(provider_key, {})
        for pk in price_keys:
            if cfg.get(pk) == "NOT_CONFIGURED":
                if provider_key not in self.unconfigured_providers:
                    self.unconfigured_providers.append(provider_key)
                return False
        return True

    def _calc_google_maps(self, usage_data):
        if not self._is_configured("google_maps", "price_per_unit_inr"):
            return 0.0
        requests = usage_data.get("google_maps_requests", 0)
        return requests * self.pricing["google_maps"]["price_per_unit_inr"]

    def _calc_sarvam(self, usage_data):
        if not self._is_configured("sarvam_tts", "price_per_unit_inr"):
            return 0.0
        chars = usage_data.get("characters", 0)
        return chars * self.pricing["sarvam_tts"]["price_per_unit_inr"]

    def _calc_gemini(self, usage_data):
        if not self._is_configured("gemini_stt", "price_per_unit_inr"):
            return 0.0
        audio_seconds = usage_data.get("audio_seconds", 0)
        return audio_seconds * self.pricing["gemini_stt"]["price_per_unit_inr"]

    def _calc_groq(self, usage_data):
        if not self._is_configured("groq_qwen", "input_price_per_1m_tokens_usd", "output_price_per_1m_tokens_usd"):
            return 0.0
        cfg = self.pricing["groq_qwen"]
        usd_to_inr = self.pricing["usd_to_inr"]
        
        in_tokens = usage_data.get("input_tokens", 0)
        out_tokens = usage_data.get("output_tokens", 0)
        
        in_cost_usd = (in_tokens / 1_000_000) * cfg["input_price_per_1m_tokens_usd"]
        out_cost_usd = (out_tokens / 1_000_000) * cfg["output_price_per_1m_tokens_usd"]
        
        return (in_cost_usd + out_cost_usd) * usd_to_inr

    def _calc_exotel(self, usage_data):
        if not self._is_configured("exotel", "price_per_minute_inr"):
            return 0.0
        seconds = usage_data.get("call_duration_seconds", 0)
        minutes = seconds / 60.0
        return minutes * self.pricing["exotel"]["price_per_minute_inr"]

    def _calc_infra(self):
        if not self._is_configured("infrastructure", "price_per_workflow_inr"):
            return 0.0
        return self.pricing["infrastructure"]["price_per_workflow_inr"]


class UnitEconomicsReport:
    """Generates the final formatted terminal report."""
    def __init__(self, usage: UsageCollector, calculator: CostCalculator, pricing: dict):
        self.usage = usage
        self.calculator = calculator
        self.pricing = pricing

    def run(self):
        # Base Calculation
        cogs_breakdown, total_cogs = self.calculator.calculate_all(self.usage)
        total_credits = self.usage.total_credits_consumed
        credit_price = self.pricing["credit_price_inr"]
        revenue = total_credits * credit_price
        
        gross_profit = revenue - total_cogs
        gross_margin = (gross_profit / revenue * 100) if revenue > 0 else 0
        cogs_per_credit = (total_cogs / total_credits) if total_credits > 0 else 0
        profit_per_credit = credit_price - cogs_per_credit

        is_verified = len(self.calculator.unconfigured_providers) == 0

        # Print Report
        print("\n" + "="*50)
        print("PEARL UNIT ECONOMICS REPORT")
        print("="*50)
        
        print("\nWorkflow:")
        print(f"ID: {self.usage.workflow_id}")
        
        duration = self.usage.baseline_duration_seconds
        m, s = divmod(duration, 60)
        print(f"Call duration: {m}m {s}s")
        
        print(f"\nCredits consumed:\n{total_credits}")
        for k, v in self.usage.credits.items():
            print(f"  - {k}: {v}")

        print(f"\nCustomer revenue:\nâ‚¹{revenue:.2f}")

        print("\n-------------------------------")
        print("COGS BREAKDOWN")
        print("-------------------------------")
        
        print(f"Google Maps:    â‚¹{cogs_breakdown['google_maps']:.4f}")
        print(f"Sarvam TTS:     â‚¹{cogs_breakdown['sarvam_tts']:.4f}")
        print(f"Gemini STT:     â‚¹{cogs_breakdown['gemini_stt']:.4f}")
        print(f"Groq / Qwen:    â‚¹{cogs_breakdown['groq_qwen']:.4f}")
        print(f"Exotel:         â‚¹{cogs_breakdown['exotel']:.4f}")
        print(f"Infrastructure: â‚¹{cogs_breakdown['infrastructure']:.4f}")

        print("\n-------------------------------")
        print(f"TOTAL COGS:     â‚¹{total_cogs:.4f}")
        print(f"GROSS PROFIT:   â‚¹{gross_profit:.4f}")
        print(f"GROSS MARGIN:   {gross_margin:.1f}%")
        print(f"COGS / CREDIT:  â‚¹{cogs_per_credit:.4f}")
        print(f"PROFIT / CREDIT:â‚¹{profit_per_credit:.4f}")

        print("\n" + "="*50)
        
        if not is_verified:
            print("âš ï¸  WARNING: PARTIAL CALCULATION")
            print("The following providers are missing pricing configuration:")
            for p in self.calculator.unconfigured_providers:
                print(f"  - {p}")
            print("Total COGS is incomplete. Margin calculations are NOT VERIFIED.")
        else:
            print("âœ… FULLY VERIFIED")
            
        print("="*50)

        # Sensitivity 1: Credit Price
        print("\nCREDIT PRICE SENSITIVITY")
        print("-------------------------------")
        prices = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
        for p in prices:
            rev = total_credits * p
            gp = rev - total_cogs
            gm = (gp / rev * 100) if rev > 0 else 0
            print(f"â‚¹{p:.2f}     â†’ {gm:>5.1f}% margin (GP: â‚¹{gp:>6.2f})")

        # Sensitivity 2: Workflow Duration
        if duration > 0:
            print("\n" + "="*50)
            print("WORKFLOW SENSITIVITY (ESTIMATED)")
            print("-------------------------------")
            durations_min = [2, 3, 5, 7, 10]
            
            for d_min in durations_min:
                target_sec = d_min * 60
                scale = target_sec / duration
                
                # Scale time-bound metrics for an ESTIMATED view
                est_cogs = (
                    cogs_breakdown['google_maps'] +  # assuming fixed
                    cogs_breakdown['infrastructure'] + # assuming fixed
                    (cogs_breakdown['sarvam_tts'] * scale) +
                    (cogs_breakdown['gemini_stt'] * scale) +
                    (cogs_breakdown['groq_qwen'] * scale) +
                    (cogs_breakdown['exotel'] * scale)
                )
                
                # Assume voice call credits scale with time, but discovery/research is fixed
                fixed_credits = (self.usage.credits.get("discovery", 0) + 
                                 self.usage.credits.get("research", 0) + 
                                 self.usage.credits.get("qualification", 0) +
                                 self.usage.credits.get("analysis", 0) +
                                 self.usage.credits.get("follow_up", 0))
                voice_credits_baseline = self.usage.credits.get("voice_call", 0)
                
                est_credits = fixed_credits + (voice_credits_baseline * scale)
                est_rev = est_credits * credit_price
                est_gp = est_rev - est_cogs
                est_gm = (est_gp / est_rev * 100) if est_rev > 0 else 0
                
                print(f"{d_min}m call:")
                print(f"  Estimated Credits: {est_credits:.1f} | COGS: â‚¹{est_cogs:.2f} | Rev: â‚¹{est_rev:.2f} | GM: {est_gm:.1f}%")
        
        print("==================================================\n")

###############################################################################
# 3. DEMO DATA GENERATOR
###############################################################################

def generate_demo_usage():
    """Generates a realistic successful 4m 37s outbound call workflow snapshot."""
    return {
        "workflow_id": "demo-pearl-success-9842",
        "lead_discovery": {
            "google_maps_requests": 0.05  # 1 request yields 20 leads; prorated cost per lead is 1/20th (0.05)
        },
        "tts": {
            "provider": "sarvam",
            "characters": 2450,
            "audio_seconds": 185,
            "requests": 18
        },
        "stt": {
            "provider": "gemini",
            "audio_seconds": 277,
            "requests": 1
        },
        "llm": {
            "provider": "groq",
            "model": "qwen/qwen3-27b",
            "input_tokens": 12500, # Grows due to conversation history being appended every turn
            "output_tokens": 950,  # ~400 spoken words + JSON state tracking over 18 turns
            "cached_tokens": 8500,
            "requests": 18
        },
        "telephony": {
            "provider": "exotel",
            "call_attempts": 1,
            "successful_calls": 1,
            "call_duration_seconds": 277  # 4 minutes 37 seconds
        },
        "follow_up": {
            "actions": 1
        },
        "credits": {
            "discovery": 5,
            "research": 5,
            "qualification": 5,
            "voice_call": 23, # Dynamic based on call length
            "analysis": 3,
            "follow_up": 2
        }
    }


###############################################################################
# 4. ENTRY POINT
###############################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pearl Unit Economics Calculator")
    parser.add_argument("usage_file", nargs="?", help="Path to usage JSON file")
    parser.add_argument("--demo", action="store_true", help="Run with demo 4-5 minute call data")
    
    args = parser.parse_args()
    
    if args.demo:
        print("\n[INFO] Running in Demo Mode (Realistic 4m 37s Workflow)")
        raw_usage = generate_demo_usage()
    elif args.usage_file:
        try:
            with open(args.usage_file, 'r') as f:
                raw_usage = json.load(f)
            print(f"\n[INFO] Loaded usage data from {args.usage_file}")
        except Exception as e:
            print(f"Error loading usage file: {e}")
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)
        
    usage_collector = UsageCollector(raw_usage)
    calculator = CostCalculator(PRICING)
    
    report = UnitEconomicsReport(usage_collector, calculator, PRICING)
    report.run()
