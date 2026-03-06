import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAppointments } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Appointment } from '../types.js';

function startOfLocalDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

function formatDayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${dayKey}T00:00:00`));
}

function formatTime(apt: Appointment): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(apt.confirmed_slot_start ?? apt.createdAt));
}

export function CalendarPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualOnly, setManualOnly] = useState(false);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const items = await listAppointments();
      const active = items.filter(a => a.status === 'confirmed' || a.status === 'needs_manual_booking');
      setAppointments(active.sort((a, b) => new Date(a.confirmed_slot_start ?? a.createdAt).getTime() - new Date(b.confirmed_slot_start ?? b.createdAt).getTime()));
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load calendar appointments.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const displayedAppointments = useMemo(() => manualOnly ? appointments.filter((j) => j.status === 'needs_manual_booking') : appointments, [appointments, manualOnly]);

  const grouped = useMemo(() => {
    const output = new Map<string, Appointment[]>();
    for (const apt of displayedAppointments) {
      const day = startOfLocalDay(new Date(apt.confirmed_slot_start ?? apt.createdAt)).toISOString().slice(0, 10);
      output.set(day, [...(output.get(day) ?? []), apt]);
    }
    return [...output.entries()];
  }, [displayedAppointments]);

  const todayCount = useMemo(() => grouped.find(([d]) => d === startOfLocalDay(new Date()).toISOString().slice(0, 10))?.[1].length ?? 0, [grouped]);
  const manualBookingCount = useMemo(() => appointments.filter((j) => j.status === 'needs_manual_booking').length, [appointments]);
  const nextAppointment = useMemo(() => {
    const upcoming = appointments.find((j) => new Date(j.confirmed_slot_start ?? j.createdAt).getTime() >= Date.now());
    return upcoming ? `${new Date(upcoming.confirmed_slot_start ?? upcoming.createdAt).toLocaleString()} — ${upcoming.caller_name || upcoming.caller_phone}` : null;
  }, [appointments]);

  if (loading) {
    return (
      <section>
        <div className="page-head">
          <div><h1>Calendar</h1><p className="subtitle">Loading appointments…</p></div>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-card kpi-skeleton"><div className="skeleton-line short" /><div className="skeleton-line wide" /><div className="skeleton-line short" /></div>
          ))}
        </div>
        <div className="calendar-board">
          <div className="skeleton-card"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>
        </div>
      </section>
    );
  }

  if (error) return <p role="alert">{error}</p>;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="subtitle">Accepted appointments by day.</p>
        </div>
        <div className="head-controls">
          <button className={manualOnly ? 'toggle on' : 'toggle'} onClick={() => setManualOnly((v) => !v)}>
            <Icon name="zap" size={14} />
            {manualOnly ? 'Manual only' : 'All appointments'}
          </button>
          <button onClick={() => void refresh()} disabled={loading} className="ghost">
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>

      {nextAppointment ? (
        <article className="assistant-brief ok">
          <header>
            <h2><Icon name="clock" size={16} /> Next appointment</h2>
            <p>{nextAppointment}</p>
          </header>
        </article>
      ) : null}

      <div className="kpi-grid">
        <article className="kpi-card"><span><Icon name="calendar" size={13} /> Today</span><strong>{todayCount}</strong><small>scheduled</small></article>
        <article className="kpi-card"><span><Icon name="chart" size={13} /> Days ahead</span><strong>{grouped.length}</strong><small>with confirmed bookings</small></article>
        <article className="kpi-card"><span><Icon name="check" size={13} /> Confirmed</span><strong>{appointments.length}</strong><small>total accepted</small></article>
        <article className="kpi-card"><span><Icon name="phone" size={13} /> Manual</span><strong>{manualBookingCount}</strong><small>need manual booking</small></article>
      </div>

      {grouped.length === 0 ? (
        <div className="empty-state">
          <Icon name="calendar" size={36} />
          <h3>No confirmed appointments</h3>
          <p>No confirmed appointments match the current view. Check the <Link to="/dashboard">Dashboard</Link> for recent calls.</p>
        </div>
      ) : (
        <div className="calendar-board">
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
                      <p className="calendar-summary">{apt.service_requested || 'General Appointment'}</p>
                      <p className="calendar-address"><Icon name="user" size={12} /> {apt.caller_name || 'Guest'}</p>
                      <div className="calendar-meta">
                        <a href={`tel:${apt.caller_phone}`}><Icon name="phone" size={12} /> {apt.caller_phone}</a>
                        {apt.callId ? <Link to={`/calls/${apt.callId}`}>View Call</Link> : null}
                        {apt.status === 'needs_manual_booking' ? <span className="ops-pill overdue"><Icon name="alert" size={11} /> Manual booking needed</span> : null}
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
  );
}
