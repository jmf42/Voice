# Top 5 Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the two highest-risk user-facing bugs, then strengthen booking recovery, Redis reliability, and frontend/backend contract consistency.

**Architecture:** Ship this in five small tracks. First correct the onboarding webhook URL and calendar date grouping because they directly affect customer setup and daily operations. Then implement durable retry behavior for failed calendar writes, preserve full Redis connection settings in both API and worker, and finally eliminate type drift by making the web app consume the same domain contract as the backend.

**Tech Stack:** React 19, Vite, Fastify, BullMQ, Prisma, TypeScript, Vitest

---

### Task 1: Fix hardcoded demo tenant in onboarding webhook instructions

**Why this is top 5:** A business can wire Twilio to the wrong tenant from the setup screen.

**Files:**
- Modify: `apps/web/src/pages/OnboardingPage.tsx`
- Test: `apps/web/test/app.test.tsx`

**Step 1: Write the failing test**

Add a test that renders onboarding with a non-demo tenant id and asserts the webhook text contains that tenant id instead of `demo-tenant`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @dispatchos/web test -- app.test.tsx`
Expected: the new onboarding assertion fails because the UI still prints `demo-tenant`.

**Step 3: Write minimal implementation**

- In `apps/web/src/pages/OnboardingPage.tsx`, derive a `tenantIdForWebhook` from `draft.id` or `settings.id`.
- Replace the hardcoded path in the onboarding help block with the real tenant id.
- Keep the current API base URL behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @dispatchos/web test -- app.test.tsx`
Expected: onboarding test passes and existing route tests still pass.

**Step 5: Commit**

```bash
git add apps/web/src/pages/OnboardingPage.tsx apps/web/test/app.test.tsx
git commit -m "fix: use tenant webhook url in onboarding"
```

### Task 2: Fix calendar day grouping so “today” is correct in local time

**Why this is top 5:** Operators can see bookings under the wrong day, especially near midnight or outside UTC.

**Files:**
- Modify: `apps/web/src/pages/CalendarPage.tsx`
- Test: `apps/web/test/app.test.tsx`

**Step 1: Write the failing test**

Add a calendar page test with an appointment near midnight local time and assert it appears under the expected local day heading and contributes to the correct “Today” count.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @dispatchos/web test -- app.test.tsx`
Expected: the new calendar grouping assertion fails because grouping uses `toISOString()`.

**Step 3: Write minimal implementation**

- In `apps/web/src/pages/CalendarPage.tsx`, replace the UTC day key logic with a local date key helper such as `YYYY-MM-DD` built from `getFullYear()`, `getMonth() + 1`, and `getDate()`.
- Reuse that helper for grouped day keys and the “today” comparison.
- Leave sorting and display formatting unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @dispatchos/web test -- app.test.tsx`
Expected: the new calendar test passes and existing calendar tests remain green.

**Step 5: Commit**

```bash
git add apps/web/src/pages/CalendarPage.tsx apps/web/test/app.test.tsx
git commit -m "fix: group calendar bookings by local day"
```

### Task 3: Implement real retry handling for `calendar-write` jobs

**Why this is top 5:** The API already queues failed booking work, but the worker currently only logs it, so recovery never happens.

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/queue.ts`
- Modify: `packages/config/src/index.ts` if new worker env vars are needed
- Test: `apps/worker/test/queues.test.ts`
- Test: `apps/api/test/app.test.ts`
- Docs: `README.md` if worker behavior or required env changes

**Step 1: Write the failing tests**

Add worker-focused tests for:
- a queued `calendar-write` job calling back into booking recovery logic
- a permanent failure ending in dead-letter handling

Add or extend API tests to assert the retry payload contains enough information to retry safely.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dispatchos/worker test`
Run: `pnpm --filter @dispatchos/api test -- app.test.ts`
Expected: tests fail because `calendar-write` still only logs and does not process anything.

**Step 3: Write minimal implementation**

- Define the exact recovery payload shape for `calendar-write` jobs in one place.
- Replace the log-only worker handler in `apps/worker/src/index.ts` with real recovery behavior.
- Safest default: have the worker call an internal API recovery endpoint or shared recovery function that:
  - rechecks the booking request
  - retries booking if possible
  - updates the job to `booked` or leaves `manual_required`
  - records an audit entry
- Make sure permanent failures still flow to dead-letter.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dispatchos/worker test`
Run: `pnpm --filter @dispatchos/api test -- app.test.ts`
Expected: recovery tests pass and existing booking fallback tests still pass.

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/queues.ts apps/api/src/app.ts apps/api/src/queue.ts apps/worker/test/queues.test.ts apps/api/test/app.test.ts README.md
git commit -m "feat: process queued calendar booking retries"
```

### Task 4: Preserve full Redis connection settings in API and worker

**Why this is top 5:** Production Redis deployments often require password, TLS, and database index, which the current parser discards.

**Files:**
- Modify: `apps/api/src/queue.ts`
- Modify: `apps/worker/src/queues.ts`
- Test: `apps/worker/test/queues.test.ts`
- Test: `packages/config/test/index.test.ts` if config behavior changes
- Docs: `README.md`

**Step 1: Write the failing tests**

Add queue tests that build a Redis URL with credentials and a non-default db and assert the parsed connection preserves:
- host
- port
- username/password if present
- db index if present
- TLS for `rediss://`

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dispatchos/worker test`
Expected: parser tests fail because current code only returns `host` and `port`.

**Step 3: Write minimal implementation**

- Extract a shared connection parsing helper or duplicate the same safe parser in API and worker.
- Return a BullMQ-compatible connection object instead of `{ host, port }` only.
- Keep the public queue API unchanged.

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dispatchos/worker test`
Run: `pnpm --filter @dispatchos/api typecheck`
Expected: parser tests pass and both packages still typecheck.

**Step 5: Commit**

```bash
git add apps/api/src/queue.ts apps/worker/src/queues.ts apps/worker/test/queues.test.ts README.md
git commit -m "fix: preserve full redis connection settings"
```

### Task 5: Remove frontend/backend type drift by using shared contract definitions

**Why this is top 5:** The web app currently allows values the backend does not, which creates avoidable bugs and future drift.

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: any web files that rely on widened language values
- Test: `apps/web/test/app.test.tsx`
- Test: `packages/shared/test/index.test.ts` if shared contract additions are needed

**Step 1: Write the failing tests**

Add a focused type-level or runtime-mapping test that proves the web app only accepts the same language values the shared schema exposes.

**Step 2: Run test/typecheck to verify it fails**

Run: `pnpm --filter @dispatchos/web typecheck`
Expected: once the test or stricter imports are in place, web typing fails where local web types are wider than shared types.

**Step 3: Write minimal implementation**

- Replace hand-maintained duplicates in `apps/web/src/types.ts` with imports from `@dispatchos/shared` where practical.
- Narrow web-only unions to match the backend contract.
- Keep purely UI-only fields local.

**Step 4: Run tests to verify it passes**

Run: `pnpm --filter @dispatchos/web typecheck`
Run: `pnpm --filter @dispatchos/web test`
Expected: typecheck passes and UI tests remain green.

**Step 5: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/api.ts apps/web/test/app.test.tsx packages/shared/test/index.test.ts
git commit -m "refactor: align web types with shared contract"
```

### Final verification

After all five tasks:

Run:

```bash
pnpm --filter @dispatchos/api test
pnpm --filter @dispatchos/web test
pnpm --filter @dispatchos/worker test
pnpm --filter @dispatchos/api typecheck
pnpm --filter @dispatchos/web typecheck
pnpm --filter @dispatchos/api lint
pnpm --filter @dispatchos/web lint
pnpm build
```

Expected:
- onboarding webhook text uses the active tenant
- calendar day grouping matches local time
- failed calendar writes are retried by the worker instead of silently logged
- Redis queue setup works with real managed Redis URLs
- web and backend type contracts no longer drift

### Deferred after this plan

These are important, but intentionally not in the top 5 execution sequence:

- `transcript-persist` queue is still a no-op and should either persist data or be removed
- booking slot generation should respect tenant opening hours and timezone
- auth/session hardening beyond localStorage and dev fallback should be handled as a separate security-focused track
