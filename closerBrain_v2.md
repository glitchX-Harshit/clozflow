PROJECT: Hexagon - Closer Brain V2

GOAL:
  Transform AI from reactive responder → strategic deal closer

---

CORE_ARCHITECTURE:

  pipeline:
    - transcript_input
    - intent_detection
    - deal_stage_detection
    - strategy_selection
    - memory_check
    - tone_control
    - response_generation

---

MEMORY_SYSTEM:

  buffer_size: 8

  store:
    - last_messages (speaker + text)
    - last_intent
    - last_strategy_used
    - objection_history

  rules:
    - never repeat same strategy twice in last 3 turns
    - avoid repeating similar responses (semantic similarity check)

---

INTENT_DETECTION:

  types:
    - pricing
    - trust
    - timeline
    - authority
    - confusion
    - interest
    - neutral

  logic:
    - keyword + semantic classification
    - only trigger if speaker == "prospect"

---

DEAL_STAGE_DETECTION:

  stages:
    - discovery
    - problem
    - objection
    - closing

  logic:
    - based on conversation flow + intent

---

STRATEGY_ENGINE:

  strategies:

    ROI_REFRAME:
      use_when: pricing
      output_style: show value vs cost

    COST_OF_INACTION:
      use_when: hesitation
      output_style: highlight missed opportunity

    SOCIAL_PROOF:
      use_when: trust
      output_style: case study / others success

    DIAGNOSTIC_QUESTION:
      use_when: confusion
      output_style: ask smart question

    FUTURE_PACING:
      use_when: interest
      output_style: paint future outcome

    PILOT_CLOSE:
      use_when: closing
      output_style: low-risk entry

    DECISION_CONTROL:
      use_when: authority
      output_style: uncover decision process

  rules:
    - rotate strategies
    - avoid repeating last 2 used strategies
    - prioritize based on intent + stage

---

TONE_CONTROL:

  rules:
    - never sound desperate
    - avoid long explanations
    - use confident + guiding tone
    - mix statements + questions
    - lead conversation, don’t follow blindly

  examples:
    bad: "Our product helps you increase..."
    good: "That’s exactly where most teams struggle. Let me ask you this..."

---

RESPONSE_GENERATION:

  INPUT:
    - last 5–8 messages
    - detected intent
    - deal stage
    - selected strategy
    - memory state

  OUTPUT (STRICT JSON):

    {
      "intent": "...",
      "stage": "...",
      "strategy": "...",
      "confidence": 0.85,
      "response": "...",
      "next_question": "...",
      "coaching_tip": "..."
    }

---

ANTI_REPETITION:

  rules:
    - compare new response with last 3 responses
    - if similarity > 0.7 → regenerate
    - block repeated phrases like:
      - "our website helps..."
      - "increase your online presence..."

---

TRIGGER_CONTROL:

  conditions:
    - speaker == "prospect"
    - transcript length > 8 words
    - pause detected OR final transcript
    - cooldown: 2–3 seconds between AI calls

---

FALLBACK_SYSTEM:

  if API fails:
    - do NOT repeat last response
    - return short strategic question instead
    - example:
      "Can I ask — what’s the main hesitation right now?"

---

PERFORMANCE_RULES:

  max_latency: 2 sec
  max_calls_per_minute: 10
  batch_transcripts: true

---

FUTURE_UPGRADE (NOT NOW):

  - persona selection (SPIN / Challenger / MEDDIC)
  - fine-tuned model
  - deal scoring AI
  - conversation replay training