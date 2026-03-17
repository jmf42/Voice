import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractWebsiteData, runOnboardingTestCall } from '../api.js';
import { Icon } from '../components/Icon.js';
import { useTenant } from '../tenant.js';
import type { ClientProfile as Settings } from '../types.js';

const STEPS = [
  {
    title: 'Business basics',
    detail: 'Add the business name, main phone, and optional website.',
    icon: 'briefcase',
  },
  {
    title: 'Urgent handoff',
    detail: 'Choose the real number that should receive urgent calls.',
    icon: 'shield',
  },
  {
    title: 'Caller guidance',
    detail: 'Add business notes, then run a safe test request.',
    icon: 'zap',
  },
] as const;

const STEP_OUTCOMES = [
  'Callers hear the right business name and contact number.',
  'Urgent calls have a real person to hand off to.',
  'The assistant has enough context to answer and create useful requests.',
] as const;

const CONTEXT_STARTER = `Business overview
- We are [Business Name], located in [City].
- We provide [services].
- We serve [areas].

Hours
- [days and hours]

Urgency policy
- Life safety risks: advise emergency services immediately.
- Urgent non-life-safety: callback within [X] minutes.

Pricing notes
- Starting price: [amount].
- Emergency surcharge: [amount/rules].

Answering rules
- Keep responses short and natural for phone calls.
- If unknown, say the team will confirm by phone.`;

function sanitizePhone(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function resolveTenantWebhookId(draftId?: string, settingsId?: string): string {
  return draftId || settingsId || 'demo-tenant';
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { settings, saveSettings, markOnboardingComplete } = useTenant();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testCallJobId, setTestCallJobId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [importUrl, setImportUrl] = useState('');
  const apiBase = (
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000'
  ).replace(/\/$/, '');
  const tenantWebhookId = resolveTenantWebhookId(draft?.id, settings?.id);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!settings || !draft) return <p>Loading business setup…</p>;

  const progressPercent = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);
  const currentStep = STEPS[step] ?? STEPS[0];
  const showImportedDetails =
    Boolean(draft.website_url?.trim()) ||
    (draft.services?.length ?? 0) > 0 ||
    (draft.faqs?.length ?? 0) > 0;
  const canContinue = useMemo(() => {
    if (!draft) return false;
    if (step === 0) return !isBlank(draft.business_name) && !isBlank(draft.business_phone);
    if (step === 1) return !isBlank(draft.escalation_phone);
    return true;
  }, [draft, step]);

  async function handleExtract() {
    if (!importUrl || !draft) return;
    try {
      setBusy(true);
      setMessage(null);
      const normalizedUrl = normalizeWebsiteUrl(importUrl);
      const extracted = await extractWebsiteData(normalizedUrl);
      setImportUrl(normalizedUrl);
      setDraft({ ...draft, ...extracted, website_url: normalizedUrl } as Settings);
      setMessage('Website details imported. Review them, then continue.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Website import failed.');
    } finally {
      setBusy(false);
    }
  }

  function applyStarterContext() {
    if (!draft) return;
    if (draft.business_context.trim().length > 0) {
      setMessage('Business notes already have content. Edit them directly below.');
      return;
    }
    setDraft({ ...draft, business_context: CONTEXT_STARTER });
    setMessage('Starter notes inserted. Replace the placeholders with your real details.');
  }

  async function saveCurrentStep(): Promise<void> {
    if (!draft) return;
    if (step === 0) {
      if (isBlank(draft.business_name) || isBlank(draft.business_phone)) {
        throw new Error('Add business name and main phone to continue.');
      }
      await saveSettings({
        business_name: draft.business_name.trim(),
        business_phone: sanitizePhone(draft.business_phone),
        website_url: draft.website_url,
        faqs: draft.faqs,
        services: draft.services,
      });
      return;
    }
    if (step === 1) {
      if (isBlank(draft.escalation_phone)) {
        throw new Error('Add the urgent handoff phone to continue.');
      }
      await saveSettings({ escalation_phone: sanitizePhone(draft.escalation_phone) });
      return;
    }
    if (step === 2) {
      await saveSettings({ business_context: draft.business_context });
    }
  }

  async function handleNext() {
    if (!canContinue) {
      setMessage(
        step === 0 ? 'Please add business name and main phone.' : 'Please add the urgent handoff phone.',
      );
      return;
    }
    try {
      setBusy(true);
      setMessage(null);
      await saveCurrentStep();
      if (step === STEPS.length - 1) return;
      setStep((c) => c + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save this step.');
    } finally {
      setBusy(false);
    }
  }

  async function runTestCall() {
    if (!draft?.id) return;
    try {
      setBusy(true);
      setMessage(null);
      const result = await runOnboardingTestCall(draft.id);
      setTestCallJobId(result.jobId || null);
      setMessage('Sample job created successfully. This test does not place a real phone call.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sample test failed.');
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    try {
      setBusy(true);
      setMessage(null);
      await saveCurrentStep();
      markOnboardingComplete();
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to finish setup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="onboarding">
      <div className="dashboard-head">
        <div className="page-head">
          <div>
            <h1>Set up your business</h1>
            <p className="subtitle">
              3 simple steps to set up call handling for your business.
            </p>
          </div>
          <p className="onboarding-progress-label">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
      </div>

      <div className="onboarding-progress-track" aria-hidden>
        <div className="onboarding-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="mobile-stepper">
        {STEPS.map((entry, index) => (
          <button
            key={entry.title}
            type="button"
            className={`stepper-dot ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}
            onClick={() => setStep(index)}
            disabled={busy || index > step}
          >
            {index < step ? <Icon name="check" size={12} /> : <span>{index + 1}</span>}
          </button>
        ))}
      </div>

      <div className="onboarding-frame">
        <aside className="settings-card onboarding-index">
          {STEPS.map((entry, index) => (
            <button
              key={entry.title}
              type="button"
              className={`step-index ${index === step ? 'active' : ''} ${index < step ? 'completed' : ''}`}
              onClick={() => setStep(index)}
              disabled={busy || index > step}
            >
              <span className="step-index-number">
                {index < step ? <Icon name="check" size={12} /> : `Step ${index + 1}`}
              </span>
              <strong>
                <Icon name={entry.icon} size={14} /> {entry.title}
              </strong>
              <small>{entry.detail}</small>
            </button>
          ))}

          <div className="onboarding-sidebar-note">
            <strong>By the end of setup</strong>
            <p className="helper">You should be able to place a test call and see a clear request in the inbox.</p>
          </div>
        </aside>

        <article className="settings-card onboarding-step">
          <div className="onboarding-step-header">
            <Icon name={currentStep.icon} size={22} className="onboarding-step-icon" />
            <div>
              <h2>{currentStep.title}</h2>
              <p className="subtitle">{currentStep.detail}</p>
            </div>
          </div>

          <div className="card-divider" />

          <div className="onboarding-callout">
            <strong>What this step does</strong>
            <p>{STEP_OUTCOMES[step]}</p>
          </div>

          {step === 0 ? (
            <>
              <div className="onboarding-checklist">
                <strong>Have this ready</strong>
                <p className="helper">
                  Business name, main phone, and optionally the business website.
                </p>
              </div>

              <div className="inline-toggle">
                <div>
                  <strong>Optional: import from website</strong>
                  <p className="helper">
                    Paste your website to prefill services and FAQs. You can still edit everything
                    manually.
                  </p>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', minWidth: '280px' }}>
                  <input
                    type="url"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://www.yourbusiness.com"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => void handleExtract()}
                    disabled={busy || !importUrl}
                  >
                    <Icon name="search" size={14} />
                    Import Website Details
                  </button>
                </div>
              </div>

              <label>
                <span>Business name</span>
                <input
                  value={draft.business_name}
                  onChange={(e) => setDraft({ ...draft, business_name: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label>
                <span>Main business phone</span>
                <input
                  value={draft.business_phone}
                  onChange={(e) => setDraft({ ...draft, business_phone: e.target.value })}
                  placeholder="+41 22 555 09 99"
                  disabled={busy}
                />
              </label>

              {showImportedDetails ? (
                <p className="helper">
                  <Icon name="check" size={13} /> Imported details:{' '}
                  <strong>{draft.services?.length ?? 0}</strong> services,{' '}
                  <strong>{draft.faqs?.length ?? 0}</strong> FAQs.
                </p>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="onboarding-checklist">
                <strong>Choose a real handoff number</strong>
                <p className="helper">
                  This should be the phone for the person on call, front desk, or manager who must
                  receive urgent requests.
                </p>
              </div>

              <label>
                <span>Urgent handoff phone</span>
                <input
                  value={draft.escalation_phone}
                  onChange={(e) => setDraft({ ...draft, escalation_phone: e.target.value })}
                  placeholder="+41 22 555 01 23"
                  disabled={busy}
                />
              </label>

              <div className="inline-toggle">
                <div>
                  <strong>If someone else manages your phone routing</strong>
                  <p className="helper">
                    Send them the technical details below. Most operators should only need to set
                    the urgent handoff number in this step.
                  </p>
                  <p className="helper">Twilio webhook details:</p>
                  <p className="helper">
                    Inbound: <code>{apiBase}/v1/telephony/inbound/{tenantWebhookId}</code>
                  </p>
                  <p className="helper">
                    Status: <code>{apiBase}/v1/telephony/status</code>
                  </p>
                </div>
              </div>

              <p className="helper">
                <Icon name="alert" size={13} /> Do not use the Twilio number as the handoff phone.
                Use a real human/on-call number.
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="onboarding-checklist">
                <strong>What to include here</strong>
                <p className="helper">
                  Add hours, service areas, common requests, pricing notes, and anything a staff
                  member would need to answer naturally on the phone.
                </p>
              </div>

              <div className="settings-button-group">
                <button
                  type="button"
                  className="ghost"
                  onClick={applyStarterContext}
                  disabled={busy}
                >
                  <Icon name="briefcase" size={14} />
                  Insert starter template
                </button>
              </div>
              <label>
                <span>Business notes for call handling</span>
                <textarea
                  value={draft.business_context}
                  onChange={(e) => setDraft({ ...draft, business_context: e.target.value })}
                  rows={10}
                  placeholder="Add policies, services, hours, pricing, and answer rules."
                  disabled={busy}
                />
              </label>

              <div className="settings-button-group">
                <button type="button" onClick={() => void runTestCall()} disabled={busy}>
                  <Icon name="phone" size={14} />
                  Create test request (no phone call)
                </button>
              </div>
              {testCallJobId ? (
                <p className="helper">
                  <Icon name="check" size={13} /> Test request created: <code>{testCallJobId}</code>
                </p>
              ) : (
                <p className="helper">
                  This simulation checks dashboard flow and request creation only.
                </p>
              )}

              <div className="inline-toggle">
                <div>
                  <strong>Real call test checklist</strong>
                  <p className="helper">1. Save this step</p>
                  <p className="helper">2. Call your business routing number</p>
                  <p className="helper">3. Ask about hours, a service, or pricing</p>
                  <p className="helper">
                    4. Confirm the request appears in the inbox with a useful summary
                  </p>
                </div>
              </div>
            </>
          ) : null}

          <div className="onboarding-actions">
            <button
              onClick={() => setStep((c) => Math.max(0, c - 1))}
              disabled={busy || step === 0}
              className="ghost"
            >
              <Icon name="arrow-left" size={14} />
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => void handleNext()} disabled={busy || !canContinue}>
                Save and continue
                <Icon name="chevron" size={14} />
              </button>
            ) : (
              <button onClick={() => void finishSetup()} disabled={busy}>
                <Icon name="check" size={14} />
                Finish setup
              </button>
            )}
          </div>
        </article>
      </div>

      {message ? (
        <p role="status" className="action-toast">
          {message}
        </p>
      ) : null}
    </section>
  );
}
