/* ============================================================================
 * DecisionTwin AI — UI controller
 * ========================================================================== */
import { runSimulation, fmt, STAGE_ORDER, STAGE } from "./engine.js";

const $ = (id) => document.getElementById(id);
document.getElementById("year").textContent = new Date().getFullYear();

/* ── Templates ─────────────────────────────────────────────────────────── */
const TEMPLATES = {
  custom:  { base_price: 12000, competitor_price: 11500, quote_time_hours: 72,  delivery_days: 21, discount_available: 2 },
  slow:    { base_price: 12000, competitor_price: 11500, quote_time_hours: 168, delivery_days: 21, discount_available: 2 },
  fast:    { base_price: 12000, competitor_price: 11500, quote_time_hours: 12,  delivery_days: 21, discount_available: 2 },
  leader:  { base_price: 9800,  competitor_price: 11500, quote_time_hours: 48,  delivery_days: 14, discount_available: 0 },
  tooling: { base_price: 850,   competitor_price: 799,   quote_time_hours: 24,  delivery_days: 10, discount_available: 8 },
};

/* ── Live range labels ─────────────────────────────────────────────────── */
const RANGE_LABELS = {
  quote_time_hours: (v) => v + "h",
  delivery_days: (v) => v + "d",
  discount_available: (v) => v + "%",
  price_sensitivity: (v) => (+v).toFixed(2),
  urgency: (v) => (+v).toFixed(2),
  loyalty: (v) => (+v).toFixed(2),
  authority_level: (v) => (+v).toFixed(2),
  risk_tolerance: (v) => (+v).toFixed(2),
};
const LABEL_TARGET = {
  quote_time_hours: "qh_v", delivery_days: "dd_v", discount_available: "di_v",
  price_sensitivity: "ps_v", urgency: "ur_v", loyalty: "lo_v",
  authority_level: "al_v", risk_tolerance: "rt_v",
};
function bindRange(id) {
  const el = $(id);
  if (!el) return;
  const update = () => { const t = $(LABEL_TARGET[id]); if (t) t.textContent = RANGE_LABELS[id](el.value); };
  el.addEventListener("input", update); update();
}
Object.keys(LABEL_TARGET).forEach(bindRange);

/* ── Read scenario from a form scope (prefix-less for main form) ──────── */
function readScenario(scope = document) {
  const g = (id) => scope.querySelector("#" + id) || $(id);
  return {
    base_price: +g("base_price").value,
    competitor_price: +g("competitor_price").value,
    quote_time_hours: +g("quote_time_hours").value,
    delivery_days: +g("delivery_days").value,
    discount_available: +g("discount_available").value,
    payment_terms: g("payment_terms").value,
  };
}
function readPersona(scope = document) {
  const g = (id) => scope.querySelector("#" + id) || $(id);
  return {
    price_sensitivity: +g("price_sensitivity").value,
    urgency: +g("urgency").value,
    loyalty: +g("loyalty").value,
    authority_level: +g("authority_level").value,
    risk_tolerance: +g("risk_tolerance").value,
  };
}

/* ── Template selector ─────────────────────────────────────────────────── */
$("template").addEventListener("change", (e) => {
  const t = TEMPLATES[e.target.value];
  if (!t) return;
  for (const [k, v] of Object.entries(t)) { const el = $(k); if (el) el.value = v; }
  Object.keys(LABEL_TARGET).forEach((id) => { const el = $(id); if (el) el.dispatchEvent(new Event("input")); });
});

/* ── Tabs ──────────────────────────────────────────────────────────────── */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("pane-" + tab.dataset.tab).classList.add("active");
  });
});

/* ── Renderers ─────────────────────────────────────────────────────────── */
function kpis(r) {
  return `<div class="kpis">
    <div class="kpi"><div class="label">Conversion</div><div class="value">${(r.conversion_rate*100).toFixed(1)}%</div></div>
    <div class="kpi good"><div class="label">Revenue won</div><div class="value">£${fmt(r.total_revenue)}</div></div>
    <div class="kpi danger"><div class="label">Revenue lost</div><div class="value">£${fmt(r.revenue_lost)}</div></div>
    <div class="kpi"><div class="label">Avg order</div><div class="value">£${fmt(r.avg_order_value)}</div></div>
  </div>`;
}

function funnel(r) {
  const drops = {};
  for (const s of STAGE_ORDER) drops[s] = 0;
  for (const e of r.revenue_leak_map) drops[e.stage] = (drops[e.stage] || 0) + e.agents_lost;
  let remaining = r.num_agents;
  const rows = [];
  const colors = ["#6c8cff", "#5bbfd0", "#ffb454", "#ff6b6b", "#54d6a5"];
  STAGE_ORDER.forEach((s, i) => {
    const entered = remaining;
    const pct = (entered / r.num_agents) * 100;
    rows.push(`<div class="funnel-row">
      <span class="lbl">${s}</span>
      <div class="funnel-bar-track"><div class="funnel-bar" style="width:${pct.toFixed(1)}%;background:${colors[i]}"></div></div>
      <span class="num">${fmt(entered)} (${pct.toFixed(0)}%)</span>
    </div>`);
    remaining -= drops[s] || 0;
    if (remaining < 0) remaining = 0;
  });
  return `<div class="chart-block"><h4>Decision funnel</h4><div class="funnel">${rows.join("")}</div></div>`;
}

function leakMap(r) {
  if (!r.revenue_leak_map.length)
    return `<div class="chart-block"><h4>Revenue Leak Map</h4><div class="recommend">No significant revenue leaks detected 🎉</div></div>`;
  const max = r.revenue_leak_map[0].revenue_lost || 1;
  const rows = r.revenue_leak_map.map((e) => `
    <div class="leak-row">
      <div class="leak-head"><span class="reason">${e.reason}</span><span class="amt">£${fmt(e.revenue_lost)}</span></div>
      <div class="leak-track"><div class="leak-fill" style="width:${(e.revenue_lost/max*100).toFixed(1)}%"></div></div>
      <span class="stage-tag">${e.stage} · ${e.agents_lost} buyers · ${e.pct_of_total_loss}% of loss</span>
    </div>`).join("");
  return `<div class="chart-block"><h4>Revenue Leak Map</h4><div class="leak">${rows}</div></div>`;
}

function renderResult(r, { withExport = true } = {}) {
  return `
    ${kpis(r)}
    <div class="insight"><b>Top insight</b>${r.top_insight}</div>
    <div class="recommend"><b>Recommendation</b>${r.recommendation}</div>
    <div class="insight" style="background:rgba(255,180,84,.1);border-color:rgba(255,180,84,.3)">
      <b>Annual revenue at risk</b>~£${fmt(r.annual_revenue_at_risk)} per year, scaled to your pipeline.
    </div>
    ${funnel(r)}
    ${leakMap(r)}
    ${withExport ? `<div class="result-actions"><button class="btn btn-ghost" id="dl-csv">⬇️ Download CSV</button></div>` : ""}
  `;
}

function toCSV(r) {
  const rows = [
    ["Metric", "Value"],
    ["Agents", r.num_agents],
    ["Conversion rate", (r.conversion_rate).toFixed(4)],
    ["Total revenue (GBP)", r.total_revenue],
    ["Revenue lost (GBP)", r.revenue_lost],
    ["Avg order value (GBP)", r.avg_order_value],
    ["Annual revenue at risk (GBP)", r.annual_revenue_at_risk],
    [],
    ["Stage", "Reason", "Agents lost", "Revenue lost (GBP)", "% of loss"],
    ...r.revenue_leak_map.map((e) => [e.stage, e.reason, e.agents_lost, e.revenue_lost, e.pct_of_total_loss]),
    [],
    ["Top insight", r.top_insight],
    ["Recommendation", r.recommendation],
  ];
  return rows.map((row) => row.map((c) => `"${String(c ?? "")}"`).join(",")).join("\n");
}
function download(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Single simulation ─────────────────────────────────────────────────── */
$("form-a").addEventListener("submit", (e) => {
  e.preventDefault();
  const scenario = readScenario();
  const persona = readPersona();
  const numAgents = +$("num_agents").value;
  const annualDeals = +$("annual_deals").value;
  const r = runSimulation(scenario, {
    numAgents, personaOverrides: persona, annualDealCount: annualDeals,
    seed: Math.floor(Math.random() * 99999),
  });
  $("empty-state").hidden = true;
  const body = $("result-body");
  body.hidden = false;
  body.innerHTML = renderResult(r);
  const dl = $("dl-csv");
  if (dl) dl.addEventListener("click", () => download("decisiontwin_result.csv", toCSV(r)));
  body.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

/* ── Compare A/B — build two compact forms ─────────────────────────────── */
function compactForm(label, defaults) {
  const f = (id, lbl, val, attrs = "") => `
    <label class="field"><span>${lbl}</span><input id="${id}" value="${val}" ${attrs}></label>`;
  return `<form class="panel" data-cmp="${label}">
    <h4 style="margin-bottom:14px">${label === "A" ? "Baseline (A)" : "Variant (B)"}</h4>
    ${f("c"+label+"_base_price", "Your price (£)", defaults.base_price, "type=number min=0 step=any")}
    ${f("c"+label+"_competitor_price", "Competitor price (£)", defaults.competitor_price, "type=number min=0 step=any")}
    ${f("c"+label+"_quote_time_hours", "Quote turnaround (h)", defaults.quote_time_hours, "type=number min=1 step=any")}
    ${f("c"+label+"_delivery_days", "Delivery (days)", defaults.delivery_days, "type=number min=1 step=any")}
    ${f("c"+label+"_discount_available", "Discount (%)", defaults.discount_available, "type=number min=0 max=50 step=any")}
    <label class="field"><span>Payment terms</span>
      <select id="c${label}_payment_terms"><option>Net 30</option><option>Net 60</option><option>Net 15</option><option>Net 7</option><option>Prepay</option></select>
    </label>
  </form>`;
}
$("compare-forms").innerHTML =
  compactForm("A", TEMPLATES.slow) + compactForm("B", TEMPLATES.fast);

function readCmp(label) {
  const g = (id) => $("c" + label + "_" + id);
  return {
    base_price: +g("base_price").value,
    competitor_price: +g("competitor_price").value,
    quote_time_hours: +g("quote_time_hours").value,
    delivery_days: +g("delivery_days").value,
    discount_available: +g("discount_available").value,
    payment_terms: g("payment_terms").value,
  };
}

$("run-compare").addEventListener("click", () => {
  const seed = Math.floor(Math.random() * 99999);
  const opts = { numAgents: 1000, annualDealCount: +$("annual_deals").value || 500, seed };
  const ra = runSimulation(readCmp("A"), opts);
  const rb = runSimulation(readCmp("B"), opts);

  const gain = rb.total_revenue - ra.total_revenue;
  const ppGain = (rb.conversion_rate - ra.conversion_rate) * 100;
  const cls = gain > 0 ? "up" : gain < 0 ? "down" : "";
  const verdict = gain > 0
    ? `Scenario B wins — ship it.`
    : gain < 0 ? `Scenario A is better — keep it.` : `Economically equivalent.`;

  const metrics = [
    ["Conversion rate", "conversion_rate", true],
    ["Total revenue (£)", "total_revenue", false],
    ["Revenue lost (£)", "revenue_lost", false],
    ["Avg order value (£)", "avg_order_value", false],
  ];
  const rowsHtml = metrics.map(([lbl, key, isPct]) => {
    const a = ra[key], b = rb[key];
    const d = b - a, pct = a ? (d / a * 100) : 0;
    const f = (v) => isPct ? (v*100).toFixed(1)+"%" : "£"+fmt(v);
    return `<tr><td>${lbl}</td><td>${f(a)}</td><td>${f(b)}</td><td>${d>=0?"+":""}${isPct?(d*100).toFixed(1)+" pp":"£"+fmt(d)}</td><td>${pct>=0?"+":""}${pct.toFixed(1)}%</td></tr>`;
  }).join("");

  $("compare-results").innerHTML = `
    <div class="cmp-summary">
      <div class="big ${cls}">${gain>=0?"+":"−"}£${fmt(Math.abs(gain))}</div>
      <div style="color:var(--ink-soft)">${verdict} &nbsp;·&nbsp; ${ppGain>=0?"+":""}${ppGain.toFixed(1)} pp conversion</div>
    </div>
    <table class="delta">
      <thead><tr><th>Metric</th><th>A</th><th>B</th><th>Δ</th><th>Δ%</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="cmp-cols">
      <div class="panel"><h4 style="margin-bottom:14px">Scenario A — Baseline</h4>${renderResult(ra,{withExport:false})}</div>
      <div class="panel"><h4 style="margin-bottom:14px">Scenario B — Variant</h4>${renderResult(rb,{withExport:false})}</div>
    </div>`;
  $("compare-results").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
