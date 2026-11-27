import { useEffect, useState } from 'react';
import { Check, CreditCard } from 'lucide-react';
import { SuperAdminLayout } from '../../components/SuperAdminLayout';
import { callSuperAdmin } from '../../lib/apiClient';
import { formatCents } from '../../shared/types';

interface PaymentsOverviewResponse {
  properties: Array<{
    id: string;
    name: string;
    status: string;
    payoutWeekday: number;
    timezone: string;
    minWithdrawalCents: number;
    payoutFeePaidBy: string;
    paymentFeePaidBy: string;
  }>;
  batches: Array<{
    id: string;
    propertyName: string;
    payoutDate: string;
    status: string;
    totalCents: number;
    withdrawalCount: number;
  }>;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SuperPaymentsPage() {
  const [data, setData] = useState<PaymentsOverviewResponse | null>(null);
  const [payoutWeekday, setPayoutWeekday] = useState(4);
  const [minWithdrawalDollars, setMinWithdrawalDollars] = useState('10');
  const [applyToAll, setApplyToAll] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await callSuperAdmin<PaymentsOverviewResponse>({ action: 'payments_overview' });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payment settings');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSaveDefaults(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedNotice(null);
    try {
      const res = await callSuperAdmin<{ updatedPropertiesCount: number }>({
        action: 'update_payment_defaults',
        payoutWeekday,
        minWithdrawalCents: Math.max(100, Math.round(Number(minWithdrawalDollars || 10) * 100)),
        applyToAll,
      });
      setSavedNotice(
        applyToAll
          ? `Saved defaults and updated ${res.updatedPropertiesCount} properties.`
          : 'Saved platform defaults for new properties.'
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment defaults');
    }
  }

  return (
    <SuperAdminLayout title="Platform Payments & Stripe Connect">
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      {savedNotice && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-xs text-[#047857] flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stripe Connect Express Health Card */}
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#F5E1C3]/45 text-[#8C5E1A] flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[#1C110A]">
                Stripe Connect Express (Separate Charges &amp; Transfers)
              </h2>
              <p className="text-xs text-[#5C4B3E]">
                Signed-off payout architecture · Zero bank/card/SSN storage in app DB
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-[#F9FAFB] border border-[#E7DDD0] p-3 text-xs text-[#374151] space-y-1.5">
            <p>
              <strong>Guest Settlement:</strong> Stripe Payment Element settles into platform account;
              signed webhooks credit recipient wallets atomically.
            </p>
            <p>
              <strong>Staff Payouts:</strong> Staff onboard bank/debit accounts inside Stripe-hosted
              Connect Express flows; weekly batch &amp; instant debit payouts transfer via idempotency keys.
            </p>
          </div>
        </section>

        {/* Global Defaults Form */}
        <form
          onSubmit={handleSaveDefaults}
          className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4 text-xs"
        >
          <h2 className="text-sm font-semibold text-[#1C110A]">Global Payout Defaults</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="font-medium text-[#374151]">Default Weekly Payout Day</span>
              <select
                value={payoutWeekday}
                onChange={(e) => setPayoutWeekday(Number(e.target.value))}
                className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm bg-white"
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium text-[#374151]">Minimum Withdrawal (USD)</span>
              <input
                type="number"
                min="1"
                value={minWithdrawalDollars}
                onChange={(e) => setMinWithdrawalDollars(e.target.value)}
                className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm tabular-nums"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-[#374151]">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            <span>Apply these defaults to all non-cancelled properties now</span>
          </label>

          <button
            type="submit"
            className="rounded-lg bg-[#2A1A10] text-white px-4 py-2 font-medium hover:bg-[#3D281B] cursor-pointer"
          >
            Save Platform Defaults
          </button>
        </form>
      </div>

      {/* Per-Property Payout Schedule Table */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E7DDD0]">
          <h2 className="text-sm font-semibold text-[#1C110A]">Per-Property Payout Schedules</h2>
        </div>
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
              <th className="py-2.5 px-4 font-medium">Property</th>
              <th className="py-2.5 px-4 font-medium">Payout Day (09:00 Local)</th>
              <th className="py-2.5 px-4 font-medium">Timezone</th>
              <th className="py-2.5 px-4 font-medium">Fee Policy</th>
              <th className="py-2.5 px-4 font-medium text-right">Min Withdrawal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {data?.properties.map((p) => (
              <tr key={p.id}>
                <td className="py-2.5 px-4 font-medium text-[#1C110A]">{p.name}</td>
                <td className="py-2.5 px-4">{WEEKDAYS[p.payoutWeekday] || 'Thursday'}</td>
                <td className="py-2.5 px-4">{p.timezone}</td>
                <td className="py-2.5 px-4">
                  Pay: {p.paymentFeePaidBy} · Payout: {p.payoutFeePaidBy}
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                  {formatCents(p.minWithdrawalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Weekly Payout Batches */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E7DDD0]">
          <h2 className="text-sm font-semibold text-[#1C110A]">Recent Weekly Payout Batches</h2>
        </div>
        <div className="p-4 text-xs text-[#7A6859]">
          {data?.batches.length ? (
            <ul className="divide-y divide-[#E5E7EB]">
              {data.batches.map((b) => (
                <li key={b.id} className="py-2 flex items-center justify-between text-[#1C110A]">
                  <span>
                    {b.propertyName} · {b.payoutDate} ({b.withdrawalCount} payouts)
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(b.totalCents)} · {b.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No weekly payout batches executed yet.</p>
          )}
        </div>
      </section>
    </SuperAdminLayout>
  );
}
