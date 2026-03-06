import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signOut,
  signInWithEmailLink,
  type Auth,
} from 'firebase/auth';

const TOKEN_KEY = 'dispatchos_token';
const ROLE_KEY = 'dispatchos_role';
const EMAIL_KEY = 'dispatchos_magic_email';
const DEV_FALLBACK_DISABLED_KEY = 'dispatchos_disable_dev_fallback';
const DEV_FALLBACK_TOKEN =
  (import.meta.env.VITE_DEV_AUTH_TOKEN as string | undefined) ??
  (import.meta.env.DEV ? 'tenant:demo-tenant:role:operator:user:1' : undefined);
const FALLBACK_LOGIN_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ALLOW_FALLBACK_LOGIN === 'true';

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

function firebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  };
}

export function isFirebaseConfigured(): boolean {
  const config = firebaseConfig();
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function ensureFirebaseAuth(): Auth {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured in this environment.');
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig() as { apiKey: string; authDomain: string; projectId: string; appId: string });
  }

  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }

  return firebaseAuth;
}

export function getToken(): string {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const devFallbackDisabled = localStorage.getItem(DEV_FALLBACK_DISABLED_KEY) === 'true';
  if (FALLBACK_LOGIN_ENABLED && DEV_FALLBACK_TOKEN && !devFallbackDisabled) return DEV_FALLBACK_TOKEN;
  return '';
}

export function getRole(): 'operator' | 'client_admin' {
  const existing = localStorage.getItem(ROLE_KEY);
  if (existing === 'client_admin') return 'client_admin';
  return 'operator'; // Default fallback assumption for legacy tokens
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

export function setToken(token: string, role: 'operator' | 'client_admin' = 'operator'): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.removeItem(DEV_FALLBACK_DISABLED_KEY);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.setItem(DEV_FALLBACK_DISABLED_KEY, 'true');
  if (firebaseAuth) {
    void signOut(firebaseAuth).catch(() => undefined);
  }
}

export function canUseDevFallback(): boolean {
  return Boolean(FALLBACK_LOGIN_ENABLED && DEV_FALLBACK_TOKEN);
}

export function loginWithDevFallback(): boolean {
  if (!canUseDevFallback() || !DEV_FALLBACK_TOKEN) {
    return false;
  }
  localStorage.removeItem(DEV_FALLBACK_DISABLED_KEY);
  localStorage.setItem(TOKEN_KEY, DEV_FALLBACK_TOKEN);
  // Optional: Extract role if embedded in DEV_FALLBACK_TOKEN
  const roleMatch = DEV_FALLBACK_TOKEN.match(/role:(operator|client_admin)/);
  if (roleMatch?.[1]) localStorage.setItem(ROLE_KEY, roleMatch[1]);
  else localStorage.setItem(ROLE_KEY, 'operator');
  return true;
}

export async function sendMagicLink(email: string): Promise<void> {
  const auth = ensureFirebaseAuth();
  const actionCodeSettings = {
    url: window.location.origin + '/login',
    handleCodeInApp: true,
  };

  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  localStorage.setItem(EMAIL_KEY, email);
}

export async function completeMagicLinkIfPresent(): Promise<boolean> {
  if (!isFirebaseConfigured()) return false;

  const auth = ensureFirebaseAuth();
  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) return false;

  const email = localStorage.getItem(EMAIL_KEY);
  if (!email) {
    throw new Error('Missing saved email for magic-link completion. Please request a new link.');
  }

  const credential = await signInWithEmailLink(auth, email, href);
  const idToken = await credential.user.getIdToken();
  setToken(idToken);

  window.history.replaceState({}, document.title, '/dashboard');
  return true;
}
