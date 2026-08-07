#!/usr/bin/env node
/**
 * generate-wireframes.mjs
 *
 * docs/wireframes/{S-xxx|A-xxx}-{slug}/prompt.md をパースして、
 * 画像生成 API を呼びワイヤーフレーム画像 (*.png) を生成する。
 *
 * 依存ゼロ (Node.js 18+ の標準機能のみ)。npm install 不要。
 *
 * パース契約 (.claude/agents/designer.md と対で維持すること):
 *   - `## 共通プロンプト` セクションの最初のコードブロック = 全画像に前置される共通プロンプト
 *   - `## {name}.png プロンプト` セクションの最初のコードブロック = その画像固有のプロンプト
 *   - API へ送る本文 = 共通プロンプト + "\n\n---\n\n" + バリアントのプロンプト
 *   - `mobile` のみ縦長、それ以外は横長
 *
 * 使い方:
 *   node scripts/generate-wireframes.mjs --dry-run
 *   node scripts/generate-wireframes.mjs
 *   node scripts/generate-wireframes.mjs --screen S-001
 *   node scripts/generate-wireframes.mjs --force
 *   node scripts/generate-wireframes.mjs --concurrency 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_WIREFRAME_DIR = path.join(PROJECT_ROOT, 'docs', 'wireframes');

const CONCURRENCY_DEFAULT = 3;
const CONCURRENCY_MAX = 16;

// ---------------------------------------------------------------------------
// .env ローダ (依存を足さないための最小実装)
// ---------------------------------------------------------------------------

/**
 * .env / .env.local を読み、process.env に無いキーだけを補う。
 * すでにシェルで設定されている環境変数を上書きしない。
 */
function loadDotEnv() {
  // 後に読むファイルほど優先度が低い (先勝ち)
  for (const name of ['.env.local', '.env']) {
    const file = path.join(PROJECT_ROOT, name);
    if (!fs.existsSync(file)) continue;

    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      let value = line.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// 引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    force: false,
    screens: [],
    variants: [],
    concurrency: CONCURRENCY_DEFAULT,
    retries: 2,
    dir: DEFAULT_WIREFRAME_DIR,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} には値が必要です`);
      return v;
    };

    switch (arg) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--screen':
        opts.screens.push(next());
        break;
      case '--variant':
        opts.variants.push(next());
        break;
      case '--concurrency':
        opts.concurrency = Number(next());
        break;
      case '--retries':
        opts.retries = Number(next());
        break;
      case '--dir':
        opts.dir = path.resolve(PROJECT_ROOT, next());
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        fail(`不明な引数: ${arg}  (--help で使い方を表示)`);
    }
  }

  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    fail('--concurrency は 1 以上の整数で指定してください');
  }
  if (opts.concurrency > CONCURRENCY_MAX) {
    fail(`--concurrency の上限は ${CONCURRENCY_MAX} です`);
  }
  if (!Number.isInteger(opts.retries) || opts.retries < 0) {
    fail('--retries は 0 以上の整数で指定してください');
  }

  return opts;
}

const HELP = `
generate-wireframes.mjs — docs/wireframes/*/prompt.md からワイヤーフレーム画像を生成する

  node scripts/generate-wireframes.mjs [options]

Options:
  --dry-run           API を呼ばず、生成対象の一覧とプロンプト長だけを表示する
  --screen <ID>       特定画面のみ対象にする (例: --screen S-001)。複数指定可
  --variant <name>    特定バリアントのみ対象にする (例: --variant mobile)。複数指定可
  --force             既存の画像も再生成する (課金が発生する。理由を確認してから使うこと)
  --concurrency <N>   同時生成数。既定 ${CONCURRENCY_DEFAULT}、上限 ${CONCURRENCY_MAX}
  --retries <N>       429 / 5xx 時のリトライ回数。既定 2
  --dir <path>        ワイヤーフレームのルートディレクトリ (既定: docs/wireframes)
  -h, --help          このヘルプ

環境変数 (.env / .env.local から自動読み込み。.env.example を参照):
  WIREFRAME_IMAGE_PROVIDER      openai | gemini              (既定: openai)
  WIREFRAME_IMAGE_MODEL         モデル名                      (必須。スクリプトにハードコードしない)
  WIREFRAME_IMAGE_QUALITY       画質                          (任意。provider が対応する場合のみ送信)
  WIREFRAME_IMAGE_SIZE_LANDSCAPE 横長サイズ                   (既定: 1536x1024)
  WIREFRAME_IMAGE_SIZE_PORTRAIT  縦長サイズ                   (既定: 1024x1536)
  WIREFRAME_API_BASE_URL        API ベース URL の上書き        (任意)
  OPENAI_API_KEY / GEMINI_API_KEY  provider に対応する API キー
`.trim();

// ---------------------------------------------------------------------------
// prompt.md のパース
// ---------------------------------------------------------------------------

const SHARED_HEADING = '共通プロンプト';
const VARIANT_HEADING_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\.png\s*プロンプト/;

/**
 * Markdown を H2 セクションに分割する。
 * @returns {{ heading: string, lines: string[] }[]}
 */
function splitH2Sections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;
  let insideFence = null; // フェンス内の "## " を見出しと誤認しないため

  for (const line of lines) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (insideFence === null) {
        insideFence = marker;
      } else if (marker[0] === insideFence[0] && marker.length >= insideFence.length) {
        insideFence = null;
      }
    }

    const h2 = insideFence === null ? line.match(/^##\s+(.*?)\s*$/) : null;
    if (h2) {
      current = { heading: h2[1], lines: [] };
      sections.push(current);
      continue;
    }

    if (current) current.lines.push(line);
  }

  return sections;
}

/**
 * セクション内の最初のコードブロックの中身を返す。無ければ null。
 */
function firstCodeBlock(sectionLines) {
  let fenceMarker = null;
  const body = [];

  for (const line of sectionLines) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);

    if (fenceMarker === null) {
      if (fence) fenceMarker = fence[1];
      continue;
    }

    if (fence && fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length) {
      return body.join('\n').trim();
    }

    body.push(line);
  }

  // 閉じフェンスが無い = 壊れた prompt.md
  return fenceMarker === null ? null : body.join('\n').trim();
}

/**
 * 1 つの prompt.md をパースして生成ジョブの配列にする。
 */
function parsePromptFile(promptPath) {
  const markdown = fs.readFileSync(promptPath, 'utf8');
  const sections = splitH2Sections(markdown);
  const dir = path.dirname(promptPath);
  const screenDir = path.basename(dir);

  const sharedSections = sections.filter((s) => s.heading.startsWith(SHARED_HEADING));
  if (sharedSections.length === 0) {
    throw new Error(`\`## ${SHARED_HEADING}\` セクションがありません: ${promptPath}`);
  }
  if (sharedSections.length > 1) {
    throw new Error(
      `\`## ${SHARED_HEADING}\` セクションが ${sharedSections.length} 個あります (1 つだけにしてください): ${promptPath}`,
    );
  }

  const shared = firstCodeBlock(sharedSections[0].lines);
  if (!shared) {
    throw new Error(`\`## ${SHARED_HEADING}\` にコードブロックがありません: ${promptPath}`);
  }

  const jobs = [];
  const seen = new Set();

  for (const section of sections) {
    const m = section.heading.match(VARIANT_HEADING_RE);
    if (!m) continue;

    const variant = m[1];
    if (seen.has(variant)) {
      throw new Error(`バリアント "${variant}" のセクションが重複しています: ${promptPath}`);
    }
    seen.add(variant);

    const body = firstCodeBlock(section.lines);
    if (!body) {
      throw new Error(
        `\`## ${variant}.png プロンプト\` にコードブロックがありません: ${promptPath}`,
      );
    }

    jobs.push({
      screenDir,
      screenId: screenDir.split('-').slice(0, 2).join('-'),
      variant,
      promptPath,
      outputPath: path.join(dir, `${variant}.png`),
      prompt: `${shared}\n\n---\n\n${body}`,
      // designer.md の契約: mobile のみ縦長、それ以外は横長
      orientation: variant === 'mobile' ? 'portrait' : 'landscape',
    });
  }

  return jobs;
}

function collectJobs(rootDir, opts) {
  if (!fs.existsSync(rootDir)) {
    fail(`ワイヤーフレームディレクトリがありません: ${rootDir}\n  designer エージェントで prompt.md を作成してから実行してください。`);
  }

  const promptFiles = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(rootDir, e.name, 'prompt.md'))
    .filter((p) => fs.existsSync(p))
    .sort();

  if (promptFiles.length === 0) {
    fail(`${rootDir} に prompt.md が 1 つもありません。`);
  }

  let jobs = [];
  const parseErrors = [];

  for (const file of promptFiles) {
    try {
      jobs.push(...parsePromptFile(file));
    } catch (err) {
      parseErrors.push(err.message);
    }
  }

  if (parseErrors.length > 0) {
    for (const message of parseErrors) console.error(`パースエラー: ${message}`);
    console.error('');
  }

  if (opts.screens.length > 0) {
    const wanted = opts.screens.map((s) => s.toUpperCase());
    jobs = jobs.filter((j) => {
      const dirUpper = j.screenDir.toUpperCase();
      return wanted.some((w) => dirUpper === w || dirUpper.startsWith(`${w}-`));
    });
  }

  if (opts.variants.length > 0) {
    jobs = jobs.filter((j) => opts.variants.includes(j.variant));
  }

  return { jobs, parseErrorCount: parseErrors.length };
}

// ---------------------------------------------------------------------------
// 画像生成 API
// ---------------------------------------------------------------------------

function resolveProviderConfig() {
  const provider = (process.env.WIREFRAME_IMAGE_PROVIDER || 'openai').toLowerCase();
  const model = process.env.WIREFRAME_IMAGE_MODEL;

  if (!model) {
    fail(
      'WIREFRAME_IMAGE_MODEL が未設定です。\n' +
        '  .env に使用するモデル名を設定してください (.env.example 参照)。\n' +
        '  🔴 モデル名はスクリプトにハードコードしません。モデルは更新されるため、環境変数で指定します。',
    );
  }

  const sizes = {
    landscape: process.env.WIREFRAME_IMAGE_SIZE_LANDSCAPE || '1536x1024',
    portrait: process.env.WIREFRAME_IMAGE_SIZE_PORTRAIT || '1024x1536',
  };
  const quality = process.env.WIREFRAME_IMAGE_QUALITY || null;

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      fail('OPENAI_API_KEY が未設定です。.env に設定してください (.env.example 参照)。');
    }
    const baseUrl = process.env.WIREFRAME_API_BASE_URL || 'https://api.openai.com/v1';
    return { provider, model, sizes, quality, apiKey, baseUrl };
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      fail('GEMINI_API_KEY が未設定です。.env に設定してください (.env.example 参照)。');
    }
    const baseUrl =
      process.env.WIREFRAME_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    return { provider, model, sizes, quality, apiKey, baseUrl };
  }

  fail(`WIREFRAME_IMAGE_PROVIDER が不正です: "${provider}" (openai | gemini)`);
}

/** @returns {Promise<Buffer>} PNG バイト列 */
async function requestImage(job, cfg) {
  const size = cfg.sizes[job.orientation];

  if (cfg.provider === 'openai') {
    const body = { model: cfg.model, prompt: job.prompt, size, n: 1 };
    if (cfg.quality) body.quality = cfg.quality;

    const res = await fetch(`${cfg.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await httpError(res);

    const json = await res.json();
    const item = json?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) {
      const img = await fetch(item.url);
      if (!img.ok) throw await httpError(img);
      return Buffer.from(await img.arrayBuffer());
    }
    throw new Error('応答に画像データが含まれていません');
  }

  // gemini
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${job.prompt}\n\nAspect ratio: ${job.orientation === 'portrait' ? '9:16 (portrait)' : '16:9 (landscape)'}.` }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };

  const res = await fetch(`${cfg.baseUrl}/models/${cfg.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await httpError(res);

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = inline?.inlineData?.data ?? inline?.inline_data?.data;
  if (!data) throw new Error('応答に画像データが含まれていません');
  return Buffer.from(data, 'base64');
}

async function httpError(res) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    /* 応答本文が読めないケースは無視する */
  }
  const err = new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  err.status = res.status;
  return err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateWithRetry(job, cfg, retries) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const png = await requestImage(job, cfg);
      fs.writeFileSync(job.outputPath, png);
      return { ok: true, job, bytes: png.length, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      const retriable = err.status === 429 || (err.status >= 500 && err.status < 600);
      if (!retriable || attempt === retries) break;

      const waitMs = 2000 * 2 ** attempt;
      console.log(
        `  retry  ${job.screenDir}/${job.variant}.png — ${err.message.split('\n')[0]} (${waitMs / 1000}s 後に再試行)`,
      );
      await sleep(waitMs);
    }
  }

  return { ok: false, job, error: lastError };
}

/** 同時実行数を制限してジョブを流す。 */
async function runPool(jobs, limit, worker) {
  const results = new Array(jobs.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      results[index] = await worker(jobs[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  loadDotEnv();

  const { jobs: allJobs, parseErrorCount } = collectJobs(opts.dir, opts);

  const skipped = opts.force ? [] : allJobs.filter((j) => fs.existsSync(j.outputPath));
  const targets = opts.force ? allJobs : allJobs.filter((j) => !fs.existsSync(j.outputPath));

  console.log(`ワイヤーフレームディレクトリ: ${opts.dir}`);
  console.log(`対象バリアント: ${allJobs.length} 件 (生成: ${targets.length} / 既存スキップ: ${skipped.length})`);
  if (parseErrorCount > 0) {
    console.log(`🔴 パースエラー: ${parseErrorCount} 件 (上記参照。該当画面は対象外)`);
  }
  console.log('');

  if (opts.dryRun) {
    for (const job of allJobs) {
      const state = fs.existsSync(job.outputPath) ? (opts.force ? 'REGEN ' : 'SKIP  ') : 'GEN   ';
      console.log(
        `${state} ${job.screenDir}/${job.variant}.png  [${job.orientation}]  prompt ${job.prompt.length} chars`,
      );
    }
    console.log('');
    console.log('--dry-run のため API は呼び出していません。');
    if (parseErrorCount > 0) process.exit(1);
    return;
  }

  if (targets.length === 0) {
    console.log('生成対象がありません。既存画像を作り直す場合は --force を付けてください。');
    if (parseErrorCount > 0) process.exit(1);
    return;
  }

  const cfg = resolveProviderConfig();
  console.log(`provider=${cfg.provider} model=${cfg.model}${cfg.quality ? ` quality=${cfg.quality}` : ''} concurrency=${opts.concurrency}`);
  console.log('');

  const started = process.hrtime.bigint();
  let done = 0;

  const results = await runPool(targets, opts.concurrency, async (job) => {
    const result = await generateWithRetry(job, cfg, opts.retries);
    done++;
    const tag = `[${String(done).padStart(String(targets.length).length)}/${targets.length}]`;
    if (result.ok) {
      console.log(`${tag} OK    ${job.screenDir}/${job.variant}.png  (${Math.round(result.bytes / 1024)} KB)`);
    } else {
      console.log(`${tag} FAIL  ${job.screenDir}/${job.variant}.png  — ${result.error.message.split('\n')[0]}`);
    }
    return result;
  });

  const elapsedSec = Number(process.hrtime.bigint() - started) / 1e9;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log('');
  console.log(`完了: 成功 ${ok.length} / 失敗 ${failed.length}  (${elapsedSec.toFixed(1)}s)`);

  if (failed.length > 0) {
    console.log('');
    console.log('失敗した画像:');
    for (const r of failed) {
      console.log(`  - ${r.job.screenDir}/${r.job.variant}.png — ${r.error.message.split('\n')[0]}`);
    }
    console.log('');
    console.log('HTTP 429 の失敗は課金されません。--concurrency を下げて再実行してください。');
    console.log('(未生成のものだけが対象になるため --force は不要です)');
  }

  if (failed.length > 0 || parseErrorCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
