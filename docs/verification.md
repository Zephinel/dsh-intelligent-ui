# 验证记录

中文 | [English](verification.en.md)

[← 返回 README](../README.md)

以下为一次历史验证记录；其中的测试数量与打包大小按最近一次 `npm run check` / `npm pack` 输出更新。

在隔离的第二个 DSH Web 实例（3081 端口，同一 profile + patch overlay）上做过端到端验证：

- 模型按提示词调用 `render_ui`，生成 31–117 条语句的页面；非法程序被 Host 拒绝并给出精确字段错误，模型在同一轮内自修成功。
- 组件总览页、旧金山行程、咖啡计算器、SVG 折纸教程均正常渲染；照片（Wikipedia/Wikimedia）、MapLibre 地图 + pin、图表、表单、计时器、翻转卡、撒花、HtmlView 动画可用。
- 交互：勾选时间线计数更新、SegmentedControl 联动、表单与按钮状态正常；暗色主题自动切换。
- 响应式：390 / 546 / 768 / 1092 px 下无横向溢出（补齐了组件库依赖的 `box-sizing` 作用域 reset）。
- 测试：`npm run check` 全绿——Host 24（含全局启用/样式、会话开关与样式覆盖、跨标签广播、投影/命令/工具 style 校验与 Article 结构校验、设置页与提示词样式注入）、Client 32（含档位控件/样式面板与滑杆、双语字典、设置页全局启用与样式选择、程序 style 解析、跨标签广播）、打包清单 18（含组件/函数目录、57 组件计数、SKILL.md 计数、双语 README 链接、CHANGELOG 与截图一致性、prompt/Skill 的只读 checkout 护栏、Article/Section/Toc 文档护栏，以及“开启会话默认出卡片 / 显式调用是直接指令”的决策策略护栏）、渲染器解析 41/41、SSR 41/41、i18n 渲染检查 4 组（zh + en fallback）、排版检查 22/22（货币符号字距、CJK 字距、卡片内标题比例尺、窄屏换行与图表标签）；`npm pack` 产物约 2.34 MB / 36 个文件（解包 5.49 MB）；README 截图已更新为 57 组件一览、示例、输入框开关/样式面板与插件设置页（WebP + PNG）。
- **Agent Skill 端到端**：在真实 DSH 会话里模型调用 `skill { name: "intelligent-ui" }` 成功加载 `<skill_content>`（15 KB 正文 + references 基目录提示），随后按技能用 `render_ui` 生成并渲染了验证页。
- **bundle 安装链路**：用 `npm pack` 产物在一次性 profile（`~/.dsh/profiles/zbundle-test`，依赖 `file:/tmp/…tgz` + `dsh.profile.bundles`）里安装，`dsh --profile zbundle-test --dump-config` 退出 0，输出出现 `# == @zephinel/dsh-intelligent-ui` 与插入行 `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'`（验证后已清理）。
- **三档开关端到端（0.2.1 时代记录）**：默认「关闭」请求里没有 `render_ui`、提示词为空；选「仅本会话」后本会话请求带工具与提示词并渲染出卡片，而新开会话仍是关闭；选「全部会话」后新开会话直接带工具与提示词；选「关闭」后文件清空、新会话再次无工具无提示词；两个标签页之间控件状态通过 BroadcastChannel 同步；状态文件 `{ "global": false, "sessions": [] }` 与投影行为符合预期。0.3 的会话开关/样式覆盖与 Article 页面尚待实机验证。
- **Style panel 浏览器 E2E（组件级，可复跑）**：`npm run test:browser` 用无头 Chrome + CDP 加载 `test/browser/harness` 的 `ToggleControl`，验证 chip → menu（无「全部会话」、含「显示样式」）→ 仅本会话 → 样式面板；面板矩形完全在视口内，焦点进入面板；拖动真实滑杆到 Article 后发出 `style:article`；Escape 关闭后焦点回到 chip。该测试不启动完整 DSH Web，也不替代 Host/Client 集成 E2E。
- **界面语言**：zh/en 字典 key 对齐、档位控件中文 SSR、渲染器组件（Code / Timer / Map / 空程序兜底）中文与英文回退 SSR 均由自动检查覆盖；尚未在运行中的 Web UI 里手动切换语言做人工点验。
- **0.2.0 发布**：推送 tag `v0.2.0-26-10-21` 触发 GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955)（`publish.yml`，33 s）并完成发布；registry `latest` = `0.2.0-26-10-21`，`gitHead` = `e5ce0af`，`npm audit signatures` 验证了 registry signature 与 provenance attestation（SLSA v1）。GitHub release：[v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21)。
- **0.2.1 发布**：配置从 Settings 迁移到插件详情页（`plugins.bundle.config`，key 为包名），开关改用 DSH 原生样式；tag `v0.2.1-26-10-21` 触发 [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971)，registry `latest` = `0.2.1-26-10-21`（`gitHead` = `4dcd34b`），`npm audit signatures` 验证了 provenance；本地 `npm run check` 65 tests、`npm pack` 34 个文件。GitHub release：[v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21)。
- 已验证的 DSH 版本：**0.2.1-rc.2**（`dsh --version`）。更晚的版本未验证。
- **平台覆盖**：macOS（Web + DSH Desktop）与 Windows（DSH Desktop）均已安装并验证基本使用（输入框 UI 控件、卡片）；Linux 未验证。
- **0.2.2 发布**（纯文档）：修正 README 的 CJK 加粗渲染与平台验证说明；tag `v0.2.2-26-10-21` 触发 [run 39598770488](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39598770488)，registry `latest` = `0.2.2-26-10-21`（`gitHead` = `aac3f86`），provenance 已验证；无代码或行为变化。
