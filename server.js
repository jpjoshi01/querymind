// QueryMind Backend Server
// Handles multi-LLM proxying with user-owned API keys stored in the OS
// credential manager. API keys are never exposed to the browser after setup.

require('dotenv').config();
const express = require('express');
const path = require('path');
const keytar = require('keytar');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;
const CREDENTIAL_SERVICE = 'QueryMind';

const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    account: 'anthropic-api-key',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },
  openai: {
    label: 'OpenAI (GPT)',
    account: 'openai-api-key',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  kimi: {
    label: 'Kimi (Moonshot AI)',
    account: 'kimi-api-key',
    model: process.env.KIMI_MODEL || 'moonshot-v1-32k',
  },
};

async function providerStatus() {
  const providers = await Promise.all(
    Object.entries(PROVIDERS).map(async ([id, cfg]) => ({
      id,
      label: cfg.label,
      model: cfg.model,
      configured: !!(await keytar.getPassword(CREDENTIAL_SERVICE, cfg.account)),
    }))
  );

  return providers;
}

async function getDefaultProvider() {
  const requested = process.env.DEFAULT_LLM_PROVIDER;
  const providers = await providerStatus();

  if (requested && providers.some(provider => provider.id === requested && provider.configured)) {
    return requested;
  }

  return providers.find(provider => provider.configured)?.id || null;
}

async function getApiKey(provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return null;
  return keytar.getPassword(CREDENTIAL_SERVICE, cfg.account);
}

app.get('/', (req, res) => {
  res.redirect('/querymind.html');
});

app.get('/querymind.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'querymind.html'));
});

// Provider status for the frontend. API keys are never exposed.
app.get('/api/providers', async (req, res) => {
  try {
    res.json({
      providers: await providerStatus(),
      defaultProvider: await getDefaultProvider(),
    });
  } catch (err) {
    res.status(500).json({ error: `Could not read Credential Manager: ${err.message}` });
  }
});

// POST /api/credentials { provider: "claude"|"openai"|"kimi", apiKey: "..." }
app.post('/api/credentials', async (req, res) => {
  const { provider, apiKey } = req.body;
  const cfg = PROVIDERS[provider];

  if (!cfg) {
    return res.status(400).json({ error: `Unknown provider: ${provider || 'none'}` });
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return res.status(400).json({ error: 'Enter a valid API key.' });
  }

  try {
    await keytar.setPassword(CREDENTIAL_SERVICE, cfg.account, apiKey.trim());
    res.json({
      ok: true,
      providers: await providerStatus(),
      defaultProvider: provider,
    });
  } catch (err) {
    res.status(500).json({ error: `Could not save API key to Credential Manager: ${err.message}` });
  }
});

// DELETE /api/credentials/:provider
app.delete('/api/credentials/:provider', async (req, res) => {
  const cfg = PROVIDERS[req.params.provider];

  if (!cfg) {
    return res.status(400).json({ error: `Unknown provider: ${req.params.provider || 'none'}` });
  }

  try {
    await keytar.deletePassword(CREDENTIAL_SERVICE, cfg.account);
    res.json({
      ok: true,
      providers: await providerStatus(),
      defaultProvider: await getDefaultProvider(),
    });
  } catch (err) {
    res.status(500).json({ error: `Could not remove API key from Credential Manager: ${err.message}` });
  }
});

// POST /api/chat  { provider: "claude"|"openai"|"kimi", system, prompt, max_tokens }
app.post('/api/chat', async (req, res) => {
  const {
    provider: requestedProvider,
    system = '',
    prompt = '',
    max_tokens = 2000,
  } = req.body;
  const provider = requestedProvider || await getDefaultProvider();

  const cfg = PROVIDERS[provider];
  if (!cfg) {
    return res.status(400).json({ error: `Unknown provider: ${provider || 'none'}` });
  }

  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    return res.status(401).json({
      error: `${cfg.label} is not configured on this machine. Add your API key in QueryMind setup.`,
    });
  }

  const safeMaxTokens = Math.min(Math.max(Number(max_tokens) || 2000, 1), 4000);

  try {
    let text;
    if (provider === 'claude') {
      text = await callClaude(apiKey, cfg.model, system, prompt, safeMaxTokens);
    } else if (provider === 'openai') {
      text = await callOpenAI(apiKey, cfg.model, system, prompt, safeMaxTokens);
    } else if (provider === 'kimi') {
      text = await callKimi(apiKey, cfg.model, system, prompt, safeMaxTokens);
    }

    res.json({ text });
  } catch (err) {
    console.error(`[${provider}] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

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
  return data.content.map(block => block.text || '').join('');
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

// Kimi (Moonshot AI) uses an OpenAI-compatible chat completions API.
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

const server = app.listen(PORT, async () => {
  console.log(`QueryMind server running at http://localhost:${PORT}`);
  console.log('Credential-backed LLM providers:');
  try {
    const providers = await providerStatus();
    providers.forEach(provider => {
      console.log(`  - ${provider.label}: ${provider.configured ? 'configured' : 'missing'}`);
    });
    console.log(`Default provider: ${(await getDefaultProvider()) || 'none configured'}`);
  } catch (err) {
    console.error(`Could not read Credential Manager: ${err.message}`);
  }
});

module.exports = { app, server };
