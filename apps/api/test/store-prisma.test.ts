import { describe, expect, it, vi } from 'vitest';
import { PrismaStore } from '../src/store-prisma.js';

describe('PrismaStore tenant settings persistence', () => {
  it('creates missing tenant defaults without overwriting existing tenant settings', async () => {
    const tenantUpsert = vi.fn(async () => ({
      id: 'demo-tenant',
      createdAt: new Date('2026-03-04T00:00:00.000Z'),
    }));
    const settingsUpsert = vi.fn(async () => ({}));

    const store = new PrismaStore({
      tenant: { upsert: tenantUpsert },
      tenantSettings: { upsert: settingsUpsert },
    } as never);

    await store.createTenant({
      tenantId: 'demo-tenant',
      businessName: 'DispatchOS Demo Heating',
      businessPhone: '+41225550999',
      escalationPhone: '+41225550123',
    });

    expect(tenantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'demo-tenant' },
        update: {},
      }),
    );
    expect(settingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'demo-tenant' },
        update: {},
      }),
    );
  });

  it('maps UI settings updates into Prisma tenant settings columns', async () => {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      tenantId: 'demo-tenant',
      enabled: true,
      businessName: 'DispatchOS Demo',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      businessPhone: '+41225550000',
      languages: ['fr', 'en'],
      calendarEnabled: false,
      businessContext: data.businessContext ?? '',
      vertical: data.vertical ?? 'other',
      websiteUrl: data.websiteUrl ?? '',
      openingHours: data.openingHours ?? {},
      recordingConsentEnabled: data.recordingConsentEnabled ?? false,
      faqs: data.faqs ?? [],
      services: data.services ?? [],
    }));

    const store = new PrismaStore({
      tenantSettings: {
        findUnique: vi.fn(async () => ({
          tenantId: 'demo-tenant',
          enabled: true,
          businessName: 'DispatchOS Demo',
          escalationPhone: '+41220000000',
          callbackSlaMinutes: 30,
          businessPhone: '+41225550000',
          languages: ['fr', 'en'],
          calendarEnabled: false,
          businessContext: '',
          vertical: 'other',
          websiteUrl: '',
          openingHours: {},
          recordingConsentEnabled: false,
          faqs: [],
          services: [],
        })),
        update,
      },
    } as never);

    const result = await store.patchTenantSettings('demo-tenant', {
      business_context: 'Weekend surcharge is CHF 90.',
      vertical: 'field_service',
      website_url: 'https://example.com',
      opening_hours: { mon: '08:00-18:00' },
      recording_consent_enabled: true,
      faqs: [{ question: 'Do you work weekends?', answer: 'Yes, emergency only.' }],
      services: [{ name: 'Boiler Repair', duration_minutes: 60 }],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'demo-tenant' },
        data: expect.objectContaining({
          businessContext: 'Weekend surcharge is CHF 90.',
          vertical: 'field_service',
          websiteUrl: 'https://example.com',
          openingHours: { mon: '08:00-18:00' },
          recordingConsentEnabled: true,
          faqs: [{ question: 'Do you work weekends?', answer: 'Yes, emergency only.' }],
          services: [{ name: 'Boiler Repair', duration_minutes: 60 }],
        }),
      }),
    );

    expect(result.business_context).toBe('Weekend surcharge is CHF 90.');
    expect(result.vertical).toBe('field_service');
    expect(result.website_url).toBe('https://example.com');
    expect(result.opening_hours).toEqual({ mon: '08:00-18:00' });
    expect(result.recording_consent_enabled).toBe(true);
    expect(result.faqs).toEqual([{ question: 'Do you work weekends?', answer: 'Yes, emergency only.' }]);
    expect(result.services).toEqual([{ name: 'Boiler Repair', duration_minutes: 60 }]);
  });
});
