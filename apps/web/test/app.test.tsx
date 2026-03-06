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

      if (url.includes('/v2/calls/stream')) {
        const payload = JSON.stringify({
          items: [
            {
              id: 'c1',
              call_intent: 'booking',
              hallucination_flag: false,
              missed_booking_opportunity: false,
              duration_seconds: 60,
              caller_phone: '+15555555555',
              summary: 'Fake call',
            },
          ],
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

      if (url.includes('/v2/calls')) {
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

    expect(await screen.findByText(/We Build/i)).toBeInTheDocument();
    expect(screen.getByTestId('mock-cyber-bg')).toBeInTheDocument();
  });

  it('renders login when unauthenticated', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Assistant knowledge' })).toBeInTheDocument();
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
        return new Response('{}', { status: 200 });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/Settings are being saved in temporary memory/i),
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

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    fireEvent.click(within(primaryNav).getByRole('link', { name: /Settings/ }));
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
    expect(within(primaryNav).getByRole('link', { name: /Settings/i })).toBeInTheDocument();
  });
});
