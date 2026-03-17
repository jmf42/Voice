import { describe, expect, it } from 'vitest';
import {
  extractRequestedSchedule,
  isBusinessQuestion,
  isLikelyUnclearRealtimeTranscript,
  isSmallTalkText,
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

  it('extracts a requested slot from spaced spoken digits for today', () => {
    const requested = extractRequestedSchedule('1 2 0 8 today', {
      now: new Date('2026-03-17T08:30:00+01:00'),
      durationMinutes: 60,
    });

    expect(requested).toEqual({
      slotStart: '2026-03-17T11:08:00.000Z',
      slotEnd: '2026-03-17T12:08:00.000Z',
      label: 'today at 12:08 PM',
    });
  });

  it('does not treat small talk as the service issue', () => {
    expect(isSmallTalkText('Good morning. How are you?')).toBe(true);
    expect(shouldCaptureIssueText('Good morning. How are you?')).toBe(false);
    expect(shouldCaptureIssueText('I need a lock replacement tonight.')).toBe(true);
  });

  it('flags noisy realtime transcripts for clarification before intake advances', () => {
    expect(isLikelyUnclearRealtimeTranscript('[noise]')).toBe(true);
    expect(isLikelyUnclearRealtimeTranscript('um')).toBe(true);
    expect(isLikelyUnclearRealtimeTranscript('Need boiler repair at Main Street 10.')).toBe(false);
  });
});
