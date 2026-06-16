// QueryMind Backend Server
// Handles: multi-LLM proxy (Claude / OpenAI / Kimi) using keys from .env,
// and optional Oracle DB connectivity via TNS (oracledb).
//
// Setup:
//   npm install
//   cp .env.example .env   (fill in your keys / TNS details)
//   node server.js
//
// The server reads API keys from environment variables so individual
// users never need to enter or see an API key in the browser.

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname))); // serves querymind.html etc.

const PORT = process.env.PORT || 3000;

// ── LLM PROVIDER CONFIG ─────────────────────────────────────────────────────
// Each provider reads its key from .env. If a key is missing, that provider
// is reported as unavailable to the frontend (so the dropdown can be filtered
// or show a warning) but the server still starts fine.

const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    envKey: 'ANTHROPIC_API_KEY',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },
  openai: {
    label: 'OpenAI (GPT)',
    envKey: 'OPENAI_API_KEY',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  kimi: {
    label: 'Kimi (Moonshot AI)',
    envKey: 'KIMI_API_KEY',
    model: process.env.KIMI_MODEL || 'moonshot-v1-32k',
  },
};

// Tell the frontend which providers are configured (no keys are ever exposed)
app.get('/api/providers', (req, res) => {
  const available = Object.entries(PROVIDERS).map(([id, cfg]) => ({
    id,
    label: cfg.label,
    configured: !!process.env[cfg.envKey],
  }));
  res.json({ providers: available });
});

// ── UNIFIED CHAT ENDPOINT ────────────────────────────────────────────────────
// POST /api/chat  { provider: "claude"|"openai"|"kimi", system, prompt, max_tokens }
app.post('/api/chat', async (req, res) => {
  const { provider = 'claude', system = '', prompt = '', max_tokens = 2000 } = req.body;
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  const apiKey = process.env[cfg.envKey];
  if (!apiKey) {
    return res.status(500).json({
      error: `${cfg.label} is not configured on the server. Set ${cfg.envKey} in .env`,
    });
  }

  try {
    let text;
    if (provider === 'claude') {
      text = await callClaude(apiKey, cfg.model, system, prompt, max_tokens);
    } else if (provider === 'openai') {
      text = await callOpenAI(apiKey, cfg.model, system, prompt, max_tokens);
    } else if (provider === 'kimi') {
      text = await callKimi(apiKey, cfg.model, system, prompt, max_tokens);
    }
    res.json({ text });
  } catch (err) {
    console.error(`[${provider}] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PROVIDER IMPLEMENTATIONS ─────────────────────────────────────────────────

async function callClaude(apiKey, model, system, prompt, max_tokens) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.content.map(b => b.text || '').join('');
}

async function callOpenAI(apiKey, model, system, prompt, max_tokens) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// Kimi (Moonshot AI) uses an OpenAI-compatible chat completions API
async function callKimi(apiKey, model, system, prompt, max_tokens) {
  const resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Kimi API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── ORACLE DB (TNS) CONNECTIVITY ─────────────────────────────────────────────
// Requires: npm install oracledb
// Requires Oracle Instant Client installed and TNS_ADMIN pointing at the
// directory containing tnsnames.ora (set in .env).
//
// POST /api/db/connect  { tnsAlias, user, password }
// POST /api/db/query    { tnsAlias, user, password, sql }
//
// Connections are opened per-request and closed immediately. For production
// use, switch to oracledb connection pools (oracledb.createPool).

let oracledb;
try {
  oracledb = require('oracledb');
  if (process.env.ORACLE_CLIENT_LIB_DIR) {
    oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR });
  }
} catch (e) {
  console.warn('oracledb module not installed - TNS DB features disabled. Run "npm install oracledb" to enable.');
}

// List TNS aliases available from tnsnames.ora (TNS_ADMIN must be set)
app.get('/api/db/tns-entries', (req, res) => {
  const tnsAdmin = process.env.TNS_ADMIN;
  if (!tnsAdmin) return res.status(500).json({ error: 'TNS_ADMIN is not set in .env' });
  try {
    const fs = require('fs');
    const content = fs.readFileSync(path.join(tnsAdmin, 'tnsnames.ora'), 'utf8');
    // crude parse: alias names are at the start of a line, followed by '='
    const aliases = [...content.matchAll(/^([A-Za-z0-9_.\-]+)\s*=/gm)].map(m => m[1]);
    res.json({ aliases });
  } catch (err) {
    res.status(500).json({ error: `Could not read tnsnames.ora: ${err.message}` });
  }
});

// Test a connection using a TNS alias + credentials
app.post('/api/db/connect', async (req, res) => {
  if (!oracledb) return res.status(500).json({ error: 'oracledb is not installed on the server' });
  const { tnsAlias, user, password } = req.body;
  if (!tnsAlias || !user || !password) {
    return res.status(400).json({ error: 'tnsAlias, user, and password are required' });
  }
  let connection;
  try {
    connection = await oracledb.getConnection({
      user,
      password,
      connectString: tnsAlias, // resolved via TNS_ADMIN/tnsnames.ora
    });
    res.json({ success: true, message: `Connected successfully to ${tnsAlias}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
});

// Run a query against a TNS alias (used to feed real schema/data into the AI tools)
app.post('/api/db/query', async (req, res) => {
  if (!oracledb) return res.status(500).json({ error: 'oracledb is not installed on the server' });
  const { tnsAlias, user, password, sql, binds = {}, maxRows = 100 } = req.body;
  if (!tnsAlias || !user || !password || !sql) {
    return res.status(400).json({ error: 'tnsAlias, user, password, and sql are required' });
  }
  let connection;
  try {
    connection = await oracledb.getConnection({ user, password, connectString: tnsAlias });
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows,
    });
    res.json({ rows: result.rows, metaData: result.metaData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
});

// ── START ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`QueryMind server running at http://localhost:${PORT}`);
  console.log('Configured LLM providers:');
  Object.entries(PROVIDERS).forEach(([id, cfg]) => {
    console.log(`  - ${cfg.label}: ${process.env[cfg.envKey] ? 'OK' : 'MISSING (' + cfg.envKey + ')'}`);
  });
  if (!process.env.TNS_ADMIN) {
    console.log('  TNS_ADMIN not set - Oracle TNS database features will be limited.');
  }
});
