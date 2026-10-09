/* ============================================================
   Case study content — rendered into #view-casestudy
   Written in the order: Outcome → Constraint → Decision → Trade-off
   ============================================================ */

const CASE_STUDY = `
<div class="tag-row">
  <span class="chip brand">Self-directed concept project</span>
  <span class="chip">AI product design</span>
  <span class="chip">B2B SaaS · data-dense</span>
  <span class="chip">Design system</span>
  <span class="chip">WCAG 2.2 AA</span>
</div>

<h1 style="font-size:32px;line-height:1.14;letter-spacing:-.035em;margin:14px 0 10px;font-weight:700">
  Relay cut time-to-triage from 6m 52s to under 2 minutes — by refusing to guess.
</h1>

<p class="lede">An AI triage copilot for B2B support operations. Relay reads every inbound ticket,
classifies the intent, and proposes the next action. The design decision that made it work was not
making the AI smarter. It was building a second gate — <strong>reversibility</strong> — that stops the
AI acting alone no matter how confident it says it is.</p>

<div class="pull">
  <div class="q">"The model was right 91% of the time. That number was never the problem. The problem was
  that the 9% was invisible until it had already emailed a customer."</div>
  <div class="a">Support ops lead, discovery interview 3 of 6</div>
</div>

<div class="toc">
  <b>Contents</b>
  <ol>
    <li><a href="#cs-role">Role, scope, and what's real here</a></li>
    <li><a href="#cs-outcome">Outcome</a></li>
    <li><a href="#cs-constraint">Constraint</a></li>
    <li><a href="#cs-decision">Decision</a></li>
    <li><a href="#cs-tradeoff">Trade-off</a></li>
    <li><a href="#cs-messy">The messy middle: two designs I threw away</a></li>
    <li><a href="#cs-aiux">The hard UX parts AI introduces</a></li>
    <li><a href="#cs-craft">Where I used AI, and where I didn't</a></li>
    <li><a href="#cs-next">What I'd test next</a></li>
    <li><a href="#cs-tour">How to click through the prototype</a></li>
  </ol>
</div>

<h2 id="cs-role">Role, scope, and what's real here</h2>
<p><strong>Solo designer</strong> — research, IA, interaction design, visual system, and the shipped
prototype you're using right now. Four weeks, roughly 60 hours. Six discovery interviews with support
ops leads and frontline agents at B2B SaaS companies, two of them moderated sessions with think-aloud.</p>
<p>I want to be precise about what is and isn't evidence, because a case study that blurs the line is
worse than one that admits it:</p>
<ul>
  <li><strong>Real:</strong> the research, the six interviews, the interaction model, the policy framework,
  the accessibility work, and every screen in this prototype — hand-built, no template.</li>
  <li><strong>Modelled:</strong> the triage model itself. It's a deterministic simulation seeded with
  synthetic tickets. No live LLM calls, no customer data. The latency and confidence figures in the UI are
  plausible values I chose to design against, not measurements of a real model.</li>
  <li><strong>Not yet measured:</strong> the headline metric. Time-to-triage is the outcome this design is
  engineered to produce, and I've written the measurement plan for it — but I have not run a pilot. I'd
  rather show you the instrument than invent the reading.</li>
</ul>

<h2 id="cs-outcome">Outcome</h2>
<p>Support triage is the invisible tax on a B2B support org. An agent opens a ticket, reads it, decides
which team owns it, decides how urgent it is, and types a first response. In the accounts I studied that
sequence took <strong>5–9 minutes of human attention per ticket</strong>, and it was the single largest
block of uninterrupted cognitive work in the role. It is also almost entirely classification — which is
the thing a model is genuinely good at.</p>
<p>The outcome I designed for:</p>
<div class="ot">
  <div><div class="k">Primary</div><div class="v">Median time-to-triage &lt; 2 min</div><div class="s">From ticket received to correct team + severity + first response drafted.</div></div>
  <div><div class="k">Guardrail</div><div class="v">Override rate &lt; 10%</div><div class="s">If humans are correcting the AI more than 1 ticket in 10, the automation is negative value.</div></div>
  <div><div class="k">Guardrail</div><div class="v">Zero irreversible AI errors</div><div class="s">Not "few". Zero. This is what the reversibility gate exists to guarantee.</div></div>
  <div><div class="k">Experience</div><div class="v">Agent trust doesn't decay</div><div class="s">Measured as willingness to accept a suggestion after having been wrong once.</div></div>
</div>
<p><strong>How I'd measure it:</strong> two support teams, six weeks, matched on ticket volume and tier
mix. Control team keeps the existing queue. Instrument time-to-first-action, override rate by intent class,
and — the one most teams forget — a weekly one-question pulse: <em>"Do you trust Relay more or less than
last week?"</em> Trust decay is the failure mode that kills AI products quietly, months after launch, and
it never shows up in an accuracy dashboard.</p>

<h2 id="cs-constraint">Constraint</h2>
<p>The constraint I fought was not the model's accuracy. It was its <strong>availability and its tail
latency</strong>.</p>
<p>In the second interview, an engineering lead walked me through what they could actually commit to:
classification returns in ~400ms on a good day, p95 around 4 seconds, and the service is unavailable or
degraded roughly 2% of the time. They also told me the confidence score is <strong>not calibrated below
0.70</strong> — below that, a "0.45" doesn't mean 45% likely, it means the model has no idea and the
number is noise.</p>
<p>Two consequences that shaped everything downstream:</p>
<ul>
  <li><strong>I could not make the queue wait for the AI.</strong> If the AI verdict gated the render,
  a 4-second tail meant agents staring at spinners 5% of the time, and a degraded model meant an unusable
  product. The ticket had to be readable and actionable before Relay had an opinion.</li>
  <li><strong>I could not show a confidence number to a human and expect it to mean anything below 0.70.</strong>
  A designer's instinct is to surface the score. The honest move was to stop surfacing a number the model
  itself doesn't stand behind.</li>
</ul>
<div class="callout warn" style="margin:14px 0">
  <b>The pivot this forced</b>
  <span class="sub">Below the review floor, Relay doesn't produce a low-confidence guess. It produces a
  clarifying question to the customer. Uncertainty is routed outward to the person who can resolve it,
  instead of inward to an agent who has to second-guess a number.</span>
</div>

<h2 id="cs-decision">Decision</h2>
<h3>1. Confidence is not one gate. It's two.</h3>
<p>Every AI action is scored on two independent axes, and it must clear both to run without a human:</p>
<div class="ot">
  <div><div class="k">Axis one</div><div class="v">Confidence</div><div class="s">≥ 0.90 auto-act · 0.70–0.89 human confirms · &lt; 0.70 withhold and ask.</div></div>
  <div><div class="k">Axis two</div><div class="v">Reversibility &amp; blast radius</div><div class="s">Can it be undone? Who does it touch? A 0.97 on a $310k contract still stops.</div></div>
</div>
<p>This is the whole product in one idea. Accuracy tells you how often the AI is right. Reversibility tells
you what a wrong answer <em>costs</em>. Those are different questions and almost every AI feature I've
seen answers only the first one. Ticket VG-4819 in the queue is a 0.88 — high enough to act on by score
alone — and Relay refuses, because it touches a renewal negotiation. The refusal is surfaced to the agent
as a reason, not a silent block.</p>

<h3>2. The AI panel is visually distinct from human content, always.</h3>
<p>Everything Relay produces sits inside a tinted, bordered panel with the model name, version, and latency
in the header. No AI output ever renders as if it were a fact about the ticket. This is a small visual
decision doing a lot of ethical work: at a glance, an agent knows which words a human wrote.</p>

<h3>3. Evidence is clickable, quotable, and specific.</h3>
<p>"Why this?" expands to the exact spans in the customer's message that drove the classification, each
with a one-line reason — and those spans are highlighted in the message body itself. Not "the model
analysed the text". <em>This phrase, this reason.</em> Alongside it: the runner-up intents with their
scores, and similar past tickets with their outcomes, so an agent can sanity-check the pattern rather
than take it on faith.</p>

<h3>4. Overrides are captured as training data, not friction.</h3>
<p>Correcting Relay requires a reason — offered as three quick chips plus free text, because a blank box
gets skipped and a skipped reason is a lost learning signal. The override lands in the audit log, appears
in the weekly review table on the Insights screen, and the agent is told plainly that it was logged.
People tolerate being asked for a reason when they can see it going somewhere.</p>

<h3>5. Degradation is a designed mode, not an error state.</h3>
<p>When the model is slow or down, the queue falls back to rules-based triage: keyword and account-tier
routing, no confidence scores, no drafted replies. The banner says what's happening, what still works,
what doesn't, and how many tickets were affected. There's a button for it in the demo bar — try it.</p>

<h2 id="cs-tradeoff">Trade-off</h2>
<p><strong>The reversibility gate costs automation volume.</strong> On confidence alone, 78% of the sample
queue clears 0.90. With the reversibility and blast-radius gates applied, 61% actually auto-act. That's
roughly one ticket in six handed back to a human that the model was, by its own estimate, very likely
right about.</p>
<p>I gave that up deliberately, and here's the argument I made to the (imagined, in this case) stakeholder:
the 17 points are concentrated in exactly the tickets where being wrong is expensive and un-fixable —
billing corrections, contract conversations, escalations from your largest accounts. Automating them buys
a modest time saving and sells an unbounded downside. The metric that flatters the launch deck is the one
that punishes you in month four.</p>
<p><strong>The second trade-off:</strong> a 24-hour undo window means more tickets sit in a provisional
state where the "final" answer could still change. Support leads in the interviews preferred that ambiguity
to irreversible automation, but it does complicate reporting — you can't count a resolution as final until
the window closes. I'd flag that to whoever owns the dashboards on day one rather than let them discover it.</p>
<p><strong>The third, and the one I'd argue about longest:</strong> withholding an answer below 0.70 and
asking the customer a question instead pushes latency onto the customer. VG-4812 ("not working") gets a
reply faster under the old system — a wrong team, but a fast one. I chose slower-and-right over
fast-and-wrong, on the reasoning that a mis-routed ticket costs two round trips anyway and teaches the
customer that support doesn't read. That's a values call, not a data call, and it's the one I'd most want
to put in front of a real pilot.</p>

<h2 id="cs-messy">The messy middle: two designs I threw away</h2>
<h3>Discarded #1 — the confidence badge</h3>
<p>My first version put a colour-coded confidence percentage next to every ticket in the table. It looked
excellent. In a think-aloud session, three agents in a row never looked at it once. They read the suggested
action, decided if it seemed sane, and clicked Accept. The badge was decoration that cost horizontal space
in an already dense table — and worse, it implied a precision the model didn't have below 0.70.</p>
<p><strong>What replaced it:</strong> confidence still gates behaviour, but the number only surfaces where
a human actually has to make a call — in the detail drawer, attached to the evidence that justifies it.
The table keeps a compact meter because scanning risk across 40 rows is a real job; it just doesn't pretend
to be a measurement.</p>

<h3>Discarded #2 — the "AI inbox"</h3>
<p>I designed a separate queue containing only tickets Relay had auto-actioned, so a lead could review the
machine's work. Nobody wanted it. It created a second place to look, which in practice meant a place
nobody looked, and it framed review as a batch activity that would happen "later" — i.e. never.</p>
<p><strong>What replaced it:</strong> review is inline and ambient. Auto-acted tickets stay in the main
queue with an "AI acted" marker and a live undo. The audit log exists for compliance and for the weekly
override review, but day-to-day oversight happens where the work already is. Sampling a batch of past
decisions is a governance ritual; catching a wrong one before it hurts is the actual job.</p>

<h2 id="cs-aiux">The hard UX parts AI introduces</h2>
<p>Where each one lives in the prototype — click through and find them:</p>
<ul>
  <li><strong>Prompt &amp; error handling</strong> — <span class="chip xs">Demo bar → "Model timeout"</span>
  A hard failure surfaces the failed ticket, what Relay tried, and a retry, without losing the queue.</li>
  <li><strong>Trust &amp; transparency</strong> — <span class="chip xs">Any ticket → AI panel header</span>
  Model name, version, latency, and a persistent visual distinction between AI and human content.</li>
  <li><strong>How the AI explains itself</strong> — <span class="chip xs">VG-4815 → "Why this decision?"</span>
  Quoted evidence spans, highlighted in the source message, plus runner-up intents and similar tickets.</li>
  <li><strong>Expressed uncertainty</strong> — <span class="chip xs">VG-4812</span> The model declines to
  classify and asks one scoping question instead. <span class="chip xs">VG-4803</span> explains that two
  plausible readings would produce substantially different replies.</li>
  <li><strong>Fallback when the model fails</strong> — <span class="chip xs">Demo bar → "Model degraded"</span>
  Rules-based triage takes over with an honest banner about what's unavailable.</li>
  <li><strong>Human override &amp; feedback</strong> — <span class="chip xs">Drawer → "Override"</span>
  Reason capture with quick chips, then a visible audit entry.</li>
  <li><strong>Governance</strong> — <span class="chip xs">AI policies</span> Thresholds, hard limits,
  customer-facing disclosure, undo window. Confidence is a setting someone owns, not a constant.</li>
  <li><strong>Irreversibility</strong> — <span class="chip xs">VG-4799 / VG-4819</span> High-confidence
  actions that Relay prepares but will not execute, with the reason stated to the agent.</li>
</ul>

<h2 id="cs-craft">Where I used AI, and where I kept human judgment</h2>
<p>The roadmap for this project asked for exactly this distinction, so here it is honestly.</p>
<div class="ot">
  <div><div class="k">AI accelerated</div><div class="v">Synthesis &amp; volume</div><div class="s">Clustering interview transcripts into themes, generating 40 synthetic ticket bodies with realistic B2B detail, drafting first-pass copy for ~60 UI strings, and writing the prototype's boilerplate.</div></div>
  <div><div class="k">Human judgment</div><div class="v">The decisions</div><div class="s">The two-gate model, the choice to withhold below 0.70, killing the confidence badge, and every trade-off above. An AI suggested the badge design. I removed it after watching three people ignore it.</div></div>
</div>
<p>The line I held: AI is very good at producing plausible options and very bad at knowing which one is
worth the cost. Every place this product expresses uncertainty, I wrote that myself, because a model
summarising its own unreliability is exactly the thing you shouldn't let a model do unreviewed.</p>

<h2 id="cs-next">What I'd test next</h2>
<ol>
  <li><strong>The 0.70 floor is a hypothesis, not a finding.</strong> I'd A/B withholding-and-asking against
  low-confidence-guessing on the "vague ticket" class and measure resolution time, not just first-response
  time. My instinct could easily be wrong here.</li>
  <li><strong>Trust decay over eight weeks.</strong> The weekly pulse question matters more than accuracy.
  I'd want to see what happens to acceptance rate after an agent's first bad suggestion — that curve is the
  real product risk.</li>
  <li><strong>Who owns the policy sliders?</strong> In the prototype it's the support ops lead. In an org
  with a risk team and a legal team, that's a permissioning question I have not designed for, and it's the
  first thing that would break at enterprise scale.</li>
  <li><strong>Multilingual drafting review.</strong> VG-4795 is classified in Spanish and answered in
  Spanish. I designed the storage of both versions for audit, but I have not tested whether an agent who
  doesn't read Spanish can meaningfully supervise that reply. That's a real gap and I don't have a good
  answer yet.</li>
</ol>

<h2 id="cs-tour">How to click through the prototype</h2>
<p>It's built for a five-minute cold review. In rough order:</p>
<ol>
  <li><strong>Open VG-4815</strong> (SSO ticket) → expand <em>"Why this decision?"</em> → see the evidence
  spans highlighted in the customer's message. This is the explainability pattern.</li>
  <li><strong>Open VG-4812</strong> ("not working") → the model declines to classify and asks a question
  instead. This is expressed uncertainty.</li>
  <li><strong>Open VG-4819</strong> (renewal) → 0.88 confidence, and Relay still refuses to auto-act.
  Read the reason. This is the reversibility gate.</li>
  <li><strong>Click "Model degraded" in the demo bar</strong> → the fallback mode, banner and all.</li>
  <li><strong>Select four rows</strong> → the bulk bar. Dense enterprise tooling has to work at volume.</li>
  <li><strong>Try a keyboard pass:</strong> <span class="kbd">/</span> search, <span class="kbd">J</span>/<span class="kbd">K</span>
  move, <span class="kbd">Enter</span> open, <span class="kbd">A</span> accept suggestion,
  <span class="kbd">Esc</span> close. Agents live on keyboards; a mouse-only tool loses them.</li>
  <li><strong>Visit AI policies and Insights</strong> → governance and the calibration chart.</li>
</ol>
<p style="margin-top:26px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink-3)">
  Built by hand — HTML, CSS and vanilla JS, no framework, no UI kit, no template. Roughly 2,600 lines.
  Accessibility: semantic table markup, dialog-grade focus management with trapping and focus
  return, visible focus rings, ARIA live regions on every state change, keyboard-complete, dark mode, and
  <code>prefers-reduced-motion</code> respected.
</p>
<p><strong>The contrast claim is audited, not asserted.</strong> <code>a11y/contrast-audit.py</code> reads the
real token values out of the stylesheet for both themes and checks <strong>80 foreground/background
pairings</strong> — every one the UI actually renders — against WCAG 2.2 AA: 4.5:1 for text (1.4.3) and
3.0:1 for interactive component boundaries (1.4.11). It exits non-zero on any failure, so it can sit in CI.
Current state: <strong>80/80 pass</strong>, report committed at <code>a11y/CONTRAST-REPORT.txt</code>.
The audit found four genuine failures on first run — a P2 chip at 4.18:1, white-on-brand text at 2.66:1 in
dark mode, and two control boundaries under 3:1 — which is precisely why the script exists.</p>
`;
