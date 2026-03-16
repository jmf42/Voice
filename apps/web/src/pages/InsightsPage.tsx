import { useEffect, useMemo, useState } from 'react';
import { loadMetrics } from '../api.js';
import { Icon } from '../components/Icon.js';
import { buildQAAssistantBrief } from '../ops-intelligence.js';
import type { Metrics } from '../types.js';
import { useTenant } from '../tenant.js';

function formatPercent(value: number): string { return `${Math.round(value * 100)}%`; }

interface HealthCheck { label: string; status: 'good' | 'warn'; detail: string; icon: string; }

export function InsightsPage() {
  const { role } = useTenant();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try { setLoading(true); setError(null); setMetrics(await loadMetrics()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load insights.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const checks = useMemo<HealthCheck[]>(() => {
    if (!metrics) return [];
    return [
      { label: 'Answer rate', icon: 'phone', status: (metrics.calls_answered / Math.max(metrics.calls_total, 1)) >= 0.95 ? 'good' : 'warn', detail: `${formatPercent(metrics.calls_answered / Math.max(metrics.calls_total, 1))} of calls answered.` },
      { label: 'Answer risk', icon: 'alert', status: metrics.hallucination_rate < 0.05 ? 'good' : 'warn', detail: `${formatPercent(metrics.hallucination_rate)} of calls may need answer review.` },
      { label: 'Average duration', icon: 'clock', status: metrics.avg_call_duration_seconds < 120 ? 'good' : 'warn', detail: `${Math.round(metrics.avg_call_duration_seconds)}s average call length.` },
      { label: 'Urgent handoffs', icon: 'zap', status: metrics.urgent_escalations < 5 ? 'good' : 'warn', detail: `${metrics.urgent_escalations} urgent handoffs.` },
    ] as HealthCheck[];
  }, [metrics]);

  const assistantBrief = useMemo(() => {
    if (!metrics) return null;
    return buildQAAssistantBrief({
      hallucinationCount: Math.round(metrics.calls_total * metrics.hallucination_rate),
      missedBookingCount: Math.max(metrics.calls_total - metrics.bookings_created, 0),
      failedEscalationCount: 0,
      totalCallsReviewed: metrics.calls_total,
      pendingReviewCount: 0,
    });
  }, [metrics]);

  if (loading) {
    return (
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="page-head">
          <div className="dashboard-head">
            <h1>Insights</h1>
            <p className="subtitle">Loading reliability metrics…</p>
          </div>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton-card kpi-skeleton"><div className="skeleton-line short" /><div className="skeleton-line wide" /><div className="skeleton-line short" /></div>
          ))}
        </div>
      </section>
    );
  }

  if (error) return <p role="alert">{error}</p>;
  if (!metrics) return <div className="empty-state"><Icon name="chart" size={32} /><p>No metrics available.</p></div>;

  return (
    <section className="max-w-7xl mx-auto px-6 py-12">
      <section className="dashboard-head">
        <div className="page-head">
          <div>
            <h1>Insights</h1>
            <p className="subtitle">Call volume, booking outcomes, and review risk in one quick summary.</p>
          </div>
          <button onClick={() => void refresh()} disabled={loading} className="ghost">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </section>

      {role === 'operator' && assistantBrief ? (
        <article className={`assistant-brief ${assistantBrief.severity}`}>
          <header><h2>{assistantBrief.headline}</h2><p>{assistantBrief.summary}</p></header>
          <ul className="plain-list">{assistantBrief.actions.map((a) => <li key={a}>{a}</li>)}</ul>
        </article>
      ) : null}

      <div className="kpi-grid">
        <article className="kpi-card"><span><Icon name="phone" size={13} /> Total calls</span><strong>{metrics.calls_total}</strong><small>{metrics.calls_answered} answered</small></article>
        <article className="kpi-card"><span><Icon name="check" size={13} /> Bookings</span><strong>{metrics.bookings_created}</strong><small>new appointments</small></article>
        <article className="kpi-card"><span><Icon name="zap" size={13} /> Missed recovered</span><strong>{metrics.missed_calls_recovered}</strong><small>saved opportunities</small></article>
        <article className="kpi-card"><span><Icon name="briefcase" size={13} /> Callbacks</span><strong>{metrics.callback_requests_captured}</strong><small>requests captured</small></article>
        <article className="kpi-card"><span><Icon name="clock" size={13} /> After hours</span><strong>{metrics.after_hours_calls_handled}</strong><small>covered after hours</small></article>
        <article className="kpi-card"><span><Icon name="alert" size={13} /> Urgent handoffs</span><strong>{metrics.urgent_escalations}</strong><small>urgent cases</small></article>
      </div>

      {role === 'operator' && (
        <div className="health-grid">
          {checks.map((check) => (
            <article key={check.label} className={`health-card ${check.status}`}>
              <h2><Icon name={check.icon} size={15} /> {check.label}</h2>
              <p>{check.detail}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
