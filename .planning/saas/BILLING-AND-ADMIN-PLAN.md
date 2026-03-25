# WhatsApp Channel as a Service -- Billing & System Admin Plan

## Architecture Overview

**Current state**: Single-tenant OpenClaw plugin. Raw Node.js HTTP server (no Express). SQLite (better-sqlite3). React admin panel (shadcn/ui + Tailwind + Vite). ~30 API routes under `/api/admin/`.

**Target state**: Multi-tenant SaaS. PostgreSQL for shared data. Per-tenant SQLite for hot path (directory, analytics). Stripe for billing. Two admin panels: System Admin (us) and Tenant Admin (evolved current panel).

---

## 1. Stripe Integration

### 1.1 Product & Price Structure

```
Products (Stripe Dashboard):
  - whatsapp-channel-starter    -> $29/mo, 1 session, 5,000 msgs/mo
  - whatsapp-channel-pro        -> $79/mo, 3 sessions, 25,000 msgs/mo
  - whatsapp-channel-business   -> $199/mo, 10 sessions, 100,000 msgs/mo
  - whatsapp-channel-enterprise -> custom pricing, unlimited sessions

Metered component (usage-based add-on):
  - whatsapp-message-overage    -> $0.005 per message over plan limit
  - whatsapp-media-storage      -> $0.10 per GB over 1 GB included
```

### 1.2 Subscription Lifecycle

```
src/billing/stripe-client.ts     -- Stripe SDK wrapper, API key management
src/billing/subscriptions.ts     -- create, upgrade, downgrade, cancel, pause, resume
src/billing/metering.ts          -- usage record reporting to Stripe
src/billing/webhooks.ts          -- Stripe webhook handler
src/billing/dunning.ts           -- payment failure handling
src/billing/portal.ts            -- customer portal session creation
```

#### Key Flows

**Create subscription:**
```
POST /api/billing/checkout
  -> Creates Stripe Checkout Session (mode: subscription)
  -> checkout.session.completed webhook -> provision tenant
  -> Redirect to /onboarding/whatsapp-setup
```

**Upgrade/Downgrade:**
```
POST /api/billing/change-plan { planId: string, immediate?: boolean }
  -> stripe.subscriptions.update(subId, { items: [{ price: newPriceId }] })
  -> For upgrades: proration_behavior = 'create_prorations'
  -> For downgrades: proration_behavior = 'none', apply at period end
  -> customer.subscription.updated webhook -> update tenant plan in DB
```

**Cancel:**
```
POST /api/billing/cancel { immediate?: boolean, reason?: string }
  -> stripe.subscriptions.update(subId, { cancel_at_period_end: true })
  -> Or stripe.subscriptions.cancel(subId) for immediate
  -> Store cancellation reason in tenant_events
```

**Pause/Resume:**
```
POST /api/billing/pause
  -> stripe.subscriptions.update(subId, { pause_collection: { behavior: 'void' } })
  -> Disable WAHA sessions but preserve config

POST /api/billing/resume
  -> stripe.subscriptions.update(subId, { pause_collection: '' })
  -> Re-enable WAHA sessions
```

### 1.3 Usage-Based Billing (Message Metering)

```typescript
// src/billing/metering.ts

// Called from inbound.ts on every processed message
export function recordMessageUsage(tenantId: string): void {
  // 1. Increment local counter (in-memory, flushed every 60s)
  // 2. Check against plan limit -> emit warning SSE at 80%, 90%, 100%
  // 3. At 100%: check tenant config for overage policy
  //    - "block" -> reject messages, send WhatsApp auto-reply "quota exceeded"
  //    - "charge" -> allow + report usage to Stripe
}

// Flushed to Stripe every 60 seconds via interval
async function flushUsageToStripe(): Promise<void> {
  for (const [tenantId, count] of pendingUsage.entries()) {
    await stripe.subscriptionItems.createUsageRecord(
      tenant.stripeSubscriptionItemId,
      { quantity: count, timestamp: 'now', action: 'increment' }
    );
    pendingUsage.delete(tenantId);
  }
}

// Schema for local metering (fast path, SQLite per tenant)
// Table: usage_events
//   id INTEGER PRIMARY KEY
//   timestamp INTEGER NOT NULL
//   direction TEXT CHECK(direction IN ('inbound', 'outbound'))
//   billable INTEGER DEFAULT 1
//   reported_to_stripe INTEGER DEFAULT 0
```

### 1.4 Stripe Webhook Handler

```typescript
// src/billing/webhooks.ts
// Mounted at POST /webhooks/stripe (separate from /api/admin/ namespace)

const HANDLED_EVENTS = [
  'checkout.session.completed',       // -> provision tenant
  'customer.subscription.created',    // -> activate subscription record
  'customer.subscription.updated',    // -> plan change, pause, resume
  'customer.subscription.deleted',    // -> deprovision (grace period)
  'customer.subscription.paused',     // -> pause WAHA sessions
  'customer.subscription.resumed',    // -> resume WAHA sessions
  'invoice.paid',                     // -> record payment, reset usage counters
  'invoice.payment_failed',          // -> dunning flow
  'invoice.finalized',               // -> store invoice PDF URL
  'customer.updated',                // -> sync billing email/name
  'payment_method.attached',         // -> update default payment method
  'charge.refunded',                 // -> record refund
] as const;

// Verification: stripe.webhooks.constructEvent(body, sig, endpointSecret)
// Idempotency: store event.id in processed_stripe_events table, skip duplicates
```

### 1.5 Payment Failure & Dunning

```
invoice.payment_failed webhook:
  attempt 1: Send email + WhatsApp notification "payment failed, update card"
  attempt 2 (3 days later): Send warning "service will be suspended in 4 days"
  attempt 3 (7 days later): Suspend tenant (pause WAHA sessions, read-only admin)
  attempt 4 (14 days later): Mark for deletion (30 day grace before data purge)

State machine: active -> past_due -> suspended -> pending_deletion -> deleted
```

### 1.6 Trial Period

```
Trial config:
  - Duration: 14 days
  - No credit card required for trial start
  - Limited to 1 session, 500 messages
  - Trial end: prompt for payment or auto-suspend
  - Stripe: subscription_data.trial_period_days = 14 in Checkout Session
```

### 1.7 Decision: Stripe Checkout vs Embedded

**Recommendation: Stripe Checkout (hosted page)**

Rationale:
- No PCI scope for us
- Stripe handles all payment UI, 3D Secure, Apple Pay, Google Pay
- Customer portal for subscription management (invoices, payment method, cancel)
- We only need: (a) create checkout session, (b) create portal session, (c) handle webhooks
- Embedded billing adds significant frontend complexity with no real benefit at our scale

```typescript
// Checkout session creation
POST /api/billing/checkout -> redirect to Stripe Checkout URL
POST /api/billing/portal   -> redirect to Stripe Customer Portal URL
```

---

## 2. System Admin Panel (SaaS Operator)

### 2.1 Separate App

The system admin panel is a **separate React app** at `/system-admin/`. It does NOT share the tenant admin codebase -- different data model, different concerns. Same tech stack (shadcn/ui + Tailwind + Vite) for consistency.

```
src/system-admin/          -- separate Vite entrypoint
  src/
    App.tsx
    components/
      tabs/
        TenantsTab.tsx
        BillingTab.tsx
        InfrastructureTab.tsx
        SupportTab.tsx
        FeatureFlagsTab.tsx
```

### 2.2 API Routes (under /api/system/)

All system admin routes require a separate auth layer (not tenant auth). Initially: static bearer token from env var. Later: proper admin SSO.

```
Authentication:
  Header: Authorization: Bearer <SYSTEM_ADMIN_TOKEN>
  Middleware: validateSystemAdminAuth()

Tenants:
  GET    /api/system/tenants                  -- list (paginated, search, filter by status/plan)
  GET    /api/system/tenants/:id              -- detail view
  POST   /api/system/tenants/:id/suspend      -- suspend tenant
  POST   /api/system/tenants/:id/unsuspend    -- unsuspend
  DELETE /api/system/tenants/:id              -- mark for deletion (soft delete)
  POST   /api/system/tenants/:id/impersonate  -- generate short-lived token for tenant admin

Billing:
  GET    /api/system/billing/overview         -- MRR, ARR, churn rate, plan distribution
  GET    /api/system/billing/revenue          -- revenue timeseries (daily/weekly/monthly)
  GET    /api/system/billing/invoices         -- all invoices across tenants
  POST   /api/system/billing/credit           -- issue credit to tenant account

Infrastructure:
  GET    /api/system/infrastructure/waha      -- all WAHA instances, health, session counts
  GET    /api/system/infrastructure/sessions  -- all WhatsApp sessions across tenants
  POST   /api/system/infrastructure/waha/:id/restart  -- restart a WAHA instance

Usage:
  GET    /api/system/usage/tenants            -- per-tenant usage summary (msgs, media, API calls)
  GET    /api/system/usage/aggregate          -- platform-wide usage timeseries

Feature Flags:
  GET    /api/system/flags                    -- all feature flags
  PUT    /api/system/flags/:flag              -- set flag globally or per-tenant
  GET    /api/system/tenants/:id/flags        -- flags for specific tenant
  PUT    /api/system/tenants/:id/flags/:flag  -- override flag for tenant
```

### 2.3 UI Tab Descriptions

**Tenants Tab:**
- DataTable with columns: Name, Plan, Status, Sessions, Messages (30d), MRR, Created
- Search by name/email/domain
- Filter by: status (active/trial/suspended/past_due), plan
- Row click -> tenant detail sheet (sidebar)
- Tenant detail: subscription info, usage charts, sessions list, recent events, action buttons (suspend/unsuspend/impersonate)
- Impersonate button opens tenant admin in new tab with short-lived admin token

**Billing Tab:**
- KPI cards at top: MRR, ARR, Active subscriptions, Churn rate (30d), Trial conversion rate
- Revenue chart (recharts area chart, same library as current analytics tab)
- Plan distribution pie chart
- Recent invoices table
- Failed payments requiring attention (sorted by severity)

**Infrastructure Tab:**
- WAHA instance cards: host, version, session count, CPU/memory, health status
- WhatsApp sessions table: session ID, tenant, phone number, status, last activity
- Alert banner for any unhealthy sessions
- Restart button per WAHA instance

**Feature Flags Tab:**
- Toggle switches for each flag
- Per-flag: global default + per-tenant overrides table
- Flags: `modules_enabled`, `analytics_enabled`, `advanced_filters`, `api_access`, `media_storage_gb`, `max_sessions`, `beta_features`

---

## 3. Tenant Onboarding Flow

### 3.1 Flow Steps

```
1. Sign Up
   POST /api/auth/register { email, password, orgName }
   -> Create tenant record (status: 'onboarding')
   -> Create Stripe customer
   -> Send verification email
   -> Redirect to /onboarding/verify-email

2. Email Verification
   GET /api/auth/verify?token=<token>
   -> Mark email verified
   -> Redirect to /onboarding/plan

3. Plan Selection
   Page: /onboarding/plan
   -> Display plan cards (Starter, Pro, Business, Enterprise)
   -> "Start free trial" or "Subscribe now"
   -> POST /api/billing/checkout { planId, trial: true/false }
   -> Stripe Checkout redirect -> success_url = /onboarding/whatsapp

4. WhatsApp Setup
   Page: /onboarding/whatsapp
   -> Provision WAHA session for tenant
   -> Display QR code (polled from WAHA /api/sessions/:id/qr)
   -> Poll /api/onboarding/session-status every 3s
   -> On "CONNECTED": show green checkmark, enable "Next"

5. Webhook & API Key Configuration
   Page: /onboarding/integration
   -> Generate API key (displayed once, copy to clipboard)
   -> Show webhook URL to configure in their system
   -> Optional: test webhook button (sends test event)
   -> cURL examples / SDK snippet for common languages

6. Health Check / First Message
   Page: /onboarding/verify
   -> "Send a test message to your WhatsApp"
   -> Input: phone number to send test to
   -> POST /api/onboarding/test-message { phone }
   -> Wait for delivery confirmation
   -> On success: "You're all set!" -> redirect to /admin (tenant admin)
   -> Confetti animation (optional, tasteful)

7. Post-Onboarding
   -> Tenant status: 'onboarding' -> 'active'
   -> Start usage metering
   -> Enable webhook processing
```

### 3.2 Onboarding API Routes

```
POST /api/auth/register            -- create account
GET  /api/auth/verify?token=       -- verify email
POST /api/onboarding/session       -- provision WAHA session + get QR code
GET  /api/onboarding/session-status -- poll WhatsApp connection status
POST /api/onboarding/api-key       -- generate API key
POST /api/onboarding/test-message  -- send test WhatsApp message
POST /api/onboarding/complete      -- finalize onboarding, set tenant active
```

### 3.3 QR Code Scanning Flow

```typescript
// Leverages existing WAHA session management

async function provisionTenantSession(tenantId: string): Promise<{ qrUrl: string }> {
  const sessionName = `tenant_${tenantId}_default`;

  // 1. Create WAHA session
  await wahaApi.post('/api/sessions', {
    name: sessionName,
    config: {
      webhooks: [{
        url: `${BASE_URL}/webhooks/waha/${tenantId}`,
        events: ['message', 'message.reaction', 'session.status']
      }]
    }
  });

  // 2. Start session -> triggers QR generation
  await wahaApi.post(`/api/sessions/${sessionName}/start`);

  // 3. Return QR code URL
  return { qrUrl: `${WAHA_BASE}/api/sessions/${sessionName}/qr` };
}
```

### 3.4 Onboarding UI (React pages)

```
src/onboarding/
  pages/
    RegisterPage.tsx       -- email + password + org name form
    VerifyEmailPage.tsx    -- "check your inbox" + resend button
    PlanSelectionPage.tsx  -- plan cards with feature comparison table
    WhatsAppSetupPage.tsx  -- QR code display with polling spinner
    IntegrationPage.tsx    -- API key reveal + webhook URL + code snippets
    VerifyPage.tsx         -- test message sender + success state
  components/
    OnboardingProgress.tsx -- step indicator (1-6)
    PlanCard.tsx           -- plan display card
    QrCodeDisplay.tsx      -- QR image with auto-refresh
    CodeSnippet.tsx        -- syntax highlighted code block
```

---

## 4. Tenant Admin Panel (Evolution of Current Panel)

### 4.1 What Stays (Current tabs, unchanged)

| Tab | Changes |
|-----|---------|
| Dashboard | Stays. Add usage quota bar (messages used / limit) |
| Directory | Stays as-is. Per-tenant SQLite |
| Settings | Stays. Remove WAHA connection config (managed by platform) |
| Sessions | Stays. Scoped to tenant's sessions only |
| Modules | Stays as-is |
| Log | Stays as-is |
| Queue | Stays as-is |
| Analytics | Stays. Add "included in plan" overlay on quota |

### 4.2 New Tabs

**Billing Tab** (`BillingTab.tsx`):
```
Layout:
  [Current Plan Card]
    Plan name, price, renewal date
    "Change Plan" button -> opens plan comparison modal
    "Cancel Subscription" button (with confirmation)

  [Usage This Period]
    Progress bar: 12,450 / 25,000 messages (49.8%)
    "Resets on April 1, 2026"
    Warning states: yellow at 80%, red at 95%, "overage charges apply" at 100%

  [Payment Method]
    Card ending in ****4242, expires 03/28
    "Update" button -> Stripe Customer Portal

  [Invoices]
    DataTable: Date, Amount, Status, PDF link
    Pulls from Stripe API (cached 5 min)

API routes:
  GET  /api/tenant/billing/summary     -- plan, usage, next invoice
  GET  /api/tenant/billing/invoices    -- invoice list from Stripe
  POST /api/tenant/billing/portal      -- Stripe customer portal redirect
  POST /api/tenant/billing/change-plan -- plan change
  POST /api/tenant/billing/cancel      -- cancel subscription
```

**API Keys Tab** (`ApiKeysTab.tsx`):
```
Layout:
  [Create API Key] button
    -> Modal: name, expiry (optional), permissions checkboxes
    -> On create: show key ONCE with copy button

  [Active Keys Table]
    Columns: Name, Key (masked ****abcd), Created, Last Used, Permissions, Actions
    Actions: Revoke (with confirmation)

  [Webhook Configuration]
    URL input field
    Events checkboxes (message.received, message.sent, session.status, etc.)
    Secret key (auto-generated, copyable)
    "Test Webhook" button
    Recent deliveries log (last 20, with status codes)

API routes:
  GET    /api/tenant/api-keys           -- list keys
  POST   /api/tenant/api-keys           -- create key
  DELETE /api/tenant/api-keys/:id       -- revoke key
  GET    /api/tenant/webhooks           -- webhook config
  PUT    /api/tenant/webhooks           -- update webhook config
  POST   /api/tenant/webhooks/test      -- send test event
  GET    /api/tenant/webhooks/deliveries -- recent delivery log
```

**Team Tab** (`TeamTab.tsx`):
```
Layout:
  [Invite Member] button
    -> Modal: email, role (admin / viewer)

  [Members Table]
    Columns: Name, Email, Role, Last Active, Actions
    Actions: Change role, Remove (with confirmation)
    Owner cannot be removed

Roles (RBAC):
  - owner:  full access, billing, team management
  - admin:  all tabs except billing and team management
  - viewer: read-only access to all tabs

API routes:
  GET    /api/tenant/team               -- list members
  POST   /api/tenant/team/invite        -- send invite
  PUT    /api/tenant/team/:userId/role   -- change role
  DELETE /api/tenant/team/:userId        -- remove member
```

### 4.3 Auth Changes

Current admin panel has no auth (single-tenant, accessed via local network). Multi-tenant requires:

```
Authentication:
  - JWT-based (access token: 15min, refresh token: 7d)
  - Login page: /login (email + password)
  - Magic link option (send login link to email)
  - Session stored in httpOnly cookie (not localStorage)

Authorization middleware:
  - Extract tenant_id from JWT claims
  - All /api/tenant/* routes scoped to authenticated tenant
  - Role check middleware for RBAC

Routes:
  POST /api/auth/login         -- email + password -> JWT
  POST /api/auth/magic-link    -- send magic link email
  GET  /api/auth/magic-link/verify?token=  -- verify magic link
  POST /api/auth/refresh       -- refresh token rotation
  POST /api/auth/logout        -- invalidate refresh token
```

---

## 5. Database Schema

### 5.1 Migration Strategy: SQLite -> PostgreSQL

**Hybrid approach:**
- **PostgreSQL**: All shared/cross-tenant data (tenants, billing, auth, API keys, audit log, feature flags)
- **Per-tenant SQLite**: Hot-path data that benefits from single-writer (directory, analytics, queue state)

Rationale: The existing SQLite code for directory and analytics is battle-tested and fast. Moving it to PostgreSQL adds latency and connection pooling complexity with no benefit -- each tenant's data is fully isolated. PostgreSQL is needed for cross-tenant queries (billing reports, system admin).

```
PostgreSQL (shared):
  tenants, subscriptions, invoices, usage_daily,
  api_keys, webhook_configs, team_members,
  audit_log, feature_flags, stripe_events

Per-tenant SQLite (existing pattern):
  ~/.saas/tenants/{tenant_id}/directory.db    -- contacts, groups, dm_settings
  ~/.saas/tenants/{tenant_id}/analytics.db    -- message_events
  ~/.saas/tenants/{tenant_id}/config.json     -- tenant WAHA config
```

### 5.2 PostgreSQL Schema

```sql
-- =============================================
-- TENANTS
-- =============================================

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                    -- organization name
  slug            TEXT UNIQUE NOT NULL,             -- URL-safe identifier
  status          TEXT NOT NULL DEFAULT 'onboarding'
                  CHECK (status IN ('onboarding', 'trial', 'active', 'past_due',
                                    'suspended', 'pending_deletion', 'deleted')),
  plan_id         TEXT NOT NULL DEFAULT 'starter',  -- references product catalog
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  trial_ends_at   TIMESTAMPTZ,
  onboarding_step TEXT DEFAULT 'register',          -- tracks onboarding progress
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ                       -- soft delete
);

CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_stripe_customer ON tenants(stripe_customer_id);

-- =============================================
-- USERS & AUTH
-- =============================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,                             -- null for magic-link only users
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE TABLE tenant_members (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  role            TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('owner', 'admin', 'viewer')),
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE auth_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL,                    -- SHA-256 of refresh token
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_hash ON auth_tokens(token_hash);

CREATE TABLE magic_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  email           TEXT NOT NULL,
  token_hash      TEXT NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('login', 'verify_email', 'invite')),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- BILLING & SUBSCRIPTIONS
-- =============================================

CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  stripe_subscription_id  TEXT UNIQUE NOT NULL,
  stripe_price_id         TEXT NOT NULL,
  status                  TEXT NOT NULL,             -- mirrors Stripe status
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at             TIMESTAMPTZ,
  cancellation_reason     TEXT,
  trial_start             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);

CREATE TABLE invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  stripe_invoice_id   TEXT UNIQUE NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'usd',
  status              TEXT NOT NULL,                  -- paid, open, void, uncollectible
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  pdf_url             TEXT,
  hosted_url          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);

-- Daily usage rollup (aggregated from per-tenant SQLite analytics)
CREATE TABLE usage_daily (
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  date                DATE NOT NULL,
  messages_inbound    INTEGER NOT NULL DEFAULT 0,
  messages_outbound   INTEGER NOT NULL DEFAULT 0,
  messages_total      INTEGER NOT NULL DEFAULT 0,
  media_bytes         BIGINT NOT NULL DEFAULT 0,
  api_calls           INTEGER NOT NULL DEFAULT 0,
  errors              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, date)
);

-- Plan limits (product catalog)
CREATE TABLE plan_limits (
  plan_id             TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  price_cents         INTEGER NOT NULL,
  max_sessions        INTEGER NOT NULL,
  max_messages_month  INTEGER NOT NULL,              -- 0 = unlimited
  max_media_gb        INTEGER NOT NULL DEFAULT 1,
  max_team_members    INTEGER NOT NULL DEFAULT 5,
  stripe_price_id     TEXT NOT NULL,
  features            JSONB NOT NULL DEFAULT '{}',   -- feature flags included
  sort_order          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plan_limits VALUES
  ('starter',    'Starter',    2900,  1,   5000,   1,  2, 'price_starter_monthly',    '{"modules": false, "analytics": true, "api_access": false}', 1),
  ('pro',        'Pro',        7900,  3,  25000,   5,  5, 'price_pro_monthly',        '{"modules": true,  "analytics": true, "api_access": true}',  2),
  ('business',   'Business',  19900, 10, 100000,  25, 20, 'price_business_monthly',   '{"modules": true,  "analytics": true, "api_access": true}',  3),
  ('enterprise', 'Enterprise',    0, -1,      0, 100, -1, 'price_enterprise_custom',  '{"modules": true,  "analytics": true, "api_access": true}',  4);

-- =============================================
-- API KEYS & WEBHOOKS
-- =============================================

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL,                     -- SHA-256 of the actual key
  key_prefix      TEXT NOT NULL,                     -- first 8 chars for display (e.g., "wk_live_abcd")
  permissions     JSONB NOT NULL DEFAULT '["read", "write"]',
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE webhook_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  url             TEXT NOT NULL,
  secret          TEXT NOT NULL,                     -- HMAC signing secret
  events          JSONB NOT NULL DEFAULT '["message.received"]',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES webhook_configs(id),
  event_type      TEXT NOT NULL,
  payload_summary TEXT,                              -- truncated for storage
  status_code     INTEGER,
  response_body   TEXT,
  duration_ms     INTEGER,
  success         BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

-- =============================================
-- WAHA INSTANCES & SESSIONS
-- =============================================

CREATE TABLE waha_instances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host            TEXT NOT NULL,                     -- e.g., "waha-01.internal:3004"
  api_key         TEXT NOT NULL,
  max_sessions    INTEGER NOT NULL DEFAULT 50,
  region          TEXT DEFAULT 'us-east-1',
  status          TEXT NOT NULL DEFAULT 'healthy'
                  CHECK (status IN ('healthy', 'degraded', 'down', 'draining')),
  last_health_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  waha_instance_id UUID NOT NULL REFERENCES waha_instances(id),
  session_name    TEXT NOT NULL UNIQUE,              -- e.g., "tenant_abc123_default"
  phone_number    TEXT,                              -- populated after QR scan
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'scanning', 'connected', 'disconnected', 'failed')),
  role            TEXT NOT NULL DEFAULT 'bot',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ
);

CREATE INDEX idx_tenant_sessions_tenant ON tenant_sessions(tenant_id);
CREATE INDEX idx_tenant_sessions_instance ON tenant_sessions(waha_instance_id);

-- =============================================
-- FEATURE FLAGS
-- =============================================

CREATE TABLE feature_flags (
  flag            TEXT PRIMARY KEY,
  default_value   BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT
);

CREATE TABLE tenant_feature_flags (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  flag            TEXT NOT NULL REFERENCES feature_flags(flag),
  value           BOOLEAN NOT NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_by          TEXT,                              -- "system" or admin user email
  PRIMARY KEY (tenant_id, flag)
);

-- =============================================
-- AUDIT LOG
-- =============================================

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),       -- null for system-level events
  user_id         UUID REFERENCES users(id),          -- null for system/webhook events
  action          TEXT NOT NULL,                       -- e.g., "subscription.created", "session.connected"
  resource_type   TEXT,                               -- e.g., "tenant", "session", "api_key"
  resource_id     TEXT,
  details         JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at DESC);

-- =============================================
-- STRIPE EVENT DEDUP
-- =============================================

CREATE TABLE processed_stripe_events (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.3 Tenant Isolation Strategy

```
Request flow:

  1. Request arrives -> extract tenant_id from JWT or API key
  2. PostgreSQL: check tenant status, plan limits, feature flags
  3. Per-tenant SQLite: directory.db, analytics.db (path derived from tenant_id)
  4. WAHA API: scoped to tenant's session(s) only

Data isolation:
  - PostgreSQL: all queries include WHERE tenant_id = $1
  - SQLite: separate file per tenant (physical isolation)
  - WAHA: session names prefixed with tenant_id
  - File storage: separate directory per tenant

Connection to existing code:
  - DirectoryDb constructor already takes dbPath -> just change path to include tenant_id
  - AnalyticsDb same pattern
  - getDirectoryDb() / getAnalyticsDb() singletons -> replace with per-tenant cache (LRU, max 50)
```

### 5.4 Migration Path from Current Single-Tenant

```
Phase 1: Add PostgreSQL alongside SQLite (dual-write)
  - Install pg driver
  - Create tenant table, insert "self" as first tenant
  - Wrap existing /api/admin/ routes with tenant middleware (no-op for single tenant)

Phase 2: Auth layer
  - Add login page + JWT middleware
  - Existing admin panel works behind auth
  - System admin panel as separate app

Phase 3: Multi-tenant routing
  - Tenant-scoped WAHA webhook path: /webhooks/waha/:tenantId
  - Per-tenant SQLite directories
  - Onboarding flow

Phase 4: Billing
  - Stripe integration
  - Plan enforcement
  - Usage metering
```

---

## 6. File Structure (New Files)

```
src/
  billing/
    stripe-client.ts        -- Stripe SDK init, helpers
    subscriptions.ts        -- CRUD subscription operations
    metering.ts             -- usage counting and Stripe reporting
    webhooks.ts             -- POST /webhooks/stripe handler
    dunning.ts              -- payment failure state machine
    portal.ts               -- customer portal session
    plans.ts                -- plan catalog and limit checking
  auth/
    middleware.ts           -- JWT extraction, tenant scoping
    login.ts                -- login/register/magic-link handlers
    passwords.ts            -- bcrypt hash/verify
    tokens.ts               -- JWT sign/verify, refresh rotation
  multi-tenant/
    tenant-manager.ts       -- provision, suspend, delete tenants
    tenant-context.ts       -- per-request tenant context (AsyncLocalStorage)
    session-provisioner.ts  -- WAHA session lifecycle for tenants
    usage-aggregator.ts     -- daily SQLite -> PostgreSQL rollup
  onboarding/
    flow.ts                 -- onboarding step orchestration
    routes.ts               -- /api/onboarding/* handlers
  system-admin/
    routes.ts               -- /api/system/* handlers
  db/
    postgres.ts             -- pg pool, query helpers
    migrations/             -- numbered SQL migration files
      001-tenants.sql
      002-auth.sql
      003-billing.sql
      004-api-keys.sql
      005-infrastructure.sql
      006-feature-flags.sql
      007-audit-log.sql

src/admin/src/              -- existing tenant admin (add new tabs)
  components/tabs/
    BillingTab.tsx           -- NEW: plan, usage, invoices
    ApiKeysTab.tsx           -- NEW: key management, webhooks
    TeamTab.tsx              -- NEW: members, roles
  pages/
    LoginPage.tsx            -- NEW: auth
    OnboardingLayout.tsx     -- NEW: onboarding wrapper

src/system-admin/           -- NEW: separate Vite app
  src/
    App.tsx
    components/tabs/
      TenantsTab.tsx
      BillingTab.tsx
      InfrastructureTab.tsx
      FeatureFlagsTab.tsx
```

---

## 7. Key Dependencies to Add

```json
{
  "stripe": "^17.x",           // Stripe Node SDK
  "pg": "^8.x",               // PostgreSQL client
  "bcryptjs": "^3.x",         // password hashing (pure JS, no native deps)
  "jose": "^6.x",             // JWT sign/verify (ESM native, no jsonwebtoken)
  "nodemailer": "^7.x",       // email sending (verify, magic links, dunning)
  "@paralleldrive/cuid2": "^2.x"  // collision-resistant IDs for API keys
}
```

---

## 8. Environment Variables (New)

```env
# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/whatsapp_saas

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...   # frontend only

# Auth
JWT_SECRET=<random 64 char hex>
JWT_ISSUER=whatsapp-saas

# System Admin
SYSTEM_ADMIN_TOKEN=<random bearer token>

# Email (nodemailer)
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_...
EMAIL_FROM=noreply@yourdomain.com

# App
BASE_URL=https://app.yourdomain.com
```
