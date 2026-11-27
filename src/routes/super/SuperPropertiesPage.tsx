import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { SuperAdminLayout } from '../../components/SuperAdminLayout';
import { AgreementSigningCard } from '../../components/AgreementSigningCard';
import { QrTemplatePlacer, type QrPosition } from './QrTemplatePlacer';
import { callSuperAdmin } from '../../lib/apiClient';
import { FEATURE_CATALOG, type FeatureKey } from '../../shared/features';
import { formatCents } from '../../shared/types';
import { MOTION } from '../../ui/motionTokens';

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  status: 'pending' | 'active' | 'restricted' | 'cancelled';
  planType: 'monthly' | 'yearly';
  planPriceCents: number;
  agreementSigned: boolean;
  paymentFeePaidBy: string;
  payoutFeePaidBy: string;
}

interface PropertyDetailPayload {
  property: Record<string, unknown>;
  features: Array<{ featureKey: FeatureKey; enabled: boolean }>;
  departments: Array<{ id: string; name: string; isHousekeeping: boolean; defaultDistribution: string }>;
  agreements: Array<{
    id: string;
    signerType: string;
    version: string;
    typedName: string;
    signedAt: string;
    ipAddress: string;
    pdfStoragePath: string;
  }>;
  admins: Array<{ id: string; name: string; email: string; status: string }>;
}

const WIZARD_STEPS = [
  'Basics & Admin',
  'Plan & Price',
  'Contract Terms',
  'Fee Policy',
  'Payout & TZ',
  'QR & Resort Photo',
  'Departments',
] as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
];

export function SuperPropertiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 7-Step Wizard State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardBusy, setWizardBusy] = useState(false);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [planType, setPlanType] = useState<'monthly' | 'yearly'>('monthly');
  const [planPriceDollars, setPlanPriceDollars] = useState('199');
  const [contractTermMonths, setContractTermMonths] = useState('12');
  const [noticeDays, setNoticeDays] = useState('30');
  const [paymentFeePaidBy, setPaymentFeePaidBy] = useState<'property' | 'guest' | 'staff'>('guest');
  const [payoutFeePaidBy, setPayoutFeePaidBy] = useState<'property' | 'staff'>('property');
  const [payoutWeekday, setPayoutWeekday] = useState('4');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [minWithdrawalDollars, setMinWithdrawalDollars] = useState('10');
  const [templatePath, setTemplatePath] = useState('');
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const [heroPhotoPath, setHeroPhotoPath] = useState('');
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [qrPosition, setQrPosition] = useState<QrPosition>({ x: 0.35, y: 0.44, size: 0.3 });
  const [defaultFeaturesEnabled, setDefaultFeaturesEnabled] = useState(true);
  const [depts, setDepts] = useState<
    Array<{ name: string; isHousekeeping: boolean; defaultDistribution: 'split' | 'individual' }>
  >([
    { name: 'Housekeeping', isHousekeeping: true, defaultDistribution: 'split' },
    { name: 'Front Desk', isHousekeeping: false, defaultDistribution: 'split' },
  ]);

  // Property Detail Drawer State
  const selectedId = searchParams.get('id');
  const [detail, setDetail] = useState<PropertyDetailPayload | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callSuperAdmin<{ properties: PropertyRow[] }>({ action: 'dashboard' });
      setProperties(res.properties || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load properties');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (propertyId: string) => {
    try {
      const res = await callSuperAdmin<PropertyDetailPayload>({
        action: 'property_detail',
        propertyId,
      });
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load property details');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  async function handleFinishWizard() {
    setError(null);
    setWizardBusy(true);
    try {
      const res = await callSuperAdmin<{ propertyId: string }>({
        action: 'onboard_property',
        payload: {
          name,
          address,
          contactName,
          contactEmail,
          adminName: adminName || contactName,
          adminEmail: adminEmail || contactEmail,
          planType,
          planPriceCents: Math.max(0, Math.round(Number(planPriceDollars || 0) * 100)),
          contractTermMonths: Math.max(1, Number(contractTermMonths || 12)),
          noticeDays: Math.max(0, Number(noticeDays || 30)),
          paymentFeePaidBy,
          payoutFeePaidBy,
          payoutWeekday: Number(payoutWeekday),
          timezone,
          minWithdrawalCents: Math.max(100, Math.round(Number(minWithdrawalDollars || 10) * 100)),
          templatePath: templatePath || null,
          heroPhotoPath: heroPhotoPath || null,
          qrPosition,
          defaultFeaturesEnabled,
          departments: depts.filter((d) => d.name.trim().length > 0),
        },
      });
      setWizardOpen(false);
      setWizardStep(0);
      await loadList();
      setSearchParams({ id: res.propertyId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to onboard property');
    } finally {
      setWizardBusy(false);
    }
  }

  async function handleToggleFeature(featureKey: FeatureKey, nextEnabled: boolean) {
    if (!detail || !selectedId) return;
    const prev = detail.features;
    setDetail({
      ...detail,
      features: prev.map((f) => (f.featureKey === featureKey ? { ...f, enabled: nextEnabled } : f)),
    });
    try {
      await callSuperAdmin({
        action: 'set_feature_toggle',
        propertyId: selectedId,
        featureKey,
        enabled: nextEnabled,
      });
    } catch (err) {
      setDetail({ ...detail, features: prev });
      setError(err instanceof Error ? err.message : 'Failed to update toggle');
    }
  }

  async function handleStatusUpdate(nextStatus: string) {
    if (!selectedId) return;
    setError(null);
    setDetailBusy(true);
    try {
      await callSuperAdmin({
        action: 'update_property',
        propertyId: selectedId,
        patch: { status: nextStatus },
      });
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update property status');
    } finally {
      setDetailBusy(false);
    }
  }

  const featureGroups = ['Guest', 'QR', 'Assignments', 'Staff & Payouts', 'Admin & Integrations'] as const;
  const detailProp = detail?.property;
  const hasSignedPropertyAgreement = Boolean(
    detail?.agreements.some((a) => a.signerType === 'property')
  );

  return (
    <SuperAdminLayout
      title="Properties & Feature Toggles"
      actions={
        <button
          type="button"
          onClick={() => {
            setError(null);
            setWizardOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] text-white px-3.5 py-2 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Onboard Property</span>
        </button>
      }
    >
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Property Table */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
              <th className="py-3 px-4 font-medium">Property</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Fee Policy</th>
              <th className="py-3 px-4 font-medium">Plan</th>
              <th className="py-3 px-4 font-medium text-right">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {loading && (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-[#7A6859]">
                  Loading properties...
                </td>
              </tr>
            )}
            {properties.map((p) => (
              <tr key={p.id} className="hover:bg-[#F9FAFB]">
                <td className="py-3 px-4">
                  <p className="font-semibold text-[#1C110A]">{p.name}</p>
                  <p className="text-[#7A6859]">{p.address}</p>
                </td>
                <td className="py-3 px-4 capitalize font-medium">{p.status}</td>
                <td className="py-3 px-4">
                  Pay: {p.paymentFeePaidBy} · Payout: {p.payoutFeePaidBy}
                </td>
                <td className="py-3 px-4 tabular-nums">
                  {formatCents(p.planPriceCents)} / {p.planType}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => setSearchParams({ id: p.id })}
                    className="rounded-md border border-[#D8CBB8] px-3 py-1.5 font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer"
                  >
                    Configure &amp; Toggles
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 7-Step Onboarding Wizard Slide-Over Drawer */}
      <AnimatePresence>
        {wizardOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.2, ease: MOTION.easeOutEnter }}
              className="w-full max-w-3xl bg-white h-full overflow-y-auto p-6 flex flex-col justify-between gap-6"
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-[#E7DDD0] pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-[#1C110A]">
                      Onboard Hotel Property
                    </h2>
                    <p className="text-xs text-[#5C4B3E] mt-0.5">
                      Step {wizardStep + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[wizardStep]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWizardOpen(false)}
                    className="p-1.5 rounded-lg border border-[#E7DDD0] text-[#5C4B3E] hover:text-[#1C110A] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Progress Bar */}
                <div className="grid grid-cols-7 gap-1.5">
                  {WIZARD_STEPS.map((label, idx) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setWizardStep(idx)}
                      className="text-left space-y-1 cursor-pointer"
                    >
                      <div
                        className={`h-1.5 rounded-full transition-colors ${
                          idx <= wizardStep ? 'bg-[#2A1A10]' : 'bg-[#E5E7EB]'
                        }`}
                      />
                      <span className="block text-xs truncate text-[#5C4B3E]">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Step Forms */}
                {wizardStep === 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Property Name</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Solis Cove Lodge"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Property Address</span>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="100 Ocean Palms Blvd, Miami, FL"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Primary Contact Name</span>
                      <input
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Elena Navarro"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Primary Contact Email</span>
                      <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="gm@soliscove.com"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Property Admin Name</span>
                      <input
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                        placeholder="Defaults to Contact Name"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Property Admin Email</span>
                      <input
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="Defaults to Contact Email"
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                )}

                {wizardStep === 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Billing Cycle</span>
                      <select
                        value={planType}
                        onChange={(e) => setPlanType(e.target.value as 'monthly' | 'yearly')}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                      >
                        <option value="monthly">Monthly Flat Subscription</option>
                        <option value="yearly">Yearly Flat Subscription</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Subscription Price (USD)</span>
                      <input
                        type="number"
                        min="0"
                        value={planPriceDollars}
                        onChange={(e) => setPlanPriceDollars(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm tabular-nums"
                      />
                    </label>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Contract Term (Months)</span>
                      <input
                        type="number"
                        min="1"
                        value={contractTermMonths}
                        onChange={(e) => setContractTermMonths(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Cancellation Notice (Days)</span>
                      <input
                        type="number"
                        min="0"
                        value={noticeDays}
                        onChange={(e) => setNoticeDays(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm tabular-nums"
                      />
                    </label>
                    <p className="sm:col-span-2 rounded-lg bg-[#F9FAFB] border border-[#E7DDD0] p-3 text-[#5C4B3E]">
                      Property starts in <strong>pending</strong> status until the Property Service Agreement is signed by click-to-accept.
                    </p>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Guest Payment Processing Fee Paid By</span>
                      <select
                        value={paymentFeePaidBy}
                        onChange={(e) =>
                          setPaymentFeePaidBy(e.target.value as 'property' | 'guest' | 'staff')
                        }
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                      >
                        <option value="guest">Guest (added line at checkout · $1 min)</option>
                        <option value="property">Property absorbs fee ($2 min floor)</option>
                        <option value="staff">Staff wallet absorbs fee ($2 min floor)</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Standard Payout Fee Paid By</span>
                      <select
                        value={payoutFeePaidBy}
                        onChange={(e) => setPayoutFeePaidBy(e.target.value as 'property' | 'staff')}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                      >
                        <option value="property">Property absorbs standard fee</option>
                        <option value="staff">Staff wallet absorbs standard fee</option>
                      </select>
                    </label>
                    <p className="sm:col-span-2 rounded-lg bg-[#F9FAFB] border border-[#E7DDD0] p-3 text-[#5C4B3E]">
                      Default guest presets: <strong>$3 · $5 · $10 · $20 + Custom</strong> (cap $200, configurable up to $500). Instant debit payout fees are always paid by staff.
                    </p>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Weekly Payout Day</span>
                      <select
                        value={payoutWeekday}
                        onChange={(e) => setPayoutWeekday(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                      >
                        {WEEKDAYS.map((day, i) => (
                          <option key={day} value={i}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Property Timezone (IANA)</span>
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="font-medium text-[#374151]">Min Withdrawal (USD)</span>
                      <input
                        type="number"
                        min="1"
                        value={minWithdrawalDollars}
                        onChange={(e) => setMinWithdrawalDollars(e.target.value)}
                        className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm tabular-nums"
                      />
                    </label>
                  </div>
                )}

                {wizardStep === 5 && (
                  <QrTemplatePlacer
                    templatePreviewUrl={templatePreview}
                    qrPosition={qrPosition}
                    onChangePosition={setQrPosition}
                    onUploadTemplate={(fileName, dataUrl) => {
                      setTemplatePath(`templates/${fileName}`);
                      setTemplatePreview(dataUrl);
                    }}
                    heroPreviewUrl={heroPreview}
                    onUploadHero={(fileName, dataUrl) => {
                      setHeroPhotoPath(`backdrops/${fileName}`);
                      setHeroPreview(dataUrl);
                    }}
                    propertyName={name}
                  />
                )}

                {wizardStep === 6 && (
                  <div className="space-y-4 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[#374151]">Starting Departments</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDepts([...depts, { name: '', isHousekeeping: false, defaultDistribution: 'split' }])
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-[#D8CBB8] px-2.5 py-1 font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Department</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {depts.map((dept, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            value={dept.name}
                            onChange={(e) =>
                              setDepts(depts.map((d, idx) => (idx === i ? { ...d, name: e.target.value } : d)))
                            }
                            placeholder="Department name"
                            className="col-span-5 rounded-lg border border-[#D8CBB8] px-2.5 py-1.5 text-xs"
                          />
                          <select
                            value={dept.defaultDistribution}
                            onChange={(e) =>
                              setDepts(
                                depts.map((d, idx) =>
                                  idx === i
                                    ? { ...d, defaultDistribution: e.target.value as 'split' | 'individual' }
                                    : d
                                )
                              )
                            }
                            className="col-span-3 rounded-lg border border-[#D8CBB8] px-2 py-1.5 text-xs bg-white"
                          >
                            <option value="split">Split Evenly</option>
                            <option value="individual">Individual</option>
                          </select>
                          <label className="col-span-3 flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={dept.isHousekeeping}
                              onChange={(e) =>
                                setDepts(
                                  depts.map((d, idx) =>
                                    idx === i ? { ...d, isHousekeeping: e.target.checked } : d
                                  )
                                )
                              }
                            />
                            <span>Housekeeping</span>
                          </label>
                          <button
                            type="button"
                            disabled={depts.length <= 1}
                            onClick={() => setDepts(depts.filter((_, idx) => idx !== i))}
                            className="col-span-1 p-1 text-[#7A6859] hover:text-[#B91C1C] disabled:opacity-30 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <label className="flex items-center gap-2 pt-2 border-t border-[#E7DDD0] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={defaultFeaturesEnabled}
                        onChange={(e) => setDefaultFeaturesEnabled(e.target.checked)}
                      />
                      <span>Enable all 27 platform feature toggles for this property at onboarding</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Footer Controls */}
              <div className="flex items-center justify-between pt-4 border-t border-[#E7DDD0]">
                <button
                  type="button"
                  disabled={wizardStep === 0}
                  onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
                  className="rounded-lg border border-[#D8CBB8] px-4 py-2 text-xs font-medium text-[#1C110A] disabled:opacity-40 cursor-pointer"
                >
                  Back
                </button>
                {wizardStep < WIZARD_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep((s) => s + 1)}
                    className="rounded-lg bg-[#2A1A10] text-white px-4 py-2 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={wizardBusy}
                    onClick={() => void handleFinishWizard()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#047857] text-white px-4 py-2 text-xs font-medium hover:bg-[#065F46] disabled:opacity-60 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{wizardBusy ? 'Creating Property...' : 'Create Property (Pending)'}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Property Detail & 27-Toggle Matrix Slide-Over Drawer */}
      <AnimatePresence>
        {selectedId && detail && detailProp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.2, ease: MOTION.easeOutEnter }}
              className="w-full max-w-3xl bg-[#F9FAFB] h-full overflow-y-auto p-6 space-y-6"
            >
              <div className="flex items-start justify-between border-b border-[#E7DDD0] pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#1C110A]">
                    {String(detailProp.name)}
                  </h2>
                  <p className="text-xs text-[#5C4B3E]">
                    {String(detailProp.address)} · TZ: {String(detailProp.timezone)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSearchParams({})}
                  className="p-1.5 rounded-lg border border-[#D8CBB8] bg-white text-[#5C4B3E] hover:text-[#1C110A] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Lifecycle Status Controls */}
              <div className="bg-white border border-[#E7DDD0] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-[#1C110A]">Property Status</h3>
                    <p className="text-xs text-[#5C4B3E]">
                      Current: <strong className="capitalize">{String(detailProp.status)}</strong>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {(['active', 'restricted', 'cancelled'] as const).map((st) => {
                      const blockedByContract = st === 'active' && !hasSignedPropertyAgreement;
                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={detailBusy || detailProp.status === st || blockedByContract}
                          title={
                            blockedByContract
                              ? 'Property Service Agreement must be signed before activating'
                              : undefined
                          }
                          onClick={() => void handleStatusUpdate(st)}
                          className="rounded-lg border border-[#D8CBB8] px-3 py-1.5 font-medium capitalize hover:bg-[#F3F4F6] disabled:opacity-40 cursor-pointer"
                        >
                          Set {st}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {!hasSignedPropertyAgreement && (
                  <p className="text-xs text-[#B45309]">
                    Activation locked until Property Service Agreement is signed below (or by Property Admin at first login).
                  </p>
                )}
              </div>

              {/* Inline Property Agreement Signing (when unsigned) or Stored Agreements */}
              {!hasSignedPropertyAgreement && (
                <AgreementSigningCard
                  signerType="property"
                  signerId={selectedId}
                  propertyId={selectedId}
                  propertyName={String(detailProp.name)}
                  defaultTypedName={String(detailProp.contact_name || '')}
                  contractTermMonths={Number(detailProp.contract_term_months || 12)}
                  noticeDays={Number(detailProp.notice_days || 30)}
                  onSigned={() => {
                    void loadDetail(selectedId);
                    void loadList();
                  }}
                />
              )}

              <div className="bg-white border border-[#E7DDD0] rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-[#1C110A]">Signed Agreements</h3>
                {detail.agreements.length === 0 ? (
                  <p className="text-xs text-[#7A6859]">No agreements signed yet.</p>
                ) : (
                  <div className="divide-y divide-[#E5E7EB] text-xs">
                    {detail.agreements.map((ag) => (
                      <div key={ag.id} className="py-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#1C110A] capitalize">
                            {ag.signerType} Agreement (v{ag.version}) — {ag.typedName}
                          </p>
                          <p className="text-[#7A6859]">
                            Signed {new Date(ag.signedAt).toLocaleString()} · IP {ag.ipAddress}
                          </p>
                        </div>
                        {import.meta.env.DEV && (
                          <a
                            href={`/api/dev/agreement-pdf?path=${encodeURIComponent(ag.pdfStoragePath)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-[#D8CBB8] px-2.5 py-1 font-medium text-[#1C110A] hover:bg-[#F3F4F6]"
                          >
                            View PDF
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 27-Toggle Feature Matrix */}
              <div className="bg-white border border-[#E7DDD0] rounded-xl p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#1C110A]">
                    Per-Property Feature Toggles (27 Controls)
                  </h3>
                  <p className="text-xs text-[#5C4B3E]">
                    Disabling hides UI controls and rejects backend calls without deleting existing data or blocking earned wallet withdrawals (except unpaid subscription restrictions).
                  </p>
                </div>

                {featureGroups.map((group) => (
                  <div key={group} className="space-y-2">
                    <h4 className="text-xs font-semibold text-[#374151] border-b border-[#E7DDD0] pb-1">
                      {group}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {FEATURE_CATALOG.filter((item) => item.group === group).map((item) => {
                        const row = detail.features.find((f) => f.featureKey === item.key);
                        const enabled = row?.enabled ?? false;
                        return (
                          <label
                            key={item.key}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[#E7DDD0] px-3 py-2 text-xs cursor-pointer hover:bg-[#F9FAFB]"
                          >
                            <span className="text-[#1C110A]">
                              <span className="font-mono text-[#7A6859] mr-1">{item.id}</span>
                              {item.label}
                            </span>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => void handleToggleFeature(item.key, e.target.checked)}
                              className="rounded accent-[#1D4ED8] cursor-pointer"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SuperAdminLayout>
  );
}
