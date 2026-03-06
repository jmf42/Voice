import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@dispatchos/shared';

export interface AuthContext {
  tenantId: string;
  role: Role;
  userId: string;
}

export function allowDevAuthToken(): boolean {
  if (process.env.ALLOW_DEV_AUTH_TOKEN === 'true') return true;
  if (process.env.ALLOW_DEV_AUTH_TOKEN === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function parseBearerToken(authHeader?: string): AuthContext | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();

  // Development token format: tenant:<tenantId>:role:<operator|client_admin>:user:<id>
  const parts = token.split(':');
  const tenantId = parts[1];
  const role = parts[3];
  const userId = parts[5];

  if (
    parts.length >= 6 &&
    parts[0] === 'tenant' &&
    parts[2] === 'role' &&
    parts[4] === 'user' &&
    tenantId &&
    role &&
    userId
  ) {
    if (role === 'operator' || role === 'client_admin') {
      return {
        tenantId,
        role: role as Role,
        userId,
      };
    }
  }

  return null;
}

function rawBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.replace('Bearer ', '').trim();
}

function initFirebaseIfConfigured(): boolean {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (getApps().length > 0) return true;

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
    return true;
  }

  if (!projectId) return false;

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
  return true;
}

async function verifyFirebaseBearer(authHeader?: string): Promise<AuthContext | null> {
  if (!initFirebaseIfConfigured()) return null;
  const token = rawBearerToken(authHeader);
  if (!token) return null;

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const tenantId =
      (decoded.tenantId as string | undefined) ?? (decoded['tenant_id'] as string | undefined);
    const role = decoded.role as Role | undefined;
    if (!tenantId || (role !== 'operator' && role !== 'client_admin')) return null;

    return {
      tenantId,
      role,
      userId: decoded.uid,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const devAuthEnabled = allowDevAuthToken();
  const auth =
    (devAuthEnabled ? parseBearerToken(request.headers.authorization) : null) ??
    (await verifyFirebaseBearer(request.headers.authorization));
  if (!auth) {
    reply.status(401).send({ error: 'Unauthorized. Use a valid magic-link session token.' });
    return;
  }

  (request as FastifyRequest & { auth: AuthContext }).auth = auth;
}
