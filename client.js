/**
 * dsh-trading-cockpit — browser half.
 *
 * Registered as the central `main` panel `trading-cockpit` plus a sidebar
 * entry icon. The panel talks to the Host half over the same-origin
 * `/trading-cockpit/api/*` JSON routes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-trading-cockpit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    const ID = 'dsh-trading-cockpit';
    const API = '/trading-cockpit/api';
    const SYMBOLS = ['PP0', 'MA0', 'M0', 'RM0', 'SR0', 'CF0', 'TA0', 'FG0', 'SA0', 'UR0', 'OI0', 'RB0', 'HC0', 'I0', 'J0', 'JM0', 'SC0', 'V0', 'L0', 'EG0', 'P0', 'Y0', 'C0', 'CS0', 'A0', 'B0', 'JD0', 'AP0'];
    const MULTIPLIERS = { PP: 5, L: 5, V: 5, EG: 10, MA: 10, M: 10, RM: 10, SR: 10, CF: 5, TA: 5, FG: 20, SA: 20, UR: 20, OI: 10, RB: 10, HC: 10, I: 100, J: 100, JM: 60, SC: 1000, P: 10, Y: 10, C: 10, CS: 10, A: 10, B: 10, JD: 10, AP: 10 };

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------
    async function api(path, options) {
      const response = await fetch(`${API}/${path}`, {
        ...(options ?? {}),
        headers: { 'content-type': 'application/json', ...((options && options.headers) || {}) },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!payload || payload.ok !== true) {
        const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
        error.details = payload?.error?.details ?? null;
        throw error;
      }
      return payload.data;
    }

    function shanghaiParts(date = new Date()) {
      const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
      };
    }

    function pad(value) {
      return String(value).padStart(2, '0');
    }

    function nowLocalInput() {
      const p = shanghaiParts();
      return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
    }

    function toIsoInput(value) {
      if (!value) return null;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00+08:00`;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}+08:00`;
      return value;
    }


    function toLocalInput(value) {
      if (!value) return '';
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) return '';
      const p = shanghaiParts(new Date(ms));
      return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
    }

    function draftForm(trade) {
      return {
        symbol: trade.symbol ?? 'PP0',
        direction: trade.direction ?? 'long',
        entryPrice: trade.entryPrice ?? '',
        stopPrice: trade.stopPrice ?? '',
        targetPrice: trade.targetPrice ?? '',
        lots: trade.lots ?? 1,
        multiplier: trade.multiplier ?? multiplierOf(trade.symbol),
        entryTime: toLocalInput(trade.openedAt),
        exitTime: toLocalInput(trade.closedAt),
        exitPrice: trade.exitPrice ?? '',
      };
    }

    function fmtTime(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value).slice(11, 16);
      return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    }

    function fmtDateTime(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
    }

    function fmtMoney(value) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
      const number = Number(value);
      return `${number > 0 ? '+' : ''}${number.toFixed(0)}`;
    }

    function fmtPrice(value) {
      if (value === null || value === undefined || value === '') return '—';
      const number = Number(value);
      return Number.isFinite(number) ? String(Math.round(number * 1000) / 1000) : '—';
    }

    function multiplierOf(symbol) {
      return MULTIPLIERS[String(symbol || '').replace(/[^A-Za-z]/g, '').toUpperCase()] ?? 10;
    }

    const PALETTE_KEY = 'dsh-trading-cockpit.palette';

    function readPalette() {
      try {
        return window.localStorage.getItem(PALETTE_KEY) === 'cn' ? 'cn' : 'intl';
      } catch {
        return 'intl';
      }
    }

    function savePalette(value) {
      try {
        window.localStorage.setItem(PALETTE_KEY, value);
      } catch {
        /* private mode: keep the in-memory choice */
      }
    }

    function emptyForm(symbol = 'PP0') {
      return {
        symbol,
        direction: 'long',
        entryTime: nowLocalInput(),
        entryPrice: '',
        stopPrice: '',
        targetPrice: '',
        lots: '1',
        multiplier: String(multiplierOf(symbol)),
        exitTime: '',
        exitPrice: '',
        state15m: 'trend',
        pattern: '',
        errors: [],
        note: '',
        shot: '',
        shotPreview: '',
      };
    }

    function buildPayload(form, symbol, tradingDay) {
      return {
        symbol,
        tradingDay: tradingDay || null,
        direction: form.direction,
        openedAt: toIsoInput(form.entryTime),
        entryPrice: form.entryPrice === '' ? null : Number(form.entryPrice),
        stopPrice: form.stopPrice === '' ? null : Number(form.stopPrice),
        targetPrice: form.targetPrice === '' ? null : Number(form.targetPrice),
        lots: form.lots === '' ? null : Number(form.lots),
        multiplier: form.multiplier === '' ? null : Number(form.multiplier),
        closedAt: form.exitTime ? toIsoInput(form.exitTime) : null,
        exitPrice: form.exitPrice === '' ? null : Number(form.exitPrice),
        note: form.note,
        source: form.shot ? 'screenshot' : 'manual',
        extended: { state15m: form.state15m, pattern: form.pattern, errors: form.errors, shot: form.shot || null },
      };
    }

    function fileToDataUrl(file) {
      return new Promise((resolvePromise, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolvePromise(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取截图失败'));
        reader.readAsDataURL(file);
      });
    }

    function colorLuminance(value) {
      const text = String(value || '').trim();
      const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
      if (hex) {
        let digits = hex[1];
        if (digits.length === 3) digits = digits.split('').map((part) => part + part).join('');
        if (digits.length >= 6) {
          const number = Number.parseInt(digits.slice(0, 6), 16);
          const red = (number >> 16) & 0xff;
          const green = (number >> 8) & 0xff;
          const blue = number & 0xff;
          return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        }
      }
      const rgb = /^rgba?\(([^)]+)\)/i.exec(text);
      if (rgb) {
        const parts = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()));
        if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
          return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
        }
      }
      return null;
    }

    function detectScheme() {
      try {
        const root = document.documentElement;
        const token = window.getComputedStyle(root).getPropertyValue('--dsw-alias-bg-base');
        const luminance = colorLuminance(token);
        if (luminance !== null) return luminance < 0.45 ? 'dark' : 'light';
        for (const element of [root, document.body]) {
          if (!element) continue;
          const marker = [
            String(element.className?.baseVal ?? element.className ?? ''),
            element.getAttribute('data-theme') ?? '',
            element.getAttribute('data-scheme') ?? '',
          ].join(' ');
          if (/\bdark\b/i.test(marker)) return 'dark';
          if (/\blight\b/i.test(marker)) return 'light';
        }
      } catch {
        // Fall through to the media query when the host exposes no usable color.
      }
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function nearestBar(bars, iso) {
      const target = Date.parse(iso);
      if (!Array.isArray(bars) || bars.length === 0 || !Number.isFinite(target)) return -1;
      let best = 0;
      let diff = Infinity;
      for (let index = 0; index < bars.length; index += 1) {
        const distance = Math.abs(bars[index].t - target);
        if (distance < diff) {
          diff = distance;
          best = index;
        }
      }
      return best;
    }

    function cls(...values) {
      return values.filter(Boolean).join(' ');
    }

    const MODE_LABELS = { trend: '趋势', tr: 'TR 区间', breakout: '已确认突破', chaotic: '混乱' };
    const MODE_OPTIONS = [
      ['trend', '趋势'],
      ['tr', 'TR 区间'],
      ['breakout', '已确认突破'],
      ['chaotic', '混乱'],
    ];

    function evaluateDecision(input, state) {
      const session = state?.session;
      const guards = state?.summary?.guards ?? [];
      const gates = [];
      const live = !session?.tradingDay || state?.day === session.tradingDay;
      if (live && session && !session.open) gates.push(`当前${session.phase}，休市`);
      else if (live && session && !session.canOpen) gates.push(session.reason);
      for (const guard of guards) gates.push(guard);

      const stop = Number(input.stopPoints);
      const targetR = Number(input.targetR);
      const lots = Number(input.lots);
      const bias = input.bias;
      const mode = input.state15m;
      const checks = [];

      if (mode === 'trend') {
        checks.push({ label: '3m 未反向', pass: input.aligned3m });
        checks.push({ label: '回踩 EMA20 / 摆动 ≤1 ATR', pass: input.pullback });
        checks.push({ label: '信号 K 成立并被后续突破', pass: input.signal });
        checks.push({ label: '止损 ≤120 点', pass: Number.isFinite(stop) && stop > 0 && stop <= 120 });
        checks.push({ label: '目标 ≥2R', pass: Number.isFinite(targetR) && targetR >= 2 });
        checks.push({ label: '手数 ≥1', pass: Number.isFinite(lots) && lots >= 1 });
      } else if (mode === 'tr') {
        checks.push({ label: 'TR 边缘 ±0.5 ATR', pass: input.atEdge });
        checks.push({ label: '反转信号 K 成立', pass: input.signal });
        checks.push({ label: '止损 ≤30 点', pass: Number.isFinite(stop) && stop > 0 && stop <= 30 });
        checks.push({ label: '目标 ≥1R', pass: Number.isFinite(targetR) && targetR >= 1 });
        checks.push({ label: '手数 ≥1', pass: Number.isFinite(lots) && lots >= 1 });
      } else if (mode === 'breakout') {
        checks.push({ label: '回踩不破边界', pass: input.pullback });
        checks.push({ label: '信号 K 成立', pass: input.signal });
        checks.push({ label: '止损 ≤120 点', pass: Number.isFinite(stop) && stop > 0 && stop <= 120 });
        checks.push({ label: '目标 ≥2R', pass: Number.isFinite(targetR) && targetR >= 2 });
        checks.push({ label: '手数 ≥1', pass: Number.isFinite(lots) && lots >= 1 });
      } else {
        checks.push({ label: '15m 状态为混乱', pass: false });
      }
      checks.push({ label: '方向明确（HH/HL 多，LH/LL 空）', pass: bias === 'long' || bias === 'short' });

      const all = checks.every((check) => check.pass);
      let verdict;
      let tone;
      let detail;
      if (gates.length > 0) {
        verdict = '停手';
        tone = 'error';
        detail = gates.join('；');
      } else if (mode === 'chaotic') {
        verdict = '不做';
        tone = 'error';
        detail = '15m 混乱，手册要求不做。';
      } else if (!all) {
        verdict = '等待';
        tone = 'warn';
        detail = checks.filter((check) => !check.pass).map((check) => check.label).join('；');
      } else {
        verdict = bias === 'long' ? '可做多' : '可做空';
        tone = 'ok';
        detail = '规则检查全部通过；仍按信号 K、止损和 2R/1R 目标执行。';
      }
      return { gates, checks, verdict, tone, detail, mode };
    }

    // ---------------------------------------------------------------------
    // small presentational components
    // ---------------------------------------------------------------------
    function Badge({ tone, children }) {
      return h('span', { className: cls('tc-badge', tone && `tc-badge-${tone}`) }, children);
    }

    function Stat({ label, value, tone, hint }) {
      return h('div', { className: cls('tc-stat', tone && `tc-stat-${tone}`), title: hint },
        h('span', { className: 'tc-stat-label' }, label),
        h('span', { className: 'tc-stat-value' }, value));
    }

    function Empty({ children }) {
      return h('div', { className: 'tc-empty' }, children);
    }

    function Toast({ toast }) {
      if (!toast) return null;
      return h('div', { className: cls('tc-toast', toast.kind === 'error' && 'tc-toast-error') }, toast.text);
    }

    function CockpitIcon(props) {
      const size = props && props.size ? props.size : 20;
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 }),
      h('path', { d: 'M7 9v6' }), h('path', { d: 'M5.5 11h3' }),
      h('path', { d: 'M11 7v8' }), h('path', { d: 'M9.5 9.5h3' }),
      h('path', { d: 'M15 10v7' }), h('path', { d: 'M13.5 13h3' }),
      h('path', { d: 'M6 17l3.5-2.5L13 16l5-5' }));
    }

    // ---------------------------------------------------------------------
    // Kline chart
    // ---------------------------------------------------------------------
    function KlineChart({ bars, trades }) {
      if (!Array.isArray(bars) || bars.length === 0) return h(Empty, null, '这个交易日还没有 K 线数据。');
      const W = 1000;
      const H = 470;
      const left = 12;
      const right = 76;
      const top = 18;
      const bottom = 34;
      const plotW = W - left - right;
      const plotH = H - top - bottom;
      const values = [];
      for (const bar of bars) values.push(bar.low, bar.high);
      for (const trade of trades ?? []) {
        for (const value of [trade.entryPrice, trade.stopPrice, trade.targetPrice, trade.exitPrice]) {
          if (value !== null && value !== undefined && Number.isFinite(Number(value))) values.push(Number(value));
        }
      }
      let min = Math.min(...values);
      let max = Math.max(...values);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0;
        max = 1;
      }
      if (max - min < 1e-9) {
        max += 1;
        min -= 1;
      }
      const padding = (max - min) * 0.06;
      min -= padding;
      max += padding;
      const x = (index) => left + (index + 0.5) * (plotW / bars.length);
      const y = (price) => top + ((max - price) / (max - min)) * plotH;
      const candleW = Math.max(1, Math.min(10, (plotW / bars.length) * 0.62));
      const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max - (max - min) * ratio);
      const emaPoints = [];
      bars.forEach((bar, index) => {
        if (bar.ema20 !== null && bar.ema20 !== undefined) emaPoints.push(`${x(index)},${y(bar.ema20)}`);
      });
      const marks = [];
      marks.push(h('rect', { key: 'bg', x: left, y: top, width: plotW, height: plotH, fill: 'var(--dsw-alias-bg-overlay)', opacity: 0.25 }));
      grid.forEach((price, index) => {
        const lineY = y(price);
        marks.push(h('line', { key: `g${index}`, x1: left, y1: lineY, x2: left + plotW, y2: lineY, stroke: 'var(--dsw-alias-border-l1)', strokeDasharray: '3 4' }));
        marks.push(h('text', { key: `gt${index}`, x: left + plotW + 6, y: lineY + 3, fill: 'var(--dsw-alias-label-secondary)', fontSize: 10 }, price.toFixed(1)));
      });
      bars.forEach((bar, index) => {
        const bx = x(index);
        const up = bar.close >= bar.open;
        const color = up ? 'var(--tc-up)' : 'var(--tc-down)';
        const openY = y(bar.open);
        const closeY = y(bar.close);
        const bodyY = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(closeY - openY));
        marks.push(h('line', { key: `w${index}`, x1: bx, y1: y(bar.high), x2: bx, y2: y(bar.low), stroke: color, strokeWidth: 1 }));
        marks.push(h('rect', { key: `c${index}`, x: bx - candleW / 2, y: bodyY, width: candleW, height: bodyH, fill: up ? 'var(--dsw-alias-bg-base)' : color, stroke: color, strokeWidth: 1 }));
      });
      if (emaPoints.length > 1) {
        marks.push(h('polyline', { key: 'ema', points: emaPoints.join(' '), fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.4, opacity: 0.9 }));
      }
      (trades ?? []).forEach((trade, index) => {
        const entryIndex = nearestBar(bars, trade.openedAt);
        if (entryIndex < 0) return;
        const exitIndex = trade.closedAt ? nearestBar(bars, trade.closedAt) : -1;
        const long = trade.direction === 'long';
        const color = long ? 'var(--tc-up)' : 'var(--tc-down)';
        const entryX = x(entryIndex);
        const endX = exitIndex >= 0 ? x(exitIndex) : left + plotW;
        const entryY = y(trade.entryPrice);
        marks.push(h('line', { key: `el${index}`, x1: entryX, y1: entryY, x2: endX, y2: entryY, stroke: color, strokeWidth: 1, strokeDasharray: '5 4' }));
        if (trade.stopPrice !== null && trade.stopPrice !== undefined) {
          marks.push(h('line', { key: `sl${index}`, x1: left, y1: y(trade.stopPrice), x2: left + plotW, y2: y(trade.stopPrice), stroke: 'var(--dsw-alias-state-error-primary)', strokeWidth: 0.8, strokeDasharray: '2 4', opacity: 0.7 }));
        }
        if (trade.targetPrice !== null && trade.targetPrice !== undefined) {
          marks.push(h('line', { key: `tl${index}`, x1: left, y1: y(trade.targetPrice), x2: left + plotW, y2: y(trade.targetPrice), stroke: 'var(--dsw-alias-state-success-primary)', strokeWidth: 0.8, strokeDasharray: '2 4', opacity: 0.7 }));
        }
        marks.push(h('circle', { key: `ed${index}`, cx: entryX, cy: entryY, r: 3.5, fill: color, stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 1 }));
        marks.push(h('text', { key: `et${index}`, x: entryX + 6, y: entryY + (long ? 14 : -8), fill: color, fontSize: 10, fontWeight: 600 }, `${long ? '多' : '空'} ${trade.lots}手`));
        if (exitIndex >= 0 && trade.exitPrice !== null && trade.exitPrice !== undefined) {
          const exitX = x(exitIndex);
          const exitY = y(trade.exitPrice);
          marks.push(h('circle', { key: `xd${index}`, cx: exitX, cy: exitY, r: 3, fill: 'var(--dsw-alias-label-primary)' }));
          const pnl = trade.pnl === null || trade.pnl === undefined ? '' : ` ${trade.pnl >= 0 ? '+' : ''}${trade.pnl}`;
          marks.push(h('text', { key: `xt${index}`, x: exitX + 6, y: exitY + (long ? -8 : 14), fill: 'var(--dsw-alias-label-primary)', fontSize: 10 }, `平${pnl}`));
        }
      });
      const ticks = Math.min(5, bars.length);
      for (let index = 0; index < ticks; index += 1) {
        const at = Math.round(((bars.length - 1) * index) / Math.max(1, ticks - 1));
        const first = index === 0;
        const last = index === ticks - 1;
        marks.push(h('text', {
          key: `tm${index}`,
          x: x(at) + (first ? 4 : last ? -4 : 0),
          y: H - 10,
          fill: 'var(--dsw-alias-label-secondary)',
          fontSize: 9,
          textAnchor: first ? 'start' : last ? 'end' : 'middle',
        }, bars[at].time.slice(5, 16)));
      }
      return h('div', { className: 'tc-chart-wrap' },
        h('svg', { className: 'tc-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '当日 K 线与交易标记' }, marks));
    }

    // ---------------------------------------------------------------------
    // Rules tab
    // ---------------------------------------------------------------------
    function RulesPanel({ rules, setRules, onSearch, onOpenSection, account }) {
      const quick = [
        ['单笔风险', `¥${account?.maxTradeRisk ?? 600} / 2%`],
        ['日亏上限', `¥${account?.maxDailyLoss ?? 1200} / 4%`],
        ['止损上限', '120 点（TR 30 点）'],
        ['手数公式', 'min(600÷(止损×乘数), 8000÷保证金)'],
        ['禁开仓', '9:18 前 · 10:30 首根 · 11:25 后 · 13:39 前 · 14:45 后 · 22:45 后'],
        ['离场优先', '硬止损 > 反向信号K > 回撤50% > 止盈 > 6根3m > 收盘'],
      ];
      return h('div', { className: 'tc-rules' },
        h('aside', { className: 'tc-card tc-outline' },
          h('div', { className: 'tc-card-title' }, '章节目录'),
          h('div', { className: 'tc-outline-list' },
            (rules.outline ?? []).map((item) => h('button', {
              key: item.id,
              className: cls('tc-outline-item', rules.section?.id === item.id && 'is-active'),
              onClick: () => onOpenSection(item.id),
            },
            h('span', { className: 'tc-outline-title' }, item.title),
            h('span', { className: 'tc-outline-line' }, `L${item.line}`)))),
        ),
        h('section', { className: 'tc-card tc-rule-main' },
          h('form', { className: 'tc-search', onSubmit: onSearch },
            h('input', {
              className: 'tc-input tc-search-input',
              value: rules.query,
              placeholder: '搜规则：手数 / TR 边界 / 止损 / 移动止损 / 复盘 …',
              onChange: (event) => setRules((previous) => ({ ...previous, query: event.target.value })),
            }),
            h('button', { className: 'tc-btn tc-btn-primary', type: 'submit', disabled: rules.loading }, rules.loading ? '检索中…' : '检索')),
          rules.section
            ? h('div', { className: 'tc-rule-section' },
                h('div', { className: 'tc-rule-section-head' },
                  h('div', null,
                    h('div', { className: 'tc-rule-section-title' }, rules.section.title),
                    h('div', { className: 'tc-muted' }, `第 ${rules.section.line}-${rules.section.endLine} 行 · ${rules.section.path.join(' / ')}`)),
                  h('button', { className: 'tc-btn', onClick: () => setRules((previous) => ({ ...previous, section: null })) }, '返回')),
                h('div', { className: 'tc-code' },
                  rules.section.body.split('\n').map((line, index) => h('div', { key: index, className: 'tc-code-line' },
                    h('span', { className: 'tc-line-no' }, rules.section.line + index),
                    h('span', { className: 'tc-code-text' }, line || ' ')))))
            : rules.results
              ? h('div', { className: 'tc-rule-results' },
                  h('div', { className: 'tc-muted tc-result-count' }, `找到 ${rules.results.length} 节；点标题看原文。`),
                  rules.results.length === 0 ? h(Empty, null, '没有匹配的规则。') : null,
                  rules.results.map((result) => h('button', {
                    key: result.id,
                    className: 'tc-rule-result',
                    onClick: () => onOpenSection(result.id),
                  },
                  h('div', { className: 'tc-rule-result-head' },
                    h('strong', null, result.title),
                    h('span', { className: 'tc-muted' }, `L${result.line}`)),
                  h('div', { className: 'tc-rule-snippet' }, result.snippet))))
              : h('div', { className: 'tc-rule-quick' },
                  h('div', { className: 'tc-muted' }, '速查（以手册原文为准；左侧目录可看全文）：'),
                  h('div', { className: 'tc-quick-grid' },
                    quick.map(([label, value]) => h('div', { key: label, className: 'tc-quick-card' },
                      h('span', { className: 'tc-quick-label' }, label),
                      h('strong', { className: 'tc-quick-value' }, value)))),
                  h(Empty, null, '输入关键词检索；结果会显示章节、行号和原文片段。'))));
    }

    // ---------------------------------------------------------------------
    // Trades tab
    // ---------------------------------------------------------------------
    function DraftCard({ draft, onConfirm, onDiscard }) {
      const [form, setForm] = React.useState(() => draftForm(draft.trade));
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState('');
      const set = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));
      const field = (name, label, type, options) =>
        h('label', { className: 'tc-field' },
          h('span', { className: 'tc-field-label' }, label),
          type === 'select'
            ? h('select', { className: 'tc-select', value: form[name], onChange: (event) => set(name, event.target.value) },
                options.map(([value, text]) => h('option', { key: value, value }, text)))
            : h('input', {
                className: 'tc-input', type,
                step: type === 'number' ? '0.001' : undefined,
                value: form[name],
                onChange: (event) => set(name, event.target.value),
              }));
      const stopMissing = !(Number(form.stopPrice) > 0);
      const submit = async () => {
        if (stopMissing) {
          setError('账户截图通常没有止损；先补止损价再入账。');
          return;
        }
        setSaving(true);
        setError('');
        const ok = await onConfirm(draft, {
          symbol: form.symbol,
          direction: form.direction,
          openedAt: toIsoInput(form.entryTime),
          entryPrice: Number(form.entryPrice),
          stopPrice: Number(form.stopPrice),
          targetPrice: form.targetPrice === '' ? null : Number(form.targetPrice),
          lots: Number(form.lots),
          multiplier: form.multiplier === '' ? null : Number(form.multiplier),
          closedAt: form.exitTime ? toIsoInput(form.exitTime) : null,
          exitPrice: form.exitPrice === '' ? null : Number(form.exitPrice),
          note: draft.trade.note,
          source: 'screenshot',
          extended: draft.trade.extended,
        });
        setSaving(false);
        if (!ok) setError('入账失败：先检查字段，再点一次。');
      };
      return h('div', { className: 'tc-draft' },
        h('div', { className: 'tc-draft-head' },
          h('strong', null, `${draft.trade.symbol} 截图草稿`),
          h('span', { className: 'tc-muted' }, fmtDateTime(draft.createdAt))),
        h('div', { className: 'tc-draft-prices' }, '识别结果；可直接改字段，补止损后入账。'),
        h('div', { className: 'tc-draft-grid' },
          field('symbol', '合约', 'text'),
          field('direction', '方向', 'select', [['long', '做多'], ['short', '做空']]),
          field('lots', '手数', 'number'),
          field('entryPrice', '入场价', 'number'),
          field('stopPrice', '止损价（必填）', 'number'),
          field('targetPrice', '目标价', 'number'),
          field('entryTime', '入场时间', 'datetime-local'),
          field('exitTime', '离场时间', 'datetime-local'),
          field('exitPrice', '离场价', 'number')),
        draft.warnings?.length > 0 ? h('div', { className: 'tc-warn-text' }, draft.warnings.join('；')) : null,
        error ? h('div', { className: 'tc-error tc-form-error' }, error) : null,
        h('div', { className: 'tc-draft-actions' },
          h('button', { className: 'tc-btn tc-btn-primary', type: 'button', disabled: saving || stopMissing, onClick: submit },
            saving ? '保存中…' : stopMissing ? '补止损后可入账' : '确认入账'),
          h('button', { className: 'tc-btn', type: 'button', onClick: () => onDiscard(draft.id) }, '丢弃')));
    }

    function TradesPanel({ state, form, setForm, formError, saving, onSubmit, symbol, confirmId, onDelete, onConfirmDraft, onDiscardDraft }) {
      const setField = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));
      const field = (name, label, type, options) =>
        h('label', { className: 'tc-field' },
          h('span', { className: 'tc-field-label' }, label),
          type === 'select'
            ? h('select', { className: 'tc-select', value: form[name], onChange: (event) => setField(name, event.target.value) },
                options.map(([value, text]) => h('option', { key: value, value }, text)))
            : h('input', {
                className: 'tc-input',
                type,
                step: type === 'number' ? '0.001' : undefined,
                value: form[name],
                onChange: (event) => setField(name, event.target.value),
              }));
      const trades = state?.trades ?? [];
      const drafts = state?.drafts ?? [];
      const summary = state?.summary;
      return h('div', { className: 'tc-trades' },
        h('section', { className: 'tc-card tc-trade-list' },
          h('div', { className: 'tc-card-head' },
            h('div', { className: 'tc-card-title' }, `当日交易 · ${state?.day ?? ''}`),
            h('span', { className: 'tc-muted' }, `${summary?.closedCount ?? 0} 已平 / ${summary?.openCount ?? 0} 持仓`)),
          h('div', { className: 'tc-summary-row' },
            h(Stat, { label: '日盈亏', value: `¥${fmtMoney(summary?.dailyPnl)}`, tone: (summary?.dailyPnl ?? 0) < 0 ? 'error' : (summary?.dailyPnl ?? 0) > 0 ? 'ok' : undefined }),
            h(Stat, { label: '胜率', value: `${summary?.winRate ?? 0}%` }),
            h(Stat, { label: '连亏', value: summary?.consecutiveLosses ?? 0, tone: (summary?.consecutiveLosses ?? 0) >= 3 ? 'error' : undefined }),
            h(Stat, { label: '连赢', value: summary?.consecutiveWins ?? 0, tone: (summary?.consecutiveWins ?? 0) >= 4 ? 'warn' : undefined }),
            h(Stat, { label: '日亏剩余', value: `¥${fmtMoney(summary?.dailyLossRemaining)}` })),
          trades.length === 0
            ? h(Empty, null, '今天还没有交易记录。右侧手工录入，或在聊天里发截图生成草稿。')
            : h('div', { className: 'tc-trade-items' }, trades.map((trade) => h('div', { key: trade.id, className: cls('tc-trade', trade.direction === 'long' ? 'is-long' : 'is-short') },
                h('div', { className: 'tc-trade-head' },
                  h('div', { className: 'tc-trade-title' },
                    h('strong', null, trade.symbol),
                    h(Badge, { tone: trade.direction === 'long' ? 'ok' : 'error' }, trade.direction === 'long' ? '多' : '空'),
                    h('span', { className: 'tc-muted' }, `${trade.lots} 手 · ${fmtTime(trade.openedAt)}`)),
                  h('div', { className: 'tc-trade-actions' },
                    h('button', { className: cls('tc-btn', 'tc-btn-danger'), onClick: () => onDelete(trade.id) }, confirmId === trade.id ? '确认删除' : '删除'))),
                h('div', { className: 'tc-trade-prices' },
                  h('span', null, `入 ${fmtPrice(trade.entryPrice)}`),
                  h('span', null, `止 ${fmtPrice(trade.stopPrice)}`),
                  h('span', null, `标 ${fmtPrice(trade.targetPrice)}`),
                  h('span', null, trade.closedAt ? `出 ${fmtPrice(trade.exitPrice)}` : '持仓中')),
                h('div', { className: 'tc-trade-foot' },
                  h('span', { className: cls('tc-pnl', (trade.pnl ?? 0) > 0 ? 'is-ok' : (trade.pnl ?? 0) < 0 ? 'is-error' : '') }, trade.pnl === null || trade.pnl === undefined ? '未平仓' : `盈亏 ¥${fmtMoney(trade.pnl)}`),
                  h('span', { className: 'tc-muted' }, [trade.extended?.state15m, trade.extended?.pattern, trade.note].filter(Boolean).join(' · '))))))),
          drafts.length > 0
            ? h('div', { className: 'tc-drafts' },
                h('div', { className: 'tc-card-title tc-drafts-title' }, '截图草稿'),
                drafts.map((draft) => h(DraftCard, { key: draft.id, draft, onConfirm: onConfirmDraft, onDiscard: onDiscardDraft })))
            : null,
        h('section', { className: 'tc-card tc-trade-form' },
          h('div', { className: 'tc-card-title' }, '录入交易'),
          h('form', { onSubmit },
            h('div', { className: 'tc-form-grid' },
              field('direction', '方向', 'select', [['long', '做多'], ['short', '做空']]),
              field('entryTime', '入场时间', 'datetime-local'),
              field('entryPrice', '入场价', 'number'),
              field('stopPrice', '止损价', 'number'),
              field('targetPrice', '目标价', 'number'),
              field('lots', '手数', 'number'),
              field('multiplier', '合约乘数', 'number'),
              field('exitTime', '离场时间', 'datetime-local'),
              field('exitPrice', '离场价', 'number'),
              field('state15m', '15m 状态', 'select', MODE_OPTIONS),
              field('pattern', '形态', 'text')),
            h('label', { className: 'tc-field tc-field-wide' },
              h('span', { className: 'tc-field-label' }, '备注'),
              h('textarea', { className: 'tc-textarea', rows: 2, value: form.note, onChange: (event) => setField('note', event.target.value) })),
            formError ? h('div', { className: 'tc-error tc-form-error' }, formError) : null,
            h('div', { className: 'tc-form-actions' },
              h('button', { className: 'tc-btn tc-btn-primary', type: 'submit', disabled: saving }, saving ? '保存中…' : '保存交易'),
              h('button', { className: 'tc-btn', type: 'button', onClick: () => setForm(emptyForm(symbol)) }, '重置'))),
          h('div', { className: 'tc-muted tc-form-hint' }, '结构错误会拦截；止损过大、风险超 600、禁开仓时段等只告警。')));
    }

    // ---------------------------------------------------------------------
    // Decision tab
    // ---------------------------------------------------------------------
    function Toggle({ value, onChange, yes = '是', no = '否' }) {
      return h('div', { className: 'tc-toggle' },
        h('button', { type: 'button', className: cls('tc-toggle-btn', value === true && 'is-on'), onClick: () => onChange(true) }, yes),
        h('button', { type: 'button', className: cls('tc-toggle-btn', value === false && 'is-on'), onClick: () => onChange(false) }, no));
    }

    function DecisionPanel({ state, decision, setDecision }) {
      const patch = (name, value) => setDecision((previous) => ({ ...previous, [name]: value }));
      const result = evaluateDecision(decision, state);
      const gatesFailed = result.gates.length > 0;
      return h('div', { className: 'tc-decision' },
        h('section', { className: 'tc-card tc-decision-inputs' },
          h('div', { className: 'tc-card-title' }, '当前判断'),
          h('label', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '15m 状态'),
            h('select', { className: 'tc-select', value: decision.state15m, onChange: (event) => patch('state15m', event.target.value) },
              MODE_OPTIONS.map(([value, text]) => h('option', { key: value, value }, text)))),
          h('label', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '方向偏向'),
            h('select', { className: 'tc-select', value: decision.bias, onChange: (event) => patch('bias', event.target.value) },
              h('option', { value: 'long' }, '做多（HH/HL）'),
              h('option', { value: 'short' }, '做空（LH/LL）'),
              h('option', { value: 'none' }, '不明确'))),
          h('div', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '3m 未反向'),
            h(Toggle, { value: decision.aligned3m, onChange: (value) => patch('aligned3m', value) })),
          h('div', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '回踩 ≤1 ATR / 回踩不破'),
            h(Toggle, { value: decision.pullback, onChange: (value) => patch('pullback', value) })),
          h('div', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, 'TR 边缘 ±0.5 ATR'),
            h(Toggle, { value: decision.atEdge, onChange: (value) => patch('atEdge', value) })),
          h('div', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '信号 K 成立'),
            h(Toggle, { value: decision.signal, onChange: (value) => patch('signal', value) })),
          h('label', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '止损（点）'),
            h('input', { className: 'tc-input', type: 'number', step: '0.1', value: decision.stopPoints, onChange: (event) => patch('stopPoints', event.target.value) })),
          h('label', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '目标（R）'),
            h('input', { className: 'tc-input', type: 'number', step: '0.1', value: decision.targetR, onChange: (event) => patch('targetR', event.target.value) })),
          h('label', { className: 'tc-field' }, h('span', { className: 'tc-field-label' }, '手数'),
            h('input', { className: 'tc-input', type: 'number', step: '1', value: decision.lots, onChange: (event) => patch('lots', event.target.value) })),
          h('div', { className: 'tc-muted tc-form-hint' }, '这是规则校验器，不读取行情自动判断；状态和方向由你按 15m 图选择。')),
        h('section', { className: 'tc-flow' },
          h('div', { className: cls('tc-node', gatesFailed ? 'is-fail' : 'is-pass') },
            h('div', { className: 'tc-node-title' }, '① 风控闸门'),
            result.gates.length > 0 ? h('ul', { className: 'tc-node-list' }, result.gates.map((gate) => h('li', { key: gate }, gate))) : h('div', { className: 'tc-node-detail' }, '时段可开仓，无日亏/连亏/连赢/持仓闸门。'),
            h('div', { className: 'tc-branch' }, gatesFailed ? '否 → 停手' : '是 → 继续')),
          h('div', { className: 'tc-arrow' }, '↓'),
          h('div', { className: 'tc-node is-info' },
            h('div', { className: 'tc-node-title' }, '② 15m 状态'),
            h('div', { className: 'tc-node-detail' }, `${MODE_LABELS[decision.state15m]} · 方向 ${decision.bias === 'long' ? '多' : decision.bias === 'short' ? '空' : '不明确'}`)),
          h('div', { className: 'tc-arrow' }, '↓'),
          h('div', { className: cls('tc-node', result.mode === 'chaotic' ? 'is-fail' : 'is-info') },
            h('div', { className: 'tc-node-title' }, '③ 模式映射'),
            h('div', { className: 'tc-node-detail' }, decision.state15m === 'trend' ? '趋势模式：趋势回调 / TR 突破回踩，要求 3m 不反向。' : decision.state15m === 'tr' ? 'TR 模式：边缘反转 / 突破回踩，不要求 3m 不反向。' : decision.state15m === 'breakout' ? '已确认突破：回踩不破 + 信号 K。' : '混乱：手册要求不做。')),
          h('div', { className: 'tc-arrow' }, '↓'),
          h('div', { className: 'tc-node is-info' },
            h('div', { className: 'tc-node-title' }, '④ 逐项检查'),
            h('div', { className: 'tc-checks' }, result.checks.map((check) => h('div', { key: check.label, className: cls('tc-check', check.pass ? 'is-pass' : 'is-fail') },
              h('span', { className: 'tc-check-mark' }, check.pass ? '✓' : '✕'),
              h('span', null, check.label),
              h('span', { className: 'tc-check-branch' }, check.pass ? '是 → 继续' : '否 → 停'))))),
          h('div', { className: 'tc-arrow' }, '↓'),
          h('div', { className: cls('tc-verdict', `is-${result.tone}`) },
            h('div', { className: 'tc-verdict-label' }, '终局'),
            h('div', { className: 'tc-verdict-value' }, result.verdict),
            h('div', { className: 'tc-verdict-detail' }, result.detail)),
          h('div', { className: 'tc-refs' },
            h('div', { className: 'tc-muted' }, '规则出处：5.1/5.2 模式映射 · 5.3 信号 K · 5.4 位置 · 6.2 入场 · 6.3 止损 · 6.4 目标 · 6.5 手数 · 8 持仓 · 9.1 离场 · 12 错误标签。'))),
        );
    }

    // ---------------------------------------------------------------------
    // Panel

    // ---------------------------------------------------------------------
    // 模块板
    // ---------------------------------------------------------------------
    const PAGE_SIZE = 10;
    const PATTERN_OPTIONS = ['H1', 'H2', 'L1', 'L2', 'PIN', 'TR 反转', 'BREAKOUT', 'REVERSAL'];

    const ERROR_CODES = [
      ['E1', '入场太早'], ['E2', '入场太晚'], ['E3', '止损太紧'], ['E4', '止盈不合理'],
      ['E5', '逆势加仓'], ['E6', '偏离计划'], ['E7', '追单 / 情绪单'], ['E8', '手数过大'],
    ];
    const ERR_LABEL = {
      E1: '入场太早', E2: '入场太晚', E3: '止损太紧', E4: '止盈不合理',
      E5: '逆势加仓', E6: '偏离计划', E7: '追单 / 情绪单', E8: '手数过大',
    };
    const CLOSE_SECONDS = 15 * 3600 + 6 * 60;

    function two(value) {
      return String(value).padStart(2, '0');
    }

    function signedMoney(value) {
      const number = Number(value) || 0;
      if (number === 0) return '¥0';
      return `${number < 0 ? '−' : '+'}¥${Math.abs(number).toFixed(0)}`;
    }

    function plainMoney(value) {
      const number = Number(value) || 0;
      return `¥${Math.round(Math.abs(number)).toLocaleString('en-US')}`;
    }

    function secondsOfDay(date) {
      return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
    }

    function countdownText(session, live = true) {
      if (!live) return { text: '复盘', sub: '历史交易日' };
      if (session && session.open === false) return { text: '休市', sub: session.phase || '休市' };
      const left = CLOSE_SECONDS - secondsOfDay(new Date());
      if (left <= 0) return { text: '00:00', sub: '已收盘' };
      const minutes = Math.floor(left / 60);
      const seconds = left % 60;
      const canOpen = session ? session.canOpen : true;
      return {
        text: `${two(minutes)}:${two(seconds)}`,
        sub: canOpen ? `14:45 起禁开 · 剩 ${two(minutes)}:${two(seconds)}` : '已禁开新仓',
      };
    }

    function openPrice(trades, symbol, price) {
      if (!price) return 0;
      let total = 0;
      for (const trade of trades) {
        if (trade.symbol !== symbol || trade.exitPrice !== null && trade.exitPrice !== undefined) continue;
        const direction = trade.direction === 'short' ? -1 : 1;
        total += (price - trade.entryPrice) * direction * (trade.lots ?? 0) * (trade.multiplier ?? 1);
      }
      return total;
    }

    function mixFrom(trades) {
      const counts = new Map();
      for (const trade of trades) {
        const errors = Array.isArray(trade.extended?.errors) ? trade.extended.errors : [];
        for (const code of errors) counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
      return { rows: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]), total };
    }

    function gateChecks(summary, session, live = true) {
      const dailyCap = 1200;
      const loss = summary?.dailyPnl ?? 0;
      return [
        { id: '01', name: '时段允许开新仓', value: live ? (session?.canOpen ? '可开仓' : (session?.reason ?? '禁开仓')) : '历史复盘', pass: live ? !!session?.canOpen : true },
        { id: '02', name: '当日亏损未触及上限', value: `${plainMoney(loss)} / ${plainMoney(dailyCap)}`, pass: loss > -dailyCap },
        { id: '03', name: '连续止损少于 3 笔', value: `${summary?.consecutiveLosses ?? 0} / 3`, pass: (summary?.consecutiveLosses ?? 0) < 3 },
        { id: '04', name: '连续盈利少于 4 笔', value: `${summary?.consecutiveWins ?? 0} / 4`, pass: (summary?.consecutiveWins ?? 0) < 4 },
        { id: '05', name: '无持仓、无挂单', value: `${summary?.openCount ?? 0} 笔持仓`, pass: (summary?.openCount ?? 0) === 0 },
      ];
    }

    function Chip({ children, tone }) {
      return h('span', { className: cls('tc-chip', tone && `is-${tone}`) }, children);
    }

    function KpiCard({ summary, session, trades, symbol, price, clock, day, live = true }) {
      const down = countdownText(session, live);
      const float = openPrice(trades, symbol, price);
      const realized = summary?.dailyPnl ?? 0;
      const left = (summary?.dailyLossRemaining ?? 0);
      const tr = session?.tr;
      return h('section', { className: 'tc-mod tc-kpi' },
        h('div', { className: 'tc-stat-head' },
          h('span', { className: 'tc-stamp' },
            h('b', null, day || clock.day),
            h('i', null, '·'),
            h('span', null, live ? (session?.phase ?? '—') : '历史复盘'),
            h('i', null, '·'),
            h('span', { className: 'mono' }, clock.time)),
          tr ? h('span', { className: 'tc-stamp-r' }, tr) : null),
        h('div', { className: 'tc-kpis' },
          h('div', { className: 'tc-kpi-cell' },
            h('span', { className: 'tc-kpi-label' }, '距收盘'),
            h('b', { className: 'tc-kpi-value mono' }, down.text),
            h('span', { className: 'tc-kpi-sub' }, down.sub)),
          h('div', { className: 'tc-kpi-cell' },
            h('span', { className: 'tc-kpi-label' }, '当日已实现'),
            h('b', { className: cls('tc-kpi-value', realized > 0 ? 'is-up' : realized < 0 ? 'is-down' : '') }, signedMoney(realized)),
            h('span', { className: 'tc-kpi-sub' }, `${summary?.closedCount ?? 0} 笔 · 胜率 ${summary?.winRate ?? 0}%`)),
          h('div', { className: 'tc-kpi-cell' },
            h('span', { className: 'tc-kpi-label' }, '持仓浮动'),
            h('b', { className: cls('tc-kpi-value', float > 0 ? 'is-up' : float < 0 ? 'is-down' : '') }, signedMoney(float)),
            h('span', { className: 'tc-kpi-sub' }, `${summary?.openCount ?? 0} 笔持仓${price ? ` · 现价 ${fmtPrice(price)}` : ''}`)),
          h('div', { className: 'tc-kpi-cell' },
            h('span', { className: 'tc-kpi-label' }, '日亏剩余'),
            h('b', { className: 'tc-kpi-value' }, plainMoney(left)),
            h('span', { className: 'tc-kpi-sub' }, `上限 ¥1,200 · 已用 ${plainMoney(Math.max(0, -realized))}`))));
    }

    function MixPanel({ stats, trades, onManage }) {
      const fallback = mixFrom(trades);
      const rows = stats?.errors?.length
        ? stats.errors
        : fallback.rows.map(([code, count]) => ({ code, label: ERR_LABEL[code] ?? '', count, today: 0 }));
      const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
      return h('section', { className: 'tc-mod' },
        h('div', { className: 'tc-mod-head' },
          h('span', { className: 'tc-num' }, '01'),
          h('h2', null, '失误清单'),
          h('button', { className: 'tc-icon-btn tc-mod-action', title: '管理错误库', onClick: onManage }, '⚙'),
          h('span', { className: 'tc-aside' }, total > 0 ? `累计 ${total} 次 · ${rows.length} 类` : '无记录')),
        rows.length === 0
          ? h('div', { className: 'tc-empty-line' }, '还没有记录失误——保持住')
          : h('div', { className: 'tc-mix' }, rows.map((row) =>
              h('div', { key: row.code, className: 'tc-mix-cell' },
                h('span', { className: 'tc-mix-code' }, row.code),
                h('span', { className: 'tc-mix-note' }, row.label || ERR_LABEL[row.code] || '已从字典删除'),
                row.today > 0 ? h('span', { className: 'tc-mix-today' }, `今天 ${row.today}`) : null,
                h('span', { className: 'tc-mix-count' }, `×${row.count}`)))));
    }

    function GatePanel({ summary, session, symbol, trades, live = true }) {
      const checks = gateChecks(summary, session, live);
      const blocked = checks.filter((check) => !check.pass);
      const canOpen = blocked.length === 0;
      const openTrade = trades.find((trade) => trade.symbol === symbol && (trade.exitPrice === null || trade.exitPrice === undefined));
      return h('section', { className: 'tc-mod tc-gate' },
        h('div', { className: 'tc-mod-head' },
          h('span', { className: 'tc-num' }, '02'),
          h('h2', null, '风险闸门'),
          h('span', { className: 'tc-aside' }, `${checks.length} 项 · ${checks.length - blocked.length} 通过 · ${blocked.length} 拦截`)),
        h('div', { className: 'tc-gate-verdict' },
          h('span', { className: 'tc-gate-verdict-label' }, '当前结论'),
          h('b', { className: cls('tc-gate-word', canOpen ? 'is-ok' : 'is-no') }, canOpen ? '可做' : '不做'),
          h('p', { className: 'tc-gate-why' },
            blocked.length === 0
              ? '五项闸门全部通过，按手册找 H2 / L2 再进。'
              : `${blocked[0].name}：${blocked[0].value}。${openTrade ? '等平仓或止损后再找信号。' : '先处理这一项再找信号。'}`),
          openTrade
            ? h('span', { className: 'tc-gate-meta' }, `${openTrade.direction === 'long' ? '多' : '空'} ${openTrade.lots} 手 @ ${fmtPrice(openTrade.entryPrice)}`)
            : null),
        h('div', { className: 'tc-gate-checks' }, checks.map((check) =>
          h('div', { key: check.id, className: cls('tc-gate-check', !check.pass && 'is-bad') },
            h('span', { className: 'tc-gate-id' }, check.id),
            h('span', { className: 'tc-gate-name' }, check.name),
            h('span', { className: 'tc-gate-value' }, check.value),
            h('span', { className: 'tc-gate-state' }, check.pass ? '通过' : '拦截')))));
    }

    function ChartPanel({ kline, trades, symbol, symbols, onSymbol, klineType, onChangeType, loading, error }) {
      const price = kline?.bars?.length ? kline.bars[kline.bars.length - 1].close : null;
      return h('section', { className: 'tc-mod' },
        h('div', { className: 'tc-mod-head' },
          h('span', { className: 'tc-num' }, '03'),
          h('h2', null, '盘中走势'),
          h('select', { className: 'tc-mini-select', value: symbol, onChange: (event) => onSymbol(event.target.value) },
            (symbols ?? SYMBOLS).map((item) => h('option', { key: item, value: item }, item))),
          h('span', { className: 'tc-aside mono' }, kline
            ? `ATR14 ${kline.atr14 ?? '—'} · EMA20 ${kline.ema20Last ?? '—'}`
            : '')),
        h('div', { className: 'tc-chart-bar' },
          h('div', { className: 'tc-seg' },
            h('button', { className: cls('tc-seg-btn', klineType === 3 && 'is-on'), onClick: () => onChangeType(3) }, '3m'),
            h('button', { className: cls('tc-seg-btn', klineType === 15 && 'is-on'), onClick: () => onChangeType(15) }, '15m')),
          h('div', { className: 'tc-legend' },
            h('span', null, h('i', { className: 'tc-sw is-up' }), '上涨'),
            h('span', null, h('i', { className: 'tc-sw is-down' }), '下跌'),
            h('span', null, h('i', { className: 'tc-sw is-ema' }), 'EMA20'),
            h('span', null, h('i', { className: 'tc-sw is-stop' }), '止损'),
            h('span', null, h('i', { className: 'tc-sw is-target' }), '目标')),
          h('span', { className: 'tc-aside mono' }, kline ? `${kline.bars?.length ?? 0} 根 · 更新 ${fmtTime(kline.fetchedAt)}` : '')),
        error ? h('div', { className: 'tc-inline-error' }, error) : null,
        loading && !kline ? h('div', { className: 'tc-empty-line' }, '正在拉取 K 线…') : null,
        kline ? h('div', { className: 'tc-chart-body' },
          h(KlineChart, { bars: kline.bars, trades: trades.filter((trade) => trade.symbol === symbol) })) : null,
        kline?.warning ? h('div', { className: 'tc-inline-warn' }, kline.warning) : null);
    }

    function TradesPanel2({ trades, symbol, onDelete, confirmId, onAdd }) {
      const [filter, setFilter] = useState({ pat: '', sym: '', q: '', page: 1, day: '' });
      const setField = (name, value) => setFilter((previous) => ({ ...previous, [name]: value, page: 1 }));
      const rows = useMemo(() => {
        const query = filter.q.trim().toLowerCase();
        return trades.filter((trade) => {
          const pat = trade.extended?.pattern ?? trade.extended?.state15m ?? '';
          if (filter.pat && pat !== filter.pat) return false;
          if (filter.sym && trade.symbol !== filter.sym) return false;
          if (!query) return true;
          const hay = [trade.tradingDay, fmtTime(trade.openedAt), pat, trade.symbol, trade.note, trade.direction === 'long' ? '多' : '空']
            .filter(Boolean).join(' ').toLowerCase();
          return hay.includes(query);
        });
      }, [trades, filter]);
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      const page = Math.min(filter.page, pages);
      const view = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const closed = rows.filter((trade) => trade.exitPrice !== null && trade.exitPrice !== undefined);
      const net = closed.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
      const rate = closed.length === 0 ? 0 : Math.round((closed.filter((trade) => (trade.pnl ?? 0) > 0).length / closed.length) * 100);
      const patSet = Array.from(new Set(trades.map((trade) => trade.extended?.pattern ?? trade.extended?.state15m).filter(Boolean)));
      const symSet = Array.from(new Set(trades.map((trade) => trade.symbol).filter(Boolean)));
      return h('section', { className: 'tc-mod' },
        h('div', { className: 'tc-mod-head' },
          h('span', { className: 'tc-num' }, '04'),
          h('h2', null, '交易记录'),
          h('button', { className: 'tc-btn tc-btn-sm tc-mod-action', onClick: onAdd }, '＋ 添加交易'),
          h('span', { className: 'tc-aside' }, `共 ${rows.length} 笔 · 第 ${page}/${pages} 页`)),
        h('div', { className: 'tc-filters' },
          h('select', { className: 'tc-mini-select', value: filter.pat, onChange: (event) => setField('pat', event.target.value) },
            h('option', { value: '' }, '全部形态'),
            patSet.map((item) => h('option', { key: item, value: item }, item))),
          h('select', { className: 'tc-mini-select', value: filter.sym, onChange: (event) => setField('sym', event.target.value) },
            h('option', { value: '' }, '全部品种'),
            symSet.map((item) => h('option', { key: item, value: item }, item))),
          h('input', {
            className: 'tc-mini-input', placeholder: '搜索形态 / 备注 / 时间',
            value: filter.q, onChange: (event) => setField('q', event.target.value),
          }),
          h('button', { className: 'tc-btn tc-btn-sm', onClick: () => setFilter({ pat: '', sym: '', q: '', page: 1, day: '' }) }, '重置')),
        h('div', { className: 'tc-table tc-t-list' },
          h('div', { className: 'tc-tr is-head' },
            h('span', null, '日期'), h('span', null, '时间'), h('span', null, '方向'),
            h('span', null, '形态'), h('span', null, '品种'), h('span', null, '入场'),
            h('span', null, '手数'), h('span', null, '状态'), h('span', null, '错'), h('span', null, '盈亏'),
            h('span', { className: 'tc-note-col' }, '备注'), h('span', null, '')),
          view.length === 0
            ? h('div', { className: 'tc-empty-line' }, '没有符合条件的记录')
            : view.map((trade) =>
                h('div', { key: trade.id, className: 'tc-tr' },
                  h('span', { className: 'mono' }, (trade.tradingDay ?? '').slice(5)),
                  h('span', { className: 'mono' }, fmtTime(trade.openedAt)),
                  h('span', { className: cls('tc-dir', trade.direction === 'long' ? 'is-long' : 'is-short') }, trade.direction === 'long' ? '多' : '空'),
                  h('span', { className: 'mono' }, trade.extended?.pattern ?? trade.extended?.state15m ?? '—'),
                  h('span', null, trade.symbol),
                  h('span', { className: 'mono' }, fmtPrice(trade.entryPrice)),
                  h('span', { className: 'mono' }, trade.lots),
                  h('span', null, trade.exitPrice === null || trade.exitPrice === undefined
                    ? h('em', { className: 'tc-tag is-live' }, '持仓')
                    : h('em', { className: 'tc-tag' }, '已平')),
                  h('span', { className: 'tc-errs mono' }, (trade.extended?.errors ?? []).join(' ') || '—'),
                  h('span', { className: cls('mono', (trade.pnl ?? 0) > 0 ? 'is-up' : (trade.pnl ?? 0) < 0 ? 'is-down' : '') },
                    trade.pnl === null || trade.pnl === undefined ? '—' : signedMoney(trade.pnl)),
                  h('span', { className: 'tc-note-col tc-note' }, trade.note || ''),
                  h('span', null, h('button', { className: 'tc-icon-btn', title: '删除', onClick: () => onDelete(trade.id) }, confirmId === trade.id ? '确认' : '✕')))),
          ),
        h('div', { className: 'tc-mod-foot' },
          h('span', null, `净 ${signedMoney(net)} · ${closed.length} 笔已平 · 胜率 ${rate}%`),
          h('div', { className: 'tc-pager' },
            h('button', { className: 'tc-page-btn', disabled: page <= 1, onClick: () => setFilter((previous) => ({ ...previous, page: page - 1 })) }, '‹'),
            h('span', { className: 'mono' }, `${page} / ${pages}`),
            h('button', { className: 'tc-page-btn', disabled: page >= pages, onClick: () => setFilter((previous) => ({ ...previous, page: page + 1 })) }, '›'))));
    }

    function AddTradeDialog({
      open, onClose, form, setForm, onSubmit, saving, formError, drafts,
      onConfirmDraft, onDiscardDraft, symbol, symbols, dict, onManageDict, onUploadShot, uploading,
    }) {
      const boxRef = useRef(null);
      const fileRef = useRef(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        const box = boxRef.current;
        const focusables = () => Array.from(box?.querySelectorAll('input:not([type="hidden"]),select,textarea,button:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])
          .filter((node) => node.offsetParent !== null || node === document.activeElement);
        const first = box?.querySelector('form input:not([type="hidden"]), form select, form textarea') ?? focusables()[0];
        if (first) first.focus();
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeRef.current();
            return;
          }
          if (event.key !== 'Tab') return;
          const nodes = focusables();
          if (nodes.length === 0) return;
          const head = nodes[0];
          const tail = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === head) {
            event.preventDefault();
            tail.focus();
          } else if (!event.shiftKey && document.activeElement === tail) {
            event.preventDefault();
            head.focus();
          }
        };
        const onPaste = (event) => {
          const item = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.type.startsWith('image/'));
          const file = item?.getAsFile?.();
          if (!file) return;
          event.preventDefault();
          onUploadShot(file);
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('paste', onPaste, true);
        return () => {
          document.removeEventListener('keydown', onKey, true);
          document.removeEventListener('paste', onPaste, true);
          if (previous && typeof previous.focus === 'function') previous.focus();
        };
      }, [open]);

      if (!open) return null;
      const setField = (name, value) => setForm((previous) => ({ ...previous, [name]: value }));
      const field = (name, label, type, options) =>
        h('label', { className: 'tc-field' },
          h('span', { className: 'tc-field-label' }, label),
          type === 'select'
            ? h('select', { className: 'tc-input', value: form[name], onChange: (event) => setField(name, event.target.value) },
                options.map(([value, text]) => h('option', { key: value, value }, text)))
            : h('input', {
                className: 'tc-input', type, step: type === 'number' ? '0.001' : undefined,
                value: form[name], onChange: (event) => setField(name, event.target.value),
              }));
      const patternOptions = dict?.patterns?.length
        ? [['', '未选'], ...dict.patterns.map((item) => [item.code, item.label ? `${item.code} · ${item.label}` : item.code])]
        : [['', '未选'], ...PATTERN_OPTIONS.map((item) => [item, item])];
      const errorOptions = dict?.errors?.length ? dict.errors : ERROR_CODES.map(([code, text]) => ({ code, label: text }));
      const allSymbols = Array.from(new Set([...SYMBOLS, ...(symbols ?? []), form.symbol || symbol].filter(Boolean)));

      function pickFile(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) return;
        onUploadShot(file);
      }

      return h('div', { className: 'tc-dlg', onClick: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h('div', { className: 'tc-dlg-box', ref: boxRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': '添加交易' },
          h('div', { className: 'tc-dlg-head' },
            h('h3', null, '添加交易'),
            h('span', { className: 'tc-aside mono' }, `${form.symbol || symbol}`),
            h('button', { className: 'tc-icon-btn', onClick: onClose, title: '关闭' }, '✕')),
          h('form', { className: 'tc-form', onSubmit },
            h('div', { className: 'tc-form-grid' },
              h('label', { className: 'tc-field' },
                h('span', { className: 'tc-field-label' }, '合约'),
                h('select', {
                  className: 'tc-input', value: form.symbol || symbol,
                  onChange: (event) => {
                    const value = event.target.value;
                    setForm((previous) => ({ ...previous, symbol: value, multiplier: String(multiplierOf(value)) }));
                  },
                }, allSymbols.map((item) => h('option', { key: item, value: item }, item)))),
              field('direction', '方向', 'select', [['long', '做多'], ['short', '做空']]),
              field('entryTime', '入场时间', 'datetime-local'),
              field('entryPrice', '入场价', 'number'),
              field('stopPrice', '止损价', 'number'),
              field('targetPrice', '目标价', 'number'),
              field('lots', '手数', 'number'),
              field('exitTime', '离场时间', 'datetime-local'),
              field('exitPrice', '离场价', 'number'),
              h('label', { className: 'tc-field' },
                h('span', { className: 'tc-field-label' }, '15m 状态'),
                h('select', { className: 'tc-input', value: form.state15m, onChange: (event) => setField('state15m', event.target.value) },
                  MODE_OPTIONS.map(([value, text]) => h('option', { key: value, value }, text)))),
              h('label', { className: 'tc-field' },
                h('span', { className: 'tc-field-label' }, '形态 / 状态', h('button', {
                  type: 'button', className: 'tc-link', onClick: () => onManageDict('pattern'),
                }, '管理')),
                h('select', { className: 'tc-input', value: form.pattern, onChange: (event) => setField('pattern', event.target.value) },
                  patternOptions.map(([value, text]) => h('option', { key: value, value }, text))))),
            h('div', { className: 'tc-field tc-field-wide' },
              h('span', { className: 'tc-field-label' }, '犯错 · 可多选'),
              h('div', { className: 'tc-errs-row' },
                h('select', {
                  className: 'tc-input', value: '',
                  onChange: (event) => {
                    const code = event.target.value;
                    if (!code) return;
                    setForm((previous) => ({
                      ...previous,
                      errors: previous.errors.includes(code) ? previous.errors : [...previous.errors, code],
                    }));
                    event.target.value = '';
                  },
                },
                  h('option', { value: '' }, '＋ 选择错误'),
                  errorOptions.map((item) => h('option', { key: item.code, value: item.code }, `${item.code} · ${item.label ?? ''}`))),
                (form.errors ?? []).length > 0
                  ? h('div', { className: 'tc-chip-row' }, (form.errors ?? []).map((code) => {
                      const pair = errorOptions.find((item) => item.code === code);
                      return h('span', { key: code, className: 'tc-chip' },
                        `${code} ${pair ? pair.label : ''}`,
                        h('button', {
                          type: 'button', className: 'tc-chip-x', title: '移除',
                          onClick: () => setForm((previous) => ({ ...previous, errors: previous.errors.filter((item) => item !== code) })),
                        }, '×'));
                    }))
                  : null)),
            h('div', { className: 'tc-field tc-field-wide' },
              h('span', { className: 'tc-field-label' }, '交易截图'),
              h('input', {
                ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' },
                onChange: (event) => { pickFile(event.target.files?.[0]); event.target.value = ''; },
              }),
              form.shotPreview
                ? h('div', { className: 'tc-shot-row' },
                    h('img', { className: 'tc-shot-thumb', src: form.shotPreview, alt: '交易截图' }),
                    h('span', { className: 'tc-muted' }, '截图已保存，可随交易归档'),
                    h('button', {
                      type: 'button', className: 'tc-btn tc-btn-sm',
                      onClick: () => setForm((previous) => ({ ...previous, shot: '', shotPreview: '' })),
                    }, '移除'))
                : h('button', {
                    type: 'button', className: cls('tc-shot-drop', uploading && 'is-busy'),
                    onClick: () => fileRef.current?.click(),
                    onDragOver: (event) => event.preventDefault(),
                    onDrop: (event) => { event.preventDefault(); pickFile(event.dataTransfer?.files?.[0]); },
                  }, uploading ? '截图上传中…' : '点击选图，或在本页 Ctrl/⌘+V 粘贴截图')),
            h('label', { className: 'tc-field tc-field-wide' },
              h('span', { className: 'tc-field-label' }, '备注'),
              h('textarea', { className: 'tc-input', rows: 2, value: form.note, onChange: (event) => setField('note', event.target.value) })),
            formError ? h('div', { className: 'tc-inline-error' }, formError) : null,
            h('div', { className: 'tc-form-actions' },
              h('button', { className: 'tc-btn tc-btn-primary', type: 'submit', disabled: saving }, saving ? '保存中…' : '保存'),
              h('button', { className: 'tc-btn', type: 'button', onClick: () => setForm(emptyForm(form.symbol || symbol)) }, '清空'))),
          drafts.length > 0
            ? h('div', { className: 'tc-draft-block' },
                h('div', { className: 'tc-sub-head' }, h('h3', null, '截图草稿'), h('span', { className: 'tc-aside' }, `${drafts.length} 条待确认`)),
                drafts.map((draft) => h(DraftCard, { key: draft.id, draft, onConfirm: onConfirmDraft, onDiscard: onDiscardDraft })))
            : null));
    }

    function DictDialog({ open, kind, onClose, dict, stats, onChanged }) {
      const [code, setCode] = useState('');
      const [label, setLabel] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        if (!open) return;
        setCode('');
        setLabel('');
        setError('');
      }, [open, kind]);

      if (!open) return null;
      const isPattern = kind === 'pattern';
      const bucket = isPattern ? dict?.patterns ?? [] : dict?.errors ?? [];
      const usage = (isPattern ? dict?.usage?.patterns : dict?.usage?.errors) ?? {};
      const historical = (isPattern ? stats?.patterns : stats?.errors) ?? [];

      async function add() {
        if (!code.trim()) {
          setError('代码不能为空');
          return;
        }
        setBusy(true);
        setError('');
        try {
          const data = await api('dict', { method: 'POST', body: JSON.stringify({ kind: isPattern ? 'pattern' : 'error', code: code.trim(), label: label.trim() }) });
          await onChanged(data);
          setCode('');
          setLabel('');
        } catch (saveError) {
          setError(saveError.message);
        } finally {
          setBusy(false);
        }
      }

      async function remove(codeValue) {
        setBusy(true);
        setError('');
        try {
          const data = await api(`dict?kind=${isPattern ? 'pattern' : 'error'}&code=${encodeURIComponent(codeValue)}`, { method: 'DELETE' });
          await onChanged(data);
        } catch (saveError) {
          setError(saveError.message);
        } finally {
          setBusy(false);
        }
      }

      return h('div', { className: 'tc-dlg', onClick: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h('div', { className: 'tc-dlg-box tc-dict-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': isPattern ? '形态库' : '错误库' },
          h('div', { className: 'tc-dlg-head' },
            h('h3', null, isPattern ? '形态库' : '错误库'),
            h('span', { className: 'tc-aside' }, `${bucket.length} 项`),
            h('button', { className: 'tc-icon-btn', onClick: onClose, title: '关闭' }, '✕')),
          h('div', { className: 'tc-dict-list' },
            bucket.length === 0
              ? h('div', { className: 'tc-empty-line' }, '还没有条目')
              : bucket.map((item) => h('div', { key: item.code, className: 'tc-dict-row' },
                  h('span', { className: 'tc-dict-code mono' }, item.code),
                  h('span', { className: 'tc-dict-label' }, item.label || ''),
                  h('span', { className: 'tc-dict-count mono' }, `×${usage[item.code] ?? 0}`),
                  h('button', { className: 'tc-icon-btn', title: '删除', disabled: busy, onClick: () => remove(item.code) }, '✕'))),
            historical.filter((row) => !bucket.some((item) => item.code === row.code)).length > 0
              ? h('div', { className: 'tc-dict-extra' },
                  h('div', { className: 'tc-muted' }, '历史交易里还用到、但已从字典删除的代码：'),
                  historical.filter((row) => !bucket.some((item) => item.code === row.code)).map((row) =>
                    h('span', { key: row.code, className: 'tc-chip' }, `${row.code}${row.label ? ` ${row.label}` : ''} ×${row.count}`)))
              : null),
          h('div', { className: 'tc-dict-add' },
            h('input', { className: 'tc-input', placeholder: isPattern ? '如 H3 / WEDGE' : '如 E9', value: code, onChange: (event) => setCode(event.target.value), maxLength: 24 }),
            h('input', { className: 'tc-input', placeholder: '说明，如 提前离场', value: label, onChange: (event) => setLabel(event.target.value) }),
            h('button', { className: 'tc-btn tc-btn-primary', disabled: busy, onClick: add }, busy ? '处理中…' : '添加')),
          error ? h('div', { className: 'tc-inline-error' }, error) : null,
          h('div', { className: 'tc-muted tc-dict-hint' }, '删掉一项只从候选里移除，不会改写历史交易里的代码。')));
    }

    function TradingCockpit() {
      const [state, setState] = useState(null);
      const [day, setDay] = useState('');
      const [symbol, setSymbol] = useState('PP0');
      const [kline, setKline] = useState(null);
      const [klineType, setKlineType] = useState(3);
      const [klineLoading, setKlineLoading] = useState(false);
      const [klineError, setKlineError] = useState('');
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [toast, setToast] = useState(null);
      const [rules, setRules] = useState({ outline: [], results: null, section: null, query: '', loading: false });
      const [form, setForm] = useState(() => emptyForm());
      const [formError, setFormError] = useState('');
      const [saving, setSaving] = useState(false);
      const [confirmId, setConfirmId] = useState('');
      const [addOpen, setAddOpen] = useState(false);
      const [dict, setDict] = useState({ patterns: [], errors: [], usage: { patterns: {}, errors: {} } });
      const [stats, setStats] = useState(null);
      const [dictOpen, setDictOpen] = useState(null);
      const [palette, setPalette] = useState(readPalette);
      const [scheme, setScheme] = useState(detectScheme);
      const [uploading, setUploading] = useState(false);
      const [clock, setClock] = useState(() => currentClock());
      const [decision, setDecision] = useState({
        state15m: 'trend', bias: 'none', aligned3m: false, pullback: false, atEdge: false, signal: false, stopPoints: '', targetR: '', lots: '',
      });

      function currentClock() {
        const now = new Date();
        const parts = shanghaiParts(now);
        return {
          day: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
          time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(new Date().getSeconds()).padStart(2, '0')}`,
        };
      }

      useEffect(() => {
        const timer = setInterval(() => setClock(currentClock()), 1000);
        return () => clearInterval(timer);
      }, []);

      useEffect(() => {
        savePalette(palette);
      }, [palette]);

      useEffect(() => {
        const sync = () => setScheme(detectScheme());
        sync();
        const Observer = window.MutationObserver;
        if (!Observer) return undefined;
        const observer = new Observer(sync);
        const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-scheme'] };
        observer.observe(document.documentElement, options);
        if (document.body) observer.observe(document.body, options);
        const media = window.matchMedia?.('(prefers-color-scheme: dark)');
        media?.addEventListener?.('change', sync);
        return () => {
          observer.disconnect();
          media?.removeEventListener?.('change', sync);
        };
      }, []);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 7000);
        return () => clearTimeout(timer);
      }, [toast]);

      useEffect(() => {
        void loadAll();
      }, []);

      async function loadKline(targetDay, targetSymbol, type, force) {
        setKlineLoading(true);
        setKlineError('');
        try {
          const query = new URLSearchParams({ symbol: targetSymbol, type: String(type), day: targetDay, force: force ? '1' : '0' });
          setKline(await api(`kline?${query}`));
        } catch (fetchError) {
          setKlineError(fetchError.message);
        } finally {
          setKlineLoading(false);
        }
      }

      async function loadAll(dayArg, symbolArg, force) {
        const targetSymbol = (symbolArg ?? symbol).toUpperCase();
        setLoading(true);
        setError('');
        try {
          const query = new URLSearchParams({ symbol: targetSymbol });
          if (dayArg) query.set('day', dayArg);
          const data = await api(`state?${query}`);
          setState(data);
          setDay(data.day);
          setSymbol(data.symbol);
          const [dictData, statsData] = await Promise.all([api('dict'), api('stats')]);
          setDict(dictData);
          setStats(statsData);
          await loadKline(data.day, data.symbol, klineType, force === true);
          if ((rules.outline ?? []).length === 0) {
            const outline = await api('rules');
            setRules((previous) => ({ ...previous, outline: outline.outline ?? [] }));
          }
        } catch (fetchError) {
          setError(fetchError.message);
        } finally {
          setLoading(false);
        }
      }

      async function refreshAll() {
        await loadAll(day || '', symbol, true);
      }

      async function changeSymbol(value) {
        setSymbol(value);
        setForm((previous) => ({ ...previous, symbol: value, multiplier: String(multiplierOf(value)) }));
        await loadAll(day, value, false);
      }

      async function changeKlineType(type) {
        setKlineType(type);
        if (day) await loadKline(day, symbol, type, false);
      }

      async function submitSearch(event) {
        event.preventDefault();
        setRules((previous) => ({ ...previous, loading: true, section: null }));
        try {
          const query = new URLSearchParams({ q: rules.query ?? '' });
          const data = await api(`rules?${query}`);
          setRules((previous) => ({ ...previous, results: data.results ?? [], sectionCount: data.sectionCount, loading: false }));
        } catch (fetchError) {
          setRules((previous) => ({ ...previous, loading: false }));
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      async function openSection(id) {
        try {
          setRules((previous) => ({ ...previous, loading: true }));
          const section = await api(`rule?id=${encodeURIComponent(id)}`);
          setRules((previous) => ({ ...previous, section, loading: false }));
        } catch (fetchError) {
          setRules((previous) => ({ ...previous, loading: false }));
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      async function submitTrade(event) {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
          const targetSymbol = (form.symbol || symbol || 'PP0').toUpperCase();
          const payload = buildPayload(form, targetSymbol, day);
          const data = await api('trades', { method: 'POST', body: JSON.stringify({ trade: payload }) });
          setToast({ kind: 'ok', text: `已保存 ${data.trade.id}${data.warnings?.length ? `　告警：${data.warnings.join('；')}` : ''}` });
          setForm(emptyForm(targetSymbol));
          setAddOpen(false);
          setSymbol(targetSymbol);
          await loadAll(data.day || day, targetSymbol, false);
        } catch (saveError) {
          const details = saveError.details;
          setFormError(details?.errors?.length ? `${saveError.message}\n${details.errors.join('；')}` : saveError.message);
          setToast({ kind: 'error', text: saveError.message });
        } finally {
          setSaving(false);
        }
      }

      async function confirmDraft(draft, trade) {
        try {
          const data = await api('trades', { method: 'POST', body: JSON.stringify({ trade, draftId: draft.id }) });
          setToast({ kind: 'ok', text: `草稿已入账：${data.trade.id}` });
          await loadAll(data.day || day, symbol, false);
          return true;
        } catch (saveError) {
          setToast({ kind: 'error', text: saveError.message });
          return false;
        }
      }

      async function discardDraft(id) {
        try {
          await api(`drafts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
          await loadAll(day, symbol, false);
        } catch (fetchError) {
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      async function uploadShot(file) {
        if (!file) return;
        setUploading(true);
        try {
          const dataUrl = await fileToDataUrl(file);
          if (!dataUrl.startsWith('data:image/')) throw new Error('只支持图片文件');
          if (dataUrl.length > 11 * 1024 * 1024) throw new Error('截图太大，请压缩到 8MB 以内');
          const data = await api('shots', { method: 'POST', body: JSON.stringify({ name: file.name || 'screenshot', dataUrl }) });
          setForm((previous) => ({ ...previous, shot: data.shot.id, shotPreview: dataUrl }));
          setToast({ kind: 'ok', text: '截图已保存，会随交易归档。' });
        } catch (uploadError) {
          setToast({ kind: 'error', text: uploadError.message });
        } finally {
          setUploading(false);
        }
      }

      async function refreshDict(data) {
        if (data) setDict(data);
        try {
          setStats(await api('stats'));
        } catch {
          /* keep the previous stats */
        }
      }

      async function deleteTrade(id) {
        if (confirmId !== id) {
          setConfirmId(id);
          setToast({ kind: 'ok', text: '再点一次「确认」才会删除。' });
          return;
        }
        setConfirmId('');
        try {
          await api(`trades?id=${encodeURIComponent(id)}&day=${encodeURIComponent(day)}`, { method: 'DELETE' });
          await loadAll(day, symbol, false);
        } catch (fetchError) {
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      const summary = state?.summary;
      const session = state?.session;
      const trades = state?.trades ?? [];
      const drafts = state?.drafts ?? [];
      const price = kline?.bars?.length ? kline.bars[kline.bars.length - 1].close : null;
      const live = !session?.tradingDay || day === session.tradingDay;
      const symbolOptions = Array.from(new Set([...SYMBOLS, ...trades.map((trade) => trade.symbol).filter(Boolean), symbol, form.symbol].filter(Boolean)));

      return h('div', { className: 'tc-root', 'data-palette': palette, 'data-scheme': scheme },
        h('header', { className: 'tc-top' },
          h('div', { className: 'tc-brand' },
            h('span', { className: 'tc-logo' }),
            h('b', null, '交易中控台')),
          h('div', { className: 'tc-top-actions' },
            h('input', {
              className: 'tc-mini-input', type: 'date', value: day || '',
              onChange: (event) => {
                const value = event.target.value;
                setDay(value);
                if (value) void loadAll(value, symbol, false);
              },
            }),
            h('button', {
              className: 'tc-act', onClick: () => setPalette((value) => (value === 'intl' ? 'cn' : 'intl')),
              title: '切换涨跌配色（国际：绿涨红跌 / 国内：红涨绿跌）',
            }, palette === 'intl' ? '涨绿' : '涨红'),
            h('button', { className: 'tc-act', onClick: refreshAll, disabled: loading }, loading ? '刷新中…' : '刷新'))),
        h('div', { className: 'tc-board' },
          error ? h('div', { className: 'tc-inline-error' }, error, h('button', { className: 'tc-btn tc-btn-sm', onClick: refreshAll }, '重试')) : null,
          loading && !state ? h('div', { className: 'tc-empty-line' }, '正在加载…') : null,
          state
            ? h('div', { className: 'tc-stack' },
                h(KpiCard, { summary, session, trades, symbol, price, clock, day, live }),
                h('div', { className: 'tc-row-two' },
                  h(MixPanel, { stats, trades, onManage: () => setDictOpen('error') }),
                  h(GatePanel, { summary, session, symbol, trades, live })),
                h(ChartPanel, {
                  kline, trades, symbol, symbols: symbolOptions, klineType, loading: klineLoading, error: klineError,
                  onSymbol: changeSymbol, onChangeType: changeKlineType,
                }),
                h(TradesPanel2, {
                  trades, symbol, onDelete: deleteTrade, confirmId,
                  onAdd: () => { setForm(emptyForm(symbol)); setFormError(''); setAddOpen(true); },
                }),
                h('section', { className: 'tc-mod' },
                  h('div', { className: 'tc-mod-head' },
                    h('span', { className: 'tc-num' }, '05'),
                    h('h2', null, '执行手册'),
                    h('span', { className: 'tc-aside' }, state.manual ? `${state.manual.sectionCount} 节 · ${state.manual.lineCount} 行` : '')),
                  h(RulesPanel, { rules, setRules, onSearch: submitSearch, onOpenSection: openSection, account: state.account })),
                h('section', { className: 'tc-mod' },
                  h('div', { className: 'tc-mod-head' },
                    h('span', { className: 'tc-num' }, '06'),
                    h('h2', null, '决策')),
                  h(DecisionPanel, { state, decision, setDecision })))
            : null),
        h(AddTradeDialog, {
          open: addOpen, onClose: () => setAddOpen(false), form, setForm, onSubmit: submitTrade,
          saving, formError, drafts, onConfirmDraft: confirmDraft, onDiscardDraft: discardDraft,
          symbol, symbols: symbolOptions, dict, onManageDict: setDictOpen, onUploadShot: uploadShot, uploading,
        }),
        h(DictDialog, {
          open: dictOpen !== null, kind: dictOpen, onClose: () => setDictOpen(null), dict, stats, onChanged: refreshDict,
        }),
        h(Toast, { toast }));
    }

    // ---------------------------------------------------------------------
    // styles
    // ---------------------------------------------------------------------
    const CSS = `
.tc-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:auto;font-size:13px;line-height:1.55}
.tc-root *{box-sizing:border-box}
/* Sample palette — values copied from docs/mock/index.html. The DSH aliases
   below are only the fallback when a host element cannot expose its scheme. */
.tc-root[data-scheme="light"]{
  --tc-paper:#fafaf8;--tc-paper-2:#f2f2f0;--tc-ground:#f0f0ee;--tc-ink:#0a0a0a;
  --tc-t2:#525252;--tc-t3:#767674;--tc-line:#d4d4d2;--tc-line-2:#e2e2e0;
  --tc-accent:#002fa7;--tc-green:#147a4a;--tc-red:#b42318;--tc-warn:#8a5a00;
}
.tc-root[data-scheme="dark"]{
  --tc-paper:#171717;--tc-paper-2:#1f1f1e;--tc-ground:#0e0e0d;--tc-ink:#f2f2f0;
  --tc-t2:#b0b0ad;--tc-t3:#8a8a87;--tc-line:#3a3a38;--tc-line-2:#2a2a28;
  --tc-accent:#7d9bff;--tc-green:#3fbf7f;--tc-red:#ff6b5e;--tc-warn:#d5a13a;
}
.tc-root[data-scheme]{
  --dsw-alias-bg-base:var(--tc-ground);
  --dsw-alias-bg-layer-1:var(--tc-paper);
  --dsw-alias-bg-layer-2:var(--tc-paper-2);
  --dsw-alias-bg-overlay:var(--tc-paper-2);
  --dsw-alias-border-l1:var(--tc-line);
  --dsw-alias-border-l2:var(--tc-line);
  --dsw-alias-label-primary:var(--tc-ink);
  --dsw-alias-label-secondary:var(--tc-t2);
  --dsw-alias-brand-primary:var(--tc-accent);
  --dsw-alias-state-success-primary:var(--tc-green);
  --dsw-alias-state-error-primary:var(--tc-red);
  --dsw-alias-state-warn-primary:var(--tc-warn);
}
.tc-top{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;height:48px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.tc-brand{display:flex;align-items:center;gap:8px;font-size:13px}
.tc-brand b{font-weight:600;letter-spacing:.01em}
.tc-logo{width:14px;height:14px;background:var(--dsw-alias-label-primary);position:relative;display:inline-block}
.tc-logo::after{content:"";position:absolute;inset:3px;background:var(--dsw-alias-bg-layer-1)}
.tc-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.tc-act{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,color .15s}
.tc-act:hover:not(:disabled){border-color:var(--dsw-alias-label-primary)}
.tc-act:disabled{opacity:.5;cursor:default}
.tc-board{flex:1;min-height:0;padding:22px 24px 60px}
.tc-stack{display:flex;flex-direction:column;gap:20px;max-width:1180px;margin:0 auto}
.tc-mod{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);animation:tcRise .4s cubic-bezier(.2,.7,.3,1)}
.tc-mod{display:flex;flex-direction:column}
.tc-mod-head{display:flex;align-items:center;gap:10px;padding:0 16px;height:44px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-num{font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;color:var(--dsw-alias-label-secondary)}
.tc-mod-head h2{margin:0;font-size:13.5px;font-weight:600;letter-spacing:.01em}
.tc-aside{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.tc-aside.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
.tc-mod-action{margin-left:auto}
.tc-mod-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.tc-row-two{display:flex;gap:20px;align-items:stretch}
.tc-row-two>.tc-mod{flex:1 1 0;min-width:0}
.tc-row-two>.tc-mod:first-child{flex:1 1 auto}
.tc-row-two>.tc-mod:last-child{flex:0 0 430px}
@keyframes tcRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* KPI */
.tc-stat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.tc-stamp{display:flex;align-items:center;gap:8px;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;color:var(--dsw-alias-label-secondary)}
.tc-stamp b{font-weight:500;color:var(--dsw-alias-label-primary)}
.tc-stamp i{font-style:normal;opacity:.45}
.tc-stamp-r{font:10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);letter-spacing:.04em;white-space:nowrap}
.tc-kpis{display:grid;grid-template-columns:repeat(4,1fr)}
.tc-kpi-cell{display:flex;flex-direction:column;gap:6px;padding:14px 16px 16px;border-right:1px solid var(--dsw-alias-border-l1)}
.tc-kpi-cell:last-child{border-right:0}
.tc-kpi-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tc-kpi-value{font-size:25px;font-weight:300;line-height:1.1;letter-spacing:-.01em}
.tc-kpi-value.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:400}
.tc-kpi-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.is-up{color:var(--tc-up,var(--dsw-alias-state-success-primary))}
.is-down{color:var(--tc-down,var(--dsw-alias-state-error-primary))}

/* mix */
.tc-mix{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));grid-auto-rows:1fr;flex:1;align-content:stretch}
.tc-mix-cell{display:flex;align-items:baseline;gap:9px;padding:13px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1)}
.tc-mix-code{font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:var(--dsw-alias-state-error-primary)}
.tc-mix-note{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.tc-mix-count{margin-left:auto;font:13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600}

/* gate */
.tc-gate{display:flex;flex-direction:column}
.tc-gate-verdict{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-gate-verdict-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tc-gate-word{font-size:30px;font-weight:300;line-height:1.05;letter-spacing:-.02em}
.tc-gate-word.is-no{color:inherit}
.tc-gate-why{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.tc-gate-meta{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.tc-gate-checks{display:flex;flex-direction:column}
.tc-gate-check{display:grid;grid-template-columns:24px minmax(0,1fr) auto 40px;align-items:center;gap:10px;padding:7px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.tc-gate-check:last-child{border-bottom:0}
.tc-gate-check.is-bad{background:var(--dsw-alias-bg-layer-2)}
.tc-gate-id{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.tc-gate-value{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.tc-gate-state{text-align:right;font-size:11px;color:var(--dsw-alias-state-success-primary)}
.tc-gate-check.is-bad .tc-gate-state{color:var(--dsw-alias-state-error-primary)}

/* chart */
.tc-chart-bar{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-seg{display:flex;border:1px solid var(--dsw-alias-border-l2)}
.tc-seg-btn{height:24px;padding:0 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}
.tc-seg-btn.is-on{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.tc-legend{display:flex;align-items:center;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.tc-legend span{display:inline-flex;align-items:center;gap:5px}
.tc-sw{width:9px;height:9px;display:inline-block;border:1px solid var(--dsw-alias-border-l2)}
.tc-sw.is-up{background:var(--tc-up,var(--dsw-alias-state-success-primary));border-color:transparent}
.tc-sw.is-down{background:var(--tc-down,var(--dsw-alias-state-error-primary));border-color:transparent}
.tc-sw.is-ema{background:var(--dsw-alias-label-secondary);border-color:transparent;opacity:.5}
.tc-sw.is-stop{border-color:var(--dsw-alias-state-error-primary);border-style:dashed}
.tc-sw.is-target{border-color:var(--dsw-alias-state-success-primary);border-style:dashed}
.tc-chart-body{padding:10px 12px 4px}
.tc-chart-wrap{position:relative;width:100%}
.tc-chart svg{display:block;width:100%;height:auto}
.tc-mini-select,.tc-mini-input{height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}
.tc-mini-input::placeholder{color:var(--dsw-alias-label-secondary);letter-spacing:0}
.tc-mini-select:focus,.tc-mini-input:focus{border-color:var(--dsw-alias-label-primary)}

/* trades table */
.tc-filters{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-filters .tc-mini-input{flex:1 1 160px;min-width:90px;font-family:inherit;font-size:12px}
.tc-table{display:flex;flex-direction:column}
.tc-tr{display:grid;grid-template-columns:62px 54px 32px 62px 44px 72px 38px 52px 52px 76px minmax(0,1fr) 30px;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.tc-tr.is-head{height:30px;padding-top:0;padding-bottom:0;font-size:10px;letter-spacing:.1em;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);text-transform:uppercase}
.tc-tr:last-child{border-bottom:0}
.tc-tr .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.tc-tr .tc-errs{font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-state-error-primary)}
.tc-dir{font-size:11px}
.tc-dir.is-long{color:var(--tc-up,var(--dsw-alias-state-success-primary))}
.tc-dir.is-short{color:var(--tc-down,var(--dsw-alias-state-error-primary))}
.tc-tag{display:inline-block;padding:1px 5px;border:1px solid var(--dsw-alias-border-l2);font-size:10.5px;font-style:normal;color:var(--dsw-alias-label-secondary)}
.tc-tag.is-live{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.tc-note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.tc-icon-btn{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;line-height:1}
.tc-icon-btn:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary)}
.tc-pager{display:flex;align-items:center;gap:6px}
.tc-page-btn{width:24px;height:22px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer;font-size:12px;line-height:1}
.tc-page-btn:disabled{opacity:.35;cursor:default}

/* forms + dialog */
.tc-btn{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}
.tc-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-primary)}
.tc-btn-sm{height:26px;padding:0 10px;font-size:11.5px}
.tc-btn-primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.tc-btn-primary:hover:not(:disabled){opacity:.88}
.tc-btn:disabled{opacity:.5;cursor:default}
.tc-field{display:flex;flex-direction:column;gap:5px}
.tc-field-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tc-field-wide{grid-column:1 / -1}
.tc-input{height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;font-size:12.5px;outline:none;width:100%}
textarea.tc-input{height:auto;padding:7px 9px;resize:vertical;line-height:1.5}
.tc-input:focus{border-color:var(--dsw-alias-label-primary)}
.tc-form{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.tc-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px}
.tc-errs-row{display:flex;flex-direction:column;gap:6px}
.tc-chip-row{display:flex;flex-wrap:wrap;gap:6px}
.tc-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}
.tc-chip-x{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;line-height:1;padding:2px 4px}
.tc-chip-x:hover{color:var(--dsw-alias-state-error-primary)}
.tc-form-actions{display:flex;gap:8px;align-items:center}
.tc-dlg{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,#000)}
.tc-dlg-box{width:min(620px,100%);max-height:82vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 60px rgba(0,0,0,.18)}
.tc-dlg-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-dlg-head h3{margin:0;font-size:13.5px;font-weight:600}
.tc-dlg-head .tc-aside{margin-left:auto}
.tc-dlg-box .tc-form{overflow:auto;min-height:0}
.tc-sub-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.tc-sub-head h3{margin:0;font-size:12px;font-weight:600}
.tc-draft-block{overflow:auto;min-height:0}

/* legacy panels (手册 / 决策 / 草稿) */
.tc-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.tc-card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tc-card-title{font-size:12.5px;font-weight:600;letter-spacing:.01em}
.tc-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.tc-rules,.tc-trades,.tc-decision{display:flex;flex-direction:column;gap:12px;padding:14px 16px}
.tc-tr{display:grid;grid-template-columns:62px 54px 32px 62px 44px 72px 38px 52px 52px 76px minmax(0,1fr) 30px;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.tc-tr.is-head{height:30px;padding-top:0;padding-bottom:0;font-size:10px;letter-spacing:.1em;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);text-transform:uppercase}
.tc-tr:last-child{border-bottom:0}
.tc-tr .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.tc-tr .tc-errs{font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-state-error-primary)}
.tc-dir{font-size:11px}
.tc-dir.is-long{color:var(--tc-up,var(--dsw-alias-state-success-primary))}
.tc-dir.is-short{color:var(--tc-down,var(--dsw-alias-state-error-primary))}
.tc-tag{display:inline-block;padding:1px 5px;border:1px solid var(--dsw-alias-border-l2);font-size:10.5px;font-style:normal;color:var(--dsw-alias-label-secondary)}
.tc-tag.is-live{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.tc-note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.tc-icon-btn{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;line-height:1}
.tc-icon-btn:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary)}
.tc-pager{display:flex;align-items:center;gap:6px}
.tc-page-btn{width:24px;height:22px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer;font-size:12px;line-height:1}
.tc-page-btn:disabled{opacity:.35;cursor:default}

/* forms + dialog */
.tc-btn{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}
.tc-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-primary)}
.tc-btn-sm{height:26px;padding:0 10px;font-size:11.5px}
.tc-btn-primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.tc-btn-primary:hover:not(:disabled){opacity:.88}
.tc-btn:disabled{opacity:.5;cursor:default}
.tc-field{display:flex;flex-direction:column;gap:5px}
.tc-field-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tc-field-wide{grid-column:1 / -1}
.tc-input{height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;font-size:12.5px;outline:none;width:100%}
textarea.tc-input{height:auto;padding:7px 9px;resize:vertical;line-height:1.5}
.tc-input:focus{border-color:var(--dsw-alias-label-primary)}
.tc-form{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.tc-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px}
.tc-form-actions{display:flex;gap:8px;align-items:center}
.tc-dlg{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,#000)}
.tc-dlg-box{width:min(620px,100%);max-height:82vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 60px rgba(0,0,0,.18)}
.tc-dlg-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-dlg-head h3{margin:0;font-size:13.5px;font-weight:600}
.tc-dlg-head .tc-aside{margin-left:auto}
.tc-dlg-box .tc-form{overflow:auto;min-height:0}
.tc-sub-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.tc-sub-head h3{margin:0;font-size:12px;font-weight:600}
.tc-draft-block{overflow:auto;min-height:0}

/* legacy panels (手册 / 决策 / 草稿) */
.tc-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);padding:12px 14px}
.tc-card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tc-card-title{font-size:12.5px;font-weight:600;letter-spacing:.01em}
.tc-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.tc-search{display:flex;gap:8px}
.tc-search-input{flex:1}
.tc-rule-results{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}
.tc-rule-result{border:1px solid var(--dsw-alias-border-l1);padding:8px 10px;cursor:pointer}
.tc-rule-result:hover{border-color:var(--dsw-alias-label-primary)}
.tc-rule-result-head{display:flex;justify-content:space-between;gap:10px;font-size:12px}
.tc-rule-snippet{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.tc-outline-list{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto}
.tc-outline-line{display:flex;gap:10px;font-size:12px;padding:3px 0;cursor:pointer}
.tc-outline-title:hover{text-decoration:underline}
.tc-code-line{display:flex;gap:10px;font:11.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
.tc-line-no{width:34px;color:var(--dsw-alias-label-secondary);text-align:right;flex:0 0 auto}
.tc-code-text{white-space:pre-wrap}
.tc-empty,.tc-empty-line{padding:16px;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:center}
.tc-inline-error{padding:10px 16px;font-size:12px;color:var(--dsw-alias-state-error-primary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-inline-warn{padding:8px 16px;font-size:11.5px;color:var(--dsw-alias-state-warn-primary);border-top:1px solid var(--dsw-alias-border-l1)}
.tc-toast{position:fixed;right:18px;bottom:18px;z-index:90;max-width:420px;padding:10px 14px;border:1px solid var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);font-size:12.5px;white-space:pre-wrap;box-shadow:0 12px 30px rgba(0,0,0,.16)}
.tc-toggle{display:flex;gap:6px}
.tc-quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.tc-quick-card{border:1px solid var(--dsw-alias-border-l1);padding:8px 10px}
.tc-quick-label{font-size:10px;letter-spacing:.1em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.tc-quick-value{font-size:13px}
.tc-draft{border:1px solid var(--dsw-alias-border-l1);padding:10px 12px;margin:10px 16px}
.tc-draft-head{display:flex;justify-content:space-between;gap:10px;font-size:12px}
.tc-draft-prices{display:flex;gap:14px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);margin-top:4px}
.tc-draft-actions{display:flex;gap:8px;margin-top:8px}
.tc-decision .tc-verdict-value{font-size:22px;font-weight:300}
.tc-flow{display:flex;flex-direction:column;gap:2px}
.tc-node{padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);font-size:12px}
.tc-check-mark{font-size:11px;color:var(--dsw-alias-label-secondary)}

/* palette + misc */
.tc-root{--tc-up:var(--dsw-alias-state-success-primary);--tc-down:var(--dsw-alias-state-error-primary)}
.tc-root[data-palette="cn"]{--tc-up:var(--dsw-alias-state-error-primary);--tc-down:var(--dsw-alias-state-success-primary)}
.tc-mix-today{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-border-l2);padding:0 4px}
.tc-link{margin-left:6px;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;cursor:pointer;padding:0}
.tc-link:hover{text-decoration:underline}

/* screenshot */
.tc-shot-drop{height:62px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;line-height:1.4;cursor:pointer;padding:0 12px}
.tc-shot-drop:hover{border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.tc-shot-drop.is-busy{cursor:progress;opacity:.6}
.tc-shot-row{display:flex;align-items:center;gap:10px}
.tc-shot-thumb{width:52px;height:52px;object-fit:cover;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}

/* dictionary */
.tc-dict-box{width:min(580px,100%)}
.tc-dict-list{overflow:auto;min-height:0;max-height:46vh}
.tc-dict-row{display:grid;grid-template-columns:84px minmax(0,1fr) 54px 24px;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.tc-dict-row:last-child{border-bottom:0}
.tc-dict-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.tc-dict-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-dict-count{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);text-align:right}
.tc-dict-add{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
.tc-dict-hint{padding:0 16px 14px}
.tc-dict-extra{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1)}

/* unify legacy manual / decision cards with the module board */
.tc-mod .tc-card{border:0;background:transparent;padding:0}
.tc-mod .tc-rules{display:grid;grid-template-columns:250px minmax(0,1fr);gap:0;padding:0}
.tc-mod .tc-outline{border-right:1px solid var(--dsw-alias-border-l1);padding:14px 16px;max-height:420px;overflow:auto}
.tc-mod .tc-rule-main{padding:14px 16px;min-width:0}
.tc-mod .tc-decision{display:grid;grid-template-columns:340px minmax(0,1fr);gap:0;padding:0}
.tc-mod .tc-decision>.tc-card{border-right:1px solid var(--dsw-alias-border-l1);padding:14px 16px}
.tc-mod .tc-decision>.tc-flow{padding:14px 16px;min-width:0}
.tc-mod .tc-card-title{margin-bottom:8px}

@media (max-width:1080px){
  .tc-row-two{flex-direction:column}
  .tc-row-two>.tc-mod:last-child{flex:none}
  .tc-kpis{grid-template-columns:repeat(2,1fr)}
  .tc-kpi-cell:nth-child(2){border-right:0}
  .tc-kpi-cell:nth-child(1),.tc-kpi-cell:nth-child(2){border-bottom:1px solid var(--dsw-alias-border-l1)}
  .tc-tr{grid-template-columns:46px 22px minmax(0,1fr) 58px 44px 56px;gap:6px;font-size:12px}
  .tc-tr .tc-note-col,.tc-tr>span:nth-child(1),.tc-tr>span:nth-child(5),.tc-tr>span:nth-child(7),.tc-tr>span:nth-child(9),.tc-tr>span:nth-child(12){display:none}
  .tc-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tc-mod .tc-rules,.tc-mod .tc-decision{grid-template-columns:1fr}
  .tc-mod .tc-outline,.tc-mod .tc-decision>.tc-card{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:none}
  .tc-dict-add{grid-template-columns:1fr}
  .tc-board{padding:16px 14px 48px}
}
@media (prefers-reduced-motion:reduce){
  .tc-mod{animation:none}
}

`;

    function ensureStyle() {
      const existing = document.getElementById('tc-style');
      if (existing) return () => {};
      const style = document.createElement('style');
      style.id = 'tc-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposeStyle = ensureStyle();
        ctx.effect?.(() => () => disposeStyle());
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, locale: 'zh' }, TradingCockpit));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: ID, order: 30, label: () => '中控台', locale: 'zh',
        }, CockpitIcon));
      },
    };
  },
});
