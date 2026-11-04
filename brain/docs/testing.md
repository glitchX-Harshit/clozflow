> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Testing

The current tests use standard-library `unittest` so Phase 1 can be verified in the bundled runtime without installing dependencies.

## Test Coverage

- Cognitive Event registry defaults and validation.
- World Model mutation contract serialization.
- Session creation and World Model initialization.
- Kernel event acceptance.
- Engine scheduling through the registry.
- Engine-returned World Model mutations applied by the repository.
- SQLAlchemy repositories verified against SQLite without external database services.
- Redis World Model adapter verified with a fake RedisJSON client.
- Kafka Event Bus adapter verified with a fake async producer.

## Command

```powershell
& 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s tests
```

## Future Quality Gates

Per CCBS Volume X, later phases must add:

- engine contract tests,
- integration tests against Kafka/Redis/PostgreSQL,
- full Cognitive Decision Cycle tests,
- simulation-corpus tests,
- latency tests,
- load and chaos tests.
