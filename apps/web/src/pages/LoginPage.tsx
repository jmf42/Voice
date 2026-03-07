import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.js';
import {
  canUseDevFallback,
  completeMagicLinkIfPresent,
  isFirebaseConfigured,
  isLoggedIn,
  setToken,
  sendMagicLink,
} from '../auth.js';

const DEMO_OPERATOR_TOKEN = 'tenant:demo-tenant:role:operator:user:1';
const DEMO_CLIENT_TOKEN = 'tenant:demo-tenant:role:client_admin:user:1';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const firebaseReady = isFirebaseConfigured();
  const fallbackReady = canUseDevFallback();

  useEffect(() => {
    const run = async () => {
      if (isLoggedIn()) {
        navigate('/dashboard', { replace: true });
        return;
      }
      if (!firebaseReady) return;
      try {
        const completed = await completeMagicLinkIfPresent();
        if (completed) navigate('/dashboard', { replace: true });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to complete sign-in link.');
      }
    };
    void run();
  }, [firebaseReady, navigate]);

  async function handleSendMagicLink() {
    if (!email.trim()) {
      setMessage('Enter your work email to receive a sign-in link.');
      return;
    }

    try {
      setBusy(true);
      setMessage(null);
      await sendMagicLink(email.trim());
      setMessage('Check your inbox. Open the sign-in link on this device to continue.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Use demo access below if you need to continue now.`
          : 'Unable to send the sign-in link. Use demo access below if you need to continue now.',
      );
    } finally {
      setBusy(false);
    }
  }

  function handleDemoLogin(role: 'operator' | 'client_admin') {
    if (!fallbackReady) {
      setMessage('Demo access is not enabled in this environment.');
      return;
    }

    const token = role === 'operator' ? DEMO_OPERATOR_TOKEN : DEMO_CLIENT_TOKEN;
    setToken(token, role);
    navigate('/dashboard', { replace: true });
  }

  const supportCopy = firebaseReady
    ? 'Use your work email and we will send a sign-in link.'
    : 'Email sign-in is not ready in this environment yet.';

  return (
    <section className="min-h-[100dvh] bg-[radial-gradient(circle_at_15%_0%,rgba(0,243,255,0.08),transparent_34%),radial-gradient(circle_at_85%_0%,rgba(157,0,255,0.06),transparent_32%),linear-gradient(180deg,#040407_0%,#0b0d12_100%)] px-6 py-10 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div className="max-w-xl">
          <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
            <span className="h-2 w-2 rounded-full bg-[#00f3ff]" />
            Voice workspace access
          </div>

          <h1 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-[clamp(2.8rem,6vw,4.8rem)] font-bold leading-[0.95] tracking-[-0.05em] text-transparent">
            Sign in to Voice
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-[#d7deea]">{supportCopy}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Calls', detail: 'See new requests in one inbox.', icon: 'phone' },
              { label: 'Bookings', detail: 'Confirm jobs and update the schedule.', icon: 'calendar' },
              { label: 'Urgent', detail: 'Route important calls faster.', icon: 'shield' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-white/10 bg-black/40 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl"
              >
                <div className="mb-3 inline-flex rounded-2xl border border-[#00f3ff]/20 bg-[#00f3ff]/10 p-2 text-[#00f3ff]">
                  <Icon name={item.icon} size={16} />
                </div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#f0f4f8]">
                  {item.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#b8c4d3]">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-black/40 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.36)] backdrop-blur-2xl md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
                Access
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">
                Continue to your workspace
              </h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00f3ff]/25 bg-[#00f3ff]/10 text-[#00f3ff]">
              <Icon name="zap" size={20} />
            </div>
          </div>

          {firebaseReady ? (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[#e8edf3]">Work email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={busy}
                />
              </label>

              <button onClick={() => void handleSendMagicLink()} disabled={busy} className="w-full">
                <Icon name="zap" size={14} />
                Email me a sign-in link
              </button>

              {fallbackReady ? (
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm font-medium leading-6 text-[#c6d0dd]">
                    Need temporary access? Use one of the demo roles below.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => handleDemoLogin('operator')}
                      disabled={busy}
                      className="ghost"
                    >
                      <Icon name="zap" size={14} />
                      Business owner demo
                    </button>
                    <button
                      onClick={() => handleDemoLogin('client_admin')}
                      disabled={busy}
                      className="ghost"
                    >
                      <Icon name="briefcase" size={14} />
                      Manager demo
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 text-[#dfe8f2]">
                <p className="text-base font-medium">Email sign-in is not available here yet.</p>
                <p className="mt-2 text-sm leading-6 text-[#c6d0dd]">
                  Use demo access below for now, or finish Firebase setup to enable email sign-in.
                </p>
              </div>

              {fallbackReady ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button onClick={() => handleDemoLogin('operator')} disabled={busy}>
                    <Icon name="zap" size={14} />
                    Business owner demo
                  </button>
                  <button
                    onClick={() => handleDemoLogin('client_admin')}
                    disabled={busy}
                    className="ghost"
                  >
                    <Icon name="briefcase" size={14} />
                    Manager demo
                  </button>
                </div>
              ) : (
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-sm leading-6 text-[#c6d0dd]">
                    Demo access is disabled in this environment.
                  </p>
                </div>
              )}
            </div>
          )}

          {message ? (
            <p
              role="status"
              className="mt-5 rounded-[22px] border border-[#6ea8ff]/20 bg-[#6ea8ff]/10 px-4 py-3 text-sm leading-6 text-[#dfeaff]"
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
