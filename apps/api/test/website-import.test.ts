import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: mocks.create,
      },
    };
  },
}));

import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store.js';

const authHeader = {
  authorization: 'Bearer tenant:demo-tenant:role:operator:user:1',
};

describe('website import', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: '{"business_name":"Acme Locks"}' } }],
    });
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('falls back to a text reader when the original website blocks the request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockRejectedValueOnce(new Error('blocked'));
    fetchMock.mockRejectedValueOnce(new Error('blocked'));
    fetchMock.mockResolvedValueOnce(
      new Response('Acme Locks emergency locksmith Geneva +41 22 555 00 00', { status: 200 }),
    );

    const app = createApp({ store: new InMemoryStore() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/website/extract',
      headers: authHeader,
      payload: { url: 'acmelocks.example' },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://acmelocks.example/',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://www.acmelocks.example/',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://r.jina.ai/http://acmelocks.example',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.body)).toEqual({
      extracted: {
        business_name: 'Acme Locks',
      },
    });
  });
});
