"""
Prospect Dialogue Generation Engine.
Generates realistic, dynamic prospect utterances responsive to Pearl's actual responses.
Supports deterministic rule-based simulation and external LLM simulation.
"""
import random
from typing import Dict, Any, List, Optional
from .persona_engine import PersonaEngine


class DialogueEngine:
    """
    Generates dynamic prospect responses reflecting Indian business communication patterns,
    objection injections, and sentiment shifts.
    """

    def __init__(self, seed: Optional[int] = 42):
        self.rng = random.Random(seed)

    def generate_next_utterance(
        self,
        engine: PersonaEngine,
        pearl_last_message: Optional[str],
        predefined_turns: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        turn_num = engine.state.turns_completed

        # 1. If predefined scripted turn exists for this turn index, use it as baseline
        if predefined_turns and turn_num < len(predefined_turns):
            user_input = predefined_turns[turn_num].get("user_input")
            if user_input and user_input.strip():
                return user_input

        # 2. Dynamic generation based on persona state and Pearl's last utterance
        state = engine.state
        lang = state.preferred_language.lower()

        # If Pearl just opened or haven't spoken yet
        if not pearl_last_message:
            if lang == "hindi":
                return "Namaste, aap kaun bol rahe hain aur kiske regarding call kiya hai?"
            elif lang == "hinglish":
                return "Haanji hello, kaun bol raha hai aur kis baare me call hai?"
            else:
                return "Hello, who is this and what is this regarding?"

        lower_pearl = pearl_last_message.lower()

        # If meeting scheduled or agreed
        if state.meeting_agreed:
            if lang == "hindi":
                return "Ji bilkul, kal do baje ka samay theek rahega. Dhanyavaad."
            elif lang == "hinglish":
                return "Haanji done, kal 3 PM ka invite bhej dijiye email par. Thank you!"
            else:
                return "Sounds good. Please send the calendar invite to my email. Thanks."

        # If patience exhausted
        if state.hung_up:
            if lang == "hindi":
                return "Mujhe abhi baat nahi karni hai. Kripya phone rakhein."
            elif lang == "hinglish":
                return "Boss abhi bohot busy hoon, please call cut kar raha hoon."
            else:
                return "I really don't have time right now. Please don't call back."

        # If Pearl offered a demo or asked for time
        if any(w in lower_pearl for w in ["demo", "schedule", "kal", "tomorrow", "convenient", "meeting", "time"]):
            if state.buying_intent >= 0.6:
                if lang == "hindi":
                    return "Haan, kal dopahar 3 baje hum 15 minute ke liye connect kar sakte hain."
                elif lang == "hinglish":
                    return "Haan theek hai, kal afternoon me 3:30 PM ka slot lock kar lo."
                else:
                    return "Sure, let's do a 15-minute walkthrough tomorrow at 3 PM."
            else:
                # Deflect to WhatsApp / Email
                if lang == "hindi":
                    return "Pehle aap mujhe WhatsApp par details bhej dijiye, main dekh ke batata hoon."
                elif lang == "hinglish":
                    return "Pehle ek baar WhatsApp par deck bhej do, main review karke batata hoon."
                else:
                    return "Can you just email me an overview first? I'll review and let you know."

        # If Pearl mentioned pricing
        if any(w in lower_pearl for w in ["pricing", "cost", "rupees", "inr", "plan", "kharcha"]):
            if state.price_sensitivity > 0.6:
                if lang == "hindi":
                    return "Ye toh thoda mehenga lag raha hai. Kya isme koi startup discount ya waiver milega?"
                elif lang == "hinglish":
                    return "Yaar pricing thodi steep hai hamare current stage ke hisaab se. Any concession possible?"
                else:
                    return "That seems somewhat high for our current volume. Are there any volume discounts?"
            else:
                if lang == "hinglish":
                    return "Okay, aur isme per-minute charges alag se hain ya included hain?"
                else:
                    return "Understood. Does this plan include telephony provider trunking fees?"

        # Inject target objection on turn 2 if specified and not yet raised
        if engine.target_objection and engine.target_objection not in state.objections_raised and turn_num == 1:
            state.objections_raised.append(engine.target_objection)
            if "competitor" in engine.target_objection.lower():
                return "Actually hum already doosra vendor use kar rahe hain, aap unse better kaise ho?"
            elif "whatsapp" in engine.target_objection.lower():
                return "Abhi thoda busy hoon, can you just drop the highlights on my WhatsApp?"
            elif "expensive" in engine.target_objection.lower() or "price" in engine.target_objection.lower():
                return "Hamara budget bohot tight hai iss quarter, pricing flexible hai kya?"

        # Default conversational follow-up
        if lang == "hindi":
            return "Samajh gaya. Lekin iska implementation kitne din me complete ho jayega?"
        elif lang == "hinglish":
            return "Achha, aur onboarding aur team training me kitna time lagta hai?"
        else:
            return "Got it. How easy is it to integrate with our existing stack?"
