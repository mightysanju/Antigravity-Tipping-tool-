import { useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import { callSignAgreement } from '../lib/apiClient';

const PROPERTY_TERMS = [
  '1. Flat Subscription & Zero Tip Commission: Property pays the agreed flat monthly or yearly subscription fee. FrontDesk Tip takes 0% of guest tips.',
  '2. Contract Term & Notice: Defaults to a 12-month auto-renewing term with 30 days written termination notice prior to renewal (editable per property).',
  '3. Billing & Restriction: Unresolved failed invoices place the property into restricted status (pausing guest tips and payouts) until billing is resolved.',
  '4. Stripe Connect Express & Chargebacks: Staff payouts run through Stripe Connect Express; properties never cover guest chargebacks.',
];

const STAFF_TERMS = [
  '1. In-App Wallet & Weekly/Instant Payouts: Confirmed tips credit your wallet after Stripe webhook verification. Standard payouts batch weekly; optional instant debit payouts deduct the instant fee.',
  '2. Stripe Connect Express Onboarding: You link bank or debit details directly with Stripe; FrontDesk Tip stores zero bank, card, or SSN records.',
  '3. 24-Hour Refunds & Chargebacks: Admins may refund a tip within 24 hours if covered by your wallet. Card disputes deduct from your wallet and recover from future tips.',
  '4. Unclaimed Balances: Earned funds remain yours until withdrawn; reminders email at 30, 60, and 90 days.',
];

interface AgreementSigningCardProps {
  signerType: 'property' | 'staff';
  signerId: string;
  propertyId: string;
  propertyName: string;
  defaultTypedName?: string;
  contractTermMonths?: number;
  noticeDays?: number;
  onSigned?: (result: { pdfStoragePath: string; pdfBase64: string }) => void;
}

export function AgreementSigningCard({
  signerType,
  signerId,
  propertyId,
  propertyName,
  defaultTypedName = '',
  contractTermMonths = 12,
  noticeDays = 30,
  onSigned,
}: AgreementSigningCardProps) {
  const [typedName, setTypedName] = useState(defaultTypedName);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'signed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signedPdf, setSignedPdf] = useState<{ path: string; base64: string } | null>(null);

  const clauses = signerType === 'property' ? PROPERTY_TERMS : STAFF_TERMS;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting' || status === 'signed') return;
    setError(null);

    if (typedName.trim().length < 2) {
      setError('Please enter your full legal name.');
      return;
    }
    if (!confirmed) {
      setError('Please check the confirmation box to accept the agreement.');
      return;
    }

    setStatus('submitting');
    try {
      const res = await callSignAgreement({
        signerType,
        signerId,
        propertyId,
        propertyName,
        typedName: typedName.trim(),
        checkboxConfirmed: true,
      });
      setStatus('signed');
      setSignedPdf({ path: res.pdfStoragePath, base64: res.pdfBase64 });
      onSigned?.({ pdfStoragePath: res.pdfStoragePath, pdfBase64: res.pdfBase64 });
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Unable to record signature');
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4 text-[#1C110A]"
    >
      <div>
        <h3 className="text-base font-semibold">
          {signerType === 'property' ? 'Property Service Agreement' : 'Staff Wallet & Payout Agreement'}
        </h3>
        <p className="text-xs text-[#5C4B3E] mt-0.5">
          {propertyName}
          {signerType === 'property'
            ? ` · ${contractTermMonths}-month auto-renewing term · ${noticeDays} days notice`
            : ' · Required before receiving tips or withdrawing'}
        </p>
      </div>

      <div className="rounded-lg border border-[#E7DDD0] bg-[#F9FAFB] p-3.5 max-h-44 overflow-y-auto space-y-2 text-xs text-[#374151] leading-relaxed">
        {clauses.map((clause) => (
          <p key={clause}>{clause}</p>
        ))}
        <p className="text-[#7A6859] italic">
          Draft template copy pending final counsel sign-off prior to commercial launch.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#374151] mb-1">
            Type your full name to sign
          </label>
          <input
            type="text"
            value={typedName}
            disabled={status === 'signed'}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="e.g. Clara Mendez"
            className="w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-sm outline-none focus:border-[#B8863B] disabled:bg-[#F3F4F6]"
          />
          {typedName.trim().length > 0 && (
            <div className="mt-2 rounded-lg border border-[#E7DDD0] bg-[#FAF7F2] px-3 py-2 text-[#1C1917]">
              <span className="block text-xs text-[#57534E]">Electronic Signature Preview</span>
              <span className="serif-display text-lg font-semibold italic">{typedName}</span>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-[#374151] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={status === 'signed'}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 rounded accent-[#1D4ED8] cursor-pointer"
          />
          <span>
            I confirm that I am authorized to accept these terms on behalf of{' '}
            <strong>{signerType === 'property' ? propertyName : 'myself'}</strong>, and understand my
            typed name, timestamp, and IP address will be stored permanently.
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status !== 'idle'}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors cursor-pointer ${
            status === 'signed'
              ? 'bg-[#047857]'
              : 'bg-[#2A1A10] hover:bg-[#3D281B] disabled:opacity-70'
          }`}
        >
          {status === 'submitting' && <Loader2 className="w-4 h-4 animate-spin" />}
          {status === 'signed' && <Check className="w-4 h-4" />}
          <span>
            {status === 'idle'
              ? 'Sign & Accept Agreement'
              : status === 'submitting'
                ? 'Recording Signature...'
                : 'Agreement Signed'}
          </span>
        </button>

        {signedPdf && (
          <a
            href={`data:application/pdf;base64,${signedPdf.base64}`}
            download={signedPdf.path.split('/').pop() || 'signed-agreement.pdf'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-medium text-[#1C110A] hover:bg-[#F3F4F6]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Signed PDF</span>
          </a>
        )}
      </div>
    </form>
  );
}
