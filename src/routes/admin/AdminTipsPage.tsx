import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Download, Layers, Users } from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import { useAuth } from '../../auth/AuthContext';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import {
  callAdminTipsOverview,
  callDistributePool,
  callExportTips,
  callRefundTip,
  type AdminTipsOverviewView,
} from '../../lib/apiClient';

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function downloadBase64(base64: string, contentType: string, filename: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function AdminTipsPage() {
  const { user } = useAuth();
  const { activeProperty } = usePropertySwitcher();
  const propertyId =
    user?.role === 'super_admin' ? activeProperty?.id ?? null : user?.propertyId ?? null;

  const [data, setData] = useState<AdminTipsOverviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [expandedTipId, setExpandedTipId] = useState<string | null>(null);

  // Pool distribution form state per department
  const [poolMethod, setPoolMethod] = useState<Record<string, 'split' | 'individual'>>({});
  const [customAllocs, setCustomAllocs] = useState<Record<string, Record<string, string>>>({});
  const [distributingDept, setDistributingDept] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await callAdminTipsOverview({
        propertyId,
        fromDate: fromDate || null,
        toDate: toDate || null,
        departmentId: deptFilter || null,
        personId: personFilter || null,
      });
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tips overview');
    } finally {
      setLoading(false);
    }
  }, [propertyId, fromDate, toDate, deptFilter, personFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleExport(format: 'csv' | 'pdf') {
    if (!propertyId) return;
    setError(null);
    try {
      const file = await callExportTips({
        propertyId,
        format,
        fromDate: fromDate || null,
        toDate: toDate || null,
        departmentId: deptFilter || null,
        personId: personFilter || null,
      });
      downloadBase64(file.dataBase64, file.contentType, file.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  async function handleDistribute(dept: AdminTipsOverviewView['departments'][number]) {
    if (!propertyId) return;
    const method = poolMethod[dept.id] ?? dept.defaultDistribution;
    setDistributingDept(dept.id);
    setError(null);
    setNotice(null);
    try {
      let allocations: Array<{ personId: string; amountCents: number }> | null = null;
      if (method === 'individual') {
        const inputs = customAllocs[dept.id] ?? {};
        allocations = dept.activeStaff
          .map((s) => ({
            personId: s.id,
            amountCents: Math.round((Number.parseFloat(inputs[s.id] || '0') || 0) * 100),
          }))
          .filter((a) => a.amountCents > 0);
      }
      const res = await callDistributePool({
        propertyId,
        departmentId: dept.id,
        method,
        allocations,
      });
      setNotice(`Distributed ${fmt(res.totalCents)} from ${dept.name} pool.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pool distribution failed');
    } finally {
      setDistributingDept(null);
    }
  }

  if (!propertyId) {
    return (
      <AdminLayout title="Tips Overview">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5 text-sm text-[#5C4B3E]">
          Select a property using the Super Admin Property Switcher to view tips.
        </div>
      </AdminLayout>
    );
  }

  const exportEnabled = data?.toggles.tips_overview_export !== false;
  const poolEnabled = data?.toggles.pool_distribution !== false;

  return (
    <AdminLayout title="Tips Overview">
      {error && (
        <div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#166534]">
          {notice}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5">
          <div className="text-xs text-[#7A6859]">Total Net Tips</div>
          <div className="text-2xl font-bold text-[#1C110A] mt-1 tabular-nums">
            {fmt(data?.kpis.totalNetCents ?? 0)}
          </div>
        </div>
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5">
          <div className="text-xs text-[#7A6859]">Number of Tips</div>
          <div className="text-2xl font-bold text-[#1C110A] mt-1 tabular-nums">
            {data?.kpis.tipCount ?? 0}
          </div>
        </div>
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5">
          <div className="text-xs text-[#7A6859]">Average Tip</div>
          <div className="text-2xl font-bold text-[#1C110A] mt-1 tabular-nums">
            {fmt(data?.kpis.averageNetCents ?? 0)}
          </div>
        </div>
      </div>

      {/* Filters & Payroll Export */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[#5C4B3E]">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D8CBB8] px-3 py-1.5 text-xs"
          />
        </label>
        <label className="text-xs text-[#5C4B3E]">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D8CBB8] px-3 py-1.5 text-xs"
          />
        </label>
        {!data?.scopedDepartmentId && (
          <label className="text-xs text-[#5C4B3E]">
            Department
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="mt-1 block rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs"
            >
              <option value="">All departments</option>
              {(data?.departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-[#5C4B3E]">
          Staff
          <select
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs"
          >
            <option value="">All staff</option>
            {(data?.byPerson ?? []).map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.personName}
              </option>
            ))}
          </select>
        </label>
        {exportEnabled && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void handleExport('csv')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] px-3 py-1.5 text-xs font-medium hover:bg-[#F3F4F6]"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] px-3 py-1.5 text-xs font-medium hover:bg-[#F3F4F6]"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </section>

      {/* Department Pools */}
      {poolEnabled && data && data.departments.length > 0 && (
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#8C5E1A]" />
            <h2 className="text-sm font-semibold text-[#1C110A]">Department Tip Pools</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.departments.map((dept) => {
              const method = poolMethod[dept.id] ?? dept.defaultDistribution;
              return (
                <div key={dept.id} className="rounded-xl border border-[#E7DDD0] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-[#1C110A]">{dept.name}</div>
                      <div className="text-xs text-[#7A6859]">{dept.activeStaff.length} active staff</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#7A6859]">Unallocated Pool</div>
                      <div className="text-base font-bold text-[#8C5E1A] tabular-nums">
                        {fmt(dept.unallocatedPoolCents)}
                      </div>
                    </div>
                  </div>

                  {dept.unallocatedPoolCents > 0 && (
                    <div className="space-y-2 border-t border-[#F3F4F6] pt-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPoolMethod((m) => ({ ...m, [dept.id]: 'split' }))}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                            method === 'split' ? 'bg-[#2A1A10] text-white' : 'bg-[#F3F4F6] text-[#374151]'
                          }`}
                        >
                          Split evenly
                        </button>
                        <button
                          type="button"
                          onClick={() => setPoolMethod((m) => ({ ...m, [dept.id]: 'individual' }))}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                            method === 'individual' ? 'bg-[#2A1A10] text-white' : 'bg-[#F3F4F6] text-[#374151]'
                          }`}
                        >
                          Individual amounts
                        </button>
                      </div>

                      {method === 'individual' && (
                        <div className="space-y-1.5">
                          {dept.activeStaff.map((s) => (
                            <label key={s.id} className="flex items-center justify-between gap-2 text-xs">
                              <span>{s.name}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={customAllocs[dept.id]?.[s.id] ?? ''}
                                onChange={(e) =>
                                  setCustomAllocs((prev) => ({
                                    ...prev,
                                    [dept.id]: { ...(prev[dept.id] ?? {}), [s.id]: e.target.value },
                                  }))
                                }
                                className="w-24 rounded-lg border border-[#D8CBB8] px-2 py-1 text-xs tabular-nums"
                              />
                            </label>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={distributingDept === dept.id}
                        onClick={() => void handleDistribute(dept)}
                        className="w-full rounded-lg bg-[#2A1A10] py-2 text-xs font-semibold text-white hover:bg-[#3D281B] disabled:opacity-50"
                      >
                        {distributingDept === dept.id ? 'Distributing…' : `Distribute ${fmt(dept.unallocatedPoolCents)}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Summary by Person */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#8C5E1A]" />
          <h2 className="text-sm font-semibold text-[#1C110A]">Summary by Staff</h2>
        </div>
        {loading ? (
          <p className="text-xs text-[#7A6859]">Loading…</p>
        ) : data && data.byPerson.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[#7A6859] border-b border-[#E7DDD0]">
                <tr>
                  <th className="py-2 pr-3">Staff</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Tips</th>
                  <th className="py-2">Net Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {data.byPerson.map((p) => (
                  <tr key={p.personId}>
                    <td className="py-2 pr-3 font-medium text-[#1C110A]">{p.personName}</td>
                    <td className="py-2 pr-3 text-[#5C4B3E]">{p.departmentName}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.tipCount}</td>
                    <td className="py-2 font-semibold tabular-nums">{fmt(p.totalNetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[#7A6859]">No individual tips match the selected filters.</p>
        )}
      </section>

      {/* Expandable Tip Rows */}
      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1C110A]">Tip Detail ({data?.tips.length ?? 0})</h2>
        {data && data.tips.length > 0 ? (
          <ul className="divide-y divide-[#F3F4F6]">
            {data.tips.map((t) => {
              const expanded = expandedTipId === t.id;
              return (
                <li key={t.id} className="py-2.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandedTipId(expanded ? null : t.id)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <span className="font-semibold text-[#1C110A]">
                        {t.personName || `${t.departmentName} Pool`}
                      </span>
                      <span className="ml-2 text-[#7A6859]">
                        {t.roomNumber ? `Room ${t.roomNumber}` : t.departmentName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[#1C110A] tabular-nums">{fmt(t.netCents)}</span>
                      <ChevronDown className={`w-4 h-4 text-[#7A6859] transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {expanded && (
                    <div className="mt-2 rounded-lg bg-[#F9FAFB] p-3 text-[#5C4B3E] space-y-1">
                      <div>Paid at: {new Date(t.paidAt).toLocaleString()} · Status: {t.status}</div>
                      <div className="tabular-nums">
                        Gross: {fmt(t.amountCents)} · Stripe fee: {fmt(t.feeCents)} · Guest paid fee: {fmt(t.guestFeeCents)}
                      </div>
                      {t.note && <div className="italic text-[#1C110A]">Note: &ldquo;{t.note}&rdquo;</div>}
                      {t.status === 'paid' &&
                        data.toggles.refunds !== false &&
                        user?.role !== 'dept_manager' && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={async () => {
                                setError(null);
                                setNotice(null);
                                try {
                                  const res = await callRefundTip(t.id);
                                  setNotice(`Tip ${res.status === 'refunded' ? 'refunded' : 'refund initiated'}.`);
                                  await load();
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Refund failed');
                                }
                              }}
                              className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-2.5 py-1 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
                            >
                              Issue 24h Refund
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-[#7A6859]">No tips found.</p>
        )}
      </section>
    </AdminLayout>
  );
}
