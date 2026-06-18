/* ============================================================================
 * DecisionTwin AI — Simulation Engine (browser port)
 * Faithful JS port of the Python backend engine. No dependencies.
 * ========================================================================== */

/* ── Seeded PRNG (mulberry32) so A/B runs are reproducible ─────────────── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Gaussian via Box–Muller, driven by a uniform rng */
function gauss(rng, mean, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + sd * n;
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const clip  = (v) => Math.max(0.02, Math.min(0.98, v));

/* ── Stages & reasons ─────────────────────────────────────────────────── */
export const STAGE = {
  RFQ:   "RFQ Submission",
  QUOTE: "Quote Evaluation",
  NEG:   "Negotiation",
  APPR:  "Approval",
  WON:   "Purchase",
};

const REASON = {
  NOT_ENGAGED: "Never engaged — weak product fit / brand trust",
  SLOW_QUOTE:  "Quote too slow — buyer went to competitor",
  PRICE_GAP:   "Price gap too large vs. competitor",
  DELIVERY:    "Delivery lead time unacceptable",
  PAYMENT:     "Payment terms didn't fit buyer cashflow",
  CFO_VETO:    "Blocked in internal approval (CFO / procurement veto)",
};

/* ── Buying committee ─────────────────────────────────────────────────── */
const BASE_PERSONAS = {
  procurement_manager:     { price_sensitivity: 0.80, urgency: 0.45, loyalty: 0.35, authority_level: 0.60, risk_tolerance: 0.40 },
  technical_buyer:         { price_sensitivity: 0.50, urgency: 0.55, loyalty: 0.55, authority_level: 0.45, risk_tolerance: 0.55 },
  business_decision_maker: { price_sensitivity: 0.65, urgency: 0.70, loyalty: 0.40, authority_level: 0.85, risk_tolerance: 0.50 },
  end_user:                { price_sensitivity: 0.35, urgency: 0.75, loyalty: 0.60, authority_level: 0.20, risk_tolerance: 0.45 },
  cfo:                     { price_sensitivity: 0.90, urgency: 0.30, loyalty: 0.35, authority_level: 0.95, risk_tolerance: 0.30 },
};

const COMMITTEE = [
  ["procurement_manager", 0.30],
  ["technical_buyer", 0.20],
  ["business_decision_maker", 0.20],
  ["end_user", 0.20],
  ["cfo", 0.10],
];

function sampleBuyer(rng, overrides) {
  const r = rng();
  let acc = 0, ptype = COMMITTEE[0][0];
  for (const [t, w] of COMMITTEE) { acc += w; if (r <= acc) { ptype = t; break; } }

  let base = { ...BASE_PERSONAS[ptype] };
  if (overrides) {
    for (const k of Object.keys(base)) {
      const o = overrides[k];
      if (typeof o === "number") base[k] = 0.4 * base[k] + 0.6 * o;
    }
  }
  return {
    type: ptype,
    price_sensitivity: clamp(gauss(rng, base.price_sensitivity, 0.10)),
    urgency:           clamp(gauss(rng, base.urgency, 0.10)),
    loyalty:           clamp(gauss(rng, base.loyalty, 0.10)),
    authority_level:   clamp(gauss(rng, base.authority_level, 0.10)),
    risk_tolerance:    clamp(gauss(rng, base.risk_tolerance, 0.10)),
  };
}

/* ── Friction curves ──────────────────────────────────────────────────── */
function pricePressure(s) {
  if (s.competitor_price <= 0) return 0;
  const gap = (s.base_price - s.competitor_price) / s.competitor_price;
  return Math.max(0, Math.min(1.5, gap * 10));
}
function quoteLateness(s) {
  const h = s.quote_time_hours;
  if (h <= 24) return 0;
  if (h <= 72) return (h - 24) / 96;
  return Math.min(1, 0.5 + (h - 72) / 200);
}
function deliveryPain(s) {
  const d = s.delivery_days;
  if (d <= 7) return 0;
  if (d <= 30) return (d - 7) / 46;
  return Math.min(1, 0.5 + (d - 30) / 60);
}
function paymentFriction(s) {
  const t = (s.payment_terms || "").toLowerCase();
  if (t.includes("prepay") || t.includes("advance")) return 0.7;
  if (t.includes("net 7") || t.includes("net 15")) return 0.4;
  if (t.includes("net 30") || t.includes("net 60")) return 0.1;
  return 0.2;
}

/* ── Stage probabilities ──────────────────────────────────────────────── */
const pEngage = (b) => clip(0.85 - 0.25 * b.loyalty + 0.15 * b.risk_tolerance);
const pQuote  = (b, s) => clip(0.95 - quoteLateness(s) * (0.4 + 0.6 * b.urgency)
                                     - pricePressure(s) * (0.3 + 0.7 * b.price_sensitivity));
function pNeg(b, s) {
  const ep = Math.max(0, pricePressure(s) - s.discount_available / 100 * 2.5);
  return clip(0.90 - ep * (0.3 + 0.7 * b.price_sensitivity)
                   - deliveryPain(s) * (0.3 + 0.7 * b.urgency)
                   - paymentFriction(s) * (0.4 + 0.3 * b.price_sensitivity));
}
const pAppr = (b, s) => clip(0.92 - pricePressure(s) * (1 - b.authority_level) * 0.6
                                   - (1 - b.risk_tolerance) * 0.15);

function simulateOne(rng, buyer, s) {
  const eff = s.base_price * (1 - s.discount_available / 100);
  if (rng() > pEngage(buyer))   return { stage: STAGE.RFQ,   won: false, reason: REASON.NOT_ENGAGED, revenue: 0 };
  if (rng() > pQuote(buyer, s)) {
    const reason = quoteLateness(s) > pricePressure(s) ? REASON.SLOW_QUOTE : REASON.PRICE_GAP;
    return { stage: STAGE.QUOTE, won: false, reason, revenue: 0 };
  }
  if (rng() > pNeg(buyer, s)) {
    const d = deliveryPain(s), p = paymentFriction(s), pr = pricePressure(s);
    const reason = (d >= p && d >= pr) ? REASON.DELIVERY : (p >= pr ? REASON.PAYMENT : REASON.PRICE_GAP);
    return { stage: STAGE.NEG, won: false, reason, revenue: 0 };
  }
  if (rng() > pAppr(buyer, s)) return { stage: STAGE.APPR, won: false, reason: REASON.CFO_VETO, revenue: 0 };
  return { stage: STAGE.WON, won: true, reason: null, revenue: eff };
}

/* ── Public: run a full simulation ────────────────────────────────────── */
export function runSimulation(scenario, {
  numAgents = 1000,
  personaOverrides = null,
  annualDealCount = 500,
  seed = 42,
} = {}) {
  const rng = mulberry32(seed);
  const leak = new Map();           // "stage|reason" -> count
  const stageCounts = {};
  let won = 0, total = 0;

  for (let i = 0; i < numAgents; i++) {
    const b = sampleBuyer(rng, personaOverrides);
    const o = simulateOne(rng, b, scenario);
    stageCounts[o.stage] = (stageCounts[o.stage] || 0) + 1;
    if (o.won) { won++; total += o.revenue; }
    else if (o.reason) {
      const key = o.stage + "|" + o.reason;
      leak.set(key, (leak.get(key) || 0) + 1);
    }
  }

  const conv  = numAgents ? won / numAgents : 0;
  const aov   = won ? total / won : 0;
  const eff   = scenario.base_price * (1 - scenario.discount_available / 100);
  const pot   = eff * numAgents;
  const lost  = Math.max(0, pot - total);
  const scale = numAgents ? annualDealCount / numAgents : 1;

  const leakMap = [];
  for (const [key, cnt] of leak.entries()) {
    const [stage, reason] = key.split("|");
    const rl = cnt * eff;
    leakMap.push({
      stage, reason,
      agents_lost: cnt,
      revenue_lost: Math.round(rl * 100) / 100,
      pct_of_total_loss: lost ? Math.round((rl / lost) * 1000) / 10 : 0,
    });
  }
  leakMap.sort((a, b) => b.revenue_lost - a.revenue_lost);

  let topInsight = "Strong funnel — pricing and terms are well-calibrated.";
  let recommendation = "Consider a small price lift to capture more margin.";
  if (leakMap.length) {
    const t = leakMap[0];
    const ann = lost * scale * t.pct_of_total_loss / 100;
    const r = t.reason.toLowerCase();
    if (r.includes("slow") || (r.includes("quote") && r.includes("too")))
      recommendation = `Cut quote turnaround to <24h — could recover ~£${fmt(ann)}/yr.`;
    else if (r.includes("price"))
      recommendation = `Close the price gap or offer a ${Math.max(5, Math.round(scenario.discount_available + 3))}% volume discount.`;
    else if (r.includes("delivery"))
      recommendation = `Offer a ${Math.max(7, Math.floor(scenario.delivery_days / 2))}-day expedited delivery option.`;
    else if (r.includes("payment"))
      recommendation = "Offer Net 30/60 terms for cashflow-constrained buyers.";
    else if (r.includes("approval") || r.includes("veto"))
      recommendation = "Prepare a CFO/procurement briefing pack (ROI + TCO) to help champions close.";
    topInsight = `Biggest leak: "${t.reason}" at the ${t.stage} stage — ${Math.round(t.pct_of_total_loss)}% of lost revenue (~£${fmt(ann)}/yr).`;
  }

  return {
    num_agents: numAgents,
    conversion_rate: Math.round(conv * 10000) / 10000,
    total_revenue: Math.round(total * 100) / 100,
    revenue_lost: Math.round(lost * 100) / 100,
    potential_revenue: Math.round(pot * 100) / 100,
    avg_order_value: Math.round(aov * 100) / 100,
    annual_revenue_at_risk: Math.round(lost * scale),
    revenue_leak_map: leakMap,
    top_insight: topInsight,
    recommendation,
    stage_breakdown: stageCounts,
  };
}

export function fmt(n) {
  return Math.round(n).toLocaleString("en-GB");
}

export const STAGE_ORDER = [STAGE.RFQ, STAGE.QUOTE, STAGE.NEG, STAGE.APPR, STAGE.WON];
