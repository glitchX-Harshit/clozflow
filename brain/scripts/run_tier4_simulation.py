import json
import os
import sys
import time
from uuid import UUID

from clozflow_brain.api.main import build_kernel
from clozflow_brain.contracts.events import CognitiveEvent

def main():
    print("Starting Tier 4 Simulation...")
    print("This is a reliability replay. Human relevance and labelled accuracy gates require separate evaluation.")

    # 1. Initialize Kernel and Services
    try:
        kernel, session_service, ingestion_service, context_service, memory_service, knowledge_service = build_kernel()
    except Exception as e:
        print(f"Failed to build Kernel: {e}")
        sys.exit(1)

    print("Cognitive Kernel initialized.")

    # 2. Load Corpus
    corpus_dir = os.path.join(os.path.dirname(__file__), "..", "data", "simulation_corpus")
    if not os.path.exists(corpus_dir):
        print(f"Corpus directory {corpus_dir} not found.")
        sys.exit(1)

    session_files = [f for f in os.listdir(corpus_dir) if f.endswith(".json")]
    if not session_files:
        print("No simulation sessions found.")
        sys.exit(1)

    print(f"Loaded {len(session_files)} sessions for simulation.")

    success_count = 0
    failure_count = 0
    total_events = 0
    start_time = time.perf_counter()

    # 3. Execute Simulation
    for file_name in session_files:
        file_path = os.path.join(corpus_dir, file_name)
        with open(file_path, "r") as f:
            events_data = json.load(f)

        session_id_str = events_data[0]["session_id"]
        tenant_id_str = events_data[0]["tenant_id"]

        # Create session explicitly
        try:
            session = session_service.create_session(
                tenant_id=UUID(tenant_id_str),
                salesperson_id=events_data[0]["payload"]["salesperson_id"],
                crm_opportunity_id=events_data[0]["payload"]["crm_opportunity_id"],
                metadata={}
            )
            real_session_id = str(session.session_id)
        except Exception as e:
            print(f"Failed to create session {session_id_str}: {e}")
            failure_count += 1
            continue

        session_ok = True
        # Ingest events
        for event_dict in events_data:
            event_dict["session_id"] = real_session_id
            try:
                event_obj = CognitiveEvent.model_validate(event_dict)
                result = ingestion_service.ingest(event_obj)
                total_events += 1
                failed = [o for o in result.engine_outputs if o.status.value in {"ERROR", "TIMEOUT"}]
                if failed:
                    print("Engine failures:", ", ".join(o.engine_id for o in failed))
                    session_ok = False
            except Exception as e:
                print(f"Error ingesting event in session {real_session_id}: {e}")
                session_ok = False
                break

        if session_ok:
            success_count += 1
        else:
            failure_count += 1

    kernel.scheduler.close()

    # 4. Report
    duration = time.perf_counter() - start_time
    print("\n" + "="*40)
    print("TIER 4 SIMULATION RESULTS")
    print("="*40)
    print(f"Total Sessions Processed: {len(session_files)}")
    print(f"Successful Sessions:      {success_count}")
    print(f"Failed Sessions:          {failure_count}")
    print(f"Total Events Ingested:    {total_events}")
    print(f"Total Time Taken:         {duration:.2f} seconds")
    print(f"Average Time/Session:     {duration/len(session_files):.3f} seconds")
    print("="*40)

    if failure_count > 0:
        print("Simulation completed with errors.")
        sys.exit(1)
    else:
        print("Simulation completed SUCCESSFULLY.")

if __name__ == "__main__":
    main()
