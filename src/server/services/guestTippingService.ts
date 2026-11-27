import Stripe from 'stripe';
import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import type { PaymentAdapter } from '../adapters/paymentAdapter.ts';
import type { ServerConfig } from '../config.ts';
import type { DbAdapter } from './types.ts';

export type TipTargetType = 'room' | 'dept' | 'person';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicStaffSummary {
  personId: string;
  displayName: string;
  photoUrl: string | null;
  departmentId?: string;
  departmentName?: string;
}

export interface PublicDepartmentSummary {
  departmentId: string;
  name: string;
  isHousekeeping: boolean;
  poolEnabled: boolean;
  staff: PublicStaffSummary[];
}

export interface ResolvedTipTarget {
  ok: boolean;
  code?: string;
  status?: string;
  mode?: 'room' | 'dept' | 'person' | 'person_fallback_pool';
  propertyId?: string;
  propertyName?: string;
  heroBackdropUrl?: string | null;
  accentColorHex?: string | null;
  tipBounds?: {
    minCents: number;
    maxCents: number;
    presetsCents: number[];
  };
  guestFeePolicy?: 'guest' | 'property' | 'staff';
  enabledToggles?: Record<string, boolean>;
  room?: { roomId: string; roomNumber: string } | null;
  assignedHousekeeper?: PublicStaffSummary | null;
  departments?: PublicDepartmentSummary[];
  targetPerson?: PublicStaffSummary;
  fallbackPool?: { departmentId: string; departmentName: string };
}

async function signOptionalUrl(
  db: DbAdapter,
  bucket: string,
  objectPath: string | null | undefined
): Promise<string | null> {
  if (!objectPath || !db.createSignedStorageUrl) return null;
  return db.createSignedStorageUrl(bucket, objectPath, 3600);
}

/**
 * Resolves a public room / department / person QR target with strict PII minimization.
 * Converts private Storage paths (property-backdrops, staff-photos) to short-lived signed URLs.
 */
export async function resolveRoomViewWorkflow(
  db: DbAdapter,
  type: TipTargetType,
  id: string
): Promise<ResolvedTipTarget> {
  if (!UUID_RE.test(id)) {
    return { ok: false, code: 'TARGET_NOT_FOUND' };
  }

  const raw = await db.callAnonRpc<Record<string, unknown>>(
    'get_public_tip_target',
    { p_type: type, p_id: id },
    [type, id]
  );

  if (!raw || raw.ok !== true) {
    return {
      ok: false,
      code: String(raw?.code || 'TARGET_NOT_FOUND'),
      status: raw?.status ? String(raw.status) : undefined,
      propertyName: raw?.propertyName ? String(raw.propertyName) : undefined,
    };
  }

  const heroBackdropUrl = await signOptionalUrl(
    db,
    'property-backdrops',
    raw.heroPhotoPath as string | null | undefined
  );

  const rawAssigned = raw.assignedHousekeeper as
    | { personId: string; displayName: string; photoPath?: string | null; departmentId?: string }
    | null
    | undefined;
  const assignedHousekeeper: PublicStaffSummary | null = rawAssigned
    ? {
        personId: rawAssigned.personId,
        displayName: rawAssigned.displayName,
        photoUrl: await signOptionalUrl(db, 'staff-photos', rawAssigned.photoPath),
        departmentId: rawAssigned.departmentId,
      }
    : null;

  const rawTarget = raw.targetPerson as
    | {
        personId: string;
        displayName: string;
        photoPath?: string | null;
        departmentId?: string;
        departmentName?: string;
      }
    | undefined;
  const targetPerson: PublicStaffSummary | undefined = rawTarget
    ? {
        personId: rawTarget.personId,
        displayName: rawTarget.displayName,
        photoUrl: await signOptionalUrl(db, 'staff-photos', rawTarget.photoPath),
        departmentId: rawTarget.departmentId,
        departmentName: rawTarget.departmentName,
      }
    : undefined;

  const rawDepts = (raw.departments as Array<{
    departmentId: string;
    name: string;
    isHousekeeping: boolean;
    poolEnabled: boolean;
    staff: Array<{ personId: string; displayName: string; photoPath?: string | null }>;
  }>) || [];

  const departments: PublicDepartmentSummary[] = await Promise.all(
    rawDepts.map(async (dept) => ({
      departmentId: dept.departmentId,
      name: dept.name,
      isHousekeeping: dept.isHousekeeping,
      poolEnabled: dept.poolEnabled,
      staff: await Promise.all(
        (dept.staff || []).map(async (member) => ({
          personId: member.personId,
          displayName: member.displayName,
          photoUrl: await signOptionalUrl(db, 'staff-photos', member.photoPath),
        }))
      ),
    }))
  );

  return {
    ok: true,
    mode: raw.mode as ResolvedTipTarget['mode'],
    propertyId: String(raw.propertyId),
    propertyName: String(raw.propertyName),
    heroBackdropUrl,
    accentColorHex: (raw.accentColorHex as string | null) ?? null,
    tipBounds: raw.tipBounds as ResolvedTipTarget['tipBounds'],
    guestFeePolicy: raw.guestFeePolicy as ResolvedTipTarget['guestFeePolicy'],
    enabledToggles: (raw.enabledToggles as Record<string, boolean>) || {},
    room: (raw.room as { roomId: string; roomNumber: string } | null) ?? null,
    assignedHousekeeper,
    departments,
    targetPerson,
    fallbackPool: raw.fallbackPool as ResolvedTipTarget['fallbackPool'],
  };
}

export interface CreateTipCheckoutInput {
  sourceType: TipTargetType;
  sourceId: string;
  recipientType: 'person' | 'department_pool';
  personId?: string | null;
  departmentId: string;
  amountCents: number;
  note?: string | null;
  guestEmail?: string | null;
  expectedPersonId?: string | null;
}

export async function createTipCheckoutWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  input: CreateTipCheckoutInput;
}) {
  const { db, paymentAdapter, input } = params;
  if (!UUID_RE.test(input.sourceId) || !UUID_RE.test(input.departmentId)) {
    throw new Error('TARGET_NOT_FOUND');
  }
  if (input.personId && !UUID_RE.test(input.personId)) {
    throw new Error('RECIPIENT_UNAVAILABLE');
  }

  const prepared = await db.callServiceRpc<{
    checkoutIntentId: string;
    propertyId: string;
    propertyName: string;
    recipientType: 'person' | 'department_pool';
    recipientName: string;
    personId: string | null;
    departmentId: string;
    roomNumber: string | null;
    amountCents: number;
    feeCents: number;
    guestFeeCents: number;
    netCents: number;
    chargeCents: number;
  }>(
    'prepare_tip_checkout',
    {
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_recipient_type: input.recipientType,
      p_person_id: input.personId ?? null,
      p_department_id: input.departmentId,
      p_amount_cents: Math.round(input.amountCents),
      p_note: input.note ?? null,
      p_guest_email: input.guestEmail ?? null,
      p_expected_person_id: input.expectedPersonId ?? null,
    },
    [
      input.sourceType,
      input.sourceId,
      input.recipientType,
      input.personId ?? null,
      input.departmentId,
      Math.round(input.amountCents),
      input.note ?? null,
      input.guestEmail ?? null,
      input.expectedPersonId ?? null,
    ]
  );

  const intent = await paymentAdapter.createTipPaymentIntent({
    checkoutIntentId: prepared.checkoutIntentId,
    propertyId: prepared.propertyId,
    chargeCents: prepared.chargeCents,
    metadata: {
      property_id: prepared.propertyId,
      recipient_type: prepared.recipientType,
      department_id: prepared.departmentId,
      ...(prepared.personId ? { person_id: prepared.personId } : {}),
      ...(prepared.roomNumber ? { room_number: prepared.roomNumber } : {}),
    },
  });

  await db.callServiceRpc<void>(
    'attach_payment_intent_to_checkout',
    {
      p_checkout_intent_id: prepared.checkoutIntentId,
      p_payment_intent_id: intent.paymentIntentId,
    },
    [prepared.checkoutIntentId, intent.paymentIntentId]
  );

  return {
    checkoutIntentId: prepared.checkoutIntentId,
    paymentIntentId: intent.paymentIntentId,
    clientSecret: intent.clientSecret,
    paymentMode: paymentAdapter.mode,
    propertyName: prepared.propertyName,
    recipientName: prepared.recipientName,
    amountCents: prepared.amountCents,
    guestFeeCents: prepared.guestFeeCents,
    chargeCents: prepared.chargeCents,
    netCents: prepared.netCents,
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Verifies Stripe webhook signature and commits confirmed tips idempotently.
 * Tips, ledger credits, and staff notifications are created ONLY here.
 */
export async function handleStripeWebhookWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  emailAdapter: EmailAdapter;
  rawBody: string | Buffer;
  signatureHeader: string;
}) {
  const { db, paymentAdapter, emailAdapter, rawBody, signatureHeader } = params;
  const event = paymentAdapter.verifyWebhookEvent(rawBody, signatureHeader);

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const confirmed = await db.callServiceRpc<{
      ok: boolean;
      deduplicated?: boolean;
      ignored?: boolean;
      tipId?: string;
      guestEmail?: string | null;
      amountCents?: number;
      guestFeeCents?: number;
      roomNumber?: string | null;
    }>(
      'confirm_tip_payment_webhook',
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payment_intent_id: pi.id,
      },
      [event.id, event.type, pi.id]
    );

    if (!confirmed.deduplicated && !confirmed.ignored && confirmed.guestEmail) {
      const totalCents = (confirmed.amountCents ?? 0) + (confirmed.guestFeeCents ?? 0);
      await emailAdapter.sendEmail({
        to: confirmed.guestEmail,
        subject: `Thank you for your ${formatCents(confirmed.amountCents ?? 0)} tip`,
        text: `Thank you! Your ${formatCents(totalCents)} gratitude payment${confirmed.roomNumber ? ` for Room ${confirmed.roomNumber}` : ''} has been received.`,
        html: `<p>Thank you! Your <strong>${formatCents(totalCents)}</strong> gratitude payment${confirmed.roomNumber ? ` for Room ${confirmed.roomNumber}` : ''} has been received.</p>`,
        template: 'receipt',
        metadata: { tipId: confirmed.tipId ?? '' },
      });
    }

    return { received: true, eventId: event.id, eventType: event.type, ...confirmed };
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const failed = await db.callServiceRpc<{ ok: boolean; deduplicated?: boolean; markedFailed?: boolean }>(
      'fail_tip_payment_webhook',
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payment_intent_id: pi.id,
      },
      [event.id, event.type, pi.id]
    );
    return { received: true, eventId: event.id, eventType: event.type, ...failed };
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const tipId = charge.metadata?.tip_id ?? null;
    if (!tipId) {
      return { received: true, eventId: event.id, eventType: event.type, ignored: true };
    }
    const finalized = await db.callServiceRpc<Record<string, unknown>>(
      'finalize_tip_refund',
      { p_tip_id: tipId, p_success: true, p_event_id: event.id },
      [tipId, true, event.id]
    );
    return { received: true, eventId: event.id, eventType: event.type, ...finalized };
  }

  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    const dispute = event.data.object as Stripe.Dispute;
    const piId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? '';
    const handled = await db.callServiceRpc<Record<string, unknown>>(
      'handle_tip_dispute_webhook',
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payment_intent_id: piId,
        p_dispute_status: dispute.status ?? null,
      },
      [event.id, event.type, piId, dispute.status ?? null]
    );
    return { received: true, eventId: event.id, eventType: event.type, ...handled };
  }

  return { received: true, eventId: event.id, eventType: event.type, ignored: true };
}

/**
 * Helper for mock/dev mode & tests: constructs a real Stripe-signed webhook event
 * and routes it through handleStripeWebhookWorkflow.
 */
export function buildSignedMockStripeEvent(
  config: ServerConfig,
  type:
    | 'payment_intent.succeeded'
    | 'payment_intent.payment_failed'
    | 'charge.refunded'
    | 'charge.dispute.created'
    | 'charge.dispute.closed',
  paymentIntentId: string,
  eventId = `evt_mock_${crypto.randomUUID().slice(0, 12)}`,
  extra: { tipId?: string; disputeStatus?: string } = {}
): { rawBody: string; signatureHeader: string; eventId: string } {
  const dataObject =
    type === 'charge.refunded'
      ? {
          id: `ch_mock_${crypto.randomUUID().slice(0, 8)}`,
          object: 'charge',
          payment_intent: paymentIntentId,
          metadata: extra.tipId ? { tip_id: extra.tipId } : {},
        }
      : type.startsWith('charge.dispute.')
        ? {
            id: `dp_mock_${crypto.randomUUID().slice(0, 8)}`,
            object: 'dispute',
            payment_intent: paymentIntentId,
            status: extra.disputeStatus ?? 'needs_response',
          }
        : {
            id: paymentIntentId,
            object: 'payment_intent',
          };

  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object: dataObject },
  });
  const stripe = new Stripe('sk_test_mock_dev_key');
  const signatureHeader = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.stripeWebhookSecret,
  });
  return { rawBody: payload, signatureHeader, eventId };
}
