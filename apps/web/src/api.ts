import { getToken, logout } from './auth.js';
import type {
  Appointment,
  CallSummary,
  CallTimelineItem,
  ClientProfile,
  Metrics,
  ReadinessStatus,
} from './types.js';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';

interface JobApi {
  id: string;
  tenantId: string;
  callId: string;
  status: 'urgent' | 'new' | 'confirmed' | 'closed';
  booking_status?: 'booked' | 'manual_required' | 'not_requested';
  confirmed_slot_start?: string;
  confirmed_slot_end?: string;
  external_event_id?: string;
  caller_phone: string;
  address_raw: string;
  address_confirmed: boolean;
  urgency: 'urgent' | 'normal';
  preferred_time_window: 'morning' | 'afternoon' | 'evening' | 'specific';
  job_summary: string;
  service_hint?: string;
  risk_flags?: string[];
  language_detected?: 'fr' | 'en';
  transcript?: string;
  createdAt: string;
  updatedAt: string;
}

interface SettingsResponse {
  settings: ClientProfile;
  persistence?: {
    mode: 'memory' | 'database';
    durable: boolean;
  };
}

function inferDurationSeconds(transcript?: string): number {
  if (!transcript) return 0;
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(12, Math.round(words * 0.42));
}

function mapJobToCall(job: JobApi): CallSummary {
  const callIntent: CallSummary['call_intent'] =
    job.urgency === 'urgent' ? 'urgent_escalation' : job.service_hint ? 'booking' : 'unknown';
  const languageDetected: CallSummary['language_detected'] = job.language_detected === 'fr' ? 'fr' : 'en';
  const missedBooking = job.booking_status === 'manual_required';

  return {
    id: job.id,
    clientId: job.tenantId,
    caller_phone: job.caller_phone,
    call_intent: callIntent,
    language_detected: languageDetected,
    duration_seconds: inferDurationSeconds(job.transcript),
    transcript: job.transcript ?? '',
    summary: job.job_summary,
    hallucination_flag: false,
    missed_booking_opportunity: missedBooking,
    escalation_successful: job.urgency === 'urgent' ? job.status === 'confirmed' : undefined,
    createdAt: job.createdAt,
  };
}

function mapJobToAppointment(job: JobApi): Appointment {
  const status: Appointment['status'] =
    job.booking_status === 'manual_required'
      ? 'needs_manual_booking'
      : job.booking_status === 'booked' || job.status === 'confirmed'
        ? 'confirmed'
        : job.status === 'closed'
          ? 'cancelled'
          : 'requested';

  return {
    id: job.id,
    clientId: job.tenantId,
    callId: job.callId,
    caller_name: undefined,
    caller_phone: job.caller_phone,
    status,
    service_requested: job.service_hint ?? job.job_summary,
    preferred_time_window: job.preferred_time_window,
    confirmed_slot_start: job.confirmed_slot_start,
    confirmed_slot_end: job.confirmed_slot_end,
    external_event_id: job.external_event_id,
    notes: job.address_raw,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error('Authentication required. Sign in first.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      `Cannot reach DispatchOS API at ${API_BASE}. Make sure the backend server is running and VITE_API_BASE_URL is set correctly.`,
    );
  }

  if (response.status === 401) {
    logout();
    throw new Error('Your session expired. Please sign in again.');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listCalls(clientId?: string): Promise<CallSummary[]> {
  void clientId;
  const data = await request<{ items: JobApi[] }>('/v1/jobs');
  return data.items.map(mapJobToCall);
}

export function subscribeCalls(
  clientId: string | undefined,
  onItems: (items: CallSummary[]) => void,
  onError?: (error: Error) => void,
): () => void {
  void clientId;
  const token = getToken();
  const controller = new AbortController();

  if (!token) {
    onError?.(new Error('Authentication required. Sign in first.'));
    return () => controller.abort();
  }

  void (async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/jobs/stream`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        logout();
        throw new Error('Your session expired. Please sign in again.');
      }
      if (!response.ok) {
        throw new Error(`Calls stream request failed (${response.status}).`);
      }
      if (!response.body) {
        throw new Error('Calls stream is not available in this browser.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const block = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          const dataLines = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          if (dataLines.length > 0) {
            try {
              const payload = JSON.parse(dataLines.join('\n')) as { items?: JobApi[] };
              if (Array.isArray(payload.items)) {
                onItems(payload.items.map(mapJobToCall));
              }
            } catch {
              // Ignore malformed chunks and continue processing stream.
            }
          }
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      onError?.(error instanceof Error ? error : new Error('Calls stream disconnected.'));
    }
  })();

  return () => controller.abort();
}

export async function getCall(callId: string): Promise<{ call: CallSummary; timeline: CallTimelineItem[] }> {
  const data = await request<{ job: JobApi; timeline?: CallTimelineItem[] }>(`/v1/jobs/${callId}`);
  return {
    call: mapJobToCall(data.job),
    timeline: data.timeline ?? [],
  };
}

export async function listAppointments(clientId?: string): Promise<Appointment[]> {
  void clientId;
  const data = await request<{ items: JobApi[] }>('/v1/jobs');
  return data.items.map(mapJobToAppointment);
}

export async function confirmAppointment(appointmentId: string, slotStart: string): Promise<Appointment> {
  const data = await request<{ job: JobApi }>(`/v1/jobs/${appointmentId}/confirm-time`, {
    method: 'POST',
    body: JSON.stringify({ slotStart }),
  });
  return mapJobToAppointment(data.job);
}

export async function cancelAppointment(appointmentId: string): Promise<Appointment> {
  const data = await request<{ job: JobApi }>(`/v1/jobs/${appointmentId}/close`, { method: 'POST' });
  return mapJobToAppointment(data.job);
}

export async function loadClientProfile(clientId?: string): Promise<ClientProfile> {
  const path = clientId ? `/v1/settings?clientId=${clientId}` : '/v1/settings';
  const data = await request<SettingsResponse>(path);
  return {
    ...data.settings,
    persistence_mode: data.persistence?.mode,
    persistence_durable: data.persistence?.durable,
  };
}

export async function updateClientProfile(input: Partial<ClientProfile>, clientId?: string): Promise<ClientProfile> {
  const path = clientId ? `/v1/settings?clientId=${clientId}` : '/v1/settings';
  const data = await request<SettingsResponse>(path, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return {
    ...data.settings,
    persistence_mode: data.persistence?.mode,
    persistence_durable: data.persistence?.durable,
  };
}

export async function connectCalendar(clientId?: string): Promise<string> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  const data = await request<{ authUrl: string }>(`/v1/calendar/google/start${query}`);
  return data.authUrl;
}

export async function runOnboardingTestCall(clientId?: string): Promise<{ ok: boolean; jobId: string }> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  const data = await request<{ ok: boolean; jobId?: string; callId?: string }>(`/v1/onboarding/test-call${query}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return {
    ok: Boolean(data.ok),
    jobId: data.jobId ?? data.callId ?? '',
  };
}

export async function loadMetrics(clientId?: string): Promise<Metrics> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return request(`/v1/metrics${query}`);
}

export async function extractWebsiteData(url: string): Promise<Partial<ClientProfile>> {
  const data = await request<{ extracted: Partial<ClientProfile> }>('/v1/website/extract', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return { ...data.extracted, website_url: url };
}

export async function loadReadinessStatus(): Promise<ReadinessStatus> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/health`);
  } catch {
    throw new Error('Cannot reach the live readiness check right now.');
  }

  if (!response.ok) {
    throw new Error(`Readiness check failed (${response.status}).`);
  }

  return response.json() as Promise<ReadinessStatus>;
}
