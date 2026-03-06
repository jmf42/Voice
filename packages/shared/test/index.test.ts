import { describe, expect, it } from 'vitest';
import {
  CallOutcomeSchema,
  QualifiedJobSchema,
  buildNormalSms,
  buildUrgentSms,
  chooseJobStatus,
  isUrgentText,
} from '../src/index.js';

describe('shared schemas', () => {
  it('rejects invalid call outcomes', () => {
    expect(() => CallOutcomeSchema.parse('INVALID')).toThrow();
  });

  it('validates qualified job payload', () => {
    const result = QualifiedJobSchema.parse({
      caller_phone: '+4179000000',
      address_raw: 'Rue de Lausanne 1, Geneva',
      address_confirmed: true,
      urgency: 'normal',
      preferred_time_window: 'morning',
      job_summary: 'Water leak in kitchen. Needs technician visit.',
    });

    expect(result.preferred_time_window).toBe('morning');
  });

  it('detects urgent text in french and english', () => {
    expect(isUrgentText('Bonjour, c\'est une fuite de gaz')).toBe(true);
    expect(isUrgentText('We have a burst pipe emergency')).toBe(true);
    expect(isUrgentText('Need regular maintenance next week')).toBe(false);
  });

  it('maps urgency to board status', () => {
    expect(chooseJobStatus('urgent')).toBe('urgent');
    expect(chooseJobStatus('normal')).toBe('new');
  });

  it('renders SMS templates', () => {
    expect(buildNormalSms('Plombier SA')).toContain('Plombier SA');
    expect(buildUrgentSms('Plombier SA', 30)).toContain('30 minutes');
  });
});
