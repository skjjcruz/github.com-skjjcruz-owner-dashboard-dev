// ══════════════════════════════════════════════════════════════════
// js/tabs/league-map.js — LeagueMapTab: League overview, power rankings,
// competitive tiers, trade targets, draft picks, all-players view
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// ReportSubView — Custom report builder (manager, editor, table)
// ══════════════════════════════════════════════════════════════════
function leagueMapPosLabel(pos) {
  return window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
}

function ReportSubView({
  runReport, loadSavedReports, saveReportsToStorage, DEFAULT_REPORTS,
  getPlayerColumns, getTeamColumns, getFilterableFields, getFilterOps, getFilterOptionSet, sortBtnStyle,
  analyticsEmbedMode, openTeamContext,
}) {
  const [reportView, setReportView] = React.useState('list'); // 'list' | 'edit' | 'view'
  const [reports, setReports] = React.useState(() => {
    const saved = loadSavedReports();
    return saved || [...DEFAULT_REPORTS];
  });
  const [activeReportId, setActiveReportId] = React.useState(null);
  const [editDraft, setEditDraft] = React.useState(null);
  const [viewResult, setViewResult] = React.useState(null);
  const [viewSort, setViewSort] = React.useState(null);

  function persistReports(next) { setReports(next); saveReportsToStorage(next); }

  function handleViewReport(report) {
    const result = runReport(report);
    setViewResult({ report, ...result });
    setViewSort(report.sort ? { ...report.sort } : null);
    setActiveReportId(report.id);
    setReportView('view');
  }

  function handleNewReport() {
    setEditDraft({
      id: 'rpt_' + Date.now(),
      name: '',
      dataSource: 'players',
      columns: ['name', 'pos', 'dhq'],
      filters: [],
      sort: { field: 'dhq', dir: 'desc' },
      groupBy: null,
      limit: null,
    });
    setReportView('edit');
  }

  function handleUseTemplate(report) {
    setEditDraft({
      ...JSON.parse(JSON.stringify(report)),
      id: 'rpt_' + Date.now(),
      name: report.name + ' Copy',
    });
    setReportView('edit');
  }

  function handleEditReport(report) {
    setEditDraft(JSON.parse(JSON.stringify(report)));
    setReportView('edit');
  }

  function handleSaveReport(config) {
    const idx = reports.findIndex(r => r.id === config.id);
    let next;
    if (idx >= 0) { next = [...reports]; next[idx] = config; }
    else { next = [...reports, config]; }
    persistReports(next);
    window.wrLogAction?.('\uD83D\uDCCA', 'Created report: ' + (config.name || 'Untitled'), 'research', { actionType: 'custom-report' });
    setReportView('list');
  }

  function handleDeleteReport(id) {
    persistReports(reports.filter(r => r.id !== id));
    if (reportView === 'view' && activeReportId === id) setReportView('list');
  }

  function handleResort(field) {
    if (!viewResult) return;
    const newDir = (viewSort && viewSort.field === field && viewSort.dir === 'desc') ? 'asc' : 'desc';
    const newSort = { field, dir: newDir };
    setViewSort(newSort);
    const re = runReport({ ...viewResult.report, sort: newSort });
    setViewResult({ report: viewResult.report, ...re });
  }

  function canOpenReportPlayer(row, report) {
    return !!(report?.dataSource === 'players' && row?.pid && !row._groupHeader);
  }

  function openReportPlayerRow(row, report) {
    if (!canOpenReportPlayer(row, report)) return;
    const options = { context: 'custom_report', reportId: report?.id || null, reportName: report?.name || null };
    if (window.WR && typeof window.WR.openPlayerCard === 'function') {
      window.WR.openPlayerCard(row.pid, options);
      return;
    }
    if (typeof window.openPlayerModal === 'function') {
      window.openPlayerModal(row.pid);
      return;
    }
    if (typeof window.openFWPlayerModal === 'function') {
      window.openFWPlayerModal(row.pid);
    }
  }

  function handleReportPlayerRowKey(e, row, report) {
    if (!canOpenReportPlayer(row, report)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openReportPlayerRow(row, report);
  }

  function reportPlayerRowProps(row, report) {
    if (!canOpenReportPlayer(row, report)) return {};
    return {
      role: 'button',
      tabIndex: 0,
      title: 'Open player card',
      onClick: () => openReportPlayerRow(row, report),
      onKeyDown: (e) => handleReportPlayerRowKey(e, row, report),
    };
  }

  function canOpenReportTeam(row, report) {
    return !!(report?.dataSource === 'teams' && row?.rosterId && !row._groupHeader && typeof openTeamContext === 'function');
  }

  function openReportTeamRow(row, report) {
    if (!canOpenReportTeam(row, report)) return;
    openTeamContext(row, report);
  }

  function handleReportTeamRowKey(e, row, report) {
    if (!canOpenReportTeam(row, report)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openReportTeamRow(row, report);
  }

  function reportTeamRowProps(row, report) {
    if (!canOpenReportTeam(row, report)) return {};
    return {
      role: 'button',
      tabIndex: 0,
      title: 'Open team context',
      onClick: () => openReportTeamRow(row, report),
      onKeyDown: (e) => handleReportTeamRowKey(e, row, report),
    };
  }

  // ── List View ───────────────────────────────────────────────────
  if (reportView === 'list') {
    const previewReport = reports[0] || DEFAULT_REPORTS[0];
    const previewResult = previewReport ? runReport(previewReport) : null;
    const previewRows = (previewResult?.rows || []).filter(r => !r._groupHeader).slice(0, 6);
    const previewCols = (previewResult?.columns || []).slice(0, 4);
    return (
      <div>
        {analyticsEmbedMode && (
          <div className="analytics-report-lab">
            <div>
              <span>Report Lab</span>
              <strong>Build once, rerun all season</strong>
              <p>Use templates for quick owner/player screens or create a sandbox report from scratch.</p>
            </div>
            <div className="analytics-report-templates">
              {DEFAULT_REPORTS.map(r => (
                <button key={r.id} onClick={() => handleUseTemplate(r)}>
                  <strong>{r.name}</strong>
                  <em>{r.dataSource} · {(r.columns || []).length} cols</em>
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' }}>CUSTOM REPORTS</div>
          <button onClick={handleNewReport} style={{ ...sortBtnStyle(false), marginLeft: 'auto', fontSize: '0.74rem' }}>+ New Report</button>
        </div>
        {reports.length === 0 && <div style={{ color: 'var(--silver)', fontSize: '0.82rem', padding: '24px', textAlign: 'center' }}>No reports yet. Create one to get started.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {reports.map(r => (
            <div key={r.id} role="button" tabIndex={0} title="Open report" data-report-id={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', transition: 'border-color 0.15s', outline: 'none' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--acc-line3, rgba(212,175,55,0.4))'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--acc-fill3, rgba(212,175,55,0.15))'}
              onClick={() => handleViewReport(r)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleViewReport(r); } }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--white)' }}>{r.name || 'Untitled Report'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '2px' }}>
                  <span style={{ textTransform: 'capitalize' }}>{r.dataSource}</span>
                  {r.filters && r.filters.length > 0 && <span> {'\u00B7'} {r.filters.length} filter{r.filters.length > 1 ? 's' : ''}</span>}
                  {r.groupBy && <span> {'\u00B7'} grouped by {r.groupBy}</span>}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleEditReport(r); }} style={{ background: 'none', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', padding: '3px 8px', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'var(--font-body)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Edit</button>
              {!r.id.startsWith('default_') && <button onClick={(e) => { e.stopPropagation(); handleDeleteReport(r.id); }} style={{ background: 'none', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', padding: '3px 8px', color: 'var(--bad)', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'var(--font-body)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Del</button>}
            </div>
          ))}
        </div>
        {analyticsEmbedMode && previewReport && (
          <div className="analytics-report-preview">
            <div className="analytics-evidence-head">
              <div>
                <span>Evidence Layer</span>
                <strong>Live report preview</strong>
                <em>{previewReport.name}</em>
              </div>
              <div className="analytics-evidence-meta">{previewRows.length} rows</div>
            </div>
            {previewRows.length ? (
              <div>
                <div className="analytics-report-preview-head" style={{ gridTemplateColumns: previewCols.map(() => '1fr').join(' ') }}>
                  {previewCols.map(col => <span key={col.key}>{col.label}</span>)}
                </div>
                {previewRows.map((row, idx) => {
                  const canOpenPlayer = canOpenReportPlayer(row, previewReport);
                  const canOpenTeam = canOpenReportTeam(row, previewReport);
                  return (
                    <div
                      key={idx}
                      className={'analytics-report-preview-row' + ((canOpenPlayer || canOpenTeam) ? ' is-clickable' : '')}
                      style={{ gridTemplateColumns: previewCols.map(() => '1fr').join(' ') }}
                      {...reportPlayerRowProps(row, previewReport)}
                      {...reportTeamRowProps(row, previewReport)}
                    >
                      {previewCols.map(col => <span key={col.key}>{row[col.key] == null ? '\u2014' : (col.key === 'pos' ? leagueMapPosLabel(row[col.key]) : String(row[col.key]))}</span>)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="analytics-report-preview-empty">No rows match this report yet.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Editor View ─────────────────────────────────────────────────
  if (reportView === 'edit' && editDraft) {
    const draft = editDraft;
    const colDefs = draft.dataSource === 'players' ? getPlayerColumns() : getTeamColumns();
    const filterFields = getFilterableFields(draft.dataSource);
    const ops = getFilterOps();
    const sortableFields = colDefs.map(c => c.key);
    const groupableFields = draft.dataSource === 'players' ? ['pos', 'team', 'owner', 'tier'] : ['tier'];

    function updateDraft(patch) { setEditDraft({ ...draft, ...patch }); }

    function toggleColumn(key) {
      const cols = [...(draft.columns || [])];
      const idx = cols.indexOf(key);
      if (idx >= 0) cols.splice(idx, 1); else cols.push(key);
      updateDraft({ columns: cols });
    }

    function addFilter() {
      updateDraft({ filters: [...(draft.filters || []), { field: filterFields[0], op: 'eq', value: '' }] });
    }

    function updateFilter(idx, patch) {
      const fs = [...(draft.filters || [])];
      fs[idx] = { ...fs[idx], ...patch };
      updateDraft({ filters: fs });
    }

    function removeFilter(idx) {
      const fs = [...(draft.filters || [])];
      fs.splice(idx, 1);
      updateDraft({ filters: fs });
    }

    function handleDataSourceChange(ds) {
      const newCols = ds === 'players' ? ['name', 'pos', 'dhq'] : ['teamName', 'healthScore', 'tier'];
      const newSort = ds === 'players' ? { field: 'dhq', dir: 'desc' } : { field: 'healthScore', dir: 'desc' };
      updateDraft({ dataSource: ds, columns: newCols, filters: [], sort: newSort, groupBy: null });
    }

    const inputStyle = { background: 'var(--ov-4, rgba(255,255,255,0.06))', border: '1px solid var(--ov-6, rgba(255,255,255,0.12))', borderRadius: '4px', padding: '5px 8px', color: 'var(--white)', fontSize: '0.78rem', fontFamily: 'var(--font-body)', outline: 'none' };
    const selectStyle = { ...inputStyle, cursor: 'pointer' };
    const labelStyle = { fontSize: '0.72rem', color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', display: 'block' };

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' }}>{draft.id && reports.find(r => r.id === draft.id) ? 'EDIT REPORT' : 'NEW REPORT'}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button onClick={() => { if (draft.name.trim()) handleSaveReport(draft); }} style={sortBtnStyle(true)} disabled={!draft.name.trim()}>Save</button>
            <button onClick={() => setReportView('list')} style={sortBtnStyle(false)}>Cancel</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '10px', padding: '16px' }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Report Name</label>
            <input value={draft.name} onChange={e => updateDraft({ name: e.target.value })} placeholder="My Custom Report" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
          </div>
          {/* Data Source */}
          <div>
            <label style={labelStyle}>Data Source</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => handleDataSourceChange('players')} style={sortBtnStyle(draft.dataSource === 'players')}>Players</button>
              <button onClick={() => handleDataSourceChange('teams')} style={sortBtnStyle(draft.dataSource === 'teams')}>Teams</button>
            </div>
          </div>
          {/* Columns */}
          <div>
            <label style={labelStyle}>Columns</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {colDefs.map(c => {
                const active = (draft.columns || []).includes(c.key);
                return (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.78rem', color: active ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', padding: '3px 8px', background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid ' + (active ? 'var(--acc-line2, rgba(212,175,55,0.3))' : 'var(--ov-5, rgba(255,255,255,0.08))'), borderRadius: '4px' }}>
                    <input type="checkbox" checked={active} onChange={() => toggleColumn(c.key)} style={{ display: 'none' }} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </div>
          {/* Filters */}
          <div>
            <label style={labelStyle}>Filters</label>
            {(draft.filters || []).map((f, i) => {
              // Phase 8 deferred: dropdown value picker when the field has a known option set
              const optSet = typeof getFilterOptionSet === 'function' ? getFilterOptionSet(f.field) : null;
              return (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <select value={f.field} onChange={e => updateFilter(i, { field: e.target.value, value: '' })} style={selectStyle}>
                  {filterFields.map(ff => <option key={ff} value={ff}>{ff}</option>)}
                </select>
                <select value={f.op} onChange={e => updateFilter(i, { op: e.target.value })} style={selectStyle}>
                  {ops.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                {optSet && optSet.length && f.op !== 'in' ? (
                  <select value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
                    <option value="">— choose —</option>
                    {optSet.map(v => <option key={v} value={v}>{f.field === 'pos' ? leagueMapPosLabel(v) : v}</option>)}
                  </select>
                ) : (
                  <input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} placeholder={optSet && f.op === 'in' ? optSet.slice(0, 3).join(',') + '…' : 'value'} style={{ ...inputStyle, flex: 1 }} />
                )}
                <button onClick={() => removeFilter(i)} style={{ background: 'none', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', padding: '3px 8px', color: 'var(--bad)', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'var(--font-body)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>X</button>
              </div>
              );
            })}
            <button onClick={addFilter} style={{ ...sortBtnStyle(false), fontSize: '0.72rem', padding: '3px 10px' }}>+ Add Filter</button>
          </div>
          {/* Sort */}
          <div>
            <label style={labelStyle}>Sort By</label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select value={draft.sort?.field || ''} onChange={e => updateDraft({ sort: { ...draft.sort, field: e.target.value } })} style={selectStyle}>
                <option value="">None</option>
                {sortableFields.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <button onClick={() => updateDraft({ sort: { ...draft.sort, dir: draft.sort?.dir === 'asc' ? 'desc' : 'asc' } })} style={sortBtnStyle(false)}>
                {draft.sort?.dir === 'asc' ? 'ASC \u25B2' : 'DESC \u25BC'}
              </button>
            </div>
          </div>
          {/* Group By */}
          <div>
            <label style={labelStyle}>Group By (optional)</label>
            <select value={draft.groupBy || ''} onChange={e => updateDraft({ groupBy: e.target.value || null })} style={selectStyle}>
              <option value="">None</option>
              {groupableFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {/* Limit */}
          <div>
            <label style={labelStyle}>Limit Per Group (optional)</label>
            <input type="number" value={draft.limit || ''} onChange={e => updateDraft({ limit: e.target.value ? parseInt(e.target.value) : null })} placeholder="No limit" min="1" style={{ ...inputStyle, width: '120px' }} />
          </div>
        </div>
      </div>
    );
  }

  // ── Table View ──────────────────────────────────────────────────
  if (reportView === 'view' && viewResult) {
    const { report, rows, columns } = viewResult;
    const tierColors = { ELITE: 'var(--gold)', CONTENDER: 'var(--good)', CROSSROADS: 'var(--warn)', REBUILDING: 'var(--bad)' };

    function cellValue(row, col) {
      const val = row[col.key];
      if (val == null) return '\u2014';
      if (col.key === 'dhq' || col.key === 'totalDHQ') return typeof val === 'number' ? val.toLocaleString() : val;
      if (col.key === 'healthScore') return typeof val === 'number' ? val : val;
      if (col.key === 'peakYrs') return val > 0 ? val : (val === 0 ? 'At peak' : 'Past');
      if (col.key === 'pos') return leagueMapPosLabel(val);
      return String(val);
    }

    function cellColor(row, col) {
      const val = row[col.key];
      if (col.key === 'dhq' || col.key === 'totalDHQ') {
        if (typeof val === 'number') return val >= 7000 ? 'var(--good)' : val >= 4000 ? 'var(--k-3498db, #3498db)' : val >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.35))';
      }
      if (col.key === 'tier') return tierColors[val] || 'var(--silver)';
      if (col.key === 'healthScore') {
        if (typeof val === 'number') return val >= 90 ? 'var(--gold)' : val >= 80 ? 'var(--good)' : val >= 70 ? 'var(--warn)' : 'var(--bad)';
      }
      if (col.key === 'peakYrs') {
        if (typeof val === 'number') return val >= 3 ? 'var(--good)' : val >= 1 ? 'var(--warn)' : 'var(--bad)';
      }
      return 'var(--silver)';
    }

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
          <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' }}>{report.name || 'Report'}</div>
          <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{rows.filter(r => !r._groupHeader).length} results</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button onClick={() => handleEditReport(report)} style={sortBtnStyle(false)}>Edit</button>
            <button onClick={() => setReportView('list')} style={sortBtnStyle(false)}>Back</button>
          </div>
        </div>
        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: columns.map(() => '1fr').join(' '), gap: '4px', padding: '6px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: '0.74rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>
            {columns.map(col => (
              <span key={col.key} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleResort(col.key)}>
                {col.label}{viewSort && viewSort.field === col.key ? (viewSort.dir === 'desc' ? ' \u25BC' : ' \u25B2') : ''}
              </span>
            ))}
          </div>
          {/* Rows */}
          <div style={analyticsEmbedMode ? {} : { maxHeight: '600px', overflow: 'auto' }}>
            {rows.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--silver)', fontSize: '0.82rem' }}>No data matches the report criteria.</div>}
            {rows.map((row, idx) => {
              if (row._groupHeader) {
                return (
                  <div key={'gh_' + row._groupKey} style={{ padding: '8px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderBottom: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-title)', letterSpacing: '0.04em' }}>
                    {report.groupBy === 'pos' ? leagueMapPosLabel(row._groupKey) : row._groupKey} <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--silver)', fontFamily: 'var(--font-body)' }}>({row._count})</span>
                  </div>
                );
              }
              const canOpenPlayer = canOpenReportPlayer(row, report);
              const canOpenTeam = canOpenReportTeam(row, report);
              return (
                <div key={idx} className={(canOpenPlayer || canOpenTeam) ? 'is-clickable-report-row' : ''} style={{ display: 'grid', gridTemplateColumns: columns.map(() => '1fr').join(' '), gap: '4px', padding: '5px 10px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', fontSize: '0.74rem', alignItems: 'center', transition: 'background 0.1s', cursor: (canOpenPlayer || canOpenTeam) ? 'pointer' : 'default', outline: 'none' }}
                  {...reportPlayerRowProps(row, report)}
                  {...reportTeamRowProps(row, report)}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {columns.map(col => (
                    <span key={col.key} style={{ fontFamily: (col.key === 'dhq' || col.key === 'totalDHQ' || col.key === 'healthScore' || col.key === 'ppg' || col.key === 'eliteCount') ? 'var(--font-mono)' : 'inherit', fontWeight: (col.key === 'name' || col.key === 'teamName' || col.key === 'dhq' || col.key === 'totalDHQ') ? 600 : 400, color: cellColor(row, col), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cellValue(row, col)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return <div style={{ color: 'var(--silver)', padding: '16px' }}>Loading reports...</div>;
}

// ══════════════════════════════════════════════════════════════════
// All Players column registry — the single source of truth for the column picker
// on the combined Players & Picks screen. This is a SUPERSET of every column the
// Custom Report builder offers for the 'players' data source (getPlayerColumns):
//   report 'name'->name, 'pos'->pos, 'team'->nflTeam, 'age'->age, 'dhq'->dhq,
//   'ppg'->ppg, 'peakYrs'->peakYrs, 'owner'->owner, 'tier'->tier, 'acquired'->acq.
// Plus two extras (yoe, peak bar). Every key here has a renderCell case below and a
// width (the grid template + min-width math depend on it), so all are toggleable.
// To add a new report column: add an entry here (with width) AND a renderCell case.
// ══════════════════════════════════════════════════════════════════
const ALL_PLAYERS_COLUMNS = [
    { key: 'name',     label: 'Player',   width: '1fr',   toggleable: false },
    { key: 'pos',      label: 'Pos',      width: '36px' },
    { key: 'nflTeam',  label: 'NFL Team', width: '60px' },
    { key: 'age',      label: 'Age',      width: '32px' },
    { key: 'yoe',      label: 'YOE',      width: '36px' },
    { key: 'peak',     label: 'Peak',     width: '60px' },
    { key: 'peakYrs',  label: 'Peak Yrs', width: '52px' },
    { key: 'dhq',      label: 'DHQ',      width: '54px', sortable: true, sortKey: 'dhq' },
    { key: 'ppg',      label: 'PPG',      width: '42px', sortable: true, sortKey: 'ppg' },
    { key: 'tier',     label: 'Tier',     width: '72px' },
    { key: 'owner',    label: 'Owner',    width: '100px', sortable: true, sortKey: 'team' },
    { key: 'acq',      label: 'Acquired', width: '72px' },
];
// Default visible = the report-builder parity set, so the combined screen opens with
// report-grade columns and users can toggle the extras (YOE, Peak bar) from the picker.
const ALL_PLAYERS_DEFAULT_VISIBLE = ['name', 'pos', 'nflTeam', 'age', 'dhq', 'ppg', 'peakYrs', 'tier', 'owner', 'acq'];

// ══════════════════════════════════════════════════════════════════
// RosterPlayerDossier — the My-Roster-style inline player card, reused in
// the Analytics All Players list. Edit D ("root out and replace the player
// cards in analytics with the ones from my roster"): clicking an All Players
// row now expands THIS dossier inline (matching the My Roster experience)
// instead of opening the generic modal. Self-contained: it computes its own
// dynasty read / peak / rank from globals so it works for any player —
// rostered by anyone or in the draft pool — not just your own roster.
// ══════════════════════════════════════════════════════════════════
function RosterPlayerDossier({ x, playersData, statsData, currentLeague, normPos, onCollapse }) {
    const App = window.App || {};
    const p = x.p || {};
    const pos = x.pos;
    const pid = x.pid;
    const dhq = x.dhq || 0;
    const age = x.age || p.age || null;
    const posColors = App.POS_COLORS || {};
    const posLabel = (pp) => App.posLabel?.(pp) || (pp === 'DEF' ? 'D/ST' : pp);
    const isElite = typeof App.isElitePlayer === 'function' ? App.isElitePlayer(pid) : dhq >= 7000;
    const band = isElite ? 'Elite' : dhq >= 4000 ? 'Starter' : dhq >= 2000 ? 'Depth' : 'Stash';
    const dhqCol = dhq >= 7000 ? 'var(--good)' : dhq >= 4000 ? 'var(--k-3498db, #3498db)' : dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))';
    const dhqBg = dhq >= 7000 ? 'rgba(46,204,113,0.12)' : dhq >= 4000 ? 'rgba(52,152,219,0.12)' : 'var(--acc-fill2, rgba(212,175,55,0.1))';
    const fmtHeight = (h) => {
        if (!h) return '';
        const n = parseInt(h, 10);
        if (!isNaN(n) && String(h).indexOf("'") === -1 && n > 40 && n < 90) return Math.floor(n / 12) + "'" + (n % 12) + '"';
        return String(h);
    };
    const stat = statsData?.[pid] || {};
    const gp = stat.gp || 0;
    const ppg = x.ppg || 0;
    const posP75 = App.POS_PPG_P75 || {};

    // Peak / age-curve read.
    const nP = pos === 'DE' || pos === 'DT' ? 'DL' : (pos === 'CB' || pos === 'S' ? 'DB' : pos);
    const curve = typeof App.getAgeCurve === 'function' ? App.getAgeCurve(nP) : { peak: (App.peakWindows || {})[nP] || [24, 29], decline: [30, 32] };
    const peakWin = curve.peak || (App.peakWindows || {})[nP] || [24, 29];
    const [pLo, pHi] = peakWin;
    const declineHi = (curve.decline && curve.decline[1]) || (pHi + 3);
    const peakPhase = !age ? '—' : age < pLo ? 'PRE' : age <= pHi ? 'PEAK' : 'POST';
    const peakYrsLeft = age && age <= pHi ? Math.max(0, pHi - age) : 0;
    const valueYrsLeft = age && age <= declineHi ? Math.max(0, declineHi - age) : 0;

    // Position rank across every rostered player by DHQ (mirrors My Roster's RANK box).
    const posRank = (() => {
        try {
            const scores = App.LI?.playerScores || {};
            const norm = typeof normPos === 'function' ? normPos : (q) => q;
            const all = (currentLeague?.rosters || [])
                .flatMap(ros => (ros.players || []).filter(pid2 => (norm(playersData?.[pid2]?.position) || playersData?.[pid2]?.position) === pos))
                .map(pid2 => ({ pid: pid2, dhq: scores[pid2] || 0 }))
                .sort((a, b) => b.dhq - a.dhq);
            const idx = all.findIndex(e => String(e.pid) === String(pid));
            return idx >= 0 ? pos + (idx + 1) : null;
        } catch { return null; }
    })();

    // Dynasty read — plain-language summary from band + peak phase.
    const dynastyRead = (() => {
        const lead = band + ' ' + posLabel(pos) + (age ? ', age ' + age : '') + '.';
        const tail = peakPhase === 'PRE' ? ' Ascending — value should climb as the role solidifies.'
            : peakPhase === 'PEAK' ? ' In his prime window — production and value are at their height.'
            : peakPhase === 'POST' ? ' Past peak — weigh present value over a long-term hold.'
            : ' Limited age data — judge on role and production.';
        const own = x.isPool ? ' Currently in the draft pool (unrostered).' : x.isMe ? ' On your roster.' : x.teamName ? ' Rostered by ' + x.teamName + '.' : '';
        return lead + tail + own;
    })();

    // Player tags — shared global store, same as My Roster.
    const [, setTagTick] = React.useState(0); // bump to re-render after a tag toggle
    const leagueId = currentLeague?.id || currentLeague?.league_id || '';
    const activeTag = window._playerTags?.[pid];
    const TAGS = [
        { tag: 'trade', label: 'TRADE BLOCK', bg: 'rgba(240,165,0,0.15)', col: 'var(--warn)', border: 'rgba(240,165,0,0.3)' },
        { tag: 'cut', label: 'CUT', bg: 'rgba(231,76,60,0.15)', col: 'var(--bad)', border: 'rgba(231,76,60,0.3)' },
        { tag: 'untouchable', label: 'UNTOUCHABLE', bg: 'rgba(46,204,113,0.15)', col: 'var(--good)', border: 'rgba(46,204,113,0.3)' },
        { tag: 'watch', label: 'WATCH', bg: 'rgba(52,152,219,0.15)', col: 'var(--k-3498db, #3498db)', border: 'rgba(52,152,219,0.3)' },
    ];

    const dhqPct = Math.min(100, Math.round((dhq / 10000) * 100));
    const dhqFilled = Math.round(dhqPct / 10);
    const dhqGaugeClass = dhq >= 7000 ? 'filled-green' : dhq >= 4000 ? 'filled' : 'filled-red';
    const statBoxes = [
        { label: 'DHQ', val: dhq > 0 ? dhq.toLocaleString() : '—', col: dhqCol, gauge: true },
        { label: 'RANK', val: posRank || '—', col: 'var(--gold)' },
        { label: 'PPG', val: ppg || '—', col: ppg >= (posP75[pos] || 10) ? 'var(--good)' : 'var(--text-primary)' },
        { label: 'GP', val: gp || '—', col: gp >= 14 ? 'var(--good)' : gp >= 10 ? 'var(--silver)' : 'var(--bad)' },
        { label: 'BAND', val: band, col: dhqCol },
    ];
    const ages = Array.from({ length: 17 }, (_, i) => i + 20);

    return (
        <div style={{ borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'linear-gradient(180deg, var(--surf-solid, rgba(18,18,24,0.99)), var(--surf-solid, rgba(6,6,10,0.99)))', padding: '12px 14px', animation: 'wrFadeIn 0.2s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.4fr) minmax(0, 0.8fr)', gap: '10px', marginBottom: '10px', alignItems: 'stretch' }}>
                {/* Header: photo + bio */}
                <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', gap: '10px', alignItems: 'center', background: 'var(--ov-1, rgba(255,255,255,0.022))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px' }}>
                    <div style={{ flexShrink: 0, position: 'relative' }}>
                        <img src={'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg'} alt="" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} style={{ width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))' }} />
                        <div style={{ display: 'none', width: '72px', height: '72px', borderRadius: '8px', background: 'var(--charcoal)', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', fontWeight: 700, color: 'var(--silver)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>{(p.first_name || '?')[0]}{(p.last_name || '?')[0]}</div>
                        <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '1px 7px', borderRadius: '7px', background: (posColors[pos] || 'var(--k-666666, #666666)') + '22', color: posColors[pos] || 'var(--silver)', whiteSpace: 'nowrap' }}>{posLabel(pos)}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.18rem', color: 'var(--white)', letterSpacing: '0.01em', lineHeight: 1.08 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Player'}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '4px', lineHeight: 1.4 }}>
                            {p.team || 'FA'} {'·'} Age {age || '?'} {'·'} {p.years_exp || 0}yr exp
                            {fmtHeight(p.height) ? ' · ' + fmtHeight(p.height) : ''}
                            {p.weight ? ' · ' + p.weight + 'lbs' : ''}
                            {p.college ? ' · ' + p.college : ''}
                        </div>
                        {p.injury_status && <div style={{ fontSize: '0.72rem', color: 'var(--bad)', fontWeight: 700, marginTop: '5px' }}>{p.injury_status}</div>}
                    </div>
                </div>
                {/* Dynasty Read */}
                <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '5px' }}>Dynasty Read</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--k-d8d8de, #d8d8de)', lineHeight: 1.42 }}>{dynastyRead}</div>
                </div>
                {/* Decision Stack */}
                <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Decision Stack</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: dhqBg, color: dhqCol }}>{band} {'·'} {dhq.toLocaleString()} DHQ</span>
                        <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '999px', background: peakPhase === 'PRE' ? 'rgba(46,204,113,0.1)' : peakPhase === 'POST' ? 'rgba(231,76,60,0.1)' : 'var(--acc-fill2, rgba(212,175,55,0.08))', color: peakPhase === 'PRE' ? 'var(--good)' : peakPhase === 'POST' ? 'var(--bad)' : 'var(--gold)', fontWeight: 700 }}>{peakPhase}</span>
                    </div>
                    <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.72rem', color: 'var(--silver)' }}>
                        <div><span style={{ opacity: 0.55 }}>Owner </span><strong style={{ color: 'var(--white)' }}>{x.isPool ? 'Draft Pool' : (x.teamName || '—')}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Depth </span><strong style={{ color: 'var(--white)' }}>{p.depth_chart_order != null ? pos + (p.depth_chart_order + 1) : '—'}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Peak </span><strong style={{ color: 'var(--white)' }}>{peakYrsLeft > 0 ? peakYrsLeft + ' yrs' : '—'}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Value </span><strong style={{ color: 'var(--white)' }}>{valueYrsLeft > 0 ? valueYrsLeft + ' yrs' : '—'}</strong></div>
                    </div>
                </div>
            </div>
            {/* Stat boxes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '6px', marginBottom: '10px' }}>
                {statBoxes.map((s, i) => (
                    <div key={i} style={{ background: 'var(--ov-2, rgba(255,255,255,0.026))', border: '1px solid var(--ov-4, rgba(255,255,255,0.055))', borderRadius: '7px', padding: '7px 6px', textAlign: 'center' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', fontWeight: 550, color: s.col }}>{s.val}</div>
                        {s.gauge && <div className="wr-gauge" style={{ marginTop: '3px' }}>{Array.from({ length: 10 }, (_, gi) => <div key={gi} className={'wr-gauge-seg' + (gi < dhqFilled ? ' ' + dhqGaugeClass : '')}></div>)}</div>}
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{s.label}</div>
                    </div>
                ))}
            </div>
            {/* Age curve */}
            <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Age Curve</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{'Currently age ' + (age || '?') + ' · ' + peakPhase + ' · ' + (peakYrsLeft > 0 ? '~' + peakYrsLeft + ' peak yr left' : valueYrsLeft > 0 ? '~' + valueYrsLeft + ' value yr left' : 'Past value window')}</div>
                </div>
                <div style={{ display: 'flex', height: '22px', borderRadius: '5px', overflow: 'hidden', gap: '1px' }}>
                    {ages.map(a => {
                        const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' : a < pLo ? 'rgba(46,204,113,0.45)' : (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' : a <= declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                        const isMe = a === (age || 0);
                        return <div key={a} style={{ flex: 1, background: col, opacity: isMe ? 1 : 0.55, outline: isMe ? '2px solid var(--gold)' : 'none', outlineOffset: '-1px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: isMe ? 'var(--text-primary)' : 'transparent' }}>{isMe ? a : ''}</div>;
                    })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '3px' }}>
                    <span>20</span><span>{'Peak ' + pLo + '–' + pHi + ' / Value thru ' + declineHi}</span><span>36</span>
                </div>
            </div>
            {/* Career stats */}
            {typeof window.InlineCareerStats === 'function' && React.createElement(window.InlineCareerStats, { pid, pos, player: p, scoringSettings: currentLeague?.scoring_settings, statsData })}
            {/* Actions: tags + collapse */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                {TAGS.map(t => {
                    const on = activeTag === t.tag;
                    return <button key={t.tag} onClick={e => {
                        e.stopPropagation();
                        const tags = window._playerTags || {};
                        if (tags[pid] === t.tag) delete tags[pid]; else tags[pid] = t.tag;
                        window._playerTags = { ...tags };
                        if (window.OD?.savePlayerTags) window.OD.savePlayerTags(leagueId, tags);
                        setTagTick(v => v + 1);
                    }} style={{ padding: '7px 12px', minHeight: '44px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', background: on ? t.bg : 'transparent', color: on ? t.col : 'var(--silver)', border: '1px solid ' + (on ? t.border : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: '6px', cursor: 'pointer', fontWeight: on ? 700 : 400, letterSpacing: '0.03em' }}>{t.label}</button>;
                })}
                <button onClick={e => { e.stopPropagation(); onCollapse && onCollapse(); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '6px', cursor: 'pointer' }}>COLLAPSE</button>
            </div>
        </div>
    );
}

function LeagueMapTab({
  // Phase 8: when `embedSubView` is set, we render ONLY that sub-view content
  // (Teams / All Players / Draft Picks / Custom Reports) without the outer header,
  // the Overview/Analyst top tabs, or the sub-view tab row. Used by AnalyticsPanel
  // after the League Map nav entry was removed.
  embedSubView,
  analyticsEmbedMode,
  leagueViewTab, setLeagueViewTab,
  leagueSelectedTeam, setLeagueSelectedTeam,
  leagueSort, setLeagueSort,
  leagueSubView, setLeagueSubView,
  leagueViewMode, setLeagueViewMode,
  lpSort, setLpSort,
  lpFilter, setLpFilter,
  // Phase 8 deferred: All Players search term (may be undefined when consumers pre-date the prop)
  lpSearch, setLpSearch,
  standings,
  currentLeague,
  leagueSkin,
  playersData,
  statsData,
  sleeperUserId,
  myRoster,
  activeYear,
  timeRecomputeTs,
  setTimeRecomputeTs,
  getAcquisitionInfo: getAcquisitionInfoProp,
  getOwnerName: getOwnerNameProp,
  setActiveTab,
}) {
  // Defensive fallback — any render path that mounts LeagueMapTab without a
  // getAcquisitionInfo function (stale prop chain during initial mount, legacy
  // deep-link path, any future refactor) must not crash the Analytics embed.
  // Matches the pattern my-team.js:58 already uses.
  const getAcquisitionInfo = typeof getAcquisitionInfoProp === 'function'
    ? getAcquisitionInfoProp
    : () => ({ method: 'Unknown', date: '\u2014', cost: '', season: '', week: 0 });

  const _seasonCtx = React.useContext(window.App.SeasonContext) || {};
  const _sPlayerStats = _seasonCtx.playerStats || window.S?.playerStats || {};
  const _sTradedPicks = _seasonCtx.tradedPicks !== undefined ? _seasonCtx.tradedPicks : (window.S?.tradedPicks || []);
  const resolvedLeagueSkin = leagueSkin || _seasonCtx.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
  const skinFeatures = resolvedLeagueSkin?.features || {};
  const normPos = window.App.normPos;

  function calcRawPts(s) { return window.App.calcRawPts(s, currentLeague?.scoring_settings); }
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);
  function getOwnerName(rosterId) {
    try {
      const supplied = typeof getOwnerNameProp === 'function' ? getOwnerNameProp(rosterId) : '';
      if (supplied && supplied !== 'Unknown') return supplied;
    } catch (_) {}
    const roster = currentLeague.rosters?.find(r => sameId(r.roster_id, rosterId) || sameId(r.owner_id, rosterId));
    const user = currentLeague.users?.find(u => sameId(u.user_id, roster?.owner_id) || sameId(u.user_id, rosterId));
    return user?.metadata?.team_name || user?.display_name || user?.username || 'Unknown';
  }

  // All Players visible columns — persisted per league.
  const LEAGUE_ID_KEY = currentLeague?.id || currentLeague?.league_id || 'default';
  const ALL_PLAYERS_COL_KEY = 'wr_all_players_cols_' + LEAGUE_ID_KEY;
  const [allPlayersCols, setAllPlayersCols] = React.useState(() => {
      try {
          const saved = JSON.parse(localStorage.getItem(ALL_PLAYERS_COL_KEY) || 'null');
          if (Array.isArray(saved) && saved.length) {
              // Drop any stored keys that aren't in the current registry — prevents
              // dead entries from silently widening the grid vs the row renderer.
              const registryKeys = new Set(ALL_PLAYERS_COLUMNS.map(c => c.key));
              const clean = saved.filter(k => registryKeys.has(k));
              if (clean.length) return clean;
          }
      } catch (_) {}
      return ALL_PLAYERS_DEFAULT_VISIBLE.slice();
  });
  const [allPlayersColPickerOpen, setAllPlayersColPickerOpen] = React.useState(false);
  React.useEffect(() => {
      try { localStorage.setItem(ALL_PLAYERS_COL_KEY, JSON.stringify(allPlayersCols)); } catch (_) {}
  }, [ALL_PLAYERS_COL_KEY, allPlayersCols]);

  // Rolling PPG window — shared with My Roster / FA so the setting is consistent.
  const [ppgWindow, setPpgWindow] = React.useState(() => { try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; } });
  React.useEffect(() => { try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {} }, [ppgWindow]);

  // Combined "Players & Picks" screen — which half is showing. Persisted per browser so
  // the toggle survives navigating away to another analytics sub-tab and back.
  const [assetsView, setAssetsView] = React.useState(() => { try { return localStorage.getItem('wr_assets_view') || 'players'; } catch { return 'players'; } });
  React.useEffect(() => { try { localStorage.setItem('wr_assets_view', assetsView); } catch {} }, [assetsView]);
  // Inline player dossier (My-Roster-style card) expanded in the All Players list.
  const [allPlayersExpandedPid, setAllPlayersExpandedPid] = React.useState(null);
  const [pickOwnerFilter, setPickOwnerFilter] = React.useState('all');
  const [pickStatusFilter, setPickStatusFilter] = React.useState('all');
  const [pickYearFilter, setPickYearFilter] = React.useState('all');
  const [, forcePpgRerender] = React.useState(0);
  React.useEffect(() => {
      const h = () => forcePpgRerender(n => n + 1);
      window.addEventListener('wr:weekly-points-loaded', h);
      return () => window.removeEventListener('wr:weekly-points-loaded', h);
  }, []);

  // ── Report Engine ─────────────────────────────────────────────────
  const REPORT_STORAGE_KEY = 'wr_custom_reports';

  function loadSavedReports() {
    try {
      const raw = localStorage.getItem(REPORT_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) { /* ignore */ }
    return null;
  }

  function saveReportsToStorage(reports) {
    try { localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(reports)); } catch(e) { /* ignore */ }
  }

  const DEFAULT_REPORTS = [
    {
      id: 'default_top_by_pos_rebuilders',
      name: 'Top Players by Position (Rebuilders)',
      dataSource: 'players',
      columns: ['name', 'pos', 'age', 'team', 'dhq', 'ppg', 'peakYrs', 'owner', 'tier'],
      filters: [{ field: 'tier', op: 'in', value: 'REBUILDING,CROSSROADS' }],
      sort: { field: 'dhq', dir: 'desc' },
      groupBy: 'pos',
      limit: 5,
    },
    {
      id: 'default_team_comparison',
      name: 'Team Comparison',
      dataSource: 'teams',
      columns: ['teamName', 'record', 'healthScore', 'tier', 'totalDHQ', 'avgAge', 'eliteCount'],
      filters: [],
      sort: { field: 'healthScore', dir: 'desc' },
      groupBy: null,
      limit: null,
    },
  ];

  function getPlayerColumns() {
    return [
      { key: 'name', label: 'Name' },
      { key: 'pos', label: 'Pos' },
      { key: 'age', label: 'Age' },
      { key: 'team', label: 'NFL Team' },
      { key: 'dhq', label: 'DHQ' },
      { key: 'ppg', label: 'PPG' },
      { key: 'peakYrs', label: 'Peak Yrs' },
      { key: 'owner', label: 'Owner' },
      { key: 'tier', label: 'Tier' },
      { key: 'acquired', label: 'Acquired' },
    ];
  }

  function getTeamColumns() {
    return [
      { key: 'teamName', label: 'Team' },
      { key: 'record', label: 'Record' },
      { key: 'healthScore', label: 'Health' },
      { key: 'tier', label: 'Tier' },
      { key: 'totalDHQ', label: 'Total DHQ' },
      { key: 'avgAge', label: 'Avg Age' },
      { key: 'eliteCount', label: 'Elite Players' },
    ];
  }

  function getFilterableFields(dataSource) {
    if (dataSource === 'players') return ['pos', 'age', 'dhq', 'ppg', 'peakYrs', 'team', 'owner', 'tier'];
    return ['healthScore', 'tier', 'totalDHQ', 'avgAge', 'eliteCount'];
  }

  function getFilterOps() {
    return [
      { key: 'eq', label: '=' },
      { key: 'neq', label: '!=' },
      { key: 'gt', label: '>' },
      { key: 'lt', label: '<' },
      { key: 'gte', label: '>=' },
      { key: 'lte', label: '<=' },
      { key: 'in', label: 'IN (comma sep)' },
    ];
  }

  // Phase 8 deferred: enumerated option sets so Custom Reports filter values are dropdowns
  // instead of free text. Each key maps the field name to the allowed values.
  function getFilterOptionSet(field) {
    switch (field) {
      case 'pos':   return ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
      case 'tier':  return ['ELITE','CONTENDER','CROSSROADS','REBUILDING'];
      case 'owner': {
        try {
          const users = (window.S?.leagues?.[0]?.users) || (window.App?.LI?.leagueUsers) || [];
          const names = new Set();
          (window.S?.rosters || []).forEach(r => {
              const u = users.find(x => x.user_id === r.owner_id);
              if (u) names.add(u.display_name || u.username || '');
          });
          return Array.from(names).filter(Boolean).sort();
        } catch (e) { return []; }
      }
      case 'team': {
        // NFL team abbreviations
        return ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS','FA'];
      }
      default: return null; // field isn't enumerated — caller falls back to free-text input
    }
  }

  function runReport(config) {
    const allAssessments = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []).filter(a => a && a.rosterId);
    const scores = window.App?.LI?.playerScores || {};
    const rosters = currentLeague?.rosters || [];
    const users = currentLeague?.users || [];

    function ownerNameForRoster(rid) {
      const r = rosters.find(ro => ro.roster_id === rid);
      const u = users.find(us => us.user_id === r?.owner_id);
      return u?.display_name || u?.username || 'Unknown';
    }

    function assessForRoster(rid) {
      return typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(rid) : null;
    }

    let rows = [];

    if (config.dataSource === 'players') {
      rosters.forEach(r => {
        const ownerName = ownerNameForRoster(r.roster_id);
        const assess = assessForRoster(r.roster_id);
        (r.players || []).forEach(pid => {
          const p = playersData[pid]; if (!p) return;
          const pos = normPos(p.position) || p.position;
          const dhq = scores[pid] || 0;
          const st = statsData[pid] || {};
          const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
          const pw = window.App?.peakWindows?.[pos];
          const peakYrs = (pw && p.age) ? Math.max(0, pw[1] - p.age) : null;
          const acq = getAcquisitionInfo(pid, r.roster_id);
          const acqLabel = acq?.type === 'draft' ? ('Draft R' + (acq.round || '?')) : acq?.type === 'trade' ? 'Trade' : acq?.type === 'add' ? 'FA' : '\u2014';
          rows.push({
            name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
            pos, age: p.age || null, team: p.team || 'FA', dhq, ppg,
            peakYrs, owner: ownerName, tier: assess?.tier || 'N/A',
            acquired: acqLabel, pid, rosterId: r.roster_id,
          });
        });
      });
    } else {
      // teams
      rosters.forEach(r => {
        const ownerName = ownerNameForRoster(r.roster_id);
        const assess = assessForRoster(r.roster_id);
        const st = standings.find(s => {
          const matchR = rosters.find(ro => ro.owner_id === s.userId);
          return matchR?.roster_id === r.roster_id;
        });
        const playerIds = r.players || [];
        const totalDHQ = playerIds.reduce((s, pid) => s + (scores[pid] || 0), 0);
        const ages = playerIds.map(pid => playersData[pid]?.age).filter(a => a && a > 18 && a < 45);
        const avgAge = ages.length > 0 ? +((ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1)) : null;
        const eliteCount = typeof window.App?.countElitePlayers === 'function'
          ? window.App.countElitePlayers(playerIds)
          : playerIds.filter(pid => (scores[pid] || 0) >= 7000).length;
        rows.push({
          teamName: ownerName,
          record: (st?.wins ?? r.settings?.wins ?? 0) + '-' + (st?.losses ?? r.settings?.losses ?? 0),
          healthScore: assess?.healthScore || 0,
          tier: assess?.tier || 'N/A',
          totalDHQ, avgAge, eliteCount, rosterId: r.roster_id,
        });
      });
    }

    // Apply filters
    (config.filters || []).forEach(f => {
      if (!f.field || !f.op || (f.value === '' && f.value !== 0)) return;
      rows = rows.filter(row => {
        const val = row[f.field];
        const cmp = isNaN(Number(f.value)) ? f.value : Number(f.value);
        const numVal = typeof val === 'number' ? val : (isNaN(Number(val)) ? val : Number(val));
        switch (f.op) {
          case 'eq': return String(val).toLowerCase() === String(cmp).toLowerCase();
          case 'neq': return String(val).toLowerCase() !== String(cmp).toLowerCase();
          case 'gt': return numVal > cmp;
          case 'lt': return numVal < cmp;
          case 'gte': return numVal >= cmp;
          case 'lte': return numVal <= cmp;
          case 'in': {
            const vals = String(f.value).split(',').map(v => v.trim().toUpperCase());
            return vals.includes(String(val).toUpperCase());
          }
          default: return true;
        }
      });
    });

    // Sort
    if (config.sort && config.sort.field) {
      const sf = config.sort.field;
      const dir = config.sort.dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const av = a[sf], bv = b[sf];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    // Group + limit
    if (config.groupBy) {
      const groups = {};
      rows.forEach(r => {
        const key = String(r[config.groupBy] ?? 'Other');
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });
      let finalRows = [];
      Object.entries(groups).forEach(([groupKey, groupRows]) => {
        const limited = config.limit ? groupRows.slice(0, config.limit) : groupRows;
        finalRows.push({ _groupHeader: true, _groupKey: groupKey, _count: groupRows.length });
        finalRows = finalRows.concat(limited);
      });
      rows = finalRows;
    } else if (config.limit) {
      rows = rows.slice(0, config.limit);
    }

    const columnsAvail = config.dataSource === 'players' ? getPlayerColumns() : getTeamColumns();
    const columns = columnsAvail.filter(c => (config.columns || []).includes(c.key));

    return { rows, columns };
  }

  // ── end Report Engine ────────────────────────────────────────────

  const selectedTeam = leagueSelectedTeam;
  const setSelectedTeam = setLeagueSelectedTeam;

  if (selectedTeam) {
    return renderTeamRoster(selectedTeam);
  }

  const sortedStandings = [...standings].sort((a, b) => {
    if (leagueSort === 'dhq') {
      const rA = currentLeague.rosters.find(r => r.owner_id === a.userId);
      const rB = currentLeague.rosters.find(r => r.owner_id === b.userId);
      const dhqA = (rA?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
      const dhqB = (rB?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
      return dhqB - dhqA;
    }
    if (leagueSort === 'champs') {
      const champs = window.App?.LI?.championships || {};
      const rA = currentLeague.rosters.find(r => r.owner_id === a.userId);
      const rB = currentLeague.rosters.find(r => r.owner_id === b.userId);
      const aChamps = Object.values(champs).filter(c => c.champion === rA?.roster_id).length;
      const bChamps = Object.values(champs).filter(c => c.champion === rB?.roster_id).length;
      return bChamps - aChamps;
    }
    if (leagueSort === 'health') {
      const rA = currentLeague.rosters.find(r => r.owner_id === a.userId);
      const rB = currentLeague.rosters.find(r => r.owner_id === b.userId);
      const hsA = (typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(rA?.roster_id) : null)?.healthScore || 0;
      const hsB = (typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(rB?.roster_id) : null)?.healthScore || 0;
      return hsB - hsA;
    }
    // default: wins
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.losses - a.losses;
  });
  const sortBtnStyle = (active) => ({
    padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', transition: 'all 0.15s',
    border: '1px solid ' + (active ? 'var(--gold)' : 'var(--acc-line2, rgba(212,175,55,0.3))'),
    background: active ? 'var(--gold)' : 'transparent',
    color: active ? 'var(--black)' : 'var(--gold)',
  });

  function openLeagueTeamContext(team, roster) {
    const resolvedRoster = roster || currentLeague.rosters?.find(r => sameId(r.roster_id, team?.rosterId) || sameId(r.owner_id, team?.userId) || sameId(r.owner_id, team?.ownerId));
    if (!resolvedRoster) return;
    const standingTeam = sortedStandings.find(t => sameId(t.userId, resolvedRoster.owner_id) || sameId(t.rosterId, resolvedRoster.roster_id)) || {};
    setLeagueViewMode('roster');
    setSelectedTeam({
      ...standingTeam,
      ...team,
      roster: resolvedRoster,
      rosterId: resolvedRoster.roster_id,
      userId: resolvedRoster.owner_id,
      displayName: team?.displayName || team?.teamName || standingTeam.displayName || getOwnerName(resolvedRoster.roster_id),
    });
  }

  function handleLeagueTeamKey(e, team, roster) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openLeagueTeamContext(team, roster);
  }

  function openTeamContext(row) {
    if (!row?.rosterId) return;
    const roster = currentLeague.rosters?.find(r => sameId(r.roster_id, row.rosterId));
    openLeagueTeamContext({
      rosterId: row.rosterId,
      displayName: row.teamName,
      teamName: row.teamName,
      wins: row.wins,
      losses: row.losses,
    }, roster);
  }

  function openPickContext(row) {
    if (!row) return;
    const detail = {
      context: 'league_pick_ledger',
      year: row.year,
      round: row.round,
      label: row.label,
      status: row.status,
      value: row.value || 0,
      traded: !!row.traded,
      isMine: !!row.isMyPick,
      originalRosterId: row.originalRid,
      currentOwnerRosterId: row.currentOwnerRid,
      originalOwnerName: getOwnerName(row.originalRid),
      currentOwnerName: getOwnerName(row.currentOwnerRid),
    };
    window._wrDraftPickFocus = detail;
    try { window.dispatchEvent(new CustomEvent('wr:open-draft-pick-context', { detail })); } catch (_) {}
    if (typeof setActiveTab === 'function') setActiveTab('draft');
    else if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('draft');
  }

  function handlePickRowKey(e, row) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openPickContext(row);
  }

  function pickRowProps(row) {
    return {
      role: 'button',
      tabIndex: 0,
      title: 'Open draft pick context',
      onClick: () => openPickContext(row),
      onKeyDown: (e) => handlePickRowKey(e, row),
    };
  }

  // Phase 8: when Analytics embeds this component, force the requested sub-view
  // and skip the outer chrome entirely. We still use all the local helpers/state.
  const _isEmbed = !!embedSubView;
  const _analyticsEmbed = !!analyticsEmbedMode;
  const _activeSubView = _isEmbed ? embedSubView : leagueSubView;
  const _activeViewTab = _isEmbed ? 'analyst' : leagueViewTab;
  const _leagueViewLabels = { overview: 'Overview', analyst: 'Analyst' };
  const _leagueViewContext = {
    overview: 'Every team, asset, and competitive position in one scan.',
    analyst: 'Players, picks, reports, and saved league-map views.'
  };

  return (
    <div style={{ padding: _isEmbed ? '0' : '16px' }}>
      {!_isEmbed && <>
      <div className="wr-module-strip">
        <div className="wr-module-context">
          <span>League Map</span>
          <strong>{_leagueViewLabels[_activeViewTab]}</strong>
          <em>{_leagueViewContext[_activeViewTab]}</em>
        </div>
        <div className="wr-module-actions">
        <div className="wr-module-nav">
        <button className={leagueViewTab === 'overview' ? 'is-active' : ''} onClick={() => setLeagueViewTab('overview')}>Overview</button>
        <button className={leagueViewTab === 'analyst' ? 'is-active' : ''} onClick={() => setLeagueViewTab('analyst')}>Analyst</button>
        </div>
        </div>
      </div>
      </>}

      {/* League Overview */}
      {_activeViewTab === 'overview' && (() => {
        // Assess all teams
        const allAssessments = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : [])
          .filter(a => a && a.rosterId);
        if (!allAssessments.length) return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--silver)' }}>Loading league intelligence...</div>;

        // Group by tier
        const tiers = { ELITE: [], CONTENDER: [], CROSSROADS: [], REBUILDING: [] };
        allAssessments.forEach(a => { if (tiers[a.tier]) tiers[a.tier].push(a); });

        // Sort by health within each tier
        Object.values(tiers).forEach(arr => arr.sort((a, b) => b.healthScore - a.healthScore));

        // Health rankings (all teams sorted)
        const ranked = [...allAssessments].sort((a, b) => b.healthScore - a.healthScore);

        // Phase 8 deferred: tradeTargets computation removed along with the Top Trade Targets card.

        // Power balance — top 3 teams for radar
        const top3 = ranked.slice(0, 3);
        const tierColors = { ELITE: 'var(--k-d4af37, #d4af37)', CONTENDER: 'var(--k-2ecc71, #2ecc71)', CROSSROADS: 'var(--k-f0a500, #f0a500)', REBUILDING: 'var(--k-e74c3c, #e74c3c)' };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Tier Overview */}
            <div>
              <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em', marginBottom: '10px' }}>COMPETITIVE TIERS</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                {Object.entries(tiers).map(([tierName, teams]) => (
                  <div key={tierName} className="wr-glass" style={{ background: 'var(--black)', border: '2px solid ' + (tierColors[tierName] || 'var(--k-666666, #666666)') + '44', borderRadius: '10px', padding: '14px', borderLeft: '4px solid ' + (tierColors[tierName] || 'var(--k-666666, #666666)') }}>
                    <div style={{ fontFamily: 'var(--font-title)', fontSize: '1rem', color: tierColors[tierName], marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {tierName}
                      <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-body)', color: 'var(--silver)', fontWeight: 400 }}>{teams.length} team{teams.length !== 1 ? 's' : ''}</span>
                    </div>
                    {teams.length === 0 ? <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.5 }}>None</div> : teams.map(t => (
                      <div key={t.rosterId} className={t.ownerId === sleeperUserId ? 'wr-my-row' : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', borderRadius: '4px' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--white)', fontWeight: t.ownerId === sleeperUserId ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.ownerName}{t.ownerId === sleeperUserId ? ' (You)' : ''}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.74rem', color: 'var(--silver)' }}>{t.wins}-{t.losses}</span>
                          {typeof MiniDonut !== 'undefined' && React.createElement(MiniDonut, { value: t.healthScore, size: 28, thickness: 3 })}
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: tierColors[tierName] }}>{t.healthScore}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Power Rankings — 3 views */}
            {(() => {
              const rp = currentLeague?.roster_positions || [];
              // Contender: by optimal PPG
              const contenderRanked = [...allAssessments].map(t => {
                const r = currentLeague.rosters?.find(r2 => r2.roster_id === t.rosterId);
                const ppg = typeof window.App?.calcOptimalPPG === 'function' ? window.App.calcOptimalPPG(r?.players || [], playersData, _sPlayerStats, rp) : 0;
                return { ...t, ppg };
              }).sort((a, b) => b.ppg - a.ppg);
              // Dynasty: by total DHQ
              const dynastyRanked = [...allAssessments].map(t => {
                const r = currentLeague.rosters?.find(r2 => r2.roster_id === t.rosterId);
                const totalDhq = (r?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
                return { ...t, totalDhq };
              }).sort((a, b) => b.totalDhq - a.totalDhq);

              const views = [
                { key: 'blended', label: 'Blended', data: ranked, valFn: t => t.healthScore, fmtFn: v => v, colFn: v => v >= 90 ? 'var(--gold)' : v >= 80 ? 'var(--good)' : v >= 70 ? 'var(--warn)' : 'var(--bad)', subFn: t => t.tier },
                { key: 'contender', label: 'Contender', data: contenderRanked, valFn: t => t.ppg, fmtFn: v => v > 0 ? v.toFixed(1) : '\u2014', colFn: (v, i) => i < 3 ? 'var(--good)' : i < 8 ? 'var(--silver)' : 'var(--bad)', subFn: t => (t.ppg > 0 ? t.ppg.toFixed(1) + ' PPG' : '') },
                { key: 'dynasty', label: 'Dynasty', data: dynastyRanked, valFn: t => t.totalDhq, fmtFn: v => v > 0 ? (v/1000).toFixed(1)+'K' : '\u2014', colFn: (v, i) => i < 3 ? 'var(--good)' : i < 8 ? 'var(--silver)' : 'var(--bad)', subFn: t => (t.totalDhq > 0 ? t.totalDhq.toLocaleString() + ' DHQ' : '') },
              ];
              const prView = window._wrPrView || 'blended';
              const view = views.find(v => v.key === prView) || views[0];

              return <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' }}>POWER RANKINGS</div>
                  <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                    {views.map(v => <button key={v.key} onClick={() => { window._wrPrView = v.key; setTimeRecomputeTs(Date.now()); }} style={{ padding: '3px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', borderRadius: '4px', cursor: 'pointer', border: '1px solid ' + (prView === v.key ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: prView === v.key ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: prView === v.key ? 'var(--gold)' : 'var(--silver)' }}>{v.label}</button>)}
                  </div>
                </div>
                <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '10px', overflow: 'hidden' }}>
                  {(() => {
                    const top5 = view.data.slice(0, 5);
                    const myIdx = view.data.findIndex(t => t.ownerId === sleeperUserId);
                    const showMe = myIdx >= 5;
                    const displayData = showMe ? [...top5, view.data[myIdx]] : top5;
                    const remaining = view.data.length - displayData.length;
                    return <React.Fragment>
                      {displayData.map((t, di) => {
                        const i = view.data.indexOf(t);
                        const isMe = t.ownerId === sleeperUserId;
                        const val = view.valFn(t);
                        const maxVal = view.valFn(view.data[0]) || 1;
                        const pct = Math.min(100, Math.round((val / maxVal) * 100));
                        return (
                          <div key={t.rosterId} className={isMe ? 'wr-my-row' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', background: isMe ? 'var(--acc-fill1, rgba(212,175,55,0.04))' : 'transparent', ...(showMe && di === 5 ? { borderTop: '1px dashed var(--acc-line1, rgba(212,175,55,0.2))' } : {}) }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: i < 3 ? 'var(--gold)' : 'var(--silver)', width: '20px', textAlign: 'center' }}>{i + 1}</span>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.ownerName}{isMe ? ' (You)' : ''}</span>
                            </div>
                            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, flexShrink: 0 }}>{t.tier}</span>
                            <div style={{ width: '60px', height: '5px', borderRadius: '3px', background: 'var(--ov-4, rgba(255,255,255,0.06))', overflow: 'hidden', flexShrink: 0 }}>
                              <div style={{ width: pct + '%', height: '100%', borderRadius: '3px', background: view.colFn(val, i) }}></div>
                            </div>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: view.colFn(val, i), width: '36px', textAlign: 'right' }}>{view.fmtFn(val)}</span>
                          </div>
                        );
                      })}
                      {remaining > 0 && <div style={{ padding: '6px 10px', fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.5, textAlign: 'center' }}>and {remaining} more teams</div>}
                    </React.Fragment>;
                  })()}
                </div>
              </div>;
            })()}

            {/* Phase 8 deferred: Top Trade Targets card removed per user feedback (2026-04-18).
                The Overview mode is unreachable after League Map was pulled from the nav,
                but dead code here was still evaluating tradeTargets on every render. */}

          </div>
        );
      })()}

      {/* Analyst View: Teams / All Players / Draft Picks / Custom Reports */}
      {_activeViewTab === 'analyst' && <React.Fragment>
      {/* Sub-view tab bar — hidden when embedded inside Analytics (Analytics provides its own tabs) */}
      {!_isEmbed && <div className="wr-module-nav" style={{ marginBottom: '12px' }}>
        <button className={leagueSubView === 'players' ? 'is-active' : ''} onClick={() => setLeagueSubView('players')}>All Players</button>
        <button className={leagueSubView === 'picks' ? 'is-active' : ''} onClick={() => setLeagueSubView('picks')}>Draft Picks</button>
        <button className={leagueSubView === 'reports' ? 'is-active' : ''} onClick={() => setLeagueSubView('reports')}>Custom Reports</button>
      </div>}
      {/* Combined Players & Picks screen (Analytics 'assets' sub-tab): internal segmented toggle. */}
      {_activeSubView === 'assets' && <div className="wr-module-nav" style={{ marginBottom: '12px' }}>
        <button className={assetsView === 'players' ? 'is-active' : ''} onClick={() => setAssetsView('players')}>All Players</button>
        <button className={assetsView === 'picks' ? 'is-active' : ''} onClick={() => setAssetsView('picks')}>Draft Picks</button>
      </div>}
      {_activeSubView === 'teams' && (<div>
      <div className="wr-module-toolbar">
        <span className="wr-module-toolbar-label">Sort</span>
        <div className="wr-module-nav">
        <button className={leagueSort === 'wins' ? 'is-active' : ''} onClick={() => setLeagueSort('wins')}>Wins</button>
        <button className={leagueSort === 'dhq' ? 'is-active' : ''} onClick={() => setLeagueSort('dhq')}>DHQ Value</button>
        <button className={leagueSort === 'health' ? 'is-active' : ''} onClick={() => setLeagueSort('health')}>Health Score</button>
        <button className={leagueSort === 'champs' ? 'is-active' : ''} onClick={() => setLeagueSort('champs')}>Championships</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
        {sortedStandings.map(team => {
          const roster = currentLeague.rosters.find(r => r.owner_id === team.userId);
          const totalDHQ = (roster?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
          const isMe = team.userId === sleeperUserId;
          const user = currentLeague.users?.find(u => u.user_id === team.userId);
          return (
            <div key={team.rosterId} role="button" tabIndex={0} title="Open team context" onClick={() => openLeagueTeamContext(team, roster)} onKeyDown={e => handleLeagueTeamKey(e, team, roster)}
              style={{
                background: 'var(--black)', border: '2px solid ' + (isMe ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                borderRadius: '10px', padding: '14px', cursor: 'pointer',
                transition: 'all 0.15s', outline: 'none'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = isMe ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                {user?.avatar && <img src={'https://sleepercdn.com/avatars/thumbs/' + user.avatar} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: isMe ? 'var(--gold)' : 'var(--white)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {team.displayName}{isMe ? ' (You)' : ''}
                    {(() => {
                      const champs = window.App?.LI?.championships || {};
                      const champCount = Object.values(champs).filter(c => c.champion === roster?.roster_id).length;
                      if (champCount > 0) return <span style={{ fontSize: '0.7rem', color: 'var(--gold)', fontWeight: 700 }}>{champCount > 1 ? champCount + 'x ' : ''}Champion</span>;
                      return null;
                    })()}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--silver)', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {roster?.settings?.wins ?? team.wins}-{roster?.settings?.losses ?? team.losses}{(roster?.settings?.ties > 0) ? '-' + roster.settings.ties : ''}{roster?.settings?.fpts ? ' (' + roster.settings.fpts + ' PF)' : ''} {'\u00B7'} {totalDHQ > 0 ? (totalDHQ/1000).toFixed(0) + 'k DHQ' : '\u2014'}
                    {(() => {
                      const hist = window.App?.LI?.leagueUsersHistory || {};
                      let yrs = 0;
                      Object.values(hist).forEach(users => { (users || []).forEach(u => { if (u.user_id === team.userId) yrs++; }); });
                      if (yrs <= 1) return <span style={{ fontSize: '0.76rem', color: 'var(--warn)', fontWeight: 700, marginLeft: '4px' }}>NEW</span>;
                      if (yrs >= 4) return <span style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.6, marginLeft: '4px' }}>{yrs}yr</span>;
                      return null;
                    })()}
                  </div>
                  {(() => {
                    const oh = typeof buildOwnerHistory === 'function' ? buildOwnerHistory() : {};
                    const h = oh[roster?.roster_id];
                    if (!h || (!h.playoffWins && !h.playoffLosses && !h.totalTrades)) return null;
                    return (
                      <div style={{ fontSize: '0.76rem', color: 'var(--silver)', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', opacity: 0.7 }}>
                        {(h.playoffWins > 0 || h.playoffLosses > 0) && <span>Playoffs {h.playoffRecord}</span>}
                        {(h.playoffWins > 0 || h.playoffLosses > 0) && h.totalTrades > 0 && <span>{'\u00B7'}</span>}
                        {h.totalTrades > 0 && <span>{h.totalTrades} trades</span>}
                      </div>
                    );
                  })()}
                </div>
              </div>
              {(() => {
                const rPlayers = roster?.players || [];
                const scored = rPlayers.map(pid => ({ pid, dhq: window.App?.LI?.playerScores?.[pid] || 0, meta: window.App?.LI?.playerMeta?.[pid] }));
                const eliteCount = typeof window.App?.countElitePlayers === 'function' ? window.App.countElitePlayers(scored.map(x => x.pid)) : scored.filter(x => x.dhq >= 7000).length;
                const ages = scored.map(x => x.meta?.age).filter(a2 => a2 && a2 > 18 && a2 < 45);
                const avgAge = ages.length > 0 ? (ages.reduce((s,a2) => s + a2, 0) / ages.length).toFixed(1) : '\u2014';
                // Positional needs: positions where team is below league avg investment
                const posNeeds = [];
                const LIx = window.App?.LI;
                if (LIx?.playerMeta) {
                  const posDhq = {};
                  scored.forEach(x => { const pos2 = x.meta?.pos || 'UNK'; posDhq[pos2] = (posDhq[pos2] || 0) + x.dhq; });
                  const teamTotal = scored.reduce((s,x) => s + x.dhq, 0) || 1;
                  const needPositions = typeof window.getLeaguePositions === 'function'
                    ? window.getLeaguePositions({ league: currentLeague })
                    : ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
                  needPositions.forEach(pos2 => {
                    const pct = (posDhq[pos2] || 0) / teamTotal;
                    if (pct < 0.10) posNeeds.push(pos2);
                  });
                }
                // Status tag from assessment
                const teamAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(roster?.roster_id) : null;
                const tier2 = (teamAssess?.tier || '').toUpperCase();
                const tierCol2 = tier2 === 'ELITE' ? 'var(--gold)' : tier2 === 'CONTENDER' ? 'var(--good)' : tier2 === 'CROSSROADS' ? 'var(--warn)' : tier2 === 'REBUILDING' ? 'var(--bad)' : 'var(--silver)';
                const hs2 = teamAssess?.healthScore || 0;

                return (
                  <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.4 }}>
                    {/* Status tag + health */}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                      {tier2 && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: tierCol2, background: wrAlpha(tierCol2, '15'), padding: '1px 8px', borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>{tier2}</span>}
                      {hs2 > 0 && <span style={{ fontSize: '0.72rem', color: hs2 >= 75 ? 'var(--good)' : hs2 >= 55 ? 'var(--warn)' : 'var(--bad)', fontWeight: 600 }}>{hs2} health</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', opacity: 0.7 }}>
                      <span>{rPlayers.length} players</span>
                      <span>{'\u00B7'} Avg {avgAge}yr</span>
                      <span>{'\u00B7'} {eliteCount} elite</span>
                    </div>
                    {posNeeds.length > 0 && <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      {posNeeds.map(pos2 => <span key={pos2} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--bad)', background: 'rgba(231,76,60,0.1)', padding: '1px 6px', borderRadius: '3px', fontWeight: 600 }}>Need {leagueMapPosLabel(pos2)}</span>)}
                    </div>}
                    {scored.sort((a2,b2) => b2.dhq - a2.dhq).slice(0, 3).map(x => (
                      <div key={x.pid} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{playersData[x.pid]?.full_name || '?'}</span>
                        <span style={{ color: x.dhq >= 7000 ? 'var(--good)' : x.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : 'var(--silver)', fontFamily: 'var(--font-body)' }}>{x.dhq > 0 ? x.dhq.toLocaleString() : '\u2014'}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
      </div>)}
	      {(_activeSubView === 'players' || (_activeSubView === 'assets' && assetsView === 'players')) && (() => {
	        const posColors = window.App.POS_COLORS;
	        const allPlayers = [];
	        const rosteredPlayerIds = new Set();
	        (currentLeague.rosters || []).forEach(r => {
	            const user = currentLeague.users?.find(u => u.user_id === r.owner_id);
	            const teamName = user?.display_name || user?.username || 'Team';
	            (r.players || []).forEach(pid => {
	                const p = playersData[pid]; if (!p) return;
	                rosteredPlayerIds.add(String(pid));
	                const dhq = window.App?.LI?.playerScores?.[pid] || 0;
	                const pos = normPos(p.position) || p.position;
	                const st = statsData[pid] || {};
	                const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
	                allPlayers.push({ pid, p, pos, dhq, ppg, age: p.age || null, teamName, rosterId: r.roster_id, isMe: r.roster_id === myRoster?.roster_id });
	            });
	        });
	        // Pre-draft pool: surface undrafted players (incl. rookies) before a draft.
	        // Fire whenever the league is in its pre-draft phase REGARDLESS of skin family —
	        // dynasty/long-term leagues have isSeasonal === false, so the old isSeasonal-gated
	        // condition meant rookies never showed up pre-draft in dynasty leagues.
	        const isPreDraftPhase = !!(resolvedLeagueSkin?.state?.isPreDraft || resolvedLeagueSkin?.state?.isPreDraftRosterEmpty);
	        const shouldShowDraftPool = isPreDraftPhase || !!(resolvedLeagueSkin?.state?.isSeasonal && allPlayers.length === 0);
	        if (shouldShowDraftPool) {
	            const leaguePositions = typeof window.getLeaguePositions === 'function'
	                ? window.getLeaguePositions({ league: currentLeague })
	                : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
	            const validPositions = new Set((leaguePositions || [])
	                .map(pos => normPos(pos) || pos)
	                .map(pos => pos === 'DST' || pos === 'D/ST' ? 'DEF' : pos)
	                .filter(pos => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos)));
	            Object.entries(playersData || {}).forEach(([pid, p]) => {
	                if (!p || rosteredPlayerIds.has(String(pid))) return;
	                const pos = normPos(p.position) || p.position;
	                if (!validPositions.has(pos)) return;
	                // Keep incoming rookies (years_exp === 0) even if Sleeper still flags them
                // inactive — they haven't debuted yet but must be visible in the pre-draft pool.
                if (p.active === false && pos !== 'DEF' && p.years_exp !== 0) return;
	                const dhq = window.App?.LI?.playerScores?.[pid] || 0;
	                const st = statsData[pid] || {};
	                const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
	                allPlayers.push({ pid, p, pos, dhq, ppg, age: p.age || null, teamName: 'Draft Pool', rosterId: null, isMe: false, isPool: true });
	            });
	        }
        let filtered = allPlayers;
        // Phase 8 deferred: free-text search across player name + owner team
        const q = (lpSearch || '').toLowerCase().trim();
        if (q) {
            filtered = filtered.filter(x => {
                const name = (x.p.full_name || ((x.p.first_name || '') + ' ' + (x.p.last_name || '')).trim()).toLowerCase();
                const team = (x.teamName || '').toLowerCase();
                return name.includes(q) || team.includes(q);
            });
        }
        if (lpFilter === '__ROOKIE__') filtered = filtered.filter(x => x.p.years_exp === 0);
        else if (lpFilter) filtered = filtered.filter(x => x.pos === lpFilter);
        filtered.sort((a, b) => {
            const { key, dir } = lpSort;
            if (key === 'dhq') return (a.dhq - b.dhq) * dir;
            if (key === 'age') return ((a.age||99) - (b.age||99)) * dir;
            if (key === 'ppg') return (a.ppg - b.ppg) * dir;
            if (key === 'name') return (a.p.full_name||'').localeCompare(b.p.full_name||'') * dir;
            if (key === 'team') return a.teamName.localeCompare(b.teamName) * dir;
            return 0;
        });
        const playerSummary = {
            total: allPlayers.length,
            elite: allPlayers.filter(x => typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(x.pid) : x.dhq >= 7000).length,
            mine: allPlayers.filter(x => x.isMe).length,
            avgDhq: Math.round(allPlayers.reduce((s, x) => s + (x.dhq || 0), 0) / Math.max(1, allPlayers.length)),
        };
        const posLeader = Object.entries(allPlayers.reduce((acc, x) => {
            acc[x.pos] = (acc[x.pos] || 0) + 1;
            return acc;
        }, {})).sort((a, b) => b[1] - a[1])[0];
        return (
            <div>
                {_analyticsEmbed && (
                    <div className="analytics-embed-summary">
                        <div><span>Player Pool</span><strong>{playerSummary.total.toLocaleString()}</strong><em>{filtered.length.toLocaleString()} shown</em></div>
                        <div><span>Elite Assets</span><strong>{playerSummary.elite}</strong><em>7000+ DHQ or top 5 pos</em></div>
                        <div><span>Your Roster</span><strong>{playerSummary.mine}</strong><em>owned players in table</em></div>
                        <div><span>Avg DHQ</span><strong>{playerSummary.avgDhq.toLocaleString()}</strong><em>{posLeader ? posLeader[0] + ' is deepest room' : 'all positions'}</em></div>
                    </div>
                )}
                {_analyticsEmbed && (
                    <div className="analytics-evidence-head">
                        <div>
                            <span>Evidence Layer</span>
                            <strong>Player market ledger</strong>
                            <em>Sorted high-to-low by DHQ by default; use this table to verify owner/player signals from the dashboards above.</em>
                        </div>
                        <div className="analytics-evidence-meta">{filtered.length.toLocaleString()} rows</div>
                    </div>
                )}
                {/* Phase 8 deferred: search + position chips + SavedViewBar */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                        type="text"
                        value={lpSearch || ''}
                        onChange={e => setLpSearch && setLpSearch(e.target.value)}
                        placeholder="Search by player name or owner…"
                        style={{ flex: '0 1 260px', padding: '5px 10px', fontSize: '0.76rem', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: '4px', color: 'var(--white)', fontFamily: 'var(--font-body)', outline: 'none', minHeight: '44px' }}
                    />
                    {['','QB','RB','WR','TE','K','DEF','DL','LB','DB'].map(pos => (
                        <button key={pos} onClick={() => setLpFilter(pos)} style={{
                            padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', textTransform: 'uppercase',
                            background: lpFilter === pos ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                            color: lpFilter === pos ? 'var(--black)' : 'var(--silver)',
                            border: '1px solid ' + (lpFilter === pos ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                            borderRadius: '3px', cursor: 'pointer', minHeight: '44px'
                        }}>{pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'All'}</button>
                    ))}
                    {/* Rookies quick-filter — surfaces years_exp===0 players (e.g. the pre-draft rookie pool). */}
                    <button onClick={() => setLpFilter(lpFilter === '__ROOKIE__' ? '' : '__ROOKIE__')} style={{
                        padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', textTransform: 'uppercase',
                        background: lpFilter === '__ROOKIE__' ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                        color: lpFilter === '__ROOKIE__' ? 'var(--black)' : 'var(--silver)',
                        border: '1px solid ' + (lpFilter === '__ROOKIE__' ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                        borderRadius: '3px', cursor: 'pointer', minHeight: '44px'
                    }}>Rookies</button>
                    <span style={{ fontSize: '0.72rem', color: 'var(--silver)', alignSelf: 'center' }}>{filtered.length} players</span>
                    {/* Rolling PPG window selector */}
                    <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.65, fontFamily: 'var(--font-body)' }}>PPG:</span>
                    {[{k:'season',l:'Season'},{k:'l5',l:'L5'},{k:'l3',l:'L3'}].map(opt => (
                        <button key={opt.k} onClick={() => setPpgWindow(opt.k)} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games'} style={{
                            padding: '3px 8px', fontSize: '0.7rem', fontWeight: ppgWindow === opt.k ? 700 : 400,
                            fontFamily: 'var(--font-body)', textTransform: 'uppercase',
                            background: ppgWindow === opt.k ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                            color: ppgWindow === opt.k ? 'var(--black)' : 'var(--silver)',
                            border: '1px solid ' + (ppgWindow === opt.k ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                            borderRadius: '3px', cursor: 'pointer', letterSpacing: '0.03em', minHeight: '44px'
                        }}>{opt.l}</button>
                    ))}
                    {/* Column picker */}
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setAllPlayersColPickerOpen(o => !o)} style={{
                            padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-body)',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.1))', color: 'var(--gold)',
                            border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '3px', cursor: 'pointer',
                        }}>⚙ Columns ({allPlayersCols.length})</button>
                        {allPlayersColPickerOpen && (
                            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--black)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', padding: '8px', zIndex: 20, minWidth: '180px', boxShadow: '0 6px 20px rgba(0,0,0,0.6)' }}>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '6px' }}>Visible Columns</div>
                                {ALL_PLAYERS_COLUMNS.map(c => {
                                    const on = allPlayersCols.includes(c.key);
                                    return (
                                        <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: '0.72rem', color: 'var(--silver)', cursor: c.toggleable === false ? 'not-allowed' : 'pointer', opacity: c.toggleable === false ? 0.6 : 1 }}>
                                            <input type="checkbox" checked={on} disabled={c.toggleable === false} onChange={() => {
                                                if (c.toggleable === false) return;
                                                setAllPlayersCols(prev => prev.includes(c.key) ? prev.filter(k => k !== c.key) : [...prev, c.key]);
                                            }} />
                                            {c.label}
                                        </label>
                                    );
                                })}
                                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', borderTop: '1px solid var(--ov-5, rgba(255,255,255,0.08))', paddingTop: '6px' }}>
                                    <button onClick={() => setAllPlayersCols(ALL_PLAYERS_COLUMNS.map(c => c.key))} style={{ flex: 1, padding: '4px', fontSize: 'var(--text-micro, 0.6875rem)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: '3px', color: 'var(--silver)', cursor: 'pointer', fontFamily: 'inherit' }}>All</button>
                                    <button onClick={() => setAllPlayersCols(ALL_PLAYERS_DEFAULT_VISIBLE.slice())} style={{ flex: 1, padding: '4px', fontSize: 'var(--text-micro, 0.6875rem)', background: 'var(--acc-fill3, rgba(212,175,55,0.15))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '3px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
                                </div>
                            </div>
                        )}
                    </div>
                    {window.WR?.SavedViews?.SavedViewBar && (
                        <div style={{ marginLeft: 'auto' }}>
                            {React.createElement(window.WR.SavedViews.SavedViewBar, {
                                surface: 'all_players',
                                leagueId: currentLeague?.id || currentLeague?.league_id,
                                currentState: { columns: allPlayersCols, sort: lpSort, filters: { lpFilter, lpSearch: lpSearch || '' } },
                                onApply: v => {
                                    if (Array.isArray(v.columns) && v.columns.length) setAllPlayersCols(v.columns);
                                    if (v.sort && v.sort.key) setLpSort({ key: v.sort.key, dir: v.sort.dir || -1 });
                                    if (v.filters) {
                                        if (typeof v.filters.lpFilter === 'string') setLpFilter(v.filters.lpFilter);
                                        if (typeof v.filters.lpSearch === 'string' && setLpSearch) setLpSearch(v.filters.lpSearch);
                                    }
                                },
                            })}
                        </div>
                    )}
                </div>
                {(() => {
                    const activeCols = ALL_PLAYERS_COLUMNS.filter(c => allPlayersCols.includes(c.key));
                    const gridTpl = ['24px', '28px'].concat(activeCols.map(c => c.width)).join(' ');
                    // Sum fixed (px) column widths + index/avatar cols + a 140px floor for the 1fr name col,
                    // so wide column selections scroll horizontally inside the card on iPad instead of crushing the name column.
                    const fixedColPx = activeCols.reduce((sum, c) => sum + (/px$/.test(c.width) ? parseInt(c.width, 10) : 0), 0);
                    const gridMinWidth = (24 + 28 + 140 + fixedColPx + (activeCols.length + 2) * 4) + 'px';
                    const tierOf = (rid) => {
                        const h = window.App?.LI?.teamHealth?.[rid];
                        return h?.tier || '';
                    };
                    const peakYrsOf = (x) => {
                        const pw = window.App?.peakWindows?.[x.pos];
                        if (!pw || !x.age) return null;
                        return Math.max(0, pw[1] - x.age);
                    };
                    return (
                <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: gridTpl, gap: '4px', padding: '6px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', minWidth: gridMinWidth }}>
                        <span>#</span><span></span>
                        {activeCols.map(c => {
                            if (c.sortable && c.sortKey) {
                                const isActive = lpSort.key === c.sortKey;
                                return (
                                    <span key={c.key} style={{ cursor: 'pointer' }} onClick={() => setLpSort(prev => prev.key === c.sortKey ? { ...prev, dir: prev.dir * -1 } : { key: c.sortKey, dir: c.sortKey === 'team' ? 1 : -1 })}>
                                        {c.label}{isActive ? (lpSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''}
                                    </span>
                                );
                            }
                            if (c.key === 'name') {
                                const isActive = lpSort.key === 'name';
                                return (
                                    <span key={c.key} style={{ cursor: 'pointer' }} onClick={() => setLpSort(prev => prev.key === 'name' ? { ...prev, dir: prev.dir * -1 } : { key: 'name', dir: 1 })}>
                                        {c.label}{isActive ? (lpSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''}
                                    </span>
                                );
                            }
                            if (c.key === 'age') {
                                const isActive = lpSort.key === 'age';
                                return (
                                    <span key={c.key} style={{ cursor: 'pointer' }} onClick={() => setLpSort(prev => prev.key === 'age' ? { ...prev, dir: prev.dir * -1 } : { key: 'age', dir: 1 })}>
                                        {c.label}{isActive ? (lpSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''}
                                    </span>
                                );
                            }
                            return <span key={c.key}>{c.label}</span>;
                        })}
                    </div>
                    <div style={_analyticsEmbed ? { minWidth: gridMinWidth } : { maxHeight: '600px', overflowY: 'auto', minWidth: gridMinWidth }}>
                        {filtered.map((x, idx) => {
                            const pw = window.App?.peakWindows?.[x.pos];
                            let peakColor = 'var(--ov-6, rgba(255,255,255,0.15))';
                            let peakPct = 0;
                            if (pw && x.age) {
                                const [lo, hi] = pw;
                                const range = hi - lo;
                                peakPct = Math.max(0, Math.min(1, (x.age - lo) / range));
                                if (x.age >= lo && x.age <= hi) peakColor = 'var(--good)';
                                else if (x.age >= lo - 2 && x.age <= hi + 2) peakColor = 'var(--k-f1c40f, #f1c40f)';
                                else peakColor = 'var(--bad)';
                            }
	                            const acq = x.isPool ? { method: 'Draft Pool', date: '' } : getAcquisitionInfo(x.pid, x.rosterId);
	                            const acqMethod = acq?.method || (acq?.type === 'draft' ? 'Drafted' : acq?.type === 'trade' ? 'Traded' : acq?.type === 'add' ? 'FA' : '—');
	                            const acqDate = acq?.date || '';
	                            const acqColor = acqMethod === 'Draft Pool' ? 'var(--gold)' : acqMethod === 'Drafted' ? 'var(--k-3498db, #3498db)' : acqMethod === 'Traded' ? 'var(--warn)' : (acqMethod === 'FA' || acqMethod === 'Waiver') ? 'var(--good)' : 'var(--ov-7, rgba(255,255,255,0.25))';
                            const yrs = peakYrsOf(x);
                            const tier = tierOf(x.rosterId);
                            const yoe = x.p.years_exp != null ? x.p.years_exp : '';
                            const renderCell = (c) => {
                                switch (c.key) {
                                    case 'name':
                                        return <div key={c.key} style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 600, color: x.isMe ? 'var(--gold)' : 'var(--white)' }}>{x.p.full_name || (x.p.first_name + ' ' + x.p.last_name).trim()}</div>;
                                    case 'pos':
                                        return <span key={c.key} style={{ fontSize: '0.7rem', fontWeight: 700, color: posColors[x.pos] || 'var(--silver)' }}>{leagueMapPosLabel(x.pos)}</span>;
                                    case 'nflTeam':
                                        return <span key={c.key} style={{ color: 'var(--silver)', fontSize: '0.7rem' }}>{x.p.team || '\u2014'}</span>;
                                    case 'age':
                                        return <span key={c.key} style={{ color: 'var(--silver)' }}>{x.age || '\u2014'}</span>;
                                    case 'yoe':
                                        return <span key={c.key} style={{ color: 'var(--silver)' }}>{yoe === '' ? '\u2014' : yoe}</span>;
                                    case 'peak':
                                        return (
                                            <span key={c.key} style={{ display: 'flex', alignItems: 'center' }}>
                                                {pw && x.age ? (
                                                    <div style={{ width: '100%', height: '6px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', position: 'relative', overflow: 'hidden' }}>
                                                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: (peakPct * 100) + '%', background: peakColor, borderRadius: '3px', transition: 'width 0.2s' }} />
                                                    </div>
                                                ) : <span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))', fontSize: 'var(--text-micro, 0.6875rem)' }}>{'\u2014'}</span>}
                                            </span>
                                        );
                                    case 'peakYrs':
                                        return <span key={c.key} style={{ color: 'var(--silver)' }}>{yrs == null ? '\u2014' : yrs}</span>;
                                    case 'dhq':
                                        return <span key={c.key} style={{ fontWeight: 700, fontFamily: 'var(--font-body)', color: x.dhq >= 7000 ? 'var(--good)' : x.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : x.dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{x.dhq > 0 ? x.dhq.toLocaleString() : '\u2014'}</span>;
                                    case 'ppg': {
                                        let shown = x.ppg;
                                        let marker = '';
                                        if (ppgWindow !== 'season') {
                                            const n = ppgWindow === 'l3' ? 3 : 5;
                                            const rolling = typeof window.App?.computeRollingPPG === 'function'
                                                ? window.App.computeRollingPPG(x.pid, n)
                                                : 0;
                                            if (rolling > 0) { shown = rolling; marker = ' · L' + n; }
                                            else { marker = ' · Szn'; }
                                        }
                                        return <span key={c.key} style={{ color: 'var(--silver)' }}>{shown || '\u2014'}{marker}</span>;
                                    }
                                    case 'tier':
                                        return <span key={c.key} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: tier === 'ELITE' ? 'var(--good)' : tier === 'CONTENDER' ? 'var(--k-3498db, #3498db)' : tier === 'REBUILDING' ? 'var(--bad)' : 'var(--silver)', fontWeight: 700, letterSpacing: '0.04em' }}>{tier || '\u2014'}</span>;
                                    case 'owner':
                                        return <span key={c.key} style={{ fontSize: '0.74rem', color: x.isMe ? 'var(--gold)' : 'var(--silver)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.teamName}{x.isMe ? ' (You)' : ''}</span>;
                                    case 'acq':
                                        return <span key={c.key} title={acqDate} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: acqColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acqMethod}{acqDate ? ' · ' + acqDate : ''}</span>;
                                    default:
                                        return <span key={c.key}></span>;
                                }
                            };
                            const isExpanded = String(allPlayersExpandedPid) === String(x.pid);
                            const rowBg = isExpanded ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : x.isMe ? 'var(--acc-fill1, rgba(212,175,55,0.04))' : 'transparent';
                            return (
                            <React.Fragment key={x.pid}>
                            <div onClick={() => setAllPlayersExpandedPid(prev => String(prev) === String(x.pid) ? null : x.pid)}
                                style={{ display: 'grid', gridTemplateColumns: gridTpl, gap: '4px', padding: '5px 10px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', cursor: 'pointer', fontSize: '0.72rem', alignItems: 'center', background: rowBg, transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'}
                                onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--silver)', fontFamily: 'var(--font-body)' }}>{idx+1}</span>
                                <div style={{ width: '22px', height: '22px', flexShrink: 0 }}><img src={'https://sleepercdn.com/content/nfl/players/thumb/'+x.pid+'.jpg'} onError={e=>e.target.style.display='none'} style={{ width:'22px',height:'22px',borderRadius:'50%',objectFit:'cover' }} /></div>
                                {activeCols.map(renderCell)}
                            </div>
                            {isExpanded && <RosterPlayerDossier x={x} playersData={playersData} statsData={statsData} currentLeague={currentLeague} normPos={normPos} onCollapse={() => setAllPlayersExpandedPid(null)} />}
                            </React.Fragment>
                            );
                        })}
                    </div>
                </div>
                    );
                })()}
            </div>
        );
      })()}
	      {(_activeSubView === 'picks' || (_activeSubView === 'assets' && assetsView === 'picks')) && (() => {
		        const tradedPicks = _sTradedPicks;
		        const leagueSeason = parseInt(currentLeague.season || activeYear);
		        const draftRounds = window.App?.LeagueSkin?.resolveDraftRounds?.({
		            league: currentLeague,
		            leagueSkin: resolvedLeagueSkin,
		            drafts: window.S?.drafts || currentLeague?.drafts || [],
		            fallbackRounds: currentLeague.settings?.draft_rounds || 5,
		        }) || currentLeague.settings?.draft_rounds || 5;
		        const years = skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2];
	        const totalTeams = currentLeague.rosters?.length || 12;
        const sortedRosters = [...(currentLeague.rosters || [])].sort((a, b) => {
            const stA = standings.find(s => { const rr = currentLeague.rosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, a.roster_id); });
            const stB = standings.find(s => { const rr = currentLeague.rosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, b.roster_id); });
            const wA = stA?.wins ?? (a.settings?.wins ?? 0);
            const wB = stB?.wins ?? (b.settings?.wins ?? 0);
            if (wA !== wB) return wA - wB;
            return (stA?.losses ?? (a.settings?.losses ?? 0)) - (stB?.losses ?? (b.settings?.losses ?? 0));
        });
        const pickOrder = {};
        sortedRosters.forEach((r, i) => { pickOrder[String(r.roster_id)] = i + 1; });
        const discountSlotValue = (value, yr) => {
            const curYear = parseInt(window.S?.season || currentLeague.season || activeYear, 10) || new Date().getFullYear();
            const pickYear = parseInt(yr, 10) || curYear;
            const yearsAhead = Math.max(0, pickYear - curYear);
            return Math.round(value * Math.pow(0.88, yearsAhead));
        };
        const pickValue = (yr, rd, slotInRound) => {
            const slot = Math.max(1, Math.min(Number(slotInRound) || Math.ceil(totalTeams / 2), totalTeams));
            const overall = (rd - 1) * totalTeams + slot;
            let value = 0;
            if (typeof window.getPickValueBySlot === 'function') value = window.getPickValueBySlot(rd, slot, totalTeams, draftRounds);
            if (!value && typeof window.getIndustryPickValue === 'function') value = window.getIndustryPickValue(overall, totalTeams, draftRounds);
            if (!value) value = window.App?.PlayerValue?.PICK_VALUES_BY_SLOT?.[overall] || 0;
            if (!value) value = window.App?.LI?.dhqPickValueFn?.(yr, rd, slot) || 0;
            if (value > 0) return discountSlotValue(value, yr);
            return window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || Math.max(100, 9000 - rd * 1600);
        };
        const pickRows = years.flatMap(yr => Array.from({ length: draftRounds }, (_, rd) => rd + 1).flatMap(rd => {
            return sortedRosters.map(r => {
                const originalRid = r.roster_id;
                const pickInRound = pickOrder[String(originalRid)] || 1;
                const trade = tradedPicks.find(tp =>
                    sameId(tp.season, yr) &&
                    Number(tp.round) === rd &&
                    sameId(tp.roster_id, originalRid)
                );
                const currentOwnerRid = trade ? trade.owner_id : originalRid;
                const traded = !!trade && !sameId(trade.owner_id, originalRid);
                const isMyPick = sameId(currentOwnerRid, myRoster?.roster_id);
                const isMyOriginal = sameId(originalRid, myRoster?.roster_id);
                const status = !traded ? 'Own' : isMyPick ? 'Acquired' : isMyOriginal ? 'Traded Away' : 'Moved';
                return {
                    year: yr,
                    round: rd,
                    originalRid,
                    currentOwnerRid,
                    traded,
                    isMyPick,
                    isMyOriginal,
                    status,
                    value: pickValue(yr, rd, pickInRound),
                    label: rd + '.' + String(pickInRound).padStart(2, '0'),
                };
            });
        }));
        const filteredRows = pickRows.filter(row => {
            if (pickYearFilter !== 'all' && String(row.year) !== String(pickYearFilter)) return false;
            if (pickOwnerFilter !== 'all' && !sameId(row.currentOwnerRid, pickOwnerFilter)) return false;
            if (pickStatusFilter === 'mine' && !row.isMyPick) return false;
            if (pickStatusFilter === 'traded' && !row.traded) return false;
            if (pickStatusFilter === 'acquired' && row.status !== 'Acquired') return false;
            if (pickStatusFilter === 'away' && row.status !== 'Traded Away') return false;
            return true;
        });
        const myRows = pickRows.filter(row => row.isMyPick);
        const myValue = myRows.reduce((s, row) => s + (row.value || 0), 0);
        const ownerSummary = {};
        pickRows.forEach(row => {
            const key = String(row.currentOwnerRid);
            if (!ownerSummary[key]) ownerSummary[key] = { rid: row.currentOwnerRid, count: 0, value: 0 };
            ownerSummary[key].count++;
            ownerSummary[key].value += row.value || 0;
        });
        const leaders = Object.values(ownerSummary).sort((a, b) => b.value - a.value).slice(0, 4);

        // Use shared getOwnerName() defined above

        return (
            <div>
                {_analyticsEmbed && (
                    <div className="analytics-embed-summary">
                        <div><span>My Pick Capital</span><strong>{myValue.toLocaleString()}</strong><em>{myRows.length} slot-adjusted picks</em></div>
	                        <div><span>Early Picks</span><strong>{myRows.filter(r => r.round <= 2).length}</strong><em>{years.length === 1 ? 'R1-R2 this draft' : 'R1-R2 through ' + (leagueSeason + 2)}</em></div>
                        <div><span>Traded Picks</span><strong>{pickRows.filter(r => r.traded).length}</strong><em>league-wide moved picks</em></div>
                        <div><span>Capital Leader</span><strong>{leaders[0] ? getOwnerName(leaders[0].rid) : '\u2014'}</strong><em>{leaders[0] ? leaders[0].value.toLocaleString() + ' DHQ' : 'no data'}</em></div>
                    </div>
                )}
                {_analyticsEmbed && (
                    <div className="analytics-evidence-head">
                        <div>
                            <span>Evidence Layer</span>
                            <strong>Slot-adjusted pick ledger</strong>
                            <em>Values are estimated from projected draft slot, current owner, original owner, and future-year discount.</em>
                        </div>
                        <div className="analytics-evidence-meta">{filteredRows.length.toLocaleString()} picks</div>
                    </div>
                )}
                <div className="analytics-filter-row">
                    <select value={pickYearFilter} onChange={e => setPickYearFilter(e.target.value)}>
                        <option value="all">All Years</option>
                        {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
                    </select>
                    <select value={pickOwnerFilter} onChange={e => setPickOwnerFilter(e.target.value)}>
                        <option value="all">All Owners</option>
                        {(currentLeague.rosters || []).map(r => <option key={r.roster_id} value={r.roster_id}>{getOwnerName(r.roster_id)}</option>)}
                    </select>
                    {[
                        ['all', 'All Picks'],
                        ['mine', 'My Picks'],
                        ['traded', 'Moved'],
                        ['acquired', 'Acquired'],
                        ['away', 'Traded Away'],
                    ].map(([key, label]) => (
                        <button key={key} onClick={() => setPickStatusFilter(key)} className={pickStatusFilter === key ? 'is-active' : ''}>{label}</button>
                    ))}
                </div>
                {_analyticsEmbed && (
                    <div className="analytics-pick-leaders">
                        {leaders.map(leader => (
                            <div key={leader.rid}>
                                <strong>{getOwnerName(leader.rid)}</strong>
                                <span>{leader.count} picks</span>
                                <em>{leader.value.toLocaleString()} DHQ</em>
                            </div>
                        ))}
                    </div>
                )}
                {years.map(yr => (
                    <div key={yr} style={{ marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.2rem', color: 'var(--gold)', marginBottom: '8px' }}>{yr} DRAFT PICKS</div>
                        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', overflow: 'hidden' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px 80px', gap: '4px', padding: '6px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>
                                <span>Pick</span><span>Current Owner</span><span>Original Owner</span><span>Status</span><span>Value</span>
                            </div>
                            <div style={_analyticsEmbed ? {} : { maxHeight: '500px', overflow: 'auto' }}>
                                {filteredRows.filter(row => row.year === yr).map(row => (
                                            <div key={yr+'-'+row.round+'-'+row.originalRid} {...pickRowProps(row)} style={{
                                                display: 'grid', gridTemplateColumns: '70px 1fr 1fr 90px 80px', gap: '4px',
                                                padding: '5px 10px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))',
                                                fontSize: '0.72rem', alignItems: 'center',
                                                background: row.isMyPick ? 'var(--acc-fill1, rgba(212,175,55,0.04))' : 'transparent',
                                                cursor: 'pointer', outline: 'none'
                                            }}>
                                                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, color: row.round === 1 ? 'var(--gold)' : 'var(--silver)' }}>{row.label}</span>
                                                <span style={{ color: row.isMyPick ? 'var(--gold)' : 'var(--white)', fontWeight: row.isMyPick ? 700 : 400 }}>
                                                    {getOwnerName(row.currentOwnerRid)}{row.isMyPick ? ' (You)' : ''}
                                                </span>
                                                <span style={{ color: 'var(--silver)', opacity: row.traded ? 1 : 0.4 }}>
                                                    {getOwnerName(row.originalRid)}{row.isMyOriginal ? ' (You)' : ''}
                                                </span>
                                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: row.status === 'Acquired' ? 'var(--gold)' : row.traded ? 'var(--warn)' : 'var(--good)' }}>
                                                    {row.status}
                                                </span>
                                                <span style={{ color: row.round === 1 ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', fontWeight: 700 }}>{row.value.toLocaleString()}</span>
                                            </div>
                                ))}
                                {filteredRows.filter(row => row.year === yr).length === 0 && (
                                    <div style={{ padding: '18px', color: 'var(--silver)', opacity: 0.65, fontSize: '0.78rem', textAlign: 'center' }}>No picks match these filters.</div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
      })()}
      {_activeSubView === 'reports' && (() => {
        // ── Reports Sub-View (self-contained state) ───────────────────
        return React.createElement(ReportSubView, {
          runReport, loadSavedReports, saveReportsToStorage, DEFAULT_REPORTS,
          getPlayerColumns, getTeamColumns, getFilterableFields, getFilterOps, getFilterOptionSet, sortBtnStyle,
          analyticsEmbedMode: _analyticsEmbed,
          openTeamContext,
        });
      })()}
      </React.Fragment>}
    </div>
  );

  function renderTeamRoster(team) {
    const roster = team.roster;
    if (!roster) return null;
    const players = (roster.players || []).map(pid => {
      const p = playersData[pid];
      if (!p) return null;
      const pos = normPos(p.position) || p.position;
      const dhq = window.App?.LI?.playerScores?.[pid] || 0;
      const acq = getAcquisitionInfo(pid, roster.roster_id);
      const st = statsData[pid] || {};
      const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
      const posColors = window.App.POS_COLORS;
      const isStarter = (roster.starters || []).includes(pid);
      return { pid, p, pos, dhq, acq, ppg, isStarter, posCol: posColors[pos] || 'var(--silver)' };
    }).filter(Boolean).sort((a,b) => b.dhq - a.dhq);

    return (
      <div id="wr-export-team-roster" style={{ padding: '16px' }}>
        <button onClick={() => { setSelectedTeam(null); setLeagueViewMode('roster'); }} style={{ background: 'none', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '4px', padding: '4px 12px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', marginBottom: '12px' }}>Back to League</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.4rem', color: 'var(--gold)', marginBottom: '4px' }}>{team.displayName}</div>
          <button onClick={() => window.wrExport?.capture(document.getElementById('wr-export-team-roster'), 'team-' + (team.displayName || 'roster').replace(/\s+/g, '-').toLowerCase())} style={{ background:'none', border:'1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius:'4px', padding:'2px 8px', color:'var(--gold)', fontSize:'var(--text-micro, 0.6875rem)', cursor:'pointer', fontFamily: 'var(--font-body)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Share</button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--silver)', marginBottom: '12px' }}>
          {roster?.settings?.wins ?? team.wins}-{roster?.settings?.losses ?? team.losses}{(roster?.settings?.ties > 0) ? '-' + roster.settings.ties : ''} Regular Season
          {roster?.settings?.fpts ? ' (' + roster.settings.fpts + ' PF)' : ''}
          {' \u00B7 '}{players.reduce((s,r) => s + r.dhq, 0).toLocaleString()} Total DHQ {'\u00B7'} {players.length} players
        </div>

        {/* Roster / History toggle */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            <button onClick={() => setLeagueViewMode('roster')} style={{
                padding: '5px 14px', fontSize: '0.76rem', fontFamily: 'var(--font-body)', textTransform: 'uppercase',
                background: leagueViewMode === 'roster' ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                color: leagueViewMode === 'roster' ? 'var(--black)' : 'var(--silver)',
                border: '1px solid ' + (leagueViewMode === 'roster' ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                borderRadius: '4px', cursor: 'pointer'
            }}>Roster</button>
            <button onClick={() => setLeagueViewMode('history')} style={{
                padding: '5px 14px', fontSize: '0.76rem', fontFamily: 'var(--font-body)', textTransform: 'uppercase',
                background: leagueViewMode === 'history' ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                color: leagueViewMode === 'history' ? 'var(--black)' : 'var(--silver)',
                border: '1px solid ' + (leagueViewMode === 'history' ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                borderRadius: '4px', cursor: 'pointer'
            }}>History</button>
        </div>

        {leagueViewMode === 'history' && (() => {
            const ownerHist = typeof buildOwnerHistory === 'function' ? buildOwnerHistory() : {};
            const h = ownerHist[team.roster?.roster_id];
            if (!h) return <div style={{ color: 'var(--silver)', padding: '16px' }}>History not available — DHQ engine loading</div>;

            // Franchise narrative
            const narrativeParts = [];
            if (h.championships > 0) narrativeParts.push(h.championships + 'x champion (' + h.champSeasons.join(', ') + ').');
            else narrativeParts.push('No championships yet.');
            if (h.playoffWins > h.playoffLosses) narrativeParts.push('Strong playoff performer (' + h.playoffRecord + ').');
            else if (h.playoffAppearances > 0) narrativeParts.push('Playoff presence but struggles to close (' + h.playoffRecord + ').');
            else narrativeParts.push('Has not reached playoffs.');
            if (h.draftHitRate >= 50) narrativeParts.push('Excellent drafter (' + h.draftHitRate + '% hit rate).');
            else if (h.draftHitRate >= 30) narrativeParts.push('Average drafter (' + h.draftHitRate + '%).');
            else if (h.draftTotal > 0) narrativeParts.push('Poor draft results (' + h.draftHitRate + '% hit rate).');
            if (h.avgValueDiff > 100) narrativeParts.push('Wins trades consistently (+' + h.avgValueDiff + ' avg DHQ).');
            else if (h.avgValueDiff < -100) narrativeParts.push('Loses value in trades (' + h.avgValueDiff + ' avg DHQ).');

            // Best/worst assets
            const rosterScored = (roster?.players || []).map(pid => ({ pid, dhq: window.App?.LI?.playerScores?.[pid] || 0 })).sort((a,b) => b.dhq - a.dhq);
            const bestAsset = rosterScored[0];

            // Rivalries
            const rivalries = typeof detectRivalries === 'function' ? detectRivalries(team.roster?.roster_id) : [];

            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Franchise narrative */}
                    <GMMessage>
                        {narrativeParts.join(' ')}
                        {bestAsset && bestAsset.dhq > 0 ? ` Crown jewel: ${playersData[bestAsset.pid]?.full_name || '?'} (${bestAsset.dhq.toLocaleString()} DHQ).` : ''}
                    </GMMessage>

                    {/* Header stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        {[
                            { label: 'Championships', value: h.championships, sub: h.champSeasons.join(', ') || 'None', color: h.championships > 0 ? 'var(--gold)' : 'var(--silver)' },
                            { label: 'Playoff Record', value: h.playoffRecord, sub: h.playoffAppearances + ' appearances', color: h.playoffWins > h.playoffLosses ? 'var(--good)' : 'var(--silver)' },
                            { label: 'Draft Hit Rate', value: h.draftHitRate + '%', sub: h.draftHits + '/' + h.draftTotal + ' starters', color: h.draftHitRate >= 50 ? 'var(--good)' : h.draftHitRate >= 30 ? 'var(--warn)' : 'var(--bad)' },
                            { label: 'Trade Record', value: h.tradesWon + '-' + h.tradesLost + '-' + h.tradesFair, sub: (h.avgValueDiff >= 0 ? '+' : '') + h.avgValueDiff + ' avg DHQ', color: h.avgValueDiff >= 0 ? 'var(--good)' : 'var(--bad)' },
                        ].map((stat, i) => (
                            <div key={i} style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.78rem', color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{stat.label}</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: stat.color, fontFamily: 'var(--font-mono)' }}>{stat.value}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--silver)', marginTop: '2px' }}>{stat.sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Season by season */}
                    <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', padding: '12px 16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Season History</div>
                        {h.seasonHistory.map(s => (
                            <div key={s.season} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', fontSize: '0.75rem' }}>
                                <span style={{ fontFamily: 'var(--font-title)', fontSize: '0.95rem', color: 'var(--gold)', minWidth: '40px' }}>{s.season}</span>
                                <span style={{
                                    fontSize: '0.74rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                                    background: s.finish === 'Champion' ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : s.finish === 'Runner-Up' ? 'rgba(192,192,192,0.15)' : s.finish === 'Semi-Finals' ? 'rgba(205,127,50,0.15)' : s.finish === 'Playoffs' ? 'rgba(46,204,113,0.1)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                                    color: s.finish === 'Champion' ? 'var(--gold)' : s.finish === 'Runner-Up' ? 'var(--k-c0c0c0, #c0c0c0)' : s.finish === 'Semi-Finals' ? 'var(--k-cd7f32, #cd7f32)' : s.finish === 'Playoffs' ? 'var(--good)' : 'var(--silver)'
                                }}>{s.finish}</span>
                                {s.hadFirstPick && <span style={{ fontSize: '0.7rem', color: 'var(--gold)', fontWeight: 600 }}>#1 Overall Pick</span>}
                            </div>
                        ))}
                    </div>

                    {/* #1 Overall Picks */}
                    {h.numberOnePicks.length > 0 && (
                        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', padding: '12px 16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>#1 Overall Picks</div>
                            {h.numberOnePicks.map((pk, i) => (
                                <div key={i} style={{ fontSize: '0.75rem', color: 'var(--white)', padding: '4px 0' }}>
                                    <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-title)', fontSize: '0.85rem' }}>{pk.season}</span> — {pk.player} <span style={{ color: 'var(--silver)', fontSize: '0.74rem' }}>({pk.pos})</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Best + Worst Picks */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {h.bestPick && (
                            <div style={{ background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.15)', borderRadius: '8px', padding: '10px 14px' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--good)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', marginBottom: '4px' }}>Best Draft Pick</div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--white)' }}>{h.bestPick.name}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)' }}>{h.bestPick.season} Round {h.bestPick.round} ({h.bestPick.pos})</div>
                            </div>
                        )}
                        {h.bustPicks.length > 0 && (
                            <div style={{ background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.15)', borderRadius: '8px', padding: '10px 14px' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--bad)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', marginBottom: '4px' }}>Draft Busts (R1-R2)</div>
                                {h.bustPicks.map((bp, i) => (
                                    <div key={i} style={{ fontSize: '0.72rem', color: 'var(--silver)', padding: '2px 0' }}>{bp.name} — {bp.season} R{bp.round}</div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Rivalries */}
                    {h.rivalries.length > 0 && (
                        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', padding: '12px 16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Playoff Rivalries</div>
                            {h.rivalries.map((r, i) => {
                                const rivalUser = (currentLeague.users || []).find(u => {
                                    const rivalRoster = (currentLeague.rosters || []).find(ros => ros.roster_id === r.rosterId);
                                    return rivalRoster && u.user_id === rivalRoster.owner_id;
                                });
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '0.75rem' }}>
                                        <span style={{ fontWeight: 600, color: 'var(--white)' }}>{rivalUser?.display_name || 'Team ' + r.rosterId}</span>
                                        <span style={{ color: r.wins > r.losses ? 'var(--good)' : r.wins < r.losses ? 'var(--bad)' : 'var(--silver)', fontWeight: 700 }}>{r.wins}-{r.losses}</span>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>({r.seasons.join(', ')})</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        })()}

        {leagueViewMode === 'roster' && (
        <div>
        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3px 28px 1fr 36px 32px 54px 42px 60px 52px', gap: '4px', padding: '6px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>
            <span></span><span></span><span>Player</span><span>Pos</span><span>Age</span><span>DHQ</span><span>PPG</span><span>Acquired</span><span>Date</span>
          </div>
          <div style={{ maxHeight: '600px', overflow: 'auto' }}>
            {players.map(r => (
              <div key={r.pid} onClick={() => { if (window._wrSelectPlayer) window._wrSelectPlayer(r.pid); }}
                style={{ display: 'grid', gridTemplateColumns: '3px 28px 1fr 36px 32px 54px 42px 60px 52px', gap: '4px', padding: '5px 10px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', cursor: 'pointer', fontSize: '0.72rem', alignItems: 'center', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ background: r.isStarter ? 'var(--gold)' : 'transparent', width: '3px', height: '100%' }}></div>
                <div style={{ width: '22px', height: '22px', flexShrink: 0 }}><img src={`https://sleepercdn.com/content/nfl/players/thumb/${r.pid}.jpg`} alt="" onError={e=>e.target.style.display='none'} style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} /></div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p.full_name || (r.p.first_name + ' ' + r.p.last_name).trim()}</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.65 }}>{r.p.team || 'FA'}</div>
                </div>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: r.posCol }}>{leagueMapPosLabel(r.pos)}</span>
                <span style={{ color: 'var(--silver)' }}>{r.p.age || '\u2014'}</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-body)', color: r.dhq >= 7000 ? 'var(--good)' : r.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : r.dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014'}</span>
                <span style={{ color: 'var(--silver)' }}>{r.ppg || '\u2014'}</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: r.acq.method === 'Drafted' ? 'var(--gold)' : r.acq.method === 'Traded' ? 'var(--warn)' : r.acq.method === 'Waiver' ? 'var(--good)' : r.acq.method === 'FA' ? 'var(--k-1abc9c, #1abc9c)' : 'var(--silver)' }}>{r.acq.method}{r.acq.cost ? ' ' + r.acq.cost : ''}</span>
                <span style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.65 }}>{r.acq.date}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
        )}
      </div>
    );
  }
}

// Phase 8: expose on window so AnalyticsPanel can embed sub-views
// (All Players, Draft Picks, Custom Reports) after League Map was removed from the nav.
window.LeagueMapTab = LeagueMapTab;
