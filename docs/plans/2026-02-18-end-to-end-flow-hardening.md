# DispatchOS v1 End-to-End Flow Hardening (Login -> AI Context -> Output)

## Reviewed flow

1. Web login and session state (`/login`, token handling, onboarding gate).
2. Protected app routes and tenant settings loading.
3. Realtime call conversation intake (WebSocket turn capture and finalization).
4. Job creation output quality (urgent vs qualified outcomes).

## Issues found

1. Onboarding completion state was stored in a single global browser key, which could leak onboarding-complete state across tenants on shared devices.
2. Protected routes recreated `TenantProvider` on each page navigation, causing repeated `/v1/settings` reloads and avoidable loading churn.
3. Realtime calls could be finalized as normal qualified jobs even when core intake details were missing (for example, caller hangs up early).
4. Interrupted utterances in realtime mode were added to transcript but not parsed into intake state, reducing context quality.

## Fixes applied

1. Onboarding completion now uses tenant-scoped keys (`dispatchos_onboarding_done:<tenantId>`) with legacy-key migration fallback.
2. Protected routing now uses one shared `TenantProvider` shell across authenticated routes to avoid redundant settings reloads.
3. Realtime finalization now checks for core details (issue, address, time window, callback phone). If incomplete, it escalates as callback SLA (`urgent`) instead of producing a false "qualified" normal job.
4. Realtime interrupt events now also update intake state via the same extraction pipeline used for normal prompts.

## Verification coverage added

1. Web test: settings are loaded once and reused while navigating between protected routes.
2. API test: incomplete realtime intake now creates an urgent/escalated job with pending-address marker.

