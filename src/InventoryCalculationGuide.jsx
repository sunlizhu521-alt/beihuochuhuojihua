const INVENTORY_CALCULATION_SOURCES = [
  {
    name: 'FBA库存',
    file: 'FBA库存报表',
    fields: 'SKU、仓库名称、库存筛选、期末库存(含移仓)-数量',
    filters: '仅库存筛选=全部；期末库存(含移仓)-数量为0、空值或非法值不进入映射与汇总',
    mapping: 'SKU → Dim-领星SKU对应物料编码-产品管理的识别码（物料编码）；仓库名称 → Dim-领星FBA仓库&金蝶仓库并保留全部候选金蝶仓库 → 主体+候选金蝶仓库+物料编码 → 仓库与物料对照表 → 唯一事业部',
    quantity: '期末库存(含移仓)-数量',
    value: '期末库存(含移仓)-数量 × 商品分类维度的不含税结算价'
  },
  {
    name: 'FBM库存',
    file: 'FBM库存报表',
    fields: '识别码、仓库名称、实际总量',
    filters: '实际总量为0、空值或非法值不进入映射与汇总；排除默认仓库、US-FBA移除中转虚拟仓、虚拟仓库--仅用于测试',
    mapping: '识别码=物料编码；仓库名称 → 维度表库“仓库名称”取得主体；主体+仓库名称+物料编码 → 仓库与物料对照表 → 事业部',
    quantity: '实际总量',
    value: '实际总量 × 商品分类维度的不含税结算价'
  },
  {
    name: 'WFS库存',
    file: 'WFS库存报表',
    fields: 'SKU、仓库名称、总库存数量',
    filters: '总库存数量为0、空值或非法值不进入映射与汇总',
    mapping: 'SKU → Dim-领星SKU对应物料编码-产品管理的识别码（物料编码）；WFS仓库名称匹配仓库与物料对照表中WFS完整仓库的末级名称，再按物料编码取得唯一主体、完整仓库和事业部；领星仓库对照仅作兼容回退',
    quantity: '总库存数量',
    value: '总库存数量 × 商品分类维度的不含税结算价'
  },
  {
    name: '国内在库',
    file: '国内在库报表',
    fields: '使用组织/库存组织、仓库名称、物料编码、库存量(主单位)',
    filters: '库存量(主单位)为0、空值或非法值不进入映射与汇总；仓库名称必须在仓库名称维度中唯一匹配且站点=中国；事业部映射成功后全部保留',
    mapping: '使用组织=主体=库存组织；两个028-R/028-M瑞朗德销售部仓固定归销售部-工厂，其余记录按主体+仓库名称+物料编码 → 仓库与物料对照表 → 事业部；物料编码直接匹配商品分类',
    quantity: '库存量(主单位)',
    value: '库存量(主单位) × 商品分类维度的不含税结算价'
  },
  {
    name: '京东在库',
    file: '京东在库报表',
    fields: '旧格式：SKU/京东ID、全国现货库存；新格式：SKU、RDC、现货库存',
    filters: '新格式只保留RDC=全国，每个SKU必须且只能有一条全国行；旧格式直接读取全国现货库存；赠品、上柜、下柜、厂直和店铺状态均不额外筛选；库存为0、空值或非法值不进入映射与汇总',
    mapping: 'SKU/京东ID → Dim-京东ID与品号匹配 → 物料编码；事业部固定为国内事业部；库存主体固定为浙江迈德斯特医疗器械科技有限公司',
    quantity: '新格式取RDC=全国行的现货库存；旧格式取全国现货库存',
    value: '对应库存数量 × 商品分类维度的不含税结算价'
  },
  {
    name: 'FBA在途',
    file: 'FBA在途报表',
    fields: '店铺、SKU、货件状态、发货数量、已发货、签收量',
    filters: '拆分并向下填充全部合并单元格；即使文件已丢失合并标记，也继续向下填充店铺、站点、货件状态和发货数量；仅保留 RECEIVING、READY_TO_SHIP、CLOSED、IN_TRANSIT、WORKING、SHIPPED、DELIVERED；发货数量=0时排除',
    mapping: 'SKU → Dim-领星SKU对应物料编码-产品管理；店铺 → Dim-领星FBA在途&金蝶仓库 → 主体+金蝶仓库+物料编码 → 仓库与物料对照表 → 事业部',
    quantity: '逐行 MAX(已发货-签收量, 0)，再按事业部+物料编码汇总',
    value: '在途数量 × 商品分类维度的不含税结算价'
  },
  {
    name: 'FBM在途',
    file: 'FBM在途报表',
    fields: 'SKU、发货仓库（单据）、单据状态、备货数量、收货数量',
    filters: '读取“备货单详情”工作表；单据状态仅保留待收货、待配货；发货仓库仅保留 102-US-海外二部-海上在途、101-US-海外一部-海上在途、101-G-海外一部-海上在途、102-Q-海外二部-海上在途、102-G-海外二部-海上在途、104-US-全球招商部-海上在途、106-G-国内事业部-海上在途、101-G海外一部供应商仓跨境医疗器械；负数结果保留',
    mapping: 'SKU → Dim-领星SKU对应物料编码-产品管理；发货仓库（单据） → 维度表库“仓库名称”取得主体；主体+发货仓库（单据）+物料编码 → 仓库与物料对照表 → 事业部',
    quantity: '逐行备货数量-收货数量，再按事业部+物料编码汇总',
    value: '在途数量 × 商品分类维度的不含税结算价'
  },
  {
    name: '京东在途',
    file: '京东在途',
    fields: '物料编码、在途数量',
    filters: '文件必须且只能有一个工作表；全部数据纳入；零数和负数保留；空值、短横线或非法值按0并进入数据诊断',
    mapping: '物料编码直接匹配商品分类；事业部固定为国内事业部；库存主体固定为浙江迈德斯特医疗器械科技有限公司',
    quantity: '逐行读取在途数量，再按国内事业部+物料编码汇总',
    value: '在途数量 × 商品分类维度的不含税结算价；商品分类未匹配时货值按0'
  },
  {
    name: 'WFS在途',
    file: 'WFS在途报表',
    fields: 'SKU、仓库名称、在途数量',
    filters: '数量为0、空值或非法值不进入映射与汇总；其他有效数据全部纳入',
    mapping: 'SKU → Dim-领星SKU对应物料编码-产品管理；仓库名称 → Dim-领星FBA仓库&金蝶仓库 → 主体+金蝶仓库+物料编码 → 仓库与物料对照表 → 事业部',
    quantity: '逐行读取在途数量，再按事业部+物料编码汇总',
    value: '在途数量 × 商品分类维度的不含税结算价'
  },
  {
    name: '销售数据',
    file: '销售数据报表',
    fields: '日期、事业部、物料编码、销售数量、销售金额',
    filters: '全部数据纳入；日期统一转换为 YYYY-MM 并保留月份',
    mapping: '事业部直接取报表字段；物料编码直接匹配商品分类',
    quantity: '销售数量；按 YYYY-MM+事业部+物料编码汇总',
    value: '销售金额直接取报表字段，不使用结算价重算'
  },
  {
    name: '采购未交付',
    file: '采购跟单情况',
    fields: '下单月份、事业部、物料编码、备货剩余数量、完工未发产品、已下单未备料未生产、已备料未生产、生产中产品、是否需正常交货',
    filters: '是否需正常交货为“是”或“否”时计入；其他值显示为无未交付，采购数量按0处理；全部月份保留',
    mapping: '事业部和物料编码直接取报表字段；物料编码直接匹配商品分类',
    quantity: '未交付数量=备货剩余数量；生产阶段数量分别取对应原字段',
    value: '未交付及各生产阶段数量 × 商品分类维度的不含税结算价'
  }
];

const INVENTORY_CALCULATION_FORMULAS = [
  ['跨境在库', 'FBA库存 + FBM库存 + WFS库存'],
  ['国内在库', '国内在库报表 + 京东在库报表'],
  ['在库量', '跨境在库 + 国内在库'],
  ['在途量', 'FBA在途 + FBM在途 + WFS在途 + 京东在途'],
  ['采购未交付', '采购跟单情况中的备货剩余数量'],
  ['库存规模合计', '在库量 + 在途量 + 采购未交付']
];

export default function InventoryCalculationGuide({ onBack }) {
  return (
    <section className="inventory-methodology">
      <header className="inventory-methodology-header">
        <button type="button" className="ghost compact-button inventory-methodology-back" onClick={onBack}>← 返回销售与库存看板</button>
        <div>
          <span className="section-kicker">CALCULATION LOGIC</span>
          <h2>库存计算口径说明</h2>
          <p>说明当前系统实际使用的文件、字段、筛选条件、映射链路和汇总公式。</p>
        </div>
      </header>

      <aside className="inventory-methodology-pending" aria-label="不可售库存口径">
        <span>已确认</span>
        <div>
          <strong>不可售库存分类</strong>
          <p>原始仓库或映射后的金蝶仓库编码以333、555、777开头，仓库名称包含023、“（杭州）电子成品仓”、“配件仓”、“塑件车间仓库”或“综合线组装仓库”，以及“888-G-采购成品仓虚拟仓-跨境医疗器械”“888-US-采购成品仓虚拟仓-跨境医疗器械”时，不区分销售产品分类，全部归入不可售库存。</p>
          <p>其他仓库名称含“退货”时，商品分类维度SKU包含RE或K1的归入成品，其余归入不可售；上述强制不可售仓库规则优先。</p>
          <p>“001-M/国内事业部/瑞朗德仓/京东商家云仓”的库存固定归入成品在库量，不受商品分类维度中的成品/配件分类影响。</p>
          <p>FBM在途仍以“收货仓库”为777开头识别不可售在途。</p>
          <p><b>当前系统处理：</b>不可售库存与不可售在途从默认成品口径中剔除，可通过“成品/配件”筛选器单独查看数量和货值。</p>
        </div>
      </aside>

      <section className="inventory-methodology-section">
        <div className="inventory-methodology-section-head">
          <h3>分层计算公式</h3>
          <span>数量与货值使用同一分层结构</span>
        </div>
        <div className="inventory-formula-grid">
          {INVENTORY_CALCULATION_FORMULAS.map(([label, formula]) => (
            <article className="inventory-formula-card" key={label}>
              <strong>{label}</strong>
              <span>{formula}</span>
            </article>
          ))}
        </div>
        <p className="inventory-methodology-note">除销售金额外，货值统一按“对应数量 × 商品分类维度的不含税结算价”逐行计算后汇总；页面金额不超过一万元时显示元，超过一万元时显示万元，均不保留小数；Excel导出保留原始元和原始精度。</p>
      </section>

      <section className="inventory-methodology-section">
        <div className="inventory-methodology-section-head">
          <h3>数据来源与取数字段</h3>
          <span>横向滚动可查看完整映射链路</span>
        </div>
        <div className="inventory-methodology-table-wrap">
          <table className="inventory-methodology-table">
            <thead>
              <tr>
                <th>指标</th>
                <th>来源文件</th>
                <th>使用字段</th>
                <th>筛选与取数范围</th>
                <th>物料与事业部映射</th>
                <th>数量计算</th>
                <th>货值计算</th>
              </tr>
            </thead>
            <tbody>
              {INVENTORY_CALCULATION_SOURCES.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  <td>{row.file}</td>
                  <td>{row.fields}</td>
                  <td>{row.filters}</td>
                  <td>{row.mapping}</td>
                  <td>{row.quantity}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="inventory-methodology-section">
        <div className="inventory-methodology-section-head">
          <h3>公共映射与异常处理</h3>
          <span>所有事实数据最终按事业部+物料编码归集</span>
        </div>
        <div className="inventory-rule-grid">
          <article>
            <strong>商品分类映射</strong>
            <p>物料编码匹配“商品分类”，取得 SKU、物料名称、销售产品线、销售系列、销售区域和不含税结算价。供应计划分析仅按销售区域区分海外-美国、海外-欧洲和国内三个渠道。</p>
          </article>
          <article>
            <strong>仓库事业部映射</strong>
            <p>先取得主体和金蝶仓库，再使用“主体+仓库名称+物料编码”匹配“仓库与物料对照表”取得事业部。</p>
          </article>
          <article>
            <strong>缺失与冲突</strong>
            <p>维度缺失或同一键存在多个结果时标记映射冲突并进入诊断。国内在库先按仓库名称维度仅保留站点为“中国”的记录，再纳入所有事业部映射成功的记录；销售部-工厂特殊仓库继续按固定归属处理。</p>
          </article>
          <article>
            <strong>数量清洗</strong>
            <p>数量支持逗号分隔。库存数量为0时直接剔除且不生成维度提醒；京东在途例外，零数和负数保留，空值、短横线或非法值按0并进入数据诊断。</p>
          </article>
        </div>
      </section>

      <section className="inventory-methodology-section">
        <div className="inventory-methodology-section-head">
          <h3>ABC分类与看板口径</h3>
          <span>销量ABC与销售额ABC相互独立</span>
        </div>
        <div className="inventory-methodology-copy">
          <p><strong>销量ABC：</strong>各事业部内按销售数量合计降序计算累计贡献，累计占比≤80%为A，80%＜累计占比≤90%为B，累计占比＞90%为C；销售数量合计≤0归为C。</p>
          <p><strong>销售额ABC：</strong>各事业部内按销售金额合计降序独立计算，边界规则与销量ABC一致；销售金额合计≤0归为C。</p>
          <p><strong>相同值处理：</strong>相同销量或销售额采用同一累计边界并归入相同等级。看板筛选后的卡片、图表和表格均基于同一批汇总行计算。</p>
        </div>
      </section>
    </section>
  );
}
