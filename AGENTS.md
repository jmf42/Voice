# Voice App Guide

## What this app does

Voice is an AI-assisted call intake and scheduling system for local service businesses such as plumbers, salons, clinics, restaurants, and other appointment-based teams.

The product has three main jobs:

1. Answer inbound calls and capture the customer request.
2. Store business settings, services, FAQs, and scheduling preferences.
3. Create and manage bookings, including calendar sync and urgent escalation.

## Main parts of the system

- [`apps/web`](/Users/juanmanuelfontes/Voice/apps/web): customer-facing operations dashboard used by business owners and managers.
- [`apps/api`](/Users/juanmanuelfontes/Voice/apps/api): Fastify backend that handles auth, settings, telephony webhooks, jobs, metrics, and calendar actions.
- [`apps/worker`](/Users/juanmanuelfontes/Voice/apps/worker): queue worker for retryable jobs such as messaging and calendar follow-up.
- [`packages/shared`](/Users/juanmanuelfontes/Voice/packages/shared): shared schemas and domain types.
- [`packages/config`](/Users/juanmanuelfontes/Voice/packages/config): runtime environment validation.

## Production data model

### Primary application data

The production source of truth is PostgreSQL through Prisma.

- Prisma schema: [`apps/api/prisma/schema.prisma`](/Users/juanmanuelfontes/Voice/apps/api/prisma/schema.prisma)
- Production store implementation: [`apps/api/src/store-prisma.ts`](/Users/juanmanuelfontes/Voice/apps/api/src/store-prisma.ts)

This is where the app stores:

- tenant/business profile
- business context and assistant memory
- services and FAQs
- jobs and call records
- calendar connections
- audit events and booking metadata

### Queue and retry system

Redis is used for queue-backed work and retry/deferred jobs.

- Queue client: [`apps/api/src/queue.ts`](/Users/juanmanuelfontes/Voice/apps/api/src/queue.ts)
- Worker: [`apps/worker/src/index.ts`](/Users/juanmanuelfontes/Voice/apps/worker/src/index.ts)

### Firebase

Firebase is currently used for authentication, not as the primary business database.

- Web auth setup: [`apps/web/src/auth.ts`](/Users/juanmanuelfontes/Voice/apps/web/src/auth.ts)
- API token verification: [`apps/api/src/auth.ts`](/Users/juanmanuelfontes/Voice/apps/api/src/auth.ts)

The Google project `dops-02242320-17720` is now attached to Firebase, and it already has a Firestore database named `dispatchos`. Even so, the business and calendar data path in this codebase is still PostgreSQL-first.

The current Google Cloud SQL instance attached to production is `dispatchos-pg` and it is running PostgreSQL 15 in `us-central1`.

## Main user flow

1. User signs in from the web app.
2. User completes onboarding:
   - business basics
   - urgent routing
   - assistant knowledge
3. API stores tenant settings.
4. Incoming calls create jobs.
5. Jobs can be confirmed into appointments.
6. If Google Calendar is connected, bookings are written to the connected calendar.

## Important routes

### Web

- `/login`
- `/onboarding`
- `/dashboard`
- `/calendar`
- `/settings`
- `/calls/:id`

### API

- `GET /v1/settings`
- `PATCH /v1/settings`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `POST /v1/jobs/:jobId/confirm-time`
- `GET /v1/calendar/google/start`
- `GET /v1/calendar/google/callback`
- `POST /v1/onboarding/test-call`
- `POST /v1/telephony/inbound/:tenantId`

## Current production services

- Web Cloud Run service: `dispatchos-web`
- API Cloud Run service: `voice-api`
- Project: `dops-02242320-17720`
- Region: `us-central1`

## Environment expectations

### Required for durable production behavior

- `NODE_ENV=production`
- `STORE_MODE=prisma`
- `QUEUE_MODE=redis`
- `ALLOW_INMEMORY_STORE=false`
- `BOOTSTRAP_DEMO_TENANT=false`
- `DATABASE_URL`
- `REDIS_URL`
- `QUEUE_SHARED_SECRET`

`QUEUE_SHARED_SECRET` must be set to the same value in both the API and worker services so queued calendar retry jobs can be replayed safely through the internal recovery endpoint.

### Current auth-related production gap to watch

The live API currently still has `ALLOW_DEV_AUTH_TOKEN=true`, which means production auth is not fully hardened yet even though PostgreSQL and Redis are configured correctly.

Firebase Authentication is also not fully initialized in Google Cloud for this project yet. A direct smoke test against the Identity Toolkit API currently returns `CONFIGURATION_NOT_FOUND`, so email-link sign-in should not be treated as production-ready until Auth is enabled in the Firebase console for project `dops-02242320-17720`.

## Local verification commands

Run from repo root:

```bash
pnpm --filter @dispatchos/api test
pnpm --filter @dispatchos/web test
pnpm --filter @dispatchos/worker test
pnpm --filter @dispatchos/api typecheck
pnpm --filter @dispatchos/web typecheck
pnpm --filter @dispatchos/worker typecheck
pnpm --filter @dispatchos/api lint
pnpm --filter @dispatchos/web lint
pnpm --filter @dispatchos/worker lint
pnpm build
```

## Health and readiness

The API exposes `GET /health` as a public liveness plus readiness snapshot. It returns:

- whether persistence is `memory` or `database`
- whether the queue is `memory` or `redis`
- whether production-safe auth is active
- whether OpenAI, Twilio, and Google Calendar are configured
- whether demo tenant bootstrapping is enabled

For production, the target state is:

- `readiness.productionSafe = true`
- no critical issues in `readiness.issues`

## Deployment notes

### Web

- Dockerfile: [`apps/web/Dockerfile`](/Users/juanmanuelfontes/Voice/apps/web/Dockerfile)
- Cloud Build config: [`cloudbuild.web.yaml`](/Users/juanmanuelfontes/Voice/cloudbuild.web.yaml)

The web app is currently deployed by building a static Vite bundle and serving it through Nginx on Cloud Run.

### API

The API is separately deployed to Cloud Run and uses secrets for:

- `OPENAI_API_KEY`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `DATABASE_URL`
- `REDIS_URL`

## UX intent

The primary user is a non-technical service operator. The app should feel like:

- a simple inbox for new requests
- a clear calendar for confirmed appointments
- a straightforward settings area for business details and assistant knowledge

The app should avoid internal QA jargon in the main flow unless it is clearly part of an advanced admin or troubleshooting surface.
