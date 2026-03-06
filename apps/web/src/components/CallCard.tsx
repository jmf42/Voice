import { Link } from 'react-router-dom';
import type { CallSummary } from '../types.js';
import { Icon } from './Icon.js';

interface CallCardProps {
  call: CallSummary;
}

function intentLabel(intent: CallSummary['call_intent']): string {
  if (intent === 'urgent_escalation') return 'Urgent';
  if (intent === 'booking') return 'Booking';
  if (intent === 'faq') return 'Question';
  if (intent === 'message') return 'Message';
  return 'Request';
}

export function CallCard({ call }: CallCardProps) {
  const isAlert =
    call.hallucination_flag ||
    call.missed_booking_opportunity ||
    call.escalation_successful === false;

  return (
    <article className={`call-card ${isAlert ? 'alert' : ''}`}>
      <div className="job-head">
        <div className="job-status">
          <span className={`badge ${isAlert ? 'danger' : 'normal'}`}>
            {intentLabel(call.call_intent)}
          </span>
        </div>
        <div className="link-action job-phone">
          <Icon name="phone" size={13} />
          {call.caller_phone}
        </div>
      </div>

      <p className="summary">
        {call.summary.length > 100 ? call.summary.substring(0, 100) + '...' : call.summary}
      </p>

      <div className="time-window ops-meta">
        <span className="ops-pill">
          <Icon name="clock" size={11} /> {Math.round(call.duration_seconds)}s
        </span>
        <span className="ops-pill">
          <Icon name="check" size={11} /> {call.language_detected.toUpperCase()}
        </span>
      </div>

      <div className="ops-meta" style={{ marginTop: '0.5rem' }}>
        {call.hallucination_flag ? (
          <span className="ops-pill overdue">
            <Icon name="alert" size={11} />
            Check AI answer
          </span>
        ) : null}
        {call.missed_booking_opportunity ? (
          <span className="ops-pill overdue">
            <Icon name="alert" size={11} />
            Follow-up needed
          </span>
        ) : null}
        {call.escalation_successful === false ? (
          <span className="ops-pill overdue">
            <Icon name="alert" size={11} />
            Urgent transfer failed
          </span>
        ) : null}
      </div>

      <Link to={`/calls/${call.id}`} className="details-link">
        Open details →
      </Link>
    </article>
  );
}
