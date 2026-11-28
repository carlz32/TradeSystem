# 交易中控台 · 实现说明

## 结构

- `lib/core.js`：纯逻辑（手册解析/检索、交易日/时段、交易校验与汇总、K 线解码与指标），可用 Node 单测。
- `lib/index.js`：Host 插件。注册同源 HTTP API `/trading-cockpit/api/*`、agent 工具、行情缓存与 JSON 存储。
- `client.js`：浏览器半，经典脚本，`window.__ModuleLoader__.load` 注册 `main` 中央面板与 `sidebar.panellist` 侧栏图标。
- `locale/*.json`：插件标题/描述。
- `cordis.patch.yml`：bundle 行，id/name 均为 `dsh-trading-cockpit`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `state?day&symbol` | 当日交易、汇总、时段、手册元信息、截图草稿 |
| GET | `rules?q&limit` | 无 q 返回章节目录；有 q 返回检索结果 |
| GET | `rule?id` | 某一节完整原文 |
| GET | `kline?symbol&type&day&force` | 当日 K 线；type=3/5/15/30/60 |
| GET | `trades?day` | 当日交易与汇总 |
| POST | `trades` | 保存交易；结构错误返回 422 |
| DELETE | `trades?id&day` | 删除交易 |
| GET/POST/DELETE | `drafts` | 截图草稿 |
| GET/POST/DELETE | `dict` | 形态/错误字典（`dict.json`） |
| GET | `stats?from&to` | 跨日统计错误码/形态使用次数 |
| POST | `shots` | 保存截图（dataURL，png/jpg/webp，≤8MB） |
| GET | `shot?id` | 读取截图（直接返回图片） |

所有路由先过 `connection.requestRejection` 鉴权；响应统一 `{ok, data}` 或 `{ok:false, error}`。

## 存储

- `notes/TradeLog/cockpit/YYYY-MM-DD.json`：`{version, day, updatedAt, trades}`。
- `notes/TradeLog/cockpit/drafts.json`：`{version, updatedAt, drafts}`。
- `notes/TradeLog/cockpit/dict.json`：`{version, updatedAt, patterns, errors}`。
- `notes/TradeLog/cockpit/shots/<uuid>.<ext>`：交易截图；交易里用 `extended.shot` 关联。
- 写入使用临时文件 + rename，避免半截文件；按文件串行化写操作。

## 交易字段

精简版：`direction, symbol, openedAt, entryPrice, stopPrice, targetPrice, lots, multiplier, closedAt, exitPrice, note`；扩展字段放在 `extended`（`state15m`、`pattern`、`errors`、`shot`），后续加 `H1/L1`、`是否守规`、`错误标签`时不必改顶层结构。

## 告警规则（不拦截保存）

- 止损 >120 点；TR 模式 >30 点。
- 单笔风险 >600；手数超过 `floor(600/(止损点数×乘数))`。
- 禁开仓时段入场；同品种同方向已有持仓。
- 日亏 ≥1200、连亏 3、连赢 4 的闸门在顶部状态条和决策图显示。

## 截图流程

聊天发图 → 模型读图 → `trading_trade_draft`（允许缺止损，草稿带「缺止损」告警）→ 存 `drafts.json` → 中控台「04 交易记录」草稿卡就地改字段、补止损 → 点「确认入账」→ `POST /trades`（带 `draftId`，成功后删草稿）。止损未填时确认按钮不可用；正式保存仍走严格校验。

添加交易弹窗也可以直接选图/拖拽/粘贴：前端先 `POST /shots` 拿 `shot.id`，再随交易写入 `extended.shot` 并显示缩略图。

## 跨电脑

插件在 `TradeSystem/plugins/dsh-trading-cockpit`，数据在 `TradeSystem/notes/TradeLog/cockpit`，同处一个工作区；同步工作区后，在另一台 DSH 的插件页重新选择本目录安装即可。Host 不写死用户目录，按 `执行手册.md` 定位工作区。
