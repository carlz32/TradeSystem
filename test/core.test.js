import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ACCOUNT,
  addDays,
  atr,
  buildTrade,
  ema,
  klineForDay,
  klineWindow,
  lastSessionEnd,
  multiplierFor,
  nextBusinessDay,
  nextSessionEnd,
  parseManual,
  parseSinaJsonp,
  previousBusinessDay,
  searchManual,
  sessionState,
  shouldRefreshKline,
  summarizeTrades,
  todayInShanghai,
  tradePnl,
  tradingDayOf,
} from '../lib/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const manualPath = join(here, '..', '..', '..', '执行手册.md');

test('account constants match the manual', () => {
  assert.equal(ACCOUNT.maxTradeRisk, 600);
  assert.equal(ACCOUNT.maxTradeRisk, 600);
  assert.equal(ACCOUNT.maxDailyLoss, 1200);
  assert.equal(ACCOUNT.marginCap, 8000);
  assert.equal(multiplierFor('PP0'), 5);
  assert.equal(multiplierFor('MA0'), 10);
});

test('business day helpers skip weekends', () => {
  assert.equal(nextBusinessDay('2026-11-27'), '2026-11-30');
  assert.equal(previousBusinessDay('2026-11-30'), '2026-11-27');
  assert.equal(addDays('2026-11-30', -3), '2026-11-27');
});

test('night session belongs to the next trading day', () => {
  assert.equal(tradingDayOf(new Date('2026-11-25T09:30:00+08:00')), '2026-11-25');
  assert.equal(tradingDayOf(new Date('2026-11-25T21:30:00+08:00')), '2026-11-26');
  assert.equal(tradingDayOf(new Date('2026-11-26T00:30:00+08:00')), '2026-11-26');
  assert.equal(tradingDayOf(new Date('2026-11-27T21:30:00+08:00')), '2026-11-30');
  assert.equal(tradingDayOf(new Date('2026-11-28T10:00:00+08:00')), '2026-11-30');
});

test('kline window spans the previous night to the day close', () => {
  const window = klineWindow('2026-11-26');
  assert.equal(window.start, '2026-11-25T21:00:00+08:00');
  assert.equal(window.end, '2026-11-26T15:00:00+08:00');
  assert.equal(window.previousTradingDay, '2026-11-25');
});

test('session state marks open sessions and the no-new-entry windows', () => {
  const at = (iso) => sessionState(new Date(iso));
  assert.equal(at('2026-11-25T09:10:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T09:20:00+08:00').canOpen, true);
  assert.equal(at('2026-11-25T10:20:00+08:00').open, false);
  assert.equal(at('2026-11-25T10:31:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T10:35:00+08:00').canOpen, true);
  assert.equal(at('2026-11-25T11:26:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T13:35:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T13:40:00+08:00').canOpen, true);
  assert.equal(at('2026-11-25T14:46:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T15:05:00+08:00').open, false);
  assert.equal(at('2026-11-25T20:09:00+08:00').phase, '日盘收盘');
  assert.equal(at('2026-11-25T23:30:00+08:00').phase, '夜盘收盘');
  assert.equal(at('2026-11-25T08:00:00+08:00').phase, '盘前');
  assert.equal(at('2026-11-25T21:05:00+08:00').canOpen, false);
  assert.equal(at('2026-11-25T21:20:00+08:00').canOpen, true);
  assert.equal(at('2026-11-25T22:46:00+08:00').canOpen, false);
  assert.equal(at('2026-11-28T10:00:00+08:00').open, false);
});

test('session boundaries and cache invalidation', () => {
  const now = new Date('2026-11-25T10:20:00+08:00');
  assert.equal(lastSessionEnd(now), Date.parse('2026-11-25T10:15:00+08:00'));
  assert.equal(nextSessionEnd(now), Date.parse('2026-11-25T11:30:00+08:00'));
  assert.equal(shouldRefreshKline(Date.parse('2026-11-25T10:16:00+08:00'), now.getTime()), false);
  assert.equal(shouldRefreshKline(Date.parse('2026-11-25T10:10:00+08:00'), now.getTime()), true);
  assert.equal(shouldRefreshKline(Date.parse('2026-11-25T10:16:00+08:00'), Date.parse('2026-11-25T10:18:00+08:00')), false);
});

test('manual parser keeps headings, line numbers and breadcrumbs', () => {
  const text = [
    '# 1 总则',
    '',
    '## 1.1 账户',
    '账户 3 万。',
    '',
    '### 1.1.1 手数',
    '手数公式。',
    '',
    '## 1.2 时段',
    '9:00 开盘。',
  ].join('\n');
  const parsed = parseManual(text);
  assert.equal(parsed.sections.length, 4);
  const manual = parsed.sections.find((section) => section.title === '1.1.1 手数');
  assert.equal(manual.line, 6);
  assert.equal(manual.chapter, '1.1.1');
  assert.deepEqual(manual.path, ['1 总则', '1.1 账户', '1.1.1 手数']);
  assert.ok(manual.body.includes('手数公式'));
});

test('real manual search finds the lot-size and TR sections', () => {
  const parsed = parseManual(readFileSync(manualPath, 'utf8'));
  assert.ok(parsed.sections.length > 50);
  assert.ok(parsed.lineCount > 500);
  const lots = searchManual(parsed, '手数', 10);
  assert.ok(lots.length > 0);
  assert.ok(lots.some((result) => result.title.includes('手数') || result.snippet.includes('手数')));
  assert.ok(lots.some((result) => result.snippet.includes('600')));
  const tr = searchManual(parsed, 'TR 边界', 10);
  assert.ok(tr.length > 0);
  assert.ok(tr.some((result) => result.title.includes('TR') || result.snippet.includes('TR')));
  assert.equal(searchManual(parsed, '', 10).length, 0);
});

function tradeInput(overrides = {}) {
  return {
    symbol: 'PP0',
    direction: 'long',
    openedAt: '2026-11-25T09:30:00+08:00',
    entryPrice: 7000,
    stopPrice: 6980,
    targetPrice: 7040,
    lots: 1,
    multiplier: 5,
    ...overrides,
  };
}

test('buildTrade accepts a valid trade and computes the trading day', () => {
  const { trade, errors, warnings } = buildTrade(tradeInput(), { now: new Date('2026-11-25T09:31:00+08:00') });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(trade.tradingDay, '2026-11-25');
  assert.equal(trade.session, 'day');
  assert.equal(trade.entryPrice, 7000);
  assert.equal(tradePnl({ ...trade, exitPrice: 7040 }), 200);
});

test('buildTrade blocks structural mistakes', () => {
  assert.ok(buildTrade(tradeInput({ stopPrice: 7010 })).errors.length > 0);
  assert.ok(buildTrade(tradeInput({ targetPrice: 6990 })).errors.length > 0);
  assert.ok(buildTrade(tradeInput({ lots: 0 })).errors.length > 0);
  assert.ok(buildTrade(tradeInput({ exitPrice: 7040 })).errors.length > 0);
  assert.ok(buildTrade(tradeInput({ closedAt: '2026-11-25T09:20:00+08:00', exitPrice: 7040 })).errors.length > 0);
});

test('buildTrade lenient mode allows a screenshot draft without a stop', () => {
  const { trade, errors, warnings } = buildTrade(tradeInput({ stopPrice: null }), { requireStop: false });
  assert.deepEqual(errors, []);
  assert.equal(trade.stopPrice, null);
  assert.ok(warnings.some((warning) => warning.includes('缺止损')));
  assert.ok(!warnings.some((warning) => warning.includes('120')));
});

test('buildTrade warns but does not block on rule limits', () => {
  const wide = buildTrade(tradeInput({ entryPrice: 7000, stopPrice: 6860 }));
  assert.equal(wide.errors.length, 0);
  assert.ok(wide.warnings.some((warning) => warning.includes('120')));

  const tr = buildTrade(tradeInput({ stopPrice: 6960, extended: { state15m: 'TR' } }));
  assert.ok(tr.warnings.some((warning) => warning.includes('TR') && warning.includes('30')));

  const big = buildTrade(tradeInput({ entryPrice: 7000, stopPrice: 6900, lots: 3 }));
  assert.ok(big.warnings.some((warning) => warning.includes('风险')));
  assert.ok(big.warnings.some((warning) => warning.includes('手数')));
});

test('summarizeTrades tracks pnl, streaks and guards', () => {
  const closed = [
    { id: 'a', direction: 'long', entryPrice: 7000, exitPrice: 7020, multiplier: 5, lots: 1, fees: 0, closedAt: '2026-11-25T09:40:00+08:00', openedAt: '2026-11-25T09:30:00+08:00' },
    { id: 'b', direction: 'long', entryPrice: 7000, exitPrice: 6990, multiplier: 5, lots: 1, fees: 0, closedAt: '2026-11-25T10:00:00+08:00', openedAt: '2026-11-25T09:50:00+08:00' },
    { id: 'c', direction: 'long', entryPrice: 7000, exitPrice: 6985, multiplier: 5, lots: 1, fees: 0, closedAt: '2026-11-25T10:10:00+08:00', openedAt: '2026-11-25T10:05:00+08:00' },
  ];
  const summary = summarizeTrades(closed, { now: new Date('2026-11-25T10:20:00+08:00') });
  assert.equal(summary.closedCount, 3);
  assert.equal(summary.dailyPnl, -25);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 2);
  assert.equal(summary.consecutiveLosses, 2);
  assert.equal(summary.consecutiveWins, 0);
  assert.equal(summary.dailyLossRemaining, 1175);
});

test('Sina JSONP decoding handles the real payload shape', () => {
  const payload = 'var _PP0=([{"d":"2026-11-25 09:00:00","o":"7000","h":"7010","l":"6990","c":"7005","v":"10","p":"100"},{"d":"2026-11-25 09:03:00","o":"7005","h":"7012","l":"7000","c":"7010","v":"12","p":"120"}]);';
  const bars = parseSinaJsonp(payload);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].open, 7000);
  assert.equal(bars[0].time, '2026-11-25 09:00');
  assert.equal(bars[1].close, 7010);
  assert.throws(() => parseSinaJsonp('var _PP0=();'));
});

test('EMA/ATR and day slicing produce a chart payload', () => {
  assert.equal(ema([1, 2, 3, 4, 5], 3)[2], 2);
  assert.equal(ema([1, 2], 3)[0], null);
  const bars = Array.from({ length: 100 }, (_, index) => ({
    t: Date.parse('2026-11-25T09:00:00+08:00') + index * 180000,
    time: `2026-11-25 09:${String(index).padStart(2, '0')}`,
    open: 7000 + index,
    high: 7005 + index,
    low: 6995 + index,
    close: 7002 + index,
    volume: 10,
  }));
  const a = atr(bars, 14);
  assert.ok(a[14] > 0);
  const payload = klineForDay(bars, '2026-11-25');
  assert.equal(payload.window.tradingDay, '2026-11-25');
  assert.equal(payload.bars.length, 100);
  assert.ok(payload.bars.some((bar) => bar.ema20 !== null));
  assert.ok(payload.atr14 > 0);
});
