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
- **Style panel 浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 先用无头 Chrome + CDP 加载 `test/browser/harness` 的 `ToggleControl`，验证 chip → menu（无「全部会话」、含「显示样式」）→ 仅本会话 → 样式面板，以及面板内返回按钮回到作用域菜单而不是关闭全部浮层、返回后焦点落在「显示样式」行；菜单宽度按内容且不小于 208px、右缘与 chip 对齐、统一最小行高与间距、分割线内缩、展开时 chevron 旋转 180°；关闭开关后「显示样式」仍显示但为 disabled，点击不能打开面板；面板矩形完全在视口内，焦点进入面板；拖动真实滑杆到 Article 后发出 `style:article`；Escape 关闭后焦点回到 chip。该测试不启动完整 DSH Web，也不替代 Host/Client 集成 E2E。
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
- 已验证的 DSH 版本：**0.2.1-rc.2**（`dsh --version`）。更晚的版本未验证。
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
| `npm run pack:check` | PASS；43 个文件；tarball **4,036,061 字节**（4.04 MB），解包 **10,216,623 字节**（10.22 MB） |
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
