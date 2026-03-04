#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

function parseArgs(argv) {
  const args = {
    label: 'benchmark',
    output: 'perf/benchmark.json',
    runs: 5,
    port: 4173,
    warmup: 1,
    headless: true,
    browser: 'firefox',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--label' && next) {
      args.label = next;
      i += 1;
    } else if (key === '--output' && next) {
      args.output = next;
      i += 1;
    } else if (key === '--runs' && next) {
      args.runs = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--port' && next) {
      args.port = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--warmup' && next) {
      args.warmup = Number.parseInt(next, 10);
      i += 1;
    } else if (key === '--headed') {
      args.headless = false;
    } else if (key === '--browser' && next) {
      args.browser = next;
      i += 1;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for local server at ${url}`);
}

function startServer(port) {
  const proc = spawn('python3', ['-m', 'http.server', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });

  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});

  return proc;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { mean, median, min, max, samples: values };
}

function selectBrowserType(name) {
  if (name === 'chromium') return chromium;
  if (name === 'webkit') return webkit;
  return firefox;
}

async function measureScenario(page, baseUrl) {
  const navStart = performance.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const el = document.getElementById('total-count');
    return Number(el?.textContent || '0') > 0;
  }, { timeout: 90000 });
  await page.waitForTimeout(400);
  const readyMs = performance.now() - navStart;

  const details = await page.evaluate(async () => {
    const raf2 = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    async function waitForCountChange(beforeValue, timeoutMs = 2500) {
      const target = document.getElementById('visible-count');
      return new Promise((resolve) => {
        let done = false;
        const finish = (changed) => {
          if (done) return;
          done = true;
          observer.disconnect();
          clearTimeout(timer);
          resolve(changed);
        };

        const observer = new MutationObserver(() => {
          const next = Number(target.textContent || '0');
          if (next !== beforeValue) finish(true);
        });

        const timer = window.setTimeout(() => finish(false), timeoutMs);
        observer.observe(target, { childList: true, characterData: true, subtree: true });

        const current = Number(target.textContent || '0');
        if (current !== beforeValue) finish(true);
      });
    }

    async function measureAction(action, timeoutMs = 2500) {
      const visible = document.getElementById('visible-count');
      const before = Number(visible.textContent || '0');
      const start = performance.now();
      action();
      const changed = await waitForCountChange(before, timeoutMs);
      await raf2();
      const after = Number(visible.textContent || '0');
      return {
        before,
        after,
        changed,
        durationMs: performance.now() - start,
      };
    }

    const search = document.getElementById('search');
    const minHeight = document.getElementById('minHeight');
    const clearFilters = document.getElementById('clearFilters');
    const firstFamily = document.querySelector('#familyFilters [data-family]');

    const searchOak = await measureAction(() => {
      search.value = 'oak';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }, 4000);

    clearFilters.click();
    await raf2();

    const familyToggle = await measureAction(() => {
      if (firstFamily) firstFamily.click();
    });

    clearFilters.click();
    await raf2();

    const heightMin20 = await measureAction(() => {
      minHeight.value = '20';
      minHeight.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const clearAll = await measureAction(() => {
      clearFilters.click();
    });

    await raf2();

    return {
      totalTrees: Number(document.getElementById('total-count')?.textContent || '0'),
      finalVisible: Number(document.getElementById('visible-count')?.textContent || '0'),
      domNodeCount: document.getElementsByTagName('*').length,
      heapUsedBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
      actions: {
        searchOak,
        familyToggle,
        heightMin20,
        clearAll,
      },
    };
  });

  return {
    readyMs,
    ...details,
  };
}

async function run() {
  const args = parseArgs(process.argv);
  const server = startServer(args.port);
  const baseUrl = `http://127.0.0.1:${args.port}`;

  try {
    await waitForServer(baseUrl);

    const browserType = selectBrowserType(args.browser);
    const browser = await browserType.launch({
      headless: args.headless,
      args: ['--enable-precise-memory-info'],
    });

    const allRuns = [];

    for (let i = 0; i < args.warmup + args.runs; i += 1) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const result = await measureScenario(page, baseUrl);
      await context.close();

      if (i >= args.warmup) {
        allRuns.push(result);
      }
    }

    await browser.close();

    const readyStats = stats(allRuns.map((r) => r.readyMs));
    const searchStats = stats(allRuns.map((r) => r.actions.searchOak.durationMs));
    const familyStats = stats(allRuns.map((r) => r.actions.familyToggle.durationMs));
    const heightStats = stats(allRuns.map((r) => r.actions.heightMin20.durationMs));
    const clearStats = stats(allRuns.map((r) => r.actions.clearAll.durationMs));
    const domStats = stats(allRuns.map((r) => r.domNodeCount));

    const output = {
      label: args.label,
      dateIso: new Date().toISOString(),
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        runs: args.runs,
        warmup: args.warmup,
        browser: args.browser,
        viewport: { width: 1440, height: 900 },
      },
      summary: {
        readyMs: readyStats,
        searchOakMs: searchStats,
        familyToggleMs: familyStats,
        heightMin20Ms: heightStats,
        clearAllMs: clearStats,
        domNodeCount: domStats,
      },
      runs: allRuns,
    };

    const outputPath = path.resolve(process.cwd(), args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    console.log(`Wrote benchmark to ${outputPath}`);
    console.log(JSON.stringify(output.summary, null, 2));
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
