# Incident Response Runbook

## Severity model

- SEV-1: Call intake unavailable or all calls failing
- SEV-2: Partial degradation (SMS delivery issues, delayed jobs)
- SEV-3: Minor UI issues without call flow impact

## Immediate actions

1. Check API health endpoint.
2. Check Twilio webhook delivery logs.
3. Check queue backlog and worker status.
4. If severe and unresolved in 10 minutes, disable AI intake per tenant (ON/OFF -> OFF) to route directly to business phone.

## Communication template

- What happened
- Who is impacted
- Temporary workaround
- Next update time

## Post-incident

1. Identify root cause and affected calls.
2. Verify no urgent jobs were lost.
3. Document preventive actions.
