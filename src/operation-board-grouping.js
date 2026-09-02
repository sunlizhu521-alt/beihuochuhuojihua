import { purchaseTrackingBusinessUnit } from './business-unit.js';

const MATERIAL_GROUP_NUMERIC_FIELDS = [
  'remainingInboundQty',
  'shippedQty',
  'unpreparedQty',
  'preparedNotStartedQty',
  'inProductionQty',
  'finishedQty'
];

const MATERIAL_GROUP_TEXT_FIELDS = [
  'month',
  'orderNo',
  'sourceFile',
  'effectiveOrderCondition',
  'businessClose',
  'closeStatus',
  'documentStatus',
  'businessUnit',
  'operatorName',
  'supplier',
  'orderCreator',
  'supplierShortName',
  'orderSupplierShortName',
  'purchaseOwner',
  'purchaseOrg',
  'productLine',
  'productSeries',
  'sku',
  'materialName',
  'oaFlowNo',
  'dataSource',
  'dataStatus'
];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function addTextValue(group, field, value) {
  const normalized = normalizeText(value);
  if (normalized) group.textValues[field].add(normalized);
}

/**
 * 运营看板方案二：筛选完成后，按标准化的完整物料编码＋事业部精确汇总。
 * 同一物料跨事业部时分行展示，不合并事业部。
 * 空物料编码记录保留为独立行，避免把无编码数据错误合并。
 */
export function groupOperationBoardRowsByMaterial(rows) {
  const groups = new Map();
  const blankRows = [];

  rows.forEach((row, sourceIndex) => {
    const materialCode = normalizeText(row.materialCode);
    const businessUnit = purchaseTrackingBusinessUnit(row.businessUnit);
    if (!materialCode) {
      blankRows.push({
        ...row,
        rowKey: row.rowKey || row.demandKey || `operation-material-blank-${sourceIndex}`,
        demandKey: row.demandKey || `operation-material-blank-${sourceIndex}`,
        materialCode: '',
        businessUnit,
        sourceIndex
      });
      return;
    }

    const groupKey = JSON.stringify([materialCode, businessUnit]);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        materialCode,
        businessUnit,
        firstRow: row,
        firstIndex: sourceIndex,
        numericTotals: Object.fromEntries(MATERIAL_GROUP_NUMERIC_FIELDS.map((field) => [field, 0])),
        textValues: Object.fromEntries(MATERIAL_GROUP_TEXT_FIELDS.map((field) => [field, new Set()]))
      };
      groups.set(groupKey, group);
    }

    MATERIAL_GROUP_NUMERIC_FIELDS.forEach((field) => {
      group.numericTotals[field] += numericValue(row[field]);
    });
    MATERIAL_GROUP_TEXT_FIELDS.forEach((field) => addTextValue(group, field, row[field]));
  });

  const materialRows = [...groups.values()].map((group) => {
    const { materialCode, businessUnit } = group;
    const textFields = Object.fromEntries(
      MATERIAL_GROUP_TEXT_FIELDS.map((field) => [field, [...group.textValues[field]].join('、')])
    );
    return {
      ...group.firstRow,
      ...textFields,
      ...group.numericTotals,
      rowKey: `operation-material:${materialCode}:${businessUnit || '未分事业部'}`,
      demandKey: `operation-material:${materialCode}:${businessUnit || '未分事业部'}`,
      materialCode,
      businessUnit,
      operationOrderRows: [],
      sourceIndex: group.firstIndex
    };
  });

  materialRows.sort((left, right) => (
    left.materialCode.localeCompare(right.materialCode, 'zh-Hans-CN', { numeric: true })
      || left.businessUnit.localeCompare(right.businessUnit, 'zh-Hans-CN')
  ));

  return [...materialRows, ...blankRows]
    .map(({ sourceIndex: _sourceIndex, ...row }) => row);
}
