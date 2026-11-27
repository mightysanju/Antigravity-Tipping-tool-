import crypto from 'node:crypto';
import Stripe from 'stripe';
import type { ServerConfig } from '../config.ts';

export interface CreateTipPaymentIntentInput {
  checkoutIntentId: string;
  propertyId: string;
  chargeCents: number;
  metadata: Record<string, string>;
}

export interface CreateTipPaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
}

export interface ConnectOnboardingInput {
  personId: string;
  propertyId: string;
  email: string;
  name: string;
  existingAccountId: string | null;
  returnUrl: string;
  refreshUrl: string;
}

export interface ConnectOnboardingResult {
  stripeConnectAccountId: string;
  onboardingUrl: string;
}

export interface ConnectTransferInput {
  withdrawalId: string;
  destinationAccountId: string;
  netPayoutCents: number;
  method: 'standard' | 'instant';
  idempotencyKey: string;
}

export interface PayoutExecutor {
  createConnectExpressOnboardingLink(input: ConnectOnboardingInput): Promise<ConnectOnboardingResult>;
  executeTransferAndPayout(input: ConnectTransferInput): Promise<{ stripePayoutId: string }>;
}

export interface PaymentAdapter {
  readonly mode: ServerConfig['paymentMode'];
  readonly payoutExecutor: PayoutExecutor;
  createTipPaymentIntent(input: CreateTipPaymentIntentInput): Promise<CreateTipPaymentIntentResult>;
  refundPaymentIntent(input: {
    paymentIntentId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ stripeRefundId: string; status: string }>;
  verifyWebhookEvent(rawBody: string | Buffer, signatureHeader: string): Stripe.Event;
}

class MockPaymentAdapter implements PaymentAdapter {
  readonly mode = 'mock' as const;
  private readonly webhookSecret: string;
  private readonly stripeStub: Stripe;

  constructor(webhookSecret: string) {
    this.webhookSecret = webhookSecret;
    this.stripeStub = new Stripe('sk_test_mock_dev_key');
  }

  readonly payoutExecutor: PayoutExecutor = {
    createConnectExpressOnboardingLink: async (input) => {
      const accountId = input.existingAccountId ?? `acct_mock_${input.personId.slice(0, 8)}`;
      return {
        stripeConnectAccountId: accountId,
        onboardingUrl: `${input.returnUrl}?mock_connect_onboarded=${encodeURIComponent(accountId)}`,
      };
    },
    executeTransferAndPayout: async (input) => ({
      stripePayoutId: `po_mock_${input.method}_${input.withdrawalId.slice(0, 8)}`,
    }),
  };

  async createTipPaymentIntent(
    input: CreateTipPaymentIntentInput
  ): Promise<CreateTipPaymentIntentResult> {
    const suffix = `${input.checkoutIntentId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`;
    return {
      paymentIntentId: `pi_mock_${suffix}`,
      clientSecret: `pi_mock_${suffix}_secret_${crypto.randomBytes(6).toString('hex')}`,
    };
  }

  async refundPaymentIntent(input: {
    paymentIntentId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ stripeRefundId: string; status: string }> {
    return {
      stripeRefundId: `re_mock_${crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 12)}`,
      status: 'succeeded',
    };
  }

  verifyWebhookEvent(rawBody: string | Buffer, signatureHeader: string): Stripe.Event {
    return this.stripeStub.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
  }
}

class StripePaymentAdapter implements PaymentAdapter {
  readonly mode: 'stripe_test' | 'stripe_live';
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(mode: 'stripe_test' | 'stripe_live', secretKey: string, webhookSecret: string) {
    this.mode = mode;
    this.stripe = new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  readonly payoutExecutor: PayoutExecutor = {
    createConnectExpressOnboardingLink: async (input) => {
      let accountId = input.existingAccountId;
      if (!accountId) {
        const account = await this.stripe.accounts.create({
          type: 'express',
          email: input.email,
          capabilities: {
            transfers: { requested: true },
          },
          metadata: {
            person_id: input.personId,
            property_id: input.propertyId,
          },
        });
        accountId = account.id;
      }

      const link = await this.stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      });

      return {
        stripeConnectAccountId: accountId,
        onboardingUrl: link.url,
      };
    },
    executeTransferAndPayout: async (input) => {
      const transfer = await this.stripe.transfers.create(
        {
          amount: input.netPayoutCents,
          currency: 'usd',
          destination: input.destinationAccountId,
          metadata: { withdrawal_id: input.withdrawalId, method: input.method },
        },
        { idempotencyKey: `tr:${input.idempotencyKey}` }
      );

      if (input.method === 'instant') {
        const payout = await this.stripe.payouts.create(
          {
            amount: input.netPayoutCents,
            currency: 'usd',
            method: 'instant',
          },
          {
            stripeAccount: input.destinationAccountId,
            idempotencyKey: `po:${input.idempotencyKey}`,
          }
        );
        return { stripePayoutId: payout.id };
      }

      return { stripePayoutId: transfer.id };
    },
  };

  async createTipPaymentIntent(
    input: CreateTipPaymentIntentInput
  ): Promise<CreateTipPaymentIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.chargeCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        checkout_intent_id: input.checkoutIntentId,
        property_id: input.propertyId,
        ...input.metadata,
      },
    });
    if (!intent.client_secret) {
      throw new Error('Stripe PaymentIntent missing client_secret');
    }
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
    };
  }

  async refundPaymentIntent(input: {
    paymentIntentId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ stripeRefundId: string; status: string }> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return {
      stripeRefundId: refund.id,
      status: refund.status ?? 'succeeded',
    };
  }

  verifyWebhookEvent(rawBody: string | Buffer, signatureHeader: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
  }
}

export function createPaymentAdapter(config: ServerConfig): PaymentAdapter {
  if (config.paymentMode === 'mock') {
    return new MockPaymentAdapter(config.stripeWebhookSecret);
  }
  return new StripePaymentAdapter(
    config.paymentMode,
    config.stripeSecretKey,
    config.stripeWebhookSecret
  );
}
