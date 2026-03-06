import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  PhoneCall,
  CalendarCheck,
  ShieldCheck,
  ArrowRight,
  Zap,
  Clock,
  CheckCircle2,
  Phone,
  Headphones,
  Bot,
  Globe,
  Mic,
  Activity,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CyberBackground3D } from '../components/CyberBackground3D.js';

/* ─── animated counter ─── */
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      setCount(value);
      return;
    }
    if (!inView) return;
    let frame: number;
    const duration = 2000;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      setCount(Math.floor(ease * value));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduceMotion, value]);

  return (
    <span ref={ref}>
      {count.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ─── section reveal wrapper ─── */
function Section({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={reduceMotion ? undefined : { duration: 0.55, ease: 'easeOut' as const, delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ─── data ─── */
const FEATURES = [
  {
    icon: <PhoneCall className="w-6 h-6" />,
    color: 'blue',
    title: '24/7 Intelligent Answering',
    desc: 'Our AI voice agents pick up every call in under 2 seconds — simultaneously. Zero hold times, zero missed revenue, even at 3 AM.',
  },
  {
    icon: <CalendarCheck className="w-6 h-6" />,
    color: 'purple',
    title: 'Instant Booking & Calendar Sync',
    desc: 'Connects directly to Google Calendar to book, reschedule, or cancel appointments. Clients get confirmation SMS automatically.',
  },
  {
    icon: <ShieldCheck className="w-6 h-6" />,
    color: 'emerald',
    title: 'Smart Escalation & Routing',
    desc: 'Detects urgency, frustration, and high-value opportunities in real-time — routes the call to the right human instantly.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Connect your line',
    desc: 'Forward your business phone to Voice Ops. Takes 2 minutes with any provider.',
    icon: <Phone className="w-5 h-5" />,
  },
  {
    num: '02',
    title: 'Train the AI',
    desc: 'Add your services, FAQs, and business hours. The assistant learns your voice in one session.',
    icon: <Bot className="w-5 h-5" />,
  },
  {
    num: '03',
    title: 'Go live',
    desc: 'Flip the switch. Calls are answered, qualified, and booked — while you focus on your work.',
    icon: <Zap className="w-5 h-5" />,
  },
];

const STATS = [
  { value: 50000, suffix: '+', label: 'Calls handled', icon: <Headphones className="w-5 h-5" /> },
  { value: 98, suffix: '%', label: 'Booking accuracy', icon: <CheckCircle2 className="w-5 h-5" /> },
  { value: 2, suffix: 's', label: 'Avg pickup time', icon: <Clock className="w-5 h-5" /> },
  { value: 4, suffix: '+', label: 'Languages supported', icon: <Globe className="w-5 h-5" /> },
];

/* ─── page ─── */
export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const navbar = (
    <nav className="fixed top-0 w-full z-50 bg-[#020202]/72 backdrop-blur-md border-b border-white/5 shadow-xl">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00f3ff]/20 to-[#9d00ff]/20 flex items-center justify-center border border-[#00f3ff]/30">
            <Mic className="text-[#00f3ff] w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight font-[Manrope]">Voice Ops</span>
        </div>

        <div className="hidden md:flex items-center gap-10 text-sm font-semibold tracking-wide text-gray-400 uppercase">
          <span className="hover:text-white transition-colors cursor-pointer">Capabilities</span>
          <span className="hover:text-white transition-colors cursor-pointer">System</span>
          <span className="hover:text-white transition-colors cursor-pointer">Metrics</span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className="hidden sm:inline-flex text-sm font-bold text-gray-400 hover:text-white transition-colors uppercase tracking-wide"
          >
            Sign In
          </Link>
          <Link
            to="/login"
            className="px-6 py-2.5 rounded-full text-sm font-bold uppercase tracking-wide bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20 shadow-[0_0_18px_rgba(0,243,255,0.12)] transition-all hover:shadow-[0_0_28px_rgba(0,243,255,0.2)]"
          >
            Initialize
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <CyberBackground3D isScrollable overlay={navbar}>
      {/* ━━━━━━━━━━━━━━━ 1. HERO (PAGE 1) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col items-center justify-center px-6 pt-20">
        <div className="max-w-6xl mx-auto text-center pointer-events-auto">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
            transition={reduceMotion ? undefined : { duration: 0.65, ease: 'easeOut' }}
          >
            <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white/[0.03] backdrop-blur-md border border-white/[0.1] text-xs font-bold tracking-widest uppercase text-cyan-400 mb-10 shadow-[0_0_20px_rgba(0,243,255,0.1)]">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(0,243,255,0.8)]" />
              System Active: 50,000+ Calls/Month
            </div>
          </motion.div>

          <motion.h1
            initial={reduceMotion ? false : { opacity: 0, y: 30 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.8, delay: 0.12, ease: 'easeOut' }}
            className="text-[clamp(3.5rem,8vw,8rem)] font-extrabold tracking-[-0.05em] leading-[0.9] mb-8 font-[Manrope] uppercase"
          >
            We Build <br />
            <span
              className={`text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] via-[#9d00ff] to-[#00f3ff] bg-[length:200%_auto] ${reduceMotion ? '' : 'animate-[gradient-shift_4s_linear_infinite]'}`}
            >
              Digital Realities
            </span>
          </motion.h1>

          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.55, delay: 0.22 }}
            className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-12 leading-relaxed font-light"
          >
            Automated voice operations for the modern enterprise. Scale your front desk infinitely
            with human-level AI intelligence.
          </motion.p>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? undefined : { duration: 0.55, delay: 0.32 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-6"
          >
            <a
              href="/login"
              className="hero-cta w-full sm:w-auto px-10 py-5 rounded-full text-lg font-black uppercase tracking-[0.18em] transition-all flex items-center justify-center gap-3 hover:scale-[1.02]"
            >
              Deploy Now <ArrowRight className="w-5 h-5" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━ 2. FEATURES (PAGE 2) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col justify-center px-6 py-20 pointer-events-none">
        <div className="max-w-7xl mx-auto w-full pointer-events-auto">
          <Section className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-[#00f3ff] uppercase mb-4">
              Core Architecture
            </p>
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tighter uppercase font-[Manrope] mb-6 shadow-black drop-shadow-2xl">
              Beyond Human Capacity
            </h2>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {FEATURES.map((f, i) => (
              <Section key={i} delay={i * 0.1}>
                <div className="group relative h-full rounded-3xl border border-white/10 bg-black/40 backdrop-blur-md p-10 transition-all duration-400 hover:bg-white/5 hover:border-white/20 hover:-translate-y-1 shadow-[0_0_24px_rgba(0,0,0,0.42)]">
                  <div className="relative z-10 w-16 h-16 rounded-2xl flex items-center justify-center mb-8 border border-white/10 bg-white/5 text-white group-hover:bg-[#00f3ff]/10 group-hover:text-[#00f3ff] group-hover:border-[#00f3ff]/30 transition-all duration-500 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                    {f.icon}
                  </div>
                  <h3 className="relative z-10 text-2xl font-bold mb-4 font-[Manrope] tracking-tight">
                    {f.title}
                  </h3>
                  <p className="relative z-10 text-gray-400 leading-relaxed text-lg">{f.desc}</p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━ 3. HOW IT WORKS (PAGE 3) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col justify-center px-6 py-20 pointer-events-none">
        <div className="max-w-6xl mx-auto w-full pointer-events-auto">
          <Section className="text-center mb-20">
            <p className="text-sm font-bold tracking-widest text-[#9d00ff] uppercase mb-4">
              Integration Protocol
            </p>
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tighter uppercase font-[Manrope] mb-6 shadow-black drop-shadow-2xl">
              Seamless deployment
            </h2>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {STEPS.map((s, i) => (
              <Section key={i} delay={i * 0.15}>
                <div className="relative p-8 rounded-3xl border border-white/10 bg-black/40 backdrop-blur-md shadow-xl">
                  <div className="absolute -top-6 -left-6 w-16 h-16 rounded-2xl bg-gradient-to-br from-[#9d00ff] to-[#00f3ff] flex items-center justify-center text-xl font-black shadow-[0_0_30px_rgba(157,0,255,0.4)]">
                    {s.num}
                  </div>
                  <div className="mt-6">
                    <h3 className="text-2xl font-bold mb-4 font-[Manrope] tracking-tight uppercase">
                      {s.title}
                    </h3>
                    <p className="text-gray-400 text-lg leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━ 4. DASHBOARD PREVIEW (PAGE 4) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col justify-center px-6 py-20 pointer-events-none">
        <div className="max-w-6xl mx-auto w-full pointer-events-auto">
          <Section className="text-center mb-16">
            <p className="text-sm font-bold tracking-widest text-emerald-400 uppercase mb-4">
              Command Center
            </p>
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tighter uppercase font-[Manrope] mb-6 shadow-black drop-shadow-2xl">
              Absolute Control
            </h2>
          </Section>

          <Section>
            <div className="rounded-3xl border border-white/20 bg-black/50 backdrop-blur-xl overflow-hidden shadow-[0_0_44px_rgba(0,0,0,0.62)]">
              <div className="flex items-center gap-4 px-6 py-4 border-b border-white/10 bg-white/5">
                <div className="flex gap-2">
                  <div className="w-4 h-4 rounded-full bg-red-500/80 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                  <div className="w-4 h-4 rounded-full bg-yellow-500/80 shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
                  <div className="w-4 h-4 rounded-full bg-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="px-6 py-1.5 rounded-lg bg-black/50 text-xs text-gray-400 font-mono tracking-widest border border-white/5">
                    system.voiceops.ai/telemetry
                  </div>
                </div>
              </div>
              <div className="p-8 md:p-12">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
                  {[
                    {
                      label: 'Network Calls',
                      val: '1,247',
                      trend: '+12%',
                      color: 'text-emerald-400',
                    },
                    { label: 'Resolved', val: '892', trend: '+8%', color: 'text-cyan-400' },
                    { label: 'Anomalies', val: '23', trend: '-15%', color: 'text-purple-400' },
                    { label: 'Latency', val: '1.2s', trend: '', color: 'text-gray-300' },
                  ].map((kpi, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md"
                    >
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                        {kpi.label}
                      </p>
                      <p className="text-4xl font-black font-[Manrope] tracking-tighter">
                        {kpi.val}
                      </p>
                      {kpi.trend && (
                        <p className={`text-sm font-bold mt-2 ${kpi.color}`}>{kpi.trend} shift</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md">
                  <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
                      Live Telemetry Stream
                    </span>
                  </div>
                  {[
                    {
                      phone: 'NODE-A // +41 79 *** 42',
                      intent: 'Transaction',
                      time: 'SYNC: -2m',
                      status: 'OPTIMAL',
                      statusColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                    },
                    {
                      phone: 'NODE-B // +41 78 *** 18',
                      intent: 'Query',
                      time: 'SYNC: -8m',
                      status: 'OPTIMAL',
                      statusColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
                    },
                    {
                      phone: 'NODE-F // +41 76 *** 91',
                      intent: 'Critical',
                      time: 'SYNC: -15m',
                      status: 'REROUTED',
                      statusColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                    },
                  ].map((call, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-5 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors gap-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-400">
                          <Activity className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold tracking-wider font-mono text-gray-200">
                            {call.phone}
                          </p>
                          <p className="text-xs text-gray-500 tracking-widest uppercase mt-1">
                            [{call.intent}] · {call.time}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-md border ${call.statusColor}`}
                      >
                        {call.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━ 5. STATS (PAGE 5) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col justify-center px-6 py-20 pointer-events-none">
        <div className="max-w-6xl mx-auto w-full pointer-events-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-16">
            {STATS.map((s, i) => (
              <Section key={i} delay={i * 0.1} className="text-center group">
                <div className="w-16 h-16 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-md flex items-center justify-center text-[#00f3ff] mx-auto mb-6 group-hover:scale-110 group-hover:bg-white/10 transition-all duration-500 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                  {s.icon}
                </div>
                <p className="text-5xl md:text-7xl font-black font-[Manrope] tracking-tighter mb-4 text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                </p>
                <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">
                  {s.label}
                </p>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ━━━━━━━━━━━━━━━ 6. CTA + FOOTER (PAGE 6) ━━━━━━━━━━━━━━━ */}
      <section className="min-h-[100vh] flex flex-col justify-end pointer-events-none">
        <div className="flex-1 flex flex-col justify-center px-6 w-full max-w-4xl mx-auto text-center pointer-events-auto">
          <Section>
            <h2 className="text-5xl md:text-8xl font-black tracking-tighter uppercase font-[Manrope] mb-8 leading-[0.9] shadow-black drop-shadow-2xl">
              Initiate Sequence
            </h2>
            <p className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              Join the vanguard of service businesses using next-generation AI to systematically
              capture every opportunity.
            </p>
            <a
              href="/login"
              className="inline-flex items-center gap-4 px-12 py-6 rounded-full text-xl font-black uppercase tracking-widest bg-white text-black shadow-[0_0_50px_rgba(255,255,255,0.3)] hover:shadow-[0_0_80px_rgba(255,255,255,0.6)] hover:bg-gray-200 transition-all hover:scale-105"
            >
              Begin Protocol <Zap className="w-6 h-6" />
            </a>
          </Section>
        </div>

        <footer className="w-full border-t border-white/10 bg-black/80 backdrop-blur-2xl px-6 py-12 pointer-events-auto mt-auto">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#00f3ff]/20 flex items-center justify-center border border-[#00f3ff]/40">
                <Mic className="text-[#00f3ff] w-4 h-4" />
              </div>
              <span className="text-lg font-black font-[Manrope] tracking-widest uppercase">
                Voice Ops
              </span>
            </div>
            <p className="text-sm text-gray-500 font-medium tracking-wide">
              © {new Date().getFullYear()} VOICE OPS AI. ALL SYSTEMS NOMINAL.
            </p>
            <div className="flex gap-8 text-sm font-bold tracking-widest text-gray-500 uppercase">
              <span className="hover:text-white transition-colors cursor-pointer">Privacy</span>
              <span className="hover:text-white transition-colors cursor-pointer">Terms</span>
              <span className="hover:text-white transition-colors cursor-pointer">Contact</span>
            </div>
          </div>
        </footer>
      </section>
    </CyberBackground3D>
  );
}
