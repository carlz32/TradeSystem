/**
 * dsh-trading-cockpit — Host half.
 *
 * Owns the execution-manual index, the per-trading-day trade store, the Sina
 * kline cache and the same-origin JSON API consumed by the Client panel. Also
 * registers the agent tools that let a chat turn search rules, draft a trade
 * from a screenshot, and save/list trades.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export const name = 'dsh-trading-cockpit';
export const inject = ['webServer', 'connection', 'tools'];

import {
  ACCOUNT,
  DEFAULT_SYMBOL,
  buildTrade,
  klineForDay,
  parseManual,
  parseSinaJsonp,
  parseTimestamp,
  searchManual,
  sessionState,
  summarizeTrades,
  tradePnl,
  tradingDayOf,
} from './core.js';

const PLUGIN_ID = 'dsh-trading-cockpit';
const API_PREFIX = '/trading-cockpit/api';
const MAX_BODY_BYTES = 1024 * 1024;
const KLINE_TYPES = new Set([3, 5, 15, 30, 60]);
const KLINE_TIMEOUT_MS = 10000;

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function writeJson(res, status, body) {
  if (res.headersSent) {
    res.destroy?.();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  writeJson(res, 200, { ok: true, data });
}

function fail(res, error) {
  if (error instanceof ApiError) {
    writeJson(res, error.status, {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeJson(res, 500, { ok: false, error: { code: 'internal', message, details: null } });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new ApiError(413, 'too-large', '请求体超过 1MB');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad-json', '请求体不是合法 JSON');
  }
}

/**
 * Local equivalent of `defineTool` from @deepseek-ai/dsh-tools.
 *
 * The Host does not expose that package to installed bundles (it is a peer of
 * first-party plugins), so compile the same small author schema subset here:
 * per-property `{ type, description, required?, enum? }` becomes raw JSON
 * Schema at the object root.
 */
function compileObjectSchema(spec, { closed }) {
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(spec ?? {})) {
    const property = { ...value };
    if (property.required === true) {
      required.push(key);
      delete property.required;
    }
    properties[key] = property;
  }
  return {
    type: 'object',
    properties,
    ...(closed ? { additionalProperties: false } : {}),
    ...(required.length > 0 ? { required } : {}),
  };
}

function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: compileObjectSchema(options.parameters, { closed: false }),
    output: {
      schema: {
        ...compileObjectSchema(options.output.schema.properties, { closed: false }),
        additionalProperties: false,
      },
      render: options.output.render,
      ...(options.output.presentationMeta ? { presentationMeta: options.output.presentationMeta } : {}),
    },
    execute: options.execute,
  };
}

function textRender(fn) {
  return (_args, value) => [{ type: 'text', text: fn(value) }];
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function normalizeDay(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, 'bad-day', `日期格式应为 YYYY-MM-DD：${text}`);
  return text;
}

function resolveWorkspace(ctx, config) {
  const candidates = [];
  if (config.workspace) candidates.push(config.workspace);
  const registry = ctx.get('workspaceRegistry');
  if (registry && typeof registry.list === 'function') {
    for (const workspace of registry.list()) {
      if (workspace?.path) candidates.push(workspace.path);
    }
  }
  const workingDirectory = ctx.get('workingDirectory');
  if (workingDirectory) {
    const current = workingDirectory.defaultDirectory;
    if (current) candidates.push(current);
  }
  candidates.push(fileURLToPath(new URL('../../../', import.meta.url)));
  candidates.push(process.cwd());

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    const absolute = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (existsSync(join(absolute, '执行手册.md'))) return absolute;
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return isAbsolute(candidate) ? candidate : resolve(candidate);
  }
  throw new ApiError(500, 'no-workspace', '找不到工作区目录');
}

function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return mkdir(dirname(file), { recursive: true })
    .then(() => writeFile(tmp, text, 'utf8'))
    .then(() => rename(tmp, file));
}

function createFence(ctx) {
  return (req) => {
    const connection = ctx.connection;
    const requestRejection = connection?.requestRejection;
    if (typeof requestRejection === 'function') return requestRejection.call(connection, req) === undefined;
    const admit = connection?.admit;
    if (typeof admit === 'function') {
      const verdict = admit.call(connection, req);
      return !(verdict !== null && typeof verdict === 'object' && 'rejection' in verdict);
    }
    throw new TypeError('connection exposes neither requestRejection nor admit');
  };
}

export function apply(ctx, config = {}) {
  const store = createStore(ctx, config);
  const manual = createManualIndex(store);
  const market = createMarketData(ctx, config, store);
  const fence = createFence(ctx);

  // -------------------------------------------------------------------------
  // HTTP API
  // -------------------------------------------------------------------------
  const route = (req, res) => {
    if (!fence(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden', details: null } });
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const method = pathname.startsWith(`${API_PREFIX}/`) ? pathname.slice(API_PREFIX.length + 1) : '';
    if (method === '' || method.includes('/')) {
      fail(res, new ApiError(404, 'not-found', 'unknown trading cockpit API'));
      return;
    }
    handle(method, req, res).catch((error) => fail(res, error));
  };

  async function handle(method, req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.internal');
    const params = url.searchParams;

    if (req.method === 'GET' && method === 'state') {
      const symbol = String(params.get('symbol') || DEFAULT_SYMBOL).toUpperCase();
      const day = normalizeDay(params.get('day')) ?? tradingDayOf(new Date());
      ok(res, await store.state(day, symbol, manual));
      return;
    }
    if (req.method === 'GET' && method === 'rules') {
      const parsed = await manual.load();
      const query = String(params.get('q') ?? '').trim();
      const limit = clampInt(params.get('limit'), 30, 1, 100);
      if (query === '') {
        ok(res, {
          title: parsed.title,
          lineCount: parsed.lineCount,
          sectionCount: parsed.sections.length,
          outline: parsed.sections
            .filter((section) => section.level <= 2)
            .map((section) => ({ id: section.id, title: section.title, level: section.level, line: section.line })),
        });
        return;
      }
      ok(res, {
        query,
        results: searchManual(parsed, query, limit),
        sectionCount: parsed.sections.length,
      });
      return;
    }
    if (req.method === 'GET' && method === 'rule') {
      const parsed = await manual.load();
      const id = String(params.get('id') ?? '');
      const section = parsed.sections.find((candidate) => candidate.id === id);
      if (!section) throw new ApiError(404, 'no-section', `没有这一节：${id}`);
      ok(res, section);
      return;
    }
    if (req.method === 'GET' && method === 'kline') {
      const symbol = String(params.get('symbol') || DEFAULT_SYMBOL).toUpperCase();
      const type = clampInt(params.get('type'), 3, 1, 60);
      if (!KLINE_TYPES.has(type)) throw new ApiError(400, 'bad-type', 'K 线周期只支持 3/5/15/30/60 分钟');
      const day = normalizeDay(params.get('day')) ?? tradingDayOf(new Date());
      const force = params.get('force') === '1';
      const payload = await market.dayKline(symbol, type, day, force);
      ok(res, payload);
      return;
    }
    if (req.method === 'GET' && method === 'trades') {
      const day = normalizeDay(params.get('day')) ?? tradingDayOf(new Date());
      ok(res, await store.dayTrades(day));
      return;
    }
    if (req.method === 'GET' && method === 'drafts') {
      ok(res, { drafts: await store.listDrafts() });
      return;
    }
    if (req.method === 'DELETE' && method === 'trades') {
      const day = normalizeDay(params.get('day')) ?? tradingDayOf(new Date());
      const id = String(params.get('id') ?? '');
      ok(res, await store.deleteTrade(day, id));
      return;
    }
    if (req.method === 'DELETE' && method === 'drafts') {
      const id = String(params.get('id') ?? '');
      ok(res, await store.deleteDraft(id));
      return;
    }
    if (req.method === 'POST' && method === 'trades') {
      const body = await readJsonBody(req);
      const input = body?.trade && typeof body.trade === 'object' ? body.trade : body;
      const result = await store.saveTrade(input, { draftId: body?.draftId });
      if (result.errors.length > 0) {
        writeJson(res, 422, { ok: false, error: { code: 'invalid-trade', message: result.errors.join('；'), details: result }, data: result });
        return;
      }
      ok(res, result);
      return;
    }
    if (req.method === 'POST' && method === 'drafts') {
      const body = await readJsonBody(req);
      const input = body?.trade && typeof body.trade === 'object' ? body.trade : body;
      const result = await store.saveDraft(input, { warnings: body?.warnings });
      if (result.errors.length > 0) {
        writeJson(res, 422, { ok: false, error: { code: 'invalid-draft', message: result.errors.join('；'), details: result }, data: result });
        return;
      }
      ok(res, result);
      return;
    }
    throw new ApiError(405, 'method', `不支持 ${req.method} ${method}`);
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: `${API_PREFIX}`, handler: route }),
    'trading-cockpit: HTTP API',
  );

  // -------------------------------------------------------------------------
  // Agent tools
  // -------------------------------------------------------------------------
  const parameter = {
    symbol: { type: 'string', description: '合约代码，默认 PP0' },
    direction: { type: 'string', required: true, description: 'long（做多）或 short（做空）' },
    entryPrice: { type: 'number', required: true, description: '入场价' },
    stopPrice: { type: 'number', description: '止损价；截图草稿可留空，确认前补' },
    targetPrice: { type: 'number', description: '目标价，可留空' },
    lots: { type: 'number', required: true, description: '手数' },
    entryTime: { type: 'string', description: '入场时间，ISO 或 YYYY-MM-DD HH:MM，默认现在' },
    exitTime: { type: 'string', description: '离场时间，未平仓留空' },
    exitPrice: { type: 'number', description: '离场价，未平仓留空' },
    multiplier: { type: 'number', description: '合约乘数，默认按品种查表' },
    note: { type: 'string', description: '备注' },
    state15m: { type: 'string', description: '15m 状态：trend / tr / breakout / chaotic' },
    pattern: { type: 'string', description: '形态，如 H1/L1/H2/L2/Pin Bar/TR 反转' },
  };

  const saveLike = (draft) =>
    defineTool({
      name: draft ? 'trading_trade_draft' : 'trading_trade_save',
      description: draft
        ? '把聊天截图识别出的交易先存为草稿，不进入当日交易记录，等待用户在中控台确认。识别不准的字段可以留空后再问用户。'
        : '把一笔已确认的交易写入当天（交易日）的交易记录，并返回当日汇总与告警。结构错误不会写入。',
      parameters: draft
        ? parameter
        : {
            ...parameter,
            stopPrice: { ...parameter.stopPrice, required: true, description: '止损价（正式保存必填）' },
            draftId: { type: 'string', description: '从草稿入账时传草稿 id，保存成功后会删除该草稿' },
            tradingDay: { type: 'string', description: '交易日 YYYY-MM-DD，默认按入场时间推算' },
          },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: textRender((value) => value.text),
      },
      execute: async (args, exec) => {
        exec?.signal?.throwIfAborted?.();
        const input = toolInput(args);
        const result = draft
          ? await store.saveDraft(input)
          : await store.saveTrade(input, { draftId: args.draftId });
        return { text: formatTradeResult(result, draft) };
      },
    });

  const toolInput = (args) => ({
    symbol: args.symbol,
    direction: args.direction,
    entryPrice: args.entryPrice,
    stopPrice: args.stopPrice,
    targetPrice: args.targetPrice ?? null,
    lots: args.lots,
    multiplier: args.multiplier,
    tradingDay: args.tradingDay,
    openedAt: args.entryTime,
    closedAt: args.exitTime,
    exitPrice: args.exitPrice ?? null,
    note: args.note,
    source: args.source,
    extended: { state15m: args.state15m, pattern: args.pattern },
  });

  function formatTradeResult(result, isDraft) {
    if (result.errors.length > 0) {
      return `${isDraft ? '草稿' : '交易'}未保存，结构错误：\n- ${result.errors.join('\n- ')}`;
    }
    const lines = [];
    if (isDraft) {
      lines.push(`草稿已保存：${result.draft.id}（当日文件 ${result.draft.trade.tradingDay}）`);
      lines.push('请在「交易中控台」的当日记录里确认后再入账。');
    } else {
      lines.push(`已写入交易 ${result.trade.id}：${result.trade.symbol} ${result.trade.direction === 'long' ? '多' : '空'} ${result.trade.lots} 手 @ ${result.trade.entryPrice}，止损 ${result.trade.stopPrice}`);
    }
    if (result.warnings.length > 0) lines.push('', '告警（不拦截保存）：', ...result.warnings.map((warning) => `- ${warning}`));
    if (result.summary) {
      lines.push('', `当日：${result.summary.closedCount} 笔已平，盈亏 ¥${result.summary.dailyPnl}，连亏 ${result.summary.consecutiveLosses}，连赢 ${result.summary.consecutiveWins}`);
      if (result.summary.guards.length > 0) lines.push(...result.summary.guards.map((guard) => `- ${guard}`));
    }
    return lines.join('\n');
  }

  const ruleTool = defineTool({
    name: 'trading_rule_search',
    description: '在《执行手册》里按关键词检索执行规则，返回章节、行号和原文片段。用于回答“手数怎么算”“TR 边界是什么”这类问题。',
    parameters: {
      query: { type: 'string', required: true, description: '检索词，可空格分隔多个词' },
      limit: { type: 'number', description: '最多返回条数，默认 8' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: textRender((value) => value.text),
    },
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const parsed = await manual.load();
      const results = searchManual(parsed, args.query, clampInt(args.limit, 8, 1, 30));
      if (results.length === 0) return { text: `没有找到「${args.query}」。` };
      const text = results
        .map((result) => `## ${result.title}（第 ${result.line} 行）\n${result.snippet}`)
        .join('\n\n');
      return { text };
    },
  });

  const sectionTool = defineTool({
    name: 'trading_manual_section',
    description: '按规则检索结果里的 section id 读取《执行手册》某一节的完整原文。',
    parameters: { id: { type: 'string', required: true, description: '如 sec-42' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: textRender((value) => value.text),
    },
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const parsed = await manual.load();
      const section = parsed.sections.find((candidate) => candidate.id === args.id);
      if (!section) return { text: `没有这一节：${args.id}` };
      return { text: `${section.title}（第 ${section.line}-${section.endLine} 行）\n\n${section.body}` };
    },
  });

  const listTool = defineTool({
    name: 'trading_trade_list',
    description: '列出某个交易日的交易记录与汇总（盈亏、连亏连赢、日亏剩余额度）。',
    parameters: { day: { type: 'string', description: '交易日 YYYY-MM-DD，默认当前交易日' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: textRender((value) => value.text),
    },
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const day = normalizeDay(args.day) ?? tradingDayOf(new Date());
      const data = await store.dayTrades(day);
      if (data.trades.length === 0) return { text: `${day} 还没有交易记录。` };
      const rows = data.trades.map((trade) => {
        const pnl = trade.exitPrice === null ? '持仓中' : `¥${trade.pnl}`;
        return `- ${trade.id} ${trade.symbol} ${trade.direction === 'long' ? '多' : '空'} ${trade.lots} 手 @${trade.entryPrice} 止损 ${trade.stopPrice} ${pnl}`;
      });
      const summary = data.summary;
      const guards = summary.guards?.length ? summary.guards.join('；') : '无';
      return {
        text: `${day}：\n${rows.join('\n')}\n\n汇总：已平 ${summary.closedCount} 笔，持仓 ${summary.openCount}，盈亏 ¥${summary.dailyPnl}，胜率 ${summary.winRate}%，连亏 ${summary.consecutiveLosses}，连赢 ${summary.consecutiveWins}，日亏剩余 ¥${summary.dailyLossRemaining}\n风控闸门：${guards}`,
      };
    },
  });

  const klineTool = defineTool({
    name: 'trading_kline',
    description: '读取某个交易日的中控台 K 线（默认 3 分钟，可切 15 分钟），返回窗口、ATR14、EMA20 和最近几根。数据按交易时段缓存，不实时轮询。',
    parameters: {
      symbol: { type: 'string', description: '合约代码，默认 PP0' },
      type: { type: 'number', description: '3 或 15，默认 3' },
      day: { type: 'string', description: '交易日 YYYY-MM-DD，默认当前交易日' },
      force: { type: 'boolean', description: '忽略缓存强制刷新' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: textRender((value) => value.text),
    },
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const symbol = String(args.symbol || DEFAULT_SYMBOL).toUpperCase();
      const type = Number(args.type) === 15 ? 15 : 3;
      const day = normalizeDay(args.day) ?? tradingDayOf(new Date());
      const payload = await market.dayKline(symbol, type, day, args.force === true);
      const bars = payload.bars.slice(-10).map((bar) => `${bar.time} O${bar.open} H${bar.high} L${bar.low} C${bar.close}`);
      return {
        text: `${symbol} ${type}m ${day}\n窗口：${payload.window.start} → ${payload.window.end}\n共 ${payload.bars.length} 根，ATR14=${payload.atr14 ?? '—'}，EMA20=${payload.ema20Last ?? '—'}\n最近：\n${bars.join('\n')}`,
      };
    },
  });

  const statusTool = defineTool({
    name: 'trading_day_status',
    description: '返回当前交易时段状态、当日盈亏/连亏连赢/日亏剩余额度与风控闸门。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: textRender((value) => value.text),
    },
    execute: async (_args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const day = tradingDayOf(new Date());
      const data = await store.state(day, DEFAULT_SYMBOL, manual);
      const summary = data.summary;
      const guards = summary.guards.length > 0 ? summary.guards.join('；') : '无';
      return {
        text: `交易日 ${day}\n时段：${summary.session.phase}（${summary.session.open ? '开市' : '休市'}，${summary.session.canOpen ? '可开仓' : summary.session.reason}）\n已平 ${summary.closedCount} 笔，盈亏 ¥${summary.dailyPnl}，胜率 ${summary.winRate}%，连亏 ${summary.consecutiveLosses}，连赢 ${summary.consecutiveWins}\n日亏剩余额度 ¥${summary.dailyLossRemaining}\n风控闸门：${guards}`,
      };
    },
  });

  for (const tool of [ruleTool, sectionTool, saveLike(false), saveLike(true), listTool, klineTool, statusTool]) {
    ctx.effect(() => ctx.tools.register(tool), `trading-cockpit: tool ${tool.name}`);
  }

  ctx.logger?.info?.(`[${PLUGIN_ID}] ready at ${store.root}`);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
function createStore(ctx, config) {
  const root = resolveWorkspace(ctx, config);
  const dataDir = join(root, 'notes', 'TradeLog', 'cockpit');
  const locks = new Map();

  const withLock = (key, operation) => {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    locks.set(key, next.catch(() => {}));
    return next;
  };

  const dayFile = (day) => join(dataDir, `${day}.json`);
  const draftsFile = () => join(dataDir, 'drafts.json');

  const readDayFile = async (day) => {
    try {
      const raw = await readFile(dayFile(day), 'utf8');
      const parsed = JSON.parse(raw);
      const trades = Array.isArray(parsed?.trades) ? parsed.trades : [];
      return { version: 1, day, updatedAt: parsed?.updatedAt ?? null, trades };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, day, updatedAt: null, trades: [] };
      throw new ApiError(500, 'store-read', `读取 ${day}.json 失败：${error.message}`);
    }
  };

  const writeDayFile = (day, doc) =>
    atomicWrite(dayFile(day), { ...doc, version: 1, day, updatedAt: new Date().toISOString() });

  const readDrafts = async () => {
    try {
      const raw = await readFile(draftsFile(), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new ApiError(500, 'drafts-read', `读取 drafts.json 失败：${error.message}`);
    }
  };

  const writeDrafts = (drafts) => atomicWrite(draftsFile(), { version: 1, updatedAt: new Date().toISOString(), drafts });

  const decorate = (trades) => {
    const summary = summarizeTrades(trades, { now: new Date() });
    return {
      trades: trades.map((trade) => ({
        ...trade,
        pnl: trade.exitPrice === null || trade.exitPrice === undefined ? null : tradePnl(trade),
      })),
      summary,
    };
  };

  return {
    root,
    dataDir,
    dayTrades: async (day) => {
      const doc = await readDayFile(day);
      return { day, ...decorate(doc.trades) };
    },
    state: async (day, symbol, manual) => {
      const doc = await readDayFile(day);
      const parsed = await manual.load();
      const drafts = (await readDrafts()).filter((draft) => draft?.trade?.tradingDay === day);
      return {
        day,
        symbol,
        tradingDay: day,
        session: sessionState(new Date()),
        manual: { title: parsed.title, lineCount: parsed.lineCount, sectionCount: parsed.sections.length },
        ...decorate(doc.trades),
        drafts,
        account: ACCOUNT,
      };
    },
    saveTrade: async (input, { draftId } = {}) =>
      withLock('trades', async () => {
        const now = new Date();
        let openedAt = now;
        try {
          openedAt = parseTimestamp(input?.openedAt ?? input?.entryTime ?? now, now);
        } catch {
          openedAt = now;
        }
        const explicitDay = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.tradingDay ?? '')) ? String(input.tradingDay) : null;
        const day = explicitDay ?? tradingDayOf(openedAt);
        const doc = await readDayFile(day);
        const { trade, errors, warnings } = buildTrade(input, { now, existing: doc.trades });
        if (errors.length > 0) return { errors, warnings, trade: null, summary: null };
        const id = trade.id || `t-${randomUUID().slice(0, 8)}`;
        const stored = { ...trade, id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
        const index = doc.trades.findIndex((candidate) => candidate.id === id);
        if (index >= 0) doc.trades[index] = { ...doc.trades[index], ...stored };
        else doc.trades.push(stored);
        await writeDayFile(day, doc);
        if (draftId) {
          const drafts = (await readDrafts()).filter((draft) => draft.id !== draftId);
          await writeDrafts(drafts);
        }
        const decorated = decorate(doc.trades);
        return { errors: [], warnings, trade: stored, summary: decorated.summary, day };
      }),
    deleteTrade: async (day, id) =>
      withLock('trades', async () => {
        const doc = await readDayFile(day);
        const before = doc.trades.length;
        doc.trades = doc.trades.filter((trade) => trade.id !== id);
        if (doc.trades.length === before) throw new ApiError(404, 'no-trade', `没有这笔交易：${id}`);
        await writeDayFile(day, doc);
        return { day, deleted: id, ...decorate(doc.trades) };
      }),
    saveDraft: async (input, { warnings: extraWarnings } = {}) =>
      withLock('drafts', async () => {
        const now = new Date();
        const { trade, errors, warnings } = buildTrade(input, { now, existing: [], requireStop: false });
        if (errors.length > 0) return { errors, warnings, draft: null };
        const draft = {
          id: `d-${randomUUID().slice(0, 8)}`,
          createdAt: now.toISOString(),
          source: 'screenshot',
          trade,
          warnings: [...warnings, ...(Array.isArray(extraWarnings) ? extraWarnings.map(String) : [])],
        };
        const drafts = await readDrafts();
        drafts.push(draft);
        await writeDrafts(drafts);
        return { errors: [], warnings: draft.warnings, draft };
      }),
    listDrafts: () => readDrafts(),
    deleteDraft: async (id) =>
      withLock('drafts', async () => {
        const drafts = await readDrafts();
        const filtered = drafts.filter((draft) => draft.id !== id);
        if (filtered.length === drafts.length) throw new ApiError(404, 'no-draft', `没有这份草稿：${id}`);
        await writeDrafts(filtered);
        return { deleted: id };
      }),
  };
}

// ---------------------------------------------------------------------------
// Manual index
// ---------------------------------------------------------------------------
function createManualIndex(store) {
  let cache = { mtimeMs: 0, size: 0, parsed: null };
  return {
    load: async () => {
      const path = join(store.root, '执行手册.md');
      const info = await stat(path);
      if (cache.parsed && cache.mtimeMs === info.mtimeMs && cache.size === info.size) return cache.parsed;
      const text = await readFile(path, 'utf8');
      cache = { mtimeMs: info.mtimeMs, size: info.size, parsed: parseManual(text) };
      return cache.parsed;
    },
    path: () => join(store.root, '执行手册.md'),
  };
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------
function createMarketData(ctx, config, store) {
  const cache = new Map();
  return {
    dayKline: async (symbol, type, day, force) => {
      const key = `${symbol}:${type}`;
      const hit = cache.get(key);
      const now = Date.now();
      const fresh = hit && !force && !shouldRefresh(hit.fetchedAt, now);
      if (!fresh) {
        const url = sinaUrl(symbol, type);
        let text;
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(config.requestTimeoutMs ?? KLINE_TIMEOUT_MS),
            headers: {
              'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
              referer: 'https://finance.sina.com.cn/',
            },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          text = await response.text();
        } catch (error) {
          if (hit) {
            ctx.logger?.warn?.(`[${PLUGIN_ID}] kline refresh failed, serving cache: ${error.message}`);
            return buildKline(store, hit, day, true, error.message);
          }
          throw new ApiError(502, 'kline-fetch', `抓取新浪行情失败：${error.message}`);
        }
        let bars;
        try {
          bars = parseSinaJsonp(text);
        } catch (error) {
          throw new ApiError(502, 'kline-parse', error.message);
        }
        cache.set(key, { bars, fetchedAt: now, symbol, type });
        return buildKline(store, cache.get(key), day, false, null);
      }
      return buildKline(store, hit, day, true, null);
    },
    clear: () => cache.clear(),
  };
}

function shouldRefresh(fetchedAt, now) {
  const parts = new Date(now + 8 * 3600 * 1000);
  const minutes = parts.getUTCHours() * 60 + parts.getUTCMinutes();
  const candidates = [615, 690, 900, 1380].filter((minute) => minute <= minutes);
  const lastEnd = candidates.length > 0 ? candidates[candidates.length - 1] : 0;
  const dayStart = Date.UTC(parts.getUTCFullYear(), parts.getUTCMonth(), parts.getUTCDate());
  const lastEndMs = dayStart - 8 * 3600 * 1000 + lastEnd * 60000;
  return now - fetchedAt > 5 * 60 * 1000 || fetchedAt < lastEndMs;
}

function buildKline(store, entry, day, cached, warning) {
  const payload = klineForDay(entry.bars, day, { includePartial: false, now: Date.now() });
  return {
    ...payload,
    symbol: entry.symbol,
    type: entry.type,
    day,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    cached,
    warning,
  };
}

function sinaUrl(symbol, type) {
  const safe = encodeURIComponent(symbol);
  return `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${safe}=/InnerFuturesNewService.getFewMinLine?symbol=${safe}&type=${type}`;
}
