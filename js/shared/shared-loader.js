// js/shared/shared-loader.js
// Resolves ReconAI shared scripts for local War Room dev and production.

(function() {
    const REMOTE_BASE = (function () {
        try {
            const h = window.location.hostname || '';
            // ReconAI shared scripts are deployed at <origin>/ReconAI-sandbox-dev/ on the
            // skjjcruz Pages host. When War Room is served from skjjcruz.github.io the
            // ReconAI-sandbox-dev project site is same-origin, so load it relative to the
            // origin (covered by CSP 'self'). Any other host loads it cross-origin from
            // skjjcruz.github.io explicitly.
            if (h === 'skjjcruz.github.io') return `${window.location.origin}/ReconAI-sandbox-dev/shared/`;
        } catch (e) {}
        return 'https://skjjcruz.github.io/ReconAI-sandbox-dev/shared/';
    })();
    const DEFAULT_VERSION = '20260531sandbox2';
    const config = {
        localBase: null,
        remoteBase: REMOTE_BASE,
        version: DEFAULT_VERSION,
    };

    function params() {
        return new URLSearchParams(window.location.search || '');
    }

    function cleanBase(base) {
        return String(base || '').replace(/\/?$/, '/');
    }

    function isLocalHost() {
        return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(window.location.hostname || '');
    }

    function isGitHubPagesHost() {
        return /(^|\.)github\.io$/i.test(window.location.hostname || '');
    }

    function isLocalMode() {
        const shared = params().get('shared');
        if (shared === 'remote') return false;
        if (shared === 'local') return true;
        if (isGitHubPagesHost()) return false;
        return isLocalHost() || window.location.protocol === 'file:' || params().has('dev');
    }

    function defaultLocalBase() {
        const path = window.location.pathname || '';
        if (path.includes('/draft-war-room/') || path.includes('/dist-preview/')) return '../reconai-shared/';
        return 'reconai-shared/';
    }

    function resolveBase() {
        const explicit = params().get('sharedBase') || window.WARROOM_SHARED_BASE;
        if (explicit) return cleanBase(explicit);
        if (isLocalMode()) return cleanBase(config.localBase || defaultLocalBase());
        return cleanBase(config.remoteBase);
    }

    function withVersion(url, version) {
        const v = version || config.version;
        if (!v) return url;
        return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(v)}`;
    }

    function src(file, version) {
        return withVersion(resolveBase() + String(file || '').replace(/^\//, ''), version);
    }

    function load(file, version) {
        document.write(`<script src="${src(file, version)}"><\/script>`);
    }

    function loadMany(files) {
        files.forEach(item => {
            if (Array.isArray(item)) load(item[0], item[1]);
            else load(item, config.version);
        });
    }

    function configure(next = {}) {
        if (next.localBase) config.localBase = next.localBase;
        if (next.remoteBase) config.remoteBase = next.remoteBase;
        if (next.version) config.version = next.version;
        if (next.rookieDataBase && !window.ROOKIE_DATA_BASE) {
            window.ROOKIE_DATA_BASE = next.rookieDataBase;
        }
    }

    function setDefaultRookieDataBase() {
        if (window.ROOKIE_DATA_BASE) return;
        if (!window.location.origin || window.location.origin === 'null') return;
        const path = window.location.pathname || '';
        if (isLocalMode()) {
            window.ROOKIE_DATA_BASE = `${window.location.origin}/draft-war-room`;
            return;
        }
        // Hosted deployments resolve same-origin so the data load is covered by CSP 'self'.
        // GitHub Pages project sites serve under /<repo>/; root-domain deployments use the origin root.
        const firstSegment = window.location.hostname.endsWith('.github.io')
            ? path.split('/').filter(Boolean)[0]
            : '';
        window.ROOKIE_DATA_BASE = firstSegment
            ? `${window.location.origin}/${firstSegment}/draft-war-room`
            : `${window.location.origin}/draft-war-room`;
    }

    window.WRShared = {
        configure,
        src,
        load,
        loadMany,
        isLocalMode,
        resolveBase,
    };
    setDefaultRookieDataBase();
})();
