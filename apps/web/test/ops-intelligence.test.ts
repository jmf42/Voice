import { describe, expect, it } from 'vitest';
import { buildQAAssistantBrief, scoreCallPriority } from '../src/ops-intelligence.js';

describe('scoreCallPriority', () => {
  it('marks hallucination and missed booking opportunity as critical', () => {
    const result = scoreCallPriority({
      intent: 'booking',
      hallucination_flag: true,
      missed_booking_opportunity: true,
      duration_seconds: 120,
    });

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.label).toBe('Critical');
  });

  it('keeps healthy faq calls in low priority range', () => {
    const result = scoreCallPriority({
      intent: 'faq',
      hallucination_flag: false,
      missed_booking_opportunity: false,
      duration_seconds: 40,
    });

    expect(result.score).toBeLessThan(40);
    expect(result.label).toBe('Low');
  });
});

describe('buildQAAssistantBrief', () => {
  it('recommends immediate escalation when hallucinations exist', () => {
    const brief = buildQAAssistantBrief({
      hallucinationCount: 2,
      missedBookingCount: 1,
      failedEscalationCount: 0,
      totalCallsReviewed: 10,
      pendingReviewCount: 5,
    });

    expect(brief.severity).toBe('alert');
    expect(brief.headline).toContain('Immediate attention needed');
    expect(brief.actions[0]).toContain('Review 2 hallucinations');
  });

  it('returns stable guidance when queue is healthy', () => {
    const brief = buildQAAssistantBrief({
      hallucinationCount: 0,
      missedBookingCount: 0,
      failedEscalationCount: 0,
      totalCallsReviewed: 50,
      pendingReviewCount: 2,
    });

    expect(brief.severity).toBe('ok');
    expect(brief.headline).toContain('Queue is healthy');
    expect(brief.actions.length).toBeGreaterThan(0);
  });
});
