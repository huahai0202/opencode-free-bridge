#!/usr/bin/env node
// ACP smoke test for opencode-free-bridge under `dsh --profile acp`.
// initialize + session/new, prints the agent's model catalog / config options.
// Zero dependencies, Node >= 22. Usage: node tools/acp-smoke.mjs [--cwd <dir>]

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CWD = arg('--cwd', process.cwd());
const PROFILE = arg('--profile', 'acp');

const child = process.platform === 'win32'
  ? spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `dsh --profile ${PROFILE}`],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  : spawn('dsh', ['--profile', PROFILE], { stdio: ['pipe', 'pipe', 'pipe'] });

const rl = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }
    }, 30000);
  });
}

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { console.log('[non-json stdout]', t.slice(0, 200)); return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method} -> ${JSON.stringify(msg.error).slice(0, 300)}`));
    else p.resolve(msg.result);
  }
});

let stderrTail = '';
child.stderr.on('data', (d) => { stderrTail += d; if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000); });

try {
  const init = await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  });
  console.log('agent:', init.agentInfo?.name, init.agentInfo?.version, '| protocol', init.protocolVersion, '| authMethods', init.authMethods?.length ?? 0);

  const sess = await send('session/new', { cwd: CWD, mcpServers: [] });
  const selects = (sess.configOptions ?? []).filter((o) => o.type === 'select');
  console.log('sessionId:', sess.sessionId);
  for (const g of selects) console.log(' ', g.id, '=', g.currentValue);
  console.log('\nSMOKE OK');
} catch (err) {
  console.error('SMOKE FAILED:', err.message);
  if (stderrTail.trim()) console.error('[stderr tail]', stderrTail.trim().slice(-800));
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
