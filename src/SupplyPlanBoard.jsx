import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  SUPPLY_PLAN_FILTER_FIELDS,
  SUPPLY_PLAN_PAGE_SIZE,
  SUPPLY_PLAN_ROW_TYPES,
  SUPPLY_PLAN_WEEKS,
  applySupplyPlanImport,
  buildSupplyPlanFilterOptions,
  calculateSupplyPlanRow,
  filterSupplyPlanRows,
  parseSupplyPlanWorksheet,
  supplyPlanRowKey
} from './supply-plan.js';

const API = import.meta.env.DEV ? 'http://localhost:4003' : '';
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
const FIXED_COLUMNS = [
  { key: 'productLine', label: '产品线', width: 92 },
  { key: 'businessUnit', label: '事业部', width: 116 },
  { key: 'productSeries', label: '系列', width: 92 },
  { key: 'model', label: '型号', width: 92 },
  { key: 'materialCode', label: '物料编码', width: 112 },
  { key: 'sku', label: 'SKU', width: 130 },
  { key: 'materialName', label: '名称', width: 210 },
  { key: 'safetyStockQty', label: '安全库存数量', width: 112 },
  { key: 'metric', label: '供应计划指标', width: 112 }
];
const FIXED_LEFTS = FIXED_COLUMNS.map((_, index) => (
  FIXED_COLUMNS.slice(0, index).reduce((sum, column) => sum + column.width, 0)
));
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

function stickyStyle(index) {
  const width = FIXED_COLUMNS[index].width;
  return {
    '--supply-plan-left': `${FIXED_LEFTS[index]}px`,
    width,
    minWidth: width,
    maxWidth: width
  };
}

function metricWeekValue(row, metric, weekIndex) {
  if (metric === '销售预测' || metric === '出货数量') return row.weeklyForecast[weekIndex] || 0;
  if (metric === '未交付量') return row.undeliveredQty;
  if (metric === '在途量') return row.inTransitQty;
  if (metric === '在库量') return row.onHandQty;
  return row.purchaseGap;
}

function RouteSettings({ params, saving, meta, onChange, onSave }) {
  return (
    <section className="supply-plan-route-wrap">
      <div className="supply-plan-section-heading">
        <div>
          <h3>路由时间设置</h3>
          <p>{meta.updatedAt
            ? `腾讯云最后保存：${meta.updatedBy || '未知用户'}，${timestampText(meta.updatedAt)}`
            : '暂无历史设置，当前使用系统默认值'}</p>
        </div>
        <button type="button" className="primary" disabled={saving} onClick={onSave}>{saving ? '保存中...' : '保存'}</button>
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
  const [forecasts, setForecasts] = useState({});
  const [safetyOverrides, setSafetyOverrides] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const forecastInputRef = useRef(null);
  const safetyInputRef = useRef(null);

  async function loadSummary({ manual = false } = {}) {
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest('/api/supply-plan/summary', token);
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setParams(payload.params);
      setMeta({
        updatedBy: payload.updatedBy || '',
        updatedAt: payload.updatedAt || '',
        generatedAt: payload.generatedAt || ''
      });
      if (manual) setMessage(`已读取服务器最新库存数据，共 ${payload.rows?.length || 0} 个事业部＋物料编码。`);
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

  async function importWorkbook(file, mode) {
    if (!file) return;
    setError('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('导入文件没有可读取的工作表');
      const aoa = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '', raw: true, blankrows: false });
      const parsed = parseSupplyPlanWorksheet(aoa, { mode });
      const applied = applySupplyPlanImport(rows, parsed, forecasts, safetyOverrides);
      setForecasts(applied.forecasts);
      setSafetyOverrides(applied.safetyOverrides);
      const label = mode === 'forecast' ? '销售预测' : '安全库存';
      setMessage(`${label}导入完成：更新 ${applied.stats.updatedSkuRows} 个SKU行，未匹配 ${applied.stats.unmatchedImportRows} 行${applied.stats.ignoredWeekColumns ? `，忽略超出W52的 ${applied.stats.ignoredWeekColumns} 个周列` : ''}。`);
    } catch (importError) {
      setError(`${mode === 'forecast' ? '销售预测' : '安全库存'}导入失败：${importError.message}`);
    }
  }

  const calculatedRows = useMemo(() => rows.map((row) => {
    const rowKey = supplyPlanRowKey(row);
    const safetyDays = params?.channels?.[row.channelKey]?.safetyDays ?? row.safetyDays;
    return calculateSupplyPlanRow(
      { ...row, safetyDays },
      forecasts[rowKey] || [],
      Object.hasOwn(safetyOverrides, rowKey) ? safetyOverrides[rowKey] : null
    );
  }), [rows, params, forecasts, safetyOverrides]);

  const filterOptions = useMemo(
    () => buildSupplyPlanFilterOptions(calculatedRows, filters),
    [calculatedRows, filters]
  );
  const filteredRows = useMemo(
    () => filterSupplyPlanRows(calculatedRows, filters),
    [calculatedRows, filters]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / SUPPLY_PLAN_PAGE_SIZE));
  const visibleRows = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * SUPPLY_PLAN_PAGE_SIZE;
    return filteredRows.slice(start, start + SUPPLY_PLAN_PAGE_SIZE);
  }, [filteredRows, currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
          <h2>供应计划工具</h2>
          <p>库存来源：当前服务器库存汇总；周预测与安全库存覆盖仅保留在本次页面会话。</p>
        </div>
        <span>{meta.generatedAt ? `生成时间：${timestampText(meta.generatedAt)}` : ''}</span>
      </div>

      {params ? <RouteSettings params={params} saving={saving} meta={meta} onChange={changeParam} onSave={saveParams} /> : null}

      <div className="toolbar supply-plan-toolbar">
        <button type="button" disabled={loading} onClick={() => loadSummary({ manual: true })}>{loading ? '重算中...' : '重算'}</button>
        <button type="button" onClick={() => forecastInputRef.current?.click()}>导入销售预测</button>
        <button type="button" onClick={() => safetyInputRef.current?.click()}>导入安全库存</button>
        <input ref={forecastInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => {
          importWorkbook(event.target.files?.[0], 'forecast');
          event.target.value = '';
        }} />
        <input ref={safetyInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => {
          importWorkbook(event.target.files?.[0], 'safety');
          event.target.value = '';
        }} />
        <span className="section-count">当前显示 {filteredRows.length} / {calculatedRows.length} 个事业部＋物料编码</span>
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
              {FIXED_COLUMNS.map((column, index) => (
                <th key={column.key} className="supply-plan-sticky" style={stickyStyle(index)}>{column.label}</th>
              ))}
              <th className="inventory-column">库存数据</th>
              {SUPPLY_PLAN_WEEKS.map((week) => (
                <th key={week.key} className="week-column"><strong>{week.label}</strong><small>{week.dateRange}</small></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.flatMap((row) => {
              const rowKey = supplyPlanRowKey(row);
              return SUPPLY_PLAN_ROW_TYPES.map((metric, metricIndex) => (
                <tr key={`${rowKey}-${metric}`} className={`${metricIndex === 0 ? 'sku-group ' : ''}metric-row-${metricIndex}`}>
                  {metricIndex === 0 ? FIXED_COLUMNS.slice(0, 8).map((column, index) => (
                    <td key={column.key} rowSpan={SUPPLY_PLAN_ROW_TYPES.length} className="supply-plan-sticky supply-plan-rowspan" style={stickyStyle(index)} title={String(row[column.key] ?? '')}>
                      {column.key === 'safetyStockQty' ? numberText(row.safetyStockQty) : String(row[column.key] ?? '未匹配')}
                    </td>
                  )) : null}
                  <td className="supply-plan-sticky metric-name" style={stickyStyle(8)}>{metric}</td>
                  <td className="numeric-cell inventory-column">{numberText(row.inventoryQty)}</td>
                  {SUPPLY_PLAN_WEEKS.map((week, weekIndex) => {
                    const value = metricWeekValue(row, metric, weekIndex);
                    return (
                      <td key={week.key} className={`numeric-cell${metric === '采购数量' && value > 0 ? ' gap-positive' : ''}`}>
                        {numberText(value)}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
            {!visibleRows.length ? <tr><td className="empty-cell" colSpan={FIXED_COLUMNS.length + 1 + SUPPLY_PLAN_WEEKS.length}>暂无可展示的供应计划数据</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="supply-plan-pagination">
        <span>每页 {SUPPLY_PLAN_PAGE_SIZE} 个SKU，第 {Math.min(currentPage, totalPages)} / {totalPages} 页</span>
        <div>
          <button type="button" className="ghost" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</button>
          <button type="button" className="ghost" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>下一页</button>
        </div>
      </div>
    </div>
  );
}
