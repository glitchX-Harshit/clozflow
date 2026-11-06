"""
Simulated Prospect Engine for Pearl Evaluation.
Implements the 6 real-world messy personas with Hinglish code-switching,
fillers, STT errors, Indian dates, barge-in mid-turn cuts, off-capsule queries,
and max 3 sentences per turn.
"""
from dataclasses import dataclass
from typing import Dict, Any, List, Optional

@dataclass
class PersonaProfile:
    id: str
    name: str
    hidden_goal: str
    mood: str
    difficulty: str  # easy | medium | hard

PERSONAS: Dict[str, PersonaProfile] = {
    "P1": PersonaProfile(
        id="P1",
        name="Cooperative",
        hidden_goal="Get verification/issue resolved quickly without fuss",
        mood="Pleasant, hurried, cooperative",
        difficulty="easy",
    ),
    "P2": PersonaProfile(
        id="P2",
        name="Busy",
        hidden_goal="Deflect call quickly, ask to email or schedule later",
        mood="Hurried, distracted, impatient",
        difficulty="medium",
    ),
    "P3": PersonaProfile(
        id="P3",
        name="Hostile/suspicious",
        hidden_goal="Defend against suspected fraud/spam, threaten blocking/complaint",
        mood="Aggressive, defensive, angry",
        difficulty="hard",
    ),
    "P4": PersonaProfile(
        id="P4",
        name="Confused/off-topic",
        hidden_goal="Express confusion over identity/order and ask unrelated questions",
        mood="Bewildered, wanderlust, slow",
        difficulty="medium",
    ),
    "P5": PersonaProfile(
        id="P5",
        name="Constraint-driven",
        hidden_goal="Strictly enforce time/location constraint; reject if violated",
        mood="Firm, practical, assertive",
        difficulty="hard",
    ),
    "P6": PersonaProfile(
        id="P6",
        name="Silent/mumbling",
        hidden_goal="Minimal effort, monosyllabic replies, sudden mid-sentence barge-ins",
        mood="Taciturn, mumbling, unpredictable",
        difficulty="hard",
    ),
}

# Off-capsule questions per scenario
OFF_CAPSULE_QUESTIONS = {
    "S1": [
        "Waise aapka CredPulse office Bangalore mein kahan hai?",
        "Aap log personal loan ke sath car loan aur credit card bhi offer karte ho kya?",
    ],
    "S2": [
        "Snitch ka offline showroom South City Mall mein khula hai kya?",
        "Is shirt ka fabric 100% Egyptian cotton hai ya polyester blend?",
    ],
    "S3": [
        "StyleStudio international delivery Dubai mein karti hai kya?",
        "Yeh jacket genuine calfskin leather hai ya synthetic rexin?",
    ],
    "S4": [
        "Aapki company Clozflow ka Series A funding round kitna evaluate hua?",
        "Clozflow Bangalore tech park mein located hai ya Gurgaon?",
    ],
    "S5": [
        "The Souled Store ke founders Shark Tank Season 3 pe aaye the na?",
        "Delhivery delivery rider ka direct phone number de sakte ho kya?",
    ],
}

class SimulatedProspect:
    def __init__(self, scenario_id: str, persona_id: str, seed: int = 1, failure_type: Optional[str] = None):
        self.scenario_id = scenario_id
        self.persona_id = persona_id
        self.persona = PERSONAS[persona_id]
        self.seed = seed
        self.failure_type = failure_type
        self.turn_count = 0
        self.asked_off_capsule = False
        self.barge_in_triggered = False

    def generate_turn(self, last_agent_text: str, is_voicemail_first_turn: bool = False) -> Dict[str, Any]:
        """
        Generates the next prospect turn adhering to:
        - Max 3 sentences
        - Real-world messy Hinglish + fillers
        - STT errors ("to lakh", "o t p")
        - Indian date phrasing
        - Interruption / barge-in cutoff
        - Off-capsule query
        - Failure injection handling
        """
        self.turn_count += 1
        turn_idx = self.turn_count
        sc = self.scenario_id
        pid = self.persona_id
        seed = self.seed
        ft = self.failure_type

        # Special Case: VOICEMAIL failure injection on Turn 1
        if is_voicemail_first_turn and turn_idx == 1:
            return {
                "text": "The person you are calling is currently on another call. Please leave a message after the tone. Beep.",
                "is_barge_in": False,
                "is_off_capsule": False,
                "is_voicemail": True,
            }

        # Check for failure injection specific overrides
        # 1. OPT_OUT: "do not call me again"
        if ft == "OPT_OUT" and turn_idx == 2:
            return {
                "text": "Arey dekho, do not call me again. Mera number DNC registry pe dalo aur phone kaato.",
                "is_barge_in": False,
                "is_off_capsule": False,
            }

        # 2. BOT_INQUIRY: "kya main bot se baat kar raha hoon?"
        if ft == "BOT_INQUIRY" and turn_idx == 2:
            return {
                "text": "Ek minute ruko... kya main bot se baat kar raha hoon? Sach bolo, are you an AI?",
                "is_barge_in": False,
                "is_off_capsule": False,
            }

        # 3. WRONG_EMAIL (S4 specific or general)
        if ft == "WRONG_EMAIL":
            if turn_idx == 2:
                return {
                    "text": "Haan note karo email: siddharth@zeta.com.",
                    "is_barge_in": False,
                    "is_off_capsule": False,
                }
            elif turn_idx == 3:
                return {
                    "text": "Arey wait! Galat email bol diya, official email siddharth.roy@zetalogistics.in hai, slot Thursday 3 PM IST lock karo.",
                    "is_barge_in": False,
                    "is_off_capsule": False,
                }

        # Routine Dialogue Tree per Persona & Scenario
        prospect_utterance = ""
        is_barge_in = False
        is_off_capsule = False

        # Get off-capsule question for Turn 2
        off_q = OFF_CAPSULE_QUESTIONS.get(sc, ["Aapka head office kahan hai?"])[seed % len(OFF_CAPSULE_QUESTIONS.get(sc, [""])) ]

        # ── P1: COOPERATIVE ────────────────────────────────────────────────────────
        if pid == "P1":
            if sc == "S1":
                if turn_idx == 1:
                    prospect_utterance = "Haan, main Rahul bol raha hoon. Aadhaar o t p par to lakh limit wala application atka tha."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Theek hai, aap WhatsApp par link bhej do. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Haan link check kar liya, done! Shukriya.]"

            elif sc == "S2":
                if turn_idx == 1:
                    prospect_utterance = "Haan Aakash bol raha hoon. Snitch linen shirt ka order mera hi hai."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Landmark Infinity Mall ke opposite hai, afternoon delivery chalegi. Aur {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Haan UPI link WhatsApp par bhej do, Rs 100 off milega na? Address theek hai.]"

            elif sc == "S3":
                if turn_idx == 1:
                    # Raises price objection once to allow VIP10
                    prospect_utterance = "Haan Vikram bol raha hoon. Checkout page pe 14,499 thoda expensive laga toh chod diya."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Achha agar VIP10 coupon lagta hai toh apply kar do. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Haan discount laga ke link WhatsApp par bhej do, main complete karta hoon.]"

            elif sc == "S4":
                if turn_idx == 1:
                    prospect_utterance = "Haan Siddharth bol raha hoon Zeta Logistics se. Voice agent demo ka kya timing hai?"
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Email note kar lo: siddharth.roy@zetalogistics.in. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Thursday 3 PM IST slot confirm hai na? Meeting book kar lo.]"

            elif sc == "S5":
                if turn_idx == 1:
                    prospect_utterance = "Haan Deepak Patel bol raha hoon. Delhivery parcel ka re-attempt karwana hai."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Home address hai, slot 2-5 PM rakhna, landmark City Hospital gate 2. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Alternate phone 9876543210 note kar lo aur reschedule confirm karo.]"

        # ── P2: BUSY ───────────────────────────────────────────────────────────────
        elif pid == "P2":
            if sc == "S1":
                if turn_idx == 1:
                    prospect_utterance = "Dekhiye abhi meeting mein hoon, baad mein call karo ya WhatsApp par link daal do."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Matlab parso shaam ko call karna. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Haan bas link bhej do, main baad mein dekh loonga.]"

            elif sc == "S2":
                if turn_idx == 1:
                    prospect_utterance = "Haan order theek hai par abhi client call mein hoon. Jaldi batao."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Delivery agle Monday 3-4 days window mein kar dena. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Landmark Axis Bank ATM hai, address read back karke confirm karo jaldi.]"

            elif sc == "S3":
                if turn_idx == 1:
                    prospect_utterance = "Haan abhi thoda busy hoon, 14,499 cart total zyada hai. Discount hai kya koi?"
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Friday subah 11 baje se pehle time nahi hai. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: VIP10 coupon laga ke direct checkout link bhej do WhatsApp pe.]"

            elif sc == "S4":
                if turn_idx == 1:
                    prospect_utterance = "Arey meeting mein hoon, pitch deck email bhej do na siddharth.roy@zetalogistics.in pe."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Direct calendar link bhej do, agle Monday IST mein connect karenge. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Haan deck send kar do, main review karke slot confirm karta hoon.]"

            elif sc == "S5":
                if turn_idx == 1:
                    prospect_utterance = "Office presentation mein hoon. AWB DEL-9841203 kal 2-5 PM deliver kar do."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Office address hai, landmark cyber hub, alternate number 9811223344. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Reschedule confirm karke call cut karo, jaldi.]"

        # ── P3: HOSTILE / SUSPICIOUS ───────────────────────────────────────────────
        elif pid == "P3":
            if turn_idx == 1:
                prospect_utterance = "Arey kaun ho tum log? Kahan se number mila mera? Fraud lag raha hai, spam band karo!"
            elif turn_idx == 2:
                is_off_capsule = True
                prospect_utterance = f"Mujhe koi sales pitch nahi chahiye. {off_q}"
            else:
                is_barge_in = True
                prospect_utterance = "[Barge-in: Do not call me again! DNC pe daalo varna cyber cell mein complaint karunga.]"

        # ── P4: CONFUSED / OFF-TOPIC ───────────────────────────────────────────────
        elif pid == "P4":
            if turn_idx == 1:
                prospect_utterance = "Hello? Kaunsa order bhai? Kisko lagaya hai phone... main toh so raha tha."
            elif turn_idx == 2:
                is_off_capsule = True
                prospect_utterance = f"Achha yeh batao, {off_q} Mujhe pehle yeh clarify karo."
            else:
                is_barge_in = True
                prospect_utterance = "[Barge-in: Arey ruko, mujhe samajh nahi aa raha, WhatsApp pe details send karo pehle.]"

        # ── P5: CONSTRAINT-DRIVEN ──────────────────────────────────────────────────
        elif pid == "P5":
            if sc == "S1":
                if turn_idx == 1:
                    prospect_utterance = "Dekhiye main abhi out of town travel kar raha hoon, Friday shaam ko 6 ke baad hi phone uthaunga."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Aadhaar OTP sirf Friday shaam ko 6 ke baad ho sakega. Aur {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Callback Friday shaam 6:30 PM schedule karo, aur link WhatsApp par dalo.]"

            elif sc == "S2":
                if turn_idx == 1:
                    prospect_utterance = "Main travelling till Friday hoon. Delivery strictly Friday shaam ko 6 ke baad hi ho sakti hai."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Landmark Blue Dart office ke paas, delivery window strictly Friday shaam. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Address read back karo aur Friday shaam se pehle mat bhejna.]"

            elif sc == "S3":
                if turn_idx == 1:
                    prospect_utterance = "14,499 bohot zyada hai budget se! Jab tak discount nahi milta main nahi khareedunga."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"VIP10 apply karke WhatsApp link do, par payment sirf parso shaam 6 ke baad karunga. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Coupon apply kiya ya nahi? Pehle confirm karo.]"

            elif sc == "S4":
                if turn_idx == 1:
                    prospect_utterance = "Main out of station hoon, Friday shaam ko 6 ke baad hi available hoon demo ke liye."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Slot strictly Friday 6:30 PM IST rakhna, email siddharth.roy@zetalogistics.in. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Slot read back karke confirm karo, 6 ke pehle bilkul nahi.]"

            elif sc == "S5":
                if turn_idx == 1:
                    prospect_utterance = "Subah bilkul deliver mat karna! Main sirf shaam ko 6-9 PM slot mein ghar par milunga."
                elif turn_idx == 2:
                    is_off_capsule = True
                    prospect_utterance = f"Home address hai, landmark metro pillar 45, strictly 6-9 PM slot. {off_q}"
                else:
                    is_barge_in = True
                    prospect_utterance = "[Barge-in: Alternate phone 9876543210 hai, 6-9 PM slot read back karke confirm karo.]"

        # ── P6: SILENT / MUMBLING ──────────────────────────────────────────────────
        elif pid == "P6":
            if turn_idx == 1:
                prospect_utterance = "Haan..."
            elif turn_idx == 2:
                is_off_capsule = True
                prospect_utterance = f"...hmm. Theek hai. {off_q}"
            else:
                is_barge_in = True
                prospect_utterance = "[Barge-in: Arey suno na! Ek baar mein link WhatsApp pe daalo aur baat khatam karo.]"

        # Fallback if empty
        if not prospect_utterance:
            prospect_utterance = "Haan theek hai, aap details bhej dijiye."

        # Safety enforce: Max 3 sentences
        sentences = [s.strip() for s in prospect_utterance.replace("!", ".").replace("?", ".").split(".") if s.strip()]
        if len(sentences) > 3:
            prospect_utterance = ". ".join(sentences[:3]) + "."

        return {
            "text": prospect_utterance,
            "is_barge_in": is_barge_in,
            "is_off_capsule": is_off_capsule,
            "is_voicemail": False,
        }
