"use client";

import * as React from "react";
import {
  AgentWorkflow,
  type AgentPhase,
  type ToolDefinition,
} from "@/components/ui/ai-thinking-and-tool-calls";
import { RotateCcw, Database, ShieldCheck, Cpu } from "lucide-react";

/**
 * Custom tools keep working: the registry's icons ride the rail tips —
 * rendered in the app's single muted tone, exactly like native tools
 */
const CUSTOM_TOOLS: Record<string, ToolDefinition> = {
  db_inspect: {
    name: "db_inspect",
    label: "Inspect Schema",
    icon: Database,
    monoChip: true,
  },
  vuln_scan: {
    name: "vuln_scan",
    label: "Security Audit",
    icon: ShieldCheck,
  },
  cluster_exec: {
    name: "cluster_exec",
    label: "Deploy Canary",
    icon: Cpu,
    monoChip: true,
  },
};

const AUTH_MIDDLEWARE_EXCERPT = `export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }

  const token = header.slice("Bearer ".length);
  const cacheKey = sha256(token).digest("hex");

  // 1. Revocation check — sliding LRU, 15 minute TTL
  if (revokedCache.has(cacheKey)) {
    metrics.increment("auth.revoked_hit");
    return res.status(401).json({ error: "token revoked" });
  }

  // 2. Verify — options come from the shared verifier module
  let payload: SessionClaims;
  try {
    payload = verifySession(token);
  } catch (err) {
    metrics.increment("auth.verify_failure");
    return respondUnauthorized(res, err);
  }

  // 3. Bind the session to the request and move on
  req.session = {
    sub: payload.sub,
    role: payload.role,
    expiresAt: payload.exp * 1000,
  } satisfies AuthSession;

  return next();
}`;

const AUTH_TYPES_EXCERPT = `export type Role = "admin" | "operator" | "viewer";

export interface SessionClaims {
  sub: string;
  role: Role;
  iss: string;
  aud: string;
  exp: number;
}

export interface AuthSession {
  sub: string;
  role: Role;
  expiresAt: number;
}

// 3 downstream route handlers depend on this contract:
//   /routes/admin.ts, /routes/billing.ts, /routes/audit.ts`;

export const MULTI_ROUND_AGENT_WORKFLOW: AgentPhase[] = [
  // ── PHASE 1: Audit & Discovery ──────────────────────────────────────────
  {
    trace: [
      {
        type: "reasoning",
        sentences: [
          "Auditing the authentication middleware AST for algorithm injection and permissive defaults.",
          "The `jwt.verify` call accepts **undefined algorithms** — the decoder will happily negotiate `'none'`, which is the classic algorithm-confusion vector.",
          "Checking whether any route passes a user-controlled token straight into verification without an issuer or audience pin.",
          "Tracing `process.env.JWT_SECRET` to guarantee the key never crosses a debug or log sink.",
          "The session contract in `auth.d.ts` is shared by three route handlers — the fix must stay shape-compatible or the blast radius grows.",
          "Pulling the RFC 7519 guidance: pin the algorithm allowlist, validate `iss`/`aud`, and treat clock skew explicitly.",
          "Formulating a strict HS256-only allowlist plus a sliding LRU revocation cache before touching any route code.",
        ],
        durationSeconds: 9.8,
      },
      {
        type: "tool",
        toolName: "read_file",
        args: { path: "src/middleware/auth.ts" },
        lineStart: 36,
        lineEnd: 72,
        code: AUTH_MIDDLEWARE_EXCERPT,
      },
      {
        type: "tool",
        toolName: "read_file",
        args: { path: "src/types/auth.d.ts" },
        lineStart: 1,
        lineEnd: 19,
        code: AUTH_TYPES_EXCERPT,
      },
      {
        type: "tool",
        toolName: "vuln_scan",
        primary: "Audit",
        secondary: "AST check · 3 files",
        details: [
          { text: "✓ HIGH  jwt.verify at src/middleware/auth.ts:42 — algorithms unpinned" },
          { text: "✓ PASS  JWT_SECRET never crosses a debug/log sink" },
          { text: "✓ PASS  token expiry handled as seconds (no 2038 wrap)" },
        ],
      },
      {
        type: "search",
        toolName: "search_web",
        secondary: "RFC 7519 algorithm confusion",
        sources: [
          { name: "Auth0 Security Advisory", url: "https://auth0.com" },
          { name: "Node JOSE Standards", url: "https://github.com" },
          { name: "OWASP JWT Cheat Sheet", url: "https://owasp.org" },
        ],
      },
    ],
    message: "Audit complete — one high-severity finding: **unpinned verify algorithms** at `src/middleware/auth.ts:42`. Pinning HS256 and adding revocation next.",
  },

  // ── PHASE 2: Patch, Cache & Test Run ────────────────────────────────────
  {
    trace: [
      {
        type: "reasoning",
        sentences: [
          "Designing a sliding-window LRU cache with a 15-minute TTL for revoked token fingerprints — bounded at 100k entries so memory stays flat under churn.",
          "Pinning `algorithms: ['HS256']` so the verifier can never negotiate a downgrade — the allowlist is the whole fix, everything else is hardening.",
          "The pin must land in `verify-options.ts`, not the middleware — three handlers import it and they all need the same guard.",
          "Adding `issuer` and `audience` claims so a token minted for one service can't be replayed against another.",
          "Adding a 10-second `clockTolerance` to absorb NTP drift between edge regions without loosening expiry.",
          "Sketching the eviction test: insert a fingerprint, age it past the TTL, assert the next verify re-reads the token.",
          "Redis side: the fingerprint column is already SHA-256, so cache keys can match it directly — no second hash layer.",
        ],
        durationSeconds: 10.4,
      },
      {
        type: "tool",
        toolName: "edit_file",
        args: { path: "src/auth/verify-options.ts" },
        add: 5,
        del: 2,
        diffFile: "src/auth/verify-options.ts",
        diffRows: [
          { old: 10, cur: 10, type: "ctx", text: "import jwt from 'jsonwebtoken';" },
          { old: 11, cur: null, type: "del", text: "" },
          { old: 12, cur: 11, type: "ctx", text: "export const verifyOptions: jwt.VerifyOptions = {" },
          { old: 13, cur: null, type: "del", text: "  algorithms: undefined," },
          { old: null, cur: 12, type: "add", text: "  algorithms: ['HS256'], // pinned — cipher-downgrade guard" },
          { old: null, cur: 13, type: "add", text: "  issuer: 'api.enterprise.internal'," },
          { old: null, cur: 14, type: "add", text: "  audience: 'internal-services'," },
          { old: null, cur: 15, type: "add", text: "  clockTolerance: 10, // seconds of NTP drift absorbed" },
          { old: 14, cur: 16, type: "ctx", text: "};" },
        ],
      },
      {
        type: "tool",
        toolName: "edit_file",
        args: { path: "src/auth/revocation-cache.ts" },
        add: 18,
        del: 0,
        diffFile: "src/auth/revocation-cache.ts",
        diffRows: [
          { old: null, cur: 1, type: "add", text: "const TTL_MS = 15 * 60 * 1000;" },
          { old: null, cur: 2, type: "add", text: "const CACHE_CAP = 100_000; // LRU bound" },
          { old: 1, cur: 3, type: "ctx", text: "" },
          { old: null, cur: 4, type: "add", text: "export const revokedCache = new LRUCache<string, number>({" },
          { old: null, cur: 5, type: "add", text: "  max: CACHE_CAP," },
          { old: null, cur: 6, type: "add", text: "  ttl: TTL_MS," },
          { old: null, cur: 7, type: "add", text: "  updateAgeOnGet: true, // sliding window" },
          { old: null, cur: 8, type: "add", text: "});" },
        ],
      },
      {
        type: "tool",
        toolName: "db_inspect",
        primary: "Query",
        secondary: "sessions.revoked_tokens",
        mono: true,
        details: [
          { text: "✓ LRU TTL indexed in Redis cluster" },
          { text: "✓ 0 slow-query alerts on key expiration" },
          { text: "✓ fingerprint column already SHA-256 (matches cacheKey)" },
        ],
      },
      {
        type: "terminal",
        command: "npm run test:auth -- --coverage",
        exitCode: 0,
        output: `PASS tests/auth/jwt-verifier.test.ts
  ✓ should pin HS256 algorithm (18 ms)
  ✓ should reject unsigned tokens with HTTP 401 (12 ms)
  ✓ should reject wrong issuer with HTTP 401 (9 ms)
  ✓ should reject wrong audience with HTTP 401 (8 ms)
  ✓ should enforce sliding 15-minute LRU eviction (24 ms)
  ✓ should tolerate ±10s clock skew (11 ms)

Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        2.411 s
Coverage:    100% Statements, 100% Branches, 96.4% Lines`,
      },
    ],
    message: "Patch applied — **14/14 tests passing**, 100% branch coverage. Moving to adversarial regression and the canary.",
  },

  // ── PHASE 3: Fuzzing, Regression Matrix & Canary ────────────────────────
  {
    trace: [
      {
        type: "reasoning",
        sentences: [
          "Synthesizing the adversarial signature matrix: 'none'-algorithm forgeries, RSA-keyed tokens signed with the wrong key, and headers corrupted after signing.",
          "Every malformed or expired token must return a plain **HTTP 401** — never a stack trace, never a 500, never a timing side-channel.",
          "Parameterizing the test matrix with `it.each` so each forgery class stays a one-line addition when a new algorithm lands.",
          "Benchmarking verification under synthetic 5,000 req/s — HS256 verify is ~40µs, so p99 should sit well under 12 ms with the LRU hit.",
          "Checking `redis.conf`: `allkeys-lru` already matches the cache policy, and persistence is off which is correct for revocation fingerprints.",
          "Staging the canary on `staging-cluster-01` and shifting traffic 10% → 50% → 100% with a health probe between steps.",
        ],
        durationSeconds: 8.2,
      },
      {
        type: "tool",
        toolName: "edit_file",
        args: { path: "tests/auth/adversarial.test.ts" },
        add: 7,
        del: 1,
        diffFile: "tests/auth/adversarial.test.ts",
        diffRows: [
          { old: 41, cur: 41, type: "ctx", text: "describe('Adversarial Algorithm Invariant', () => {" },
          { old: 42, cur: null, type: "del", text: "  // TODO: verify algorithm none reject" },
          { old: null, cur: 42, type: "add", text: "  const forged = [forgeUnsignedToken, forgeRsaKeyedToken, forgeCorruptHeader];" },
          { old: null, cur: 43, type: "add", text: "" },
          { old: null, cur: 44, type: "add", text: "  it.each(forged)('rejects %# with HTTP 401', async (forge) => {" },
          { old: null, cur: 45, type: "add", text: "    const res = await request(app).get('/me').auth(forge({ sub: 'admin' }));" },
          { old: null, cur: 46, type: "add", text: "    expect(res.status).toBe(401);" },
          { old: null, cur: 47, type: "add", text: "    expect(res.body.stack).toBeUndefined();" },
          { old: null, cur: 48, type: "add", text: "  });" },
          { old: 43, cur: 49, type: "ctx", text: "});" },
        ],
      },
      {
        type: "tool",
        toolName: "read_file",
        args: { path: "config/redis.conf" },
        lineStart: 12,
        lineEnd: 18,
        code: `maxmemory 512mb
maxmemory-policy allkeys-lru
save ""
appendonly no
# revocation fingerprints live here — LRU only, no persistence needed
databases 2
activerehashing yes`,
      },
      {
        type: "tool",
        toolName: "agent",
        secondary: "run forged-JWT fuzz matrix",
      },
      {
        type: "terminal",
        command: "kubectl rollout status deployment/auth-service --namespace=staging && kubectl get pods -l app=auth-service",
        exitCode: 0,
        output: `Waiting for deployment "auth-service" rollout: 1 of 3 updated replicas available...
Waiting for deployment "auth-service" rollout: 2 of 3 updated replicas available...
✓ deployment "auth-service" successfully rolled out

NAME                           READY   STATUS    RESTARTS   AGE
auth-service-7d9f4b6c8-x2k9m   1/1     Running   0          94s
auth-service-7d9f4b6c8-v8q1p   1/1     Running   0          2m11s
auth-service-7d9f4b6c8-r4n7w   1/1     Running   0          3m2s`,
      },
      {
        type: "tool",
        toolName: "cluster_exec",
        primary: "Deploy",
        secondary: "staging-cluster-01",
        details: [
          { text: "✓ Traffic shifted: 10% → 50% → 100%" },
          { text: "✓ Canary probe: p99 9.4 ms, 0 errors over 12k requests" },
          { text: "✓ Rollback window closed — canary promoted to stable" },
        ],
      },
    ],
    message: "All **28 regression tests** passed — forged `'none'`, RSA-keyed, and corrupt-header tokens all land on a clean 401. Canary promoted to stable.",
  },
];

export default function Demo() {
  const [replayKey, setReplayKey] = React.useState(0);

  return (
    <div className="min-h-screen w-full bg-background px-4 pt-14 pb-28 text-foreground flex flex-col items-center justify-start selection:bg-primary/20 antialiased [font-synthesis:none] sm:px-6">
      <div className="fixed top-6 left-6 z-20">
        <button
          type="button"
          onClick={() => setReplayKey((k) => k + 1)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur-sm transition-all duration-150 hover:border-border hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          <span>Replay</span>
        </button>
      </div>

      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-foreground text-balance shadow-xs">
            Audit our auth middleware for security vulnerabilities, patch any
            algorithm bypasses, and add regression tests.
          </div>
        </div>

        <div className="flex flex-col">
          <AgentWorkflow key={replayKey} phases={MULTI_ROUND_AGENT_WORKFLOW} tools={CUSTOM_TOOLS} />
        </div>
      </div>
    </div>
  );
}
