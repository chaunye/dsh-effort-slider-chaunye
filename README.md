# dsh-effort-slider-chaunye

推理等级滑条：给 DeepSeek Harness（DSH）Web composer 的模型选择器旁加一个胶囊，点开是**整宽的渐变滑条**——拖动即改当前会话的推理等级。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/chaunye/dsh-effort-slider-chaunye)

## 特性

- **整宽渐变滑条**：20px 药丸轨道 + 蓝→紫渐变填充 + 26px 纯白圆钮 + 数值标签居中显示在条上方
- **颜色随档位整体推进**：`Off/Low` 纯蓝、`High` 蓝紫过渡、最高档显示为 **Ultra** 且**整条都是紫**，与其他档位一眼区分
- **流光动效**：一条浅色光带每 2.4s 从左扫到右（用 `transform` 走合成器，不逐帧重绘），最高档另有呼吸光晕；`prefers-reduced-motion: reduce` 下全部关闭
- **与官方模型菜单共用同一份状态**：读取 DSH 自己的 per-session 模型目录（`ctx.modelDirectories`），改档走同一条 `session.selectModel`，所以两处显示永远不会打架
- **不做做不到的事**：当前模型没有声明推理等级时**完全不渲染**（不出现动不了的控件）；只声明 1 档时退化为只读徽标
- **拖动一次只提交一次**：松手才写档位，不会因为划过 4 个刻度就写 4 次
- **零网络请求**：不联网、不读文件、不引入任何第三方依赖，只调用 DSH 自身的接口

## 安装

```sh
dsh plugin --profile <你的 profile 名> add github:chaunye/dsh-effort-slider-chaunye
```

例如 `dsh plugin --profile web add github:chaunye/dsh-effort-slider-chaunye`。

安装后**重启一次 DSH**（新 bundle 需要重启加载；之后的改动走客户端热替换，不用再重启）。

- **桌面版用户**：`--profile desktop` 由 Electron 独占（CLI 会报 `profile "desktop" is managed exclusively by the Electron application`），请在应用内的「设置 → 插件市场」安装，或用本仓库的 `tools/install-into-profile.mjs` 手动安装。
- **从这个仓库直接安装不会触发任何构建**：本插件是手写的 classic script，仓库里就是运行产物，不需要 `prepare` 脚本、也不需要 pnpm 的 `allowBuilds` 授权。

## 使用

1. 点 composer 中模型选择器旁的胶囊（胶囊上有一个跟随档位变色的小圆点）。
2. 拖动滑条、点刻度，或用 `←`/`→` 逐档；`Home`/`End` 到两端；`Esc` 收起。
3. 改档立即生效于**下一次请求**；正在跑的那一步不会被中断。

## 要求与权限

- **DSH 版本**：≥ `0.2.0-rc.1`（开发与实测在 `0.2.0-rc.2`）。用到的接口：`ctx.modelDirectories`（per-session 模型目录）、`session.selectModel`（改档 RPC）、`conversation.input.activity`（composer 座位）、`react` / `react-dom`（平台模块表）。
- **平台**：Web 半边，任何能跑 DSH Web GUI 的平台；已在 Windows + 桌面版实测。
- **权限声明**：不需要任何额外权限。不执行命令、不读写文件、不发起网络请求、不向模型注册任何工具。
- **外部服务**：无。

## 已知限制（实测，不是推测）

- **档位之间的实际差异未被证实**：同一道可判对错的题、temperature 0、n=10/档的对照实验里，`low/high/max` 的 reasoning tokens 均值 148/143/161（区间 97–228 大幅重叠），正确率 9/10、10/10、10/10，延迟基本相同。阴性结果不足以断定网关忽略 `reasoning_effort`（题目可能过易、样本过小），因此滑条**如实透传**网关词汇，**不代表"档位越高越强"**。唯一有确定性效果的是 `off`（发 `thinking:{type:disabled}`，`reasoning_content` 消失）。
- **最高档显示名 `Ultra` 只是展示层**：发给网关的仍是该档位自己的 id（如 `max`）；DSH 官方模型菜单里仍显示适配器给出的名字（适配器的档位名是硬编码的，配置改不了）。
- **改档会同时成为"新会话默认"**：DSH 的 `selectModel` 内部会调用 `agentDefaultModel.saveSelection()`，插件侧无法关闭这一行为。
- **与官方模型菜单的档位名可能不一致**（见上一条），这是有意为之的显示层选择。

## 演示

- [`demo/mockup.html`](./demo/mockup.html) —— 自包含的可交互原型：可拖动、切换深浅色、对比两种渐变、开关动效。直接双击用浏览器打开即可（不需要 DSH）。

## 开发与验证

```sh
node tools/validate.mjs    # 清单/产物规则校验（含一条 portal 自定义属性作用域检查）
node tools/smoke.mjs       # 36 项行为断言，无需浏览器（自带微型 hook 运行时驱动组件）
```

想移植到其它宿主（MiMo / OpenCode 等）请读 [`PORTING.md`](./PORTING.md)：里面逐行标出了「DSH 专属层」与「可移植层」。

## 许可证

MIT，见 [`LICENSE`](./LICENSE)。
