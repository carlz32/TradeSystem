/**
 * Pure logic for the trading cockpit: rule parsing/search, trading-day and
 * session arithmetic, trade validation/aggregation, and Sina kline decoding.
 *
 * No DSH / DOM imports here so this module can be unit-tested with plain Node.
 * All clock arithmetic is pinned to Asia/Shanghai (UTC+8, no DST).
 */

export const ACCOUNT = Object.freeze({
  maxTradeRisk: 600,
  maxDailyLoss: 1200,
  marginCap: 8000,
});

export const SESSION_ENDS = Object.freeze(['10:15', '11:30', '15:00', '23:00']);

/** Main-contract point value per lot (yuan per point). */
export const MULTIPLIERS = Object.freeze({
  PP: 5, L: 5, V: 5, EG: 10,
  MA: 10, M: 10, RM: 10, SR: 10, CF: 5, TA: 5, FG: 20, SA: 20, UR: 20, OI: 10,
  RB: 10, HC: 10, I: 100, J: 100, JM: 60, SC: 1000,
  P: 10, Y: 10, C: 10, CS: 10, A: 10, B: 10, JD: 10, AP: 10, CJ: 5, PK: 5, LH: 16,
});

export const SYMBOLS = Object.freeze([
  'PP0', 'MA0', 'M0', 'RM0', 'SR0', 'CF0', 'TA0', 'FG0', 'SA0', 'UR0',
  'OI0', 'RB0', 'HC0', 'I0', 'J0', 'JM0', 'SC0', 'V0', 'L0', 'EG0',
  'P0', 'Y0', 'C0', 'CS0', 'A0', 'B0', 'JD0', 'AP0',
]);

export const DEFAULT_SYMBOL = 'PP0';

export function multiplierFor(symbol) {
  const key = String(symbol ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
  return MULTIPLIERS[key] ?? 10;
}

// ---------------------------------------------------------------------------
// Shanghai clock helpers
// ---------------------------------------------------------------------------

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** @param {Date|number|string} [value] */
export function shanghaiParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function dayString(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function todayInShanghai(value = new Date()) {
  return dayString(shanghaiParts(value));
}

export function dayToUtcMs(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!match) throw new Error(`invalid day: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function addDays(day, amount) {
  return new Date(dayToUtcMs(day) + amount * 86400000).toISOString().slice(0, 10);
}

export function weekdayOf(day) {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

export function isWeekend(day) {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

export function nextBusinessDay(day) {
  let cursor = addDays(day, 1);
  while (isWeekend(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

export function previousBusinessDay(day) {
  let cursor = addDays(day, -1);
  while (isWeekend(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

/**
 * Futures trading day: the 21:00-23:00 night session belongs to the next
 * business day, so a trade at 21:30 on 2026-11-25 is booked to 2026-11-26.
 */
export function tradingDayOf(value = new Date()) {
  const parts = shanghaiParts(value);
  const day = dayString(parts);
  if (isWeekend(day)) return nextBusinessDay(day);
  if (parts.hour >= 20) return nextBusinessDay(day);
  return day;
}

/** ISO timestamp in +08:00 for a day/time pair. */
export function shanghaiIso(day, hour, minute) {
  return `${day}T${pad2(hour)}:${pad2(minute)}:00+08:00`;
}

/** Kline window for one trading day: previous business day 21:00 -> day 15:00. */
export function klineWindow(tradingDay) {
  const previous = previousBusinessDay(tradingDay);
  const start = shanghaiIso(previous, 21, 0);
  const end = shanghaiIso(tradingDay, 15, 0);
  return {
    tradingDay,
    previousTradingDay: previous,
    start,
    end,
    startMs: Date.parse(start),
    endMs: Date.parse(end),
  };
}

function minutesOfDay(parts) {
  return parts.hour * 60 + parts.minute;
}

function atMinutes(parts, hour, minute) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute) - SHANGHAI_OFFSET_MS;
}

/**
 * Session state right now. `open` means the market has a session; `canOpen`
 * additionally excludes the manual's no-new-entry windows.
 */
export function sessionState(value = new Date()) {
  const parts = shanghaiParts(value);
  const day = dayString(parts);
  const minutes = minutesOfDay(parts);
  const base = { phase: '休市', open: false, canOpen: false, reason: '非交易时段', tradingDay: tradingDayOf(value) };
  if (isWeekend(day)) return { ...base, phase: '周末休市', reason: '周末不交易', tradingDay: nextBusinessDay(day) };

  const inRange = (from, to) => minutes >= from && minutes < to;
  const at = (hour, minute) => hour * 60 + minute;
  const mk = (phase, open, canOpen, reason) => ({ ...base, phase, open, canOpen, reason, tradingDay: tradingDayOf(value) });

  if (inRange(at(9, 0), at(10, 15))) {
    if (minutes < at(9, 18)) return mk('日盘·早盘', true, false, '开盘前 6 根 3m（9:18 前）不做');
    return mk('日盘·早盘', true, true, '可开新仓');
  }
  if (inRange(at(10, 15), at(10, 30))) return mk('日盘·休息', false, false, '10:15-10:30 休息');
  if (inRange(at(10, 30), at(11, 30))) {
    if (minutes < at(10, 33)) return mk('日盘·上午二', true, false, '10:30 后第 1 根 3m 不做');
    if (minutes >= at(11, 25)) return mk('日盘·上午二', true, false, '11:25 停新开仓，11:30 前平仓');
    return mk('日盘·上午二', true, true, '可开新仓');
  }
  if (inRange(at(11, 30), at(13, 30))) return mk('午休', false, false, '午休不留仓');
  if (inRange(at(13, 30), at(15, 0))) {
    if (minutes < at(13, 39)) return mk('日盘·下午', true, false, '13:30 后前 3 根 3m 不做');
    if (minutes >= at(14, 45)) return mk('日盘·下午', true, false, '14:45 停新开仓，14:55 市价平仓');
    return mk('日盘·下午', true, true, '可开新仓');
  }
  if (inRange(at(21, 0), at(23, 0))) {
    if (minutes < at(21, 18)) return mk('夜盘', true, false, '开盘前 6 根 3m（21:18 前）不做');
    if (minutes >= at(22, 45)) return mk('夜盘', true, false, '22:45 停新开仓，22:55 市价平仓');
    return mk('夜盘', true, true, '可开新仓');
  }
  if (minutes >= at(15, 0) && minutes < at(21, 0)) return mk('日盘收盘', false, false, '15:00 日盘收盘，21:00 夜盘开盘');
  if (minutes >= at(23, 0)) return mk('夜盘收盘', false, false, '23:00 夜盘收盘');
  if (minutes < at(9, 0)) return mk('盘前', false, false, '09:00 日盘开盘');
  return mk('休市', false, false, '非交易时段');
}

/** Most recent completed period boundary at or before `value`. */
export function lastSessionEnd(value = new Date()) {
  const parts = shanghaiParts(value);
  const now = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const candidates = [];
  for (let offset = -1; offset <= 0; offset += 1) {
    const day = addDays(dayString(parts), offset);
    for (const end of SESSION_ENDS) {
      const [hour, minute] = end.split(':').map(Number);
      candidates.push(Date.parse(shanghaiIso(day, hour, minute)));
    }
  }
  return Math.max(...candidates.filter((candidate) => candidate <= now));
}

/** Next period boundary strictly after `value`. */
export function nextSessionEnd(value = new Date()) {
  const parts = shanghaiParts(value);
  const now = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const candidates = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = addDays(dayString(parts), offset);
    for (const end of SESSION_ENDS) {
      const [hour, minute] = end.split(':').map(Number);
      candidates.push(Date.parse(shanghaiIso(day, hour, minute)));
    }
  }
  return Math.min(...candidates.filter((candidate) => candidate > now));
}

export function shouldRefreshKline(fetchedAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(fetchedAtMs)) return true;
  if (nowMs - fetchedAtMs > 5 * 60 * 1000) return true;
  return fetchedAtMs < lastSessionEnd(nowMs);
}

// ---------------------------------------------------------------------------
// Execution manual parsing / search
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * Split the markdown manual into heading-delimited sections, preserving the
 * exact source text and 1-based line numbers.
 */
export function parseManual(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADING.exec(lines[index]);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim() });
  }
  const sections = [];
  const pushSection = (startIndex, endIndex, level, title) => {
    const body = lines.slice(startIndex, endIndex).join('\n');
    const chapterMatch = /^(\d+(?:\.\d+)*)/.exec(title);
    sections.push({
      id: `sec-${sections.length + 1}`,
      level,
      title,
      chapter: chapterMatch ? chapterMatch[1] : '',
      line: startIndex + 1,
      endLine: endIndex,
      body,
    });
  };
  if (headings.length === 0) {
    pushSection(0, lines.length, 1, '执行手册');
  } else {
    const first = headings[0];
    if (first.index > 0 && lines.slice(0, first.index).join('').trim()) {
      pushSection(0, first.index, 1, '前言');
    }
    for (let index = 0; index < headings.length; index += 1) {
      const heading = headings[index];
      const end = index + 1 < headings.length ? headings[index + 1].index : lines.length;
      pushSection(heading.index, end, heading.level, heading.title);
    }
  }
  // Attach ancestor titles for breadcrumbs.
  const stack = [];
  for (const section of sections) {
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) stack.pop();
    section.path = stack.map((entry) => entry.title).concat(section.title);
    stack.push({ level: section.level, title: section.title });
  }
  return {
    title: sections[0]?.title ?? '执行手册',
    lineCount: lines.length,
    sections,
  };
}

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

/**
 * Keyword search over the parsed manual. Multiple whitespace-separated terms
 * must all be present; results carry the section, the best matching line and a
 * short excerpt around it.
 */
export function searchManual(parsed, query, limit = 30) {
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const results = [];
  for (const section of parsed.sections) {
    const title = section.title.toLowerCase();
    const body = section.body.toLowerCase();
    const combined = `${title}\n${body}`;
    const all = terms.every((term) => combined.includes(term));
    const any = terms.some((term) => combined.includes(term));
    if (!all && !any) continue;
    let score = 0;
    for (const term of terms) {
      score += countOccurrences(title, term) * 20;
      score += countOccurrences(body, term) * 2;
    }
    if (all) score += 30;
    const bodyLines = section.body.split('\n');
    let best = { index: -1, hits: -1 };
    for (let index = 1; index < bodyLines.length; index += 1) {
      const line = bodyLines[index].toLowerCase();
      const hits = terms.filter((term) => line.includes(term)).length;
      if (hits > best.hits) best = { index, hits };
      if (hits === terms.length) break;
    }
    const matchLine = best.index >= 0 ? section.line + best.index : section.line;
    let rawLine = best.index >= 0 ? bodyLines[best.index] : '';
    if (!rawLine) rawLine = bodyLines.slice(1).find((line) => line.trim()) ?? bodyLines[0] ?? '';
    let snippet = collapseWhitespace(rawLine);
    if (snippet.length > 260) {
      const lower = rawLine.toLowerCase();
      const first = Math.max(0, Math.min(...terms.map((term) => {
        const at = lower.indexOf(term);
        return at < 0 ? snippet.length : at;
      })));
      const from = Math.max(0, first - 100);
      snippet = `${from > 0 ? '…' : ''}${collapseWhitespace(rawLine.slice(from, from + 260))}…`;
    }
    results.push({
      id: section.id,
      title: section.title,
      chapter: section.chapter,
      level: section.level,
      path: section.path,
      line: matchLine,
      sectionLine: section.line,
      snippet,
      score,
    });
  }
  results.sort((left, right) => right.score - left.score || left.line - right.line);
  return results.slice(0, Math.max(1, limit));
}

// ---------------------------------------------------------------------------
// Trade validation / aggregation
// ---------------------------------------------------------------------------

export function parseTimestamp(value, fallback = new Date()) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) return new Date(Number(text.length === 10 ? `${text}000` : text));
  let normalized = text.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) normalized += ':00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) normalized += '+08:00';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00+08:00';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`无法识别时间：${text}`);
  return parsed;
}

export function toIso(value, fallback = new Date()) {
  return parseTimestamp(value, fallback).toISOString();
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundPrice(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Normalize one trade, producing structural errors and rule warnings.
 * Structural errors block persistence; warnings never do.
 */
export function buildTrade(input, { now = new Date(), existing = [], requireStop = true } = {}) {
  const errors = [];
  const warnings = [];
  const direction = input.direction === 'short' ? 'short' : input.direction === 'long' ? 'long' : null;
  if (!direction) errors.push('方向必须是 long 或 short');

  const symbol = String(input.symbol ?? DEFAULT_SYMBOL).toUpperCase().trim();
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) errors.push(`品种代码不合法：${symbol}`);

  const entryPrice = finiteNumber(input.entryPrice);
  const stopPrice = finiteNumber(input.stopPrice);
  const targetPrice = finiteNumber(input.targetPrice);
  const exitPrice = finiteNumber(input.exitPrice);
  const lots = finiteNumber(input.lots ?? 1);
  const fees = finiteNumber(input.fees ?? 0) ?? 0;
  const multiplier = finiteNumber(input.multiplier) ?? multiplierFor(symbol);

  if (entryPrice === null || entryPrice <= 0) errors.push('入场价必须是正数');
  if (stopPrice === null || stopPrice <= 0) {
    if (requireStop) errors.push('止损价必须是正数');
    else warnings.push('缺止损，确认入账前补');
  }
  if (targetPrice !== null && targetPrice <= 0) errors.push('目标价必须是正数');
  if (exitPrice !== null && exitPrice <= 0) errors.push('离场价必须是正数');
  if (lots === null || !Number.isInteger(lots) || lots < 1) errors.push('手数必须是 ≥1 的整数');
  if (!(multiplier > 0)) errors.push('合约乘数必须是正数');

  let openedAt;
  try {
    openedAt = parseTimestamp(input.openedAt ?? input.entryTime ?? now, now);
  } catch (error) {
    errors.push(error.message);
    openedAt = now;
  }
  let closedAt = null;
  if (input.closedAt ?? input.exitTime) {
    try {
      closedAt = parseTimestamp(input.closedAt ?? input.exitTime, openedAt);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (closedAt && closedAt.getTime() < openedAt.getTime()) errors.push('离场时间不能早于入场时间');
  if (closedAt && exitPrice === null) errors.push('已填离场时间时必须填离场价');
  if (!closedAt && exitPrice !== null) errors.push('已填离场价时必须填离场时间');

  if (direction && entryPrice !== null && stopPrice !== null) {
    if (direction === 'long' && stopPrice >= entryPrice) errors.push('做多止损必须低于入场价');
    if (direction === 'short' && stopPrice <= entryPrice) errors.push('做空止损必须高于入场价');
    if (targetPrice !== null) {
      if (direction === 'long' && targetPrice <= entryPrice) errors.push('做多目标必须高于入场价');
      if (direction === 'short' && targetPrice >= entryPrice) errors.push('做空目标必须低于入场价');
    }
  }

  const tradingDay = /^\d{4}-\d{2}-\d{2}$/.test(String(input.tradingDay ?? ''))
    ? String(input.tradingDay)
    : tradingDayOf(openedAt);
  const parts = shanghaiParts(openedAt);
  const session = parts.hour >= 20 || parts.hour < 8 ? 'night' : 'day';

  const trade = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '',
    tradingDay,
    session,
    symbol,
    direction,
    openedAt: openedAt.toISOString(),
    entryPrice: entryPrice === null ? null : roundPrice(entryPrice),
    stopPrice: stopPrice === null ? null : roundPrice(stopPrice),
    targetPrice: targetPrice === null ? null : roundPrice(targetPrice),
    lots: lots === null ? null : Math.trunc(lots),
    multiplier,
    closedAt: closedAt ? closedAt.toISOString() : null,
    exitPrice: exitPrice === null ? null : roundPrice(exitPrice),
    exitReason: input.exitReason ? String(input.exitReason) : null,
    fees: Math.max(0, fees),
    note: input.note ? String(input.note) : '',
    tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 20) : [],
    source: input.source === 'screenshot' ? 'screenshot' : 'manual',
    extended: input.extended && typeof input.extended === 'object' ? input.extended : {},
  };

  if (errors.length === 0) {
    if (trade.stopPrice !== null) {
      const stopPoints = Math.abs(trade.entryPrice - trade.stopPrice);
      const riskAmount = stopPoints * trade.multiplier * trade.lots;
      const state = trade.extended?.state15m;
      if (state === 'TR' && stopPoints > 30) warnings.push(`TR 模式止损 ${stopPoints.toFixed(1)} 点 > 30 点上限`);
      else if (stopPoints > 120) warnings.push(`止损 ${stopPoints.toFixed(1)} 点 > 120 点上限`);
      if (riskAmount > ACCOUNT.maxTradeRisk) warnings.push(`单笔风险 ¥${riskAmount.toFixed(0)} > ¥${ACCOUNT.maxTradeRisk}`);
      const maxByRisk = stopPoints > 0 ? Math.floor(ACCOUNT.maxTradeRisk / (stopPoints * trade.multiplier)) : Infinity;
      if (trade.lots > maxByRisk) warnings.push(`手数 ${trade.lots} 超过风险公式上限 ${maxByRisk} 手`);
    }
    const sessionNow = sessionState(openedAt);
    if (sessionNow.open && !sessionNow.canOpen) warnings.push(`入场时段禁开新仓：${sessionNow.reason}`);

    const sameSideOpen = existing.filter((item) => item.id !== trade.id && item.symbol === trade.symbol && item.direction === trade.direction && item.exitPrice === null);
    if (sameSideOpen.length > 0) warnings.push(`同品种同方向已有 ${sameSideOpen.length} 笔持仓，手册要求同时只做 1 笔`);
  }

  return { trade, errors, warnings };
}

export function tradePnl(trade) {
  if (!trade || trade.exitPrice === null || trade.exitPrice === undefined || trade.entryPrice === null || trade.entryPrice === undefined) return null;
  const direction = trade.direction === 'short' ? -1 : 1;
  const gross = (trade.exitPrice - trade.entryPrice) * direction * (trade.multiplier ?? multiplierFor(trade.symbol)) * (trade.lots ?? 1);
  return Math.round((gross - (trade.fees ?? 0)) * 100) / 100;
}

export function tradeRisk(trade) {
  if (!trade || trade.entryPrice === null || trade.stopPrice === null) return null;
  const points = Math.abs(trade.entryPrice - trade.stopPrice);
  return Math.round(points * (trade.multiplier ?? multiplierFor(trade.symbol)) * (trade.lots ?? 1) * 100) / 100;
}

export function summarizeTrades(trades, { now = new Date() } = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const closed = list
    .filter((trade) => trade.exitPrice !== null && trade.exitPrice !== undefined)
    .sort((left, right) => String(left.closedAt ?? left.openedAt).localeCompare(String(right.closedAt ?? right.openedAt)) || String(left.id).localeCompare(String(right.id)));
  const open = list.filter((trade) => trade.exitPrice === null || trade.exitPrice === undefined);
  const dailyPnl = Math.round(closed.reduce((sum, trade) => sum + (tradePnl(trade) ?? 0), 0) * 100) / 100;
  const wins = closed.filter((trade) => (tradePnl(trade) ?? 0) > 0).length;
  const losses = closed.filter((trade) => (tradePnl(trade) ?? 0) < 0).length;

  let consecutiveLosses = 0;
  for (let index = closed.length - 1; index >= 0; index -= 1) {
    const pnl = tradePnl(closed[index]) ?? 0;
    if (pnl < 0) consecutiveLosses += 1;
    else if (pnl > 0) break;
    else break;
  }
  let consecutiveWins = 0;
  for (let index = closed.length - 1; index >= 0; index -= 1) {
    const pnl = tradePnl(closed[index]) ?? 0;
    if (pnl > 0) consecutiveWins += 1;
    else if (pnl < 0) break;
    else break;
  }

  const openRisk = open.reduce((sum, trade) => sum + (tradeRisk(trade) ?? 0), 0);
  const dailyLossRemaining = Math.max(0, Math.round((ACCOUNT.maxDailyLoss + Math.min(0, dailyPnl)) * 100) / 100);
  const state = sessionState(now);
  const guards = [];
  if (dailyPnl <= -ACCOUNT.maxDailyLoss) guards.push(`当日亏损 ¥${Math.abs(dailyPnl).toFixed(0)} 已达上限 ¥${ACCOUNT.maxDailyLoss}`);
  if (consecutiveLosses >= 3) guards.push('连续 3 次止损，当日停止交易');
  if (consecutiveWins >= 4) guards.push('连续 4 笔盈利，当日只平不开');
  if (open.length > 0) guards.push('已有持仓/挂单，手册要求同时只做 1 笔');

  return {
    count: list.length,
    closedCount: closed.length,
    openCount: open.length,
    dailyPnl,
    wins,
    losses,
    winRate: closed.length > 0 ? Math.round((wins / closed.length) * 1000) / 10 : 0,
    consecutiveLosses,
    consecutiveWins,
    openRisk: Math.round(openRisk * 100) / 100,
    dailyLossRemaining,
    guards,
    session: state,
  };
}

// ---------------------------------------------------------------------------
// Sina kline decoding / indicators
// ---------------------------------------------------------------------------

/** Decode Sina's `var _PP0=([...]);` JSONP payload into normalized bars. */
export function parseSinaJsonp(text) {
  const source = String(text ?? '');
  const open = source.indexOf('(');
  const close = source.lastIndexOf(')');
  if (open < 0 || close <= open) throw new Error('新浪行情返回格式无法识别');
  let rows;
  try {
    rows = JSON.parse(source.slice(open + 1, close));
  } catch (error) {
    throw new Error(`新浪行情 JSON 解析失败：${error.message}`);
  }
  if (!Array.isArray(rows)) throw new Error('新浪行情没有返回 K 线数组');
  const bars = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const time = String(row.d ?? '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(time);
    if (!match) continue;
    const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || seen.has(ms)) continue;
    const openPrice = Number(row.o);
    const high = Number(row.h);
    const low = Number(row.l);
    const closePrice = Number(row.c);
    if (![openPrice, high, low, closePrice].every(Number.isFinite)) continue;
    seen.add(ms);
    bars.push({
      t: ms,
      time: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`,
      open: openPrice,
      high,
      low,
      close: closePrice,
      volume: Number(row.v) || 0,
      amount: Number(row.p) || 0,
    });
  }
  bars.sort((left, right) => left.t - right.t);
  if (bars.length === 0) throw new Error('新浪行情 K 线为空');
  return bars;
}

export function ema(values, period = 20) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let index = 0; index < period; index += 1) sum += values[index];
  let previous = sum / period;
  result[period - 1] = previous;
  const factor = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * factor + previous;
    result[index] = previous;
  }
  return result;
}

export function atr(bars, period = 14) {
  const result = new Array(bars.length).fill(null);
  if (bars.length <= period) return result;
  const trueRanges = new Array(bars.length).fill(null);
  trueRanges[0] = bars[0].high - bars[0].low;
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const previousClose = bars[index - 1].close;
    trueRanges[index] = Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  }
  let sum = 0;
  for (let index = 1; index <= period; index += 1) sum += trueRanges[index];
  let previous = sum / period;
  result[period] = previous;
  for (let index = period + 1; index < bars.length; index += 1) {
    previous = (previous * (period - 1) + trueRanges[index]) / period;
    result[index] = previous;
  }
  return result;
}

/**
 * Build the chart payload for one trading day. Indicators are computed on the
 * full series (so EMA20 is warm at the window start), then sliced.
 */
export function klineForDay(allBars, tradingDay, { includePartial = false, now = Date.now() } = {}) {
  const window = klineWindow(tradingDay);
  const bars = Array.isArray(allBars) ? allBars : [];
  const emaSeries = ema(bars.map((bar) => bar.close), 20);
  const atrSeries = atr(bars, 14);
  const result = [];
  let lastAtr = null;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!includePartial && bar.t > now) continue;
    if (bar.t < window.startMs || bar.t > window.endMs) continue;
    result.push({
      t: bar.t,
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      ema20: emaSeries[index] === null ? null : Math.round(emaSeries[index] * 1000) / 1000,
    });
    if (atrSeries[index] !== null && bar.t <= window.endMs) lastAtr = atrSeries[index];
  }
  return {
    window,
    bars: result,
    atr14: lastAtr === null ? null : Math.round(lastAtr * 100) / 100,
    ema20Last: result.length > 0 ? result[result.length - 1].ema20 : null,
  };
}

export function formatClock(timestamp) {
  const parts = shanghaiParts(timestamp);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatDateTime(timestamp) {
  const parts = shanghaiParts(timestamp);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Bar index whose end time first covers `timestamp`; -1 when out of range. */
export function barIndexFor(bars, timestamp) {
  if (!Array.isArray(bars) || bars.length === 0) return -1;
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index].t >= timestamp) return index;
  }
  return -1;
}
