import type { Handler, HandlerContext, HandlerEvent } from '@netlify/functions';
import { handler as adminAssignments } from '../netlify/functions/admin-assignments.ts';
import { handler as adminDirectory } from '../netlify/functions/admin-directory.ts';
import { handler as adminRooms } from '../netlify/functions/admin-rooms.ts';
import { handler as adminTips } from '../netlify/functions/admin-tips.ts';
import { handler as apiGateway } from '../netlify/functions/api-gateway.ts';
import { handler as billingSync } from '../netlify/functions/billing-sync.ts';
import { handler as createConnectOnboardingLink } from '../netlify/functions/create-connect-onboarding-link.ts';
import { handler as createTipCheckout } from '../netlify/functions/create-tip-checkout.ts';
import { handler as deleteDepartment } from '../netlify/functions/delete-department.ts';
import { handler as distributePool } from '../netlify/functions/distribute-pool.ts';
import { handler as exportTips } from '../netlify/functions/export-tips.ts';
import { handler as generateQrCards } from '../netlify/functions/generate-qr-cards.ts';
import { handler as joinByQr } from '../netlify/functions/join-by-qr.ts';
import { handler as loginContext } from '../netlify/functions/login-context.ts';
import { handler as parseAssignmentSheet } from '../netlify/functions/parse-assignment-sheet.ts';
import { handler as reconcileStalePayoutsBackground } from '../netlify/functions/reconcile-stale-payouts-background.ts';
import { handler as refundTip } from '../netlify/functions/refund-tip.ts';
import { handler as requestWithdrawal } from '../netlify/functions/request-withdrawal.ts';
import { handler as resolveRoomView } from '../netlify/functions/resolve-room-view.ts';
import { handler as runWeeklyPayoutsBackground } from '../netlify/functions/run-weekly-payouts-background.ts';
import { handler as sendOtp } from '../netlify/functions/send-otp.ts';
import { handler as signAgreement } from '../netlify/functions/sign-agreement.ts';
import { handler as ssoToken } from '../netlify/functions/sso-token.ts';
import { handler as staffPortal } from '../netlify/functions/staff-portal.ts';
import { handler as stripeWebhook } from '../netlify/functions/stripe-webhook.ts';
import { handler as superAdmin } from '../netlify/functions/super-admin.ts';
import { handler as superIntegrations } from '../netlify/functions/super-integrations.ts';
import { handler as unclaimedRemindersBackground } from '../netlify/functions/unclaimed-reminders-background.ts';
import { handler as verifyOtp } from '../netlify/functions/verify-otp.ts';

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv extends Record<string, unknown> {
  ASSETS: Fetcher;
  CRON_SECRET?: string;
}

const FUNCTION_ROUTES: Record<string, Handler> = {
  'admin-assignments': adminAssignments,
  'admin-directory': adminDirectory,
  'admin-rooms': adminRooms,
  'admin-tips': adminTips,
  'api-gateway': apiGateway,
  'billing-sync': billingSync,
  'create-connect-onboarding-link': createConnectOnboardingLink,
  'create-tip-checkout': createTipCheckout,
  'delete-department': deleteDepartment,
  'distribute-pool': distributePool,
  'export-tips': exportTips,
  'generate-qr-cards': generateQrCards,
  'join-by-qr': joinByQr,
  'login-context': loginContext,
  'parse-assignment-sheet': parseAssignmentSheet,
  'reconcile-stale-payouts-background': reconcileStalePayoutsBackground,
  'refund-tip': refundTip,
  'request-withdrawal': requestWithdrawal,
  'resolve-room-view': resolveRoomView,
  'run-weekly-payouts-background': runWeeklyPayoutsBackground,
  'send-otp': sendOtp,
  'sign-agreement': signAgreement,
  'sso-token': ssoToken,
  'staff-portal': staffPortal,
  'stripe-webhook': stripeWebhook,
  'super-admin': superAdmin,
  'super-integrations': superIntegrations,
  'unclaimed-reminders-background': unclaimedRemindersBackground,
  'verify-otp': verifyOtp,
};

function syncEnv(env: WorkerEnv, origin?: string) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    }
  }
  if (origin && !process.env.URL) {
    process.env.URL = origin;
  }
}

async function toHandlerEvent(request: Request, url: URL): Promise<HandlerEvent> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp && !headers['x-forwarded-for']) {
    headers['x-forwarded-for'] = cfConnectingIp;
  }

  const queryStringParameters: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryStringParameters[key] = value;
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const rawBody = hasBody ? await request.text() : null;

  return {
    rawUrl: request.url,
    rawQuery: url.search.replace(/^\?/, ''),
    path: url.pathname,
    httpMethod: request.method,
    headers,
    multiValueHeaders: {},
    queryStringParameters,
    multiValueQueryStringParameters: {},
    body: rawBody,
    isBase64Encoded: false,
  };
}

function fromHandlerResult(result: Awaited<ReturnType<Handler>>): Response {
  if (!result) {
    return new Response(null, { status: 204 });
  }
  const headers = new Headers();
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) {
        headers.set(key, String(value));
      }
    }
  }
  if (result.multiValueHeaders) {
    for (const [key, values] of Object.entries(result.multiValueHeaders)) {
      for (const value of values) {
        headers.append(key, String(value));
      }
    }
  }
  const body = result.isBase64Encoded && result.body
    ? Buffer.from(result.body, 'base64')
    : (result.body ?? '');

  return new Response(body, {
    status: result.statusCode ?? 200,
    headers,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const fnPrefix = '/.netlify/functions/';

    if (url.pathname.startsWith(fnPrefix)) {
      const rest = url.pathname.slice(fnPrefix.length);
      const fnName = rest.split('/')[0];
      const handler = FUNCTION_ROUTES[fnName];

      if (!handler) {
        return new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: `Unknown function: ${fnName}` } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      syncEnv(env, url.origin);
      const event = await toHandlerEvent(request, url);
      const result = await handler(event, {} as HandlerContext);
      return fromHandlerResult(result);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: { cron: string }, env: WorkerEnv): Promise<void> {
    syncEnv(env);
    const cronSecret = typeof env.CRON_SECRET === 'string' ? env.CRON_SECRET : '';
    const cronMap: Record<string, Handler> = {
      '0 * * * *': reconcileStalePayoutsBackground,
      '0 9 * * 1': runWeeklyPayoutsBackground,
      '0 10 * * *': unclaimedRemindersBackground,
    };
    const handler = cronMap[controller.cron];
    if (!handler) return;

    const event: HandlerEvent = {
      rawUrl: 'https://worker.internal/cron',
      rawQuery: '',
      path: '/cron',
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
      multiValueHeaders: {},
      queryStringParameters: {},
      multiValueQueryStringParameters: {},
      body: '{}',
      isBase64Encoded: false,
    };
    await handler(event, {} as HandlerContext);
  },
};
