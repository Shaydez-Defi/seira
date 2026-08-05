import { useEffect, useRef, useState, useCallback, useMemo } from "react";
/* ────────────────────────────────────────────────────────────
   SEIRA — design tokens
   Palette (capped 3 hues): ink, paper, pink (brand mark).
   Dark technical panels reuse ink as a surface, not a 4th hue.
   Type: Instrument Serif (display, restrained) + system-ui body
   + system mono for genuine data. No Google-default sans.
   ──────────────────────────────────────────────────────────── */

const TOKENS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
  :root{
    --ink:#15141a;
    --ink-soft:#4a4852;
    --ink-faint:#8b899193;
    --paper:#faf9f7;
    --paper-dim:#f1f0ec;
    --line: rgba(21,20,26,0.10);
    --line-dark: rgba(250,249,247,0.12);
    --pink:#ff1a5e;
    --pink-deep:#c2003f;
    --pink-tint:#ffe3ec;
    --font-display:'Instrument Serif', Georgia, serif;
    --font-body:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --ease-out: cubic-bezier(.16,1,.3,1);
    --ease-in-out: cubic-bezier(.65,0,.35,1);
  }
`;

const NAV_SECTIONS = [
  { id: "how", label: "How it Works" },
  { id: "architecture", label: "Architecture" },
  { id: "developers", label: "Developers" },
];

function SeiraMark({ size = 28, color = "var(--pink)" }) {
  return (
    <svg width={size} height={size * 0.66} viewBox="0 0 120 80" fill="none" aria-hidden="true">
      <path
        d="M52 30 C46 22, 36 17, 26 17 C13 17, 3 27, 3 40 C3 53, 13 63, 26 63 C34 63, 41 59, 46 53
           M68 50 C74 58, 84 63, 94 63 C107 63, 117 53, 117 40 C117 27, 107 17, 94 17 C86 17, 79 21, 74 27
           M46 53 C 40 60, 36 64, 36 40 C 36 30, 44 26, 52 30 C 60 34, 62 46, 68 50 C 74 54, 82 50, 74 27"
        stroke={color} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpRight({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 18L18 6M18 6H9M18 6V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ size = 14, color = "var(--pink)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5L9.5 18L20 6" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDown({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Full-width wavy divider that marks the boundary between the hero and the
   first section with a soft pink-tint band capped by a pink wave line. */
function SectionWave() {
  return (
    <div className="section-wave" aria-hidden="true">
      <svg viewBox="0 0 1440 72" preserveAspectRatio="none">
        <path
          d="M0,0 L1440,0 L1440,44 C1260,70 1080,12 900,44 C720,76 540,12 360,44 C180,76 60,12 0,44 Z"
          fill="var(--pink-tint)"
        />
        <path
          d="M0,44 C60,12 180,76 360,44 C540,12 720,76 900,44 C1080,12 1260,70 1440,44"
          fill="none"
          stroke="var(--pink)"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  );
}

/* Scroll reveal — content is opacity:1 always (never gated on the
   observer firing); it only settles into place a little as it enters
   view. Alternating direction + stagger so it isn't one uniform
   fade-up down the whole page. */
function Reveal({ children, stagger = 0, dir = "up", className = "" }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-dir={dir}
      className={`reveal ${inView ? "is-in" : ""} ${className}`}
      style={{ "--stagger": stagger }}
    >
      {children}
    </div>
  );
}

/* Custom dropdown — replaces the native <select> so the popup actually
   belongs to the site's design system instead of the OS sheet. */
function Select({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="sel" ref={wrapRef}>
      <span className="sel-label">{label}</span>
      <button type="button" className={`sel-trigger ${open ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{value}</span>
        <span className="sel-chevron"><ChevronDown /></span>
      </button>
      {open && (
        <div className="sel-menu">
          {options.map((opt, i) => (
            <button
              type="button"
              key={opt}
              className={`sel-option ${opt === value ? "is-selected" : ""}`}
              style={{ "--i": i }}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
              {opt === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CARD_STEPS = [
  { label: "You Pay", value: "54.73 XRP" },
  { label: "Routing", value: "via Seira Router" },
  { label: "Merchant Receives", value: "25 USDT0" },
];

function PaymentCard() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % CARD_STEPS.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pcard-stage">
      <div className="pcard-glow" />
      <div className="pcard">
        <div className="pcard-sheen" />
        <div className="pcard-edge" />
        <div className="pcard-head">
          <span className="pcard-merchant">Coffee House</span>
          <span className="pcard-live">Live</span>
        </div>

        <div className="pcard-amount">
          <span className="pcard-amount-k">Merchant receives</span>
          <span className="pcard-amount-v">25<span className="pcard-amount-unit">USDT0</span></span>
        </div>

        <div className="pcard-route">
          <span className="pcard-route-tag">via Seira Router</span>
          <div className="pcard-route-amounts">
            <span className="pcard-route-node">54.73 XRP</span>
            <span className="pcard-route-arrow">→</span>
            <span className="pcard-route-node">25 USDT0</span>
          </div>
        </div>

        <div className="pcard-hair" />
        <div className="pcard-row"><span className="pcard-k">Settlement time</span><span className="pcard-v pcard-v--mono">6 sec</span></div>

        <button className="pcard-cta">Confirm Payment</button>
      </div>
    </div>
  );
}

/* ── Problem section — a chain, not a card list ──────────── */
const MESSY_CHAIN = [
  { text: "Merchant wants USDT", bad: false },
  { text: "You own XRP", bad: false },
  { text: "Open DEX", bad: false },
  { text: "Swap", bad: false },
  { text: "Insufficient gas", bad: true },
  { text: "Bridge", bad: false },
  { text: "Network changed", bad: true },
  { text: "Retry", bad: false },
  { text: "Transaction failed", bad: true },
  { text: "Pay, finally", bad: false },
];
const CLEAN_CHAIN = [
  { text: "Merchant wants USDT0" },
  { text: "You own XRP" },
  { text: "Confirm payment. Done." },
];

function MessyChain() {
  return (
    <div className="chain chain--messy">
      <span className="chain-label">Today</span>
      <div className="chain-spine chain-spine--broken" />
      {MESSY_CHAIN.map((it, i) => (
        <div className={`chain-node ${it.bad ? "is-bad" : ""}`} key={i} style={{ "--i": i }}>
          <span className="chain-dot" />
          <span className="chain-text">{it.text}</span>
        </div>
      ))}
    </div>
  );
}

function CleanChain() {
  return (
    <div className="chain chain--clean">
      <span className="chain-label chain-label--pink">With Seira</span>
      <div className="chain-spine chain-spine--clean">
        <span className="chain-pulse" />
      </div>
      {CLEAN_CHAIN.map((it, i) => (
        <div className="chain-node chain-node--clean" key={i} style={{ "--i": i }}>
          <span className="chain-dot chain-dot--pink" />
          <span className="chain-text">{it.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ── How Seira Works ─────────────────────────────────────── */
const WORKS_CARDS = [
  {
    n: "01", title: "Create an Intent",
    body: "Seira understands what you want to achieve, not just what transaction you're signing.",
    visual: (
      <div className="works-visual">
        <span className="works-chip">Pay 25 <b>USDT0</b></span>
        <span className="works-chip works-chip--muted">wallet holds XRP</span>
      </div>
    ),
  },
  {
    n: "02", title: "Plan Settlement",
    body: "Seira evaluates available settlement routes and selects the safest path that satisfies your payment.",
    visual: (
      <div className="works-graph">
        <span className="works-node">FXRP</span>
        <span className="works-graph-line" />
        <span className="works-node works-node--active">USDT0</span>
      </div>
    ),
  },
  {
    n: "03", title: "Execute",
    body: "Every step confirms in order. Nothing is left ambiguous once you approve.",
    visual: (
      <div className="works-timeline">
        {["Approve", "Convert", "Transfer", "Verify"].map((s) => (
          <span key={s} className="works-tl-item"><Check size={12} /> {s}</span>
        ))}
      </div>
    ),
  },
];

/* ── Why it matters ──────────────────────────────────────── */
const MATTERS = [
  { role: "Buyer", line: "Pay using the assets you already own." },
  { role: "Merchant", line: "Receive exactly the assets you requested." },
  { role: "Developer", line: "Integrate one payment system instead of supporting every chain individually." },
];

/* ── Live demo ────────────────────────────────────────────── */
function LiveDemo() {
  const [buyAsset, setBuyAsset] = useState("XRP");
  const [receiveAsset, setReceiveAsset] = useState("USDT0");
  const [amount, setAmount] = useState(50);
  const [phase, setPhase] = useState("idle"); // idle | finding | done

  const run = useCallback(() => {
    setPhase("finding");
    setTimeout(() => setPhase("done"), 1400);
  }, []);

  return (
    <div className="demo-panel">
      <div className="demo-controls">
        <Select label="Buyer Asset" value={buyAsset} options={["XRP", "FXRP", "FLR"]} onChange={setBuyAsset} />
        <Select label="Merchant Receives" value={receiveAsset} options={["USDT0", "USDC", "ETH"]} onChange={setReceiveAsset} />
        <label className="demo-field">
          <span>Amount</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button className="btn-primary demo-generate" onClick={run}>Generate Settlement</button>
      </div>

      <div className="demo-result">
        {phase === "idle" && <span className="demo-idle">Choose assets, then generate a route.</span>}
        {phase === "finding" && <span className="demo-finding">Finding Route…</span>}
        {phase === "done" && (
          <div className="demo-done">
            <span className="demo-done-route"><Check /> Route selected: Seira Router</span>
            <span className="demo-stat">Estimated Time <b>6 sec</b></span>
            <span className="demo-stat">Estimated Cost <b>~0.002 FLR</b></span>
            <button className="btn-secondary">Confirm <ArrowUpRight /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Under the hood ───────────────────────────────────────── */
const HOOD_BLOCKS = [
  { title: "Payment Intent", body: "What the buyer wants to achieve." },
  { title: "Intent Compiler", body: "Turns intent into a constraint set." },
  { title: "Execution Planner", body: "Finds the safest settlement path." },
  { title: "Execution Runtime", body: "Carries the plan out, step by step." },
  { title: "Settlement", body: "Funds land in the asset the merchant asked for." },
];

function HoodDiagram() {
  const [open, setOpen] = useState(null);
  return (
    <div className="hood-diagram">
      {HOOD_BLOCKS.map((b, i) => (
        <div key={b.title} className="hood-block-wrap">
          <button
            className={`hood-block ${open === i ? "is-open" : ""}`}
            onMouseEnter={() => setOpen(i)}
            onMouseLeave={() => setOpen(null)}
            onClick={() => setOpen(open === i ? null : i)}
          >
            {b.title}
            <span className={`hood-tip ${open === i ? "is-visible" : ""}`}>
              <span className="hood-tip-arrow" />
              {b.body}
            </span>
          </button>
          {i < HOOD_BLOCKS.length - 1 && <span className="hood-arrow">↓</span>}
        </div>
      ))}
    </div>
  );
}

/* ── Developer architecture ──────────────────────────────── */
const SNIPPETS = [
  {
    title: "Payment Intent", caption: "What the buyer is asking for, plain and asset-agnostic.",
    json: `{
  "want": "USDT0",
  "amount": 25,
  "from": "wallet:fxrp"
}`,
  },
  {
    title: "Execution Plan", caption: "The route the planner chose to satisfy the intent.",
    json: `{
  "route": "Seira Router",
  "hops": ["FXRP", "USDT0"],
  "eta_sec": 6
}`,
  },
  {
    title: "Capability", caption: "A registered settlement path Seira can call on.",
    json: `{
  "provider": "Seira Router",
  "supports": ["FXRP", "USDT0"]
}`,
  },
];

const ROADMAP = [
  { phase: "Today", items: ["FXRP", "USDT0"] },
  { phase: "Next", items: ["Ethereum", "Base"] },
  { phase: "Later", items: ["Any Asset", "Any Merchant", "Any Chain"] },
];

function WalletGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3h-4a2.5 2.5 0 0 0 0 5h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="16.5" cy="12.5" r="1" fill="currentColor" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" strokeOpacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
function RouteVerified({ size = 15, color = "var(--pink)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.2a8.8 8.8 0 1 0 8.2 5.6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.4 12.4l2.6 2.6 5-6.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeft({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5M5 12l6-6M5 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StoreGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9.5V19a1 1 0 0 0 1 1h5v-5h4v5h5a1 1 0 0 0 1-1V9.5M3 9.5l1.6-4.8A1 1 0 0 1 5.55 4h12.9a1 1 0 0 1 .95.7L21 9.5M3 9.5h18M8 9.5v1.5a2 2 0 1 1-4 0V9.5M12 9.5v1.5a2 2 0 1 1-4 0V9.5M16 9.5v1.5a2 2 0 1 1-4 0V9.5M20 9.5v1.5a2 2 0 1 1-4 0V9.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SelectPay({ value, options, onChange, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="cr-sel" ref={ref}>
      <button type="button" className={`cr-sel-trigger ${open ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {value} <ChevronDown />
      </button>
      {open && (
        <div className={`cr-sel-menu align-${align}`}>
          {options.map((opt, i) => (
            <button type="button" key={opt} className={`cr-sel-opt ${opt === value ? "is-sel" : ""}`}
              style={{ "--i": i }} onClick={() => { onChange(opt); setOpen(false); }}>
              {opt}{opt === value && <Check size={11} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RATE = { FXRP: 2.189, FLR: 77.6 };
function ClockGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DropletGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.5c3 3.6 5.5 6.7 5.5 9.7a5.5 5.5 0 1 1-11 0c0-3 2.5-6.1 5.5-9.7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}


const TICKER_STEPS = [
  { key: "acquire", label: "Acquire", detail: "Locking 54.73 FXRP" },
  { key: "convert", label: "Convert", detail: "Routing through Seira Router" },
  { key: "transfer", label: "Transfer", detail: "Sending to Coffee House" },
  { key: "verify", label: "Verify", detail: "Confirming on Coston2" },
];
const BRAND_STEPS = ["Acquire", "Convert", "Transfer", "Verify"];

function LandingScreen({ onStart }) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("");
  const sectionRefs = useRef({});

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.dataset.navid);
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const setRef = (id) => (el) => { sectionRefs.current[id] = el; };

  return (
    <div className="seira-root">
      <style>{`
        ${TOKENS}
        *{box-sizing:border-box;}
        .seira-root{ color:var(--ink); font-family:var(--font-body);
          background:
            radial-gradient(ellipse 1000px 700px at 100% 0%, rgba(255,26,94,.05), transparent 60%),
            radial-gradient(ellipse 900px 700px at 0% 30%, rgba(255,26,94,.035), transparent 55%),
            var(--paper);
        }
        section{ scroll-margin-top:90px; }
        h1,h2,h3{ font-weight:400; }

        /* NAV */
        .nav{ position:sticky; top:0; z-index:40; display:flex; align-items:center; justify-content:space-between;
          padding:22px 48px; background:rgba(250,249,247,0.86); backdrop-filter:blur(10px) saturate(140%);
          -webkit-backdrop-filter:blur(10px) saturate(140%); transform:translateZ(0);
          border-bottom:1px solid transparent; transition:padding .3s var(--ease-in-out), border-color .3s var(--ease-in-out); }
        .nav.is-scrolled{ padding:13px 48px; border-bottom:1px solid var(--line); }
        .nav-left{ display:flex; align-items:center; gap:11px; flex:none; }
        .nav-word{ display:flex; flex-direction:column; line-height:1; }
        .nav-word .brand{ font-family:var(--font-display); font-size:22px; }
        .nav-word .tagline{ font-size:10px; letter-spacing:.06em; color:var(--ink-soft); margin-top:3px; white-space:nowrap; }
        .nav-links{ display:flex; align-items:center; gap:30px; }
        .nav-link{ font-size:clamp(14px, .95vw, 15.5px); color:var(--ink-soft); text-decoration:none; background:none; border:none; cursor:pointer;
          font-weight:500; transition:color .18s var(--ease-out), font-weight .1s; white-space:nowrap; }
        .nav-link:hover{ color:var(--ink); }
        .nav-link.is-active{ color:var(--pink-deep); font-weight:700; }
        .nav-cta{ font-size:14px; font-weight:600; color:var(--paper); background:var(--ink); border:none; border-radius:8px;
          padding:10px 18px; cursor:pointer; transition:transform .15s var(--ease-out), background .15s var(--ease-out); white-space:nowrap; }
        .nav-cta:hover{ background:var(--pink-deep); }
        .nav-cta:active{ transform:scale(.97); }
        @media (max-width:820px){
          .nav-word .tagline{ display:none; }
          .nav-links > .nav-link{ display:none; }
          .nav{ padding:16px 20px; }
        }

        /* HERO */
        .hero{ display:grid; grid-template-columns:1fr 1.05fr; gap:48px; align-items:center; padding:24px 48px 40px; max-width:1520px; margin:0 auto; min-height:calc(100vh - 76px); }
        .kicker{ font-size:12px; letter-spacing:.08em; color:var(--pink-deep); font-weight:600; margin-bottom:14px; display:block; }
        .headline{ font-family:var(--font-display); font-size:clamp(40px, 4.3vw, 66px); line-height:1.02; letter-spacing:-.015em; margin:0 0 16px; max-width:16ch; }
        .headline em{ font-style:italic; color:var(--pink); }
        .sub{ font-size:clamp(16.5px, 1.25vw, 19px); line-height:1.55; color:var(--ink-soft); max-width:40ch; margin:0 0 22px; }
        .hero-actions{ display:flex; align-items:center; gap:20px; margin-bottom:20px; }
        .btn-primary{ font-size:15px; font-weight:600; color:var(--paper); background:var(--ink); border:none; border-radius:10px;
          padding:14px 26px; cursor:pointer; box-shadow:0 3px 3px rgba(21,20,26,.06); transition:transform .15s var(--ease-out), background .15s var(--ease-out); }
        .btn-primary:hover{ background:var(--pink-deep); }
        .btn-primary:active{ transform:scale(.97); }
        .btn-secondary{ font-size:15px; font-weight:600; color:var(--ink); background:none; border:none; padding:0; cursor:pointer;
          display:inline-flex; align-items:center; gap:7px; transition:gap .18s var(--ease-out), color .18s var(--ease-out); }
        .btn-secondary:hover{ gap:11px; color:var(--pink-deep); }
        .trust-row{ display:flex; gap:32px; flex-wrap:wrap; }
        .trust-item{ font-size:clamp(13px, .85vw, 14.5px); color:var(--ink-soft); display:flex; align-items:center; gap:8px; }
        .trust-item .dot{ width:5px; height:5px; border-radius:2px; background:var(--pink); flex:none; }

        .pcard-stage{ position:relative; max-width:580px; width:100%; margin-left:auto; perspective:1400px; }
        .pcard-glow{ position:absolute; top:-40px; left:-60px; width:340px; height:340px; border-radius:50%;
          background:radial-gradient(circle at 30% 30%, rgba(255,26,94,.11), transparent 70%);
          filter:blur(40px); pointer-events:none; }

        /* PAYMENT CARD — the signature artifact. Real depth via layered
           shadow + self-colored edge, not a gimmick frame. Width is
           fixed and modest so it holds its proportions from tablet
           through a 1440/1920 laptop viewport — the hero column caps
           at 1200px total, so this card never stretches. */
        .pcard{ position:relative; width:100%; margin-left:auto; padding:36px 38px 34px;
          background:var(--paper); border-radius:22px 22px 22px 6px; overflow:hidden;
          box-shadow:
            0 2px 2px rgba(21,20,26,.04),
            0 18px 30px -14px rgba(21,20,26,.22),
            0 46px 70px -28px rgba(21,20,26,.28),
            inset 0 1px 0 rgba(255,255,255,.7);
          transform:rotateY(-5deg) rotateX(2deg); transform-style:preserve-3d;
          animation:card-float 6s var(--ease-in-out) infinite;
        }
        @keyframes card-float{ 0%,100%{ transform:rotateY(-5deg) rotateX(2deg) translateY(0); } 50%{ transform:rotateY(-5deg) rotateX(2deg) translateY(-9px); } }
        .pcard-edge{ position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--pink); border-radius:22px 0 0 6px; }
        .pcard-sheen{ position:absolute; inset:0; background:linear-gradient(118deg, rgba(255,255,255,.55) 0%, transparent 32%); pointer-events:none; }
        .pcard-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; padding-left:6px; }
        .pcard-merchant{ font-family:var(--font-display); font-size:24px; }
        .pcard-live{ font-size:10.5px; color:var(--ink-soft); letter-spacing:.05em; text-transform:uppercase; }

        .pcard-amount{ margin-bottom:18px; padding-left:6px; }
        .pcard-amount-k{ display:block; font-size:11.5px; color:var(--ink-soft); margin-bottom:4px; }
        .pcard-amount-v{ font-family:var(--font-display); font-size:54px; line-height:1; color:var(--ink); display:flex; align-items:baseline; gap:10px; }
        .pcard-amount-unit{ font-family:var(--font-mono); font-size:14px; color:var(--pink-deep); font-weight:600; }

        .pcard-route{ margin-bottom:16px; padding-left:6px; }
        .pcard-route-tag{ display:inline-block; font-family:var(--font-mono); font-size:10px; letter-spacing:.03em;
          color:var(--pink-deep); font-weight:600; background:var(--pink-tint); border-radius:20px; padding:3px 9px; margin-bottom:10px; }
        .pcard-route-amounts{ display:flex; align-items:center; gap:8px; }
        .pcard-route-node{ font-family:var(--font-mono); font-size:11.5px; color:var(--ink-soft); white-space:nowrap; }
        .pcard-route-arrow{ color:var(--ink-faint); font-size:12px; }

        .pcard-row{ display:flex; justify-content:space-between; align-items:baseline; padding:10px 0 10px 6px; }
        .pcard-k{ font-size:12.5px; color:var(--ink-soft); }
        .pcard-v{ font-size:15px; font-weight:600; }
        .pcard-v--mono{ font-family:var(--font-mono); font-size:13.5px; }
        .pcard-hair{ height:1px; background:var(--line); margin-left:6px; }
        .pcard-cta{ width:100%; margin-top:18px; font-size:14.5px; font-weight:600; color:var(--paper); background:var(--ink); border:none; border-radius:10px;
          padding:14px; cursor:pointer; transition:transform .15s var(--ease-out), background .15s var(--ease-out); }
        .pcard-cta:hover{ background:var(--pink-deep); }
        .pcard-cta:active{ transform:scale(.97); }
        @media (prefers-reduced-motion: reduce){ .pcard{ animation:none; } }
        @media (max-width:860px){ .pcard{ transform:none; animation:none; width:100%; } .pcard-stage{ max-width:100%; } .pcard-glow{ display:none; } }

        /* SECTION SHELL */
        .section{ padding:64px 48px; max-width:1520px; margin:0 auto; }
        /* Background rhythm: alternating dark ink bands that read clearly as
           separate "pages". Each band carries color--paper text and the needed
           descendant overrides so inner text that was written for light pages
           stays readable on the dark surface. Tokens only (no new hues). */
        .section--ink{ background:var(--ink); color:var(--paper); border-radius:22px; margin:28px auto; }
        .section--ink .section-line{ color:var(--paper); }
        .section--ink .section-line b{ color:var(--pink); }
        .section--ink .roadmap-phase{ color:var(--ink-faint); }
        .section--ink .roadmap-item{ color:var(--paper); }
        .section--pink{ background:
            linear-gradient(to bottom, transparent 0, var(--pink-tint) 8%, var(--pink-tint) calc(100% - 8%), transparent 100%),
            var(--paper); }
        .section-wave{ display:block; width:100%; height:72px; overflow:hidden; pointer-events:none; }
        .section-wave svg{ display:block; width:100%; height:100%; }
        .section-line{ font-size:clamp(19px, 1.6vw, 24px); line-height:1.5; max-width:32ch; margin:0 0 36px; font-family:var(--font-display); }
        .section-line b{ color:var(--pink-deep); font-weight:400; font-style:italic; }

        .reveal{ opacity:1; transition:transform .6s var(--ease-out); transition-delay:calc(var(--stagger,0) * 80ms); }
        .reveal[data-dir="up"]{ transform:translateY(20px) scale(.985); }
        .reveal[data-dir="left"]{ transform:translateX(-22px); }
        .reveal[data-dir="right"]{ transform:translateX(22px); }
        .reveal.is-in{ transform:translate(0,0) scale(1); }
        @media (prefers-reduced-motion: reduce){ .reveal{ transition:none; transform:none; } }

        /* PROBLEM — chains, not cards */
        .problem-grid{ display:grid; grid-template-columns:1fr 1fr; gap:56px; align-items:start; }
        .chain{ position:relative; padding-left:26px; padding-top:8px; }
        .chain-label{ position:absolute; left:26px; top:-26px; font-size:11px; letter-spacing:.08em; font-weight:700; color:var(--ink-faint); text-transform:uppercase; }
        .chain-label--pink{ color:var(--pink-deep); }
        .chain-spine{ position:absolute; left:4px; top:14px; bottom:14px; width:2px; }
        .chain-spine--broken{ background-image:repeating-linear-gradient(to bottom, var(--ink-faint) 0 5px, transparent 5px 10px); opacity:.5; }
        .chain-spine--clean{ background:var(--pink); opacity:.3; overflow:hidden; }
        .chain-pulse{ position:absolute; left:-3px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.16); animation:pulse-travel 3.2s var(--ease-in-out) infinite; }
        @keyframes pulse-travel{ 0%{ top:0%; opacity:0; } 8%{ opacity:1; } 92%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .chain-node{ position:relative; display:flex; align-items:center; gap:14px; padding:9px 0; font-size:14px;
          animation:chain-in .5s var(--ease-out) both; animation-delay:calc(var(--i) * 45ms); }
        @keyframes chain-in{ from{ opacity:0; transform:translateX(-6px);} to{ opacity:1; transform:translateX(0);} }
        .chain-dot{ position:relative; z-index:1; width:9px; height:9px; border-radius:50%; background:var(--paper); border:2px solid var(--ink-faint); flex:none; }
        .chain-dot--pink{ border-color:var(--pink); }
        .chain-text{ color:var(--ink-soft); }
        .chain-node.is-bad{ animation:chain-in .5s var(--ease-out) both, jitter 2.6s ease-in-out infinite; animation-delay:calc(var(--i) * 45ms), calc(var(--i) * 45ms + .5s); }
        .chain-node.is-bad .chain-dot{ border-color:var(--pink-deep); background:var(--pink-tint); }
        .chain-node.is-bad .chain-text{ color:var(--pink-deep); font-weight:600; }
        @keyframes jitter{ 0%,88%,100%{ transform:translateX(0); } 90%{ transform:translateX(-3px); } 92%{ transform:translateX(2px); } 94%{ transform:translateX(-1px); } 96%{ transform:translateX(0); } }
        .chain-node--clean .chain-text{ color:var(--ink); font-weight:500; }
        @media (prefers-reduced-motion: reduce){
          .chain-node, .chain-node.is-bad, .chain-pulse{ animation:none; opacity:1; }
        }
        @media (max-width:820px){ .problem-grid{ grid-template-columns:1fr; gap:64px; } }

        /* HOW IT WORKS */
        .works-grid{ display:flex; flex-direction:column; gap:1px; background:var(--line); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
        .works-card{ background:var(--paper); padding:26px 28px; display:grid; grid-template-columns:auto 1fr auto; gap:24px; align-items:center; }
        .works-n{ font-family:var(--font-mono); font-size:13px; color:var(--pink); }
        .works-title{ font-family:var(--font-display); font-size:clamp(22px, 1.7vw, 27px); margin:6px 0 8px; }
        .works-body{ font-size:clamp(14.5px, 1vw, 16px); color:var(--ink-soft); max-width:44ch; line-height:1.55; }
        .works-visual{ display:flex; flex-direction:column; gap:8px; }
        .works-chip{ font-size:12px; background:var(--paper-dim); border-radius:7px; padding:7px 11px; }
        .works-chip--muted{ color:var(--ink-soft); }
        .works-graph{ display:flex; align-items:center; gap:10px; }
        .works-node{ font-size:12px; font-family:var(--font-mono); background:var(--paper-dim); border-radius:7px; padding:7px 11px; }
        .works-node--active{ background:var(--ink); color:var(--paper); }
        .works-graph-line{ width:26px; height:1px; background:var(--ink-faint); }
        .works-timeline{ display:flex; flex-direction:column; gap:6px; }
        .works-tl-item{ font-size:11.5px; display:flex; align-items:center; gap:6px; color:var(--ink-soft); }
        @media (max-width:760px){ .works-card{ grid-template-columns:1fr; } }

        /* WHY IT MATTERS */
        .matters-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line); border-radius:16px; overflow:hidden; border:1px solid var(--line); }
        .matters-card{ background:var(--paper); padding:26px 28px; min-height:140px; display:flex; flex-direction:column; justify-content:space-between; }
        .matters-role{ font-family:var(--font-display); font-size:22px; font-style:italic; color:var(--pink-deep); }
        .matters-line{ font-size:clamp(15px, 1.05vw, 16.5px); color:var(--ink-soft); margin-top:20px; line-height:1.5; }
        @media (max-width:820px){ .matters-grid{ grid-template-columns:1fr; } }

        /* DEMO */
        .demo-panel{ border:1px solid var(--line); border-radius:16px; padding:24px; background:var(--paper-dim); display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:24px; width:100%; overflow:hidden; }
        .demo-controls{ display:flex; flex-direction:column; gap:14px; min-width:0; }
        .demo-field{ display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--ink-soft); min-width:0; }
        .demo-field input{ font-size:14px; padding:10px 12px; border-radius:8px; border:1px solid var(--line); background:var(--paper); font-family:var(--font-body); color:var(--ink); width:100%; min-width:0; }

        .sel{ position:relative; display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--ink-soft); min-width:0; }
        .sel-label{ }
        .sel-trigger{ display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;
          font-size:14px; font-family:var(--font-body); color:var(--ink); background:var(--paper);
          border:1px solid var(--line); border-radius:8px; padding:10px 12px; cursor:pointer;
          transition:border-color .15s var(--ease-out); }
        .sel-trigger:hover{ border-color:var(--ink-faint); }
        .sel-trigger.is-open{ border-color:var(--pink); }
        .sel-chevron{ display:flex; color:var(--ink-soft); transition:transform .25s var(--ease-out); }
        .sel-trigger.is-open .sel-chevron{ transform:rotate(180deg); color:var(--pink-deep); }

        .sel-menu{ position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:20;
          background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:5px;
          box-shadow:0 18px 32px -16px rgba(21,20,26,.24);
          transform-origin:top center;
          animation:sel-reveal .18s var(--ease-out) both; }
        @keyframes sel-reveal{ from{ opacity:0; transform:scaleY(.9) translateY(-4px); } to{ opacity:1; transform:scaleY(1) translateY(0); } }
        .sel-option{ display:flex; align-items:center; justify-content:space-between; width:100%;
          font-size:13.5px; font-family:var(--font-body); color:var(--ink); background:none; border:none;
          border-radius:6px; padding:9px 10px; cursor:pointer; text-align:left;
          animation:sel-opt-in .22s var(--ease-out) both; animation-delay:calc(var(--i) * 35ms);
          transition:background .12s var(--ease-out); }
        @keyframes sel-opt-in{ from{ opacity:0; transform:translateX(-5px); } to{ opacity:1; transform:translateX(0); } }
        .sel-option:hover{ background:var(--paper-dim); }
        .sel-option.is-selected{ color:var(--pink-deep); font-weight:600; }
        @media (prefers-reduced-motion: reduce){ .sel-menu, .sel-option{ animation:none; } }
        .demo-generate{ margin-top:4px; width:100%; }
        .demo-result{ border-left:1px solid var(--line); padding-left:28px; display:flex; align-items:center; min-width:0; }
        .demo-idle, .demo-finding{ font-size:14px; color:var(--ink-soft); }
        .demo-finding{ font-family:var(--font-mono); }
        .demo-done{ display:flex; flex-direction:column; gap:10px; font-size:14px; min-width:0; width:100%; }
        .demo-done-route{ display:flex; align-items:center; gap:8px; font-weight:600; flex-wrap:wrap; word-break:break-word; }
        .demo-stat{ font-size:13px; color:var(--ink-soft); }
        .demo-stat b{ color:var(--ink); font-family:var(--font-mono); font-weight:600; }
        .demo-done .btn-secondary{ margin-top:2px; }
        @media (max-width:760px){ .demo-panel{ grid-template-columns:1fr; } .demo-result{ border-left:none; border-top:1px solid var(--line); padding-left:0; padding-top:20px; } }

        /* UNDER THE HOOD — dark, deliberate */
        .hood-section{ background:var(--ink); color:var(--paper); border-radius:22px; margin:28px auto; }
        .hood-section .section-line{ color:var(--paper); }
        .hood-diagram{ display:flex; flex-direction:column; align-items:center; gap:0; padding:8px 0 28px; }
        .hood-block-wrap{ position:relative; display:flex; flex-direction:column; align-items:center; }
        .hood-block{ position:relative; font-size:14px; font-family:var(--font-mono); color:var(--paper); background:rgba(250,249,247,.06);
          border:1px solid var(--line-dark); border-radius:10px; padding:14px 22px; cursor:pointer;
          transition:background .18s var(--ease-out), border-color .18s var(--ease-out); }
        .hood-block:hover, .hood-block.is-open{ background:rgba(255,26,94,.12); border-color:var(--pink); }
        .hood-tip{ position:absolute; top:50%; left:calc(100% + 22px); width:230px;
          font-family:var(--font-body); font-size:13px; line-height:1.5; color:var(--ink);
          background:var(--paper); padding:14px 17px; border-radius:10px; white-space:normal; z-index:5;
          box-shadow:0 16px 32px -12px rgba(0,0,0,.35);
          opacity:0; visibility:hidden; pointer-events:none;
          transform:translate(-6px, -50%) scale(.96); transform-origin:left center;
          transition:opacity .2s var(--ease-out), transform .2s var(--ease-out), visibility 0s linear .2s; }
        .hood-tip.is-visible{ opacity:1; visibility:visible; pointer-events:auto;
          transform:translate(0, -50%) scale(1); transition:opacity .2s var(--ease-out), transform .2s var(--ease-out), visibility 0s; }
        .hood-tip-arrow{ position:absolute; top:50%; left:-5px; transform:translateY(-50%) rotate(45deg);
          width:9px; height:9px; background:var(--paper); }
        @media (max-width:700px){
          .hood-tip{ left:50%; top:calc(100% + 14px); transform:translate(-50%, -6px) scale(.96); transform-origin:top center; }
          .hood-tip.is-visible{ transform:translate(-50%, 0) scale(1); }
          .hood-tip-arrow{ top:-5px; left:50%; transform:translateX(-50%) rotate(45deg); }
        }
        @media (prefers-reduced-motion: reduce){ .hood-tip{ transition:opacity .1s linear; transform:translate(-50%, 0) scale(1); } }
        .hood-arrow{ color:var(--ink-faint); font-size:13px; padding:6px 0; }

        /* DEV ARCHITECTURE */
        .snippets-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
        .snippet{ background:rgba(250,249,247,.05); border:1px solid var(--line-dark); border-radius:12px; padding:20px; }
        .snippet-title{ font-size:clamp(13px, .9vw, 14.5px); font-weight:600; margin-bottom:6px; }
        .snippet-caption{ font-size:clamp(12px, .82vw, 13px); color:var(--ink-faint); margin-bottom:14px; line-height:1.5; }
        .snippet pre{ font-family:var(--font-mono); font-size:clamp(11.5px, .8vw, 13px); line-height:1.65; color:#ffb4c9; margin:0; white-space:pre-wrap; }
        @media (max-width:820px){ .snippets-grid{ grid-template-columns:1fr; } }

        /* ROADMAP */
        .roadmap-row{ display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
        .roadmap-col{ border-top:2px solid var(--line); padding-top:18px; }
        .roadmap-col.is-now{ border-top-color:var(--pink); }
        .roadmap-phase{ font-size:clamp(12px, .82vw, 13px); letter-spacing:.06em; font-weight:700; color:var(--ink-soft); }
        .roadmap-items{ margin-top:14px; display:flex; flex-direction:column; gap:8px; }
        .roadmap-item{ font-family:var(--font-mono); font-size:clamp(13.5px, .95vw, 15px); }
        @media (max-width:820px){ .roadmap-row{ grid-template-columns:1fr; } }

        /* FINAL CTA */
        .final-cta{ text-align:center; padding:40px 48px 80px; }
        .final-cta h2{ font-family:var(--font-display); font-size:clamp(34px, 3.4vw, 50px); line-height:1.2; max-width:16ch; margin:0 auto 16px; }
        .final-cta h2 em{ font-style:italic; color:var(--pink); }
        .final-cta p{ color:var(--ink-soft); font-size:clamp(15.5px, 1.15vw, 18px); margin-bottom:36px; }
        .final-cta-actions{ display:flex; justify-content:center; gap:28px; }

        /* FOOTER */
        .footer{ border-top:1px solid var(--line); padding:24px 48px; display:flex; justify-content:space-between; align-items:center; font-size:clamp(13px, .85vw, 14px); color:var(--ink-soft); }
        .footer-links{ display:flex; gap:24px; }
        .footer-links a{ color:var(--ink-soft); text-decoration:none; }
        .footer-links a:hover{ color:var(--ink); }
        @media (max-width:640px){ .footer{ flex-direction:column; gap:16px; text-align:center; } }

        @media (max-width:860px){
          .hero{ grid-template-columns:1fr; padding:40px 24px 60px; min-height:auto; }
          .headline{ font-size:34px; }
          .pcard{ margin:0; max-width:100%; }
          .section{ padding:72px 24px; }
        }
      `}</style>

      <nav className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="nav-left">
          <SeiraMark size={scrolled ? 22 : 26} />
          <div className="nav-word">
            <span className="brand">Seira</span>
            <span className="tagline">SETTLEMENT INFRASTRUCTURE</span>
          </div>
        </div>
        <div className="nav-links">
          {NAV_SECTIONS.map((s) => (
            <a key={s.id} className={`nav-link ${active === s.id ? "is-active" : ""}`} href={`#${s.id}`}>{s.label}</a>
          ))}
          <a className="nav-link" href="#github">GitHub</a>
          <button className="nav-cta" onClick={onStart}>Start Payment</button>
        </div>
      </nav>

      <section className="hero">
        <div>
          <span className="kicker">FLARE · CROSS-CHAIN SETTLEMENT</span>
          <h1 className="headline">Pay with what you hold.<br />Merchants receive <em>what they want</em>.</h1>
          <p className="sub">Seira automatically settles crypto payments across interoperable assets, so buyers and merchants never have to agree on the same asset or blockchain.</p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={onStart}>Start Payment</button>
            <button className="btn-secondary" onClick={() => document.getElementById("architecture")?.scrollIntoView({ behavior: "smooth" })}>View Architecture <ArrowUpRight /></button>
          </div>
          <div className="trust-row">
            <span className="trust-item"><span className="dot" />One confirmation</span>
            <span className="trust-item"><span className="dot" />Automatic settlement</span>
            <span className="trust-item"><span className="dot" />Built on Flare</span>
          </div>
        </div>
        <PaymentCard />
      </section>

      <SectionWave />

      <section className="section" id="problem" data-navid="problem" ref={setRef("problem")}>
        <Reveal><p className="section-line">Every crypto payment today assumes buyers and merchants use <b>the same asset</b>. Seira removes that assumption.</p></Reveal>
        <div className="problem-grid">
          <Reveal dir="left"><MessyChain /></Reveal>
          <Reveal dir="right" stagger={1}><CleanChain /></Reveal>
        </div>
      </section>

      <section className="section" id="how" data-navid="how" ref={setRef("how")}>
        <Reveal><p className="section-line">How Seira <b>actually works</b>. Three steps, no jargon.</p></Reveal>
        <div className="works-grid">
          {WORKS_CARDS.map((c, i) => (
            <Reveal key={c.n} stagger={i} dir={i % 2 === 0 ? "left" : "right"} className="works-card">
              <span className="works-n">{c.n}</span>
              <div>
                <h3 className="works-title">{c.title}</h3>
                <p className="works-body">{c.body}</p>
              </div>
              {c.visual}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section section--ink" id="matters" data-navid="matters" ref={setRef("matters")}>
        <Reveal><p className="section-line">Why it <b>matters</b>, from every side of the payment.</p></Reveal>
        <div className="matters-grid">
          {MATTERS.map((m, i) => (
            <Reveal key={m.role} stagger={i} className="matters-card">
              <span className="matters-role">{m.role}</span>
              <p className="matters-line">{m.line}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section section--pink" id="demo" data-navid="demo" ref={setRef("demo")}>
        <Reveal><p className="section-line">Try it. A <b>live</b> route, mocked for the demo.</p></Reveal>
        <Reveal stagger={1}><LiveDemo /></Reveal>
      </section>

      <section className="section hood-section" id="architecture" data-navid="architecture" ref={setRef("architecture")}>
        <Reveal><p className="section-line">Under the hood. <b>Hover</b> a block to see what it does.</p></Reveal>
        <Reveal stagger={1}><HoodDiagram /></Reveal>
      </section>

      <section className="section hood-section" id="developers" data-navid="developers" ref={setRef("developers")}>
        <Reveal><p className="section-line">For developers. The <b>actual</b> shapes Seira passes around.</p></Reveal>
        <div className="snippets-grid">
          {SNIPPETS.map((s, i) => (
            <Reveal key={s.title} stagger={i} className="snippet">
              <div className="snippet-title">{s.title}</div>
              <div className="snippet-caption">{s.caption}</div>
              <pre>{s.json}</pre>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section section--ink" id="roadmap" data-navid="roadmap" ref={setRef("roadmap")} style={{ paddingBottom: "32px" }}>
        <Reveal><p className="section-line">Where this is <b>headed</b>.</p></Reveal>
        <div className="roadmap-row">
          {ROADMAP.map((r, i) => (
            <Reveal key={r.phase} stagger={i} className={`roadmap-col ${i === 0 ? "is-now" : ""}`}>
              <span className="roadmap-phase">{r.phase.toUpperCase()}</span>
              <div className="roadmap-items">
                {r.items.map((it) => <span className="roadmap-item" key={it}>{it}</span>)}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <Reveal>
          <h2>Crypto payments shouldn't require users to <em>think about blockchains</em>.</h2>
          <p>Seira makes interoperability invisible.</p>
          <div className="final-cta-actions">
            <button className="btn-primary" onClick={onStart}>Start Payment</button>
            <button className="btn-secondary">GitHub <ArrowUpRight /></button>
          </div>
        </Reveal>
      </section>

      <footer className="footer">
        <div className="nav-left"><SeiraMark size={18} /> <span style={{fontFamily:"var(--font-display)", fontSize:16}}>Seira</span></div>
        <div className="footer-links">
          <a href="#github">GitHub</a><a href="#docs">Documentation</a><a href="#flare">Flare</a><a href="#explorer">Explorer</a>
        </div>
        <span>MIT License</span>
      </footer>
    </div>
  );
}

function ConnectScreen({ onConnected }) {
  const [phase, setPhase] = useState("idle"); // idle | connecting | connected

  const connect = useCallback(() => {
    setPhase("connecting");
    setTimeout(() => setPhase("connected"), 1300);
  }, []);

  return (
    <div className="app-shell">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        .app-shell{ min-height:100vh; display:grid; grid-template-columns:1fr; background:var(--paper); color:var(--ink); font-family:var(--font-body); }
        @media (min-width:960px){ .app-shell{ grid-template-columns:420px 1fr; } }

        /* BRAND PANEL — desktop only. This is what fills the screen
           instead of a stranded centered card in raw whitespace. */
        .brand-panel{ display:none; }
        @media (min-width:960px){
          .brand-panel{ display:flex; flex-direction:column; justify-content:space-between;
            background:var(--ink); color:var(--paper); padding:44px 40px; position:relative; overflow:hidden; }
        }
        .brand-top{ display:flex; align-items:center; gap:10px; position:relative; z-index:1; }
        .brand-top span{ font-family:var(--font-display); font-size:19px; }
        .brand-mid{ position:relative; z-index:1; }
        .brand-statement{ font-family:var(--font-display); font-size:clamp(27px, 2vw, 32px); line-height:1.38; max-width:19ch; margin:0 0 40px; }
        .brand-statement em{ font-style:italic; color:var(--pink); }
        .brand-chain{ position:relative; padding-left:22px; }
        .brand-chain-spine{ position:absolute; left:4px; top:5px; bottom:5px; width:1px; background:var(--line-dark); overflow:hidden; }
        .brand-chain-pulse{ position:absolute; left:-3.5px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.18); animation:brand-travel 4.8s var(--ease-in-out) infinite; }
        @keyframes brand-travel{ 0%{ top:0%; opacity:0; } 6%{ opacity:1; } 94%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .brand-chain-item{ font-family:var(--font-mono); font-size:12.5px; color:rgba(250,249,247,.5); padding:9px 0; }
        .brand-foot{ font-family:var(--font-mono); font-size:11px; color:rgba(250,249,247,.4); position:relative; z-index:1; }

        /* MAIN COLUMN */
        .main-col{ display:flex; flex-direction:column; position:relative;
          background:
            radial-gradient(ellipse 900px 600px at 100% 0%, rgba(255,26,94,.045), transparent 60%),
            radial-gradient(ellipse 800px 600px at 0% 45%, rgba(255,26,94,.03), transparent 55%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,26,94,.025), transparent 55%);
        }
        .main-top{ display:flex; align-items:center; justify-content:space-between; padding:24px 32px; }
        .main-top-left{ display:flex; align-items:center; gap:9px; }
        .main-top .brand{ font-family:var(--font-display); font-size:18px; }
        @media (min-width:960px){ .main-top-left{ display:none; } }
        .main-top-meta{ font-family:var(--font-mono); font-size:11.5px; color:var(--ink-faint); }

        .main-stage{ flex:1; display:flex; align-items:center; justify-content:center; padding:24px 24px 60px; }
        .connect-card{ width:100%; max-width:560px; }

        .connect-title{ font-family:var(--font-display); font-size:clamp(32px, 3vw, 46px); margin:0 0 12px; }
        .connect-sub{ font-size:clamp(16px, 1.2vw, 18.5px); color:var(--ink-soft); margin:0 0 32px; line-height:1.55; max-width:38ch; }

        .connect-btn{ width:100%; display:flex; align-items:center; justify-content:center; gap:10px;
          font-size:15px; font-weight:600; color:var(--paper); background:var(--ink); border:none;
          border-radius:11px; padding:16px; cursor:pointer;
          transition:transform .15s var(--ease-out), background .15s var(--ease-out); }
        .connect-btn:hover{ background:var(--pink-deep); }
        .connect-btn:active{ transform:scale(.98); }
        .connect-btn:disabled{ cursor:default; opacity:.85; }
        .connect-network-note{ font-size:12px; color:var(--ink-faint); margin-top:14px; }
        .spin{ animation:spin .8s linear infinite; }
        @keyframes spin{ to{ transform:rotate(360deg); } }

        .connect-result{ animation:settle .5s var(--ease-out) both; }
        @keyframes settle{ from{ opacity:1; transform:translateY(10px) scale(.98); } to{ opacity:1; transform:translateY(0) scale(1); } }

        .balance-stage{ position:relative; margin-bottom:22px; }
        .balance-glow{ position:absolute; top:-30px; left:-30px; width:220px; height:220px; border-radius:50%;
          background:radial-gradient(circle at 30% 30%, rgba(255,26,94,.08), transparent 70%);
          filter:blur(34px); pointer-events:none; }
        .balance-card{ position:relative; border:1px solid var(--line); border-radius:18px 18px 18px 4px;
          padding:26px; overflow:hidden;
          box-shadow:0 28px 52px -26px rgba(21,20,26,.24), inset 0 1px 0 rgba(255,255,255,.5); }
        .balance-sheen{ position:absolute; inset:0; background:linear-gradient(120deg, rgba(255,255,255,.45) 0%, transparent 32%); pointer-events:none; }
        .balance-k{ font-size:clamp(12px, .82vw, 13px); color:var(--ink-soft); margin-bottom:4px; }
        .balance-v{ font-family:var(--font-display); font-size:clamp(38px, 3vw, 48px); line-height:1; }
        .balance-v span{ font-family:var(--font-mono); font-size:14px; color:var(--pink-deep); margin-left:8px; font-weight:600; }
        .balance-secondary{ font-size:clamp(13.5px, .92vw, 15px); color:var(--ink-soft); margin-top:8px; }
        .balance-secondary b{ font-family:var(--font-mono); font-weight:600; color:var(--ink); font-size:12.5px; }
        .balance-hair{ height:1px; background:var(--line); margin:18px 0 14px; }
        .balance-verified{ display:flex; align-items:center; gap:7px; font-size:12px; color:var(--ink-soft); }

        .make-payment-btn{ margin-top:4px; }

        @media (prefers-reduced-motion: reduce){
          .connect-result{ animation:none; }
          .spin{ animation:none; }
          .brand-chain-pulse{ animation:none; opacity:1; top:50%; }
        }
      `}</style>

      <aside className="brand-panel">
        <div className="brand-top"><SeiraMark color="var(--pink)" /><span>Seira</span></div>
        <div className="brand-mid">
          <p className="brand-statement">Pay in what you hold. <em>Land in what they want.</em></p>
          <div className="brand-chain">
            <div className="brand-chain-spine"><span className="brand-chain-pulse" /></div>
            {BRAND_STEPS.map((s) => <div className="brand-chain-item" key={s}>{s}</div>)}
          </div>
        </div>
        <div className="brand-foot">Coston2 Testnet · Built on Flare</div>
      </aside>

      <div className="main-col">
        <div className="main-top">
          <div className="main-top-left"><SeiraMark size={22} /><span className="brand">Seira</span></div>
          {phase === "connected" && <span className="main-top-meta">rEb1...9kQ2 · Coston2</span>}
        </div>

        <div className="main-stage">
          <div className="connect-card">
            {phase !== "connected" ? (
              <>
                <h1 className="connect-title">Connect your wallet</h1>
                <p className="connect-sub">
                  Seira needs read access to check your balance and prepare a
                  settlement. Nothing moves until you confirm a payment.
                </p>
                <button className="connect-btn" onClick={connect} disabled={phase === "connecting"}>
                  {phase === "connecting" ? <><Spinner /> Connecting</> : <><WalletGlyph /> Connect Wallet</>}
                </button>
                <p className="connect-network-note">Connects on Coston2 testnet.</p>
              </>
            ) : (
              <div className="connect-result">
                <div className="balance-stage">
                  <div className="balance-glow" />
                  <div className="balance-card">
                    <div className="balance-sheen" />
                    <div className="balance-k">Balance</div>
                    <div className="balance-v">312.48<span>FXRP</span></div>
                    <div className="balance-secondary">4,120.0 <b>FLR</b></div>
                    <div className="balance-hair" />
                    <div className="balance-verified"><RouteVerified /> Wallet connected, ready to send</div>
                  </div>
                </div>
                <button className="connect-btn make-payment-btn" onClick={onConnected}>Make Payment</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateScreen({ payment, setPayment, onBack, onContinue }) {
  const { recipient, amount, receiveAsset, buyerAsset } = payment;
  const setRecipient = (v) => setPayment((p) => ({ ...p, recipient: v }));
  const setAmount = (v) => setPayment((p) => ({ ...p, amount: v }));
  const setReceiveAsset = (v) => setPayment((p) => ({ ...p, receiveAsset: v }));
  const setBuyerAsset = (v) => setPayment((p) => ({ ...p, buyerAsset: v }));

  const converted = useMemo(() => {
    const n = parseFloat(amount);
    if (!n || isNaN(n)) return "0.00";
    return (n * RATE[buyerAsset]).toFixed(2);
  }, [amount, buyerAsset]);

  const canContinue = recipient.trim().length > 0 && parseFloat(amount) > 0;

  return (
    <div className="app-shell">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        .app-shell{ min-height:100vh; display:grid; grid-template-columns:1fr; background:var(--paper); color:var(--ink); font-family:var(--font-body); }
        @media (min-width:960px){ .app-shell{ grid-template-columns:420px 1fr; } }

        .brand-panel{ display:none; }
        @media (min-width:960px){
          .brand-panel{ display:flex; flex-direction:column; justify-content:space-between;
            background:var(--ink); color:var(--paper); padding:44px 40px; position:relative; overflow:hidden; }
        }
        .brand-top{ display:flex; align-items:center; gap:10px; position:relative; z-index:1; }
        .brand-top span{ font-family:var(--font-display); font-size:19px; }
        .brand-mid{ position:relative; z-index:1; }
        .brand-statement{ font-family:var(--font-display); font-size:clamp(27px, 2vw, 32px); line-height:1.38; max-width:19ch; margin:0 0 40px; }
        .brand-statement em{ font-style:italic; color:var(--pink); }
        .brand-chain{ position:relative; padding-left:22px; }
        .brand-chain-spine{ position:absolute; left:4px; top:5px; bottom:5px; width:1px; background:var(--line-dark); overflow:hidden; }
        .brand-chain-pulse{ position:absolute; left:-3.5px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.18); animation:brand-travel 4.8s var(--ease-in-out) infinite; }
        @keyframes brand-travel{ 0%{ top:0%; opacity:0; } 6%{ opacity:1; } 94%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .brand-chain-item{ font-family:var(--font-mono); font-size:12.5px; color:rgba(250,249,247,.5); padding:9px 0; }
        .brand-foot{ font-family:var(--font-mono); font-size:11px; color:rgba(250,249,247,.4); position:relative; z-index:1; }

        .main-col{ display:flex; flex-direction:column; position:relative;
          background:
            radial-gradient(ellipse 900px 600px at 100% 0%, rgba(255,26,94,.045), transparent 60%),
            radial-gradient(ellipse 800px 600px at 0% 45%, rgba(255,26,94,.03), transparent 55%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,26,94,.025), transparent 55%);
        }
        .main-top{ display:flex; align-items:center; justify-content:space-between; padding:24px 32px; }
        .main-top-left{ display:flex; align-items:center; gap:9px; }
        @media (min-width:960px){ .main-top-left{ display:none; } }
        .cr-top-left{ display:flex; align-items:center; gap:14px; }
        .cr-back{ display:flex; align-items:center; gap:7px; font-size:13.5px; color:var(--ink-soft);
          background:none; border:none; cursor:pointer; padding:0; transition:color .15s var(--ease-out); }
        .cr-back:hover{ color:var(--ink); }
        .cr-steps{ display:flex; gap:6px; }
        .cr-step{ width:26px; height:3px; border-radius:2px; background:var(--line); }
        .cr-step.is-active{ background:var(--pink); }

        .main-stage{ flex:1; display:flex; align-items:center; justify-content:center; padding:12px 24px 60px; }
        .cr-card{ width:100%; max-width:560px; }

        .cr-headline{ font-family:var(--font-display); font-size:clamp(32px, 3vw, 46px); margin:0 0 8px; }
        .cr-sub{ font-size:clamp(15.5px, 1.15vw, 18px); color:var(--ink-soft); margin:0 0 30px; }

        .cr-field{ margin-bottom:18px; }
        .cr-field-label{ font-size:clamp(12px, .82vw, 13px); color:var(--ink-soft); margin-bottom:8px; display:block; }
        .cr-input-wrap{ position:relative; display:flex; align-items:center; }
        .cr-input-icon{ position:absolute; left:14px; color:var(--ink-faint); pointer-events:none; }
        .cr-input{ width:100%; font-size:15px; font-family:var(--font-body); color:var(--ink);
          background:var(--paper); border:1px solid var(--line); border-radius:11px;
          padding:14px 14px 14px 40px; transition:border-color .15s var(--ease-out); }
        .cr-input:focus{ outline:none; border-color:var(--pink); }
        .cr-input::placeholder{ color:var(--ink-faint); }

        .cr-amount-panel{ border:1px solid var(--line); border-radius:16px 16px 16px 4px; padding:22px;
          margin-bottom:24px; box-shadow:0 20px 40px -28px rgba(21,20,26,.2); }
        .cr-row{ display:flex; align-items:center; justify-content:space-between; gap:14px; }
        .cr-row + .cr-row{ margin-top:16px; padding-top:16px; border-top:1px solid var(--line); }
        .cr-row-label{ font-size:12px; color:var(--ink-soft); }
        .cr-amount-input{ font-family:var(--font-display); font-size:clamp(28px, 2.2vw, 34px); color:var(--ink);
          background:none; border:none; width:100%; padding:0; text-align:left; }
        .cr-amount-input:focus{ outline:none; }
        .cr-amount-input::placeholder{ color:var(--ink-faint); }
        .cr-preview{ font-family:var(--font-display); font-size:clamp(22px, 1.7vw, 26px); }
        .cr-preview span{ font-family:var(--font-mono); font-size:12px; color:var(--ink-soft); margin-left:6px; }

        .cr-sel{ position:relative; flex:none; }
        .cr-sel-trigger{ display:flex; align-items:center; gap:6px; font-family:var(--font-mono); font-size:13.5px;
          font-weight:600; color:var(--ink); background:var(--paper-dim); border:1px solid var(--line);
          border-radius:8px; padding:8px 11px; cursor:pointer; transition:border-color .15s var(--ease-out); }
        .cr-sel-trigger:hover{ border-color:var(--ink-faint); }
        .cr-sel-trigger.is-open{ border-color:var(--pink); }
        .cr-sel-menu{ position:absolute; top:calc(100% + 6px); min-width:110px; z-index:10;
          background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:5px;
          box-shadow:0 18px 32px -16px rgba(21,20,26,.24); animation:cr-reveal .18s var(--ease-out) both; }
        .cr-sel-menu.align-right{ right:0; transform-origin:top right; }
        .cr-sel-menu.align-left{ left:0; transform-origin:top left; }
        @keyframes cr-reveal{ from{ opacity:0; transform:scaleY(.9); } to{ opacity:1; transform:scaleY(1); } }
        .cr-sel-opt{ display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%;
          font-family:var(--font-mono); font-size:13px; color:var(--ink); background:none; border:none;
          border-radius:6px; padding:8px 10px; cursor:pointer; text-align:left;
          animation:cr-opt-in .2s var(--ease-out) both; animation-delay:calc(var(--i) * 30ms); }
        @keyframes cr-opt-in{ from{ opacity:0; transform:translateX(-4px); } to{ opacity:1; transform:translateX(0); } }
        .cr-sel-opt:hover{ background:var(--paper-dim); }
        .cr-sel-opt.is-sel{ color:var(--pink-deep); font-weight:700; }

        .cr-cta{ width:100%; font-size:15px; font-weight:600; color:var(--paper); background:var(--ink);
          border:none; border-radius:11px; padding:16px; cursor:pointer;
          transition:transform .15s var(--ease-out), background .15s var(--ease-out), opacity .15s var(--ease-out); }
        .cr-cta:hover:not(:disabled){ background:var(--pink-deep); }
        .cr-cta:active:not(:disabled){ transform:scale(.98); }
        .cr-cta:disabled{ opacity:.4; cursor:not-allowed; }
      `}</style>

      <aside className="brand-panel">
        <div className="brand-top"><SeiraMark /><span>Seira</span></div>
        <div className="brand-mid">
          <p className="brand-statement">Pay in what you hold. <em>Land in what they want.</em></p>
          <div className="brand-chain">
            <div className="brand-chain-spine"><span className="brand-chain-pulse" /></div>
            {BRAND_STEPS.map((s) => <div className="brand-chain-item" key={s}>{s}</div>)}
          </div>
        </div>
        <div className="brand-foot">Coston2 Testnet · Built on Flare</div>
      </aside>

      <div className="main-col">
        <div className="main-top">
          <div className="cr-top-left">
            <div className="main-top-left"><SeiraMark size={20} /></div>
            <button className="cr-back" onClick={onBack}><ArrowLeft /> Wallet</button>
          </div>
          <div className="cr-steps">
            <span className="cr-step is-active" /><span className="cr-step" /><span className="cr-step" />
          </div>
        </div>

        <div className="main-stage">
          <div className="cr-card">
            <h1 className="cr-headline">New payment</h1>
            <p className="cr-sub">Pay anyone, in whatever you're holding. Seira handles the rest.</p>

            <div className="cr-field">
              <span className="cr-field-label">Pay to</span>
              <div className="cr-input-wrap">
                <span className="cr-input-icon"><StoreGlyph /></span>
                <input
                  className="cr-input"
                  placeholder="Merchant name or wallet address"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>
            </div>

            <div className="cr-amount-panel">
              <div className="cr-row">
                <div>
                  <div className="cr-row-label">They receive</div>
                  <input className="cr-amount-input" type="number" value={amount}
                    onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                </div>
                <SelectPay value={receiveAsset} options={["USDT0", "USDC", "ETH"]} onChange={setReceiveAsset} align="right" />
              </div>
              <div className="cr-row">
                <div>
                  <div className="cr-row-label">You pay</div>
                  <div className="cr-preview">{converted}<span>{buyerAsset}</span></div>
                </div>
                <SelectPay value={buyerAsset} options={["FXRP", "FLR"]} onChange={setBuyerAsset} align="right" />
              </div>
            </div>

            <button className="cr-cta" disabled={!canContinue} onClick={() => { setPayment((p) => ({ ...p, convertedAmount: converted })); onContinue(); }}>Review Payment</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmScreen({ payment, onBack, onConfirm }) {
  const [routeIn, setRouteIn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRouteIn(true), 120); return () => clearTimeout(t); }, []);

  return (
    <div className="app-shell">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        .app-shell{ min-height:100vh; display:grid; grid-template-columns:1fr; background:var(--paper); color:var(--ink); font-family:var(--font-body); }
        @media (min-width:960px){ .app-shell{ grid-template-columns:420px 1fr; } }

        .brand-panel{ display:none; }
        @media (min-width:960px){
          .brand-panel{ display:flex; flex-direction:column; justify-content:space-between;
            background:var(--ink); color:var(--paper); padding:44px 40px; position:relative; overflow:hidden; }
        }
        .brand-top{ display:flex; align-items:center; gap:10px; position:relative; z-index:1; }
        .brand-top span{ font-family:var(--font-display); font-size:19px; }
        .brand-mid{ position:relative; z-index:1; }
        .brand-statement{ font-family:var(--font-display); font-size:clamp(27px, 2vw, 32px); line-height:1.38; max-width:19ch; margin:0 0 40px; }
        .brand-statement em{ font-style:italic; color:var(--pink); }
        .brand-chain{ position:relative; padding-left:22px; }
        .brand-chain-spine{ position:absolute; left:4px; top:5px; bottom:5px; width:1px; background:var(--line-dark); overflow:hidden; }
        .brand-chain-pulse{ position:absolute; left:-3.5px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.18); animation:brand-travel 4.8s var(--ease-in-out) infinite; }
        @keyframes brand-travel{ 0%{ top:0%; opacity:0; } 6%{ opacity:1; } 94%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .brand-chain-item{ font-family:var(--font-mono); font-size:12.5px; color:rgba(250,249,247,.5); padding:9px 0; }
        .brand-foot{ font-family:var(--font-mono); font-size:11px; color:rgba(250,249,247,.4); position:relative; z-index:1; }

        .main-col{ display:flex; flex-direction:column; position:relative;
          background:
            radial-gradient(ellipse 900px 600px at 100% 0%, rgba(255,26,94,.045), transparent 60%),
            radial-gradient(ellipse 800px 600px at 0% 45%, rgba(255,26,94,.03), transparent 55%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,26,94,.025), transparent 55%);
        }
        .main-top{ display:flex; align-items:center; justify-content:space-between; padding:24px 32px; }
        .cr-top-left{ display:flex; align-items:center; gap:14px; }
        .main-top-left{ display:flex; align-items:center; }
        @media (min-width:960px){ .main-top-left{ display:none; } }
        .cf-back{ display:flex; align-items:center; gap:7px; font-size:13.5px; color:var(--ink-soft);
          background:none; border:none; cursor:pointer; padding:0; transition:color .15s var(--ease-out); }
        .cf-back:hover{ color:var(--ink); }
        .cf-steps{ display:flex; gap:6px; }
        .cf-step{ width:26px; height:3px; border-radius:2px; background:var(--line); }
        .cf-step.is-active, .cf-step.is-done{ background:var(--pink); }
        .cf-step.is-done{ opacity:.4; }

        .main-stage{ flex:1; display:flex; align-items:center; justify-content:center; padding:12px 24px 60px; }
        .cf-card{ width:100%; max-width:580px; }

        .cf-label{ font-size:clamp(13px, .95vw, 15px); color:var(--ink-soft); margin-bottom:6px; }
        .cf-headline{ font-family:var(--font-display); font-size:clamp(30px, 2.8vw, 42px); margin:0 0 28px; }

        .cf-route-panel{ border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:20px;
          box-shadow:0 20px 40px -28px rgba(21,20,26,.2); }

        .cf-route{ display:flex; align-items:flex-end; gap:14px; margin-bottom:6px; }
        .cf-route-side{ display:flex; flex-direction:column; gap:5px; min-width:0; }
        .cf-route-side--right{ align-items:flex-end; text-align:right; }
        .cf-route-label{ font-size:11px; color:var(--ink-soft); }
        .cf-route-amount{ font-family:var(--font-display); font-size:clamp(28px, 2vw, 32px); line-height:1; }
        .cf-route-asset{ font-family:var(--font-mono); font-size:11.5px; color:var(--pink-deep); font-weight:600; letter-spacing:.02em; }

        .cf-route-mid{ flex:1; position:relative; height:40px; }
        .cf-route-tag{ position:absolute; top:0; left:50%; transform:translateX(-50%); white-space:nowrap;
          font-family:var(--font-mono); font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--ink-soft); }
        .cf-route-tick{ position:absolute; top:16px; left:50%; width:1px; height:9px; background:var(--ink-faint); transform:translateX(-50%); }
        .cf-route-line{ position:absolute; bottom:6px; left:0; right:0; height:1px; background:var(--line);
          transform:scaleX(0); transform-origin:left; transition:transform .6s var(--ease-out); }
        .cf-route-line.is-in{ transform:scaleX(1); }
        .cf-route-dot{ position:absolute; bottom:4px; left:0; width:5px; height:5px; border-radius:50%; background:var(--pink); opacity:0; }
        .cf-route-line.is-in ~ .cf-route-dot{ animation:travel 2.2s linear infinite .6s; }
        @keyframes travel{ 0%{ left:0%; opacity:0; } 8%{ opacity:1; } 92%{ opacity:1; } 100%{ left:100%; opacity:0; } }

        .cf-safest{ display:flex; align-items:flex-start; gap:12px; margin-top:18px; padding-top:18px; border-top:1px solid var(--line); }
        .cf-safest svg{ color:var(--pink); flex:none; margin-top:1px; }
        .cf-safest-text{ display:flex; flex-direction:column; gap:2px; }
        .cf-safest-title{ font-size:13.5px; font-weight:600; color:var(--ink); }
        .cf-safest-sub{ font-size:12px; color:var(--ink-soft); }

        .cf-stats-panel{ display:flex; align-items:stretch; border:1px solid var(--line); border-radius:16px;
          padding:20px 22px; margin-bottom:24px; box-shadow:0 20px 40px -28px rgba(21,20,26,.2); }
        .cf-stat{ flex:1; display:flex; align-items:center; gap:12px; }
        .cf-stat svg{ color:var(--ink-faint); flex:none; }
        .cf-stat-text{ display:flex; flex-direction:column; gap:2px; }
        .cf-stat-div{ width:1px; background:var(--line); margin:0 20px; }
        .cf-stat-k{ font-size:11.5px; color:var(--ink-soft); }
        .cf-stat-v{ font-family:var(--font-display); font-size:clamp(22px, 1.6vw, 26px); }
        .cf-stat-v span{ font-family:var(--font-mono); font-size:12px; color:var(--ink-soft); margin-left:4px; }

        .cf-cta{ width:100%; font-size:15px; font-weight:600; color:var(--paper); background:var(--ink);
          border:none; border-radius:11px; padding:16px; cursor:pointer;
          transition:transform .15s var(--ease-out), background .15s var(--ease-out); }
        .cf-cta:hover{ background:var(--pink-deep); }
        .cf-cta:active{ transform:scale(.98); }

        @media (prefers-reduced-motion: reduce){
          .cf-route-line{ transition:none; transform:scaleX(1); }
          .cf-route-dot{ animation:none; opacity:1; left:50%; }
          .brand-chain-pulse{ animation:none; opacity:1; top:50%; }
        }
      `}</style>

      <aside className="brand-panel">
        <div className="brand-top"><SeiraMark /><span>Seira</span></div>
        <div className="brand-mid">
          <p className="brand-statement">Pay in what you hold. <em>Land in what they want.</em></p>
          <div className="brand-chain">
            <div className="brand-chain-spine"><span className="brand-chain-pulse" /></div>
            {BRAND_STEPS.map((s) => <div className="brand-chain-item" key={s}>{s}</div>)}
          </div>
        </div>
        <div className="brand-foot">Coston2 Testnet · Built on Flare</div>
      </aside>

      <div className="main-col">
        <div className="main-top">
          <div className="cr-top-left">
            <div className="main-top-left"><SeiraMark size={20} /></div>
            <button className="cf-back" onClick={onBack}><ArrowLeft /> Edit payment</button>
          </div>
          <div className="cf-steps">
            <span className="cf-step is-done" /><span className="cf-step is-active" /><span className="cf-step" />
          </div>
        </div>

        <div className="main-stage">
          <div className="cf-card">
            <span className="cf-label">Reviewing the plan for</span>
            <h1 className="cf-headline">{payment.convertedAmount} {payment.buyerAsset} → {payment.amount} {payment.receiveAsset}</h1>

            <div className="cf-route-panel">
              <div className="cf-route">
                <div className="cf-route-side">
                  <span className="cf-route-label">You send</span>
                  <span className="cf-route-amount">{payment.convertedAmount}</span>
                  <span className="cf-route-asset">{payment.buyerAsset}</span>
                </div>
                <div className="cf-route-mid">
                  <span className="cf-route-tag">via Seira Router</span>
                  <span className="cf-route-tick" />
                  <span className={`cf-route-line ${routeIn ? "is-in" : ""}`} />
                  <span className="cf-route-dot" />
                </div>
                <div className="cf-route-side cf-route-side--right">
                  <span className="cf-route-label">Merchant gets</span>
                  <span className="cf-route-amount">{payment.amount}</span>
                  <span className="cf-route-asset">{payment.receiveAsset}</span>
                </div>
              </div>

              <div className="cf-safest">
                <RouteVerified />
                <div className="cf-safest-text">
                  <span className="cf-safest-title">Safest route selected</span>
                  <span className="cf-safest-sub">Chosen over 2 alternative paths on Coston2</span>
                </div>
              </div>
            </div>

            <div className="cf-stats-panel">
              <div className="cf-stat">
                <ClockGlyph />
                <div className="cf-stat-text"><span className="cf-stat-k">Estimated time</span><span className="cf-stat-v">6<span>sec</span></span></div>
              </div>
              <div className="cf-stat-div" />
              <div className="cf-stat">
                <DropletGlyph />
                <div className="cf-stat-text"><span className="cf-stat-k">Estimated cost</span><span className="cf-stat-v">0.002<span>FLR</span></span></div>
              </div>
            </div>

            <button className="cf-cta" onClick={onConfirm}>Confirm & Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusScreen({ payment, onDone, onViewMerchant }) {
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (current >= TICKER_STEPS.length) { setDone(true); return; }
    const t = setTimeout(() => setCurrent((c) => c + 1), 1100);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <div className="app-shell">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        .app-shell{ min-height:100vh; display:grid; grid-template-columns:1fr; background:var(--paper); color:var(--ink); font-family:var(--font-body); }
        @media (min-width:960px){ .app-shell{ grid-template-columns:420px 1fr; } }

        .brand-panel{ display:none; }
        @media (min-width:960px){
          .brand-panel{ display:flex; flex-direction:column; justify-content:space-between;
            background:var(--ink); color:var(--paper); padding:44px 40px; position:relative; overflow:hidden; }
        }
        .brand-top{ display:flex; align-items:center; gap:10px; position:relative; z-index:1; }
        .brand-top span{ font-family:var(--font-display); font-size:19px; }
        .brand-mid{ position:relative; z-index:1; }
        .brand-statement{ font-family:var(--font-display); font-size:clamp(27px, 2vw, 32px); line-height:1.38; max-width:19ch; margin:0 0 40px; }
        .brand-statement em{ font-style:italic; color:var(--pink); }
        .brand-chain{ position:relative; padding-left:22px; }
        .brand-chain-spine{ position:absolute; left:4px; top:5px; bottom:5px; width:1px; background:var(--line-dark); overflow:hidden; }
        .brand-chain-pulse{ position:absolute; left:-3.5px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.18); animation:brand-travel 4.8s var(--ease-in-out) infinite; }
        @keyframes brand-travel{ 0%{ top:0%; opacity:0; } 6%{ opacity:1; } 94%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .brand-chain-item{ font-family:var(--font-mono); font-size:12.5px; color:rgba(250,249,247,.5); padding:9px 0; }
        .brand-foot{ font-family:var(--font-mono); font-size:11px; color:rgba(250,249,247,.4); position:relative; z-index:1; }

        .main-col{ display:flex; flex-direction:column; position:relative;
          background:
            radial-gradient(ellipse 900px 600px at 100% 0%, rgba(255,26,94,.045), transparent 60%),
            radial-gradient(ellipse 800px 600px at 0% 45%, rgba(255,26,94,.03), transparent 55%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,26,94,.025), transparent 55%);
        }
        .main-top{ display:flex; align-items:center; justify-content:flex-end; padding:24px 32px; }
        .main-top-left{ display:flex; align-items:center; margin-right:auto; }
        @media (min-width:960px){ .main-top-left{ display:none; } }
        .st-steps{ display:flex; gap:6px; }
        .st-step{ width:26px; height:3px; border-radius:2px; background:var(--pink); opacity:.4; }

        .main-stage{ flex:1; display:flex; align-items:center; justify-content:center; padding:12px 24px 60px; }
        .st-card{ width:100%; max-width:560px; }

        .st-label{ font-size:clamp(13px, .95vw, 15px); color:var(--ink-soft); margin-bottom:6px; }
        .st-headline{ font-family:var(--font-display); font-size:clamp(30px, 2.8vw, 42px); margin:0 0 32px; }

        .st-ticker{ position:relative; padding-left:30px; margin-bottom:28px; }
        .st-spine{ position:absolute; left:6px; top:6px; bottom:6px; width:2px; background:var(--line); overflow:hidden; }
        .st-spine-fill{ position:absolute; top:0; left:0; width:100%; background:var(--pink); transition:height .5s var(--ease-in-out); }
        .st-node{ position:relative; display:flex; align-items:center; gap:12px; padding:11px 0; }
        .st-node-mark{ position:absolute; left:-30px; width:14px; height:14px; border-radius:50%;
          display:flex; align-items:center; justify-content:center; background:var(--paper);
          border:2px solid var(--ink-faint); transition:border-color .2s var(--ease-out), background .2s var(--ease-out); flex:none; }
        .st-node.is-done .st-node-mark{ background:var(--pink); border-color:var(--pink); }
        .st-node.is-active .st-node-mark{ border-color:var(--pink); }
        .st-node-text{ display:flex; flex-direction:column; gap:1px; }
        .st-node-label{ font-size:clamp(14px, 1vw, 16px); font-weight:500; color:var(--ink-faint); transition:color .2s var(--ease-out); }
        .st-node.is-active .st-node-label, .st-node.is-done .st-node-label{ color:var(--ink); }
        .st-node-detail{ font-size:12px; color:var(--ink-soft); font-family:var(--font-mono); }

        .st-receipt{ animation:settle .5s var(--ease-out) both; }
        @keyframes settle{ from{ opacity:1; transform:translateY(10px) scale(.98); } to{ opacity:1; transform:translateY(0) scale(1); } }
        .st-receipt-panel{ border:1px solid var(--line); border-radius:16px; padding:24px;
          box-shadow:0 20px 40px -28px rgba(21,20,26,.2); margin-bottom:24px; }
        .st-received-k{ font-size:12px; color:var(--ink-soft); margin-bottom:4px; }
        .st-received-v{ font-family:var(--font-display); font-size:clamp(34px, 2.8vw, 44px); margin-bottom:18px; }
        .st-received-v span{ font-family:var(--font-mono); font-size:14px; color:var(--pink-deep); margin-left:8px; }
        .st-meta-row{ display:flex; justify-content:space-between; padding:9px 0; border-top:1px solid var(--line); font-size:12.5px; }
        .st-meta-k{ color:var(--ink-soft); }
        .st-meta-v{ font-family:var(--font-mono); color:var(--ink); }

        .st-actions{ display:flex; align-items:center; justify-content:space-between; gap:20px; }
        .st-done-btn{ flex:1; font-size:15px; font-weight:600; color:var(--paper); background:var(--ink);
          border:none; border-radius:11px; padding:16px; cursor:pointer;
          transition:transform .15s var(--ease-out), background .15s var(--ease-out); }
        .st-done-btn:hover{ background:var(--pink-deep); }
        .st-done-btn:active{ transform:scale(.98); }
        .st-merchant-link{ font-size:13.5px; font-weight:600; color:var(--ink); background:none; border:none; cursor:pointer;
          display:inline-flex; align-items:center; gap:6px; white-space:nowrap; transition:gap .18s var(--ease-out), color .18s var(--ease-out); }
        .st-merchant-link:hover{ gap:9px; color:var(--pink-deep); }

        .spin{ animation:spin .8s linear infinite; }
        @keyframes spin{ to{ transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce){
          .st-receipt{ animation:none; }
          .spin{ animation:none; }
          .brand-chain-pulse{ animation:none; opacity:1; top:50%; }
        }
      `}</style>

      <aside className="brand-panel">
        <div className="brand-top"><SeiraMark /><span>Seira</span></div>
        <div className="brand-mid">
          <p className="brand-statement">Pay in what you hold. <em>Land in what they want.</em></p>
          <div className="brand-chain">
            <div className="brand-chain-spine"><span className="brand-chain-pulse" /></div>
            {BRAND_STEPS.map((s) => <div className="brand-chain-item" key={s}>{s}</div>)}
          </div>
        </div>
        <div className="brand-foot">Coston2 Testnet · Built on Flare</div>
      </aside>

      <div className="main-col">
        <div className="main-top">
          <div className="main-top-left"><SeiraMark size={20} /></div>
          <div className="st-steps"><span className="st-step" /><span className="st-step" /><span className="st-step" /></div>
        </div>

        <div className="main-stage">
          <div className="st-card">
            {!done ? (
              <>
                <span className="st-label">Settling your payment to</span>
                <h1 className="st-headline">{payment.recipient || "your recipient"}</h1>
                <div className="st-ticker">
                  <div className="st-spine"><div className="st-spine-fill" style={{ height: `${(current / TICKER_STEPS.length) * 100}%` }} /></div>
                  {TICKER_STEPS.map((s, i) => (
                    <div key={s.key} className={`st-node ${i < current ? "is-done" : i === current ? "is-active" : ""}`}>
                      <span className="st-node-mark">{i < current ? <Check size={9} /> : i === current ? <Spinner size={10} /> : null}</span>
                      <span className="st-node-text"><span className="st-node-label">{s.label}</span><span className="st-node-detail">{s.detail}</span></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="st-receipt">
                <span className="st-label">Payment complete</span>
                <h1 className="st-headline">{payment.recipient || "Recipient"} got paid</h1>
                <div className="st-receipt-panel">
                  <div className="st-received-k">Merchant received</div>
                  <div className="st-received-v">{payment.amount}<span>{payment.receiveAsset}</span></div>
                  <div className="st-meta-row"><span className="st-meta-k">Route</span><span className="st-meta-v">{payment.buyerAsset} → Seira Router → {payment.receiveAsset}</span></div>
                  <div className="st-meta-row"><span className="st-meta-k">Transaction</span><span className="st-meta-v">0x8f2a...c94d</span></div>
                  <div className="st-meta-row"><span className="st-meta-k">Settled in</span><span className="st-meta-v">6 sec</span></div>
                </div>
                <div className="st-actions">
                  <button className="st-done-btn" onClick={onDone}>Done</button>
                  <button className="st-merchant-link" onClick={onViewMerchant}>View as Merchant <ArrowUpRight /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MerchantScreen({ payment, onBack }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 120); return () => clearTimeout(t); }, []);

  return (
    <div className="app-shell">
      <style>{`
        ${TOKENS}
        *{ box-sizing:border-box; }
        .app-shell{ min-height:100vh; display:grid; grid-template-columns:1fr; background:var(--paper); color:var(--ink); font-family:var(--font-body); }
        @media (min-width:960px){ .app-shell{ grid-template-columns:420px 1fr; } }

        .brand-panel{ display:none; }
        @media (min-width:960px){
          .brand-panel{ display:flex; flex-direction:column; justify-content:space-between;
            background:var(--ink); color:var(--paper); padding:44px 40px; position:relative; overflow:hidden; }
        }
        .brand-top{ display:flex; align-items:center; gap:10px; position:relative; z-index:1; }
        .brand-top span{ font-family:var(--font-display); font-size:19px; }
        .brand-mid{ position:relative; z-index:1; }
        .brand-statement{ font-family:var(--font-display); font-size:clamp(27px, 2vw, 32px); line-height:1.38; max-width:19ch; margin:0 0 40px; }
        .brand-statement em{ font-style:italic; color:var(--pink); }
        .brand-chain{ position:relative; padding-left:22px; }
        .brand-chain-spine{ position:absolute; left:4px; top:5px; bottom:5px; width:1px; background:var(--line-dark); overflow:hidden; }
        .brand-chain-pulse{ position:absolute; left:-3.5px; width:8px; height:8px; border-radius:50%; background:var(--pink);
          box-shadow:0 0 0 5px rgba(255,26,94,.18); animation:brand-travel 4.8s var(--ease-in-out) infinite; }
        @keyframes brand-travel{ 0%{ top:0%; opacity:0; } 6%{ opacity:1; } 94%{ opacity:1; } 100%{ top:100%; opacity:0; } }
        .brand-chain-item{ font-family:var(--font-mono); font-size:12.5px; color:rgba(250,249,247,.5); padding:9px 0; }
        .brand-foot{ font-family:var(--font-mono); font-size:11px; color:rgba(250,249,247,.4); position:relative; z-index:1; }

        .main-col{ display:flex; flex-direction:column; position:relative;
          background:
            radial-gradient(ellipse 900px 600px at 100% 0%, rgba(255,26,94,.045), transparent 60%),
            radial-gradient(ellipse 800px 600px at 0% 45%, rgba(255,26,94,.03), transparent 55%),
            radial-gradient(ellipse 700px 500px at 90% 100%, rgba(255,26,94,.025), transparent 55%);
        }
        .main-top{ padding:26px 32px; display:flex; align-items:center; gap:9px; }
        .main-top .mr-brand{ font-family:var(--font-display); font-size:18px; color:var(--ink-soft); }
        @media (min-width:960px){ .main-top{ display:none; } }

        .main-stage{ flex:1; display:flex; align-items:center; justify-content:center; padding:12px 24px 60px; }
        .mr-card{ width:100%; max-width:520px; text-align:center; }

        .mr-mark{ display:flex; justify-content:center; margin-bottom:20px;
          opacity:0; transform:scale(.9); transition:opacity .5s var(--ease-out), transform .5s var(--ease-out); }
        .mr-mark.is-in{ opacity:1; transform:scale(1); }

        .mr-label{ font-size:clamp(13.5px, 1vw, 16px); color:var(--ink-soft); margin-bottom:8px; }
        .mr-amount{ font-family:var(--font-display); font-size:clamp(52px, 4.4vw, 68px); line-height:1; margin:0 0 6px; }
        .mr-amount span{ font-family:var(--font-mono); font-size:16px; color:var(--pink-deep); font-weight:600; margin-left:10px; }
        .mr-from{ font-size:clamp(15.5px, 1.15vw, 18px); color:var(--ink-soft); margin-bottom:32px; }
        .mr-from b{ color:var(--ink); font-weight:600; }

        .mr-proof{ border:1px solid var(--line); border-radius:16px; padding:20px 22px; text-align:left; margin-bottom:28px; }
        .mr-proof-row{ display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; font-size:12.5px; }
        .mr-proof-row + .mr-proof-row{ border-top:1px solid var(--line); }
        .mr-proof-k{ color:var(--ink-soft); }
        .mr-proof-v{ font-family:var(--font-mono); color:var(--ink); }

        .mr-back{ display:inline-flex; align-items:center; gap:7px; font-size:13.5px; font-weight:600;
          color:var(--ink-soft); background:none; border:none; cursor:pointer;
          transition:color .15s var(--ease-out), gap .15s var(--ease-out); }
        .mr-back:hover{ color:var(--pink-deep); gap:10px; }

        @media (prefers-reduced-motion: reduce){
          .mr-mark{ transition:none; opacity:1; transform:none; }
          .brand-chain-pulse{ animation:none; opacity:1; top:50%; }
        }
      `}</style>

      <aside className="brand-panel">
        <div className="brand-top"><SeiraMark /><span>Seira · Merchant</span></div>
        <div className="brand-mid">
          <p className="brand-statement">One confirmation. <em>No manual swap, on either side.</em></p>
          <div className="brand-chain">
            <div className="brand-chain-spine"><span className="brand-chain-pulse" /></div>
            {BRAND_STEPS.map((s) => <div className="brand-chain-item" key={s}>{s}</div>)}
          </div>
        </div>
        <div className="brand-foot">Coston2 Testnet · Built on Flare</div>
      </aside>

      <div className="main-col">
        <div className="main-top"><SeiraMark size={20} /><span className="mr-brand">Seira · Merchant</span></div>

        <div className="main-stage">
          <div className="mr-card">
            <div className={`mr-mark ${settled ? "is-in" : ""}`}><RouteVerified /></div>
            <div className="mr-label">Payment received</div>
            <h1 className="mr-amount">{payment.amount}<span>{payment.receiveAsset}</span></h1>
            <p className="mr-from">from a buyer who paid in <b>{payment.buyerAsset}</b>. No manual swap, on either side.</p>

            <div className="mr-proof">
              <div className="mr-proof-row"><span className="mr-proof-k">Settlement route</span><span className="mr-proof-v">{payment.buyerAsset} → Seira Router → {payment.receiveAsset}</span></div>
              <div className="mr-proof-row"><span className="mr-proof-k">Transaction</span><span className="mr-proof-v">0x8f2a...c94d</span></div>
              <div className="mr-proof-row"><span className="mr-proof-k">Settled in</span><span className="mr-proof-v">6 sec</span></div>
              <div className="mr-proof-row"><span className="mr-proof-k">Network</span><span className="mr-proof-v">Coston2</span></div>
            </div>

            <button className="mr-back" onClick={onBack}><ArrowLeft /> Back to Seira</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SeiraApp() {
  const [screen, setScreen] = useState("landing");
  const [payment, setPayment] = useState({
    recipient: "Coffee House",
    amount: "25",
    receiveAsset: "USDT0",
    buyerAsset: "FXRP",
    convertedAmount: "54.73",
  });

  const goTo = (s) => { setScreen(s); if (typeof window !== "undefined") window.scrollTo(0, 0); };

  return (
    <>
      {screen === "landing" && <LandingScreen onStart={() => goTo("connect")} />}
      {screen === "connect" && <ConnectScreen onConnected={() => goTo("create")} />}
      {screen === "create" && (
        <CreateScreen
          payment={payment}
          setPayment={setPayment}
          onBack={() => goTo("connect")}
          onContinue={() => goTo("confirm")}
        />
      )}
      {screen === "confirm" && (
        <ConfirmScreen payment={payment} onBack={() => goTo("create")} onConfirm={() => goTo("status")} />
      )}
      {screen === "status" && (
        <StatusScreen payment={payment} onDone={() => goTo("landing")} onViewMerchant={() => goTo("merchant")} />
      )}
      {screen === "merchant" && <MerchantScreen payment={payment} onBack={() => goTo("landing")} />}
    </>
  );
}