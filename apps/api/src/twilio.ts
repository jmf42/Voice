import twilio from 'twilio';
import type { FastifyRequest } from 'fastify';

export function shouldVerifyTwilioSignature(): boolean {
  return process.env.NODE_ENV !== 'test' && Boolean(process.env.TWILIO_AUTH_TOKEN);
}

export function verifyTwilioRequest(request: FastifyRequest): boolean {
  if (!shouldVerifyTwilioSignature()) return true;

  const signature = request.headers['x-twilio-signature'];
  if (typeof signature !== 'string') return false;

  const params = (request.body as Record<string, string>) ?? {};
  const urls = buildCandidateRequestUrls(request);

  return urls.some((url) =>
    twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN ?? '', signature, url, params),
  );
}

function buildCandidateRequestUrls(request: FastifyRequest): string[] {
  const requestPath = request.raw.url ?? request.url;
  const candidates = new Set<string>();
  const explicitBaseUrl = process.env.API_BASE_URL;
  const forwardedProto = headerValue(request.headers['x-forwarded-proto']);
  const forwardedHost = headerValue(request.headers['x-forwarded-host']);
  const host = headerValue(request.headers.host);
  const hostname = request.hostname;
  const protocol = request.protocol;

  if (explicitBaseUrl) {
    candidates.add(new URL(requestPath, explicitBaseUrl).toString());
  }

  for (const candidateHost of [forwardedHost, host, hostname]) {
    if (!candidateHost) continue;
    for (const candidateProtocol of [forwardedProto, protocol, 'https', 'http']) {
      if (!candidateProtocol) continue;
      candidates.add(`${candidateProtocol}://${candidateHost}${requestPath}`);
    }
  }

  return [...candidates];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
