import type { PropsWithChildren } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { isLoggedIn } from './auth.js';
import { Layout } from './components/Layout.js';
import { CalendarPage } from './pages/CalendarPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { InsightsPage } from './pages/InsightsPage.js';
import { CallDetailsPage } from './pages/CallDetailsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LandingPage } from './pages/LandingPage.js';
import { needsOnboarding, TenantProvider, useTenant } from './tenant.js';

function RequireAuth({ children }: PropsWithChildren) {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RequireOnboardingComplete({ children }: PropsWithChildren) {
  const { settings, loading, error, onboardingComplete } = useTenant();

  if (loading) return <p>Loading workspace...</p>;
  if (error) return <p role="alert">{error}</p>;

  if (needsOnboarding(settings, onboardingComplete)) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function SkipOnboardingWhenDone({ children }: PropsWithChildren) {
  const { settings, loading, error, onboardingComplete } = useTenant();

  if (loading) return <p>Loading workspace...</p>;
  if (error) return <p role="alert">{error}</p>;

  if (!needsOnboarding(settings, onboardingComplete)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function ProtectedShell() {
  return (
    <RequireAuth>
      <TenantProvider>
        <Outlet />
      </TenantProvider>
    </RequireAuth>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route
          path="/onboarding"
          element={
            <SkipOnboardingWhenDone>
              <Layout>
                <OnboardingPage />
              </Layout>
            </SkipOnboardingWhenDone>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireOnboardingComplete>
              <Layout>
                <DashboardPage />
              </Layout>
            </RequireOnboardingComplete>
          }
        />
        <Route
          path="/calls/:id"
          element={
            <RequireOnboardingComplete>
              <Layout>
                <CallDetailsPage />
              </Layout>
            </RequireOnboardingComplete>
          }
        />
        <Route
          path="/calendar"
          element={
            <RequireOnboardingComplete>
              <Layout>
                <CalendarPage />
              </Layout>
            </RequireOnboardingComplete>
          }
        />
        <Route
          path="/insights"
          element={
            <RequireOnboardingComplete>
              <Layout>
                <InsightsPage />
              </Layout>
            </RequireOnboardingComplete>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireOnboardingComplete>
              <Layout>
                <SettingsPage />
              </Layout>
            </RequireOnboardingComplete>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
