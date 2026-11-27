import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { createPaymentAdapter } from '../../src/server/adapters/paymentAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { handleStripeWebhookWorkflow } from '../../src/server/services/guestTippingService.ts';

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
    const emailAdapter = createEmailAdapter(config);

    const signature =
      event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';
    if (!signature) {
      return json(400, { error: { code: 'INVALID_SIGNATURE', message: 'Missing Stripe-Signature' } });
    }

    const rawBody = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64')
      : (event.body ?? '');

    const result = await handleStripeWebhookWorkflow({
      db,
      paymentAdapter,
      emailAdapter,
      rawBody,
      signatureHeader: signature,
    });
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook verification failed';
    return json(400, { error: { code: 'WEBHOOK_ERROR', message } });
  }
};
