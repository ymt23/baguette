#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_VERSION = '0.1.1';
const REVIEW_API_VERSION = '1';
const PAYLOAD_VERSION = '1';
const DEFAULT_BASE_URL = process.env.BAGUETTE_REVIEW_BASE_URL || 'http://127.0.0.1:8421';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const templatePath = resolve(pluginRoot, 'templates/project-skill/SKILL.md');
let launchedProcess = null;
let activeBaseUrl = DEFAULT_BASE_URL;

console.error(`[baguette-review-mcp] starting v${PLUGIN_VERSION}`);

const tools = [
  {
    name: 'baguette_status',
    description: 'Return Baguette review API status when the local server is reachable.',
    inputSchema: schema({ baseUrl: stringProp('Baguette base URL') }),
  },
  {
    name: 'baguette_start',
    description: 'Start baguette serve if no reachable Baguette server already exists.',
    inputSchema: schema({
      host: stringProp('Host to bind', '127.0.0.1'),
      port: numberProp('Port to bind', 8421),
      baguetteBin: stringProp('Baguette executable path or name', 'baguette'),
      repoPath: stringProp('Baguette CX review fork repository path'),
    }),
  },
  {
    name: 'baguette_review_url',
    description: 'Return a Baguette focus-mode review URL by UDID or simulator name.',
    inputSchema: schema({
      udid: stringProp('Simulator UDID'),
      deviceName: stringProp('Simulator display name'),
      baseUrl: stringProp('Baguette base URL'),
    }),
  },
  {
    name: 'baguette_get_latest_review',
    description: 'Return the latest saved CX review annotations, optionally scoped to one UDID.',
    inputSchema: schema({
      udid: stringProp('Simulator UDID'),
      baseUrl: stringProp('Baguette base URL'),
    }),
  },
  {
    name: 'baguette_wait_for_review',
    description: 'Poll until a saved review has at least one annotation comment.',
    inputSchema: schema({
      udid: stringProp('Simulator UDID'),
      baseUrl: stringProp('Baguette base URL'),
      timeoutMs: numberProp('Timeout in milliseconds', 300000),
      intervalMs: numberProp('Polling interval in milliseconds', 1500),
    }),
  },
  {
    name: 'baguette_clear_review',
    description: 'Delete saved CX review annotations for a simulator UDID.',
    inputSchema: schema({
      udid: stringProp('Simulator UDID'),
      baseUrl: stringProp('Baguette base URL'),
    }, ['udid']),
  },
  {
    name: 'baguette_project_skill_status',
    description: 'Check whether the current project has the Baguette review apply skill and whether its template version matches.',
    inputSchema: schema({
      projectPath: stringProp('Project root. Defaults to MCP working directory.'),
    }),
  },
  {
    name: 'baguette_project_skill_diff',
    description: 'Return a compact template-vs-project skill diff for human review.',
    inputSchema: schema({
      projectPath: stringProp('Project root. Defaults to MCP working directory.'),
    }),
  },
  {
    name: 'baguette_scaffold_project_skill',
    description: 'Create .codex/skills/baguette-review-apply/SKILL.md from the bundled template without overwriting existing files.',
    inputSchema: schema({
      projectPath: stringProp('Project root. Defaults to MCP working directory.'),
    }),
  },
];

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function stringProp(description, defaultValue) {
  const prop = { type: 'string', description };
  if (defaultValue !== undefined) prop.default = defaultValue;
  return prop;
}

function numberProp(description, defaultValue) {
  const prop = { type: 'number', description };
  if (defaultValue !== undefined) prop.default = defaultValue;
  return prop;
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'baguette_status':
      return baguetteStatus(args);
    case 'baguette_start':
      return baguetteStart(args);
    case 'baguette_review_url':
      return baguetteReviewUrl(args);
    case 'baguette_get_latest_review':
      return baguetteGetLatestReview(args);
    case 'baguette_wait_for_review':
      return baguetteWaitForReview(args);
    case 'baguette_clear_review':
      return baguetteClearReview(args);
    case 'baguette_project_skill_status':
      return projectSkillStatus(args);
    case 'baguette_project_skill_diff':
      return projectSkillDiff(args);
    case 'baguette_scaffold_project_skill':
      return scaffoldProjectSkill(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function baguetteStatus(args) {
  const baseUrl = normalizedBaseUrl(args.baseUrl);
  const status = await getJSON(`${baseUrl}/review/status.json`);
  if (!status.ok) {
    const simulators = await request(`${baseUrl}/simulators`);
    if (simulators.ok) {
      return {
        ok: false,
        reachable: false,
        serverReachable: true,
        compatible: false,
        incompatible: true,
        baseUrl,
        plugin: { version: PLUGIN_VERSION },
        error: 'Baguette is reachable, but CX Review API is missing. The running binary is likely an upstream/Homebrew build without CX Review Mode.',
        details: {
          reviewStatusError: status.error,
          simulatorsStatus: simulators.status,
        },
      };
    }
    return {
      ok: false,
      reachable: false,
      serverReachable: false,
      compatible: false,
      baseUrl,
      plugin: { version: PLUGIN_VERSION },
      error: status.error,
    };
  }
  return {
    ok: true,
    reachable: true,
    serverReachable: true,
    baseUrl,
    plugin: { version: PLUGIN_VERSION },
    compatible: String((status.data.cxReview || status.data.baguette)?.reviewApiVersion) === REVIEW_API_VERSION &&
      String((status.data.cxReview || status.data.baguette)?.annotationPayloadVersion) === PAYLOAD_VERSION,
    status: status.data,
  };
}

async function baguetteStart(args) {
  const host = args.host || '127.0.0.1';
  const requestedPort = Number(args.port || 8421);
  let port = requestedPort;
  let baseUrl = `http://${host}:${port}`;
  const existing = await baguetteStatus({ baseUrl });
  if (existing.reachable && existing.compatible !== false) {
    activeBaseUrl = baseUrl;
    return { ...existing, reused: true };
  }
  if (existing.serverReachable && !existing.compatible) {
    const nextPort = await nextReviewPort(host, requestedPort + 1);
    port = nextPort;
    baseUrl = `http://${host}:${port}`;
  }

  const bin = resolveBaguetteBin(args);
  launchedProcess = spawn(bin, ['serve', '--host', host, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  launchedProcess.unref();

  const deadline = Date.now() + 10000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(500);
    last = await baguetteStatus({ baseUrl });
    if (last.reachable && last.compatible !== false) {
      activeBaseUrl = baseUrl;
      return { ...last, started: true, pid: launchedProcess.pid, baguetteBin: bin };
    }
  }
  return {
    ok: false,
    reachable: false,
    started: false,
    baseUrl,
    baguetteBin: bin,
    error: last?.error || 'Baguette did not become reachable with a compatible CX Review API',
  };
}

async function baguetteReviewUrl(args) {
  const baseUrl = normalizedBaseUrl(args.baseUrl);
  const udid = args.udid || await udidForDeviceName(baseUrl, args.deviceName);
  if (!udid) return { ok: false, error: 'No matching simulator UDID found' };
  return { ok: true, udid, url: `${baseUrl}/simulators/${encodeURIComponent(udid)}` };
}

async function baguetteGetLatestReview(args) {
  const baseUrl = normalizedBaseUrl(args.baseUrl);
  const udid = args.udid || await latestReviewUdid(baseUrl);
  if (!udid) return { ok: false, error: 'No saved review annotations found' };
  const review = await getJSON(`${baseUrl}/simulators/${encodeURIComponent(udid)}/review-annotations.json`);
  if (!review.ok) return { ok: false, udid, error: review.error };
  return { ok: true, udid, review: review.data };
}

async function baguetteWaitForReview(args) {
  const timeoutMs = Number(args.timeoutMs || 300000);
  const intervalMs = Number(args.intervalMs || 1500);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await baguetteGetLatestReview(args);
    if (last.ok && Number(last.review.annotationCount || 0) > 0) {
      return { ...last, waitedMs: timeoutMs - Math.max(0, deadline - Date.now()) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, timeout: true, waitedMs: timeoutMs, last };
}

async function baguetteClearReview(args) {
  const baseUrl = normalizedBaseUrl(args.baseUrl);
  const udid = args.udid;
  if (!udid) return { ok: false, error: 'udid is required' };
  const result = await request(`${baseUrl}/simulators/${encodeURIComponent(udid)}/review-annotations.json`, { method: 'DELETE' });
  return result.ok ? { ok: true, udid } : { ok: false, udid, error: result.error };
}

function projectSkillStatus(args) {
  const projectPath = resolve(args.projectPath || process.cwd());
  const skillPath = projectSkillPath(projectPath);
  const template = readFileSync(templatePath, 'utf8');
  const templateMeta = frontmatter(template);
  if (!existsSync(skillPath)) {
    return { ok: true, exists: false, projectPath, skillPath, templateVersion: templateMeta.baguetteReviewTemplateVersion };
  }
  const current = readFileSync(skillPath, 'utf8');
  const currentMeta = frontmatter(current);
  return {
    ok: true,
    exists: true,
    projectPath,
    skillPath,
    templateVersion: templateMeta.baguetteReviewTemplateVersion,
    installedVersion: currentMeta.baguetteReviewTemplateVersion || null,
    annotationPayloadVersion: currentMeta.annotationPayloadVersion || null,
    stale: currentMeta.baguetteReviewTemplateVersion !== templateMeta.baguetteReviewTemplateVersion,
  };
}

function projectSkillDiff(args) {
  const projectPath = resolve(args.projectPath || process.cwd());
  const skillPath = projectSkillPath(projectPath);
  const template = readFileSync(templatePath, 'utf8');
  if (!existsSync(skillPath)) {
    return { ok: true, exists: false, projectPath, skillPath, template };
  }
  const current = readFileSync(skillPath, 'utf8');
  return {
    ok: true,
    exists: true,
    projectPath,
    skillPath,
    diff: simpleDiff(current, template),
  };
}

function scaffoldProjectSkill(args) {
  const projectPath = resolve(args.projectPath || process.cwd());
  const skillPath = projectSkillPath(projectPath);
  if (existsSync(skillPath)) {
    return { ok: false, exists: true, projectPath, skillPath, error: 'Project skill already exists; refusing to overwrite' };
  }
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, readFileSync(templatePath, 'utf8'));
  return { ok: true, projectPath, skillPath, created: true };
}

async function latestReviewUdid(baseUrl) {
  const status = await getJSON(`${baseUrl}/review/status.json`);
  if (!status.ok) return null;
  return status.data.reviews?.[0]?.udid || null;
}

async function udidForDeviceName(baseUrl, deviceName) {
  if (!deviceName) return null;
  const status = await getJSON(`${baseUrl}/review/status.json`);
  if (!status.ok) return null;
  const devices = status.data.simulators || [];
  const exact = devices.find((device) => device.name === deviceName);
  if (exact) return exact.udid;
  return devices.find((device) => String(device.name || '').includes(deviceName))?.udid || null;
}

async function getJSON(url) {
  const result = await request(url);
  if (!result.ok) return result;
  try {
    return { ok: true, data: JSON.parse(result.text) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON from ${url}: ${error.message}` };
  }
}

async function request(url, init = {}) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, text, error: text || `HTTP ${response.status}` };
    return { ok: true, status: response.status, text };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizedBaseUrl(value) {
  return String(value || activeBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function resolveBaguetteBin(args = {}) {
  if (args.baguetteBin) return args.baguetteBin;
  if (process.env.BAGUETTE_BIN) return process.env.BAGUETTE_BIN;

  for (const candidate of baguetteBinCandidates(args.repoPath)) {
    if (existsSync(candidate)) return candidate;
  }

  return 'baguette';
}

function baguetteBinCandidates(repoPath) {
  const roots = [
    repoPath,
    process.env.BAGUETTE_REVIEW_REPO,
    process.env.HOME && `${process.env.HOME}/Documents/Personal/Tools/baguette-cx-review`,
  ].filter(Boolean);

  return roots.flatMap((root) => [
    resolve(root, '.build/arm64-apple-macosx/debug/Baguette'),
    resolve(root, '.build/debug/Baguette'),
    resolve(root, '.build/arm64-apple-macosx/release/Baguette'),
    resolve(root, '.build/release/Baguette'),
  ]);
}

async function nextReviewPort(host, startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    const probe = await request(`http://${host}:${port}/simulators`);
    if (!probe.ok && !probe.status) return port;
  }
  return startPort;
}

function projectSkillPath(projectPath) {
  return resolve(projectPath, '.codex/skills/baguette-review-apply/SKILL.md');
}

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const meta = {};
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

function simpleDiff(current, template) {
  const a = current.split('\n');
  const b = template.split('\n');
  const max = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`-${i + 1}: ${a[i]}`);
    if (b[i] !== undefined) out.push(`+${i + 1}: ${b[i]}`);
    if (out.length > 300) {
      out.push('...');
      break;
    }
  }
  return out.join('\n');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`${json}\n`);
}

async function handle(message) {
  if (message.method === 'initialize') {
    console.error(`[baguette-review-mcp] initialize ${message.params?.protocolVersion || 'unknown'}`);
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'baguette-review', version: PLUGIN_VERSION },
        instructions: 'Baguette Review MCP provides tools for opening CX Review Mode and retrieving saved review annotations.',
      },
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'tools/list') {
    console.error(`[baguette-review-mcp] tools/list ${tools.length}`);
    send({ jsonrpc: '2.0', id: message.id, result: { tools } });
    return;
  }
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: result && result.ok === false,
        },
      });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: error.stack || error.message }],
          isError: true,
        },
      });
    }
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  readMessages();
});

function readMessages() {
  while (input.length > 0) {
    if (/^content-length:/i.test(input.toString('utf8', 0, Math.min(input.length, 64)))) {
      if (!readContentLengthMessage()) return;
      continue;
    }

    const lineEnd = input.indexOf('\n');
    if (lineEnd === -1) return;
    const line = input.slice(0, lineEnd).toString('utf8').trim();
    input = input.slice(lineEnd + 1);
    if (line.length === 0) continue;
    handleBody(line);
  }
}

function readContentLengthMessage() {
  const headerEnd = input.indexOf('\r\n\r\n');
  if (headerEnd === -1) return false;

  const header = input.slice(0, headerEnd).toString('utf8');
  const match = /content-length:\s*(\d+)/i.exec(header);
  if (!match) {
    input = input.slice(headerEnd + 4);
    return true;
  }

  const length = Number(match[1]);
  const start = headerEnd + 4;
  const end = start + length;
  if (input.length < end) return false;

  const body = input.slice(start, end).toString('utf8');
  input = input.slice(end);
  handleBody(body);
  return true;
}

function handleBody(body) {
  try {
    Promise.resolve(handle(JSON.parse(body))).catch((error) => {
      send({ jsonrpc: '2.0', error: { code: -32603, message: error.message } });
    });
  } catch (error) {
    send({ jsonrpc: '2.0', error: { code: -32700, message: error.message } });
  }
}
