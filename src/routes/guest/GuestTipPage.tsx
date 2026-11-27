import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  ChevronDown,
  HeartHandshake,
  Lock,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  callCreateTipCheckout,
  callMockCompleteTip,
  callResolveRoomView,
  type PublicDepartmentSummary,
  type PublicStaffSummary,
  type ResolvedTipTargetView,
  type TipTargetType,
} from '../../lib/apiClient';
import { MOTION } from '../../ui/motionTokens';

type SelectedRecipient =
  | {
      recipientType: 'person';
      person: PublicStaffSummary;
      departmentId: string;
      departmentName: string;
      isAssignedRoomHousekeeper: boolean;
    }
  | {
      recipientType: 'department_pool';
      departmentId: string;
      departmentName: string;
    };

function formatDollars(cents: number, stripZeroCents = false): string {
  const val = (cents / 100).toFixed(2);
  if (stripZeroCents && val.endsWith('.00')) {
    return `$${val.slice(0, -3)}`;
  }
  return `$${val}`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function StaffAvatar({ person, size = 'md' }: { person: PublicStaffSummary; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-9 h-9 text-xs' : 'w-14 h-14 text-base';
  if (person.photoUrl) {
    return (
      <img
        src={person.photoUrl}
        alt={person.displayName}
        className={`${dim} rounded-full object-cover border border-[#FAF6F0]/40 shrink-0`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`${dim} rounded-full bg-[#E6C79C]/25 border border-[#E6C79C]/50 text-[#FAF6F0] font-semibold flex items-center justify-center shrink-0`}
    >
      {initialsOf(person.displayName)}
    </div>
  );
}

export function GuestTipPage({ sourceType }: { sourceType: TipTargetType }) {
  const params = useParams();
  const sourceId =
    sourceType === 'room'
      ? params.roomId ?? ''
      : sourceType === 'dept'
        ? params.departmentId ?? ''
        : params.personId ?? '';

  const [data, setData] = useState<ResolvedTipTargetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedRecipient | null>(null);
  const [openDeptId, setOpenDeptId] = useState<string | null>(null);

  const [amountCents, setAmountCents] = useState<number>(1000);
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [note, setNote] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedTip, setConfirmedTip] = useState<{
    amountCents: number;
    chargeCents: number;
    recipientName: string;
    propertyName: string;
  } | null>(null);

  const applyDefaultSelection = useCallback(
    (resolved: ResolvedTipTargetView) => {
      if (!resolved.ok) {
        setSelected(null);
        return;
      }
      const presets = resolved.tipBounds?.presetsCents ?? [300, 500, 1000, 2000];
      const min = resolved.tipBounds?.minCents ?? 100;
      const defaultPreset = presets.includes(1000) ? 1000 : presets[0] ?? min;
      setAmountCents(Math.max(min, defaultPreset));
      setCustomMode(false);
      setCustomInput('');

      if (resolved.mode === 'person' && resolved.targetPerson) {
        setSelected({
          recipientType: 'person',
          person: resolved.targetPerson,
          departmentId: resolved.targetPerson.departmentId ?? '',
          departmentName: resolved.targetPerson.departmentName ?? 'Hospitality',
          isAssignedRoomHousekeeper: false,
        });
        return;
      }

      if (resolved.mode === 'person_fallback_pool' && resolved.fallbackPool) {
        setSelected({
          recipientType: 'department_pool',
          departmentId: resolved.fallbackPool.departmentId,
          departmentName: resolved.fallbackPool.departmentName,
        });
        return;
      }

      const depts = resolved.departments ?? [];
      if (resolved.assignedHousekeeper) {
        const dept = depts.find((d) => d.departmentId === resolved.assignedHousekeeper?.departmentId);
        setSelected({
          recipientType: 'person',
          person: resolved.assignedHousekeeper,
          departmentId: resolved.assignedHousekeeper.departmentId ?? dept?.departmentId ?? '',
          departmentName: dept?.name ?? 'Housekeeping',
          isAssignedRoomHousekeeper: true,
        });
        setOpenDeptId(null);
        return;
      }

      const firstDept = depts[0];
      if (firstDept) {
        setOpenDeptId(firstDept.departmentId);
        if (firstDept.poolEnabled) {
          setSelected({
            recipientType: 'department_pool',
            departmentId: firstDept.departmentId,
            departmentName: firstDept.name,
          });
        } else if (firstDept.staff[0]) {
          setSelected({
            recipientType: 'person',
            person: firstDept.staff[0],
            departmentId: firstDept.departmentId,
            departmentName: firstDept.name,
            isAssignedRoomHousekeeper: false,
          });
        }
      }
    },
    []
  );

  const loadTarget = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callResolveRoomView(sourceType, sourceId);
      setData(res);
      applyDefaultSelection(res);
    } catch {
      setData({ ok: false, code: 'TARGET_NOT_FOUND' });
    } finally {
      setLoading(false);
    }
  }, [sourceType, sourceId, applyDefaultSelection]);

  useEffect(() => {
    setConfirmedTip(null);
    setNotice(null);
    void loadTarget();
  }, [loadTarget]);

  const minCents = data?.tipBounds?.minCents ?? 100;
  const maxCents = data?.tipBounds?.maxCents ?? 20000;
  const presetsCents = useMemo(
    () => data?.tipBounds?.presetsCents ?? [300, 500, 1000, 2000],
    [data]
  );

  const guestPaysFee =
    data?.guestFeePolicy === 'guest' && data?.enabledToggles?.guest_paid_fee_option !== false;
  const estimatedFeeCents = Math.round(amountCents * 0.029) + 30;
  const guestFeeCents = guestPaysFee ? estimatedFeeCents : 0;
  const totalChargeCents = amountCents + guestFeeCents;

  function selectCustomValue(raw: string) {
    setCustomInput(raw);
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      setAmountCents(Math.round(parsed * 100));
    } else {
      setAmountCents(0);
    }
  }

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.ok || !selected) return;
    if (amountCents < minCents || amountCents > maxCents) {
      setError(
        `Please enter a tip between ${formatDollars(minCents)} and ${formatDollars(maxCents)}.`
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const checkout = await callCreateTipCheckout({
        sourceType,
        sourceId,
        recipientType: selected.recipientType,
        personId: selected.recipientType === 'person' ? selected.person.personId : null,
        departmentId: selected.departmentId,
        amountCents,
        note: data.enabledToggles?.guest_notes !== false ? note : null,
        guestEmail: data.enabledToggles?.email_receipts !== false ? guestEmail : null,
        expectedPersonId:
          selected.recipientType === 'person' && selected.isAssignedRoomHousekeeper
            ? selected.person.personId
            : null,
      });

      if (checkout.paymentMode === 'mock') {
        await callMockCompleteTip(checkout.paymentIntentId);
        setConfirmedTip({
          amountCents: checkout.amountCents,
          chargeCents: checkout.chargeCents,
          recipientName: checkout.recipientName,
          propertyName: checkout.propertyName,
        });
      } else {
        setError(
          'Stripe Payment Element checkout requires a live/test Stripe webhook callback. Configure VITE_STRIPE_PUBLISHABLE_KEY for browser card entry.'
        );
      }
    } catch (err) {
      const apiErr = err as Error & { code?: string };
      if (apiErr.code === 'ASSIGNMENT_CHANGED') {
        setNotice(
          'Today’s room assignment was just updated by the hotel. We refreshed the recipient below so your tip reaches the right team member.'
        );
        await loadTarget();
      } else {
        setError(apiErr.message || 'Could not process tip. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const backdropUrl = data?.heroBackdropUrl || '/assets/resort-backdrop.jpg';

  // Friendly error / unavailable states (L183 / L187)
  if (!loading && (!data || !data.ok)) {
    const isRestricted = data?.code === 'PROPERTY_RESTRICTED';
    const message = isRestricted
      ? 'Tipping is temporarily unavailable for this property.'
      : "We couldn't find this tipping link. Please ask the front desk for an updated QR code.";
    return (
      <main
        className="resort-photo-backdrop min-h-screen relative flex items-center justify-center p-4"
        style={{ backgroundImage: `url('${backdropUrl}')` }}
      >
        <div className="resort-scrim-guest absolute inset-0" aria-hidden="true" />
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: MOTION.easeOutEnter }}
          className="relative z-10 w-full max-w-md glass-card-heavy rounded-2xl p-6 text-[#FAF6F0] space-y-3 text-center"
        >
          <HeartHandshake className="w-8 h-8 text-[#E6C79C] mx-auto" />
          <h1 className="serif-display text-2xl font-semibold">
            {data?.propertyName || 'FrontDesk Tip'}
          </h1>
          <p className="text-sm text-[#F5EBE0]/90">{message}</p>
        </motion.section>
      </main>
    );
  }

  // Greeting copy per OI-6
  let headline = 'A warm thank-you';
  let subline = '100% of your gratitude goes to the hospitality team';
  if (data?.ok && selected) {
    if (selected.recipientType === 'person') {
      headline = `A warm thank-you for ${selected.person.displayName}`;
      subline =
        data.room && selected.isAssignedRoomHousekeeper
          ? `Caring for Room ${data.room.roomNumber} today · 100% goes to ${selected.person.displayName}`
          : `${selected.departmentName} · 100% goes to ${selected.person.displayName}`;
    } else {
      headline = `Thank our ${selected.departmentName} Team`;
      subline = data.room
        ? `Room ${data.room.roomNumber} · Shared equally across today’s team`
        : 'Shared equally across today’s team';
    }
  }

  const depts: PublicDepartmentSummary[] = data?.departments ?? [];

  return (
    <main
      className="resort-photo-backdrop min-h-screen relative flex items-center justify-center px-4 py-8"
      style={{ backgroundImage: `url('${backdropUrl}')` }}
    >
      <div className="resort-scrim-guest fixed inset-0 pointer-events-none" aria-hidden="true" />

      <section className="relative z-10 w-full max-w-md space-y-4 text-[#FAF6F0]">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: MOTION.easeOutEnter }}
          className="glass-text-shadow space-y-1.5"
        >
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#E6C79C] font-semibold">
            {data?.propertyName || 'Loading…'}
            {data?.room ? ` · Room ${data.room.roomNumber}` : ''}
          </p>
          <h1 className="serif-display text-3xl font-semibold leading-tight">{headline}</h1>
          <p className="text-sm text-[#F5EBE0]/90">{subline}</p>
        </motion.header>

        {loading && (
          <div className="glass-card-heavy rounded-2xl p-6 text-sm text-[#F5EBE0]/80">
            Preparing your hospitality tipping card…
          </div>
        )}

        <AnimatePresence mode="wait">
          {confirmedTip ? (
            <motion.div
              key="thank-you"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: MOTION.easeOutEnter }}
              className="glass-card-heavy rounded-2xl p-6 space-y-4 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-[#E6C79C]/20 border border-[#E6C79C]/60 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-[#E6C79C]" />
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-[#E6C79C] font-semibold">
                  Sent with thanks
                </p>
                <h2 className="serif-display text-2xl font-semibold tabular-nums">
                  Thank you — {formatDollars(confirmedTip.amountCents)} sent
                </h2>
                <p className="text-sm text-[#F5EBE0]/90">
                  Delivered to <strong>{confirmedTip.recipientName}</strong> at{' '}
                  {confirmedTip.propertyName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmedTip(null);
                  setNote('');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#FAF6F0]/15 hover:bg-[#FAF6F0]/25 px-4 py-2 text-xs font-medium text-[#FAF6F0] transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#E6C79C]" /> Send another thank-you
              </button>
            </motion.div>
          ) : (
            !loading &&
            data?.ok && (
              <motion.div
                key="checkout-flow"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: MOTION.easeOutEnter }}
                className="space-y-3"
              >
                {notice && (
                  <div
                    role="status"
                    className="glass-toast rounded-xl px-4 py-3 text-xs text-[#FDE68A]"
                  >
                    {notice}
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#FCA5A5]/40 bg-[#450A0A]/80 px-4 py-3 text-xs text-[#FECACA]"
                  >
                    {error}
                  </div>
                )}

                {/* AC-1: Assigned Housekeeper Spotlight Card (non-nested glass-surface) */}
                {data.assignedHousekeeper && (
                  <button
                    type="button"
                    onClick={() => {
                      const dept = depts.find(
                        (d) => d.departmentId === data.assignedHousekeeper?.departmentId
                      );
                      setSelected({
                        recipientType: 'person',
                        person: data.assignedHousekeeper!,
                        departmentId:
                          data.assignedHousekeeper!.departmentId ?? dept?.departmentId ?? '',
                        departmentName: dept?.name ?? 'Housekeeping',
                        isAssignedRoomHousekeeper: true,
                      });
                    }}
                    className={`w-full text-left glass-surface rounded-2xl p-4 flex items-center gap-3.5 transition ${
                      selected?.recipientType === 'person' && selected.isAssignedRoomHousekeeper
                        ? 'ring-2 ring-[#E6C79C]'
                        : 'opacity-85 hover:opacity-100'
                    }`}
                  >
                    <StaffAvatar person={data.assignedHousekeeper} />
                    <div className="min-w-0 flex-1">
                      <span className="inline-block text-[10px] uppercase tracking-[0.14em] text-[#E6C79C] font-semibold">
                        Today&apos;s Room {data.room?.roomNumber} Housekeeper
                      </span>
                      <div className="text-base font-semibold truncate">
                        {data.assignedHousekeeper.displayName}
                      </div>
                      <div className="text-xs text-[#F5EBE0]/80">
                        Direct 100% personal gratitude
                      </div>
                    </div>
                  </button>
                )}

                {/* AC-2: Department Accordion (Room or Dept mode) */}
                {depts.length > 0 && (
                  <div className="space-y-2">
                    {data.assignedHousekeeper && (
                      <p className="text-xs text-[#F5EBE0]/80 pt-1">
                        Or thank another department or team member:
                      </p>
                    )}
                    {depts.map((dept) => {
                      const isOpen = openDeptId === dept.departmentId;
                      return (
                        <div key={dept.departmentId} className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenDeptId(isOpen ? null : dept.departmentId)}
                            className="w-full glass-surface rounded-xl px-4 py-3 flex items-center justify-between text-left"
                          >
                            <span className="text-sm font-medium">{dept.name}</span>
                            <ChevronDown
                              className={`w-4 h-4 text-[#E6C79C] transition-transform ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.22 }}
                                className="overflow-hidden pl-2 space-y-1.5"
                              >
                                {dept.poolEnabled && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelected({
                                        recipientType: 'department_pool',
                                        departmentId: dept.departmentId,
                                        departmentName: dept.name,
                                      })
                                    }
                                    className={`w-full glass-surface rounded-xl px-3.5 py-2.5 flex items-center gap-3 text-left ${
                                      selected?.recipientType === 'department_pool' &&
                                      selected.departmentId === dept.departmentId
                                        ? 'ring-2 ring-[#E6C79C]'
                                        : ''
                                    }`}
                                  >
                                    <div className="w-9 h-9 rounded-full bg-[#E6C79C]/20 flex items-center justify-center shrink-0">
                                      <Users className="w-4 h-4 text-[#E6C79C]" />
                                    </div>
                                    <div>
                                      <div className="text-xs font-semibold">
                                        Whole {dept.name} Pool
                                      </div>
                                      <div className="text-[11px] text-[#F5EBE0]/75">
                                        Shared equally across today&apos;s team
                                      </div>
                                    </div>
                                  </button>
                                )}

                                {dept.staff.map((member) => {
                                  const isSelected =
                                    selected?.recipientType === 'person' &&
                                    selected.person.personId === member.personId;
                                  return (
                                    <button
                                      key={member.personId}
                                      type="button"
                                      onClick={() =>
                                        setSelected({
                                          recipientType: 'person',
                                          person: member,
                                          departmentId: dept.departmentId,
                                          departmentName: dept.name,
                                          isAssignedRoomHousekeeper:
                                            data.assignedHousekeeper?.personId === member.personId,
                                        })
                                      }
                                      className={`w-full glass-surface rounded-xl px-3.5 py-2.5 flex items-center gap-3 text-left ${
                                        isSelected ? 'ring-2 ring-[#E6C79C]' : ''
                                      }`}
                                    >
                                      <StaffAvatar person={member} size="sm" />
                                      <div className="text-xs font-semibold">
                                        {member.displayName}
                                      </div>
                                    </button>
                                  );
                                })}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Main Glass Checkout Card (no nested glass inside!) */}
                <form
                  onSubmit={handleCheckout}
                  className="glass-card-heavy rounded-2xl p-5 space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#F5EBE0]/80 mb-2">
                      <span>Select amount</span>
                      <span className="tabular-nums">
                        {formatDollars(minCents, true)} – {formatDollars(maxCents, true)}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {presetsCents.map((preset) => {
                        const active = !customMode && amountCents === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setCustomMode(false);
                              setAmountCents(preset);
                            }}
                            className={`relative rounded-xl py-2.5 text-sm font-semibold tabular-nums transition ${
                              active
                                ? 'text-[#1C110A]'
                                : 'bg-[#FAF6F0]/10 text-[#FAF6F0] hover:bg-[#FAF6F0]/20'
                            }`}
                          >
                            {active && (
                              <motion.span
                                layoutId="tip-amount-pill"
                                transition={MOTION.springLayout}
                                className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#F5E1C3] to-[#D9B17A]"
                              />
                            )}
                            <span className="relative z-10">{formatDollars(preset, true)}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setCustomMode(true);
                          setCustomInput(amountCents > 0 ? String(amountCents / 100) : '');
                        }}
                        className={`relative rounded-xl py-2.5 text-xs font-semibold transition ${
                          customMode
                            ? 'text-[#1C110A]'
                            : 'bg-[#FAF6F0]/10 text-[#FAF6F0] hover:bg-[#FAF6F0]/20'
                        }`}
                      >
                        {customMode && (
                          <motion.span
                            layoutId="tip-amount-pill"
                            transition={MOTION.springLayout}
                            className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#F5E1C3] to-[#D9B17A]"
                          />
                        )}
                        <span className="relative z-10">Custom</span>
                      </button>
                    </div>

                    {customMode && (
                      <div className="mt-2.5">
                        <label className="block text-xs text-[#F5EBE0]/80">
                          Custom amount (USD)
                          <input
                            type="number"
                            step="0.01"
                            min={(minCents / 100).toFixed(2)}
                            max={(maxCents / 100).toFixed(2)}
                            value={customInput}
                            onChange={(e) => selectCustomValue(e.target.value)}
                            placeholder="15.00"
                            className="mt-1 w-full rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/50 px-3 py-2 text-sm text-[#FAF6F0] tabular-nums"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {data.enabledToggles?.guest_notes !== false && (
                    <label className="block text-xs text-[#F5EBE0]/80">
                      Add a thank-you note (optional)
                      <textarea
                        rows={2}
                        maxLength={150}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Thank you for making our stay so comfortable!"
                        className="mt-1 w-full rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/50 px-3 py-2 text-xs text-[#FAF6F0] placeholder:text-[#F5EBE0]/45"
                      />
                    </label>
                  )}

                  {data.enabledToggles?.email_receipts !== false && (
                    <label className="block text-xs text-[#F5EBE0]/80">
                      Email receipt (optional)
                      <input
                        type="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        placeholder="guest@example.com"
                        className="mt-1 w-full rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/50 px-3 py-2 text-xs text-[#FAF6F0] placeholder:text-[#F5EBE0]/45"
                      />
                    </label>
                  )}

                  {guestPaysFee && amountCents > 0 && (
                    <div className="flex items-center justify-between text-xs text-[#F5EBE0]/85 border-t border-[#FAF6F0]/15 pt-3 tabular-nums">
                      <span>Include processing fee (+{formatDollars(guestFeeCents)})</span>
                      <span className="font-semibold text-[#FAF6F0]">
                        Total {formatDollars(totalChargeCents)}
                      </span>
                    </div>
                  )}

                  <motion.button
                    type="submit"
                    whileTap={{ scale: MOTION.tapScale }}
                    disabled={submitting || !selected || amountCents < minCents}
                    className="w-full rounded-xl bg-gradient-to-r from-[#F5E1C3] via-[#E6C79C] to-[#D4A86A] py-3.5 text-sm font-bold text-[#1C110A] shadow-lg disabled:opacity-50 tabular-nums"
                  >
                    {submitting
                      ? 'Sending…'
                      : `Send ${formatDollars(totalChargeCents, totalChargeCents % 100 === 0)} Thank-You`}
                  </motion.button>

                  <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#F5EBE0]/70 text-center">
                    <Lock className="w-3 h-3 text-[#E6C79C]" />
                    Secured by Stripe · Non-refundable after 24 hours
                  </p>
                </form>
              </motion.div>
            )
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
