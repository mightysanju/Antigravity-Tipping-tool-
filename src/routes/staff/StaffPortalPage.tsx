import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  Check,
  Copy,
  Download,
  LogOut,
  QrCode,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  callCreateConnectOnboardingLink,
  callRequestWithdrawal,
  callSendOtp,
  callStaffPortal,
  type StaffPortalView,
} from '../../lib/apiClient';
import { supabase } from '../../lib/supabaseClient';
import { MOTION } from '../../ui/motionTokens';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StaffPortalPage() {
  const { user, signOut } = useAuth();
  const [data, setData] = useState<StaffPortalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'tips' | 'ledger'>('tips');
  const [notifOpen, setNotifOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [withdrawNotice, setWithdrawNotice] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [wdAmount, setWdAmount] = useState('');
  const [wdMethod, setWdMethod] = useState<'standard' | 'instant'>('standard');
  const [wdOtpSent, setWdOtpSent] = useState(false);
  const [wdOtpCode, setWdOtpCode] = useState('');
  const [wdBusy, setWdBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await callStaffPortal({ action: 'context' });
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load staff portal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime subscription when connected to Supabase
  useEffect(() => {
    if (!data?.person.id) return;
    const channel = supabase
      .channel(`staff-notifs-${data.person.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `person_id=eq.${data.person.id}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data?.person.id, load]);

  async function handleOpenNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next && data && data.unreadCount > 0) {
      try {
        await callStaffPortal({ action: 'mark_read' });
        await load();
      } catch {
        // non-blocking
      }
    }
  }

  function copyQrUrl() {
    if (!data?.personalQr?.url) return;
    void navigator.clipboard.writeText(data.personalQr.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadQrSvg() {
    if (!data?.personalQr?.svg) return;
    const blob = new Blob([data.personalQr.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personal-qr-${data.person.name.toLowerCase().replace(/\s+/g, '-')}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const backdropUrl = data?.heroBackdropUrl || '/assets/resort-backdrop.jpg';
  const isInactive = data?.person.status === 'inactive';
  const isRestricted = data?.property.status === 'restricted' || data?.property.status === 'cancelled';

  return (
    <main
      className="resort-photo-backdrop min-h-screen relative px-4 py-6"
      style={{ backgroundImage: `url('${backdropUrl}')` }}
    >
      <div className="resort-scrim-staff fixed inset-0 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 max-w-2xl mx-auto space-y-4 text-[#FAF6F0]">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 glass-text-shadow">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#E6C79C] font-semibold">
              {data?.property.name || 'Staff Portal'}
              {data?.person.departmentName ? ` · ${data.person.departmentName}` : ''}
            </p>
            <h1 className="serif-display text-2xl font-semibold">
              {data?.person.name ? `Welcome, ${data.person.name}` : 'Staff Wallet'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Refresh wallet"
              className="glass-surface rounded-xl p-2.5 text-[#FAF6F0] hover:bg-[#FAF6F0]/20"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleOpenNotifications()}
              aria-label="Notifications"
              className="relative glass-surface rounded-xl p-2.5 text-[#FAF6F0] hover:bg-[#FAF6F0]/20"
            >
              <Bell className="w-4 h-4 text-[#E6C79C]" />
              {data && data.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 rounded-full bg-[#E6C79C] text-[#1C110A] text-[10px] font-bold px-1.5 py-0.5 leading-none tabular-nums">
                  {data.unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="glass-surface rounded-xl p-2.5 text-[#FAF6F0] hover:bg-[#FAF6F0]/20"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-xl border border-[#FCA5A5]/40 bg-[#450A0A]/80 px-4 py-3 text-xs text-[#FECACA]">
            {error}
          </div>
        )}

        {isInactive && (
          <div className="glass-toast rounded-xl px-4 py-3 text-xs text-[#FDE68A]">
            Your staff profile is currently <strong>inactive (withdraw-only mode)</strong>. Your remaining wallet balance stays yours until withdrawn.
          </div>
        )}

        {/* Notifications Drawer */}
        <AnimatePresence>
          {notifOpen && data && (
            <motion.section
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: MOTION.easeOutEnter }}
              className="glass-card-heavy rounded-2xl p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Recent Notifications</h2>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  className="text-xs text-[#E6C79C]"
                >
                  Close
                </button>
              </div>
              {data.notifications.length === 0 ? (
                <p className="text-xs text-[#F5EBE0]/75">No notifications yet.</p>
              ) : (
                <ul className="space-y-2 max-h-60 overflow-y-auto">
                  {data.notifications.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-xl bg-[#FAF6F0]/10 px-3 py-2 text-xs flex items-start justify-between gap-2"
                    >
                      <span>{n.message}</span>
                      <span className="text-[10px] text-[#F5EBE0]/60 shrink-0 tabular-nums">
                        {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="glass-card-heavy rounded-2xl p-6 text-sm text-[#F5EBE0]/80">
            Loading wallet &amp; activity…
          </div>
        ) : (
          data && (
            <>
              {/* Wallet Hero Card */}
              <section className="glass-card-heavy rounded-2xl p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-[#E6C79C] font-medium">
                      <Wallet className="w-4 h-4" /> Available Wallet Balance
                    </div>
                    <div className="serif-display text-4xl font-semibold mt-1 tabular-nums">
                      {fmt(data.person.walletBalanceCents)}
                    </div>
                    <p className="text-xs text-[#F5EBE0]/80 mt-1">
                      Weekly payout day: <strong>{WEEKDAYS[data.property.payoutWeekday] ?? 'Thursday'}</strong> · Min withdrawal{' '}
                      <span className="tabular-nums">{fmt(data.property.minWithdrawalCents)}</span>
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end shrink-0">
                    {!data.person.stripeConnectAccountId && (
                      <button
                        type="button"
                        disabled={wdBusy}
                        onClick={async () => {
                          setWdBusy(true);
                          setError(null);
                          try {
                            const link = await callCreateConnectOnboardingLink();
                            setWithdrawNotice(
                              `Bank payout account linked (${link.stripeConnectAccountId}).`
                            );
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Unable to start Connect onboarding');
                          } finally {
                            setWdBusy(false);
                          }
                        }}
                        className="rounded-xl border border-[#E6C79C]/50 bg-[#FAF6F0]/10 px-3 py-2 text-xs font-semibold text-[#E6C79C] hover:bg-[#FAF6F0]/20"
                      >
                        Link Bank (Stripe Express)
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={
                        isRestricted ||
                        !data.person.stripeConnectAccountId ||
                        data.person.walletBalanceCents < data.property.minWithdrawalCents
                      }
                      onClick={() => {
                        setWithdrawOpen((v) => !v);
                        setWdAmount((data.person.walletBalanceCents / 100).toFixed(2));
                        setWithdrawNotice(null);
                      }}
                      className="rounded-xl bg-gradient-to-r from-[#F5E1C3] to-[#D4A86A] px-4 py-2.5 text-xs font-bold text-[#1C110A] disabled:opacity-45 shrink-0"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                {withdrawOpen && (
                  <div className="border-t border-[#FAF6F0]/15 pt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-[#F5EBE0]/85">
                        Amount (USD)
                        <input
                          type="number"
                          step="0.01"
                          min={(data.property.minWithdrawalCents / 100).toFixed(2)}
                          max={(data.person.walletBalanceCents / 100).toFixed(2)}
                          value={wdAmount}
                          onChange={(e) => setWdAmount(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/50 px-3 py-2 text-xs text-[#FAF6F0] tabular-nums"
                        />
                      </label>
                      <label className="text-xs text-[#F5EBE0]/85">
                        Payout Speed
                        <select
                          value={wdMethod}
                          onChange={(e) => setWdMethod(e.target.value as 'standard' | 'instant')}
                          className="mt-1 w-full rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/80 px-3 py-2 text-xs text-[#FAF6F0]"
                        >
                          <option value="standard">
                            Standard Weekly ({WEEKDAYS[data.property.payoutWeekday] ?? 'Thursday'}, Free)
                          </option>
                          {data.toggles.instant_payouts && (
                            <option value="instant">Instant Debit Payout</option>
                          )}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <button
                        type="button"
                        disabled={wdBusy || !user?.email}
                        onClick={async () => {
                          if (!user?.email) return;
                          setWdBusy(true);
                          setError(null);
                          try {
                            await callSendOtp({ email: user.email, purpose: 'withdrawal' });
                            setWdOtpSent(true);
                            setWithdrawNotice(`6-digit withdrawal code sent to ${user.email}.`);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Could not send OTP');
                          } finally {
                            setWdBusy(false);
                          }
                        }}
                        className="rounded-xl bg-[#FAF6F0]/15 hover:bg-[#FAF6F0]/25 px-3 py-2 text-xs font-medium"
                      >
                        {wdOtpSent ? 'Resend Code' : 'Send Email Code'}
                      </button>

                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit OTP"
                        value={wdOtpCode}
                        onChange={(e) => setWdOtpCode(e.target.value)}
                        className="w-32 rounded-xl border border-[#FAF6F0]/25 bg-[#1C110A]/50 px-3 py-2 text-xs text-[#FAF6F0] tabular-nums"
                      />

                      <button
                        type="button"
                        disabled={wdBusy || wdOtpCode.trim().length !== 6}
                        onClick={async () => {
                          setWdBusy(true);
                          setError(null);
                          try {
                            const cents = Math.round((Number.parseFloat(wdAmount) || 0) * 100);
                            const res = await callRequestWithdrawal({
                              amountCents: cents,
                              method: wdMethod,
                              otpCode: wdOtpCode.trim(),
                            });
                            setWithdrawOpen(false);
                            setWdOtpCode('');
                            setWdOtpSent(false);
                            setWithdrawNotice(
                              res.status === 'paid'
                                ? `Instant payout of ${fmt(res.netPayoutCents)} sent!`
                                : `Withdrawal of ${fmt(res.netPayoutCents)} queued for ${WEEKDAYS[data.property.payoutWeekday] ?? 'Thursday'}.`
                            );
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Withdrawal failed');
                          } finally {
                            setWdBusy(false);
                          }
                        }}
                        className="rounded-xl bg-gradient-to-r from-[#F5E1C3] to-[#D4A86A] px-4 py-2 text-xs font-bold text-[#1C110A] disabled:opacity-45"
                      >
                        Confirm Withdrawal
                      </button>
                    </div>
                  </div>
                )}

                {isRestricted && (
                  <p className="text-xs text-[#FCA5A5]">
                    Withdrawals are temporarily paused while this property&apos;s billing is restricted.
                  </p>
                )}
                {withdrawNotice && (
                  <p className="rounded-xl bg-[#FAF6F0]/10 px-3 py-2 text-xs text-[#E6C79C]">
                    {withdrawNotice}
                  </p>
                )}
              </section>

              {/* Today's Rooms & Personal QR (active staff only) */}
              {!isInactive && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.person.isHousekeeping && (
                    <section className="glass-card-heavy rounded-2xl p-5 space-y-2.5">
                      <h2 className="text-sm font-semibold">Today&apos;s Rooms ({data.todayDate})</h2>
                      {data.todayRooms.length === 0 ? (
                        <p className="text-xs text-[#F5EBE0]/75">No rooms assigned yet today.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {data.todayRooms.map((rm) => (
                            <span
                              key={rm}
                              className="rounded-lg bg-[#FAF6F0]/15 border border-[#FAF6F0]/25 px-2.5 py-1 text-xs font-semibold tabular-nums"
                            >
                              Room {rm}
                            </span>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {data.personalQr && (
                    <section className="glass-card-heavy rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold flex items-center gap-1.5">
                          <QrCode className="w-4 h-4 text-[#E6C79C]" /> Personal Tip QR
                        </h2>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={copyQrUrl}
                            className="rounded-lg bg-[#FAF6F0]/15 hover:bg-[#FAF6F0]/25 px-2 py-1 text-[11px] flex items-center gap-1"
                          >
                            {copied ? <Check className="w-3 h-3 text-[#E6C79C]" /> : <Copy className="w-3 h-3" />}
                            {copied ? 'Copied' : 'Link'}
                          </button>
                          <button
                            type="button"
                            onClick={downloadQrSvg}
                            className="rounded-lg bg-[#FAF6F0]/15 hover:bg-[#FAF6F0]/25 px-2 py-1 text-[11px] flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" /> SVG
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-20 h-20 rounded-xl bg-white p-1.5 shrink-0"
                          dangerouslySetInnerHTML={{
                            __html: data.personalQr.svg.replace('<svg ', '<svg style="width:100%;height:100%" '),
                          }}
                        />
                        <p className="text-xs text-[#F5EBE0]/80">
                          Guests scanning your personal QR go directly to your tipping card.
                        </p>
                      </div>
                    </section>
                  )}
                </div>
              )}

              {/* Recent Tips / Ledger Tabs */}
              <section className="glass-card-heavy rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTab('tips')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      tab === 'tips' ? 'bg-[#E6C79C] text-[#1C110A]' : 'bg-[#FAF6F0]/10 text-[#FAF6F0]'
                    }`}
                  >
                    Recent Tips ({data.recentTips.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('ledger')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      tab === 'ledger' ? 'bg-[#E6C79C] text-[#1C110A]' : 'bg-[#FAF6F0]/10 text-[#FAF6F0]'
                    }`}
                  >
                    Wallet Ledger ({data.ledgerEntries.length})
                  </button>
                </div>

                {tab === 'tips' ? (
                  data.recentTips.length === 0 ? (
                    <p className="text-xs text-[#F5EBE0]/75">No tips received yet.</p>
                  ) : (
                    <ul className="divide-y divide-[#FAF6F0]/15">
                      {data.recentTips.map((t) => (
                        <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                          <div className="space-y-0.5">
                            <div className="font-semibold">
                              {t.roomNumber ? `Room ${t.roomNumber}` : 'Direct / Pool'} ·{' '}
                              <span className="text-[#E6C79C] uppercase text-[10px]">{t.status}</span>
                            </div>
                            {t.note && <p className="text-[#F5EBE0]/85 italic">&ldquo;{t.note}&rdquo;</p>}
                            <p className="text-[11px] text-[#F5EBE0]/60">
                              {new Date(t.paidAt).toLocaleString()}
                            </p>
                          </div>
                          <span className="font-semibold text-[#E6C79C] tabular-nums shrink-0">
                            +{fmt(t.netCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                ) : data.ledgerEntries.length === 0 ? (
                  <p className="text-xs text-[#F5EBE0]/75">No ledger entries yet.</p>
                ) : (
                  <ul className="divide-y divide-[#FAF6F0]/15">
                    {data.ledgerEntries.map((l) => (
                      <li key={l.id} className="py-2 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-medium capitalize">{l.type.replace(/_/g, ' ')}</span>
                          <span className="ml-2 text-[11px] text-[#F5EBE0]/60">
                            {new Date(l.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <span className="font-semibold tabular-nums">
                          {l.amountCents >= 0 ? `+${fmt(l.amountCents)}` : fmt(l.amountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )
        )}
      </div>
    </main>
  );
}
