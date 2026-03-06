import { useEffect, useState } from 'react';
import { connectCalendar, runOnboardingTestCall } from '../api.js';
import { Icon } from '../components/Icon.js';
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
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="page-head relative z-10 mb-8 p-6 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Settings
          </h1>
          <p className="text-gray-400 mt-2">
            One place to manage your business details, AI knowledge, and calendar setup.
          </p>
        </div>
      </div>

      {draft.persistence_mode === 'memory' ? (
        <div className="mb-8 rounded-3xl border border-amber-400/30 bg-amber-500/10 px-6 py-5 text-amber-100 shadow-[0_0_30px_rgba(245,158,11,0.08)]">
          <strong className="block mb-1 text-amber-300">Temporary storage only</strong>
          <p className="text-sm leading-relaxed text-amber-100/90">
            Settings are being saved in temporary memory right now. Changes will update the app
            immediately, but they are not being written to a real database until the backend is
            switched to database mode.
          </p>
        </div>
      ) : null}

      <div className="settings-layout grid gap-6">
        <article className="settings-card bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl transition hover:bg-black/50">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Icon name="settings" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Workspace basics</h2>
              <p className="text-sm text-gray-400">
                The core business and routing information your team relies on.
              </p>
            </div>
          </div>
          <div className="h-px w-full bg-white/10 mb-6" />
          {role === 'operator' ? (
            <div className="flex justify-between items-center mb-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
              <div>
                <strong className="block text-white mb-1">AI intake</strong>
                <p className="text-sm text-gray-400">
                  {draft.enabled
                    ? 'Calls are handled by the assistant first.'
                    : 'Calls go straight to your business phone.'}
                </p>
              </div>
              <button
                type="button"
                className={
                  draft.enabled
                    ? 'px-4 py-2 rounded-full border border-blue-500/50 bg-blue-500/20 text-blue-400'
                    : 'px-4 py-2 rounded-full border border-white/10 bg-white/5 text-gray-400'
                }
                onClick={() =>
                  void save(
                    { enabled: !draft.enabled },
                    `AI intake ${draft.enabled ? 'disabled' : 'enabled'}.`,
                  )
                }
                disabled={saving}
              >
                {draft.enabled ? 'Active' : 'Bypassed'}
              </button>
            </div>
          ) : null}
          <label className="block mb-4">
            <span className="block text-sm text-gray-400 mb-2">Business name</span>
            <input
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50"
              value={draft.business_name}
              onChange={(e) => setDraft({ ...draft, business_name: e.target.value })}
              disabled={saving}
            />
          </label>
          <label className="block mb-4">
            <span className="block text-sm text-gray-400 mb-2">Main phone</span>
            <input
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50"
              value={draft.business_phone}
              onChange={(e) => setDraft({ ...draft, business_phone: e.target.value })}
              disabled={saving}
            />
          </label>
          <label className="block mb-6">
            <span className="block text-sm text-gray-400 mb-2">Urgent handoff phone</span>
            <input
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50"
              value={draft.escalation_phone}
              onChange={(e) => setDraft({ ...draft, escalation_phone: e.target.value })}
              disabled={saving}
            />
          </label>
          <p className="text-sm text-gray-400 mb-4">
            If AI intake is disabled, inbound calls go to the main phone. Urgent calls are routed to
            the urgent handoff phone.
          </p>
          <button
            className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-2 transition"
            onClick={() =>
              void save({
                business_name: draft.business_name,
                business_phone: draft.business_phone,
                escalation_phone: draft.escalation_phone,
              })
            }
            disabled={saving}
          >
            <Icon name="check" size={16} /> Save Basics
          </button>
        </article>

        {role === 'operator' && (
          <article className="settings-card bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl transition hover:bg-black/50">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Icon name="book" size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Assistant knowledge</h2>
                <p className="text-sm text-gray-400">
                  This is the information the assistant should use when answering callers and
                  preparing jobs.
                </p>
              </div>
            </div>
            <div className="h-px w-full bg-white/10 mb-6" />
            <label className="block mb-6">
              <span className="block text-sm text-gray-400 mb-2">
                Business profile, policies, and AI memory
              </span>
              <textarea
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-emerald-500/50 resize-y"
                value={draft.business_context}
                onChange={(e) => setDraft({ ...draft, business_context: e.target.value })}
                rows={6}
                placeholder="Example: We only serve central Geneva. Emergency surcharge after 20:00 is CHF 90. Weekend visits must be confirmed by phone."
                disabled={saving}
              />
            </label>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">FAQs</h3>
                    <p className="text-sm text-gray-400">
                      Short, direct answers for common caller questions.
                    </p>
                  </div>
                  <button
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm"
                    type="button"
                    onClick={addFaq}
                    disabled={saving}
                  >
                    <Icon name="plus" size={14} /> Add FAQ
                  </button>
                </div>
                <div className="grid gap-4">
                  {(draft.faqs ?? []).map((faq, index) => (
                    <div
                      key={`${index}-${faq.question}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="flex justify-end mb-2">
                        <button
                          type="button"
                          onClick={() => removeFaq(index)}
                          disabled={saving}
                          className="text-gray-400 hover:text-white"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <label className="block mb-3">
                        <span className="block text-sm text-gray-400 mb-2">Question</span>
                        <input
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                          value={faq.question}
                          onChange={(e) => updateFaq(index, 'question', e.target.value)}
                          disabled={saving}
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm text-gray-400 mb-2">Answer</span>
                        <textarea
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 resize-y"
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
                      No FAQs yet. Add the answers you want the assistant to reuse.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Services</h3>
                    <p className="text-sm text-gray-400">
                      These services help the assistant identify what the caller needs.
                    </p>
                  </div>
                  <button
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm"
                    type="button"
                    onClick={addService}
                    disabled={saving}
                  >
                    <Icon name="plus" size={14} /> Add service
                  </button>
                </div>
                <div className="grid gap-4">
                  {(draft.services ?? []).map((service, index) => (
                    <div
                      key={`${index}-${service.name}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="flex justify-end mb-2">
                        <button
                          type="button"
                          onClick={() => removeService(index)}
                          disabled={saving}
                          className="text-gray-400 hover:text-white"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),140px,140px]">
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Service name</span>
                          <input
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                            value={service.name}
                            onChange={(e) => updateService(index, 'name', e.target.value)}
                            disabled={saving}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Price</span>
                          <input
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                            value={service.price || ''}
                            onChange={(e) => updateService(index, 'price', e.target.value)}
                            disabled={saving}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-sm text-gray-400 mb-2">Minutes</span>
                          <input
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
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
                      <label className="block mt-3">
                        <span className="block text-sm text-gray-400 mb-2">Description</span>
                        <input
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                          value={service.description || ''}
                          onChange={(e) => updateService(index, 'description', e.target.value)}
                          disabled={saving}
                        />
                      </label>
                    </div>
                  ))}
                  {(draft.services ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No services yet. Add your main service names so jobs can be tagged correctly.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <button
              className="mt-6 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-2 transition"
              onClick={() =>
                void save(
                  {
                    business_context: draft.business_context,
                    faqs: draft.faqs,
                    services: draft.services,
                  },
                  'Assistant knowledge saved.',
                )
              }
              disabled={saving}
            >
              <Icon name="check" size={16} /> Save Knowledge
            </button>
          </article>
        )}

        <article className="settings-card bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl transition hover:bg-black/50">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Icon name="calendar" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Calendar & Testing</h2>
              <p className="text-sm text-gray-400">
                Connect scheduling and validate the flow end-to-end.
              </p>
            </div>
          </div>
          <div className="h-px w-full bg-white/10 mb-6" />

          <div className="mb-6 p-4 rounded-xl border border-white/5 bg-white/5 flex items-center justify-between">
            <div>
              <strong className="text-white block mb-1">Google Calendar</strong>
              <p className="text-sm text-gray-400">
                {draft.calendar_enabled ? '✓ Connected and syncing' : '○ Not connected'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <button
              className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-2 transition shadow-[0_0_20px_rgba(37,99,235,0.3)]"
              onClick={() => void handleCalendarConnect()}
              disabled={saving}
            >
              <Icon name="calendar" size={16} />{' '}
              {draft.calendar_enabled ? 'Reconnect Calendar' : 'Connect Calendar'}
            </button>
            <button
              className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium flex items-center gap-2 transition"
              onClick={() => void handleTestCall()}
              disabled={saving}
            >
              <Icon name="phone" size={16} /> Create Sample Job (No Call)
            </button>
          </div>
          <p className="mt-6 text-sm text-gray-400">
            After connecting Google Calendar, confirmed jobs can be written to the connected
            calendar and auto-booked when the flow has enough information.
          </p>
        </article>
      </div>

      {/* Toast */}
      {message ? (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full bg-white text-black font-medium shadow-2xl z-50">
          {message}
        </div>
      ) : null}
    </div>
  );
}
