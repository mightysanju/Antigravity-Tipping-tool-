import { useRef, useState } from 'react';
import { Move, QrCode, Upload } from 'lucide-react';

export interface QrPosition {
  x: number;
  y: number;
  size: number;
}

export function QrTemplatePlacer({
  templatePreviewUrl,
  qrPosition,
  onChangePosition,
  onUploadTemplate,
  heroPreviewUrl,
  onUploadHero,
  propertyName,
}: {
  templatePreviewUrl: string | null;
  qrPosition: QrPosition;
  onChangePosition: (pos: QrPosition) => void;
  onUploadTemplate: (fileName: string, previewDataUrl: string) => void;
  heroPreviewUrl: string | null;
  onUploadHero: (fileName: string, previewDataUrl: string) => void;
  propertyName: string;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null);

  function clamp(val: number, min: number, max: number) {
    return Math.min(max, Math.max(min, val));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragMode || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    if (dragMode === 'move') {
      const nextX = clamp(relX - qrPosition.size / 2, 0.04, 0.96 - qrPosition.size);
      const nextY = clamp(relY - qrPosition.size / 2, 0.04, 0.96 - qrPosition.size);
      onChangePosition({
        x: Number(nextX.toFixed(3)),
        y: Number(nextY.toFixed(3)),
        size: qrPosition.size,
      });
    } else {
      const maxAllowable = Math.min(0.96 - qrPosition.x, 0.96 - qrPosition.y, 0.65);
      const nextSize = clamp(Math.max(relX - qrPosition.x, relY - qrPosition.y), 0.14, maxAllowable);
      onChangePosition({
        x: qrPosition.x,
        y: qrPosition.y,
        size: Number(nextSize.toFixed(3)),
      });
    }
  }

  function handleFileRead(
    e: React.ChangeEvent<HTMLInputElement>,
    cb: (name: string, dataUrl: string) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        cb(file.name, reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  const backdropSrc = heroPreviewUrl || '/assets/resort-backdrop.jpg';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: QR Card Template Placer */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#1C110A]">
            QR Template &amp; Coordinate Placer
          </span>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] bg-white px-2.5 py-1 text-xs font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Template</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleFileRead(e, onUploadTemplate)}
            />
          </label>
        </div>

        <div
          ref={boardRef}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDragMode(null)}
          onPointerLeave={() => setDragMode(null)}
          className="relative w-full aspect-[4/3] rounded-xl border border-[#D8CBB8] bg-[#FAF7F2] overflow-hidden select-none touch-none"
        >
          {templatePreviewUrl ? (
            <img
              src={templatePreviewUrl}
              alt="QR card template preview"
              className="w-full h-full object-cover pointer-events-none"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-between p-4 text-center pointer-events-none">
              <div className="space-y-0.5">
                <p className="serif-display text-sm font-semibold text-[#1C1917]">
                  {propertyName || 'Your Resort Name'}
                </p>
                <p className="text-xs text-[#57534E]">Scan to thank our hospitality team</p>
              </div>
              <p className="text-xs text-[#57534E]">Drag or resize the QR target box</p>
            </div>
          )}

          {/* Draggable / Resizable QR Box */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragMode('move');
            }}
            style={{
              left: `${qrPosition.x * 100}%`,
              top: `${qrPosition.y * 100}%`,
              width: `${qrPosition.size * 100}%`,
              aspectRatio: '1 / 1',
            }}
            className="absolute rounded-lg border-2 border-[#B8863B] bg-white/90 shadow-md flex items-center justify-center cursor-move"
          >
            <QrCode className="w-2/3 h-2/3 text-[#1C110A] pointer-events-none" />
            <span className="absolute top-1 left-1 text-[#8C5E1A] pointer-events-none">
              <Move className="w-3 h-3" />
            </span>
            <button
              type="button"
              aria-label="Resize QR box"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDragMode('resize');
              }}
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#2A1A10] border-2 border-white cursor-nwse-resize"
            />
          </div>
        </div>

        <p className="text-xs text-[#5C4B3E] tabular-nums">
          Coordinates: x={qrPosition.x.toFixed(2)}, y={qrPosition.y.toFixed(2)}, size=
          {qrPosition.size.toFixed(2)}
        </p>
      </div>

      {/* Right: Resort Backdrop Upload + Live Glassmorphism Guest Preview */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#1C110A]">
            Resort Backdrop &amp; Live Guest Preview
          </span>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] bg-white px-2.5 py-1 text-xs font-medium text-[#1C110A] hover:bg-[#F3F4F6] cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Resort Photo</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleFileRead(e, onUploadHero)}
            />
          </label>
        </div>

        <div
          className="resort-photo-backdrop relative w-full aspect-[4/3] rounded-xl border border-[#4D3627] overflow-hidden p-3.5 flex flex-col justify-between text-[#FAF6F0]"
          style={{ backgroundImage: `url('${backdropSrc}')` }}
        >
          <div className="resort-scrim-guest absolute inset-0" aria-hidden="true" />
          <div className="relative z-10 flex items-center gap-2.5">
            <img
              src="/assets/demo-maria.jpg"
              alt="Sample staff avatar"
              className="w-9 h-9 rounded-full object-cover border border-[#FAF6F0]/70"
            />
            <div className="glass-text-shadow min-w-0">
              <p className="serif-display text-sm font-semibold truncate">
                A warm thank-you for Maria
              </p>
              <p className="text-xs text-[#F5EBE0]/90 truncate">
                {propertyName || 'Your Property'} · Room 412
              </p>
            </div>
          </div>

          <div className="relative z-10 space-y-2">
            <div className="glass-surface grid grid-cols-4 gap-1 p-1 rounded-lg text-center text-xs font-semibold tabular-nums">
              <span className="py-1 rounded bg-[#FAF3E8]/95 text-[#21150E]">$3</span>
              <span className="py-1">$5</span>
              <span className="py-1">$10</span>
              <span className="py-1">$20</span>
            </div>
            <div className="rounded-lg bg-[#FAF3E8]/95 text-[#21150E] text-center py-1.5 text-xs font-semibold">
              Send $3.00 Thank-You
            </div>
          </div>
        </div>

        <p className="text-xs text-[#5C4B3E]">
          {heroPreviewUrl ? 'Custom property photo loaded' : 'Using bundled golden-hour resort default'}
        </p>
      </div>
    </div>
  );
}
