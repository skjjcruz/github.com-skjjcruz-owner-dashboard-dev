#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const contentPath = path.join(ROOT, 'content', 'landing-pages.json');
const landingPath = path.join(ROOT, 'landing.html');

const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const landing = content.pages && content.pages.landing;

assert.strictEqual(content.schemaVersion, 1, 'schemaVersion must be 1');
assert(landing, 'pages.landing is required');
assert(landing.meta?.title, 'landing meta title is required');
assert(landing.hero?.title, 'landing hero title is required');
assert(Array.isArray(landing.productSummary) && landing.productSummary.length === 3, 'landing needs 3 product summary chips');
assert(Array.isArray(landing.features?.cards) && landing.features.cards.length === 6, 'landing needs 6 feature cards');
assert(Array.isArray(landing.pricing?.plans) && landing.pricing.plans.length === 4, 'landing needs 4 pricing plans');
assert(Array.isArray(landing.platforms?.badges) && landing.platforms.badges.length >= 2, 'landing needs platform badges');
assert(landing.auth?.signupSubmit && landing.auth?.signinSubmit, 'landing auth labels are required');

const html = fs.readFileSync(landingPath, 'utf8');
assert(html.includes('js/landing-content.js'), 'landing.html must load js/landing-content.js');

console.log('landing content contract ok');
