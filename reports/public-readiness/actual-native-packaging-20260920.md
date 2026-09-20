# Actual native packaging checkpoint — 2026-09-20

This is a bounded staging repair, not a native launch-readiness declaration.

## Provenance and reproduced failure

- Actual native source: `skjjcruz/github.com-skjjcruz-owner-dashboard-dev`, revision `aa13193b28c552f977fa36a4683bb3a688d3da4f`. Working branch: `codex/readiness-actual-native-20260920` in `warroom-readiness-actual-native`.
- Canonical shared source: `skjjcruz/DHQ-Shared`, pinned `dedbb1614f08459905eef27d0f0b7bce27cd4e15` in `native-build.json`. Build reads a separate, clean checkout through `DHQ_SHARED_SOURCE`; it does not edit that checkout.
- The actual source differs from the older C2 repository: it contains no `data/time-league`, no `data/duat`, no Vault/Duat frontend module, and no prior custom `cap-sync-guard.cjs`. The earlier C2 historical-archive restriction is therefore not evidence of this repository's current native blocker. This does not establish that the suite's promised Vault or Duat experience has a native implementation.
- Baseline `capacitor.config.json` used `webDir: "."`. With the installed locked Capacitor CLI 8.5.2, `npx --no-install cap sync` failed: `"." is not a valid value for webDir`. The CLI rejected the configuration before copying; a leak from that configuration was not reproduced. Its copy implementation otherwise recursively copies the selected web directory, which makes an explicit public artifact necessary.
- No tracked `ios/` or `android/` project exists. Existing store-checklist completion language was not supported by a build or installation artifact in this snapshot; a superseding status now links this evidence.

## Resolution

`build:native` verifies Node 22 or newer and the exact clean canonical shared revision, synchronizes the existing 44 shared modules and three data files, and compiles all 16 existing public entry pages. It stages 215 public assets (10.72 MiB) in `dist-native`, and Capacitor now uses that directory.

The artifact uses tracked public source paths, with explicit entry/file/directory/extension allowlists and separately vendored shared assets. Private backend, tests, reports, configuration, credentials, dependency folders, untracked source, and symlinks are excluded or rejected. Artifact and source hashes, asset inventory, required entries, local script/link dependencies, and removal of browser Babel are checked before native copy/sync/build. Injected files or changed bytes fail closed. Remote `server.url` and root-directory workarounds fail. If the restricted Vault archive is added later, packaging stops for a distribution and required-asset review rather than silently removing it.

The production compiler now handles nested entry paths and stamps the shared loader only in its output overlay. It no longer changes tracked shared-loader source while building. Runtime module behavior and product pages are preserved; no platform project was invented and no guard was bypassed.

## Actual verification

| Evidence stage | Status | Evidence / limit |
| --- | --- | --- |
| Locked dependency install | PASS | Own isolated `npm ci --ignore-scripts`: 215 packages, audit 0 vulnerabilities. Node 25.8.1, npm 11.11.0; Capacitor packages 8.5.2, RevenueCat 13.5.1. No lock/dependency change in this batch. |
| Responsive browser | NOT RUN for this candidate | Actual preview compiled successfully. Existing browser evidence in other branches does not prove this native candidate. |
| Production web compilation and native staging | PASS | 16 entries, 71 Babel sources, 215 assets. All 182 shipped JavaScript files pass Node syntax parsing. [Packaging log](evidence/actual-native-packaging-20260920.log). |
| Guard regression | PASS | Eight checks: required executable assets, untracked-source exclusion, changed compiled bytes, changed source, injected private output rejected by actual installed CLI sync hook, output symlink rejection, future restricted archive rejection, and root/remote configuration rejection. Temporary fixture mutations restored. |
| Core product regression | PASS | [142/142 existing actual-native core tests](evidence/actual-native-core-20260920.log). Not the entire browser/security/billing release suite. |
| Capacitor synchronization | PASS, web only | [Actual CLI copy/update web](evidence/actual-native-web-sync-20260920.log). No platform projects were present; this is not iOS/Android compilation. |
| Native compilation | BLOCKED | No tracked platform project. Selected developer tools are `/Library/Developer/CommandLineTools`; `xcodebuild -version` fails, `xcrun --find simctl` unavailable. No Java runtime, adb, or Gradle found. |
| Install / physical device / store distribution | NOT RUN | No verified native binary, installation, device journey, purchase/restore, signing, upload, or store approval. |
| Deployment | NOT RUN | No push, deployment, purchase, new service, or remote data mutation in this batch. |

`git diff --check` passed. Focused commands:

```sh
DHQ_SHARED_SOURCE=/path/to/clean/DHQ-Shared npm run test:native
npx --no-install cap sync
npm run test:core
```

## Integration and next executable steps

1. Independently review this separate packaging commit, then integrate with the actual-native auth candidate `5e355b64ed66e3e483d3bd533418b185514085f6` and the prepared billing/account-deletion corrections. Preserve both package-script changes; do not reuse the auth candidate's whole-patch manifest after changing its inputs. Regenerate and review the intended release manifest.
2. When canonical shared fixes are accepted upstream, deliberately update `native-build.json` to their reviewed revision and rebuild. Do not update the pin from an uncommitted or floating source.
3. Run the actual-native integrated browser/security/billing gates, including narrow and landscape navigation, authentication and reconnect, deletion failure/retry, purchase activation, restore, and cross-account completion races. Packaging checks do not prove these journeys.
4. With the authorized native toolchains available, create or locate the intended platform projects, synchronize the verified bundle, and build each supported platform. Record platform source/revision, signing configuration, build results, install/device evidence, and store state separately. Existing external CDN dependencies also require actual runtime/network recovery checks; staging is not an offline-use promise.
5. Resolve the suite-level native Vault/Duat coverage gap from established product scope. This source's absent game implementation is not a passing game journey and was not hidden to make staging pass.

Root continues suite integration and holds live billing/deletion until their lifecycle dependencies are reviewed. The next bounded agent task is to include durable checkout attempts in deletion inventory and expire open provider checkout sessions before final account deletion.

## Independent review disposition

Root independently reviewed commit `4e11942`, including the staging/compiler/hooks and actual Pages overlay order, and reran the eight native guard checks against the actual shared pin. Review found no material issue in the bounded staging delta. The independent run again staged 215 public assets; it made no native-binary or device claim. Evidence: [independent native run](evidence/actual-native-independent-20260920.log). The remaining integration/toolchain/journey gates above remain open.
