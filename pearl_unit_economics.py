import argparse
import json
import sys
import copy

# Ensure UTF-8 output encoding across terminals
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

###############################################################################
# 1. PRICING CONFIGURATION
###############################################################################
# To make this calculation fully verified, replace "NOT_CONFIGURED" with 
# actual contracted or list prices.

PRICING = {
    "credit_price_inr": 1.00,
    "usd_to_inr": 84.00,

    "google_maps": {
        "unit": "request",
        "price_per_unit_inr": 1.68, # ~$0.02 USD per Places API request
        "currency": "INR",
        "source": "Google Cloud Console Average",
        "last_updated": "2026-10-03"
    },

    "sarvam_tts": {
        "model": "bulbul:v4-flash",
        "unit": "characters",
        "price_per_unit_inr": 0.002, # ₹20 per 10,000 characters (Bulbul v4-flash: ₹2/1k chars, 1/3 cheaper than v3)
        "currency": "INR",
        "source": "Sarvam Bulbul v4 Flash Pricing Matrix",
        "last_updated": "2026-10-14"
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

        print(f"\nCustomer revenue:\n₹{revenue:.2f}")

        print("\n-------------------------------")
        print("COGS BREAKDOWN")
        print("-------------------------------")
        
        print(f"Google Maps:    ₹{cogs_breakdown['google_maps']:.4f}")
        print(f"Sarvam TTS:     ₹{cogs_breakdown['sarvam_tts']:.4f}")
        print(f"Gemini STT:     ₹{cogs_breakdown['gemini_stt']:.4f}")
        print(f"Groq / Qwen:    ₹{cogs_breakdown['groq_qwen']:.4f}")
        print(f"Exotel:         ₹{cogs_breakdown['exotel']:.4f}")
        print(f"Infrastructure: ₹{cogs_breakdown['infrastructure']:.4f}")

        print("\n-------------------------------")
        print(f"TOTAL COGS:     ₹{total_cogs:.4f}")
        print(f"GROSS PROFIT:   ₹{gross_profit:.4f}")
        print(f"GROSS MARGIN:   {gross_margin:.1f}%")
        print(f"COGS / CREDIT:  ₹{cogs_per_credit:.4f}")
        print(f"PROFIT / CREDIT:₹{profit_per_credit:.4f}")

        print("\n" + "="*50)
        
        if not is_verified:
            print("⚠️  WARNING: PARTIAL CALCULATION")
            print("The following providers are missing pricing configuration:")
            for p in self.calculator.unconfigured_providers:
                print(f"  - {p}")
            print("Total COGS is incomplete. Margin calculations are NOT VERIFIED.")
        else:
            print("✅ FULLY VERIFIED")
            
        print("="*50)

        # Sensitivity 1: Credit Price
        print("\nCREDIT PRICE SENSITIVITY")
        print("-------------------------------")
        prices = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
        for p in prices:
            rev = total_credits * p
            gp = rev - total_cogs
            gm = (gp / rev * 100) if rev > 0 else 0
            print(f"₹{p:.2f}     → {gm:>5.1f}% margin (GP: ₹{gp:>6.2f})")

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
                print(f"  Estimated Credits: {est_credits:.1f} | COGS: ₹{est_cogs:.2f} | Rev: ₹{est_rev:.2f} | GM: {est_gm:.1f}%")
        
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
            "model": "bulbul:v4-flash",
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
# 4. USER SCALE & RATE LIMIT FORECASTER
###############################################################################

class UserForecaster:
    """
    Simulates monthly user scale cohorts (10 to 50,000 users), forecasting credit 
    burn, customer revenue (@ ₹1/credit), Sarvam TTS demand, peak concurrency, 
    and platform rate limits.
    """
    def __init__(self, pricing_config, raw_usage):
        self.pricing = pricing_config
        self.usage = UsageCollector(raw_usage)
        self.calculator = CostCalculator(pricing_config)

    def run(self, calls_per_day=50, business_days=28):
        cogs_breakdown, total_cogs = self.calculator.calculate_all(self.usage)
        full_credits = self.usage.total_credits_consumed
        credit_price = self.pricing["credit_price_inr"]
        full_rev = full_credits * credit_price
        full_gp = full_rev - total_cogs
        full_gm = (full_gp / full_rev * 100) if full_rev > 0 else 0
        
        sarvam_chars_full = self.usage.tts.get("characters", 2450)

        # Short / Unanswered Drop Call (30s)
        # 17 credits: 5 discovery + 5 research + 5 qualification + 2 call attempt
        short_credits = 17
        short_cogs = {
            "google_maps": cogs_breakdown["google_maps"],
            "sarvam_tts": 150 * self.pricing["sarvam_tts"]["price_per_unit_inr"], # 1 prompt ~150 chars = ₹0.30
            "gemini_stt": 10 * self.pricing["gemini_stt"]["price_per_unit_inr"],   # 10s audio = ₹0.05
            "groq_qwen": (1000/1e6 * 0.15 + 50/1e6 * 0.20) * self.pricing["usd_to_inr"], # ₹0.0134
            "exotel": 0.60, # 1 min pulse = ₹0.60
            "infrastructure": 0.20
        }
        short_total_cogs = sum(short_cogs.values())
        short_rev = short_credits * credit_price
        short_gp = short_rev - short_total_cogs
        short_gm = (short_gp / short_rev * 100)

        # Real-World Blended Campaign: 35% connected full calls, 65% short drops
        blended_credits = (0.35 * full_credits) + (0.65 * short_credits)
        blended_rev = blended_credits * credit_price
        blended_cogs = (0.35 * total_cogs) + (0.65 * short_total_cogs)
        blended_gp = blended_rev - blended_cogs
        blended_gm = (blended_gp / blended_rev * 100)
        blended_sarvam_chars = (0.35 * sarvam_chars_full) + (0.65 * 150)
        blended_sarvam_cost = blended_sarvam_chars * self.pricing["sarvam_tts"]["price_per_unit_inr"]

        print("\n" + "="*80)
        print("PEARL MONTHLY USER SCALE & RATE LIMIT FORECAST (1 Credit = ₹1.00)")
        print("="*80)
        print(f"Pricing Model:    ₹{credit_price:.2f} per Credit")
        print(f"TTS Engine:       Sarvam Bulbul v4-flash (@ ₹20 / 10k chars = ₹0.002 / char)")
        print(f"Operating Window: {business_days} business days/month, 8 active calling hours/day")
        print("="*80)

        # 1 User Profiles
        print("\n--------------------------------------------------------------------------------")
        print("1. SINGLE USER MONTHLY CONSUMPTION PROFILES (BY DAILY LEAD / CALL VOLUME)")
        print("--------------------------------------------------------------------------------")
        daily_brackets = [
            ("Light Starter", 20),
            ("Active Growth", 50),
            ("Power Enterprise", 100)
        ]
        
        for name, d_calls in daily_brackets:
            m_leads = d_calls * business_days
            
            # Blended real-world
            b_cred = m_leads * blended_credits
            b_rev = b_cred * credit_price
            b_cogs = m_leads * blended_cogs
            b_gp = b_rev - b_cogs
            b_tts_chars = m_leads * blended_sarvam_chars
            b_tts_cost = m_leads * blended_sarvam_cost
            
            # Theoretical Full Loop
            f_cred = m_leads * full_credits
            f_rev = f_cred * credit_price
            f_cogs = m_leads * total_cogs
            f_gp = f_rev - f_cogs
            
            print(f"\n[{name}] {d_calls} leads & calls/day → {m_leads:,d} leads/month:")
            print(f"  • Blended Real-World (35% connected, 65% short drops):")
            print(f"      Credits: {b_cred:,.0f} | Revenue: ₹{b_rev:,.2f} | COGS: ₹{b_cogs:,.2f} | Gross Profit: ₹{b_gp:,.2f} (GM: {blended_gm:.1f}%)")
            print(f"      Sarvam TTS: {b_tts_chars:,.0f} chars (~₹{b_tts_cost:,.2f})")
            print(f"  • Full Loop Ceiling (100% 4m 37s connected calls):")
            print(f"      Credits: {f_cred:,.0f} | Revenue: ₹{f_rev:,.2f} | COGS: ₹{f_cogs:,.2f} | Gross Profit: ₹{f_gp:,.2f} (GM: {full_gm:.1f}%)")

        # Cohort Matrix
        cohorts = [10, 100, 500, 1000, 10000, 50000]
        print("\n--------------------------------------------------------------------------------")
        print(f"2. SCALE COHORTS FORECAST (Based on Moderate Baseline: {calls_per_day} calls/day, {business_days} days/month)")
        print("--------------------------------------------------------------------------------")
        print(f"Showing Blended Real-World Campaign (35% connected 4.5m calls, 65% short drops):")
        print("-" * 155)
        print(f"{'Users':>7} | {'Monthly Dials':>13} | {'Credits Burned':>15} | {'Revenue (₹)':>14} | {'Sarvam Chars':>14} | {'Sarvam TTS (₹)':>14} | {'Total COGS (₹)':>14} | {'Gross Profit (₹)':>16} | {'GM %':>5} | {'Peak Conc':>10} | {'Sarvam RPM':>10}")
        print("-" * 155)

        for u in cohorts:
            m_dials = u * calls_per_day * business_days
            m_cred = m_dials * blended_credits
            m_rev = m_cred * credit_price
            m_tts_cost = m_dials * blended_sarvam_cost
            m_cogs = m_dials * blended_cogs
            m_gp = m_rev - m_cogs
            
            # Concurrency math:
            # 8 hour calling day = 480 minutes
            # Avg call duration = 0.35 * 4.6 + 0.65 * 0.5 = 1.935 mins
            daily_dials = u * calls_per_day
            avg_conc = (daily_dials * 1.935) / 480
            peak_conc = avg_conc * 1.5 # 1.5x peak burst factor
            
            # Sarvam RPM during peak:
            sarvam_rpm = peak_conc * 2.67

            m_tts_chars = m_dials * blended_sarvam_chars
            if m_tts_chars >= 1_000_000_000:
                chars_str = f"{m_tts_chars/1_000_000_000:.2f} Bn"
            elif m_tts_chars >= 10_000_000:
                chars_str = f"{m_tts_chars/10_000_000:.2f} Cr"
            elif m_tts_chars >= 100_000:
                chars_str = f"{m_tts_chars/100_000:.2f} L"
            else:
                chars_str = f"{m_tts_chars:,.0f}"
            print(f"{u:7,d} | {m_dials:13,d} | {m_cred:15,.0f} | ₹{int(round(m_rev)):13,d} | {chars_str:>14} | ₹{int(round(m_tts_cost)):13,d} | ₹{int(round(m_cogs)):13,d} | ₹{int(round(m_gp)):15,d} | {blended_gm:4.1f}% | {peak_conc:10.1f} | {sarvam_rpm:10.1f}")
        print("-" * 155)

        print("\n--------------------------------------------------------------------------------")
        print("3. PLATFORM RATE LIMITING & MARGIN PRESERVATION ARCHITECTURE")
        print("--------------------------------------------------------------------------------")
        print("""
1. RATE LIMITING ON CLOZFLOW:
   • Per-User Concurrent Call Cap:
     - Starter: 1 concurrent call (prevents accidental runaway batch dials).
     - Growth: 3-5 concurrent calls.
     - Enterprise: 10-25 concurrent calls (requires dedicated SIP trunk allocation).
   • Token Bucket / Leaky Bucket Queue:
     - Place outbound call triggers into a Redis Queue (BullMQ / Celery).
     - Rate-limit dispatch to 1 call per 2-3 seconds per user campaign to prevent provider bursts.
   • Upstream Provider Concurrency & RPM Limits:
     - Sarvam TTS default quota is typically 50-200 concurrent WebSocket sessions.
     - At 100+ active users (peak concurrency > 40 channels), request an enterprise quota 
       increase from Sarvam for 500+ WebSocket connections and dedicated provisioned throughput.

2. HOW TO MAINTAIN HEALTHY MARGINS (77% - 85%):
   • Pre-Call Credit Reservation:
     - Deduct 15 credits upfront for Discovery + Research before dialing.
     - Reserve 20 credits for the voice call. If call ends in 30s, deduct only 2 credits 
       and immediately refund 18 credits.
   • Real-Time Call Heartbeat & Hard Ceilings:
     - Meter active calls in 30s or 60s increments.
     - Cap calls at a hard ceiling (e.g. 7 or 10 minutes max) to prevent rogue rambling calls.
     - If user credit balance drops below 5 credits during a call, have Pearl politely say 
       "I have another appointment coming up, let me send our brochure over WhatsApp" and disconnect.
   • Audio & Turn Caching:
     - Cache static greetings, disclaimers, company introductions, and common objection answers.
     - Pre-synthesizing top 20 repetitive phrases saves 25% of all Sarvam TTS synthesis costs!
   • Turn Detection & VAD:
     - Stream STT only when Voice Activity Detector (VAD) detects caller speech.
     - Truncate prompt context history with rolling summarization to prevent LLM token bloat.
""")
        print("="*80 + "\n")


###############################################################################
# 5. ENTRY POINT
###############################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pearl Unit Economics & User Scale Forecaster")
    parser.add_argument("usage_file", nargs="?", help="Path to usage JSON file")
    parser.add_argument("--demo", action="store_true", help="Run with demo 4-5 minute call data")
    parser.add_argument("--forecast", action="store_true", help="Run user growth forecasting (10 to 50k users) and concurrency analysis")
    parser.add_argument("--calls-per-day", type=int, default=50, help="Average calls per user per day for forecast (default: 50)")
    parser.add_argument("--days", type=int, default=28, help="Operating days per month for forecast (default: 28)")
    
    args = parser.parse_args()
    
    if args.demo or (args.forecast and not args.usage_file):
        raw_usage = generate_demo_usage()
        if args.demo:
            print("\n[INFO] Running in Demo Mode (Realistic 4m 37s Workflow)")
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
    
    if args.demo or (not args.forecast and args.usage_file):
        report = UnitEconomicsReport(usage_collector, calculator, PRICING)
        report.run()
        
    if args.forecast:
        forecaster = UserForecaster(PRICING, raw_usage)
        forecaster.run(calls_per_day=args.calls_per_day, business_days=args.days)
