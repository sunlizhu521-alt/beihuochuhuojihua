import { useEffect, useMemo, useRef, useState } from 'react';

const API = import.meta.env.DEV ? 'http://localhost:4003' : '';

const RISK_CHANNELS = [
  { key: 'overseasUs', label: '海外-美国' },
  { key: 'overseasEurope', label: '海外-欧洲' },
  { key: 'domestic', label: '国内' }
];
const DEFAULT_CHANNEL_PARAMS = {
  onHandSellableDays: 10,
  dispatchToShelfDays: 10,
  transportDays: 10,
  bookingDays: 10,
  averageLeadTimeDays: 10,
  contractSigningDays: 10,
  restrictThresholdDays: 40,
  stopThresholdDays: 50
};
const DEFAULT_PARAMS = {
  forecastMonths: 6,
  historicalMonths: 6,
  channels: Object.fromEntries(RISK_CHANNELS.map(({ key }) => [key, { ...DEFAULT_CHANNEL_PARAMS }]))
};

const PERIOD_FIELDS = [
  ['onHandSellableDays', '在库量可销天数'],
  ['dispatchToShelfDays', '发货到上架'],
  ['transportDays', '海运/运输'],
  ['bookingDays', '订舱/预约'],
  ['averageLeadTimeDays', '平均交期'],
  ['contractSigningDays', '合同签订']
];

const EMPTY_RISK_FILTERS = Object.freeze({
  businessUnits: [],
  warehouseLocations: [],
  sites: [],
  productLines: [],
  productSeries: [],
  models: [],
  supplierShortNames: [],
  channels: [],
  actions: [],
  forecastAvailability: []
});

const BUSINESS_UNIT_FILTER_ORDER = [
  '海外事业一部',
  '海外事业二部',
  '国内事业部',
  '全球招商事业部',
  '销售部-工厂'
];

function compareBusinessUnitFilterOptions(left, right) {
  const leftIndex = BUSINESS_UNIT_FILTER_ORDER.indexOf(left);
  const rightIndex = BUSINESS_UNIT_FILTER_ORDER.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right, 'zh-CN');
}

function numberText(value, maximumFractionDigits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN', { maximumFractionDigits });
}

function splitSupplierShortNames(value) {
  const names = String(value || '').split(/[&+、,，;；]/).map((item) => item.trim()).filter(Boolean);
  return names.length ? [...new Set(names)] : ['未匹配'];
}

function riskRowValues(row, arrayKey, valueKey) {
  const values = Array.isArray(row?.[arrayKey])
    ? row[arrayKey]
    : [row?.[valueKey]];
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : ['未匹配'];
}

function derivedChannelDays(settings) {
  const value = (field) => {
    const number = Number(settings?.[field]);
    return Number.isFinite(number) ? number : 0;
  };
  const spotDays = value('onHandSellableDays') + value('dispatchToShelfDays') + value('transportDays') + value('bookingDays');
  return {
    spotDays,
    fullChainDays: spotDays + value('averageLeadTimeDays') + value('contractSigningDays')
  };
}

function RiskParameterMatrix({ params, onChannelChange, onRootChange }) {
  return (
    <section className="inventory-risk-parameters">
      <fieldset className="inventory-risk-range-settings">
        <legend>计算范围</legend>
        <div className="inventory-risk-input-grid">
          <label><span>预测月数</span><input type="number" min="1" max="24" step="1" value={params.forecastMonths} onChange={(event) => onRootChange('forecastMonths', event.target.value)} /></label>
          <label><span>历史月数</span><input type="number" min="1" max="24" step="1" value={params.historicalMonths} onChange={(event) => onRootChange('historicalMonths', event.target.value)} /></label>
        </div>
      </fieldset>

      <fieldset className="inventory-risk-matrix-fieldset">
        <legend>计算周期</legend>
        <div className="inventory-risk-matrix-wrap">
          <div className="inventory-risk-parameter-matrix inventory-risk-period-matrix">
            <div className="matrix-heading">渠道</div>
            {PERIOD_FIELDS.slice(0, 4).map(([, label]) => <div className="matrix-heading" key={label}>{label}</div>)}
            <div className="matrix-heading calculated">现货天数</div>
            <div className="matrix-heading">平均交期</div>
            <div className="matrix-heading">合同签订</div>
            <div className="matrix-heading calculated">全链路天数</div>
            {RISK_CHANNELS.flatMap(({ key, label }) => {
              const settings = params.channels[key];
              const derived = derivedChannelDays(settings);
              return [
                <strong className="matrix-channel" key={`${key}-label`}>{label}</strong>,
                ...PERIOD_FIELDS.slice(0, 4).map(([field]) => <input key={`${key}-${field}`} aria-label={`${label}${field}`} type="number" min="0" step="1" value={settings[field]} onChange={(event) => onChannelChange(key, field, event.target.value)} />),
                <output className="matrix-output" key={`${key}-spot`}>{numberText(derived.spotDays)}</output>,
                <input key={`${key}-averageLeadTimeDays`} aria-label={`${label}averageLeadTimeDays`} type="number" min="0" step="1" value={settings.averageLeadTimeDays} onChange={(event) => onChannelChange(key, 'averageLeadTimeDays', event.target.value)} />,
                <input key={`${key}-contractSigningDays`} aria-label={`${label}contractSigningDays`} type="number" min="0" step="1" value={settings.contractSigningDays} onChange={(event) => onChannelChange(key, 'contractSigningDays', event.target.value)} />,
                <output className="matrix-output" key={`${key}-full`}>{numberText(derived.fullChainDays)}</output>
              ];
            })}
          </div>
        </div>
        <p className="inventory-risk-parameter-note">现货天数 = 在库量可销天数 + 发货到上架 + 海运/运输 + 订舱/预约；全链路天数 = 现货天数 + 平均交期 + 合同签订。</p>
      </fieldset>

      <fieldset className="inventory-risk-matrix-fieldset">
        <legend>处置规则</legend>
        <div className="inventory-risk-matrix-wrap">
          <div className="inventory-risk-parameter-matrix inventory-risk-rule-matrix">
            <div className="matrix-heading">渠道</div>
            <div className="matrix-heading">限制采购阈值</div>
            <div className="matrix-heading">停止采购阈值</div>
            {RISK_CHANNELS.flatMap(({ key, label }) => [
              <strong className="matrix-channel" key={`${key}-rule-label`}>{label}</strong>,
              <input key={`${key}-restrict`} aria-label={`${label}限制采购阈值`} type="number" min="0" step="1" value={params.channels[key].restrictThresholdDays} onChange={(event) => onChannelChange(key, 'restrictThresholdDays', event.target.value)} />,
              <input key={`${key}-stop`} aria-label={`${label}停止采购阈值`} type="number" min="0" step="1" value={params.channels[key].stopThresholdDays} onChange={(event) => onChannelChange(key, 'stopThresholdDays', event.target.value)} />
            ])}
          </div>
        </div>
        <p className="inventory-risk-parameter-note">在库+在途周转天数超过限制阈值时限制采购；全链覆盖天数超过停止阈值时停止采购，停止采购优先。</p>
      </fieldset>
    </section>
  );
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
  if (!response.ok) {
    const error = new Error(payload?.error || payload || `请求失败（${response.status}）`);
    if (payload && typeof payload === 'object') error.payload = payload;
    throw error;
  }
  return payload;
}

function RiskMultiSelectFilter({ label, allLabel, value = [], options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const availableOptions = useMemo(
    () => [...new Set([...options, ...value].map((option) => String(option || '').trim()).filter(Boolean))],
    [options, value]
  );
  const selected = value.filter((item) => availableOptions.includes(item));

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const buttonLabel = selected.length === 0
    ? allLabel
    : selected.length <= 2
      ? selected.join('、')
      : `已选${selected.length}项`;
  const toggle = (option) => onChange(selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option]);

  return (
    <div className="multi-filter" ref={rootRef}>
      <span className="multi-filter-label">{label}</span>
      <button type="button" className="multi-filter-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{buttonLabel}</span><b aria-hidden="true">⌄</b>
      </button>
      {open && (
        <div className="multi-filter-menu">
          <label className="multi-filter-option">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>{allLabel}</span>
          </label>
          {availableOptions.map((option) => (
            <label key={option} className="multi-filter-option">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ForecastParsingDiagnostics({ diagnostics }) {
  const parsing = diagnostics?.forecastParsing;
  if (!parsing) return null;
  const reasons = parsing.reasonCounts || {};
  const fields = parsing.recognizedFields || {};
  return (
    <details className="inventory-risk-diagnostics inventory-risk-failure-diagnostics" open>
      <summary>销售预测解析诊断</summary>
      <div className="inventory-risk-diagnostic-grid">
        <section>
          <h3>数据源与表头</h3>
          <p>文件：{parsing.sourceFileName || '未识别'}</p>
          <p>槽位更新时间：{parsing.sourceUpdatedAt || '未识别'}</p>
          <p>年份锚点：{parsing.anchorMonth || '未识别'}（{parsing.anchorSource || '未知来源'}）</p>
          <p>识别字段：{Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join('；') || '无'}</p>
          <p>全部表头：{(parsing.headers || []).join('、') || '无'}</p>
        </section>
        <section>
          <h3>月份识别与失败统计</h3>
          <p>月份列：{(parsing.monthColumns || []).map((column) => `${column.header} → ${column.month}`).join('；') || '未识别到月份销量列'}</p>
          <p>总行数 {reasons.totalRows || 0}；成功解析 {reasons.parsedRows || 0}；有效汇总键 {parsing.parsedKeyCount || 0}</p>
          <p>物料缺失 {reasons.missingMaterialCode || 0}；事业部缺失 {reasons.missingBusinessUnit || 0}；月份格式无效 {reasons.invalidLongMonth || 0}；无有效月份列 {reasons.noValidMonthColumns || 0}</p>
          {(diagnostics.forecastIssues || []).slice(0, 20).map((row) => <p key={row.id}>第 {row.row} 行 · {row.materialCode} · {row.issue}</p>)}
        </section>
      </div>
    </details>
  );
}

function RiskPagination({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <div className="inventory-risk-pagination">
      <span>第 {page}/{pages} 页</span>
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</button>
    </div>
  );
}

function RiskDataSourceCell({ value }) {
  const items = String(value || '无仓库数据').split('；').filter(Boolean);
  return <div className="inventory-risk-source-cell">{items.map((item) => <span key={item}>{item}</span>)}</div>;
}

function RiskTable({ rows, showDataSources, onToggleDataSources }) {
  const pageSize = 20;
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [page, rows]);

  useEffect(() => setPage(1), [rows]);

  return (
    <section className="inventory-risk-result inventory-risk-result-combined">
      <div className="inventory-risk-section-heading">
        <div>
          <span className="inventory-risk-section-kicker">处置清单</span>
          <h3>供应计划分析处置清单</h3>
        </div>
        <div className="inventory-risk-section-actions">
          <button className="inventory-risk-button secondary" type="button" onClick={onToggleDataSources}>{showDataSources ? '隐藏数据来源' : '显示数据来源'}</button>
          <strong>{numberText(rows.length, 0)} 个物料</strong>
        </div>
      </div>
      <div className="inventory-risk-table-wrap">
        <table className={`inventory-risk-table${showDataSources ? ' show-data-source' : ''}`}>
          <thead>
            <tr>
              {showDataSources && <th>数据来源</th>}
              <th>渠道</th><th>销售区域</th><th>事业部</th><th>产品线</th><th>物料编码</th><th>SKU</th><th>物料名称</th><th>未交付供应商简称</th>
              <th>在库数量</th><th>在途数量</th><th>待交付数量</th><th>合计数量</th><th>预测月均销量</th><th>最近N月平均月销量</th>
              <th>在库在途周转天数</th><th>全链覆盖天数</th><th>预测状态</th><th>处置动作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                {showDataSources && <td><RiskDataSourceCell value={row.dataSource} /></td>}
                <td><span className={`inventory-risk-segment inventory-risk-segment-${row.channel === '国内' ? 'domestic' : 'overseas'}`}>{row.channel}</span></td>
                <td>{row.salesRegion}</td><td>{row.businessUnit}</td><td>{row.productLine}</td><td>{row.materialCode}</td><td>{row.sku}</td><td>{row.materialName}</td>
                <td>{row.unfulfilledSupplierShortName || '未匹配'}</td><td>{numberText(row.onHandQty)}</td><td>{numberText(row.inTransitQty)}</td>
                <td>{numberText(row.undeliveredQty)}</td><td>{numberText(row.totalInventoryQty)}</td><td>{numberText(row.forecastMonthlyAverage)}</td>
                <td>{numberText(row.historicalMonthlyAverage)}</td><td>{numberText(row.transitTurnoverDays)}</td>
                <td>{numberText(row.fullChainCoverageDays)}</td><td>{row.forecastStatus}</td>
                <td><strong className={`inventory-risk-action inventory-risk-action-${row.action === '停止采购' ? 'stopped' : row.action === '限制采购' ? 'restricted' : 'normal'}`}>{row.action}</strong></td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td className="inventory-risk-empty" colSpan={showDataSources ? 19 : 18}>当前筛选条件下没有库存、在途或未交付数量大于 0 的物料</td></tr>}
          </tbody>
        </table>
      </div>
      <RiskPagination page={page} pages={pages} onChange={setPage} />
    </section>
  );
}

function InventoryRiskLogic({ onBack }) {
  return (
    <div className="inventory-risk-page inventory-risk-logic-page">
      <header className="inventory-risk-header">
        <div><span className="inventory-risk-eyebrow">SUPPLY PLANNING</span><h2>供应计划分析计算逻辑</h2><p>用于核对数据来源、计算公式和处置边界。</p></div>
        <button className="inventory-risk-button secondary" type="button" onClick={onBack}>返回供应计划分析</button>
      </header>
      <div className="inventory-risk-logic-grid">
        <section><span>01</span><h3>数据来源</h3><p>库存、在途、待交付、商品分类和历史销售完全复用“库存汇总”的标准化结果；销售预测读取“底表文件”的槽位 15。</p></section>
        <section><span>02</span><h3>物料与渠道</h3><p>以事业部 + 物料编码为主键，SKU 仅展示。渠道只取商品分类的销售区域：中国为国内，美国为海外-美国，欧洲为海外-欧洲；其他已确认区域按2B排除，缺失或无法区分进入维度表缺失。</p></section>
        <section><span>03</span><h3>销售速度</h3><p>预测月均销量取本月起连续 N 个月预测数量合计除以 N；最近 N 月平均月销量独立取销售数据最新月份向前 N 个月。</p></section>
        <section><span>04</span><h3>在库在途周转</h3><p>在库在途周转天数 =（在库数量 + 在途数量）÷（预测月均销量 ÷ 30）。超过当前渠道的限制采购阈值时限制采购。</p></section>
        <section><span>05</span><h3>全链覆盖</h3><p>全链覆盖天数 =（在库数量 + 在途数量 + 待交付数量）÷（预测月均销量 ÷ 30）+ 当前渠道平均交期。超过停止采购阈值时停止采购。</p></section>
        <section><span>06</span><h3>异常和优先级</h3><p>无预测或预测合计为 0 时天数按 999，进入停止采购。停止采购优先于限制采购；处置清单展示合计数量大于 0 的全部物料，包括正常物料。</p></section>
      </div>
    </div>
  );
}

export default function InventoryRiskPage({ token, active }) {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [paramsReady, setParamsReady] = useState(false);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [paramsLoadAttempted, setParamsLoadAttempted] = useState(false);
  const [paramsMeta, setParamsMeta] = useState({ updatedBy: '', updatedAt: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorDiagnostics, setErrorDiagnostics] = useState(null);
  const [showLogic, setShowLogic] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState({ ...EMPTY_RISK_FILTERS });
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [showDataSources, setShowDataSources] = useState(false);

  const setRootParam = (field, value) => setParams((current) => ({ ...current, [field]: value }));
  const setChannelParam = (channelKey, field, value) => setParams((current) => ({
    ...current,
    channels: {
      ...current.channels,
      [channelKey]: { ...current.channels[channelKey], [field]: value }
    }
  }));

  async function loadServerParams() {
    setParamsLoading(true);
    setParamsLoadAttempted(true);
    setError('');
    try {
      const payload = await apiRequest('/api/inventory-risk/params', token);
      setParams(payload.params || DEFAULT_PARAMS);
      setParamsMeta({ updatedBy: payload.updatedBy || '', updatedAt: payload.updatedAt || '' });
      setParamsReady(true);
    } catch (requestError) {
      setError(`读取腾讯云最后参数失败：${requestError.message}`);
    } finally {
      setParamsLoading(false);
    }
  }

  async function calculate(force = false) {
    setLoading(true);
    setError('');
    setErrorDiagnostics(null);
    try {
      const payload = await apiRequest('/api/inventory-risk/query', token, {
        method: 'POST',
        body: JSON.stringify({ ...params, force, saveParams: force })
      });
      setResult(payload);
      setParams(payload.params || params);
      if (payload.parameterSettings) {
        setParamsMeta({
          updatedBy: payload.parameterSettings.updatedBy || '',
          updatedAt: payload.parameterSettings.updatedAt || ''
        });
      }
      setFilters({ ...EMPTY_RISK_FILTERS });
      setLoaded(true);
    } catch (requestError) {
      setError(requestError.message);
      setErrorDiagnostics(requestError.payload?.diagnostics || null);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active && !paramsReady && !paramsLoading && !paramsLoadAttempted) loadServerParams();
  }, [active, paramsReady, paramsLoading, paramsLoadAttempted]);

  useEffect(() => {
    if (active && paramsReady && !loaded && !loading) calculate();
  }, [active, paramsReady, loaded, loading]);

  useEffect(() => {
    if (active) return;
    setParamsReady(false);
    setParamsLoadAttempted(false);
    setLoaded(false);
  }, [active]);

  async function exportResult() {
    if (exporting) return;
    setExporting(true);
    setExportStatus({ type: 'working', message: '正在请求服务器生成 Excel，请稍候...', progress: null });
    try {
      const response = await fetch(`${API}/api/inventory-risk/export`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, includeDataSource: showDataSources })
      });
      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
          ? await response.json().catch(() => ({}))
          : await response.text().catch(() => '');
        throw new Error(payload?.error || payload || `导出失败（${response.status}）`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      let blob;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;
        setExportStatus({ type: 'working', message: '正在下载 Excel 数据...', progress: contentLength > 0 ? 0 : null });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          receivedBytes += value.byteLength;
          const progress = contentLength > 0
            ? Math.min(100, Math.round((receivedBytes / contentLength) * 100))
            : null;
          setExportStatus({ type: 'working', message: '正在下载 Excel 数据...', progress });
        }
        blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else {
        setExportStatus({ type: 'working', message: '正在下载 Excel 数据...', progress: null });
        blob = await response.blob();
      }
      setExportStatus({ type: 'working', message: '数据获取完成，正在启动下载...', progress: 100 });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `供应计划分析_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus({ type: 'success', message: '导出完成，Excel 文件已开始下载。', progress: 100 });
    } catch (requestError) {
      setExportStatus({ type: 'error', message: requestError.message || '导出失败，请稍后重试。', progress: null });
    } finally {
      setExporting(false);
    }
  }

  const actionRows = useMemo(
    () => (result?.rows || [...(result?.stopped || []), ...(result?.restricted || []), ...(result?.normal || [])])
      .filter((row) => Number(row.totalInventoryQty ?? (Number(row.onHandQty || 0) + Number(row.inTransitQty || 0) + Number(row.undeliveredQty || 0))) > 0),
    [result]
  );
  const matchesFilters = (row, omit = '') => (
    (omit === 'businessUnits' || filters.businessUnits.length === 0 || filters.businessUnits.includes(row.businessUnit))
    && (omit === 'warehouseLocations' || filters.warehouseLocations.length === 0 || riskRowValues(row, 'warehouseLocations', 'warehouseLocation').some((value) => filters.warehouseLocations.includes(value)))
    && (omit === 'sites' || filters.sites.length === 0 || riskRowValues(row, 'sites', 'site').some((value) => filters.sites.includes(value)))
    && (omit === 'productLines' || filters.productLines.length === 0 || filters.productLines.includes(row.productLine))
    && (omit === 'productSeries' || filters.productSeries.length === 0 || filters.productSeries.includes(row.productSeries))
    && (omit === 'models' || filters.models.length === 0 || filters.models.includes(row.model))
    && (omit === 'supplierShortNames' || filters.supplierShortNames.length === 0 || splitSupplierShortNames(row.unfulfilledSupplierShortName).some((name) => filters.supplierShortNames.includes(name)))
    && (omit === 'channels' || filters.channels.length === 0 || filters.channels.includes(row.channel))
    && (omit === 'actions' || filters.actions.length === 0 || filters.actions.includes(row.action))
    && (omit === 'forecastAvailability' || filters.forecastAvailability.length === 0 || filters.forecastAvailability.includes(row.forecastAvailability))
  );
  const filterOptions = useMemo(() => {
    const valuesFor = (key, valueKey) => [...new Set(actionRows
      .filter((row) => matchesFilters(row, key))
      .map((row) => row[valueKey])
      .filter(Boolean))];
    const multiValuesFor = (key, arrayKey, valueKey) => [...new Set(actionRows
      .filter((row) => matchesFilters(row, key))
      .flatMap((row) => riskRowValues(row, arrayKey, valueKey)))];
    const sortWarehouseOption = (left, right) => (
      (left === '未匹配') - (right === '未匹配') || left.localeCompare(right, 'zh-CN', { numeric: true })
    );
    const supplierTotals = new Map();
    actionRows.filter((row) => matchesFilters(row, 'supplierShortNames')).forEach((row) => {
      splitSupplierShortNames(row.unfulfilledSupplierShortName).forEach((name) => {
        supplierTotals.set(name, (supplierTotals.get(name) || 0) + Number(row.undeliveredQty || 0));
      });
    });
    return {
      businessUnits: valuesFor('businessUnits', 'businessUnit').sort(compareBusinessUnitFilterOptions),
      warehouseLocations: multiValuesFor('warehouseLocations', 'warehouseLocations', 'warehouseLocation').sort(sortWarehouseOption),
      sites: multiValuesFor('sites', 'sites', 'site').sort(sortWarehouseOption),
      productLines: valuesFor('productLines', 'productLine').sort((a, b) => a.localeCompare(b, 'zh-CN')),
      productSeries: valuesFor('productSeries', 'productSeries').sort((a, b) => a.localeCompare(b, 'zh-CN')),
      models: valuesFor('models', 'model').sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })),
      supplierShortNames: [...supplierTotals.keys()].sort((left, right) => (
        supplierTotals.get(right) - supplierTotals.get(left) || left.localeCompare(right, 'zh-CN')
      )),
      channels: RISK_CHANNELS.map((channel) => channel.label).filter((channel) => valuesFor('channels', 'channel').includes(channel)),
      actions: ['正常', '限制采购', '停止采购'].filter((action) => valuesFor('actions', 'action').includes(action)),
      forecastAvailability: ['有预测销售', '无预测销售']
        .filter((status) => valuesFor('forecastAvailability', 'forecastAvailability').includes(status))
    };
  }, [actionRows, filters]);
  const filteredRows = useMemo(() => actionRows
    .filter((row) => matchesFilters(row))
    .sort((left, right) => compareBusinessUnitFilterOptions(left.businessUnit, right.businessUnit)), [actionRows, filters]);
  const filteredSummary = useMemo(() => {
    const onHandQty = filteredRows.reduce((sum, row) => sum + Number(row.onHandQty || 0), 0);
    const inTransitQty = filteredRows.reduce((sum, row) => sum + Number(row.inTransitQty || 0), 0);
    const undeliveredQty = filteredRows.reduce((sum, row) => sum + Number(row.undeliveredQty || 0), 0);
    return {
      restrictedCount: filteredRows.filter((row) => row.action === '限制采购').length,
      stoppedCount: filteredRows.filter((row) => row.action === '停止采购').length,
      normalCount: filteredRows.filter((row) => row.action === '正常').length,
      forecastedCount: filteredRows.filter((row) => row.forecastAvailability === '有预测销售').length,
      unforecastedCount: filteredRows.filter((row) => row.forecastAvailability === '无预测销售').length,
      onHandQty,
      inTransitQty,
      undeliveredQty,
      totalInventoryQty: onHandQty + inTransitQty + undeliveredQty
    };
  }, [filteredRows]);
  const hasFilters = Object.values(filters).some((values) => values.length > 0);

  if (showLogic) return <InventoryRiskLogic onBack={() => setShowLogic(false)} />;

  const summary = result?.summary || {};
  return (
    <div className="inventory-risk-page">
      <header className="inventory-risk-header">
        <div><span className="inventory-risk-eyebrow">SUPPLY PLANNING</span><h2>供应计划分析</h2><p>按海外-美国、海外-欧洲和国内三个渠道识别限制采购与停止采购物料。</p></div>
        <div className="inventory-risk-actions">
          <button className="inventory-risk-button secondary" type="button" onClick={() => setShowLogic(true)}>计算逻辑</button>
          <button className="inventory-risk-button secondary" type="button" disabled={!result || loading || exporting} onClick={exportResult}>{exporting ? '导出中...' : '导出 Excel'}</button>
          <button className="inventory-risk-button primary" type="button" disabled={loading || exporting} onClick={() => calculate(true)}>{loading ? '计算中...' : '重新计算'}</button>
        </div>
      </header>

      {exportStatus && (
        <div className={`inventory-risk-export-status ${exportStatus.type}`} role={exportStatus.type === 'error' ? 'alert' : 'status'} aria-live="polite">
          <div className="inventory-risk-export-status-line">
            <strong>{exportStatus.type === 'error' ? '导出失败' : exportStatus.type === 'success' ? '导出完成' : '正在导出'}</strong>
            <span>{exportStatus.message}</span>
            {Number.isFinite(exportStatus.progress) && <b>{exportStatus.progress}%</b>}
          </div>
          {exportStatus.type === 'working' && (
            <div
              className={`inventory-risk-export-progress${Number.isFinite(exportStatus.progress) ? '' : ' indeterminate'}`}
              role="progressbar"
              aria-label="Excel 导出进度"
              aria-valuemin="0"
              aria-valuemax="100"
              {...(Number.isFinite(exportStatus.progress) ? { 'aria-valuenow': exportStatus.progress } : {})}
            >
              <span style={Number.isFinite(exportStatus.progress) ? { width: `${exportStatus.progress}%` } : undefined} />
            </div>
          )}
        </div>
      )}

      {paramsReady && (
        <>
          <div className="inventory-risk-parameter-source">
            参数保存在腾讯云：{paramsMeta.updatedAt
              ? `最后由 ${paramsMeta.updatedBy || '未知用户'} 于 ${paramsMeta.updatedAt} 保存`
              : '暂无历史设置，当前使用系统默认值；点击“重新计算”后保存'}
          </div>
          <RiskParameterMatrix params={params} onChannelChange={setChannelParam} onRootChange={setRootParam} />
        </>
      )}

      {error && <div className="inventory-risk-alert error"><strong>计算失败</strong><span>{error}</span></div>}
      {error && <ForecastParsingDiagnostics diagnostics={errorDiagnostics} />}
      {(paramsLoading || (loading && !result)) && <div className="inventory-risk-loading">{paramsLoading ? '正在读取腾讯云最后参数...' : '正在读取库存、在途、采购未交付、销售和预测数据...'}</div>}

      {result && (
        <>
          <section className="inventory-risk-filters" aria-label="供应计划分析筛选器">
            <RiskMultiSelectFilter label="事业部" allLabel="全部事业部" value={filters.businessUnits} options={filterOptions.businessUnits} onChange={(value) => setFilters((current) => ({ ...current, businessUnits: value }))} />
            <RiskMultiSelectFilter label="仓位位置" allLabel="全部仓位位置" value={filters.warehouseLocations} options={filterOptions.warehouseLocations} onChange={(value) => setFilters((current) => ({ ...current, warehouseLocations: value }))} />
            <RiskMultiSelectFilter label="站点" allLabel="全部站点" value={filters.sites} options={filterOptions.sites} onChange={(value) => setFilters((current) => ({ ...current, sites: value }))} />
            <RiskMultiSelectFilter label="产品线" allLabel="全部产品线" value={filters.productLines} options={filterOptions.productLines} onChange={(value) => setFilters((current) => ({ ...current, productLines: value }))} />
            <RiskMultiSelectFilter label="系列" allLabel="全部系列" value={filters.productSeries} options={filterOptions.productSeries} onChange={(value) => setFilters((current) => ({ ...current, productSeries: value }))} />
            <RiskMultiSelectFilter label="型号" allLabel="全部型号" value={filters.models} options={filterOptions.models} onChange={(value) => setFilters((current) => ({ ...current, models: value }))} />
            <RiskMultiSelectFilter label="供应商简称" allLabel="全部供应商简称" value={filters.supplierShortNames} options={filterOptions.supplierShortNames} onChange={(value) => setFilters((current) => ({ ...current, supplierShortNames: value }))} />
            <RiskMultiSelectFilter label="渠道" allLabel="全部渠道" value={filters.channels} options={filterOptions.channels} onChange={(value) => setFilters((current) => ({ ...current, channels: value }))} />
            <RiskMultiSelectFilter label="处置动作" allLabel="全部处置动作" value={filters.actions} options={filterOptions.actions} onChange={(value) => setFilters((current) => ({ ...current, actions: value }))} />
            <RiskMultiSelectFilter label="预测销售" allLabel="全部预测销售" value={filters.forecastAvailability} options={filterOptions.forecastAvailability} onChange={(value) => setFilters((current) => ({ ...current, forecastAvailability: value }))} />
            <button className="inventory-risk-button secondary inventory-risk-filter-clear" type="button" disabled={!hasFilters} onClick={() => setFilters({ ...EMPTY_RISK_FILTERS })}>清空筛选</button>
            <span className="inventory-risk-filter-count">筛选结果 {numberText(filteredRows.length, 0)} 条</span>
          </section>
          <section className="inventory-risk-summary">
            <article className="inventory-total">
              <span>库存总量</span>
              <strong>{numberText(filteredSummary.totalInventoryQty)}</strong>
              <div className="inventory-risk-total-breakdown">
                <span>在库<b>{numberText(filteredSummary.onHandQty)}</b></span>
                <span>在途<b>{numberText(filteredSummary.inTransitQty)}</b></span>
                <span>未交付<b>{numberText(filteredSummary.undeliveredQty)}</b></span>
              </div>
            </article>
            <article className="forecasted"><span>有销售预测的物料编码数量</span><strong>{numberText(filteredSummary.forecastedCount, 0)}</strong><small>按事业部 + 物料编码独立计数</small></article>
            <article className="unforecasted"><span>无销售预测的物料编码数量</span><strong>{numberText(filteredSummary.unforecastedCount, 0)}</strong><small>按事业部 + 物料编码独立计数</small></article>
            <article className="restricted"><span>限制采购</span><strong>{numberText(filteredSummary.restrictedCount, 0)}</strong><small>事业部 + 物料编码数量</small></article>
            <article className="stopped"><span>停止采购</span><strong>{numberText(filteredSummary.stoppedCount, 0)}</strong><small>事业部 + 物料编码数量</small></article>
            <article><span>正常</span><strong>{numberText(filteredSummary.normalCount, 0)}</strong><small>事业部 + 物料编码数量</small></article>
          </section>
          <div className="inventory-risk-periods">
            <span>预测区间：{result.periods.forecastStartMonth} 至 {result.periods.forecastEndMonth}</span>
            <span>历史销量区间：{result.periods.historicalStartMonth || '暂无'} 至 {result.periods.historicalEndMonth || '暂无'}</span>
            <span>生成时间：{new Date(result.generatedAt).toLocaleString('zh-CN')}</span>
            <span>2B渠道排除：{numberText(summary.b2bExcludedCount, 0)} 条</span>
            <span>销售区域待维护：{numberText(summary.channelMissingCount, 0)} 条</span>
          </div>
          <RiskTable rows={filteredRows} showDataSources={showDataSources} onToggleDataSources={() => setShowDataSources((current) => !current)} />
          {(result.diagnostics.mappingIssues.length > 0 || result.diagnostics.forecastIssues.length > 0) && (
            <details className="inventory-risk-diagnostics">
              <summary>数据诊断：映射问题 {result.diagnostics.mappingIssues.length} 条，预测问题 {result.diagnostics.forecastIssues.length} 条</summary>
              <div className="inventory-risk-diagnostic-grid">
                <section><h3>库存与采购映射问题</h3>{result.diagnostics.mappingIssues.slice(0, 50).map((row) => <p key={row.id}>{row.sourceType} · {row.materialCode} · {row.issue} · 数量 {numberText(row.qty)}</p>)}{!result.diagnostics.mappingIssues.length && <p>无映射问题</p>}</section>
                <section><h3>销售预测解析问题</h3>{result.diagnostics.forecastIssues.slice(0, 50).map((row) => <p key={row.id}>第 {row.row} 行 · {row.materialCode} · {row.issue}</p>)}{!result.diagnostics.forecastIssues.length && <p>无预测解析问题</p>}</section>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
