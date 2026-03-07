import { describe, expect, it } from 'vitest';
import {
  extractRequestedSchedule,
  isBusinessQuestion,
  shouldCaptureIssueText,
} from '../src/realtime-intake.js';

describe('realtime intake helpers', () => {
  it('treats business info questions as informational instead of service issues', () => {
    expect(isBusinessQuestion("Can you tell me the company's name?")).toBe(true);
    expect(isBusinessQuestion('What services do you provide?')).toBe(true);
    expect(shouldCaptureIssueText("Can you tell me the company's name?")).toBe(false);
    expect(shouldCaptureIssueText('Can you open my door without damaging the lock?')).toBe(true);
    expect(shouldCaptureIssueText('I am locked out of my apartment.')).toBe(true);
  });

  it('extracts an exact requested slot from relative schedule language', () => {
    const requested = extractRequestedSchedule('At 9 PM tomorrow.', {
      now: new Date('2026-03-07T10:00:00+01:00'),
      durationMinutes: 60,
    });

    expect(requested).toEqual({
      slotStart: '2026-03-08T20:00:00.000Z',
      slotEnd: '2026-03-08T21:00:00.000Z',
      label: 'tomorrow at 9:00 PM',
    });
  });
});
