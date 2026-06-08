# App Store Connect — "App Privacy" Questionnaire Answers

Apple makes you declare what data your app collects, in **App Store Connect → your app →
App Privacy → Edit**. It's a clicking exercise, not code. Below are the answers based on what
your code actually does today. For each data type Apple asks four things:

1. **Collected?** — do you (or a tool you use) gather it.
2. **Linked to the user?** — can it be tied to their identity/account. (Most of yours: yes,
   because it's tied to their account.)
3. **Used to track them?** — i.e. shared for cross-app advertising / with data brokers.
   **For your app this is NO for everything** — you have no ad or cross-app tracking SDKs.
4. **Purpose** — why you collect it.

---

## ✅ Data to declare as COLLECTED

| Apple data type | Where to find it | Linked to identity? | Tracking? | Purpose to select |
|---|---|---|---|---|
| **Contact Info → Name** | Display name (`app_users.display_name`) | Yes | No | App Functionality |
| **Contact Info → Email Address** | Sign-up / login (`fw-signup`) | Yes | No | App Functionality |
| **Identifiers → User ID** | Account id + Sleeper/linked usernames | Yes | No | App Functionality |
| **User Content → Other User Content** | AI chat messages, league docs/notes, strategy, imported roster/league data | Yes | No | App Functionality |
| **Purchases → Purchase History** | Subscription tier/status (`subscriptions`) | Yes | No | App Functionality |
| **Usage Data → Product Interaction** | Feature-usage events (`analytics_events`) | Yes | No | Analytics, App Functionality |
| **Diagnostics → Crash Data** | Sentry error reports | Yes* | No | App Functionality |
| **Diagnostics → Performance Data** | Sentry performance monitoring | Yes* | No | App Functionality |

\* Sentry *can* attach the signed-in user to a report. If you configure Sentry **not** to
send user identity, you may mark Crash/Performance Data as **Not Linked**. Default-safe
answer is "Linked."

---

## 🚫 Data to declare as NOT collected

Mark these "No" (none of them are present in your code):

- **Health & Fitness** — none
- **Financial Info** — none. *(Card details are handled by Apple In-App Purchase / Stripe and
  are never stored by your app, so you don't declare payment-card data here.)*
- **Location** (precise or coarse) — none
- **Contacts** — none
- **Browsing History / Search History** — none
- **Sensitive Info** — none
- **Audio / Photos / Videos** — none
- **Gameplay Content / Game Center** — none (fantasy data is declared under *User Content*)
- **Advertising Data / Other Data for advertising** — none

---

## 🔑 The big answers, summarized

- **"Does this app collect data?"** → **Yes.**
- **"Is any data used to track you?"** → **No** (no ad SDKs, no cross-app tracking, no data
  brokers).
- **"Is data linked to the user's identity?"** → **Yes** for the items in the table above
  (everything is tied to their account).

---

## ⚠️ Before you submit — confirm these three things

1. **No ad / tracking SDKs.** If you ever add ads, analytics-for-ads, or an attribution SDK,
   the "tracking" answers change and you'll need App Tracking Transparency. None today.
2. **Sentry user linkage** — decide whether crash reports include the user identity (affects
   the "Linked" answer for Diagnostics, above).
3. **AI providers (Anthropic / Google / OpenAI)** — your app sends user chat content to them
   to generate responses. That's disclosed under *User Content → Other User Content* above and
   in your Privacy Policy. Confirm you're on their standard API terms (they don't train on
   your API data by default) — no extra Apple declaration needed, but keep the Privacy Policy
   wording accurate.

---

*These answers reflect the codebase as of this commit. Re-check if you add new data
collection, SDKs, or features before submitting.*
