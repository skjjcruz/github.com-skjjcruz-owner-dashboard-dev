// js/draft/scouting.js
// War Room adapter over ReconAI/shared/rookie-data.js.
// The shared rookie module is the only active prospect data pipeline.

(function() {
    window.DraftCC = window.DraftCC || {};

    const sharedLoad = window.RookieData?.loadRookieProspects || window.App?.loadRookieProspects || window.loadRookieProspects;
    const sharedGet = window.RookieData?.getProspects || window.App?.getProspects || window.getProspects;
    const sharedFind = window.RookieData?.findProspect || window.App?.findProspect || window.findProspect;

    let _ready = null;
    let _prospects = [];
    let _nameIndex = {};

    function normName(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function stripSuffix(name) {
        return String(name || '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '').trim();
    }

    function aliasKeys(name) {
        const key = normName(name);
        if (!key) return [];
        const noSuffix = stripSuffix(key);
        const keys = new Set([key, noSuffix]);
        const parts = noSuffix.split(' ').filter(Boolean);
        if (parts.length >= 2) {
            const first = parts[0];
            const last = parts[parts.length - 1];
            keys.add(`${first} ${last}`);
            keys.add(`${first[0]} ${last}`);
            keys.add(last);
        }
        return [...keys].filter(Boolean);
    }

    function normalizeProspect(p, index) {
        const rawPos = (p.rawPos || p.position || p.pos || '').toString().toUpperCase();
        const pos = p.mappedPos || p.pos || rawPos;
        return {
            ...p,
            id: p.id || index + 1,
            pid: p.pid || `csv_${normName(p.name).replace(/[^a-z0-9]/g, '_')}`,
            pos,
            position: pos,
            rawPos,
            mappedPos: p.mappedPos || pos,
            school: p.school || p.college || '',
            college: p.college || p.school || '',
            source: 'rookie-data',
        };
    }

    function indexProspects(prospects) {
        const index = {};
        prospects.forEach(p => {
            aliasKeys(p.name).forEach(key => {
                const existing = index[key];
                if (!existing || (p.rank || 999) < (existing.rank || 999)) index[key] = p;
            });
        });
        return index;
    }

    function loadProspects() {
        if (_ready) return _ready;
        _ready = (async function() {
            if (typeof sharedLoad !== 'function' || typeof sharedGet !== 'function') {
                if (window.wrLog) window.wrLog('scouting.sharedMissing', { source: 'rookie-data' });
                window.DraftCC.scouting.isLoaded = true;
                return [];
            }

            await sharedLoad();
            _prospects = (sharedGet() || []).map(normalizeProspect).sort((a, b) => {
                return (a.rank || 999) - (b.rank || 999) || (a.consensusRank || 999) - (b.consensusRank || 999);
            });
            _nameIndex = indexProspects(_prospects);
            window.DraftCC.scouting.isLoaded = true;
            if (window.wrLog) window.wrLog('scouting.loaded', { count: _prospects.length, source: 'rookie-data' });
            return _prospects;
        })();
        return _ready;
    }

    function getProspects(pos) {
        const wanted = pos ? String(pos).toUpperCase() : '';
        const list = _prospects.slice();
        if (!wanted) return list;
        return list.filter(p => {
            return String(p.pos || '').toUpperCase() === wanted
                || String(p.mappedPos || '').toUpperCase() === wanted
                || String(p.rawPos || '').toUpperCase() === wanted;
        });
    }

    function findProspect(name) {
        if (!name) return null;
        const key = normName(name);
        if (_nameIndex[key]) return _nameIndex[key];
        for (const alias of aliasKeys(name)) {
            if (_nameIndex[alias]) return _nameIndex[alias];
        }
        if (typeof sharedFind === 'function') {
            const found = sharedFind(name);
            return found ? normalizeProspect(found, 0) : null;
        }
        return null;
    }

    window.DraftCC.scouting = {
        ready: loadProspects(),
        isLoaded: false,
        getProspects,
        findProspect,
        source: 'rookie-data',
    };
    window.getProspects = getProspects;
    window.findProspect = findProspect;
})();
