import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, Clock } from 'lucide-react';
import { SuperAdminLayout } from '../../components/SuperAdminLayout';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import { callSuperAdmin } from '../../lib/apiClient';
import { formatCents } from '../../shared/types';

interface DashboardResponse {
  kpis: {
    totalTipsCents: number;
    tipCount: number;
    feesCollectedCents: number;
    totalWalletLiabilityCents: number;
    activeSubscriptionsCount: number;
    overdueOrRestrictedCount: number;
  };
  properties: Array<{
    id: string;
    name: string;
    address: string;
    status: 'pending' | 'active' | 'restricted' | 'cancelled';
    planType: 'monthly' | 'yearly';
    planPriceCents: number;
    staffCount: number;
    roomCount: number;
    totalTipsCents: number;
    agreementSigned: boolean;
  }>;
}

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
  pending: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
  restricted: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
  cancelled: 'bg-[#F3F4F6] text-[#5C4B3E] border-[#D8CBB8]',
};

export function SuperDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setActiveProperty } = usePropertySwitcher();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    callSuperAdmin<DashboardResponse>({ action: 'dashboard' })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      });
    return () => {
      active = false;
    };
  }, []);

  const kpis = data?.kpis;

  return (
    <SuperAdminLayout
      title="Platform Dashboard"
      actions={
        <button
          type="button"
          onClick={() => navigate('/super/properties')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] text-white px-3.5 py-2 text-xs font-medium hover:bg-[#3D281B] cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Onboard Property</span>
        </button>
      }
    >
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-4">
          <p className="text-xs font-medium text-[#5C4B3E]">Total Tip Volume</p>
          <p className="text-2xl font-bold text-[#1C110A] tabular-nums mt-1">
            {kpis ? formatCents(kpis.totalTipsCents) : '—'}
          </p>
          <p className="text-xs text-[#7A6859] tabular-nums mt-1">
            {kpis ? `${kpis.tipCount} confirmed tips` : 'Loading...'}
          </p>
        </div>

        <div className="bg-white border border-[#E7DDD0] rounded-xl p-4">
          <p className="text-xs font-medium text-[#5C4B3E]">Stripe Fees Tracked</p>
          <p className="text-2xl font-bold text-[#1C110A] tabular-nums mt-1">
            {kpis ? formatCents(kpis.feesCollectedCents) : '—'}
          </p>
          <p className="text-xs text-[#7A6859] mt-1">0% platform tip cut</p>
        </div>

        <div className="bg-white border border-[#E7DDD0] rounded-xl p-4">
          <p className="text-xs font-medium text-[#5C4B3E]">Staff Wallet Liability</p>
          <p className="text-2xl font-bold text-[#1C110A] tabular-nums mt-1">
            {kpis ? formatCents(kpis.totalWalletLiabilityCents) : '—'}
          </p>
          <p className="text-xs text-[#7A6859] mt-1">Payable via Connect Express</p>
        </div>

        <div className="bg-white border border-[#E7DDD0] rounded-xl p-4">
          <p className="text-xs font-medium text-[#5C4B3E]">Property Subscriptions</p>
          <p className="text-2xl font-bold text-[#1C110A] tabular-nums mt-1">
            {kpis ? `${kpis.activeSubscriptionsCount} Active` : '—'}
          </p>
          <p className="text-xs text-[#B91C1C] tabular-nums mt-1">
            {kpis ? `${kpis.overdueOrRestrictedCount} restricted / overdue` : 'Loading...'}
          </p>
        </div>
      </section>

      {/* Properties Health Table */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E7DDD0] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1C110A]">Properties Overview</h2>
          <span className="text-xs text-[#7A6859] tabular-nums">
            {data ? `${data.properties.length} properties` : ''}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E7DDD0] bg-[#F9FAFB] text-[#5C4B3E]">
                <th className="py-3 px-4 font-medium">Property</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Plan</th>
                <th className="py-3 px-4 font-medium">Agreement</th>
                <th className="py-3 px-4 font-medium text-right">Rooms / Staff</th>
                <th className="py-3 px-4 font-medium text-right">Total Tips</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {!data && (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#7A6859]">
                    Loading platform properties...
                  </td>
                </tr>
              )}
              {data?.properties.map((prop) => (
                <tr key={prop.id} className="hover:bg-[#F9FAFB]">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-[#1C110A]">{prop.name}</p>
                    <p className="text-[#7A6859] truncate max-w-xs">{prop.address}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border font-medium capitalize ${
                        STATUS_BADGES[prop.status] || STATUS_BADGES.pending
                      }`}
                    >
                      {prop.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 tabular-nums">
                    {formatCents(prop.planPriceCents)} / {prop.planType === 'monthly' ? 'mo' : 'yr'}
                  </td>
                  <td className="py-3 px-4">
                    {prop.agreementSigned ? (
                      <span className="inline-flex items-center gap-1 text-[#047857] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Signed</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#B45309] font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Awaiting Signature</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {prop.roomCount} rooms · {prop.staffCount} staff
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums">
                    {formatCents(prop.totalTipsCents)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/super/properties?id=${prop.id}`)}
                        className="rounded-md border border-[#D8CBB8] px-2.5 py-1 font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer"
                      >
                        Manage
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveProperty({ id: prop.id, name: prop.name });
                          navigate('/admin/departments');
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-[#F5E1C3]/45 text-[#8C5E1A] px-2.5 py-1 font-medium hover:bg-[#DBEAFE] cursor-pointer"
                      >
                        <span>Switch</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SuperAdminLayout>
  );
}
