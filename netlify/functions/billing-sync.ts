import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createPaymentAdapter } from '../../src/server/adapters/paymentAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { handleBillingWebhookWorkflow } from '../../src/server/services/billingApiAndSsoService.ts';

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
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

    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
    if (!sig) {
      return json(400, { error: { code: 'INVALID_SIGNATURE', message: 'Missing Stripe-Signature' } });
    }
    const rawBody = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64')
      : (event.body ?? '');

    return json(
      200,
      await handleBillingWebhookWorkflow({
        db,
        paymentAdapter,
        rawBody,
        signatureHeader: sig,
      })
    );
  } catch (err) {
    return json(400, {
      error: { code: 'BILLING_WEBHOOK_ERROR', message: err instanceof Error ? err.message : 'Invalid event' },
    });
  }
};
