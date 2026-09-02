import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import xlsx from 'xlsx';
import {
  buildStyledExcelBuffer,
  STANDARD_EXCEL_DECIMAL_FORMAT,
  STANDARD_EXCEL_INTEGER_FORMAT
} from '../shared/excel-export.js';

test('统一Excel格式应用到每个工作表', async () => {
  const source = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(source, xlsx.utils.aoa_to_sheet([
    ['事业部', '物料编码', '物料名称', '数量'],
    ['国内事业部', '1002010248', '测试物料一', 150],
    ['海外事业一部', '1924010005', '测试物料二', 80.26],
    ['全球招商事业部', '1007010344', '测试物料三', 30]
  ]), '明细');
  source.Sheets['明细']['!cols'] = [{ wch: 24 }];
  xlsx.utils.book_append_sheet(source, xlsx.utils.aoa_to_sheet([
    ['项目', '结果'],
    ['完整性', '通过']
  ]), '诊断');

  const buffer = await buildStyledExcelBuffer(xlsx, source);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  workbook.eachSheet((worksheet) => {
    assert.equal(worksheet.views[0].state, 'frozen');
    assert.equal(worksheet.views[0].ySplit, 1);
    assert.ok(worksheet.autoFilter);
    assert.equal(worksheet.getCell('A1').font.bold, true);
    assert.equal(worksheet.getCell('A1').fill.fgColor.argb, 'FFD9EAF7');
    assert.equal(worksheet.getCell('A2').alignment.horizontal, 'center');
    assert.equal(worksheet.getCell('A2').alignment.vertical, 'middle');
    assert.notEqual(worksheet.getCell('A2').alignment.wrapText, true);
    assert.equal(worksheet.getCell('A2').border.top.style, 'thin');
    assert.equal(worksheet.getCell('A2').fill.fgColor.argb, 'FFF3F6FA');
    assert.notEqual(worksheet.getCell('A3').fill?.fgColor?.argb, 'FFF3F6FA');
    assert.ok(worksheet.getColumn(1).width >= 10);
  });
  assert.equal(workbook.getWorksheet('明细').autoFilter, 'A1:D4');
  assert.ok(workbook.getWorksheet('明细').getColumn(1).width >= 24);
  assert.equal(workbook.getWorksheet('明细').getCell('D2').value, 150);
  assert.equal(workbook.getWorksheet('明细').getCell('D2').numFmt, STANDARD_EXCEL_INTEGER_FORMAT);
  assert.equal(workbook.getWorksheet('明细').getCell('D3').value, 80.3);
  assert.equal(workbook.getWorksheet('明细').getCell('D3').numFmt, STANDARD_EXCEL_DECIMAL_FORMAT);
  assert.equal(workbook.getWorksheet('明细').getCell('B2').value, '1002010248');
});

test('numeric text uses explicit integer or decimal formats while identifier text is preserved', async () => {
  const source = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(source, xlsx.utils.aoa_to_sheet([
    ['materialCode', 'qty', 'amount'],
    ['0010248', '1,200.0', '36.25'],
    ['1924010005', '8.6', '10']
  ]), 'Number format');

  const buffer = await buildStyledExcelBuffer(xlsx, source);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('Number format');

  assert.equal(worksheet.getCell('A2').value, '0010248');
  assert.equal(worksheet.getCell('B2').value, 1200);
  assert.equal(worksheet.getCell('B2').numFmt, STANDARD_EXCEL_INTEGER_FORMAT);
  assert.equal(worksheet.getCell('B3').value, 8.6);
  assert.equal(worksheet.getCell('B3').numFmt, STANDARD_EXCEL_DECIMAL_FORMAT);
  assert.equal(worksheet.getCell('C2').value, 36.3);
  assert.equal(worksheet.getCell('C2').numFmt, STANDARD_EXCEL_DECIMAL_FORMAT);
  assert.equal(worksheet.getCell('C3').value, 10);
  assert.equal(worksheet.getCell('C3').numFmt, STANDARD_EXCEL_INTEGER_FORMAT);
});

test('浏览器端和服务端业务导出均经过统一格式模块', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
  assert.doesNotMatch(client, /XLSX\.writeFile\(/);
  assert.doesNotMatch(server, /xlsx\.write\([^\n]+bookType:\s*'xlsx'/);
  assert.ok((client.match(/writeStyledExcelFile\(/g) || []).length >= 9);
  assert.ok((server.match(/buildStyledExcelBuffer\(/g) || []).length >= 5);
});
