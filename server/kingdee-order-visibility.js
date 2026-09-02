const NON_ZERO_EPSILON = 1e-9;

function normalizePart(value) {
  return String(value ?? '').trim();
}

function numericValue(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function kingdeeOrderIdentity(demandKey, orderNo) {
  return `${normalizePart(demandKey)}|${normalizePart(orderNo)}`;
}

export function isEffectivePurchaseOrder(row) {
  const documentStatus = normalizePart(row?.documentStatus ?? row?.document_status);
  if (documentStatus === '暂存') return true;
  return normalizePart(row?.businessClose ?? row?.business_close) === '正常'
    && normalizePart(row?.closeStatus ?? row?.close_status) === '未关闭';
}

export function groupCurrentKingdeeOrderRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const demandKey = normalizePart(row.demandKey ?? row.demand_key);
    const orderNo = normalizePart(row.orderNo ?? row.order_no);
    const key = kingdeeOrderIdentity(demandKey, orderNo);
    const group = groups.get(key) || { key, demandKey, orderNo, remainingInboundQty: 0, rows: [] };
    group.remainingInboundQty += numericValue(row.remainingInboundQty ?? row.remaining_inbound_qty);
    group.rows.push(row);
    groups.set(key, group);
  });
  return [...groups.values()].filter((group) => Math.abs(group.remainingInboundQty) > NON_ZERO_EPSILON);
}
