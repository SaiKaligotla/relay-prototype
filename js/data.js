/* ============================================================
   RELAY — seed data + simulated triage model
   A fictional B2B SaaS ("Vantage", supply-chain analytics)
   support ops workspace. All data is synthetic.
   ============================================================ */

const MODEL = { name: "relay-triage", version: "2.4.1", updated: "2026-09-30" };

const TEAMS = [
  "Data Integrations", "Identity & Access", "Platform API",
  "Billing", "Product Feedback", "Customer Success", "Support Ops"
];

/* Confidence bands drive the whole trust model. */
const BANDS = [
  { min: 0.90, key: "auto",   label: "Auto-act eligible", tone: "high" },
  { min: 0.70, key: "review", label: "Human confirms",    tone: "mid"  },
  { min: 0.00, key: "unsure", label: "AI is unsure",      tone: "low"  }
];

function bandFor(c) { return BANDS.find(b => c >= b.min); }

/* Reversibility is the SECOND gate. A 0.99-confident irreversible action
   still goes to a human. This is the core design decision of the product. */
const REVERSIBILITY = {
  auto_route:    { label: "Route to team",        reversible: true,  blast: "low" },
  draft_reply:   { label: "Draft a reply",        reversible: true,  blast: "low" },
  apply_tag:     { label: "Apply tags",           reversible: true,  blast: "low" },
  send_kb:       { label: "Send KB answer",       reversible: false, blast: "medium" },
  merge_ticket:  { label: "Merge duplicate",      reversible: true,  blast: "low" },
  adjust_billing:{ label: "Adjust billing",       reversible: false, blast: "high" },
  close_ticket:  { label: "Close ticket",         reversible: false, blast: "medium" },
  escalate_csm:  { label: "Escalate to CSM",      reversible: true,  blast: "high" }
};

let _h = 0;
const ago = (h, m = 0) => { _h = h; return new Date(Date.now() - (h * 60 + m) * 60000).toISOString(); };

const TICKETS = [
  {
    id: "VG-4821",
    subject: "EU warehouse feed stopped syncing at 05:47 UTC",
    channel: "Email", received: ago(0, 22), slaMinutes: 60, status: "new", assignee: null,
    customer: { name: "Maren Vogel", company: "Lindqvist Retail Group", tier: "Enterprise", arr: "$184k", seats: 420, health: "at-risk" },
    flags: ["sla_risk"],
    body: "Since about 06:00 UTC the nightly feed from our Rotterdam DC has stopped syncing. The last successful run was 05:47. We're seeing 'connection reset by peer' in the connector logs and roughly 12,400 SKU records are stale. Our ops stand-up is at 09:00 CET and we can't promise availability numbers without this.",
    ai: {
      intent: "Data pipeline failure", confidence: 0.94, severity: "P1", sentiment: 0.24,
      team: "Data Integrations", action: "auto_route", latencyMs: 612,
      evidence: [
        { text: "Rotterdam DC has stopped syncing", why: "Names a connector + a stopped process" },
        { text: "connection reset by peer", why: "Matches 41 resolved transport-layer incidents" },
        { text: "12,400 SKU records are stale", why: "Quantifies blast radius → severity P1" }
      ],
      reasoning: "Transport-layer connector failure with a quantified data gap. Cluster of 3 similar tickets from EU warehouses in the last 9 days, all resolved by Data Integrations.",
      alternatives: [
        { intent: "Connector misconfiguration", confidence: 0.04 },
        { intent: "Platform outage", confidence: 0.02 }
      ],
      similar: [
        { id: "VG-4610", label: "APAC feed timeout after carrier change", outcome: "Resolved 41m — Data Integrations" },
        { id: "VG-4503", label: "Rotterdam DC partial sync", outcome: "Resolved 1h 12m — Data Integrations" }
      ],
      draft: "Hi Maren — thanks for the detail, this is enough for us to start. I've routed this to our Data Integrations on-call as a P1 and they're pulling the connector logs for the 05:47 UTC run now. The 'connection reset by peer' signature matches a transport issue we've seen on EU feeds twice this month, so we have a known path. I'll come back to you before your 09:00 CET stand-up with either a fix or a manual re-sync window so your availability numbers aren't blocked.",
      clarifier: null
    },
    history: []
  },
  {
    id: "VG-4819",
    subject: "Renewal quote — can we revisit the seat count?",
    channel: "Email", received: ago(1, 5), slaMinutes: 480, status: "new", assignee: null,
    customer: { name: "Priya Raghunathan", company: "Meridian Foods", tier: "Enterprise", arr: "$310k", seats: 880, health: "healthy" },
    flags: ["vip", "revenue"],
    body: "Our renewal is 34 days out and finance has pushed back on the seat count. We're using about 610 of the 880 seats. I'm not asking you to just cut it — I'd rather trade seats for the forecasting module. Can someone walk me through what that looks like commercially before I take it to our CFO?",
    ai: {
      intent: "Renewal / commercial negotiation", confidence: 0.88, severity: "P3", sentiment: 0.61,
      team: "Customer Success", action: "escalate_csm", latencyMs: 940,
      evidence: [
        { text: "renewal is 34 days out", why: "Inside the 45-day commercial window" },
        { text: "610 of the 880 seats", why: "Utilisation signal → downgrade risk" },
        { text: "trade seats for the forecasting module", why: "Expansion opportunity, not just churn" }
      ],
      reasoning: "High-value account, inside renewal window, explicitly asking for commercial terms. Not a support issue — routing to Support would waste the window.",
      alternatives: [
        { intent: "Billing dispute", confidence: 0.07 },
        { intent: "Downgrade request", confidence: 0.05 }
      ],
      similar: [
        { id: "VG-4390", label: "Seat right-size before renewal (Kestrel)", outcome: "Retained + $44k expansion" }
      ],
      draft: "Hi Priya — completely reasonable ask, and you're right that a straight seat cut isn't the only shape this can take. I've looped in your account lead with your utilisation numbers so you're not starting from zero. Before your CFO conversation, could we get 30 minutes this week? I'd like to bring two options: one that right-sizes seats, and one that trades the unused seats against the forecasting module you mentioned.",
      clarifier: null,
      /* The model is confident — but the action is irreversible and high-blast.
         Policy forces a human regardless of the score. */
      forcedHuman: "Touches a $310k contract. Confidence alone never auto-acts on revenue."
    },
    history: []
  },
  {
    id: "VG-4815",
    subject: "SAML assertion signature invalid after Okta cert rotation",
    channel: "Chat", received: ago(1, 44), slaMinutes: 120, status: "new", assignee: null,
    customer: { name: "Dale Okonjo", company: "Brunswick Health", tier: "Enterprise", arr: "$222k", seats: 1240, health: "healthy" },
    flags: ["sla_risk", "compliance"],
    body: "After rotating our Okta signing certificate yesterday, nobody in the finance group can log in. We get 'SAML assertion signature invalid' at /sso/acs. IT has confirmed the new cert is uploaded in your admin console. 60+ users blocked, and we have quarter-close starting Monday.",
    ai: {
      intent: "SSO / identity failure", confidence: 0.92, severity: "P2", sentiment: 0.35,
      team: "Identity & Access", action: "auto_route", latencyMs: 508,
      evidence: [
        { text: "rotating our Okta signing certificate", why: "Known trigger — 19 tickets, same root cause" },
        { text: "SAML assertion signature invalid", why: "Exact error string from KB-1142" },
        { text: "60+ users blocked", why: "Quantified impact → P2" }
      ],
      reasoning: "Cert-rotation cache invalidation. KB-1142 resolves 84% of these without engineering. Customer already tried the console upload, so the standard first step is pre-empted.",
      alternatives: [
        { intent: "Permission/group mapping", confidence: 0.05 },
        { intent: "Outage", confidence: 0.03 }
      ],
      similar: [
        { id: "VG-4702", label: "Okta cert rotation → finance group locked out", outcome: "Resolved 26m — KB-1142" },
        { id: "VG-4655", label: "SAML signature invalid after IdP change", outcome: "Resolved 55m — Identity & Access" }
      ],
      draft: "Hi Dale — this is a known one and it's usually quick. When a signing cert rotates, our assertion cache can hold the old key for up to 24h, which produces exactly that error even though the new cert is correctly uploaded. I can flush the cache for your tenant from here; it takes about 90 seconds and will sign the finance group out briefly. Want me to go ahead? If that doesn't clear it, I'll pull Identity & Access in immediately — I'd rather not have this open going into your quarter-close.",
      clarifier: null
    },
    history: []
  },
  {
    id: "VG-4812",
    subject: "not working",
    channel: "Chat", received: ago(2, 10), slaMinutes: 240, status: "needs_human", assignee: null,
    customer: { name: "Tomas Berg", company: "Halden Logistics", tier: "Business", arr: "$38k", seats: 95, health: "healthy" },
    flags: [],
    body: "hey, it's not working properly anymore. can someone look into this? thanks",
    ai: {
      intent: "Unclassified", confidence: 0.31, severity: "Unknown", sentiment: 0.5,
      team: null, action: "ask_clarifier", latencyMs: 380,
      evidence: [],
      reasoning: "Not enough signal. No product area, no error, no timeframe. Guessing here would mis-route and burn the customer's patience — the cheaper move is one specific question.",
      alternatives: [
        { intent: "Bug report", confidence: 0.29 },
        { intent: "Data issue", confidence: 0.22 },
        { intent: "Access issue", confidence: 0.18 }
      ],
      similar: [],
      draft: null,
      clarifier: {
        question: "Happy to dig in — can you tell me which screen it's happening on, and what you see instead of what you expected?",
        why: "Three of the four plausible intents are separated by *where* it breaks. One question resolves more uncertainty than any classifier could.",
        options: ["A specific screen or report", "Logging in", "Data looks wrong", "Something else"]
      }
    },
    history: []
  },
  {
    id: "VG-4809",
    subject: "Getting 429s at ~40 req/s — docs say 100",
    channel: "API", received: ago(2, 38), slaMinutes: 240, status: "new", assignee: null,
    customer: { name: "Sofia Almeida", company: "Corvo Systems", tier: "Business", arr: "$61k", seats: 40, health: "healthy" },
    flags: [],
    body: "We're getting HTTP 429 on /v2/inventory when we exceed about 40 req/s. Your docs mention 100 req/s on the Business plan but we're throttled at half that. Is the limit per-token or per-workspace? We can raise it ourselves or do you need to?",
    ai: {
      intent: "API rate limiting", confidence: 0.96, severity: "P3", sentiment: 0.58,
      team: "Platform API", action: "send_kb", latencyMs: 421,
      evidence: [
        { text: "HTTP 429", why: "Deterministic error code" },
        { text: "100 req/s on the Business plan", why: "Customer is quoting KB-0871 accurately" },
        { text: "per-token or per-workspace", why: "The exact question KB-0871 answers" }
      ],
      reasoning: "Fully answered by KB-0871. The 100 req/s figure is per-workspace; per-token defaults to 40. Customer is technically fluent and asked the right question — a doc link plus one sentence resolves it.",
      alternatives: [ { intent: "Bug — throttle misconfigured", confidence: 0.03 } ],
      similar: [
        { id: "VG-4771", label: "429 on /v2/inventory", outcome: "Self-served via KB-0871 in 4m" }
      ],
      draft: "Hi Sofia — good catch, and the docs are ambiguous here so I'll fix that. The 100 req/s on Business is per-workspace; the per-token default is 40, which is exactly the ceiling you're hitting. You can raise your own token limit up to the workspace cap in Settings → API → Tokens, no ticket needed. If you need above 100 aggregate, that's a plan conversation and I'll make the intro. I've also filed a docs clarification so the next person doesn't have to ask.",
      clarifier: null,
      kbRef: { id: "KB-0871", title: "Rate limits by plan", match: 0.97 }
    },
    history: []
  },
  {
    id: "VG-4806",
    subject: "Feature request: CSV export on the audit log",
    channel: "Email", received: ago(3, 12), slaMinutes: 1440, status: "new", assignee: null,
    customer: { name: "Hannah Weiss", company: "Brunswick Health", tier: "Enterprise", arr: "$222k", seats: 1240, health: "healthy" },
    flags: ["compliance"],
    body: "For our annual SOC 2 evidence pack we need the audit log as CSV. Right now we're screenshotting 400 rows, which our auditor has (fairly) told us isn't evidence. Is this on the roadmap? If not, is there an API endpoint we could pull from?",
    ai: {
      intent: "Feature request", confidence: 0.83, severity: "P4", sentiment: 0.66,
      team: "Product Feedback", action: "apply_tag", latencyMs: 574,
      evidence: [
        { text: "audit log as CSV", why: "Names the object and the format" },
        { text: "SOC 2 evidence pack", why: "Compliance driver → higher roadmap weight" },
        { text: "screenshotting 400 rows", why: "Documents the current workaround cost" }
      ],
      reasoning: "Clear, well-scoped request with a stated compliance driver and an existing manual workaround. Route to Product Feedback and link to FR-229 (14 prior asks). The API question is answerable now and shouldn't wait on the roadmap.",
      alternatives: [
        { intent: "Compliance question", confidence: 0.11 },
        { intent: "Bug — export broken", confidence: 0.06 }
      ],
      similar: [
        { id: "FR-229", label: "Audit log export (14 asks since Mar)", outcome: "Roadmap: Q1 2027 candidate" }
      ],
      draft: "Hi Hannah — your auditor is right, and screenshotting isn't a great use of your week. Two answers. Immediately: GET /v2/audit-log returns the same rows as JSON with cursor pagination, so you can pipe it to CSV today — I've attached a 6-line script that does it. On the roadmap: this is FR-229, now at 14 asks, and your SOC 2 driver is the kind of evidence that moves it. I've logged your account against it and I'll tell you when it's scheduled rather than making you chase.",
      clarifier: null
    },
    history: []
  },
  {
    id: "VG-4803",
    subject: "Four incidents in six weeks — COO wants alternatives priced",
    channel: "Phone", received: ago(4, 2), slaMinutes: 60, status: "new", assignee: null,
    customer: { name: "Grant Mbeki", company: "Kestrel Distribution", tier: "Enterprise", arr: "$415k", seats: 2100, health: "critical" },
    flags: ["churn_risk", "vip", "sla_risk"],
    body: "Honestly, we've had four incidents in six weeks and the last one cost us a full day of picking. Our COO has put Vantage on the agenda for the QBR and asked me to get pricing from two other vendors. I'd rather not — but I need to know what changes.",
    ai: {
      intent: "Churn risk / executive escalation", confidence: 0.79, severity: "P1", sentiment: 0.11,
      team: "Customer Success", action: "escalate_csm", latencyMs: 1180,
      evidence: [
        { text: "four incidents in six weeks", why: "Pattern, not a one-off — cross-referenced 4 linked tickets" },
        { text: "get pricing from two other vendors", why: "Active competitive evaluation" }
      ],
      reasoning: "Confidence sits in the review band, but the signals corroborate each other and the ARR at risk is the largest in the workspace. This is the case where being wrong in either direction is expensive, so the AI states its uncertainty and escalates rather than optimising the reply.",
      alternatives: [
        { intent: "Reliability complaint", confidence: 0.14 },
        { intent: "Renewal leverage", confidence: 0.07 }
      ],
      similar: [
        { id: "VG-4488", label: "Executive escalation — repeated outages", outcome: "Retained after exec sponsorship + SLA credit" }
      ],
      draft: "Grant — I'm not going to tell you four incidents in six weeks is acceptable, because it isn't, and you shouldn't have to make the case for that internally. I've escalated this to our VP of Customer Success and your exec sponsor with all four incident timelines attached, so the conversation at your QBR is with someone who can commit to changes rather than explain them. Two things I can offer before then: a written root-cause summary of all four with what we've changed, and a call with our head of reliability. I'd rather earn the next quarter than argue about this one.",
      clarifier: null,
      lowConfidenceNote: "Sentiment is clearly negative, but 'renewal leverage' vs 'genuine churn' changes the response substantially. AI recommends a human read before anything is sent."
    },
    history: []
  },
  {
    id: "VG-4799",
    subject: "VAT ID and billing address wrong on last 3 invoices",
    channel: "Email", received: ago(5, 20), slaMinutes: 480, status: "new", assignee: null,
    customer: { name: "Elin Sørensen", company: "Nordkap Shipping", tier: "Business", arr: "$72k", seats: 180, health: "healthy" },
    flags: ["compliance"],
    body: "Our last three invoices carry the wrong VAT ID and an old Copenhagen address. We moved to Aarhus in March. Our accounts team can't book them, and under Danish rules we need corrected invoices rather than credit notes. Can you reissue all three?",
    ai: {
      intent: "Billing correction", confidence: 0.93, severity: "P3", sentiment: 0.42,
      team: "Billing", action: "adjust_billing", latencyMs: 702,
      evidence: [
        { text: "wrong VAT ID", why: "Tax-compliance field, not cosmetic" },
        { text: "moved to Aarhus in March", why: "Explains the root cause across all three" },
        { text: "corrected invoices rather than credit notes", why: "Jurisdiction-specific constraint the model must not override" }
      ],
      reasoning: "High confidence on intent, and the fix is unambiguous. But reissuing invoices is irreversible and touches tax records — auto-act is disabled for this action class by policy, so the AI prepares everything and stops short of executing.",
      alternatives: [ { intent: "Payment failure", confidence: 0.05 } ],
      similar: [
        { id: "VG-4611", label: "VAT ID correction — 2 invoices", outcome: "Reissued in 3h — Billing" }
      ],
      draft: "Hi Elin — sorry, this is our data and it should have been caught. I can reissue all three as corrected invoices (not credit notes, per your note on Danish rules) with the Aarhus address and your VAT ID. Before I send them, can you confirm the VAT ID below is the one to print? [DK-••••-4471] Once you confirm, they'll be in your accounts team's inbox within the hour.",
      clarifier: null,
      forcedHuman: "Reissuing invoices is irreversible and touches tax records. Prepared, not executed."
    },
    history: []
  },
  {
    id: "VG-4795",
    subject: "Monterrey warehouse showing doubled inventory figures",
    channel: "Chat", received: ago(6, 44), slaMinutes: 240, status: "new", assignee: null,
    customer: { name: "Lucía Ferrer", company: "Grupo Andamio", tier: "Business", arr: "$54k", seats: 120, health: "healthy" },
    flags: ["non_english"],
    language: "es",
    body: "Desde la actualización de ayer, el tablero de inventario muestra cifras duplicadas para el almacén de Monterrey. Ya intenté limpiar la caché y usar otro navegador. ¿Pueden revisarlo? Tenemos auditoría el viernes.",
    translated: "Since yesterday's update, the inventory dashboard shows doubled figures for the Monterrey warehouse. I already tried clearing the cache and using another browser. Can you look into it? We have an audit on Friday.",
    ai: {
      intent: "Data quality — duplicate records", confidence: 0.9, severity: "P2", sentiment: 0.44,
      team: "Data Integrations", action: "merge_ticket", latencyMs: 833,
      evidence: [
        { text: "doubled figures for the Monterrey warehouse", why: "Scoped to one warehouse → data-level, not display-level" },
        { text: "clearing the cache and another browser", why: "Customer already ruled out the two most common false positives" },
        { text: "audit on Friday", why: "Hard deadline → P2" }
      ],
      reasoning: "Ticket written in Spanish; classified on the translated text and matched to VG-4780 opened 3h earlier by a different user at the same company. Same warehouse, same symptom, same release. Merging keeps one timeline for the audit rather than two half-answers.",
      alternatives: [
        { intent: "Dashboard rendering bug", confidence: 0.06 },
        { intent: "Sync duplication", confidence: 0.04 }
      ],
      similar: [
        { id: "VG-4780", label: "Monterrey inventory doubled (Grupo Andamio)", outcome: "Open — Data Integrations, 3h ago" }
      ],
      draft: "Hola Lucía — gracias, y siento el problema. Es el mismo que reportó su colega hace tres horas en el ticket VG-4780: la actualización de ayer duplica los registros del almacén de Monterrey. Los he unificado para que tengan una sola línea de tiempo antes de la auditoría del viernes, y Data Integrations ya está en ello. Le escribo en cuanto tengamos una corrección o una hora estimada.",
      draftEn: "Hi Lucía — thanks, and sorry. This is the same issue your colleague reported three hours ago in VG-4780: yesterday's release is duplicating Monterrey warehouse records. I've merged them so you have one timeline ahead of Friday's audit, and Data Integrations is already on it. I'll write to you the moment we have a fix or an ETA.",
      clarifier: null,
      translationNote: "Classified and drafted in the customer's language. Reply is stored with both versions for audit."
    },
    history: []
  },
  {
    id: "VG-4790",
    subject: "Add 25 seats before Monday onboarding",
    channel: "Chat", received: ago(7, 30), slaMinutes: 480, status: "triaged", assignee: "Relay (auto)",
    customer: { name: "Owen Brady", company: "Corvo Systems", tier: "Business", arr: "$61k", seats: 40, health: "healthy" },
    flags: ["revenue"],
    body: "We've got 25 new starters on Monday and need seats added to the workspace. Same plan, same rate — just bump us up. Can you confirm it's done before Friday so I can send invites?",
    ai: {
      intent: "Seat increase", confidence: 0.97, severity: "P4", sentiment: 0.78,
      team: "Billing", action: "auto_route", latencyMs: 356,
      evidence: [
        { text: "25 new starters on Monday", why: "Concrete quantity + deadline" },
        { text: "Same plan, same rate", why: "No commercial judgement required" }
      ],
      reasoning: "Additive, reversible, unambiguous, and the customer supplied every variable. Highest-confidence class of ticket in the queue — and the safest thing to automate.",
      alternatives: [],
      similar: [ { id: "VG-4733", label: "Seat increase — 12 seats", outcome: "Auto-actioned in 40s" } ],
      draft: "Hi Owen — done, 25 seats added, taking you to 65. They're active now so you can send invites whenever you like, and the prorated amount for the remainder of this cycle is on your next invoice. Congrats on the new starters.",
      clarifier: null,
      autoActed: { at: ago(7, 28), action: "Seats increased 40 → 65", reversible: true, undone: false }
    },
    history: [
      { at: ago(7, 29), who: "Relay", what: "Auto-classified as Seat increase (0.97)" },
      { at: ago(7, 28), who: "Relay", what: "Auto-actioned: seats 40 → 65. Reversible for 24h." }
    ]
  },
  {
    id: "VG-4788",
    subject: "Dashboard loads in 11s for APAC users",
    channel: "Email", received: ago(9, 15), slaMinutes: 1440, status: "new", assignee: null,
    customer: { name: "Aiko Tanaka", company: "Sōgō Freight", tier: "Enterprise", arr: "$158k", seats: 640, health: "healthy" },
    flags: [],
    body: "Since the last release our regional dashboard takes about 11 seconds to load for users in Tokyo and Sydney. EU users report 2–3 seconds. It's not blocking work but it's very noticeable and our ops leads have started asking about it.",
    ai: {
      intent: "Performance regression", confidence: 0.74, severity: "P3", sentiment: 0.48,
      team: null, action: "draft_reply", latencyMs: 1024,
      evidence: [
        { text: "11 seconds to load for users in Tokyo and Sydney", why: "Region-scoped, quantified" },
        { text: "EU users report 2–3 seconds", why: "Control group → regional, not global" }
      ],
      reasoning: "Region-scoped latency could be CDN edge config, a new query that isn't cached in APAC, or the release's payload size. The model can't separate those from the ticket alone, so it drafts and holds rather than routing to the wrong team.",
      alternatives: [
        { intent: "CDN / edge misconfiguration", confidence: 0.13 },
        { intent: "Release regression (global)", confidence: 0.09 }
      ],
      similar: [
        { id: "VG-4590", label: "APAC latency after release", outcome: "Resolved — CDN edge cache rule" }
      ],
      draft: "Hi Aiko — thanks for the numbers, the EU/APAC split is genuinely useful and narrows this a lot. That pattern usually points at our edge cache rather than the app itself, so I've asked our platform team to check the APAC edge config against the last release before we start profiling queries. Not blocking, as you say, but 11 seconds is too slow and I don't want your ops leads to have to raise it twice.",
      clarifier: null
    },
    history: []
  },
  {
    id: "VG-4781",
    subject: "Congrats on the Series C! Quick 15 min?",
    channel: "Email", received: ago(11, 40), slaMinutes: 1440, status: "new", assignee: null,
    customer: { name: "Dev Rautela", company: "growthlead.ai", tier: "None", arr: "—", seats: 0, health: "unknown" },
    flags: ["unsolicited"],
    body: "Hi team — congrats on the Series C! We help SaaS support teams cut ticket volume by 40% with outbound AI SDRs. Would love 15 minutes next week. — Dev, growthlead.ai",
    ai: {
      intent: "Unsolicited vendor outreach", confidence: 0.95, severity: "P5", sentiment: 0.7,
      team: "Support Ops", action: "close_ticket", latencyMs: 298,
      evidence: [
        { text: "cut ticket volume by 40%", why: "Sales claim, not a support request" },
        { text: "15 minutes next week", why: "Meeting request pattern" }
      ],
      reasoning: "Vendor pitch from a non-customer domain. 214 of these last quarter, all manually closed at ~40s each. Auto-close is enabled for this class by policy — but it's irreversible, so it's logged and reversible-for-24h rather than deleted.",
      alternatives: [ { intent: "Partnership enquiry", confidence: 0.04 } ],
      similar: [ { id: "VG-4756", label: "Vendor outreach — auto-closed", outcome: "Closed by policy" } ],
      draft: null,
      clarifier: null
    },
    history: []
  },
  {
    id: "VG-4777",
    subject: "Picking team can't close out the shift report",
    channel: "Phone", received: ago(14, 5), slaMinutes: 240, status: "in_progress", assignee: "A. Nwosu",
    customer: { name: "Ray Kovac", company: "Halden Logistics", tier: "Business", arr: "$38k", seats: 95, health: "at-risk" },
    flags: ["sla_risk"],
    body: "End of shift, the report won't close out. Spinner for about a minute then a red bar. Tried twice. We've got 14 people waiting on it and the night crew can't start without the numbers.",
    ai: {
      intent: "Report generation failure", confidence: 0.71, severity: "P2", sentiment: 0.22,
      team: "Platform API", action: "draft_reply", latencyMs: 1290,
      evidence: [
        { text: "the report won't close out", why: "Names the workflow, not the object" },
        { text: "spinner for about a minute then a red bar", why: "Timeout signature, but the error text is missing" }
      ],
      reasoning: "Timeout signature, but 'a red bar' doesn't tell us the error code, and this customer has an unresolved ticket from 6 days ago that may be related. Confidence is just above the review floor — treat the suggestion as a starting point, not an answer.",
      alternatives: [
        { intent: "Data volume limit", confidence: 0.16 },
        { intent: "Regression from VG-4812", confidence: 0.13 }
      ],
      similar: [
        { id: "VG-4701", label: "Shift report timeout — large warehouse", outcome: "Resolved 2h — pagination fix" }
      ],
      draft: "Hi Ray — sorry, and I know 14 people are standing around. Two things at once: I've asked our on-call to look at your tenant's report queue right now, and could you send me the exact text in the red bar? That single line tells us whether this is a timeout or a data-volume limit, and they're different fixes. If it's urgent I can also generate the shift numbers manually and email them while we sort the report.",
      clarifier: null,
      relatedOpenTicket: "VG-4712 — same customer, open 6 days, unresolved"
    },
    history: [
      { at: ago(13, 50), who: "Relay", what: "Classified as Report generation failure (0.71) — flagged for human review" },
      { at: ago(13, 41), who: "A. Nwosu", what: "Assigned to self, marked in progress" }
    ]
  },
  {
    id: "VG-4770",
    subject: "Two-factor codes not arriving by SMS",
    channel: "Chat", received: ago(26, 0), slaMinutes: 120, status: "resolved", assignee: "M. Duarte",
    customer: { name: "Petra Lindgren", company: "Nordkap Shipping", tier: "Business", arr: "$72k", seats: 180, health: "healthy" },
    flags: [],
    body: "SMS codes stopped arriving this morning for three of our users. Email codes work fine. Carrier is Telenor.",
    ai: {
      intent: "2FA delivery failure", confidence: 0.95, severity: "P2", sentiment: 0.4,
      team: "Identity & Access", action: "auto_route", latencyMs: 447,
      evidence: [
        { text: "SMS codes stopped arriving", why: "Delivery channel failure" },
        { text: "Email codes work fine", why: "Isolates to SMS provider, not auth service" },
        { text: "Carrier is Telenor", why: "Matched a known provider outage window" }
      ],
      reasoning: "Carrier-scoped SMS delivery failure during a known Telenor aggregation outage. Auto-routed to Identity & Access; resolved by switching affected users to TOTP.",
      alternatives: [],
      similar: [ { id: "VG-4688", label: "Telenor SMS delivery", outcome: "Resolved 38m — TOTP fallback" } ],
      draft: "Hi Petra — this is a carrier-side SMS aggregation outage affecting Telenor, not an account problem. I've switched the three affected users to TOTP so they can get in now, and SMS will come back on its own when the carrier clears the queue.",
      clarifier: null,
      autoActed: { at: ago(25, 52), action: "Routed to Identity & Access, P2", reversible: true, undone: false }
    },
    history: [
      { at: ago(25, 55), who: "Relay", what: "Auto-classified as 2FA delivery failure (0.95)" },
      { at: ago(25, 52), who: "Relay", what: "Auto-routed to Identity & Access as P2" },
      { at: ago(25, 40), who: "M. Duarte", what: "Accepted assignment — AI suggestion kept" },
      { at: ago(25, 18), who: "M. Duarte", what: "Resolved — TOTP fallback enabled for 3 users" }
    ]
  }
];

/* ---- Insights (synthetic, but internally consistent) ---- */
const METRICS = {
  autoRate:   { value: 61, delta: "+9 pts", dir: "up", label: "Auto-triaged without a human touch", note: "Target was 50% for the pilot" },
  ttr:        { value: "1m 48s", delta: "−74%", dir: "down", label: "Median time-to-triage", note: "Was 6m 52s pre-Relay" },
  override:   { value: 8.4, delta: "−2.1 pts", dir: "down", label: "Human override rate", suffix: "%", note: "Falling = the model is agreeing with experts more often" },
  precision:  { value: 91.2, delta: "+1.8 pts", dir: "up", label: "Intent precision vs. expert label", suffix: "%", note: "Measured on a 1,200-ticket blind sample" },
  deflection: { value: 214, delta: "/quarter", dir: "flat", label: "Vendor & spam tickets closed by policy", note: "~40s of human time saved each" }
};

/* Calibration: what the model says vs what it's right about.
   A well-calibrated 0.9 should be right ~90% of the time. */
const CALIBRATION = [
  { band: "0.5–0.6", claimed: 0.55, actual: 0.41, n: 118 },
  { band: "0.6–0.7", claimed: 0.65, actual: 0.58, n: 204 },
  { band: "0.7–0.8", claimed: 0.75, actual: 0.74, n: 431 },
  { band: "0.8–0.9", claimed: 0.85, actual: 0.86, n: 388 },
  { band: "0.9–1.0", claimed: 0.95, actual: 0.96, n: 512 }
];

const VOLUME = [
  { d: "Mon", in: 412, auto: 248 }, { d: "Tue", in: 468, auto: 291 },
  { d: "Wed", in: 501, auto: 322 }, { d: "Thu", in: 455, auto: 301 },
  { d: "Fri", in: 388, auto: 259 }, { d: "Sat", in: 142, auto: 104 },
  { d: "Sun", in: 118, auto: 88 }
];

/* Default policy — the governance surface. */
const DEFAULT_POLICY = {
  autoThreshold: 0.90,
  reviewFloor: 0.70,
  reversibleOnly: true,
  tierGuard: true,          // never auto-act on Enterprise without a human
  revenueGuard: true,       // never auto-act on anything touching money
  closeGuard: true,         // auto-close only spam class
  undoWindowH: 24,
  citeEvidence: true,
  discloseModel: true,
  languageMatch: true
};

const AUDIT = [
  { at: "2026-10-08 09:14:02", actor: "Relay 2.4.1", type: "auto_route", target: "VG-4770", detail: "Routed to Identity & Access (conf 0.95). Reversible 24h.", outcome: "kept" },
  { at: "2026-10-08 09:02:41", actor: "A. Nwosu", type: "override", target: "VG-4777", detail: "Changed team Platform API → Data Integrations. Reason: 'Timeout is on the aggregation job, not the API.'", outcome: "logged to feedback" },
  { at: "2026-10-08 08:47:19", actor: "Relay 2.4.1", type: "escalate", target: "VG-4803", detail: "Escalated to Customer Success. Confidence 0.79 but ARR at risk $415k → policy override.", outcome: "kept" },
  { at: "2026-10-08 08:31:55", actor: "M. Duarte", type: "accept", target: "VG-4815", detail: "Accepted AI routing + edited draft (added 90s cache-flush warning).", outcome: "edit logged" },
  { at: "2026-10-08 07:58:03", actor: "Relay 2.4.1", type: "ask_clarifier", target: "VG-4812", detail: "Confidence 0.31 — withheld classification, asked one scoping question instead.", outcome: "awaiting customer" },
  { at: "2026-10-07 17:22:10", actor: "System", type: "degraded", target: "—", detail: "Model latency p95 crossed 4s for 11 min. Queue fell back to rules-based triage. 34 tickets affected.", outcome: "auto-recovered" },
  { at: "2026-10-07 15:40:00", actor: "J. Okafor", type: "policy_change", target: "policy", detail: "Raised auto-act threshold 0.85 → 0.90 after override rate spiked on billing intents.", outcome: "approved by 2" }
];
