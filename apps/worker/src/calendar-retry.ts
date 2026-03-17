export interface CalendarWriteRetryPayload {
  tenantId: string;
  jobId: string;
  slotStart?: string;
  slotEnd?: string;
}

export async function retryCalendarWriteJob(
  args: {
    apiBaseUrl: string;
    queueSecret?: string;
    payload: CalendarWriteRetryPayload;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  if (!args.queueSecret) {
    throw new Error('calendar-write retry requires QUEUE_SHARED_SECRET');
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`${args.apiBaseUrl}/internal/queue/calendar-write`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-queue-secret': args.queueSecret,
    },
    body: JSON.stringify(args.payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `calendar-write retry failed (${response.status})`);
  }
}
