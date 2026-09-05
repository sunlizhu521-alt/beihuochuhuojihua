import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SUPPLY_PLAN_FILTER_FIELDS,
  SUPPLY_PLAN_FORECAST_STATUS_OPTIONS,
  SUPPLY_PLAN_INVENTORY_STATUS_OPTIONS,
  SUPPLY_PLAN_PAGE_SIZE,
  SUPPLY_PLAN_ROW_TYPES,
  buildSupplyPlanWeeks,
  normalizeSupplyPlanBusinessUnit,
  supplyPlanRowKey,
  supplyPlanVirtualWindow
} from './supply-plan.js';
import { API } from './api-base.js';
import SharedFilterBar from './components/SharedFilterBar.jsx';
import RouteSettingsPanel from './RouteSettingsPanel.jsx';
import {
  ROUTE_SETTINGS_EVENT,
  loadRouteSettings,
  saveRouteSettings
} from './route-settings-storage.js';
const HORIZON_MONTHS = [6, 9, 12, 15, 18, 21, 24];
const WEEK_COLUMN_WIDTH = 72;
const WEEK_OVERSCAN = 3;
const FILTER_DEBOUNCE_MS = 300;
const METRIC_BLOCK_HEIGHT = 174;
const STATUS_ROW_HEIGHT = 44;
const VERTICAL_OVERSCAN_HEIGHT = METRIC_BLOCK_HEIGHT * 10;
const RELATED_DETAILS_COLUMN_WIDTH = 360;
const RELATED_DETAILS_COLUMN = Object.freeze({
  key: 'relatedDetails',
  label: '关联物料明细',
  width: RELATED_DETAILS_COLUMN_WIDTH
});
const SUMMARY_FIXED_COLUMNS = [
  { key: 'productLine', label: '产品线', width: 92 },
  { key: 'productSeries', label: '系列', width: 92 },
  { key: 'model', label: '型号', width: 142 },
  { key: 'actionConclusion', label: '动作结论', width: 100 },
  { key: 'safetyStockQty', label: '安全库存数量', width: 112 },
  { key: 'metric', label: '供应计划指标', width: 112 }
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
  ...SUMMARY_FIXED_COLUMNS.slice(0, 4),
  ...CHILD_DETAIL_COLUMNS,
  ...SUMMARY_FIXED_COLUMNS.slice(4)
];
const EMPTY_FILTERS = Object.freeze({
  businessUnit: Object.freeze([]),
  productLine: Object.freeze([]),
  productSeries: Object.freeze([]),
  productType: Object.freeze([]),
  inventoryStatus: Object.freeze([]),
  hasForecast: Object.freeze([]),
  actionConclusion: Object.freeze([])
});
const FILTER_OPTIONS_DEFAULT = Object.freeze({
  businessUnit: [],
  productLine: [],
  productSeries: [],
  productType: [],
  inventoryStatus: SUPPLY_PLAN_INVENTORY_STATUS_OPTIONS,
  hasForecast: SUPPLY_PLAN_FORECAST_STATUS_OPTIONS,
  actionConclusion: []
});
const SUPPLY_PLAN_SHARED_FILTERS = Object.freeze([
  ...SUPPLY_PLAN_FILTER_FIELDS.filter(({ key }) => key !== 'actionConclusion'),
  { key: 'inventoryStatus', label: '库存状态' },
  { key: 'hasForecast', label: '是否有预测' },
  ...SUPPLY_PLAN_FILTER_FIELDS.filter(({ key }) => key === 'actionConclusion')
]);

function filtersEqual(left, right) {
  return Object.keys(EMPTY_FILTERS).every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!Array.isArray(leftValue) && !Array.isArray(rightValue)) return leftValue === rightValue;
    const leftList = Array.isArray(leftValue) ? leftValue : [];
    const rightList = Array.isArray(rightValue) ? rightValue : [];
    return leftList.length === rightList.length && leftList.every((value, index) => value === rightList[index]);
  });
}

function filterQueryValues(filters) {
  return Object.fromEntries(Object.entries(filters).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.length ? [[key, value.join(',')]] : [];
    return value ? [[key, value]] : [];
  }));
}

function detailCacheKey(group, horizonMonths, filterQuery) {
  return `${horizonMonths}\u001f${new URLSearchParams(filterQuery)}\u001f${group.modelKey}`;
}

function numberText(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN', { maximumFractionDigits });
}

function timestampText(value) {
  return String(value || '').replace('T', ' ').replace(/\.\d{3}Z$/, '');
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
  if (metric === '预测剩余库存') return row.weeklyRemainingStock?.[weekIndex] ?? null;
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

const SupplyPlanRelatedDetails = memo(function SupplyPlanRelatedDetails({ details = [] }) {
  if (!details.length) return <span className="supply-plan-related-empty">—</span>;
  return (
    <div className="supply-plan-related-list">
      {details.map((detail) => {
        const code = String(detail.materialCode || '未匹配');
        const sku = String(detail.sku || '未匹配');
        return (
          <div key={`${detail.businessUnit || ''}-${code}-${sku}`}>
            {code}({sku}) 在库{numberText(detail.onHandQty)}/在途{numberText(detail.inTransitQty)}/未交付{numberText(detail.undeliveredQty)}
          </div>
        );
      })}
    </div>
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
      {fixedColumns.map((column, index) => {
        if (column.key === 'metric') {
          return <td key={column.key} className="supply-plan-sticky metric-name" style={stickyStyle(fixedColumns, index)}>{metric}</td>;
        }
        if (metricIndex !== 0) return null;
        if (column.key === 'actionConclusion') {
          return (
            <td
              key={column.key}
              rowSpan={SUPPLY_PLAN_ROW_TYPES.length}
              className="supply-plan-sticky supply-plan-action-column supply-plan-action-rowspan"
              style={stickyStyle(fixedColumns, index)}
            >
              <SupplyPlanActionBadge row={row} />
            </td>
          );
        }
        if (column.key === 'relatedDetails') {
          return (
            <td
              key={column.key}
              rowSpan={SUPPLY_PLAN_ROW_TYPES.length}
              className="supply-plan-sticky supply-plan-related-details-column"
              style={stickyStyle(fixedColumns, index)}
            >
              <SupplyPlanRelatedDetails details={row.relatedDetails} />
            </td>
          );
        }
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
      })}
      <td className={`numeric-cell supply-plan-data-column${metric === '预测剩余库存' && metricDataValue(row, metric) < Number(row.safetyStockQty || 0) ? ' inventory-negative' : ''}`}>
        {numberText(metricDataValue(row, metric))}
      </td>
      {beforeWidth ? <td aria-hidden="true" className="supply-plan-week-spacer" style={{ width: beforeWidth, minWidth: beforeWidth }} /> : null}
      {visibleWeeks.map((week, visibleIndex) => {
        const weekIndex = weekStart + visibleIndex;
        const value = metricWeekValue(row, metric, weekIndex);
        const negativeRemaining = metric === '预测剩余库存' && value !== null && value < Number(row.safetyStockQty || 0);
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

function ActionConclusionRules() {
  return (
    <details className="supply-plan-action-rules" open>
      <summary>动作结论判定规则</summary>
      <div className="supply-plan-action-rules-content">
        <p><strong>正常流转：</strong>不存在缺货风险，按正常节奏持续监控。</p>
        <p><strong>需要补货：</strong>存在销售预测，且计入未交付数量后，全预测窗口内仍会出现库存不足，需新增补货。</p>
        <p><strong>调整计划：</strong>存在销售预测，全链路周期内预测剩余库存会跌为负数，但计入未交付数量后全预测窗口仍可覆盖，需调整现有到货节奏。</p>
        <p><strong>停采观察：</strong>无销售预测，全链路周期内预测剩余库存持续为正，且计入未交付数量后全预测窗口也持续为正，建议暂停采购并观察库存消耗。</p>
        <p className="supply-plan-action-rules-note">
          预测剩余库存按周递推扣减销售预测；建议采购数量按首次低于安全库存的周倒退计算。判定优先级：停采观察 → 需要补货 → 调整计划 → 正常流转。
        </p>
      </div>
    </details>
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
  const [filterDrafts, setFilterDrafts] = useState(EMPTY_FILTERS);
  const [filterDebouncing, setFilterDebouncing] = useState(false);
  const [showRelatedDetails, setShowRelatedDetails] = useState(false);
  const [filterOptions, setFilterOptions] = useState(FILTER_OPTIONS_DEFAULT);
  const [pagination, setPagination] = useState({ page: 1, pageSize: SUPPLY_PLAN_PAGE_SIZE, totalItems: 0, totalPages: 1, totalChildItems: 0 });
  const [modelStates, setModelStates] = useState(() => new Map());
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [weeks, setWeeks] = useState(() => buildSupplyPlanWeeks(6));
  const [visibleWeekRange, setVisibleWeekRange] = useState({ start: 0, end: 14 });
  const [verticalViewport, setVerticalViewport] = useState({ scrollTop: 0, height: 700 });
  const modelStatesRef = useRef(modelStates);
  const modelDetailCacheRef = useRef(new Map());
  const summaryRequestRef = useRef(0);
  const scrollFrameRef = useRef(0);
  const tableWrapRef = useRef(null);

  useEffect(() => {
    modelStatesRef.current = modelStates;
  }, [modelStates]);

  const resetTableScroll = useCallback(() => {
    if (tableWrapRef.current) tableWrapRef.current.scrollTop = 0;
    setVerticalViewport((current) => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 });
  }, []);

  useEffect(() => {
    if (!filterDebouncing || filtersEqual(filterDrafts, filters)) {
      if (filterDebouncing) setFilterDebouncing(false);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setFilters(filterDrafts);
      setCurrentPage(1);
      setPageDraft('1');
      resetTableScroll();
      modelStatesRef.current = new Map();
      setModelStates(new Map());
      setFilterDebouncing(false);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [filterDebouncing, filterDrafts, filters, resetTableScroll]);

  const filterQuery = useMemo(() => filterQueryValues(filters), [filters]);
  const filterConfigs = useMemo(() => SUPPLY_PLAN_SHARED_FILTERS.map(({ key, label }) => ({
    key,
    label,
    options: filterOptions[key] || [],
    multiSelect: true
  })), [filterOptions]);

  const loadSummary = useCallback(async ({ manual = false, page = currentPage, months = horizonMonths } = {}) => {
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    if (manual) modelDetailCacheRef.current.clear();
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
      const storedParams = loadRouteSettings();
      setParams(storedParams || payload.params);
      if (!storedParams && payload.params) saveRouteSettings(payload.params);
      setPagination(payload.pagination || { page: 1, pageSize: SUPPLY_PLAN_PAGE_SIZE, totalItems: 0, totalPages: 1, totalChildItems: 0 });
      setFilterOptions(payload.filterOptions || FILTER_OPTIONS_DEFAULT);
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
    const syncParams = (event) => {
      const next = event.type === ROUTE_SETTINGS_EVENT ? event.detail : loadRouteSettings();
      if (next?.channels) setParams(next);
    };
    window.addEventListener('storage', syncParams);
    window.addEventListener(ROUTE_SETTINGS_EVENT, syncParams);
    return () => {
      window.removeEventListener('storage', syncParams);
      window.removeEventListener(ROUTE_SETTINGS_EVENT, syncParams);
    };
  }, []);

  useEffect(() => {
    setVisibleWeekRange({ start: 0, end: Math.min(14, weeks.length) });
  }, [weeks.length]);

  const changeParam = useCallback((channelKey, field, rawValue) => {
    const value = rawValue === '' ? '' : Number(rawValue);
    const next = {
      ...params,
      channels: {
        ...params.channels,
        [channelKey]: { ...params.channels[channelKey], [field]: value }
      }
    };
    setParams(next);
    saveRouteSettings(next);
  }, [params]);

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
      saveRouteSettings(payload.params);
      setMeta((current) => ({ ...current, updatedBy: payload.updatedBy || '', updatedAt: payload.updatedAt || '' }));
      setMessage(`路由时间已保存到腾讯云，保存人：${payload.updatedBy || '未知用户'}。`);
      modelDetailCacheRef.current.clear();
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
    resetTableScroll();
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
    const cacheKey = detailCacheKey(group, horizonMonths, filterQuery);
    const cachedRows = modelDetailCacheRef.current.get(cacheKey);
    if (cachedRows) {
      const next = new Map(modelStatesRef.current);
      next.set(group.modelKey, { expanded: true, loading: false, rows: cachedRows, error: '' });
      modelStatesRef.current = next;
      setModelStates(next);
      setMessage(`型号 ${group.model} 明细已从缓存加载。`);
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
      modelDetailCacheRef.current.set(cacheKey, payload.rows || []);
      while (modelDetailCacheRef.current.size > 300) {
        modelDetailCacheRef.current.delete(modelDetailCacheRef.current.keys().next().value);
      }
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

  const flattenedRows = useMemo(() => rows.flatMap((group) => {
    const detailState = modelStates.get(group.modelKey);
    const expanded = Boolean(detailState?.expanded);
    const items = [{
      key: `parent-${group.modelKey}`,
      kind: 'data',
      row: {
        ...group,
        businessUnit: normalizeSupplyPlanBusinessUnit(group.businessUnit),
        normalizedBusinessUnit: normalizeSupplyPlanBusinessUnit(group.businessUnit)
      },
      level: 'parent',
      expanded,
      childCount: group.childCount,
      detailLoading: Boolean(detailState?.loading),
      height: METRIC_BLOCK_HEIGHT
    }];
    if (!expanded) return items;
    (detailState?.rows || []).forEach((child) => {
      items.push({
        key: `child-${group.modelKey}-${supplyPlanRowKey(child)}`,
        kind: 'data',
        row: {
          ...child,
          businessUnit: normalizeSupplyPlanBusinessUnit(child.businessUnit),
          normalizedBusinessUnit: normalizeSupplyPlanBusinessUnit(child.businessUnit)
        },
        level: 'child',
        expanded: false,
        childCount: 0,
        detailLoading: false,
        height: METRIC_BLOCK_HEIGHT
      });
    });
    if (detailState?.loading || detailState?.error) items.push({
      key: `status-${group.modelKey}`,
      kind: 'status',
      error: detailState.error || '',
      height: STATUS_ROW_HEIGHT
    });
    return items;
  }), [modelStates, rows]);

  const showChildColumns = useMemo(
    () => flattenedRows.some((item) => item.level === 'child' || item.expanded),
    [flattenedRows]
  );
  const fixedColumns = useMemo(() => {
    const columns = showChildColumns ? EXPANDED_FIXED_COLUMNS : SUMMARY_FIXED_COLUMNS;
    if (!showRelatedDetails) return columns;
    const modelIndex = columns.findIndex((column) => column.key === 'model');
    return [
      ...columns.slice(0, modelIndex + 1),
      RELATED_DETAILS_COLUMN,
      ...columns.slice(modelIndex + 1)
    ];
  }, [showChildColumns, showRelatedDetails]);
  const fixedWidth = useMemo(() => (
    fixedColumns.reduce((sum, column) => sum + column.width, 0)
    + 82
  ), [fixedColumns]);
  const visibleWeeks = useMemo(
    () => weeks.slice(visibleWeekRange.start, visibleWeekRange.end),
    [visibleWeekRange, weeks]
  );
  const virtualRows = useMemo(() => supplyPlanVirtualWindow(
    flattenedRows,
    verticalViewport.scrollTop,
    verticalViewport.height,
    VERTICAL_OVERSCAN_HEIGHT
  ), [flattenedRows, verticalViewport.height, verticalViewport.scrollTop]);

  const handleTableScroll = useCallback((event) => {
    const element = event.currentTarget;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const firstVisible = Math.max(0, Math.floor((element.scrollLeft - fixedWidth) / WEEK_COLUMN_WIDTH));
      const start = Math.max(0, firstVisible - WEEK_OVERSCAN);
      const visibleCount = Math.ceil(element.clientWidth / WEEK_COLUMN_WIDTH) + WEEK_OVERSCAN * 2;
      const end = Math.min(weeks.length, start + visibleCount);
      setVisibleWeekRange((current) => current.start === start && current.end === end ? current : { start, end });
      setVerticalViewport((current) => (
        current.scrollTop === element.scrollTop && current.height === element.clientHeight
          ? current
          : { scrollTop: element.scrollTop, height: element.clientHeight }
      ));
    });
  }, [fixedWidth, weeks.length]);

  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), []);

  function changeFilter(key, value) {
    setFilterDrafts((current) => ({ ...current, [key]: value }));
    setFilterDebouncing(true);
  }

  function clearFilters() {
    setFilterDrafts(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setFilterDebouncing(false);
    setCurrentPage(1);
    setPageDraft('1');
    resetTableScroll();
    modelStatesRef.current = new Map();
    setModelStates(new Map());
  }

  function goToPage(page) {
    const safePage = Math.min(pagination.totalPages, Math.max(1, Number(page) || 1));
    setCurrentPage(safePage);
    setPageDraft(String(safePage));
    resetTableScroll();
  }

  if (!params && loading) return <div className="loading-fallback">正在计算供应计划...</div>;

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

      {params ? (
        <RouteSettingsPanel
          params={params}
          saving={saving}
          meta={meta}
          horizonMonths={horizonMonths}
          horizonOptions={HORIZON_MONTHS}
          onHorizonChange={changeHorizon}
          onChange={changeParam}
          onSave={saveParams}
        >
          <ActionConclusionRules />
        </RouteSettingsPanel>
      ) : null}

      <div className="toolbar supply-plan-toolbar">
        <span className="section-count">全量跟单计划：共 {pagination.totalItems} 个产品型号，包含 {pagination.totalChildItems} 个事业部＋物料编码</span>
        <label className="supply-plan-related-toggle">
          <input type="checkbox" checked={showRelatedDetails} onChange={(event) => setShowRelatedDetails(event.target.checked)} />
          <span>显示关联物料明细</span>
        </label>
      </div>

      <SharedFilterBar
        filters={filterConfigs}
        values={filterDrafts}
        onChange={changeFilter}
        onClear={clearFilters}
        ariaLabel="供应计划筛选器"
        status={filterDebouncing ? '计算中...' : ''}
      />

      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <div
        ref={tableWrapRef}
        className="supply-plan-table-wrap"
        style={{ contain: 'layout paint' }}
        onScroll={handleTableScroll}
      >
        <table className="supply-plan-table">
          <thead>
            <tr>
              {fixedColumns.map((column, index) => (
                <th key={column.key} className={`supply-plan-sticky${CHILD_DETAIL_COLUMNS.some((detail) => detail.key === column.key) ? ' supply-plan-detail-column' : ''}${column.key === 'relatedDetails' ? ' supply-plan-related-details-column' : ''}`} style={stickyStyle(fixedColumns, index)}>{column.label}</th>
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
            {virtualRows.beforeHeight ? (
              <tr className="supply-plan-virtual-spacer" aria-hidden="true">
                <td colSpan={fixedColumns.length + visibleWeeks.length + 3} style={{ height: virtualRows.beforeHeight }} />
              </tr>
            ) : null}
            {virtualRows.visible.map((item) => item.kind === 'status' ? (
              <tr key={item.key}>
                <td className={`supply-plan-detail-status${item.error ? ' error' : ''}`} colSpan={fixedColumns.length + visibleWeeks.length + 3}>
                  {item.error || '正在读取该型号明细…'}
                </td>
              </tr>
            ) : (
              <SupplyPlanMetricRows
                key={item.key}
                row={item.row}
                rowKey={item.key}
                fixedColumns={fixedColumns}
                visibleWeeks={visibleWeeks}
                weekStart={visibleWeekRange.start}
                totalWeeks={weeks.length}
                level={item.level}
                expanded={item.expanded}
                childCount={item.childCount}
                detailLoading={item.detailLoading}
                onToggle={toggleModel}
              />
            ))}
            {virtualRows.afterHeight ? (
              <tr className="supply-plan-virtual-spacer" aria-hidden="true">
                <td colSpan={fixedColumns.length + visibleWeeks.length + 3} style={{ height: virtualRows.afterHeight }} />
              </tr>
            ) : null}
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
