#!/usr/bin/env node
// Real-browser launch QA for auth, onboarding, billing, admin analytics, and gating.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_START = Number(process.env.WARROOM_LAUNCH_QA_PORT || 3310);
const QA_TOKEN = 'qa-session-token';
const ADMIN_TOKEN = 'qa-admin-token';

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP launch browser QA - @playwright/test is not installed. Run npm install first.');
  process.exit(0);
}

function hasChrome() {
  return fs.existsSync(CHROME);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOpenPort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port >= 65536) {
        reject(new Error(`no open port found starting at ${start}`));
        return;
      }
      const server = net.createServer();
      server.once('error', err => {
        if (err && ['EACCES', 'EPERM'].includes(err.code)) reject(err);
        else tryPort(port + 1);
      });
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port, '127.0.0.1');
    };
    if (!Number.isFinite(start)) reject(new Error('invalid start port'));
    else tryPort(start);
  });
}

async function startStaticServer(port) {
  const cmd = process.execPath;
  const args = [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`];
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  proc.stdout.on('data', chunk => {
    if (String(chunk).includes('Serving')) ready = true;
  });
  for (let i = 0; i < 40; i++) {
    if (ready) return proc;
    await wait(250);
  }
  return proc;
}

function supabaseStub() {
  return `
    window.__qaAnalyticsEvents = window.__qaAnalyticsEvents || [];
    window.__qaOAuth = window.__qaOAuth || [];
    window.supabase = {
      createClient: function () {
        return {
          auth: {
            getSession: async function () { return { data: { session: null } }; },
            signInWithOAuth: async function (opts) {
              window.__qaOAuth.push(opts);
              return { data: {}, error: null };
            }
          },
          from: function (table) {
            return {
              upsert: async function (rows) {
                if (table === 'analytics_events') window.__qaAnalyticsEvents.push.apply(window.__qaAnalyticsEvents, rows || []);
                return { data: null, error: null };
              },
              insert: async function (rows) {
                if (table === 'analytics_events') window.__qaAnalyticsEvents.push.apply(window.__qaAnalyticsEvents, rows || []);
                return { data: null, error: null };
              }
            };
          }
        };
      }
    };
  `;
}

function reconSharedStub() {
  return `
    window.OD = window.OD || {};
    window.OD.saveProfile = async function () { return true; };
    window.OD.track = function (eventName, payload) {
      window.__qaAnalyticsEvents = window.__qaAnalyticsEvents || [];
      window.__qaAnalyticsEvents.push({ event_name: eventName, metadata: payload || {} });
    };
  `;
}

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

async function installRoutes(context, network) {
  await context.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();

    if (url.includes('/functions/v1/') && req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    }

    if (url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: supabaseStub() });
    }

    if (url.includes('jcc100218.github.io/ReconAI/shared/supabase-client.js')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: reconSharedStub() });
    }

    if (url.includes('/functions/v1/fw-signup')) {
      network.signup.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill(jsonResponse({ token: QA_TOKEN, user: { email: 'qa@example.com', displayName: 'QA User' } }));
    }

    if (url.includes('/functions/v1/fw-signin')) {
      network.signin.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill(jsonResponse({ error: 'Invalid email or password.' }, 401));
    }

    if (url.includes('/functions/v1/fw-request-password-reset')) {
      network.passwordReset.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill(jsonResponse({ ok: true }));
    }

    if (url.includes('/functions/v1/fw-create-checkout')) {
      network.checkout.push({
        auth: req.headers().authorization || '',
        body: JSON.parse(req.postData() || '{}'),
      });
      return route.fulfill(jsonResponse({ checkoutUrl: `${network.baseUrl}/checkout-qa.html` }));
    }

    if (url.includes('/functions/v1/admin-list-users')) {
      if (req.headers().authorization !== `Bearer ${ADMIN_TOKEN}`) {
        return route.fulfill(jsonResponse({ error: 'Unauthorized' }, 401));
      }
      return route.fulfill(jsonResponse({
          users: [
            { email: 'qa@example.com', displayName: 'QA User', tier: 'pro', products: ['war_room'], createdAt: '2026-05-01T00:00:00Z' },
            { email: 'free@example.com', displayName: 'Free User', tier: 'free', products: [], createdAt: '2026-05-02T00:00:00Z' },
          ],
          total: 2,
          page: 0,
          limit: 50,
      }));
    }

    if (url.includes('/functions/v1/admin-analytics-report')) {
      if (req.headers().authorization !== `Bearer ${ADMIN_TOKEN}`) {
        return route.fulfill(jsonResponse({ error: 'Unauthorized' }, 401));
      }
      return route.fulfill(jsonResponse({
          days: 7,
          since: '2026-04-26T00:00:00Z',
          report: {
            totals: { events: 120, sessions: 24, knownUsers: 9, anonymousSessions: 15, clientErrors: 2, sentryLinkedErrors: 1 },
            funnel: [
              { label: 'Landing viewed', eventName: 'landing_viewed', sessions: 24 },
              { label: 'Signup started', eventName: 'signup_started', sessions: 10 },
              { label: 'Signup succeeded', eventName: 'signup_succeeded', sessions: 7 },
            ],
            dropoffs: [{ from: 'landing_viewed', to: 'signup_started', fromSessions: 24, toSessions: 10, dropoffPct: 58.3 }],
            topModules: [{ module: 'dashboard', sessions: 7 }],
            errors: [{ source: 'react_error_boundary', errorName: 'Error', events: 2 }],
          },
      }));
    }

    if (url.includes('api.sleeper.app/v1/user/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user_id: 'sleeper_qa_user', username: 'bigloco', display_name: 'bigloco' }),
      });
    }

    if (url === `${network.baseUrl}/checkout-qa.html`) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe QA</title><h1>Stripe QA</h1>' });
    }

    if (['image', 'font', 'media'].includes(type)) return route.abort();
    return route.continue();
  });
}

async function newPage(context, failures) {
  const page = await context.newPage();
  page.on('pageerror', err => failures.push(`page error: ${err.message}`));
  return page;
}

async function assertNoHorizontalOverflow(page, label) {
  const snap = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
    innerWidth: window.innerWidth,
  }));
  if (snap.scrollWidth > snap.innerWidth + 2) {
    throw new Error(`${label}: horizontal overflow ${snap.scrollWidth} > ${snap.innerWidth}`);
  }
}

async function eventNames(page) {
  return page.evaluate(() => (window.__qaAnalyticsEvents || []).map(evt => evt.event_name));
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(name, fn, failures) {
  try {
    await fn();
    process.stdout.write('.');
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : err}`);
    process.stdout.write('F');
  }
}

async function testLandingAuth(context, baseUrl, failures) {
  const page = await newPage(context, failures);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${baseUrl}/landing.html`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow(page, 'landing mobile');

  let names = await eventNames(page);
  expect(names.includes('landing_viewed'), 'landing_viewed analytics event missing');

  await page.getByRole('button', { name: 'Start free trial' }).first().click();
  await page.locator('#tabSignup').click();
  await page.locator('#su-email').fill('qa@example.com');
  await page.locator('#su-password').fill('launch-password-1');
  await page.locator('#su-name').fill('QA User');
  await page.locator('#btnSignup').click();
  await page.getByText('Account created!', { exact: false }).waitFor({ state: 'visible', timeout: 4000 });

  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('fw_session_v1') || 'null'));
  expect(session?.token === QA_TOKEN, 'signup did not store the app session token');
  names = await eventNames(page);
  expect(names.includes('signup_started'), 'signup_started analytics event missing');
  expect(names.includes('signup_succeeded'), 'signup_succeeded analytics event missing');
  await page.close();
}

async function testSigninAndReset(context, baseUrl, failures) {
  const page = await newPage(context, failures);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${baseUrl}/landing.html`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.locator('#tabSignin').click();
  await page.locator('#si-email').fill('fail@example.com');
  await page.locator('#si-password').fill('bad-password');
  await page.locator('#btnSignin').click();
  await page.getByText('Invalid email or password.', { exact: false }).waitFor({ state: 'visible', timeout: 4000 });
  await page.locator('#btnReset').click();
  await page.getByText('reset link is on the way', { exact: false }).waitFor({ state: 'visible', timeout: 4000 });
  const names = await eventNames(page);
  expect(names.includes('signin_started'), 'signin_started analytics event missing');
  expect(names.includes('signin_failed'), 'signin_failed analytics event missing');
  expect(names.includes('password_reset_requested'), 'password reset analytics event missing');
  await page.close();
}

async function testOnboardingFreeFlow(context, baseUrl, failures) {
  const page = await newPage(context, failures);
  await page.addInitScript(token => {
    try {
      if (!sessionStorage.getItem('__qa_onboarding_seeded')) {
        localStorage.setItem('fw_session_v1', JSON.stringify({ token, user: { email: 'qa@example.com', displayName: 'QA User' } }));
        localStorage.removeItem('od_profile_v1');
        sessionStorage.setItem('__qa_onboarding_seeded', '1');
      }
    } catch (err) {
      window.__qaInitError = err.message;
    }
  }, QA_TOKEN);
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(`${baseUrl}/onboarding.html`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForTimeout(250);
  await assertNoHorizontalOverflow(page, 'onboarding mobile step 1');
  await page.locator('#plan-scout').click();
  await page.locator('#step1Btn').click();
  await page.locator('#step3.active').waitFor({ state: 'attached', timeout: 4000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#sleeperUsernameInput').fill('bigloco');
  await page.locator('#sleeperBtn').click();
  await page.waitForURL('**/index.html', { timeout: 5000 });
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('od_profile_v1') || '{}'));
  const auth = await page.evaluate(() => JSON.parse(localStorage.getItem('od_auth_v1') || '{}'));
  expect(profile.onboardingComplete === true, 'onboarding did not mark profile complete');
  expect(profile.sleeperUsername === 'bigloco', 'onboarding did not persist Sleeper username');
  expect(auth.username === 'bigloco', 'onboarding did not persist legacy Sleeper auth compatibility');
  await page.close();
}

async function testCheckoutFlow(context, baseUrl, network, failures) {
  const page = await newPage(context, failures);
  await page.addInitScript(token => {
    try {
      if (!sessionStorage.getItem('__qa_checkout_seeded')) {
        localStorage.setItem('fw_session_v1', JSON.stringify({ token, user: { email: 'qa@example.com', displayName: 'QA User' } }));
        localStorage.removeItem('od_profile_v1');
        sessionStorage.setItem('__qa_checkout_seeded', '1');
      }
    } catch (err) {
      window.__qaInitError = err.message;
    }
  }, QA_TOKEN);
  await page.goto(`${baseUrl}/onboarding.html`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.locator('#plan-standard').click();
  await page.locator('#step1Btn').click();
  await page.locator('#stripeBtn').click();
  for (let i = 0; i < 30 && !network.checkout.length; i++) await wait(100);
  const alertText = await page.locator('#alertPayment').textContent().catch(() => '');
  expect(network.checkout.length > 0, `checkout endpoint was not called; alert="${alertText || ''}" url="${page.url()}"`);
  const request = network.checkout.at(-1);
  expect(request?.auth === `Bearer ${QA_TOKEN}`, 'checkout request did not include the app session token');
  expect(request?.body?.productSlug === 'war_room', 'standard checkout did not request war_room');
  expect(request?.body?.successUrl?.includes('payment=success'), 'checkout success URL missing payment=success');
  await page.close();
}

async function testAdminAnalytics(context, baseUrl, failures) {
  const page = await newPage(context, failures);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(`${baseUrl}/admin.html`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.locator('#secret-input').fill(ADMIN_TOKEN);
  await page.locator('#login-btn').click();
  await page.getByText('Launch Analytics', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByText('Landing viewed', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByText('dashboard', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await assertNoHorizontalOverflow(page, 'admin analytics');
  await page.close();
}

async function testSubscriptionGating(context, baseUrl, failures) {
  const page = await newPage(context, failures);
  await page.addInitScript(() => {
    localStorage.setItem('od_profile_v1', JSON.stringify({ tier: 'free', onboardingComplete: true }));
    localStorage.setItem('fw_session_v1', JSON.stringify({ token: 'qa-session-token', user: { email: 'qa@example.com' } }));
  });
  await page.goto(`${baseUrl}/dist-preview/?dev=true&user=bigloco#league=1312100327931019264&tab=dashboard`, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForFunction(() => typeof window.canAccess === 'function', null, { timeout: 12000 });
  const access = await page.evaluate(() => ({
    freeAnalytics: (() => {
      window.getTier = () => 'free';
      localStorage.setItem('od_profile_v1', JSON.stringify({ tier: 'free', onboardingComplete: true }));
      return window.canAccess('analytics-full');
    })(),
    freeWarRoom: (() => {
      window.getTier = () => 'free';
      return window.canAccess('war-room-core');
    })(),
    afterUpgrade: (() => {
      window.getTier = () => 'paid';
      window.App = window.App || {};
      window.App._productTier = 'warroom';
      localStorage.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom', onboardingComplete: true }));
      return window.canAccess('analytics-full');
    })(),
  }));
  expect(access.freeAnalytics === false, 'free profile should not access analytics-full');
  expect(access.freeWarRoom === false, 'free profile should not access war-room-core');
  expect(access.afterUpgrade === true, 'warroom profile should access analytics-full');
  await page.close();
}

async function main() {
  if (!hasChrome()) {
    console.log(`SKIP launch browser QA - Chrome not found at ${CHROME}`);
    return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP launch browser QA - local port binding is not permitted here (${err.code}).`);
      return;
    }
    throw err;
  }
  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];
  const network = { signup: [], signin: [], passwordReset: [], checkout: [] };
  const baseUrl = `http://127.0.0.1:${port}`;
  network.baseUrl = baseUrl;

  try {
    const context = await browser.newContext();
    await installRoutes(context, network);

    await runCase('landing signup analytics', () => testLandingAuth(context, baseUrl, failures), failures);
    await runCase('signin reset analytics', () => testSigninAndReset(context, baseUrl, failures), failures);
    await runCase('onboarding free flow', () => testOnboardingFreeFlow(context, baseUrl, failures), failures);
    await runCase('checkout flow', () => testCheckoutFlow(context, baseUrl, network, failures), failures);
    await runCase('admin analytics', () => testAdminAnalytics(context, baseUrl, failures), failures);
    await runCase('subscription gating', () => testSubscriptionGating(context, baseUrl, failures), failures);

    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length) {
    console.log('\nLaunch browser QA failures:');
    failures.forEach(failure => console.log(`  FAIL: ${failure}`));
    process.exit(1);
  }

  console.log('\nPASS launch browser QA - 6 flows');
}

main().catch(err => {
  console.error('Launch browser QA failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
