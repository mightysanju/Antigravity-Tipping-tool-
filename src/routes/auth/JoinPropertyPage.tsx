import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckCircle2, UserCheck } from 'lucide-react';
import { callJoinByQrGet, callJoinByQrPost } from '../../lib/apiClient';
import { MOTION } from '../../ui/motionTokens';

interface JoinablePerson {
  personId: string;
  displayName: string;
  departmentName: string | null;
}

export function JoinPropertyPage() {
  const { propertyId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [propertyName, setPropertyName] = useState('');
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<JoinablePerson[]>([]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPerson, setSelectedPerson] = useState<JoinablePerson | null>(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [typedName, setTypedName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    callJoinByQrGet(propertyId)
      .then((res) => {
        if (!active) return;
        if (!res.ok) {
          setBlockedMessage(
            res.code === 'FEATURE_DISABLED'
              ? 'Join QR onboarding is currently disabled for this property.'
              : 'This Join QR link is unavailable or the property is inactive.'
          );
        } else {
          setPropertyName(res.propertyName || 'Hotel Property');
          setStaffList(res.staff || []);
        }
      })
      .catch(() => {
        if (active) setBlockedMessage('Unable to load Join QR directory.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [propertyId]);

  async function handleSendOtp(person: JoinablePerson) {
    if (!propertyId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await callJoinByQrPost<{ maskedEmail: string }>({
        action: 'send_otp',
        propertyId,
        personId: person.personId,
      });
      setSelectedPerson(person);
      setMaskedEmail(res.maskedEmail);
      setTypedName(person.displayName);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send verification code');
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !selectedPerson) return;
    setError(null);
    setBusy(true);
    try {
      await callJoinByQrPost({
        action: 'complete',
        propertyId,
        personId: selectedPerson.personId,
        code: otpCode,
        password,
        typedName,
        checkboxConfirmed: confirmed,
      });
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete onboarding');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="resort-photo-backdrop min-h-screen relative flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/assets/resort-backdrop.jpg')" }}
    >
      <div className="resort-scrim-guest absolute inset-0" aria-hidden="true" />
      <section className="relative z-10 w-full max-w-md space-y-4 text-[#FAF6F0]">
        <header className="glass-text-shadow space-y-1">
          <h1 className="serif-display text-2xl font-semibold">
            {propertyName || 'Join Your Team'}
          </h1>
          <p className="text-sm text-[#F5EBE0]/90">
            Claim your staff wallet in 3 quick steps
          </p>
        </header>

        {/* Step Progress Bar */}
        {!blockedMessage && !completed && (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-1.5 rounded-full bg-[#FAF6F0]/20 overflow-hidden">
                {n <= step && (
                  <motion.div
                    layoutId={`joinStepFill-${n}`}
                    transition={MOTION.springSnappy}
                    className="h-full bg-[#FAF3E8]"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="glass-card-heavy rounded-2xl p-5 space-y-4">
          {loading && <p className="text-sm text-[#F5EBE0]/85">Loading staff directory...</p>}

          {blockedMessage && (
            <p className="text-sm text-[#FDE68A]">{blockedMessage}</p>
          )}

          {error && (
            <p className="rounded-lg bg-[#7F1D1D]/60 border border-[#FCA5A5]/40 px-3 py-2 text-xs text-[#FEE2E2]">
              {error}
            </p>
          )}

          {!loading && !blockedMessage && !completed && step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-[#F5EBE0]/85">
                Select your name below to receive a 6-digit code at your work email:
              </p>
              {staffList.length === 0 ? (
                <p className="text-sm text-[#F5EBE0]/80">
                  No unclaimed staff profiles remain. Please sign in on the Login page.
                </p>
              ) : (
                <ul className="space-y-2 max-h-60 overflow-y-auto">
                  {staffList.map((person) => (
                    <li key={person.personId}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSendOtp(person)}
                        className="w-full rounded-xl border border-[#FAF6F0]/25 bg-[#FAF6F0]/10 hover:bg-[#FAF6F0]/20 px-3.5 py-2.5 flex items-center justify-between text-left cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-semibold text-[#FAF6F0]">{person.displayName}</p>
                          <p className="text-xs text-[#F5EBE0]/75">
                            {person.departmentName || 'Hospitality Staff'}
                          </p>
                        </div>
                        <UserCheck className="w-4 h-4 text-[#E6C79C]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!completed && step === 2 && selectedPerson && (
            <div className="space-y-4">
              <p className="text-xs text-[#F5EBE0]/90">
                We sent a 6-digit code to <strong>{maskedEmail}</strong> for{' '}
                <strong>{selectedPerson.displayName}</strong>.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit OTP"
                className="w-full h-11 rounded-xl border border-[#FAF6F0]/30 bg-[#FAF6F0]/10 px-3 text-center text-base font-bold tracking-widest tabular-nums text-[#FAF6F0] outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 h-10 rounded-xl border border-[#FAF6F0]/25 text-xs font-semibold cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={otpCode.length < 6}
                  onClick={() => setStep(3)}
                  className="flex-1 h-10 rounded-xl bg-[#FAF3E8] text-[#21150E] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {!completed && step === 3 && selectedPerson && (
            <form onSubmit={handleComplete} className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-[#F5EBE0]/90 font-medium">Create Password (min 8 chars)</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 rounded-xl border border-[#FAF6F0]/30 bg-[#FAF6F0]/10 px-3 text-sm text-[#FAF6F0] outline-none"
                />
              </label>

              <div className="rounded-xl border border-[#FAF6F0]/20 bg-[#1C110A]/60 p-3 space-y-1.5 text-[#F5EBE0]/85">
                <p className="font-semibold text-[#FAF6F0]">Staff Wallet &amp; Payout Agreement</p>
                <p>
                  Tips credit your wallet after Stripe confirmation. Standard payouts batch weekly;
                  instant debit deducts the instant fee. Card disputes deduct from your wallet.
                </p>
              </div>

              <label className="block space-y-1">
                <span className="text-[#F5EBE0]/90 font-medium">Type Full Name to Sign</span>
                <input
                  required
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full h-10 rounded-xl border border-[#FAF6F0]/30 bg-[#FAF6F0]/10 px-3 text-sm text-[#FAF6F0] outline-none"
                />
              </label>

              <label className="flex items-start gap-2 cursor-pointer text-[#F5EBE0]/90">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I accept the Staff Wallet &amp; Payout Agreement.</span>
              </label>

              <button
                type="submit"
                disabled={busy || !confirmed || password.length < 8}
                className="w-full h-10 rounded-xl bg-[#FAF3E8] text-[#21150E] font-semibold text-sm disabled:opacity-50 cursor-pointer"
              >
                {busy ? 'Activating Account...' : 'Activate & Sign Agreement'}
              </button>
            </form>
          )}

          {completed && (
            <div className="text-center space-y-3 py-2">
              <CheckCircle2 className="w-10 h-10 text-[#86EFAC] mx-auto" />
              <h2 className="serif-display text-lg font-semibold">Welcome aboard</h2>
              <p className="text-xs text-[#F5EBE0]/85">
                Your account and Staff Agreement are active. You can now sign in to view your wallet.
              </p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full h-10 rounded-xl bg-[#FAF3E8] text-[#21150E] text-sm font-semibold cursor-pointer"
              >
                Go to Sign In
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
