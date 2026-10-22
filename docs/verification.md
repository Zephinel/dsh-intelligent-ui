# 验证记录

中文 | [English](verification.en.md)

[← 返回 README](../README.md)

以下为一次历史验证记录；其中的测试数量与打包大小按最近一次 `npm run check` / `npm pack` 输出更新。

在隔离的第二个 DSH Web 实例（3081 端口，同一 profile + patch overlay）上做过端到端验证：

- 模型按提示词调用 `render_ui`，生成 31–117 条语句的页面；非法程序被 Host 拒绝并给出精确字段错误，模型在同一轮内自修成功。
- 组件总览页、旧金山行程、咖啡计算器、SVG 折纸教程均正常渲染；照片（Wikipedia/Wikimedia）、MapLibre 地图 + pin、图表、表单、计时器、翻转卡、撒花、HtmlView 动画可用。
- 交互：勾选时间线计数更新、SegmentedControl 联动、表单与按钮状态正常；暗色主题自动切换。
- 响应式：390 / 546 / 768 / 1092 px 下无横向溢出（补齐了组件库依赖的 `box-sizing` 作用域 reset）。
- 测试（实时子项，2026-10-22 R4）: `npm run check`：179/179（Host 77 + Client 81 + packaging 21）；renderer 解析 41/41、SSR 41/41、contrast OK、i18n 4 个程序、typography 22/22；`npm run pack:check`：43 个文件，tarball 4,036,017 字节，解包 10,215,182 字节。下方旧浏览器/模型记录保留为历史，当前证据与边界见末尾 R4 记录。
- **Agent Skill 端到端**：在真实 DSH 会话里模型调用 `skill { name: "intelligent-ui" }` 成功加载 `<skill_content>`（15 KB 正文 + references 基目录提示），随后按技能用 `render_ui` 生成并渲染了验证页。
- **bundle 安装链路**：用 `npm pack` 产物在一次性 profile（`~/.dsh/profiles/zbundle-test`，依赖 `file:/tmp/…tgz` + `dsh.profile.bundles`）里安装，`dsh --profile zbundle-test --dump-config` 退出 0，输出出现 `# == @zephinel/dsh-intelligent-ui` 与插入行 `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'`（验证后已清理）。
- **三档开关端到端（0.2.1 时代记录）**：默认「关闭」请求里没有 `render_ui`、提示词为空；选「仅本会话」后本会话请求带工具与提示词并渲染出卡片，而新开会话仍是关闭；选「全部会话」后新开会话直接带工具与提示词；选「关闭」后文件清空、新会话再次无工具无提示词；两个标签页之间控件状态通过 BroadcastChannel 同步；状态文件 `{ "global": false, "sessions": [] }` 与投影行为符合预期。0.3 的会话开关/样式覆盖与 Article 页面尚待实机验证。
- **Style panel 浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 先用无头 Chrome + CDP 加载 `test/browser/harness` 的 `ToggleControl`，验证 chip → menu（无「全部会话」、含「显示样式」）→ 仅本会话 → 样式面板，以及面板内返回按钮回到作用域菜单而不是关闭全部浮层、返回后焦点落在「显示样式」行；菜单宽度按内容且不小于 208px、右缘与 chip 对齐、统一最小行高与间距、分割线内缩、展开时 chevron 旋转 180°；关闭开关后「显示样式」仍显示但为 disabled，点击不能打开面板；面板矩形完全在视口内，焦点进入面板；拖动真实滑杆到 Article 后发出 `style:article`；Escape 关闭后焦点回到 chip。该测试不启动完整 DSH Web，也不替代 Host/Client 集成 E2E。
- **图片导出浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 随后加载 `test/browser/harness/export-entry.tsx`：真实 `ExportAction` + 真实渲染器卡片 + 两个入口（其中一个的 Chat selector 经结构化快照运行真实的 `messageHasRenderUi` 并报告无渲染输出），卡片里是真实的 `SearchImage`，其 Wikipedia 查询由 harness stub 到本地 SVG。断言只有扩展回答出现导出药丸按钮（带可见「导出」文案、`order:1`、贴齐操作栏右缘）；导出菜单右缘与按钮对齐、宽度按内容，上方空间不足时翻到按钮下方，并在触发 scroll 后立即关闭；打开菜单依次导「原始」「卡片」和「圆角 2x」：卡片初始为折叠态，截图时已展开、完成后退回折叠；3D 翻面已展平为可见面、过渡/动画已冻结、lazy 图片改为 eager 且完成加载；harness 用带同样就绪属性的假地图验证导出会等待 resize 后的地图就绪；card 帧尺寸比 raw 多出两侧 padding + 阴影留白且底部留白能采到非零阴影像素，圆角 2x 帧尺寸为 raw 的 2 倍再加 2x padding。该测试不启动完整 DSH Web；跨域 Wikimedia 图片的抓取另用同一 session 程序手工复现（见下一条）。
- **交互页面浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 的交互页面脚本把真实的 `lib/standalone.js` / `lib/standalone.css`、当前主题快照与两张卡片程序交给 `buildStandaloneHtml` 生成单文件 HTML，直接在无头 Chrome 中打开该文件：断言页面没有外部 script/stylesheet 引用、体积 ≥3.4 MB、两张卡片的正文都挂载且没有标题栏/折叠控件、内联主题改变页面背景，并点击一个 `@ToAssistant` 按钮确认页面复制兜底会弹出提示而不调用 DSH；随后打开开启「移除追问操作」的同一页面，断言包含追问的 Card 被整块隐藏（包括 Card 内 Row 里的按钮）、非追问的 `@OpenUrl` 按钮仍可见、根级追问只隐藏控件而不隐藏页面，并检查没有 `html` 级隐藏属性。图片导出 E2E 也新增开启该开关后追问 Card 不进入 PNG（截图高度变小）的断言。该测试不启动 DSH Web。
- **自定义选色器浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 的 settings-picker 脚本渲染真实 Plugin 详情页，断言原生 `input[type=color]` 已移除、背景色触发器和 12 个预设色块存在；点击预设会保存 `exportBackground`，输入十六进制并按 Enter 会保存并关闭面板；真实鼠标的“hex 有焦点时点预设”和“输入后点面板外”路径分别验证预设获胜、有效草稿被提交。
- **Article 间距浏览器 E2E（组件级，可复跑）**：第四个 `npm run test:browser` 脚本渲染一个 Article fixture，断言每个 `Section` 正文是独立 flow、正文块间距为 16px（标题到后续块 12px）且不再贴在一起；同时断言页面级 flow 没有额外的 18px flex gap，section 间距保持单一级距（约 24px）而不是双倍留白。
- **导出追问开关**：Plugin 详情页 **导出** 分组新增「移除追问操作」开关（Host volatile `removeFollowUps`，默认开启）；开启后图片与 Standalone 页面都会隐藏包含 `@ToAssistant` 控件的语义区块（Card/Form/Carousel item/Pressable/Row），并禁用复制回调；关闭后保留区块并恢复页面复制兜底。设置对图片与页面同时生效。设置 SSR、图片导出 E2E 与 standalone-page E2E 覆盖；另有 `to-assistant` 单测锁定“裸按钮才是追问、带本地 action 的按钮不是”的语义和旧 `exportToAssistant` 迁移。
- **布局/间距契约**：生成提示词与 Agent Skill 增加布局与间距条目；Host `layoutWarnings` 对根 `gap`、纵向 `Spacer()`、空 `Section`/`Text`、`gap: 0` 块栈返回非致命 warning（Host 单测覆盖）；Article 的 Section 正文改为嵌套 flow、页面根不再叠加 flex gap，article-layout E2E 用实测间距（16/16/12/16px，section 约 24px）护栏。
- **图片导出（2026-10-22，组件级 + 浏览器实验）**：底部导出入口与图片导出已实现并构建通过。用无头 Chrome + CDP 在临时 harness（真实 `ExportAction` + 真实渲染器卡片）上验证：导出按钮只在记录过 `render_ui` 的消息出现；菜单含原始 / 圆角 / 卡片；折叠卡片在截取时展开、完成后恢复；2x 圆角美化输出 1616×2348 PNG、背景色生效、文件名带标题与本地时间。MapLibre 截图实验：默认 `preserveDrawingBuffer: false` 时 canvas `toDataURL` 为空白（约 9 KB），开启 `canvasContextAttributes.preserveDrawingBuffer` 后为完整地图（约 449 KB），`render` 事件内抓帧同样可行。该验证不启动完整 DSH Web；重启 DSH Web 后的真实会话人工点验尚未进行。随后用会话 `c3a17e93-b553-4f6f-8734-3997fa02a751` 的历史程序复现并修复了真实导出中发现的两个缺陷：翻卡片 3D 双面重叠（截图中文字重叠）与图片搜索/加载未完成导致的空图片框；修复后的翻卡片展平与图片落定路径由 `npm run test:browser` 的 `export-image` E2E 覆盖（图片搜索用本地 stub、跨域 Wikimedia 抓取另行手工复现）；同一 E2E 也用尺寸与像素质检覆盖 card 阴影帧。
- **界面语言**：zh/en 字典 key 对齐、档位控件中文 SSR、渲染器组件（Code / Timer / Map / 空程序兜底）中文与英文回退 SSR 均由自动检查覆盖；尚未在运行中的 Web UI 里手动切换语言做人工点验。
- **0.2.0 发布**：推送 tag `v0.2.0-26-10-21` 触发 GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955)（`publish.yml`，33 s）并完成发布；registry `latest` = `0.2.0-26-10-21`，`gitHead` = `e5ce0af`，`npm audit signatures` 验证了 registry signature 与 provenance attestation（SLSA v1）。GitHub release：[v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21)。
- **0.2.1 发布**：配置从 Settings 迁移到插件详情页（`plugins.bundle.config`，key 为包名），开关改用 DSH 原生样式；tag `v0.2.1-26-10-21` 触发 [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971)，registry `latest` = `0.2.1-26-10-21`（`gitHead` = `4dcd34b`），`npm audit signatures` 验证了 provenance；本地 `npm run check` 65 tests、`npm pack` 34 个文件。GitHub release：[v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21)。
- 已验证的 DSH 版本：**0.2.1-rc.2**（`dsh --version`）。更晚的版本未验证。
- **平台覆盖**：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）均已安装并验证基本使用（输入框 UI 控件、卡片）；Linux 未验证。
- **0.2.2 发布**（纯文档）：修正 README 的 CJK 加粗渲染与平台验证说明；tag `v0.2.2-26-10-21` 触发 [run 39598770488](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39598770488)，registry `latest` = `0.2.2-26-10-21`（`gitHead` = `aac3f86`），provenance 已验证；无代码或行为变化。
- **0.3.0 发布**：把回答样式、图片导出与交互页面导出作为 0.3.0 发布，并修正随包 Agent Skill 的工具契约文档；tag `v0.3.0-26-10-22`（annotated）触发 [run 39785829751](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39785829751)（40 s），registry `latest` = `0.3.0-26-10-22`，`gitHead` = `8cfd0cd`；GitHub Release 于 2026-10-22 回填：[v0.3.0-26-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.3.0-26-10-22)。provenance 记录在透明度日志（logIndex 3388870856），临时目录安装后 `npm audit signatures` 报告 2 个包 attestation 验证通过。本地 `npm run check` 102 tests，`npm pack` 40 个文件（3.63 MB / 解包 9.45 MB）。实测 registry 元数据在 publish 后约 5 分钟才可见、tarball 又晚 1–2 分钟（期间 `npm install` 返回 404），不是发布失败。

- **0.4.0 发布**：把自定义样式模板、聊天内按需生成及其生命周期/内容接地修复作为 0.4.0 发布；tag `v0.4.0`（annotated）指向发布提交 `3a3d6a8`，触发 [run 39850727142](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39850727142)（44 s，success）。registry `latest` = `0.4.0`，`gitHead` = `3a3d6a8`；临时目录安装后 `npm audit signatures` 报告 4 个包 registry signature、2 个包 attestation 验证通过。本地 `npm run check` 179 tests，`npm pack` 43 个文件（4,036,017 字节 / 解包 10,215,182 字节）。registry 元数据在 publish 后约 2–3 分钟才显示 `0.4.0`，属传播延迟，不是发布失败。

## 2026-10-22 — R4 自定义模板与聊天内按需生成

本条是当前未提交工作区的增量文档/截图同步，不是发布验收。基于 HEAD `155585c9afcc943b98e7fb5b36a2a2f0e4b51c49` 加既有 R1–R3 改动；本阶段未更改 src、依赖、版本或计划/审查历史，也未提交/发布。环境：Node v24.22.0、npm 11.19.1、Google Chrome 155.0.8059.86。

### 自动化结果

| 命令 / 检查 | 本阶段结果 |
| --- | --- |
| `npm run check` | PASS；179/179 Node 测试 = Host 77 + Client 81 + packaging 21，0 失败、0 跳过 |
| renderer（包含于 check） | 解析 41/41、SSR 41/41（使用现有 `/tmp/oiui/src/app/gallery` fixture）；contrast OK；i18n 4 个程序（zh/en fallback）；typography 22/22，Chrome 实际执行 |
| `npm run pack:check` | PASS；43 个文件；tarball **4,036,017 字节**（4.04 MB），解包 **10,215,182 字节**（10.22 MB） |
| 构建产物 | `lib/index.js` 637,813 字节；`lib/client.js` 3,763,748 字节；`lib/standalone.js` 3,426,892 字节；`lib/standalone.css` 511,833 字节 |
| `npm run test:browser` | PASS，7/7 套件：on-demand（85 断言）、style-panel、style-theme、export-image、standalone-page、article-layout、settings-picker；均非跳过 |
| `node --test test/packaging/*.test.mjs` | PASS，21/21；manifest 9 + references 6 + guardrails 6；13 个 assets 均被两份 README 引用，locale meta key 一致 |
| 文档检查 | README 与三组 docs 双语标题层级一致；本地链接/锚点、绝对 GitHub 文档路径、语言切换、clone URL 与 CHANGELOG 链接有效 |
| `git diff --check` | PASS |

首次与截图任务同时进行的浏览器运行在 `export-image.e2e.mjs:228` 点击菜单项时报 `Cannot read properties of null (reading 'click')`；未修改产品或该测试，完整串行重跑 7 个套件通过。根因未确认，保留为一次浏览器运行不稳定记录。SSR 的 React useLayoutEffect 提示仍可见，渲染检查退出 0，不把这些提示写成运行失败。

当前组件级证据覆盖：完整生产 slot/命令/焦点接线、草稿保护、armed 提示与取消、临时卡片调整/保存、模板管理与错误态；无 catalog 时临时快照重放、主题切换/恢复；PNG 像素与 HTML 中的临时/已保存模板主题快照。图片导出 fixture 使用本地照片、假地图就绪信号与精简 standalone 资产；独立页面套件使用真实构建产物。它们不能证明 DSH 服务或真实模型会遵守协议。

### 截图与复现

`node scripts/capture-screenshots.mjs` 在临时 HTTP 服务 + 无头 Chrome/CDP 中挂载生产 `ToggleControl`、`OnDemandHint`、`IntelligentUICards`、`SettingsPage`，配固定 light/dark token 与假 projection/catalog/form；deviceScaleFactor 为 2。`scripts/screenshot-entry.tsx` 提供固定内容，壳层卡片图标因 DSH primitives 由 live loader 提供而采用 lucide 替身。没有手工编辑图片。layout/tour 仍可复跑；完整捕获重跑到独立目录后，7 张输出与 assets 的 SHA-256 逐一一致。

| 截图 | 输出像素 |
| --- | --- |
| `assets/intelligent-ui-components-layout.webp` | 1616 × 4040 |
| `assets/intelligent-ui-settings.webp` | 1336 × 2690 |
| `assets/intelligent-ui-toggle.png` | 1080 × 800 |
| `assets/intelligent-ui-style-panel.webp` | 1080 × 1860 |
| `assets/intelligent-ui-on-demand-hint.webp` | 1520 × 598 |
| `assets/intelligent-ui-temporary-result.webp` / `assets/intelligent-ui-temporary-result-dark.webp` | 各 1536 × 1032 |

已用 `node scripts/capture-screenshots.mjs --dark --out-dir=/tmp/iui-r4-dark` 重跑全部 7 项深色截图；这些临时输出不进入 assets。READMEs 共引用 13 张资产，既有真实会话示例未改。Composer 实际标签为「自定义样式」，设置页为「我的样式」；截图遵循当前代码。

### 真实模型状态与重启后的待验场景

**本阶段未运行真实模型 DSH 端到端验证。** 上方历史模型记录不能证明本次重构通过。Owner 重启承载 DSH Web 的进程并重新打开页面，使 Host/Client 同时加载当前构建后，仍需逐项验证：

1. 清晰需求：Composer → 按需生成 → 普通消息直接 render，无冗余追问、预览、命名、确认或强制保存；完成后下一条普通消息不重复触发。
2. 真正歧义：默认主对话模型可用 `ask_user_question`，选项/自由输入/跳过、阻塞或超时后的回复恢复正确；最多两轮，未回答前不提前渲染。缺工具时文字降级与重新武装提示可理解。
3. 结果与调整：保留原草稿和内容，多次调整绑定正确父结果；保存旧结果与新结果各自的快照，directives 是可跨内容复用的设计规则，无业务/私有数据复制。
4. 保存/管理：不保存即可用；本会话/全局保存、重名、容量、删除当前默认、失效模板、设置只管理持久模板且无生成工作台；不意外改会话样式或全局默认。
5. 生命周期：取消、失败后重新武装、10 分钟 armed 过期、重启后操作清空；两个标签页避免误消费，并确认提示只出现在发起标签页。Host 仍绑定该会话下一条人工消息，无发送来源隔离保证。
6. 历史与导出：重启后 DSH 历史确实保留完整 temporaryStyle 参数，catalog 不可用时临时结果仍重放；200 条结果淘汰后的保存错误明确。检查实际 PNG 与单文件 HTML、明暗切换、文章/卡片、真实媒体，以及导出后冻结 scheme 的行为；portaled Popover/iframe 保留默认主题。

这些模型/部署行为没有机械门禁保证；当前实现也没有独立 revisionId 或服务端保存幂等键。以 callId 标识不可变结果、重复名称报错的事实已写入 as-built 文档；批准的 §13/§14 与审查原文保持不变。

### 2026-10-22 — R4 后激活修复（工具 JSON Schema 子集）

R4 完成后首次让新 Host 激活时，插件条目显示 Problem，composer 的 UI 入口消失；Host 日志为：

```
JsonSchemaError: unsupported JSON schema: schema.properties.styleId.maxLength is not a supported keyword
(subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)
```

原因：`render_ui` 的输入/输出 JSON Schema 使用了 DSH 0.2.1 工具注册不接受的 `maxLength` / `minLength` / `pattern`。修复：把这些限制移到 `description`，继续在 execute 中做严格校验；`test/host/tool.test.mjs` 新增同规则的 schema 子集守卫（并额外用已安装 `dsh-tools` 的 `assertSupportedJsonSchema` 验证构建产物）。重新构建后：

- `npm run check`：**179/179**（Host 77 + Client 81 + packaging 21）；renderer 不变；`lib/index.js` 639718 字节。
- 在第二个独立 DSH Web 实例（127.0.0.1:3081，同一 profile、无并发写入会话）实测：Host 正常激活，插件条目不再 Problem，composer 出现 UI 控件；作用域菜单、样式面板、My styles/On-demand UI 入口、armed 提示、示例填充草稿、取消操作均正常，无控制台/页面错误。该实例没有调用真实模型，且已关闭；**主实例仍需重启**才能加载修复。

### 2026-10-22 — R4 后按需生成时序修复与真实模型验证

在隔离实例中做真实模型验证时发现：DSH 在 step 内先写 `system/message`、后写本次 `user/message`，而控制器只在 `user/message` 绑定 Operation，因此按需 turn 的首个系统提示词里没有 ON-DEMAND note，模型按普通样式渲染；用户再次点按需生成时还会替换正在运行的操作。修复：

- `promptNote` 在 **armed** 阶段也注入；绑定后继续注入。
- 已绑定 running/clarifying 时拒绝再次武装，必须先显式取消。
- 按需 turn 中不带 `temporaryStyle` 的普通 `render_ui` 直接拒绝，要求模型改用临时快照或先提问。
- 新增对应 Host 单测（总计 **179/179**：Host 77 + Client 81 + packaging 21）；`lib/index.js` 639718 字节。

真实模型 DSH E2E（第二个独立实例，127.0.0.1:3081，同一 profile，未动主实例）：新建会话 → 按需生成 → 点示例「Make this analysis a compact Linear-style dashboard」→ 发送。真实模型（DeepSeek-V4.1-Flash）调用 `render_ui` 并带 `temporaryStyle`，页面出现「Temporary style」徽标和临时主题；结果注册表写入 1 条快照（含可复用 directives 与明暗主题）；「Save as template」成功创建模板并写入样式库。测试后已停止实例、删除测试模板与结果记录。仍未真机验证：真正的歧义澄清/`ask_user_question`、连续调整绑定、多标签页、重启后历史重放、真实图片/单页导出；这些仍是待手验项。主实例需再次重启以加载本轮 Host 修改。

### 2026-10-22 — R4 后按需生成状态与内容澄清补强

用户在真实模型测试中提出两点：按需提示在发送后消失、看不到生成状态；缺少内容时模型曾编造数据集，且内置提问选项无法承载要粘贴的链接。补强如下：

- `OnDemandHint` 现在覆盖 armed / running / clarifying：发送后保留“正在生成”状态与轻量 SVG 加载指示，提问等待时显示“等待回答”，不再一回车就消失。只有成功生成临时结果或用户取消后才清理。
- 一轮以 completed 结束但没有 render（典型是模型用文字要求补充内容）时，操作回到 armed 并带 `resume`，提示显示“继续按需生成”，下一条消息继续同一操作；不再静默丢弃意图。
- 内容接地：提示词与 Agent Skill 要求先核对内容/数字/日期/来源；缺少时用 ask_user_question **无选项自由输入**（便于粘贴文本、路径或链接），明确禁止编造占位数据。选择题 UI 本身未改。
- 加载指示从边框转圈/前卫细线改为常规但精致的 SVG 圆环（轨道 + 圆头弧线），保留 reduced-motion 回退。

真实模型 DSH E2E（隔离实例，127.0.0.1:3082）：空会话中按需生成 → 模型先检查会话/工作区，明确表示无法接地、不编造，并弹出无选项自由输入问题（What should the dashboard be built from? Paste the analysis text, or give the file path / URL）；hint 在 running→clarifying 全程可见。随后模型改用真实 `stats.gov.cn` 数据源渲染临时样式卡片，卡片保留来源，hint 在结果出现后才清除。测试实例已停止，测试结果记录已清理。

门禁：`npm run check` **179/179**（Host 77 + Client 81 + packaging 21）；浏览器 **7/7**（on-demand **85** 断言）；`lib/index.js` 639718 字节。主实例仍需重启加载本轮 Host/Client。未真机验证：连续调整绑定、多标签、重启历史重放、真实图片/单页导出。

补充：终态引导。失败/中断不再让提示静默消失：composer 保留提示和原因摘要，提供“重试”（重新武装同一会话的按需生成）与“关闭”（只隐藏本标签页提示）；仅取消、成功 render 或用户关闭后清理。浏览器 on-demand 断言增至 **84** 条，Node 仍为 179/179。

### 2026-10-22 — Codex 对未提交改动的 review 修复

Codex（gpt-6.1-sol / xhigh）审查未提交工作区：**无 P0，1 个 P1、3 个 P2**。均已修复：

- **P1 投影 schema 拒绝 `resume`**：`modeViewSchema` 未声明该字段，DSH 发布/读取投影会报 `unrecognized_keys: resume`。已加入可选 boolean；绑定下一条消息时清除该标记，并新增 wire schema 接受 `resume` 的断言。
- **P2 重试调整操作丢失父结果**：失败/中断后点「重试」原为普通 arm，会从 adjust 变成 generate。现在带 `kind: adjust` 与 `parentResultId` 重新武装；浏览器断言校验命令包含 `adjust <parent>`。
- **P2 catalog 不可用时 HTML 导出与页面外观不一致**：实时卡片在 catalog `unavailable` 时回退默认主题，导出仍用缓存模板。新增 `exportTemplatesFor` 统一选择逻辑：unavailable 时返回空模板，导出与页面一致；补充单测。
- **P2 文档生命周期过时**：README、FAQ、architecture、integration 仍称“文字结束未渲染即失败”“重新武装替换活动操作”“文字提问需立即重新武装”。已改为 resume/拒绝重复 arm/下一条消息继续/失败重试的真实行为。

门禁：`npm run check` **179/179**（Host 77 + Client 81 + packaging 21）；浏览器 **7/7**（on-demand **85** 断言）；packaging 21/21；`git diff --check` 通过。Review 未运行真实模型 E2E（此前真实模型路径已验证）。
