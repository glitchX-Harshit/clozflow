> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Deployment Notes

CCBS Volume X specifies FastAPI, Kafka, Redis JSON, PostgreSQL, OpenTelemetry/Grafana, Docker, and Kubernetes.

## Local Topology

`infra/docker-compose.local.yml` defines local Kafka, Redis Stack, PostgreSQL, and OpenTelemetry Collector services. It is a development topology only.

The production adapter modules are documented in [production-adapters.md](production-adapters.md).

## Production Direction

- API Gateway: Kong or equivalent with JWT validation and tenant rate limits.
- Session API: FastAPI service.
- Event Bus: Kafka topics `cognitive.events`, `cognitive.recommendations`, and `cognitive.learning`.
- World Model hot store: Redis JSON.
- Checkpoint and audit store: PostgreSQL.
- Observability: OpenTelemetry exported to Grafana-compatible backends.
- Runtime: Kubernetes with separately scalable API, scheduler, engine, memory, knowledge, and observability services.

## Security Requirements To Implement Before Real Customer Data

- RS256 JWT verification and scoped tenant claims.
- TLS 1.3 between services.
- Redis ACL and TLS.
- PostgreSQL encryption for transcript text and tenant-scoped query guards.
- Recommendation audit retention policy.
- Tenant data deletion endpoint.
