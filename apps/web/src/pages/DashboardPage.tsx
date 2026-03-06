import { useEffect, useMemo, useState } from 'react';
import { listCalls, subscribeCalls, runOnboardingTestCall } from '../api.js';
import { CallCard } from '../components/CallCard.js';
import { Icon } from '../components/Icon.js';
import { useTenant } from '../tenant.js';
import type { CallSummary } from '../types.js';

export function DashboardPage() {
  const { settings, role } = useTenant();
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function handleCreateSampleRequest() {
    try {
      setActionBusy(true);
      setActionMessage('Creating sample request...');
      await runOnboardingTestCall(settings?.id);
      setActionMessage('Sample request created.');
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to create sample request.');
    } finally {
      setActionBusy(false);
      setTimeout(() => setActionMessage(null), 3000);
    }
  }

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      setCalls(await listCalls(role === 'client_admin' ? settings?.id : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    void refresh();
    const unsubscribe = subscribeCalls(
      role === 'client_admin' ? settings?.id : undefined,
      (items) => {
        if (mounted) {
          setCalls(items);
          setLoading(false);
        }
      },
      () => {},
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [role, settings?.id]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  const shownCalls = useMemo(() => {
    return calls
      .filter((call) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return call.caller_phone.includes(q) || call.summary.toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [calls, searchQuery]);

  const urgentCount = useMemo(
    () => calls.filter((call) => call.call_intent === 'urgent_escalation').length,
    [calls],
  );
  const bookingCount = useMemo(
    () =>
      calls.filter((call) => call.call_intent === 'booking' && !call.missed_booking_opportunity)
        .length,
    [calls],
  );
  const followUpCount = useMemo(
    () =>
      calls.filter(
        (call) =>
          call.missed_booking_opportunity ||
          call.escalation_successful === false ||
          call.hallucination_flag,
      ).length,
    [calls],
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="page-head dashboard-head">
          <div>
            <h1>{role === 'client_admin' ? 'Business overview' : 'Inbox'}</h1>
            <p className="subtitle">
              {role === 'client_admin'
                ? 'Loading your latest customer activity…'
                : 'Loading customer requests…'}
            </p>
          </div>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton-card kpi-skeleton">
              <div className="skeleton-line short" />
              <div className="skeleton-line wide" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <p role="alert">{error}</p>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="page-head dashboard-head">
        <div>
          <h1>{role === 'client_admin' ? 'Business overview' : 'Inbox'}</h1>
          <p className="subtitle">
            {role === 'client_admin'
              ? 'See customer requests, urgent cases, and bookings in one place.'
              : settings?.business_name
                ? `${settings.business_name} customer requests and appointments.`
                : 'Customer requests and appointments.'}
          </p>
        </div>
        <div className="head-controls">
          <label className="search-field">
            <span className="sr-only">Search calls</span>
            <Icon name="search" size={15} className="search-icon" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search calls…"
            />
          </label>
          {role === 'operator' && (
            <button
              className="ghost"
              onClick={() => void handleCreateSampleRequest()}
              disabled={loading || actionBusy}
            >
              <Icon name="phone" size={14} />
              Create sample request
            </button>
          )}
          <button onClick={() => void refresh()} disabled={loading || actionBusy} className="ghost">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>

      <article
        className={`assistant-brief ${urgentCount > 0 || followUpCount > 0 ? 'attention' : 'ok'}`}
      >
        <header className="mb-4">
          <h2>{role === 'client_admin' ? 'Today at a glance' : 'What needs attention'}</h2>
          <p className="subtitle">
            {urgentCount > 0
              ? `${urgentCount} urgent request${urgentCount === 1 ? '' : 's'} need a quick callback or transfer.`
              : followUpCount > 0
                ? `${followUpCount} request${followUpCount === 1 ? '' : 's'} need follow-up to close the loop.`
                : 'Everything looks calm right now. New requests will appear here automatically.'}
          </p>
        </header>
        <ul className="plain-list">
          <li>
            {bookingCount} booking request{bookingCount === 1 ? '' : 's'} handled successfully.
          </li>
          <li>
            {urgentCount} urgent request{urgentCount === 1 ? '' : 's'} currently in the queue.
          </li>
          <li>
            {followUpCount} request{followUpCount === 1 ? '' : 's'} need manual follow-up.
          </li>
        </ul>
      </article>

      <div className="kpi-grid grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <article className="kpi-card">
          <span>
            <Icon name="phone" size={13} /> Requests
          </span>
          <strong>{calls.length}</strong>
          <small>recent customer conversations</small>
        </article>
        <article className="kpi-card">
          <span className="kpi-label--success">
            <Icon name="calendar" size={13} /> Booked
          </span>
          <strong>{bookingCount}</strong>
          <small>appointments already captured</small>
        </article>
        <article className="kpi-card">
          <span className={urgentCount > 0 ? 'kpi-label--info' : undefined}>
            <Icon name="alert" size={13} /> Urgent
          </span>
          <strong>{urgentCount}</strong>
          <small>need fast attention</small>
        </article>
      </div>

      <div className="board">
        <div className="board-column new-column recent-calls-column">
          <div className="column-head">
            <h2>
              <Icon name="phone" size={16} /> Latest requests
            </h2>
            <span className="count-badge">{shownCalls.length}</span>
          </div>
          <div className="cards">
            {shownCalls.length === 0 ? (
              <div className="empty-state">
                <Icon name="check" size={28} />
                <p>No requests match this search yet.</p>
              </div>
            ) : (
              shownCalls.map((call) => <CallCard key={call.id} call={call} />)
            )}
          </div>
        </div>
      </div>

      {actionMessage ? <p className="action-toast">{actionMessage}</p> : null}
    </div>
  );
}
