import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCall } from '../api.js';
import { Icon } from '../components/Icon.js';
import { useTenant } from '../tenant.js';
import type { CallSummary } from '../types.js';

interface CallTimelineItem {
  id?: string;
  type?: string;
  createdAt?: string;
}

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
      try {
        setLoading(true);
        setError(null);
        const data = await getCall(id);
        setCall(data.call);
        setTimeline(data.timeline as CallTimelineItem[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load call details.');
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [id]);

  if (loading) {
    return (
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="dashboard-head">
          <Link to="/dashboard" className="back-link">
            <Icon name="arrow-left" size={15} /> Back to Dashboard
          </Link>
          <h1>Call details</h1>
          <p className="subtitle">Loading the full conversation and timeline…</p>
        </div>
        <div className="skeleton-grid">
          <div className="skeleton-card">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
          <div className="skeleton-card">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line" />
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="max-w-7xl mx-auto px-6 py-12">
        <Link to="/dashboard" className="back-link">
          <Icon name="arrow-left" size={15} /> Back to Dashboard
        </Link>
        <p role="alert">{error}</p>
      </section>
    );
  }

  if (!call) {
    return (
      <section className="max-w-7xl mx-auto px-6 py-12">
        <Link to="/dashboard" className="back-link">
          <Icon name="arrow-left" size={15} /> Back to Dashboard
        </Link>
        <div className="empty-state">
          <Icon name="phone" size={28} />
          <h3>Call not found</h3>
          <p>This conversation is no longer available in the dashboard.</p>
        </div>
      </section>
    );
  }

  const cleanRun =
    !call.hallucination_flag &&
    !call.missed_booking_opportunity &&
    call.escalation_successful !== false;

  return (
    <section className="max-w-7xl mx-auto px-6 py-12">
      <section className="dashboard-head">
        <Link to="/dashboard" className="back-link">
          <Icon name="arrow-left" size={15} /> Back to Dashboard
        </Link>
        <div className="page-head">
          <div>
            <h1>Call details</h1>
            <p className="subtitle">Conversation summary, review flags, and timeline for this request.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Caller
              </p>
              <strong className="mt-1 block text-white">{call.caller_phone}</strong>
              <p className="mt-1 text-sm text-gray-400">phone number</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Intent
              </p>
              <strong className="mt-1 block text-white">{call.call_intent}</strong>
              <p className="mt-1 text-sm text-gray-400">captured from the call</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Duration
              </p>
              <strong className="mt-1 block text-white">{Math.round(call.duration_seconds)}s</strong>
              <p className="mt-1 text-sm text-gray-400">
                {call.language_detected.toUpperCase()} transcript
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr),360px]">
        <div className="grid gap-6">
          <article className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Summary</h2>
            <p className="mt-2 text-sm leading-7 text-gray-400">{call.summary}</p>
            <ul className="mt-5 detail-list">
              <li>
                <Icon name="phone" size={14} /> <strong>Caller:</strong> {call.caller_phone}
              </li>
              <li>
                <Icon name="zap" size={14} /> <strong>Intent:</strong> {call.call_intent}
              </li>
              <li>
                <Icon name="clock" size={14} /> <strong>Duration:</strong>{' '}
                {Math.round(call.duration_seconds)}s
              </li>
              <li>
                <Icon name="globe" size={14} /> <strong>Language:</strong>{' '}
                {call.language_detected.toUpperCase()}
              </li>
            </ul>
          </article>

          <article className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Transcript</h2>
            <p className="mt-2 text-sm text-gray-400">
              Full call text, useful for review or follow-up.
            </p>
            <div className="mt-5">
              <pre>{call.transcript ?? 'No transcript available yet.'}</pre>
            </div>
          </article>
        </div>

        <aside className="grid gap-6">
          {role === 'operator' ? (
            <section className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
              <h2 className="text-xl font-bold text-white">Review flags</h2>
              <p className="mt-2 text-sm text-gray-400">
                Signals that may need a person to review the conversation.
              </p>
              <ul className="mt-5 plain-list">
                {call.hallucination_flag ? (
                  <li>
                    <Icon name="alert" size={13} />{' '}
                    <span className="danger-text">Answer may be incorrect</span>
                  </li>
                ) : null}
                {call.missed_booking_opportunity ? (
                  <li>
                    <Icon name="alert" size={13} />{' '}
                    <span className="warning-text">Missed booking opportunity</span>
                  </li>
                ) : null}
                {call.escalation_successful === false ? (
                  <li>
                    <Icon name="alert" size={13} />{' '}
                    <span className="danger-text">Urgent handoff failed</span>
                  </li>
                ) : null}
                {cleanRun ? (
                  <div className="empty-state-inline">
                    <Icon name="shield" size={20} />
                    <p>No issues detected.</p>
                  </div>
                ) : null}
              </ul>
            </section>
          ) : null}

          <section className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Timeline</h2>
            <p className="mt-2 text-sm text-gray-400">
              Events captured while the request moved through the system.
            </p>
            {timeline.length ? (
              <ul className="mt-5 timeline-list">
                {timeline.map((item, index) => (
                  <li key={item.id ?? index} className="timeline-item">
                    <span className="timeline-dot" />
                    <div>
                      <strong>{item.type ?? 'Event'}</strong>
                      {item.createdAt ? (
                        <small>{new Date(item.createdAt).toLocaleString()}</small>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-5 empty-state-inline">
                <Icon name="clock" size={20} />
                <p>No timeline events yet.</p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
