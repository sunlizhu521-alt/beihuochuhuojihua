import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  SUPPLY_PLAN_FILTER_FIELDS,
  SUPPLY_PLAN_PAGE_SIZE,
  SUPPLY_PLAN_ROW_TYPES,
  buildSupplyPlanFilterOptions,
  buildSupplyPlanWeeks,
  calculateSupplyPlanRow,
  filterSupplyPlanRows,
  groupSupplyPlanRows,
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
const SUMMARY_FIXED_COLUMNS = [
  { key: 'productLine', label: '产品线', width: 92 },
  { key: 'productSeries', label: '系列', width: 92 },
  { key: 'model', label: '型号', width: 142 },
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
  ...SUMMARY_FIXED_COLUMNS.slice(0, 3),
  ...CHILD_DETAIL_COLUMNS,
  ...SUMMARY_FIXED_COLUMNS.slice(3)
];
const EMPTY_FILTERS = Object.freeze({ businessUnit: '', productLine: '', productSeries: '' });

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
  return metric === '建议采购' ? row.purchaseGap : 0;
}

function SupplyPlanMetricRows({ row, rowKey, fixedColumns, weeks, level, expanded = false, childCount = 0, onToggle }) {
  return SUPPLY_PLAN_ROW_TYPES.map((metric, metricIndex) => (
    <tr
      key={`${rowKey}-${metric}`}
      className={`${metricIndex === 0 ? 'supply-plan-group-start ' : ''}${level === 'parent' ? 'supply-plan-parent-row' : 'supply-plan-child-row'} metric-row-${metricIndex}`}
    >
      {metricIndex === 0 ? fixedColumns.slice(0, -1).map((column, index) => {
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
              <button type="button" className="supply-plan-model-toggle" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}型号 ${row.model}`} onClick={onToggle}>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <strong>{content}</strong>
                <small>{childCount} 项</small>
              </button>
            ) : content}
          </td>
        );
      }) : null}
      <td className="supply-plan-sticky metric-name" style={stickyStyle(fixedColumns, fixedColumns.length - 1)}>{metric}</td>
      <td className="numeric-cell supply-plan-data-column">{numberText(metricDataValue(row, metric))}</td>
      {weeks.map((week, weekIndex) => {
        const value = metricWeekValue(row, metric, weekIndex);
        return (
          <td key={week.key} className={`numeric-cell${metric === '建议采购' && value > 0 ? ' gap-positive' : ''}`}>
            {numberText(value)}
          </td>
        );
      })}
    </tr>
  ));
}

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
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedModels, setExpandedModels] = useState(() => new Set());
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [weeks, setWeeks] = useState(() => buildSupplyPlanWeeks(6));

  async function loadSummary({ manual = false, months = horizonMonths } = {}) {
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest(`/api/supply-plan/summary?months=${months}`, token);
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setWeeks(Array.isArray(payload.weeks) ? payload.weeks : buildSupplyPlanWeeks(months));
      setHorizonMonths(payload.horizonMonths || months);
      setParams(payload.params);
      setMeta({
        updatedBy: payload.updatedBy || '',
        updatedAt: payload.updatedAt || '',
        generatedAt: payload.generatedAt || ''
      });
      if (manual) setMessage(`已读取底表18/19/21最新数据，共 ${payload.rows?.length || 0} 个事业部＋物料编码。`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) {
      setLoadAttempted(false);
      return;
    }
    if (loadAttempted) return;
    setLoadAttempted(true);
    loadSummary();
  }, [active, loadAttempted, token]);

  function changeParam(channelKey, field, rawValue) {
    const value = rawValue === '' ? '' : Number(rawValue);
    setParams((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [channelKey]: { ...current.channels[channelKey], [field]: value }
      }
    }));
  }

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
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function changeHorizon(months) {
    setHorizonMonths(months);
    setCurrentPage(1);
    setExpandedModels(new Set());
    loadSummary({ months });
  }

  const calculatedRows = useMemo(() => rows.map((row) => {
    const safetyDays = params?.channels?.[row.channelKey]?.safetyDays ?? row.safetyDays;
    return calculateSupplyPlanRow(
      { ...row, safetyDays },
      row.weeklyForecast,
      null,
      weeks.length
    );
  }), [rows, params, weeks.length]);

  const filterOptions = useMemo(
    () => buildSupplyPlanFilterOptions(calculatedRows, filters),
    [calculatedRows, filters]
  );
  const filteredRows = useMemo(
    () => filterSupplyPlanRows(calculatedRows, filters),
    [calculatedRows, filters]
  );
  const modelGroups = useMemo(() => groupSupplyPlanRows(filteredRows, weeks.length), [filteredRows, weeks.length]);

  const totalPages = Math.max(1, Math.ceil(modelGroups.length / SUPPLY_PLAN_PAGE_SIZE));
  const visibleGroups = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * SUPPLY_PLAN_PAGE_SIZE;
    return modelGroups.slice(start, start + SUPPLY_PLAN_PAGE_SIZE);
  }, [modelGroups, currentPage, totalPages]);
  const showChildColumns = visibleGroups.some((group) => expandedModels.has(group.key));
  const fixedColumns = showChildColumns ? EXPANDED_FIXED_COLUMNS : SUMMARY_FIXED_COLUMNS;

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  function toggleModel(groupKey) {
    setExpandedModels((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  useEffect(() => {
    setFilters((current) => {
      const next = { ...current };
      let changed = false;
      SUPPLY_PLAN_FILTER_FIELDS.forEach(({ key }) => {
        if (!next[key]) return;
        const options = buildSupplyPlanFilterOptions(rows, next);
        if (!options[key].includes(next[key])) {
          next[key] = '';
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [rows]);

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
        <span>{meta.generatedAt ? `生成时间：${timestampText(meta.generatedAt)}` : ''}</span>
      </div>

      {params ? <RouteSettings params={params} saving={saving} meta={meta} horizonMonths={horizonMonths} onHorizonChange={changeHorizon} onChange={changeParam} onSave={saveParams} /> : null}

      <div className="toolbar supply-plan-toolbar">
        <span className="section-count">全量跟单计划：当前显示 {modelGroups.length} 个产品型号，包含 {filteredRows.length} / {calculatedRows.length} 个事业部＋物料编码</span>
      </div>

      <div className="supply-plan-filter-bar" aria-label="供应计划筛选器">
        {SUPPLY_PLAN_FILTER_FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <select value={filters[key]} onChange={(event) => {
              const value = event.target.value;
              setFilters((current) => {
                const next = { ...current, [key]: value };
                SUPPLY_PLAN_FILTER_FIELDS.forEach(({ key: otherKey }) => {
                  if (otherKey === key || !next[otherKey]) return;
                  const nextOptions = buildSupplyPlanFilterOptions(calculatedRows, next);
                  if (!nextOptions[otherKey].includes(next[otherKey])) next[otherKey] = '';
                });
                return next;
              });
              setCurrentPage(1);
            }}>
              <option value="">全部{label}</option>
              {filterOptions[key].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className="ghost" disabled={!Object.values(filters).some(Boolean)} onClick={() => {
          setFilters(EMPTY_FILTERS);
          setCurrentPage(1);
        }}>清空筛选</button>
      </div>

      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <div className="supply-plan-table-wrap">
        <table className="supply-plan-table">
          <thead>
            <tr>
              {fixedColumns.map((column, index) => (
                <th key={column.key} className={`supply-plan-sticky${CHILD_DETAIL_COLUMNS.some((detail) => detail.key === column.key) ? ' supply-plan-detail-column' : ''}`} style={stickyStyle(fixedColumns, index)}>{column.label}</th>
              ))}
              <th className="supply-plan-data-column">数据</th>
              {weeks.map((week) => (
                <th key={week.key} className="week-column"><strong>{week.label}</strong><small>{week.dateRange}</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((group) => {
              const expanded = expandedModels.has(group.key);
              return (
                <Fragment key={group.key}>
                  <SupplyPlanMetricRows
                    row={group}
                    rowKey={`parent-${group.key}`}
                    fixedColumns={fixedColumns}
                    weeks={weeks}
                    level="parent"
                    expanded={expanded}
                    childCount={group.children.length}
                    onToggle={() => toggleModel(group.key)}
                  />
                  {expanded ? group.children.map((child) => (
                    <SupplyPlanMetricRows
                      key={supplyPlanRowKey(child)}
                      row={child}
                      rowKey={`child-${group.key}-${supplyPlanRowKey(child)}`}
                      fixedColumns={fixedColumns}
                      weeks={weeks}
                      level="child"
                    />
                  )) : null}
                </Fragment>
              );
            })}
            {!visibleGroups.length ? <tr><td className="empty-cell" colSpan={fixedColumns.length + 1 + weeks.length}>暂无可展示的供应计划数据</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="supply-plan-pagination">
        <span>每页 {SUPPLY_PLAN_PAGE_SIZE} 个产品型号，第 {Math.min(currentPage, totalPages)} / {totalPages} 页</span>
        <div>
          <button type="button" className="ghost" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</button>
          <button type="button" className="ghost" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>下一页</button>
        </div>
      </div>
    </div>
  );
}
