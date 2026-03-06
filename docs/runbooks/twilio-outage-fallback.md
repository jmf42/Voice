# Twilio Outage Fallback

## Trigger
Twilio cannot deliver inbound call webhooks or transfer actions fail globally.

## Mitigation

1. Set `enabled=false` for affected tenants.
2. Confirm direct transfer to business phone works.
3. Notify businesses that calls are routed directly until restored.

## Recovery

1. Monitor Twilio status page and webhook success rate.
2. Re-enable intake tenant by tenant.
3. Run test normal and urgent calls for each re-enabled tenant.
