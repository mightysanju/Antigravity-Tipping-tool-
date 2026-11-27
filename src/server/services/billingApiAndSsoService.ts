import crypto from 'node:crypto';
import type Stripe from 'stripe';
import type { PaymentAdapter } from '../adapters/paymentAdapter.ts';
import type { ServerConfig } from '../config.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

export type ApiKeyScope = 'assignments:write' | 'people:read' | 'people:write' | 'tips:read';

function sha256Hex(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============================================================================
// Step 9: Property Billing & Non-Payment Restrictions
// ============================================================================

export async function syncBillingStripeEvent(db: DbAdapter, event: Stripe.Event) {
  const obj = event.data.object as unknown as Record<string, unknown>;
  let customerId = typeof obj.customer === 'string' ? obj.customer : '';
  let subscriptionId =
    typeof obj.subscription === 'string'
      ? obj.subscription
      : event.type.startsWith('customer.subscription.') && typeof obj.id === 'string'
        ? obj.id
        : null;
  let subscriptionStatus =
    event.type.startsWith('customer.subscription.') && typeof obj.status === 'string'
      ? obj.status
      : null;

  let invoiceId: string | null = null;
  let amountCents: number | null = null;
  let invoiceStatus: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    invoiceId = typeof obj.id === 'string' ? obj.id : null;
    amountCents = typeof obj.amount_due === 'number' ? obj.amount_due : Number(obj.amount_paid ?? 0);
    invoiceStatus = event.type === 'invoice.paid' ? 'paid' : 'open';
    if (typeof obj.period_start === 'number') {
      periodStart = new Date(obj.period_start * 1000).toISOString();
    }
    if (typeof obj.period_end === 'number') {
      periodEnd = new Date(obj.period_end * 1000).toISOString();
    }
    if (!customerId && typeof obj.customer === 'string') {
      customerId = obj.customer;
    }
  }

  return db.callServiceRpc<Record<string, unknown>>(
    'sync_property_billing_webhook',
    {
      p_event_id: event.id,
      p_event_type: event.type,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId,
      p_subscription_status: subscriptionStatus,
      p_invoice_id: invoiceId,
      p_amount_cents: amountCents,
      p_invoice_status: invoiceStatus,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    },
    [
      event.id,
      event.type,
      customerId,
      subscriptionId,
      subscriptionStatus,
      invoiceId,
      amountCents,
      invoiceStatus,
      periodStart,
      periodEnd,
    ]
  );
}

export async function handleBillingWebhookWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  rawBody: string | Buffer;
  signatureHeader: string;
}) {
  const { db, paymentAdapter, rawBody, signatureHeader } = params;
  const event = paymentAdapter.verifyWebhookEvent(rawBody, signatureHeader);
  if (
    event.type === 'invoice.paid' ||
    event.type === 'invoice.payment_failed' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    return syncBillingStripeEvent(db, event);
  }
  return { ok: true, ignored: true, eventType: event.type };
}

// ============================================================================
// Step 10A: Super Admin Integrations (API Keys + SSO Providers)
// ============================================================================

export async function getSuperIntegrationsWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string
) {
  return db.callRpc<{
    propertyId: string;
    propertyName: string;
    propertyStatus: string;
    toggles: Record<string, boolean>;
    apiKeys: Array<{
      id: string;
      label: string;
      keyPrefix: string;
      scopes: ApiKeyScope[];
      revoked: boolean;
      revokedAt: string | null;
      lastUsedAt: string | null;
      createdAt: string;
    }>;
    ssoProvider: {
      id: string;
      clientId: string;
      authMode: 'server_minted' | 'partner_asymmetric';
      hasClientSecret: boolean;
      publicKeyPem: string | null;
      jwksUrl: string | null;
      allowedOrigins: string[];
      enabled: boolean;
    } | null;
  }>(caller, 'get_super_integrations', { p_property_id: propertyId }, [propertyId]);
}

export async function createPropertyApiKeyWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: { propertyId: string; label: string; scopes: ApiKeyScope[] }
) {
  const rawKey = `fdp_live_${crypto.randomBytes(24).toString('base64url')}`;
  const keyPrefix = rawKey.slice(0, 14);
  const hashedKey = sha256Hex(rawKey);
  const record = await db.callRpc<{
    id: string;
    label: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdAt: string;
  }>(
    caller,
    'create_property_api_key',
    {
      p_property_id: input.propertyId,
      p_label: input.label,
      p_key_prefix: keyPrefix,
      p_hashed_key: hashedKey,
      p_scopes: input.scopes,
    },
    [input.propertyId, input.label, keyPrefix, hashedKey, input.scopes]
  );

  return { ...record, rawKey };
}

export async function revokePropertyApiKeyWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  keyId: string
) {
  return db.callRpc<{ revoked: boolean; keyId: string }>(
    caller,
    'revoke_property_api_key',
    { p_key_id: keyId },
    [keyId]
  );
}

export async function upsertSsoProviderWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    clientId: string;
    authMode: 'server_minted' | 'partner_asymmetric';
    clientSecret?: string | null;
    publicKeyPem?: string | null;
    jwksUrl?: string | null;
    allowedOrigins?: string[];
    enabled: boolean;
  }
) {
  const hashedSecret =
    input.clientSecret && input.clientSecret.trim() ? sha256Hex(input.clientSecret.trim()) : null;
  return db.callRpc<Record<string, unknown>>(
    caller,
    'upsert_sso_provider',
    {
      p_property_id: input.propertyId,
      p_client_id: input.clientId,
      p_auth_mode: input.authMode,
      p_hashed_client_secret: hashedSecret,
      p_public_key_pem: input.publicKeyPem ?? null,
      p_jwks_url: input.jwksUrl ?? null,
      p_allowed_origins: input.allowedOrigins ?? [],
      p_enabled: input.enabled,
    },
    [
      input.propertyId,
      input.clientId,
      input.authMode,
      hashedSecret,
      input.publicKeyPem ?? null,
      input.jwksUrl ?? null,
      input.allowedOrigins ?? [],
      input.enabled,
    ]
  );
}

// ============================================================================
// Step 10B: External API Gateway
// ============================================================================

export async function handleApiGatewayRequest(params: {
  db: DbAdapter;
  apiKey: string | null;
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
}): Promise<{ status: number; body: unknown }> {
  const { db, apiKey, method, path, query = {}, body = {} } = params;
  const requestId = `req_${crypto.randomUUID().slice(0, 12)}`;

  if (!apiKey || !apiKey.startsWith('fdp_live_')) {
    return {
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key', requestId } },
    };
  }

  let requiredScope: ApiKeyScope;
  let requireAssignmentPush = false;

  if (method === 'POST' && path === '/assignments') {
    requiredScope = 'assignments:write';
    requireAssignmentPush = true;
  } else if (method === 'GET' && path === '/people') {
    requiredScope = 'people:read';
  } else if (method === 'POST' && path === '/people') {
    requiredScope = 'people:write';
  } else if (method === 'GET' && path === '/tips') {
    requiredScope = 'tips:read';
  } else {
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: `Unsupported route ${method} ${path}`, requestId } },
    };
  }

  const auth = await db.callServiceRpc<{
    ok: boolean;
    status?: number;
    code?: string;
    propertyId?: string;
  }>(
    'authenticate_api_key_and_rate_limit',
    {
      p_hashed_key: sha256Hex(apiKey),
      p_required_scope: requiredScope,
      p_require_assignment_push: requireAssignmentPush,
    },
    [sha256Hex(apiKey), requiredScope, requireAssignmentPush]
  );

  if (!auth.ok || !auth.propertyId) {
    return {
      status: auth.status ?? 403,
      body: {
        error: {
          code: auth.code ?? 'FORBIDDEN',
          message: `API access denied (${auth.code ?? 'FORBIDDEN'})`,
          requestId,
        },
      },
    };
  }

  if (method === 'POST' && path === '/assignments') {
    const date = String(body.date || '');
    const items = Array.isArray(body.assignments) ? body.assignments : [];
    const res = await db.callServiceRpc<Record<string, unknown>>(
      'api_push_assignments',
      { p_property_id: auth.propertyId, p_date: date, p_items: items },
      [auth.propertyId, date, JSON.stringify(items)]
    );
    return { status: 200, body: res };
  }

  if (method === 'GET' && path === '/people') {
    const res = await db.callServiceRpc<Record<string, unknown>>(
      'api_list_people',
      {
        p_property_id: auth.propertyId,
        p_status: query.status ?? null,
        p_department_id: query.departmentId ?? null,
      },
      [auth.propertyId, query.status ?? null, query.departmentId ?? null]
    );
    return { status: 200, body: res };
  }

  if (method === 'POST' && path === '/people') {
    const res = await db.callServiceRpc<{ person: Record<string, unknown> }>(
      'create_person_record',
      {
        p_property_id: auth.propertyId,
        p_name: String(body.name || ''),
        p_email: String(body.email || ''),
        p_role: String(body.role || 'staff'),
        p_department_id: (body.departmentId as string | null) ?? null,
        p_photo_path: null,
      },
      [
        auth.propertyId,
        String(body.name || ''),
        String(body.email || ''),
        String(body.role || 'staff'),
        (body.departmentId as string | null) ?? null,
        null,
      ]
    );
    return { status: 201, body: res };
  }

  // GET /tips
  const tipsRes = await db.callServiceRpc<Record<string, unknown>>(
    'api_list_tips',
    {
      p_property_id: auth.propertyId,
      p_from_date: query.from ?? null,
      p_to_date: query.to ?? null,
    },
    [auth.propertyId, query.from ?? null, query.to ?? null]
  );
  return { status: 200, body: tipsRes };
}

// ============================================================================
// Step 10C: Single Sign-On (Server-Minted + Partner Asymmetric RS256/EdDSA)
// ============================================================================

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

export async function mintServerSsoTokenWorkflow(params: {
  db: DbAdapter;
  config: ServerConfig;
  clientId: string;
  clientSecret: string;
  email: string;
  appOrigin?: string;
}) {
  const { db, config, clientId, clientSecret, email, appOrigin } = params;
  const prov = await db.callServiceRpc<{
    ok: boolean;
    code?: string;
    propertyId?: string;
    propertyStatus?: string;
    ft26Enabled?: boolean;
    authMode?: string;
    hashedClientSecret?: string;
    enabled?: boolean;
  }>('get_sso_provider_for_auth', { p_client_id: clientId }, [clientId]);

  if (!prov.ok || !prov.enabled || !prov.ft26Enabled || prov.propertyStatus !== 'active') {
    throw new Error(prov.code || 'SSO_DISABLED_OR_PROPERTY_INACTIVE');
  }
  if (prov.authMode !== 'server_minted' || !prov.hashedClientSecret) {
    throw new Error('SSO_AUTH_MODE_MISMATCH');
  }
  if (!timingSafeHexEqual(sha256Hex(clientSecret), prov.hashedClientSecret)) {
    throw new Error('INVALID_SSO_CLIENT_SECRET');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 60;
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlEncode(
    JSON.stringify({
      iss: clientId,
      aud: 'frontdesk-tip-sso',
      sub: email.trim().toLowerCase(),
      propertyId: prov.propertyId,
      jti: crypto.randomUUID(),
      iat: nowSec,
      exp: expSec,
    })
  );
  const sig = crypto
    .createHmac('sha256', config.ssoTokenSigningKey)
    .update(`${header}.${payload}`)
    .digest('base64url');
  const token = `${header}.${payload}.${sig}`;
  const origin = (appOrigin || 'http://localhost:5173').replace(/\/$/, '');

  return {
    token,
    redirectUrl: `${origin}/login#sso=${encodeURIComponent(token)}`,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export async function exchangeSsoTokenWorkflow(params: {
  db: DbAdapter;
  config: ServerConfig;
  token: string;
}) {
  const { db, config, token } = params;
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('MALFORMED_SSO_TOKEN');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) as { alg?: string };
  const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as {
    iss?: string;
    aud?: string;
    sub?: string;
    propertyId?: string;
    jti?: string;
    exp?: number;
  };

  if (!payload.iss || !payload.sub || !payload.jti || !payload.exp) {
    throw new Error('INVALID_SSO_CLAIMS');
  }
  if (payload.exp * 1000 < Date.now()) {
    throw new Error('SSO_TOKEN_EXPIRED');
  }

  const prov = await db.callServiceRpc<{
    ok: boolean;
    code?: string;
    propertyId?: string;
    propertyStatus?: string;
    ft26Enabled?: boolean;
    authMode?: 'server_minted' | 'partner_asymmetric';
    publicKeyPem?: string | null;
    enabled?: boolean;
  }>('get_sso_provider_for_auth', { p_client_id: payload.iss }, [payload.iss]);

  if (!prov.ok || !prov.enabled || !prov.ft26Enabled || prov.propertyStatus !== 'active') {
    throw new Error(prov.code || 'SSO_DISABLED_OR_PROPERTY_INACTIVE');
  }
  if (payload.propertyId && payload.propertyId !== prov.propertyId) {
    throw new Error('CROSS_PROPERTY_SSO_FORBIDDEN');
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  if (prov.authMode === 'server_minted') {
    if (header.alg !== 'HS256') throw new Error('INVALID_SSO_ALG');
    const expectedSig = crypto
      .createHmac('sha256', config.ssoTokenSigningKey)
      .update(signingInput)
      .digest('hex');
    const actualSig = b64urlDecode(sigB64).toString('hex');
    if (!timingSafeHexEqual(expectedSig, actualSig)) {
      throw new Error('INVALID_SSO_SIGNATURE');
    }
  } else {
    if (!prov.publicKeyPem) throw new Error('MISSING_PARTNER_PUBLIC_KEY');
    const alg = header.alg === 'EdDSA' ? null : header.alg === 'RS256' ? 'RSA-SHA256' : 'UNSUPPORTED';
    if (alg === 'UNSUPPORTED') throw new Error('UNSUPPORTED_SSO_ALG');
    const valid = crypto.verify(
      alg,
      Buffer.from(signingInput),
      prov.publicKeyPem,
      b64urlDecode(sigB64)
    );
    if (!valid) {
      throw new Error('INVALID_SSO_SIGNATURE');
    }
  }

  const resolved = await db.callServiceRpc<{
    ok: boolean;
    code?: string;
    personId?: string;
    authUserId?: string;
    name?: string;
    email?: string;
    role?: 'property_admin' | 'dept_manager' | 'staff';
    propertyId?: string;
  }>(
    'resolve_and_consume_sso_user',
    {
      p_property_id: prov.propertyId,
      p_email: payload.sub,
      p_jti: payload.jti,
      p_expires_at: new Date(payload.exp * 1000).toISOString(),
    },
    [prov.propertyId, payload.sub, payload.jti, new Date(payload.exp * 1000).toISOString()]
  );

  if (!resolved.ok) {
    throw new Error(resolved.code || 'SSO_REJECTED');
  }

  return resolved;
}
