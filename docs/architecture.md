# 架构与行为

中文 | [English](architecture.en.md)

[← 返回 README](../README.md)

本文展开 README 的结构与行为细节。

## 架构

```
Host  lib/index.js（Node）
├─ ctx.tools.register(render_ui)          # 参数 { program, style, title?, styleId? | temporaryStyle? }
│   └─ @openuidev/lang-core 按组件库 spec 校验；错误精确回传，模型同一轮自修
├─ 会话开关 + 回答样式（全局默认 + 会话覆盖）   # /iui 命令 + 投影 + 每 agent 工具可见性
├─ ctx.systemPrompt.section(...)          # 开关打开时才注入 OpenUI Lang 生成提示词
├─ Config.globalEnabled / answerStyle / freeComposition / exportBackground / exportScale / removeFollowUps (volatile)  # 插件详情页写入；prompt 每次请求读取实时值
├─ on-demand.ts Operation controller       # session/event 绑定、澄清与终止；projection v6 的 onDemand
├─ style-store.ts + style-routes.ts          # 已保存模板；认证 catalog/saveFromResult/update/delete
├─ result-store.ts                          # 最多 200 条不可变临时结果快照；事后保存
├─ webServer 路由（可选注入）                # /api/intelligent-ui/export/standalone.{js,css}，供交互页面导出读取
└─ ctx.skills.register(intelligent-ui)    # 内嵌 Agent Skill（skills/intelligent-ui/SKILL.md）

Client  lib/client.js（浏览器，DSH module loader 懒加载）
├─ ctx.locale.register('intelligent-ui')  # zh/en UI 字典；slot 声明 locale 后组件拿到注入的 t
├─ conversation.input.activity             # 输入框右侧的 UI 控件（chip + Menu + 样式面板；读投影 + 开关/样式/按需命令）
├─ conversation.input.overlay              # OnDemandHint：发起标签页的 armed 提示、示例与取消
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # 插件详情页：可用性、回答样式、我的样式、编排方式与导出（写 Host 设置文档的 volatile 字段）
├─ conversation.chat.turnTail 列表项       # 每轮结束时提取程序/临时快照，渲染主题、临时标记、调整/保存操作
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 移植后的 57 个组件（chrome 走渲染器 i18n context）
├─ conversation.chat.assistant-actions 列表项  # 仅该轮记录过 render_ui 的消息出现导出按钮
│   └─ 菜单（图片：原始 / 圆角 / 卡片；交互页面）→ PNG 或单文件 HTML 下载
├─ tool.call.toolview keyed 'render_ui'   # 进程区只留一行「交互式回答」（英文界面 "Interactive answer"）
└─ 内置 CSS（组件库 / MapLibre / KaTeX 使用 DSH 全局样式 + scoped reset）
```

开关关闭时模型侧完全没有这个工具的痕迹；打开后模型才看到工具、一段系统提示词和一个按需加载的 skill。UI 渲染与交互全部在浏览器完成，程序本身作为工具参数进入会话日志，随历史重放。

## 开关与回答样式

![输入框右侧的 UI 控件：三档开关与分隔线下的 Display style](../assets/intelligent-ui-toggle.png)

- **全局默认**：插件详情页提供「在所有会话中启用」开关、回答样式（Auto / Card / Article 或已保存的全局模板）、「自由布局」开关，以及导出的默认值（图片背景色、1x/2x、图片/交互页面是否移除包含 `@ToAssistant` 追问的整个区块（默认移除））。新会话默认继承这些设置。页面按 **可用性** / **回答样式** / **我的样式** / **编排方式** / **导出** 分组。
- **会话覆盖**：输入框 UI 控件只改当前会话。`/iui on` / `off` / `inherit` 设置启用覆盖；`/iui style auto|card|article|inherit|<cs_id>` 设置样式覆盖。会话覆盖优先于全局，`inherit` 跟随全局。
- **答案样式**：`Card` 为紧凑交互卡片；`Article` 为 `render_ui` 卡片内的阅读版式（`Toc` + 可折叠 `Section` + 长 Markdown 正文）；`Auto` 由模型按请求选择。Article 的 `Section` 正文是一个嵌套 flow，块间距使用 group 级节奏；页面级 flow 只靠 margin 排版，不再叠加 flex gap，避免 section 前后出现双倍留白。
- 状态：全局启用/样式/自由布局在 Host 设置文档；会话启用、关闭与样式覆盖原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`（`sessions`、`offSessions`、`styles`）。旧版 `{ "global": true, "sessions": [...] }` 仍可读取为全局/会话迁移值。
- 会话里的命令日志折叠成 `intelligent-ui` 投影，提供当前启用/样式状态、pending 和实时 `onDemand`（stateVersion 6）；输入框控件只镜像投影，Host 负责全部状态决定。控件会把乐观视图通过 BroadcastChannel 同步给其他标签，投影到达后收敛为该投影值。作用域菜单与导出菜单共用 `MenuItem`/`MenuDivider` 菜单行（宽度按内容、最小 208px，统一行距与选中/悬停/禁用态）；作用域菜单右缘与 chip 右缘对齐；「显示样式」一行常驻，关闭时置灰禁用，上方有一条内缩的浅分割线；样式面板是菜单的第二级，返回按钮回到作用域菜单而不是关闭全部浮层。
- 开关依赖部署同时组合 `sessionProjections` + `commands`（DSH Web 默认都有）。缺任一服务时无法显示/持久化会话控件，扩展回到**始终开启**行为。

## 自定义样式与按需操作

### 结果样式契约

`src/shared/style-templates.ts` 的 `StyleSnapshot` 是 schemaVersion 1（StyleSnapshotV1）：`baseLayout: card|article`、`directives`、`theme`，另有可选 `suggestedName`。`render_ui` 要求 `program` 与 `style`；可带 `title`，以及互斥的 `styleId` 或 `temporaryStyle`。临时快照的 `baseLayout` 必须等于 `style`；仅当前 Host 授权且已观察到的工具调用可使用它。解析/Article 结构校验仍照常执行。成功值含 `statements`、`style`、`styleSource: builtin|template|temporary`，以及可选 `styleId`、`warnings`；快照由工具参数承载，不在成功值中复制。

优先级是：当前调用已授权的临时样式 → 会话样式覆盖 → 全局默认 → Auto。临时样式不写会话/全局设置。已选自定义模板时，普通调用必须传准确的 `styleId` 和模板的基础版式。模板或 catalog 不可用时客户端降级默认主题；临时快照则独立于模板库。

### Operation 与会话事件

`host/on-demand.ts` 维护每会话一个 Operation，含 Host 生成的 `operationId`、会话/可选客户端标识、首次人工消息的 `triggerMessageId`、generate/adjust 类型、可选 `parentResultId`、澄清轮数、结果 ID 与时间戳。`/iui on-demand [off|<client-instance-token> [adjust <resultId>]]` 武装或取消；插件必须先在该会话启用。armed 状态下再次武装会替换活动操作，不改选中的样式；已经绑定消息的 running/clarifying 操作拒绝再次武装，必须先显式取消，避免第二下点击撤销模型即将提交的授权。

状态为 `armed → running ↔ clarifying → completed`，也可进入 `failed`、`cancelled`、`interrupted`。armed 在读取时检查 10 分钟 TTL；控制器最多保留 256 个会话，不因容量静默淘汰活动操作。操作仅在内存，重启后视图清空（不重建 interrupted 记录），必须重新武装。

控制器以前置 `session/event` 监听更新状态后再投影；按单调 seq 去重，以 turn 限定工具事件。首条人工 `user/message` 绑定操作，技能/文件等注入消息被忽略。注意 DSH 在 step 内先把 `system/message` 追加到 surface，随后才追加本次 `user/message`；因此提示词必须在 **armed** 阶段就注入 ON-DEMAND note，绑定后继续注入，否则首轮模型看不到按需契约。已绑定（running/clarifying）的按需 turn 里，不带 `temporaryStyle` 的普通 `render_ui` 会被 Host 拒绝，要求模型改用临时快照或先提问；`tool/call render_ui` 登记 callId（最多 8 次尝试），临时授权同时要求绑定消息、活动状态与当前 callId。Host 完成校验、持久化结果后同步完成操作；完成/取消后迟到调用失去授权。无渲染的 completed turn 回到 armed/resume；只有 error/abort 才进入 failed/cancelled/interrupted。

`ask_user_question` 事件进入 clarifying；尚未回答时不能提交临时 render。匹配的结构化工具结果（`answers` 数组）或带匹配 callId 的 `user-question-reply` 恢复 running；超时不算回答，错误提问结果为 failed，最多两轮澄清。提示词要求每轮 1–3 问、可选项/自由补充/跳过取决于 DSH 工具支持；扩展不改写内置提问 UI。缺少内容/数据时要求模型先提问而不是编造，并优先用**无选项的自由输入问题**取得文本、文件路径或链接，避免内置选项无法承载粘贴内容。工具不可用时文字提问降级；completed 且无 render 会进入 resume，下一条消息继续，无需在回答前重新武装（过期、重启或失败后除外）。

一轮以 completed 结束但没有 render 时（典型是模型用文字要求补充内容），操作不会直接丢弃，而是回到 armed 并带 `resume` 标记：composer 提示保留并显示“继续按需生成”，下一条人工消息再次绑定同一操作；只有成功生成临时结果（completed）或用户取消后才清理提示。

projection v6 在 enable/style/pending 之外携带可空 `onDemand`（operationId、状态、类型、parentResultId、clientInstanceId、resultIds、可选 resume）。恢复历史事件不会授权新操作。`OnDemandHint` 在 armed/running/clarifying 且客户端标识匹配时显示：armed 展示说明、示例与取消；running/clarifying 展示状态和轻量加载指示；resume armed 展示“继续按需生成”并隐藏示例。失败/中断终态也保留提示，提供“重试”（重新武装）与“关闭”（仅隐藏本标签页提示），不再静默消失。示例填入不发送，保留草稿；成功 render 或取消后提示才消失。Host 仍绑定会话的下一条人工消息，不校验发送标签来源；这种多标签页收敛不能当作消息元数据级隔离。

### 保存与模板管理

`result-store.ts` 把最近 200 条不可变临时快照原子写入 `<DSH_HOME>/dsh-intelligent-ui-results.json`，记录 `resultId = tool callId`、sessionId、snapshot、可选 parentResultId、createdAt。每次调整产生新 callId；当前实现没有独立 revisionId，保存的是点击结果的 ID。工具参数有完整快照时，即使注册表淘汰，历史仍可重放，但事后保存返回 `result_missing`。

`style-store.ts` 把模板写入 `<DSH_HOME>/dsh-intelligent-ui-styles.json`；global 最多 40 个，session 每会话最多 20 个。`GET /api/intelligent-ui/styles?sessionId=…` 返回全局与该会话模板；同一路由 POST 支持 `save`、`saveFromResult`、`update`、`delete`。路由仅在 `webServer` 与 `connection.requestRejection` 可用时注册；先认证，JSON 请求限 64 KiB/15 秒，响应 no-store。

`saveFromResult` 只收 resultId、名称、描述、范围与可选 sessionId，Host 从注册表取快照；不能由浏览器替换 directives/theme，session 范围必须与结果所属会话一致。保存不选中模板，也不写全局默认；重复名称报错，服务端没有独立幂等键。`update` 只允许名称/描述/directives，`delete` 删除模板。Composer 管理可见模板；设置页管理全局模板，另可导出 JSON。删除当前选择会尝试回退 Auto；其他会话遇到失效引用按缺失模板处理。

### 卡片主题、操作与安全边界

`programs.ts` 从记录的调用参数提取并防御性校验临时快照，拒绝混合来源/版式不一致，跳过失败调用与已离开历史窗口的参数。`IntelligentUICards` 以临时快照优先、catalog 模板次之解析主题；`resolveStyleThemeVars` 只把允许的字段映射到 renderer host CSS 变量。明暗方案跟随 DSH body 标记（外部使用系统偏好）；portaled Popover 与沙盒 iframe 保留默认主题，状态语义色由 CSS 管理。

临时结果显示「临时样式」标记及扩展自身渲染的「调整样式」「保存为模板」，这些操作不进入模型程序。调整关联具体 resultId，保留草稿并填入前缀，正常发送后才生成新结果。保存 Popover 只收名称/描述/可用范围，复用快照，不调用模型。设置页只做全局默认、已保存模板管理、编排与导出；生成发生在 Composer。

主题只接受 light/dark 六位 hex palette 与 font/radius/density/shadow 枚举，拒绝未知键、任意 CSS/脚本/URL；临时样式的 ink/canvas、accent/canvas 在两种方案下至少 3:1，低于 4.5:1 警告。directives 最多 2,000 字符；已保存模板注入提示词时作为 JSON 字符串包在 DISPLAY PREFERENCES 边界中，明确无权覆盖系统、工具或安全规则。临时 directives 是结果数据，不提升为系统指令。模型不能自行武装、保存模板或改变默认值；`HtmlView` 原有沙盒边界仍适用。

## 布局与间距契约

- **渲染器拥有垂直节奏**：页面根 `Col`、`Section` 正文和 `Card` 内容都由渲染器的 flow 负责块间距（页面级 24px、组级 12px、内侧 8px）；模型不需要也不应该在这些位置再传 `gap`，否则会覆盖或叠加节奏。
- **显式 gap 只用于横向/紧凑组合**：`Row`、`Grid`、`Carousel` 和小组控件栈可用 1–2（内侧）或 3–4（组级）；不要用 5–6 的嵌套 `Col` 去模仿页面级留白。
- **禁止用手动空白兜底**：`Spacer()`、空的 `Box`/`Col`/`Card`、空 `Text`/`Markdown`、以及当空白用的 `Divider` 都会制造不可控的空白带；需要分组时用 `Card`，其余交给 flow。
- **兜底链路**：生成提示词与 Agent Skill 携带同一份契约；Host 的 `layoutWarnings` 对根 gap、纵向 Spacer、空 Section/Text、`gap: 0` 块栈返回非致命 warning，模型可在同轮修正；渲染器自身也保证 Section 正文是嵌套 flow、Article 根只保留一层间距。

## 决策策略

开关只决定能力是否可见；真正决定“这一轮出不出卡片、用哪种样式”的策略只有一份，位于注入的 `tool:intelligent-ui` 提示词里（Host 在开关命中会话时还会在段首加一句“本会话已开启 Intelligent UI”，并追加当前有效样式的说明）。它随开关一起出现，所以开启后的默认行为是：

- **默认出卡片**：有结构的回答一律用 `render_ui`；`Card` 页保持紧凑可扫读。
- **Article 页**：`Article` 样式要求 article-first 页面——`Toc`、可折叠 `Section`、每个 major part 的实质 `Markdown` 正文；不允许只交骨架或把内容藏在交互后面。
- **文字是有界例外**：整段回答只有单个事实或一两句话；用户明确要文字 / 文档 / 代码；内容无法页面化（安全警示、必须逐字引用的材料）；或本轮连续两次渲染失败。
- **单一规则源**：Agent Skill 不重复决策规则，只负责“怎么做”。
- **自由布局开关**：插件详情页的「自由布局」写入 Host 设置文档的 volatile 字段；开启后设计规范降级为建议。它和答案样式正交，不替代样式选择。

## 图片导出

- **入口**：扩展向 DSH 的 `conversation.chat.assistant-actions` 列表贡献一项（复制 / 点赞 / 分支所在的标准操作栏），并通过 `order` 与 `margin-left:auto` 把它排到该行**最右侧**，用带「导出」字样的药丸样式与原生图标控件区分。只有该条已定稿消息所属的 Turn 记录过可用的 `render_ui` 调用时，这一项才渲染；纯文字回答保持原生的操作栏不变。`render_ui` 工具调用本身就是持久化标识，不额外写入会话元数据。
- **范围**：一次导出覆盖该 Turn 渲染出的全部卡片。图片只包含渲染出的卡片，不包含聊天里的 Markdown 文字，也不包含导出按钮本身。
- **截取**：导出前临时展开折叠的卡片（完成后恢复原状），等待卡片内的图片、图片搜索与地图就绪信号（每个地图在 `data-iui-map-ready` 上报告 MapLibre `idle`（样式切换、瓦片回退与 resize 会先重置为未就绪））落定，并冻结过渡与动画，再用 SnapDOM 对实时卡片 DOM 做栅格化。3D 翻卡片的双面在 SVG 栅格化中不会遵守 `backface-visibility`，截图期间会按当前状态展平为读者看到的那一面。地图通过保留下来的 MapLibre WebGL 绘制缓冲入图；沙盒 iframe（`HtmlView`）无法截取，图片中会缺失。图片、字体与本地交互状态都跟随实时 DOM。
- **美化框**：菜单提供 **原始**（只截取答案本身）、**圆角**（背景色 + 圆角留白）与 **卡片**（留白、圆角与柔和阴影）。美化样式每次导出时选择；菜单右缘与导出按钮右缘对齐，宽度跟随内容；上方空间不足时菜单改为在按钮下方展开。背景色、1x/2x 分辨率与追问移除开关来自插件详情页的 **导出** 分组。
- **主题**：PNG 截取实时 renderer 主题，包含当时的卡片外观与操作行。
- **下载**：浏览器收到一张以回答标题与本地时间命名的 PNG；不涉及 Host 或会话数据。

## 交互页面导出

- **入口**：与图片导出共用操作栏的「导出」药丸与菜单；菜单底部用分割线与三个图片框分开的一项是 **交互页面**。
- **资产供应**：`scripts/build.mjs` 额外构建 `lib/standalone.js` / `lib/standalone.css`（React + 渲染器 + KaTeX/MapLibre 样式）。Host 通过可选注入的 `webServer` 注册两个 same-origin 精确路由（`/api/intelligent-ui/export/standalone.js` 与 `.../standalone.css`）并在请求时读取这两个构建产物；部署没有 `webServer` 时路由不注册，客户端会报页面构建失败。
- **生成**：浏览器在点击时并行拉取两个资产，扫描当前页面样式表收集自定义属性并用计算值拼出主题快照，再由 `export-html-plan.ts` 把卡片程序、资产与主题内联进一个 HTML；页面大小约 3.4–4.9 MB。下载文件名带回答标题与本地时间。
- **结果主题快照**：`programsToExportCards` 优先读取内联 temporaryStyle.theme，其次解析当前可见模板，再把已解析的 themeStyle 与 scheme 逐卡片内联；导出后不再查询 catalog。临时结果不依赖模板库，已保存模板缺失时按默认主题导出。
- **页面运行时**：`src/standalone/index.tsx` 只渲染真实 `OpenUIRenderer` 的卡片正文（不导出 DSH 的标题栏与折叠控件），因此地图、图表、表单等交互与 DSH 内一致；`@OpenUrl` 照常打开链接，`@ToAssistant` 退化为「复制消息 + toast 提示回到 DSH 粘贴继续」，剪贴板失败时 toast 保留原消息；插件详情页的「移除追问操作」默认开启，导出图片和页面时会移除包含追问的整个区块；关闭后保留并由页面复制消息。页面只保存导出时的主题（当前 light/dark），不跟随之后的 DSH 主题切换。

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
- 按需操作中，技能要求临时快照与 style 一致，省略 styleId；重要歧义用内置 ask_user_question，回答后直接渲染，不要求预览/命名/保存。授权来自 Host，模型不能自行创建授权或保存模板。
- 技能包含：
  - `SKILL.md` — 工作流（决策策略只由注入提示词定义；显式调用是直接指令）、回答期间的只读 checkout 预检规则、OpenUI Lang 硬规则、设计规范（自由布局模式下降级为建议）、DSH 行为、参考索引；
  - `references/components.md` — 57 个组件 + 73 个 `@functions`（14 core + 59 library）+ 5 个 action 的完整参数表；
  - `references/language.md` — 语法、表达式、`$` 状态、`@Each`、常见错误对照；
  - `references/examples.md` — 6+ 个可直接跑的完整程序（行程、计算器、SVG 教程、看板、表单、小游戏）；
  - `references/troubleshooting.md` — Host 校验错误原文与修法、运行时降级、预检规则；
  - `references/integration.md` — 其他部署/agent 的接入步骤与契约。

技能文件同时以普通目录形式随包发布（`skills/`），便于阅读、复用和二次分发。
