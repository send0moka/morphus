#!/usr/bin/env node
/**
 * Local Morphus bridge for the Figma plugin.
 * The plugin UI sends HTML here, and this server returns the converted JSON.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { convertHtmlString } from '../src/pipeline/convert.js';

const PORT = Number.parseInt(process.env.PORT ?? process.env.MORPHUS_PORT ?? '3210', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_CONCURRENT_JOBS = getPositiveEnvNumber('MORPHUS_MAX_CONCURRENT_JOBS', 1);
const MAX_QUEUED_JOBS = getPositiveEnvNumber('MORPHUS_MAX_QUEUED_JOBS', 30);
const JOB_TIMEOUT_MS = getPositiveEnvNumber('MORPHUS_JOB_TIMEOUT_MS', 150000);
const JOB_TTL_MS = getPositiveEnvNumber('MORPHUS_JOB_TTL_MS', 10 * 60 * 1000);
const IDLE_SHUTDOWN_MS = getPositiveEnvNumber('MORPHUS_IDLE_SHUTDOWN_MS', 0);
const LOCAL_MODE = process.env.MORPHUS_LOCAL_MODE === '1';
const jobs = new Map();
const jobQueue = [];
let activeJobCount = 0;
let lastHeartbeatAt = Date.now();
let shutdownStarted = false;

const server = http.createServer(async (req, res) => {
  setCors(res);
  pruneFinishedJobs();
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = requestUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStatusPage());
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && path === '/heartbeat') {
    markHeartbeat();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHealthPayload()));
    return;
  }

  if (req.method === 'POST' && path === '/shutdown' && LOCAL_MODE) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Morphus local server is shutting down.' }));
    shutdownServer('manual request');
    return;
  }

  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHealthPayload()));
    return;
  }

  if (req.method === 'POST' && path === '/jobs') {
    try {
      markHeartbeat();
      const body = await readJsonBody(req);
      if (!body.html || typeof body.html !== 'string') {
        throw new Error('`html` is required.');
      }

      if (getPendingJobCount() >= MAX_CONCURRENT_JOBS + MAX_QUEUED_JOBS) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Converter is busy. Please wait for a few current conversions to finish, then try again.',
        }));
        return;
      }

      const jobId = randomUUID();
      jobs.set(jobId, {
        state: 'queued',
        progress: 0,
        message: 'Queued. Waiting for converter slot...',
        result: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: null,
      });

      jobQueue.push({ jobId, body });
      updateQueuedJobs();
      scheduleJobs();

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jobId,
        queuePosition: getQueuePosition(jobId),
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      }));
      return;
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  if (req.method === 'GET' && path.startsWith('/jobs/')) {
    markHeartbeat();
    const jobId = path.split('/').pop();
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(job));
    return;
  }

  if (req.method === 'POST' && path === '/convert') {
    try {
      markHeartbeat();
      const body = await readJsonBody(req);
      if (!body.html || typeof body.html !== 'string') {
        throw new Error('`html` is required.');
      }

      const result = await convertHtmlString(body.html, {
        sourceName: body.sourceName || 'inline.html',
        baseUrl: body.baseUrl || null,
        viewport: {
          width: body.viewport?.width,
          height: body.viewport?.height,
        },
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Morphus server listening on http://${displayHost}:${PORT}`);
});

if (IDLE_SHUTDOWN_MS > 0) {
  const idleTimer = setInterval(checkIdleShutdown, Math.min(Math.max(IDLE_SHUTDOWN_MS / 3, 5000), 30000));
  if (typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

async function runJob(jobId, body) {
  setJob(jobId, 'running', 1, 'Starting conversion...');

  const result = await convertHtmlString(body.html, {
    sourceName: body.sourceName || 'inline.html',
    baseUrl: body.baseUrl || null,
    viewport: {
      width: body.viewport && body.viewport.width,
      height: body.viewport && body.viewport.height,
    },
    onProgress: (progress, message) => {
      setJob(jobId, 'running', progress, message);
    },
  });

  setJob(jobId, 'done', 100, 'Done', result);
}

function scheduleJobs() {
  while (activeJobCount < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const queued = jobQueue.shift();
    if (!queued || !jobs.has(queued.jobId)) {
      continue;
    }

    activeJobCount += 1;
    updateQueuedJobs();

    runJobWithTimeout(queued.jobId, queued.body)
      .catch((error) => {
        setJobError(queued.jobId, error);
      })
      .finally(() => {
        activeJobCount = Math.max(activeJobCount - 1, 0);
        scheduleJobs();
      });
  }
}

function runJobWithTimeout(jobId, body) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Conversion timed out after ${Math.round(JOB_TIMEOUT_MS / 1000)} seconds. The converter may be overloaded.`));
    }, JOB_TIMEOUT_MS);
  });

  return Promise.race([
    runJob(jobId, body),
    timeout,
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function getPendingJobCount() {
  return activeJobCount + jobQueue.length;
}

function getQueuePosition(jobId) {
  for (let index = 0; index < jobQueue.length; index++) {
    if (jobQueue[index].jobId === jobId) {
      return index + 1;
    }
  }
  return null;
}

function updateQueuedJobs() {
  for (let index = 0; index < jobQueue.length; index++) {
    const jobId = jobQueue[index].jobId;
    const job = jobs.get(jobId);
    if (!job || job.state !== 'queued') {
      continue;
    }

    const position = index + 1;
    jobs.set(jobId, {
      ...job,
      progress: 0,
      message: `Queued. Waiting for converter slot (${position}/${jobQueue.length})...`,
      queuePosition: position,
      updatedAt: Date.now(),
    });
  }
}

function setJob(jobId, state, progress, message, result) {
  const existing = jobs.get(jobId) || {};
  if (isLateUpdateAfterTimeout(existing)) {
    return;
  }

  jobs.set(jobId, {
    state: state,
    progress: progress,
    message: message,
    result: result || null,
    error: null,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
    queuePosition: null,
  });
}

function isLateUpdateAfterTimeout(job) {
  return job
    && job.state === 'error'
    && /timeout|timed out/i.test(String(job.error || ''));
}

function setJobError(jobId, error) {
  const existing = jobs.get(jobId) || {};
  jobs.set(jobId, {
    state: 'error',
    progress: 100,
    message: 'Conversion failed',
    result: null,
    error: formatJobError(error),
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
    queuePosition: null,
  });
}

function pruneFinishedJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (!job || (job.state !== 'done' && job.state !== 'error')) {
      continue;
    }
    if (now - (job.updatedAt || now) > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
}

function getHealthPayload() {
  return {
    ok: true,
    host: HOST,
    port: PORT,
    activeJobs: activeJobCount,
    queuedJobs: jobQueue.length,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    localMode: LOCAL_MODE,
    idleShutdownMs: IDLE_SHUTDOWN_MS,
  };
}

function markHeartbeat() {
  lastHeartbeatAt = Date.now();
}

function checkIdleShutdown() {
  if (shutdownStarted || activeJobCount > 0 || jobQueue.length > 0) {
    return;
  }

  if (Date.now() - lastHeartbeatAt >= IDLE_SHUTDOWN_MS) {
    shutdownServer(`idle for ${Math.round(IDLE_SHUTDOWN_MS / 1000)} seconds`);
  }
}

function shutdownServer(reason) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`Morphus server shutting down: ${reason}.`);
  server.close(() => {
    process.exit(0);
  });

  const forceExit = setTimeout(() => process.exit(0), 3000);
  if (typeof forceExit.unref === 'function') {
    forceExit.unref();
  }
}

function renderStatusPage() {
  const payload = getHealthPayload();
  const statusRows = [
    ['Status', payload.activeJobs > 0 ? 'Converting' : 'Idle and ready'],
    ['Host', payload.host],
    ['Port', String(payload.port)],
    ['Active jobs', String(payload.activeJobs)],
    ['Queued jobs', String(payload.queuedJobs)],
    ['Max concurrent jobs', String(payload.maxConcurrentJobs)],
    ['Background mode', payload.idleShutdownMs > 0 ? `Stops after ${Math.round(payload.idleShutdownMs / 1000)}s idle` : 'Stays running until shut down'],
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Morphus Converter</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #f5f5f5; background: #101214; }
    main { max-width: 640px; margin: 44px auto; padding: 0 20px; }
    h1 { font-size: 30px; margin: 0 0 8px; letter-spacing: 0; }
    p { color: #b8c0c8; line-height: 1.5; margin: 0; }
    .hero { display: flex; gap: 18px; align-items: flex-start; padding: 22px; border: 1px solid #263039; background: #171b1f; border-radius: 8px; }
    .status-icon { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: #ffffff; background: #18a058; box-shadow: 0 0 0 6px rgba(24, 160, 88, 0.18); }
    .status-icon svg { width: 28px; height: 28px; }
    .eyebrow { margin: 0 0 4px; color: #6ee7a8; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    table { width: 100%; border-collapse: collapse; margin: 22px 0; background: #171b1f; border: 1px solid #263039; border-radius: 8px; overflow: hidden; }
    td { padding: 12px 14px; border-bottom: 1px solid #263039; }
    tr:last-child td { border-bottom: 0; }
    td:first-child { color: #9ca8b3; width: 44%; }
    .actions { display: flex; align-items: center; gap: 12px; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; color: white; background: #d81722; font-weight: 700; cursor: pointer; }
    .hint { color: #9ca8b3; font-size: 13px; }
    .shutdown-result { color: #6ee7a8; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="status-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <p class="eyebrow">Converter running</p>
        <h1>Morphus Converter is ready</h1>
        <p>You can close this tab. Morphus Converter will stay idle in the background and wake up when the Figma plugin sends a conversion.</p>
      </div>
    </section>
    <table>
      ${statusRows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
    ${LOCAL_MODE ? '<form class="actions" method="post" action="/shutdown"><button type="submit">Shut Down Converter</button><span class="hint">Use this only when you want to fully stop Morphus Converter.</span></form>' : ''}
  </main>
  <script>
    const form = document.querySelector('form.actions');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        const hint = form.querySelector('.hint');
        button.disabled = true;
        button.textContent = 'Shutting down...';
        try {
          await fetch('/shutdown', { method: 'POST' });
          hint.className = 'shutdown-result';
          hint.textContent = 'Morphus Converter stopped. You can close this tab.';
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Shut Down Converter';
          hint.textContent = 'Could not shut down. Please try again.';
        }
      });
    }
  </script>
</body>
</html>`;
}

function formatJobError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/waitForLoadState|timeout|timed out/i.test(message)) {
    return 'Conversion timed out while rendering. The public converter may be busy; please try again in a minute or use a smaller HTML file.';
  }
  return message;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function getPositiveEnvNumber(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
