import type { MessageRecord } from './types.js';

export function auditTypeForMessageStatus(status: MessageRecord['status']): 'SMS_SENT' | 'SMS_FAILED' {
  return status === 'failed' ? 'SMS_FAILED' : 'SMS_SENT';
}
