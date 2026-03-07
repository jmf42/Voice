import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  public readyState = 0;
  public sent: string[] = [];

  constructor(public url: string) {
    super();
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

    session?.sendUserTurn('Need help with heating leak');
    expect(ws.sent).toHaveLength(0);

    ws.open();
    const sentPayloads = ws.sent.map(
      (entry) =>
        JSON.parse(entry) as { type: string; item?: { content?: Array<{ text: string }> } },
    );
    expect(sentPayloads.some((entry) => entry.type === 'session.update')).toBe(true);
    const userTurnPayload = sentPayloads.find((entry) => entry.type === 'conversation.item.create');
    expect(userTurnPayload?.item?.content?.[0]?.text).toBe('Need help with heating leak');
    expect(sentPayloads.some((entry) => entry.type === 'response.create')).toBe(true);
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
      .map((entry) => JSON.parse(entry) as { type: string; session?: { instructions?: string } })
      .find((entry) => entry.type === 'session.update');

    expect(sessionUpdate?.session?.instructions).toContain(
      'Business context and policies you must use when answering: Weekend emergency surcharge is CHF 90. Service area is central Geneva only. Known services: Boiler Repair. FAQ answers: Do you work weekends? -> Yes, for emergencies.',
    );
  });

  it('uses the current realtime model in the websocket URL and keeps session.update minimal', () => {
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

    ws.open();
    const sessionUpdate = ws.sent
      .map(
        (entry) =>
          JSON.parse(entry) as {
            type: string;
            session?: { modalities?: string[] };
          },
      )
      .find((entry) => entry.type === 'session.update');

    expect(sessionUpdate?.session?.modalities).toEqual(['text']);
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
