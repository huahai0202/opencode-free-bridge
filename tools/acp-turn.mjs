#!/usr/bin/env node
// ACP full-turn test for opencode-free-bridge under `dsh --profile acp`.
// initialize -> session/new -> switch model -> prompt, verifies the free-tier
// channels (OpenCode Zen / Cline) no longer fail with `MissingSessionID` 400.
// Zero dependencies, Node >= 22.
//
// Usage:
//   node tools/acp-turn.mjs                          # default: OpenCode Zen free model
//   node tools/acp-turn.mjs --model '["cline","deepseek/deepseek-v4-flash"]'
//   node tools/acp-turn.mjs --cwd <dir> --prompt "hi"

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CWD = arg('--cwd', process.cwd());
const PROFILE = arg('--profile', 'acp');
const MODEL = arg('--model', '["opencode","mimo-v2.5-free"]');
const PROMPT = arg('--prompt', 'Reply with exactly one word: pong');

const child = process.platform === 'win32'
  ? spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `dsh --profile ${PROFILE}`],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  : spawn('dsh', ['--profile', PROFILE], { stdio: ['pipe', 'pipe', 'pipe'] });

const rl = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
let assistantText = '';
let sessionError = null;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }
    }, 120000);
  });
}

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { console.log('[non-json]', t.slice(0, 150)); return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method} -> ${JSON.stringify(msg.error).slice(0, 300)}`));
    else p.resolve(msg.result);
  } else if (msg.method === 'session/update') {
    const u = msg.params?.update ?? {};
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
      assistantText += u.content.text;
    }
  } else if (msg.method?.startsWith('session/') && (msg.params?.error || msg.params?.severity === 'error')) {
    sessionError = JSON.stringify(msg.params).slice(0, 400);
  }
});

let stderrTail = '';
child.stderr.on('data', (d) => { stderrTail += d; if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000); });

try {
  await send('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
  const sess = await send('session/new', { cwd: CWD, mcpServers: [] });
  const sessionId = sess.sessionId;

  await send('session/set_config_option', { sessionId, configId: 'model', value: MODEL });
  console.log('model set to', MODEL);

  const res = await send('session/prompt', { sessionId, prompt: [{ type: 'text', text: PROMPT }] });
  console.log('stopReason:', res?.stopReason);
  console.log('assistant replied:', JSON.stringify(assistantText.slice(0, 200)));
  if (sessionError) console.log('session error notification:', sessionError);

  const bad = /MissingSessionID|only be used in OpenCode/i.test(`${assistantText} ${sessionError ?? ''}`);
  console.log(bad ? '\nTURN FAILED — provider 400 still present (bridge not active?)' : '\nTURN OK — free-model channel healthy');
  process.exitCode = bad ? 1 : 0;
} catch (err) {
  console.error('TURN TEST FAILED:', err.message);
  if (stderrTail.trim()) console.error('[stderr tail]', stderrTail.trim().slice(-800));
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
