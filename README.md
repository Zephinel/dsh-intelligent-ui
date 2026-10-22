# dsh-intelligent-ui

中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/@zephinel/dsh-intelligent-ui?label=npm)](https://www.npmjs.com/package/@zephinel/dsh-intelligent-ui)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1-4f46e5)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![publish](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml/badge.svg)](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml)

**把模型回答变成一张真正能用的页面。** 模型调用 `render_ui` 工具，把答案写成一份 [OpenUI Lang 1.0](https://openui.com) 程序；DSH 聊天页在该轮结束时把它渲染成可交互页面——地图、照片、图表、清单、表单、SVG 绘图、小游戏都是真实组件，不是截图。

基于 [Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui)（MIT）移植，并附带一个随插件自动注册的 Agent Skill（`intelligent-ui`）。

> [!NOTE]
> **当前状态**：已发布到 GitHub 与 npm，npm 版本 **`@zephinel/dsh-intelligent-ui@0.2.2-26-10-21`**（`latest`）。

## 效果

![上海两日行程：照片、地图、时间线、清单、预算与可交互控件都由 OpenUI Lang 渲染](assets/intelligent-ui-itinerary.webp)

- 用户问「帮我排一个上海两日游」，模型不再只回一段文字：回答末尾直接渲染一张可点击、可勾选、可拖动的行程页面（地图 + 照片 + 时间线 + 清单 + 预算）。
- 卡片内的 `$变量`、`@Set`、`@functions` 全部在浏览器本地执行：勾选、滑动条、Stepper、计时器、预算分配都不需要再请求模型。
- 只有真正需要继续对话的动作（`@ToAssistant`，例如表单提交）会把一条简短消息放回输入框并发送。

## 组件一览

渲染器不是把一段文字包进聊天气泡，而是一套完整的组件库：**57 个组件、73 个函数、5 种动作**。下面三张卡片都是扩展的真实渲染结果——同一套渲染器、同一套 DSH 主题 token，没有设计稿：

![布局与排版：57 组件总览，Col、Row、Box、Grid、Card、Carousel、Popover、Divider、Spacer、Section、Toc 与 12 个文本组件](assets/intelligent-ui-components-layout.webp)

![输入、媒体与数据：13 个表单控件，以及照片、表格、图表、地图与 YouTube](assets/intelligent-ui-components-inputs.webp)

![交互与绘制：翻面卡、撒花开关、Svg 十种图元与沙盒 iframe 小游戏](assets/intelligent-ui-components-drawing.webp)

## 更多示例

![销售看板：KPI、折线、环图与明细表都随区域筛选实时重算](assets/intelligent-ui-example-dashboard.webp)

![咖啡冲煮小测：翻面卡、答对反馈、得分条与沙盒小游戏](assets/intelligent-ui-example-quiz.webp)

窄屏下卡片自动切为单列，地图与图表按卡片宽度自适应；图表分类标签过长时会截断而不是溢出（约 380 px 宽）：

![窄屏下的手冲咖啡计算器：单列卡片、无横向溢出](assets/intelligent-ui-responsive.webp)

## 核心能力

| 能力 | 说明 |
|---|---|
| 交互页面 | 地图、照片、图表、清单、表单、SVG 绘图、小游戏都是真实组件，不是截图 |
| 导出图片 | 回答底部操作栏右侧的「导出」药丸按钮可把渲染结果保存为一张 PNG：原始 / 圆角 / 卡片三种美化；背景色与 1x/2x 在插件详情页设置 |
| 导出交互页面 | 同一个导出菜单可把该轮所有卡片导出为**单文件 HTML**（内联渲染器与当前主题，约 3.4–4.9 MB）；直接打开即可离线交互，页面里的 `@ToAssistant` 会复制文案并提示回到 DSH 粘贴继续 |
| 本地执行 | `$变量`、`@Set`、`@functions` 在浏览器运行；只有 `@ToAssistant` 回写消息 |
| 开关与样式 | 全局默认在插件详情页；输入框 UI 控件按会话覆盖；Auto / Card / Article 三档样式 |
| 双语界面 | 跟随 DSH 的界面语言；字典在 `src/shared/locales.ts` |
| Agent Skill | 随插件注册 `intelligent-ui`，模型按需加载完整语法、示例与排障 |
| 插件详情页 | 插件 → 智能 UI 详情页：可用性（全局启用）、回答样式（Auto / Card / Article）、编排方式（自由布局）、导出（背景色、分辨率、交互页面的追问开关） |
| 可重放 | 生成程序作为工具参数进入会话日志，随历史重放 |

## 获取代码

从 GitHub 克隆仓库：

```bash
git clone https://github.com/Zephinel/dsh-intelligent-ui.git
cd dsh-intelligent-ui
```

也可以直接从 npm 安装，不需要 checkout（见下一节）。

## 前置条件

- **DSH 0.2.1**（[`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)）：Host/Client 与插件协议按这个版本开发；实际验证版本是 `0.2.1-rc.2`，更晚版本未验证。安装：`npm install -g @deepseek-ai/dsh`。
- **[Node.js 24](https://nodejs.org/en/download)**：构建、测试与 `npm pack` 都在 Node 24 下验证；Host 产物编译目标是 Node 22（`target: 'node22'`），仓库没有 `engines` 或 `.nvmrc` 版本锁，使用更低版本前请自行验证。
- **`@deepseek-ai/dsh-client-locale`**：浏览器半边要求部署组合了它；DSH Web 0.2.1 默认包含，缺少时开关和卡片不会挂载（Host 工具与提示词仍可用）。

确认工具存在：

```bash
node --version   # v24.x
dsh --version    # 0.2.1 或 0.2.1-rc.2
```

重启示例覆盖前台 `dsh web`、macOS launchd 与 Linux systemd；用其他方式托管时重启对应服务。验证平台：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）；Linux 未验证。

## 快速开始

从 npm 安装（前置条件见上一节）：

```bash
dsh plugin --profile web add @zephinel/dsh-intelligent-ui

# 固定当前版本
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.2.2-26-10-21

# 或从 GitHub 安装
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
```

重启承载 Web UI 的 DSH 进程（前台 `dsh web`：Ctrl+C 后重新运行；launchd/systemd：重启对应服务），打开它打印的 URL，输入框右侧出现 **UI** 控件即加载成功。

**DSH Desktop（桌面版）** 不需要终端命令，在应用内安装：

1. 侧栏 **插件** → **添加插件**（或箭头 → **安装第三方插件**）。
2. 输入 `@zephinel/dsh-intelligent-ui@0.2.2-26-10-21`（或只填包名装最新版），点 **安装**。
3. 安装完成后点 **立即启用**；若输入框右侧没有 **UI** 控件，退出并重开 DSH Desktop。

桌面版的 profile 由 Electron 应用独占管理，`dsh plugin --profile desktop` 会被拒绝。国内镜像可能晚于 npm 官方源同步刚发布的版本；装不到时把安装源切回 npm 官方源。

本地开发时从 checkout 安装。扩展**没有独立的开发服务器**——它运行在 DSH 里。开发回路是：构建 → 安装进 profile → 重启 DSH Web → 打开它打印的 URL；输入框右侧出现 **UI** 控件即成功。没有 watch 模式，改完重新 `npm run build`，并按下面的缓存提示重启。

```bash
cd /path/to/dsh-intelligent-ui
npm install && npm run build
node scripts/install.mjs  # 写入 $DSH_HOME/profiles/web/cordis.patch.yml（自动备份）
```

> [!IMPORTANT]
> 改了包名或重建 `lib/client.js` 后，只刷新页面可能拿到旧 revision；先重启承载 Web UI 的 DSH 进程，再打开页面。

然后在输入框右侧点 **UI** 控件，选择「仅本会话」（或 `/iui on`），需要时在同一面板里设置本会话的 Auto / Card / Article 样式，直接提问，例如：

```text
帮我排一个上海两日游，要能勾选和调整
```

卸载、开发与排障见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)。

## 开关与回答样式

![输入框右侧的 UI 控件：Off / This session only / Follow global，以及分隔线下的 Display style](assets/intelligent-ui-toggle.png)

![选择「仅本会话」后的样式面板：本会话 Auto / Card / Article 与跟随全局](assets/intelligent-ui-style-panel.webp)

- **全局默认**：插件详情页里的「在所有会话中启用」决定新会话是否默认开启；「回答样式」里的「Display style」决定默认的 Auto / Card / Article。
- **会话覆盖**：输入框 **UI** 控件只改当前会话，选择「仅本会话」后打开样式面板；`/iui on|off|inherit` 与 `/iui style auto|card|article|inherit` 等价。
- **Auto** 由模型按请求选择：交互/结构化用紧凑 Card，详尽/深入/长文用 Article 阅读页。Article 需要 `Toc`、可折叠 `Section` 和实质正文，不是骨架。
- 会话状态原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`，刷新、DSH 重启后保留；完整语义（投影、服务依赖）见[架构与行为](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.md)。

## 使用

打开开关后直接用自然语言提问，例如：

- 「帮我排一个上海两日游，要能勾选和调整」
- 「做一个 7 速自行车的换挡模拟器」
- 「把这几张表变成一个可以筛选的销售看板」
- 「介绍一下中国历史，要能按朝代展开」

开启后，**有结构的回答默认用卡片呈现**——包括讲解、介绍、时间线、阶段、对比和可探索内容；文字只用于单个事实、一两句话的答复、你明确要文字/文档/代码，或渲染连续失败。开关没打开时，模型看不到 `render_ui`，会直接用文字回答——这不是故障；打开开关再问即可。

如果一定要保证出卡片（或模型仍然回了文字），在开关已打开的会话里用 `/intelligent-ui` 显式调用技能；显式调用会被当作直接指令。也可以说「读取 intelligent-ui skill 然后用 render_ui 做一个…」。

![插件详情页：可用性、回答样式、编排方式与导出四组设置](assets/intelligent-ui-settings.webp)

插件详情页按 **可用性**、**回答样式**、**编排方式** 和 **导出** 分组。全局值是新会话的默认；输入框 UI 控件里的会话值优先。**自由布局**只影响设计规范的建议强度，与回答样式正交。**导出** 保存图片的默认背景色、1x/2x 分辨率，以及交互页面是否保留 `@ToAssistant` 追问操作。

回答渲染完成后，消息底部操作栏的**最右侧**会出现一个带「导出」字样的**药丸按钮**（与复制/点赞/分支等自带图标控件区分开）；只有扩展渲染的回答才有这个按钮。点开后可选择图片的美化样式——**原始**（只截取答案本身）、**圆角**（背景色 + 圆角留白）或 **卡片**（留白、圆角与柔和阴影），把该轮的全部渲染结果保存为一张 PNG。导出前会临时展开折叠的卡片，完成后恢复原状；图片只包含渲染出的卡片，不包含聊天里的 Markdown 文字，也不包含导出按钮本身。

菜单底部还有一个 **交互页面** 选项：把该轮全部卡片导出为一个单文件 HTML（内联渲染器、当前主题与卡片程序，约 3.4–4.9 MB）。直接在浏览器里打开就能继续操作地图、表单、滑杆等组件；`@ToAssistant` 不会调用 DSH，而是复制消息并提示「已复制，可回到 DSH 粘贴继续」；如果不需要这些追问按钮，可在插件详情页的 **导出** 分组里关闭「保留追问操作」。单文件不依赖 DSH 或额外脚本，但地图/照片等组件仍要联网。

## 构建、测试与部署

```bash
npm run build       # 生成 prompt、Host 与 Client bundle
npm run check       # 构建 + Host/Client/打包测试 + renderer 检查
npm run pack:check  # 检查 npm pack 的最终文件清单
npm run test:browser # 可选：真实浏览器 E2E（样式面板 + 图片导出 + 交互页面 + Article 间距，需要本机 Chrome）
```

- `npm run check` 里的排版检查（typography）需要本机 Chrome；没有 Chrome 时该检查会跳过，其余测试仍会运行。

发布物是一个 DSH bundle；部署就是把插件安装进目标 DSH profile。卸载、本地开发与版本注意事项见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)。

## 贡献

- 问题与功能请求：使用 [GitHub Issues](https://github.com/Zephinel/dsh-intelligent-ui/issues)。
- 提交前运行 `npm run check`；仓库没有 PR CI，以本地命令结果为准。发布由 GitHub Actions 的 Trusted Publishing 工作流执行（推送与 `package.json` 版本一致的 `v*` tag）。
- 行为、文案或计数变化时，中英 README、`CHANGELOG.md` 与 `docs/` 对应文档要一起更新；同步规则见 `.agents/skills/sync-iui-docs/SKILL.md`（开发环境使用，不随 npm 包发布）。
- 仓库内的维护技能与文档同步规则在 `.agents/skills/`（不随 npm 包发布）；AI 协作代理同样以 `npm run check` 作为提交前门槛。

## 已知限制

- 卡片在该轮**结束时**出现；生成过程中进程区显示一行「交互式回答」（英文界面 "Interactive answer"）。
- 模型偶发生成不合法 OpenUI Lang；Host 校验会返回精确错误，通常同一轮内自修（实测 1–2 次）。
- 地图底图依赖 OpenFreeMap 瓦片，路线依赖 OSRM demo，照片依赖 Wikipedia/Wikimedia；离线时地图降级为地点列表、照片降级为占位块。
- KaTeX 使用 DSH 壳层已加载的全局样式；若该样式被移除，Math 组件会退化为纯文本。
- 生成提示词约 9.5K tokens，**只在开关命中该会话时发送**（全局开启，或该会话显式开启）；关闭时这部分开销为 0（工具 schema 也不出现）。Article 模式会生成更长的页面，输出 token 与渲染时间相应增加。
- 扩展 UI 文案随 DSH 界面语言切换；但 `/iui` 的 Host 返回文案、命令面板里的命令描述与 README 截图仍是英文（前两者是 DSH 平台行为）。
- 导出图片时，沙盒 iframe（`HtmlView` 里的小游戏）不会被截入图片，图片中该区域会缺失；地图通过保留 WebGL 绘制缓冲入图，禁用 WebGL 的浏览器会按地图自身的降级逻辑显示地点列表。
- 同一轮回复渲染出的多张卡片会合并成一张图片；导出的是**当前屏幕上渲染出的内容**，因此导出的图片会包含当时的交互状态（勾选项、筛选结果等）。导出会等待卡片内的图片加载和图片搜索完成（最多约 12.5 秒）；离线或仍未就绪时按页面上的占位状态导出。
- 交互页面导出会把渲染器、当前主题与全部卡片内联进一个 HTML（约 3.4–4.9 MB），因此文件较大但无需安装；地图、照片等组件仍依赖网络。页面里的 `@ToAssistant` 会尝试写入剪贴板并弹出提示；剪贴板不可用时提示会保留原消息供手动复制。
- 浏览器半边要求部署组合 `dsh-client-locale`（DSH Web 0.2.1 默认包含）；最小自定义 profile 缺少它时开关和卡片不挂载，Host 工具与提示词仍可用。
- 插件详情页里的配置依赖 DSH 的 settings 服务：最小自定义 profile 未组合 `dsh-settings` / `dsh-client-ui-settings` 时不出现；Host/Client 版本错位时开关可能显示为不可用。全局启用/样式与自由布局只改变提示词与页面形态，不保证每个模型都完全遵守；会话样式覆盖仍以 Host 注入的提示词为准。

## 文档

- [架构与行为](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.md)：Host/Client 组件树、开关与回答样式的完整语义、界面语言、图片与交互页面导出流程、Agent Skill。
- [开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)：安装与卸载、开发命令、改名/重建后的重启提示、Host/Client 版本错位、发布物布局。
- [验证记录](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.md)：端到端验证、测试与打包结果（历史记录）。
- [变更日志](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/CHANGELOG.md)：按版本记录新增、变更与修复（英文）。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。基于 Open Intelligent UI（MIT, Copyright (c) 2026 Thesys Inc.）与 OpenUI 生态；浏览器 bundle 内含 lucide-react（ISC）、KaTeX（MIT）、MapLibre GL JS（BSD-3-Clause）、zod（MIT）与 SnapDOM（MIT）；交互页面的独立 bundle 还内联 React / React DOM（MIT）。完整声明与许可证全文见 `NOTICE` 与 `licenses/`。
