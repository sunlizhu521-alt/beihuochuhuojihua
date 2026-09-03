import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SUPPLY_PLAN_FILTER_FIELDS,
  SUPPLY_PLAN_PAGE_SIZE,
  SUPPLY_PLAN_ROW_TYPES,
  buildSupplyPlanWeeks,
  supplyPlanRowKey
} from './supply-plan.js';
import { API } from './api-base.js';

const CHANNELS = [
  { key: 'overseasUs', label: '海外-美国' },
  { key: 'overseasEurope', label: '海外-欧洲' },
  { key: 'domestic', label: '国内' }
];
const PERIOD_FIELDS = [
  ['onHandSellableDays', '在库量可销天数'],
  ['dispatchToShelfDays', '发货到上架'],
  ['transportDays', '海运/运输'],
  ['bookingDays', '订舱/预约'],
  ['averageLeadTimeDays', '平均交期'],
  ['contractSigningDays', '合同签订']
];
const HORIZON_MONTHS = [6, 9, 12, 15, 18, 21, 24];
const WEEK_COLUMN_WIDTH = 72;
const WEEK_OVERSCAN = 3;
const SUMMARY_FIXED_COLUMNS = [
  { key: 'productLine', label: '产品线', width: 92 },
  { key: 'productSeries', label: '系列', width: 92 },
  { key: 'model', label: '型号', width: 142 },
  { key: 'safetyStockQty', label: '安全库存数量', width: 112 },
  { key: 'metric', label: '供应计划指标', width: 112 },
  { key: 'actionConclusion', label: '动作结论', width: 100 }
];
const CHILD_DETAIL_COLUMNS = [
  { key: 'businessUnit', label: '事业部', width: 116 },
  { key: 'materialCode', label: '物料编码', width: 112 },
  { key: 'sku', label: 'SKU', width: 130 },
  { key: 'skuName', label: '名称', width: 210 },
  { key: 'productLifecycle', label: '产品阶段', width: 100 },
  { key: 'productPositioning', label: '产品定位', width: 100 }
];
const EXPANDED_FIXED_COLUMNS = [
  ...SUMMARY_FIXED_COLUMNS.slice(0, 3),
  ...CHILD_DETAIL_COLUMNS,
  ...SUMMARY_FIXED_COLUMNS.slice(3)
];
const EMPTY_FILTERS = Object.freeze({ businessUnit: '', productLine: '', productSeries: '', actionConclusion: '' });

function numberText(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN', { maximumFractionDigits });
}

function timestampText(value) {
  return String(value || '').replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function derivedDays(settings = {}) {
  const value = (field) => {
    const number = Number(settings[field]);
    return Number.isFinite(number) ? number : 0;
  };
  const spotDays = value('onHandSellableDays')
    + value('dispatchToShelfDays')
    + value('transportDays')
    + value('bookingDays');
  return {
    spotDays,
    fullChainDays: spotDays + value('averageLeadTimeDays') + value('contractSigningDays')
  };
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `请求失败（${response.status}）`);
  return payload;
}

function responseFileName(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8Name) {
    try {
      return decodeURIComponent(utf8Name);
    } catch {
      return fallback;
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

function localDateText(value = new Date()) {
  const part = (number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`;
}

function stickyStyle(columns, index) {
  const width = columns[index].width;
  const left = columns.slice(0, index).reduce((sum, column) => sum + column.width, 0);
  return {
    '--supply-plan-left': `${left}px`,
    width,
    minWidth: width,
    maxWidth: width
  };
}

function metricWeekValue(row, metric, weekIndex) {
  if (metric === '销售预测') return row.weeklyForecast?.[weekIndex] || 0;
  if (metric === '预测剩余库存') return weekIndex === 0 ? row.inventoryRemainingQty : null;
  if (weekIndex > 0) return 0;
  if (metric === '未交付') return row.undeliveredQty;
  if (metric === '在途') return row.inTransitQty;
  if (metric === '在库') return row.onHandQty;
  return metric === '建议采购' ? row.purchaseGap : 0;
}

function metricDataValue(row, metric) {
  if (metric === '销售预测') return row.forecastTotal;
  if (metric === '未交付') return row.undeliveredQty;
  if (metric === '在途') return row.inTransitQty;
  if (metric === '在库') return row.onHandQty;
  if (metric === '预测剩余库存') return row.inventoryRemainingQty;
  return metric === '建议采购' ? row.purchaseGap : 0;
}

const SupplyPlanActionBadge = memo(function SupplyPlanActionBadge({ row }) {
  const conclusion = row.actionConclusion || '正常流转';
  return (
    <span
      className="supply-plan-action-badge"
      style={{ '--supply-plan-action-color': row.actionColor || '#4caf50' }}
      aria-label={`动作结论：${conclusion}`}
    >
      {conclusion}
    </span>
  );
});

const SupplyPlanMetricRows = memo(function SupplyPlanMetricRows({
  row,
  rowKey,
  fixedColumns,
  visibleWeeks,
  weekStart,
  totalWeeks,
  level,
  expanded = false,
  childCount = 0,
  detailLoading = false,
  onToggle
}) {
  const beforeWidth = weekStart * WEEK_COLUMN_WIDTH;
  const afterWidth = Math.max(0, totalWeeks - weekStart - visibleWeeks.length) * WEEK_COLUMN_WIDTH;
  return SUPPLY_PLAN_ROW_TYPES.map((metric, metricIndex) => (
    <tr
      key={`${rowKey}-${metric}`}
      className={`${metricIndex === 0 ? 'supply-plan-group-start ' : ''}${level === 'parent' ? 'supply-plan-parent-row' : 'supply-plan-child-row'} metric-row-${metricIndex}`}
    >
      {metricIndex === 0 ? fixedColumns.slice(0, -2).map((column, index) => {
        let content = String(row[column.key] ?? '未匹配');
        if (column.key === 'safetyStockQty') content = numberText(row.safetyStockQty);
        if (level === 'parent' && column.key === 'businessUnit') content = '全量汇总';
        if (level === 'parent' && column.key === 'materialCode') content = `${childCount} 项`;
        if (level === 'parent' && column.key === 'sku') content = '—';
        if (level === 'parent' && column.key === 'skuName') content = '按型号汇总';
        if (level === 'parent' && ['sku', 'productLifecycle', 'productPositioning'].includes(column.key)) content = '—';
        return (
          <td
            key={column.key}
            rowSpan={SUPPLY_PLAN_ROW_TYPES.length}
            className={`supply-plan-sticky supply-plan-rowspan${CHILD_DETAIL_COLUMNS.some((detail) => detail.key === column.key) ? ' supply-plan-detail-column' : ''}`}
            style={stickyStyle(fixedColumns, index)}
            title={String(content)}
          >
            {level === 'parent' && column.key === 'model' ? (
              <button type="button" className="supply-plan-model-toggle" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}型号 ${row.model}`} onClick={() => onToggle(row)}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <strong>{content}</strong>
                <small>{detailLoading ? '读取中…' : `${childCount} 项`}</small>
              </button>
            ) : content}
          </td>
        );
      }) : null}
      <td className="supply-plan-sticky metric-name" style={stickyStyle(fixedColumns, fixedColumns.length - 2)}>{metric}</td>
      {metricIndex === 0 ? (
        <td
          rowSpan={SUPPLY_PLAN_ROW_TYPES.length}
          className="supply-plan-sticky supply-plan-action-column supply-plan-action-rowspan"
          style={stickyStyle(fixedColumns, fixedColumns.length - 1)}
        >
          <SupplyPlanActionBadge row={row} />
        </td>
      ) : null}
      <td className={`numeric-cell supply-plan-data-column${metric === '预测剩余库存' && metricDataValue(row, metric) < 0 ? ' inventory-negative' : ''}`}>
        {numberText(metricDataValue(row, metric))}
      </td>
      {beforeWidth ? <td aria-hidden="true" className="supply-plan-week-spacer" style={{ width: beforeWidth, minWidth: beforeWidth }} /> : null}
      {visibleWeeks.map((week, visibleIndex) => {
        const weekIndex = weekStart + visibleIndex;
        const value = metricWeekValue(row, metric, weekIndex);
        const negativeRemaining = metric === '预测剩余库存' && value !== null && value < 0;
        return (
          <td key={week.key} className={`numeric-cell${metric === '建议采购' && value > 0 ? ' gap-positive' : ''}${negativeRemaining ? ' inventory-negative' : ''}`}>
            {value === null ? '' : numberText(value)}
          </td>
        );
      })}
      {afterWidth ? <td aria-hidden="true" className="supply-plan-week-spacer" style={{ width: afterWidth, minWidth: afterWidth }} /> : null}
    </tr>
  ));
});

function RouteSettings({ params, saving, meta, horizonMonths, onHorizonChange, onChange, onSave }) {
  return (
    <section className="supply-plan-route-wrap">
      <div className="supply-plan-section-heading">
        <div>
          <h3>路由时间设置</h3>
          <p>{meta.updatedAt
            ? `腾讯云最后保存：${meta.updatedBy || '未知用户'}，${timestampText(meta.updatedAt)}`
            : '暂无历史设置，当前使用系统默认值'}</p>
        </div>
        <div className="supply-plan-route-actions">
          <label>
            <span>月选视野</span>
            <select aria-label="月选视野" value={horizonMonths} onChange={(event) => onHorizonChange(Number(event.target.value))}>
              {HORIZON_MONTHS.map((months) => <option key={months} value={months}>{months} 个月</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={saving} onClick={onSave}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
      <div className="supply-plan-route-table-wrap">
        <table className="supply-plan-route-table">
          <thead>
            <tr>
              <th>渠道</th>
              <th>在库量可销天数</th>
              <th>发货到上架</th>
              <th>海运/运输</th>
              <th>订舱/预约</th>
              <th className="calculated">现货天数</th>
              <th>平均交期</th>
              <th>合同签订</th>
              <th className="total">全链路天数</th>
              <th className="total">安全库存天数</th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map(({ key, label }) => {
              const settings = params.channels[key];
              const derived = derivedDays(settings);
              return (
                <tr key={key}>
                  <th>{label}</th>
                  {PERIOD_FIELDS.slice(0, 4).map(([field]) => (
                    <td key={field}><input aria-label={`${label}${field}`} type="number" min="0" step="1" value={settings[field]} onChange={(event) => onChange(key, field, event.target.value)} /></td>
                  ))}
                  <td className="calculated"><output>{numberText(derived.spotDays)}</output></td>
                  {PERIOD_FIELDS.slice(4).map(([field]) => (
                    <td key={field}><input aria-label={`${label}${field}`} type="number" min="0" step="1" value={settings[field]} onChange={(event) => onChange(key, field, event.target.value)} /></td>
                  ))}
                  <td className="total"><output>{numberText(derived.fullChainDays)}</output></td>
                  <td className="total"><input aria-label={`${label}safetyDays`} type="number" min="0" step="1" value={settings.safetyDays} onChange={(event) => onChange(key, 'safetyDays', event.target.value)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="supply-plan-formula-note">现货天数 = 在库量可销天数 + 发货到上架 + 海运/运输 + 订舱/预约；全链路天数 = 现货天数 + 平均交期 + 合同签订。</p>
    </section>
  );
}

export default function SupplyPlanBoard({ token, active }) {
  const [rows, setRows] = useState([]);
  const [params, setParams] = useState(null);
  const [meta, setMeta] = useState({ updatedBy: '', updatedAt: '', generatedAt: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState('1');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState({ businessUnit: [], productLine: [], productSeries: [], actionConclusion: [] });
  const [pagination, setPagination] = useState({ page: 1, pageSize: SUPPLY_PLAN_PAGE_SIZE, totalItems: 0, totalPages: 1, totalChildItems: 0 });
  const [modelStates, setModelStates] = useState(() => new Map());
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [weeks, setWeeks] = useState(() => buildSupplyPlanWeeks(6));
  const [visibleWeekRange, setVisibleWeekRange] = useState({ start: 0, end: 14 });
  const modelStatesRef = useRef(modelStates);
  const summaryRequestRef = useRef(0);
  const scrollFrameRef = useRef(0);

  useEffect(() => {
    modelStatesRef.current = modelStates;
  }, [modelStates]);

  const filterQuery = useMemo(() => Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value)
  ), [filters]);

  const loadSummary = useCallback(async ({ manual = false, page = currentPage, months = horizonMonths } = {}) => {
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(SUPPLY_PLAN_PAGE_SIZE),
        horizonMonths: String(months),
        ...filterQuery
      });
      const payload = await apiRequest(`/api/supply-plan/summary?${query}`, token);
      if (summaryRequestRef.current !== requestId) return;
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setWeeks(Array.isArray(payload.weeks) ? payload.weeks : buildSupplyPlanWeeks(months));
      setHorizonMonths(payload.horizonMonths || months);
      setParams(payload.params);
      setPagination(payload.pagination || { page: 1, pageSize: SUPPLY_PLAN_PAGE_SIZE, totalItems: 0, totalPages: 1, totalChildItems: 0 });
      setFilterOptions(payload.filterOptions || { businessUnit: [], productLine: [], productSeries: [], actionConclusion: [] });
      setCurrentPage(payload.pagination?.page || 1);
      setPageDraft(String(payload.pagination?.page || 1));
      setMeta({
        updatedBy: payload.updatedBy || '',
        updatedAt: payload.updatedAt || '',
        generatedAt: payload.generatedAt || ''
      });
      if (manual) setMessage(`已重新计算，共 ${payload.pagination?.totalItems || 0} 个型号。`);
    } catch (requestError) {
      if (summaryRequestRef.current === requestId) setError(requestError.message);
    } finally {
      if (summaryRequestRef.current === requestId) setLoading(false);
    }
  }, [currentPage, filterQuery, horizonMonths, token]);

  useEffect(() => {
    if (active) loadSummary();
  }, [active, loadSummary]);

  useEffect(() => {
    setVisibleWeekRange({ start: 0, end: Math.min(14, weeks.length) });
  }, [weeks.length]);

  const changeParam = useCallback((channelKey, field, rawValue) => {
    const value = rawValue === '' ? '' : Number(rawValue);
    setParams((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [channelKey]: { ...current.channels[channelKey], [field]: value }
      }
    }));
  }, []);

  async function saveParams() {
    if (!params || saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = await apiRequest('/api/supply-plan/params', token, {
        method: 'POST',
        body: JSON.stringify(params)
      });
      setParams(payload.params);
      setMeta((current) => ({ ...current, updatedBy: payload.updatedBy || '', updatedAt: payload.updatedAt || '' }));
      setMessage(`路由时间已保存到腾讯云，保存人：${payload.updatedBy || '未知用户'}。`);
      await loadSummary({ page: currentPage, months: horizonMonths });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (exporting || loading) return;
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const query = new URLSearchParams({ horizonMonths: String(horizonMonths), ...filterQuery });
      const response = await fetch(`${API}/api/supply-plan/export?${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || `导出失败（${response.status}）`);
        setMessage(payload?.message || '当前无需要补货的型号');
        return;
      }
      if (!response.ok) {
        throw new Error(`导出失败（${response.status}）`);
      }
      const blob = await response.blob();
      const fallback = `备货计划-${localDateText().replaceAll('-', '')}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = responseFileName(response, fallback);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`导出完成：${link.download}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExporting(false);
    }
  }

  function changeHorizon(months) {
    setHorizonMonths(months);
    setCurrentPage(1);
    setPageDraft('1');
    modelStatesRef.current = new Map();
    setModelStates(new Map());
  }

  const toggleModel = useCallback(async (group) => {
    const current = modelStatesRef.current.get(group.modelKey);
    if (current?.loading) return;
    if (current?.rows) {
      const next = new Map(modelStatesRef.current);
      next.set(group.modelKey, { ...current, expanded: !current.expanded });
      modelStatesRef.current = next;
      setModelStates(next);
      return;
    }
    const loadingState = new Map(modelStatesRef.current);
    loadingState.set(group.modelKey, { expanded: true, loading: true, rows: [], error: '' });
    modelStatesRef.current = loadingState;
    setModelStates(loadingState);
    const startedAt = performance.now();
    try {
      const query = new URLSearchParams({
        modelKey: group.modelKey,
        model: group.model,
        horizonMonths: String(horizonMonths),
        ...filterQuery
      });
      const payload = await apiRequest(`/api/supply-plan/model-detail?${query}`, token);
      const next = new Map(modelStatesRef.current);
      next.set(group.modelKey, { expanded: true, loading: false, rows: payload.rows || [], error: '' });
      modelStatesRef.current = next;
      setModelStates(next);
      setMessage(`型号 ${group.model} 明细已加载，用时 ${Math.round(performance.now() - startedAt)}ms。`);
    } catch (requestError) {
      const next = new Map(modelStatesRef.current);
      next.set(group.modelKey, { expanded: true, loading: false, rows: [], error: requestError.message });
      modelStatesRef.current = next;
      setModelStates(next);
    }
  }, [filterQuery, horizonMonths, token]);

  const showChildColumns = rows.some((group) => modelStates.get(group.modelKey)?.expanded);
  const fixedColumns = showChildColumns ? EXPANDED_FIXED_COLUMNS : SUMMARY_FIXED_COLUMNS;
  const fixedWidth = useMemo(() => fixedColumns.reduce((sum, column) => sum + column.width, 0) + 82, [fixedColumns]);
  const visibleWeeks = useMemo(
    () => weeks.slice(visibleWeekRange.start, visibleWeekRange.end),
    [visibleWeekRange, weeks]
  );

  const handleWeekScroll = useCallback((event) => {
    const element = event.currentTarget;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const firstVisible = Math.max(0, Math.floor((element.scrollLeft - fixedWidth) / WEEK_COLUMN_WIDTH));
      const start = Math.max(0, firstVisible - WEEK_OVERSCAN);
      const visibleCount = Math.ceil(element.clientWidth / WEEK_COLUMN_WIDTH) + WEEK_OVERSCAN * 2;
      const end = Math.min(weeks.length, start + visibleCount);
      setVisibleWeekRange((current) => current.start === start && current.end === end ? current : { start, end });
    });
  }, [fixedWidth, weeks.length]);

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), []);

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
    setPageDraft('1');
    modelStatesRef.current = new Map();
    setModelStates(new Map());
  }

  function goToPage(page) {
    const safePage = Math.min(pagination.totalPages, Math.max(1, Number(page) || 1));
    setCurrentPage(safePage);
    setPageDraft(String(safePage));
  }

  if (!params && loading) return <div className="loading-fallback">正在读取供应计划数据...</div>;

  return (
    <div className="panel supply-plan-board">
      <div className="supply-plan-title-row">
        <div>
          <div className="supply-plan-title-heading">
            <h2>供应计划工具</h2>
            <button type="button" className="primary compact-button" disabled={loading} onClick={() => loadSummary({ manual: true })}>{loading ? '重新计算中...' : '重新计算'}</button>
          </div>
          <p>数据来源：库存数据(18)、未交付数据(19)、M+6预测(21)及维度表；点击“重新计算”读取最新数据。</p>
        </div>
        <div className="supply-plan-title-actions">
          <span>{meta.generatedAt ? `生成时间：${timestampText(meta.generatedAt)}` : ''}</span>
          <button type="button" className="primary compact-button" disabled={exporting || loading} onClick={exportExcel}>
            {exporting ? '正在生成...' : '导出备货计划'}
          </button>
        </div>
      </div>

      {params ? <RouteSettings params={params} saving={saving} meta={meta} horizonMonths={horizonMonths} onHorizonChange={changeHorizon} onChange={changeParam} onSave={saveParams} /> : null}

      <div className="toolbar supply-plan-toolbar">
        <span className="section-count">全量跟单计划：共 {pagination.totalItems} 个产品型号，包含 {pagination.totalChildItems} 个事业部＋物料编码</span>
      </div>

      <div className="supply-plan-filter-bar" aria-label="供应计划筛选器">
        {SUPPLY_PLAN_FILTER_FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <select aria-label={label} value={filters[key]} onChange={(event) => changeFilter(key, event.target.value)}>
              <option value="">全部{label}</option>
              {filterOptions[key].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className="ghost" disabled={!Object.values(filters).some(Boolean)} onClick={() => {
          setFilters(EMPTY_FILTERS);
          setCurrentPage(1);
          setPageDraft('1');
          modelStatesRef.current = new Map();
          setModelStates(new Map());
        }}>清空筛选</button>
      </div>

      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <div className="supply-plan-table-wrap" onScroll={handleWeekScroll}>
        <table className="supply-plan-table">
          <thead>
            <tr>
              {fixedColumns.map((column, index) => (
                <th key={column.key} className={`supply-plan-sticky${CHILD_DETAIL_COLUMNS.some((detail) => detail.key === column.key) ? ' supply-plan-detail-column' : ''}`} style={stickyStyle(fixedColumns, index)}>{column.label}</th>
              ))}
              <th className="supply-plan-data-column">数据</th>
              {visibleWeekRange.start ? <th aria-hidden="true" className="supply-plan-week-spacer" style={{ width: visibleWeekRange.start * WEEK_COLUMN_WIDTH, minWidth: visibleWeekRange.start * WEEK_COLUMN_WIDTH }} /> : null}
              {visibleWeeks.map((week) => (
                <th key={week.key} className="week-column"><strong>{week.label}</strong><small>{week.dateRange}</small></th>
              ))}
              {visibleWeekRange.end < weeks.length ? <th aria-hidden="true" className="supply-plan-week-spacer" style={{ width: (weeks.length - visibleWeekRange.end) * WEEK_COLUMN_WIDTH, minWidth: (weeks.length - visibleWeekRange.end) * WEEK_COLUMN_WIDTH }} /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => {
              const detailState = modelStates.get(group.modelKey);
              const expanded = Boolean(detailState?.expanded);
              return (
                <Fragment key={group.modelKey}>
                  <SupplyPlanMetricRows
                    row={group}
                    rowKey={`parent-${group.modelKey}`}
                    fixedColumns={fixedColumns}
                    visibleWeeks={visibleWeeks}
                    weekStart={visibleWeekRange.start}
                    totalWeeks={weeks.length}
                    level="parent"
                    expanded={expanded}
                    childCount={group.childCount}
                    detailLoading={detailState?.loading}
                    onToggle={toggleModel}
                  />
                  {expanded ? detailState?.rows?.map((child) => (
                    <SupplyPlanMetricRows
                      key={supplyPlanRowKey(child)}
                      row={child}
                      rowKey={`child-${group.modelKey}-${supplyPlanRowKey(child)}`}
                      fixedColumns={fixedColumns}
                      visibleWeeks={visibleWeeks}
                      weekStart={visibleWeekRange.start}
                      totalWeeks={weeks.length}
                      level="child"
                    />
                  )) : null}
                  {expanded && detailState?.loading ? <tr><td className="supply-plan-detail-status" colSpan={fixedColumns.length + visibleWeeks.length + 3}>正在读取该型号明细…</td></tr> : null}
                  {expanded && detailState?.error ? <tr><td className="supply-plan-detail-status error" colSpan={fixedColumns.length + visibleWeeks.length + 3}>{detailState.error}</td></tr> : null}
                </Fragment>
              );
            })}
            {!rows.length ? <tr><td className="empty-cell" colSpan={fixedColumns.length + 1 + visibleWeeks.length}>暂无可展示的供应计划数据</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="supply-plan-pagination">
        <span>每页 {SUPPLY_PLAN_PAGE_SIZE} 个产品型号，第 {pagination.page} / {pagination.totalPages} 页</span>
        <div>
          <button type="button" className="ghost" disabled={pagination.page <= 1 || loading} onClick={() => goToPage(pagination.page - 1)}>上一页</button>
          <form onSubmit={(event) => { event.preventDefault(); goToPage(pageDraft); }}>
            <label>跳至 <input aria-label="页码跳转" type="number" min="1" max={pagination.totalPages} value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} /> 页</label>
            <button type="submit" className="ghost" disabled={loading}>跳转</button>
          </form>
          <button type="button" className="ghost" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.page + 1)}>下一页</button>
        </div>
      </div>
    </div>
  );
}
