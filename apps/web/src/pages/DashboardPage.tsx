import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCalls, subscribeCalls, runOnboardingTestCall } from '../api.js';
import { CallCard } from '../components/CallCard.js';
import { Icon } from '../components/Icon.js';
import { ReadinessPanel } from '../components/ReadinessPanel.js';
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
      setActionMessage('Creating test request...');
      await runOnboardingTestCall(settings?.id);
      setActionMessage('Test request created.');
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to create test request.');
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
                : 'Loading calls and bookings…'}
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
      <section className="mb-8 rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1>{role === 'client_admin' ? 'Business overview' : 'Inbox'}</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              {role === 'client_admin'
                ? 'See new calls, urgent issues, and booked work without jumping between screens.'
                : settings?.business_name
                  ? `${settings.business_name} calls, booked jobs, and anything that needs you in one place.`
                  : 'Calls, booked jobs, and anything that needs you in one place.'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                New calls
              </p>
              <strong className="mt-1 block text-2xl text-white">{calls.length}</strong>
              <p className="mt-1 text-sm text-gray-400">recent customer calls</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Booked jobs
              </p>
              <strong className="mt-1 block text-2xl text-white">{bookingCount}</strong>
              <p className="mt-1 text-sm text-gray-400">already on your calendar</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Needs you
              </p>
              <strong className="mt-1 block text-2xl text-white">
                {urgentCount + followUpCount}
              </strong>
              <p className="mt-1 text-sm text-gray-400">calls to check yourself</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr),360px]">
        <section className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">New and recent calls</h2>
              <p className="mt-1 text-sm text-gray-400">
                New calls show up here automatically. Search by phone number or what the caller needed.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="search-field">
                <span className="sr-only">Search calls</span>
                <Icon name="search" size={15} className="search-icon" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search calls…"
                />
              </label>
              <button
                onClick={() => void refresh()}
                disabled={loading || actionBusy}
                className="ghost"
              >
                <Icon name="refresh" size={14} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 cards">
            {shownCalls.length === 0 ? (
              <div className="empty-state">
                <Icon name="check" size={28} />
                <p>No calls match this search yet.</p>
              </div>
            ) : (
              shownCalls.map((call) => <CallCard key={call.id} call={call} />)
            )}
          </div>
        </section>

        <aside className="grid gap-6">
          <article className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Do this now</h2>
            <p className="mt-2 text-sm text-gray-400">
              The fastest way to check calls, bookings, and setup without digging around.
            </p>
            <div className="mt-5 grid gap-3">
              {role === 'operator' ? (
                <button
                  onClick={() => void handleCreateSampleRequest()}
                  disabled={loading || actionBusy}
                >
                  <Icon name="phone" size={14} />
                  Create a sample request
                </button>
              ) : null}
              <Link
                to="/calendar"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8"
              >
                <span className="flex items-center gap-2">
                  <Icon name="calendar" size={14} />
                  Review today&apos;s bookings
                </span>
                <Icon name="chevron" size={14} />
              </Link>
              <Link
                to="/settings"
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8"
              >
                <span className="flex items-center gap-2">
                  <Icon name="settings" size={14} />
                  Check setup
                </span>
                <Icon name="chevron" size={14} />
              </Link>
            </div>
          </article>

          <ReadinessPanel settings={settings} />
        </aside>
      </div>

      {actionMessage ? <p className="action-toast">{actionMessage}</p> : null}
    </div>
  );
}
