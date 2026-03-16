import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { loadClientProfile as loadSettings, updateClientProfile as updateSettings } from './api.js';
import { getRole } from './auth.js';
import type { ClientProfile as Settings, UserRole } from './types.js';

const LEGACY_ONBOARDING_DONE_KEY = 'dispatchos_onboarding_done';
const ONBOARDING_DONE_PREFIX = 'dispatchos_onboarding_done';

interface TenantContextValue {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  onboardingComplete: boolean;
  role: UserRole;
  refreshSettings: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>;
  markOnboardingComplete: () => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

function scopedOnboardingDoneKey(tenantId: string): string {
  return `${ONBOARDING_DONE_PREFIX}:${tenantId}`;
}

function readOnboardingState(tenantId: string): boolean {
  const scoped = localStorage.getItem(scopedOnboardingDoneKey(tenantId));
  if (scoped !== null) {
    return scoped === 'true';
  }
  return localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === 'true';
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function needsOnboarding(settings: Settings | null, onboardingComplete: boolean): boolean {
  if (!settings) return true;
  const requiredDataMissing =
    isBlank(settings.business_name) || isBlank(settings.business_phone) || isBlank(settings.escalation_phone);
  return requiredDataMissing || !onboardingComplete;
}

export function TenantProvider({ children }: PropsWithChildren) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const role = useMemo(() => getRole(), []);

  const refreshSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const next = await loadSettings();
      setSettings(next);
      const tenantId = next.id;
      if (tenantId) {
        const complete = readOnboardingState(tenantId);
        if (complete) {
          localStorage.setItem(scopedOnboardingDoneKey(tenantId), 'true');
          localStorage.removeItem(LEGACY_ONBOARDING_DONE_KEY);
        }
        setOnboardingComplete(complete);
      } else {
        setOnboardingComplete(localStorage.getItem(LEGACY_ONBOARDING_DONE_KEY) === 'true');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your business settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const saved = await updateSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  const markOnboardingComplete = useCallback(() => {
    const tenantId = settings?.id;
    if (tenantId) {
      localStorage.setItem(scopedOnboardingDoneKey(tenantId), 'true');
      localStorage.removeItem(LEGACY_ONBOARDING_DONE_KEY);
    } else {
      localStorage.setItem(LEGACY_ONBOARDING_DONE_KEY, 'true');
    }
    setOnboardingComplete(true);
  }, [settings?.id]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const value = useMemo<TenantContextValue>(
    () => ({
      settings,
      loading,
      error,
      onboardingComplete,
      role,
      refreshSettings,
      saveSettings,
      markOnboardingComplete,
    }),
    [error, loading, onboardingComplete, role, refreshSettings, saveSettings, settings, markOnboardingComplete],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used inside TenantProvider.');
  }
  return context;
}
