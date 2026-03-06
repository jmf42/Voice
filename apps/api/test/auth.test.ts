import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(() => 'application-default-credential'),
  cert: vi.fn(),
  getApps: vi.fn(() => []),
  verifyIdToken: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: mocks.initializeApp,
  applicationDefault: mocks.applicationDefault,
  cert: mocks.cert,
  getApps: mocks.getApps,
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: mocks.verifyIdToken,
  }),
}));

import { requireAuth } from '../src/auth.js';

describe('firebase auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_DEV_AUTH_TOKEN;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    process.env.FIREBASE_PROJECT_ID = 'dops-02242320-17720';
    process.env.ALLOW_DEV_AUTH_TOKEN = 'false';
  });

  it('accepts Firebase bearer tokens using application default credentials', async () => {
    mocks.verifyIdToken.mockResolvedValue({
      uid: 'user-1',
      tenantId: 'demo-tenant',
      role: 'operator',
    });

    const request = {
      headers: {
        authorization: 'Bearer firebase-token',
      },
    } as never;
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const reply = {
      status,
    } as never as { status: typeof status };

    await requireAuth(request, reply as never);

    expect(mocks.applicationDefault).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp).toHaveBeenCalledWith({
      credential: 'application-default-credential',
      projectId: 'dops-02242320-17720',
    });
    expect((request as never as { auth?: { tenantId: string } }).auth?.tenantId).toBe(
      'demo-tenant',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects the request when Firebase token verification fails', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('bad token'));

    const send = vi.fn();
    const request = {
      headers: {
        authorization: 'Bearer invalid-token',
      },
    } as never;
    const status = vi.fn(() => ({ send }));
    const reply = {
      status,
    } as never as { status: typeof status };

    await requireAuth(request, reply as never);

    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: 'Unauthorized. Use a valid magic-link session token.',
    });
  });
});
