import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

test('数据审计输出头程解析版本和目的仓统计', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gendanjindu-data-audit-'));
  process.env.DATA_DIR = dataDir;
  try {
    const database = await import(`./database.js?data-audit-test=${Date.now()}`);
    await database.initDatabase();
    const firstMileRows = [
      { destinationWarehouse: 'SCK8', inboundWarehouseType: 'FBA仓' },
      { destinationWarehouse: '108-G-德国东荣仓', inboundWarehouseType: 'FBM仓' },
      { destinationWarehouse: '', inboundWarehouseType: '' }
    ];
    database.run(
      `INSERT INTO dimension_files (
         slot_id, title, file_name, mapping_json, rows_json,
         source_file_size, applied, uploaded_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        'firstMileData1', '头程数据', '头程.xlsx',
        JSON.stringify({ __firstMileSummary: { parserVersion: 5 } }),
        JSON.stringify(firstMileRows), 100, '测试用户', '2026-09-01 10:00:00'
      ]
    );
    database.saveDatabase();

    const output = execFileSync(
      process.execPath,
      [path.join(serverDir, 'data-audit.js'), path.join(dataDir, 'gendanjindu.sqlite')],
      { encoding: 'utf8' }
    );
    const audit = JSON.parse(output);
    assert.deepEqual(audit.firstMile, {
      sourceCount: 1,
      originalFileCount: 1,
      parserVersions: { 5: 1 },
      rowCount: 3,
      destinationWarehouseRows: 2,
      fbaRows: 1,
      fbmRows: 1
    });
  } finally {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
