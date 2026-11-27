import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createPaymentAdapter } from '../../src/server/adapters/paymentAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import {
  createTipCheckoutWorkflow,
  type TipTargetType,
} from '../../src/server/services/guestTippingService.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
  }
  try {
    const config = loadServerConfig();
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
    const paymentAdapter = createPaymentAdapter(config);

    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    const result = await createTipCheckoutWorkflow({
      db,
      paymentAdapter,
      input: {
        sourceType: String(body.sourceType || 'room') as TipTargetType,
        sourceId: String(body.sourceId || ''),
        recipientType: String(body.recipientType || 'person') as 'person' | 'department_pool',
        personId: (body.personId as string | null) ?? null,
        departmentId: String(body.departmentId || ''),
        amountCents: Number(body.amountCents || 0),
        note: (body.note as string | null) ?? null,
        guestEmail: (body.guestEmail as string | null) ?? null,
        expectedPersonId: (body.expectedPersonId as string | null) ?? null,
      },
    });
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create checkout';
    const status = message.includes('ASSIGNMENT_CHANGED')
      ? 409
      : message.includes('TARGET_NOT_FOUND')
        ? 404
        : message.includes('PROPERTY_RESTRICTED') || message.includes('FEATURE_DISABLED')
          ? 403
          : 422;
    const code = message.includes('ASSIGNMENT_CHANGED')
      ? 'ASSIGNMENT_CHANGED'
      : message.includes('RECIPIENT_UNAVAILABLE')
        ? 'RECIPIENT_UNAVAILABLE'
        : message.includes('PROPERTY_RESTRICTED')
          ? 'PROPERTY_RESTRICTED'
          : 'CHECKOUT_ERROR';
    return json(status, { error: { code, message } });
  }
};
