// Run: deno run --allow-net --allow-env scripts/seed.ts
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const headers = {
  'Content-Type':  'application/json',
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Prefer':        'return=minimal',
}

const entries = [
  {
    title: 'Marketing 360 renewal — May 15, 2026 deadline',
    content: 'Marketing 360 contract renewal is due May 15, 2026. There is a 30-day cancellation notice requirement — the cancellation window opens April 15, 2026. Christian Kellogg is the contact at Marketing 360. Currently evaluating Sarah Gordee at Hookd Promotions as a potential replacement. Decision must be made before April 15.',
    category: 'open_thread',
    tags: ['marketing', 'vendor', 'deadline', 'contract'],
    importance: 5,
    source: 'business operations',
  },
  {
    title: 'Marketing 360 contact: Christian Kellogg',
    content: 'Christian Kellogg is the primary contact at Marketing 360. Handles contract renewals and service questions.',
    category: 'contact',
    tags: ['marketing', 'marketing360', 'vendor-contact'],
    importance: 4,
    source: 'business operations',
  },
  {
    title: 'Potential marketing replacement: Sarah Gordee at Hookd Promotions',
    content: 'Sarah Gordee at Hookd Promotions is being evaluated as a potential replacement for Marketing 360. Evaluation in progress ahead of the May 15, 2026 Marketing 360 renewal deadline.',
    category: 'open_thread',
    tags: ['marketing', 'hookd-promotions', 'vendor-eval'],
    importance: 4,
    source: 'business operations',
  },
  {
    title: 'MSA finalization: Nicole Jessick / Schmoldt Law',
    content: 'Master Service Agreement is being finalized with Nicole Jessick at Schmoldt Law. The MSA language must match the insurance coverage language exactly. Insurance through Tyler Sperry at Mower Insurance covers "Safety Consulting Services" only — MSA must reflect this.',
    category: 'open_thread',
    tags: ['legal', 'MSA', 'insurance', 'compliance'],
    importance: 5,
    source: 'legal',
  },
  {
    title: 'Insurance: "Safety Consulting Services" only — Tyler Sperry / Mower',
    content: 'Insurance is through Tyler Sperry at Mower Insurance. Policy covers "Safety Consulting Services" ONLY. Never describe services as "home inspection" or "property management" — these are NOT covered. All contracts, marketing, and communications must use compliant language. Non-negotiable.',
    category: 'decision',
    tags: ['insurance', 'compliance', 'legal', 'risk'],
    importance: 5,
    source: 'insurance policy',
  },
  {
    title: 'Client: Joe Seckora — Premier Management tier',
    content: 'Joe Seckora is the first active client on the Premier Management tier ($299/mo). His home is the live prototype site for the Custos Hub — real sensors, real monitoring. His wife Lisa Seckora also has portal access. Joe\'s account is the primary reference implementation for all future Premier and Estate client onboarding.',
    category: 'client',
    tags: ['client', 'premier', 'custos-hub', 'prototype', 'seckora'],
    importance: 5,
    source: 'client records',
  },
  {
    title: 'Client: Lisa Seckora — portal access',
    content: 'Lisa Seckora is the wife of Joe Seckora. She has household portal access linked to Joe\'s home profile.',
    category: 'client',
    tags: ['client', 'household-member', 'seckora'],
    importance: 3,
    source: 'client records',
  },
  {
    title: 'Vendor: Erick Cordova / Cordova Cleaning LLC',
    content: 'Erick Cordova at Cordova Cleaning LLC is an active vendor partner. Engaged for cleaning services as part of the Rockwell Home Management service delivery network.',
    category: 'vendor',
    tags: ['vendor', 'cleaning', 'cordova'],
    importance: 4,
    source: 'vendor records',
  },
  {
    title: 'Custos Hub trademark — USPTO Serial No. 99666509',
    content: '"Custos Hub" is a registered trademark. USPTO Serial No. 99666509. Protect this brand in all public communications. Do not allow third parties to use this name without authorization.',
    category: 'decision',
    tags: ['trademark', 'custos-hub', 'legal', 'IP'],
    importance: 5,
    source: 'USPTO filing',
  },
  {
    title: 'Custos Hub Phase 1: general language only, no hardware specs',
    content: 'During Phase 1, all public-facing communication about the Custos Hub must use general language only. Do NOT disclose hardware specifications, sensor counts, sensor types, or technical implementation details. These are reserved for Phase 2. Applies to website copy, sales conversations, and marketing materials.',
    category: 'strategy',
    tags: ['custos-hub', 'product', 'marketing', 'phase1'],
    importance: 5,
    source: 'product strategy',
  },
  {
    title: 'Revenue targets — 5-year plan to $5M net',
    content: 'Year 1: $80,000. Year 2: $250,000. Year 3: $600,000. Year 4: $1,500,000. Year 5: $2,570,000+. Cumulative 5-year goal: $5,000,000 net. These targets inform hiring, technology investment, and expansion timing decisions.',
    category: 'strategy',
    tags: ['revenue', 'targets', 'growth', 'financial'],
    importance: 5,
    source: 'business plan',
  },
  {
    title: 'Service tiers and pricing',
    content: 'Three service tiers: Essential Watch at $129/month, Premier Management at $299/month, Estate Concierge at $749/month. Always upsell toward Estate Concierge — best margin and highest client retention. Entry point is the $150 Home Safety & Readiness Audit.',
    category: 'strategy',
    tags: ['pricing', 'tiers', 'essential-watch', 'premier-management', 'estate-concierge'],
    importance: 5,
    source: 'business model',
  },
  {
    title: 'Entry point: $150 Home Safety & Readiness Audit',
    content: 'The $150 Home Safety & Readiness Audit is the primary entry point for all new clients. Always call it the "Home Safety & Readiness Audit" — never a "home inspection." This audit is both a revenue generator and a sales tool that converts into subscription tiers.',
    category: 'strategy',
    tags: ['audit', 'sales', 'entry-point', 'compliance'],
    importance: 5,
    source: 'business model',
  },
  {
    title: 'ADRC referrals: same-day callback, Priority 1',
    content: 'Any referral from an Area Agency on Aging / ADRC (Aging and Disability Resource Center) is Priority 1. Same-day callback required — no exceptions. Missing an ADRC callback window is unacceptable. These referrals represent the highest-value pipeline for the Elder Care market segment.',
    category: 'decision',
    tags: ['ADRC', 'referrals', 'elder-care', 'priority'],
    importance: 5,
    source: 'operations policy',
  },
  {
    title: 'OPEN SECURITY FLAG: exposed API key needs confirmed rotation',
    content: 'A previously exposed API key was found on GitHub and has not been confirmed as rotated. Action required: identify the key, confirm rotation in all affected services, document resolution here. Until closed, assume potential unauthorized access to whatever that key controlled.',
    category: 'open_thread',
    tags: ['security', 'api-key', 'incident', 'urgent'],
    importance: 5,
    source: 'security audit',
  },
  {
    title: 'Playwright QA: 56 tests across 5 files — must stay green',
    content: 'Playwright QA suite: 01-login-page.spec.ts, 02-login-otp-flow.spec.ts, 03-post-login-dashboard.spec.ts, 04-session-expiry.spec.ts, 05-logout-back-button.spec.ts. Must stay green before onboarding any new client. Critical: serviceWorkers: "block" required — prevents SW from intercepting test mocks. Location: rockwell-member-portal/tests/',
    category: 'lesson',
    tags: ['playwright', 'testing', 'QA', 'portal'],
    importance: 5,
    source: 'engineering standards',
  },
  {
    title: 'Railway: no RLS — cross-tenant validation must be in NestJS guards',
    content: 'Railway does not support Supabase Row Level Security in the NestJS API context. All cross-tenant validation must be implemented in NestJS guards — never rely on Supabase RLS for data isolation in the Railway-hosted API.',
    category: 'lesson',
    tags: ['railway', 'RLS', 'nestjs', 'security', 'architecture'],
    importance: 5,
    source: 'architecture decision',
  },
  {
    title: 'Railway: no SMTP — use Resend SDK for email',
    content: 'Railway blocks outbound SMTP. All email sending must use the Resend SDK — not nodemailer or any direct SMTP approach. Hard platform constraint, not a preference.',
    category: 'lesson',
    tags: ['railway', 'email', 'resend', 'SMTP'],
    importance: 4,
    source: 'architecture decision',
  },
  {
    title: 'Compliance language rules',
    content: 'Required substitutions in all communications: "activity awareness" not "monitoring". "Safety consultation" not "inspection". "Older adults" not "elderly". Always call the entry service "Home Safety & Readiness Audit" — never "home inspection". Applies to website copy, contracts, sales calls, and all written or verbal communications.',
    category: 'decision',
    tags: ['compliance', 'language', 'legal', 'brand'],
    importance: 5,
    source: 'legal / brand guidelines',
  },
  {
    title: 'Twin Cities expansion + DTC Custos Hub timeline',
    content: 'Twin Cities regional expansion begins no later than Year 3. DTC Custos Hub Home Edition launches Month 12-18 at $299-$499 hardware kit plus $19.99-$39.99/month subscription. Runs parallel to the managed service business and opens a scalable, lower-touch revenue stream.',
    category: 'strategy',
    tags: ['expansion', 'custos-hub', 'DTC', 'twin-cities', 'timeline'],
    importance: 4,
    source: 'business plan',
  },
]

async function seed() {
  console.log(`Seeding ${entries.length} knowledge entries...`)
  let inserted = 0
  let skipped  = 0

  for (const entry of entries) {
    // Idempotency: skip if title already exists
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_entries?title=eq.${encodeURIComponent(entry.title)}&select=id`,
      { headers }
    )
    const existing: unknown[] = await checkRes.json()
    if (existing.length > 0) {
      console.log(`  SKIP: "${entry.title}"`)
      skipped++
      continue
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
    })

    if (res.status === 201) {
      console.log(`  OK:   "${entry.title}"`)
      inserted++
    } else {
      console.error(`  ERR:  "${entry.title}" — ${res.status}: ${await res.text()}`)
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`)
  console.log('Embedding queue will be processed on next cron run (within 2 minutes).')
}

seed().catch(console.error)
