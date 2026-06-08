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

## The 3 things blocking you right now

### 1. 🔴 Payments — the big one (a decision only you can make)
Right now the app sells subscriptions (Scout / War Room / Pro) using **Stripe**. On the
**web and on Android, that's fine.** But **Apple does not allow Stripe** for digital
subscriptions inside an iPhone app. Apple requires you to use **their own payment system
("In-App Purchase")** — and **Apple takes a 15–30% cut** (vs. Stripe's ~3%).

**DECIDED:** Sell through the **App Store using Apple In-App Purchase (StoreKit)**, Apple
only. No third-party billing layer (RevenueCat), not worrying about cross-platform sync for
now.

**⏸ BLOCKED ON PRODUCTS:** The actual purchase wiring can't be built until we decide **what
products we're selling and at what price** — In-App Purchase is literally "buy *product X* →
unlock *feature Y* at *price Z*." Products/pricing are intentionally on hold (TBD), so the
IAP build waits for that decision. Everything below that doesn't touch products is unblocked.

### 2. ✅ "Delete my account" button — DONE
Apple requires any app with account creation to let users delete their account in-app. Built
and shipped: a Delete Account button in Settings + the `fw-delete-account` back-end.

### 3. ✅ Privacy Policy + Terms pages — DRAFTED
Apple requires a public Privacy Policy link and Terms. Both drafted in `legal/` (fill in
company details + a quick legal review before publishing).

---

## What I'm building for you right now (in this change)

- ✅ **Draft Privacy Policy page** (`legal/privacy-policy.html`) — written around the data
  your app actually uses (email, Sleeper username, league data, AI chat, payments).
- ✅ **Draft Terms of Service page** (`legal/terms-of-service.html`).
- ⚠️ Both are **solid drafts, not final** — a lawyer (or a service like Termly/iubenda)
  should review them, and you'll fill in your company name, contact email, and state. They
  give you real, hostable pages so this stops being a blocker.

## What I can build next (just say go)

- **Delete-account flow** (blocker #2) — a button in settings + the back-end to honor it.
- **Apple In-App Purchase** (blocker #1) — once you pick option A/B/C above.
- **The actual iPhone/Android app build** — packaging, app icons, splash screen, and the
  files Apple/Google need. (Note: the final iPhone build must be done on a Mac with Xcode —
  I can prepare everything up to that point.)

---

## What only YOU can do (no code — admin/business steps)

1. **Apple Developer account** — $99/year at developer.apple.com. Required to submit.
   (Google Play is a one-time $25.)
2. **Decide the payments approach** (option A / B / C above).
3. **Company + legal info** for the privacy policy/terms: legal name, contact email, and
   your state/country.
4. **App Store listing content:** app name, description, keywords, support URL, and
   **screenshots** (taken on real devices — Apple requires several sizes).
5. **A test login for Apple's reviewers** — they need a working account to review the app.
6. **App privacy questionnaire** — Apple's "nutrition label" form asking what data you
   collect. (I'll give you the exact answers to paste in, based on your code.)

---

## The simple order to do this in

```
1. You: buy Apple Developer account ($99/yr) + decide payments (A/B/C)
2. Me:  build delete-account + finalize privacy/terms pages
3. Me:  build the chosen payments path (if A)
4. Me:  prepare the iPhone/Android app package (icons, splash, config)
5. You: lawyer-review the legal pages; write the store listing + screenshots
6. Both: submit to Apple + Google, answer review questions, ship 🚀
```

Realistic time to a submittable app once you've got the Apple account and made the payments
decision: **roughly 2–4 weeks of build work**, plus Apple's review (usually 1–3 days).

---

*Note: This is separate from the "scale to 1M users" work in
`COMMERCIAL-READINESS-PLAN.md`. You do NOT need that done to get into the App Store — that's
about handling huge traffic later. App Store approval is about the items above.*
