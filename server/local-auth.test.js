import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${logs.join('')}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The server may still be initializing sql.js.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${logs.join('')}`);
}

test('local mode starts without credentials and bypasses login sessions', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'beihuochuhuojihua-auth-'));
  const port = await getAvailablePort();
  const logs = [];
  const child = spawn(process.execPath, ['server/app.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      ADMIN_INITIAL_PASSWORD: ''
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(`${baseUrl}/api/bootstrap`, child, logs);
    const anonymousBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Origin: 'http://localhost:5173' }
    });
    assert.equal(anonymousBootstrap.status, 200);
    assert.equal(anonymousBootstrap.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const anonymousPayload = await anonymousBootstrap.json();
    assert.equal(anonymousPayload.user.id, 'local');
    assert.equal(anonymousPayload.user.role, '管理员');
    assert.ok(anonymousPayload.user.pageAccess.includes('domesticBoard'));
    assert.ok(anonymousPayload.user.pageAccess.includes('permissions'));

    const staleTokenResponse = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Authorization: 'Bearer stale-token' }
    });
    assert.equal(staleTokenResponse.status, 200);
    assert.equal((await staleTokenResponse.json()).user.id, 'local');

    assert.equal((await fetch(`${baseUrl}/api/auth/login`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })).status, 404);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
