<img src="icon.svg" alt="dsh-intelligent-ui" width="72" height="72" align="right">

# dsh-intelligent-ui

中文 | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/@zephinel/dsh-intelligent-ui?label=npm)](https://www.npmjs.com/package/@zephinel/dsh-intelligent-ui)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1-4f46e5)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![publish](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml/badge.svg)](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml)

**把 DeepSeek Harness（DSH）的模型回答变成一张真正能用的页面。** 安装并启用后，直接提问：

```text
帮我排一个上海两日游，要能勾选和调整
```

模型调用 `render_ui` 工具，把答案写成一份 [OpenUI Lang 1.0](https://openui.com) 程序；DSH 聊天页在该轮结束时把它渲染成可交互页面——地图、照片、图表、清单、表单、SVG 绘图、小游戏都是真实组件，不是截图。

基于 [Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui)（MIT）移植，并附带一个随插件自动注册的 Agent Skill（`intelligent-ui`）。

> [!NOTE]
> **当前状态**：已发布到 GitHub 与 npm，npm 版本 **`@zephinel/dsh-intelligent-ui@0.5.0`**（`latest`）。自定义样式、按需生成、自由布局与模板文件导入/导出，以及渲染契约、Host 校验与导出语义修复均已包含在 0.5.0 中。

[快速开始](#快速开始) · [获取代码](#获取代码) · [构建、测试与部署](#构建测试与部署)

## 效果

![上海两日行程：照片、地图、时间线、清单、预算与可交互控件都由 OpenUI Lang 渲染](assets/intelligent-ui-itinerary.webp)

- 用户问「帮我排一个上海两日游」，模型不再只回一段文字：回答末尾直接渲染一张可点击、可勾选、可拖动的行程页面（地图 + 照片 + 时间线 + 清单 + 预算）。
- 卡片内的 `$变量`、`@Set`、`@functions` 全部在浏览器本地执行：勾选、滑动条、Stepper、计时器、预算分配都不需要再请求模型。
- 只有真正需要继续对话的动作（`@ToAssistant`，例如表单提交）会把一条简短消息放回输入框并发送。

## 组件一览

渲染器不是把一段文字包进聊天气泡，而是一套完整的组件库：**57 个组件、73 个函数、5 种动作**。下面三张卡片都是扩展的真实渲染结果——同一套渲染器、同一套 DSH 主题 token，没有设计稿：

![一切可渲染的内容：57 个组件、73 个函数、5 类动作，以及布局（11 个）与文本（12 个）组件分组](assets/intelligent-ui-components-layout.webp)

![输入、媒体与数据：13 个输入组件，以及照片、表格、图表、地图与 YouTube](assets/intelligent-ui-components-inputs.webp)

![交互与绘制：翻面卡、撒花开关、十个 Svg 绘图组件与沙盒 iframe 小游戏](assets/intelligent-ui-components-drawing.webp)

## 更多示例

![销售看板：KPI、折线、环图与明细表都随区域筛选实时重算](assets/intelligent-ui-example-dashboard.webp)

![咖啡冲煮小测：翻面卡、答对反馈、得分条与沙盒小游戏](assets/intelligent-ui-example-quiz.webp)

窄屏下卡片自动切为单列，地图与图表按卡片宽度自适应；图表分类标签过长时会截断而不是溢出（约 380 px 宽）：

![窄屏下的手冲咖啡计算器：单列布局、无横向溢出](assets/intelligent-ui-responsive.webp)

## 核心能力

| 能力 | 说明 |
|---|---|
| 交互页面 | 地图、照片、图表、清单、表单、SVG 绘图、小游戏都是真实组件，不是截图 |
| 导出图片 | 把该轮渲染结果保存为一张 PNG：原始 / 圆角 / 卡片三种美化；背景色与 1x/2x 在插件详情页设置 |
| 导出交互页面 | 把该轮全部卡片导出为单个 HTML 文件，浏览器打开后继续交互；`@ToAssistant` 改为复制文案并提示回 DSH 粘贴 |
| 本地执行 | `$变量`、`@Set`、`@functions` 在浏览器运行；只有 `@ToAssistant` 回写消息 |
| 开关与样式 | 全局默认在插件详情页；输入框 UI 控件按会话覆盖；内置 Auto / Card / Article 与自定义模板 |
| 自定义模板与视觉主题 | 保存可复用的展示偏好与明暗配色、字体、圆角、密度、阴影；在「我的样式」中使用、重命名、编辑或删除 |
| 聊天内按需生成 | 无需模板；在 UI 面板选择「按需生成」，正常发送需求，必要时用内置提问工具澄清 |
| 按需自由布局（未发布） | 按用户需求编排页面；保存模板保留自由布局、偏好与主题，再次使用仍无 Card/Article 外壳 |
| 临时结果与可选保存 | 结果自带内联样式快照，可直接使用、调整样式或事后保存为模板；不强制预览、命名或保存 |
| 双语界面 | 跟随 DSH 的中文或英文界面语言 |
| Agent Skill | 随插件注册 `intelligent-ui`，模型按需加载完整语法、示例与排障 |
| 插件详情页 | 集中管理全局启用、默认样式、模板、编排方式与导出偏好 |
| 可重放 | 程序与临时样式随工具参数重放；导出页面冻结导出时的主题方案 |

## 获取代码

从 GitHub 克隆仓库：

```bash
git clone https://github.com/Zephinel/dsh-intelligent-ui.git
cd dsh-intelligent-ui
```

如果要提交改动，先 Fork 本仓库再克隆自己的副本；只想使用插件时，直接安装 npm 包即可（见[快速开始](#快速开始)）。

## 前置条件

以下命令用于 DSH Web 与源码开发；DSH Desktop 用户可直接按[快速开始](#快速开始)中的应用内步骤安装。

- **DSH 0.2.1 插件接口**（[`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)）：Host/Client 与插件协议按这个版本开发；实际验证版本是 `0.2.1-rc.2`，更晚版本未验证。安装命令固定到已验证版本：`npm install -g @deepseek-ai/dsh@0.2.1-rc.2`。
- **[Node.js 24 与自带的 npm](https://nodejs.org/en/download)**：构建、测试与发布工作流使用 Node 24。仓库没有 `engines` 或 `.nvmrc` 版本锁，运行 `npm install` 前需自行选用 Node 24；Host 的 Node 22 编译目标不代表整个工具链已在 Node 22 验证。
- **[Git](https://git-scm.com/downloads)**：仅获取源码时需要，仓库未指定最低版本。
- **`@deepseek-ai/dsh-client-locale`**：浏览器半边要求部署组合了它；DSH Web 0.2.1 默认包含，缺少时开关和卡片不会挂载（Host 工具与提示词仍可用）。

确认工具存在：

```bash
node --version   # v24.x
npm --version
dsh --version    # 已验证：0.2.1-rc.2
git --version    # 仅获取源码时需要
```

重启示例覆盖前台 `dsh web`、macOS launchd 与 Linux systemd；用其他方式托管时重启对应服务。验证平台：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）；Linux 未验证。

## 快速开始

**DSH Web**：从 npm 安装已发布的 0.5.0，再启动 Web UI（首次前台运行示例）：

```bash
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.5.0
dsh web
```

已有 Web 进程时，安装后重启该进程（前台：Ctrl+C 后重新运行 `dsh web`；launchd/systemd：重启对应服务）。打开它打印的 URL，输入框右侧出现 **UI** 控件即加载成功；地址与端口由 DSH profile 决定。

其他安装来源可替代上面的安装命令：跟随 npm 最新版用 `dsh plugin --profile web add @zephinel/dsh-intelligent-ui`；从 GitHub 已提交代码安装用 `dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui`。两者都不会安装当前 checkout 的未提交改动。

**DSH Desktop（桌面版）** 不需要终端命令，在应用内安装：

1. 侧栏 **插件** → **添加插件**（或箭头 → **安装第三方插件**）。
2. 输入 `@zephinel/dsh-intelligent-ui@0.5.0`（或只填包名装最新版），点 **安装**。
3. 安装完成后点 **立即启用**；若输入框右侧没有 **UI** 控件，退出并重开 DSH Desktop。

桌面版的 profile 由 Electron 应用独占管理，`dsh plugin --profile desktop` 会被拒绝。国内镜像可能晚于 npm 官方源同步刚发布的版本；装不到时把安装源切回 npm 官方源。

安装后在输入框右侧点 **UI** 控件，选择「仅本会话」（或发送 `/iui on`），再发送开头的行程示例。该轮结束后出现可交互的行程页面即验证成功。需要时可在同一面板设置本会话的 Auto / Card / Article 样式。

本地开发（从 checkout 构建并安装）、卸载与排障见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)；扩展没有独立的开发服务器。

## 开关与回答样式

![输入框右侧的 UI 控件：Off / This session only / All sessions，以及分隔线下的 Display style](assets/intelligent-ui-toggle.png)

![样式面板：内置 Auto / Card / Article 卡片、自定义样式与底部按需生成入口](assets/intelligent-ui-style-panel.webp)

- **全局默认**：插件详情页的「在所有会话中启用」与「回答样式」设置新会话默认值；可以选择内置样式或已保存的全局模板。
- **会话覆盖**：点 Composer 的 **UI** chip →「仅本会话」或「显示样式」进入面板。上方是内置 Auto / Card / Article 预览卡片，中间是「自定义样式」（已保存模板），底部是「按需生成」。「全部会话」表示本会话跟随全局开关，不会打开全局开关；`/iui on|off|inherit` 与 `/iui style auto|card|article|inherit|<cs_id>` 提供命令入口。
- **Auto** 由模型按请求选择：交互/结构化用紧凑 Card，详尽/深入/长文用 Article。Article 需要 `Toc`、可折叠 `Section` 和实质正文。
- **按需生成**：选择后面板关闭，焦点回到输入框，出现可取消的提示与示例；示例只填入内容，保留已有草稿，不自动发送。正常发送后，清晰需求直接渲染，有重要歧义时由内置 `ask_user_question` 结构化提问，回答后继续生成。
- 会话启用/样式设置原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`；按需操作不改这些设置，临时样式也不是当前选中的样式。完整边界见[架构与行为](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.md)。

![已武装的按需生成提示：示例只填入输入框，不发送](assets/intelligent-ui-on-demand-hint.webp)

## 使用

打开开关后直接用自然语言提问，例如：

- 「帮我排一个上海两日游，要能勾选和调整」
- 「做一个 7 速自行车的换挡模拟器」
- 「把这几张表变成一个可以筛选的销售看板」
- 「介绍一下中国历史，要能按朝代展开」
- 先选「按需生成」，再发送「把这次分析做成紧凑仪表盘，用卡片和图表突出关键指标」
- 点结果下的「调整样式」，再发送「保留内容，改成留白更多的阅读版式」

开启后，**有结构的回答默认用卡片呈现**——包括讲解、介绍、时间线、阶段、对比和可探索内容；文字只用于单个事实、一两句话的答复、你明确要文字/文档/代码，或渲染连续失败。开关没打开时，模型看不到 `render_ui`，会直接用文字回答——这不是故障；打开开关再问即可。

如果一定要保证出卡片（或模型仍然回了文字），在开关已打开的会话里用 `/intelligent-ui` 显式调用技能；显式调用会被当作直接指令。也可以说「读取 intelligent-ui skill 然后用 render_ui 做一个…」。

![临时结果：临时样式标记、调整样式与保存为模板](assets/intelligent-ui-temporary-result.webp)

![同一临时结果在固定深色主题下的渲染](assets/intelligent-ui-temporary-result-dark.webp)

临时结果可以立即使用。点「调整样式」会关联这张结果并在保留草稿的前提下填入调整提示，仍需正常发送；点「保存为模板」才填写名称、描述与可用范围（本会话或全局）；保存完整保留该结果的布局（free/card/article）、偏好与显式明暗主题，不再选择布局。结果没有显式主题时继承会话主题，此时不提供「保存为模板」，因为没有可复制的配色。自由模板使用独立预览与「自由布局」提示；选中后仍无 Card/Article 外壳，保留 DSH 卡片标题栏，Toc/Section 可选。保存复用该结果的已校验样式，不再次生成，也不自动选中模板或更改全局默认；不要求先预览、命名或保存。

**0.5.0 起**：Host 要求新按需生成使用自由布局；调整保留父结果的布局（free、旧 card 或 article）。若父快照已不在最近 200 条结果注册表中，调整会报错；请取消调整后重新选择「按需生成」。历史结果仍可从工具参数重放。

![插件详情页：全局启用、默认样式、我的样式管理、编排方式与导出](assets/intelligent-ui-settings.webp)

插件详情页按 **可用性**、**回答样式**、**我的样式**、**编排方式** 和 **导出** 分组。「我的样式」管理已保存的全局模板，可设为默认、重命名、编辑描述/展示偏好、导出文件、导入模板或删除；Composer 管理当前会话可见的全局与会话模板。生成入口在 Composer，设置页提供说明，不设生成工作台。全局值是新会话的默认；输入框 UI 控件里的会话值优先。**自由布局**只影响设计规范的建议强度，与回答样式正交。**导出** 保存图片的默认背景色、1x/2x 分辨率，以及图片/交互页面是否移除 `@ToAssistant` 追问控件及其表单字段（含正文的 Card 保留正文，只有纯追问区块整块消失；默认移除）。

**模板文件分享**：在插件设置页「我的样式」或 Composer 的「显示样式」面板中点模板的 `…` →「导出文件」，检查敏感信息提示后点「下载」，得到 `<模板名>.iui-style.json`。Composer 面板同时覆盖仅本会话的模板，因此不必先另存为全局模板。文件包含名称、描述、基础布局、展示规范全文和主题；分享前检查其中是否包含个人或内部信息。接收方在「我的样式」或「显示样式」面板点「导入模板」，选择文件或粘贴 JSON →「预览」→ 检查名称、描述、布局、明暗色板及展示规范全文。可以改名、编辑或清空展示规范；导入前必须勾选「我已阅读并理解上述风险，确认导入该外部模板」，再点「导入模板」。导入只新建全局模板（Composer 里的导入同样只写全局；导入到本会话仍待会话授权校验后开放），不自动应用，也不改变当前选择或全局默认；随后可正常选用、编辑、删除或再次导出。

模板交换格式 v1 只包含可移植样式配置，支持 `card|article|free`，不含本地 id、作用域、会话和时间戳。支持 v1 的插件版本可以导入该格式；未知版本会被拒绝，不尝试降级解析。导入器只接受该交换格式：原始模板导出文件与持久化库文件都会被拒绝（当前没有外部用户，不维护旧格式兼容）。交换格式版本独立于 npm 包版本；未来引入 v2 应继续支持 v1，新增布局或移除 `baseLayout` 必须显式演进格式，不允许 v1 静默接受未知布局。

单次只交换一个模板，输入最多 **32 KiB（UTF-8 字节）**；文件大小先检查再读取，不依赖扩展名或 MIME。允许全文包住的一层 Markdown 代码围栏，不从任意说明文字中提取 JSON。未知字段和模板库备份均拒绝。全局最多 40 个模板；重名时建议 `(Imported)` 后缀，仍冲突时需改名，配额满时先删除不需要的模板。没有分享码、在线链接、批量备份或会话范围导入；Composer 的导入同样只写全局。

**安全边界**：外部模板的名称与展示规范会进入提示词、可能影响模型行为；描述仅保存/导出，不会进入提示词。三者都按不可信文本处理，预览、阅读确认和不自动应用是缓解措施，不能消除提示词注入；实际执行权限仍由 DSH 工具/权限层控制。当前实现按 owner 已确认的方案（2026-10-24）用免责声明 + 阅读确认后保留外部内容；真实部署的 Origin/CSRF 与工具越权审计仍是发布前建议补做的加固。

回答渲染完成后，消息底部操作栏的**最右侧**会出现带「导出」字样的**药丸按钮**（只有扩展渲染的回答才有）。点开后可把该轮全部卡片保存为一张 PNG——**原始**（只截取答案本身）、**圆角**（背景色 + 圆角留白）或 **卡片**（留白、圆角与柔和阴影）；也可以导出为单文件 HTML，直接在浏览器打开即可继续交互，页面里的 `@ToAssistant` 改为复制消息并提示回到 DSH 粘贴。导出的图片只包含渲染出的卡片，不包含聊天里的 Markdown 文字或导出按钮本身。完整流程见[架构与行为](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.md)。

## 构建、测试与部署

从[获取代码](#获取代码)的 checkout 根目录开始。`npm install` 的 `prepare` 会自动构建；本地安装器默认写入 `web` profile 并自动备份。若该 profile 已安装 npm/GitHub 版，先用 `dsh plugin --profile web remove @zephinel/dsh-intelligent-ui` 移除，避免同一插件重复注册。

```bash
npm install
dsh plugin --profile web list  # 检查 profile；首次使用会初始化
node scripts/install.mjs
dsh web
```

已有 Web 进程时，安装后重启该进程，再打开它打印的 URL；输入框右侧出现 **UI** 控件后按[快速开始](#快速开始)启用并试问。扩展没有独立开发服务器或 watch 模式；每次修改后重新 `npm run build` 并重启 DSH。卸载与排障见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)。

日常检查与打包：

| 命令 | 用途 |
|---|---|
| `npm run build` | 生成 prompt、Host、Client 与独立导出页面 bundle |
| `npm test` | 构建后运行 Host、Client 与打包的 Node 测试 |
| `npm run typecheck` | 运行 `tsc --noEmit`（浏览器 `src/client` 暂因运行时平台类型不可解析而排除） |
| `npm run check` | 提交前完整检查：typecheck、构建、Node 测试与 renderer 检查 |
| `npm run pack:check` | 预览 npm 包最终文件清单，不发布 |
| `npm run test:browser` | 先构建；运行 7 个浏览器套件，需要 Chrome |

- 当前 main 分支验证记录：Node 测试 **247/247**（Host 117、Client 109、packaging 21）；renderer 解析/渲染各 **42/42**，CSS/组件契约 **50/50** 与 **63/63**，排版 **22/22**，i18n **4** 个程序；浏览器 **7/7** 套件通过，其中设置页模板交换 **101** 条、按需流程 **114** 条、交互页面 **46** 条、图片导出 **65** 条断言。浏览器测试覆盖组件/契约；真实模型验证范围与尚未覆盖的场景见[验证记录](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.md)（历史记录）。
- `node scripts/capture-screenshots.mjs` 以固定 DSH token、生产组件与假服务在 Chrome 2x 重建面板、提示、临时结果与设置截图；英文 UI，卡片壳层图标用 lucide 替身。
- `npm run check` 里的排版检查（typography）需要本机 Chrome；没有 Chrome 时该检查会跳过，其余测试仍会运行。非默认安装位置可用 `CHROME_BIN` 指定 Chrome 可执行文件（也适用于浏览器套件）。

发布物是一个 DSH bundle；部署就是把插件安装进目标 DSH profile。卸载与版本注意事项见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)。

## 贡献

- 问题与功能请求：使用 [GitHub Issues](https://github.com/Zephinel/dsh-intelligent-ui/issues)。
- 提交 PR 前运行 `npm run check`；仓库没有 PR CI，以本地命令结果为准。发布由 [GitHub Actions Trusted Publishing 工作流](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/.github/workflows/publish.yml)执行，流程见开发文档。
- 贡献者与 AI 协作代理都应遵循[文档同步技能](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/.agents/skills/sync-iui-docs/SKILL.md)：行为、文案或计数变化时，同步中英 README、`CHANGELOG.md` 与 `docs/` 对应文档。checkout 中以本地 `.agents/skills/sync-iui-docs/SKILL.md` 为准。
- 维护者：[@Zephinel](https://github.com/Zephinel)。

## 已知限制

- 卡片在该轮**结束时**出现；生成过程中进程区显示一行「交互式回答」（英文界面 "Interactive answer"）。
- 模型偶发生成不合法 OpenUI Lang；Host 校验会返回精确错误，通常同一轮内自修（实测 1–2 次）。
- 地图底图依赖 OpenFreeMap 瓦片，路线依赖 OSRM demo，照片依赖 Wikipedia/Wikimedia；离线时地图降级为地点列表、照片降级为占位块。
- KaTeX 使用 DSH 壳层已加载的全局样式；若该样式被移除，Math 组件会退化为纯文本。
- 生成提示词约 10K tokens，**只在开关命中该会话时发送**（全局开启，或该会话显式开启）；关闭时这部分开销为 0（工具 schema 也不出现）。Article 模式会生成更长的页面，输出 token 与渲染时间相应增加。
- 扩展 UI 文案随 DSH 界面语言切换；但 `/iui` 的 Host 返回文案、命令面板里的命令描述与 README 截图仍是英文（前两者是 DSH 平台行为）。
- 导出图片时，沙盒 iframe（`HtmlView` 里的小游戏）不会被截入图片，图片中该区域会缺失；地图通过保留 WebGL 绘制缓冲入图，禁用 WebGL 的浏览器会按地图自身的降级逻辑显示地点列表。
- 同一轮回复渲染出的多张卡片会合并成一张图片；导出的是**当前屏幕上渲染出的内容**，因此导出的图片会包含当时的交互状态（勾选项、筛选结果等）。导出会等待卡片内的图片加载和图片搜索完成（最多约 12.5 秒）；离线或仍未就绪时按页面上的占位状态导出。
- 交互页面导出会把渲染器、当前主题与全部卡片内联进一个 HTML（约 3.4–4.9 MB），因此文件较大但无需安装；地图、照片等组件仍依赖网络。页面里的 `@ToAssistant` 会尝试写入剪贴板并弹出提示；剪贴板不可用时提示会保留原消息供手动复制。
- 浏览器半边要求部署组合 `dsh-client-locale`（DSH Web 0.2.1 默认包含）；最小自定义 profile 缺少它时开关和卡片不挂载，Host 工具与提示词仍可用。
- 插件详情页里的配置依赖 DSH 的 settings 服务：最小自定义 profile 未组合 `dsh-settings` / `dsh-client-ui-settings` 时不出现；Host/Client 版本错位时开关可能显示为不可用。全局启用/样式与自由布局只改变提示词与页面形态，不保证每个模型都完全遵守；会话样式覆盖仍以 Host 注入的提示词为准。
- 交互页面导出需要部署提供 `webServer` 服务（DSH Web 0.2.1 默认包含）；最小自定义 profile 缺少它时无法导出交互页面，图片导出不受影响。

- 临时样式保存在工具参数/结果快照中，不进入模板库；历史工具参数仍在加载窗口时可重放。事后保存依赖有界结果注册表（最近 200 条），被淘汰的结果可能仍能重放但无法再保存。保存模板与结果快照在 `<DSH_HOME>` 的独立 JSON 文件中持久化。
- 样式创建/按需生成使用部署的默认主对话模型服务；扩展不提供独立生成模型或 draft 访谈服务。`ask_user_question` 是结构化澄清路径；工具不可用时降级为文字提问，文字轮结束后提示会保留，下一条消息继续同一操作，不需要重新选择「按需生成」（过期、重启或失败后除外）。
- 按需操作只在内存中：等待发送（armed）10 分钟过期，重启后活动操作无法恢复，需要重新武装；已完成结果不因此丢失。每会话最多一个活动操作：armed 时重新武装会替换，已绑定的 running/clarifying 拒绝重新武装且需先取消；最多两轮澄清。文本结束但未渲染时操作回到待继续状态，下一条消息继续；失败/中断会显示重试/关闭提示。
- 多标签页采用保守绑定：提示只显示在发起标签页，但 Host 绑定该会话的下一条人工消息，并不验证发送标签来源；请在发起标签页发送，避免另一标签同时发送。
- 自定义主题只应用到 renderer host，portaled Popover 与沙盒 iframe 保留默认主题；语义状态色保持渲染器定义。导出交互页面冻结导出时的明/暗方案，不随系统切换。
- 已保存模板的 directives 是有界展示偏好（最多 2,000 字符），不能覆盖系统、工具或安全规则；模板库上限为全局 40 个、每会话 20 个。删除/不可用的已保存模板按默认主题降级；没有显式主题的临时结果沿用会话模板或内置主题，带显式主题的快照单独重放/导出、不依赖模板库。

## 常见问题

**必须先建模板、预览或命名吗？** 不需要。选「按需生成」后正常聊天，结果可以直接使用；只有主动「保存为模板」才需要名称。临时结果不会替换当前会话选中的样式。

**能晚些保存或继续调整吗？** 可以。使用那张结果下的「调整样式」或「保存为模板」；保存的是点选结果的版本，不会自动保存后来生成的版本。注册表已淘汰该结果时会提示快照不可用。

**为什么追问后没有继续生成？** 结构化 `ask_user_question` 回答会恢复同一操作；文字提问后，下一条消息会自动继续同一操作。只有过期、重启、失败或中断后才需要重新武装/重试。多个标签同时发送也可能消费同一意图。

**为什么回答只有文字、没有卡片？** 先确认该会话的开关已打开（输入框右侧 **UI** 控件，或 `/iui on`）；开启后模型仍可能把单个事实、一两句话或明确的文字/代码请求当作有界例外。想强制出卡片时，在开关已打开的会话里用 `/intelligent-ui` 显式调用技能。详见[使用](#使用)。

**回答底部为什么没有「导出」按钮？** 只有扩展渲染出的回答才有这个药丸按钮；开关关闭、模型用文字回答或渲染失败时都不会出现。详见[使用](#使用)与[已知限制](#已知限制)。

**重建插件后 UI 没变化或报错？** 只刷新页面可能拿到旧 revision：先重启承载 Web UI 的 DSH 进程，再打开页面。具体错误信息与处理方式见[开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)。

## 文档

详细文档、变更日志与仓库维护技能不随 npm 包发布，因此链接使用绝对 GitHub 地址；未提交功能以 checkout 内对应文件为准。

- [架构与行为](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.md)：Host/Client 组件树、开关与回答样式的完整语义、界面语言、图片与交互页面导出流程、Agent Skill。
- [开发与部署](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.md)：安装与卸载、开发命令、改名/重建后的重启提示、Host/Client 版本错位、发布物布局与插件市场维护。
- [验证记录](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.md)：端到端验证、测试与打包结果（历史记录）。
- [变更日志](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/CHANGELOG.md)：按版本记录新增、变更与修复（英文）。
- [GitHub Releases](https://github.com/Zephinel/dsh-intelligent-ui/releases)：带日期的版本发布页与安装说明。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。基于 Open Intelligent UI（MIT, Copyright (c) 2026 Thesys Inc.）与 OpenUI 生态；浏览器 bundle 内含 lucide-react（ISC）、KaTeX（MIT）、MapLibre GL JS（BSD-3-Clause）、zod（MIT）与 SnapDOM（MIT）；交互页面的独立 bundle 还内联 React / React DOM（MIT）。完整声明与许可证全文见 [NOTICE](NOTICE) 与 [licenses/](licenses/)。
