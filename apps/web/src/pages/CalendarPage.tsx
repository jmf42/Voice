import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAppointments } from '../api.js';
import { Icon } from '../components/Icon.js';
import { useTenant } from '../tenant.js';
import type { Appointment } from '../types.js';

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dayKey}T00:00:00`));
}

function formatTime(apt: Appointment): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(apt.confirmed_slot_start ?? apt.createdAt),
  );
}

export function CalendarPage() {
  const { settings } = useTenant();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualOnly, setManualOnly] = useState(false);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const items = await listAppointments();
      const active = items.filter(
        (a) => a.status === 'confirmed' || a.status === 'needs_manual_booking',
      );
      setAppointments(
        active.sort(
          (a, b) =>
            new Date(a.confirmed_slot_start ?? a.createdAt).getTime() -
            new Date(b.confirmed_slot_start ?? b.createdAt).getTime(),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load calendar appointments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const displayedAppointments = useMemo(
    () =>
      manualOnly ? appointments.filter((j) => j.status === 'needs_manual_booking') : appointments,
    [appointments, manualOnly],
  );

  const grouped = useMemo(() => {
    const output = new Map<string, Appointment[]>();
    for (const apt of displayedAppointments) {
      const day = startOfLocalDay(new Date(apt.confirmed_slot_start ?? apt.createdAt))
        .toISOString()
        .slice(0, 10);
      output.set(day, [...(output.get(day) ?? []), apt]);
    }
    return [...output.entries()];
  }, [displayedAppointments]);

  const todayCount = useMemo(
    () =>
      grouped.find(([d]) => d === startOfLocalDay(new Date()).toISOString().slice(0, 10))?.[1]
        .length ?? 0,
    [grouped],
  );
  const manualBookingCount = useMemo(
    () => appointments.filter((j) => j.status === 'needs_manual_booking').length,
    [appointments],
  );
  const nextAppointment = useMemo(() => {
    const upcoming = appointments.find(
      (j) => new Date(j.confirmed_slot_start ?? j.createdAt).getTime() >= Date.now(),
    );
    return upcoming
      ? `${new Date(upcoming.confirmed_slot_start ?? upcoming.createdAt).toLocaleString()} — ${upcoming.caller_name || upcoming.caller_phone}`
      : null;
  }, [appointments]);

  if (loading) {
    return (
      <section>
        <div className="page-head">
          <div>
            <h1>Calendar</h1>
            <p className="subtitle">Loading appointments…</p>
          </div>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-card kpi-skeleton">
              <div className="skeleton-line short" />
              <div className="skeleton-line wide" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
        <div className="calendar-board">
          <div className="skeleton-card">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        </div>
      </section>
    );
  }

  if (error) return <p role="alert">{error}</p>;

  return (
    <section className="max-w-7xl mx-auto px-6 py-12">
      <section className="mb-8 rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1>Calendar</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              See confirmed bookings, manual follow-ups, and the next appointment in one place.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Today
              </p>
              <strong className="mt-1 block text-2xl text-white">{todayCount}</strong>
              <p className="mt-1 text-sm text-gray-400">scheduled today</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Confirmed
              </p>
              <strong className="mt-1 block text-2xl text-white">{appointments.length}</strong>
              <p className="mt-1 text-sm text-gray-400">active appointments</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Manual
              </p>
              <strong className="mt-1 block text-2xl text-white">{manualBookingCount}</strong>
              <p className="mt-1 text-sm text-gray-400">need follow-up</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr),360px]">
        <section className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Upcoming appointments</h2>
              <p className="mt-1 text-sm text-gray-400">Confirmed bookings grouped by day.</p>
            </div>
            <div className="flex gap-3">
              <button
                className={manualOnly ? 'toggle on' : 'toggle'}
                onClick={() => setManualOnly((v) => !v)}
              >
                <Icon name="zap" size={14} />
                {manualOnly ? 'Manual only' : 'All appointments'}
              </button>
              <button onClick={() => void refresh()} disabled={loading} className="ghost">
                <Icon name="refresh" size={14} />
                Refresh
              </button>
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="mt-6 empty-state">
              <Icon name="calendar" size={36} />
              <h3>No confirmed appointments</h3>
              <p>
                No confirmed appointments match the current view. Check the{' '}
                <Link to="/dashboard">Dashboard</Link> for recent calls.
              </p>
            </div>
          ) : (
            <div className="mt-6 calendar-board">
              {grouped.map(([day, entries]) => (
                <article className="calendar-day" key={day}>
                  <header>
                    <h2>{formatDayLabel(day)}</h2>
                    <p>{entries.length} scheduled</p>
                  </header>
                  <ol className="calendar-events">
                    {entries.map((apt) => (
                      <li key={apt.id} className="calendar-event">
                        <p className="calendar-time">{formatTime(apt)}</p>
                        <div>
                          <p className="calendar-summary">
                            {apt.service_requested || 'General Appointment'}
                          </p>
                          <p className="calendar-address">
                            <Icon name="user" size={12} /> {apt.caller_name || 'Guest'}
                          </p>
                          <div className="calendar-meta">
                            <a href={`tel:${apt.caller_phone}`}>
                              <Icon name="phone" size={12} /> {apt.caller_phone}
                            </a>
                            {apt.callId ? <Link to={`/calls/${apt.callId}`}>View call</Link> : null}
                            {apt.status === 'needs_manual_booking' ? (
                              <span className="ops-pill overdue">
                                <Icon name="alert" size={11} /> Manual booking needed
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="grid gap-6">
          <article className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Calendar status</h2>
            <p className="mt-2 text-sm text-gray-400">
              {settings?.calendar_enabled
                ? 'Google Calendar is connected and can receive confirmed bookings.'
                : 'Calendar is not connected yet. Booking stays manual until you connect it.'}
            </p>
            {nextAppointment ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Next appointment
                </p>
                <strong className="mt-1 block text-white">{nextAppointment}</strong>
              </div>
            ) : null}
          </article>

          <article className="rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-bold text-white">Manual follow-up</h2>
            <p className="mt-2 text-sm text-gray-400">
              These bookings still need a person to confirm the slot.
            </p>
            <div className="mt-5 grid gap-3">
              {appointments.filter((apt) => apt.status === 'needs_manual_booking').length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-gray-300">
                  Nothing is waiting for manual booking right now.
                </div>
              ) : (
                appointments
                  .filter((apt) => apt.status === 'needs_manual_booking')
                  .map((apt) => (
                    <div
                      key={apt.id}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4"
                    >
                      <strong className="block text-white">
                        {apt.service_requested || 'General request'}
                      </strong>
                      <p className="mt-1 text-sm text-gray-400">{apt.notes}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm">
                        <a href={`tel:${apt.caller_phone}`}>{apt.caller_phone}</a>
                        {apt.callId ? <Link to={`/calls/${apt.callId}`}>Open call</Link> : null}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}
