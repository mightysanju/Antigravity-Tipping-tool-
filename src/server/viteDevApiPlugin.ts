import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadServerConfig } from './config.ts';
import { createEmailAdapter, StubEmailAdapter } from './adapters/emailAdapter.ts';
import { createSeededLocalDb, SEED_IDS } from './db/localPgliteBootstrap.ts';
import { PgliteDbAdapter, type AuthCaller } from './services/types.ts';
import { signAgreementWorkflow } from './services/agreementService.ts';
import {
  getPlatformPaymentsOverview,
  getPropertySuperDetail,
  getSuperDashboard,
  invitePropertyAdminWorkflow,
  listPropertyAdminsSuper,
  onboardPropertyWizard,
  removePropertyAdminSuper,
  setPropertyFeatureToggle,
  updatePlatformPaymentDefaults,
  updatePropertySettingsSuper,
} from './services/superAdminService.ts';
import {
  createPersonWorkflow,
  deleteDepartmentWithReassign,
  listDepartmentsAdmin,
  listPeopleAdmin,
  updatePersonWorkflow,
  upsertDepartmentAdmin,
} from './services/adminDirectoryService.ts';
import {
  checkTrustedDeviceWorkflow,
  completeJoinQrWorkflow,
  getLoginAccountContext,
  listJoinableStaffWorkflow,
  sendJoinQrOtpWorkflow,
  sendOtpWorkflow,
  verifyOtpWorkflow,
  type OtpPurpose,
} from './services/otpAndAuthService.ts';
import {
  addRoomsAdmin,
  deleteRoomAdmin,
  generateQrCardsWorkflow,
  listRoomsAdmin,
  uploadPropertyBackdropWorkflow,
  type QrKind,
} from './services/roomsAndQrService.ts';
import { createOcrAdapter } from './adapters/ocrAdapter.ts';
import { createPaymentAdapter } from './adapters/paymentAdapter.ts';
import {
  buildSignedMockStripeEvent,
  createTipCheckoutWorkflow,
  handleStripeWebhookWorkflow,
  resolveRoomViewWorkflow,
  type TipTargetType,
} from './services/guestTippingService.ts';
import {
  createPropertyApiKeyWorkflow,
  exchangeSsoTokenWorkflow,
  getSuperIntegrationsWorkflow,
  handleApiGatewayRequest,
  mintServerSsoTokenWorkflow,
  revokePropertyApiKeyWorkflow,
  upsertSsoProviderWorkflow,
  type ApiKeyScope,
} from './services/billingApiAndSsoService.ts';
import {
  createConnectOnboardingLinkWorkflow,
  refundTipWorkflow,
  requestWithdrawalWorkflow,
} from './services/payoutsAndRefundsService.ts';
import {
  distributePoolWorkflow,
  exportTipsWorkflow,
  getAdminTipsOverviewWorkflow,
  getStaffPortalWorkflow,
  markStaffNotificationsReadWorkflow,
} from './services/walletAndTipsService.ts';
import {
  getAssignmentContext,
  parseAssignmentSheetWorkflow,
  saveAssignmentsWorkflow,
  type AssignmentSource,
} from './services/assignmentService.ts';
import type { FeatureKey } from '../shared/features.ts';

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return [part.trim(), ''];
      return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
    })
  );
}

export function viteDevApiPlugin(): Plugin {
  let runtimePromise: Promise<{
    db: PgliteDbAdapter;
    config: ReturnType<typeof loadServerConfig>;
    emailAdapter: ReturnType<typeof createEmailAdapter>;
    paymentAdapter: ReturnType<typeof createPaymentAdapter>;
  }> | null = null;

  async function getRuntime() {
    if (!runtimePromise) {
      const config = loadServerConfig();
      const emailAdapter = createEmailAdapter(config);
      const paymentAdapter = createPaymentAdapter(config);
      runtimePromise = createSeededLocalDb().then((pg) => ({
        db: new PgliteDbAdapter(pg),
        config,
        emailAdapter,
        paymentAdapter,
      }));
    }
    return runtimePromise;
  }

  return {
    name: 'frontdesk-tip-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith('/api/dev/')) {
          return next();
        }

        const callerUid =
          (req.headers['x-dev-user-id'] as string | undefined) || SEED_IDS.users.superAdmin;
        const callerEmail =
          (req.headers['x-dev-user-email'] as string | undefined) || 'superadmin@frontdesktip.test';
        const caller: AuthCaller = { uid: callerUid, email: callerEmail };

        try {
          const { db, config, emailAdapter, paymentAdapter } = await getRuntime();

          if (url === '/api/dev/storage-object' && req.method === 'GET') {
            const query = new URLSearchParams(req.url?.split('?')[1] ?? '');
            const bucket = query.get('bucket') || '';
            const objectPath = query.get('path') || '';
            if (!['property-backdrops', 'staff-photos'].includes(bucket)) {
              return sendJson(res, 403, { error: { code: 'FORBIDDEN_BUCKET', message: 'Forbidden' } });
            }
            const buf = await db.getStoredObject(bucket, objectPath);
            if (!buf) {
              return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Object not found' } });
            }
            const ext = objectPath.split('.').pop()?.toLowerCase();
            res.statusCode = 200;
            res.setHeader(
              'Content-Type',
              ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
            );
            res.end(buf);
            return;
          }

          if (url === '/api/dev/resolve-room-view' && req.method === 'GET') {
            const query = new URLSearchParams(req.url?.split('?')[1] ?? '');
            const type = (query.get('type') || 'room') as TipTargetType;
            const id = query.get('id') || '';
            const result = await resolveRoomViewWorkflow(db, type, id);
            const status = result.ok
              ? 200
              : result.code === 'RECIPIENT_UNAVAILABLE'
                ? 422
                : result.code === 'PROPERTY_RESTRICTED' || result.code === 'FEATURE_DISABLED'
                  ? 403
                  : 404;
            return sendJson(res, status, result);
          }

          if (url === '/api/dev/create-tip-checkout' && req.method === 'POST') {
            const body = await readJsonBody(req);
            try {
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
              return sendJson(res, 200, result);
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
                  : 'CHECKOUT_ERROR';
              return sendJson(res, status, { error: { code, message } });
            }
          }

          if (url === '/api/dev/stripe-webhook' && req.method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const rawBody = Buffer.concat(chunks);
            const sig = String(req.headers['stripe-signature'] || '');
            try {
              const result = await handleStripeWebhookWorkflow({
                db,
                paymentAdapter,
                emailAdapter,
                rawBody,
                signatureHeader: sig,
              });
              return sendJson(res, 200, result);
            } catch (err) {
              return sendJson(res, 400, {
                error: { code: 'WEBHOOK_ERROR', message: err instanceof Error ? err.message : 'Invalid signature' },
              });
            }
          }

          if (url === '/api/dev/mock-complete-tip' && req.method === 'POST') {
            if (config.paymentMode !== 'mock') {
              return sendJson(res, 403, { error: { code: 'MOCK_ONLY', message: 'Only available in mock payment mode' } });
            }
            const body = await readJsonBody(req);
            const piId = String(body.paymentIntentId || '');
            const signed = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', piId);
            const result = await handleStripeWebhookWorkflow({
              db,
              paymentAdapter,
              emailAdapter,
              rawBody: signed.rawBody,
              signatureHeader: signed.signatureHeader,
            });
            return sendJson(res, 200, result);
          }

          if (url === '/api/dev/health' && req.method === 'GET') {
            return sendJson(res, 200, {
              ok: true,
              paymentMode: config.paymentMode,
              emailMode: config.emailMode,
              ocrMode: config.ocrMode,
            });
          }

          if (url === '/api/dev/stub-outbox' && req.method === 'GET') {
            const outbox = emailAdapter instanceof StubEmailAdapter ? emailAdapter.getOutbox() : [];
            return sendJson(res, 200, { emails: outbox.slice(-10) });
          }

          if (url === '/api/dev/agreement-pdf' && req.method === 'GET') {
            const query = new URLSearchParams(req.url?.split('?')[1] ?? '');
            const objectPath = query.get('path') || '';
            const buf = await db.getStoredObject('signed-agreements', objectPath);
            if (!buf) {
              return sendJson(res, 404, { error: { code: 'PDF_NOT_FOUND', message: 'Signed PDF not found' } });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
              'Content-Disposition',
              `inline; filename="${objectPath.split('/').pop() || 'agreement.pdf'}"`
            );
            res.end(buf);
            return;
          }

          if (url === '/api/dev/sign-agreement' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await signAgreementWorkflow({
              db,
              emailAdapter,
              caller,
              input: {
                signerType: body.signerType as 'property' | 'staff',
                signerId: String(body.signerId || ''),
                propertyId: String(body.propertyId || ''),
                propertyName: String(body.propertyName || 'Hotel Property'),
                typedName: String(body.typedName || ''),
                checkboxConfirmed: Boolean(body.checkboxConfirmed),
                ipAddress: '127.0.0.1',
                userAgent: String(req.headers['user-agent'] || 'vite-dev'),
                version: body.version ? String(body.version) : undefined,
              },
            });
            return sendJson(res, 200, result);
          }

          if (url === '/api/dev/super-admin' && req.method === 'POST') {
            const body = await readJsonBody(req);
            switch (body.action) {
              case 'dashboard':
                return sendJson(res, 200, await getSuperDashboard(db, caller));
              case 'property_detail':
                return sendJson(res, 200, await getPropertySuperDetail(db, caller, String(body.propertyId || '')));
              case 'onboard_property':
                return sendJson(
                  res,
                  201,
                  await onboardPropertyWizard(db, caller, (body.payload as Record<string, unknown>) || {})
                );
              case 'update_property':
                return sendJson(
                  res,
                  200,
                  await updatePropertySettingsSuper(
                    db,
                    caller,
                    String(body.propertyId || ''),
                    (body.patch as Record<string, unknown>) || {}
                  )
                );
              case 'set_feature_toggle':
                return sendJson(
                  res,
                  200,
                  await setPropertyFeatureToggle(
                    db,
                    caller,
                    String(body.propertyId || ''),
                    body.featureKey as FeatureKey,
                    Boolean(body.enabled)
                  )
                );
              case 'payments_overview':
                return sendJson(res, 200, await getPlatformPaymentsOverview(db, caller));
              case 'update_payment_defaults':
                return sendJson(
                  res,
                  200,
                  await updatePlatformPaymentDefaults(
                    db,
                    caller,
                    Number(body.payoutWeekday ?? 4),
                    Number(body.minWithdrawalCents ?? 1000),
                    Boolean(body.applyToAll)
                  )
                );
              case 'list_admins':
                return sendJson(res, 200, { admins: await listPropertyAdminsSuper(db, caller) });
              case 'invite_admin':
                return sendJson(
                  res,
                  201,
                  await invitePropertyAdminWorkflow({
                    db,
                    emailAdapter,
                    caller,
                    propertyId: String(body.propertyId || ''),
                    name: String(body.name || ''),
                    email: String(body.email || ''),
                    appOrigin: `http://${req.headers.host || 'localhost:5173'}`,
                  })
                );
              case 'remove_admin':
                return sendJson(res, 200, await removePropertyAdminSuper(db, caller, String(body.personId || '')));
              default:
                return sendJson(res, 400, { error: { code: 'UNKNOWN_ACTION', message: 'Unknown action' } });
            }
          }

          if (url === '/api/dev/admin-directory' && req.method === 'POST') {
            const body = await readJsonBody(req);
            switch (body.action) {
              case 'list_departments':
                return sendJson(res, 200, {
                  departments: await listDepartmentsAdmin(db, caller, String(body.propertyId || '')),
                });
              case 'upsert_department':
                return sendJson(
                  res,
                  200,
                  await upsertDepartmentAdmin(db, caller, {
                    propertyId: String(body.propertyId || ''),
                    departmentId: (body.departmentId as string | null) ?? null,
                    name: String(body.name || ''),
                    isHousekeeping: Boolean(body.isHousekeeping),
                    defaultDistribution: (body.defaultDistribution as 'split' | 'individual') || 'split',
                  })
                );
              case 'list_people':
                return sendJson(res, 200, await listPeopleAdmin(db, caller, String(body.propertyId || '')));
              case 'create_person':
                return sendJson(
                  res,
                  201,
                  await createPersonWorkflow({
                    db,
                    emailAdapter,
                    caller,
                    input: {
                      propertyId: String(body.propertyId || ''),
                      name: String(body.name || ''),
                      email: String(body.email || ''),
                      role: (body.role as 'staff' | 'dept_manager' | 'property_admin') || 'staff',
                      departmentId: (body.departmentId as string | null) ?? null,
                      photoPath: (body.photoPath as string | null) ?? null,
                    },
                    appOrigin: `http://${req.headers.host || 'localhost:5173'}`,
                  })
                );
              case 'update_person':
                return sendJson(
                  res,
                  200,
                  await updatePersonWorkflow(db, caller, {
                    personId: String(body.personId || ''),
                    name: (body.name as string | null) ?? null,
                    email: (body.email as string | null) ?? null,
                    role: (body.role as 'staff' | 'dept_manager' | null) ?? null,
                    departmentId: (body.departmentId as string | null) ?? null,
                    status: (body.status as 'active' | 'inactive' | null) ?? null,
                    photoPath: (body.photoPath as string | null) ?? null,
                  })
                );
              default:
                return sendJson(res, 400, { error: { code: 'UNKNOWN_ACTION', message: 'Unknown action' } });
            }
          }

          if (url === '/api/dev/admin-rooms' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const propertyId = String(body.propertyId || '');
            switch (body.action) {
              case 'list_rooms':
                return sendJson(res, 200, await listRoomsAdmin(db, caller, propertyId));
              case 'add_rooms':
                return sendJson(
                  res,
                  200,
                  await addRoomsAdmin(db, caller, propertyId, {
                    roomNumber: (body.roomNumber as string | null) ?? null,
                    rangeFrom: body.rangeFrom == null ? null : Number(body.rangeFrom),
                    rangeTo: body.rangeTo == null ? null : Number(body.rangeTo),
                    prefix: (body.prefix as string | null) ?? null,
                  })
                );
              case 'delete_room':
                return sendJson(
                  res,
                  200,
                  await deleteRoomAdmin(db, caller, propertyId, String(body.roomId || ''))
                );
              case 'upload_backdrop':
                return sendJson(
                  res,
                  200,
                  await uploadPropertyBackdropWorkflow(db, caller, {
                    propertyId,
                    dataBase64: String(body.dataBase64 || ''),
                  })
                );
              default:
                return sendJson(res, 400, {
                  error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' },
                });
            }
          }

          if (url === '/api/dev/generate-qr-cards' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const origin =
              (req.headers.origin as string | undefined) ||
              `http://${req.headers.host ?? 'localhost:5173'}`;
            return sendJson(
              res,
              200,
              await generateQrCardsWorkflow({
                db,
                caller,
                propertyId: String(body.propertyId || ''),
                kind: String(body.kind || '') as QrKind,
                ids: Array.isArray(body.ids) ? (body.ids as string[]) : null,
                appOrigin: origin,
              })
            );
          }

          if (url === '/api/dev/admin-assignments' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const propertyId = String(body.propertyId || '');
            const date = String(body.date || '');
            if (body.action === 'context') {
              return sendJson(res, 200, await getAssignmentContext(db, caller, propertyId, date));
            }
            if (body.action === 'save') {
              return sendJson(
                res,
                200,
                await saveAssignmentsWorkflow(db, caller, {
                  propertyId,
                  date,
                  source: String(body.source || '') as AssignmentSource,
                  items: Array.isArray(body.items)
                    ? (body.items as Array<{ roomNumber: string; personId: string }>)
                    : [],
                })
              );
            }
            return sendJson(res, 400, { error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' } });
          }

          if (url === '/api/dev/parse-assignment-sheet' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await parseAssignmentSheetWorkflow({
                db,
                ocr: createOcrAdapter(config),
                caller,
                propertyId: String(body.propertyId || ''),
                date: String(body.date || ''),
                source: body.source === 'photo' ? 'photo' : 'pdf',
                dataBase64: String(body.dataBase64 || ''),
              })
            );
          }

          if (url === '/api/dev/staff-portal' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (body.action === 'mark_read') {
              return sendJson(
                res,
                200,
                await markStaffNotificationsReadWorkflow(
                  db,
                  caller,
                  Array.isArray(body.ids) ? (body.ids as string[]) : null
                )
              );
            }
            const origin =
              (req.headers.origin as string | undefined) ||
              `http://${req.headers.host ?? 'localhost:5173'}`;
            return sendJson(res, 200, await getStaffPortalWorkflow(db, caller, origin));
          }

          if (url === '/api/dev/admin-tips' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await getAdminTipsOverviewWorkflow(db, caller, {
                propertyId: String(body.propertyId || ''),
                fromDate: (body.fromDate as string | null) ?? null,
                toDate: (body.toDate as string | null) ?? null,
                departmentId: (body.departmentId as string | null) ?? null,
                personId: (body.personId as string | null) ?? null,
              })
            );
          }

          if (url === '/api/dev/distribute-pool' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await distributePoolWorkflow(db, caller, {
                propertyId: String(body.propertyId || ''),
                departmentId: String(body.departmentId || ''),
                method: body.method === 'individual' ? 'individual' : 'split',
                allocations: Array.isArray(body.allocations)
                  ? (body.allocations as Array<{ personId: string; amountCents: number }>)
                  : null,
              })
            );
          }

          if (url === '/api/dev/export-tips' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await exportTipsWorkflow(db, caller, {
                propertyId: String(body.propertyId || ''),
                format: body.format === 'pdf' ? 'pdf' : 'csv',
                fromDate: (body.fromDate as string | null) ?? null,
                toDate: (body.toDate as string | null) ?? null,
                departmentId: (body.departmentId as string | null) ?? null,
                personId: (body.personId as string | null) ?? null,
              })
            );
          }

          if (url === '/api/dev/create-connect-onboarding-link' && req.method === 'POST') {
            const origin =
              (req.headers.origin as string | undefined) ||
              `http://${req.headers.host ?? 'localhost:5173'}`;
            return sendJson(
              res,
              200,
              await createConnectOnboardingLinkWorkflow({
                db,
                paymentAdapter,
                caller,
                appOrigin: origin,
              })
            );
          }

          if (url === '/api/dev/request-withdrawal' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await requestWithdrawalWorkflow({
                db,
                paymentAdapter,
                config,
                caller,
                amountCents: Number(body.amountCents || 0),
                method: body.method === 'instant' ? 'instant' : 'standard',
                otpCode: String(body.otpCode || ''),
              })
            );
          }

          if (url === '/api/dev/refund-tip' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await refundTipWorkflow({
                db,
                paymentAdapter,
                caller,
                tipId: String(body.tipId || ''),
              })
            );
          }

          if (url === '/api/dev/super-integrations' && req.method === 'POST') {
            const body = await readJsonBody(req);
            switch (body.action) {
              case 'get':
                return sendJson(res, 200, await getSuperIntegrationsWorkflow(db, caller, String(body.propertyId || '')));
              case 'create_key':
                return sendJson(
                  res,
                  201,
                  await createPropertyApiKeyWorkflow(db, caller, {
                    propertyId: String(body.propertyId || ''),
                    label: String(body.label || 'Integration Key'),
                    scopes: Array.isArray(body.scopes) ? (body.scopes as ApiKeyScope[]) : [],
                  })
                );
              case 'revoke_key':
                return sendJson(res, 200, await revokePropertyApiKeyWorkflow(db, caller, String(body.keyId || '')));
              case 'upsert_sso':
                return sendJson(
                  res,
                  200,
                  await upsertSsoProviderWorkflow(db, caller, {
                    propertyId: String(body.propertyId || ''),
                    clientId: String(body.clientId || ''),
                    authMode: body.authMode === 'partner_asymmetric' ? 'partner_asymmetric' : 'server_minted',
                    clientSecret: (body.clientSecret as string | null) ?? null,
                    publicKeyPem: (body.publicKeyPem as string | null) ?? null,
                    jwksUrl: (body.jwksUrl as string | null) ?? null,
                    allowedOrigins: Array.isArray(body.allowedOrigins) ? (body.allowedOrigins as string[]) : [],
                    enabled: Boolean(body.enabled),
                  })
                );
              default:
                return sendJson(res, 400, { error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' } });
            }
          }

          if (url === '/api/dev/sso-token' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (body.action === 'exchange') {
              try {
                return sendJson(res, 200, await exchangeSsoTokenWorkflow({ db, config, token: String(body.token || '') }));
              } catch (err) {
                return sendJson(res, 401, {
                  error: { code: 'SSO_ERROR', message: err instanceof Error ? err.message : 'Invalid SSO token' },
                });
              }
            }
            const origin =
              (req.headers.origin as string | undefined) ||
              `http://${req.headers.host ?? 'localhost:5173'}`;
            return sendJson(
              res,
              200,
              await mintServerSsoTokenWorkflow({
                db,
                config,
                clientId: String(body.clientId || ''),
                clientSecret: String(body.clientSecret || ''),
                email: String(body.email || ''),
                appOrigin: origin,
              })
            );
          }

          if (url.startsWith('/api/dev/api-gateway')) {
            const subPath = url.slice('/api/dev/api-gateway'.length) || '/';
            const queryObj = Object.fromEntries(new URLSearchParams(req.url?.split('?')[1] ?? '').entries());
            const authHdr = String(req.headers.authorization || '');
            const key =
              (req.headers['x-api-key'] as string | undefined) ??
              (authHdr.startsWith('Bearer ') ? authHdr.slice(7).trim() : null);
            const body = req.method === 'POST' ? await readJsonBody(req) : {};
            const result = await handleApiGatewayRequest({
              db,
              apiKey: key ?? null,
              method: req.method || 'GET',
              path: subPath,
              query: queryObj,
              body,
            });
            return sendJson(res, result.status, result.body);
          }

          if (url === '/api/dev/delete-department' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await deleteDepartmentWithReassign(
                db,
                caller,
                String(body.departmentId || ''),
                (body.reassignToDepartmentId as string | null) ?? null
              )
            );
          }

          if (url === '/api/dev/send-otp' && req.method === 'POST') {
            const body = await readJsonBody(req);
            return sendJson(
              res,
              200,
              await sendOtpWorkflow({
                db,
                emailAdapter,
                config,
                email: String(body.email || ''),
                purpose: body.purpose as OtpPurpose,
                clientIp: '127.0.0.1',
              })
            );
          }

          if (url === '/api/dev/verify-otp' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await verifyOtpWorkflow({
              db,
              config,
              email: String(body.email || ''),
              purpose: body.purpose as OtpPurpose,
              code: String(body.code || ''),
              trustDevice: Boolean(body.trustDevice),
              authUserId: body.authUserId ? String(body.authUserId) : callerUid,
              userAgent: String(req.headers['user-agent'] || 'vite-dev'),
              clientIp: '127.0.0.1',
            });
            if (result.verified && result.deviceToken) {
              res.setHeader(
                'Set-Cookie',
                `fdp_td=${result.deviceToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
              );
            }
            return sendJson(res, result.verified ? 200 : 422, {
              verified: result.verified,
              reason: result.reason,
            });
          }

          if (url === '/api/dev/login-context' && req.method === 'POST') {
            const cookies = parseCookies(req.headers.cookie);
            const trusted = await checkTrustedDeviceWorkflow(db, callerUid, cookies.fdp_td ?? null);
            const ctx = await getLoginAccountContext(db, caller);
            return sendJson(res, 200, { ...ctx, trustedDevice: trusted });
          }

          if (url === '/api/dev/join-by-qr') {
            if (req.method === 'GET') {
              const query = new URLSearchParams(req.url?.split('?')[1] ?? '');
              const propertyId = query.get('propertyId') || '';
              const list = await listJoinableStaffWorkflow(db, propertyId);
              return sendJson(res, list.ok ? 200 : list.code === 'FEATURE_DISABLED' ? 403 : 404, list);
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              if (body.action === 'send_otp') {
                return sendJson(
                  res,
                  200,
                  await sendJoinQrOtpWorkflow({
                    db,
                    emailAdapter,
                    config,
                    propertyId: String(body.propertyId || ''),
                    personId: String(body.personId || ''),
                    clientIp: '127.0.0.1',
                  })
                );
              }
              if (body.action === 'complete') {
                return sendJson(
                  res,
                  200,
                  await completeJoinQrWorkflow({
                    db,
                    emailAdapter,
                    config,
                    propertyId: String(body.propertyId || ''),
                    personId: String(body.personId || ''),
                    code: String(body.code || ''),
                    password: String(body.password || ''),
                    typedName: String(body.typedName || ''),
                    checkboxConfirmed: Boolean(body.checkboxConfirmed),
                    clientIp: '127.0.0.1',
                    userAgent: String(req.headers['user-agent'] || 'vite-dev'),
                  })
                );
              }
            }
          }

          return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `Unknown route ${url}` } });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unexpected dev API error';
          const status = message.includes('RATE_LIMITED')
            ? 429
            : message.includes('ALREADY_ONBOARDED')
              ? 409
              : message.includes('REQUIRED') || message.includes('FORBIDDEN') || message.includes('42501')
                ? 403
                : message.includes('NOT_FOUND')
                  ? 404
                  : 422;
          return sendJson(res, status, { error: { code: 'DEV_API_ERROR', message } });
        }
      });
    },
  };
}
