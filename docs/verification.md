# 验证记录

中文 | [English](verification.en.md)

[← 返回 README](../README.md)

以下为一次历史验证记录；其中的测试数量与打包大小按最近一次 `npm run check` / `npm pack` 输出更新。

在隔离的第二个 DSH Web 实例（3081 端口，同一 profile + patch overlay）上做过端到端验证：

- 模型按提示词调用 `render_ui`，生成 31–117 条语句的页面；非法程序被 Host 拒绝并给出精确字段错误，模型在同一轮内自修成功。
- 组件总览页、旧金山行程、咖啡计算器、SVG 折纸教程均正常渲染；照片（Wikipedia/Wikimedia）、MapLibre 地图 + pin、图表、表单、计时器、翻转卡、撒花、HtmlView 动画可用。
- 交互：勾选时间线计数更新、SegmentedControl 联动、表单与按钮状态正常；暗色主题自动切换。
- 响应式：390 / 546 / 768 / 1092 px 下无横向溢出（补齐了组件库依赖的 `box-sizing` 作用域 reset）。
- 测试（实时子项）：当前 0.5.0 发布证据见文末 2026-10-25 的 0.5.0 发布记录（Node **247/247**；renderer 解析/渲染 42/42、CSS 契约 50/50、组件契约 63/63、typography 22/22、media-row 17/17、pressable 9/9、contrast OK、i18n 4 个程序；浏览器 7/7，settings 101、on-demand 114、交互页面 46、图片导出 65 条断言）。下方旧浏览器/模型记录保留为历史。
- **Agent Skill 端到端**：在真实 DSH 会话里模型调用 `skill { name: "intelligent-ui" }` 成功加载 `<skill_content>`（15 KB 正文 + references 基目录提示），随后按技能用 `render_ui` 生成并渲染了验证页。
- **bundle 安装链路**：用 `npm pack` 产物在一次性 profile（`~/.dsh/profiles/zbundle-test`，依赖 `file:/tmp/…tgz` + `dsh.profile.bundles`）里安装，`dsh --profile zbundle-test --dump-config` 退出 0，输出出现 `# == @zephinel/dsh-intelligent-ui` 与插入行 `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'`（验证后已清理）。
- **三档开关端到端（0.2.1 时代记录）**：默认「关闭」请求里没有 `render_ui`、提示词为空；选「仅本会话」后本会话请求带工具与提示词并渲染出卡片，而新开会话仍是关闭；选「全部会话」后新开会话直接带工具与提示词；选「关闭」后文件清空、新会话再次无工具无提示词；两个标签页之间控件状态通过 BroadcastChannel 同步；状态文件 `{ "global": false, "sessions": [] }` 与投影行为符合预期。0.3 的会话开关/样式覆盖与 Article 页面尚待实机验证。
- **Style panel 浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 先用无头 Chrome + CDP 加载 `test/browser/harness` 的 `ToggleControl`，验证 chip → menu（无「全部会话」、含「显示样式」）→ 切换「仅本会话」只发 `enable:on` 且**不**自动打开样式面板 → 再点已激活项或「显示样式」行才打开面板，以及面板内返回按钮回到作用域菜单而不是关闭全部浮层、返回后焦点落在「显示样式」行；菜单宽度按内容且不小于 208px、右缘与 chip 对齐、统一最小行高与间距、分割线内缩、展开时 chevron 旋转 180°；关闭开关后「显示样式」仍显示但为 disabled，点击不能打开面板；面板矩形完全在视口内，焦点进入面板；拖动真实滑杆到 Article 后发出 `style:article`；Escape 关闭后焦点回到 chip。该测试不启动完整 DSH Web，也不替代 Host/Client 集成 E2E。
- **图片导出浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 随后加载 `test/browser/harness/export-entry.tsx`：真实 `ExportAction` + 真实渲染器卡片 + 两个入口（其中一个的 Chat selector 经结构化快照运行真实的 `messageHasRenderUi` 并报告无渲染输出），卡片里是真实的 `SearchImage`，其 Wikipedia 查询由 harness stub 到本地 SVG。断言只有扩展回答出现导出药丸按钮（带可见「导出」文案、`order:1`、贴齐操作栏右缘）；导出菜单右缘与按钮对齐、宽度按内容，上方空间不足时翻到按钮下方，并在触发 scroll 后立即关闭；打开菜单依次导「原始」「卡片」和「圆角 2x」：卡片初始为折叠态，截图时已展开、完成后退回折叠；3D 翻面已展平为可见面、过渡/动画已冻结、lazy 图片改为 eager 且完成加载；harness 用带同样就绪属性的假地图验证导出会等待 resize 后的地图就绪；card 帧尺寸比 raw 多出两侧 padding + 阴影留白且底部留白能采到非零阴影像素，圆角 2x 帧尺寸为 raw 的 2 倍再加 2x padding。该测试不启动完整 DSH Web；跨域 Wikimedia 图片的抓取另用同一 session 程序手工复现（见下一条）。
- **交互页面浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 的交互页面脚本把真实的 `lib/standalone.js` / `lib/standalone.css`、当前主题快照与两张卡片程序交给 `buildStandaloneHtml` 生成单文件 HTML，直接在无头 Chrome 中打开该文件：断言页面没有外部 script/stylesheet 引用、体积 ≥3.4 MB、两张卡片的正文都挂载且没有标题栏/折叠控件、内联主题改变页面背景，并点击一个 `@ToAssistant` 按钮确认页面复制兜底会弹出提示而不调用 DSH；随后打开开启「移除追问操作」的同一页面，断言混排 Card 只隐藏追问控件（Form 字段随之移除）并保留正文、根级追问只隐藏控件而不隐藏页面、纯追问 Card 整块消失、非追问的 `@OpenUrl` 按钮仍可见，并检查没有 `html` 级隐藏属性。图片导出 E2E 也验证同一语义：混排 Card 保留正文、纯追问 Card 不进入 PNG（截图高度变小）。该测试不启动 DSH Web。
- **自定义选色器浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 的 settings-picker 脚本渲染真实 Plugin 详情页，断言原生 `input[type=color]` 已移除、背景色触发器和 12 个预设色块存在；点击预设会保存 `exportBackground`，输入十六进制并按 Enter 会保存并关闭面板；真实鼠标的“hex 有焦点时点预设”和“输入后点面板外”路径分别验证预设获胜、有效草稿被提交。
- **Article 间距浏览器 E2E（组件级，可复跑）**：第四个 `npm run test:browser` 脚本渲染一个 Article fixture，断言每个 `Section` 正文是独立 flow、正文块间距为 16px（标题到后续块 12px）且不再贴在一起；同时断言页面级 flow 没有额外的 18px flex gap，section 间距保持单一级距（约 24px）而不是双倍留白。
- **导出追问开关**：Plugin 详情页 **导出** 分组新增「移除追问操作」开关（Host volatile `removeFollowUps`，默认开启）；开启后图片与 Standalone 页面都会移除 `@ToAssistant` 追问控件及其最小包裹（Form 字段随之移除），含正文的 Card 保留正文、只有纯追问区块整块消失，并禁用复制回调；关闭后保留控件并恢复页面复制兜底。设置对图片与页面同时生效。设置 SSR、图片导出 E2E 与 standalone-page E2E 覆盖；另有 `to-assistant` 单测锁定“裸按钮才是追问、带本地 action 的按钮不是”的语义和旧 `exportToAssistant` 迁移。
- **布局/间距契约**：生成提示词与 Agent Skill 增加布局与间距条目；Host `layoutWarnings` 对根 `gap`、纵向 `Spacer()`、空 `Section`/`Text`、`gap: 0` 块栈返回非致命 warning（Host 单测覆盖）；Article 的 Section 正文改为嵌套 flow、页面根不再叠加 flex gap，article-layout E2E 用实测间距（16/16/12/16px，section 约 24px）护栏。
- **图片导出（2026-10-22，组件级 + 浏览器实验）**：底部导出入口与图片导出已实现并构建通过。用无头 Chrome + CDP 在临时 harness（真实 `ExportAction` + 真实渲染器卡片）上验证：导出按钮只在记录过 `render_ui` 的消息出现；菜单含原始 / 圆角 / 卡片；折叠卡片在截取时展开、完成后恢复；2x 圆角美化输出 1616×2348 PNG、背景色生效、文件名带标题与本地时间。MapLibre 截图实验：默认 `preserveDrawingBuffer: false` 时 canvas `toDataURL` 为空白（约 9 KB），开启 `canvasContextAttributes.preserveDrawingBuffer` 后为完整地图（约 449 KB），`render` 事件内抓帧同样可行。该验证不启动完整 DSH Web；重启 DSH Web 后的真实会话人工点验尚未进行。随后用会话 `c3a17e93-b553-4f6f-8734-3997fa02a751` 的历史程序复现并修复了真实导出中发现的两个缺陷：翻卡片 3D 双面重叠（截图中文字重叠）与图片搜索/加载未完成导致的空图片框；修复后的翻卡片展平与图片落定路径由 `npm run test:browser` 的 `export-image` E2E 覆盖（图片搜索用本地 stub、跨域 Wikimedia 抓取另行手工复现）；同一 E2E 也用尺寸与像素质检覆盖 card 阴影帧。
- **界面语言**：zh/en 字典 key 对齐、档位控件中文 SSR、渲染器组件（Code / Timer / Map / 空程序兜底）中文与英文回退 SSR 均由自动检查覆盖；尚未在运行中的 Web UI 里手动切换语言做人工点验。
- **0.2.0 发布**：推送 tag `v0.2.0-26-10-21` 触发 GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955)（`publish.yml`，33 s）并完成发布；registry `latest` = `0.2.0-26-10-21`，`gitHead` = `e5ce0af`，`npm audit signatures` 验证了 registry signature 与 provenance attestation（SLSA v1）。GitHub release：[v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21)。
- **0.2.1 发布**：配置从 Settings 迁移到插件详情页（`plugins.bundle.config`，key 为包名），开关改用 DSH 原生样式；tag `v0.2.1-26-10-21` 触发 [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971)，registry `latest` = `0.2.1-26-10-21`（`gitHead` = `4dcd34b`），`npm audit signatures` 验证了 provenance；本地 `npm run check` 65 tests、`npm pack` 34 个文件。GitHub release：[v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21)。
- 已验证的 DSH 版本：**0.2.2-rc.1**（`dsh --version`）。更晚的版本未验证。
- **平台覆盖**：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）均已安装并验证基本使用（输入框 UI 控件、卡片）；Linux 未验证。
- **0.2.2 发布**（纯文档）：修正 README 的 CJK 加粗渲染与平台验证说明；tag `v0.2.2-26-10-21` 触发 [run 39598770488](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39598770488)，registry `latest` = `0.2.2-26-10-21`（`gitHead` = `aac3f86`），provenance 已验证；无代码或行为变化。
- **0.3.0 发布**：把回答样式、图片导出与交互页面导出作为 0.3.0 发布，并修正随包 Agent Skill 的工具契约文档；tag `v0.3.0-26-10-22`（annotated）触发 [run 39785829751](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39785829751)（40 s），registry `latest` = `0.3.0-26-10-22`，`gitHead` = `8cfd0cd`；GitHub Release 于 2026-10-22 回填：[v0.3.0-26-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.3.0-26-10-22)。provenance 记录在透明度日志（logIndex 3388870856），临时目录安装后 `npm audit signatures` 报告 2 个包 attestation 验证通过。本地 `npm run check` 102 tests，`npm pack` 40 个文件（3.63 MB / 解包 9.45 MB）。实测 registry 元数据在 publish 后约 5 分钟才可见、tarball 又晚 1–2 分钟（期间 `npm install` 返回 404），不是发布失败。

- **0.4.0 发布**：把自定义样式模板、聊天内按需生成及其生命周期/内容接地修复作为 0.4.0 发布；tag `v0.4.0`（annotated）指向发布提交 `3a3d6a8`，触发 [run 39850727142](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39850727142)（44 s，success）。registry `latest` = `0.4.0`，`gitHead` = `3a3d6a8`；临时目录安装后 `npm audit signatures` 报告 4 个包 registry signature、2 个包 attestation 验证通过。本地 `npm run check` 179 tests，`npm pack` 43 个文件（4,036,061 字节 / 解包 10,216,623 字节）。registry 元数据在 publish 后约 2–3 分钟才显示 `0.4.0`，属传播延迟，不是发布失败。

- **0.4.1 发布**：修复 0.4.0 中样式预览仍显示白色的缺陷——真实 DSH 浅色主题的 `--dsw-alias-bg-layer-2` 是 `#fff`，因此改用 `--dsw-alias-bg-module-platform`（`#f5f6f7`，含 layer-2 回退），composer 的内置样式卡片、按需生成入口和插件详情页分组行现在都是浅色圆角 surface；截图 fixture 也同步真实分层 token。tag `v0.4.1` 指向 `bb38b4a`，触发 [run 39854292035](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39854292035)（44 s，success）。registry `latest` = `0.4.1`，`gitHead` = `bb38b4a`；GitHub Release：[0.4.1 — 2026-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.4.1)。临时目录安装后 `npm audit signatures` 验证 4 个 registry signature、2 个 attestation。本地 `npm run check` 179 tests，`npm pack` 43 个文件（4,036,061 字节 / 解包 10,216,623 字节）。

## 2026-10-22 — R4 自定义模板与聊天内按需生成

本条是当前未提交工作区的增量文档/截图同步，不是发布验收。基于 HEAD `155585c9afcc943b98e7fb5b36a2a2f0e4b51c49` 加既有 R1–R3 改动；本阶段未更改 src、依赖、版本或计划/审查历史，也未提交/发布。环境：Node v24.22.0、npm 11.19.1、Google Chrome 155.0.8059.86。

### 自动化结果

| 命令 / 检查 | 本阶段结果 |
| --- | --- |
| `npm run check` | PASS；179/179 Node 测试 = Host 77 + Client 81 + packaging 21，0 失败、0 跳过 |
| renderer（包含于 check） | 解析 41/41、SSR 41/41（使用现有 `/tmp/oiui/src/app/gallery` fixture）；contrast OK；i18n 4 个程序（zh/en fallback）；typography 22/22，Chrome 实际执行 |
| `npm run pack:check` | PASS；43 个文件；tarball **4,036,061 字节**（4.03 MB），解包 **10,216,623 字节**（10.22 MB） |
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
| `assets/intelligent-ui-settings.webp` | 1336 × 3508 |
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


### 2026-10-23 — 按需自由布局（未提交工作树）

结果契约新增 `RenderLayout = card | article | free`，普通会话和保存模板继续使用 `PageStyle = card | article`。SchemaVersion 1 快照新增 `baseLayout: "free"`，与 `style: "free"` 配对；扩展枚举避免新增并行快照格式或迁移。旧 card/article 快照及未记录 style 的普通调用继续原样重放。自由调用仍须通过 Host 绑定操作与当前 callId 授权，记录 `styleSource: "temporary"` 和精确快照。

自由组合复用中立的 `OpenUIRenderer`，仍置于 DSH 卡片 chrome 内，不使用 Article wrapper、紧凑要求或强制 Toc/Section。主题、解析、锚点、样式来源互斥与绑定操作的普通渲染拦截继续保留。按需操作中不注入会话外壳提示，布局遵循用户请求，有实质歧义时提出聚焦问题。普通会话选择和 `StylePicker` 不变；现有「自由布局」设置与新的结果布局独立。生成提示通过原有生成器重新构建。

重放和 HTML 数据保留 free；独立页面中自由结果使用可用宽度，混合的 Card/Article 结果保留 760px。PNG 继续截取实时 DOM，展开/还原折叠 chrome，保留主题、媒体与交互的捕获处理。自由结果主动保存为模板时，保存面板要求明确选择 Card/Article 模板外壳（新增中英图例、不预选）；只有模板接收该外壳，原始自由快照保持不可变。旧结果保存契约不变。

验证：`npm run check` **183/183**（Host **81**、Client **81**、packaging **21**）；gallery 解析/渲染各 **41/41**，另含自由组合的明暗 SSR 断言，对比度通过，i18n **4** 个程序、排版 **22/22**。`npm run test:browser` **7/7** 套件通过，包含按需流程 **101** 条断言、自由/旧结果重放与保存、PNG/HTML、宽窄屏和明暗混合导出、本地交互及原 Article 行为。导出夹具显式模拟浅色系统偏好，不再假定机器外观。`npm run pack:check`：**43** 文件，压缩 **4,038,253** 字节，解压 **10,222,452** 字节；版本保持 **0.4.2**，本次仅为未发布工作树改动。`git diff --check` 与所改双语文档标题/本地链接检查通过。

证据边界：Host 测试使用隔离的临时 DSH_HOME；浏览器测试使用生产组件及结构化 DSH 服务夹具。本轮未运行真实模型 DSH 会话、更新发布截图、安装、重启、提交、建分支、打标签、推送或发布。真实 DSH 中模型的布局澄清及生成质量仍未验证。计划文档、历史验证记录和已发布变更日志保留，只同步实现契约及 Unreleased 说明。

真实模型验证（2026-10-23，隔离 DSH Web 实例，3086 端口，clone profile + 本地未提交构建）：请求「做一个自由布局的产品发布海报：左边大标题，右边三列要点，不要卡片或文章外壳」。模型先追问产品内容（没有编造），回答使用示例内容后调用 `render_ui`，参数为 `style: "free"` 与 `temporaryStyle.baseLayout: "free"`；DOM 为一张 `data-dsh-iui-style="free"` 卡片，保留 DSH 卡片头部，但没有 `.dsh-iui-article` / `.iui-toc` / `.iui-section`，正文为多栏海报，示例文案明确标注为虚构。结果注册表记录 `baseLayout: "free"`，会话日志中的工具参数与之一致。测试实例、clone profile、结果与会话已清理。仍未真机验证：布局歧义时的提问路径、自由结果保存模板面板、真实媒体导出和主实例视觉确认。

完整改动文件列表（含原有四个提示相关未提交文件）见 [英文验证记录](verification.en.md) 的同日期段落。

### 2026-10-23 — Host 布局约束修复（未提交工作树）

修复 Astra P2：Host 按操作类型强制 `generate` 的 style/baseLayout 为 free，`adjust` 则必须与注册表中的父快照布局一致。父快照缺失或已淘汰时拒绝调整，要求用户取消后重新按需生成；不从对话或模型参数猜测布局。拒绝不写结果、不完成操作。已有生成夹具改用 free，旧 card/article 通过预载快照保留调整覆盖，原 Article 结构和锚点校验继续执行。三组新增回归在修复前均因缺少预期拒绝而失败，修复后通过，覆盖新生成拒绝 card/article、三种父布局的交叉布局拒绝与同布局成功、缺失父快照的拒绝及取消后重新生成。提示、Agent Skill、错误参考和中英文使用/架构文档同步，Unreleased 追加修复说明；历史记录保留。

验证：`npm test` 与 `npm run check` 均 **186/186**（Host **84**、Client **81**、packaging **21**）；gallery 解析/渲染各 **41/41**，自由组合明暗 SSR、对比度、i18n **4** 个程序和排版 **22/22** 均通过。`npm run test:browser` **7/7** 套件通过（按需流程 **101** 条断言）。`npm run pack:check`：**43** 文件，压缩 **4,039,289** 字节，解压 **10,225,920** 字节。`git diff --check`、双语标题结构和本地链接检查通过。Host 测试使用隔离 DSH_HOME，浏览器使用组件夹具；本次修复未重新运行真实模型 DSH 会话。版本保持 **0.4.2**，所有改动未提交，未建分支、打标签、推送或发布。


### 2026-10-23 — 保存模板保留结果布局修复（未提交工作树）

`StyleTemplate` 与 create/patch 的 `baseLayout` 沿用 `RenderLayout`（free/card/article），存储仍为 version 1；`StyleSnapshot` 语义、主题/偏好限制、可见范围、配额、名称去重和原子写入均保留。保存路由只接受结果 ID 与名称/描述/范围元数据，从 Host 快照精确复制布局、偏好和主题；所有布局都拒绝客户端 `baseLayout`。保存弹窗移除 Card/Article 选择。选中的自由模板使用 `style: "free"` 与精确 styleId，不带 temporaryStyle；提示词允许自由编排和可选 Toc/Section。工具继续拒绝无来源的 free、与选中 Card/Article 模板不符的布局、错误 ID 和混合来源。客户端支持模板回放、自由预览及中英提示；同一程序保持 DSH 标题栏、无 Article wrapper，使用模板明暗主题，无临时标记/操作。

回归证据：修复前运行保存路由测试，free 元数据保存得到 **400，而预期为 201**。修复后测试覆盖三种布局的精确保存、覆盖字段拒绝、version 1 落盘/重载/管理、自由模板工具授权、无来源及错选拒绝、回放、目录响应校验与导出主题。`npm run build && npm test` 和随后 `npm run check` 均通过 **191/191**（Host **87**、Client **83**、packaging **21**，无跳过）。gallery 解析/渲染各 **41/41**，free 明暗 SSR、contrast、i18n **4** 个程序和 typography **22/22** 通过。`npm run test:browser` **7/7** 套件通过（按需 **114** 个断言，含实际页面刷新后的自由模板回放），包括自由模板选用、PNG/HTML、真实 standalone bundle 的 free 临时/模板与旧布局混合导出、明暗模式和宽窄尺寸；Chrome 可用，未跳过。`npm run pack:check` 为 **43** 文件，压缩 **4,039,044** 字节、解包 **10,229,511** 字节。`git diff --check`、双语标题结构、截图引用、本地链接与 README 文档链接（**26** 正确、**0** 断链）均通过。

验证使用隔离 DSH_HOME 与浏览器组件夹具，没有调用真实模型或操作正在运行的 DSH。本次仅查看隔离浏览器保存弹窗/模板回放截图，未重拍仓库营销截图；独立 HTML 继续原有仅正文导出、不含聊天折叠标题栏的行为。未提交功能完整保留；未修改 `docs/plans/**` 或历史验证段落，未提交、stash、tag、push、发布或重启主实例。模型后续生成是否完全遵循自由构图仍需真实会话验证；模板被删除/目录不可用时继续使用既有默认主题回退。

### 2026-10-23 — 可移植模板文件导出与导入（未提交工作树）

在原有按需自由结果/保存布局修复上新增单模板交换。`style-template-exchange.ts` 以固定顺序显式构造 Envelope v1 和主题，支持 card/article/free；导出只含五个可移植字段，无本地身份/范围/会话/时间戳。严格解析覆盖 kind/version/白名单/类型/长度/hex/枚举、32 KiB UTF-8 字节边界、一层完整代码围栏、标签 Cf 剥离、原型键拒绝及已知完整 legacy 对象；模板库备份拒绝。设置页导出先确认公开范围；导入支持文件/粘贴、预览、改名/描述/编辑或清空规范、非空规范阅读确认、重名建议/配额/错误重试、busy 防重复提交和成功状态。仅复用认证的 `op:'save', scope:'global'`，不带 sessionId、不自动应用、不改默认。Host 等价向量验证三种布局均生成新身份/时间戳，仍拒绝本地或未知字段。

Node **24.22.0**。`npm run build && npm test`、随后 `npm run check` 均 **205/205**（Host **88**、Client **96**、packaging **21**；失败/跳过均 **0**）。新增 codec **10** 项、createTemplate **2** 项、设置入口 SSR **1** 项和 Host 导入等价性 **1** 项。gallery 解析/渲染各 **41/41**，free 明暗 SSR、contrast、i18n **4** 个程序及 typography **22/22** 通过。构建：Host **628.2 kB**、Client **3.61 MB**、standalone **3.28 MB + 502.8 kB**（构建脚本显示单位）。既有 ToggleControl SSR 的 useLayoutEffect 警告仍出现，不是失败或跳过。

`npm run test:browser` **7/7** 套件通过、无跳过；按需 **114** 条断言，设置页 **92** 条。设置页覆盖下载确认/取消、文件名/Envelope/元数据剥离/free、错误版本与超大内容不 POST、超大文件不读取、粘贴及无可信 MIME 的 legacy 文件、全文纯文本预览、编辑/清空/确认重置、Host 重名/配额错误保留输入、双击只发一次保存、不改全局选择/设置、导入后选用/重命名/编辑/再导出/删除、40 个配额、中英、窄屏滚动与焦点循环/Escape。夹具编辑时间改为单调递增，避免新导入模板的 createdAt 高于固定 updatedAt。`npm run pack:check`：**43** 文件，压缩 **4,048,125** 字节、解包 **10,260,128** 字节；版本仍为 **0.4.2**。`git diff --check`、双语标题结构及本地链接检查通过。双语 README/architecture、Unreleased、浏览器测试说明及文档验证参考增量同步；计划/评审和历史段落保留。

**证据边界/计划差异**：按本次明确批准的决策，非空外部规范经阅读确认后可以保留，替代原计划「审计前强制仅外观」；该差异写入 as-built 文档，不修改计划。外部规范仍是不可信提示文本，预览/确认/不自动应用不能证明提示词注入已消除。真实执行权限由 DSH 工具层控制；执行层权限审计、真实部署 Origin/CSRF 审计与模型对抗观察仍是发布前待验证事项。本次只使用隔离 DSH_HOME 和组件浏览器夹具，没有真实模型调用、正在运行的 DSH 操作、安装/重启、截图更新、提交、stash、tag、push 或发布。真实模型的样式还原效果未验证；本轮没有遗漏的 MVP 实现项。

### 2026-10-23 — 模板分享移除旧版原始导出兼容（未提交工作树）

产品决定：当前没有外部用户，不维护旧格式兼容。`parseStyleExport` 只接受 Envelope v1；原始 `StyleTemplate` 导出、持久化库文件与其他非 Envelope 形状统一以 `invalid_structure` 拒绝，删除 legacy 分支、`legacy` 预览标记、UI 文案与相关测试。导出确认、导入预览/阅读确认、复用 `save`、32 KiB 限制与安全边界不变；文件输入仍不信任 MIME/文件名。

验证：`npm run build && npm test` 与 `npm run check` 均 **205/205**（Host **88**、Client **96**、packaging **21**，无跳过）；gallery 解析/渲染各 **41/41**，contrast、i18n **4** 个程序、typography **22/22** 通过；`npm run test:browser` **7/7**（settings **91**、on-demand **114** 断言）；`npm run pack:check` **43** 文件，压缩 **4,047,844** 字节、解包 **10,259,306** 字节；`git diff --check` 与文档链接检查通过。浏览器文件输入用例改为合法 Envelope（`.txt` + text/plain）继续覆盖不信任 MIME/文件名；原始导出/库文件拒绝由 codec 单测覆盖。版本仍为 **0.4.2**，未提交、未发布。

### 2026-10-23 — Composer 模板入口（未提交工作树）

Composer「显示样式」面板接入与设置页相同的模板交换入口：面板内新增「导入模板」（复用 `TemplateImport`，仍只创建全局模板，不带 sessionId）；模板 `…` 菜单的「导出文件」不再受 `global` 条件限制，Composer 中的仅本会话模板也可直接导出（设置页仍只列全局模板）。`TemplateImport` 的重名预检改为检查传入的全部可见模板，避免与当前会话模板重名；全局 40 配额、Host 重名与 session 可见性规则不变。会话作用域导入继续延后，等待 `save` 的 sessionId 授权核查。

验证：`npm run build && npm test` 与 `npm run check` 均 **205/205**（Host **88**、Client **96**、packaging **21**，无跳过）；renderer、contrast、i18n **4** 个程序、typography **22/22** 通过；`npm run test:browser` **7/7**（settings **91**、on-demand **114** 断言；style-panel 覆盖 Composer 导入入口、全局/会话模板导出确认与面板保留）；`npm run pack:check` **43** 文件，压缩 **4,048,045** 字节、解包 **10,259,993** 字节；`git diff --check` 与文档链接检查通过。版本仍为 **0.4.2**，未提交、未发布。

### 2026-10-23 — 独立 review 修复（未提交工作树）

三份只读 review 的发现已修复：外部 name/description 现在与 directives 一样需要导入确认（名称/描述剥离全部 `\p{Cf}` 与 U+2028/U+2029，host 引用时转义行分隔符）；导入 directives 剥离全部不可见格式控制字符（含 bidi/tag/零宽）；保存进行中不可关闭导入弹窗；描述改为单行；库内不可导出名称、`(Imported)` 代理对截断、文件名格式控制均有专门处理与提示。原计划「执行层审计前强制仅外观」与当前实现的偏差当时如实标为**未经 owner 批准**；**后于 2026-10-24 获 owner 确认**，执行层/Origin 审计保留为发布前加固项（见文末记录）。

验证：`npm test` 与 `npm run check` 均 **205/205**（Host **88**、Client **96**、packaging **21**，无跳过）；renderer 41/41、contrast OK、i18n **4** 个程序、typography **22/22**；`npm run test:browser` **7/7**（settings **94**、on-demand **114** 断言，含保存中不可关闭与 acknowledgement 全外部内容）；`npm run pack:check` **43** 文件，压缩 **4,048,614** 字节、解包 **10,261,873** 字节；`git diff --check` 与文档链接检查通过。评审原文与处置见 [subagent-review-2026-10-23.md](plans/template-export-share/reviews/subagent-review-2026-10-23.md)。

### 2026-10-24 — 导入免责声明与 owner 批准（未提交工作树）

按 owner 决定采用 A 方案：导入风险提示强化为免责声明——预览区说明外部模板可能影响 AI 行为、导入即理解并自行承担风险、DSH 工具/权限层仍是实际执行边界；确认勾选改为「我已阅读并理解上述风险，确认导入该外部模板」。README/architecture/plan/评审记录已记录「2026-10-24 owner 确认采用免责声明 + 阅读确认方案」，替换原计划「审计前强制仅外观」；执行层工具权限与真实 Origin/CSRF 审计保留为发布前加固项（不再标记为未获批准）。

验证：`npm test` 与 `npm run check` 均 **205/205**（Host **88**、Client **96**、packaging **21**，无跳过）；renderer 41/41、contrast OK、i18n **4** 个程序、typography **22/22**；`npm run test:browser` **7/7**（settings **94**、on-demand **114** 断言，含免责声明确认与保存中不可关闭）；`npm run pack:check` **43** 文件，压缩 **4,048,935** 字节、解包 **10,262,394** 字节；`git diff --check` 与文档链接检查通过。版本仍为 **0.4.2**，未提交、未发布。

### 2026-10-24 — 第二轮 review 修复（未提交工作树）

第二轮两个只读 subagent review 均 **SHIP WITH CHANGES、无 P0/P1**；本轮修复并补测：

- 保存中仍可从父面板关闭导入（Composer 面板外点/返回/chip、设置页切换导致 disabled）：导入 busy 上报父面板，父关闭路径与 disabled 渲染守卫在 POST 期间全部让位；保存中 Escape/禁用/焦点均保持弹窗。
- directives 原先只剥离 bidi，tag/ZWSP/WJ 等不可见字符仍可能夹带隐藏文本：导入时剥离全部 `\p{Cf}`，并补全 12 个 bidi 控制与 tag/零宽测试。
- 修改外部 name/description 未重置确认（与文档不符）：现在任何预览编辑都会重置；补 e2e。
- 选择文件名残留 U+2028/U+2029/C1：显示清洗并补 e2e；`(Imported)` 截断改为共享的码点安全函数并补单测；导出失败提示、fileStem 的 Cf/行分隔符均有回归断言。
- 文档口径校正：确认改为「每次导入都需确认」、描述仅保存/导出且不进入提示词（第三轮修正了“仅作标签”的旧表述）、执行层/Origin 审计统一表述为发布前加固；plan 中仍保留的原计划条款已加“已被 2026-10-24 owner 决定取代”说明。

验证：`npm test` 与 `npm run check` 均 **206/206**（Host **88**、Client **97**、packaging **21**，无跳过）；renderer 41/41、contrast OK、i18n **4** 个程序、typography **22/22**；`npm run test:browser` **7/7**（settings **100**、on-demand **114** 断言）；`npm run pack:check` **43** 文件，压缩 **4,049,089** 字节、解包 **10,262,652** 字节；`git diff --check` 与文档链接检查通过。评审与处置见 [subagent-review-2026-10-24.md](plans/template-export-share/reviews/subagent-review-2026-10-24.md)。

### 2026-10-24 — 第三轮 review 修复（未提交工作树）

第三轮两个只读 subagent review 均 **SHIP WITH CHANGES、无 P0/P1**；修复：

- **父面板仍可卸载保存中的导入**：Composer 的 lock/view effect 与 `arm()` 成功路径未检查 import busy；设置页在父级持续 disabled 时失败信息会被隐藏。现在面板渲染在导入 busy 时保持、lock/arm 路径让位、导入卸载清理 busy；弹窗被隐藏时错误显示在触发按钮旁；busy 时焦点移到弹窗内状态行。
- **默认忽略字符**（VS16/VS1、CGJ、Hangul filler、U+2065、U+2800 等）不可见却能进入提示词：导入文本现在额外剥离 `\p{Default_Ignorable_Code_Point}` 与 U+2800。
- **描述文案**：描述并非界面标签渲染，改为“仅保存/导出、不进入提示词”。
- **覆盖声明**：修正 review/verification 中对父关闭路径与导出失败 UI 的过度表述；新增 host `quotePromptText` 的 U+2028/U+2029 回归测试。导出失败 UI 分支仍无自动化测试，已如实记录。
- **焦点抖动**：busy 时聚焦弹窗内状态行；settings e2e 连续 3 次 100 断言通过。

验证：`npm test` 与 `npm run check` 均 **207/207**（Host **89**、Client **97**、packaging **21**，无跳过）；renderer 41/41、contrast OK、i18n **4** 个程序、typography **22/22**；`npm run test:browser` **7/7**（settings **100**、on-demand **114** 断言；settings 另独立连续跑 3 次均通过）；`npm run pack:check` **43** 文件，压缩 **4,049,255** 字节、解包 **10,263,291** 字节；`git diff --check` 与文档链接检查通过。第三轮 review 与残余项见 [subagent-review-2026-10-24-third.md](plans/template-export-share/reviews/subagent-review-2026-10-24-third.md)。

### 2026-10-24 — 第四轮 review 修复（未提交工作树）

第四轮两个只读 subagent review 均 **SHIP WITH CHANGES、无 P0/P1**；修复：

- **Composer 可能在保存结束后丢弃导入结果**：父面板仅在 import busy 时保留；新增 `onStatusChange` 让父级记住终态并在结果为成功/失败时保持面板，直到用户主动关闭。
- **busy 时键盘焦点可逃出弹窗**：所有控件 disabled 导致焦点陷阱为空；取消按钮改为 `aria-disabled` 且可聚焦，busy/失败时焦点落回取消按钮，Tab 不再逃到背景设置。
- **第三轮“隐藏失败”分支无测试**：settings harness 支持在 hold 释放后注入失败；e2e 覆盖“失败 + 父级 disabled → 弹窗隐藏、错误显示在触发按钮旁”。
- **架构文档低估消毒范围**：补充 `Default_Ignorable_Code_Point`/U+2800/行分隔符归一说明。
- **docs-sync 参考数字/日期滞后**：host 89、日期 2026-10-24、settings 101 已同步。

验证：`npm test` 与 `npm run check` 均 **207/207**（Host **89**、Client **97**、packaging **21**，无跳过）；renderer 41/41、contrast OK、i18n **4** 个程序、typography **22/22**；`npm run test:browser` **7/7**（settings **101**、on-demand **114** 断言）；`npm run pack:check` **43** 文件，压缩 **4,049,307** 字节、解包 **10,263,451** 字节；`git diff --check` 与文档链接检查通过。renderer 首跑因 `/tmp/oiui` 残留空目录失败，清理后重跑通过（环境问题，非代码）。评审与残余项见 [subagent-review-2026-10-24-fourth.md](plans/template-export-share/reviews/subagent-review-2026-10-24-fourth.md)。

## 2026-10-25 — 完整文档与截图同步（sync-iui-docs）

本条是 sync-iui-docs 的 full audit + sync 增量记录，不是发布验收。基线为已推送到 main 的 `f5840d9`（0.4.2 之后、尚未发布）；npm `latest` 仍为 `0.4.2`。本阶段只同步 as-built 文档与截图，不改变行为、依赖或版本。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；**207/207** Node 测试 = Host **89** + Client **97** + packaging **21**，0 失败、0 跳过；`check`/`render-check` 各 **42/42**，free composition 明暗 SSR；contrast OK；i18n **4** 个程序；typography **22/22** |
| `npm run pack:check` | PASS；**43** 个文件，压缩 **4,061,684** 字节，解包 **10,277,299** 字节 |
| `npm run test:browser` | PASS；**7/7** 套件；settings **101**、on-demand **114** 条断言 |
| `node scripts/capture-screenshots.mjs` | PASS；七个 fixture 全部重拍；assets 仍为 **13** 张，全部被两份 README 引用 |
| README / docs 结构检查 | README 与三组 docs 双语标题层级一致；本地链接/锚点、绝对 GitHub 文档路径、语言切换、clone URL、CHANGELOG 链接有效；`git diff --check` PASS |

截图输出尺寸：layout 1616×4040、settings 1336×3082、toggle 1080×800、panel 1080×1860、hint 1520×598、temporary result 与 dark 各 1536×1032。均为 2× 组件 fixture，不是真实模型 DSH 会话证据。

本轮同步的 as-built 内容：README 与双语 detailed docs 的状态从“当前工作树”改为 main 分支未发布；renderer 计数 41/41 更新为 42/42；架构文档补充样式面板右对齐、12px 间距与 layer-2/module 表面分层；sync-iui-docs 的维护参考同步计数与新的计划目录分类。浏览器与真实模型未覆盖项仍按原记录保留。

## 2026-10-25 — typecheck/tool-schema 与可选主题增量同步（sync-iui-docs）

本条对应当前 main 工作树中尚未提交的源码增量（typecheck + `@types/node`/`tsconfig.json`、`tool-schema.ts` 注册前校验、temporaryStyle.theme 可选、无主题结果禁止保存模板），不是发布验收；npm `latest` 仍为 `0.4.2`。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；先执行 `tsc --noEmit`（通过；`src/client` 因 DSH 平台类型不是本地依赖而排除），再构建并测试；**216/216** Node 测试 = Host **98** + Client **97** + packaging **21**，0 失败/跳过；`check`/`render-check` 各 **42/42**；contrast OK、i18n 4、typography 22/22 |
| `npm run test:browser` | PASS；**7/7**；settings 101、on-demand 114 条断言 |
| `npm run pack:check` | PASS；43 文件，压缩 **4,066,380** 字节，解包 **10,292,278** 字节 |
| 文档/截图检查 | README 与三组 docs 标题层级一致；本地链接/锚点、截图引用（13 assets）、clone URL、CHANGELOG 链接通过；`git diff --check` PASS |

本轮同步的 as-built 内容：README/dev 文档把 `npm run check` 改为包含 typecheck 并补充 `npm run typecheck`；Host schema 校验现在在注册前执行，失败会整体拒绝激活并指出关键字；`StyleSnapshot.theme` 改为可选，无主题结果继承会话主题、不能保存模板且客户端隐藏保存入口；Host `saveFromResult` 对无主题快照返回 400 `no_theme`；verification references 的测试/构建/计数同步。历史记录与计划文档不改。

## 2026-10-25 — R5 渲染契约、Host 校验与导出语义修复（sync-iui-docs）

本条对应当前 main 工作树中尚未提交的隐患排查与修复增量（渲染器契约、Host 校验/警告、导出与提示词一致性），不是发布验收；npm `latest` 仍为 `0.4.2`。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；`tsc --noEmit` 通过（`src/client` 排除）；单测 **247/247** = Host **117** + Client **109** + packaging **21**，0 失败/跳过；renderer 解析/渲染各 **42/42**、CSS 契约 **50/50**、组件契约 **63/63**、排版 **22/22**、media-row **17/17**、pressable **9/9**；contrast OK、i18n 4 |
| `npm run test:browser` | PASS；**7/7** 套件（settings 101、on-demand 114、交互页面 46、图片导出 65 条断言） |
| `npm run pack:check` | PASS；**43** 文件，压缩 **4,076,474** 字节，解包 **10,318,189** 字节 |
| 构建产物（脚本显示单位） | Host **635.9 kB**、Client **3.63 MB**（js 3.49 MB + css 143.0 kB）、standalone **3.28 MB + 503.5 kB** |
| 文档/结构检查 | README 与三组 docs 标题层级一致；本地链接/锚点、截图引用（13 assets）、clone URL、CHANGELOG 链接通过；`git diff --check` PASS |

本轮修复（均有新增检查覆盖）：媒体行不再覆盖程序指定的图片尺寸；卡片副标题启发式不再改写正文；列表长 marker 在轨道内换行；`align=` 优先于 Badge/Button 默认；深色独立导出补齐 select/按钮/勾选颜色；Carousel 显式 `itemWidth` 生效、默认 240px + 85% peek；Table 数字原样输出；Chart 默认 series 跨行并集、stacked 负值保留符号；`aspectRatio` 接受 0.05–20；YouTube `/live/` 可渲染；SVG paint token 与文档一致；raw 背景对比度支持 rgba/hsl/8 位 hex；Length 支持安全的 `calc()/min()/max()/clamp()`；Slider 显示绑定值并回写越界状态；数字 Input 接受小数逗号；Flashcard 改为 `div role=button` 以允许内嵌控件；Markdown 保留嵌套列表、h5/h6 按 h4；`@Sqrt`/`@FormatDate` 等域外输入不再让整卡 fallback；`@Each` 生成的 Section/Toc 通过 article 校验、符号 anchor 不再冲突、free 布局不再收到页面节奏警告、gap 警告仅针对图片行列表；提示词修正 Form/@ToAssistant 转发、HtmlView 网络声明与 Example gap；导出「移除追问」保留含正文 Card；无主题临时结果继承会话选中模板主题；非法 `styleId` 被拒绝、不可用模板给出 warning；on-demand 上限错误说明原因与重新武装动作。完整审计与修复记录在未跟踪的 `.tmp-audit/`，独立复核见 `.tmp-verify/round4/REPORT.md`。

独立 verifier 复核：6/6 项 PASS（旧 CSS/组件变异下新检查会失败；High/Max 布局数值不变）；本轮未运行真实模型 DSH 会话。

## 2026-10-25 — 0.5.0 发布

`@zephinel/dsh-intelligent-ui@0.5.0` 已发布到 npm（`latest`）与 GitHub Release。

- **发布链路**：annotated tag `v0.5.0`（tag 对象 `5045afc`）指向发布提交 `c2a375f`，触发 `.github/workflows/publish.yml` [run 40190003142](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/40190003142)。首次尝试在 CI 的 typography Chrome 启动上出现一次瞬时失败（`Chrome did not expose the page target`，本地同一提交通过，重跑即成功，无代码改动），重跑 51 s 成功并完成 Trusted Publishing。
- **registry**：`latest` = `0.5.0`；tarball `dsh-intelligent-ui-0.5.0.tgz`，**43** 个文件，shasum `b1567cb8448191054ae6787d5a46a85129bd0456`，约 4.1 MB（解包 10.3 MB）。网络可见时间约在 publish 后 3–4 分钟（传播延迟，不是失败）。
- **签名**：publish 记录了 provenance，透明日志 logIndex **3460086916**；一次性临时目录安装 `@0.5.0` 后 `npm audit signatures` 报告 **4 个包 registry signature 验证通过、2 个包 attestation 验证通过**。
- **GitHub Release**：[0.5.0 — 2026-10-25](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.5.0)。
- **发布门禁**（发布提交所在树）：`npm run check` PASS，Node 测试 **247/247**（Host **117**、Client **109**、packaging **21**）；renderer 解析/渲染各 **42/42**、CSS 契约 **50/50**、组件契约 **63/63**、排版 **22/22**、media-row **17/17**、pressable **9/9**；浏览器 **7/7**；`npm pack` **43** 个文件。版本说明包含自由布局、模板文件导入/导出以及本轮的渲染契约、Host 校验/警告、导出语义修复。本次发布未运行真实模型 DSH 会话。

## 2026-10-25 — CI Chrome 启动重试加固（0.5.0 之后）

0.5.0 首次发布尝试在 CI 的 `typography-check` 出现一次瞬时失败（`Chrome did not expose the page target`），重跑成功。`test/support/browser.mjs` 现在在启动后 10 秒内未出现 page target 时会杀掉进程、换新 profile 与端口重启 Chrome，最多 3 次；`connectCdp` 复用同一等待逻辑。这是测试基础设施改动，不影响发布物。

验证（本地，macOS + Chrome）：`npm run check` PASS（Node **247/247**；renderer 解析/渲染各 **42/42**、CSS 契约 **50/50**、组件契约 **63/63**、typography **22/22**、media-row **17/17**、pressable **9/9**）；`npm run test:browser` **7/7**（on-demand 114、settings 101、standalone 46、export-image 65 条断言）。本轮未发布新版本；下次打 tag 会包含该加固。

## 2026-11-07 — Artifact 基础登记生命周期（未提交工作树）

本条对应当前 main 工作树中尚未提交的基础登记增量（`src/shared/artifact-base.ts`、`src/host/artifact-base.ts`、`src/client/artifact-edit/artifact-base.ts` 以及结构/历史/恢复接线），不是发布验收；npm `latest` 仍为 `0.5.0`。它修复「权威程序 registry 出现之前渲染的卡片无法进入权威状态」的根因：新增一次性、写一次的基础登记生命周期与统一 base resolve/失败边界，覆盖初始锚（`revisionId === artifactId`）与已记录锚两种 provenance。未做回填/后台迁移，未改模型路径，未提交、未推送，未重启 `dsh-web`，也未运行真实模型会话。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run build:host` | PASS；`lib/index.js` **823.0 kB** |
| `node --test test/host/*.test.mjs` | PASS；**253/253**（新增 `test/host/artifact-base.test.mjs` **12** 条） |
| `node --test test/client/*.test.mjs` | PASS；**257/257**（新增 `test/client/artifact-base.test.mjs` **5** 条、`test/client/artifact-edit.test.mjs` 新增 3 条） |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**406 checks**（场景 36 新增基础登记、登记先于结构请求、旧 Host 404 降级与统一失败文案断言） |
| `npm run test:renderer` | PASS；parse **42/42**、render **42/42**、contrast OK、i18n **4**、typography **22/22**、media-row **17/17**、pressable **9/9**、CSS 契约 **50/50**、组件契约 **63/63**、nested-css **28/28 direct + 5/5 scoped** |
| `npm run check` | **未完全 PASS**：`tsc --noEmit` PASS、build PASS；Node **531** 条中 **529 通过 / 2 失败**。两条失败均为打包测试，来自工作树中其他增量的待提交 README 真实截图资产：`test/packaging/manifest.test.mjs` 断言 `assets/` 为 28 张而实际 32 张；`test/packaging/references.test.mjs` 断言 `skills/intelligent-ui/references/integration.md` 引用的随包文件应为 63 个而文中仍写 59。二者都不读取本增量产物，属既有基线 delta；`skills/`、README 与资产归其他成员，本任务未修改。renderer 阶段因 `npm test` 非零未在 `check` 内执行，已单独运行并通过（上一行）。 |
| `npm run pack:check` | PASS；**63** 个文件，压缩 **5,730,101** 字节，解包 **12,512,663** 字节（`prepare` 先重建） |
| 构建产物 | Host **823.0 kB**；Client **4.00 MB**（js 3.79 MB + css 215.7 kB）；standalone **3.33 MB + 514.4 kB** |

### 覆盖范围

- Host：`POST /api/intelligent-ui/artifact-base` 注册与 disposer、认证先于方法分发、POST-only/content-type/坏 JSON/>1 MiB → 413、字段与 program 校验、初始锚与已记录锚登记、写一次 no-op 与 409 `program_conflict`、unknown revision 与外 artifact 记录、已记录锚解锁结构操作/历史/restore；无模型端到端升级：登记 → 结构 preview/apply **201 revision 2** → 历史含初始 revision 与 revision 2 → restore 初始 **201 revision 3**；结构路由 `artifact_missing`/`base_missing` 语义与文案回归。
- Client：`ensureArtifactBase` single-flight、成功缓存、旧 Host 404 → `unsupported` 能力缓存（同一 revision 不再探测）、网络/畸形响应可重试且从不抛出；打开编辑画布/结构 preview+apply/修订历史/restore 的接线；preview 现在解析 `error.code`，preview/apply/props 共用统一缺失 base 文案（含关闭重开、重新渲染、指令编辑路径）。
- 未覆盖：真实模型 DSH 会话、真实旧 Host 进程、`dsh-web` 重启后的真实 GUI（用户未批准重启）；浏览器证据来自临时 HTTP server + headless Chrome harness，不是完整 DSH Web 集成。

## 2026-11-07 — README 真实会话截图、快捷调整单位与基础登记整合后的最终验证（未提交工作树）

本条把同一天工作树中的三组增量放在一起做最终门禁并更新计数：README 生成区改为真实 DSH 会话截图；Divider/Spacer 快捷调整长度单位统一为默认/px/% 并补充说明；Artifact 基础登记生命周期（上一条已单独记录，本轮只做整合回归）。不是发布验收；npm `latest` 仍为 `0.5.0`；未提交、未推送、未重启 `dsh-web`。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；`tsc --noEmit` + build；Node **531/531** = Host **253** + Client **257** + packaging **21**；renderer 解析/渲染各 **42/42**、contrast OK、i18n **4**、typography **22/22**、media-row **17/17**、pressable **9/9**、CSS 契约 **50/50**、组件契约 **63/63**、nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS；**9/9** 套件；`artifact-edit` **406 checks**、`nested-edit-renderer` **75**、on-demand **114**、settings **101** 条断言等 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **5,989,503** 字节，解包 **12,783,390** 字节 |
| `npm run capture:readme` | PASS；重新生成组件/编辑/总览/组件一览/控制/临时结果等 fixture 截图，使开关文案与当前代码一致；真实会话生成 Bento **未被覆盖**（`scripts/build-readme-bento.mjs` 已移除 generation 组，`scripts/build-readme-generation-bento.mjs` 独立组合） |
| 文档/结构检查 | README 双语标题层级一致；截图引用、语言切换、clone URL、CHANGELOG 链接、本地链接/锚点通过；`git diff --check` PASS |

### 覆盖范围

- 真实会话截图：中英各一套三个不同类型的 Artifact（上海两日游行程、数据看板、交互小测），全部在运行中的 DSH GUI 由 DeepSeek V4.1 Flash · Max 真实生成后，从生产渲染的轮末卡片按 2× 捕获；原始捕获随包发布在 `assets/intelligent-ui-real-*`，组合图为 1600×1130 双语一致几何；来源、会话与提示词见 `docs/screenshots/real-generation.md`。`npm run capture:readme` 不能复现真实会话截图。
- 快捷调整：Divider width 与 Spacer width/height 只提供默认/px/%，下拉选项与行下各带一句说明；旧 `auto` 仍被 Host/渲染器接受并显示为默认，真正改动前 Apply 禁用；Host/渲染器兼容未收紧。
- 基础登记：见上一条记录；整合后 Node 总数与打包计数随其新增测试/文件更新。
- 未覆盖：真实旧 Host 进程、`dsh-web` 重启后的客户端真实行为（用户未批准重启）；真实模型会话截图不可由脚本复现；屏幕阅读器/axe 未运行。


## 2026-11-07 — 独立 review 修复与最终门禁（未提交工作树）

本条记录两个只读 review subagent 的发现修复与最终门禁，不是发布验收；npm `latest` 仍为 `0.5.0`；未提交、未推送、未重启 `dsh-web`。

### 修复范围

- **F1（用户决定 A）**：`src/host/artifact-revisions.ts` 的 program-only 回退恢复原语义（source 记录缺失但权威 program 仍在即允许恢复，不额外校验初始身份；文件相对 HEAD 净零 diff），并新增"非初始孤儿 source 仍可恢复"回归测试。
- **F2**：客户端 `artifact-base` 缓存在结构 preview/apply/props 返回 `artifact_missing`/`base_missing` 时失效（history 的 `hasProgram:false` 同样失效），带 in-flight 代际保护；关闭重开编辑确实会重新登记。
- **F3**：program store 改为先写盘、成功后提交内存；写盘失败（如 EACCES）不再留下幽灵记录，可安全重试。
- **F4**：base 校验同时限制 raw program 长度；尾随空格的超长 program 由 500 storage 改为 400 `invalid_program`。
- **F5/F6**：英文 described 单位下拉获得更大的高度预算（272px，实测 239px 内容不再裁切）；Default 说明按行区分（Divider 宽度撑满列 / Spacer 宽度填满 Row / Spacer 高度通常为 0）。
- **F7**：ensure-before-structure 测试改为先挂起 base 响应、断言 release 前无结构请求；移除 await 会使测试失败（mutation-checked）。
- 证据文档 `docs/screenshots/real-generation.md` 的视口/尺寸/语言顺序陈述、维护参考、CHANGELOG 计数与 stale 陈述同步修正；zh 行程卡的 4× 原始捕获已同步进 `.tmp-report/real-generation/`。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；`tsc --noEmit` + build；Node **538/538** = Host **257** + Client **260** + packaging **21**；renderer 解析/渲染各 **42/42**、contrast OK、i18n **4**、typography **22/22**、media-row **17/17**、pressable **9/9**、CSS 契约 **50/50**、组件契约 **63/63**、nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS；**9/9** 套件；`artifact-edit` **422 checks**、`nested-edit-renderer` **75**、on-demand **114**、settings **101** 条断言等 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **5,989,940** 字节，解包 **12,784,885** 字节 |
| 文档/结构检查 | README 双语标题层级一致；截图引用、语言切换、clone URL、CHANGELOG 链接、本地链接/锚点通过；`git diff --check` PASS |

### 未覆盖

真实旧 Host 进程、`dsh-web` 重启后的真实 GUI（用户未批准重启）、真实模型会话截图不可由脚本复现、屏幕阅读器/axe 未运行；zh 的 overview 组合图设置面板仍为英文 UI（既有语言匹配遗留，与本次真实会话生成截图无关）。

## 2026-11-08 — 编辑内自然语言样式调整（B1）与 scope 切换行为修复（未提交工作树）

本条记录 B1"编辑覆盖调整样式"（自然语言、修订语义）与"切换 scope 不再自动打开显示样式面板"的最终实现与门禁；不是发布验收；npm `latest` 仍为 `0.5.0`；未提交、未推送、未重启 `dsh-web`。

### 实现与安全边界

- `ArtifactEditRequest` 变为 block/style 判别联合；block 序列化字节不变、绝不携带 `kind`；style 变体显式 `editRequestId`、记录 layout、`styleInstruction`（≤2000）、完整 base program，禁止任何 block/排序/整体说明字段。
- Host：style 请求必须显式 selector（H1，不会被无 selector 的 `render_ui` 自动消费）；授权前无副作用 peek（H2）；有 bound on-demand 操作时拒绝（H3，避免同 callId 双写快照）；与 on-demand 共用 `validateTemporaryStyleSnapshot`；记录模型返回的 `temporaryStyle`（H7），不带 `styleId`/`editedBlockIds`；无变化 no-op 不消费；整体重设计补 H4 内容保留 warning；`edit_ui_blocks` 对 style 请求提前重定向并保持 pending。
- 根因修复：`ArtifactRevisionStore.record` 在写修订前，对携带 `temporaryStyle` 的修订先登记 ResultStore 快照（先快照后修订、失败可重试）；编辑/恢复/结构三条路径的修订卡因此都能「保存为模板」；不做历史回填。
- 客户端：编辑面板顶部样式区（≤2000 字、直接进草稿、与区块请求互斥 `style_mixed`）、chip/摘要「样式调整」、能力位 `styleEdit`；新 Host + 可编辑卡片隐藏底部「调整样式」（`saveAction` 保留），旧 Host/不可编辑卡片保留回退；能力缺失时清除已持久化样式说明。
- Scope 切换：成功切换只提交启用命令、不自动打开显示样式面板；面板仅两个显式入口（「显示样式」行、点击已激活且解析为开启的 scope 项）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；`tsc --noEmit` + build；Node **558/558** = Host **269** + Client **268** + packaging **21**；renderer 解析/渲染各 **42/42**、contrast OK、i18n **4**、typography **22/22**、media-row **17/17**、pressable **9/9**、CSS 契约 **50/50**、组件契约 **63/63**、nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS；**9/9** 套件；`artifact-edit` **447 checks**、`nested-edit-renderer` **75**、on-demand **114**、settings **101** 条断言等 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **5,992,803** 字节，解包 **12,808,780** 字节 |
| `npm run capture:readme` | PASS；临时结果截图更新为"保存为模板"（可编辑+新 Host 时底部调整样式已移除）、编辑器截图包含新样式区；真实会话生成 Bento 未被覆盖 |
| 文档/结构检查 | README 与五组双语文档标题层级一致；本地链接/锚点、截图引用、CHANGELOG 链接通过；`git diff --check` PASS |

### 覆盖与未覆盖

- 覆盖：style 信封/校验/序列化、Host mint/apply/授权、H1/H3/H4/双写变异验证、修订快照边界、history 推断、能力位与 footer 回退、编辑面板样式区/焦点/Escape/清除/chip、scope 切换 E2E、截图与文档同步。
- 未覆盖：真实模型/真实 GUI 的 style 调整（浏览器 E2E 用 mock Host）；新 Host + 旧客户端或旧 Host + 新客户端的真实混合部署运行；确定性内置/模板样式切换（B2，按裁定不在本增量）。

### 更正与后续（2026-11-08 第三轮复审后追加）

- 本记录中的“编辑器截图包含新样式区”在写作时不成立：capture harness 当时未注入 `styleEdit` 能力；后续已注入并重拍 `assets/intelligent-ui-editing-{zh,en}.webp` 与 overview 组合图，现截图确实包含「样式 / 更改样式 / 样式切换 / 应用样式」与已保存 Article 提示。
- 本记录中的“block 序列化字节不变”在后续契约强化后不再成立：block 信封的 header 与 program 正文保持兼容，但 prose 改由 `blockEditToolContract` 生成并新增 `Tool-call contract:` 行，整段文本不再保证字节不变。
- B1 真实 GUI 冒烟已做（2026-11-08，上海两日游会话：真实模型返回 Revision 2，样式生效、Save 对话框打开、历史可见、footer Adjust 隐藏）；证据仅为会话转录，未留存截图，不作为自动门禁。
- 当前工作树门禁已推进到 Node 615/615（Host 298 + Client 296 + packaging 21）、`artifact-edit` 497 checks；本记录的 558/447 仍是当时的门禁数。

## 2026-11-08 — 确定性样式切换（零模型，B2）最终验证（未提交工作树）

本条记录 B2"编辑内确定性样式切换"的实现与门禁；不是发布验收；npm `latest` 仍为 `0.5.0`；写作时未提交、未推送、未重启 `dsh-web`（B2 客户端 bundle 需下次重启/刷新后才在真实 GUI 可见）。

### 实现与边界

- 契约：既有认证 `POST /api/intelligent-ui/artifact-structure` 增加请求级 `targetStyle`（builtin card/article 或已保存 `cs_` 模板）与 `sessionStyleScope`；单意图规则（带 target 时 operations 必须为空、无 preview；无 target 时旧 1..20 ops/preview 不变）。目标只接受 durable 身份，不接收客户端快照/directives/theme；Free 仅经已保存 free 模板。
- Host：目标 Host 侧解析（`styles.resolve(styleId, sessionStyleScope)`，不可见/删除 → `style_missing`）；Article 复用与 render_ui 同一 Toc/Section+anchor 谓词（`program-validation.ts`）；对已有修订记录（revision ≥ 2）的 base 校验客户端声明的 base style/styleId 与权威记录（409 `base_style_mismatch`，零写入，H1 根因修复）；初始 revision 1 无记录、身份仍取请求/登记；no-op 规则（临时样式 base + 任意 durable 目标总是变化，快照被丢弃）；`struct_` 修订记录同程序、目标 style/styleId、无 `temporaryStyle`/`editedBlockIds`（H5 样式切换签名），latest+1/branch/ledger/registry/响应保持；digest 绑定 target+scope；`styleSwitch` 投影能力位。
- 客户端：编辑面板样式区新增单意图 radio picker（内置 Card/Article + 可见已保存模板，带 color swatch/layout meta、current badge、Article Toc/Section 提示、temporary 说明），悬停/聚焦本地预览主题与 Article 外壳（零 POST），显式「应用样式」走零模型 struct 请求；成功记录本地 `kind:'style'` 修订卡并关闭编辑器、不产生 composer chip；dirty/busy/current/no_change 守卫与 `style_missing`/`article_unavailable`/`base_not_latest`/`base_style_mismatch`/`no_change` 文案映射；历史里 `struct_` 前缀且无 `editedBlockIds` 的修订显示为样式切换（旧客户端仍显示结构操作，无新 durable 字段/枚举）。
- 限制：仅换身份/外壳/主题，模板 directives 不重排内容；本地修订卡不进入助理消息/导出/replay/其他设备；H4（render_ui 的 order-only/global-only 编辑按会话样式校验）当时记录为限制（注：H4 已在第三轮复审修复，pending block edit 使用 artifact 记录样式）；`sessionStyleScope` 是模板可见性选择器，不是授权边界。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；`tsc --noEmit` + build；Node **603/603** = Host **292** + Client **290** + packaging **21**；renderer 解析/渲染各 **42/42**、contrast OK、i18n **4**、typography **22/22**、media-row **17/17**、pressable **9/9**、CSS 契约 **50/50**、组件契约 **63/63**、nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS；**9/9** 套件；`artifact-edit` **497 checks**（场景 40 + review 修复断言）、`nested-edit-renderer` **75**、on-demand **114**、settings **101** 条断言等 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,036,654** 字节，解包 **12,874,349** 字节 |
| 构建 | host **835.9 kB**、client **4.03 MB**（js 3.81 / css 220.0）、standalone 3.33 MB + 514.4 kB |
| 文档/结构检查 | README 与五组双语文档标题层级一致；本地链接/锚点、截图引用、CHANGELOG 链接通过；`git diff --check` PASS |

### 覆盖与未覆盖

- 覆盖：contract 单测、Host struct 路由矩阵（article 谓词/目标解析/scope/临时快照丢弃/no-op/H1/请求形状/stale/branch/replay/零写）与 5 项 mutation 验证、客户端 POST 精确体/dirty-busy-current 守卫/错误映射/本地修订/历史标签、E2E 场景 40（picker/preview 零 POST/apply/本地卡/无 chip/temporary 行为/错误文案/键盘 a11y/能力关闭回归）。
- 未覆盖：真实 GUI 中的 B2 picker 与真实 GUI/DOM 组合（零模型；当前运行进程仍是 B1 bundle，需用户许可重启后复验）；真实混合部署；H4 修复（已在第三轮修复）；B2 的本地修订卡导出/replay 语义（既有结构/属性限制）。

## 2026-11-08 — 二次复审修复与模型调用契约强化（未提交工作树）

二次独立复审（1 路代码/安全 + 1 路文档/证据，均只读）后追加的修复记录。

### 复审发现与修复

- **代码 HIGH**：saved-template 与 temporary-style 两类 base 的 style 信封在上一轮修复中误删了 `Pass style` 指令；Host 要求 `args.style === request.style` 且 `temporaryStyle.baseLayout === args.style`，因此这两类页面的 B1 样式编辑首次调用必被拒。第一版按文案补回后，复审指出这仍是“补丁式”修复——根因是模型可读 prose 与 Host 接受参数是两个独立事实源，测试只断言文案片段。
- **系统性修复**：新增 `styleEditToolContract`/`buildStyleEditToolArgs` 与 `blockEditToolContract`/`buildBlockEditToolArgs` 作为单一契约源；block/style 序列化器的 `Tool-call contract:` 行由 helper 生成，不再手写各分支参数说明；新增 Host 耦合测试，分别对 style（builtin/saved/temporary 三种 base）与 block（`edit_ui_blocks` fragments / `render_ui` order-only）执行 helper 产出的真实参数并要求 Host 记录 revision 2。任一侧参数或序列化器漂移都会让测试失败。
- **同批复审修复**：saved Article 模板行补 `requiresArticleLayout` 提示；解析器在 `<artifact-program>` 区间内跳过 marker（新增合法 JSON 假 marker 回归测试）；删除“Host 会校验 styleId”的虚假文案；`local-revisions` 测试计数 3→5；英文 architecture 的旧计数/旧 pack 数、CHANGELOG 指向、README 提交状态与“选中后点应用样式”等文档残留全部修正；重拍编辑/overview 截图。
- 记录后边界：block-edit 与 style-edit 两条模型契约已用 helper + Host 耦合测试固化；branch/其他工具文案仍为手写 prose，未做同样的契约化。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **603/603** = Host **292** + Client **290** + packaging **21**；renderer/契约全绿；build host **835.9 kB**、client **4.03 MB**（js 3.81 / css 220.0）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **497 checks**、`nested-edit-renderer` 75、on-demand 114、settings 101 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,036,654** 字节，解包 **12,874,349** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 第三轮复审修复（契约强化、解析与边界路径；未提交工作树）

第三轮独立复审（代码/安全 + 文档/证据）后的修复记录；复审对契约 helper 的结论为“测试空心”，本轮把耦合测试收紧并修复了复审列出的边界路径。

### 修复

- **工具参数契约收紧**：Host 耦合测试现在使用带 `requestId`/`artifactId` 的 fragment 请求与带 `styleId`/`editRequestId` 的 order-only 请求，断言 helper 产出的完整 key 集与 contract 的 required/optional/forbidden 字段；新增双 pending selector、order-only title/styleId、session 模板与 artifact 模板不一致（H4）、伪造快照（记录以 registry 为准）等测试。
- **解析加固**：block prose 的 instruction/addition/global 文本统一转义 `<`；envelope 仅在 marker 后换行 JSON header 时成立；`<artifact-program>`/`</artifact-program>` 按独立行围栏截取，program body 内的字面 marker 不再截断；新增合法 JSON 假 marker、程序内字面 program marker 回归测试。
- **边界路径**：order-only/global-only 结果回传记录 title/styleId 与 `presentationMeta`；临时样式 additions-only 不再被客户端误判 `temporary_order`；pending block edit 使用 artifact 记录样式而非会话模板（消除 H4 deadlock）；内容编辑以 registry 的 temporaryStyle 为准；未保存的 block draft 阻止 style switch；Article hint/dirty 文案校准。
- **能力与无障碍**：`styleSwitch` 现在由 `registerArtifactStructureRoute` 的挂载结果派生（路由缺失时不发布）；branch 指令行由 `branchEnvelopeLine` 单一来源生成；forced-colors 下新增 radio 键盘焦点环（E2E 断言），并修正“E2E 覆盖 struct_ 历史标签”的文档表述（实际由单元测试覆盖）。
- 剩余已记录 LOW：可见但未选中的全局模板仍会给模型侧 “not available” 提示（模型本不应传未选中模板 id）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **615/615** = Host **298** + Client **296** + packaging **21**；renderer/契约全绿；build host **836.8 kB**、client **4.03 MB**（js 3.81 / css 220.0）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **497 checks**、`nested-edit-renderer` 75、on-demand 114、settings 101 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,047,986** 字节，解包 **12,890,199** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 第四轮复审修复（路由能力位异步、标题转义、summary fence；未提交工作树）

第四轮独立复审发现：route 派生 `styleSwitch` 在真实 cordis 下立即返回 false，而 view schema 只接受 `true`，导致 projection view 非法、picker 隐藏；block title 未转义可注入 program fence；`nextEditRequestSummary` 仍按子串扫描 program fence；以及若干文档/测试覆盖问题。

### 修复

- **能力位**：`registerArtifactStructureRoute` 不再依赖同步返回值，而是在 deferred inject 回调真正挂载时调用 `onMounted`（或 `onUnavailable`）；`modeViewSchema` 的 `styleSwitch` 改为可选 boolean；新增 deferred-inject 与 false/absent view parse 测试。
- **解析**：block target prose 的 title 统一转义；`nextEditRequestSummary` 改用 `programFence` 定位终边界（不再被 inline close marker 截断），单测改为断言精确 end。
- **测试真实性**：forced-colors E2E 断言 2px focus ring（不再被 checked-row 1px outline 满足）；E2E 成功切换改用可达的 saved card template（Article 目标对 DST program 会被真实 Host 拒绝）；style contract 增加 required/optional 数组；新增临时样式 additions-only Host 测试、order-only branch 单测、presentationMeta styleId 断言。
- **文档/截图**：limitations 的 H4 过期限制改为已修；B2 历史记录加 H4 已修注记；README 示例名与图一致（pour-over calculator）；contract prose 措辞收窄为“只有 Tool-call contract 行由 helper 生成”；截图补 `--dsw-alias-brand-primary` / `--dsw-alias-label-primary-foreground` 后重拍，Apply 按钮现可见；doc-map/CSS/pack 数字同步。
- 剩余：structure-route 的 authoritative-snapshot 分支仍只有 apply 侧测试（route 侧代码同策略，未单测）；真实 Windows 高对比度/真实 GUI 未测。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **615/615** = Host **298** + Client **296** + packaging **21**；build host **836.8 kB**、client **4.03 MB**（js 3.81 / css 220.0）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **497 checks**、`nested-edit-renderer` 75、on-demand 114、settings 101 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,047,986** 字节，解包 **12,890,199** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 稳定化守卫（统一 envelope 扫描、截图 token 契约、延迟注入、文档事实源；未提交工作树）

复审收口后补的四类结构守卫：

- **统一 envelope 解析**：`scanEnvelopeWindows()` 成为 parse/summary/split 的唯一窗口来源；修正 program close 在“两个信封直接拼接、无尾随换行”时被跳过的问题，新增直接拼接信封的 parse/summary 回归。
- **截图 token 契约**：`test/renderer/capture-token-contract-check.mjs` 扫描 `src/**/*.css` 用到的 `--dsw-alias-*`，要求 capture fixture 的 `:root` 全部定义；已补缺失 token 并重拍编辑/overview 截图（Apply style 可见）。
- **plugin 级延迟注入测试**：`test/host/mode.test.mjs` 增加 `deferInject` mount，异步 drain cordis 注入回调后校验 projection view 能被 schema parse 且 `styleSwitch: true`。
- **文档事实源**：`docs/current-facts.json` 记录当前 gate 数字，新增 `scripts/check-doc-facts.mjs` 并接入 `npm run check`，校验 README/architecture/latest verification/CHANGELOG 的当前值；历史记录保持历史数字。局限：JSON 仍需门禁后人工更新，但所有“当前值”只有一个来源，检查会让漏改变红。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **617/617** = Host **299** + Client **297** + packaging **21**；build host **836.7 kB**、client **4.03 MB**（js 3.81 / css 220.0）；含 capture-token 契约与 doc-facts 检查 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **497 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,047,986** 字节，解包 **12,890,199** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — B2 真机验收（重启后，真实 GUI）

- 同树门禁（本记录引用）：Node **617/617** = Host **299** + Client **297** + packaging **21**；`artifact-edit` **497 checks**；build host **836.7 kB**、CSS **220.9** kB；pack **6,047,986** / **12,890,199** 字节。

- dsh-web 重启后 pid **15525**（launchd loaded、3080 归该 pid、未认证根页面 401、启动日志无异常）；用新 URL 打开真实 GUI。
- 上海两日游会话（已有 B1 产生的 Revision 2）：打开卡片编辑 → 展开样式区，**B2 样式切换组出现**（内置 Card/Article；该页为临时样式 base，无 current 行并显示 temporary 说明）；选择内置 Card 后 **Apply style** 可点；点击应用后编辑器关闭、无 alert，聊天中出现本地修订卡 **“Style revision” / Revision 3**，页面内容与布局保持不变。
- 结论：真实 cordis 下 `styleSwitch` 能力位/projection view 正常（picker 可见即证明 view schema 通过），结构路由真实 POST 成功；B2 零模型路径在真实 GUI 通过。
- 未覆盖：强制色彩真机（仅 CDP 模拟）、真实旧/新 Host/Client 混合部署、真实模型（B2 本来零模型）。
- 注：本次验收在上海两日游会话追加了一条本地样式修订（Revision 3，内容不变，仅用于验证）。

## 2026-11-08 — 修订历史删除（真删 Host 记录 + 本地卡清理）

- **UI**：历史弹窗每条已记录修订新增「删除」，先内联确认再执行；初始渲染（Revision 1）不提供删除；当前/最新修订允许删除，删后最新回退到上一条。删除失败按 `409 revision_referenced` / `404 revision_missing` 显示明确原因。
- **Host**：`DELETE /api/intelligent-ui/artifact-revisions?artifactId=&revisionId=`，与 GET 探针共用认证、`effect` 和 disposer；`ArtifactRevisionStore.remove()` 拒绝作为其他记录 `baseRevisionId` 的修订，并原子重写注册表；保留的 program 由 `remove()` 清理（失败只留下 LRU 可淘汰的孤儿，不影响删除结果）。不新增 durable 字段或 `ArtifactHistorySource` 枚举值。
- **客户端**：删除成功后移除匹配的 `localStorage` 本地修订卡并刷新历史；已渲染的模型消息卡不删除（见限制）。
- **边界**：不可恢复；被其他修订引用时须先删更新的；删除当前修订后其余卡片的 revision 徽标可能停留在旧值，后续权威操作会刷新；删除 base 会让仍在引用的草稿/分支在发送时收到 `base_missing`；删除操作不撤销 `struct_` 操作的幂等 ledger 记录（同一 operationId 不应重放）。
- **验证**：Host 32 条（新增删除成功/被引用/初始/程序清理）、Client `local-revisions` 7 条（新增本地卡删除与 API 状态映射）、浏览器 `artifact-edit` **498** 条检查（新增确认→删除→本地卡消失流程）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **621/621** = Host **301** + Client **299** + packaging **21**；build host **837.4 kB**、client **4.04 MB**（js 3.82 / css 221.6）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **498 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,032,790** 字节，解包 **12,879,500** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 样式与编辑整合（可用性预判、单状态行、幂等重试、保存边界）

- **边界**：统一点是「一个 Artifact、一条修订线、一个样式入口」，并把样式切换、样式说明都作为 Artifact 编辑的操作类型；区块/结构编辑仍改 program，样式切换零模型、program 逐字节不变，样式说明由模型产出 temporaryStyle。保存模板不是编辑，也不产生修订。
- **可用性预判**：Article 谓词抽到 `src/shared/article-layout.ts`，客户端与 Host 共用；页面不满足 Toc/Section/anchor 时 Article 行直接禁用并显示一行原因。新增纯函数 `style-targets.ts` 统一计算 Apply blocker：检查中／非最新（非 branch）／忙碌／草稿／样式说明／无目标／目标不适用／当前已选；样式区只显示一条状态行，移除了常驻的多段说明。
- **版本与重试**：非 branch 旧修订禁用 Apply；显式 branch 允许并说明。请求带上可复用的 `styleSwitchOperationId`，响应丢失后用同一 id 重试，由 Host 幂等 ledger 返回已记录结果，避免变成 `base_not_latest` 或重复修订。
- **保存**：保存为模板仍只出现在带 theme 的临时样式结果（B1/按需），位于结果/修订卡而不进编辑器；样式切换结果不保存；保存不产生修订。模板仍是 live reference，改主题/删模板会影响旧切换修订，已在 limitations 记录；branch 不自动创建。
- **测试**：新增 client `style-targets` 2 条纯函数测试与 store 2 条测试（Article 前置拒绝、丢失响应后同 operationId 重试收敛）；E2E 更新为 Article 置灰、单状态行、键盘跳过禁用项、脏草稿预禁用等场景，`artifact-edit` 500 checks。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **625/625** = Host **301** + Client **303** + packaging **21**；build host **837.6 kB**、client **4.04 MB**（js 3.82 / CSS 221.9）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **500 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,025,580** 字节，解包 **12,879,400** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 样式区可见性收口

- 样式区默认折叠行保留当前样式；当前样式带 theme 时显示小色板。
- 已填样式说明时，折叠行显示「样式说明待发送」，发送摘要增加「样式说明」行（不计入区块编辑数）；DraftDock 不再把纯样式草稿显示成「整体说明」。
- 目标组文案改为「立即切换样式」，文字输入标签改为「或用文字描述（由模型修改）」，明确零模型切换与模型描述两条路径。
- 本轮没有新增 popover、页面操作待发送队列或编辑器内保存入口；样式切换仍立即产生修订，样式说明仍走 composer/model 路径，保存仍只适用于带 theme 的临时样式结果卡。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **625/625** = Host **301** + Client **303** + packaging **21**；build host **837.6 kB**、client **4.04 MB**（js 3.82 / CSS 222.4）、standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **504 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,031,253** 字节，解包 **12,885,993** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 保存入口 A 收口（仅新建模板）

- 保存说明改为：创建新模板，不覆盖内置或已有模板，其他页面不受影响。
- 保存入口条件不变：仅带 theme 的临时样式结果卡显示；内置 Card/Article、已保存模板结果、普通结果、无 theme 临时结果均无保存入口。
- 不提供“更新原模板”或“复制已保存模板”：当前没有同时具备源 styleId 与完整快照的结果，模板更新接口也只允许 name/description/directives；模板是 live reference，原地更新会影响旧页面，需另立设计。
- E2E 增加三条负向断言（内置、已保存模板、theme-less 临时结果均无 Save）；保存仍为新建模板且不产生修订。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **625/625** = Host **301** + Client **303** + packaging **21**；build host **837.6 kB**、client **4.04 MB**（js 3.82 / CSS 222.4） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **507 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,031,281** 字节，解包 **12,885,957** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-08 — 未复审提交批次修复

独立只读复审 `852e331..HEAD` 后修复的 P2/P3：

- **Envelope sibling 回归**：`programFenceFrom` 以 `nextEnvelopeOpen` 为界截断，恢复 close fence 的行尾约束；缺 program 的信封不再借用下一个信封的 program。新增“第一个缺 program、第二个完整”的回归。
- **修订删除幂等**：DELETE 返回 `revision_missing` 视为已收敛（移除本地卡并刷新）；禁止删除当前卡片正在渲染的修订；DELETE 路由捕获存储失败；Host 认证测试覆盖 DELETE。
- **晚到 stale**：Host 返回 `base_not_latest` 时（非 branch）store 进入 conflict，状态行与 Apply 禁用一致，不再显示可应用。
- **文档/测试修正**：DELETE 路由、Article 谓词位置、当前卡删除限制、stale/base_missing 文案；客户端单测增加缺 program 边界；E2E 增加当前卡删除保护与 missing 收敛断言。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **626/626** = Host **301** + Client **304** + packaging **21**；build host **837.9 kB**、client **4.04 MB**（js 3.83 / CSS 222.4） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **509 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,031,527** 字节，解包 **12,886,783** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 复审剩余 P3 修复

- **删除确认可访问性**：确认态聚焦 Cancel、取消回到 Delete、warning 用 `role=status` 播报；历史对话框初始聚焦改为同步，避免延迟 rAF 抢走确认焦点。
- **删除负路径**：Host 新增跨 artifact DELETE 测试；DELETE 已纳入 401/403 认证循环；界面禁止删除当前卡正在渲染的修订与初始修订；`revision_missing` 收敛已有 E2E。
- **显式 target 绕过**：客户端 `applyArtifactStyleSwitch` 移除显式 target 参数，只使用会话中已选择的目标，避免测试/调用方绕过 Article 前置 gate；store 测试改为先选择再应用。
- **测试真实性**：重试测试第二次返回 200 replay 而非 201；E2E 断言 style 结果保留 base program；新增 radio 16px/圆形、swatch 方角/background-origin 的 computed-style 断言；修正 stale E2E 注释与 browser README。
- **文档**：恢复被改写的历史验证门禁数字（615/298/296 等）为原值；修正 DELETE 路由、Article 谓词位置、当前修订删除限制、stale/base_missing 文案；加强 doc-facts 求和/浏览器套件/pack 文件数校验；移除未使用的 style 文案 key 与测试引用。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **627/627** = Host **302** + Client **304** + packaging **21**；build host **837.9 kB**、client **4.04 MB**（js 3.82 / CSS 222.4） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **519 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,031,255** 字节，解包 **12,885,706** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 第二轮复审修复（焦点回归、layout gate、文档事实）

- **删除后焦点逃逸（P2）**：历史对话框的 mount/cleanup effect 改为 mount-only，keydown 通过 `onCloseRef` 读取最新回调；删除成功/`revision_missing` 收敛后由 post-render effect 把焦点放回对话框 Close，父组件重渲染不再触发 cleanup 把焦点送回触发器。E2E 断言删除后焦点仍在打开的弹窗内。
- **跨行焦点**：`HistoryRow` 只在真正的取消（`confirmingDeleteId === null`）时回焦本行 Delete，移动到另一行确认时不再抢焦点。
- **Article/layout gate**：删除显式 target 参数后，由 chosen builtin layout 或所选 template layout 推导；template layout 缺失时在请求前失败，built-in Article 始终走共享谓词。
- **文档事实**：625 gate 的 packed bytes 保持 6,031,253；627 gate 的实际记录为 js 3.82，628 gate 与 current facts 为 3.83；把“缺 program 边界”从 E2E 声明改为客户端单测；doc-facts 改为真正切片最新 `##` 记录、固定 9 个套件分母，并校验 `clientJsMb`。
- **残余限制**：其他卡渲染的 latest 仍可被删除，之后按 stale/base_missing 失败；文档和删除确认文案已明确“其他仍引用该修订的卡片可能变为过期状态”，完整修复需要 render lease/卡片失效机制，不在本轮范围。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **628/628** = Host **302** + Client **305** + packaging **21**；build host **837.9 kB**、client **4.04 MB**（js 3.83 / CSS 222.4） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **519 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,031,830** 字节，解包 **12,887,088** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 历史单一入口与删除回退

- **入口收口**：卡片头部的独立 `Revision N` 徽标按钮移除，历史图标成为卡片唯一的历史入口；渲染修订号 >1 时在图标后显示数字，并把修订号并入 aria-label（`data-dsh-iui-history-count`）。编辑面板头部历史按钮保留；收口前后所有入口共用同一个 `ArtifactHistory` 与同一份 Host 历史。
- **删除回退**：`ArtifactHistory` 在删除前用 `rollbackTargetFor()` 选出「修订号更小且 program 仍保留」的最新修订，经 program 路由取回后写入新的 `artifact-edit/revision-fallbacks.ts`（`localStorage`、每会话 ≤20、按被删修订 id 去重）；`IntelligentUICards` 用 `applyRevisionFallback()` 把仍渲染被删修订的工具结果卡替换为回退修订（保留 `callId`/`requestId`/卡片位置），刷新后仍生效；`export-data.ts::programsForMessage` 应用同一 fallback。没有可回退目标时，卡片自己渲染的修订行不提供删除；确认文案改为「会回退到修订 N」。
- **本地卡**：本地修订卡（恢复/结构/属性/样式）删除仍走 `removeLocalRevision()` 移除卡片，不写回退记录。
- **测试**：新增 `test/client/revision-fallbacks.test.mjs`（9 条：目标选择、样式/标题替换、持久化/去重/上限、脏数据忽略、索引）；`export-data.test.mjs` 新增 1 条导出回退；浏览器 `artifact-edit` 新增场景 41（单一入口与修订号、回退删除确认、删除后卡片内容与修订号、重渲染后仍回退、无回退目标时不提供删除）并更新原历史场景的断言。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **637/637** = Host **302** + Client **314** + packaging **21**；build host **837.9 kB**、client **4.05 MB**（js 3.83 / CSS 222.2） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **530 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,033,184** 字节，解包 **12,892,076** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 本地图片来源（Image / Markdown）

- **共享策略**：新增 `src/shared/image-source.ts`：分类 http(s)/data/路径三类来源；`data:` 只收 base64 `png/jpeg/webp/gif`（解码 ≤512 KiB）；路径拒绝 NUL/控制字符、`..`、`~` 和 URL scheme（绝对路径与工作区相对路径都允许）；本地文件 ≤10 MiB、像素 ≤40 MP，MIME 按 magic bytes 嗅探；SVG 显式拒绝。单测 `test/client/image-source.test.mjs` 14 条覆盖分类、路径策略、MIME 嗅探、头解析像素上限、data URI 头解析、SVG 识别与错误映射。
- **客户端读取**：新增 `src/client/image-source.ts`，经可选的 `remote.workspaceFiles.stat/readBytes` 读取字节，嗅探后生成同源 Blob URL；`src/client/index.tsx` 用 `ctx.inject(['remote.workspaceFiles'])` 绑定，服务缺失时本地图片降级为「不支持 Host」占位。
- **渲染层**：新增 `src/lib/components/image-source.tsx`（Provider/`useImageSource`/错误占位）；`Image` 的显式来源失败显示占位且不再按 `alt` 搜图，`SearchImage` 不变；`Markdown` 支持 `![alt](src)`；`OpenUIRenderer`、卡片与编辑画布新增 `resolveImage` 注入。顺带修复显式来源为空时误渲染无 `src` `<img>` 的条件判断。
- **导出**：PNG settle 把错误占位视为已落定；HTML 导出从实时 `img[data-iui-image-src]` 读回 Blob 转 data URL，随 `mountIUI` 的 `assets` 内联；standalone 用资产表合成 resolver。浏览器 `artifact-edit` 场景 42 覆盖本地/内联/http/缺失/坏链/SVG/越链/Markdown 图与「显式来源不搜图」；`standalone-page` 断言内联图片与缺失占位。
- **契约与文档**：`scripts/generate-prompt.mjs` 新增 Image 描述重写（带 guard，vendor 原文不改）与图片来源契约段；同步 `vendor/spec.json`、生成的 prompt、`skills/intelligent-ui/SKILL.md`、`references/components.md`、README/usage/limitations/architecture；`test/packaging/guardrails.test.mjs` 新增图片来源单源 guard。旧 Host 无 workspace-files 时仅本地图降级，http/data 不受影响；`HtmlView` 本地图与 SVG 在 v1 不支持。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **649/649** = Host **302** + Client **325** + packaging **22**；build host **839.6 kB**、client **4.06 MB**（js 3.84 / CSS 222.9） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **538 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,040,072** 字节，解包 **12,912,120** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 独立 review 修复（系统式根因收口）

两路只读独立 review（实现深审 + 发布就绪度）结论合并：无 P0，2 个 P1，去重后 6 个 P2；本轮按根因统一修复并补测试。

- **P1 result 身份**：新增 `resultIdOf(program)`（`revisionId ?? callId`），卡片 Save as template 与底部 Adjust 统一用它；回退后不再指向被删修订的 result 快照。
- **P1 显式空来源**：`Image` 的任何字符串 `src` 都是显式来源，空/纯空白 → `path-invalid` 占位，绝不按 `alt` 搜图。
- **P2 导出 settle**：Photo/Markdown 本地图解析期统一 `data-iui-image-pending` 标记，PNG/HTML 导出等待它；离线只跳过搜索等待，本地图仍等待解析；HTML 资产收集用 canonical（trim 后）source 作为 key。
- **P2 本地卡回退记录**：父层把本 session 本地修订 id 集合传给历史弹窗，删除本地卡拥有的修订时不写回退记录（与文档一致），回退目标另受序列化字节预算约束（`MAX_REVISION_FALLBACK_STORAGE_CHARS`）。
- **P2 编辑草稿删除锁**：卡片正在渲染的修订在存在未发送编辑/打开画布时不允许删除，历史行显示原因；删除其他行的行为不变。
- **P2 契约/文案**：`vendor/spec.json` 的 components 与 schema `$defs` 描述同步，并新增逐组件 equal guard；Markdown 图片语法写入 prompt/spec/reference；troubleshooting 的旧 Image 失败描述已更新；README/usage/limitations/architecture 补充无回退目标时跨卡 stale、初始修订借用样式、HTML 导出 mounted-only、draft lock 等边界。
- **P3 系统化**：本地 SVG 按内容识别为 `svg-unsupported`；`//host/x` 归一化 https、`DATA:` 大小写不敏感；Markdown 支持 `<...>` 目标（含空格路径）；40 MP 上限对 PNG/JPEG/GIF/WebP 头预解析（未知头仍加载后检查）；`bounded()` 超时竞速避免忽略 abort 的 Remote 卡住；ImageError 的可访问名称包含原因；`bounded`/导出收集等路径补单测与 e2e（绝对路径、padded path、空来源、angle 目标、DOM 资产收集、本地图 PNG 导出、草稿锁）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **657/657** = Host **302** + Client **332** + packaging **23**；build host **840.8 kB**、client **4.06 MB**（js 3.84 / CSS 222.9） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **547 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,042,022** 字节，解包 **12,918,700** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 第二次独立复审修复（系统式收口）

第二轮两个全新独立只读复审确认上一轮 8 项修复均落地，但发现新的回退生命周期问题；本轮按根因修复后重跑全部门禁。

- **P1 回退链**：`resolveRevisionFallback()` 传递解析（深度/循环上限 20），记录新回退时改写目标等于被删修订的旧条目；卡片与 `export-data.ts` 共用，避免二次删除回退目标后卡片停留在已删除修订。
- **P2 所有权/并发**：`rollbackTargetFor()` 跳过本地卡拥有的修订；回退卡带 `fallbackFrom` 并只读，避免与同一修订的原生卡共用 `editKey` 挂载双画布；草稿锁改为 session 级 `unsentDraftRevisionIds()`（任一卡有未发送草稿，对应 base 修订均不可删）。
- **P2 图片来源语义**：`Image` 与 `SearchImage` 显式 mode；动态/非字符串 `src` 一律视为无效显式来源，绝不退搜图。
- **P2 导出**：HTML 导出改用 `settleLocalImages()`，只等待本地来源解析（短上限），不再为图片搜索/远程加载等满 12.5 s；内联 `data:` 图片也做头级 40 MP 预解析。
- **P3**：Host 历史响应新增 `referenced`，被更新修订作为基础的修订隐藏删除并说明；运行时 `defineComponent` 描述与 `vendor/spec.json` 增加全量一致性 guard（49 条）；SVG 文案限定为 path/data 来源；文档修正 Host 读权限边界、portaled Popover/失败图片导出占位、回退链/只读卡/跨卡草稿锁；修复证明/文档数字（standalone 50、image-export 66、revision-fallbacks 13、image-source 16）并移除无对应改动的“移除 unused hook”声明。
- **复审数字复核**：第二轮复审曾判 `artifact-edit` 547 checks 虚报（静态 `check(` 530）；插桩运行确认 helper 内 check 会重复执行（`chooseQuickOption` 12 次、`unitOptionsOf` 4 次），运行时 547/557 才是真实门禁数字，未按静态计数改写。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **663/663** = Host **302** + Client **338** + packaging **23**；build host **841 kB**、client **4.06 MB**（js 3.84 / CSS 222.9） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **557 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,043,599** 字节，解包 **12,924,267** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 第三轮独立复审修复（双画布/回退生命周期收口）

第三轮两个全新独立只读复审各自复现了同一 P1 与若干 P2/P3；本轮按根因修复并重跑门禁。

- **P1 回退卡双画布**：`editing`/`editorMounted`/草稿徽标/`ArtifactEditView` 挂载全部以 `fallbackFrom === undefined` 门禁；原生回退修订打开编辑器时，被重定向卡片 `[data-dsh-iui-edit-view]` 为 0。e2e 场景 41 增加该断言。
- **P2 result-bound 动作**：回退到 initial 时 Host 历史借用 `records[0].temporaryStyle`，回退卡不再显示 Save/Adjust（没有对应 result 快照）；场景 46 覆盖。
- **P2 删除失败与依赖锁**：任何已知 fallback target 但 program 拉取失败都中止并提示重试；被某卡 fallback 指向、且没有更早可回退目标的修订禁止删除并说明原因（`edit.historyDeleteDependencyLocked`），保证回退链不会落到已删除记录；场景 47 覆盖依赖锁与删除目标后的链式 retarget。
- **P3 系统化**：回退卡跳过 runtime-state 发布；per-session 图片 resolver 记忆化；HTML 导出资产仅收集导出卡片集合、按 card callId + source 分组（不再跨卡折叠同路径快照）；renderer 描述 guard 在运行时描述缺失时失败（49/49）；`data:` 大小估算扣除 base64 padding；`//host` 仅当 authority 含点/端口时按 URL，其余按双斜杠路径；cycle/depth 测试改为持久化真环与 20/21 深度边界；文档修正 session 级草稿锁文案、依赖锁/Save-Adjust 边界、SVG 作用域、跨标签页限制、per-card 资产与测试计数（revision-fallbacks 13、image-source 17、artifact-edit 566）；`.gitignore` 增加 `video/`。
- **验证数字复核**：第三轮复审中的 557/547 等静态计数讨论已由运行时确认（helper 重复执行），本轮真实数为 artifact-edit **566**、Node **664**。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **664/664** = Host **302** + Client **339** + packaging **23**；build host **841 kB**、client **4.06 MB**（js 3.85 / CSS 222.9） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **566 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,044,044** 字节，解包 **12,926,327** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-09 — 第四轮独立复审修复（活 fallback/测试保真收口）

第四轮两个全新独立只读复审结论：无 P0/P1 运行时阻塞，所有门禁通过；剩余 P2 为死 fallback 误锁、e2e fixture 与真实 Host 的 `referenced` 不一致、文档仍写 Save/Adjust 指向回退修订，P3 为若干契约/注释/边界项。本轮修复后重新验证。

- **P2 活 fallback 判定**：新增 `namedRevisionIds()` / `liveFallbackTargetIds()` / `needsRevisionFallback()`；只有仍被某个渲染程序命名的修订、或仍被活 fallback 指向的修订才记录回退；依赖锁只统计活 fallback target，死记录不再阻止 Host 允许的删除。单测覆盖三条判定。
- **P2 e2e fixture 保真**：history mock 现在按真实 Host 规则从所有记录的 `baseRevisionId` 推导 `referenced`；场景 20 改为断言“被作为基础的修订隐藏删除并说明”，真实 rollback 文案由场景 41 覆盖。
- **P2 文档**：architecture/README/usage/limitations/skill/CHANGELOG 中 Save/Adjust 的描述改为“普通卡使用 `resultIdOf`；只读回退卡隐藏 Save/Adjust（回退 initial 的样式为借用、无 result 快照）”，删除语义补上依赖锁例外，`//host` 归一化补 authority 条件。
- **P3**：`ArtifactHistoryProps` 补齐 `fallbackTargetIds`/`renderedRevisionIds`；空 result-actions wrapper 不再渲染；`export-data` 的 React-free 描述改为诚实说明；导出 assets 使用 null-prototype 容器并按字符串校验（含 `__proto__`/`constructor` 路径），`''` callId bucket 与 collector 过滤一致；`MAX_INLINE_IMAGE_DATA_URL_CHARS` 命名与计量说明；cycle/undefined 注释与真实行为对齐；late-injected workspaceFiles 与 fallback 淘汰后的 reload 行为写入 limitations；偶发 input-orbit 几何断言改为等待稳定几何。
- **验证数字**：Node **665/665** = Host **302** + Client **340** + packaging **23**（新增 live-fallback 单测）；artifact-edit **566 checks**；pack **65 files / 6,044,247 / 12,927,122**。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **665/665**（Host 302 / Client 340 / packaging 23）；build host **841 kB**、client **4.07 MB**（js 3.85 / CSS 222.9） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **566 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,044,247** 字节，解包 **12,927,122** 字节 |
| 结构 | 双语标题 parity、本地链接/锚点、截图引用、`git diff --check` 全 OK |

## 2026-11-10 — M1 活动舞台 + 可见性回落

- **版本 store**：新增 `src/client/artifact-edit/artifact-version.ts`（内存 store + 纯 reducer，`useSyncExternalStore`）。按 `(sessionId, artifactId)` 维护 revisions/latest/selected/stageCard/stageVisible；首卡成为舞台并选中 latest；舞台可见时新修订只产生 notice 行并原位更新舞台；舞台不可见时新卡晋升并冻结旧舞台；同/旧 revision 按 turn/revision 判定 notice/frozen；舞台卸载由剩余最新卡接管，最后一卡卸载后 artifact 状态清空以便重挂载/刷新重新收敛到最新（D6）。
- **卡片角色**：`IntelligentUICards` 新增 `ArtifactVersionGate`——stage 用选中 revision 合成渲染（保留自己的 `data-dsh-iui-call-id`，带 `data-dsh-iui-stage-card`/`data-artifact-id`/`data-dsh-iui-stage-visible`，编辑 key/历史 currentRevisionId/runtime state 以选中 revision 为准）；notice 是一行 `data-dsh-iui-revision-notice`（点击滚动并聚焦舞台）；frozen 渲染自己的 revision 并加 `data-dsh-iui-stage-stale-hint`；舞台显示 frozen 卡原生 revision 时只读，避免双画布。
- **一致性**：`reconcileArtifactSubmissions` 仍用本 Turn 原始 programs；local revisions 走同一 gate；历史删除沿用 revision-fallbacks 后调用 `forgetArtifactRevision`，latest/selected 指回可用记录，舞台不会悬空；选中/最新 revision 计入 `renderedRevisionIds` 供删除守卫使用。
- **测试开关**：`setArtifactVersionStageEnabled(false)` 仅 harness 使用；`artifact-edit` 场景 1–47 保持旧「每修订一张卡」断言（全部原 checks 保留），新增场景 48 开启 stage 覆盖 M1；生产默认开启，无持久化/Host 路由/新修订枚举。
- **测试**：`test/client/artifact-version.test.mjs` 20 条（首卡舞台、可见原位更新、不可见晋升、初始收敛、旧卡冻结、舞台重注册、卸载接管/清空、重挂载收敛、selectRevision、删除重指向与 fallback 记录、stageProgramFor 身份合成、只读判定、latest 排序、模块 store 注册/可见性/禁用开关）；E2E 场景 48（可见原位更新无新卡、notice 文案/点击聚焦、编辑以选中 revision、不可见晋升 + frozen hint、重挂载回最新、选旧版本只读、local revision 抑制与重挂载晋升），套件 566 → **599 checks**。
- **已知限制/风险**：M1 不做版本条/缩略图/持久化（M2）；抑制后的修订无整卡，图片/HTML 导出仍按既有语义（M3 对齐，已知回归风险，未改导出）；frozen 卡保留既有编辑入口；真实屏幕阅读器/coarse pointer 未单独验证。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **685/685** = Host **302** + Client **360** + packaging **23**；build host **841 kB**、client **4.08 MB**（js 3.86 / CSS 225.0） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **599 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,047,081** 字节，解包 **12,943,001** 字节 |
| 结构 | 新增记录中英对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — M2 最近任务式版本条 + 截图缩略图 + 切换动画

- **版本条**：stage 卡 history 图标改为打开横向「最近任务」浮层（portal 贴卡片、`role=dialog`/`listbox`、`data-dsh-iui-version-bar`）；旧 metadata 对话框降级为条内「详细列表」入口（恢复/删除不动），frozen 卡继续直接开详细列表。条目合并 Host history / local revisions / M1 store 已知 revisions，按 revision 降序取最近 20 条并提示剩余数量；每项含缩略图或占位、修订号、来源、时间、「当前」与待发送草稿标记；支持方向键/Home/End/Tab 循环、Enter 激活、Escape 关闭并归还焦点，`aria-selected` 标记当前项。
- **按需切换**：选中未知 program 的历史 revision 时用 `fetchArtifactHistoryProgram` 拉取并 `registerArtifactRevision` 注册，再 `selectArtifactRevision` 原位切换；不写 Host、不产生修订、不新增卡片；不可得时保持当前并提示。
- **缩略图（D5 双 scheme）**：新增 `artifact-thumbnails.ts`（key=artifactId+revisionId+scheme；内存 LRU 40 条/6MB + object URL 回收；IndexedDB v1 按 artifact 索引、上限与失败静默降级）；stage 显示 revision 后 SnapDOM 异步截当前 scheme（fonts+双帧+~420ms settle，~300px webp），随后用离屏 renderer 以**另一 scheme + 该 scheme 的 themeStyle** 再截一份入库；版本条打开时对前 8 个无图条目按两 scheme 各排一次（同一并发≤2、非当前 scheme 用自己 themeStyle）；读取优先当前 scheme，缺失才回退另一 scheme 并带 `data-thumb-scheme` 标注；删除修订两 scheme 一并清理并写 tombstone，飞行中采集不会写回。
- **FLIP**：`stage-flip.ts` 纯几何 `interpolateFlipRect`（单测）+ fixed 图片浮层 260ms 从条缩略图过渡到 stage `.dsh-iui-body`，stage 同步淡入；reduced-motion/无缩略图直接切换；浮层带 `data-dsh-iui-stage-flip` 且必定清理。
- **测试**：新增 `test/client/artifact-thumbnails.test.mjs`、`test/client/version-items.test.mjs` 共 20 条（LRU/字节上限、IDB 不可用降级、repo hydrate/loading/put/remove/clear、双 scheme 存取/回退/tombstone、条目合并/上限/current/draft/来源、FLIP 几何）；浏览器新增场景 49（版本条打开/当前/来源/draft、键盘与焦点归还、自动与懒缩略图、FLIP 浮层、切换无新卡与无 Host 写、reduced-motion、详细列表入口、stage-on 删除回退）与场景 50（D5：同一 revision light/dark 均 ready、切换页面 scheme 后各自使用本 scheme 图且另一份保留），套件 599 → **632 checks**；既有 1–47（stage off）与 48（M1）全过。
- **已知限制**：M2 不持久化选中版本（D6 仍回最新）；缩略图可能截到异步媒体占位（失败可重开条重试）；抑制卡无整卡时图片/HTML 导出对齐仍留 M3；版本条为非模态 dialog（Tab 在条内循环，点击外部关闭）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **705/705** = Host **302** + Client **380** + packaging **23**；build host **841 kB**、client **4.11 MB**（js 3.88 / CSS 230.8） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **632 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,056,334** 字节，解包 **12,984,362** 字节 |
| 结构 | 新增记录中英对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — M3 导出跟随当前显示版本 + branch/删除 E2E 收口

- **导出（D8）**：HTML 导出在 `programsFor` 后按 artifact 查询版本 store 选中 revision，用 `stageProgramFor` 合成 program/title/style 并保留原 callId；选中 revision 的 stage 卡在另一 Turn 时用 `assetElements` 从 stage 元素读取本地图片并按导出 callId 建桶。图片导出用纯规划器 `export-image-targets.ts` 按消息顺序解析 notice（`data-dsh-iui-artifact-id`）/卡片（`data-artifact-id`），优先跨 Turn 捕获 stage 卡（当前显示版本），找不到 stage 时退回本 Turn 整卡；notice-only 且无可捕获内容时明确报错，绝不导出旧内容；多 artifact 去重后逐个展开/等待 settled，`stackBoxes` 纵向合成；既有普通卡片路径保持 container 截图。
- **编辑/删除**：stage 显示 frozen 卡原生 revision 时 frozen 卡只读、stage 为唯一编辑面（同一 editKey 不双挂画布），可经版本条选旧 revision 后沿用冲突横幅→branch 流程（base=选中 revision、branch:true、无新增卡）。删除 stage 当前显示的 transcript revision 走既有 revision-fallbacks→forget，latest/selected 重指向 live revision，stage 不悬空、卡片数不变。
- **测试**：新增 `test/client/export-versions.test.mjs`、`test/client/export-image-targets.test.mjs` 共 9 条纯单测；artifact-edit 新增场景 51（stage 旧 revision branch）、52（stage 当前 transcript revision 删除回退）与 53（单卡 Turn 删除当前显示 revision：fallbackFrom 继承后回退卡只读、stage 不换卡），632→**655 checks**；review 修复另加 6 条 store/Set 身份/默认开关/资源合并单测（见下）；导出套件新增 D8 双路径场景（notice-only 图片导出捕获 stage 且内容为 SELECTED 非 RAW；HTML 嵌入选中 revision 而非旧记录）。既有 1–50 与导出场景全过。
- **Review 修复（2026-11-10）**：`stageProgramFor` 继承 `fallbackFrom`（单卡 stage 删除当前显示修订后回退卡只读）；gate 注册改为同一 cardId 的 update 路径（新增 `updateArtifactVersionCard`/`updateCardInState`，卸载才 unregister，stage 角色/可见性保持）；注册改 `useLayoutEffect`；版本条删除重复 import、`hasProgram=false` 条目禁用、pending 用 ref；selected revision ids Set 内容不变时保持身份；stage 选择器用 `CSS.escape`；HTML 导出 assetElements 与 container 两路本地图片合并；离屏懒采集补最小卡头与真实卡构图一致；新增生产默认 enabled 独立测试、双 scheme 缩略图 URL 不同断言。**真机复验补充（H1 残留）**：stage 显示从 Host history 拉取的 revision（卡片自身 program 是旧 revision）被删除时，store 在回退记录写 `redirectedFrom`、`stageProgramFor` 合成 `fallbackFrom`，回退 stage 保持只读；reducer 单测 + 场景 54 覆盖。**最后一个变体**：stage 显示 store 已知的 local revision 时，`renderedRevisionLocal` 仅对真 local 卡（callId===revisionId）为真、`locallyOwned` 要求对话框打开卡就是该 local 卡，删除当前显示 local revision 仍写 fallback 并保持只读；场景 55 覆盖，同时保留本地卡自身删除不写 fallback（场景 49 不回归）。**渲染 local 判定回归锁（场景 56）**：同一条 local revision 同时写入 localStorage（`localRevisionIds` 包含）且其 local 卡位于未渲染 Turn，stage 通过 store 显示它；mutation 验证旧公式 `program.localRevision === true` 时场景失败（缺 fallback/`redirectedFrom`），仅 `&& program.callId === program.revisionId` 通过。`redirectedFrom` 为 sticky 设计：target revision 再次被选中仍只读，恢复编辑需选其他 revision 或从 frozen 卡 branch。
- **已知限制**：导出只看当前 session 版本 store；多 artifact 以最大宽度+12px 纵向拼接（窄卡留透明侧边）；异步媒体/地图以 settled 信号为准；branch 语义未改，仅 stage 编辑面放开。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **722/722** = Host **302** + Client **397** + packaging **23**；build host **841 kB**、client **4.12 MB**（js 3.89 / CSS 230.8） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **699 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,058,652** 字节，解包 **12,991,046** 字节 |
| 结构 | M3 记录中英对应；`check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-09 — 区块编排批量操作（多选 + 批量顺序/复制/删除）

- **批量模式**：区块编排 section head 在「重置顺序」左侧新增「批量操作」切换（`data-dsh-iui-edit-batch-toggle`、`aria-pressed`、图标+文案）。激活后每行拖拽 grip 替换为可 Tab 聚焦的选择控件（Space/Enter 切换，点击行主体也可切换），逐行结构操作菜单隐藏、行 hover 卡片不弹出，选中行有 `is-batch-selected`/`data-batch-selected` 视觉态；Esc 退出批量模式并把焦点放回切换按钮，切换修订或关闭编辑器时选择自然清空。
- **批量工具栏**：已选数量（`role=status`）、全选/清除选择、上移/下移/置顶/置底、复制所选/删除所选、退出批量；无选择或无效果时按钮 disabled 且带 aria-label/title，选择超过 Host 单批上限 20 时结构操作禁用并提示；1180px 档 272px rail 下 section head 与工具栏换行、无水平溢出。
- **顺序语义**：置顶/置底保持所选块相对顺序；上移按下标升序、下移按降序处理，每个所选块只与未选邻居交换一格（不越过其他所选块）。只改当前草稿 `targetOrder`/`orderChanged` 并走既有持久化与 chip 同步，编辑请求编号与颜色不变。
- **批量结构操作**：复用 `POST /api/intelligent-ui/artifact-structure` 的批量 `operations`（上限 20），先 `preview: true` 在现有预览弹窗展示批量标题/操作标签/涉及区块列表/同一 diff，确认后一次真实批量 POST，只产生一条 `kind:'structure'` 本地修订并 `markSubmitted`。多个 duplicate 按页面降序发送、`toIndex = 原页内可编辑下标 + 1`，每份副本紧跟原块；Host 既有批量用例与新增 host 测试固定该顺序。所选块无法解析 nodeId/sourceDigest 或超过上限时在请求前报错、不发请求。
- **范围与限制**：v1 只作用于顶层 arrangement 列表（嵌套编排不变）；批量结构操作与内容编辑草稿不互斥；结构 duplicate 落在修订页序而非草稿顺序。
- **测试**：新增 `test/client/artifact-edit-batch-ops.test.mjs` 9 个用例（顺序语义、草稿不变性、批量 duplicate 的降序发送与 Host 实际应用位置、批量 delete 单请求单修订、20 上限、不可解析选择、取消预览、单块旧行为回归）；`test/host/artifact-structure.test.mjs` 新增多 duplicate 批量放置用例；浏览器 `artifact-edit` 新增批量场景（切换/选择/顺序/窄面板/批量预览/应用/单修订/Esc 焦点回归），519 → **564 checks**。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **638/638** = Host **303** + Client **314** + packaging **21**；build host **837.9 kB**、client **4.06 MB**（js 3.84 / CSS 226.6） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **564 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,035,842** 字节，解包 **12,905,416** 字节 |
| 结构 | 新增记录中英对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-09 — 嵌套区块编排批量操作与批量前草稿确认

- **嵌套批量模式（B1）**：嵌套编排 section head 在「重置嵌套顺序」左侧新增「批量操作」toggle（`data-dsh-iui-edit-nested-batch-toggle`、`aria-pressed`），与顶层批量模式互斥。进入后嵌套行 grip 替换为可 Tab 聚焦的选择控件（Space/Enter 或行体切换），逐行结构菜单隐藏、选中行有 `is-batch-selected` 视觉态；工具栏复用顶层批量样式（已选数量 `role=status`、全选/清除、上移/下移/置顶/置底、复制所选/删除所选、退出）。顺序操作按各自父容器独立应用（与顶层语义一致：置顶/置底保持组内相对顺序，上移升序、下移降序且只与未选邻居交换；无任何组可动时禁用）；Esc 退出并把焦点放回 toggle；切换修订或离开嵌套模式时清空选择。
- **嵌套批量结构操作**：复用 `POST /api/intelligent-ui/artifact-structure` 的 `operations[]`（≤20），一次 `preview:true` → 现有预览弹窗（批量标题/操作标签/涉及区块/同一 diff）→ 一次真实 apply → 只产生一条 `kind:'structure'` 本地修订。duplicate 按父容器分组，组内按 base 可编辑下标降序发送、`toIndex = base 可编辑下标 + 1`，跨父互不影响；容器与其嵌套块同时选中时在请求前禁用/拦截（`edit.batchNestedOverlap`），无法解析 nodeId/sourceDigest 或超限同样不发送请求。
- **批量前草稿确认（B2）**：草稿存在未发送内容（`hasArtifactEditContent`）时，批量结构预览显示「未发送内容会丢失」警告，确认按钮改为「丢弃草稿并应用」；草稿干净时保持原流程（「应用修改」）；单块结构操作流程与文案不变。
- **测试**：`test/client/artifact-edit-batch-ops.test.mjs` 新增 4 个用例（嵌套按父容器独立排序与未选组不变、嵌套 duplicate 分组降序并与真实 Host `applyStructureBatch` 落位一致、嵌套 delete 单请求单修订、重叠与不可解析选择预拦截）；浏览器 `artifact-edit` 新增 25d 嵌套批量场景（互斥、跨父独立排序、全选重叠禁用、脏草稿警告、批量 apply 单修订）、25b 干净/脏草稿预览与 25 单块无警告回归；套件 564 → **610 checks**。同时修正既有 input-orbit 几何断言的采样时序（等待 320ms 面板宽度动画稳定后仍断言精确 5px），消除长套件连跑时的偶发假失败。
- **范围与限制**：嵌套批量顺序只修改 pending `nestedOrder`/`nestedOrderChanged`；结构 duplicate 仍按修订页序而非草稿顺序；容器与后代不能同批，需分开选择；coarse 指针/真实屏幕阅读器仍未单独验证。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **642/642** = Host **303** + Client **318** + packaging **21**；build host **837.9 kB**、client **4.06 MB**（js 3.84 / CSS 227.6） |
| `npm run test:browser` | PASS；9/9 套件；`artifact-edit` **610 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,037,805** 字节，解包 **12,912,720** 字节 |
| 结构 | 新增记录中英对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — 合并两条功能分支到本地 main

本地 `main` 合并 `artifact-version-switcher`（快进）与 `artifact-batch-version-ui`（merge commit），并统一跑合并后门禁：

- **合并内容**：M1 活动舞台/可见性回落、M2 最近任务式版本条/截图缩略图/FLIP、M3 导出跟随当前显示版本 + branch/删除回退，以及顶层/嵌套区块编排批量操作（批量排序、批量复制/删除合并为一条修订、未发送草稿确认）。
- **冲突处理**：E2E input-orbit 稳定化取 main 的 settled-geometry 版本；`docs/plans/artifact-version-switcher/README.md` add/add 取较新的版本条方案；文档计数在本记录中同步为合并后实测值。两批改动只在客户端/测试/文档层交互，未新增 Host 路由或持久字段。
- **合并后 E2E**：`artifact-edit` **790 checks**，需求 1 的 25b/25c/25d 批量场景与需求 2 的 48–56 舞台/版本条/导出场景全部保留并同时通过。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm test` | PASS；Node **736/736** = Host **303** + Client **410** + packaging **23** |
| `npm run test:renderer` | PASS（CSS/组件/嵌套/排版/媒体等契约） |
| `npm run test:browser` | PASS；**9/9** 套件；`artifact-edit` **790 checks**、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,064,656** 字节，解包 **13,016,644** 字节 |
| 构建 | host 841 kB；client 4.14 MB（js 3.91 / css 236.1 kB）；standalone 3.35 MB + 523.0 kB |
| 结构 | 中英记录对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — 编辑流水线：结构操作队列、显式保存与总预览 Apply

- **用户问题**：在 Artifact 编辑面板填好整体说明与区块需求后执行批量/逐行结构操作，结构操作立即提交并关闭编辑器，草稿丢失。改为「先排队、再预览、最后一次性应用」。
- **新流程**：所有结构操作进入本轮待执行队列；批量模式内先记面板本地草稿，点「保存批量操作」才入队，取消/Esc 恢复顺序快照并清空草稿；逐行菜单 delete 保留两段确认后入队，duplicate/move 直接入队并 aria-live 播报。面板新增「本轮待执行」区（队列单条删除、已保存需求/新增、整体说明显式保存与状态、顺序状态）；整体说明改为显式「保存整体说明」；所有保存后 composer chip 与 dock 摘要立即更新，队列数量计入摘要。
- **总预览 Apply**：底部固定「应用」按钮（`data-dsh-iui-edit-apply`，无已保存内容时禁用），点击重新拉取 Host 权威 dry-run 并打开总预览对话框（结构操作、diff、涉及区块、模型摘要、冲突列表；loading/failed/ready；aria-modal + 焦点陷阱 + Escape + 焦点返回）。冲突（删除块仍被已保存需求/addition 引用、样式与结构混合、重复、容器重叠、超限、无法解析等）时 confirm 禁用并逐条说明，且不发送任何 Host 请求。
- **执行与重映射**：确认后一次原子 batch 生成一条 `kind:'structure'` 本地修订（确认过的总预览复用其 dry-run program 作为 Apply preflight，因此一次 Apply 只发一次 dry-run + 一次真实 batch），再把草稿 rekey 到新修订：`remap.ts` 先模拟 batch 后的兄弟顺序（delete 移除槽位、duplicate 副本紧跟源、move 追加到目标父），再与 Host 权威结果逐位对齐；副本槽位不参与映射（同签名副本不会抢走后续兄弟的已保存需求），容器块（Col/Row/Box/Grid/Card/Carousel）按类型+位置配对（其显示标题派生自首个子块），nestedOrder 把 batch 新建子块按 base 位置插入锚点（纯 duplicate 不会被误报为顺序改动）；selection/addition/targetOrder/nestedOrder 全部迁移，整体说明/样式/branch/strict/嵌套模式保留；新 chip 先建后删旧 chip，无悬空引用。任何 unmapped 需求/addition/嵌套子块或不可靠映射（如 duplicate+move 混合）在预览与 Apply 双重校验中阻止 Apply，绝不静默丢弃。剩余模型请求在 composer 为 plain 时自动 submit；输入框有用户正文或发送失败时保留 chip 并显示「模型请求在输入框，请手动发送」。
- **深层页面**：`MAX_CST_DEPTH` 从 4 提升到 **10**（root 为 depth 0；真实 dashboard 为 depth 5–6、83 个 CST 节点），客户端嵌套映射与 Host 结构路由共享该常量；`nestedBlocksForProgram` 不可用时回退到与 Host 同构的根级 block 表解析根级 delete/duplicate/move；超过支持深度/节点上限的页面给 `depth` 冲突（不再显示「已不在当前修订中」），嵌套 move 给 `nestedTarget` 冲突。
- **props**：Divider/Spacer 快捷属性成功后同样 rebase，不再提示丢弃草稿，已保存需求与队列保留；旧 B2「丢弃草稿并应用」警告随旧预览弹窗一并移除。
- **无障碍与 locale**：保存/入队/取消/Apply/自动发送均有 `aria-live` 播报；总预览对话框初始焦点在取消、Tab 焦点陷阱、Escape 关闭、关闭后焦点回到触发按钮；中英 key 完整；窄面板下批量工具栏、待执行行与 Apply bar 换行不溢出。
- **测试**：`remap.ts` 纯函数 15 条单测（副本排除、容器派生标题、nestedOrder 锚点插入、duplicate+move 不可靠）+ store 队列/预览/apply/rebase/chip rekey 与 20 上限拒绝单测 + 深层页面根级结构单测 + props 失败契约单测（mock 结构不一致 props 结果 → 本地修订已记录、旧草稿/chip 保留、`applyNotice='rebaseFailed'` 可关闭）+ 恢复的 batch-order 单测（6 条：up/down/top/bottom、只改 targetOrder/orderChanged、nested 按父独立、no-op）+ Host 路由深度用例（depth 6/83 节点根级 duplicate/delete 成功并记录修订；depth 11 被路由拒绝且无修订/账本）；E2E 迁移 25/25b/25c/25d/27/31/33/36 到新语义并新增 57–64（auto-submit、手动发送降级、刷新恢复 pendingOps、冲突阻止、depth-6/83 节点 dashboard 根级批量 Apply、超深页面 depth/nestedTarget 冲突、同签名 Text 副本不抢需求、第 21 条入队拒绝且不丢草稿）；artifact-edit 790 → **882 checks**。E2E 的 mock preview/apply 由真实 `applyStructureBatch`（Node bridge）生成，preview 与 apply program 与 Host 完全一致。
- **已知限制**：自动发送依赖 composer plain 阶段（busy/发送中降级手动），隔离真实 GUI 23 phase 已验证（含自动发送）；Turn 关闭仍由既有 `reconcileArtifactSubmissions` 确认提交，Host 冲突沿用既有冲突横幅；单次最多 20 条结构操作（第 21 条被拒绝并提示，不截断、不丢草稿）；同一父级不能混合操作种类；结构操作支持 CST 深度 ≤10、节点 ≤200，Host 结构路由对更深页面整体拒绝（含根级），客户端以 `depth` 冲突提前阻止；映射依赖显示身份，duplicate+move 混合或无法唯一对齐时阻止 Apply；props 修订已记录但草稿无法迁移时保留旧草稿/chip 并显示可关闭的 `rebaseFailed` notice；「移动到根级」仍受既有 Host move 校验限制（目标必须是可写容器）；编辑面板（中文）与 composer chip/dock（英文）在混合 locale 下语言可能不一致，属既有 chip locale seat 行为，非本特性引入；E2E 结构 mock 经本地 Node bridge 直接调用共享 `applyStructureBatch`，绕过 Host 路由鉴权/base registry/幂等账本（由 host 单测覆盖）；E2E 的异步 bridge 仍有少量时序等待，套件存在非零 flake 概率。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **765/765** = Host **305** + Client **437** + packaging **23**；build host **841 kB**、client **4.18 MB**（js 3.94 / CSS 242.6 kB） |
| `npm run typecheck` / `npm run test:renderer` | PASS |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**882 checks**（迁移场景 + 新增 57–64） |
| `npm run test:browser` | PASS；**9/9** 套件；`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,075,330** 字节，解包 **13,070,892** 字节 |
| 结构 | 中英记录对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — Phase A 复审修复：嵌套 Apply、队列阻塞发送、attached 保留、预览契约与诚实自动发送

- **背景**：两个全新上下文 reviewer 复审 `7f367f9..b62bd5a` 后给出 1 BLOCKER + 4 MAJOR + 若干 MINOR；本轮按根因修 Phase A 核心流水线，所有问题先用 `/tmp/iui-probe` 探针复现，再补单测/E2E。
- **嵌套 Apply（BLOCKER）**：`rebaseDraftAfterStructure` 按 `result.program` 重建嵌套 block 表与完整 nested order groups（所有父容器，含未变化组），再叠加重映射后的 pending order；仅当结果仍有嵌套块时保留 nestedMode，并新增「selection/additions 必须落在新 block 表」不变量，序列化因此始终带 `nodeId`/`parentBlockId`；嵌套模式、嵌套顺序与变更组进入 sessionStorage（selection 允许 `b1.2.1` 形状），reload 后仍可序列化。`probe-nested-rebase.mjs` 由 blocks 丢嵌套子块 / nestedOrder 丢失 / serialize `invalid` 变为嵌套表完整、nestedOrder 完整、envelope 带嵌套 nodeId。
- **普通 Send 不再静默丢队列（MAJOR）**：`serializeArtifactEditRequest` 在构建请求前检查 pendingOps，非空返回 `pending_apply`；chip Send 显示「请先应用队列」且不 markSubmitted、不删草稿。`probe-send-queue.mjs` 前后对照。
- **attached 语义与批次上限（MAJOR）**：rebase 保留 `oldSession.attached`，仅 attached 才 upsert chip / 自动发送，插入前按排除旧草稿的 attached 计数检查上限；`composerHasPlainText` 改为按 offset 移除全部 reference occurrence 后判断剩余正文，多 chip 分隔符不再算用户正文；detached 草稿给出独立 notice。`probe-detached-rebase.mjs` 由 attached=true 变为 false。
- **预览契约与诚实自动发送（MAJOR）**：从 serialize 抽出无副作用的 `buildModelRequest`，preview 与 apply 共用同一套本地校验；0 op preview 也产出 styleMixed/instruction/temporaryOrder/styleUnsupported/invalid/stale 冲突并禁用 confirm；applyRound 在 needSend 前做权威 revision probe；自动发送先 `checkArtifactEditSendable` 预检，且只在 send 路径确认草稿已被 codec 消费（`isArtifactEditSubmitted`）后返回成功，否则降级手动，不假报「已发送」。`probe-style-mixed-apply` / `probe-conflict-apply` 由 preview ready/apply needSend 变为 preview 冲突/apply error。
- **MINOR**：预览 loading 取消用 generation token 丢弃晚到响应（`probe-cancel-preview`）；面板本地状态与 popover 未保存说明纳入统一 dirty 守卫；节点预算与层级过深分别报 `nodeLimit`/`depth`（210 个根 Text 的浅页面不再误报 depth，文案与文档同步）；post-Apply notice 移到聊天级 draft dock，单卡/舞台场景可见。
- **验证**：Node **779/779**（Host **305**、Client **451**、packaging **23**；新增 14 条 Phase A 回归）；`artifact-edit` E2E **909 checks**（新增 65–68：嵌套 Apply 保留嵌套草稿、队列阻塞普通 Send、detached 草稿不重插 chip/不自动发送、0-op 预览 stale 冲突禁用 confirm；场景 57/63 改为断言真实发送文本），连跑 2 次稳定；`npm run test:browser` 9/9（`nested-edit-renderer` 75）；pack **65** files **6,077,725** / **13,083,208** 字节；docs-facts 与 `git diff --check` 通过。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **779/779** = Host **305** + Client **451** + packaging **23**；build host **841 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB） |
| `npm run typecheck` / `npm run test:renderer` | PASS |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**909 checks**（连跑 2 次） |
| `npm run test:browser` | PASS；**9/9** 套件；`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,077,725** 字节，解包 **13,083,208** 字节 |
| 结构 | 中英记录对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — Phase B 复审修复：删除回退选择/只读恢复、导出具体错误、版本来源、文档与 E2E 稳定性

- **背景**：Phase A 之后，另一组 reviewer 复审当前树，报告 1 MAJOR（删除 stage 当前显示修订时回退选择与文案不一致、且 stage 卡自身拥有被删修订时可能永久只读）+ 若干 MINOR（图片导出具体错误被吞、版本条 props 来源标签、当前态文档仍写旧流水线语义、E2E 二次跑 flake、图片断言 66、test/browser README 旧计数、bridge 声明过度、20 上限双实现、check-doc-facts 只做数字片段匹配、architecture 旧 API 当现状）。本轮按根因修复。
- **删除回退（MAJOR-4）**：`forgetRevisionInState` 删除记录后，若被删的正是 selected revision，selected 指向确认文案里的回退目标（不再无声跳到 latest）；`stageProgramFor` 只在 stage 实际显示回退目标时合成 `fallbackFrom`（卡片级标记只属于它回退到的 revision，记录级标记只属于 fallback target 记录），选其他 revision 不再带 readonly 标记、编辑入口恢复。`/tmp/iui-probe-wt` 的 `probe-forget-selection` / `probe-stage-readonly2` 复现路径由「selected r5 + fallbackFrom r2 + stage readOnly」变为「selected r1 + 回退目标显示只读 + 选其他版可编辑」。
- **图片导出**：`ExportAction` 捕获 `NO_CAPTURABLE_STAGE_MESSAGE` 时显示本地化具体原因（zh/en `export.state.noticeOnly`），触发按钮 title 与 `data-status` 同步，而不是通用「导出失败，请重试」；notice-only 无 stage 的场景不会下载任何文件。导出 E2E 新增断言。
- **版本来源**：`version-items.ts` 合并时 client-local `props`/`style` kind 覆盖 Host 通用 structure 标签（props 快捷调整在 Host 侧记为 `struct_` 结构修订，原先会显示 structure 甚至 style switch），known 记录路径同样生效；新增 2 条单测。
- **常量统一**：`remap.ts` 的客户端队列上限改为复用 shared `MAX_ARTIFACT_STRUCTURE_OPERATIONS`（单一实现），新增相等性与 20/21 边界单测。
- **E2E 稳定性**：批量取消后的 chip label 负向断言改为 `wait`（不再采样单次渲染），连续跑 3 次通过；新增场景 69「选旧版 → 删除 → stage 落在回退目标且只读 → 选另一版恢复编辑入口」。
- **文档**：`docs/limitations.md/.en` 删除「结构操作直接关闭草稿（markSubmitted）」旧语义，改为「入队 → 保存 → 总预览 Apply；纯结构 Apply 记录修订后关闭，混合 Apply 保留 rebase 草稿并自动发送/手动兜底；排队/取消不丢」；README 中英、usage 中英、architecture 中英同步；删除修订后的选中/只读/恢复语义写入 limitations/usage/architecture。README 图片断言 66 → 76；`test/browser/README.md` 更新当前 stage/版本条/流水线覆盖与 920 checks；architecture 把已删除的单操作结构 API 标为历史并限定 bridge 声明范围；`check-doc-facts.mjs` 改为上下文数字匹配（Host/Client 不可互换）+ 旧文案/浏览器 README/图片计数守卫，并新增 9 条失败用例单测。
- **测试**：Node +15（artifact-version +3、version-items +2、artifact-edit-remap +1、doc-facts-guard +9）；`artifact-edit` E2E 909 → **920 checks**；图片导出 72 → **76** 条断言。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **794/794** = Host **305** + Client **457** + packaging **32**；build host **841 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB） |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**920 checks**，连续 2 次通过 |
| `npm run test:browser` | PASS；**9/9** 套件；图片导出 76 条断言、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,078,909** 字节，解包 **13,086,153** 字节 |
| 结构 | 中英记录对应；`npm run check:docs-facts` 通过；`git diff --check` 通过 |

## 2026-11-10 — 最终复审收尾：0-op 预览陈旧检测、事实数字与文档修正

- **N1（复审发现）**：新增 doc-facts 失败用例后 Node 实际 **796/796**（Host **305**、Client **458**、packaging **33**），pack **6,079,046** / **13,086,574** 字节；本轮把 current-facts 与 README/architecture/CHANGELOG/verification 同步为最终实测值。
- **N2（0-op 预览陈旧竞争）**：`previewPendingStructureOps` 在没有排队结构操作时现在会先做只读 revision probe，把 store 尚未观测到的 head 前移折叠为 `stale` 冲突并禁用 confirm；新增单测锁住「只在预览时才前进」的路径。
- **N3（已知限制，非本轮引入）**：`additions`（模型新增区块）尚未进入 `PersistedDraft`，reload 后不会恢复；同会话内 Apply 重映射/序列化正常，已在 architecture 已知限制记录。
- N4：回退目标的 sticky 只读语义按文档保留（选另一修订恢复编辑）。
- N5：E2E 结构 mock 的 chip 断言已按当前草稿的 `data-chip-ref` 限定（harness `__activeDraftReference()`），负向断言不再受其他遗留 chip 影响；早期单 chip 场景仍使用 `chipLabel()`。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **796/796** = Host **305** + Client **458** + packaging **33**；build host **841 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB） |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**920 checks**，连续 2 次通过 |
| `npm run test:browser` | PASS；**9/9** 套件；图片导出 76 条断言、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,079,046** 字节，解包 **13,086,574** 字节 |

## 2026-11-10 — 最终门禁假绿、0-op probe 竞态与文档收尾

- **doc-facts 假绿（工具/文档）**：CLI 曾把 `current-facts.json` 不一致从失败列表中过滤掉，`verifyFacts` 又在校验前 early-return，导致事实快照错误时仍打印 ok。CLI 不再过滤该失败；新增临时根目录的 CLI 级回归测试，事实快照不一致时 `checkDocFacts` 必须返回失败。
- **N2 竞态**：关闭编辑器时现在会 bump preview generation，晚到的 probe 响应不再写回并重开弹窗；零 op 预览在 probe 期间若出现新的待执行队列，会重新进入结构预览路径，不再把 `ops: [] / structureReady: true` 泄漏给确认按钮。两个竞态各有单测。
- **N5 修正**：E2E chip 断言已按当前草稿的 `data-chip-ref` 限定（harness `__activeDraftReference()`），负向断言不再 vacuous；上一轮记录中的 N5 描述已更正。
- **N3**：`additions` 未持久化写入 architecture 的已知缺口条目（既有缺口，非本轮引入）。
- 最终实测：Node **799/799**（Host **305**、Client **460**、packaging **34**）；`artifact-edit` **920 checks**；图片导出 76；`test:browser` 9/9；pack **65** 文件 **6,079,092** / **13,086,611** 字节；构建 host **841 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **799/799** = Host **305** + Client **460** + packaging **34** |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**920 checks**，连续 2 次通过 |
| `npm run test:browser` | PASS；**9/9** 套件；图片导出 76 条断言、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,079,092** 字节，解包 **13,086,611** 字节 |

## 2026-11-10 — Closeout 竞态、CLI 覆盖与最终数字

- **空草稿关闭→重开竞态（复审 MAJOR）**：preview generation 计数不再随 draft 删除而清零（discard/close/rebase/submit 改为只递增、不 delete），空草稿关闭后同一 key 重开并启动新 preview 时，旧 probe 的 generation 必然过期；扩展关闭竞态单测：旧 probe 晚到后不得清除重开 session 的 conflict，也不得替换新 preview。
- **CLI 测试覆盖（复审 MINOR）**：抽出可测试的 `runCli(root, io)`（包含退出码与 stderr），doc-facts-guard 的临时根目录测试现在真正执行 CLI 入口并断言 exit 1 与 `docs/current-facts.json` 失败文案；Host/Client 互换分隔符补上 `/`、`|`。
- 最终实测：Node **799/799**（Host **305**、Client **460**、packaging **34**）；`artifact-edit` **920 checks**；图片导出 76；`test:browser` 9/9；pack **65** 文件 **6,079,141** / **13,086,571** 字节；构建 host **841 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB）。

### 自动化结果

| 命令 / 检查 | 本轮结果 |
| --- | --- |
| `npm run check` | PASS；Node **799/799** = Host **305** + Client **460** + packaging **34** |
| `node test/browser/artifact-edit.e2e.mjs` | PASS；**920 checks**，连续 2 次通过 |
| `npm run test:browser` | PASS；**9/9** 套件；图片导出 76 条断言、`nested-edit-renderer` 75 |
| `npm run pack:check` | PASS；**65** 个文件，压缩 **6,079,141** 字节，解包 **13,086,571** 字节 |

## 2026-11-11 — Auto 智能格式决策：是否出页面、Card/Article/自由布局

- **策略**：开启会话不再默认「出页面」。模型先按回答判断是否需要页面：有结构、可视化、交互或计算价值时渲染，否则直接用 Markdown；会话样式（Card/Article/Auto）只决定出页面时的版式。`Auto` 可直接选择自由布局（`style: "free"`，无 `styleId`/`temporaryStyle`；Host 记为 `styleSource: "builtin"`，客户端按内置自由版式回放）；强制 Card/Article 会话仍拒绝 `free`。显式渲染请求（`/intelligent-ui`、明确要页面/看板）、按需生成、待处理编辑请求与自然语言样式编辑仍必须出页面。
- **实现**：决策策略单点维护在生成的提示词前置段（`scripts/generate-prompt.mjs` → `src/generated/prompt.txt`）和运行时前缀（普通轮 / 按需轮两种）；`STYLE_NOTES` 三种样式、`customStyleNote`、`render_ui` 工具描述与 `style` 参数说明、嵌入 Agent Skill 与 integration 参考同步；composer Auto 提示与设置页说明改为「模型决定页面或纯文本」。Host 在 Auto 会话接受 free 渲染，客户端 `programFromArgs` 允许该回放形态。
- **测试**：更新 guardrails 策略断言、Host auto 样式/free 布局用例、客户端 free 无身份回放用例与旧错误文案；新增 Host「Auto 接受 free 且强制样式仍拒绝」用例。
- **实测门禁**：`npm run check` PASS；Node **800/800** = Host **306** + Client **460** + packaging **34**；`npm run test:browser` **9/9** 套件，`artifact-edit` **920 checks**、`nested-edit-renderer` **75**、图片导出 **76** 条断言；`npm run pack:check` **65** 文件，压缩 **6,080,680** 字节，解包 **13,090,208** 字节；构建 host **842 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB）；`npm run check:docs-facts` 与 `git diff --check` 通过。
- **证据边界**：本轮没有调用真实模型，无法验证模型在新策略下是否稳定地「该出页面时出、该回文字时回」；判断属模型判断，同一问题可能一次出页面、一次回文字。自由布局结果没有主题快照，不能保存为模板，编辑器样式切换的内置目标仍只有 Card/Article。

## 2026-11-11 — 独立复审修复：文档一致性、Skill/troubleshooting、回放守卫与提示词边界

- **复审方式**：两个只读 subagent 分别按 Standards / Spec 两轴审查未提交改动（`git diff HEAD`，23 文件）；无 BLOCKER。本轮修复其 MAJOR/MINOR/NIT 发现。
- **文档**：README 的旧「有结构的回答默认用卡片」与 `docs/development.md` 的旧策略描述改为与已生效规则一致；README/architecture 的门禁行改为「当前工作区验证（未提交）」；architecture/limitations 的自由布局与显式请求措辞与模型侧契约对齐。
- **提示词**：静态提示词的 session-note 句覆盖按需轮；显式要求页面/看板/卡片/UI 明确为直接指令；`ARTIFACT_EDIT_NOTE` 声明待处理编辑请求覆盖普通页面/文字决策；各样式注记不再重复回退句（决策只由运行时前缀维护）。
- **Skill / 设置文案**：free 建议覆盖 Auto-chosen；troubleshooting 补 Auto-free 路径；「自由布局」开关文案改为「布局规范是否降级为建议」，并明确 Auto free 不受该开关限制。
- **客户端回放**：free 无 `styleId`/`temporaryStyle` 仅在实时调用或记录 meta `styleSource: "builtin"` 时渲染；模板结果缺失/畸形 styleId 重新丢弃。测试同步收窄。
- **测试**：新增普通/按需前缀、编辑请求覆盖与回放守卫断言（用例数不变）。
- **实测门禁**：Node **800/800** = Host **306** + Client **460** + packaging **34**；浏览器 **9/9** 套件，`artifact-edit` **920 checks**、`nested-edit-renderer` **75**、图片导出 **76** 条断言；`npm run pack:check` **65** 文件，压缩 **6,080,849** 字节，解包 **13,090,697** 字节；构建 host **842 kB**、client **4.19 MB**（js 3.95 / CSS 242.8 kB）；`npm run check:docs-facts` 与 `git diff --check` 通过。
- **证据边界**：仍无真实模型调用；复审 subagent 为只读（未运行 build/browser），门禁由实现侧重跑。自由布局开关采用「不改 Auto free 语义、只改文案」的处理，未新增 gate。

## 2026-11-11 — 实验性「回答即文档」模式（documentMode）

- **行为**：插件详情页「实验性功能」新增「回答即文档（实验）」开关（Host volatile 字段 `documentMode`，默认关闭）。开启后，普通回答（非按需结果、非 Artifact 编辑、非保存模板）的提示词改用文档契约：整篇内容写进一个 `render_ui` program、`style: "free"`、不写 Markdown 正文；Host 强制 free 并忽略会话模板，成功值与 `presentationMeta` 记录 `document: true` 与 `styleSource: "builtin"`；客户端把该结果渲染为无卡片外壳的 `section.dsh-iui-document`（无标题栏、折叠、边框与卡片操作，也没有编辑入口/修订历史）。按需结果、保存模板与编辑请求仍按卡片渲染；开关只影响之后的回答，已记录的结果按记录回放。
- **回放修复**：普通 `render_ui` 结果现在总在 `presentationMeta` 记录 `style`/`styleSource`，修复 Auto 自由布局结果在落定/重放时因缺少样式身份被丢弃的问题；`document` 走同一 meta 通道，由客户端 `programFromArgs` 读取。
- **测试**：Host +3（文档提示词契约、文档模式强制 free 且拒绝 card/styleId、普通结果 meta）；Client +1（document meta 回放），设置页 SSR 断言新增实验开关（共 4 个开关）；`style-theme` 浏览器套件新增一条记录型文档答案（无 header、程序仍挂载、普通卡片保持 header）。
- **实测门禁**：`npm run check` PASS；Node **804/804** = Host **309** + Client **461** + packaging **34**；`npm run test:browser` **9/9** 套件，`artifact-edit` **920 checks**、`nested-edit-renderer` **75**、图片导出 **76** 条断言；`npm run pack:check` **65** 文件，压缩 **6,118,669** 字节，解包 **13,140,084** 字节；构建 host **845 kB**、client **4.19 MB**（js 3.95 / CSS 243.1 kB）；`npm run check:docs-facts` 与 `git diff --check` 通过。
- **证据边界**：未调用真实模型，因此文档模式的模型侧行为（是否严格不写正文、是否稳定用一个 program 承载整篇）未在真实会话验证；浏览器证据是组件级 harness（真实 turn-tail 组件 + 记录参数回放），不是完整 DSH Web 会话；文档模式没有卡片编辑入口与修订历史，复制、搜索、会话导出 Markdown 不包含页面正文，且只有 Web 渲染器显示。真实 GUI 手工点验待真机确认。

## 2026-11-12 — 复审修复：价值判据优先级、发布检查全量 manifest、安装器空文档

- **背景**：两个独立只读 reviewer 按 Standards / Spec 两轴复审 `aa50e7e..82aebe4`（Standards：2 MAJOR + 3 MINOR + NIT；Spec：2 MAJOR + 3 MINOR；两轴的 privacy/hygiene 均 PASS）。本轮按全局 AGENTS.md 的“先命名原因，再根因修复”原则处理，不打补丁。
- **修复**：prompt、runtime prefix 与 `render_ui` 工具描述统一为「Auto 无默认；两者都像适用时看种类：裸事实/术语复述留给文字，解释“怎么运作”即使文字版本很短也出页面」，README 与 architecture 同步；技能保持单一策略指针，`whenToUse` 只排除裸事实与术语复述，措辞 marker 抽到 `scripts/skill-policy-markers.mjs` 由 guardrail 与发布检查共用；host 单测补 prefix/tool-description 断言；`scripts/install.mjs` 识别模板的空数组文档 `[]`（安装时替换、卸载且无其它条目时写回，保留注释头），新增 `test/packaging/install-script.test.mjs`；`scripts/release-check.mjs` 改为解包全量 manifest：每个打包路径必须存在于 checkout，`lib/`、`skills/`、`locale/` 与 bundle patch 全量哈希一致；安装后的文件集合与哈希必须与 tarball 逐字节一致；失败保留临时目录、命令带超时、token 响应重试到 303、日志脱敏；文档补 pnpm 依赖与 `npm pack` 会写 ignored `lib/` 的事实，并删除示例中已不存在的 legacy `exportToAssistant`。
- **实测门禁**：`npm run check` PASS；Node **807/807** = Host **309** + Client **461** + packaging **37**；`npm run test:browser` **9/9** 套件，`artifact-edit` **920 checks**、`nested-edit-renderer` **75**、图片导出 **76** 条断言；`npm run pack:check` **65** 文件，压缩 **6,119,898** 字节，解包 **13,143,100** 字节；构建 host **846 kB**、client **4.19 MB**（js 3.95 / CSS 243.1 kB）；`npm run check:release` PASS（解包、安装、挂载、served bundle、卸载全过）；`npm run check:docs-facts` 与 `git diff --check` 通过。
- **证据边界**：本轮未重新调用真实模型，也未重跑浏览器套件与真机 GUI；reviewer 判定基于代码/静态命令与 /tmp 复现，前一轮的真机记录仍是最近的 GUI 证据。release-check 的隔离 Web 实例只验证挂载与服务端 client bundle，不渲染页面。

## 2026-11-12 — composer 应用结果条布局修复（Apply notice 不再覆盖输入区）

- **症状**：结构编辑点 Apply 后，输入框上方的「编辑应用结果」提示条（`aria-label` = 编辑应用结果）压住 composer 卡片第一行文字——提示文本与占位符重叠，提示条边框横穿输入区，用户截图确认布局损坏。
- **根因**：DSH 的 `conversation.input.overlay` slot 锚点 `[data-composer-overlay]` 是 `position: absolute; height: 0` 的浮层；扩展此前只给草稿行（`.dsh-iui-draft-dock`）写了 `:has()` 回到文档流的规则。Apply 消费草稿后 notice 条成为锚点唯一子元素，锚点仍是绝对定位，notice 条仍沿用「卡片外」的宽度/外边距，于是覆盖在输入区上。
- **修复**：post-Apply notice 条改为与草稿行共用 composer 卡片顶部 band：`:has()` 规则对 `.dsh-iui-draft-dock-notices` 同样生效；notice 条的 `-8px` 顶边距经 DSH 的 `display: contents` slot outlet 落到卡片 padding 上（不能依赖直接子元素/`:first-child` 选择器），左右 12px 内缩，单独存在时以同一内缩的分隔线收尾；其上已有 armed 的 on-demand hint 时不越过 hint；其后有草稿行时不再重复取消 padding，草稿行保留自身 12px 节奏与收尾分隔线，notice-only 与 notice+draft 两种状态都不重叠。
- **测试**：`artifact-edit` E2E 的 harness composer 现在镜像真实 DSH composer（绝对定位 overlay 锚点、`display: contents` slot outlet、前置的隐藏 slot 条目、flex 列 + 12px gap；此前 harness 缺这些，正是漏测原因），并锁定两种状态：overlay 计算样式 `position: relative`、band 有正高度、notice 条从卡片顶边起排（12–14px，而不是压在卡片 padding 上）、notice 条在卡片内、notice 底边在草稿行之上、notice 栈在保留的草稿行上方、草稿行不再二次取消 padding；套件 920 → **931 checks**（修复后连续两次通过）。
- **复审修复**：独立 reviewer 发现「直接子元素 `:first-child`」在真实 DSH DOM 里因 `display: contents` slot outlet 永不匹配（notice 会低 8px、卡片高 8px），且 pack 字节与记录差 4 字节；本轮改为 band 自带 `-8px` 顶边距 + on-demand hint 兄弟覆盖，harness 同步真实 DOM 拓扑并新增顶边距断言（对旧 CSS 实测失败），pack 字节按实测更新。
- **视觉重设计**：原提示是 band 内一整条带边框、填充、圆角的 alert 卡片，文字 11px、关闭是蓝色下划线链接，像一张贴进输入框的内容卡（PRODUCT.md 明确把这种 chrome 列为反例）。现改为 band 内的静默状态行：6px 状态点（success 中性、manual/extraText/detached 用 warn、rebaseFailed 用 error）、12/18 的次要色句子、ghost 关闭按钮（hover 才有 surface，120ms 颜色过渡，与编辑器其余 chrome 一致），与 textarea 之间只保留 band 原有的 hairline；不再有边框、填充或强调色链接。失败文案保持 primary label 墨色而非 error token（error token 在 composer 表面上略低于 WCAG AA：亮 4.50:1 / 暗 4.24:1），由红点与明确失败句承担状态；正文对比度按真实 DSH token 为亮 5.80:1 / 暗 9.25:1。E2E 场景 57/58 额外采集明暗两套截图（`harness-apply-notice-dark.png`、`harness-apply-notice-and-dock-dark.png`），检查数不变（931）。
- **实测门禁**：`npm run check` PASS；Node **807/807** = Host **309** + Client **461** + packaging **37**；浏览器 **9/9** 套件，`artifact-edit` **931 checks**、`nested-edit-renderer` **75**、图片导出 **76** 条断言；`npm run pack:check` **65** 文件，压缩 **6,120,004** 字节，解包 **13,144,621** 字节；构建 host **846 kB**、client **4.19 MB**（js 3.95 / CSS 244.5 kB）；`npm run check:docs-facts` 与 `git diff --check` 通过。
- **证据边界**：本机 GUI 由运行中的 DSH Web 服务托管，重启会中断当前会话，因此构建后未由代理重启服务；刷新/重启后的真机最终目视由用户侧确认。浏览器证据是组件级 harness（真实 composer 卡片与 overlay 锚点 CSS），不是完整 DSH Web 会话。
