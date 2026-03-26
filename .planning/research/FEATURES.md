# Feature Research

**Domain:** WhatsApp anti-bot detection mimicry / human behavioral simulation
**Researched:** 2026-03-26
**Confidence:** MEDIUM — WhatsApp's internal detection is undocumented; findings synthesized from WAHA community reports, warmup tool documentation, and behavioral pattern research

## Context: What Already Exists

The existing plugin already has:
- Token bucket rate limiter (per outbound API call, v1.14)
- Typing simulation delays on bot replies (inbound-triggered only, existing)
- Per-session, per-contact config hierarchy (partial — global + session, no contact-level for mimicry)
- Message queue with flood protection (bounded, DM priority, v1.14)
- Analytics SQLite event store (v1.13)

v1.20 builds on top of these. This research covers only new mimicry features.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any credible anti-bot system must have. Missing these = sessions get banned.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Time-of-day send gate | Humans don't message at 3am. Meta's detection watches send-time distribution; nighttime bursts are a primary ban signal. Without a gate, the bot sends whenever the LLM decides to. | LOW | Default window 7am–1am local time. Configurable per session. Queue-or-reject policy on overflow. |
| Hourly message cap (hard limit) | Burst sending is the #1 ban signal for personal WhatsApp accounts. 50+ messages in one hour from a personal number triggers review. The existing token bucket is per-call (not hourly) — different mechanism. | LOW | Hard cap (not soft warning). Reject overflow at queue boundary. Per session. Default: 30 msgs/hr for new accounts, 50 for stable. |
| Progressive caps tied to account maturity | New accounts (<30 days) are under heightened surveillance ("honeymoon surveillance" in warmup literature). Account age directly correlates with allowed message volume. Warmup research shows: week 1 = 10–20/day, weeks 2–4 = 20–50/day, stable = 50+/day. | MEDIUM | Track maturity phase per session: New (0–7 days), Warming (8–30 days), Stable (30+ days). Each phase has its own default hourly/daily cap. Override in config. |
| Config hierarchy: global → session → contact/group | Follows existing plugin config pattern. Without hierarchy, can't apply strict limits to a new session while relaxing for a known-human-contact conversation. | MEDIUM | Extend existing config merge engine with a `mimicry` block. Reuse merge strategy pattern already in place. |
| Claude Code sends routed through mimicry | whatsapp-messenger skill currently bypasses ALL delays and rate limiting — it calls the plugin's `send` action but the action handler does not enforce gates or caps. Direct bypass of the entire mimicry system. | MEDIUM | Intercept in `handleAction()` in `channel.ts` before the WAHA API call. Apply gate check + cap decrement there. Same code path as agent sends. |
| Quiet hours queue (hold, not drop) | When a message arrives outside the gate window, silently dropping it loses intent. The default expectation is "hold until morning" not "gone forever". | LOW | Config: `quietHoursPolicy: "queue" | "reject"`. Default: `"queue"`. Held messages drain when gate opens. Reuses existing message queue. |

### Differentiators (Competitive Advantage)

Features that reduce ban risk meaningfully beyond the bare minimum.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Jittered inter-message delays | Uniform delays (exactly 1000ms every time) are machine-detectable through statistical analysis of inter-message intervals. Jitter (random variance ±30–50% of base delay) breaks the pattern. | LOW | Apply to all outbound sends, not just typing simulation. Already have typing delay — add `Math.random()` variance. `baseDelay * (0.7 + Math.random() * 0.6)`. |
| Typing indicator proportional to message length | Fixed typing delay is machine-detectable. Human typing is ~40–60 WPM (~200–300 chars/min). Short messages = short typing; long = longer. Already have typing sim in inbound path — extend to outbound. | LOW | Formula: `min(25000, Math.ceil(charCount / 4.5) * 1000)` ms. WAHA typing indicator max is 25 seconds. |
| Drain rate throttling on queued messages | When multiple messages queue up (e.g., Claude Code batch send), drain at human-like rate rather than firing sequentially with minimum gaps. Prevents burst-on-open patterns. | MEDIUM | Existing queue has drain logic. Add inter-send delay of 3–8s (jittered) between consecutive sends in drain cycle. |
| Admin panel: maturity phase visibility | Without visibility, admin can't tell what limits are active or when the account upgrades to the next phase. Operational blind spot. | MEDIUM | Dashboard card or section: shows phase name (New/Warming/Stable), days since first send, days until next phase, current effective hourly cap, messages sent today vs cap. |
| Per-contact rate limit exemption flag | Some contacts are known humans or trusted systems that should not be gated (e.g., Omer's own number, known admin contacts). Hard to use the bot if legitimate urgent messages get held. | LOW | `rateLimitExempt: true` in per-contact directory settings. Skip gate + cap for outbound to that JID. Auditable, explicit, not a general bypass. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| "Urgent" bypass flag on individual messages | Agents want to send time-sensitive alerts immediately regardless of gates | Any mechanism called "urgent" gets overused. One bypass = no protection. Also impossible to verify urgency from plugin perspective — LLM decides everything is urgent. | Use `rateLimitExempt: true` on specific known-important contacts in directory settings. Explicit, admin-controlled, not LLM-controlled. |
| Clockwork send schedule (always at 9:00:00 AM) | Sounds like good discipline — only send during peak hours | Creates a perfectly regular machine signature. Messages timestamped 9:00:01, 9:00:02, 9:00:03 are more suspicious than natural variance. | Use jittered windows (gate opens at 7am, messages drain with random inter-send delay). Organic distribution within the window is better than clockwork delivery. |
| Read receipts suppression ("bots don't read") | "If the bot reads instantly, Meta knows it's a bot" | WhatsApp auto-marks messages as read when the app/connection processes them. Suppressing blue ticks via NOWEB API is possible but TOGGLING privacy settings is itself an API call that may be monitored. The existing plugin already handles `read` action. | Keep auto-read on. Consistently reading messages is a trust signal for genuine engagement. |
| Rotating sessions/phone numbers | "Use multiple numbers to spread volume" | WAHA personal accounts are phone-number-tied. Number rotation = multiple physical SIMs or VoIP numbers, all of which have their own trust scores. Fresh numbers have LOWER trust. | Build trust on the existing sessions. Account maturity is a long-term asset — don't dilute it. |
| Fake "typing" before first-message initiation | Add typing indicator before the bot's first outbound message in a new conversation | WhatsApp detection is account-level behavioral, not per-message-aesthetics. First-message typing costs API calls without meaningful detection mitigation. | Reserve typing indicators for replies (already implemented in inbound path). |
| Daily send schedule with fixed time slots | Batch all sends into a specific window (e.g., only 9–10am) | Produces a bimodal distribution in send timestamps — quiet all day, then burst in one hour. More suspicious than organic distribution throughout allowed hours. | Let the gate define allowed hours; let jitter and natural agent activity produce organic distribution within those hours. |

---

## Feature Dependencies

```
[Config hierarchy: mimicry block]
    └──required by──> [Time-of-day gate]
    └──required by──> [Hourly message cap]
    └──required by──> [Progressive caps]
    └──required by──> [Per-contact rate limit exemption]

[Account maturity phase tracker]
    └──required by──> [Progressive caps]
    └──required by──> [Admin panel maturity display]
    └──uses──> [SQLite analytics event store] (already exists v1.13)

[Time-of-day gate]
    └──required by──> [Quiet hours queue]
    └──required by──> [Claude Code mimicry routing]

[Hourly message cap]
    └──required by──> [Claude Code mimicry routing]
    └──enhances──> [Existing token bucket rate limiter] (different timescale, complementary)

[Existing message queue (v1.14)]
    └──used by──> [Quiet hours queue]
    └──used by──> [Drain rate throttling]

[Claude Code mimicry routing]
    └──requires──> [Time-of-day gate]
    └──requires──> [Hourly message cap]
    └──requires──> [Typing delay proportional to length] (for outbound Claude Code sends)

[Jittered inter-message delays]
    └──enhances──> [Existing typing simulation]
    └──enhances──> [Drain rate throttling]

[Typing delay proportional to length]
    └──enhances──> [Existing typing simulation]
    └──required by──> [Claude Code mimicry routing] (outbound typing sim)

[Admin panel maturity display]
    └──requires──> [Account maturity phase tracker]
    └──requires──> [Config hierarchy: mimicry block]
```

### Dependency Notes

- **Config hierarchy is the foundational primitive.** All other features need a `mimicry` config block that follows the existing global → session → contact/group merge. This must land first or subsequent features have no config surface.
- **Account maturity requires first-send timestamp.** The simplest implementation stores `first_send_at` per session in SQLite or config. Phase is derived: age < 7 days = New, 7–30 days = Warming, 30+ days = Stable. Minimal state.
- **Quiet hours queue reuses existing queue infrastructure.** The existing bounded message queue from v1.14 already handles DM/group message holding. Quiet hours adds a drain condition: "only drain when gate is open". No new queue needed.
- **Claude Code routing intercepts at `handleAction()`.** The whatsapp-messenger skill calls the plugin's `send` action. The gate + cap check must live in `handleAction()` in `channel.ts`, before the call chain reaches `sendWahaText`. This is the single choke point for all outbound sends regardless of origin.
- **Jitter is decoupled from typing.** Typing indicator delay is "while composing" behavior. Inter-send jitter is "how long between sends" behavior. Both use randomness but operate at different points in the send pipeline. Do not conflate.

---

## MVP Definition

### Launch With (v1.20 — this milestone)

- [ ] Config hierarchy: `mimicry` block in global/session/contact config with merge engine
- [ ] Time-of-day gate with configurable window (default 7am–1am local), hard block
- [ ] Quiet hours policy: queue (default) or reject
- [ ] Hourly message cap: hard limit per session, default caps by maturity phase
- [ ] Account maturity phase tracker: 3 phases (New/Warming/Stable), derived from `first_send_at`
- [ ] Progressive default caps: New = 15/hr, Warming = 30/hr, Stable = 50/hr (all configurable)
- [ ] Claude Code sends routed through gate + cap (intercept in `handleAction()`)
- [ ] Jittered inter-message delays on all outbound sends

### Add After Validation (v1.x)

- [ ] Typing delay proportional to message length (extend existing typing sim formula)
- [ ] Admin panel: maturity phase dashboard card (phase name, days until upgrade, cap vs limit)
- [ ] Drain rate throttling: 3–8s jittered delay between queue drain sends
- [ ] Per-contact `rateLimitExempt` flag in directory settings UI

### Future Consideration (v2+)

- [ ] Active-hours soft preference queue (hold for next engagement peak window, not just any open hour)
- [ ] Send-time distribution analytics chart (hourly histogram in admin panel)
- [ ] Automatic phase promotion based on read receipt engagement signals
- [ ] Cross-session aggregate cap (if multiple sessions share account context)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Time-of-day gate | HIGH — direct ban risk | LOW — time comparison + config | P1 |
| Hourly message cap | HIGH — burst = #1 ban signal | LOW — counter + config | P1 |
| Progressive caps (maturity phases) | HIGH — new account protection | MEDIUM — phase state derivation | P1 |
| Claude Code mimicry routing | HIGH — currently 100% unprotected | MEDIUM — intercept in handleAction | P1 |
| Config hierarchy: mimicry block | HIGH — foundation for all above | MEDIUM — extend config merge engine | P1 |
| Quiet hours queue policy | MEDIUM — better than dropping messages | LOW — extend existing queue drain | P1 |
| Jittered delays | MEDIUM — masks uniform timing pattern | LOW — Math.random() in delay calc | P2 |
| Typing delay proportional to length | LOW — marginal behavioral signal | LOW — formula change in existing code | P2 |
| Admin panel maturity display | MEDIUM — operational visibility | MEDIUM — new UI component | P2 |
| Drain rate throttling | MEDIUM — prevents burst-on-drain | MEDIUM — inter-send delay in drain cycle | P2 |
| Per-contact rate limit exemption | LOW — edge case for known humans | LOW — flag in directory settings | P3 |

**Priority key:**
- P1: Must have for v1.20 launch
- P2: Add after core is validated
- P3: Nice to have, can slip to v1.21

---

## Behavioral Signals Meta Likely Monitors

Synthesized from warmup tool documentation, WAHA community reports, and platform anti-spam research. Confidence: MEDIUM (no official Meta disclosure).

| Signal | Risk Level | Mitigated By |
|--------|------------|--------------|
| Outbound messages at 2–5am local time | HIGH | Time-of-day gate |
| >50 messages in 1 hour from personal number | HIGH | Hourly cap |
| Perfectly uniform inter-message interval | HIGH | Jitter |
| New account (<7 days) sending to strangers | HIGH | Progressive caps (New phase default = 15/hr) |
| Same message sent to 10+ contacts in <5 minutes | HIGH | Hourly cap + jitter + existing sendMulti 10-cap |
| No typing indicator before reply | MEDIUM | Existing typing sim (inbound), outbound typing (v1.20) |
| 24/7 consistent availability (no sleep pattern) | MEDIUM | Time-of-day gate creates daily quiet window |
| Burst of sends after long silence (e.g., queue drain at gate-open) | MEDIUM | Drain rate throttling |
| API-level presence without normal app lifecycle signals | LOW | Out of scope (WAHA NOWEB limitation, not addressable at plugin layer) |

---

## Sources

- [WhatsApp Automation: How to Stay Unbanned (2025)](https://tisankan.dev/whatsapp-automation-how-do-you-stay-unbanned/) — MEDIUM confidence
- [WhatsApp Warm-Up 2026: Avoid Bans and Build Durable Accounts (WAWarmer)](https://warmer.wadesk.io/blog/whatsapp-account-warm-up) — MEDIUM confidence
- [WAHA GitHub: Got banned on two numbers Issue #1362](https://github.com/devlikeapro/waha/issues/1362) — HIGH confidence (primary NOWEB community source)
- [WAHA GitHub: NOWEB ban when sending to groups Issue #765](https://github.com/devlikeapro/waha/issues/765) — HIGH confidence
- [WhatsApp Warm Up Without Getting Banned (Quackr)](https://quackr.io/blog/warm-up-whatsapp-number/) — MEDIUM confidence
- [Best Time to Send Bulk WhatsApp Messages (A2C.chat)](https://www.a2c.chat/en/whatsapp-bulk-sending-time-5-best-time-slots-tested.html) — MEDIUM confidence
- [Typing Indicators — WhatsApp Cloud API (Meta official)](https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators/) — HIGH confidence
- [How WhatsApp Manages Typing Status (DEV Community)](https://dev.to/trixsec/how-whatsapp-manages-typing-status-efficiently-a-deep-technical-breakdown-1a7m) — MEDIUM confidence

---
*Feature research for: WhatsApp anti-bot mimicry system (v1.20 Human Mimicry Hardening)*
*Researched: 2026-03-26*
