#!/usr/bin/env node
// JANAGEN AI Visual Studio — Local Server

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { exec } = require('child_process');

const PORT     = 4500;
const KEY_FILE = path.join(__dirname, 'key.txt');
const HTML_FILE = path.join(__dirname, 'index.html');

// ── Load key from key.txt ────────────────────────────────
function loadKey() {
  try {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (k.startsWith('sk-')) return k;
    console.error('\n⚠  Open key.txt and replace the placeholder with your OpenAI key.\n');
    return '';
  } catch {
    console.error('\n⚠  key.txt not found. Create it in the JANAGEN-Studio folder.\n');
    return '';
  }
}

// ── Proxy to OpenAI ──────────────────────────────────────
function openaiRequest(endpoint, body) {
  const apiKey = loadKey();
  if (!apiKey) throw new Error('API key not set — open key.txt and paste your OpenAI key.');

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.openai.com',
      path: `/v1/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch { reject(new Error('OpenAI response parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Read POST body ───────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 25e6) reject(new Error('Too large')); });
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

// ── Server ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Serve HTML
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_FILE, 'utf8'));
    } catch { res.writeHead(500); res.end('index.html not found'); }
    return;
  }

  // Vision — GPT-4o
  if (req.method === 'POST' && url === '/api/vision') {
    try {
      const body = await readBody(req);
      const result = await openaiRequest('chat/completions', {
        model: 'gpt-4o',
        max_tokens: 1200,
        temperature: 0.1,
        messages: [{
          role: 'system',
          content: `You are a data extraction engine for JANAGEN Pharmacies (Hyderabad).
Analyse the uploaded image. Extract ALL visible numbers, branch names, percentages, targets, dates.
Return ONLY valid JSON (no markdown fences):
{
  "data_type": "SALES | COMPLIANCE | OPERATIONS | FINANCE",
  "period": "e.g. April 2026",
  "summary": "one precise sentence describing the data",
  "key_metric": "the single most important value e.g. 72% or Rs 86,11,411",
  "metric_label": "what that value means",
  "secondary_metric": "second most important value",
  "secondary_label": "its label",
  "total_bills": "if visible else null",
  "avg_bill": "if visible else null",
  "branches": [{"name":"branch name","pct":72}],
  "top_performer": "branch name",
  "bottom_performer": "branch name",
  "data_points": ["6-8 precise extracted facts with actual numbers"]
}`
        }, {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${body.b64}`, detail: 'high' } },
            { type: 'text', text: 'Extract all data from this image and return the JSON.' }
          ]
        }]
      });
      let raw = result.choices[0].message.content.trim()
        .replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(JSON.parse(raw)));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // DALL-E 3
  if (req.method === 'POST' && url === '/api/dalle') {
    try {
      const body = await readBody(req);
      const result = await openaiRequest('images/generations', {
        model: 'dall-e-3',
        prompt: body.prompt,
        n: 1,
        size: '1792x1024',
        quality: 'hd',
        style: 'vivid'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: result.data[0].url }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const k = loadKey();
  console.log(`\n  ✦ JANAGEN AI Studio → http://localhost:${PORT}`);
  if (!k) console.log(`  ✎ Add your OpenAI key to key.txt then refresh the browser.\n`);
  else    console.log(`  ✓ API key loaded. Ready.\n`);
  exec(`open http://localhost:${PORT}`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') exec(`open http://localhost:${PORT}`);
  else throw err;
});
