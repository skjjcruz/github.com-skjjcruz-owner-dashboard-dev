/**
 * _shared/entitlements.ts — single source of truth for "what does this
 * account own" at token-mint time.
 *
 * History lesson: fw-profile learned to count `trialing` subscriptions and
 * the `dhq` product line, but fw-signin / fw-oauth-sync kept their own
 * copies of the query and never did — so a paying user in a Stripe trial
 * signed in as free. Every function that mints or refreshes an app session
 * must resolve entitlements through here, never with an inline query.
 */

import { SignJWT } from 'npm:jose';

// A subscription grants access while active OR in its paid-checkout trial.
// (Stripe free-trial subs carry status 'trialing' until first invoice.)
export const ENTITLED_STATUSES = ['active', 'trialing'];

// 'dhq' (the live Pro line) and legacy 'bundle' both mean full access to
// both apps. Mirrors fw-profile / ai-analyze.
export function expandProductSlugs(slugs: string[]): string[] {
  return [...new Set(
    slugs
      .filter(Boolean)
      .flatMap((slug) => (slug === 'bundle' || slug === 'dhq') ? ['war_room', 'dynast_hq'] : [slug]),
  )];
}

export async function resolveEntitlements(
  admin: any,
  userId: string,
): Promise<{ tier: 'pro' | 'free'; products: string[] }> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('product_slug, tier, status')
    .eq('user_id', userId)
    .in('status', ENTITLED_STATUSES);
  if (error) {
    throw new Error(`Subscriptions query failed: ${error.message} (${error.code})`);
  }
  const subs = data ?? [];
  const tier = subs.some((s: any) => s.tier === 'pro') ? 'pro' : 'free';
  const products = expandProductSlugs(subs.map((s: any) => String(s.product_slug || '')));
  return { tier, products };
}

// One JWT mint for every session issuer (fw-signup / fw-signin /
// fw-oauth-sync / fw-refresh-session) so claims can never drift apart.
export async function mintAppSessionJWT(args: {
  userId: string;
  email: string;
  tier: string;
  products: string[];
  sessionVersion: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET')!);
  return new SignJWT({
    role: 'authenticated',
    app_metadata: {
      user_id: args.userId,
      email: args.email,
      tier: args.tier,
      products: args.products,
      session_version: args.sessionVersion,
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(Deno.env.get('SUPABASE_URL')! + '/auth/v1')
    .setSubject(args.userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}
