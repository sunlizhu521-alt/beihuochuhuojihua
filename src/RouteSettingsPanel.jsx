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

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0';
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

export default function RouteSettingsPanel({
  params,
  saving,
  meta = {},
  horizonMonths,
  horizonOptions = [],
  onHorizonChange,
  onChange,
  onSave,
  children
}) {
  if (!params?.channels) return null;
  return (
    <section className="supply-plan-route-wrap stocking-plan-route-wrap">
      <div className="supply-plan-section-heading">
        <div>
          <h3>路由时间设置</h3>
          <p>{meta.updatedAt
            ? `腾讯云最后保存：${meta.updatedBy || '未知用户'}，${timestampText(meta.updatedAt)}`
            : '暂无历史设置，当前使用系统默认值'}</p>
        </div>
        <div className="supply-plan-route-actions">
          {horizonOptions.length ? (
            <label>
              <span>月选视野</span>
              <select aria-label="月选视野" value={horizonMonths} onChange={(event) => onHorizonChange(Number(event.target.value))}>
                {horizonOptions.map((months) => <option key={months} value={months}>{months} 个月</option>)}
              </select>
            </label>
          ) : null}
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
      {children}
    </section>
  );
}
