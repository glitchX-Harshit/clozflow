from pathlib import Path
import os
import json

def convert():
    corpus_dir = str(Path(__file__).resolve().parents[1] / "data/simulation_corpus")
    output_file = str(Path(__file__).resolve().parents[1] / "data/readable_conversations.md")
    
    if not os.path.exists(corpus_dir):
        print(f"Directory {corpus_dir} does not exist.")
        return

    files = [f for f in os.listdir(corpus_dir) if f.endswith(".json")]
    print(f"Found {len(files)} conversation files.")
    
    with open(output_file, "w", encoding="utf-8") as out:
        out.write("# 130 Simulated B2B Sales Conversations\n\n")
        out.write("This file contains the clean transcripts of all 130 generated B2B SaaS sales conversations, extracted from the raw JSON telemetry events.\n\n---\n\n")
        
        for idx, filename in enumerate(sorted(files), 1):
            filepath = os.path.join(corpus_dir, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    events = json.load(f)
                
                session_id = filename.replace("session_", "").replace(".json", "")
                out.write(f"## Conversation {idx} (Session ID: `{session_id}`)\n\n")
                
                transcript_found = False
                for event in events:
                    if event.get("event_type") == "TRANSCRIPT_SEGMENT":
                        payload = event.get("payload", {})
                        speaker = payload.get("speaker_role", "UNKNOWN")
                        text = payload.get("text", "")
                        
                        speaker_label = "Seller (Agent)" if speaker == "SALESPERSON" else "Buyer (Customer)"
                        out.write(f"* **{speaker_label}**: {text}\n")
                        transcript_found = True
                
                if not transcript_found:
                    out.write("*No transcript segments found in this session.*\n")
                
                out.write("\n---\n\n")
            except Exception as e:
                out.write(f"## Conversation {idx} (Error loading {filename})\n")
                out.write(f"Error: {str(e)}\n\n---\n\n")
                
    print(f"Successfully converted all files to {output_file}")

if __name__ == "__main__":
    convert()
