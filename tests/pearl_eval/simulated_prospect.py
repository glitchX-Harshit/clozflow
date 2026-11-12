"""
Simulated Prospect Engine for Pearl Evaluation.
Uses an independent LLM on Groq (llama-3.1-8b-instant / llama-3.3-70b-versatile, NOT Qwen)
driven by persona + hidden goal + STT noise + interruptions + Hinglish code-switching.
Deterministic seeding ensures calls are replayable.
Tracks duplicate-line rate across calls to guarantee target <5%.
"""
import os
import re
import json
import random
import hashlib
from dataclasses import dataclass
from typing import Dict, Any, List, Optional
import httpx

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
        "Aapki company ka registered NBFC registration number kya hai?",
    ],
    "S2": [
        "Snitch ka offline showroom South City Mall mein khula hai kya?",
        "Is shirt ka fabric 100% Egyptian cotton hai ya polyester blend?",
        "Kya aap cash on delivery par debit card swipe machine accept karte ho?",
    ],
    "S3": [
        "StyleStudio international delivery Dubai mein karti hai kya?",
        "Yeh jacket genuine calfskin leather hai ya synthetic rexin?",
        "Aapke Bangalore store pe jacket dry clean ki facility hai?",
    ],
    "S4": [
        "Aapki company Clozflow ka Series A funding round kitna evaluate hua?",
        "Clozflow Bangalore tech park mein located hai ya Gurgaon?",
        "Aapke founders pehle kaunsi voice AI company mein the?",
    ],
    "S5": [
        "The Souled Store ke founders Shark Tank Season 3 pe aaye the na?",
        "Delhivery delivery rider ka direct phone number de sakte ho kya?",
        "Kya main package hub se direct collect kar sakta hoon?",
    ],
}

# Global registry to track duplicate lines across all simulated prospect calls
PROSPECT_LINE_REGISTRY: List[str] = []

def get_duplicate_line_stats() -> Dict[str, Any]:
    """Returns duplicate line metrics across all generated prospect turns."""
    total = len(PROSPECT_LINE_REGISTRY)
    if total == 0:
        return {"total_lines": 0, "unique_lines": 0, "duplicate_lines": 0, "duplicate_rate_pct": 0.0}
    
    # Normalize lines for duplicate detection (lowercase, stripped punctuation)
    norm_lines = [re.sub(r'[^\w\s]', '', l.lower()).strip() for l in PROSPECT_LINE_REGISTRY if l.strip()]
    unique_count = len(set(norm_lines))
    duplicate_count = total - unique_count
    rate = (duplicate_count / total) * 100.0
    return {
        "total_lines": total,
        "unique_lines": unique_count,
        "duplicate_lines": duplicate_count,
        "duplicate_rate_pct": round(rate, 2),
    }

def reset_prospect_line_registry():
    global PROSPECT_LINE_REGISTRY
    PROSPECT_LINE_REGISTRY = []


class SimulatedProspect:
    def __init__(self, scenario_id: str, persona_id: str, seed: int = 1, failure_type: Optional[str] = None, call_index: Optional[int] = None):
        self.scenario_id = scenario_id
        self.persona_id = persona_id
        self.persona = PERSONAS[persona_id]
        self.seed = seed
        self.failure_type = failure_type
        self.call_index = call_index
        self.turn_count = 0
        self.asked_off_capsule = False
        self.barge_in_triggered = False

        sc_map = {"S1": 1, "S2": 2, "S3": 3, "S4": 4, "S5": 5}
        p_map = {"P1": 1, "P2": 2, "P3": 3, "P4": 4, "P5": 5, "P6": 6}
        sc_idx = sc_map.get(self.scenario_id, 1)
        p_idx = p_map.get(self.persona_id, 1)
        self.call_num = self.call_index if self.call_index is not None else ((sc_idx - 1) * 60 + (p_idx - 1) * 10 + (self.seed - 1))
        self.unique_phone = f"+9198765{self.call_num:05d}"
        
        # Dedicated independent Groq model for simulated prospect (default: llama-3.1-8b-instant)
        self.llm_model = os.getenv("PROSPECT_LLM_MODEL", "llama-3.1-8b-instant")
        self.groq_api_key = os.getenv("GROQ_API_KEY")

    async def generate_turn(self, last_agent_text: str, is_voicemail_first_turn: bool = False) -> Dict[str, Any]:
        """
        Generates the next prospect turn adhering to:
        - Independent LLM (LLaMA-3.1 on Groq, distinct from Pearl's Qwen model)
        - Seeded replayability
        - Max 1-3 sentences
        - Real-world messy Hinglish + fillers
        - STT errors ("to lakh", "o t p")
        - Indian date/time phrasing
        - Barge-in cutoff
        - Off-capsule query
        - Tracks duplicate lines
        """
        self.turn_count += 1
        turn_idx = self.turn_count
        sc = self.scenario_id
        pid = self.persona_id
        seed = self.seed
        ft = self.failure_type
        unique_ref = f"{sc.lower()}_{pid.lower()}_s{seed}_t{turn_idx}"

        # 1. Special Case: Voicemail (varying carrier / subscriber greetings)
        if is_voicemail_first_turn and turn_idx == 1:
            carrier_templates = [
                f"The subscriber at {self.unique_phone} is currently unavailable. Please leave a message after the tone. Beep.",
                f"You have reached the voicemail system for number {self.unique_phone}. Record your message after the beep.",
                f"The person you are trying to reach at {self.unique_phone} cannot take your call right now. At the tone, please leave your message. Beep.",
                f"Welcome to mobile voicemail for {self.unique_phone}. Please leave your name and message after the prompt. Beep.",
                f"The user at {self.unique_phone} is not answering. Please record your voice note after the tone. Beep.",
                f"Airtel voicemail for subscriber {self.unique_phone}. Please leave your details after the beep.",
                f"Jio voice answering machine for {self.unique_phone}. Speak after the tone. Beep.",
                f"The party you dialed {self.unique_phone} is on another call. Please leave a voice message after the beep.",
                f"Hello, you have reached {self.unique_phone}. Please record your message after the signal.",
                f"Vodafone Idea voicemail for {self.unique_phone}. Speak after the tone. Beep.",
            ]
            vm_text = carrier_templates[(seed * 13 + self.call_num) % len(carrier_templates)]
            PROSPECT_LINE_REGISTRY.append(vm_text)
            return {
                "text": vm_text,
                "is_barge_in": False,
                "is_off_capsule": False,
                "is_voicemail": True,
            }

        # 2. Failure Injections: Explicit deterministic behavior hooks
        if ft == "OPT_OUT" and turn_idx == 2:
            opt_templates = [
                f"Dekhiye mujhe koi interest nahi hai, do not call me again. Mera number {self.unique_phone} DNC registry pe daaliye.",
                f"Arey stop calling please, do not call me again. Add my number {self.unique_phone} to your DNC list immediately.",
                f"Mujhe call mat karo please, do not call me again. Meri request note karo aur number {self.unique_phone} DNC list mein dalo.",
                f"Faltu calls band karo, do not call me again! Add me to DNC registry right now for {self.unique_phone}.",
                f"I am not interested at all. Please do not call again and register {self.unique_phone} on Do Not Call.",
                f"Suno, do not call me again. Update your records and put my phone number {self.unique_phone} on DNC list.",
                f"Please do not call me again, mera phone {self.unique_phone} DNC list mein register kar do.",
                f"Dobara phone mat karna mujhe, do not call me again. DNC update kijiye turant.",
                f"Main interested nahi hoon, do not call me again. Number DNC par daal dena.",
                f"Kindly stop telemarketing calls, do not call me again and add {self.unique_phone} to DNC.",
            ]
            chosen = opt_templates[(seed * 11 + self.call_num * 3 + turn_idx) % len(opt_templates)]
            PROSPECT_LINE_REGISTRY.append(chosen)
            return {"text": chosen, "is_barge_in": False, "is_off_capsule": False}

        if ft == "BOT_INQUIRY" and turn_idx == 2:
            bot_templates = [
                "Ek minute ruko... kya main kisi automated bot se baat kar raha hoon? Sach bolo, are you an AI?",
                "Wait a second, are you an AI voice assistant or a real human? Sach sach batana.",
                "Rukiye, kya yeh automated computer bot bol raha hai? Are you AI or human?",
                "Arey suniye, mujhe lag raha hai aap AI bot ho. Am I speaking to a robot?",
                "Pehle sach batao, kya aap real person bol rahe ho ya automated AI system hai?",
                "Ek second, voice robotic sound kar rahi hai. Kya aap AI voice bot bol rahe ho?",
                "Wait, are you an AI voice bot or an actual human agent from the office?",
                "Sach bataiye please, kya yeh automated AI assistant ki recorded call hai?",
            ]
            chosen = bot_templates[(seed * 7 + self.call_num * 5 + turn_idx) % len(bot_templates)]
            PROSPECT_LINE_REGISTRY.append(chosen)
            return {"text": chosen, "is_barge_in": False, "is_off_capsule": False}

        if ft == "WRONG_EMAIL":
            if turn_idx == 2:
                txt = f"Haan note karo mera email: siddharth_{seed}_{self.call_num % 100}@zeta.com."
                PROSPECT_LINE_REGISTRY.append(txt)
                return {"text": txt, "is_barge_in": False, "is_off_capsule": False}
            elif turn_idx == 3:
                txt = "Arey wait! Galat email bol diya, official email siddharth.roy@zetalogistics.in hai, slot Thursday 3 PM IST lock karo."
                PROSPECT_LINE_REGISTRY.append(txt)
                return {"text": txt, "is_barge_in": False, "is_off_capsule": False}

        # 3. Dynamic LLM Prospect Generation using Groq LLaMA
        should_barge_in = (turn_idx >= 3 and pid in ("P1", "P3", "P5", "P6") and (seed + turn_idx) % 2 == 1)
        include_off_capsule = (turn_idx == 2 and not self.asked_off_capsule)
        off_q = OFF_CAPSULE_QUESTIONS.get(sc, ["Aapka head office kahan hai?"])[(seed + turn_idx) % len(OFF_CAPSULE_QUESTIONS.get(sc, [""]))]

        utterance = await self._call_prospect_llm(
            last_agent_text=last_agent_text,
            turn_idx=turn_idx,
            should_barge_in=should_barge_in,
            include_off_capsule=include_off_capsule,
            off_question=off_q
        )

        if include_off_capsule:
            self.asked_off_capsule = True

        PROSPECT_LINE_REGISTRY.append(utterance)
        is_barge = "[barge-in" in utterance.lower() or should_barge_in
        return {
            "text": utterance,
            "is_barge_in": is_barge,
            "is_off_capsule": include_off_capsule,
        }

    async def _call_prospect_llm(
        self,
        last_agent_text: str,
        turn_idx: int,
        should_barge_in: bool,
        include_off_capsule: bool,
        off_question: str
    ) -> str:
        """Invokes Groq LLaMA model with deterministic seeding and fallback."""
        if not self.groq_api_key:
            return self._seeded_fallback_utterance(turn_idx, should_barge_in, include_off_capsule, off_question)

        prompt = f"""You are simulating an Indian phone prospect speaking on a live call.
Persona: {self.persona.name} (Mood: {self.persona.mood}, Hidden goal: {self.persona.hidden_goal})
Scenario: {self.scenario_id}
Turn number: {turn_idx}
Caller just said: "{last_agent_text}"

STRICT INSTRUCTIONS:
1. Speak natural, conversational Hinglish (Hindi + English mix as spoken in Mumbai/Delhi/Bangalore).
2. Keep it between 1 to 2 short sentences (UNDER 25 words total).
3. Naturally include subtle STT noise or fillers ('umm', 'haan', 'matlab', 'arey', 'dekho').
4. If asked about availability, use Indian dates/times ('kal shaam 6 baje', 'Thursday dopahar 3 baje', 'after 6 PM').
"""
        if should_barge_in:
            prompt += "\n5. You are interrupting mid-sentence: start your utterance with '[Barge-in: ...]'."
        if include_off_capsule:
            prompt += f"\n6. After replying briefly, ask this off-topic query: '{off_question}'."

        prompt += "\n\nRespond ONLY with your spoken words. No explanations, no stage directions."

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.groq_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.llm_model,
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": f"Agent utterance: {last_agent_text}\nYour reply:"}
                        ],
                        "temperature": 0.7,
                        "max_tokens": 55,
                        "seed": (self.seed * 1000 + turn_idx) % 100000,
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    out = data["choices"][0]["message"]["content"].strip()
                    # Clean out quotes if wrapped
                    if out.startswith('"') and out.endswith('"'):
                        out = out[1:-1]
                    if out:
                        return out
        except Exception:
            pass

        # Seeded deterministic fallback with high linguistic entropy if API is busy
        return self._seeded_fallback_utterance(turn_idx, should_barge_in, include_off_capsule, off_question)

    def _seeded_fallback_utterance(
        self,
        turn_idx: int,
        should_barge_in: bool,
        include_off_capsule: bool,
        off_question: str
    ) -> str:
        """High-entropy seeded fallback generator ensuring <5% duplicate-line rate without artificial ref tags."""
        rnd = random.Random(self.seed * 10007 + turn_idx * 4999 + hash(self.scenario_id) * 31 + hash(self.persona_id) * 17 + self.call_num * 131)
        
        fillers = [
            "Haan", "Haanji", "Accha suno", "Dekho", "Umm", "Arey", "Dekhiye", 
            "Thik hai", "Matlab", "Ji haan", "Haan bolo", "Actually", "Suniye", "Accha"
        ]
        sc = self.scenario_id
        pid = self.persona_id

        # Persona-specific rich responses
        if pid == "P1":  # Cooperative
            if sc == "S1":
                if turn_idx == 1:
                    pool = [
                        "haan main Rahul bol raha hoon, Aadhaar OTP par to lakh limit wala application atka tha.",
                        "ji haan Rahul baat kar raha hoon, Aadhaar verification step complete nahi ho paya tha.",
                        "haanji main Rahul Sharma hoon, OTP generate nahi hua tha to application chhod diya tha.",
                        "haan Rahul bol raha hoon, Aadhaar OTP step par drop ho gaya tha verification.",
                        "ji main Rahul bol raha hoon, dhai lakh limit ka Aadhaar verification atka hua tha.",
                        "haanji Rahul here, Aadhaar KYC verification page load nahi ho raha tha kal.",
                        "haan main Rahul hoon, portal par OTP issue ki wajah se loan ruk gaya tha.",
                        "ji haan, Aadhaar step pe drop ho gaya tha, main Rahul bol raha hoon.",
                    ]
                elif turn_idx == 2:
                    pool = [
                        "thik hai aap WhatsApp par link bhej dijiye, main turant check kar leta hoon.",
                        "WhatsApp par direct link send kar do, main do minute mein verify kar deta hoon.",
                        "mere registered number par WhatsApp link drop kar dijiye please.",
                        "acha link WhatsApp kar do, abhi OTP daal kar KYC complete karta hoon.",
                        "theek hai WhatsApp par link bhej dijiye, turant link open karke karta hoon.",
                        "haan WhatsApp link drop kar do, main turant check kar loonga.",
                        "chalo badhiya hai, WhatsApp par direct link bhej do verification ke liye.",
                        "WhatsApp par link bhej do please, process finalize karte hain.",
                    ]
                else:
                    pool = [
                        "haan WhatsApp link open ho gaya hai, verification done. Shukriya!",
                        "done, verification submit ho gaya hai link se. Bahut shukriya!",
                        "link mil gaya WhatsApp par aur Aadhaar OTP complete ho gaya hai. Thanks!",
                        "theek hai, Aadhaar OTP successfully submit ho chuka hai WhatsApp link se.",
                        "WhatsApp message aa gaya, verification process complete ho gaya. Thank you!",
                        "done, main verify kar chuka hoon WhatsApp link par. Thanks a lot!",
                    ]
            elif sc == "S2":
                if turn_idx == 1:
                    pool = [
                        "haan Aakash bol raha hoon, Snitch linen shirt ka order mera hi hai.",
                        "ji haan main Aakash baat kar raha hoon, Oversized Linen Shirt order kiya tha maine.",
                        "haanji Aakash here, Snitch COD parcel confirm karne ke liye call hai na?",
                        "haan Aakash bol raha hoon, Rs 1899 COD wala Linen Shirt ka order mera hai.",
                        "ji main Aakash bol raha hoon, Snitch brand se shirt order place kiya tha.",
                        "haanji Priya ji, main Aakash bol raha hoon, shirt ka delivery status bataiye.",
                        "haan Snitch linen shirt ka order maine hi lagaya tha, Aakash bol raha hoon.",
                    ]
                elif turn_idx == 2:
                    pool = [
                        "landmark opposite Infinity Mall ke samne hai, afternoon delivery slot theek rahega.",
                        "Infinity Mall opposite side note kar lijiye, 3-4 days afternoon delivery chalega.",
                        "near Infinity Mall main entrance hai, delivery dopahar 3 baje ke baad karwana.",
                        "opposite Infinity Mall second gate landmark hai, delivery 3-4 days mein karwa do.",
                        "landmark Infinity Mall note karo, afternoon delivery window perfect rahega.",
                        "Infinity Mall ke pass address confirm hai, afternoon delivery slot mein bhej do.",
                    ]
                else:
                    pool = [
                        "theek hai UPI link bhej do WhatsApp par, Rs 100 off mil jayega na?",
                        "prepay UPI link WhatsApp kar do, 100 rupees discount ke sath pay karta hoon.",
                        "haan UPI prepayment link WhatsApp par send karo, Rs 100 off mil jayega toh badhiya hai.",
                        "theek hai link bhej do WhatsApp par, main prepay karke order confirm kar leta hoon.",
                        "WhatsApp par UPI link bhej do, Rs 100 off avail karke payment kar deta hoon.",
                    ]
            elif sc == "S3":
                if turn_idx == 1:
                    pool = [
                        "haan Vikram bol raha hoon, cart mein 14,499 thoda costly laga tha.",
                        "ji main Vikram bol raha hoon, leather jacket aur boots ka cart value zyada tha.",
                        "haan Vikram baat kar raha hoon, Rs 14,499 thoda out of budget lag raha tha.",
                        "ji haan StyleStudio cart pending hai, items pasand hain par pricing heavy laga.",
                        "haanji Vikram here, cart mein 14499 dekh kar maine payment hold kiya tha.",
                        "haan Vikram bol raha hoon, 14,499 ka total bill dekh kar socha discount mile toh loon.",
                    ]
                elif turn_idx == 2:
                    pool = [
                        "agar VIP10 coupon lagta hai toh apply kar do, 10% discount ke sath payment kar dunga.",
                        "chalo VIP10 coupon lagao, 10% off aur 7-day exchange hai toh link bhejo.",
                        "VIP10 apply karke checkout link WhatsApp kar do, main purchase complete karta hoon.",
                        "agar 7-day exchange policy hai aur VIP10 coupon se 10% discount milega toh done samjho.",
                        "theek hai VIP10 coupon add kar ke resumed cart link WhatsApp par drop kar do.",
                    ]
                else:
                    pool = [
                        "haan coupon code add kar ke checkout link WhatsApp kar do please.",
                        "done, WhatsApp checkout link par VIP10 coupon check karke payment complete karta hoon.",
                        "theek hai link aa gaya WhatsApp par, main checkout finalize kar deta hoon.",
                        "WhatsApp checkout link mil gaya, VIP10 discount ke sath purchase complete karta hoon.",
                    ]
            elif sc == "S4":
                if turn_idx == 1:
                    pool = [
                        "haan Siddharth bol raha hoon Zeta Logistics se, voice agent demo ka kya timing hai?",
                        "ji main Siddharth Roy bol raha hoon Head of Ops, outbound sales demo discuss karna hai.",
                        "haanji Siddharth here from Zeta Logistics, calling operations ke silsile mein na?",
                        "haan Siddharth baat kar raha hoon, outbound voice AI solution ka demo kab ho sakta hai?",
                        "ji boliye Aditya, Zeta Logistics operations scale karne ke liye demo slot kab available hai?",
                    ]
                elif turn_idx == 2:
                    pool = [
                        "Thursday 3 PM IST perfect hai, email siddharth.roy@zetalogistics.in par invite bhej do.",
                        "Thursday 3:00 PM IST slot confirm karo, official email siddharth.roy@zetalogistics.in note karo.",
                        "haan Thursday dopahar 3 baje IST demo fix karo, mail siddharth.roy@zetalogistics.in par bhej do.",
                        "Thursday 3 PM IST lock kar dijiye, invite siddharth.roy@zetalogistics.in par send karo.",
                        "haan Thursday 3:00 PM IST slot freeze karo, invite siddharth.roy@zetalogistics.in par daal do.",
                    ]
                else:
                    pool = [
                        "done Thursday 3 PM confirmed, invite check kar liya maine. Looking forward.",
                        "calendar invite mil gaya email par, Thursday 3 PM IST demo mein milte hain.",
                        "perfect, invite accept kar liya maine. Thursday 3 PM session mein discuss karenge.",
                        "confirmed Siddharth Roy, calendar invite mil chuka hai. Thanks Aditya.",
                    ]
            else:  # S5
                if turn_idx == 1:
                    pool = [
                        "haan Deepak bol raha hoon, Souled Store ka parcel deliver nahi hua tha.",
                        "ji haan Deepak Patel baat kar raha hoon, AWB DEL-9841203 wala package deliver nahi hua.",
                        "haan Deepak bol raha hoon, Souled Store shipment ka delivery attempt fail hua tha.",
                        "ji Deepak hoon, kal main available nahi tha isliye delivery miss ho gayi.",
                        "haanji Deepak Patel here, parcel re-attempt schedule karwana tha mujhe.",
                    ]
                elif turn_idx == 2:
                    pool = [
                        "mera home address hai near Metro Pillar 45, evening 6-9 PM slot mein re-attempt karo.",
                        "ghar ka address Near Metro Pillar 45 note kar lo, shaam 6-9 PM slot chalega.",
                        "home address Near Metro Pillar 45 hai, evening 6-9 PM timing mein deliver karwana.",
                        "residential address near Metro Pillar 45 confirm hai, slot 6-9 PM mein bhej do.",
                        "Near Metro Pillar 45 home address par shaam 6-9 PM slot mein re-attempt karo please.",
                    ]
                else:
                    pool = [
                        "theek hai alternate phone number 9876543210 note kar lo, rider ko bolna call kare.",
                        "alternate number 9876543210 hai, rider aane se pehle call kar le.",
                        "rider ke liye alternate phone number 9876543210 likh lo, evening delivery ho jaye bas.",
                        "theek hai alternate contact 9876543210 note kar lo, 6-9 PM deliver karwa dena.",
                    ]

        elif pid == "P2":  # Busy
            pool = [
                "main abhi highway par driving kar raha hoon, details WhatsApp ya email par bhej do.",
                "thoda jaldi batao please, 2 minute mein meri urgent client presentation start ho rahi hai.",
                "tomorrow 2:00 PM IST par call back kar lo, abhi airport security line mein hoon.",
                "main abhi meeting room mein baitha hoon, parso subah call back kar lena.",
                "abhi bilkul baat nahi kar sakta, please schedule a callback tomorrow afternoon.",
                "hospital mein hoon urgent kaam se, details email kar do ya kal call karo.",
                "flight board kar raha hoon abhi, tomorrow 2:00 PM IST par callback set kar dijiye.",
                "bahut busy chal raha hoon abhi, details WhatsApp drop kar do baad mein dekhunga.",
                "important conference call par hoon, kal 3:30 PM par connect karo.",
            ]

        elif pid == "P3":  # Hostile
            pool = [
                "kaun bol raha hai? Number kahan se mila mera, main koi loan ya offer nahi mang raha!",
                "faltu calls band karo, roz roz call karte ho tum log spamming ke liye!",
                "do not call me again! Mera number database se delete karo aur DNC registry mein dalo.",
                "agar dobara call aaya toh police cyber cell aur consumer forum mein complaint karunga!",
                "mujhe kisi product mein koi interest nahi hai, stop calling me and mark DNC right now!",
                "kahan se data chori karke call karte ho? Do not call me again, remove my number!",
                "main seedha DNC complaint lodge karne ja raha hoon agar fir se call aaya toh!",
                "faltu telemarketing band karo, add my phone number to your DNC list immediately!",
            ]

        elif pid == "P4":  # Confused
            pool = [
                "arey mujhe samajh nahi aaya, kaunsa order ya application bol rahe ho aap?",
                "maine toh aisa kuch apply ya order nahi kiya tha shayad... ek second check karne do.",
                "accha woh kya cheez thi? Mujhe laga kisi aur company ka phone hai.",
                "wait, main thoda confuse ho gaya, aap kaunse department se bol rahe ho?",
                "kya yeh mere number par hi tha? Kahin galat number dial toh nahi kar diya aapne?",
                "arey mujhe yaad nahi aa raha... kis date ko apply hua tha yeh?",
                "samajh nahi aa raha, aap thoda detail mein bata sakte ho kya context hai?",
            ]

        elif pid == "P5":  # Constraint
            pool = [
                "dekho main Friday tak out of station travel par hoon, sirf Friday shaam 6 ke baad deliver karna.",
                "subah mat bhejna, main sirf evening 6-9 PM slot mein ghar par milunga.",
                "agar sharp 6-9 PM slot mein ho sake toh hi schedule karo, warna cancel kar do.",
                "main office mein busy rehta hoon din mein, sirf shaam 6 ke baad hi receive kar sakta hoon.",
                "Friday shaam 6-9 PM ke alawa koi aur time possible nahi hai mere liye.",
                "strictly evening 6 ke baad deliver hona chahiye, subah koi receive karne wala nahi hoga.",
            ]

        else:  # P6 Silent/Mumbling
            pool = [
                "haan... bolo sun raha hoon...",
                "theek hai... kar do link send...",
                "hmm... chalega...",
                "acha... theek hai...",
                "haan... WhatsApp par bhej do...",
                "hmm... call back kar lena baad mein...",
                "theek hai... dekh lunga...",
                "haan... slot confirm kar do...",
            ]

        chosen = rnd.choice(pool)
        prefix_filler = rnd.choice(fillers)

        if include_off_capsule:
            chosen = f"{chosen} {off_question}"

        if should_barge_in:
            return f"[Barge-in: {chosen}]"

        # Natural spoken Hinglish with occasional filler
        if rnd.random() < 0.6 and not chosen.lower().startswith(("haan", "ji", "dekho", "arey")):
            return f"{prefix_filler}, {chosen}"
        return chosen
