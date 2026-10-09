/* ============================================================
   RELAY — application logic
   Vanilla JS. No framework, no build step, no dependencies.
   ============================================================ */

/* ---------- state ---------- */
const state = {
  view: "queue",
  q: "",
  filterView: "all",
  status: "", conf: "", team: "",
  selected: new Set(),
  focusIdx: 0,
  openId: null,
  demo: null,                 // null | loading | empty | degraded | error | bulk
  policy: JSON.parse(JSON.stringify(DEFAULT_POLICY)),
  tickets: JSON.parse(JSON.stringify(TICKETS)),
  audit: JSON.parse(JSON.stringify(AUDIT)),
  theme: "light"
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtTime = iso => {
  const d = new Date(iso), diff = (Date.now() - d) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const clock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/* Highlight the exact spans the model cited, inside the customer's words. */
function highlight(text, evidence) {
  let html = esc(text);
  (evidence || []).forEach(ev => {
    const needle = esc(ev.text);
    const i = html.toLowerCase().indexOf(needle.toLowerCase());
    if (i > -1) html = html.slice(0, i) + "<mark>" + html.slice(i, i + needle.length) + "</mark>" + html.slice(i + needle.length);
  });
  return html;
}

function slaOf(t) {
  const left = t.slaMinutes * 60000 - (Date.now() - new Date(t.received));
  const m = Math.round(left / 60000);
  if (t.status === "resolved") return { txt: "met", cls: "ok", lbl: "Closed" };
  if (m < 0) return { txt: `−${Math.abs(m) >= 60 ? Math.floor(Math.abs(m) / 60) + "h" : Math.abs(m) + "m"}`, cls: "risk", lbl: "Breached" };
  if (m < 30) return { txt: `${m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"}`, cls: "risk", lbl: "remaining" };
  if (m < 120) return { txt: `${m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"}`, cls: "soon", lbl: "remaining" };
  return { txt: `${m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"}`, cls: "ok", lbl: "remaining" };
}

/* The two-gate model. Confidence AND reversibility — evaluated in this order:
   1. already acted        4. irreversible / explicitly forced to a human
   2. below review floor   5. below auto threshold
   3. spam-class exception 6. tier + revenue guards (only bite if confidence
                              would otherwise have permitted auto-action)      */
function gateOf(t) {
  const a = t.ai, rev = REVERSIBILITY[a.action] || { reversible: false, blast: "high" };
  const P = state.policy;

  if (state.demo === "degraded")
    return { key: "rules", label: "Rules-based", tone: "mid", why: "Model unavailable — keyword + account-tier routing only. No confidence score, no draft, no evidence." };

  if (a.autoActed && !a.autoActed.undone)
    return { key: "done", label: "AI acted", tone: "hi", why: `Auto-actioned ${fmtTime(a.autoActed.at)}${a.autoActed.humanApproved ? " after a human overrode policy" : ""}. Reversible for ${P.undoWindowH}h.` };

  if (a.confidence < P.reviewFloor)
    return { key: "withhold", label: "AI is unsure", tone: "lo", why: `Confidence ${a.confidence.toFixed(2)} is below the ${P.reviewFloor.toFixed(2)} floor, and below that floor the score is noise rather than a measurement. Relay withholds a classification and asks one scoping question instead of guessing.` };

  // Narrow, explicit exception: the unsolicited-vendor class is auto-closable by policy.
  const spamException = a.action === "close_ticket" && P.closeGuard && t.flags.includes("unsolicited");

  if (!spamException && ((P.reversibleOnly && !rev.reversible) || a.forcedHuman))
    return { key: "blocked", label: "Prepared, not executed", tone: "mid",
      why: a.forcedHuman || `${a.confidence.toFixed(2)} confidence, but "${rev.label}" is irreversible. Policy blocks auto-action regardless of how sure the model is.` };

  if (a.confidence < P.autoThreshold)
    return { key: "review", label: "Human confirms", tone: "mid", why: `Confident enough to suggest (${a.confidence.toFixed(2)}), not confident enough to act alone — the threshold is ${P.autoThreshold.toFixed(2)}. Requires one click from you.` };

  if (P.tierGuard && t.customer.tier === "Enterprise" && rev.blast !== "low")
    return { key: "blocked", label: "Enterprise guard", tone: "mid", why: `Enterprise account and "${rev.label}" has ${rev.blast} blast radius. Confidence alone never auto-acts here.`, forced: a.forcedHuman };

  if (P.revenueGuard && t.flags.includes("revenue"))
    return { key: "blocked", label: "Revenue guard", tone: "mid", why: "This ticket touches money. A wrong number here is a commercial incident, not a support one — routed to a human regardless of confidence.", forced: a.forcedHuman };

  return { key: "auto", label: spamException ? "Auto-closes by policy" : "Auto-act eligible", tone: "hi",
    why: spamException
      ? `Confidence ${a.confidence.toFixed(2)} on the unsolicited-vendor class, which policy permits Relay to close without a human. Logged, reversible for ${P.undoWindowH}h, never deleted.`
      : `Confidence ${a.confidence.toFixed(2)} clears the ${P.autoThreshold.toFixed(2)} threshold, and "${rev.label}" is reversible with ${rev.blast} blast radius. Both gates pass.` };
}

function bandOf(c) { return c >= state.policy.autoThreshold ? "hi" : c >= state.policy.reviewFloor ? "mid" : "lo"; }

/* ---------- filtering ---------- */
function visibleTickets() {
  return state.tickets.filter(t => {
    const g = gateOf(t);
    if (state.filterView === "needs_me" && !(g.key === "review" || g.key === "withhold" || g.key === "blocked")) return false;
    if (state.filterView === "auto" && !(g.key === "done" || g.key === "auto")) return false;
    if (state.filterView === "sla") { const s = slaOf(t); if (s.cls !== "risk" || t.status === "resolved") return false; }
    if (state.status && t.status !== state.status) return false;
    if (state.conf) { const b = bandOf(t.ai.confidence); if (b !== state.conf) return false; }
    if (state.team && t.ai.team !== state.team) return false;
    if (state.q) {
      const hay = `${t.id} ${t.subject} ${t.body} ${t.customer.company} ${t.customer.name} ${t.ai.intent}`.toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
}

/* ---------- icons ---------- */
const I = {
  ai: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" stroke-linejoin="round"/></svg>`,
  warn: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4l9 16H3l9-16z" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke-linecap="round"/></svg>`,
  err: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01" stroke-linecap="round"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5.5 5.5L20 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  inbox: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 13l2.5-8h13L21 13v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" stroke-linejoin="round"/><path d="M3 13h5l1.5 2.5h5L16 13h5" stroke-linejoin="round"/></svg>`,
  spark: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" stroke-linejoin="round"/></svg>`
};

/* ============================================================
   QUEUE
   ============================================================ */
function renderStrip() {
  const m = METRICS;
  const cards = [
    { k: "Auto-triaged", v: m.autoRate.value + "%", d: m.autoRate.delta, dir: m.autoRate.dir, n: m.autoRate.note },
    { k: "Time to triage", v: m.ttr.value, d: m.ttr.delta, dir: m.ttr.dir, n: m.ttr.note },
    { k: "Override rate", v: m.override.value + "%", d: m.override.delta, dir: m.override.dir, n: m.override.note },
    state.demo === "degraded"
      ? { k: "Needs a human", v: state.tickets.filter(t => t.status !== "resolved").length, d: "all", dir: "flat", n: "Relay cannot help right now — every open ticket is a human decision until the model recovers" }
      : { k: "Needs a human", v: state.tickets.filter(t => ["review", "withhold", "blocked"].includes(gateOf(t).key)).length, d: "live", dir: "flat", n: "Confident-but-irreversible, unsure, or above your largest accounts" }
  ];
  $("#metric-strip").innerHTML = cards.map(c => `
    <div class="mcard">
      <div class="k">${esc(c.k)}</div>
      <div class="v">${esc(String(c.v))}<span class="d ${c.dir}">${esc(c.d)}</span></div>
      <div class="n">${esc(c.n)}</div>
    </div>`).join("");
}

function skeletonRows(n = 8) {
  const w = [70, 46, 30, 55, 22, 40, 34];
  return Array.from({ length: n }, () => `<tr aria-hidden="true">${
    `<td><div class="skel" style="width:14px;height:14px;border-radius:3px"></div></td>` +
    w.map(p => `<td><div class="skel" style="width:${p}%;margin-bottom:5px"></div><div class="skel" style="width:${p * .6}%;height:9px"></div></td>`).join("")
  }</tr>`).join("");
}

function renderQueue() {
  const wrap = $("#tablewrap");
  const keepScroll = wrap.scrollTop;              // re-render must not throw the agent back to the top
  const rows = visibleTickets();

  if (state.demo === "loading") {
    wrap.innerHTML = `<table class="grid" style="min-width:1180px">${tableHead()}<tbody>${skeletonRows()}</tbody></table>
      <p style="text-align:center;color:var(--ink-3);font-size:12.5px;margin-top:12px">Reading 14 tickets and classifying intent…</p>`;
    $("#row-count").textContent = "";
    wrap.scrollTop = keepScroll;
    return;
  }

  if (state.demo === "error") {
    wrap.innerHTML = `<div class="state" role="alert">
      <div class="ico" style="background:var(--lo-soft);color:var(--lo)">${I.err}</div>
      <h3>Relay couldn't classify this batch</h3>
      <p>The triage model timed out after 8s on 3 of 14 tickets. Your queue is intact and every ticket is
      still readable — only the AI suggestions failed. Rules-based routing has taken over for the batch.</p>
      <div class="acts">
        <button class="btn primary" data-recover="retry">Retry classification</button>
        <button class="btn" data-recover="rules">Continue without AI</button>
      </div>
      <p style="margin-top:14px;font-size:11.5px;color:var(--ink-3)">Incident written to the audit log at ${clock(new Date().toISOString())}. No ticket data was lost.</p>
    </div>`;
    $("#row-count").textContent = "";
    wrap.scrollTop = keepScroll;
    return;
  }

  if (state.demo === "empty" || rows.length === 0) {
    const filtered = state.demo !== "empty" && (state.q || state.status || state.conf || state.team || state.filterView !== "all");
    wrap.innerHTML = `<div class="state">
      <div class="ico">${filtered ? I.spark : I.inbox}</div>
      <h3>${filtered ? "No tickets match these filters" : "Queue is clear"}</h3>
      <p>${filtered
        ? "Nothing in the workspace matches that combination. Relay triaged 412 tickets today and 388 of them never needed a human."
        : "Everything inbound has been triaged. Relay auto-routed 26 tickets in the last hour and 2 are waiting on a customer reply to a clarifying question."}</p>
      <div class="acts">
        ${filtered ? `<button class="btn primary" data-recover="reset">Clear filters</button>` : ""}
        <button class="btn" data-recover="reset">Reset demo</button>
      </div>
    </div>`;
    $("#row-count").textContent = "";
    wrap.scrollTop = keepScroll;
    return;
  }

  const degraded = state.demo === "degraded";
  wrap.innerHTML = `<table class="grid" style="min-width:1180px">
    ${tableHead()}
    <tbody>${rows.map((t, i) => rowHTML(t, i, degraded)).join("")}</tbody>
  </table>`;

  $("#row-count").textContent = `${rows.length} of ${state.tickets.length} tickets` +
    (degraded ? " · rules-based routing" : "");
  wrap.scrollTop = keepScroll;
  $("#nav-queue-count").textContent = state.tickets.filter(t => t.status !== "resolved").length;
}

function tableHead() {
  return `<colgroup>
      <col style="width:34px"><col style="width:29%"><col style="width:13%">
      <col style="width:19%"><col style="width:50px"><col style="width:84px">
      <col style="width:15%"><col style="width:116px">
    </colgroup>
    <thead><tr>
      <th scope="col"><label class="sr" for="sel-all">Select all</label>
        <input type="checkbox" id="sel-all" ${allChecked() ? "checked" : ""}></th>
      <th scope="col">Ticket</th>
      <th scope="col">Customer</th>
      <th scope="col">Relay classification</th>
      <th scope="col">Sev</th>
      <th scope="col">SLA</th>
      <th scope="col">Proposed action</th>
      <th scope="col">Status</th>
    </tr></thead>`;
}

function allChecked() {
  const rows = visibleTickets();
  return rows.length > 0 && rows.every(t => state.selected.has(t.id));
}

function rowHTML(t, i, degraded) {
  const g = gateOf(t), sla = slaOf(t), b = bandOf(t.ai.confidence), rev = REVERSIBILITY[t.ai.action];
  const sel = state.selected.has(t.id);
  const sevCls = t.ai.severity === "P1" ? "p1" : t.ai.severity === "P2" ? "p2" : "";

  const confCell = degraded
    ? `<div class="intent">${esc(t.ai.intent === "Unclassified" ? "Unrouted" : t.ai.intent)}</div>
       <div class="intent-sub"><span class="chip mid" style="font-size:10.5px">Rules-based</span></div>`
    : `<div class="intent">${esc(t.ai.intent)}</div>
       <div class="conf" style="margin-top:5px" title="Model confidence ${t.ai.confidence.toFixed(2)}">
         <span class="conf-num" style="color:var(--${b === "hi" ? "hi" : b === "mid" ? "mid" : "lo"})">${t.ai.confidence.toFixed(2)}</span>
         <span class="meter ${b}" aria-hidden="true"><i style="width:${Math.round(t.ai.confidence * 100)}%"></i></span>
       </div>
       <div class="intent-sub">${I.ai}<span>${esc(g.label)}</span></div>`;

  const actionCell = degraded
    ? `<span class="chip">Manual triage</span><div class="sla-lbl">AI unavailable</div>`
    : `<div style="font-size:12.5px;font-weight:540;line-height:1.3">${esc(rev ? rev.label : "Ask customer")}</div>
       <div class="sla-lbl">${t.ai.autoActed ? `${I.check} done ${fmtTime(t.ai.autoActed.at)}`
         : g.key === "blocked" ? "Held — see reason" : g.key === "withhold" ? "Withheld by policy"
         : g.key === "review" ? "Needs your click" : "Eligible"}</div>`;

  return `<tr data-id="${t.id}" data-idx="${i}" tabindex="-1"
    aria-selected="${state.openId === t.id}" class="${sel ? "checked" : ""}">
    <td><label class="sr" for="sel-${t.id}">Select ${esc(t.id)}</label>
      <input type="checkbox" id="sel-${t.id}" data-sel="${t.id}" ${sel ? "checked" : ""}></td>
    <td>
      <div class="tid">${esc(t.id)} · ${esc(t.channel)}</div>
      <div class="subj">${esc(t.subject)}</div>
      <div class="snip">${esc(t.translated || t.body)}</div>
    </td>
    <td>
      <div class="co">${esc(t.customer.company)}</div>
      <div class="cometa"><span class="tier ${esc(t.customer.tier)}">${esc(t.customer.tier)}</span>
        ${t.customer.arr !== "—" ? `<span>${esc(t.customer.arr)}</span>` : ""}
        ${t.customer.health === "critical" ? `<span class="chip lo" style="font-size:10px;padding:0 5px">Churn risk</span>` : ""}
        ${t.customer.health === "at-risk" ? `<span class="chip mid" style="font-size:10px;padding:0 5px">At risk</span>` : ""}</div>
    </td>
    <td>${confCell}</td>
    <td>${degraded ? `<span class="chip">—</span>` : `<span class="chip ${sevCls}" title="${esc(t.ai.severity === "Unknown" ? "Severity not inferable without the model" : t.ai.severity)}">${esc(t.ai.severity === "Unknown" ? "—" : t.ai.severity)}</span>`}</td>
    <td><div class="sla ${sla.cls}">${esc(sla.txt)}</div><div class="sla-lbl">${esc(sla.lbl)}</div></td>
    <td>${actionCell}</td>
    <td><span class="chip ${statusTone(t.status)}">${esc(statusLabel(t.status))}</span></td>
  </tr>`;
}

const statusLabel = s => ({ new: "New", needs_human: "Needs human", triaged: "Triaged", in_progress: "In progress", resolved: "Resolved" }[s] || s);
const statusTone = s => ({ new: "", needs_human: "mid", triaged: "brand", in_progress: "", resolved: "hi" }[s] || "");

/* ============================================================
   DRAWER
   ============================================================ */
let lastFocus = null;

function openTicket(id) {
  const t = state.tickets.find(x => x.id === id);
  if (!t) return;
  lastFocus = document.activeElement;
  state.openId = id;
  renderDrawer(t);
  $("#drawer").classList.add("open");
  $("#scrim").classList.add("show");
  document.body.classList.add("drawer-open");
  $("#drawer").focus();
  $("#live-region").textContent = `Opened ${t.id}. ${t.subject}`;
  renderQueue();
}

function closeDrawer() {
  state.openId = null;
  $("#drawer").classList.remove("open");
  $("#scrim").classList.remove("show");
  document.body.classList.remove("drawer-open");
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  renderQueue();
}

function renderDrawer(t) {
  const g = gateOf(t), a = t.ai, rev = REVERSIBILITY[a.action], b = bandOf(a.confidence), sla = slaOf(t);
  const degraded = state.demo === "degraded";

  $("#dr-id").textContent = `${t.id} · ${t.channel} · received ${fmtTime(t.received)}`;
  $("#dr-title").textContent = t.subject;

  $("#dr-meta").innerHTML = `
    <span class="chip"><b style="font-weight:650">${esc(t.customer.company)}</b></span>
    <span class="tier ${esc(t.customer.tier)}">${esc(t.customer.tier)}</span>
    <span class="chip">${esc(t.customer.arr)} ARR · ${t.customer.seats || "—"} seats</span>
    ${!degraded ? `<span class="chip ${a.severity === "P1" ? "p1" : a.severity === "P2" ? "p2" : ""}">${esc(a.severity)}</span>` : ""}
    <span class="chip ${sla.cls === "risk" ? "lo" : ""}">SLA ${esc(sla.txt)} ${esc(sla.lbl)}</span>
    ${t.flags.map(f => `<span class="chip ${f === "churn_risk" ? "lo" : f === "vip" ? "brand" : "mid"}">${esc(flagLabel(f))}</span>`).join("")}
    <span class="chip ${statusTone(t.status)}">${esc(statusLabel(t.status))}</span>`;

  $("#dr-body").innerHTML = degraded ? degradedPanel(t) : `
    ${gateCallout(t, g, rev)}

    <div class="sect">
      <h3>Relay's read</h3>
      <div class="aipanel">
        <div class="aipanel-head">
          ${I.ai} AI triage panel
          <span class="right"><span class="dot" style="width:6px;height:6px"></span>${esc(MODEL.name)} ${esc(MODEL.version)} · ${a.latencyMs}ms</span>
        </div>
        <div class="aipanel-body">
          <div class="verdict">
            <div class="verdict-num" style="color:var(--${b === "hi" ? "hi" : b === "mid" ? "mid" : "lo"})">${a.confidence.toFixed(2)}</div>
            <div class="verdict-txt">
              <b>${esc(a.intent)}</b>
              <span>${esc(g.label)} · severity ${esc(a.severity)} · route to ${esc(a.team || "—")}</span>
              <span class="meter ${b}" style="margin-top:7px" aria-hidden="true"><i style="width:${Math.round(a.confidence * 100)}%"></i></span>
            </div>
          </div>

          ${a.lowConfidenceNote ? `<div class="callout warn" style="margin-bottom:11px"><b>Relay is flagging its own uncertainty</b><span class="sub">${esc(a.lowConfidenceNote)}</span></div>` : ""}

          <div class="reason">${esc(a.reasoning)}</div>

          <details style="margin-top:11px" ${g.key === "withhold" || g.key === "blocked" ? "open" : ""}>
            <summary style="cursor:pointer;font-size:12.5px;font-weight:620;color:var(--brand);padding:4px 0;list-style:none;display:flex;align-items:center;gap:6px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" class="chev"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Why this decision?
            </summary>
            <div style="padding-top:9px">
              ${a.evidence.length ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:680;margin-bottom:5px">Evidence in the customer's words</div>
                ${a.evidence.map(e => `<div class="ev"><span class="ev-q">"${esc(e.text)}"</span><span class="ev-w"><b>Why it matters</b>${esc(e.why)}</span></div>`).join("")}`
              : `<div class="callout lo"><b>No evidence found</b><span class="sub">Relay could not point to a single phrase in this message that supports a classification. That is the honest output, and it is why nothing is being suggested.</span></div>`}

              ${a.alternatives?.length ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:680;margin:13px 0 5px">What else it considered</div>
                ${a.alternatives.map(x => `<div class="alt"><span class="meter ${bandOf(x.confidence)}" style="max-width:70px"><i style="width:${Math.round(x.confidence * 100 * 3)}%"></i></span><span style="flex:1">${esc(x.intent)}</span><span style="font-family:var(--mono);font-size:11px">${x.confidence.toFixed(2)}</span></div>`).join("")}` : ""}

              ${a.relatedOpenTicket ? `<div class="callout warn" style="margin-top:12px"><b>Related open ticket</b><span class="sub">${esc(a.relatedOpenTicket)}</span></div>` : ""}
            </div>
          </details>

          ${a.kbRef ? `<div class="callout hi" style="margin-top:11px"><b>Knowledge base match · ${(a.kbRef.match * 100).toFixed(0)}%</b><span class="sub">${esc(a.kbRef.id)} — ${esc(a.kbRef.title)}</span></div>` : ""}

          ${a.similar?.length ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:680;margin:13px 0 4px">Similar tickets and how they ended</div>
            ${a.similar.map(s => `<div class="similar"><span class="id">${esc(s.id)}</span><span style="flex:1"><span class="lbl">${esc(s.label)}</span><span class="out">${esc(s.outcome)}</span></span></div>`).join("")}` : ""}
        </div>
      </div>
    </div>

    <div class="sect">
      <h3>Customer message ${t.language ? `<span class="chip brand" style="text-transform:none;letter-spacing:0;font-size:10.5px">${esc(t.language.toUpperCase())}</span>` : ""}</h3>
      <div class="msg">
        <div class="msg-head"><b style="color:var(--ink-2)">${esc(t.customer.name)}</b> · ${esc(t.customer.company)} · ${fmtTime(t.received)}</div>
        ${highlight(t.body, a.evidence)}
      </div>
      ${t.translated ? `
        <div class="msg translated" style="margin-top:9px">
          <div class="msg-head">${I.ai} <span>Relay translation — classified and drafted in the customer's language</span></div>
          ${highlight(t.translated, a.evidence)}
          <div class="langnote">${esc(a.translationNote || "")}</div>
        </div>` : ""}
    </div>

    ${a.clarifier ? clarifierBlock(t, a) : ""}
    ${draftBlock(t, a)}

    <div class="sect">
      <h3>History</h3>
      <ul class="timeline">
        ${(t.history.length ? t.history : [{ at: t.received, who: t.customer.name, what: `Ticket received via ${t.channel}` }])
          .map(h => `<li class="${h.who === "Relay" || h.who.startsWith("Relay") ? "ai" : ""}">
            <span class="who">${esc(h.who)}</span> <span class="at">${fmtTime(h.at)}</span>
            <div class="what">${esc(h.what)}</div></li>`).join("")}
      </ul>
    </div>`;

  renderDrawerFoot(t, g);
  $("#dr-body").scrollTop = 0;
}

const flagLabel = f => ({ sla_risk: "SLA risk", vip: "VIP", churn_risk: "Churn risk", compliance: "Compliance", revenue: "Revenue", non_english: "Non-English", unsolicited: "Unsolicited" }[f] || f);

function gateCallout(t, g, rev) {
  const map = {
    auto:    ["hi",   `${I.check} Relay can act alone on this`, `${g.why} It will be reversible for ${state.policy.undoWindowH} hours and written to the audit log.`],
    done:    ["hi",   `${I.check} Relay already acted`, `${g.why}`],
    review:  ["mid",  `${I.warn} Relay needs one click from you`, `${g.why}`],
    blocked: ["mid",  `${I.warn} Relay prepared this but will not execute it`, `${a_forced(t) || g.why}`],
    withhold:["lo",   `${I.err} Relay is not going to guess`, `${g.why}`],
    rules:   ["mid",  `${I.warn} Rules-based triage`, `${g.why}`]
  };
  const [tone, title, body] = map[g.key] || map.review;
  return `<div class="sect"><div class="callout ${tone}"><b>${title}</b><span class="sub">${body}</span></div></div>`;
}
const a_forced = t => t.ai.forcedHuman;

function clarifierBlock(t, a) {
  return `<div class="sect">
    <h3>Relay's proposed question</h3>
    <div class="draft">
      <div class="draft-head">${I.ai} Instead of a classification, Relay suggests asking this</div>
      <textarea id="clarifier-text" aria-label="Proposed clarifying question">${esc(a.clarifier.question)}</textarea>
      <div class="draft-foot">
        <span style="flex:1">${esc(a.clarifier.why)}</span>
      </div>
    </div>
    <div class="reason-chips" style="margin-top:9px">
      ${a.clarifier.options.map(o => `<button type="button" data-clar-opt="${esc(o)}">${esc(o)}</button>`).join("")}
    </div>
    <p style="font-size:11.5px;color:var(--ink-3);margin-top:8px">Quick options append to the question so the customer can answer in one tap.</p>
  </div>`;
}

function draftBlock(t, a) {
  if (!a.draft) return `<div class="sect"><h3>Reply</h3>
    <div class="callout lo"><b>No draft generated</b><span class="sub">${t.ai.action === "close_ticket"
      ? "Policy auto-closes this class without a reply. A canned decline can be attached in AI policies."
      : "Relay has nothing confident enough to say yet."}</span></div></div>`;

  const en = a.draftEn ? `<button class="btn xs" id="toggle-lang" type="button">Show English</button>` : "";
  return `<div class="sect">
    <h3>Drafted reply <span class="chip" style="text-transform:none;letter-spacing:0;font-size:10.5px">${a.draftEn ? "Customer language" : "Ready to edit"}</span></h3>
    <div class="draft">
      <div class="draft-head">${I.ai} Draft · not sent · you approve every outbound message
        <span style="margin-left:auto;display:flex;gap:6px">${en}<button class="btn xs" id="regen" type="button">Regenerate</button></span>
      </div>
      <textarea id="draft-text" aria-label="Drafted reply">${esc(a.draft)}</textarea>
      <div class="draft-foot">
        <span id="draft-status">${a.draftEn ? "Also stored in English for audit." : "Editing marks this as human-reviewed."}</span>
        <span style="margin-left:auto" id="char-count"></span>
      </div>
    </div>
  </div>`;
}

function degradedPanel(t) {
  return `
    <div class="sect"><div class="callout warn"><b>${I.warn} Rules-based triage — AI unavailable</b>
      <span class="sub">Relay's model is degraded. This ticket is routed by keyword match and account tier.
      No confidence score, no drafted reply, no evidence. Everything below is a human decision.</span></div></div>
    <div class="sect"><h3>Fallback classification</h3>
      <div class="aipanel"><div class="aipanel-head" style="background:var(--mid-soft);color:var(--mid)">
        ${I.warn} Rules engine v1
        <span class="right">keyword + tier</span></div>
        <div class="aipanel-body">
          <dl class="kv">
            <dt>Matched rule</dt><dd>"sync" + Enterprise tier → Data Integrations</dd>
            <dt>Severity</dt><dd>Defaulted to P2 (cannot infer P1 without the model)</dd>
            <dt>Reply</dt><dd>Not drafted — fallback mode never writes to a customer</dd>
          </dl>
          <div class="callout warn" style="margin-top:11px"><b>What you've lost</b>
            <span class="sub">Evidence, similar-ticket history, severity inference, and drafting. What you haven't: the ticket, the customer record, SLA timers, or routing.</span></div>
        </div></div></div>
    <div class="sect"><h3>Customer message</h3>
      <div class="msg"><div class="msg-head"><b style="color:var(--ink-2)">${esc(t.customer.name)}</b> · ${esc(t.customer.company)} · ${fmtTime(t.received)}</div>${esc(t.translated || t.body)}</div></div>
    <div class="sect"><h3>History</h3><ul class="timeline">
      <li><span class="who">System</span> <span class="at">now</span><div class="what">Model degraded — fell back to rules engine</div></li>
      <li><span class="who">${esc(t.customer.name)}</span> <span class="at">${fmtTime(t.received)}</span><div class="what">Ticket received via ${esc(t.channel)}</div></li>
    </ul></div>`;
}

function renderDrawerFoot(t, g) {
  const degraded = state.demo === "degraded";
  const canAccept = !degraded && ["auto", "review", "withhold"].includes(g.key);
  $("#dr-foot").innerHTML = `
    ${canAccept ? `<button class="btn primary" data-act="accept">${I.check} Accept Relay's suggestion</button>` : ""}
    ${!degraded ? `<button class="btn" data-act="override">Override…</button>` : ""}
    <button class="btn" data-act="assign">Assign to me</button>
    <button class="btn danger" data-act="escalate">Escalate</button>
    <span style="flex:1"></span>
    ${t.ai.autoActed ? `<button class="btn ghost sm" data-act="undo">Undo AI action</button>` : ""}
    <button class="btn ghost sm" data-act="why-gate" title="Why did Relay ${g.key === "auto" ? "act" : "stop"}?">Gate logic</button>`;
}

/* ============================================================
   ACTIONS
   ============================================================ */
function logAudit(type, target, detail, actor = "J. Okafor") {
  state.audit.unshift({
    at: new Date().toISOString().slice(0, 19).replace("T", " "),
    actor, type, target, detail, outcome: "kept"
  });
  $("#nav-audit-count").textContent = state.audit.length;
  if (state.view === "audit") renderAudit();
}

function pushHistory(t, who, what) {
  t.history.push({ at: new Date().toISOString(), who, what });
}

function toast(msg, undoFn) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${msg}</span>`;
  if (undoFn) {
    const b = document.createElement("button");
    b.className = "undo"; b.textContent = "Undo"; b.type = "button";
    b.onclick = () => { undoFn(); el.remove(); };
    el.appendChild(b);
  }
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }, undoFn ? 6000 : 3400);
}

function acceptSuggestion(t) {
  const g = gateOf(t), rev = REVERSIBILITY[t.ai.action];
  if (g.key === "withhold") {
    toast("Nothing to accept — Relay withheld a classification on this one.");
    return;
  }
  if (g.key === "blocked") {
    openOverrideModal(t, true);
    return;
  }
  const prev = { status: t.status, assignee: t.assignee, acted: t.ai.autoActed };
  t.status = "triaged";
  t.assignee = g.key === "auto" ? "Relay (auto)" : "J. Okafor";
  t.ai.autoActed = { at: new Date().toISOString(), action: rev.label, reversible: true, undone: false };
  pushHistory(t, g.key === "auto" ? "Relay" : "J. Okafor",
    g.key === "auto" ? `Auto-actioned: ${rev.label} (confidence ${t.ai.confidence.toFixed(2)}). Reversible ${state.policy.undoWindowH}h.`
                     : `Accepted Relay's suggestion — ${rev.label} to ${t.ai.team}.`);
  logAudit(g.key === "auto" ? "auto_route" : "accept", t.id,
    g.key === "auto" ? `${rev.label} (conf ${t.ai.confidence.toFixed(2)}). Reversible ${state.policy.undoWindowH}h.`
                     : `Human accepted AI suggestion: ${rev.label} → ${t.ai.team}.`);

  toast(`${t.id} · ${rev.label.toLowerCase()} ${g.key === "auto" ? "by Relay" : ""}`, () => {
    Object.assign(t, { status: prev.status, assignee: prev.assignee });
    t.ai.autoActed = prev.acted; t.history.pop(); state.audit.shift();
    renderAll(); if (state.openId === t.id) renderDrawer(t);
  });
  renderAll(); if (state.openId === t.id) renderDrawer(t);
}

/* Override always captures a reason — a skipped reason is a lost learning signal. */
const OVERRIDE_REASONS = ["Wrong team", "Wrong severity", "Missed context", "Tone is off", "Not actually a duplicate"];
function openOverrideModal(t, fromBlocked = false) {
  $("#modal-title").textContent = fromBlocked ? `Execute anyway — ${t.id}` : `Override Relay — ${t.id}`;
  $("#modal-body").innerHTML = `
    ${fromBlocked
      ? `<p>Relay prepared this action but policy blocked it: <b>${esc(gateOf(t).why)}</b> You can override the policy for this one ticket. It will be logged with your name and needs a reason.</p>`
      : `<p>Relay classified this as <b>${esc(t.ai.intent)}</b> at ${t.ai.confidence.toFixed(2)} and proposed <b>${esc((REVERSIBILITY[t.ai.action] || {}).label || "ask the customer")}</b>. Tell us what it got wrong — this goes to the weekly model review.</p>`}
    <label class="sr" for="ov-team">Route to team</label>
    <select id="ov-team">${TEAMS.map(x => `<option ${x === t.ai.team ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
    <div class="reason-chips" id="ov-chips">
      ${OVERRIDE_REASONS.map(r => `<button type="button" aria-pressed="false" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}
    </div>
    <label class="sr" for="ov-note">Reason detail</label>
    <textarea id="ov-note" placeholder="One line is enough — what did the model miss?"></textarea>`;
  $("#modal-foot").innerHTML = `<button class="btn" data-modal="cancel">Cancel</button>
    <button class="btn primary" data-modal="confirm">${fromBlocked ? "Execute anyway" : "Save override"}</button>`;

  const chosen = new Set();
  $$("#ov-chips button").forEach(b => b.onclick = () => {
    const on = b.getAttribute("aria-pressed") === "true";
    b.setAttribute("aria-pressed", String(!on)); chosen[on ? "delete" : "add"](b.dataset.reason);
  });

  openModalFocus();
  $("#ov-team").focus();
  $("[data-modal='confirm']").onclick = () => {
    const reasons = [...chosen].join("; ");
    const note = $("#ov-note").value.trim();
    const team = $("#ov-team").value;
    const detail = `Overrode AI suggestion (${t.ai.intent}, ${t.ai.confidence.toFixed(2)}) → ${team}. Reason: ${reasons || note || "not given"}${note && reasons ? " — " + note : ""}`;
    t.ai.team = team; t.status = "triaged"; t.assignee = "J. Okafor";
    if (fromBlocked) t.ai.autoActed = { at: new Date().toISOString(), action: (REVERSIBILITY[t.ai.action] || {}).label, reversible: false, undone: false, humanApproved: true };
    pushHistory(t, "J. Okafor", detail);
    logAudit("override", t.id, detail);
    closeModal(); renderAll(); if (state.openId === t.id) renderDrawer(t);
    toast(`Override logged for ${t.id} and queued for the weekly model review.`);
  };
}

let modalFocus = null;
function openModalFocus() { modalFocus = document.activeElement; $("#modal-scrim").classList.add("show"); }
function closeModal() {
  $("#modal-scrim").classList.remove("show");
  if (modalFocus && modalFocus.isConnected) modalFocus.focus();
  modalFocus = null;
}

function showGateLogic(t) {
  const g = gateOf(t), rev = REVERSIBILITY[t.ai.action] || {};
  $("#modal-title").textContent = `Gate logic — ${t.id}`;
  $("#modal-body").innerHTML = `
    <p>Two independent gates. A ticket must clear <b>both</b> before Relay acts without a human.</p>
    <dl class="kv" style="margin-top:10px">
      <dt>Confidence</dt><dd>${t.ai.confidence.toFixed(2)} — threshold is ${state.policy.autoThreshold.toFixed(2)} → <b>${t.ai.confidence >= state.policy.autoThreshold ? "PASS" : "FAIL"}</b></dd>
      <dt>Action</dt><dd>${esc(rev.label || "—")}</dd>
      <dt>Reversible?</dt><dd>${rev.reversible ? "Yes" : "No"} → <b>${!state.policy.reversibleOnly || rev.reversible ? "PASS" : "FAIL"}</b></dd>
      <dt>Blast radius</dt><dd>${esc(rev.blast || "—")}</dd>
      <dt>Account tier</dt><dd>${esc(t.customer.tier)} → ${state.policy.tierGuard && t.customer.tier === "Enterprise" && rev.blast !== "low" ? "<b>GUARD</b>" : "PASS"}</dd>
      <dt>Touches revenue?</dt><dd>${t.flags.includes("revenue") ? "Yes → <b>GUARD</b>" : "No → PASS"}</dd>
      <dt>Outcome</dt><dd><span class="chip ${g.tone}">${esc(g.label)}</span></dd>
    </dl>
    <div class="callout ${g.tone === "hi" ? "hi" : g.tone === "lo" ? "lo" : "warn"}" style="margin-top:12px">
      <b>${esc(g.label)}</b><span class="sub">${esc(g.why)}</span></div>`;
  $("#modal-foot").innerHTML = `<button class="btn primary" data-modal="cancel">Got it</button>`;
  openModalFocus();
  $("[data-modal='cancel']").focus();
}

/* ============================================================
   INSIGHTS
   ============================================================ */
function renderInsights() {
  const m = METRICS;
  $("#insight-cards").innerHTML = Object.entries(m).map(([k, x]) => `
    <div class="card">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:680">${esc(k === "ttr" ? "Time to triage" : k === "autoRate" ? "Auto-triage rate" : k === "override" ? "Override rate" : k === "precision" ? "Intent precision" : "Spam auto-closed")}</div>
      <div class="bignum" style="margin-top:6px">${esc(String(x.value))}${x.suffix ? `<span class="u">${x.suffix}</span>` : ""}</div>
      <div class="delta ${x.dir === "flat" ? "flat" : "good"}">${esc(x.delta)}</div>
      <p class="hint" style="margin:9px 0 0">${esc(x.note)}</p>
    </div>`).join("");

  $("#calib").innerHTML = CALIBRATION.map(c => `
    <div class="bar-row">
      <span class="lbl">${esc(c.band)}</span>
      <span class="bar-track">
        <span class="bar-claim" style="width:${c.claimed * 100}%"></span>
        <span class="bar-actual" style="width:${c.actual * 100}%"></span>
      </span>
      <span class="val" style="color:${c.actual < c.claimed - 0.05 ? "var(--lo)" : "var(--ink-2)"}">${(c.actual * 100).toFixed(0)}%</span>
    </div>`).join("") +
    `<p class="hint" style="margin-top:10px">The two lowest bands are over-confident by 9–14 points (n=${CALIBRATION[0].n + CALIBRATION[1].n}). That is the empirical basis for the 0.70 floor — not a preference.</p>`;

  const max = Math.max(...VOLUME.map(v => v.in));
  $("#volume").innerHTML = `<div style="display:flex;align-items:flex-end;gap:9px;height:132px;padding-top:6px">
    ${VOLUME.map(v => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end">
        <div style="font-size:10.5px;font-family:var(--mono);color:var(--ink-3)">${v.auto}</div>
        <div style="width:100%;height:${(v.in / max) * 100}%;border:1.5px solid var(--line-2);border-radius:5px;position:relative;background:var(--surface-2);overflow:hidden">
          <div style="position:absolute;bottom:0;left:0;right:0;height:${(v.auto / v.in) * 100}%;background:var(--brand);opacity:.88"></div>
        </div>
        <div style="font-size:11px;color:var(--ink-3);font-weight:560">${esc(v.d)}</div>
      </div>`).join("")}
  </div>
  <div class="legend"><span><i class="sw" style="background:var(--brand)"></i> Auto-triaged</span><span><i class="sw" style="background:var(--surface-2);border:1.5px solid var(--line-2)"></i> Total inbound</span></div>`;

  const OVR = [
    { cat: "Draft tone", n: 22, reason: "\"Too apologetic\" (14), \"too casual for enterprise\" (8)" },
    { cat: "Billing intents", n: 14, reason: "Jurisdiction rules the model doesn't have — e.g. Danish reissue-vs-credit-note" },
    { cat: "Routing team", n: 9, reason: "Timeout was in the aggregation job, not the API layer" },
    { cat: "Severity", n: 7, reason: "Customer understated impact; agent knew the account context" },
    { cat: "Duplicate merge", n: 3, reason: "Same words, different root cause" }
  ];
  $("#overrides").innerHTML = `<table class="plain"><thead><tr><th style="width:24%">Category</th><th style="width:8%">Count</th><th>Most common reason given</th><th style="width:16%">Action taken</th></tr></thead>
    <tbody>${OVR.map(o => `<tr><td style="font-weight:560">${esc(o.cat)}</td><td style="font-family:var(--mono)">${o.n}</td><td style="color:var(--ink-2)">${esc(o.reason)}</td><td><span class="chip">${o.n > 10 ? "Prompt revised" : "Watching"}</span></td></tr>`).join("")}</tbody></table>`;
}

/* ============================================================
   POLICIES
   ============================================================ */
function renderPolicies() {
  const GUARDS = [
    ["reversibleOnly", "Irreversible actions need a human", "Refunds, invoice reissues, account closure, contract changes. Confidence cannot unlock these."],
    ["tierGuard", "Never auto-act on Enterprise accounts", "Unless the action is low blast radius (tagging, routing). Your largest accounts get a human in the loop by default."],
    ["revenueGuard", "Never auto-act on anything touching money", "Seats, discounts, renewals, credits. A wrong number here is a commercial incident, not a support one."],
    ["closeTicket", "Auto-close only the unsolicited-vendor class", "214 tickets/quarter at ~40s each. Still logged, still reversible for 24h, never deleted."]
  ];
  $("#guards").innerHTML = GUARDS.map(([k, t, s]) => switchRow(k, t, s)).join("");

  const DISC = [
    ["citeEvidence", "Show the evidence behind every suggestion", "Agents see the quoted spans. Turning this off makes Relay a black box and overrides stop having useful reasons."],
    ["discloseModel", "Label AI output as AI output, everywhere", "Model name, version, and a persistent visual distinction. Never renders AI text as if a human wrote it."],
    ["languageMatch", "Reply in the customer's language", "Classify on the translation, draft in their language, store both for audit."]
  ];
  $("#disclosure").innerHTML = DISC.map(([k, t, s]) => switchRow(k, t, s)).join("");

  $$("#guards input, #disclosure input").forEach(inp => inp.onchange = () => {
    state.policy[inp.dataset.key === "closeTicket" ? "closeGuard" : inp.dataset.key] = inp.checked;
    logAudit("policy_change", "policy", `${inp.dataset.label} → ${inp.checked ? "ON" : "OFF"}`);
    toast(`Policy updated: ${inp.dataset.label} is now ${inp.checked ? "on" : "off"}. Written to the audit log.`);
    renderAll();
  });

  const bind = (id, key, out, fmt, note) => {
    const el = $(id);
    el.value = state.policy[key];
    $(out).textContent = fmt(state.policy[key]);
    el.oninput = () => {
      state.policy[key] = parseFloat(el.value);
      $(out).textContent = fmt(state.policy[key]);
      if (note) $(note).textContent = thresholdNote(key, state.policy[key]);
      renderQueue(); renderStrip(); if (state.openId) renderDrawer(state.tickets.find(t => t.id === state.openId));
    };
    el.onchange = () => logAudit("policy_change", "policy", `${key} → ${fmt(state.policy[key])}`);
  };
  bind("#p-auto", "autoThreshold", "#v-auto", v => v.toFixed(2), "#n-auto");
  bind("#p-review", "reviewFloor", "#v-review", v => v.toFixed(2), "#n-review");
  bind("#p-undo", "undoWindowH", "#v-undo", v => `${v}h`, "#n-undo");
}

function thresholdNote(key, v) {
  if (key === "autoThreshold") {
    if (v <= 0.85) return `At ${v.toFixed(2)} Relay would auto-act on ~340 more tickets a week — but measured accuracy in that band is 86%, so roughly 1 in 7 would be wrong and already sent.`;
    if (v <= 0.90) return `At ${v.toFixed(2)} the model is measured-correct 96% of the time. This is the recommended setting.`;
    return `At ${v.toFixed(2)} almost nothing auto-acts. Safe, but you've given up most of the time saving — this is a rules engine with extra steps.`;
  }
  if (key === "reviewFloor") {
    if (v <= 0.55) return `Below ${v.toFixed(2)} the confidence score is noise, not a measurement. Relay would show a number it cannot stand behind.`;
    if (v <= 0.70) return `Below this, Relay withholds its answer and asks the customer one scoping question. Guessing here mis-routes 4 in 10 tickets.`;
    return `At ${v.toFixed(2)} a large share of tickets get no suggestion at all. Agents will start working around Relay instead of with it.`;
  }
  return `${v}h covers ${v >= 24 ? "every shift handover plus a weekend" : "one shift"}. 91% of overrides happen inside the first 2 hours.`;
}

function switchRow(key, title, sub) {
  const on = key === "closeTicket" ? state.policy.closeGuard : state.policy[key];
  return `<div class="prow">
    <div class="txt"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
    <label class="switch"><input type="checkbox" data-key="${esc(key)}" data-label="${esc(title)}" ${on ? "checked" : ""} aria-label="${esc(title)}"><span class="track"></span><span class="knob"></span></label>
  </div>`;
}

/* ============================================================
   AUDIT
   ============================================================ */
function renderAudit() {
  const type = $("#a-type").value;
  const rows = state.audit.filter(r => !type || r.type === type);
  $("#audit-count").textContent = `${rows.length} events`;
  const tone = { auto_route: "brand", accept: "hi", override: "mid", ask_clarifier: "lo", escalate: "mid", degraded: "lo", policy_change: "" };
  const label = { auto_route: "AI auto-action", accept: "Human accepted", override: "Human override", ask_clarifier: "AI withheld", escalate: "Escalation", degraded: "Model degraded", policy_change: "Policy change" };
  $("#audit-table").innerHTML = rows.length ? `<table class="plain">
    <thead><tr><th style="width:150px">Timestamp</th><th style="width:120px">Event</th><th style="width:130px">Actor</th><th style="width:88px">Target</th><th>Detail</th><th style="width:130px">Outcome</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="mono">${esc(r.at)}</td>
      <td><span class="chip ${tone[r.type] || ""}">${esc(label[r.type] || r.type)}</span></td>
      <td style="font-weight:540">${esc(r.actor)}</td>
      <td class="mono" style="color:var(--brand)">${esc(r.target)}</td>
      <td style="color:var(--ink-2)">${esc(r.detail)}</td>
      <td style="color:var(--ink-3)">${esc(r.outcome)}</td>
    </tr>`).join("")}</tbody></table>`
    : `<div class="state"><div class="ico">${I.spark}</div><h3>No events of this type</h3><p>Try a different filter — or make a change in the queue and watch it land here.</p></div>`;
  $("#nav-audit-count").textContent = state.audit.length;
}

function exportAudit() {
  const head = ["timestamp", "event", "actor", "target", "detail", "outcome"];
  const lines = [head.join(",")].concat(state.audit.map(r =>
    [r.at, r.type, r.actor, r.target, `"${r.detail.replace(/"/g, '""')}"`, r.outcome].join(",")));
  const csv = lines.join("\n");
  const link = document.createElement("a");
  link.download = "relay-audit-log.csv";
  if (typeof URL !== "undefined" && URL.createObjectURL) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } else {
    link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    link.click();
  }
  toast(`Audit log exported — ${state.audit.length} events as CSV.`);
}

/* ============================================================
   DEMO STATES / BANNER
   ============================================================ */
function renderBanner() {
  const b = $("#banner"), dot = $("#model-dot"), st = $("#model-status");
  const set = (cls, html) => { b.className = `banner show ${cls}`; b.innerHTML = html; };

  if (state.demo === "degraded") {
    b.className = "banner show warn"; dot.className = "dot warn"; st.textContent = "relay-triage · degraded";
    b.innerHTML = `${I.warn}<div class="body"><b>Relay is running in fallback mode</b>
      Model latency p95 crossed 4s at ${clock(new Date(Date.now() - 660000).toISOString())}. 34 tickets were triaged by the
      rules engine instead. Confidence scores, drafted replies and evidence are unavailable — routing, SLA timers and the
      queue itself are unaffected. No customer has been sent anything by the fallback.</div>
      <div class="acts"><button class="btn sm" data-demo-off="degraded">Dismiss</button><button class="btn sm primary" data-recover="reset">Simulate recovery</button></div>`;
  } else if (state.demo === "error") {
    b.className = "banner show err"; dot.className = "dot err"; st.textContent = "relay-triage · unavailable";
    b.innerHTML = `${I.err}<div class="body"><b>Classification failed on 3 tickets</b>
      The model timed out after 8s. Nothing was lost and nothing was sent. VG-4821, VG-4815 and VG-4788 need a human read.</div>
      <div class="acts"><button class="btn sm primary" data-recover="retry">Retry now</button></div>`;
  } else {
    b.className = "banner"; b.innerHTML = ""; dot.className = "dot";
    st.textContent = `${MODEL.name} ${MODEL.version} · healthy`;
  }
}

function setDemo(mode) {
  state.demo = mode === state.demo && mode !== "reset" ? null : mode;
  if (mode === "reset") state.demo = null;
  if (mode === "bulk") {
    state.demo = null;
    state.selected = new Set(visibleTickets().slice(0, 4).map(t => t.id));
  }
  $$("[data-demo]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.demo === state.demo)));
  renderBanner(); renderAll();
  $("#live-region").textContent = state.demo ? `Demo state: ${state.demo}` : "Demo state cleared";
}

/* ============================================================
   VIEW ROUTER
   ============================================================ */
const TITLES = { queue: "Triage queue", insights: "Insights", policies: "AI policies", audit: "Audit log", casestudy: "Case study" };
function setView(v) {
  state.view = v;
  $$(".nav-i").forEach(n => n.setAttribute("aria-current", n.dataset.view === v ? "page" : "false"));
  ["queue", "insights", "policies", "audit", "casestudy"].forEach(k => {
    const el = $(`#view-${k}`);
    el.style.display = k === v ? (k === "queue" ? "flex" : "flex") : "none";
  });
  $("#crumb-page").textContent = TITLES[v];
  $(".demobar").style.display = v === "queue" ? "flex" : "none";
  if (v === "casestudy") $("#cs-body").innerHTML = CASE_STUDY;
  if (v === "insights") renderInsights();
  if (v === "policies") renderPolicies();
  if (v === "audit") renderAudit();
  if (v !== "queue" && state.openId) closeDrawer();
}

/* The filter labels quote the live policy thresholds, so the two screens
   can never drift apart and show the agent a stale number. */
function syncConfFilter() {
  const opts = $$("#f-conf option");
  if (opts.length === 4) {
    opts[1].textContent = `High ≥ ${state.policy.autoThreshold.toFixed(2)}`;
    opts[2].textContent = `Review ${state.policy.reviewFloor.toFixed(2)}–${(state.policy.autoThreshold - 0.01).toFixed(2)}`;
    opts[3].textContent = `Unsure < ${state.policy.reviewFloor.toFixed(2)}`;
  }
}

function renderAll() { syncConfFilter(); renderStrip(); renderQueue(); renderBulk(); renderBanner(); }

function renderBulk() {
  const n = state.selected.size;
  $("#bulkbar").classList.toggle("show", n > 0);
  $("#bulk-n").textContent = `${n} selected`;
}

/* ============================================================
   EVENTS
   ============================================================ */
function bind() {
  $$(".nav-i").forEach(b => b.onclick = () => setView(b.dataset.view));
  $$("[data-filter-view]").forEach(b => b.onclick = () => {
    state.filterView = b.dataset.filterView;
    $$("[data-filter-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderQueue();
  });
  ["#f-status:#status", "#f-conf:#conf", "#f-team:#team"].forEach(pair => {
    const [sel, key] = pair.split(":");
    $(sel).onchange = e => { state[key.slice(1)] = e.target.value; renderQueue(); };
  });
  $("#q").oninput = e => { state.q = e.target.value; renderQueue(); };
  $("#clear-filters").onclick = () => {
    state.q = ""; state.status = ""; state.conf = ""; state.team = ""; state.filterView = "all";
    $("#q").value = ""; $("#f-status").value = ""; $("#f-conf").value = ""; $("#f-team").value = "";
    $$("[data-filter-view]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.filterView === "all")));
    renderQueue();
  };

  $$("[data-demo]").forEach(b => b.onclick = () => setDemo(b.dataset.demo));
  $("#theme-btn").onclick = toggleTheme;
  $("#export-audit").onclick = exportAudit;
  $("#a-type").onchange = renderAudit;
  $("#dr-close").onclick = closeDrawer;
  $("#scrim").onclick = closeDrawer;

  /* Delegated: table + drawer + banner + states */
  document.addEventListener("click", e => {
    const demoOff = e.target.closest("[data-demo-off]");
    if (demoOff) { setDemo("reset"); return; }

    const recover = e.target.closest("[data-recover]");
    if (recover) {
      const k = recover.dataset.recover;
      if (k === "retry") { toast("Re-queued 3 tickets for classification…"); setTimeout(() => { setDemo("reset"); toast("Classification recovered. 3 of 3 tickets classified."); }, 1100); }
      else setDemo("reset");
      return;
    }

    const modalBtn = e.target.closest("[data-modal]");
    if (modalBtn) { if (modalBtn.dataset.modal === "cancel") closeModal(); return; }
    if (e.target.id === "modal-scrim") { closeModal(); return; }

    const bulk = e.target.closest("[data-bulk]");
    if (bulk) { doBulk(bulk.dataset.bulk); return; }

    const act = e.target.closest("[data-act]");
    if (act) {
      const t = state.tickets.find(x => x.id === state.openId);
      const k = act.dataset.act;
      if (k === "accept") acceptSuggestion(t);
      else if (k === "override") openOverrideModal(t);
      else if (k === "why-gate") showGateLogic(t);
      else if (k === "assign") { t.assignee = "J. Okafor"; t.status = "in_progress"; pushHistory(t, "J. Okafor", "Assigned to self"); renderAll(); renderDrawer(t); toast(`${t.id} assigned to you.`); }
      else if (k === "escalate") { t.status = "in_progress"; t.flags = [...new Set([...t.flags, "sla_risk"])]; pushHistory(t, "J. Okafor", "Escalated to tier 3"); logAudit("escalate", t.id, "Manually escalated by agent"); renderAll(); renderDrawer(t); toast(`${t.id} escalated to tier 3.`); }
      else if (k === "undo") {
        const a = t.ai.autoActed; t.ai.autoActed = null; t.status = "new"; t.assignee = null;
        pushHistory(t, "J. Okafor", `Undid AI action: ${a.action}`);
        logAudit("override", t.id, `Undid automated action "${a.action}" inside the ${state.policy.undoWindowH}h window.`);
        renderAll(); renderDrawer(t); toast(`Undid "${a.action}" on ${t.id}.`);
      }
      return;
    }

    const sel = e.target.closest("[data-sel]");
    if (sel) {
      e.stopPropagation();
      sel.checked ? state.selected.add(sel.dataset.sel) : state.selected.delete(sel.dataset.sel);
      renderQueue(); renderBulk();
      return;
    }
    if (e.target.id === "sel-all") {
      const rows = visibleTickets();
      e.target.checked ? rows.forEach(t => state.selected.add(t.id)) : state.selected.clear();
      renderQueue(); renderBulk(); return;
    }

    const clar = e.target.closest("[data-clar-opt]");
    if (clar) {
      const ta = $("#clarifier-text");
      if (ta && !ta.value.includes(clar.dataset.clarOpt)) ta.value += `\n\n• ${clar.dataset.clarOpt}`;
      toast("Option appended to the question.");
      return;
    }

    if (e.target.closest("#regen")) {
      const ta = $("#draft-text");
      ta.value = ta.value.replace(/\.$/, "") + " I've also attached the incident timeline so you have the full picture in one place.";
      $("#draft-status").innerHTML = `<span class="edited">Regenerated · marked as human-reviewed</span>`;
      toast("Draft regenerated. Variation stored for the prompt review.");
      return;
    }
    if (e.target.closest("#toggle-lang")) {
      const t = state.tickets.find(x => x.id === state.openId);
      const ta = $("#draft-text"), btn = $("#toggle-lang");
      const showingEn = btn.dataset.en === "1";
      ta.value = showingEn ? t.ai.draft : t.ai.draftEn;
      btn.textContent = showingEn ? "Show English" : "Show customer language";
      btn.dataset.en = showingEn ? "0" : "1";
      return;
    }

    const tr = e.target.closest("tbody tr[data-id]");
    if (tr) openTicket(tr.dataset.id);
  });

  document.addEventListener("input", e => {
    if (e.target.id === "draft-text") {
      $("#char-count").textContent = `${e.target.value.length} chars`;
      $("#draft-status").innerHTML = `<span class="edited">Edited by J. Okafor · logged as a human-reviewed draft</span>`;
    }
  });

  /* Keyboard: agents live on keyboards */
  document.addEventListener("keydown", e => {
    const typing = /input|textarea|select/i.test(e.target.tagName);

    /* Focus trap — a modal dialog that lets Tab escape to the page behind it
       is the single most common a11y failure in dashboard UIs. */
    if (e.key === "Tab") {
      const container = $("#modal-scrim").classList.contains("show") ? $(".modal")
                      : $("#drawer").classList.contains("open") ? $("#drawer") : null;
      if (container) {
        const f = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', container)
          .filter(el => el.offsetParent !== null || el === container);
        if (f.length) {
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        }
      }
    }

    if (e.key === "Escape") { if ($("#modal-scrim").classList.contains("show")) return closeModal(); if (state.openId) return closeDrawer(); if (state.selected.size) { state.selected.clear(); renderQueue(); renderBulk(); } return; }
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); $("#q").focus(); return; }
    if (state.view !== "queue") return;
    const rows = visibleTickets();
    if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
      e.preventDefault(); state.focusIdx = Math.min(rows.length - 1, state.focusIdx + 1); focusRow(rows);
    } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
      e.preventDefault(); state.focusIdx = Math.max(0, state.focusIdx - 1); focusRow(rows);
    } else if (e.key === "Enter") { e.preventDefault(); if (rows[state.focusIdx]) openTicket(rows[state.focusIdx].id); }
    else if (e.key === "x" || e.key === "X") {
      const t = rows[state.focusIdx]; if (!t) return;
      state.selected.has(t.id) ? state.selected.delete(t.id) : state.selected.add(t.id);
      renderQueue(); renderBulk();
    } else if ((e.key === "a" || e.key === "A") && state.openId) {
      acceptSuggestion(state.tickets.find(x => x.id === state.openId));
    }
  });

  $("#kbd-help").onclick = () => {
    $("#modal-title").textContent = "Keyboard shortcuts";
    $("#modal-body").innerHTML = `<p>Agents process hundreds of tickets a shift. Everything here is reachable without a mouse.</p>
      <dl class="kv" style="margin-top:12px;grid-template-columns:74px 1fr;row-gap:9px">
        <dt><span class="kbd">/</span></dt><dd>Focus search</dd>
        <dt><span class="kbd">J</span> <span class="kbd">K</span></dt><dd>Move down / up the queue</dd>
        <dt><span class="kbd">↵</span></dt><dd>Open the focused ticket</dd>
        <dt><span class="kbd">X</span></dt><dd>Toggle selection on the focused row</dd>
        <dt><span class="kbd">A</span></dt><dd>Accept Relay's suggestion (drawer open)</dd>
        <dt><span class="kbd">Esc</span></dt><dd>Close drawer, modal, or clear selection</dd>
      </dl>`;
    $("#modal-foot").innerHTML = `<button class="btn primary" data-modal="cancel">Close</button>`;
    openModalFocus();
    $("[data-modal='cancel']").focus();
  };
}

function focusRow(rows) {
  const t = rows[state.focusIdx]; if (!t) return;
  const el = $(`tr[data-id="${t.id}"]`);
  if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }
}

function doBulk(kind) {
  const ids = [...state.selected];
  const ts = ids.map(id => state.tickets.find(t => t.id === id)).filter(Boolean);
  if (kind === "clear") { state.selected.clear(); renderQueue(); renderBulk(); return; }
  if (kind === "accept") {
    let acted = 0, held = 0;
    ts.forEach(t => {
      const g = gateOf(t);
      if (g.key === "auto" || g.key === "review") {
        t.status = "triaged"; t.assignee = g.key === "auto" ? "Relay (auto)" : "J. Okafor";
        t.ai.autoActed = { at: new Date().toISOString(), action: (REVERSIBILITY[t.ai.action] || {}).label, reversible: true };
        pushHistory(t, g.key === "auto" ? "Relay" : "J. Okafor", `Bulk-accepted: ${(REVERSIBILITY[t.ai.action] || {}).label}`);
        acted++;
      } else held++;
    });
    logAudit("accept", `${ts.length} tickets`, `Bulk accept on ${ids.join(", ")}. ${acted} actioned, ${held} held by policy.`);
    const snapshot = JSON.stringify(state.tickets);
    toast(`${acted} suggestion${acted === 1 ? "" : "s"} accepted${held ? ` · ${held} held by policy and left for a human` : ""}`, () => {
      state.tickets = JSON.parse(snapshot); renderAll(); if (state.openId) renderDrawer(state.tickets.find(t => t.id === state.openId));
    });
  } else if (kind === "route" || kind === "tag" || kind === "escalate") {
    const label = { route: "route", tag: "tag", escalate: "escalate" }[kind];
    $("#modal-title").textContent = `Bulk ${label} — ${ts.length} tickets`;
    $("#modal-body").innerHTML = kind === "route"
      ? `<p>Relay's suggested teams for this selection are shown per-ticket in the queue. Bulk routing overrides them and is logged individually.</p>
         <label class="sr" for="bulk-team">Team</label><select id="bulk-team">${TEAMS.map(x => `<option>${esc(x)}</option>`).join("")}</select>`
      : kind === "tag"
      ? `<p>Tags are reversible and low blast radius — this is the safest bulk action in the product.</p>
         <label class="sr" for="bulk-tag">Tag</label><select id="bulk-tag"><option>needs-followup</option><option>qbr-context</option><option>known-issue</option><option>docs-gap</option></select>`
      : `<p>Escalation raises severity and notifies the on-call lead. Relay flagged
         <b>${ts.filter(t => slaOf(t).cls === "risk").length}</b> of these ${ts.length} as SLA risk.</p>
         <label class="sr" for="bulk-why">Reason</label><select id="bulk-why"><option>SLA breach risk</option><option>Enterprise executive escalation</option><option>Repeat incident</option></select>`;
    $("#modal-foot").innerHTML = `<button class="btn" data-modal="cancel">Cancel</button><button class="btn primary" data-modal="confirm">Apply to ${ts.length}</button>`;
    openModalFocus();
    $("[data-modal='confirm']").onclick = () => {
      const val = $("#bulk-team")?.value || $("#bulk-tag")?.value || $("#bulk-why")?.value;
      ts.forEach(t => { if (kind === "route") { t.ai.team = val; t.status = "triaged"; } if (kind === "escalate") { t.ai.severity = "P1"; t.flags = [...new Set([...t.flags, "sla_risk"])]; } pushHistory(t, "J. Okafor", `Bulk ${label}: ${val}`); });
      logAudit(kind === "route" ? "override" : "accept", `${ts.length} tickets`, `Bulk ${label} → ${val} on ${ids.join(", ")}`);
      closeModal(); state.selected.clear(); renderAll();
      toast(`${ts.length} tickets ${label === "route" ? "routed to " + val : label === "tag" ? "tagged " + val : "escalated"}.`);
    };
    return;
  }
  state.selected.clear(); renderQueue(); renderBulk();
}

/* ---------- theme ---------- */
function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem("relay-theme", state.theme); } catch (e) {}
  toast(`${state.theme === "dark" ? "Dark" : "Light"} mode.`);
}

/* ---------- boot ---------- */
function init() {
  try { const saved = localStorage.getItem("relay-theme"); if (saved) { state.theme = saved; document.documentElement.dataset.theme = saved; } } catch (e) {}
  $("#f-team").innerHTML += TEAMS.map(t => `<option>${esc(t)}</option>`).join("");
  bind();
  setView("queue");
  renderAll();
  setInterval(() => { if (state.view === "queue") renderQueue(); }, 30000);   // SLA timers tick
  $("#nav-audit-count").textContent = state.audit.length;
  setTimeout(() => toast("Prototype loaded — open <b>VG-4815</b> and click “Why this decision?”", null), 900);
}

document.addEventListener("DOMContentLoaded", init);
