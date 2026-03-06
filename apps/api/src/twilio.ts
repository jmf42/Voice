import twilio from 'twilio';
import type { FastifyRequest } from 'fastify';

export function shouldVerifyTwilioSignature(): boolean {
  return process.env.NODE_ENV !== 'test' && Boolean(process.env.TWILIO_AUTH_TOKEN);
}

export function verifyTwilioRequest(request: FastifyRequest): boolean {
  if (!shouldVerifyTwilioSignature()) return true;

  const signature = request.headers['x-twilio-signature'];
  if (typeof signature !== 'string') return false;

  const explicitBaseUrl = process.env.API_BASE_URL;
  const url = explicitBaseUrl
    ? new URL(request.raw.url ?? request.url, explicitBaseUrl).toString()
    : `${request.protocol}://${request.hostname}${request.url}`;
  const params = (request.body as Record<string, string>) ?? {};

  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN ?? '', signature, url, params);
}
