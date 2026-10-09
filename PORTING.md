# PORTING.md — 交给其它宿主 agent 的移植说明

一句话：这是一个「**推理等级选择器**」（本仓库在 DSH 里的形态 = 模型选择器旁的胶囊 + 点开的滑条卡片）。**本仓库的实现不能直接装进别的宿主**——它 100% 依赖 DSH 客户端插件 API。要移植，请把第 2 节的「DSH 专属层」换成你所在宿主的等价物；第 3–5 节（颜色出处 / 视觉参数 / 交互契约）可以直接照搬，它们是实测量出来的。

本文件只写**别处没有的**内容；实现细节与已知限制见 [`README.md`](./README.md)。

---

## 1. 文件清单（本仓库）

| 路径 | 作用 |
|---|---|
| `client.js` | 浏览器半边，**功能全在这一个文件里**（约 26 KB） |
| `index.js` | Host 半边，空 `apply()`（只为让 DSH 的 loader 里出现这一行） |
| `package.json` | `dsh.bundle.patch` + `dsh.client{platform:web, inject:[…]}` + `exports["./client"]` |
| `cordis.patch.yml` | bundle 补丁层：插入一行 loader entry（**必须是裸包名**，见文件内注释） |
| `tools/validate.mjs` | 静态校验（清单/产物规则 + 一条 portal 作用域检查） |
| `tools/smoke.mjs` | 36 项行为断言，**无需浏览器**（自带微型 hook 运行时直接驱动组件） |
| `tools/measure-reference.py` | 用 Pillow 从参考截图逐像素量几何与色相（见第 4 节） |
| `tools/install-into-profile.mjs` / `uninstall-from-profile.mjs` | 装/卸到 DSH profile（备份 + YAML 回验 + 失败自动回滚） |
| `demo/mockup.html` | 可交互视觉原型（可拖、切深浅色、两种渐变、动效开关） |

版本绑定：开发与实测环境是 DSH 桌面版 **0.2.0-rc.2**（用到的接口在 `0.2.0-rc.1` 也存在）。

---

## 2. 移植地图（`client.js` 行号 → 你必须做什么）

### DSH 专属层（必须替换）

| 行（约） | 是什么 | 替换成 |
|---|---|---|
| 41 | `window.__ModuleLoader__.load({id, factory})` | 你宿主的插件引导格式 |
| 49 / 512 | 槽位键 `conversation.input.activity` + `scope.slots.register(...)` | 你宿主的 UI 扩展点。**若宿主没有可插入 UI 的扩展点，就明确回报"UI 滑条做不到"**，改做配置/命令层 |
| 510 / 519 / 522 | `ctx.inject(['slots','modelDirectories'])` → `directory.store` 读、`directory.select()` 写 | 你宿主读写"模型 + 推理等级"的地方 |
| 244 | `React.useSyncExternalStore(store.subscribe, store.getSnapshot)` | 你宿主的响应式数据源 |
| 505 | `reactDom.createPortal(card, document.body)` | 你宿主的浮层机制；**没有 portal 时务必读第 5 节第 7 条的层叠上下文陷阱** |
| 509 | `ctx.locale.register(NS, {zh,en})` | 你宿主的 i18n |
| — | `require('react')` / `require('react-dom')` 来自 DSH 平台模块表 | 你宿主的 UI 栈（非 React 也适用第 5 节契约） |

### 可移植层（照搬）

| 函数 | 说明 |
|---|---|
| `mixHex` | sRGB 逐通道线性插值 |
| `rampFor(index, count)` | **颜色随档位整体推进**（不是按位置渐变）：蓝 → 紫，`t = i/(n-1)` |
| `sheenFor(index, count)` | 流光条：取当前档最亮色 + 8 位 hex 的 alpha 后缀（`…00` / `…8c`），避免用 `transparent` 插值发灰 |
| `colorFor(index, count)` | 胶囊圆点 / 光晕取色 |
| `levelsOf(state)` | 从目录快照取：档位列表、`defaultEffort`、模型显示名；**无档位返回 null → 不渲染** |
| `aria-valuetext` 等 | 无障碍属性表 |

---

## 3. 颜色出处（不要自己编十六进制）

DSH 主题里**没有**独立的紫/品红系；紫色只出现在"停靠点列表"token 内，而 CSS 无法只引用停靠点列表的一段：

- `--dsw-gradient-onboarding-blue-stops` = `#3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe`
- `--dsw-gradient-onboarding-violet-stops` = `#2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6`

本实现（`client.js` 顶部常量）：

- `COOL_STOPS = ['#3964fe', '#398efe', '#6dccff']`（主题蓝停靠点）
- `HOT_STOPS = ['#8b76f6', '#c5c0ff', '#8b76f6']`（主题紫停靠点，**故意跳过它自己的首个 `#2a2fb6`**，否则最高档会读成 indigo 而不是"整条紫"）

其余颜色全部是 `--dsw-alias-*` / `--dsw-static-*` token（纯白圆钮 = `--dsw-static-neutral-00`、卡片底 = `--dsw-alias-bg-layer-2`、卡片阴影 = `--dsw-elevation-prominent`、错误行 = `--dsw-alias-state-error-primary`）。**移植时换成你宿主的主题 token，不要抄 DSH 的 token 名。**

---

## 4. 视觉规格（含实测来源）

参考实现是 ChatGPT/Codex 的 power slider。用 `tools/measure-reference.py` 对一张 470×251 截图逐像素测量得到：

- 轨道高 **21px**、宽 **305px**（≈14.5:1）；圆钮 **38–42px**（轨道的 1.8–2.0 倍）且**纵向溢出轨道**；渐变**色相**从 **213°（蓝）→ 272°（紫）**；数值标签**居中在条上方**（图上是 `Ultra` + 小字 `6 Sol ›`）。
- 截图取到的十六进制值偏暗（条半透明叠在深色壁纸上），**色相可信、明度不可直接照抄**——所以本实现抄的是色相轴，不是那些像素值。

本实现的最终取值：

| 元素 | 值 |
|---|---|
| 轨道 | 高 20px，圆角 999px，空轨道底色 = 1px 边框色 token |
| 圆钮 | 26px 纯白 + `0 1px 3px #00000033`，`margin-left:-13px` 居中于填充末端 |
| 卡片 | 宽 320px，padding 16/20，圆角 = 圆角 lg token，`z-index:1200` |
| 标题 | 15px/22 600，**居中在上方**，颜色跟随档位 |
| 副标 | 11px/16，居中，**显示当前模型名** |
| 刻度 | 11px/16，两端对齐，当前档位高亮 |
| 填充缓动 | `width 200ms cubic-bezier(.2,.8,.2,1)` |
| 圆钮位移 | `left 200ms cubic-bezier(.2,.8,.2,1)` |
| 换色 | `200ms ease`（档位名 / 圆点 / 刻度） |
| 流光 | 带宽 42%，`translateX(-100%) → 238%`，`2.4s linear infinite` |
| 最高档光晕 | `1.8s ease-in-out infinite`，`scale(1)→1.7`、`opacity 0→.28` |

两个必须算对的点：

1. **流光的行程**：带宽 42% 时，`-100%` 恰好整条在左边界外、`238%` 恰好整条在右边界外；写成 `-110% → 320%` 会有约 3/4 的时间在画面外（表现为"只闪一下"）。
2. **填充里的渐变要锚定整条轨道**，否则会被压缩：本实现用"填充裁切一条整宽渐变"（填充层 `overflow:hidden`，内层渐变 `position:absolute;inset:0`）。

`prefers-reduced-motion: reduce` 下**全部**动效关闭（流光 `animation:none` 且 `opacity:0`）。

---

## 5. 必须保持的交互契约（都是踩坑得出的，别"优化"掉）

1. **模型没声明档位 → 什么都不渲染**（DSH 官方选择器同规则：不做做不到自己声称之事的控件）。
2. **只声明 1 档 → 退化为只读徽标**，不做滑条。
3. **一次手势只提交一次**：拖动过程只本地预览，`pointerup`（或按键）才提交。否则划过 4 档会写 4 次选择，而每次提交都带副作用。
4. **乐观 pending，但 settle 后以真实状态为准**：提交中显示目标值；RPC 成功但底层状态未更新时显示会回到真实值——这是故意的（不撒谎），不要"修"成缓存自己的意图。
5. **键盘**：`←/→`（或 `↑/↓`）逐档、`Home/End` 两端、`Esc` 收起、点击外部收起；**已到端点时是 no-op**（因为提交有副作用）。
6. **无障碍**：滑轨 `role="slider"` + `aria-valuemin/valuemax/valuenow/valuetext`；胶囊按钮带 `aria-expanded` + `aria-label`（含当前档位名）。
7. **浮层放对层叠上下文**：DSH 里必须用 portal 把卡片挂到 `document.body`，否则固定定位元素的 `z-index` 会被 composer 的层叠上下文困住，被会话区的浮动控件（`z-index:7` 的滚动到底槽）盖住。**同一个坑**：CSS 自定义属性**不跨 portal 继承**——插件自己的调色板必须同时声明在 portal 内那层元素上，否则卡片里的 `var(--…)` 解析失败（表现为"标题不紫、光晕消失"）。`tools/validate.mjs` 里有一条专门检查这个。
8. DSH 特有：展开时向宿主申请工具栏宽度（`onActiveChange(true)`），收起/卸载时释放。你宿主若无此概念可忽略。

---

## 6. 两个宿主的相关事实（作者已取证，可省一次考古）

### OpenCode（桌面发行版 `@opencodedesktop`，CLI **2.0.25**）

- 二进制：`%LOCALAPPDATA%\Programs\@opencodedesktop\resources\opencode-cli.exe`（单文件，字节串可搜）。配置目录 `~/.config/opencode/`，数据目录 `~/.local/share/opencode/`。
- **它原生就有 effort 机制**（从二进制里挖出的运行时代码，非猜测）：

```js
Za  = (e,a) => { if (a.type!=="effort") return []; return fa(a.values ?? ii, i => ({settings:{reasoningEffort:i}})) }
Ui  = (e,a) => { if (a.type!=="effort") return []; return fa(a.values ?? ["none","minimal",...ii,"xhigh"], wx) }
wx  = e => ({ settings: { reasoningEffort: e, reasoningSummary: "auto", include: GP } })
MP  = (e,a) => { switch(a.type){ case "effort": return fa(a.values ?? ["low","high","max"], …) } }
// 另有：["@ai-sdk/openai","@ai-sdk/azure","@ai-sdk/amazon-bedrock/mantle"].includes(provider)
//        && settings.reasoningEffort !== undefined  →  forceReasoning: true
```

即：一个 `{type:"effort", values?:[…]}` 描述会**展开成多个模型变体**，每个变体设 `settings.reasoningEffort`；默认值随 provider 不同。

- **未确认**：`variants` / `effort` 在 `opencode.json` 里的确切键路径；以及 OpenCode 是否有**可插入 UI 的扩展点**（已知 `.opencode/plugin` 是服务端 TS 插件，能挂钩子、改请求参数，**不像 DSH 那样有 slot 注册表**）。若确实没有 UI 扩展点，则"滑条 UI"在 OpenCode 里做不到，应改为"配置/变体"层交付。

### MiMo（`xiaomi-mimo-desktop` **26.929.292248**）

- 安装目录里有 Electron 应用与 `resources\app.asar`（91 MB，字节串可搜）。
- 引擎：`out/main/claude-code-session-worker.mjs` + `resources/evolve-seed/harness`（**把 Claude Code 当会话引擎**），内置工具有自己的定义 `out/main/desktop-tools-plugin.mjs`。
- 有自己的插件页：`out/renderer/assets/PluginsPage-*.js`、`usePluginInstallInteraction-*.js`。
- asar **内容级**命中：`reasoningEffort`、`reasoning_effort`、`thinking`、`variant`；**没有** `reasoningEfforts`。也出现 `opencode` 字样，但文件名级没有 opencode 可执行文件（**不是内置 opencode**）。
- **已由 MiMo 侧 agent 复核补齐（2026-10-09；以下为其报告结论，作者未独立复验）**：
  - 桌面第三方插件清单 = **`mimo-plugin.json`**，解析器只认 `components.skills[]`（id + path）与 `components.mcp[]`（local/remote），`kind ∈ {skill, plugin}`——**没有 UI 组件类型**。
  - 引擎插件 API `@mimo-ai/plugin` 只提供**服务端** hooks（`event` / `config` / `tool` / `auth` / `provider` / `chat.*` / `session.*`），无 slot；其 `PluginModule = { server, tui?: never }`。
  - 终端 TUI（MiMoCode 的 `mimo`，@opentui/solid）**有** slot 体系（`session_prompt_right`、`home_prompt_right`、`sidebar_*` … + `slots.register`），但那是**终端**宿主，与桌面 Electron 渲染层无关。
  - **结论：桌面端不存在可插入第三方 UI 的扩展点**，UI 滑条在该宿主做不到。而**推理强度是宿主原生能力**：composer 自带选择器（档位 id `low/medium/high/xhigh/max`，按模型 `reasoning_options` 降级，支持 `{type:"effort",values:[…]}` 与 `{type:"toggle"}`，另有 `cycle-reasoning` / `increase-reasoning` / `decrease-reasoning` 快捷键）。
  - 若改走"插件自带 UI"路线，桌面端唯一能自己画面的面是聊天内 **`sci-widget` iframe**（沙箱、`connect-src 'none'`、无回传桥），需要配合技能与引擎插件完成「用户把档位名发回聊天 → 插件写 variant」的链路。

取证手法（无需 Electron）：`.asar` 是「头部 JSON 索引 + 拼接数据」，Node 直接读头部即可按需取单个文件或按名字检索；编译后的单文件二进制用字节串搜索并打印上下文即可定位运行时代码。

---

## 7. 验证基线（移植后照这套做）

- `node tools/validate.mjs` → 清单/产物规则 + 一条 **portal 作用域检查**（exit 0 = 通过）。
- `node tools/smoke.mjs` → 36 项行为断言，无需浏览器；移植后请照它的断言表重写你宿主版本的等价测试（档位解析、退化分支、乐观提交、撞墙 no-op、渐变颜色、单档徽标、卸载释放）。
- **坑**：`node tools/smoke.mjs | Select-Object -First N`（或任何提前关闭管道的写法）会让 node 以 exit 1 结束，这是**截断假象**；判成败看最后一行 `smoke: all checks passed` 或跑完整输出。

---

## 8. 已知限制（别当 bug 去"修"）

见 [`README.md` 的「已知限制」](./README.md)。要点：档位间的实际差异**未被证实**（对照实验 n=10/档，均值区间大幅重叠）；最高档显示名 `Ultra` 只是**展示层**，wire 值仍是档位自己的 id；改档会同时写"新会话默认"。

---

## 9. 建议下一个 agent 先读什么

- **DSH 侧继续做**：DSH 源码 checkout 里的官方技能 `packages/preset/agent-preset/skills/cordis-plugin-development/`（`SKILL.md` + `references/practices.md` + `templates/decoration/` 四文件模板）。
- **本仓库** `README.md`（实现细节/安装/已知限制）——本文件不重复它。
- **OpenCode 侧**：先只做一件事——确认有无 UI 扩展点；有则按它的插件 API 重写视图层并复用第 3–5 节，没有则走"配置/变体"路线（第 6 节已给出它的 effort 机制形状）。
- **MiMo 侧**：桌面端已由另一 agent 复核——**没有可插入第三方 UI 的扩展点**（清单只支持 skills / mcp），而推理强度是宿主原生能力；详细事实与替代路线见第 6 节。

---

## 10. 边界与禁令

- 改目标应用的**安装目录或配置**前先备份；MiMo / OpenCode 都是 Electron 打包应用，`app.asar` 的写入能力视打包方式而定（DSH 的经验：packaged 应用里 asar 通常只有宿主进程自己能读，shell/node 会失败）。
- 本插件**没有**做过浏览器内视觉验证（作者开发机无浏览器控制通道）；观感结论来自像素测量 + token 取值核对 + 用户反馈，移植时请在你宿主里真跑一遍。
