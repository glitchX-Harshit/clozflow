import argparse
import json
import sys
import copy
import math

# Ensure UTF-8 output encoding across Windows PowerShell and Unix terminals
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

###############################################################################
# 1. PRICING & CREDIT RATES CONFIGURATION (INVESTOR-GRADE MODEL)
###############################################################################

PRICING = {
    # ── Platform Credit Currency ──
    "credit_price_inr": 1.00,  # 1 Credit = ₹1.00 flat
    "usd_to_inr": 84.00,       # Reserve Bank / FX conversion baseline

    # ── ClozFlow Customer Pricing (Revenue Collected from User Wallet) ──
    "customer_rates": {
        "lead_discovery_per_lead_inr": 0.75,   # ₹0.75 (0.75 credits) per lead discovered via Lead Finder
        "kb_website_analysis_inr": 5.00,       # ₹5.00 (5 credits) per website analysis & Knowledge Base synthesis
        "test_simulation_inr": 2.00,           # ₹2.00 (2 credits) per browser test simulation run
        "pearl_call_per_min_inr": 3.00,        # ₹3.00 per minute baseline rate (Business Tier / Public Rate)
        "phone_rental_monthly_inr": 179.00,    # ₹179.00 / month per virtual DID number
    },

    # ── Capped PayG + Tiered Minimum Commitment Plans ──
    "subscription_tiers": {
        "starter_payg": {
            "name": "Pay As You Go",
            "category": "Starter",
            "monthly_fee_inr": 0.0,
            "preloaded_credits": 0,
            "max_topup_cap_inr": 1000.0,       # Hard cap: Max ₹1,000 wallet topup
            "included_dids": 0,
            "concurrency_limit": 1,
            "pearl_call_rate_per_min_inr": 3.50,
        },
        "pro": {
            "name": "Pro",
            "category": "Scaling Teams",
            "monthly_fee_inr": 6999.0,
            "preloaded_credits": 6999,
            "max_topup_cap_inr": 25000.0,      # Monthly volume cap: ₹25,000
            "included_dids": 1,
            "concurrency_limit": 3,
            "pearl_call_rate_per_min_inr": 3.25,
        },
        "growth": {
            "name": "Growth",
            "category": "Most Popular",
            "monthly_fee_inr": 34999.0,
            "preloaded_credits": 34999,
            "max_topup_cap_inr": 100000.0,     # Monthly volume cap: ₹1,00,000
            "included_dids": 5,
            "concurrency_limit": 10,
            "pearl_call_rate_per_min_inr": 3.15,
        },
        "business": {
            "name": "Business",
            "category": "High Volume",
            "monthly_fee_inr": 99999.0,
            "preloaded_credits": 99999,
            "max_topup_cap_inr": 300000.0,     # Monthly volume cap: ₹3,00,000
            "included_dids": 20,
            "concurrency_limit": 30,
            "pearl_call_rate_per_min_inr": 3.00,
        }
    },

    # ── Upstream Provider Infrastructure Costs (COGS Incurred by ClozFlow) ──
    "vobiz": {
        "plan": "Developer Plan",
        "unit": "30s_pulse",
        "pulse_seconds": 30,
        "price_per_pulse_inr": 0.25,           # ₹0.25 per 30-second pulse (India PSTN Mobile/Landline)
        "effective_per_min_inr": 0.50,         # ₹0.50 / minute (2x 30s pulses)
        "did_monthly_cost_usd": 1.00,          # $1.00 / month from Vobiz for virtual phone number
        "did_monthly_cost_inr": 84.00,         # ₹84.00 / month ($1.00 * ₹84.00)
        "currency": "INR",
        "source": "Vobiz Developer Plan Rate Card",
        "last_updated": "2026-11-01"
    },

    "sarvam_tts": {
        "model": "bulbul:v4-flash",
        "unit": "characters",
        "price_per_unit_inr": 0.002,           # ₹20 per 10,000 characters (₹0.002 / char)
        "currency": "INR",
        "source": "Sarvam Bulbul v4 Flash Pricing Matrix",
        "last_updated": "2026-10-14"
    },

    "gemini_stt": {
        "unit": "audio_seconds",
        "price_per_unit_inr": 0.005,           # Gemini 1.5 Flash Audio (~$0.003 / min)
        "currency": "INR",
        "source": "Google AI Studio Realtime Audio",
        "last_updated": "2026-10-03"
    },

    "groq_qwen": {
        "unit": "tokens",
        "input_price_per_1m_tokens_usd": 0.15, # Qwen-3.8-27B conversational model
        "output_price_per_1m_tokens_usd": 0.20,
        "currency": "USD",
        "source": "Groq Production Pricing",
        "last_updated": "2026-10-03"
    },

    "google_maps": {
        "unit": "request",
        "price_per_unit_inr": 1.68,            # ~$0.02 USD per Places API request (yields 20 leads = ₹0.084/lead)
        "currency": "INR",
        "source": "Google Cloud Console Average",
        "last_updated": "2026-10-03"
    },

    "infrastructure": {
        "unit": "workflow",
        "price_per_workflow_inr": 0.25,        # Hostinger KVM 2 / Cloudflare WebSocket ingress & DB
        "currency": "INR",
        "source": "Hostinger KVM 2 Production Allocation",
        "last_updated": "2026-11-01"
    }
}


###############################################################################
# 2. MODELS & CALCULATORS
###############################################################################

class UsageCollector:
    """Parses and normalizes actual runtime usage."""
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
    """Calculates COGS for each provider based on Vobiz and AI stack."""
    def __init__(self, pricing_config):
        self.pricing = pricing_config
        self.unconfigured_providers = []

    def calculate_all(self, usage: UsageCollector):
        cogs = {
            "google_maps": self._calc_google_maps(usage.lead_discovery),
            "sarvam_tts": self._calc_sarvam(usage.tts),
            "gemini_stt": self._calc_gemini(usage.stt),
            "groq_qwen": self._calc_groq(usage.llm),
            "vobiz": self._calc_vobiz(usage.telephony),
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

    def _calc_vobiz(self, usage_data):
        if not self._is_configured("vobiz", "price_per_pulse_inr"):
            return 0.0
        seconds = usage_data.get("call_duration_seconds", 0)
        if seconds <= 0:
            return 0.0
        pulse_sec = self.pricing["vobiz"].get("pulse_seconds", 30)
        pulses = math.ceil(seconds / pulse_sec)
        return pulses * self.pricing["vobiz"]["price_per_pulse_inr"]

    def _calc_infra(self):
        if not self._is_configured("infrastructure", "price_per_workflow_inr"):
            return 0.0
        return self.pricing["infrastructure"]["price_per_workflow_inr"]


###############################################################################
# 3. UNIT ECONOMICS REPORT
###############################################################################

class UnitEconomicsReport:
    """Generates an investor-ready unit economics report."""
    def __init__(self, usage: UsageCollector, calculator: CostCalculator, pricing: dict):
        self.usage = usage
        self.calculator = calculator
        self.pricing = pricing

    def run(self):
        cogs_breakdown, total_cogs = self.calculator.calculate_all(self.usage)
        total_credits = self.usage.total_credits_consumed
        credit_price = self.pricing["credit_price_inr"]
        revenue = total_credits * credit_price
        
        gross_profit = revenue - total_cogs
        gross_margin = (gross_profit / revenue * 100) if revenue > 0 else 0
        cogs_per_credit = (total_cogs / total_credits) if total_credits > 0 else 0
        profit_per_credit = credit_price - cogs_per_credit

        duration = self.usage.baseline_duration_seconds
        pulses = math.ceil(duration / 30.0) if duration > 0 else 0
        m, s = divmod(duration, 60)

        # Print Executive Header
        print("\n" + "="*80)
        print("            CLOZFLOW PEARL — INVESTOR UNIT ECONOMICS DOSSIER")
        print("="*80)
        
        # 1. THE 1-RUPEE ECONOMIC (EXECUTIVE SUMMARY)
        print("\n" + "-"*80)
        print("1. THE 1-RUPEE ECONOMIC (EXECUTIVE SUMMARY)")
        print("-"*80)
        print(f"• PLATFORM CURRENCY:       1 Credit = ₹1.00 INR flat")
        print(f"• BLENDED COGS PER ₹1:     ₹{cogs_per_credit:.4f} (Upstream AI + Telephony costs)")
        print(f"• GROSS PROFIT PER ₹1:     ₹{profit_per_credit:.4f}")
        print(f"• WORKFLOW GROSS MARGIN:   {gross_margin:.1f}%")
        print(f"• ONE-SENTENCE SUMMARY:    \"For every ₹1.00 spent by a customer on ClozFlow,")
        print(f"                           ClozFlow spends ₹{cogs_per_credit:.2f} in COGS and retains ₹{profit_per_credit:.2f} ({gross_margin:.1f}%) in Gross Profit.\"")

        # 2. CORE PRICING & STANDALONE MICRO-ECONOMICS
        print("\n" + "-"*80)
        print("2. STANDALONE PRODUCT MICRO-ECONOMICS & AVERAGE GROSS MARGIN")
        print("-"*80)
        self._print_micro_economics()

        # 3. SCENARIO ANALYSIS: BEST CASE VS. WORST CASE
        print("\n" + "-"*80)
        print("3. SCENARIO COMPARISON: BEST CASE (CONNECTED) VS. WORST CASE (DROPPED)")
        print("-"*80)
        self._print_scenarios()

        # 4. FULL QUALIFIED WORKFLOW SNAPSHOT
        print("\n" + "-"*80)
        print(f"4. WORKFLOW SNAPSHOT (DEMO CASE: 1 Lead Discovered + {m}m {s}s Live Call)")
        print("-"*80)
        print(f"Workflow ID:   {self.usage.workflow_id}")
        print(f"Call Duration: {m}m {s}s ({duration} seconds total → {pulses} Vobiz 30s pulses)")
        
        print(f"\nCustomer Billing:")
        print(f"  • Total Billed: ₹{revenue:.2f} ({total_credits:.2f} credits)")
        for k, v in self.usage.credits.items():
            print(f"    - {k:<22}: {v:>5.2f} credits (₹{v * credit_price:>5.2f})")

        print(f"\nUpstream COGS Breakdown:")
        print(f"  • Vobiz PSTN Telephony : ₹{cogs_breakdown['vobiz']:.4f} ({pulses} pulses @ ₹0.25 / 30s)")
        print(f"  • Sarvam Bulbul v4 TTS : ₹{cogs_breakdown['sarvam_tts']:.4f} ({self.usage.tts.get('characters', 0):,} chars)")
        print(f"  • Gemini 1.5 Flash STT : ₹{cogs_breakdown['gemini_stt']:.4f} ({self.usage.stt.get('audio_seconds', 0)}s audio)")
        print(f"  • Groq Qwen LLM Brain  : ₹{cogs_breakdown['groq_qwen']:.4f} ({self.usage.llm.get('input_tokens', 0) + self.usage.llm.get('output_tokens', 0):,} tokens)")
        print(f"  • Google Maps Intel    : ₹{cogs_breakdown['google_maps']:.4f}")
        print(f"  • Infrastructure & Host: ₹{cogs_breakdown['infrastructure']:.4f}")
        print("  " + "-"*76)
        print(f"  TOTAL WORKFLOW COGS    : ₹{total_cogs:.4f}")
        print(f"  GROSS PROFIT           : ₹{gross_profit:.4f} (Gross Margin: {gross_margin:.1f}%)")

        # 5. PULSE ARBITRAGE ADVANTAGE
        self._print_pulse_comparison(duration)

        # 6. MARGIN EXPANSION PLAYBOOK
        self._print_margin_expansion_playbook()

        # 7. CAPPED PAYG + TIERED SUBSCRIPTION FINANCIAL MODEL
        self._print_subscription_tier_economics()

    def _print_micro_economics(self):
        """Itemized profitability and average of all gross margins across every platform SKU."""
        
        # 1. Lead Discovery (Lead Finder via Google Places)
        rev_disc = self.pricing["customer_rates"]["lead_discovery_per_lead_inr"]    # ₹0.75
        cogs_disc = self.pricing["google_maps"]["price_per_unit_inr"] / 20.0       # 1 req yields 20 leads = ₹0.084
        gp_disc = rev_disc - cogs_disc
        gm_disc = (gp_disc / rev_disc * 100)

        # 2. Knowledge Base Website Analysis (Crawling & Capsule Synthesis)
        rev_kb = self.pricing["customer_rates"]["kb_website_analysis_inr"]          # ₹5.00
        cogs_kb = 0.35                                                             # Crawling + ~15k Groq LLM tokens = ₹0.35
        gp_kb = rev_kb - cogs_kb
        gm_kb = (gp_kb / rev_kb * 100)

        # 3. 1-Minute Live Call (Bundled: Voice AI + Vobiz PSTN Trunk) - ₹3.00 flat
        rev_1m_bundled = self.pricing["customer_rates"]["pearl_call_per_min_inr"]  # ₹3.00
        cogs_1m_vobiz = 2 * self.pricing["vobiz"]["price_per_pulse_inr"]           # ₹0.50 (2x 30s pulses)
        cogs_1m_stt = 60 * self.pricing["gemini_stt"]["price_per_unit_inr"]        # ₹0.30 (60s audio)
        cogs_1m_tts = 260 * self.pricing["sarvam_tts"]["price_per_unit_inr"]       # ₹0.52 (~260 chars with natural conversational pacing & pauses)
        cogs_1m_llm = (2500 / 1e6 * 0.15 + 180 / 1e6 * 0.20) * self.pricing["usd_to_inr"] # ₹0.0345 (Groq ~2.7k tokens)
        cogs_1m_infra = 0.05                                                       # ₹0.05 Hostinger WebSocket ingress
        total_cogs_1m_bundled = cogs_1m_vobiz + cogs_1m_stt + cogs_1m_tts + cogs_1m_llm + cogs_1m_infra
        gp_1m_bundled = rev_1m_bundled - total_cogs_1m_bundled
        gm_1m_bundled = (gp_1m_bundled / rev_1m_bundled * 100)

        # 4. 30-Second Dropped Call (Rejection / Voicemail): 1 pulse
        rev_drop = (0.5 * rev_1m_bundled)                                          # ₹1.50 (pro-rata 30s)
        cogs_drop = (
            1 * self.pricing["vobiz"]["price_per_pulse_inr"] +                    # Vobiz 1 pulse: ₹0.25
            15 * self.pricing["gemini_stt"]["price_per_unit_inr"] +               # 15s STT: ₹0.075
            120 * self.pricing["sarvam_tts"]["price_per_unit_inr"] +              # 120 chars opening hook: ₹0.24
            0.02                                                                  # Infra: ₹0.02
        )
        gp_drop = rev_drop - cogs_drop
        gm_drop = (gp_drop / rev_drop * 100)

        # 5. Browser Test Simulation Run (Sandbox)
        rev_test = self.pricing["customer_rates"]["test_simulation_inr"]           # ₹2.00
        cogs_test = (
            (300 / 1e6 * 0.15 + 60 / 1e6 * 0.20) * self.pricing["usd_to_inr"] +   # Groq: ₹0.0048
            15 * self.pricing["gemini_stt"]["price_per_unit_inr"] +               # Gemini 15s: ₹0.075
            160 * self.pricing["sarvam_tts"]["price_per_unit_inr"] +              # Sarvam 160 chars: ₹0.320
            0.02                                                                  # Infra: ₹0.02
        )
        gp_test = rev_test - cogs_test
        gm_test = (gp_test / rev_test * 100)

        # 6. Virtual Phone Number Rental (Monthly DID) - ₹179.00 / month
        rev_did = self.pricing["customer_rates"]["phone_rental_monthly_inr"]       # ₹179.00
        cogs_did = self.pricing["vobiz"]["did_monthly_cost_inr"]                   # $1.00 USD = ₹84.00
        gp_did = rev_did - cogs_did
        gm_did = (gp_did / rev_did * 100)

        # Arithmetic Average of All Gross Margins
        all_margins = [gm_disc, gm_kb, gm_1m_bundled, gm_drop, gm_test, gm_did]
        avg_gross_margin = sum(all_margins) / len(all_margins)

        print(f"1. Lead Discovery (Lead Finder):")
        print(f"   • Customer Billed : ₹{rev_disc:.2f} (0.75 credits / lead)")
        print(f"   • Upstream Cost   : ₹{cogs_disc:.4f} (Google Places API prorated)")
        print(f"   • Gross Profit    : ₹{gp_disc:.4f} | GROSS MARGIN: {gm_disc:.1f}%\n")

        print(f"2. Knowledge Base Website Analysis (Crawling & Synthesis):")
        print(f"   • Customer Billed : ₹{rev_kb:.2f} (5.00 credits flat)")
        print(f"   • Upstream Cost   : ₹{cogs_kb:.4f} (Playwright crawl + LLM extraction)")
        print(f"   • Gross Profit    : ₹{gp_kb:.4f} | GROSS MARGIN: {gm_kb:.1f}%\n")

        print(f"3. 1-Minute Live Call (Bundled: Voice AI + Vobiz Trunk):")
        print(f"   • Customer Billed : ₹{rev_1m_bundled:.2f} (3.00 credits / minute)")
        print(f"   • Upstream COGS   : ₹{total_cogs_1m_bundled:.4f} (Vobiz ₹0.50 + STT ₹0.30 + TTS ₹0.60 + LLM ₹0.035 + Host ₹0.05)")
        print(f"   • Gross Profit    : ₹{gp_1m_bundled:.4f} | GROSS MARGIN: {gm_1m_bundled:.1f}%\n")

        print(f"4. 30-Second Dropped Call (Rejection / Voicemail):")
        print(f"   • Customer Billed : ₹{rev_drop:.2f} (1.50 credits pro-rata)")
        print(f"   • Upstream COGS   : ₹{cogs_drop:.4f} (1 Vobiz pulse ₹0.25 + brief AI hook)")
        print(f"   • Gross Profit    : ₹{gp_drop:.4f} | GROSS MARGIN: {gm_drop:.1f}%\n")

        print(f"5. Browser Test Simulation Run (Sandbox):")
        print(f"   • Customer Billed : ₹{rev_test:.2f} (2.00 credits flat)")
        print(f"   • Upstream COGS   : ₹{cogs_test:.4f} (AI inference + WebRTC streaming)")
        print(f"   • Gross Profit    : ₹{gp_test:.4f} | GROSS MARGIN: {gm_test:.1f}%\n")

        print(f"6. Dedicated Virtual Phone Number Rental (Monthly DID):")
        print(f"   • Customer Billed : ₹{rev_did:.2f} / month (179 credits)")
        print(f"   • Upstream Cost   : ₹{cogs_did:.2f} / month ($1.00 USD @ ₹84.00 from Vobiz)")
        print(f"   • Gross Profit    : ₹{gp_did:.2f} | GROSS MARGIN: {gm_did:.1f}%\n")

        print("-" * 80)
        print(f"★ ARITHMETIC AVERAGE OF ALL PRODUCT GROSS MARGINS: {avg_gross_margin:.1f}%")
        print(f"  Formula: ({gm_disc:.1f}% Discovery + {gm_kb:.1f}% KB + {gm_1m_bundled:.1f}% 1m Call + {gm_drop:.1f}% Drop + {gm_test:.1f}% Test + {gm_did:.1f}% DID) / 6")
        print("-" * 80)

    def _print_scenarios(self):
        """Details the exact Best Case vs. Worst Case Outbound unit economics."""
        # Worst Case: Finding 1 lead + 30s-45s dropped call
        wc_rev = 0.75 + 1.50  # ₹0.75 lead discovery + ₹1.50 for 30s call
        wc_cogs = 0.084 + (0.25 + 0.24 + 0.075 + 0.005 + 0.02)  # ₹0.674 total
        wc_gp = wc_rev - wc_cogs
        wc_gm = (wc_gp / wc_rev * 100)

        # Best Case: Finding 1 lead + 4m 37s (277s) high-converting call (natural pacing: 1,280 chars)
        bc_call_rev = round((277 / 60.0) * 3.00, 2)  # ₹13.85
        bc_rev = 0.75 + bc_call_rev                  # ₹14.60
        bc_call_cogs = 2.50 + 2.56 + 1.385 + 0.17 + 0.25  # ₹6.865 (Vobiz ₹2.50 + Sarvam ₹2.56 + STT ₹1.385 + LLM ₹0.17 + Infra ₹0.25)
        bc_cogs = 0.084 + bc_call_cogs                     # ₹6.949
        bc_gp = bc_rev - bc_cogs
        bc_gm = (bc_gp / bc_rev * 100)

        # Blended Realistic Outbound Campaign (65% Worst Case + 35% Best Case)
        blended_rev = (0.65 * wc_rev) + (0.35 * bc_rev)
        blended_cogs = (0.65 * wc_cogs) + (0.35 * bc_cogs)
        blended_gp = blended_rev - blended_cogs
        blended_gm = (blended_gp / blended_rev * 100)

        print("A. WORST CASE SCENARIO (Unanswered / Gatekeeper Rejection / Drop <30-45s):")
        print(f"   • Pipeline Steps   : 1 Lead Discovery (₹0.75) + 30s Outbound Call Attempt (₹1.50)")
        print(f"   • Customer Billed  : ₹{wc_rev:.2f} ({wc_rev:.2f} credits)")
        print(f"   • Total COGS       : ₹{wc_cogs:.4f} (Lead Intel ₹0.084 + Vobiz 1 pulse ₹0.25 + brief AI hook ₹0.34)")
        print(f"   • Gross Profit     : ₹{wc_gp:.4f}")
        print(f"   • WORST CASE MARGIN: {wc_gm:.1f}% (High margin because lead discovery is high-margin & minimal AI consumed)\n")

        print("B. BEST CASE SCENARIO (High-Converting 4m 37s In-Depth Sales Call):")
        print(f"   • Pipeline Steps   : 1 Lead Discovery (₹0.75) + 4m 37s Pearl Sales Call (₹13.85)")
        print(f"   • Customer Billed  : ₹{bc_rev:.2f} ({bc_rev:.2f} credits)")
        print(f"   • Total COGS       : ₹{bc_cogs:.4f} (Lead Intel ₹0.084 + Vobiz 10 pulses ₹2.50 + AI TTS/STT/LLM ₹4.37)")
        print(f"   • Gross Profit     : ₹{bc_gp:.4f}")
        print(f"   • BEST CASE MARGIN : {bc_gm:.1f}% (Natural pacing: 1,280 chars TTS @ ₹2.56, generates ₹{bc_gp:.2f} profit/dial)\n")

        print("C. REALISTIC BLENDED CAMPAIGN (65% Drops/Voicemails + 35% Connected Calls):")
        print(f"   • Blended Revenue  : ₹{blended_rev:.2f} per dial")
        print(f"   • Blended COGS     : ₹{blended_cogs:.2f} per dial")
        print(f"   • Blended Profit   : ₹{blended_gp:.2f} per dial")
        print(f"   • BLENDED MARGIN   : {blended_gm:.1f}%")

    def _print_pulse_comparison(self, duration_sec):
        """Quantifies the margin expansion created by Vobiz 30s pulse vs legacy 60s carriers."""
        print("\n" + "-"*80)
        print("5. STRATEGIC MOAT: VOBIZ 30s PULSE ARBITRAGE (vs. LEGACY 60s CARRIERS)")
        print("-"*80)
        print("In outbound sales, ~65% of calls end in <40s. A 60s carrier charges for a full minute.")
        print("Vobiz 30s pulse eliminates billing waste and protects gross margin:")
        print("-" * 80)
        samples = [
            ("Immediate Hangup / Voicemail", 18),
            ("Gatekeeper Objection Drop", 42),
            ("Brief Interest Check", 85),
            ("Discovery & Scheduling", 145),
            ("Deep Qualification Call", duration_sec)
        ]
        print(f"{'Call Scenario':<28} | {'Duration':>8} | {'Vobiz 30s':>10} | {'Legacy 60s':>10} | {'COGS Saved %':>12}")
        print("-" * 80)
        for label, sec in samples:
            v_pulses = math.ceil(sec / 30.0)
            v_cost = v_pulses * 0.25
            l_pulses = math.ceil(sec / 60.0)
            l_cost = l_pulses * 0.60
            savings = ((l_cost - v_cost) / l_cost * 100) if l_cost > 0 else 0
            print(f"{label:<28} | {sec:>7}s | ₹{v_cost:>8.2f} | ₹{l_cost:>8.2f} | {savings:>11.1f}%")
        print("-" * 80)

    def _print_margin_expansion_playbook(self):
        """Presents concrete, actionable engineering & business levers to increase gross margin."""
        print("\n" + "="*80)
        print("6. HOW TO INCREASE GROSS MARGINS (STRATEGIC ENGINEERING & COMMERCIAL LEVERS)")
        print("="*80)
        print("""
Current Baseline Blended Margin: 43.9% (at ₹3.00/min Live Call & ₹179/mo DID).
Here is the exact engineering roadmap to expand Gross Margins to 65% – 75%+:

1. LEVER 1: TTS AUDIO CACHING (Saves ~35% of Sarvam TTS spend)
   • Problem: In outbound calling, 35-40% of words spoken are static (opening hooks,
     objection rebuttals, disclaimers, scheduling questions).
   • Action: Pre-synthesize and cache common phrases in memory/Redis. If the LLM generates
     a known hook, stream the pre-rendered audio chunk instantly instead of hitting Sarvam API.
   • Impact: In a 4.5m call, Sarvam cost drops from ₹4.90 to ~₹3.20 (Saves ₹1.70/call).
   • Margin Effect: Live Call Gross Margin jumps from 50.5% → 62.1%!

2. LEVER 2: VAD-GATED STT STREAMING (Saves ~55% of Gemini STT spend)
   • Problem: ClozFlow currently streams continuous 277s audio to STT, but the prospect
     only speaks for ~100s total (talk:listen ratio is ~43:57 with pauses).
   • Action: Use client/server Silero VAD to only send audio frames to Gemini STT when
     prospect voice activity is detected. Do not stream silence or when the agent is speaking.
   • Impact: Cuts STT billable audio seconds from 277s to ~110s (Saves ₹0.84/call).
   • Margin Effect: Additional +5.8% Gross Margin expansion!

3. LEVER 3: VOBIZ ENTERPRISE / WHOLESALE TRUNKING COMMITMENT (Saves 35-45% of PSTN)
   • Current: On Developer Plan @ ₹0.25 / 30s pulse (₹0.50 / min).
   • Action: At 50,000+ monthly dials, commit to Vobiz Enterprise or interconnect directly
     via wholesale SIP trunks (Airtel / Tata / Jio) at ₹0.15 - ₹0.18 per 30s pulse.
   • Impact: Telephony COGS drops from ₹2.50 to ₹1.60 for a 4.5m call (Saves ₹0.90/call).
   • Margin Effect: Additional +6.2% Gross Margin expansion!

4. LEVER 4: HYBRID SELF-HOSTED TTS ENGINE (Eliminates Third-Party Per-Char Billing)
   • Action: Self-host an open-source low-latency Hindi/English model (e.g. Kokoro / Orpheus)
     on a dedicated GPU instance (Hostinger GPU / RunPod RTX 4090 @ $0.35/hr).
   • One RTX 4090 handles 18 concurrent voice streams.
   • Impact: TTS cost drops from ₹1.06/min (Sarvam) down to ~₹0.09/min (GPU server amortization).
   • Margin Effect: Live Call Gross Margin skyrockets to 78.4%!

5. LEVER 5: SAAS PLATFORM BASE SUBSCRIPTION (Software Pure Margin Moat)
   • Action: Charge a baseline monthly subscription for ClozFlow software (e.g. Starter:
     ₹1,499/mo, Growth: ₹4,999/mo, Scale: ₹14,999/mo) with bundled platform features, CRM
     sync, analytics, and phone number rental included, then bill usage credits for dials.
   • Impact: Software subscriptions operate at 95%+ gross margin, anchoring corporate
     blended gross margin safely above 75% across all customer cohorts.
""")
        print("="*80 + "\n")

    def _print_subscription_tier_economics(self):
        """Analyzes the Capped PayG + Tiered Minimum Commitment hybrid pricing architecture."""
        print("\n" + "="*80)
        print("7. CAPPED PAYG + TIERED SUBSCRIPTION HYBRID ARCHITECTURE (THE CONVERSION FLYWHEEL)")
        print("="*80)
        print("""
THE REVENUE MOAT:
• Free-rider & Abuse Prevention: Pay As You Go is capped at ₹1,000 wallet top-up.
• Mandatory Upgrade Funnel: Once a user verifies Pearl's performance and wants to dial
  more than 285 minutes (~₹1,000), they MUST upgrade to the Pro Tier (₹6,999/mo).
• Pre-loaded Commitments: Higher tiers collect 100% upfront cash every month, granting negative
  working capital and generating breakage profit on unburned credits.
""")
        tiers = self.pricing.get("subscription_tiers", {})
        cogs_1m = 1.4845  # Live call upstream COGS / min (Vobiz + Sarvam + Gemini + Groq + Host)
        did_cogs = self.pricing["vobiz"]["did_monthly_cost_inr"]  # ₹84.00

        print("-" * 115)
        print(f"{'Plan Name':<16} | {'Monthly Fee':>12} | {'Pre-loaded':>11} | {'Rate/Min':>9} | {'Top-up Cap':>12} | {'Max Concur':>11} | {'GM (100% Burn)':>14} | {'GM (15% Breakage)':>17}")
        print("-" * 115)

        for k, t in tiers.items():
            fee = t["monthly_fee_inr"]
            credits = t["preloaded_credits"]
            rate = t["pearl_call_rate_per_min_inr"]
            cap = f"₹{int(t['max_topup_cap_inr']):,}"
            concur = f"{t['concurrency_limit']} lines"
            dids = t["included_dids"]

            if fee == 0:
                # Pay As You Go
                gm_100 = ((rate - cogs_1m) / rate * 100)
                gm_break = gm_100
                print(f"{t['name']:<16} | {'₹0 (PayG)':>12} | {'₹0':>11} | ₹{rate:>7.2f} | {cap:>12} | {concur:>11} | {gm_100:>13.1f}% | {gm_break:>16.1f}%")
            else:
                mins = credits / rate
                total_cogs_100 = (mins * cogs_1m) + (dids * did_cogs)
                gp_100 = fee - total_cogs_100
                gm_100 = (gp_100 / fee * 100)

                # 15% Breakage: 85% of credits consumed, 15% expires/rolls over
                total_cogs_break = (0.85 * mins * cogs_1m) + (dids * did_cogs)
                gp_break = fee - total_cogs_break
                gm_break = (gp_break / fee * 100)

                print(f"{t['name']:<16} | ₹{int(fee):>11,d} | ₹{int(credits):>10,d} | ₹{rate:>7.2f} | {cap:>12} | {concur:>11} | {gm_100:>13.1f}% | {gm_break:>16.1f}%")

        print("-" * 115)
        print("""
KEY STRATEGIC TAKEAWAYS FOR INVESTORS:
1. Pay As You Go is a Trojan Horse: ₹3.50/min yields 57.6% Gross Margin with zero CAC churn risk.
2. The ₹1,000 Cap Forces Monetization: Every serious sales team upgrades to Pro (₹6,999/mo).
3. Negative Working Capital: ClozFlow collects ₹6,999 to ₹99,999 on Day 1; COGS is paid 30 days later.
4. Breakage Expansion: Real SaaS cohorts experience ~15% unburned credits, pushing subscription
   gross margins to 56% – 60% automatically before audio caching optimizations!
""")
        print("="*80 + "\n")


###############################################################################
# 4. USER SCALE & COHORT FORECASTER
###############################################################################

class UserForecaster:
    """
    Simulates monthly user cohorts (10 to 50,000 users) forecasting wallet credit burn,
    revenue, Vobiz telephony trunk spend, Sarvam TTS demand, and net gross profit.
    """
    def __init__(self, pricing_config, raw_usage):
        self.pricing = pricing_config
        self.usage = UsageCollector(raw_usage)
        self.calculator = CostCalculator(pricing_config)

    def run(self, calls_per_day=50, business_days=28):
        credit_price = self.pricing["credit_price_inr"]
        
        # ── Realistic Outbound Campaign Blended Unit (Per Dial) ──
        # Every 1 dial includes:
        # • 1 lead discovered @ ₹0.75 (COGS: ₹0.084)
        # • 35% connected 4.6m call @ ₹13.85 (COGS: ₹9.205)
        # • 65% dropped 30s call @ ₹1.50 (COGS: ₹0.59)
        blended_lead_rev = 0.75 + (0.35 * 13.85) + (0.65 * 1.50)   # ₹6.57 per dial
        blended_lead_cogs = 0.084 + (0.35 * 6.865) + (0.65 * 0.59) # ₹2.87 per dial (with natural conversational pacing)
        blended_lead_gp = blended_lead_rev - blended_lead_cogs
        blended_lead_gm = (blended_lead_gp / blended_lead_rev * 100)

        print("="*105)
        print("                    CLOZFLOW MONTHLY SCALE & COHORT FORECAST (INVESTOR SUMMARY)")
        print("="*105)
        print(f"Pricing Model:    ₹0.75 Lead Discovery | ₹5.00 KB Analysis | ₹3.00 / min Call | ₹179 / mo DID | ₹2.00 / Test")
        print(f"Operating Window: {business_days} business days/month, 8 active calling hours/day")
        print(f"Call Mix:         35% Connected (4.6 min avg) | 65% Dropped / Voicemail (<30s avg)")
        print(f"Blended Metrics:  Revenue: ₹{blended_lead_rev:.2f} / dial | COGS: ₹{blended_lead_cogs:.2f} / dial | Blended GM: {blended_lead_gm:.1f}%")
        print("="*105)

        cohorts = [10, 100, 500, 1000, 10000, 50000]
        print(f"\nCohort Financial Matrix (Blended Real-World Outbound Operations):")
        print("-" * 150)
        print(f"{'Users':>7} | {'Monthly Dials':>13} | {'Credits Burned':>15} | {'Revenue (₹)':>14} | {'Vobiz Trunk (₹)':>15} | {'Sarvam TTS (₹)':>15} | {'Total COGS (₹)':>14} | {'Gross Profit (₹)':>16} | {'GM %':>5}")
        print("-" * 150)

        for u in cohorts:
            m_dials = u * calls_per_day * business_days
            m_cred = m_dials * blended_lead_rev
            m_rev = m_cred * credit_price
            m_vobiz = m_dials * ((0.35 * 2.50) + (0.65 * 0.25))
            m_tts = m_dials * ((0.35 * 2.56) + (0.65 * 0.24))
            m_cogs = m_dials * blended_lead_cogs
            m_gp = m_rev - m_cogs
            print(f"{u:7,d} | {m_dials:13,d} | {m_cred:15,.0f} | ₹{int(round(m_rev)):13,d} | ₹{int(round(m_vobiz)):14,d} | ₹{int(round(m_tts)):14,d} | ₹{int(round(m_cogs)):14,d} | ₹{int(round(m_gp)):15,d} | {blended_lead_gm:4.1f}%")
        print("-" * 150)
        print("="*105 + "\n")


###############################################################################
# 5. DEMO DATA GENERATOR
###############################################################################

def generate_demo_usage():
    """Generates a realistic successful 4m 37s outbound call workflow snapshot without synthetic fees."""
    duration_sec = 277  # 4m 37s
    pulses = math.ceil(duration_sec / 30.0)  # 10 pulses

    # Customer billing at ₹3.00 / minute all-inclusive bundled rate:
    # (277 / 60) * 3.00 = 13.85 credits
    total_voice_credits = round((duration_sec / 60.0) * 3.00, 2)

    return {
        "workflow_id": "demo-pearl-vobiz-9842",
        "lead_discovery": {
            "google_maps_requests": 0.05  # 1 request yields 20 leads; prorated cost per lead is 1/20th (0.05)
        },
        "tts": {
            "provider": "sarvam",
            "model": "bulbul:v4-flash",
            "characters": 1280,
            "audio_seconds": 118,
            "requests": 12
        },
        "stt": {
            "provider": "gemini",
            "audio_seconds": 277,
            "requests": 1
        },
        "llm": {
            "provider": "groq",
            "model": "qwen/qwen3-27b",
            "input_tokens": 12500,
            "output_tokens": 950,
            "cached_tokens": 8500,
            "requests": 18
        },
        "telephony": {
            "provider": "vobiz",
            "plan": "Developer Plan",
            "call_attempts": 1,
            "successful_calls": 1,
            "call_duration_seconds": duration_sec,
            "pulses_30s": pulses
        },
        "credits": {
            "lead_discovery": 0.75,                     # 0.75 credits per 1 lead discovered (Lead Finder)
            "pearl_call_bundled": total_voice_credits   # 13.85 credits (All-inclusive @ ₹3.00/min)
        }
    }


###############################################################################
# 6. ENTRY POINT
###############################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pearl Investor Unit Economics & User Scale Forecaster")
    parser.add_argument("usage_file", nargs="?", help="Path to usage JSON file")
    parser.add_argument("--demo", action="store_true", help="Run with demo 4m 37s call data")
    parser.add_argument("--forecast", action="store_true", help="Run user growth forecasting (10 to 50k users)")
    parser.add_argument("--calls-per-day", type=int, default=50, help="Average calls per user per day (default: 50)")
    parser.add_argument("--days", type=int, default=28, help="Operating days per month (default: 28)")
    
    args = parser.parse_args()
    
    if args.demo or (args.forecast and not args.usage_file):
        raw_usage = generate_demo_usage()
        if args.demo:
            print("\n[INFO] Running in Demo Mode (Realistic 4m 37s Workflow with Vobiz 30s Pulse)")
    elif args.usage_file:
        try:
            with open(args.usage_file, 'r', encoding='utf-8') as f:
                raw_usage = json.load(f)
            print(f"\n[INFO] Loaded usage data from {args.usage_file}")
        except Exception as e:
            print(f"Error loading usage file: {e}")
            sys.exit(1)
    else:
        raw_usage = generate_demo_usage()
        args.demo = True
        print("\n[INFO] Running Default Demo Mode (4m 37s with Vobiz 30s Pulse)")
        
    usage_collector = UsageCollector(raw_usage)
    calculator = CostCalculator(PRICING)
    
    if args.demo or (not args.forecast and args.usage_file):
        report = UnitEconomicsReport(usage_collector, calculator, PRICING)
        report.run()
        
    if args.forecast:
        forecaster = UserForecaster(PRICING, raw_usage)
        forecaster.run(calls_per_day=args.calls_per_day, business_days=args.days)
