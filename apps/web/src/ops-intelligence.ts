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
      headline: `Immediate attention needed: ${snapshot.failedEscalationCount} failed handoff${snapshot.failedEscalationCount === 1 ? '' : 's'}`,
      summary:
        'At least one urgent caller was not routed to a person correctly. Review these calls immediately and confirm the handoff number is correct.',
      actions: [
        `Review the ${snapshot.failedEscalationCount} failed handoff transcript${snapshot.failedEscalationCount === 1 ? '' : 's'} now.`,
        'Check the urgent handoff number in Settings.',
        'Confirm backup routing is still working.',
      ],
    };
  }

  if (snapshot.hallucinationCount > 0 || snapshot.missedBookingCount > 0) {
    return {
      severity: 'alert',
      headline: `Immediate attention needed: ${snapshot.hallucinationCount} answer issue${snapshot.hallucinationCount === 1 ? '' : 's'}, ${snapshot.missedBookingCount} missed booking${snapshot.missedBookingCount === 1 ? '' : 's'}`,
      summary:
        'Some recent calls may need review because answers were unclear or booking opportunities were missed.',
      actions: [
        snapshot.hallucinationCount > 0
          ? `Review ${snapshot.hallucinationCount} hallucination${snapshot.hallucinationCount === 1 ? '' : 's'} and update FAQs or business notes if needed.`
          : 'Answers look stable.',
        snapshot.missedBookingCount > 0
          ? `Review ${snapshot.missedBookingCount} missed booking opportunit${snapshot.missedBookingCount === 1 ? 'y' : 'ies'}.`
          : 'Booking capture looks stable.',
        snapshot.pendingReviewCount > 0
          ? `Clear the ${snapshot.pendingReviewCount} remaining call review${snapshot.pendingReviewCount === 1 ? '' : 's'}.`
          : 'No pending call reviews.',
      ],
    };
  }

  return {
    severity: 'ok',
    headline: 'Queue is healthy',
    summary:
      'Recent calls look stable, with no urgent review issues detected.',
    actions: [
      snapshot.pendingReviewCount > 0
        ? `Review ${snapshot.pendingReviewCount} recent call${snapshot.pendingReviewCount === 1 ? '' : 's'}.`
        : 'All recent calls have been reviewed.',
      `Total calls processed: ${snapshot.totalCallsReviewed}`,
    ],
  };
}
