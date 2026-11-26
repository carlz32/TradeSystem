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
    const { useEffect, useMemo, useState } = React;

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

    function emptyForm(symbol = 'PP0') {
      return {
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
        note: '',
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
        source: 'manual',
        extended: { state15m: form.state15m, pattern: form.pattern },
      };
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
        const color = up ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
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
        const color = long ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
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
    function TradingCockpit() {
      const [state, setState] = useState(null);
      const [day, setDay] = useState('');
      const [symbol, setSymbol] = useState('PP0');
      const [tab, setTab] = useState('kline');
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
      const [decision, setDecision] = useState({
        state15m: 'trend', bias: 'none', aligned3m: false, pullback: false, atEdge: false, signal: false, stopPoints: '', targetR: '', lots: '',
      });

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
          const data = await api(`kline?${query}`);
          setKline(data);
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
        if (!day) {
          await loadAll('', symbol, true);
          return;
        }
        await loadAll(day, symbol, true);
      }

      async function changeKlineType(type) {
        setKlineType(type);
        if (day) await loadKline(day, symbol, type, false);
      }

      async function submitSearch(event) {
        event.preventDefault();
        const query = rules.query.trim();
        if (query === '') {
          setRules((previous) => ({ ...previous, results: null, section: null }));
          return;
        }
        setRules((previous) => ({ ...previous, loading: true, section: null }));
        try {
          const data = await api(`rules?q=${encodeURIComponent(query)}&limit=50`);
          setRules((previous) => ({ ...previous, loading: false, results: data.results ?? [] }));
        } catch (fetchError) {
          setRules((previous) => ({ ...previous, loading: false }));
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      async function openSection(id) {
        try {
          const section = await api(`rule?id=${encodeURIComponent(id)}`);
          setRules((previous) => ({ ...previous, section }));
        } catch (fetchError) {
          setToast({ kind: 'error', text: fetchError.message });
        }
      }

      async function submitTrade(event) {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
          const payload = buildPayload(form, symbol, day);
          const data = await api('trades', { method: 'POST', body: JSON.stringify({ trade: payload }) });
          const warningText = data.warnings?.length ? `\n告警：${data.warnings.join('；')}` : '';
          setToast({ kind: 'ok', text: `已保存 ${data.trade.id}。${warningText}` });
          setForm(emptyForm(symbol));
          await loadAll(data.day || day, symbol, false);
        } catch (saveError) {
          const details = saveError.details;
          const message = details?.errors?.length ? `${saveError.message}\n${details.errors.join('；')}` : saveError.message;
          setFormError(message);
          setToast({ kind: 'error', text: saveError.message });
        } finally {
          setSaving(false);
        }
      }

      async function confirmDraft(draft, trade) {
        try {
          const data = await api('trades', { method: 'POST', body: JSON.stringify({ trade, draftId: draft.id }) });
          setToast({ kind: 'ok', text: `草稿已入账：${data.trade.id}${data.warnings?.length ? `\n告警：${data.warnings.join('；')}` : ''}` });
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

      async function deleteTrade(id) {
        if (confirmId !== id) {
          setConfirmId(id);
          setToast({ kind: 'ok', text: '再点一次「确认删除」才会删除。' });
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
      const guards = summary?.guards ?? [];
      const symbolOptions = Array.from(new Set([
        ...SYMBOLS,
        ...(state?.trades ?? []).map((trade) => trade.symbol).filter(Boolean),
        symbol,
      ]));
      const tabs = [
        ['kline', 'K线'],
        ['rules', '规则'],
        ['trades', '交易'],
        ['decision', '决策'],
      ];

      return h('div', { className: 'tc-root' },
        h('header', { className: 'tc-header' },
          h('div', { className: 'tc-brand' },
            h('span', { className: 'tc-logo' }, '◎'),
            h('div', null,
              h('div', { className: 'tc-title' }, '交易中控台'),
              h('div', { className: 'tc-subtitle' }, '执行手册 · 当日交易 · K 线标记'))),
          h('div', { className: 'tc-controls' },
            h('label', { className: 'tc-inline-field' }, '交易日',
              h('input', {
                className: 'tc-input', type: 'date', value: day || '',
                onChange: (event) => {
                  const value = event.target.value;
                  setDay(value);
                  if (value) void loadAll(value, symbol, false);
                },
              })),
            h('label', { className: 'tc-inline-field' }, '品种',
              h('select', {
                className: 'tc-select', value: symbol,
                onChange: (event) => {
                  const value = event.target.value;
                  setSymbol(value);
                  setForm((previous) => ({ ...previous, multiplier: String(multiplierOf(value)) }));
                  void loadAll(day, value, false);
                },
              }, symbolOptions.map((item) => h('option', { key: item, value: item }, item)))),
            h('button', { className: 'tc-btn', onClick: refreshAll, disabled: loading }, loading ? '刷新中…' : '刷新'),
            h('button', { className: 'tc-btn', onClick: () => { setDay(''); void loadAll('', symbol, true); } }, '当前交易日')),
          h('div', { className: 'tc-stats' },
            h(Stat, { label: '时段', value: session?.phase ?? '—', tone: session?.canOpen ? 'ok' : 'warn', hint: session?.reason }),
            h(Stat, { label: '日盈亏', value: `¥${fmtMoney(summary?.dailyPnl)}`, tone: (summary?.dailyPnl ?? 0) < 0 ? 'error' : (summary?.dailyPnl ?? 0) > 0 ? 'ok' : undefined }),
            h(Stat, { label: '已平 / 持仓', value: `${summary?.closedCount ?? 0} / ${summary?.openCount ?? 0}` }),
            h(Stat, { label: '连亏 / 连赢', value: `${summary?.consecutiveLosses ?? 0} / ${summary?.consecutiveWins ?? 0}`, tone: (summary?.consecutiveLosses ?? 0) >= 3 ? 'error' : undefined }),
            h(Stat, { label: '日亏剩余', value: `¥${fmtMoney(summary?.dailyLossRemaining)}` }),
            h(Stat, { label: '风险额度', value: `¥${fmtMoney(summary?.openRisk)}` }))),
        guards.length > 0 ? h('div', { className: 'tc-guards' }, guards.map((guard) => h('span', { key: guard, className: 'tc-guard' }, guard))) : null,
        h('nav', { className: 'tc-tabs' }, tabs.map(([key, label]) => h('button', {
          key, className: cls('tc-tab', tab === key && 'is-active'), onClick: () => setTab(key),
        }, label))),
        h('main', { className: 'tc-body' },
          error ? h('div', { className: 'tc-error' }, error, h('button', { className: 'tc-btn', onClick: refreshAll }, '重试')) : null,
          loading && !state ? h(Empty, null, '正在加载…') : null,
          !loading && !state && !error ? h(Empty, null, '没有数据。') : null,
          state && tab === 'kline'
            ? h('section', { className: 'tc-kline' },
                h('div', { className: 'tc-kline-toolbar' },
                  h('div', { className: 'tc-segmented' },
                    h('button', { className: cls('tc-seg', klineType === 3 && 'is-active'), onClick: () => changeKlineType(3) }, '3 分钟'),
                    h('button', { className: cls('tc-seg', klineType === 15 && 'is-active'), onClick: () => changeKlineType(15) }, '15 分钟')),
                  h('div', { className: 'tc-legend' },
                    h('span', { className: 'tc-legend-item' }, h('i', { className: 'tc-dot tc-dot-entry' }), '开仓'),
                    h('span', { className: 'tc-legend-item' }, h('i', { className: 'tc-dot tc-dot-exit' }), '平仓'),
                    h('span', { className: 'tc-legend-item' }, h('i', { className: 'tc-dot tc-dot-stop' }), '止损'),
                    h('span', { className: 'tc-legend-item' }, h('i', { className: 'tc-dot tc-dot-target' }), '目标'),
                    h('span', { className: 'tc-legend-item' }, h('i', { className: 'tc-dot tc-dot-ema' }), 'EMA20')),
                  h('div', { className: 'tc-muted' }, kline ? `${kline.symbol} · ${kline.type}m · ${kline.bars?.length ?? 0} 根 · 数据 ${fmtTime(kline.fetchedAt)}${kline.cached ? ' · 缓存' : ''}` : '')),
                klineError ? h('div', { className: 'tc-error' }, klineError) : null,
                klineLoading && !kline ? h(Empty, null, '正在拉取 K 线…') : null,
                kline ? h(KlineChart, { bars: kline.bars, trades: (state.trades ?? []).filter((trade) => trade.symbol === symbol) }) : null,
                kline ? h('div', { className: 'tc-kline-meta' },
                  h('span', null, `窗口 ${kline.window?.start?.slice(5, 16)} → ${kline.window?.end?.slice(5, 16)}`),
                  h('span', null, `ATR14 ${kline.atr14 ?? '—'}`),
                  h('span', null, `EMA20 ${kline.ema20Last ?? '—'}`),
                  kline.warning ? h('span', { className: 'tc-warn-text' }, kline.warning) : null) : null,
                h('div', { className: 'tc-muted tc-kline-note' }, 'K 线不在盘中实时轮询：打开面板按缓存补拉，每个时段结束后再拉一次；可点「刷新」。'))
            : null,
          state && tab === 'rules'
            ? h(RulesPanel, { rules, setRules, onSearch: submitSearch, onOpenSection: openSection, account: state.account })
            : null,
          state && tab === 'trades'
            ? h(TradesPanel, {
                state, form, setForm, formError, saving, onSubmit: submitTrade, symbol,
                confirmId, onDelete: deleteTrade, onConfirmDraft: confirmDraft, onDiscardDraft: discardDraft,
              })
            : null,
          state && tab === 'decision'
            ? h(DecisionPanel, { state, decision, setDecision })
            : null,
        ),
        h(Toast, { toast }));
    }

    // ---------------------------------------------------------------------
    // styles
    // ---------------------------------------------------------------------
    const CSS = `
.tc-root { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); overflow: hidden; }
.tc-header { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: flex-end; padding: 18px 22px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.tc-brand { display: flex; gap: 10px; align-items: center; min-width: 210px; }
.tc-logo { display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); font-size: 20px; }
.tc-title { font-size: 17px; font-weight: 650; letter-spacing: .02em; }
.tc-subtitle { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 2px; }
.tc-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tc-inline-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tc-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.tc-stat { display: flex; flex-direction: column; gap: 2px; min-width: 78px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
.tc-stat-label { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.tc-stat-value { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tc-stat-ok .tc-stat-value { color: var(--dsw-alias-state-success-primary); }
.tc-stat-warn .tc-stat-value { color: var(--dsw-alias-state-warn-primary); }
.tc-stat-error .tc-stat-value { color: var(--dsw-alias-state-error-primary); }
.tc-guards { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 22px; background: var(--dsw-alias-bg-layer-1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.tc-guard { font-size: 11px; padding: 3px 8px; border-radius: 999px; color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.tc-tabs { display: flex; gap: 2px; padding: 0 22px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.tc-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 10px 14px; font: inherit; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; }
.tc-tab.is-active { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.tc-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 22px 36px; }
.tc-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.tc-card-title { font-weight: 650; font-size: 13px; margin-bottom: 8px; }
.tc-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tc-muted { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.tc-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.tc-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.tc-btn:disabled { opacity: .55; cursor: default; }
.tc-btn-primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
.tc-btn-danger { color: var(--dsw-alias-state-error-primary); }
.tc-input, .tc-select, .tc-textarea { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 5px 8px; font: inherit; font-size: 12px; min-height: 28px; }
.tc-input:focus, .tc-select:focus, .tc-textarea:focus { outline: 1px solid var(--dsw-alias-brand-primary); border-color: transparent; }
.tc-textarea { resize: vertical; }
.tc-empty { padding: 34px 18px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; }
.tc-error { margin: 8px 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); font-size: 12px; white-space: pre-wrap; }
.tc-warn-text { color: var(--dsw-alias-state-warn-primary); font-size: 11px; margin-top: 4px; }
.tc-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 600; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.tc-badge-ok { color: var(--dsw-alias-state-success-primary); }
.tc-badge-error { color: var(--dsw-alias-state-error-primary); }
.tc-badge-warn { color: var(--dsw-alias-state-warn-primary); }
.tc-toast { position: sticky; bottom: 12px; margin: 10px 22px 0; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 12px; white-space: pre-wrap; box-shadow: 0 6px 18px rgba(0,0,0,.18); z-index: 5; }
.tc-toast-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.tc-kline { display: flex; flex-direction: column; gap: 10px; }
.tc-kline-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.tc-segmented { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.tc-seg { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 5px 10px; font: inherit; font-size: 11px; cursor: pointer; }
.tc-seg.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.tc-legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.tc-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.tc-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.tc-dot-entry { background: var(--dsw-alias-state-success-primary); }
.tc-dot-exit { background: var(--dsw-alias-label-primary); }
.tc-dot-stop { background: var(--dsw-alias-state-error-primary); }
.tc-dot-target { background: var(--dsw-alias-state-success-primary); opacity: .45; }
.tc-dot-ema { background: var(--dsw-alias-brand-primary); }
.tc-chart-wrap { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 6px; overflow-x: auto; }
.tc-chart { width: 100%; min-width: 720px; height: auto; display: block; }
.tc-kline-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tc-kline-note { line-height: 1.5; }
.tc-rules { display: grid; grid-template-columns: minmax(200px, 270px) minmax(0, 1fr); gap: 14px; align-items: start; }
.tc-outline-list { display: flex; flex-direction: column; gap: 2px; max-height: 64vh; overflow: auto; }
.tc-outline-item { display: flex; justify-content: space-between; gap: 8px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; padding: 5px 7px; border-radius: 6px; font: inherit; font-size: 11px; cursor: pointer; }
.tc-outline-item:hover, .tc-outline-item.is-active { background: var(--dsw-alias-bg-layer-2); }
.tc-outline-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-outline-line { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.tc-rule-main { min-height: 300px; }
.tc-search { display: flex; gap: 8px; margin-bottom: 12px; }
.tc-search-input { flex: 1; }
.tc-rule-section-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
.tc-rule-section-title { font-size: 14px; font-weight: 650; margin-bottom: 3px; }
.tc-code { max-height: 62vh; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); padding: 8px 0; }
.tc-code-line { display: flex; gap: 10px; padding: 1px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.55; }
.tc-line-no { flex: 0 0 38px; text-align: right; color: var(--dsw-alias-label-secondary); opacity: .7; user-select: none; }
.tc-code-text { white-space: pre-wrap; word-break: break-word; }
.tc-rule-results { display: flex; flex-direction: column; gap: 6px; }
.tc-result-count { margin-bottom: 2px; }
.tc-rule-result { text-align: left; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: inherit; border-radius: 8px; padding: 8px 10px; font: inherit; cursor: pointer; }
.tc-rule-result:hover { border-color: var(--dsw-alias-brand-primary); }
.tc-rule-result-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.tc-rule-snippet { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 4px; line-height: 1.5; }
.tc-quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin: 10px 0 14px; }
.tc-quick-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px 10px; background: var(--dsw-alias-bg-base); display: flex; flex-direction: column; gap: 3px; }
.tc-quick-label { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.tc-quick-value { font-size: 12px; line-height: 1.45; }
.tc-trades { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(300px, .9fr); gap: 14px; align-items: start; }
.tc-summary-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 6px; margin: 8px 0 10px; }
.tc-summary-row .tc-stat { min-width: 0; padding: 5px 7px; }
.tc-summary-row .tc-stat-value { font-size: 13px; }
.tc-trade-items { display: flex; flex-direction: column; gap: 7px; }
.tc-trade { border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-state-idle-primary); border-radius: 8px; padding: 8px 10px; background: var(--dsw-alias-bg-base); }
.tc-trade.is-long { border-left-color: var(--dsw-alias-state-success-primary); }
.tc-trade.is-short { border-left-color: var(--dsw-alias-state-error-primary); }
.tc-trade-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.tc-trade-title { display: flex; gap: 6px; align-items: center; font-size: 12px; }
.tc-trade-prices { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 5px; font-variant-numeric: tabular-nums; }
.tc-trade-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 11px; }
.tc-pnl { font-weight: 650; }
.tc-pnl.is-ok { color: var(--dsw-alias-state-success-primary); }
.tc-pnl.is-error { color: var(--dsw-alias-state-error-primary); }
.tc-drafts { margin-top: 14px; border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 10px; }
.tc-drafts-title { color: var(--dsw-alias-state-warn-primary); }
.tc-draft { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 10px; margin-top: 7px; background: var(--dsw-alias-bg-base); }
.tc-draft-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.tc-draft-prices { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
.tc-draft-actions { display: flex; gap: 6px; margin-top: 7px; }
.tc-draft-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 8px; margin-top: 6px; }
.tc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
.tc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tc-field-label { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.tc-field-wide { margin-top: 8px; }
.tc-form-actions { display: flex; gap: 8px; margin-top: 10px; }
.tc-form-hint { margin-top: 8px; line-height: 1.5; }
.tc-form-error { margin-top: 8px; }
.tc-decision { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
.tc-decision-inputs { display: flex; flex-direction: column; gap: 8px; }
.tc-toggle { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; overflow: hidden; width: fit-content; }
.tc-toggle-btn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 4px 10px; font: inherit; font-size: 11px; cursor: pointer; }
.tc-toggle-btn.is-on { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.tc-flow { display: flex; flex-direction: column; gap: 4px; max-width: 780px; }
.tc-node { border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-state-idle-primary); border-radius: 9px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-1); }
.tc-node.is-pass { border-left-color: var(--dsw-alias-state-success-primary); }
.tc-node.is-fail { border-left-color: var(--dsw-alias-state-error-primary); }
.tc-node.is-info { border-left-color: var(--dsw-alias-brand-primary); }
.tc-node-title { font-size: 12px; font-weight: 650; margin-bottom: 4px; }
.tc-node-detail { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.tc-node-list { margin: 0 0 4px 18px; padding: 0; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.tc-branch { margin-top: 5px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.tc-arrow { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1; }
.tc-checks { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.tc-check { display: flex; align-items: center; gap: 7px; font-size: 11px; padding: 3px 5px; border-radius: 5px; background: var(--dsw-alias-bg-base); }
.tc-check-mark { width: 14px; font-weight: 700; }
.tc-check.is-pass .tc-check-mark { color: var(--dsw-alias-state-success-primary); }
.tc-check.is-fail .tc-check-mark { color: var(--dsw-alias-state-error-primary); }
.tc-check-branch { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.tc-verdict { border-radius: 12px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.tc-verdict.is-ok { border-color: var(--dsw-alias-state-success-primary); }
.tc-verdict.is-warn { border-color: var(--dsw-alias-state-warn-primary); }
.tc-verdict.is-error { border-color: var(--dsw-alias-state-error-primary); }
.tc-verdict-label { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.tc-verdict-value { font-size: 26px; font-weight: 750; margin: 2px 0 4px; }
.tc-verdict.is-ok .tc-verdict-value { color: var(--dsw-alias-state-success-primary); }
.tc-verdict.is-warn .tc-verdict-value { color: var(--dsw-alias-state-warn-primary); }
.tc-verdict.is-error .tc-verdict-value { color: var(--dsw-alias-state-error-primary); }
.tc-verdict-detail { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.tc-refs { margin-top: 8px; line-height: 1.6; }
@media (max-width: 980px) { .tc-rules, .tc-trades, .tc-decision { grid-template-columns: 1fr; } .tc-stats { margin-left: 0; } }
@media (max-width: 640px) { .tc-header { padding: 14px; } .tc-body { padding: 12px 14px 30px; } .tc-tabs { padding: 0 14px; } .tc-form-grid, .tc-draft-grid { grid-template-columns: 1fr; } .tc-toast { margin: 8px 14px 0; } }
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
