import asyncio
import os
from aiokafka.admin import AIOKafkaAdminClient, NewTopic


async def main():
    bootstrap_servers = os.getenv("CEB_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    print(f"Connecting to Kafka Admin at {bootstrap_servers}...")
    admin_client = AIOKafkaAdminClient(bootstrap_servers=bootstrap_servers)
    await admin_client.start()
    try:
        # Define topics according to CCBS Phase 1.3
        # cognitive.events: 12 partitions, 24h retention (86,400,000 ms)
        # cognitive.recommendations: 6 partitions, 2h retention (7,200,000 ms)
        # cognitive.learning: 3 partitions, 30d retention (2,592,000,000 ms)
        topics = [
            NewTopic(
                name="cognitive.events",
                num_partitions=12,
                replication_factor=1,
                topic_configs={"retention.ms": "86400000"},
            ),
            NewTopic(
                name="cognitive.recommendations",
                num_partitions=6,
                replication_factor=1,
                topic_configs={"retention.ms": "7200000"},
            ),
            NewTopic(
                name="cognitive.learning",
                num_partitions=3,
                replication_factor=1,
                topic_configs={"retention.ms": "2592000000"},
            ),
        ]

        print("Provisioning Kafka topics...")
        await admin_client.create_topics(new_topics=topics, validate_only=False)
        print("Kafka topics created successfully.")
    except Exception as e:
        print(f"Failed to create topics: {e}")
    finally:
        await admin_client.close()


if __name__ == "__main__":
    asyncio.run(main())
