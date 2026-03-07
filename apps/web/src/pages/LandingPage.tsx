import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Globe,
  Headphones,
  Mic,
  Phone,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CyberBackground3D } from '../components/CyberBackground3D.js';

function Section({
  children,
  className = '',
  delay = 0,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      id={id}
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={reduceMotion ? undefined : { duration: 0.5, ease: 'easeOut' as const, delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

const CAPABILITIES = [
  {
    icon: <PhoneCall className="h-6 w-6" />,
    title: 'Answer every call',
    description:
      'Voice picks up after-hours, overflow, and missed desk calls so new customers do not hit voicemail.',
  },
  {
    icon: <CalendarCheck className="h-6 w-6" />,
    title: 'Qualify and schedule',
    description:
      'The assistant captures the customer request, checks availability, and books the job when a time is confirmed.',
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: 'Escalate the urgent ones',
    description:
      'Urgent calls can be routed to a real person immediately while routine bookings stay automated.',
  },
];

const STEPS = [
  {
    number: '01',
    icon: <Phone className="h-5 w-5" />,
    title: 'Tell Voice about your business',
    description:
      'Add your services, hours, FAQs, and escalation rules so the assistant knows what to say.',
  },
  {
    number: '02',
    icon: <Bot className="h-5 w-5" />,
    title: 'Forward your number',
    description:
      'Keep your existing phone line and send unanswered or after-hours calls to Voice in a few minutes.',
  },
  {
    number: '03',
    icon: <CalendarCheck className="h-5 w-5" />,
    title: 'Let it answer, book, and update your team',
    description:
      'Calls turn into clear summaries, new jobs, and calendar-ready bookings in one shared workspace.',
  },
];

const METRICS = [
  {
    icon: <Clock className="h-5 w-5" />,
    value: '24/7',
    label: 'Coverage',
    detail: 'Handles after-hours and overflow calls automatically.',
  },
  {
    icon: <Headphones className="h-5 w-5" />,
    value: '<2 min',
    label: 'Setup path',
    detail: 'Forward your number and start with your current line.',
  },
  {
    icon: <CheckCircle2 className="h-5 w-5" />,
    value: '1 inbox',
    label: 'Team view',
    detail: 'Calls, summaries, and bookings stay in one place.',
  },
  {
    icon: <Globe className="h-5 w-5" />,
    value: 'Calendar-ready',
    label: 'Booking flow',
    detail: 'Confirmed jobs can sync into Google Calendar.',
  },
];

const NAV_ITEMS = [
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'System', href: '#system' },
  { label: 'Metrics', href: '#metrics' },
];

export function LandingPage() {
  const reduceMotion = useReducedMotion();

  const navbar = (
    <nav className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#08111a]/78 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-3 text-white hover:text-white">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00f3ff]/30 bg-[#00f3ff]/12 text-[#00f3ff] shadow-[0_12px_32px_rgba(0,243,255,0.12)]">
              <Mic className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
            <span className="text-[1.15rem] font-bold tracking-[-0.03em]">
              Voice
            </span>
            <span className="text-[0.68rem] uppercase tracking-[0.28em] text-[#d2d8e2]">
              AI call intake
            </span>
          </div>
        </a>

        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-xs font-semibold text-[#d6dde8] transition hover:bg-white/[0.08] hover:text-white sm:px-4 sm:text-sm"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-semibold text-[#d6dde8] transition hover:bg-white/[0.08] hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full border border-[#00f3ff]/35 bg-[#00f3ff]/12 px-5 py-2.5 text-sm font-bold text-white shadow-[0_16px_40px_rgba(0,243,255,0.14)] transition hover:-translate-y-0.5 hover:bg-[#00f3ff]/18 hover:text-white"
          >
            Start setup
          </Link>
        </div>
      </div>
    </nav>
  );

  return (
    <CyberBackground3D isScrollable overlay={navbar}>
      <div className="relative overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(0,243,255,0.08),transparent_34%),radial-gradient(circle_at_85%_0%,rgba(157,0,255,0.06),transparent_32%),linear-gradient(180deg,#040407_0%,#0b0d12_100%)] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:120px_120px] opacity-[0.08]" />

        <section className="relative min-h-[100vh] px-6 pb-16 pt-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="pointer-events-auto max-w-3xl">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.45 }}
                className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#00f3ff]"
              >
                <span className="h-2 w-2 rounded-full bg-[#00f3ff]" />
                Built for local service teams
              </motion.div>

              <motion.h1
                initial={reduceMotion ? false : { opacity: 0, y: 28 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.65, delay: 0.08 }}
                className="mb-6 text-[clamp(3rem,7vw,6.2rem)] font-extrabold leading-[0.95] tracking-[-0.05em] text-white"
              >
                AI phone answering for service businesses
              </motion.h1>

              <motion.p
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.55, delay: 0.16 }}
                className="mb-8 max-w-2xl text-lg leading-8 text-[#d8dee8] md:text-xl"
              >
                Voice answers every call, captures what the customer needs, and books the job or
                hands urgent calls to your team right away.
              </motion.p>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.55, delay: 0.24 }}
                className="mb-8 flex flex-col gap-4 sm:flex-row"
              >
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-[#00f3ff]/35 bg-[#00f3ff]/12 px-7 py-4 text-base font-bold text-white shadow-[0_18px_48px_rgba(0,243,255,0.16)] transition hover:-translate-y-0.5 hover:bg-[#00f3ff]/18 hover:text-white"
                >
                  Start setup <ArrowRight className="h-5 w-5" />
                </Link>
                <a
                  href="#system"
                  className="inline-flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.07] px-7 py-4 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/[0.28] hover:bg-white/[0.12]"
                >
                  See how it works
                </a>
              </motion.div>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.55, delay: 0.32 }}
                className="flex flex-wrap gap-3 text-sm text-[#d6dde8]"
              >
                {['Plumbers', 'Salons', 'Clinics', 'Restaurants', 'Field service teams'].map(
                  (item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-[#112234]/80 px-4 py-2"
                    >
                      {item}
                    </span>
                  ),
                )}
              </motion.div>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 28 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              transition={reduceMotion ? undefined : { duration: 0.7, delay: 0.18 }}
              className="pointer-events-auto relative"
            >
              <div className="absolute inset-x-[12%] top-8 h-40 rounded-full bg-[#00f3ff]/14 blur-3xl" />
              <div className="relative overflow-hidden rounded-[32px] border border-white/[0.12] bg-black/40 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.26em] text-[#8ea1b8]">
                      Example call flow
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                      New booking handled without voicemail
                    </h2>
                  </div>
                  <div className="rounded-full border border-[#00f3ff]/30 bg-[#00f3ff]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#8ff7ff]">
                    Live ready
                  </div>
                </div>

                <div className="space-y-4 rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
                  {[
                    'Customer calls after hours asking for a next-day appointment.',
                    'Voice confirms service type, location, and preferred time.',
                    'Urgent requests can route to your on-call phone immediately.',
                    'Confirmed jobs appear as a summary with a booking-ready next step.',
                  ].map((line) => (
                    <div key={line} className="flex items-start gap-3 rounded-2xl bg-white/5 p-4">
                      <div className="mt-0.5 rounded-full bg-[#00f3ff]/12 p-2 text-[#00f3ff]">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <p className="text-sm leading-6 text-[#e0e7f0]">{line}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.05] p-5">
                    <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#8ea1b8]">
                      What it captures
                    </p>
                    <ul className="space-y-3 text-sm text-[#dce3ed]">
                      <li className="flex items-center gap-3">
                        <PhoneCall className="h-4 w-4 text-[#f4c37d]" />
                        Caller details and call summary
                      </li>
                      <li className="flex items-center gap-3">
                        <CalendarCheck className="h-4 w-4 text-[#f4c37d]" />
                        Requested service and time
                      </li>
                      <li className="flex items-center gap-3">
                        <ShieldCheck className="h-4 w-4 text-[#f4c37d]" />
                        Urgency and escalation path
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#f4c37d]/10 p-5">
                    <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#00f3ff]">
                      Best for
                    </p>
                    <p className="text-sm leading-7 text-[#f7f0e4]">
                      Teams that lose leads when the phone rings during jobs, lunch, after-hours,
                      or peak scheduling windows.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <Section
          id="capabilities"
          className="relative mx-auto max-w-7xl px-6 py-14 scroll-mt-28"
        >
          <div className="mb-12 max-w-3xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
              Capabilities
            </p>
            <h2 className="mb-4 text-4xl font-extrabold tracking-[-0.04em] text-white md:text-5xl">
              Clear value, not generic AI promises
            </h2>
            <p className="text-lg leading-8 text-[#d5dce7]">
              The product is simple: answer calls, collect the right information, and move the
              customer to a booking or the right human.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {CAPABILITIES.map((item, index) => (
              <Section key={item.title} delay={index * 0.08}>
                <div className="h-full rounded-[28px] border border-white/10 bg-black/40 p-7 shadow-[0_24px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition hover:-translate-y-1 hover:border-[#00f3ff]/24 hover:bg-white/[0.05]">
                  <div className="mb-6 inline-flex rounded-2xl border border-[#00f3ff]/24 bg-[#00f3ff]/10 p-3 text-[#00f3ff]">
                    {item.icon}
                  </div>
                  <h3 className="mb-3 text-2xl font-semibold tracking-[-0.03em] text-white">
                    {item.title}
                  </h3>
                  <p className="text-base leading-7 text-[#d6dde8]">{item.description}</p>
                </div>
              </Section>
            ))}
          </div>
        </Section>

        <Section id="system" className="relative mx-auto max-w-7xl px-6 py-16 scroll-mt-28">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
                System
              </p>
              <h2 className="mb-4 text-4xl font-extrabold tracking-[-0.04em] text-white md:text-5xl">
                Set it up once, then let it keep the phone moving
              </h2>
              <p className="text-lg leading-8 text-[#d5dce7]">
                Voice is designed for operators, not engineers. The setup follows the way your
                team already works: services, hours, calendar, and who should get the urgent calls.
              </p>
            </div>

            <div className="space-y-5">
              {STEPS.map((step, index) => (
                <Section key={step.number} delay={index * 0.08}>
                  <div className="grid gap-4 rounded-[28px] border border-white/10 bg-black/40 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:grid-cols-[auto_1fr] sm:items-start">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00f3ff]/20 bg-[#00f3ff]/10 text-base font-bold text-[#00f3ff]">
                        {step.number}
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-[#00f3ff]">
                        {step.icon}
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                        {step.title}
                      </h3>
                      <p className="text-base leading-7 text-[#d6dde8]">{step.description}</p>
                    </div>
                  </div>
                </Section>
              ))}
            </div>
          </div>
        </Section>

        <Section id="metrics" className="relative mx-auto max-w-7xl px-6 py-16 scroll-mt-28">
          <div className="mb-12 max-w-3xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
              Metrics
            </p>
            <h2 className="mb-4 text-4xl font-extrabold tracking-[-0.04em] text-white md:text-5xl">
              What the product improves on day one
            </h2>
            <p className="text-lg leading-8 text-[#d5dce7]">
              These are the outcomes the landing page should make obvious: better call coverage,
              clearer handoffs, and fewer lost booking opportunities.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {METRICS.map((metric, index) => (
              <Section key={metric.label} delay={index * 0.08}>
                <div className="h-full rounded-[28px] border border-white/10 bg-black/40 p-6 backdrop-blur-2xl transition hover:-translate-y-1 hover:border-[#00f3ff]/22 hover:bg-white/[0.05]">
                  <div className="mb-5 inline-flex rounded-2xl border border-[#00f3ff]/22 bg-[#00f3ff]/10 p-3 text-[#8ff7ff]">
                    {metric.icon}
                  </div>
                  <p className="mb-2 text-4xl font-semibold tracking-[-0.04em] text-white">
                    {metric.value}
                  </p>
                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-[#8ea1b8]">
                    {metric.label}
                  </p>
                  <p className="text-sm leading-7 text-[#d6dde8]">{metric.detail}</p>
                </div>
              </Section>
            ))}
          </div>
        </Section>

        <Section className="relative px-6 pb-20 pt-12">
          <div className="mx-auto max-w-5xl rounded-[36px] border border-white/10 bg-black/40 p-8 shadow-[0_28px_80px_rgba(0,0,0,0.25)] backdrop-blur-2xl md:p-12">
            <div className="grid gap-8 md:grid-cols-[1.05fr_auto] md:items-center">
              <div>
                <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-[#00f3ff]">
                  Ready to see your setup
                </p>
                <h2 className="mb-4 text-4xl font-extrabold tracking-[-0.04em] text-white md:text-5xl">
                  Stop sending customers to voicemail
                </h2>
                <p className="max-w-2xl text-lg leading-8 text-[#eef3f8]">
                  Use Voice to answer more calls, book more work, and keep urgent requests moving
                  to the right person.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-[#00f3ff]/35 bg-[#00f3ff]/12 px-7 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#00f3ff]/18 hover:text-white"
                >
                  Start setup <ArrowRight className="h-5 w-5" />
                </Link>
                <a
                  href="#capabilities"
                  className="inline-flex items-center justify-center rounded-full border border-white/[0.18] bg-white/[0.08] px-7 py-4 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/[0.3] hover:bg-white/[0.12]"
                >
                  Review capabilities
                </a>
              </div>
            </div>
          </div>
        </Section>

        <footer className="relative border-t border-white/8 px-6 py-10">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-[#aab5c4] md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#00f3ff]/30 bg-[#00f3ff]/10 text-[#00f3ff]">
                <Mic className="h-4 w-4" />
              </div>
              <div>
                <p className="text-lg font-bold tracking-[-0.03em] text-white">
                  Voice
                </p>
                <p className="text-xs uppercase tracking-[0.22em] text-[#8ea1b8]">
                  AI call intake for local businesses
                </p>
              </div>
            </div>
            <p>Answer more calls. Book more work. Escalate the urgent ones.</p>
          </div>
        </footer>
      </div>
    </CyberBackground3D>
  );
}
