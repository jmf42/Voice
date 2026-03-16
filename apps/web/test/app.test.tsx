import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

const settingsResponse = {
  settings: {
    id: 'demo-tenant',
    tenantId: 'demo-tenant',
    enabled: true,
    business_name: 'DispatchOS Demo',
    business_phone: '+41 22 555 09 99',
    escalation_phone: '+41 22 555 01 23',
    callback_sla_minutes: 30,
    calendar_enabled: false,
    languages: ['fr', 'en'],
    business_context: 'Emergency surcharge after 20:00 is CHF 90.',
    vertical: 'field_service',
    recording_consent_enabled: false,
    faqs: [{ question: 'Do you work weekends?', answer: 'Yes, for emergencies.' }],
    services: [{ name: 'Boiler Repair', duration_minutes: 60 }],
  },
};

const healthResponse = {
  ok: true,
  service: 'dispatchos-api',
  readiness: { productionSafe: false, issues: [] },
  persistence: { mode: 'database', durable: true },
  queue: { mode: 'redis', durable: true },
  auth: { devBearerEnabled: true, firebaseAdminConfigured: true },
  providers: { openai: true, twilioVoice: true, sms: true, calendar: false },
};

function markOnboardingComplete(): void {
  localStorage.setItem('dispatchos_onboarding_done:demo-tenant', 'true');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.setItem('dispatchos_disable_dev_fallback', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/v1/settings')) {
        return new Response(JSON.stringify(settingsResponse), { status: 200 });
      }

      if (url.includes('/health')) {
        return new Response(JSON.stringify(healthResponse), { status: 200 });
      }

      if (url.includes('/v1/jobs/stream')) {
        const payload = JSON.stringify({
          items: [],
        });
        const streamData = `data: ${payload}\n\n`;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(streamData));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      if (url.includes('/v1/jobs')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }

      if (url.includes('/v1/metrics')) {
        return new Response(
          JSON.stringify({
            calls_total: 10,
            calls_completed: 10,
            qualification_completion_rate: 1,
            urgent_jobs: 1,
            sms_delivery_success: 1,
            open_jobs: 2,
            overdue_urgent_jobs: 0,
            unconfirmed_address_jobs: 0,
            manual_booking_jobs: 0,
          }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    }),
  );
});

describe('web app', () => {
  it('renders landing page with the cyber background wrapper', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /Never lose a job because you missed a call/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Voice answers missed, after-hours, and overflow calls so your business keeps winning work/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mock-cyber-bg')).toBeInTheDocument();
  });

  it('links the landing page navigation to page sections', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Capabilities' })).toHaveAttribute(
      'href',
      '#capabilities',
    );
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute('href', '#system');
    expect(screen.getByRole('link', { name: 'Metrics' })).toHaveAttribute('href', '#metrics');
  });

  it('renders login when unauthenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in to Voice' })).toBeInTheDocument();
    expect(
      screen.getByText(/Email sign-in is not ready in this environment yet/i),
    ).toBeInTheDocument();
  });

  it('routes authenticated users to onboarding until setup is completed', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Set up your business' }),
    ).toBeInTheDocument();
  });

  it('renders job board when onboarding is completed', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('renders dashboard without the cyber background wrapper', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByTestId('mock-cyber-bg')).not.toBeInTheDocument();
  });

  it('renders settings route', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What callers should know' })).toBeInTheDocument();
  });

  it('shows a simpler dashboard workspace with quick actions', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/v1/settings')) {
          return new Response(JSON.stringify(settingsResponse), { status: 200 });
        }

        if (url.includes('/health')) {
          return new Response(JSON.stringify(healthResponse), { status: 200 });
        }

        if (url.includes('/v1/jobs/stream')) {
          const payload = JSON.stringify({ items: [] });
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        if (url.includes('/v1/jobs')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'job-1',
                  tenantId: 'demo-tenant',
                  callId: 'call-1',
                  status: 'confirmed',
                  booking_status: 'booked',
                  caller_phone: '+41225550123',
                  address_raw: 'Rue du Rhone 21 Geneva',
                  address_confirmed: true,
                  urgency: 'normal',
                  preferred_time_window: 'afternoon',
                  job_summary: 'Locked out of apartment',
                  service_hint: 'Emergency lockout',
                  createdAt: '2026-03-07T09:00:00.000Z',
                  updatedAt: '2026-03-07T09:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('New and recent calls')).toBeInTheDocument();
    expect(await screen.findByText('Do this now')).toBeInTheDocument();
    expect(await screen.findByText('Finish these before going live')).toBeInTheDocument();
  });

  it('shows calendar follow-up areas clearly', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/v1/settings')) {
          return new Response(JSON.stringify(settingsResponse), { status: 200 });
        }

        if (url.includes('/health')) {
          return new Response(JSON.stringify(healthResponse), { status: 200 });
        }

        if (url.includes('/v1/jobs')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'job-1',
                  tenantId: 'demo-tenant',
                  callId: 'call-1',
                  status: 'confirmed',
                  booking_status: 'booked',
                  confirmed_slot_start: '2026-03-08T20:00:00.000Z',
                  confirmed_slot_end: '2026-03-08T21:00:00.000Z',
                  caller_phone: '+41225550123',
                  address_raw: 'Rue du Rhone 21 Geneva',
                  address_confirmed: true,
                  urgency: 'normal',
                  preferred_time_window: 'evening',
                  job_summary: 'Locked out of apartment',
                  service_hint: 'Emergency lockout',
                  createdAt: '2026-03-07T09:00:00.000Z',
                  updatedAt: '2026-03-07T09:00:00.000Z',
                },
                {
                  id: 'job-2',
                  tenantId: 'demo-tenant',
                  callId: 'call-2',
                  status: 'confirmed',
                  booking_status: 'manual_required',
                  caller_phone: '+41225550999',
                  address_raw: 'Avenue de Frontenex 12 Geneva',
                  address_confirmed: true,
                  urgency: 'normal',
                  preferred_time_window: 'morning',
                  job_summary: 'Hair appointment request',
                  service_hint: 'Styling',
                  createdAt: '2026-03-07T10:00:00.000Z',
                  updatedAt: '2026-03-07T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Upcoming bookings')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Still needs booking' })).toBeInTheDocument();
  });

  it('links calendar entries to the job details route', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/v1/settings')) {
          return new Response(JSON.stringify(settingsResponse), { status: 200 });
        }

        if (url.includes('/health')) {
          return new Response(JSON.stringify(healthResponse), { status: 200 });
        }

        if (url.includes('/v1/jobs')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'job-1',
                  tenantId: 'demo-tenant',
                  callId: 'call-1',
                  status: 'confirmed',
                  booking_status: 'booked',
                  confirmed_slot_start: '2026-03-08T20:00:00.000Z',
                  confirmed_slot_end: '2026-03-08T21:00:00.000Z',
                  caller_phone: '+41225550123',
                  address_raw: 'Rue du Rhone 21 Geneva',
                  address_confirmed: true,
                  urgency: 'normal',
                  preferred_time_window: 'evening',
                  job_summary: 'Locked out of apartment',
                  service_hint: 'Emergency lockout',
                  createdAt: '2026-03-07T09:00:00.000Z',
                  updatedAt: '2026-03-07T09:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );

    const viewCallLink = await screen.findByRole('link', { name: 'View call' });
    expect(viewCallLink).toHaveAttribute('href', '/calls/job-1');
  });

  it('treats incomplete readiness responses as needing verification', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/v1/settings')) {
          return new Response(JSON.stringify(settingsResponse), { status: 200 });
        }

        if (url.includes('/health')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (url.includes('/v1/jobs/stream')) {
          const payload = JSON.stringify({ items: [] });
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        if (url.includes('/v1/jobs')) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }

        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Finish these before going live')).toBeInTheDocument();
    expect(screen.getByText('3 to check')).toBeInTheDocument();
    expect(screen.getByText('Production access needs verification')).toBeInTheDocument();
    expect(screen.queryByText('Production access is locked down')).not.toBeInTheDocument();
  });

  it('hides imported detail counts before a website import happens', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/v1/settings')) {
          return new Response(
            JSON.stringify({
              settings: {
                ...settingsResponse.settings,
                business_context: '',
                faqs: [],
                services: [],
                website_url: '',
              },
            }),
            { status: 200 },
          );
        }

        if (url.includes('/health')) {
          return new Response(JSON.stringify(healthResponse), { status: 200 });
        }

        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Set up your business' })).toBeInTheDocument();
    expect(screen.queryByText(/Imported details:/i)).not.toBeInTheDocument();
  });

  it('warns when settings are not being saved to a durable database', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/v1/settings')) {
          return new Response(
            JSON.stringify({
              settings: settingsResponse.settings,
              persistence: { mode: 'memory', durable: false },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/health')) {
          return new Response(
            JSON.stringify({
              ...healthResponse,
              persistence: { mode: 'memory', durable: false },
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/Your changes update the app right away/i),
    ).toBeInTheDocument();
  });

  it('renders settings without the cyber background wrapper', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByTestId('mock-cyber-bg')).not.toBeInTheDocument();
  });

  it('signs out and returns to login', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    localStorage.setItem('dispatchos_role', 'operator');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('New and recent calls')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Voice' })).toBeInTheDocument();
    expect(localStorage.getItem('dispatchos_token')).toBeNull();
  });

  it('keeps tenant settings loaded across protected route navigation', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    const fetchMock = vi.mocked(fetch);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('New and recent calls')).toBeInTheDocument();
    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    fireEvent.click(within(primaryNav).getByRole('link', { name: /Setup/ }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    const settingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/v1/settings'),
    );
    expect(settingsCalls).toHaveLength(1);
  });

  it('removes the standalone knowledge base navigation entry', async () => {
    localStorage.setItem('dispatchos_token', 'tenant:demo-tenant:role:operator:user:1');
    markOnboardingComplete();
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );

    const primaryNav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(
      within(primaryNav).queryByRole('link', { name: /Knowledge Base/i }),
    ).not.toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Setup/i })).toBeInTheDocument();
  });
});
