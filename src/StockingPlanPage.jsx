import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { API } from './api-base.js';
import RouteSettingsPanel from './RouteSettingsPanel.jsx';
import {
  ROUTE_SETTINGS_EVENT,
  DEFAULT_ROUTE_SETTINGS,
  loadRouteSettings,
  saveRouteSettings
} from './route-settings-storage.js';
import {
  buildStockingPlanRows,
  filterStockingPlanRows,
  groupStockingPlanRowsByMaterial
} from './stocking-plan.js';

const MATERIALS_PER_PAGE = 20;
const EMPTY_FILTERS = Object.freeze({
  productLine: Object.freeze([]),
  productSeries: Object.freeze([]),
  productType: Object.freeze([]),
  businessUnit: Object.freeze([]),
  inventoryStatus: '',
  hasForecast: ''
});
const MULTI_FILTERS = [
  ['productLine', '产品线'],
  ['productSeries', '系列'],
  ['productType', '销售产品分类'],
  ['businessUnit', '事业部']
];

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0';
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function filterOptions(rows, field) {
  return [...new Set(rows.map((row) => String(row[field] || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}

const StockingPlanMultiFilter = memo(function StockingPlanMultiFilter({ field, label, options, selected, onChange }) {
  return (
    <details className="stocking-plan-filter-multi">
      <summary>{label}{selected.length ? `（${selected.length}）` : ''}</summary>
      <div className="stocking-plan-filter-options">
        {options.length ? options.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(event) => onChange(field, option, event.target.checked)}
            />
            <span>{option}</span>
          </label>
        )) : <span className="stocking-plan-filter-empty">暂无选项</span>}
      </div>
    </details>
  );
});

const StockingPlanParentRow = memo(function StockingPlanParentRow({
  row,
  groupKey,
  expanded,
  forecastMode,
  expectedDelivery,
  editingDelivery,
  onToggle,
  onEditExpectedDelivery,
  onExpectedDeliveryChange
}) {
  const forecastValues = forecastMode === 'month' ? row.monthForecasts : row.weeklyForecast;
  return (
    <tr
      className="stocking-plan-parent-row"
      onClick={(event) => {
        if (!event.target.closest('button, input')) onToggle(groupKey);
      }}
    >
      <td className="stocking-plan-business-cell">
        <button
          type="button"
          className="stocking-plan-expand-button"
          aria-label={`${expanded ? '折叠' : '展开'} ${row.model || row.materialCode}`}
          aria-expanded={expanded}
          onClick={() => onToggle(groupKey)}
        >
          {expanded ? '▼' : '▶'}
        </button>
      </td>
      <td>{row.productLine || '-'}</td>
      <td>{row.productSeries || '-'}</td>
      <td>{row.model || '-'}</td>
      <td>{row.materialCode || '-'}</td>
      <td>{row.sku || '-'}</td>
      <td className="stocking-plan-name-cell" title={row.productName}>{row.productName || '-'}</td>
      {forecastValues.map((value, index) => <td className="numeric-cell" key={index}>{numberText(value)}</td>)}
      <td className="numeric-cell">{numberText(row.onHandQty)}</td>
      <td className="numeric-cell">{numberText(row.inTransitQty)}</td>
      <td className="numeric-cell">{numberText(row.undeliveredQty)}</td>
      <td className="numeric-cell stocking-plan-purchase-cell">{numberText(row.suggestedPurchaseQty)}</td>
      <td
        className="stocking-plan-delivery-cell"
        onClick={(event) => {
          event.stopPropagation();
          onEditExpectedDelivery(row.materialCode);
        }}
      >
        {editingDelivery ? (
          <input
            autoFocus
            type="text"
            className="stocking-plan-date-input"
            aria-label={`期望交期 ${row.materialCode}`}
            value={expectedDelivery}
            onInput={(event) => onExpectedDeliveryChange(row.materialCode, event.currentTarget.value)}
            onBlur={() => onEditExpectedDelivery('')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
            }}
          />
        ) : expectedDelivery}
      </td>
    </tr>
  );
});

const StockingPlanChildRow = memo(function StockingPlanChildRow({ row, forecastMode }) {
  const forecastValues = forecastMode === 'month' ? row.monthForecasts : row.weeklyForecast;
  return (
    <tr className="stocking-plan-child-row">
      <td className="stocking-plan-business-cell"><span>{row.businessUnit || '-'}</span></td>
      <td>{row.productLine || '-'}</td>
      <td>{row.productSeries || '-'}</td>
      <td>{row.model || '-'}</td>
      <td>{row.materialCode || '-'}</td>
      <td>{row.sku || '-'}</td>
      <td className="stocking-plan-name-cell" title={row.productName}>{row.productName || '-'}</td>
      {forecastValues.map((value, index) => <td className="numeric-cell" key={index}>{numberText(value)}</td>)}
      <td className="numeric-cell">{numberText(row.onHandQty)}</td>
      <td className="numeric-cell">{numberText(row.inTransitQty)}</td>
      <td className="numeric-cell">{numberText(row.undeliveredQty)}</td>
      <td aria-label={`子行建议采购数量 ${row.businessUnit} ${row.materialCode}`} />
      <td aria-label={`子行期望交期 ${row.businessUnit} ${row.materialCode}`} />
    </tr>
  );
});

export default function StockingPlanPage({ token, active }) {
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forecastMode, setForecastMode] = useState('month');
  const [page, setPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [expectedDeliveries, setExpectedDeliveries] = useState(() => new Map());
  const [editingDelivery, setEditingDelivery] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [routeParams, setRouteParams] = useState(() => loadRouteSettings() || DEFAULT_ROUTE_SETTINGS);
  const [routeMeta, setRouteMeta] = useState({ updatedBy: '', updatedAt: '' });
  const [routeSaving, setRouteSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      apiRequest('/api/stocking-plan/source', token, { signal: controller.signal }),
      apiRequest('/api/supply-plan/params', token, { signal: controller.signal })
    ])
      .then(([sourcePayload, routePayload]) => {
        setSource(sourcePayload);
        const stored = loadRouteSettings();
        const nextRouteParams = stored || routePayload.params || DEFAULT_ROUTE_SETTINGS;
        setRouteParams(nextRouteParams);
        if (!stored) saveRouteSettings(nextRouteParams);
        setRouteMeta({ updatedBy: routePayload.updatedBy || '', updatedAt: routePayload.updatedAt || '' });
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || '备货需求计划加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, token]);

  useEffect(() => {
    const syncRouteSettings = (event) => {
      const next = event.type === ROUTE_SETTINGS_EVENT ? event.detail : loadRouteSettings();
      if (next?.channels) setRouteParams(next);
    };
    window.addEventListener('storage', syncRouteSettings);
    window.addEventListener(ROUTE_SETTINGS_EVENT, syncRouteSettings);
    return () => {
      window.removeEventListener('storage', syncRouteSettings);
      window.removeEventListener(ROUTE_SETTINGS_EVENT, syncRouteSettings);
    };
  }, []);

  const plan = useMemo(() => buildStockingPlanRows(source || {}), [source]);
  const options = useMemo(() => Object.fromEntries(MULTI_FILTERS.map(([field]) => [field, filterOptions(plan.rows, field)])), [plan.rows]);
  const filteredRows = useMemo(() => filterStockingPlanRows(plan.rows, filters), [filters, plan.rows]);
  const materialGroups = useMemo(() => groupStockingPlanRowsByMaterial(filteredRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(materialGroups.length / MATERIALS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const visibleGroups = useMemo(
    () => materialGroups.slice((currentPage - 1) * MATERIALS_PER_PAGE, currentPage * MATERIALS_PER_PAGE),
    [currentPage, materialGroups]
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const toggleGroup = useCallback((groupKey) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const setExpectedDelivery = useCallback((materialCode, value) => {
    setExpectedDeliveries((current) => {
      const next = new Map(current);
      if (value) next.set(materialCode, value);
      else next.delete(materialCode);
      return next;
    });
  }, []);

  const changeMultiFilter = useCallback((field, option, checked) => {
    setFilters((current) => ({
      ...current,
      [field]: checked ? [...current[field], option] : current[field].filter((value) => value !== option)
    }));
    setPage(1);
  }, []);

  const changeSingleFilter = useCallback((field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  }, []);

  const changeRouteParam = useCallback((channelKey, field, rawValue) => {
    const value = rawValue === '' ? '' : Number(rawValue);
    const next = {
      ...routeParams,
      channels: {
        ...routeParams.channels,
        [channelKey]: { ...routeParams.channels[channelKey], [field]: value }
      }
    };
    setRouteParams(next);
    saveRouteSettings(next);
  }, [routeParams]);

  const saveRouteParams = useCallback(async () => {
    if (routeSaving) return;
    setRouteSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = await apiRequest('/api/supply-plan/params', token, {
        method: 'POST',
        body: JSON.stringify(routeParams)
      });
      setRouteParams(payload.params);
      saveRouteSettings(payload.params);
      setRouteMeta({ updatedBy: payload.updatedBy || '', updatedAt: payload.updatedAt || '' });
      setMessage('路由时间已保存，两页面已同步。');
    } catch (requestError) {
      setError(requestError.message || '路由时间保存失败');
    } finally {
      setRouteSaving(false);
    }
  }, [routeParams, routeSaving, token]);

  if (!source && loading) return <div className="loading-fallback">正在加载备货需求计划...</div>;

  return (
    <section className="stocking-plan-page">
      <div className="page-heading-row stocking-plan-heading">
        <div>
          <h2>备货需求计划</h2>
          <p>按型号＋物料编码汇总，展开后查看各事业部明细。</p>
        </div>
        <div className="stocking-plan-view-toggle" role="group" aria-label="预测视图切换">
          <button type="button" className={forecastMode === 'month' ? 'active' : ''} onClick={() => setForecastMode('month')}>月预测</button>
          <button type="button" className={forecastMode === 'week' ? 'active' : ''} onClick={() => setForecastMode('week')}>周预测</button>
        </div>
      </div>
      <div className="stocking-plan-meta">
        <span>共 {materialGroups.length} 个型号＋物料编码父项，{filteredRows.length} 条事业部明细</span>
        {source?.updatedAt ? <span>数据更新：{source.updatedAt}</span> : null}
      </div>
      <RouteSettingsPanel
        params={routeParams}
        saving={routeSaving}
        meta={routeMeta}
        onChange={changeRouteParam}
        onSave={saveRouteParams}
      />
      <section className="stocking-plan-filter-panel" aria-label="备货需求计划筛选器">
        {MULTI_FILTERS.map(([field, label]) => (
          <StockingPlanMultiFilter
            key={field}
            field={field}
            label={label}
            options={options[field] || []}
            selected={filters[field]}
            onChange={changeMultiFilter}
          />
        ))}
        <label className="stocking-plan-filter-select">
          <span>库存状态</span>
          <select aria-label="库存状态" value={filters.inventoryStatus} onChange={(event) => changeSingleFilter('inventoryStatus', event.target.value)}>
            <option value="">全部</option>
            <option value="onHand">在库</option>
            <option value="inTransit">在途</option>
            <option value="undelivered">未交付</option>
          </select>
        </label>
        <label className="stocking-plan-filter-select">
          <span>是否有预测</span>
          <select aria-label="是否有预测" value={filters.hasForecast} onChange={(event) => changeSingleFilter('hasForecast', event.target.value)}>
            <option value="">全部</option>
            <option value="yes">有</option>
            <option value="no">无</option>
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>清空筛选</button>
      </section>
      {error ? <p className="error-message">{error}</p> : null}
      {message ? <p className="success-message">{message}</p> : null}
      {!loading && !error && plan.rows.length === 0 ? (
        <div className="stocking-plan-empty" role="status">
          <strong>暂无备货需求计划数据</strong>
          <span>请先在底表文件和维度表库上传并应用槽位 18、19、21 及商品分类。</span>
        </div>
      ) : null}
      {plan.rows.length > 0 ? (
        <>
          <div className="stocking-plan-table-wrap">
            <table className="stocking-plan-table">
              <thead>
                <tr>
                  {['事业部', '产品线', '系列', '型号', '物料编码', 'SKU', '产品名称'].map((label) => <th key={label}>{label}</th>)}
                  {forecastMode === 'month'
                    ? Array.from({ length: 6 }, (_, index) => <th key={`M${index + 1}`}>M{index + 1}预测</th>)
                    : plan.weeks.map((week) => <th className="stocking-plan-week-column" key={week.key}><strong>{week.label}</strong><small>{week.dateRange}</small></th>)}
                  {['在库量', '在途量', '未交付量', '建议采购数量', '期望交期'].map((label) => <th key={label}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => {
                  const expanded = expandedGroups.has(group.key);
                  const expectedDelivery = expectedDeliveries.get(group.materialCode) || '';
                  return (
                    <Fragment key={group.key}>
                      <StockingPlanParentRow
                        row={group.parent}
                        groupKey={group.key}
                        expanded={expanded}
                        forecastMode={forecastMode}
                        expectedDelivery={expectedDelivery}
                        editingDelivery={editingDelivery === group.materialCode}
                        onToggle={toggleGroup}
                        onEditExpectedDelivery={setEditingDelivery}
                        onExpectedDeliveryChange={setExpectedDelivery}
                      />
                      {expanded ? group.children.map((row) => (
                        <StockingPlanChildRow
                          key={row.rowKey}
                          row={row}
                          forecastMode={forecastMode}
                        />
                      )) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="stocking-plan-pagination" aria-label="备货需求计划分页">
            <span>每页 {MATERIALS_PER_PAGE} 个父项，第 {currentPage} / {totalPages} 页</span>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
