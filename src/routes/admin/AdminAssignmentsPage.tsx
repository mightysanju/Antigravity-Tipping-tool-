import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, FileText, ListChecks } from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import { useAuth } from '../../auth/AuthContext';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import {
  callAdminAssignmentsContext,
  callAdminAssignmentsSave,
  callParseAssignmentSheet,
  type AssignmentContextView,
  type ParseSheetView,
} from '../../lib/apiClient';

type Source = 'pdf' | 'photo' | 'manual';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}

const STATUS_STYLE: Record<string, string> = {
  matched: 'bg-[#DCFCE7] text-[#166534]',
  ambiguous: 'bg-[#FEF3C7] text-[#92400E]',
  unmatched: 'bg-[#FEE2E2] text-[#991B1B]',
};

export function AdminAssignmentsPage() {
  const { user } = useAuth();
  const { activeProperty } = usePropertySwitcher();
  const propertyId =
    user?.role === 'super_admin' ? activeProperty?.id ?? null : user?.propertyId ?? null;

  const [date, setDate] = useState('');
  const [ctx, setCtx] = useState<AssignmentContextView | null>(null);
  const [source, setSource] = useState<Source>('manual');
  const [parsed, setParsed] = useState<ParseSheetView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (forDate: string) => {
      if (!propertyId) return;
      try {
        const res = await callAdminAssignmentsContext(propertyId, forDate || '2000-01-01');
        setCtx(res);
        if (!forDate) setDate(res.today);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load assignments');
      }
    },
    [propertyId]
  );

  useEffect(() => {
    setParsed(null);
    setDraft({});
    void load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, date]);

  const current = useMemo(
    () => Object.fromEntries((ctx?.assignments ?? []).map((a) => [a.roomNumber, a.personId])),
    [ctx]
  );
  const nameById = useMemo(
    () => Object.fromEntries((ctx?.housekeepers ?? []).map((h) => [h.id, h.name])),
    [ctx]
  );

  // Rows to save: for manual, only rooms whose selection differs from the saved one.
  const rowsToSave = useMemo(() => {
    return Object.entries(draft)
      .filter(([room, personId]) => personId && (source !== 'manual' || current[room] !== personId))
      .map(([roomNumber, personId]) => ({ roomNumber, personId }));
  }, [draft, source, current]);

  const unresolved = parsed
    ? parsed.proposals.filter((p) => p.status !== 'matched' && !draft[p.roomNumber]).length
    : 0;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, kind: 'pdf' | 'photo') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !propertyId) return;
    await run(async () => {
      const result = await callParseAssignmentSheet({
        propertyId,
        date,
        source: kind,
        dataBase64: await fileToBase64(file),
      });
      setParsed(result);
      setSource(kind);
      setDraft(
        Object.fromEntries(
          result.proposals.filter((p) => p.personId).map((p) => [p.roomNumber, p.personId as string])
        )
      );
    });
  }

  async function handleSave() {
    if (!propertyId || rowsToSave.length === 0) return;
    await run(async () => {
      const res = await callAdminAssignmentsSave({ propertyId, date, source, items: rowsToSave });
      setNotice(
        `Saved ${res.savedCount} assignment(s)` +
          (res.reassignedCount ? `, ${res.reassignedCount} reassigned` : '') +
          (res.unchangedCount ? `, ${res.unchangedCount} unchanged` : '') +
          '.'
      );
      setParsed(null);
      setDraft({});
      await load(date);
    });
  }

  if (!propertyId) {
    return (
      <AdminLayout title="Daily Assignments">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5 text-sm text-[#5C4B3E]">
          Select a property using the Super Admin Property Switcher to manage assignments.
        </div>
      </AdminLayout>
    );
  }

  const toggles = ctx?.toggles ?? {};
  const select = (room: string, options: Array<{ id: string; name: string }>, placeholder: string) => (
    <select
      aria-label={`Housekeeper for room ${room}`}
      value={draft[room] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [room]: e.target.value }))}
      className="rounded-lg border border-[#D8CBB8] bg-white px-2 py-1.5 text-xs"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  const tabs: Array<{ key: Source; label: string; icon: typeof FileText; enabled: boolean }> = [
    { key: 'manual', label: 'Manual', icon: ListChecks, enabled: toggles.manual_assignment === true },
    { key: 'pdf', label: 'PDF upload', icon: FileText, enabled: toggles.pdf_assignment_upload === true },
    { key: 'photo', label: 'Camera photo', icon: Camera, enabled: toggles.camera_photo_ocr === true },
  ];

  return (
    <AdminLayout title="Daily Assignments">
      {error && (
        <div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error === 'PDF_NO_TEXT_USE_PHOTO_OCR'
            ? 'This PDF has no readable text (it looks scanned). Use the Camera photo option instead.'
            : error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#166534]">
          {notice}
        </div>
      )}

      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-[#5C4B3E]">
            Date
            <input
              type="date"
              value={date}
              min={ctx?.today}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-1" role="tablist" aria-label="Input method">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={source === t.key}
                disabled={!t.enabled}
                title={t.enabled ? undefined : 'Turned off for this property'}
                onClick={() => {
                  setSource(t.key);
                  setParsed(null);
                  setDraft(t.key === 'manual' ? { ...current } : {});
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40 ${source === t.key ? 'bg-[#2A1A10] text-white' : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'}`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
          {source === 'pdf' && (
            <label className="rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-medium hover:bg-[#F3F4F6] cursor-pointer">
              Choose PDF…
              <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => handleFile(e, 'pdf')} />
            </label>
          )}
          {source === 'photo' && (
            <label className="rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-medium hover:bg-[#F3F4F6] cursor-pointer">
              Take or choose photo…
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => handleFile(e, 'photo')} />
            </label>
          )}
        </div>
        {busy && <p className="text-xs text-[#7A6859]">Working…</p>}
      </section>

      {parsed && (
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#1C110A]">Review before saving</h2>
            <p className="text-xs text-[#7A6859]">
              {parsed.summary.matched} matched · {parsed.summary.ambiguous} ambiguous · {parsed.summary.unmatched} unmatched.
              Nothing is saved until you confirm.
            </p>
          </div>
          {parsed.unlistedRoomTokens.length > 0 && (
            <p className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
              Not in this property&apos;s room list and ignored: {parsed.unlistedRoomTokens.join(', ')}
            </p>
          )}
          {parsed.proposals.length === 0 ? (
            <p className="text-xs text-[#7A6859]">No room numbers from this property were found in the sheet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[#7A6859]">
                  <tr>
                    <th className="py-2 pr-3">Room</th>
                    <th className="py-2 pr-3">Housekeeper</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">From sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.proposals.map((p) => {
                    const chosen = draft[p.roomNumber] ?? '';
                    const options =
                      p.status === 'ambiguous' && p.candidates.length ? p.candidates : parsed.housekeepers;
                    const reassigning = chosen && p.currentPersonId && p.currentPersonId !== chosen;
                    return (
                      <tr key={p.roomNumber} className="border-t border-[#F3F4F6] align-top">
                        <td className="py-2 pr-3 font-medium tabular-nums">{p.roomNumber}</td>
                        <td className="py-2 pr-3">
                          {select(p.roomNumber, options, p.status === 'matched' ? '— skip —' : 'Choose…')}
                          {reassigning && (
                            <div className="mt-1 text-[11px] text-[#92400E]">
                              Reassigns from {nameById[p.currentPersonId as string] ?? 'current housekeeper'}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                        </td>
                        <td className="py-2 text-[#7A6859]">{p.sourceLine}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {source === 'manual' && ctx && (
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#1C110A]">Rooms</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ctx.rooms.map((room) => {
              const value = draft[room] ?? current[room] ?? '';
              return (
                <label key={room} className="flex items-center justify-between gap-2 rounded-lg border border-[#E7DDD0] px-3 py-2 text-xs">
                  <span className="font-medium tabular-nums">{room}</span>
                  <select
                    aria-label={`Housekeeper for room ${room}`}
                    value={value}
                    onChange={(e) => setDraft((d) => ({ ...{ ...current, ...d }, [room]: e.target.value }))}
                    className="rounded-lg border border-[#D8CBB8] bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {ctx.housekeepers.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {(parsed || source === 'manual') && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || rowsToSave.length === 0 || unresolved > 0}
            className="rounded-lg bg-[#2A1A10] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3D281B] disabled:opacity-50"
          >
            Save {rowsToSave.length} assignment(s)
          </button>
          {unresolved > 0 && (
            <span className="text-xs text-[#92400E]">
              Pick a housekeeper for {unresolved} unmatched or ambiguous row(s) before saving.
            </span>
          )}
        </div>
      )}

      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1C110A]">Room counts for {date || 'today'}</h2>
        {ctx && ctx.counts.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ctx.counts.map((c) => (
              <li key={c.personId} className="flex items-center justify-between rounded-lg border border-[#E7DDD0] px-3 py-2 text-xs">
                <span>{c.name}</span>
                <span className="font-semibold tabular-nums">{c.roomCount} room(s)</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[#7A6859]">No assignments saved for this date.</p>
        )}
      </section>
    </AdminLayout>
  );
}
