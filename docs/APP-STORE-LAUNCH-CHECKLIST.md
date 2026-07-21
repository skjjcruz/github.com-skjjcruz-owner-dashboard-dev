# App Store Launch Checklist — Dynasty HQ (plain-English version)

*Written for the owner, not engineers. No jargon — and where a technical word is
unavoidable, it's explained.*

---

## The bottom line

Your app is already built with **Capacitor** — the tool that turns your web app into a
real iPhone/Android app you can submit to the stores. That's the hard part, and it's done.

But there are **3 things that will get you rejected** if you submit today. None of them are
huge, but all three are required. Two I can build for you. One is a decision only you can make.

---

## The 3 former blockers — ALL CLEARED (updated 2026-07-21)

### 1. ✅ Payments — BUILT
Decision landed and shipped: **iOS sells through Apple In-App Purchase via RevenueCat**
(`js/billing.js`, `fw-revenuecat-webhook`); **web sells through Stripe** (`upgrade.html`,
`fw-create-checkout`). Either path grants the same entitlement. Users can cancel:
web → Stripe Billing Portal from Settings (`fw-billing-portal`); iOS → Apple ID
subscription settings (linked from Settings, as Apple requires).

### 2. ✅ "Delete my account" button — DONE AND SURFACED
Apple requires in-app account deletion (guideline 5.1.1(v)). The Settings account panel has
a double-confirm Delete Account control wired to `fw-delete-account`, pinned by a contract
test so it can't silently disappear.

### 3. ✅ Privacy Policy + Terms pages — FINAL AND LIVE
Published at `legal/privacy-policy.html` and `legal/terms-of-service.html`, linked from
Settings. Draft banners removed, placeholders filled (Tennessee governing law), provider
table matches the app (incl. RevenueCat). A professional legal review is still recommended
but no longer blocks submission.

---

## What remains — all owner/admin steps in App Store Connect (no code)

1. **IAP products live in App Store Connect** — the two subscriptions
   (`com.dhqfootball.app.dhq.monthly` / `.annual`) must exist, be priced, and be attached
   to the app version you submit, and the RevenueCat dashboard must point at them.
2. **App Privacy questionnaire** — paste-ready answers in
   `docs/APP-PRIVACY-QUESTIONNAIRE.md`.
3. **Store listing** — name, subtitle, description, keywords, support URL, and the
   **Privacy Policy URL** (use the live `legal/privacy-policy.html` link).
4. **Screenshots** — Apple requires iPhone (6.7" and 6.5") sets; iPad set if the iPad
   box is checked.
5. **Reviewer test account** — a working email+password login with a connected league so
   Apple's reviewer sees a real dashboard (put it in App Review Information → Sign-in
   required).
6. **Build upload** — archive in Xcode on a Mac (Product → Archive → Distribute →
   App Store Connect), then select that build on the version page and Submit for Review.

Apple review usually takes 1–3 days. Rejections, if any, come with a message — bring it
back here and we fix and resubmit.

---

*Note: This is separate from the "scale to 1M users" work in
`COMMERCIAL-READINESS-PLAN.md`. You do NOT need that done to get into the App Store — that's
about handling huge traffic later. App Store approval is about the items above.*
