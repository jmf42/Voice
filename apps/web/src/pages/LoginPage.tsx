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

  useEffect(() => {
    const run = async () => {
      if (isLoggedIn()) {
        navigate('/dashboard', { replace: true });
        return;
      }
      if (!isFirebaseConfigured()) return;
      try {
        const completed = await completeMagicLinkIfPresent();
        if (completed) navigate('/dashboard', { replace: true });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to complete sign-in link.');
      }
    };
    void run();
  }, [navigate]);

  async function handleSendMagicLink() {
    if (!email.trim()) {
      setMessage('Enter your work email to receive a sign-in link.');
      return;
    }
    try {
      setBusy(true);
      setMessage(null);
      await sendMagicLink(email.trim());
      setMessage('Sign-in link sent. Check your inbox and open the link on this device.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} If email sign-in is not ready yet, use the demo access buttons below.`
          : 'Unable to send sign-in link. Use the demo access buttons below.',
      );
    } finally {
      setBusy(false);
    }
  }

  function handleDemoLogin(role: 'operator' | 'client_admin') {
    if (!canUseDevFallback()) {
      setMessage('Fallback login is not enabled in this environment.');
      return;
    }
    const token = role === 'operator' ? DEMO_OPERATOR_TOKEN : DEMO_CLIENT_TOKEN;
    setToken(token, role);
    navigate('/dashboard', { replace: true });
  }

  return (
    <section className="login-page">
      <header className="login-hero">
        <div className="login-brand-icon">
          <Icon name="zap" size={32} />
        </div>
        <h1>Welcome back</h1>
        <p className="subtitle">
          Manage customer calls, appointments, and business settings in one place.
        </p>
      </header>

      <div className="login-grid">
        {isFirebaseConfigured() ? (
          <article className="settings-card login-card">
            <h2>
              <Icon name="zap" size={16} /> Sign in
            </h2>
            <p className="helper">Use your work email. We will send a secure sign-in link.</p>
            <label>
              <span>Work email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={busy}
              />
            </label>
            <button onClick={() => void handleSendMagicLink()} disabled={busy}>
              <Icon name="zap" size={14} />
              Send login link
            </button>
            {canUseDevFallback() ? (
              <>
                <div className="card-divider" />
                <p className="helper">
                  If email sign-in is not working yet, use temporary demo access.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleDemoLogin('operator')}
                    disabled={busy}
                    className="ghost"
                  >
                    <Icon name="zap" size={14} />
                    Continue as business owner
                  </button>
                  <button
                    onClick={() => handleDemoLogin('client_admin')}
                    disabled={busy}
                    className="ghost"
                  >
                    <Icon name="briefcase" size={14} />
                    Continue as manager
                  </button>
                </div>
              </>
            ) : null}
          </article>
        ) : (
          <article className="settings-card login-card">
            <h2>
              <Icon name="settings" size={16} /> Sign-in setup
            </h2>
            <p className="helper">
              Secure email sign-in is not fully configured yet in this environment.
            </p>
            {canUseDevFallback() ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button onClick={() => handleDemoLogin('operator')} disabled={busy}>
                  <Icon name="zap" size={14} />
                  Continue as business owner
                </button>
                <button
                  onClick={() => handleDemoLogin('client_admin')}
                  disabled={busy}
                  className="ghost"
                >
                  <Icon name="briefcase" size={14} />
                  Continue as manager
                </button>
              </div>
            ) : (
              <div className="empty-state-inline">
                <Icon name="alert" size={18} />
                <p>Finish Firebase setup to enable secure sign-in.</p>
              </div>
            )}
          </article>
        )}

        <article className="settings-card">
          <h2>
            <Icon name="briefcase" size={16} /> What you can do here
          </h2>
          <ul className="plain-list">
            <li>
              <Icon name="check" size={13} /> Set up your business details, services, FAQs, and
              calendar.
            </li>
            <li>
              <Icon name="check" size={13} /> See new customer requests and urgent cases in one
              simple inbox.
            </li>
            <li>
              <Icon name="check" size={13} /> Confirm appointments and keep your schedule up to
              date.
            </li>
          </ul>
        </article>

        <article className="settings-card">
          <h2>
            <Icon name="shield" size={16} /> Access
          </h2>
          <ul className="plain-list">
            <li>
              <Icon name="shield" size={13} /> Each business keeps its own data and settings.
            </li>
            <li>
              <Icon name="zap" size={13} /> Team members sign in with approved company emails.
            </li>
            <li>
              <Icon name="check" size={13} /> Business owner and manager roles stay separated.
            </li>
          </ul>
        </article>
      </div>

      {message ? (
        <p role="status" className="action-toast login-toast">
          {message}
        </p>
      ) : null}
    </section>
  );
}
