const HEADER_FILL = 'FFD9EAF7';
const HEADER_FONT = 'FF17324D';
const ALTERNATE_FILL = 'FFF3F6FA';
const BORDER_COLOR = 'FFCBD5E1';
export const STANDARD_EXCEL_INTEGER_FORMAT = '#,##0';
export const STANDARD_EXCEL_DECIMAL_FORMAT = '#,##0.0';

export function standardExcelNumberFormat(value) {
  return Number.isInteger(value) ? STANDARD_EXCEL_INTEGER_FORMAT : STANDARD_EXCEL_DECIMAL_FORMAT;
}

const NUMERIC_HEADER_PATTERN = /(数量|金额|货值|占比|天数|销量|销售额|单价|结算价|差异|库存|在途|未交付|已发货|入库|生产|完工|需求|合计|记录数|物料数|影响|qty|amount|price|value|count|days|rate|percent)/i;
const TEXT_HEADER_PATTERN = /(编码|编号|单号|订单号|sku|id|日期|时间|月份|状态|名称|事业部|产品线|系列|型号|仓库|主体|供应商|创建人|备注|原因|来源|分类|类型|组织|店铺|站点|渠道|区域|动作|角色|页面|路径|方式)/i;

function roundedNumber(value) {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function numericTextValue(value, header) {
  if (typeof value !== 'string') return null;
  const headerText = String(header ?? '').trim();
  if (!NUMERIC_HEADER_PATTERN.test(headerText) || TEXT_HEADER_PATTERN.test(headerText)) return null;
  const normalized = value.trim().replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundedNumber(parsed) : null;
}

function normalizedCellValue(value, header) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  if (typeof value === 'number') return roundedNumber(value);
  if (typeof value === 'string') {
    const cleaned = value.replace(/[\r\n]+/g, ' / ').trim();
    return numericTextValue(cleaned, header) ?? cleaned;
  }
  if (value instanceof Date || typeof value !== 'object') return value;
  return JSON.stringify(value);
}

function displayWidth(value) {
  const text = String(value ?? '');
  let width = 0;
  for (const character of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60]/u.test(character) ? 2 : 1;
  }
  return width;
}

function thinBorder() {
  const side = { style: 'thin', color: { argb: BORDER_COLOR } };
  return { top: side, left: side, bottom: side, right: side };
}

export function applyStandardExcelTableFormat(worksheet, options = {}) {
  const columnCount = Math.max(1, worksheet.columnCount);
  const rowCount = Math.max(1, worksheet.rowCount);
  const minimumWidth = Number(options.minimumWidth) || 10;
  const maximumWidth = Number(options.maximumWidth) || 80;
  const preferredWidths = options.preferredWidths || [];

  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rowCount, column: columnCount }
  };
  worksheet.properties.defaultRowHeight = 18;

  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (rowNumber === 1) row.height = 22;
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: HEADER_FONT } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      } else if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALTERNATE_FILL } };
      }
      if (cell.value !== '' && cell.value !== null && cell.value !== undefined) {
        cell.border = thinBorder();
      }
      if (typeof cell.value === 'number') cell.numFmt = standardExcelNumberFormat(cell.value);
    }
  }

  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    let calculatedWidth = minimumWidth;
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      calculatedWidth = Math.max(calculatedWidth, displayWidth(worksheet.getCell(rowNumber, columnNumber).value) + 2);
    }
    const preferredWidth = Number(preferredWidths[columnNumber - 1]);
    worksheet.getColumn(columnNumber).width = Math.min(
      maximumWidth,
      Math.max(calculatedWidth, Number.isFinite(preferredWidth) ? preferredWidth : 0)
    );
  }

  return worksheet;
}

export async function buildStyledExcelBuffer(sheetJs, sourceWorkbook, options = {}) {
  const module = await import('exceljs');
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.creator || '供应AI系统';
  workbook.created = new Date();

  sourceWorkbook.SheetNames.forEach((sheetName) => {
    const sourceSheet = sourceWorkbook.Sheets[sheetName];
    const sourceRows = sheetJs.utils.sheet_to_json(sourceSheet, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: true
    });
    const headers = sourceRows[0] || [];
    const rows = sourceRows.map((row) => row.map((value, columnIndex) => normalizedCellValue(value, headers[columnIndex])));
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.addRows(rows.length ? rows : [['']]);
    applyStandardExcelTableFormat(worksheet, {
      ...options,
      preferredWidths: (sourceSheet?.['!cols'] || []).map((column) => column?.wch || column?.width || 0)
    });
  });

  return workbook.xlsx.writeBuffer();
}

export async function writeStyledExcelFile(sheetJs, sourceWorkbook, fileName, options = {}) {
  const output = await buildStyledExcelBuffer(sheetJs, sourceWorkbook, options);
  const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
