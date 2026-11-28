import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  FileScan,
  KeyRound,
  Lock,
  QrCode,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getRoleHomeRoute } from '../shared/types';

const PRESET_AMOUNTS = [10, 20, 50, 100];

const ARCHITECTURE_PILLARS = [
  {
    icon: QrCode,
    eyebrow: '01 · GUEST CHECKOUT',
    title: 'Zero-App QR & NFC Tipping',
    description:
      'Guests scan a room tent, valet tag, or concierge card and tip in under 8 seconds with Apple Pay, Google Pay, or card — no app install required.',
    badge: 'Stripe Express',
  },
  {
    icon: FileScan,
    eyebrow: '02 · SHIFT INTELLIGENCE',
    title: 'AI-Assisted Roster & PDF Parsing',
    description:
      'Upload daily housekeeping or valet sheets as PDFs or photos. Assignments map rooms to staff automatically for one-click manager approval.',
    badge: 'OCR + PDF',
  },
  {
    icon: Wallet,
    eyebrow: '03 · INSTANT SETTLEMENT',
    title: 'Immutable Ledger & Direct Payouts',
    description:
      'Double-entry ledger tracks every cent across individual tips and department pools, with T+0 instant withdrawals or automated weekly payouts.',
    badge: 'Connect T+0',
  },
];

const SECURITY_CONTROLS = [
  {
    icon: ShieldCheck,
    label: '22 Postgres RLS Policies',
    detail: 'Strict per-property & per-role row isolation at the database layer.',
  },
  {
    icon: Lock,
    label: 'Signed Digital Agreements',
    detail: 'Immutable timestamped staff onboarding & tip-pool consent records.',
  },
  {
    icon: KeyRound,
    label: 'Enterprise SSO & API Keys',
    detail: 'Scoped property API gateway, HMAC-verified webhooks, and SAML/OIDC.',
  },
  {
    icon: Building2,
    label: 'Multi-Property Command',
    detail: 'Centralized Super Admin oversight across resorts, fees, and compliance.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const [selectedAmount, setSelectedAmount] = useState<number>(20);
  const [tipSent, setTipSent] = useState<boolean>(false);

  const dashboardRoute = user ? getRoleHomeRoute(user.role) : '/login';

  function handleSimulateTip() {
    setTipSent(true);
    window.setTimeout(() => setTipSent(false), 3200);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#1c110a] text-[#faf6f0]">
      {/* Full-bleed resort backdrop + warm obsidian scrim */}
      <div
        className="pointer-events-none fixed inset-0 resort-photo-backdrop opacity-55"
        style={{ backgroundImage: "url('/assets/resort-backdrop.jpg')" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 resort-scrim-staff" aria-hidden="true" />

      {/* Subtle ambient champagne radial aura */}
      <motion.div
        data-motion="decorative"
        aria-hidden="true"
        animate={{ opacity: [0.35, 0.55, 0.35], scale: [1, 1.06, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none fixed -top-40 left-1/2 h-[540px] w-[780px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(230,199,156,0.22)_0%,rgba(140,94,26,0.06)_48%,transparent_72%)] blur-3xl"
      />

      {/* Top Navigation */}
      <header className="relative z-20 mx-auto max-w-7xl px-4 pt-5 sm:px-8">
        <nav className="glass-surface flex items-center justify-between rounded-2xl px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#E6C79C] to-[#8C5E1A] text-[#1c110a] shadow-lg">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <span className="serif-display block text-lg font-semibold tracking-tight text-[#faf6f0]">
                FrontDesk Tip
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#E6C79C]/80">
                Hospitality OS
              </span>
            </div>
          </Link>

          <div className="hidden items-center gap-7 text-sm text-[#faf6f0]/80 md:flex">
            <a href="#live-preview" className="transition hover:text-[#E6C79C]">
              Live Preview
            </a>
            <a href="#architecture" className="transition hover:text-[#E6C79C]">
              Architecture
            </a>
            <a href="#security" className="transition hover:text-[#E6C79C]">
              Security
            </a>
          </div>

          <div className="flex items-center gap-2.5">
            {user ? (
              <Link
                to={dashboardRoute}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#E6C79C] to-[#cfa56a] px-4 py-2 text-sm font-semibold text-[#1c110a] shadow-lg transition hover:brightness-105"
              >
                Open Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden rounded-xl px-3.5 py-2 text-sm font-medium text-[#faf6f0]/85 transition hover:bg-white/10 sm:inline-flex"
                >
                  Staff Sign In
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#E6C79C] to-[#cfa56a] px-4 py-2 text-sm font-semibold text-[#1c110a] shadow-lg transition hover:brightness-105"
                >
                  Launch Portal
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-8 sm:pt-16">
        {/* Hero Split */}
        <section className="grid items-center gap-12 lg:grid-cols-12">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-7"
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#E6C79C]/35 bg-[#E6C79C]/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#E6C79C]">
              <Zap className="h-3.5 w-3.5" />
              Next-Gen Gratuity Infrastructure
            </div>

            <h1 className="serif-display glass-text-shadow text-4xl font-semibold leading-[1.06] tracking-tight text-[#faf6f0] sm:text-6xl">
              Instant, Cashless Tipping Built for{' '}
              <span className="bg-gradient-to-r from-[#F5E1C0] via-[#E6C79C] to-[#C28E42] bg-clip-text text-transparent">
                Modern Hospitality.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#faf6f0]/78 sm:text-lg">
              Turn every suite, valet stand, and concierge desk into a frictionless recognition
              moment. Guests tip in two taps with zero app downloads, while hotels automate shift
              assignments, pool splits, and Stripe Connect payouts.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to={dashboardRoute}
                className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#E6C79C] to-[#cfa56a] px-6 py-3.5 text-sm font-semibold text-[#1c110a] shadow-[0_12px_32px_rgba(230,199,156,0.28)] transition hover:scale-[1.01] hover:brightness-105"
              >
                {user ? 'Go to Your Workspace' : 'Enter Staff & Admin Portal'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#live-preview"
                className="glass-surface inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-sm font-medium text-[#faf6f0] transition hover:bg-white/20"
              >
                <QrCode className="h-4 w-4 text-[#E6C79C]" />
                Interactive Guest Flow
              </a>
            </div>

            {/* Crisp Telemetry Strip */}
            <div className="mt-10 grid grid-cols-3 gap-3 sm:gap-4">
              <div className="glass-surface rounded-2xl p-4">
                <div className="tabular-nums text-2xl font-bold text-[#E6C79C] sm:text-3xl">
                  &lt; 8s
                </div>
                <div className="mt-1 text-xs text-[#faf6f0]/70">Guest Apple Pay Checkout</div>
              </div>
              <div className="glass-surface rounded-2xl p-4">
                <div className="tabular-nums text-2xl font-bold text-[#E6C79C] sm:text-3xl">
                  100%
                </div>
                <div className="mt-1 text-xs text-[#faf6f0]/70">RLS Property Isolation</div>
              </div>
              <div className="glass-surface rounded-2xl p-4">
                <div className="tabular-nums text-2xl font-bold text-[#E6C79C] sm:text-3xl">
                  T+0
                </div>
                <div className="mt-1 text-xs text-[#faf6f0]/70">Instant Connect Payouts</div>
              </div>
            </div>
          </motion.div>

          {/* Interactive Futuristic Device Simulator */}
          <motion.div
            id="live-preview"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-5"
          >
            <div className="glass-card-heavy relative mx-auto max-w-md overflow-hidden rounded-[2rem] p-6">
              <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E6C79C]">
                    Paloma Oceanfront · Suite 412
                  </span>
                  <p className="mt-0.5 text-xs text-[#faf6f0]/65">
                    Live Room QR Preview
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Edge Ready
                </span>
              </div>

              <div className="flex items-center gap-4">
                <img
                  src="/assets/demo-maria.jpg"
                  alt="Maria Elena, Lead Room Attendant"
                  className="h-16 w-16 rounded-2xl border border-[#E6C79C]/40 object-cover shadow-md"
                />
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-[#E6C79C]/90">
                    Your Room Attendant
                  </div>
                  <div className="serif-display text-xl font-semibold text-[#faf6f0]">
                    Maria Elena
                  </div>
                  <div className="text-xs text-[#faf6f0]/70">
                    Housekeeping · Verified Staff Member
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2.5 flex items-center justify-between text-xs text-[#faf6f0]/70">
                  <span>Select Appreciation</span>
                  <span className="tabular-nums font-medium text-[#E6C79C]">
                    100% goes to Maria
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AMOUNTS.map((amount) => {
                    const active = selectedAmount === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          setSelectedAmount(amount);
                          setTipSent(false);
                        }}
                        className={`tabular-nums rounded-xl py-2.5 text-sm font-semibold transition ${
                          active
                            ? 'bg-gradient-to-b from-[#E6C79C] to-[#cfa56a] text-[#1c110a] shadow-md'
                            : 'border border-white/15 bg-white/5 text-[#faf6f0] hover:bg-white/15'
                        }`}
                      >
                        ${amount}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-[#faf6f0]/75">
                <div className="flex items-center justify-between">
                  <span>Guest Total</span>
                  <span className="tabular-nums font-semibold text-[#faf6f0]">
                    ${selectedAmount.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[#E6C79C]/90">
                  <span>Staff Wallet Credit</span>
                  <span className="tabular-nums font-semibold">
                    +${selectedAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSimulateTip}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E6C79C] to-[#cfa56a] px-5 py-3.5 text-sm font-semibold text-[#1c110a] shadow-lg transition hover:brightness-105"
              >
                {tipSent ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Simulated Tip Credited to Maria!
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Simulate ${selectedAmount} Instant Tip
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </section>

        {/* Architecture Bento Grid */}
        <section id="architecture" className="mt-24">
          <div className="mb-10 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E6C79C]">
              End-to-End Platform
            </span>
            <h2 className="serif-display mt-2 text-3xl font-semibold text-[#faf6f0] sm:text-4xl">
              Engineered for Guest Delight &amp; Audit-Grade Finance.
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {ARCHITECTURE_PILLARS.map((pillar, idx) => {
              const Icon = pillar.icon;
              return (
                <motion.div
                  key={pillar.title}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.5, delay: idx * 0.08 }}
                  className="glass-surface flex flex-col justify-between rounded-3xl p-6"
                >
                  <div>
                    <div className="mb-5 flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E6C79C]/15 text-[#E6C79C]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full border border-[#E6C79C]/30 bg-[#E6C79C]/10 px-3 py-1 text-[11px] font-semibold text-[#E6C79C]">
                        {pillar.badge}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E6C79C]/80">
                      {pillar.eyebrow}
                    </div>
                    <h3 className="serif-display mt-1.5 text-xl font-semibold text-[#faf6f0]">
                      {pillar.title}
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-[#faf6f0]/75">
                      {pillar.description}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Security & Enterprise Section */}
        <section id="security" className="mt-20">
          <div className="glass-card-heavy rounded-3xl p-7 sm:p-10">
            <div className="grid items-center gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#E6C79C]">
                  Security &amp; Compliance
                </span>
                <h2 className="serif-display mt-2 text-2xl font-semibold text-[#faf6f0] sm:text-3xl">
                  Built on Cloudflare Edge, Supabase RLS &amp; Stripe Connect.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[#faf6f0]/75">
                  Every property operates in a strictly isolated tenant boundary with immutable
                  signed staff agreements, rate-limited OTP onboarding, and webhook-verified
                  settlements.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
                {SECURITY_CONTROLS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-white/12 bg-white/5 p-4"
                    >
                      <div className="flex items-center gap-2.5 text-sm font-semibold text-[#E6C79C]">
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-[#faf6f0]/70">
                        {item.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-16 text-center">
          <div className="glass-surface mx-auto max-w-3xl rounded-3xl px-6 py-10 sm:px-10">
            <h2 className="serif-display text-2xl font-semibold text-[#faf6f0] sm:text-3xl">
              Ready to elevate your property&apos;s gratuity experience?
            </h2>
            <p className="mx-auto mt-2.5 max-w-xl text-sm text-[#faf6f0]/75">
              Sign in as Staff, Property Admin, Department Manager, or Super Admin to explore the
              live platform.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                to={dashboardRoute}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#E6C79C] to-[#cfa56a] px-6 py-3 text-sm font-semibold text-[#1c110a] shadow-lg transition hover:brightness-105"
              >
                {user ? 'Open Dashboard' : 'Sign In to FrontDesk Tip'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 bg-black/25 py-6 text-center text-xs text-[#faf6f0]/55">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-8">
          <span>FrontDesk Tip · Hospitality Gratuity Infrastructure</span>
          <div className="flex items-center gap-5">
            <Link to="/login" className="hover:text-[#E6C79C]">
              Portal Login
            </Link>
            <Link to="/staff" className="hover:text-[#E6C79C]">
              Staff Wallet
            </Link>
            <Link to="/admin/tips" className="hover:text-[#E6C79C]">
              Admin Tips
            </Link>
            <Link to="/super/dashboard" className="hover:text-[#E6C79C]">
              Super Admin
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
