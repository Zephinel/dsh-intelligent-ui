# 架构与行为

中文 | [English](architecture.en.md)

[← 返回 README](../README.md)

本文展开 README 的结构与行为细节。

## 架构

```
Host  lib/index.js（Node）
├─ ctx.tools.register(render_ui)          # 参数 { program, title? }
│   └─ @openuidev/lang-core 按组件库 spec 校验；错误精确回传，模型同一轮自修
├─ 三档开关（off/session/global，持久化）   # /iui 命令 + 投影 + 每 agent 工具可见性
├─ ctx.systemPrompt.section(...)          # 开关打开时才注入 OpenUI Lang 生成提示词
├─ Config.freeComposition (volatile)      # 插件详情页写入；prompt 每次请求读取实时值
└─ ctx.skills.register(intelligent-ui)    # 内嵌 Agent Skill（skills/intelligent-ui/SKILL.md）

Client  lib/client.js（浏览器，DSH module loader 懒加载）
├─ ctx.locale.register('intelligent-ui')  # zh/en UI 字典；slot 声明 locale 后组件拿到注入的 t
├─ conversation.input.activity             # 输入框右侧的 UI 控件（chip + 原生 Menu；读投影 + 执行开关命令）
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # 插件详情页：自由布局开关（写 Host 设置文档的 volatile 字段）
├─ conversation.chat.turnTail 列表项       # 每轮结束时取出该轮 render_ui 程序并渲染卡片
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 移植后的 55 个组件（chrome 走渲染器 i18n context）
├─ tool.call.toolview keyed 'render_ui'   # 进程区只留一行「交互式回答」（英文界面 "Interactive answer"）
└─ 内置 CSS（组件库 / MapLibre / KaTeX 使用 DSH 全局样式 + scoped reset）
```

开关关闭时模型侧完全没有这个工具的痕迹；打开后模型才看到工具、一段系统提示词和一个按需加载的 skill。UI 渲染与交互全部在浏览器完成，程序本身作为工具参数进入会话日志，随历史重放。

## 开关：默认关闭，三档作用域

![输入框右侧的 UI 控件：点击后弹出「关闭 / 仅本会话 / 全部会话」菜单（截图为英文界面）](../assets/intelligent-ui-toggle.png)

> 截图取自英文界面；扩展文案跟随 DSH 的界面语言，中文界面下开关显示为「UI：关闭 / UI：本会话 / UI：全部」，菜单为「关闭 / 仅本会话 / 全部会话」。

- **关闭**（默认）：所有会话的 `render_ui` schema 都不出现在请求里，约 8.5K tokens 的生成提示词展开为空，工具调用会被明确拒绝。
- **仅本会话**：只有当前会话启用；其他会话（包括新会话）仍然关闭。
- **全部会话**：所有会话、包括之后新开的会话都启用。
- 状态原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`（默认 `~/.dsh/dsh-intelligent-ui.json`，形如 `{ "global": false, "sessions": ["<session-id>"] }`），刷新、DSH 重启后保留；「全部会话」与「仅本会话」互斥，选择「关闭」会清掉所有会话的白名单。
- 命令行等价：`/iui off` / `/iui session` / `/iui global`（裸 `/iui` 显示当前状态；`on`、`all` 是 `global` 的别名）。
- 会话里的命令日志折叠成 `intelligent-ui` 投影，用于开关的 pending 状态；点控件的切换通过 BroadcastChannel 同步到其他标签。
- 输入框控件与斜杠命令等价；DSH Desktop / Web 通用。
- 开关依赖部署同时组合 `sessionProjections` + `commands`（DSH Web 默认都有）。缺任一服务时无法显示/持久化开关，扩展回到旧的**始终开启**行为。

## 决策策略

开关只决定能力是否可见；真正决定“这一轮出不出卡片”的策略只有一份，位于注入的 `tool:intelligent-ui` 提示词里（Host 在开关命中会话时还会在段首加一句“本会话已开启 Intelligent UI”）。它随开关一起出现，所以开启后的默认行为是：

- **默认出卡片**：有结构的回答（多个事实、时间线、阶段、步骤、选项、数字、对比、可探索内容，含讲解 / 介绍 / 综述）一律用 `render_ui`。
- **文字是有界例外**：整段回答只有单个事实或一两句话；用户明确要文字 / 文档 / 代码；内容无法页面化（安全警示、必须逐字引用的材料）；或本轮连续两次渲染失败。
- **显式调用是直接指令**：用户用 `/intelligent-ui` 调用技能，或明确要求用 `render_ui` 做页面时，必须出卡片（除非用户同时要文字或工具不可用）。
- **单一规则源**：Agent Skill 不再重复决策规则，只负责“怎么做”。此前 skill 与提示词各写一份 prose 规则，同一问题在不同模型或部署上会得到不同结果。
- **自由布局开关**：插件详情页的「自由布局」写入 Host 设置文档的 volatile 字段；开启后，注入提示词追加“design playbook 只作为建议”，skill 的 Design playbook 也明确降级为建议。关闭时保持默认版式规范。插件详情页同时注明这是提示词层偏好、不是硬性强制；需要固定出卡片时用 `/intelligent-ui` 显式调用。

## 界面语言

- 浏览器半边的全部自有文案（输入框开关、菜单、卡片标题与状态、渲染失败提示、地图/代码块/计时器等组件 chrome、无障碍标签）都通过 DSH 的 locale 服务翻译：`ctx.locale.register('intelligent-ui', { zh, en })`，slot 注册声明 `locale` 后组件拿到注入的 `t`。
- 浏览器半边因此要求部署组合了 `@deepseek-ai/dsh-client-locale`（DSH Web 0.2.1 默认包含）；自定义组合缺少它时，浏览器半边不会挂载（Host 工具与提示词不受影响）。
- 跟随 DSH 的界面语言设置（**设置 → 通用 → 界面语言**），切换即时生效，不需要刷新；在 `src/shared/locales.ts` 维护双语字典，`zh` 为 key 的准绳，`en` 按同一 key 集合校验。
- 插件在插件列表里的标题/描述由 `locale/en.json`、`locale/zh.json` 提供（`PluginLocalizedMeta` 约定），与上面的 UI 字典是两套机制。
- 模型侧文案（`render_ui` 工具描述、OpenUI Lang 生成提示词、Agent Skill）以及 `/iui` 命令的 Host 返回文案保持英文：DSH 的 locale 服务只负责浏览器 UI，内置 Host 命令同样是英文。
- 渲染器库在 DSH 之外（测试、独立嵌入）使用时默认英文，不依赖 locale 服务。

## Agent Skill

插件在 mount 时把 `skills/intelligent-ui/SKILL.md` 注册为**内嵌 skill**（仅当部署同时组合了 `dsh-skill` 技能服务时；没有技能服务的部署不受影响）：

- 会话目录里会出现 `intelligent-ui`，模型用 `skill` 工具按需加载；
- 技能目录条目始终可见（开销很小）；但**开关关闭时不要调用 `render_ui`**，Host 会拒绝，先请用户打开开关；
- 用户也可以用 `/intelligent-ui` 直接调用（`userInvocable`）；显式调用会注入同一份技能内容，并按显式调用规则要求出卡片；
- 技能包含：
  - `SKILL.md` — 工作流（决策策略只由注入提示词定义；显式调用是直接指令）、回答期间的只读 checkout 预检规则、OpenUI Lang 硬规则、设计规范（自由布局模式下降级为建议）、DSH 行为、参考索引；
  - `references/components.md` — 55 个组件 + 73 个 `@functions`（14 core + 59 library）+ 5 个 action 的完整参数表；
  - `references/language.md` — 语法、表达式、`$` 状态、`@Each`、常见错误对照；
  - `references/examples.md` — 6+ 个可直接跑的完整程序（行程、计算器、SVG 教程、看板、表单、小游戏）；
  - `references/troubleshooting.md` — Host 校验错误原文与修法、运行时降级、预检规则；
  - `references/integration.md` — 其他部署/agent 的接入步骤与契约。

技能文件同时以普通目录形式随包发布（`skills/`），便于阅读、复用和二次分发。
