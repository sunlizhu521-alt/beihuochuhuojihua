import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PRODUCT_ARCHIVE_PAGE_SIZE, filterProductArchiveRows, flattenProductArchive, productArchiveFilterOptions, productArchiveMetrics } from './product-archive.js';
import { PRODUCT_PROJECT_PAGE_SIZE, createEmptyProjectFilters, filterProductProjectRows, mappingSuggestions, productProjectFilterOptions, salesProductLine, summarizeProductProjectRows } from './product-projects.js';

const API = import.meta.env.DEV ? 'http://localhost:4003' : '';
const EMPTY_FILTERS = Object.freeze({ businessUnit: '', productLine: '', productSeries: '', productLifecycle: '', productPositioning: '', keyword: '' });
const MAPPING_FIELDS = [
  ['projectName', '项目名称', true],
  ['priority', '优先级'],
  ['innovationType', '创新类型'],
  ['projectStage', '当前阶段'],
  ['responsibilityDepartment', '责任部门'],
  ['owner', '项目负责人'],
  ['technicalContact', '技术对接人'],
  ['supplyChainContact', '供应链对接人'],
  ['manufacturer', '生产商（已重新盘点）'],
  ['projectType', '项目类型'],
  ['productLine', '产品线'],
  ['demandInitiationDate', '1-需求立项'],
  ['weeklyMeetingNote', '最新周会纪要'],
  ['modifiedAt', '钉钉修改时间']
];

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}
const dateTimeText = (value) => String(value || '').replace('T', ' ').replace(/\.\d{3}Z$/, '') || '-';
const dateText = (value) => String(value || '').slice(0, 10) || '-';
function priceText(value) { const number = Number(value); return value === '' || value === null || value === undefined ? '-' : (Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(value)); }

function FilterSelect({ label, value, options, onChange }) {
  return <label className="filter-control"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function MultiSelectFilter({ label, allLabel, value = [], options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const availableOptions = useMemo(() => [...new Set(options.filter(Boolean))], [options]);
  const selected = (Array.isArray(value) ? value : []).filter((item) => availableOptions.includes(item));

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPosition(null);
      return undefined;
    }
    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(250, rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuPosition({ left, top: rect.bottom + 4, width });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  const buttonLabel = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.join('、')
      : `已选${selected.length}项`;
  const toggle = (option) => onChange(selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option]);

  return <div className="multi-filter" ref={rootRef}>
    <span className="multi-filter-label">{label}</span>
    <button ref={buttonRef} type="button" className="multi-filter-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{buttonLabel}</span><b aria-hidden="true">⌄</b>
    </button>
    {open && menuPosition && createPortal(<div ref={menuRef} className="multi-filter-menu" style={{ position: 'fixed', zIndex: 10000, ...menuPosition }}>
      <label className="multi-filter-option"><input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} /><span>{allLabel}</span></label>
      {availableOptions.map((option) => <label key={option} className="multi-filter-option"><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}
    </div>, document.body)}
  </div>;
}
function Metric({ label, value, tone = '' }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{Number(value || 0).toLocaleString('zh-CN')}</strong></article>; }
function Pagination({ page, totalPages, pageSize, onChange }) { return <nav className="table-pagination"><button type="button" className="ghost compact-button" disabled={page === 1} onClick={() => onChange(1)}>首页</button><button type="button" className="ghost compact-button" disabled={page === 1} onClick={() => onChange(page - 1)}>上一页</button><span className="section-count">第 {page} / {totalPages} 页，每页 {pageSize} 条</span><button type="button" className="ghost compact-button" disabled={page === totalPages} onClick={() => onChange(page + 1)}>下一页</button><button type="button" className="ghost compact-button" disabled={page === totalPages} onClick={() => onChange(totalPages)}>末页</button></nav>; }
function MiniBars({ title, rows = [] }) { const max = Math.max(1, ...rows.map((row) => row.value)); return <article className="product-project-chart"><h4>{title}</h4>{!rows.length ? <p className="section-count">暂无数据</p> : rows.slice(0, 12).map((row) => <div className="product-project-bar" key={row.label}><span>{row.label}</span><i><b style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></i><strong>{row.value}</strong></div>)}</article>; }

function ActiveProductsTab({ payload, focusProductId, onOpenProjects }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const flatRows = useMemo(() => flattenProductArchive(payload.rows, payload.feedbackSlots), [payload.rows, payload.feedbackSlots]);
  const options = useMemo(() => productArchiveFilterOptions(flatRows), [flatRows]);
  const filteredRows = useMemo(() => filterProductArchiveRows(focusProductId ? flatRows.filter((row) => row.id === focusProductId) : flatRows, filters), [flatRows, filters, focusProductId]);
  const metrics = useMemo(() => productArchiveMetrics(payload.rows, flatRows), [payload.rows, flatRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PRODUCT_ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filteredRows.slice((currentPage - 1) * PRODUCT_ARCHIVE_PAGE_SIZE, currentPage * PRODUCT_ARCHIVE_PAGE_SIZE);
  const change = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  return <>
    <div className="product-archive-source"><strong>底表来源：{payload.source?.fileName || '商品分类尚未上传并应用'}</strong><span>工作表：{payload.source?.sheetName || '-'}</span><span>应用人：{payload.source?.uploadedBy || '-'}</span><span>应用时间：{dateTimeText(payload.source?.updatedAt)}</span></div>
    <section className="metric-grid product-archive-metrics"><Metric label="产品档案" value={metrics.productCount} /><Metric label="已有事业部数据的产品" value={metrics.coveredProducts} /><Metric label="已维护事业部×产品" value={metrics.feedbackCount} /><Metric label="待维护事业部×产品" value={metrics.pendingCount} tone={metrics.pendingCount ? 'warning' : ''} /></section>
    <section className="panel product-archive-panel">{focusProductId && <p className="message">正在查看关联产品，可点击上方“在售产品档案”清除关联筛选。</p>}<div className="product-archive-filters"><FilterSelect label="事业部" value={filters.businessUnit} options={options.businessUnits} onChange={(v) => change('businessUnit', v)} /><FilterSelect label="产品生命周期" value={filters.productLifecycle} options={options.lifecycles} onChange={(v) => change('productLifecycle', v)} /><FilterSelect label="产品定位" value={filters.productPositioning} options={options.positions} onChange={(v) => change('productPositioning', v)} /><FilterSelect label="产品线" value={filters.productLine} options={options.productLines} onChange={(v) => change('productLine', v)} /><FilterSelect label="系列" value={filters.productSeries} options={options.productSeries} onChange={(v) => change('productSeries', v)} /><label className="filter-control product-archive-search"><span>搜索</span><input value={filters.keyword} placeholder="物料、SKU、名称、型号、备注" onChange={(event) => change('keyword', event.target.value)} /></label><button type="button" className="ghost compact-button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>清空筛选</button></div>
      <div className="section-heading-row"><h3>事业部产品档案明细</h3><span className="section-count">当前显示 {filteredRows.length.toLocaleString('zh-CN')} 条</span></div><div className="table-wrap product-archive-table-wrap"><table><thead><tr><th>事业部</th><th>产品生命周期</th><th>产品定位</th><th>产品线</th><th>系列</th><th>型号</th><th>物料编码</th><th>SKU</th><th>物料名称</th><th>品牌</th><th>产品类型</th><th>销售区域</th><th>不含税结算价</th><th>关联研发项目</th><th>反馈备注</th><th>反馈来源文件</th><th>反馈更新时间</th></tr></thead><tbody>{!rows.length ? <tr><td className="empty" colSpan="17">暂无符合条件的产品档案</td></tr> : rows.map((row) => <tr key={row.rowKey} className={row.feedbackComplete ? '' : 'product-archive-pending'}><td><strong>{row.businessUnit}</strong></td><td>{row.productLifecycle || <span className="status-pending">待反馈</span>}</td><td>{row.productPositioning || <span className="status-pending">待反馈</span>}</td><td>{row.productLine || '-'}</td><td>{row.productSeries || '-'}</td><td>{row.model || '-'}</td><td>{row.materialCode || '-'}</td><td>{row.sku || '-'}</td><td>{row.materialName || '-'}</td><td>{row.brand || '-'}</td><td>{row.productType || '-'}</td><td>{row.salesRegion || '-'}</td><td className="number-cell">{priceText(row.pretaxPrice)}</td><td>{row.linkedProjectCount ? <button type="button" className="link-button" onClick={() => onOpenProjects(row.id)}>{row.linkedProjectCount} 个，查看</button> : '-'}</td><td>{row.feedbackRemark || '-'}</td><td>{row.feedbackFileName || '-'}</td><td>{dateTimeText(row.feedbackUpdatedAt)}</td></tr>)}</tbody></table></div><Pagination page={currentPage} totalPages={totalPages} pageSize={PRODUCT_ARCHIVE_PAGE_SIZE} onChange={setPage} />
    </section>
  </>;
}

function AdminSettings({ token, source, onSynced }) {
  const [documentReference, setDocumentReference] = useState(source.documentReference || source.baseId || '');
  const [baseId, setBaseId] = useState(source.baseId || '');
  const [sheets, setSheets] = useState([]);
  const [sheetId, setSheetId] = useState(source.sheetId || '');
  const [fields, setFields] = useState([]);
  const [mapping, setMapping] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  async function loadHistory() { try { setHistory((await request('/api/product-projects/sync-history', token)).rows || []); } catch {} }
  useEffect(() => { loadHistory(); }, [token]);
  async function discoverSheets() { setBusy(true); setMessage(''); try { const result = await request(`/api/product-projects/source-schema?documentReference=${encodeURIComponent(documentReference)}&baseId=${encodeURIComponent(baseId)}`, token); setBaseId(result.baseId); setSheets(result.sheets || []); setMessage(`已读取 ${result.sheets?.length || 0} 个数据表`); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function discoverFields(nextSheetId) { setSheetId(nextSheetId); setBusy(true); setMessage(''); try { const result = await request(`/api/product-projects/source-schema?baseId=${encodeURIComponent(baseId)}&sheetId=${encodeURIComponent(nextSheetId)}`, token); setFields(result.fields || []); setMapping(mappingSuggestions(result.fields || [])); setMessage(`已读取 ${result.fields?.length || 0} 个字段，请确认映射`); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function save() { setBusy(true); setMessage(''); try { const selected = sheets.find((sheet) => String(sheet.id) === String(sheetId)); await request('/api/product-projects/settings', token, { method: 'PUT', body: JSON.stringify({ documentReference, baseId, sheetId, sheetName: selected?.name || source.sheetName || '', mapping }) }); setMessage('数据源与字段映射已保存到腾讯云'); await onSynced(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  async function sync() { setBusy(true); setMessage(''); try { const result = await request('/api/product-projects/sync', token, { method: 'POST' }); setMessage(`同步完成：读取 ${result.sourceCount} 条，保留 ${result.acceptedCount} 条`); await Promise.all([onSynced(), loadHistory()]); } catch (error) { setMessage(error.message); await loadHistory(); } finally { setBusy(false); } }
  const names = fields.map((field) => String(field.name || field.id));
  return <details className="product-project-settings"><summary>管理员：钉钉研发项目数据源设置</summary><div className="product-project-config-status"><span>AppKey/AppSecret：{source.appCredentialsConfigured ? '已配置' : '未配置'}</span><span>操作人 unionId：{source.operatorConfigured ? '已配置' : '未配置'}</span><span>定时同步：每天北京时间 00:30</span></div><div className="product-project-settings-grid"><label className="filter-control"><span>钉钉文档链接或AI表格ID</span><input value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} /></label><label className="filter-control"><span>AI表格ID</span><input value={baseId} onChange={(event) => setBaseId(event.target.value)} /></label><button className="ghost compact-button" type="button" disabled={busy} onClick={discoverSheets}>读取数据表</button><label className="filter-control"><span>研发项目数据表</span><select value={sheetId} onChange={(event) => discoverFields(event.target.value)}><option value="">请选择</option>{sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name || sheet.id}</option>)}</select></label></div>{fields.length > 0 && <div className="product-project-mapping">{MAPPING_FIELDS.map(([key, label, required]) => <label className="filter-control" key={key}><span>{label}{required ? '（必需）' : ''}</span><select value={mapping[key] || ''} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value }))}><option value="">不映射</option>{names.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>)}</div>}<div className="toolbar"><button type="button" className="primary" disabled={busy || !mapping.projectName} onClick={save}>保存设置</button><button type="button" className="ghost" disabled={busy || !source.configured} onClick={sync}>立即同步</button></div>{message && <p className="message">{message}</p>}{history.length > 0 && <div className="table-wrap product-project-history"><table><thead><tr><th>开始时间</th><th>触发方式</th><th>状态</th><th>来源/保留</th><th>异常</th></tr></thead><tbody>{history.slice(0, 8).map((row) => <tr key={row.id}><td>{dateTimeText(row.startedAt)}</td><td>{row.triggerType === 'scheduled' ? '定时' : '手动'} / {row.triggeredBy}</td><td>{row.status}</td><td>{row.sourceCount} / {row.acceptedCount}</td><td>{row.errorMessage || `缺名称${row.missingNameCount}、重复${row.duplicateCount}、日期异常${row.invalidDateCount}`}</td></tr>)}</tbody></table></div>}</details>;
}

function ProjectsTab({ payload, focusProductId, onOpenProduct }) {
  const [filters, setFilters] = useState(createEmptyProjectFilters);
  const [page, setPage] = useState(1);
  const options = useMemo(() => productProjectFilterOptions(payload.rows), [payload.rows]);
  const filteredRows = useMemo(() => filterProductProjectRows(focusProductId ? payload.rows.filter((row) => row.linkedProductId === focusProductId) : payload.rows, filters), [payload.rows, filters, focusProductId]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PRODUCT_PROJECT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filteredRows.slice((currentPage - 1) * PRODUCT_PROJECT_PAGE_SIZE, currentPage * PRODUCT_PROJECT_PAGE_SIZE);
  const change = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const metrics = useMemo(() => summarizeProductProjectRows(filteredRows), [filteredRows]);
  const sourceName = payload.source?.sourceType === 'file'
    ? payload.source.fileName
    : payload.source?.sheetName;
  const latestMeetingTitle = useMemo(
    () => payload.rows.find((row) => row.weeklyMeetingTitle)?.weeklyMeetingTitle || '最新周会纪要',
    [payload.rows]
  );
  return <>
    <div className="product-archive-source">
      <strong>项目进度来源：{sourceName || '请在“产品数据-产品项目”槽位上传并应用文件'}</strong>
      <span>工作表：{payload.source?.sheetName || '-'}</span>
      <span>上传人：{payload.source?.uploadedBy || '-'}</span>
      <span>更新时间：{dateTimeText(payload.source?.updatedAt || payload.sync?.lastSuccessAt)}</span>
      <span>状态：{payload.sync?.running ? '处理中' : (payload.sync?.latestStatus || '未上传')}</span>
      {payload.sync?.latestError && <span className="status-pending">最近失败：{payload.sync.latestError}（仍展示上次成功数据）</span>}
    </div>
    <section className="metric-grid product-archive-metrics">
      <Metric label="研发项目" value={metrics.totalProjects} />
      <Metric label="涉及责任部门" value={metrics.businessUnitCount} />
      <Metric label="项目阶段" value={metrics.stageCount} />
      <Metric label="销售产品线" value={metrics.salesProductLineCount} />
    </section>
    <section className="product-project-charts">
      <MiniBars title="责任部门项目分布" rows={metrics.responsibilityDepartments} />
      <MiniBars title="项目阶段分布" rows={metrics.stages} />
      <MiniBars title="销售产品线分类" rows={metrics.salesProductLines} />
    </section>
    <section className="panel product-archive-panel">
      {focusProductId && <p className="message">正在查看所选在售产品关联的研发项目，点击上方“研发项目看板”可清除。</p>}
      <div className="product-archive-filters">
        <MultiSelectFilter label="状态" allLabel="全部状态" value={filters.projectStatus} options={options.statuses} onChange={(v) => change('projectStatus', v)} />
        <MultiSelectFilter label="当前阶段" allLabel="全部阶段" value={filters.projectStage} options={options.stages} onChange={(v) => change('projectStage', v)} />
        <MultiSelectFilter label="责任部门" allLabel="全部责任部门" value={filters.responsibilityDepartment} options={options.responsibilityDepartments} onChange={(v) => change('responsibilityDepartment', v)} />
        <MultiSelectFilter label="销售产品线" allLabel="全部销售产品线" value={filters.salesProductLine} options={options.salesProductLines} onChange={(v) => change('salesProductLine', v)} />
        <MultiSelectFilter label="项目负责人" allLabel="全部项目负责人" value={filters.owner} options={options.owners} onChange={(v) => change('owner', v)} />
        <MultiSelectFilter label="创新类型" allLabel="全部创新类型" value={filters.innovationType} options={options.innovationTypes} onChange={(v) => change('innovationType', v)} />
        <label className="filter-control product-archive-search"><span>搜索</span><input value={filters.keyword} placeholder="项目、部门、负责人、对接人、生产商、周会纪要" onChange={(event) => change('keyword', event.target.value)} /></label>
        <button type="button" className="ghost compact-button" onClick={() => { setFilters(createEmptyProjectFilters()); setPage(1); }}>清空筛选</button>
      </div>
      <div className="section-heading-row"><h3>研发项目明细</h3><span className="section-count">当前显示 {filteredRows.length.toLocaleString('zh-CN')} 条</span></div>
      <div className="table-wrap product-archive-table-wrap">
        <table>
          <thead><tr><th>状态</th><th>当前阶段</th><th>责任部门</th><th>销售产品线</th><th>项目负责人</th><th>创新类型</th><th>优先级</th><th>项目名称</th><th>技术对接人</th><th>供应链对接人</th><th>生产商（已重新盘点）</th><th>项目类型</th><th>1-需求立项</th><th>{latestMeetingTitle}</th><th>在售产品关联</th><th>修改时间</th></tr></thead>
          <tbody>{!rows.length ? <tr><td className="empty" colSpan="16">暂无研发项目数据</td></tr> : rows.map((row) => <tr key={row.sourceRecordId}><td>{row.projectStatus || '-'}</td><td>{row.projectStage || '-'}</td><td>{row.responsibilityDepartment || row.businessUnit || '-'}</td><td>{salesProductLine(row.productLine)}</td><td>{row.owner || '-'}</td><td>{row.innovationType || row.productPositioning || '-'}</td><td>{row.priority || '-'}</td><td><strong>{row.projectName}</strong></td><td>{row.technicalContact || '-'}</td><td>{row.supplyChainContact || '-'}</td><td>{row.manufacturer || '-'}</td><td>{row.projectType || '-'}</td><td>{dateText(row.demandInitiationDate)}</td><td>{row.weeklyMeetingNote || '-'}</td><td>{row.linkedProductId ? <button type="button" className="link-button" onClick={() => onOpenProduct(row.linkedProductId)}>已关联，查看</button> : <><span className={row.linkStatus === '关联冲突' ? 'status-pending' : ''}>{row.linkStatus}</span><small>{row.linkMessage}</small></>}</td><td>{dateText(row.sourceModifiedAt)}</td></tr>)}</tbody>
        </table>
      </div>
      <Pagination page={currentPage} totalPages={totalPages} pageSize={PRODUCT_PROJECT_PAGE_SIZE} onChange={setPage} />
    </section>
  </>;
}

export default function ProductArchivePage({ token, active }) {
  const [tab, setTab] = useState('activeProducts');
  const [focusProductId, setFocusProductId] = useState('');
  const [archive, setArchive] = useState({ rows: [], feedbackSlots: [], source: {} });
  const [projects, setProjects] = useState({ rows: [], metrics: {}, sync: {}, source: {} });
  const [loading, setLoading] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  async function load() { setLoading(true); setError(''); try { const [a, p] = await Promise.all([request('/api/product-archive', token), request('/api/product-projects', token)]); setArchive(a); setProjects(p); setLoaded(true); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }
  useEffect(() => { if (!active) { setLoaded(false); return; } if (!loaded) load(); }, [active, loaded, token]);
  if (!loaded && loading) return <p className="section-count">正在读取产品档案...</p>;
  return <div className="product-archive-page"><div className="section-heading-row product-archive-heading"><div><h2>产品档案</h2><p className="section-count">在售产品来自商品分类与事业部产品数据；研发项目来自“产品项目”槽位上传的项目进度文件。</p></div><button type="button" className="ghost" disabled={loading} onClick={load}>{loading ? '刷新中...' : '刷新'}</button></div>{error && <p className="message">加载失败：{error}</p>}<div className="product-archive-tabs"><button type="button" className={tab === 'activeProducts' ? 'active' : ''} onClick={() => { setFocusProductId(''); setTab('activeProducts'); }}>在售产品档案</button><button type="button" className={tab === 'projects' ? 'active' : ''} onClick={() => { setFocusProductId(''); setTab('projects'); }}>研发项目看板</button></div>{tab === 'activeProducts' ? <ActiveProductsTab payload={archive} focusProductId={focusProductId} onOpenProjects={(id) => { setFocusProductId(id); setTab('projects'); }} /> : <ProjectsTab payload={projects} focusProductId={focusProductId} onOpenProduct={(id) => { setFocusProductId(id); setTab('activeProducts'); }} />}</div>;
}
