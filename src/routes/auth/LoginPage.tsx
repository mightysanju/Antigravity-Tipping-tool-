import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Lock, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { callLoginContext, callSendOtp, callSsoExchange, callVerifyOtp } from '../../lib/apiClient';
import { AgreementSigningCard } from '../../components/AgreementSigningCard';
import { DEV_PERSONAS, useAuth, type DevPersonaKey } from '../../auth/AuthContext';
import { getRoleHomeRoute, type AppRole } from '../../shared/types';
import { MOTION } from '../../ui/motionTokens';

export function LoginPage() {
  const { switchDevPersona } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#sso=')) return;
    const token = decodeURIComponent(hash.slice(5));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!token) return;

    setBusy(true);
    setError(null);
    callSsoExchange(token)
      .then((res) => {
        navigate(getRoleHomeRoute(res.role), { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Single sign-on failed');
      })
      .finally(() => setBusy(false));
  }, [navigate]);

  const [step, setStep] = useState<'credentials' | 'otp' | 'agreement'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [trustDevice, setTrustDevice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreementCtx, setAgreementCtx] = useState<{
    signerType: 'property' | 'staff';
    signerId: string;
    propertyId: string;
    propertyName: string;
    role: AppRole;
    personName: string;
    contractTermMonths?: number;
    noticeDays?: number;
  } | null>(null);

  async function resolvePostAuthFlow(targetEmail: string, authUserId?: string) {
    const ctx = await callLoginContext();
    if (!ctx.authenticated || !ctx.role) {
      throw new Error('Account context unavailable');
    }

    if (!ctx.trustedDevice && step === 'credentials') {
      await callSendOtp({ email: targetEmail, purpose: 'new_device' });
      setStep('otp');
      return;
    }

    if (ctx.needsPropertyAgreement && ctx.propertyId && ctx.propertyName) {
      setAgreementCtx({
        signerType: 'property',
        signerId: ctx.propertyId,
        propertyId: ctx.propertyId,
        propertyName: ctx.propertyName,
        role: ctx.role as AppRole,
        personName: ctx.personName || '',
        contractTermMonths: ctx.contractTermMonths,
        noticeDays: ctx.noticeDays,
      });
      setStep('agreement');
      return;
    }

    if (ctx.needsStaffAgreement && ctx.personId && ctx.propertyId && ctx.propertyName) {
      setAgreementCtx({
        signerType: 'staff',
        signerId: ctx.personId,
        propertyId: ctx.propertyId,
        propertyName: ctx.propertyName,
        role: ctx.role as AppRole,
        personName: ctx.personName || '',
      });
      setStep('agreement');
      return;
    }

    void authUserId;
    navigate(getRoleHomeRoute(ctx.role as AppRole));
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (import.meta.env.DEV) {
        const normalized = email.trim().toLowerCase();
        const matched = (Object.entries(DEV_PERSONAS) as Array<[Exclude<DevPersonaKey, 'signed_out'>, typeof DEV_PERSONAS.super_admin]>).find(
          ([, p]) => p.email.toLowerCase() === normalized
        );
        if (!matched) {
          throw new Error('In local dev mode, enter a seeded email (e.g. maria.garcia@frontdesktip.test) or use the Dev Persona selector.');
        }
        switchDevPersona(matched[0]);
        await resolvePostAuthFlow(normalized, matched[1].authUserId);
      } else {
        const { data, error: authErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authErr || !data.user) {
          throw new Error(authErr?.message || 'Invalid email or password');
        }
        await resolvePostAuthFlow(email.trim(), data.user.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  function handleOtpChange(idx: number, raw: string) {
    const cleaned = raw.replace(/\D/g, '');
    if (cleaned.length > 1) {
      const next = [...otpDigits];
      cleaned
        .slice(0, 6)
        .split('')
        .forEach((ch, offset) => {
          if (idx + offset < 6) next[idx + offset] = ch;
        });
      setOtpDigits(next);
      return;
    }
    const next = [...otpDigits];
    next[idx] = cleaned;
    setOtpDigits(next);
    if (cleaned && idx < 5) {
      const nextEl = document.getElementById(`login-otp-${idx + 1}`);
      nextEl?.focus();
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otpDigits.join('');
    if (code.length < 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await callVerifyOtp({
        email: email.trim(),
        purpose: 'new_device',
        code,
        trustDevice,
      });
      if (!res.verified) {
        throw new Error(res.reason || 'Invalid verification code');
      }
      await resolvePostAuthFlow(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
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
          <h1 className="serif-display text-2xl font-semibold">Team Sign In</h1>
          <p className="text-sm text-[#F5EBE0]/90">
            FrontDesk Tip hospitality portal
          </p>
        </header>

        <AnimatePresence mode="wait">
          {step === 'credentials' && (
            <motion.form
              key="creds"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.18, ease: MOTION.easeOutEnter }}
              onSubmit={handleCredentialsSubmit}
              className="glass-card-heavy rounded-2xl p-5 space-y-4"
            >
              <label className="block space-y-1 text-xs">
                <span className="text-[#F5EBE0]/90 font-medium">Work Email</span>
                <div className="flex items-center rounded-xl border border-[#FAF6F0]/25 bg-[#FAF6F0]/10 px-3 h-10 gap-2">
                  <Mail className="w-4 h-4 text-[#E6C79C]" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="maria.garcia@frontdesktip.test"
                    className="w-full bg-transparent text-sm text-[#FAF6F0] outline-none placeholder:text-[#FAF6F0]/60"
                  />
                </div>
              </label>

              <label className="block space-y-1 text-xs">
                <span className="text-[#F5EBE0]/90 font-medium">Password</span>
                <div className="flex items-center rounded-xl border border-[#FAF6F0]/25 bg-[#FAF6F0]/10 px-3 h-10 gap-2">
                  <Lock className="w-4 h-4 text-[#E6C79C]" />
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-transparent text-sm text-[#FAF6F0] outline-none placeholder:text-[#FAF6F0]/60"
                  />
                </div>
              </label>

              {error && (
                <p className="rounded-lg bg-[#7F1D1D]/60 border border-[#FCA5A5]/40 px-3 py-2 text-xs text-[#FEE2E2]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full h-10 rounded-xl bg-[#FAF3E8] text-[#21150E] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{busy ? 'Signing In...' : 'Continue'}</span>
              </button>
            </motion.form>
          )}

          {step === 'otp' && (
            <motion.form
              key="otp"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: MOTION.easeOutEnter }}
              onSubmit={handleVerifyOtp}
              className="glass-card-heavy rounded-2xl p-5 space-y-4"
            >
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Verify New Device</h2>
                <p className="text-xs text-[#F5EBE0]/85">
                  Enter the 6-digit code sent to {email}
                </p>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    id={`login-otp-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    className="h-11 rounded-xl border border-[#FAF6F0]/30 bg-[#FAF6F0]/10 text-center text-base font-bold tabular-nums text-[#FAF6F0] outline-none focus:border-[#E6C79C]"
                  />
                ))}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#F5EBE0]/90 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                />
                <span>Trust this browser for 30 days</span>
              </label>

              {error && (
                <p className="rounded-lg bg-[#7F1D1D]/60 border border-[#FCA5A5]/40 px-3 py-2 text-xs text-[#FEE2E2]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full h-10 rounded-xl bg-[#FAF3E8] text-[#21150E] font-semibold text-sm cursor-pointer disabled:opacity-60"
              >
                {busy ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </motion.form>
          )}

          {step === 'agreement' && agreementCtx && (
            <motion.div
              key="agreement"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: MOTION.easeOutEnter }}
            >
              <AgreementSigningCard
                signerType={agreementCtx.signerType}
                signerId={agreementCtx.signerId}
                propertyId={agreementCtx.propertyId}
                propertyName={agreementCtx.propertyName}
                defaultTypedName={agreementCtx.personName}
                contractTermMonths={agreementCtx.contractTermMonths}
                noticeDays={agreementCtx.noticeDays}
                onSigned={() => navigate(getRoleHomeRoute(agreementCtx.role))}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
