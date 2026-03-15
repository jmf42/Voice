import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  public readyState = 0;
  public sent: string[] = [];
  public options?: { headers?: Record<string, string> };

  constructor(
    public url: string,
    options?: {
      headers?: Record<string, string>;
    },
  ) {
    super();
    this.options = options;
    MockWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  message(payload: unknown): void {
    this.emit('message', JSON.stringify(payload));
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }
}

vi.mock('ws', () => ({ default: MockWebSocket }));

const { RealtimeConversationService } = await import('../src/services.js');

describe('RealtimeConversationService', () => {
  it('queues prompt turns until realtime socket is open', () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');
    let doneCount = 0;

    const session = service.createSession({
      businessName: 'Demo',
      knowledgeInstruction: 'Known services: Heating Repair.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      onTextDelta: () => {},
      onTextDone: () => {
        doneCount += 1;
      },
      onError: () => {},
    });

    expect(session).toBeTruthy();
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    if (!ws) {
      throw new Error('mock websocket missing');
    }

    session?.sendUserTurn(
      'Need help with heating leak',
      'Ask for the full service address next and stay in English.',
    );
    expect(ws.sent).toHaveLength(0);

    ws.open();
    const sentPayloads = ws.sent.map(
      (entry) =>
        JSON.parse(entry) as {
          type: string;
          item?: { content?: Array<{ text: string }> };
          response?: {
            instructions?: string;
            output_modalities?: string[];
            max_output_tokens?: number;
          };
        },
    );
    expect(sentPayloads.some((entry) => entry.type === 'session.update')).toBe(true);
    const userTurnPayload = sentPayloads.find((entry) => entry.type === 'conversation.item.create');
    expect(userTurnPayload?.item?.content?.[0]?.text).toBe('Need help with heating leak');
    const responseCreate = sentPayloads.find((entry) => entry.type === 'response.create');
    expect(responseCreate?.response?.instructions).toBe(
      'Ask for the full service address next and stay in English.',
    );
    expect(responseCreate?.response?.output_modalities).toEqual(['text']);
    expect(responseCreate?.response?.max_output_tokens).toBe(120);
    expect(doneCount).toBe(0);
  });

  it('includes business context in the realtime session instructions', () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');

    service.createSession({
      businessName: 'Demo Plumbing',
      knowledgeInstruction:
        'Business context and policies you must use when answering: Weekend emergency surcharge is CHF 90. Service area is central Geneva only. Known services: Boiler Repair. FAQ answers: Do you work weekends? -> Yes, for emergencies.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      onTextDelta: () => {},
      onTextDone: () => {},
      onError: () => {},
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    if (!ws) {
      throw new Error('mock websocket missing');
    }

    ws.open();
    const sessionUpdate = ws.sent
      .map(
        (entry) =>
          JSON.parse(entry) as {
            type: string;
            session?: { instructions?: string; max_output_tokens?: number };
          },
      )
      .find((entry) => entry.type === 'session.update');

    expect(sessionUpdate?.session?.instructions).toContain(
      'Business context and policies you must use when answering: Weekend emergency surcharge is CHF 90. Service area is central Geneva only. Known services: Boiler Repair. FAQ answers: Do you work weekends? -> Yes, for emergencies.',
    );
    expect(sessionUpdate?.session?.instructions).toContain('# Conversation flow');
    expect(sessionUpdate?.session?.instructions).toContain(
      'Never switch to French, Spanish, or any other language',
    );
    expect(sessionUpdate?.session?.instructions).toContain(
      'Use at most one short sentence plus one short follow-up question.',
    );
    expect(sessionUpdate?.session?.max_output_tokens).toBe(120);
  });

  it('uses the current realtime model and current GA session fields', () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');

    service.createSession({
      businessName: 'Demo Plumbing',
      knowledgeInstruction: 'Use saved business details first.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      onTextDelta: () => {},
      onTextDone: () => {},
      onError: () => {},
    });

    const ws = MockWebSocket.instances[0];
    expect(ws?.url).toContain('gpt-realtime-1.5');
    if (!ws) {
      throw new Error('mock websocket missing');
    }
    expect(ws.options?.headers).toEqual({
      Authorization: 'Bearer test-openai-key',
    });

    ws.open();
    const sessionUpdate = ws.sent
      .map(
        (entry) =>
          JSON.parse(entry) as {
            type: string;
            session?: {
              type?: string;
              model?: string;
              output_modalities?: string[];
              truncation?: { type?: string; retention_ratio?: number };
            };
          },
      )
      .find((entry) => entry.type === 'session.update');

    expect(sessionUpdate?.session?.type).toBe('realtime');
    expect(sessionUpdate?.session?.model).toBe('gpt-realtime-1.5');
    expect(sessionUpdate?.session?.output_modalities).toEqual(['text']);
    expect(sessionUpdate?.session?.truncation).toEqual({
      type: 'retention_ratio',
      retention_ratio: 0.8,
    });
  });

  it('registers realtime tools and continues the response after tool output', async () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');
    const toolHandler = vi.fn().mockResolvedValue({
      answered: true,
      answer: 'We provide boiler repair.',
    });
    let doneCount = 0;

    const session = service.createSession({
      businessName: 'Demo Plumbing',
      knowledgeInstruction: 'Use saved business details first.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      tools: {
        lookup_business_answer: {
          description: 'Answer saved business questions.',
          parameters: {
            type: 'object',
            properties: {
              question: { type: 'string' },
            },
          },
          handler: toolHandler,
        },
      },
      onTextDelta: () => {},
      onTextDone: () => {
        doneCount += 1;
      },
      onError: () => {},
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    if (!ws) {
      throw new Error('mock websocket missing');
    }

    ws.open();
    session?.sendUserTurn('What services do you provide?');

    const sessionUpdate = ws.sent
      .map(
        (entry) =>
          JSON.parse(entry) as {
            type: string;
            session?: { tools?: Array<{ name: string }> };
          },
      )
      .find((entry) => entry.type === 'session.update');
    expect(sessionUpdate?.session?.tools).toEqual([
      expect.objectContaining({ name: 'lookup_business_answer' }),
    ]);

    ws.message({
      type: 'response.done',
      response: {
        output: [
          {
            type: 'function_call',
            name: 'lookup_business_answer',
            call_id: 'call_123',
            arguments: JSON.stringify({ question: 'What services do you provide?' }),
          },
        ],
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(toolHandler).toHaveBeenCalledWith({ question: 'What services do you provide?' });
    expect(doneCount).toBe(0);

    const sentPayloads = ws.sent.map((entry) => JSON.parse(entry) as Record<string, unknown>);
    expect(sentPayloads).toContainEqual({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: 'call_123',
        output: JSON.stringify({
          answered: true,
          answer: 'We provide boiler repair.',
        }),
      },
    });
    expect(
      sentPayloads.filter((entry) => entry.type === 'response.create').at(-1),
    ).toMatchObject({
      type: 'response.create',
      response: {
        output_modalities: ['text'],
        max_output_tokens: 120,
        tool_choice: 'auto',
      },
    });
  });

  it('streams output_text events and only finalizes once per assistant response', () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');
    let output = '';
    let doneCount = 0;

    const session = service.createSession({
      businessName: 'Demo',
      knowledgeInstruction: 'Known services: Heating Repair.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      onTextDelta: (token) => {
        output += token;
      },
      onTextDone: () => {
        doneCount += 1;
      },
      onError: () => {},
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    if (!ws) {
      throw new Error('mock websocket missing');
    }
    ws.open();
    session?.sendUserTurn('Can someone come this afternoon?');

    ws.message({ type: 'response.output_text.delta', delta: 'Yes,' });
    ws.message({ type: 'response.output_text.delta', delta: ' we can help.' });
    ws.message({ type: 'response.output_text.done', text: 'Yes, we can help.' });
    ws.message({ type: 'response.done' });

    expect(output).toBe('Yes, we can help.');
    expect(doneCount).toBe(1);
  });

  it('finalizes response when output_text.done arrives without response.done', () => {
    MockWebSocket.reset();
    const service = new RealtimeConversationService('test-openai-key');
    let doneCount = 0;

    const session = service.createSession({
      businessName: 'Demo',
      knowledgeInstruction: 'Known services: Heating Repair.',
      escalationPhone: '+41220000000',
      callbackSlaMinutes: 30,
      languages: ['en'],
      onTextDelta: () => {},
      onTextDone: () => {
        doneCount += 1;
      },
      onError: () => {},
    });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();
    if (!ws) {
      throw new Error('mock websocket missing');
    }
    ws.open();
    session?.sendUserTurn('Need an update');
    ws.message({ type: 'response.output_text.done', text: 'All set.' });

    expect(doneCount).toBe(1);
  });
});
