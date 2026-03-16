import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadReadinessStatus } from '../api.js';
import { Icon } from './Icon.js';
import type { ClientProfile, ReadinessStatus } from '../types.js';

interface ReadinessPanelProps {
  settings: ClientProfile | null | undefined;
  compact?: boolean;
}

interface ChecklistItem {
  label: string;
  detail: string;
  tone: 'ok' | 'warning' | 'critical';
}

function buildAuthChecklistItem(readiness: ReadinessStatus | null): ChecklistItem {
  if (readiness?.auth?.devBearerEnabled === false) {
    return {
      label: 'Production access is locked down',
      detail: 'Only the intended sign-in path is active.',
      tone: 'ok',
    };
  }

  if (readiness?.auth?.devBearerEnabled === true) {
    return {
      label: 'Production access still needs hardening',
      detail: 'A development login path is still enabled in production.',
      tone: 'warning',
    };
  }

  return {
    label: 'Production access needs verification',
    detail: 'The live readiness check did not return enough auth detail to confirm sign-in is locked down.',
    tone: 'warning',
  };
}

function buildPersistenceChecklistItem(readiness: ReadinessStatus | null): ChecklistItem {
  if (readiness?.persistence?.durable === true) {
    return {
      label: 'Database saving is permanent',
      detail: 'Calls and settings are being saved durably.',
      tone: 'ok',
    };
  }

  if (readiness?.persistence?.durable === false) {
    return {
      label: 'Saving is still temporary',
      detail: 'Data can be lost until permanent database storage is active.',
      tone: 'critical',
    };
  }

  return {
    label: 'Saving status needs verification',
    detail: 'The live readiness check did not confirm whether calls and settings are stored durably.',
    tone: 'warning',
  };
}

function buildCalendarChecklistItem(
  settings: ClientProfile | null | undefined,
  readiness: ReadinessStatus | null,
): ChecklistItem {
  const calendarConnected = Boolean(settings?.calendar_enabled);

  if (!calendarConnected) {
    return {
      label: 'Calendar booking still needs setup',
      detail: 'Connect Google Calendar if you want booked jobs to sync automatically.',
      tone: 'warning',
    };
  }

  if (readiness?.providers?.calendar === true) {
    return {
      label: 'Calendar booking is available',
      detail: 'Confirmed work can be synced automatically.',
      tone: 'ok',
    };
  }

  if (readiness?.providers?.calendar === false) {
    return {
      label: 'Calendar looks connected, but live sync is incomplete',
      detail: 'The app says connected, but the server is missing live calendar setup.',
      tone: 'critical',
    };
  }

  return {
    label: 'Calendar sync needs verification',
    detail: 'The live readiness check did not confirm whether calendar sync is active.',
    tone: 'warning',
  };
}

function hasSavedBusinessAnswers(settings: ClientProfile | null | undefined): boolean {
  if (!settings) return false;
  return Boolean(
    settings.business_context.trim() ||
      settings.faqs?.some((faq) => faq.question.trim() && faq.answer.trim()) ||
      settings.services?.some((service) => service.name.trim()),
  );
}

function buildChecklist(
  settings: ClientProfile | null | undefined,
  readiness: ReadinessStatus | null,
): ChecklistItem[] {
  const businessAnswersSaved = hasSavedBusinessAnswers(settings);

  return [
    settings?.enabled
      ? {
          label: 'Calls are being answered',
          detail: 'The AI answers first before handing off urgent work.',
          tone: 'ok',
        }
      : {
          label: 'Calls are not being answered yet',
          detail: 'Turn on call answering when you are ready to go live.',
          tone: 'critical',
        },
    businessAnswersSaved
      ? {
          label: 'Business details are saved',
          detail: 'The assistant has notes, FAQs, or services to answer with.',
          tone: 'ok',
        }
      : {
          label: 'Business answers still need setup',
          detail: 'Add services, FAQs, or notes so callers get clear answers.',
          tone: 'warning',
        },
    buildPersistenceChecklistItem(readiness),
    buildCalendarChecklistItem(settings, readiness),
    buildAuthChecklistItem(readiness),
  ];
}

export function ReadinessPanel({ settings, compact = false }: ReadinessPanelProps) {
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const next = await loadReadinessStatus();
        if (active) {
          setReadiness(next);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load readiness status.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const checklist = useMemo(() => buildChecklist(settings, readiness), [readiness, settings]);
  const criticalCount = checklist.filter((item) => item.tone === 'critical').length;
  const warningCount = checklist.filter((item) => item.tone === 'warning').length;
  const isReady = criticalCount === 0 && warningCount === 0;

  return (
    <article className={`readiness-card${compact ? ' compact' : ''}`}>
      <div className="readiness-head">
        <div>
          <h2>{isReady ? 'Ready to run today' : 'Finish these before going live'}</h2>
          <p>
            {loading
              ? 'Checking your live setup...'
              : 'This is the quickest way to see whether the app is truly ready for customer calls.'}
          </p>
        </div>
        <span className={`readiness-badge ${isReady ? 'ok' : 'warning'}`}>
          {isReady ? 'Ready' : `${criticalCount + warningCount} to check`}
        </span>
      </div>

      {error ? <p className="readiness-inline-note">{error}</p> : null}

      <div className="readiness-list">
        {checklist.map((item) => (
          <div key={item.label} className={`readiness-item ${item.tone}`}>
            <div className="readiness-icon">
              <Icon
                name={item.tone === 'ok' ? 'check' : item.tone === 'warning' ? 'alert' : 'shield'}
                size={14}
              />
            </div>
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="readiness-links">
        <Link to="/settings">Open setup</Link>
        <Link to="/calendar">Check bookings</Link>
      </div>

      {readiness?.readiness?.issues?.length ? (
        <div className="readiness-issues">
          <strong>Live server notes</strong>
          <ul>
            {readiness.readiness.issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
