import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCall } from '../api.js';
import { Icon } from '../components/Icon.js';
import { useTenant } from '../tenant.js';
import type { CallSummary } from '../types.js';

interface CallTimelineItem { id?: string; type?: string; createdAt?: string; }

export function CallDetailsPage() {
  const { role } = useTenant();
  const { id } = useParams<{ id: string }>();
  const [call, setCall] = useState<CallSummary | null>(null);
  const [timeline, setTimeline] = useState<CallTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      try { setLoading(true); setError(null); const data = await getCall(id); setCall(data.call); setTimeline(data.timeline as CallTimelineItem[]); }
      catch (err) { setError(err instanceof Error ? err.message : 'Failed to load call details.'); }
      finally { setLoading(false); }
    };
    void run();
  }, [id]);

  if (loading) {
    return (
      <section>
        <div className="page-head">
          <div>
            <Link to="/dashboard" className="back-link"><Icon name="arrow-left" size={15} /> Back to Dashboard</Link>
            <h1>Call Details</h1>
          </div>
        </div>
        <div className="skeleton-grid">
          <div className="skeleton-card"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>
          <div className="skeleton-card"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line" /></div>
        </div>
      </section>
    );
  }

  if (error) return <section><Link to="/dashboard" className="back-link"><Icon name="arrow-left" size={15} /> Back to Dashboard</Link><p role="alert">{error}</p></section>;
  if (!call) return <section><Link to="/dashboard" className="back-link"><Icon name="arrow-left" size={15} /> Back to Dashboard</Link><p>Call not found.</p></section>;

  return (
    <section>
      <div className="page-head">
        <div>
          <Link to="/dashboard" className="back-link"><Icon name="arrow-left" size={15} /> Back to Dashboard</Link>
          <h1>Call Details</h1>
          <p className="subtitle">Full context for this interactions.</p>
        </div>
      </div>

      <div className="detail-grid">
        <article className="settings-card">
          <h2>Summary</h2>
          <p>{call.summary}</p>
          <ul className="detail-list">
            <li><Icon name="phone" size={14} /> <strong>Caller:</strong> {call.caller_phone}</li>
            <li><Icon name="zap" size={14} /> <strong>Intent:</strong> {call.call_intent}</li>
            <li><Icon name="clock" size={14} /> <strong>Duration:</strong> {Math.round(call.duration_seconds)}s</li>
            <li><Icon name="globe" size={14} /> <strong>Language:</strong> {call.language_detected.toUpperCase()}</li>
          </ul>
        </article>

        <article className="settings-card transcript-card">
          <h2>Transcript</h2>
          <pre>{call.transcript ?? 'No transcript available yet.'}</pre>
        </article>
      </div>

      <div className="detail-grid">
        {role === 'operator' && (
          <section className="settings-card">
            <h2>QA Flags</h2>
            <ul className="plain-list">
              {call.hallucination_flag ? (
                <li><Icon name="alert" size={13} /> <span className="danger-text">Hallucination Detected</span></li>
              ) : null}
              {call.missed_booking_opportunity ? (
                <li><Icon name="alert" size={13} /> <span className="warning-text">Missed Booking Opportunity</span></li>
              ) : null}
              {call.escalation_successful === false ? (
                <li><Icon name="alert" size={13} /> <span className="danger-text">Escalation Failed</span></li>
              ) : null}
              {!call.hallucination_flag && !call.missed_booking_opportunity && call.escalation_successful !== false ? (
                <div className="empty-state-inline">
                  <Icon name="shield" size={20} />
                  <p>No issues detected.</p>
                </div>
              ) : null}
            </ul>
          </section>
        )}

        <section className="settings-card">
          <h2>Timeline</h2>
          {timeline.length ? (
            <ul className="timeline-list">
              {timeline.map((item, index) => (
                <li key={item.id ?? index} className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <strong>{item.type ?? 'Event'}</strong>
                    {item.createdAt ? <small>{new Date(item.createdAt).toLocaleString()}</small> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state-inline">
              <Icon name="clock" size={20} />
              <p>No timeline events yet.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
