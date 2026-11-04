import json
import os
import random
import uuid
import urllib.request
import urllib.error
import time
from datetime import datetime, timedelta, timezone
from typing import Any

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"

def utc_now():
    return datetime.now(timezone.utc)

def call_gemini(prompt: str) -> str:
    """Call Gemini API and return the text."""
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.9,
            "responseMimeType": "application/json"
        }
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(GEMINI_URL, data=data, headers={'Content-Type': 'application/json'})

    max_retries = 3
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                result = json.loads(response.read().decode('utf-8'))
                return result['candidates'][0]['content']['parts'][0]['text']
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"Rate limited. Waiting 10 seconds... (Attempt {attempt+1}/{max_retries})")
                time.sleep(10)
            else:
                print(f"HTTP Error: {e.code} - {e.read().decode()}")
                time.sleep(2)
        except Exception as e:
            print(f"Error calling Gemini: {e}")
            time.sleep(2)
    return "[]"

def generate_conversations_batch(batch_size=10):
    prompt = f"""
    You are generating realistic sales transcripts for a B2B SaaS product.
    Generate an array of {batch_size} independent conversations.
    Each conversation is an array of turns between a Salesperson and a Buyer.
    The dialogues should have between 4 and 10 turns.
    CRITICAL: The buyer should NOT be ideal. They should have objections, interruptions, budget concerns, express confusion, or be pressed for time. Make it sound like a real, sometimes messy human conversation.

    Return a JSON array of arrays.
    Format:
    [
      [
        {{"speaker": "SALESPERSON", "text": "Hi, thanks for joining..."}},
        {{"speaker": "BUYER", "text": "Yeah, I only have 5 minutes..."}}
      ],
      [
        ...
      ]
    ]
    """

    print(f"Requesting {batch_size} conversations from Gemini...")
    response_text = call_gemini(prompt)
    try:
        conversations = json.loads(response_text)
        return conversations
    except json.JSONDecodeError:
        print("Failed to decode JSON from Gemini. Fallback to empty.")
        return []

def package_events(session_id, index, conversation_turns):
    tenant_id = str(uuid.uuid4())
    events: list[dict[str, Any]] = []

    start_time = utc_now()
    events.append({
        "event_id": str(uuid.uuid4()),
        "event_type": "SESSION_START",
        "session_id": session_id,
        "tenant_id": tenant_id,
        "timestamp_utc": start_time.isoformat(),
        "sequence_num": 0,
        "source": "simulator",
        "priority": 1,
        "ttl_ms": 500,
        "payload": {
            "salesperson_id": f"sp_{index}",
            "crm_opportunity_id": f"opp_{index}"
        },
        "confidence": 1.0,
        "metadata": {}
    })

    current_time = start_time
    seq = 1

    for turn in conversation_turns:
        speaker = turn.get("speaker", "SALESPERSON")
        text = turn.get("text", "")

        current_time += timedelta(seconds=random.randint(2, 5))
        events.append({
            "event_id": str(uuid.uuid4()),
            "event_type": "TRANSCRIPT_SEGMENT",
            "session_id": session_id,
            "tenant_id": tenant_id,
            "timestamp_utc": current_time.isoformat(),
            "sequence_num": seq,
            "source": "simulator",
            "priority": 1,
            "ttl_ms": 200,
            "payload": dict(
                text=text,
                speaker_id="SPEAKER_1" if speaker == "SALESPERSON" else "SPEAKER_2",
                speaker_role=speaker,
                start_ms=int((current_time - start_time).total_seconds() * 1000),
                end_ms=int((current_time - start_time).total_seconds() * 1000) + 1500,
                is_final=True,
                language="en-US"
            ),
            "confidence": random.uniform(0.85, 0.99),
            "metadata": {}
        })
        seq += 1

    current_time += timedelta(seconds=5)
    events.append({
        "event_id": str(uuid.uuid4()),
        "event_type": "SESSION_END",
        "session_id": session_id,
        "tenant_id": tenant_id,
        "timestamp_utc": current_time.isoformat(),
        "sequence_num": seq,
        "source": "simulator",
        "priority": 1,
        "ttl_ms": 500,
        "payload": {
            "status": "COMPLETED"
        },
        "confidence": 1.0,
        "metadata": {}
    })

    return events

def main():
    target_dir = os.path.join(os.path.dirname(__file__), "..", "data", "simulation_corpus")
    os.makedirs(target_dir, exist_ok=True)

    # Clear existing corpus
    for f in os.listdir(target_dir):
        if f.endswith(".json"):
            os.remove(os.path.join(target_dir, f))

    num_sessions = 130
    batch_size = 10
    total_generated = 0

    print(f"Generating {num_sessions} simulated sessions to {target_dir} using Gemini...")

    while total_generated < num_sessions:
        current_batch_size = min(batch_size, num_sessions - total_generated)
        conversations = generate_conversations_batch(current_batch_size)

        if not conversations:
            print("Received empty or invalid batch, retrying...")
            time.sleep(2)
            continue

        for conv in conversations:
            total_generated += 1
            session_id = str(uuid.uuid4())
            events = package_events(session_id, total_generated, conv)

            file_path = os.path.join(target_dir, f"session_{session_id}.json")
            with open(file_path, "w") as f:
                json.dump(events, f, indent=2)

        print(f"Progress: {total_generated}/{num_sessions}")
        time.sleep(1) # Prevent rate limiting

    print("Done. Realistic Tier 4 Simulation Corpus generated.")

if __name__ == "__main__":
    main()
