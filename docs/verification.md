# 验证记录

中文 | [English](verification.en.md)

[← 返回 README](../README.md)

以下为一次历史验证记录；其中的测试数量与打包大小按最近一次 `npm run check` / `npm pack` 输出更新。

在隔离的第二个 DSH Web 实例（3081 端口，同一 profile + patch overlay）上做过端到端验证：

- 模型按提示词调用 `render_ui`，生成 31–117 条语句的页面；非法程序被 Host 拒绝并给出精确字段错误，模型在同一轮内自修成功。
- 组件总览页、旧金山行程、咖啡计算器、SVG 折纸教程均正常渲染；照片（Wikipedia/Wikimedia）、MapLibre 地图 + pin、图表、表单、计时器、翻转卡、撒花、HtmlView 动画可用。
- 交互：勾选时间线计数更新、SegmentedControl 联动、表单与按钮状态正常；暗色主题自动切换。
- 响应式：390 / 546 / 768 / 1092 px 下无横向溢出（补齐了组件库依赖的 `box-sizing` 作用域 reset）。
- 测试：`npm run check` 全绿——Host 27（含全局启用/样式、会话开关与样式覆盖、跨标签广播、投影/命令/工具 style 校验与 Article 结构校验、设置页与提示词样式注入、交互页面资产路由、布局/间距告警）、Client 52（含档位控件/样式面板与滑杆、双语字典、设置页全局启用/样式/图片导出设置、程序 style 解析、跨标签广播、导出消息/Turn 查找、图片美化/阴影留白几何与单文件页面组装）、打包清单 19（含组件/函数目录、57 组件计数、SKILL.md 计数、双语 README 链接、CHANGELOG 与截图一致性、prompt/Skill 的只读 checkout 护栏、布局/间距契约护栏、Article/Section/Toc 文档护栏，以及“开启会话默认出卡片 / 显式调用是直接指令”的决策策略护栏）、渲染器解析 41/41、SSR 41/41、i18n 渲染检查 4 组（zh + en fallback）、排版检查 22/22（货币符号字距、CJK 字距、卡片内标题比例尺、窄屏换行与图表标签）；`npm pack` 产物约 3.70 MB / 40 个文件（解包 9.78 MB）；README 截图已更新为 57 组件一览、示例、输入框开关/样式面板与插件设置页（WebP + PNG）。
- **Agent Skill 端到端**：在真实 DSH 会话里模型调用 `skill { name: "intelligent-ui" }` 成功加载 `<skill_content>`（15 KB 正文 + references 基目录提示），随后按技能用 `render_ui` 生成并渲染了验证页。
- **bundle 安装链路**：用 `npm pack` 产物在一次性 profile（`~/.dsh/profiles/zbundle-test`，依赖 `file:/tmp/…tgz` + `dsh.profile.bundles`）里安装，`dsh --profile zbundle-test --dump-config` 退出 0，输出出现 `# == @zephinel/dsh-intelligent-ui` 与插入行 `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'`（验证后已清理）。
- **三档开关端到端（0.2.1 时代记录）**：默认「关闭」请求里没有 `render_ui`、提示词为空；选「仅本会话」后本会话请求带工具与提示词并渲染出卡片，而新开会话仍是关闭；选「全部会话」后新开会话直接带工具与提示词；选「关闭」后文件清空、新会话再次无工具无提示词；两个标签页之间控件状态通过 BroadcastChannel 同步；状态文件 `{ "global": false, "sessions": [] }` 与投影行为符合预期。0.3 的会话开关/样式覆盖与 Article 页面尚待实机验证。
- **Style panel 浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 先用无头 Chrome + CDP 加载 `test/browser/harness` 的 `ToggleControl`，验证 chip → menu（无「全部会话」、含「显示样式」）→ 仅本会话 → 样式面板，以及面板内返回按钮回到作用域菜单而不是关闭全部浮层、返回后焦点落在「显示样式」行；菜单宽度按内容且不小于 208px、右缘与 chip 对齐、统一最小行高与间距、分割线内缩、展开时 chevron 旋转 180°；关闭开关后「显示样式」仍显示但为 disabled，点击不能打开面板；面板矩形完全在视口内，焦点进入面板；拖动真实滑杆到 Article 后发出 `style:article`；Escape 关闭后焦点回到 chip。该测试不启动完整 DSH Web，也不替代 Host/Client 集成 E2E。
- **图片导出浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 随后加载 `test/browser/harness/export-entry.tsx`：真实 `ExportAction` + 真实渲染器卡片 + 两个入口（其中一个的 Chat selector 经结构化快照运行真实的 `messageHasRenderUi` 并报告无渲染输出），卡片里是真实的 `SearchImage`，其 Wikipedia 查询由 harness stub 到本地 SVG。断言只有扩展回答出现导出药丸按钮（带可见「导出」文案、`order:1`、贴齐操作栏右缘）；导出菜单右缘与按钮对齐、宽度按内容，上方空间不足时翻到按钮下方，并在触发 scroll 后立即关闭；打开菜单依次导「原始」「卡片」和「圆角 2x」：卡片初始为折叠态，截图时已展开、完成后退回折叠；3D 翻面已展平为可见面、过渡/动画已冻结、lazy 图片改为 eager 且完成加载；harness 用带同样就绪属性的假地图验证导出会等待 resize 后的地图就绪；card 帧尺寸比 raw 多出两侧 padding + 阴影留白且底部留白能采到非零阴影像素，圆角 2x 帧尺寸为 raw 的 2 倍再加 2x padding。该测试不启动完整 DSH Web；跨域 Wikimedia 图片的抓取另用同一 session 程序手工复现（见下一条）。
- **交互页面浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 的第三个脚本把真实的 `lib/standalone.js` / `lib/standalone.css`、当前主题快照与两张卡片程序交给 `buildStandaloneHtml` 生成单文件 HTML，直接在无头 Chrome 中打开该文件：断言页面没有外部 script/stylesheet 引用、体积 ≥3.4 MB、两张卡片的正文都挂载且没有标题栏/折叠控件、内联主题改变页面背景，并点击一个 `@ToAssistant` 按钮确认页面复制兜底会弹出提示而不调用 DSH；随后打开关闭「保留追问操作」的同一页面，断言卡片正文仍在但追问控件被移除。该测试不启动 DSH Web。
- **Article 间距浏览器 E2E（组件级，可复跑）**：第四个 `npm run test:browser` 脚本渲染一个 Article fixture，断言每个 `Section` 正文是独立 flow、正文块间距为 16px（标题到后续块 12px）且不再贴在一起；同时断言页面级 flow 没有额外的 18px flex gap，section 间距保持单一级距（约 24px）而不是双倍留白。
- **导出追问开关**：Plugin 详情页 **导出** 分组新增「保留追问操作」开关（Host volatile `exportToAssistant`，默认开启）；关闭后 Standalone 页面通过 `ToAssistantHiddenContext` 隐藏只包含 `@ToAssistant` 的 Button/IconButton/Pressable，并禁用复制回调。Settings SSR 与 standalone-page E2E 覆盖。
- **布局/间距契约**：生成提示词与 Agent Skill 增加布局与间距条目；Host `layoutWarnings` 对根 `gap`、纵向 `Spacer()`、空 `Section`/`Text`、`gap: 0` 块栈返回非致命 warning（Host 单测覆盖）；Article 的 Section 正文改为嵌套 flow、页面根不再叠加 flex gap，article-layout E2E 用实测间距（16/16/12/16px，section 约 24px）护栏。
- **图片导出（2026-10-22，组件级 + 浏览器实验）**：底部导出入口与图片导出已实现并构建通过。用无头 Chrome + CDP 在临时 harness（真实 `ExportAction` + 真实渲染器卡片）上验证：导出按钮只在记录过 `render_ui` 的消息出现；菜单含原始 / 圆角 / 卡片；折叠卡片在截取时展开、完成后恢复；2x 圆角美化输出 1616×2348 PNG、背景色生效、文件名带标题与本地时间。MapLibre 截图实验：默认 `preserveDrawingBuffer: false` 时 canvas `toDataURL` 为空白（约 9 KB），开启 `canvasContextAttributes.preserveDrawingBuffer` 后为完整地图（约 449 KB），`render` 事件内抓帧同样可行。该验证不启动完整 DSH Web；重启 DSH Web 后的真实会话人工点验尚未进行。随后用会话 `c3a17e93-b553-4f6f-8734-3997fa02a751` 的历史程序复现并修复了真实导出中发现的两个缺陷：翻卡片 3D 双面重叠（截图中文字重叠）与图片搜索/加载未完成导致的空图片框；修复后的翻卡片展平与图片落定路径由 `npm run test:browser` 的 `export-image` E2E 覆盖（图片搜索用本地 stub、跨域 Wikimedia 抓取另行手工复现）；同一 E2E 也用尺寸与像素质检覆盖 card 阴影帧。
- **界面语言**：zh/en 字典 key 对齐、档位控件中文 SSR、渲染器组件（Code / Timer / Map / 空程序兜底）中文与英文回退 SSR 均由自动检查覆盖；尚未在运行中的 Web UI 里手动切换语言做人工点验。
- **0.2.0 发布**：推送 tag `v0.2.0-26-10-21` 触发 GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955)（`publish.yml`，33 s）并完成发布；registry `latest` = `0.2.0-26-10-21`，`gitHead` = `e5ce0af`，`npm audit signatures` 验证了 registry signature 与 provenance attestation（SLSA v1）。GitHub release：[v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21)。
- **0.2.1 发布**：配置从 Settings 迁移到插件详情页（`plugins.bundle.config`，key 为包名），开关改用 DSH 原生样式；tag `v0.2.1-26-10-21` 触发 [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971)，registry `latest` = `0.2.1-26-10-21`（`gitHead` = `4dcd34b`），`npm audit signatures` 验证了 provenance；本地 `npm run check` 65 tests、`npm pack` 34 个文件。GitHub release：[v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21)。
- 已验证的 DSH 版本：**0.2.1-rc.2**（`dsh --version`）。更晚的版本未验证。
- **平台覆盖**：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）均已安装并验证基本使用（输入框 UI 控件、卡片）；Linux 未验证。
- **0.2.2 发布**（纯文档）：修正 README 的 CJK 加粗渲染与平台验证说明；tag `v0.2.2-26-10-21` 触发 [run 39598770488](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39598770488)，registry `latest` = `0.2.2-26-10-21`（`gitHead` = `aac3f86`），provenance 已验证；无代码或行为变化。
