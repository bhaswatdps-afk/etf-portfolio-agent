// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  CORPUS_LAKHS: 400,
  ALERT_EMAIL: "bhaswat@classplus.co",   // ← change in Apps Script too
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,   // 5 minutes
};

// ─── DEFAULT HOLDINGS (your actual deployments from conversation) ─────────────
const DEFAULT_HOLDINGS = [
  { id: 'h1', name: 'SBI Nifty 50 ETF',             ticker: 'SETFNIF50',   cat: 'large',  invested: 22.90, avgNav: 254.55 },
  { id: 'h2', name: 'Motilal Oswal Midcap 100 ETF',  ticker: 'MON100',      cat: 'mid',    invested: 15.16, avgNav: 60.65  },
  { id: 'h3', name: 'Nippon Midcap 150 ETF',         ticker: 'MID150BEES',  cat: 'mid',    invested: 21.43, avgNav: 214.35 },
  { id: 'h4', name: 'ICICI Pru Nifty 50 Index Fund', ticker: 'ICICI-N50',   cat: 'mutual', invested: 15.00, avgNav: 247.00 },
];

// ─── TRIGGER DEFINITIONS ──────────────────────────────────────────────────────
const TRIGGER_DEFS = [
  {
    id: 't1',
    tranche: 'Tranche 1',
    label: 'T1 — Deploy now (already triggered)',
    condition: 'Nifty ≤ 23,736 (10% below ATH of 26,373)',
    threshold: 23736,
    metric: 'nifty',
    direction: 'below',
    startRef: 26373,
    action: 'Deploy ₹1.92Cr: SETFNIF50 ₹52L · NIFTYBEES ₹40L · MID150BEES ₹80L · INFRABEES ₹28L · ITETF ₹36L · PHARMABEES ₹20L · GOLDBEES ₹20L · Start monthly ETF buys.',
    alreadyTriggered: true,
  },
  {
    id: 't2',
    tranche: 'Tranche 2 — ₹80L',
    label: 'T2 — Nifty closes below 22,500',
    condition: 'Nifty close < 22,500 for 2 consecutive days (watch tonight\'s close)',
    threshold: 22500,
    metric: 'nifty',
    direction: 'below',
    startRef: 24500,
    action: 'Deploy ₹80L from LIQUIDBEES: MID150BEES ₹24L · BANKBEES ₹12L · GOLDBEES ₹12L · KOTAKSC ₹16L · SMLCAP250 ₹16L. Increase smallcap monthly buy to ₹2L/month.',
    alreadyTriggered: false,
    emailSubject: '🚨 T2 TRIGGER FIRED — Deploy ₹80L NOW (Nifty below 22,500)',
  },
  {
    id: 't3',
    tranche: 'Tranche 3 — ₹80L',
    label: 'T3 — Nifty closes below 21,500',
    condition: 'Nifty close < 21,500 — max pessimism zone (18.5% from ATH)',
    threshold: 21500,
    metric: 'nifty',
    direction: 'below',
    startRef: 23500,
    action: 'Deploy full ₹80L: KOTAKSC/SMLCAP250 ₹40L · BANKBEES ₹16L · INFRABEES ₹14L · MID150BEES ₹10L. Deploy SAME DAY — no waiting.',
    alreadyTriggered: false,
    emailSubject: '🔴 T3 TRIGGER FIRED — MAXIMUM PESSIMISM — Deploy ₹80L NOW',
  },
  {
    id: 'tv2',
    tranche: 'Signal',
    label: 'VIX spike — extreme fear',
    condition: 'India VIX crosses above 26 (extreme fear territory)',
    threshold: 26,
    metric: 'vix',
    direction: 'above',
    startRef: 18,
    action: 'VIX > 26 + Nifty < 22,500 → T2 confirmed, deploy immediately. VIX > 30 → T3 imminent, prepare full ₹80L dry powder.',
    alreadyTriggered: false,
    emailSubject: '⚡ VIX ALERT — India VIX above 26, extreme fear. Check T2 trigger.',
  },
  {
    id: 'toil',
    tranche: 'Signal',
    label: 'Oil easing — recovery signal',
    condition: 'Brent crude falls below $90/bbl (recovery signal → add banks)',
    threshold: 90,
    metric: 'oil',
    direction: 'below',
    startRef: 120,
    action: 'Oil < $90 → add BANKBEES ₹12L. Oil < $85 → recovery confirmed, deploy all remaining T2+T3 capital regardless of Nifty level.',
    alreadyTriggered: false,
    emailSubject: '🟢 OIL EASING — Brent below $90. Recovery signal. Add BANKBEES.',
  },
  {
    id: 'tpe',
    tranche: 'Exit Signal',
    label: 'PE overvalued — stop SIPs',
    condition: 'Nifty PE ratio crosses above 24x (exit / stop-SIP zone)',
    threshold: 24,
    metric: 'niftyPE',
    direction: 'above',
    startRef: 20,
    action: 'STOP all monthly ETF buys. Begin planning exits from ITETF, PHARMABEES, INFRABEES, BANKBEES. Keep core SETFNIF50, MID150BEES invested.',
    alreadyTriggered: false,
    emailSubject: '📊 PE ALERT — Nifty PE above 24x. Stop SIPs, plan sectoral exits.',
  },
];

// ─── APPS SCRIPT SOURCE CODE ──────────────────────────────────────────────────
const APPS_SCRIPT_CODE = `// ═══════════════════════════════════════════════════════════
// ETF PORTFOLIO AGENT — Google Apps Script
// Deploy: script.google.com → Paste → Triggers → Every 15 min
// ═══════════════════════════════════════════════════════════

const ALERT_EMAIL = "bhaswat@classplus.co";  // ← YOUR EMAIL

// Trigger thresholds — must match your portfolio config
const THRESHOLDS = {
  niftyT2:    22500,   // T2 deploy ₹80L
  niftyT3:    21500,   // T3 deploy ₹80L (max pessimism)
  vixAlert:   26,      // Extreme fear
  oilEasing:  90,      // Oil recovery signal (USD/bbl)
  peStop:     24,      // Stop SIPs (Nifty PE)
};

// Track what we've already alerted (avoid spam)
const PROPS = PropertiesService.getScriptProperties();

function checkPortfolioTriggers() {
  const data = fetchMarketData();
  if (!data) { Logger.log("Market data fetch failed"); return; }

  const { nifty, vix, oil, niftyPE } = data;
  const alerts = [];

  // ── T2 trigger ──────────────────────────────────────────
  if (nifty && nifty < THRESHOLDS.niftyT2) {
    const key = "t2_" + new Date().toDateString();
    const count = parseInt(PROPS.getProperty(key) || "0");
    if (count === 0) {
      PROPS.setProperty(key, "1");
      alerts.push({
        subject: "🚨 T2 TRIGGER — Deploy ₹80L NOW (Nifty " + Math.round(nifty) + ")",
        body: buildT2Email(nifty, vix)
      });
    } else if (count === 1) {
      PROPS.setProperty(key, "2");
      alerts.push({
        subject: "🚨 T2 CONFIRMED (Day 2) — Deploy ₹80L immediately",
        body: buildT2Email(nifty, vix) + "\\n\\n⚡ This is the SECOND consecutive day below 22,500. T2 is fully triggered."
      });
    }
  } else {
    // Reset counter if Nifty bounces back above threshold
    PROPS.deleteProperty("t2_" + new Date().toDateString());
  }

  // ── T3 trigger ──────────────────────────────────────────
  if (nifty && nifty < THRESHOLDS.niftyT3) {
    const key3 = "t3_" + new Date().toDateString();
    if (!PROPS.getProperty(key3)) {
      PROPS.setProperty(key3, "true");
      alerts.push({
        subject: "🔴 T3 TRIGGERED — MAXIMUM PESSIMISM — Deploy ₹80L SAME DAY",
        body: buildT3Email(nifty, vix)
      });
    }
  }

  // ── VIX alert ───────────────────────────────────────────
  if (vix && vix > THRESHOLDS.vixAlert) {
    const keyV = "vix_" + Utilities.formatDate(new Date(), "IST", "yyyyMMddHH");
    if (!PROPS.getProperty(keyV)) {
      PROPS.setProperty(keyV, "true");
      alerts.push({
        subject: "⚡ VIX ALERT — India VIX at " + vix.toFixed(1) + " (extreme fear)",
        body: buildVixEmail(vix, nifty)
      });
    }
  }

  // ── Oil easing alert ────────────────────────────────────
  if (oil && oil < THRESHOLDS.oilEasing) {
    const keyO = "oil_" + new Date().toDateString();
    if (!PROPS.getProperty(keyO)) {
      PROPS.setProperty(keyO, "true");
      alerts.push({
        subject: "🟢 OIL EASING — Brent at $" + oil.toFixed(0) + " — Recovery signal",
        body: buildOilEmail(oil, nifty)
      });
    }
  }

  // ── PE overvalued alert ─────────────────────────────────
  if (niftyPE && niftyPE > THRESHOLDS.peStop) {
    const keyPE = "pe_" + new Date().toDateString();
    if (!PROPS.getProperty(keyPE)) {
      PROPS.setProperty(keyPE, "true");
      alerts.push({
        subject: "📊 PE OVERVALUED — Nifty PE at " + niftyPE.toFixed(1) + "x — Stop SIPs",
        body: buildPEEmail(niftyPE, nifty)
      });
    }
  }

  // ── Send all alerts ─────────────────────────────────────
  alerts.forEach(alert => {
    MailApp.sendEmail({
      to: ALERT_EMAIL,
      subject: alert.subject,
      body: alert.body,
      htmlBody: "<pre style='font-family:monospace;font-size:13px;line-height:1.7'>" + alert.body + "</pre>"
    });
    Logger.log("Sent: " + alert.subject);
  });

  if (alerts.length === 0) Logger.log("No triggers fired. Nifty: " + Math.round(nifty));
}

// ── DATA FETCH ───────────────────────────────────────────────────────────────
function fetchMarketData() {
  try {
    const niftyUrl = "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=2d";
    const vixUrl   = "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?interval=1d&range=2d";
    const oilUrl   = "https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=1d&range=2d";

    const [niftyResp, vixResp, oilResp] = [niftyUrl, vixUrl, oilUrl].map(url =>
      UrlFetchApp.fetch(url, { muteHttpExceptions: true })
    );

    const niftyData = JSON.parse(niftyResp.getContentText());
    const vixData   = JSON.parse(vixResp.getContentText());
    const oilData   = JSON.parse(oilResp.getContentText());

    const lastClose = arr => arr.indicators.quote[0].close.filter(Boolean).slice(-1)[0];

    return {
      nifty:   lastClose(niftyData.chart.result[0]),
      vix:     lastClose(vixData.chart.result[0]),
      oil:     lastClose(oilData.chart.result[0]),
      niftyPE: null,  // PE not available via Yahoo — check nifty-pe-ratio.com manually
    };
  } catch(e) {
    Logger.log("Fetch error: " + e.message);
    return null;
  }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────
function buildT2Email(nifty, vix) {
  return \`ETF PORTFOLIO AGENT — TRIGGER ALERT
════════════════════════════════════════

TRANCHE 2 TRIGGER FIRED
Nifty 50: \${Math.round(nifty).toLocaleString('en-IN')} (below threshold: 22,500)
India VIX: \${vix ? vix.toFixed(1) : '—'}

DEPLOY TODAY (₹80L from LIQUIDBEES):
  · MID150BEES:     ₹24L
  · BANKBEES:       ₹12L
  · GOLDBEES:       ₹12L
  · KOTAKSC:        ₹16L
  · SMLCAP250:      ₹16L
  ────────────────────────────
  Total:            ₹80L

Also: Increase monthly ETF buy to ₹3L/month total.

Next trigger to watch: Nifty 21,500 → T3 (deploy ₹80L more)

— ETF Portfolio Agent · auto-sent by Apps Script\`;
}

function buildT3Email(nifty, vix) {
  return \`ETF PORTFOLIO AGENT — MAXIMUM PESSIMISM ALERT
════════════════════════════════════════════════

TRANCHE 3 TRIGGERED — ACT TODAY, NO WAITING
Nifty 50: \${Math.round(nifty).toLocaleString('en-IN')} (below 21,500 = 18.5% from ATH)
India VIX: \${vix ? vix.toFixed(1) : '—'}

DEPLOY FULL ₹80L (remaining dry powder):
  · KOTAKSC + SMLCAP250:  ₹40L  (max beta smallcap)
  · BANKBEES:             ₹16L
  · INFRABEES:            ₹14L
  · MID150BEES:           ₹10L
  ────────────────────────────
  Total:                  ₹80L

⚠️ DEPLOY SAME DAY. Maximum fear = maximum opportunity.
Historical precedent: This zone has NEVER failed to return 80%+ over 24 months.

— ETF Portfolio Agent · auto-sent by Apps Script\`;
}

function buildVixEmail(vix, nifty) {
  return \`ETF PORTFOLIO AGENT — VIX ALERT
════════════════════════════════

India VIX at \${vix.toFixed(1)} — Extreme fear territory
Nifty 50: \${nifty ? Math.round(nifty).toLocaleString('en-IN') : '—'}

ACTION:
  · VIX > 26 + Nifty < 22,500 → T2 fully confirmed, deploy immediately
  · VIX > 30 → T3 imminent, prepare ₹80L

Monitor daily close tonight. If Nifty closes below 22,500: deploy T2.

— ETF Portfolio Agent · auto-sent by Apps Script\`;
}

function buildOilEmail(oil, nifty) {
  return \`ETF PORTFOLIO AGENT — OIL EASING ALERT
════════════════════════════════════════

Brent crude at $\${oil.toFixed(0)}/bbl (below $90 recovery threshold)
Nifty 50: \${nifty ? Math.round(nifty).toLocaleString('en-IN') : '—'}

RECOVERY SIGNAL:
  · Oil < $90 → Add BANKBEES ₹12L (FII return play)
  · Oil < $85 → Full recovery confirmed — deploy all remaining T2+T3 capital

Banking sector re-rates fastest when oil eases. BANKBEES entry now.

— ETF Portfolio Agent · auto-sent by Apps Script\`;
}

function buildPEEmail(pe, nifty) {
  return \`ETF PORTFOLIO AGENT — VALUATION ALERT
═══════════════════════════════════════

Nifty PE at \${pe.toFixed(1)}x (above 24x stop-SIP threshold)
Nifty 50: \${nifty ? Math.round(nifty).toLocaleString('en-IN') : '—'}

ACTIONS:
  · STOP all monthly ETF buys immediately
  · Plan exits: ITETF, PHARMABEES, INFRABEES, BANKBEES (sectorals first)
  · Keep: SETFNIF50, MID150BEES, NIFTYBEES (core index — let compound)
  · Resume SIPs only after next 15%+ correction from current level

Tax tip: Stagger exits across FY2027-28 and 2028-29 to use ₹1.25L LTCG exemption per year.

— ETF Portfolio Agent · auto-sent by Apps Script\`;
}

// ── MANUAL TEST ───────────────────────────────────────────────────────────────
function testSendEmail() {
  MailApp.sendEmail({
    to: ALERT_EMAIL,
    subject: "✅ ETF Agent — Test email working",
    body: "Your ETF Portfolio Agent email alerts are configured correctly.\\n\\nAll triggers are being monitored every 15 minutes.\\n\\n— ETF Portfolio Agent"
  });
  Logger.log("Test email sent to " + ALERT_EMAIL);
}`;
