import { useEffect, useState } from 'react';
import { connectCalendar, runOnboardingTestCall } from '../api.js';
import { Icon } from '../components/Icon.js';
import { ReadinessPanel } from '../components/ReadinessPanel.js';
import { useTenant } from '../tenant.js';
import type { ClientProfile as Settings } from '../types.js';

export function SettingsPage() {
  const { settings, loading, error, saveSettings, role } = useTenant();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // Auto-dismiss messages
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  function addFaq() {
    if (!draft) return;
    setDraft({ ...draft, faqs: [...(draft.faqs ?? []), { question: '', answer: '' }] });
  }

  function updateFaq(index: number, key: 'question' | 'answer', value: string) {
    if (!draft?.faqs) return;
    const nextFaqs = [...draft.faqs];
    const current = nextFaqs[index];
    if (!current) return;
    nextFaqs[index] = { ...current, [key]: value };
    setDraft({ ...draft, faqs: nextFaqs });
  }

  function removeFaq(index: number) {
    if (!draft?.faqs) return;
    setDraft({ ...draft, faqs: draft.faqs.filter((_, currentIndex) => currentIndex !== index) });
  }

  function addService() {
    if (!draft) return;
    setDraft({
      ...draft,
      services: [
        ...(draft.services ?? []),
        { name: '', description: '', price: '', duration_minutes: 30 },
      ],
    });
  }

  function updateService(
    index: number,
    key: 'name' | 'description' | 'price' | 'duration_minutes',
    value: string | number,
  ) {
    if (!draft?.services) return;
    const nextServices = [...draft.services];
    const current = nextServices[index];
    if (!current) return;
    nextServices[index] = { ...current, [key]: value };
    setDraft({ ...draft, services: nextServices });
  }

  function removeService(index: number) {
    if (!draft?.services) return;
    setDraft({
      ...draft,
      services: draft.services.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="page-head relative z-10 mb-8 p-6 bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Settings
          </h1>
        </div>
        <div className="settings-layout grid gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="skeleton-card bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6"
            >
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <p role="alert">{error}</p>;
  if (!draft)
    return (
      <div className="empty-state">
        <Icon name="settings" size={28} />
        <p>No settings available.</p>
      </div>
    );

  async function save(patch: Partial<Settings>, msg = 'Saved.') {
    try {
      setSaving(true);
      setMessage(null);
      setDraft(await saveSettings(patch));
      setMessage(msg);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCalendarConnect() {
    try {
      setSaving(true);
      setMessage(null);
      const url = await connectCalendar();
      window.open(url, '_blank', 'noopener,noreferrer');
      setMessage('Google Calendar opened in a new tab.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to connect calendar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestCall() {
    if (!draft?.id) return;
    try {
      setSaving(true);
      setMessage(null);
      const r = await runOnboardingTestCall(draft.id);
      setMessage(`Sample job created. Job ID: ${r.jobId}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Test call failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8 rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Settings
            </h1>
            <p className="mt-2 max-w-2xl text-gray-400">
              Edit the details Voice needs to answer calls, handle urgent jobs, and book work correctly.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[340px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Saving
              </p>
              <strong className="mt-1 block text-white">
                {draft.persistence_mode === 'memory' ? 'Saved for now' : 'Saved permanently'}
              </strong>
              <p className="mt-1 text-sm text-gray-400">
                {draft.persistence_durable
                  ? 'Your changes will still be here later.'
                  : 'Your changes can reset until permanent storage is turned on.'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Booking calendar
              </p>
              <strong className="mt-1 block text-white">
                {draft.calendar_enabled ? 'Connected' : 'Not connected'}
              </strong>
              <p className="mt-1 text-sm text-gray-400">
                {draft.calendar_enabled
                  ? 'Booked jobs can sync automatically.'
                  : 'Connect Google Calendar when you want automatic booking.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {draft.persistence_mode === 'memory' ? (
        <div className="mb-8 rounded-3xl border border-amber-400/30 bg-amber-500/10 px-6 py-5 text-amber-100 shadow-[0_0_30px_rgba(245,158,11,0.08)]">
          <strong className="block mb-1 text-amber-300">Temporary storage only</strong>
          <p className="text-sm leading-relaxed text-amber-100/90">
            Your changes update the app right away, but they are only being saved temporarily until
            permanent storage is turned on.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr),360px]">
        <div className="grid min-w-0 gap-6">
          <article className="rounded-[28px] border border-white/10 bg-black/40 p-7 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-purple-500/20 bg-purple-500/10 text-purple-400">
                <Icon name="settings" size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">Your business</h2>
                <p className="mt-1 text-sm text-gray-400">
                  The basics Voice uses to answer calls and send urgent work to the right number.
                </p>
              </div>
            </div>

            {role === 'operator' ? (
              <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="block text-white">Call coverage</strong>
                  <p className="mt-1 text-sm text-gray-400">
                    {draft.enabled
                      ? 'Voice answers first and passes on urgent or booked work.'
                      : 'Calls go straight to your business phone.'}
                  </p>
                </div>
                <button
                  type="button"
                  className={draft.enabled ? '' : 'ghost'}
                  onClick={() =>
                    void save(
                      { enabled: !draft.enabled },
                      `Call answering ${draft.enabled ? 'turned off' : 'turned on'}.`,
                    )
                  }
                  disabled={saving}
                >
                  <Icon name={draft.enabled ? 'check' : 'alert'} size={15} />
                  {draft.enabled ? 'Answering on' : 'Answering off'}
                </button>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="block text-sm text-gray-400 mb-2">Business name</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-purple-500/50 focus:outline-none"
                  value={draft.business_name}
                  onChange={(e) => setDraft({ ...draft, business_name: e.target.value })}
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="block text-sm text-gray-400 mb-2">Business phone</span>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-purple-500/50 focus:outline-none"
                  value={draft.business_phone}
                  onChange={(e) => setDraft({ ...draft, business_phone: e.target.value })}
                  disabled={saving}
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="block text-sm text-gray-400 mb-2">Urgent calls go here</span>
              <input
                className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-purple-500/50 focus:outline-none"
                value={draft.escalation_phone}
                onChange={(e) => setDraft({ ...draft, escalation_phone: e.target.value })}
                disabled={saving}
              />
            </label>

            <p className="mt-4 text-sm text-gray-400">
              If answering is off, calls ring your business phone. Urgent calls go to the urgent
              number.
            </p>

            <button
              className="mt-6"
              onClick={() =>
                void save({
                  business_name: draft.business_name,
                  business_phone: draft.business_phone,
                  escalation_phone: draft.escalation_phone,
                })
              }
              disabled={saving}
            >
              <Icon name="check" size={16} />
              Save business info
            </button>
          </article>

          {role === 'operator' ? (
            <article className="rounded-[28px] border border-white/10 bg-black/40 p-7 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-start gap-4">
                <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                  <Icon name="zap" size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white">What callers should know</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Add the details customers ask about most so answers stay clear and consistent.
                  </p>
                </div>
              </div>

              <label className="mt-6 block">
                  <span className="block text-sm text-gray-400 mb-2">
                  Notes for answering calls
                </span>
                <textarea
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-4 text-white focus:border-emerald-500/50 focus:outline-none resize-y"
                  value={draft.business_context}
                  onChange={(e) => setDraft({ ...draft, business_context: e.target.value })}
                  rows={7}
                  placeholder="Example: We serve central Geneva only. Emergency surcharge after 20:00 is CHF 90. Weekend visits must be confirmed by phone."
                  disabled={saving}
                />
              </label>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Common questions</h3>
                    <p className="mt-1 text-sm text-gray-400">
                      Short answers to the questions you hear all the time.
                    </p>
                  </div>
                  <button type="button" onClick={addFaq} disabled={saving} className="ghost">
                    Add question
                  </button>
                </div>

                <div className="mt-4 grid gap-4">
                  {(draft.faqs ?? []).map((faq, index) => (
                    <div
                      key={`${index}-${faq.question}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeFaq(index)}
                          disabled={saving}
                          className="ghost"
                        >
                          Remove
                        </button>
                      </div>
                      <label className="block mb-3">
                        <span className="block text-sm text-gray-400 mb-2">Question</span>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none"
                          value={faq.question}
                          onChange={(e) => updateFaq(index, 'question', e.target.value)}
                          disabled={saving}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm text-gray-400 mb-2">Answer</span>
                        <textarea
                          className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none resize-y"
                          value={faq.answer}
                          onChange={(e) => updateFaq(index, 'answer', e.target.value)}
                          rows={3}
                          disabled={saving}
                        />
                      </label>
                    </div>
                  ))}
                  {(draft.faqs ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No saved questions yet. Add the answers you want callers to hear every time.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">What you offer</h3>
                    <p className="mt-1 text-sm text-gray-400">
                      Add your main jobs or services so calls are tagged correctly.
                    </p>
                  </div>
                  <button type="button" onClick={addService} disabled={saving} className="ghost">
                    Add service
                  </button>
                </div>

                <div className="mt-4 grid gap-4">
                  {(draft.services ?? []).map((service, index) => (
                    <div
                      key={`${index}-${service.name}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeService(index)}
                          disabled={saving}
                          className="ghost"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),160px,120px]">
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Service name</span>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none"
                            value={service.name}
                            onChange={(e) => updateService(index, 'name', e.target.value)}
                            disabled={saving}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Price</span>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none"
                            value={service.price || ''}
                            onChange={(e) => updateService(index, 'price', e.target.value)}
                            disabled={saving}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Minutes</span>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none"
                            type="number"
                            min={5}
                            step={5}
                            value={service.duration_minutes || 30}
                            onChange={(e) =>
                              updateService(index, 'duration_minutes', Number(e.target.value))
                            }
                            disabled={saving}
                          />
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className="block text-sm text-gray-400 mb-2">Description</span>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white focus:border-emerald-500/50 focus:outline-none"
                          value={service.description || ''}
                          onChange={(e) => updateService(index, 'description', e.target.value)}
                          disabled={saving}
                        />
                      </label>
                    </div>
                  ))}
                  {(draft.services ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No services yet. Add the main work you do so calls can be sorted correctly.
                    </p>
                  ) : null}
                </div>
              </div>

              <button
                className="mt-6"
                onClick={() =>
                    void save(
                      {
                        business_context: draft.business_context,
                        faqs: draft.faqs,
                        services: draft.services,
                      },
                      'Caller info saved.',
                    )
                  }
                  disabled={saving}
                >
                  <Icon name="check" size={16} />
                  Save caller info
                </button>
            </article>
          ) : null}
        </div>

        <aside className="grid gap-6">
          <ReadinessPanel settings={draft} compact />

          <article className="rounded-[28px] border border-white/10 bg-black/40 p-7 shadow-2xl backdrop-blur-2xl xl:sticky xl:top-24">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
                <Icon name="calendar" size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">Calendar and test call</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Connect your calendar and run one sample request to confirm the setup.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <strong className="block text-white">Google Calendar</strong>
              <p className="mt-1 text-sm text-gray-400">
                {draft.calendar_enabled ? 'Connected and ready to sync' : 'Not connected yet'}
              </p>
            </div>

            <div className="mt-6 grid gap-3">
              <button onClick={() => void handleCalendarConnect()} disabled={saving}>
                <Icon name="calendar" size={16} />
                {draft.calendar_enabled ? 'Reconnect calendar' : 'Connect calendar'}
              </button>
              <button className="ghost" onClick={() => void handleTestCall()} disabled={saving}>
                <Icon name="phone" size={16} />
                Make a sample call
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <strong className="block text-white">This page controls</strong>
              <ul className="mt-3 grid gap-2 text-sm text-gray-400">
                <li>Your business name and phone numbers</li>
                <li>Notes Voice should use on calls</li>
                <li>Common questions and services</li>
                <li>Calendar connection for bookings</li>
              </ul>
            </div>

            <p className="mt-6 text-sm text-gray-400">
              After you connect Google Calendar, booked jobs can be added there automatically when
              the call has enough information.
            </p>
          </article>
        </aside>
      </div>

      {message ? (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white px-6 py-3 font-medium text-black shadow-2xl">
          {message}
        </div>
      ) : null}
    </div>
  );
}
