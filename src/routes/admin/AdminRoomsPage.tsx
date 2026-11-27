import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ImagePlus, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout';
import { useAuth } from '../../auth/AuthContext';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import {
  callAdminRooms,
  callGenerateQrCards,
  type RoomsAdminView,
} from '../../lib/apiClient';
import {
  buildCardZip,
  buildPrintSheetHtml,
  CARD_HEIGHT,
  CARD_WIDTH,
  composeCardSvg,
  safeFileName,
  type QrCardData,
  type TemplateRef,
} from '../../shared/qrCards';

type Kind = 'room' | 'department' | 'person';
type Generated = Awaited<ReturnType<typeof callGenerateQrCards>>;

const KIND_META: Record<Kind, { label: string; toggle: string; ftId: string }> = {
  room: { label: 'Room QR', toggle: 'room_qr_codes', ftId: 'FT-8' },
  department: { label: 'Department QR', toggle: 'department_qr_codes', ftId: 'FT-6' },
  person: { label: 'Staff personal QR', toggle: 'personal_staff_qr_codes', ftId: 'FT-7' },
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function base64FromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}

function svgToPngBlob(svg: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Canvas unavailable'));
      }
      ctx.drawImage(img, 0, 0, CARD_WIDTH, CARD_HEIGHT);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('PNG export failed'));
    };
    img.src = url;
  });
}

export function AdminRoomsPage() {
  const { user } = useAuth();
  const { activeProperty } = usePropertySwitcher();
  const propertyId =
    user?.role === 'super_admin' ? activeProperty?.id ?? null : user?.propertyId ?? null;

  const [view, setView] = useState<RoomsAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [singleRoom, setSingleRoom] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [prefix, setPrefix] = useState('');

  const [kind, setKind] = useState<Kind>('room');
  const [genFrom, setGenFrom] = useState('');
  const [genTo, setGenTo] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setView(await callAdminRooms<RoomsAdminView>({ action: 'list_rooms', propertyId }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load rooms');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setGenerated(null);
  }, [kind, propertyId]);

  async function guarded(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }

  const template: TemplateRef = useMemo(
    () => (generated?.templateDataUri ? { mode: 'embedded', dataUri: generated.templateDataUri } : null),
    [generated]
  );

  function cardSvg(card: QrCardData) {
    return composeCardSvg({
      card,
      propertyName: generated?.propertyName ?? '',
      template,
      position: generated?.qrPosition,
    });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId) return;
    await guarded(async () => {
      const isRange = rangeFrom.trim() !== '' || rangeTo.trim() !== '';
      const res = await callAdminRooms<{ addedCount: number; skippedExisting: string[] }>({
        action: 'add_rooms',
        propertyId,
        roomNumber: isRange ? null : singleRoom,
        rangeFrom: isRange ? Number(rangeFrom) : null,
        rangeTo: isRange ? Number(rangeTo) : null,
        prefix: isRange ? prefix : null,
      });
      setNotice(
        `Added ${res.addedCount} room(s)` +
          (res.skippedExisting.length ? `; ${res.skippedExisting.length} already existed.` : '.')
      );
      setSingleRoom('');
      setRangeFrom('');
      setRangeTo('');
      await load();
    });
  }

  async function handleDelete(roomId: string) {
    if (!propertyId) return;
    await guarded(async () => {
      await callAdminRooms({ action: 'delete_room', propertyId, roomId });
      await load();
    });
  }

  async function handleBackdrop(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !propertyId) return;
    await guarded(async () => {
      const dataBase64 = await base64FromFile(file);
      await callAdminRooms({ action: 'upload_backdrop', propertyId, dataBase64 });
      setNotice('Resort backdrop saved for guest and staff pages.');
      await load();
    });
  }

  async function handleGenerate() {
    if (!propertyId || !view) return;
    setGenerating(true);
    await guarded(async () => {
      let ids: string[] | null = null;
      if (kind === 'room' && (genFrom.trim() || genTo.trim())) {
        const lo = genFrom.trim() ? Number(genFrom) : -Infinity;
        const hi = genTo.trim() ? Number(genTo) : Infinity;
        ids = view.rooms
          .filter((r) => /^\d+$/.test(r.roomNumber) && Number(r.roomNumber) >= lo && Number(r.roomNumber) <= hi)
          .map((r) => r.id);
        if (ids.length === 0) throw new Error('No rooms fall inside that range.');
      }
      setGenerated(await callGenerateQrCards({ propertyId, kind, ids }));
    });
    setGenerating(false);
  }

  async function downloadSvg(card: QrCardData) {
    downloadBlob(
      new Blob([cardSvg(card)], { type: 'image/svg+xml' }),
      `${card.kind}-${safeFileName(card.label, card.id.slice(0, 8))}.svg`
    );
  }

  async function downloadPng(card: QrCardData) {
    await guarded(async () => {
      downloadBlob(
        await svgToPngBlob(cardSvg(card)),
        `${card.kind}-${safeFileName(card.label, card.id.slice(0, 8))}.png`
      );
    });
  }

  function downloadZip() {
    if (!generated) return;
    let tpl: { bytes: Uint8Array; extension: 'png' | 'jpg' | 'webp' } | null = null;
    if (generated.templateDataUri && generated.templateExtension) {
      const b64 = generated.templateDataUri.split(',')[1] ?? '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      tpl = { bytes, extension: generated.templateExtension };
    }
    const zip = buildCardZip({
      propertyName: generated.propertyName,
      cards: generated.cards,
      template: tpl,
      position: generated.qrPosition,
    });
    downloadBlob(
      new Blob([zip as BlobPart], { type: 'application/zip' }),
      `${safeFileName(generated.propertyName, 'property')}-${kind}-qr-cards.zip`
    );
  }

  function openPrintSheet() {
    if (!generated) return;
    const html = buildPrintSheetHtml({
      propertyName: generated.propertyName,
      cards: generated.cards,
      templateDataUri: generated.templateDataUri,
      position: generated.qrPosition,
    });
    const win = window.open('', '_blank');
    if (!win) {
      setError('Pop-up blocked. Allow pop-ups to open the printable sheet.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  if (!propertyId) {
    return (
      <AdminLayout title="Rooms & QR Cards">
        <div className="bg-white border border-[#E7DDD0] rounded-xl p-5 text-sm text-[#5C4B3E]">
          Select a property using the Super Admin Property Switcher to manage its rooms.
        </div>
      </AdminLayout>
    );
  }

  const meta = KIND_META[kind];
  const kindEnabled = view ? view.toggles[meta.toggle] === true : true;

  return (
    <AdminLayout title="Rooms & QR Cards">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#1C110A]">Add rooms</h2>
          <form onSubmit={handleAdd} className="space-y-3">
            <label className="block text-xs text-[#5C4B3E]">
              Single room number
              <input
                value={singleRoom}
                onChange={(e) => setSingleRoom(e.target.value)}
                placeholder="e.g. 412 or PH-1"
                className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm"
              />
            </label>
            <div className="text-[11px] uppercase text-[#9CA3AF]">or a range</div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-[#5C4B3E]">
                From
                <input value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} inputMode="numeric" placeholder="101"
                  className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-[#5C4B3E]">
                To
                <input value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} inputMode="numeric" placeholder="140"
                  className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-[#5C4B3E]">
                Prefix
                <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="optional"
                  className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm" />
              </label>
            </div>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3D281B]">
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>
        </section>

        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#1C110A]">Resort backdrop</h2>
          <p className="text-xs text-[#5C4B3E]">
            Full-bleed photo behind the guest and staff pages for this property
            {view?.heroPhotoPath ? ' (a backdrop is set).' : ' (using the default resort photo).'} JPEG, PNG or WebP, up to 4&nbsp;MB.
          </p>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] bg-white px-3 py-2 text-xs font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer">
            <ImagePlus className="w-4 h-4" /> Upload photo
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleBackdrop} />
          </label>
        </section>
      </div>

      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#1C110A]">Rooms ({view?.rooms.length ?? 0})</h2>
        {loading ? (
          <p className="text-xs text-[#7A6859]">Loading…</p>
        ) : view && view.rooms.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {view.rooms.map((r) => (
              <li key={r.id} className="inline-flex items-center gap-1 rounded-lg border border-[#E7DDD0] bg-[#F9FAFB] px-2.5 py-1 text-xs tabular-nums">
                {r.roomNumber}
                <button type="button" aria-label={`Delete room ${r.roomNumber}`} onClick={() => handleDelete(r.id)}
                  className="text-[#9CA3AF] hover:text-[#B91C1C]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[#7A6859]">No rooms yet. Add a room or a range above.</p>
        )}
      </section>

      <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <QrCode className="w-4 h-4 text-[#8C5E1A]" />
          <h2 className="text-sm font-semibold text-[#1C110A]">QR cards</h2>
          <div className="ml-auto flex gap-1" role="tablist" aria-label="QR type">
            {(Object.keys(KIND_META) as Kind[]).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${kind === k ? 'bg-[#2A1A10] text-white' : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'}`}>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>

        {!kindEnabled && (
          <p className="rounded-lg bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E]">
            {meta.label} generation is turned off for this property ({meta.ftId}). Ask a Super Admin to enable it.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {kind === 'room' && (
            <>
              <label className="text-xs text-[#5C4B3E]">
                Rooms from
                <input value={genFrom} onChange={(e) => setGenFrom(e.target.value)} inputMode="numeric" placeholder="all"
                  className="mt-1 block w-24 rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-[#5C4B3E]">
                to
                <input value={genTo} onChange={(e) => setGenTo(e.target.value)} inputMode="numeric" placeholder="all"
                  className="mt-1 block w-24 rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm" />
              </label>
            </>
          )}
          <button type="button" onClick={handleGenerate} disabled={!kindEnabled || generating}
            className="rounded-lg bg-[#2A1A10] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3D281B] disabled:opacity-50">
            {generating ? 'Generating…' : 'Generate cards'}
          </button>
          {generated && (
            <>
              <button type="button" onClick={downloadZip}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-medium hover:bg-[#F3F4F6]">
                <Download className="w-4 h-4" /> ZIP ({generated.count})
              </button>
              <button type="button" onClick={openPrintSheet}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-medium hover:bg-[#F3F4F6]">
                <Printer className="w-4 h-4" /> Print sheet / save as PDF
              </button>
            </>
          )}
        </div>

        {generated && (
          <>
            <p className="text-xs text-[#7A6859]">
              {generated.count} card(s). {generated.templateApplied ? 'Stamped on the property template.' : 'Using the default card design (no template applied).'}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {generated.cards.map((card) => (
                <li key={card.id} className="space-y-2">
                  <div
                    className="rounded-lg overflow-hidden border border-[#E7DDD0]"
                    style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
                    // SVG is generated locally from escaped text + the qrcode library output.
                    dangerouslySetInnerHTML={{ __html: cardSvg(card).replace('<svg ', '<svg style="width:100%;height:100%" ') }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-[#1C110A]">{card.label}</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => downloadSvg(card)} className="rounded border border-[#D8CBB8] px-2 py-1 text-[11px] hover:bg-[#F3F4F6]">SVG</button>
                      <button type="button" onClick={() => downloadPng(card)} className="rounded border border-[#D8CBB8] px-2 py-1 text-[11px] hover:bg-[#F3F4F6]">PNG</button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
