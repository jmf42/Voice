# DispatchOS v1

DispatchOS answers inbound calls, captures qualified jobs, escalates urgent requests, sends SMS confirmations, and gives dispatchers a mobile-first Job Board.

## What is production-ready now

- Twilio voice webhooks for intake + escalation transfer.
- Twilio SMS send + delivery status callbacks.
- FR/EN qualification flow with urgency and address confidence gating.
- Strict terminal invariant: each call ends in exactly one outcome.
- Post-call fallback finalization from Twilio call status callbacks.
- Multi-tenant API with auth and tenant isolation.
- Google Calendar OAuth + confirm-time booking flow.
- Queue-backed retry/deferred work (BullMQ + Redis) with dead-letter queue.
- Mobile-first dashboard: Job Board, Job Details, Settings, onboarding test-call.
- Security baseline: signature verification, rate limiting, CORS allowlist, secure headers, PII-redacted logs.

## Monorepo layout

- `/Users/juanmanuelfontes/Voice/apps/api` Fastify API.
- `/Users/juanmanuelfontes/Voice/apps/worker` queue workers.
- `/Users/juanmanuelfontes/Voice/apps/web` React dashboard.
- `/Users/juanmanuelfontes/Voice/packages/shared` domain schemas/types.
- `/Users/juanmanuelfontes/Voice/packages/config` env validation.
- `/Users/juanmanuelfontes/Voice/infra` local Postgres + Redis.

## What you need to provide

You can run locally with demo providers first, but for real production behavior you need:

1. Twilio
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

2. OpenAI (optional but recommended)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-4.1-mini`)

3. Firebase auth (for real magic-link sessions)
- API verification (backend): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Web client (frontend): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`

4. Google Calendar
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

## Quick start (local)

1. Copy env file:

```bash
cp /Users/juanmanuelfontes/Voice/.env.example /Users/juanmanuelfontes/Voice/.env
```

2. Start Postgres + Redis:

```bash
cd /Users/juanmanuelfontes/Voice
pnpm infra:up
```

3. Install dependencies:

```bash
cd /Users/juanmanuelfontes/Voice
pnpm install
```

4. Generate Prisma client:

```bash
cd /Users/juanmanuelfontes/Voice
pnpm --filter @dispatchos/api db:generate
```

5. Run migrations and seed demo tenant:

```bash
cd /Users/juanmanuelfontes/Voice
pnpm db:migrate
pnpm db:seed
```

6. Run services (3 terminals):

```bash
cd /Users/juanmanuelfontes/Voice
pnpm --filter @dispatchos/api dev
```

```bash
cd /Users/juanmanuelfontes/Voice
pnpm --filter @dispatchos/worker dev
```

```bash
cd /Users/juanmanuelfontes/Voice
pnpm --filter @dispatchos/web dev
```

7. Open dashboard:

- [http://localhost:5173](http://localhost:5173)

## Environment modes

### Local demo mode (no real providers)

- `STORE_MODE=memory`
- `QUEUE_MODE=memory`
- `ALLOW_DEV_AUTH_TOKEN=true`

### Real local/staging mode

- `STORE_MODE=prisma`
- `QUEUE_MODE=redis`
- `ALLOW_DEV_AUTH_TOKEN=false` (recommended once Firebase is ready)

### Production

- `NODE_ENV=production`
- `STORE_MODE=prisma`
- `QUEUE_MODE=redis`
- `ALLOW_INMEMORY_STORE=false`
- `ALLOW_DEV_AUTH_TOKEN=false`
- `VOICE_FLOW_MODE=guided` (or `realtime` to enable full conversational call handling)
- `REALTIME_AGENT_MODEL=gpt-realtime-mini`

## Login and onboarding flow

1. Go to `/login`.
2. If Firebase is configured, enter work email and click `Send login link`.
3. If Firebase is not configured (local dev), click `Continue in demo mode`.
4. First login opens the 3-step onboarding:
   - Business basics (business name, main phone, optional website import)
   - Call routing (escalation number + Twilio webhook setup reference)
   - Assistant memory & test (business context + sample job creation)
5. After onboarding:
   - `Job Board` = urgent + new action queue.
   - `Calendar` = all accepted/confirmed jobs by day and time.
   - `Insights` = production health, SLA risk, address quality, and booking follow-up metrics.
   - `Settings` = operations, business identity, language, integrations.

Sign out now clears session correctly and always returns to `/login`.

## Production monitoring checklist

Use `/insights` daily:

1. `Call completion` should stay high (target 95%+).
2. `SMS reliability` should stay high (target 95%+).
3. `Urgent workload` should stay controlled (small active queue).
4. `Overdue urgent jobs` should stay at zero.
5. `Unconfirmed address jobs` should stay at zero.

Also monitor:

1. Twilio call + messaging logs for delivery/transfer failures.
2. API logs for webhook validation, escalation fallbacks, and retries.
3. Queue health (retries / dead-letter entries) in worker logs.

Emergency rollback:

1. Go to `Settings`.
2. Toggle `AI intake` to `Disabled`.
3. Calls immediately bypass to business phone (no forwarding change needed).

## Run full verification

```bash
cd /Users/juanmanuelfontes/Voice
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
```

## API endpoints

- `POST /v1/telephony/inbound/:tenantId`
- `POST /v1/telephony/gather/:tenantId/:callId/:step`
- `POST /v1/telephony/status`
- `POST /v1/telephony/transfer/status`
- `WS /v1/voice/realtime/:tenantId` (used when `VOICE_FLOW_MODE=realtime`)
- `POST /v1/sms/status`
- `POST /v1/sms/inbound`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `POST /v1/jobs/:jobId/confirm-time`
- `POST /v1/jobs/:jobId/callback`
- `POST /v1/jobs/:jobId/close`
- `GET /v1/settings`
- `PATCH /v1/settings`
- `GET /v1/calendar/google/start`
- `GET /v1/calendar/google/callback`
- `POST /v1/onboarding/test-call`

## Notes

- Audio retention is off; transcript-only flow is enabled.
- If SMS provider fails, retry jobs are queued.
- If calendar booking fails, job still confirms and is marked `manual_required`.
