export interface CallPriorityInput {
  intent: 'booking' | 'faq' | 'message' | 'urgent_escalation' | 'unknown';
  hallucination_flag: boolean;
  missed_booking_opportunity: boolean;
  escalation_successful?: boolean;
  duration_seconds: number;
}

export interface PriorityScore {
  score: number;
  label: 'Low' | 'Medium' | 'High' | 'Critical';
}

export interface QAQueueSnapshot {
  hallucinationCount: number;
  missedBookingCount: number;
  failedEscalationCount: number;
  totalCallsReviewed: number;
  pendingReviewCount: number;
}

export interface QAAssistantBrief {
  severity: 'ok' | 'attention' | 'alert';
  headline: string;
  summary: string;
  actions: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// Scores how urgently an Operator needs to review this call transcript
export function scoreCallPriority(input: CallPriorityInput): PriorityScore {
  let score = 10;

  if (input.hallucination_flag) score += 50;
  if (input.missed_booking_opportunity) score += 30;
  if (input.intent === 'urgent_escalation' && input.escalation_successful === false) score += 50;
  if (input.intent === 'unknown') score += 15;

  if (input.duration_seconds < 10) score += 20; // Suspiciously short call
  if (score > 100) score = 100;

  const boundedScore = clampScore(score);

  if (boundedScore >= 80) return { score: boundedScore, label: 'Critical' };
  if (boundedScore >= 60) return { score: boundedScore, label: 'High' };
  if (boundedScore >= 40) return { score: boundedScore, label: 'Medium' };
  return { score: boundedScore, label: 'Low' };
}

export function buildQAAssistantBrief(snapshot: QAQueueSnapshot): QAAssistantBrief {
  if (snapshot.failedEscalationCount > 0) {
    return {
      severity: 'alert',
      headline: `Critical: ${snapshot.failedEscalationCount} failed escalations`,
      summary:
        'The AI failed to route urgent calls to a human. This is a severe failure for the client. Review immediately and contact the client if necessary.',
      actions: [
        `Review the ${snapshot.failedEscalationCount} failed escalation transcripts now.`,
        'Check escalation phone numbers in Client Settings.',
        'If it was a technical failure, update the fallback intent.',
      ],
    };
  }

  if (snapshot.hallucinationCount > 0 || snapshot.missedBookingCount > 0) {
    return {
      severity: 'alert',
      headline: `Immediate attention needed: ${snapshot.hallucinationCount} hallucinations, ${snapshot.missedBookingCount} missed bookings`,
      summary:
        'The knowledge base or prompt instructions are failing to capture intent correctly.',
      actions: [
        snapshot.hallucinationCount > 0
          ? `Review 2 hallucinations by updating the FAQs.`
          : 'FAQ matching is currently stable.',
        snapshot.missedBookingCount > 0
          ? `Review ${snapshot.missedBookingCount} missed booking opportunities.`
          : 'Booking success rate is stable.',
        `Clear the ${snapshot.pendingReviewCount} remaining calls in the queue.`,
      ],
    };
  }

  return {
    severity: 'ok',
    headline: 'Queue is healthy',
    summary:
      'No critical errors detected in recent calls. The agent is strictly following the knowledge base.',
    actions: [
      snapshot.pendingReviewCount > 0
        ? `Review ${snapshot.pendingReviewCount} recent calls.`
        : 'All calls have been reviewed.',
      `Total calls processed: ${snapshot.totalCallsReviewed}`,
    ],
  };
}
