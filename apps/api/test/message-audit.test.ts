import { describe, expect, it } from 'vitest';
import { auditTypeForMessageStatus } from '../src/message-audit.js';

describe('auditTypeForMessageStatus', () => {
  it('marks failed SMS attempts as SMS_FAILED', () => {
    expect(auditTypeForMessageStatus('failed')).toBe('SMS_FAILED');
  });

  it('keeps successful or pending SMS attempts as SMS_SENT', () => {
    expect(auditTypeForMessageStatus('queued')).toBe('SMS_SENT');
    expect(auditTypeForMessageStatus('sent')).toBe('SMS_SENT');
    expect(auditTypeForMessageStatus('delivered')).toBe('SMS_SENT');
  });
});
