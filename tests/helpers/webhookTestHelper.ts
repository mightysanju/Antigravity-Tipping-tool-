import Stripe from 'stripe';

/**
 * Dev/CI-only synthetic Stripe webhook signature generator.
 * Lives strictly under tests/ (never inside netlify/functions/).
 */
export function buildSignedMockStripeWebhook(
  payload: Record<string, unknown>,
  webhookSecret = 'whsec_mock_dev'
): { rawBody: string; signatureHeader: string } {
  const stripe = new Stripe('sk_test_mock_dev_key');
  const rawBody = JSON.stringify(payload);
  const signatureHeader = stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: webhookSecret,
  });
  return { rawBody, signatureHeader };
}
