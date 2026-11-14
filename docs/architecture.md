# 架构与行为

中文 | [English](architecture.en.md)

[← 返回 README](../README.md)

本文展开 README 的结构与行为细节。

## 架构

```
Host  lib/index.js（Node）
├─ tool-schema.ts                          # 注册前用 DSH 子集校验 render_ui 参数/输出
├─ ctx.tools.register(render_ui)          # 参数 { program, style, title?, styleId? | temporaryStyle?, editRequestId? }；编辑结果额外返回修订血缘（含 requestId）、Host 归一化 program 与 presentationMeta
│   └─ @openuidev/lang-core 按组件库 spec 校验；错误精确回传，模型同一轮自修
├─ ctx.tools.register(edit_ui_blocks)     # 区块片段编辑：Host 用 artifact-block-bundle 切片/回填微程序；多 pending 时用 requestId/artifactId 选择
│   └─ artifact-block-bundle.ts（shared）  # extractBlockBundle / spliceBlockBundle：只替换选中的根子节点槽位
├─ 会话开关 + 回答样式（全局默认 + 会话覆盖）   # /iui 命令 + 投影 + 每 agent 工具可见性（关闭时 deny render_ui 与 edit_ui_blocks）
├─ ctx.systemPrompt.section(...)          # 开关打开时才注入 OpenUI Lang 生成提示词
├─ Config.globalEnabled / answerStyle / freeComposition / exportBackground / exportScale / removeFollowUps (volatile)  # 插件详情页写入；prompt 每次请求读取实时值
├─ on-demand.ts Operation controller       # session/event 绑定、澄清与终止；projection v6 的 onDemand
├─ style-store.ts + style-routes.ts          # 已保存模板；认证 catalog/saveFromResult/update/delete
├─ result-store.ts                          # 最多 200 条不可变临时结果快照；事后保存
├─ artifact-edit.ts + artifact-revisions.ts # 解析一消息多信封（parseEditRequestTexts）→ 每会话 Map<requestId, Entry>（最多 3 条 pending）；按 requestId 精确 apply、每请求独立修订并在 meta 回传 requestId；branch 请求允许旧 base（revision = latest+1）；`edit_ui_blocks` 合并/排序并支持临时样式快照；M4-1 嵌套编辑用 `program-cst.ts` 的 revision-scoped `nodeId`/`sourceDigest` 校验并替换嵌套节点；M4-2 `orderByParent` 层级排序按 parent → 完整子 nodeId 排列、最深优先重建；M4-3 权威 program 注册表（`dsh-intelligent-ui-programs.json`）+ 幂等 ledger（`dsh-intelligent-ui-structure-operations.json`）+ POST 结构操作路由；修订注册表（含可选 `temporaryStyle`）+ 认证查询路由 + POST 恢复路由
├─ webServer 路由（可选注入）                # /api/intelligent-ui/export/standalone.{js,css}；GET 修订查询与 POST /api/intelligent-ui/artifact-restore（零模型恢复）；GET /api/intelligent-ui/update（npm 新版本检查）
└─ ctx.skills.register(intelligent-ui)    # 内嵌 Agent Skill（skills/intelligent-ui/SKILL.md）

Client  lib/client.js（浏览器，DSH module loader 懒加载）
├─ ctx.locale.register('intelligent-ui')  # zh/en UI 字典；slot 声明 locale 后组件拿到注入的 t
├─ conversation.input.activity             # 输入框右侧的 UI 控件（chip + Menu + 样式面板；读投影 + 开关/样式/按需命令）
├─ conversation.input.overlay              # OnDemandHint：发起标签页的 armed 提示、示例与取消
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # 插件详情页：可用性、回答样式、我的样式、编排方式与导出（写 Host 设置文档的 volatile 字段）
├─ conversation.chat.turnTail 列表项       # 每轮结束时提取程序/临时快照，渲染主题、临时标记、调整/保存操作
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 移植后的 57 个组件（chrome 走渲染器 i18n context）
├─ 卡片区块编辑与编排（IntelligentUICards + artifact-edit/*）  # 多草稿表格：同一聊天多份编辑草稿、单 active 画布（activeKeys）、每 chat 最多 6 份/发送最多 3 个 attached；草稿按标签页持久化到 sessionStorage（刷新恢复，跨标签不共享）；卡片显示「编辑」入口、带修订号的历史图标、非 active 草稿角标；编辑模式挂载编辑视图（画布实时预览目标顺序，<720px 提示）、Artifact 编辑器（顶部「待提交编辑 (N/6)」切换区）与区块浮层；block-edit 修订卡片从 `edit_ui_blocks` 结果 meta 渲染；Turn 关闭时按 requestId 对账 submitted 草稿；旧修订冲突横幅可启用 branch；旧修订可零模型恢复为本地修订卡片；临时样式卡片支持内容编辑（快照随请求）；「嵌套区块」opt-in 后可选 `Col`/`Row`/`Card` 内的子区块做内容替换（根层顺序不变），并在「嵌套区块编排」中调整同一 parent 内的子区块顺序，编排行提供复制/删除结构操作（M4-3，零模型 Host 路由 + 本地结构修订卡片）
│   └─ BlockSlot（仅编辑模式 library）+ 每草稿一个 Composer 引用 chip（按 ref upsert/remove，标签「编辑 {title} · 修订 N · {摘要}」，branch 追加「 · 分支」）+ 已发送消息逐信封摘要节点；`programs.ts::blockEditProgram` + `artifact-edit/local-revisions.ts`（localStorage 每会话 ≤20、按 Turn 渲染）+ `artifact-edit/revision-fallbacks.ts`（删除已渲染修订后的回退目标，localStorage 每会话 ≤20）+ `shared/image-source.ts`（图片来源策略/上限/MIME）+ `client/image-source.ts`（workspaceFiles→同源 Blob URL）+ `artifact-edit/tabs.ts`（BroadcastChannel 跨标签软租约横幅）+ `artifact-edit/nested.ts`（CST→嵌套 display block 映射，`bN.M.K` 与 nodeId/digest）+ RenderUiRow 错误明细；嵌套模式经 `nestedBlockSlots` 走 `nestedEditLibrary`（`src/lib/library.ts`，Col/Row/Card HOC）；Host 归一化/合成 program 随 presentationMeta 回放
├─ conversation.chat.assistant-actions 列表项  # 仅该轮记录过 render_ui 的消息出现导出按钮
│   └─ 菜单（图片：原始 / 圆角 / 卡片；交互页面）→ PNG 或单文件 HTML 下载
├─ tool.call.toolview keyed 'render_ui' / 'edit_ui_blocks'  # 进程区只留一行「交互式回答」；失败调用附一行原因（完整文本在 title）
└─ 内置 CSS（组件库 / MapLibre / KaTeX 使用 DSH 全局样式 + scoped reset）
```

开关关闭时模型侧完全没有这个工具的痕迹；打开后模型才看到工具、一段系统提示词和一个按需加载的 skill。UI 渲染与交互全部在浏览器完成，程序本身作为工具参数进入会话日志，随历史重放。

## 开关与回答样式

![输入框右侧的 UI 控件：三档开关与分隔线下的 Display style](../assets/intelligent-ui-toggle.png)

- **全局默认**：插件详情页提供「在所有会话中启用」开关、回答样式（Auto / Card / Article 或已保存的全局模板）、「自由布局」开关、实验性「回答即文档」开关，以及导出的默认值（图片背景色、1x/2x、图片/交互页面是否移除 `@ToAssistant` 追问控件及其表单字段（含正文的卡片保留正文，只有纯追问区块整块消失；默认移除））。新会话默认继承这些设置。页面按 **可用性** / **回答样式** / **我的样式** / **编排方式** / **实验性功能** / **导出** 分组。
- **会话覆盖**：输入框 UI 控件只改当前会话。`/iui on` / `off` / `inherit` 设置启用覆盖；`/iui style auto|card|article|inherit|<cs_id>` 设置样式覆盖。会话覆盖优先于全局，`inherit` 跟随全局。
- **答案样式**：会话样式是「出页面时的版式偏好」，不是必须出页面——模型先按回答判断该不该出页面（有结构、可视化、交互或计算价值时出，否则用 Markdown）。`Card` 为紧凑交互卡片；`Article` 为 `render_ui` 卡片内的阅读版式（`Toc` + 可折叠 `Section` + 长 Markdown 正文）；`Auto` 由模型在 `Card`、`Article` 或自由布局（无 Card/Article 外壳，`Toc`/`Section` 可选）中选择。Article 的 `Section` 正文是一个嵌套 flow，块间距使用 group 级节奏；页面级 flow 只靠 margin 排版，不再叠加 flex gap，避免 section 前后出现双倍留白。
- **实验性文档模式**：插件详情页的「实验性功能 → 回答即文档（实验）」写入 Host 设置文档的 volatile 字段 `documentMode`。开启后，普通回答（非按需生成、非 Artifact 编辑、非保存模板）的提示词改用文档契约：整篇内容写进一个 program、`style: "free"`、不写 Markdown 正文；Host 强制该布局并忽略会话模板，成功值与 `presentationMeta` 记录 `document: true` 与 `styleSource: "builtin"`，客户端按结果标记渲染成无卡片外壳的 `section.dsh-iui-document`。它不产生 Artifact 血缘、没有编辑入口与修订历史；按需结果（保留 `temporaryStyle`）、选中模板与编辑请求仍走卡片。结果按记录重放，因此开关只影响新回答。移除路径：DSH 原生支持消息内嵌 UI 后，删除该设置字段、文档提示词前缀/说明、Host 的 `documentRender` 分支与客户端 `DocumentCard`，历史结果回到卡片外壳。
- 状态：全局启用/样式/自由布局/文档模式在 Host 设置文档；会话启用、关闭与样式覆盖原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`（`sessions`、`offSessions`、`styles`）。旧版 `{ "global": true, "sessions": [...] }` 仍可读取为全局/会话迁移值。
- 会话里的命令日志折叠成 `intelligent-ui` 投影，提供当前启用/样式状态、pending 和实时 `onDemand`（stateVersion 6）；输入框控件只镜像投影，Host 负责全部状态决定。控件会把乐观视图通过 BroadcastChannel 同步给其他标签，投影到达后收敛为该投影值。作用域菜单与导出菜单共用 `MenuItem`/`MenuDivider` 菜单行（宽度按内容、最小 208px，统一行距与选中/悬停/禁用态）；作用域菜单与样式面板都按右缘对齐 chip，并与触发按钮保持 12px 间距；两者使用不透明的 layer-2 抬升表面，内部卡片/行保留 module surface 以便在深浅色下分层。「显示样式」一行常驻，关闭时置灰禁用，上方有一条内缩的浅分割线；样式面板是菜单的第二级，返回按钮回到作用域菜单而不是关闭全部浮层。切换启用范围只提交开关命令，**不会自动打开**样式面板；面板只有两个显式入口——「显示样式」行，以及点击已激活且解析为开启的作用域项（Off 或全局关闭时的「跟随全局」只关闭菜单）。
- 开关依赖部署同时组合 `sessionProjections` + `commands`（DSH Web 默认都有）。缺任一服务时无法显示/持久化会话控件，扩展回到**始终开启**行为。

## 自定义样式与按需操作

### 结果样式契约

`src/shared/style-templates.ts` 的 `StyleSnapshot` 是 schemaVersion 1（StyleSnapshotV1）：`baseLayout: card|article|free`、`directives`、可选 `theme`，另有可选 `suggestedName`。不带主题是正常情况：结果继承会话主题（当前选中模板，否则内置主题）；只有需要独立配色时才传完整主题，此时才做 3:1/建议 4.5:1 对比度检查。没有显式主题的结果不能保存为模板（没有可复制的 palette）。`render_ui` 要求 `program` 与 `style`；可带 `title`，以及互斥的 `styleId` 或 `temporaryStyle`。临时快照的 `baseLayout` 必须等于 `style`；仅当前 Host 授权且已观察到的工具调用可使用它。新按需生成使用 `style: "free"` 与 `temporaryStyle.baseLayout: "free"`，由程序组合用户要求的布局，不受 Card 紧凑要求或 Article 阅读 wrapper 限制；Toc/Section 可选，解析、锚点、主题与授权校验仍保留。旧 card/article 快照继续使用原有外壳与 Article 校验；内置会话样式仍为 Auto/Card/Article；Auto 会话的普通渲染还可直接使用 `style: "free"`（无 `styleId`/`temporaryStyle`，Host 记为 builtin，客户端按内置自由版式回放）；强制 Card/Article 会话仍拒绝 free。保存模板的 `baseLayout` 为 `RenderLayout`（card/article/free）。选中自由模板时传 `style: "free"` 与精确 `styleId`，不带 `temporaryStyle`；Host 保留模板 ID 与布局一致性校验。按需操作期间不注入会话外壳提示；布局由用户请求决定，有实质歧义时先问一个聚焦问题，不静默默认。成功值含 `statements`、`style`、`styleSource: builtin|template|temporary`，以及可选 `styleId`、`document`、`warnings`；普通渲染还会在 `presentationMeta` 记录 `style`/`styleSource`（以及文档模式的 `document: true`），供落定后的自由布局与文档结果回放；快照由工具参数承载、不在成功值中复制，而 B1 style edit 的成功值会回传 `styleEdit`/`temporaryStyle`/`title` 供客户端渲染修订卡。

Host 按操作类型强制校验布局：`generate` 的 `style` 和 `temporaryStyle.baseLayout` 必须均为 `free`；`adjust` 必须均与 `parentResultId` 在结果注册表中的快照 `baseLayout` 一致（free 保持 free，旧 card/article 保持原布局）。父快照缺失（包括被最近 200 条上限淘汰）时拒绝调整，错误提示用户取消后重新按需生成；不从模型参数或对话推断父布局。拒绝不写结果、不完成操作，历史工具参数仍可重放。

优先级是：当前调用已授权的临时样式 → 会话样式覆盖 → 全局默认 → Auto。会话样式只决定「出页面时」的版式；是否出页面由模型按回答判断（用户显式要求渲染、`/intelligent-ui` 显式调用、按需生成与编辑请求除外）。临时样式不写会话/全局设置。已选自定义模板时，普通调用必须传准确的 `styleId` 和模板的基础版式。模板或 catalog 不可用时客户端降级默认主题；没有显式主题的临时快照同样继承当前选中模板或内置主题，而不是独立于模板库。

### Operation 与会话事件

`host/on-demand.ts` 维护每会话一个 Operation，含 Host 生成的 `operationId`、会话/可选客户端标识、首次人工消息的 `triggerMessageId`、generate/adjust 类型、可选 `parentResultId`、澄清轮数、结果 ID 与时间戳。`/iui on-demand [off|<client-instance-token> [adjust <resultId>]]` 武装或取消；插件必须先在该会话启用。armed 状态下再次武装会替换活动操作，不改选中的样式；已经绑定消息的 running/clarifying 操作拒绝再次武装，必须先显式取消，避免第二下点击撤销模型即将提交的授权。

状态为 `armed → running ↔ clarifying → completed`，也可进入 `failed`、`cancelled`、`interrupted`。armed 在读取时检查 10 分钟 TTL；控制器最多保留 256 个会话，不因容量静默淘汰活动操作。操作仅在内存，重启后视图清空（不重建 interrupted 记录），必须重新武装。

控制器以前置 `session/event` 监听更新状态后再投影；按单调 seq 去重，以 turn 限定工具事件。首条人工 `user/message` 绑定操作，技能/文件等注入消息被忽略。注意 DSH 在 step 内先把 `system/message` 追加到 surface，随后才追加本次 `user/message`；因此提示词必须在 **armed** 阶段就注入 ON-DEMAND note，绑定后继续注入，否则首轮模型看不到按需契约。已绑定（running/clarifying）的按需 turn 里，不带 `temporaryStyle` 的普通 `render_ui` 会被 Host 拒绝，要求模型改用临时快照或先提问；`tool/call render_ui` 登记 callId（最多 8 次尝试），临时授权同时要求绑定消息、活动状态与当前 callId。Host 完成校验、持久化结果后同步完成操作；完成/取消后迟到调用失去授权。无渲染的 completed turn 回到 armed/resume；只有 error/abort 才进入 failed/cancelled/interrupted。

`ask_user_question` 事件进入 clarifying；尚未回答时不能提交临时 render。匹配的结构化工具结果（`answers` 数组）或带匹配 callId 的 `user-question-reply` 恢复 running；超时不算回答，错误提问结果为 failed，最多两轮澄清。提示词要求每轮 1–3 问、可选项/自由补充/跳过取决于 DSH 工具支持；扩展不改写内置提问 UI。缺少内容/数据时要求模型先提问而不是编造，并优先用**无选项的自由输入问题**取得文本、文件路径或链接，避免内置选项无法承载粘贴内容。工具不可用时文字提问降级；completed 且无 render 会进入 resume，下一条消息继续，无需在回答前重新武装（过期、重启或失败后除外）。

一轮以 completed 结束但没有 render 时（典型是模型用文字要求补充内容），操作不会直接丢弃，而是回到 armed 并带 `resume` 标记：composer 提示保留并显示“继续按需生成”，下一条人工消息再次绑定同一操作；只有成功生成临时结果（completed）或用户取消后才清理提示。

projection v6 在 enable/style/pending 之外携带可空 `onDemand`（operationId、状态、类型、parentResultId、clientInstanceId、resultIds、可选 resume）。恢复历史事件不会授权新操作。`OnDemandHint` 在 armed/running/clarifying 且客户端标识匹配时显示：armed 展示说明、示例与取消；running/clarifying 展示状态和轻量加载指示；resume armed 展示“继续按需生成”并隐藏示例。失败/中断终态也保留提示，提供“重试”（重新武装）与“关闭”（仅隐藏本标签页提示），不再静默消失。示例填入不发送，保留草稿；成功 render 或取消后提示才消失。Host 仍绑定会话的下一条人工消息，不校验发送标签来源；这种多标签页收敛不能当作消息元数据级隔离。

### 保存与模板管理

`result-store.ts` 把最近 200 条不可变临时快照原子写入 `<DSH_HOME>/dsh-intelligent-ui-results.json`，记录 `resultId = tool callId`、sessionId、snapshot、可选 parentResultId、createdAt。每次调整产生新 callId；当前实现没有独立 revisionId，保存的是点击结果的 ID。工具参数有完整快照时，即使注册表淘汰，历史仍可重放，但事后保存返回 `result_missing`。

`style-store.ts` 把模板写入 `<DSH_HOME>/dsh-intelligent-ui-styles.json`（仍为 `version: 1`；free 为新增布局值，无需迁移）；global 最多 40 个，session 每会话最多 20 个。`GET /api/intelligent-ui/styles?sessionId=…` 返回全局与该会话模板；同一路由 POST 支持 `save`、`saveFromResult`、`update`、`delete`。路由仅在 `webServer` 与 `connection.requestRejection` 可用时注册；先认证，JSON 请求限 64 KiB/15 秒，响应 no-store。

`saveFromResult` 收 resultId、名称、描述、范围与可选 sessionId；不接受 `baseLayout`（包括旧客户端的布局选择），也不接受浏览器提供的 directives/theme。Host 从注册表快照精确复制 baseLayout/directives/theme；无主题快照返回 400 `no_theme`，客户端也不显示「保存为模板」，因为模板需要自己的 palette。session 范围必须与结果所属会话一致。保存不选中模板，也不写全局默认；重复名称报错，服务端没有独立幂等键。`update` 只允许名称/描述/directives，`delete` 删除模板。Composer 管理可见模板；设置页管理全局模板及文件导出/导入。删除当前选择会尝试回退 Auto；其他会话遇到失效引用按缺失模板处理。

### 可移植模板交换 v1

纯共享模块 `src/shared/style-template-exchange.ts` 不依赖 React、DOM 或 DSH，提供 `toPortableStyle`、`createStyleExport`、`encodeStyleExport` 与 `parseStyleExport`。Envelope 的顶层键固定为 `kind: "dsh-intelligent-ui/style-template"`、`schemaVersion: 1`、`template`；模板仅包含按序构建的 `name`、`description`、`baseLayout: card|article|free`、`directives`、`theme`。description 可缺省，解析为 `''`；其他字段必填。所有层级拒绝未知键（包括 `__proto__`、`constructor`、`prototype`）；主题复用 `isStyleTheme` 的 hex/枚举白名单，标签及规范沿用长度/字符规则。名称与描述额外剥离 Unicode `Cf` 并 trim，空名称或保留名称拒绝。主题与 palette 也显式重建并固定字段顺序，`JSON.stringify(value, null, 2)` 使同一配置产生相同字节；不带 id、scope、sessionId、时间戳、包版本、导出时间、作者、签名或校验和。

输入先按 `TextEncoder` 计算 UTF-8 字节，最多 32 KiB；文件选择先检查 `File.size`，超限不读取，不依赖文件名/MIME。允许全文的一层 `json` 或无语言 Markdown 代码围栏，不在任意文字中搜索 JSON。外部名称/描述/指令剥离 `Cf`、`Default_Ignorable_Code_Point` 与 U+2800；名称/描述还把 U+2028/U+2029 归一为空格。不兼容旧版原始模板导出：原始对象、持久化库文件 `{version:1, templates:[…]}` 与其他非 Envelope 形状一律以 `invalid_structure` 拒绝，不做模糊识别。错误统一为 `StyleExchangeError` 的 `empty_input`、`too_large`、`invalid_json`、`invalid_structure`、`unsupported_version`、`invalid_template`，UI 映射双语文案，不显示原始异常。

设置页「我的样式」与 Composer「显示样式」面板共用导出菜单（Composer 会话模板也可导出）：先确认名称/描述/规范全文/主题的公开范围，再用 `fileStem` 下载 `<模板名>.iui-style.json`（application/json）；anchor 临时挂载、设置 noopener、移除并延时回收 URL。两处「导入模板」入口（设置页与 Composer 面板）复用 `TemplateImport` 的文件/粘贴输入进入同一 codec，均只创建全局模板；预览可编辑名称（30）、描述（100）、规范（2000）或清空规范，显示布局、明暗 canvas/ink/accent 色板及完整规范。所有外部内容（名称、描述与规范）都必须显式阅读确认，修改名称/规范会重置确认。所有外部文本使用 React 文本节点/表单字段，不执行 HTML 或 Markdown。全局名称大小写冲突建议截断后的 `(Imported)` 名称，仍冲突阻止确认；全局满 40 个禁止导入，Host 的 duplicate_name/limit_reached 仍是权威结果。错误保留输入；busy 与同步 flight 标记防止重复提交，Popover 支持 Escape、焦点返回及键盘循环。

确认后 `StyleActions.createTemplate` 复用认证的 `POST /api/intelligent-ui/styles`，请求仅为 `{op:'save', template:{name,description,baseLayout,directives,theme}, scope:'global'}`，不带 sessionId；响应须通过 `isStyleTemplate`。Host 保持五字段白名单、主题/名称/规范校验、跨范围重名、配额和原子写，重新生成 id 与时间戳。成功刷新 catalog、关闭弹窗并显示状态，不写设置、不自动应用。导入后即普通全局模板，使用现有选用/改名/编辑/删除/再导出路径。没有新增 Host 端点、存储格式或模型调用；Composer 面板复用同一导出/导入组件（导出覆盖会话模板，导入仍只写全局），会话作用域导入延后。没有分享码/链接/在线库/批量导入。

**兼容承诺**：模板交换格式 v1 只含可移植样式配置及全部三种当前布局，不含本地身份与会话元数据。支持 v1 的插件版本可以导入；未知交换版本明确拒绝，不做降级猜测。原始模板导出不在兼容范围内。交换版本独立于 npm 包版本；未来 v2 应保留 v1 解析分支，新增布局值或移除 baseLayout 需要显式演进格式，v1 不静默接受未知布局。

**信任边界与计划差异**：当前实现按 owner 已确认的方案（2026-10-24）用「免责声明 + 外部内容阅读确认后保留」替代计划中的「执行审计前强制仅外观」；原计划/评审记录保留。外部名称与 directives 会进入提示词，描述仅保存/导出、不进入提示词；这些外部内容都按不可信文本处理。预览、可编辑/清空、免责声明确认与不自动应用都是缓解，不能保证消除提示词注入。DISPLAY PREFERENCES/JSON 编码也不提供执行隔离。真正权限仍属于 DSH 工具/权限执行层；执行层工具权限与真实部署 Origin/CSRF 审计是发布前建议补做的加固项。本轮仅验证既有 requestRejection 委托与路由拒绝行为，不将 stub 认证测试描述为真实部署 Origin/CSRF 审计或工具越权已验证。

### 卡片主题、操作与安全边界

`programs.ts` 从记录的调用参数提取并防御性校验临时快照，拒绝混合来源/版式不一致，跳过失败调用与已离开历史窗口的参数。`IntelligentUICards` 以临时快照主题优先，其次按 `styleId` 解析已保存模板，无 `theme` 的临时快照再继承会话当前选中模板的主题（live 卡片与 HTML 导出共用同一解析），最后回退内置主题；`resolveStyleThemeVars` 只把允许的字段映射到 renderer host CSS 变量。明暗方案跟随 DSH body 标记（外部使用系统偏好）；portaled Popover 与沙盒 iframe 保留默认主题，状态语义色由 CSS 管理。

临时结果显示「临时样式」标记与「保存为模板」；样式调整在支持新 Host 且可编辑的卡片上位于编辑画布的「样式 → 更改样式」区（旧 Host/不可编辑卡片仍显示底部「调整样式」回退按钮；被重定向的只读回退卡不显示 Save/Adjust），不再有独立的扩展操作。保存 Popover 收名称/描述/可用范围；不再选择 Card/Article。Host 精确保存原布局、已校验主题和偏好，原结果保持不变，不调用模型；旧快照继续原有保存流程并保留布局。自由模板有本地组合预览和「自由布局」提示，支持选用、重命名、编辑偏好与删除。模板结果保留 DSH 卡片标题栏，无临时样式标记及调整/保存操作；free 不添加 Article wrapper，不强制 Toc/Section，使用模板明暗主题。设置页只做全局默认、已保存模板管理、编排与导出；生成发生在 Composer。

主题只接受 light/dark 六位 hex palette 与 font/radius/density/shadow 枚举，拒绝未知键、任意 CSS/脚本/URL；临时样式的 ink/canvas、accent/canvas 在两种方案下至少 3:1，低于 4.5:1 警告。directives 最多 2,000 字符；已保存模板注入提示词时作为 JSON 字符串包在 DISPLAY PREFERENCES 边界中，明确无权覆盖系统、工具或安全规则。临时 directives 是结果数据，不提升为系统指令。模型不能自行武装、保存模板或改变默认值；`HtmlView` 原有沙盒边界仍适用。

重放解析接受带合法 styleId 的 free 模板调用，无来源的 free、无效快照与 styleId/temporaryStyle 混用仍不渲染。重放与 `programsToExportCards` 保留临时结果及模板的 free 布局；PNG 截取实际组件组合。独立 HTML 中自由结果使用可用页面宽度，Card/Article 保留 760px 宽度、卡片列间距与 live 一致（12px），包括混合导出；逐结果解析的主题与明暗模式仍内联冻结。

界面状态结构：进行中的写入/命令不能折算成视觉 `disabled`。设置页没有可渲染的 pending 状态，保存只通过 `sectionRef` 命令式设置 `aria-busy`；Composer 面板拆为独立的 `StylePanel`，只接收可用性（`disabled`）与回调，父级 `busy`/`pending` 不在其作用域；On-demand 的 arming 状态在 `StylePicker` 内部。新增控件位于这些边界内时拿不到瞬时命令状态，因此无法把一次保存/切换变成整块控件的 disabled/opacity 闪烁。只有拥有该异步操作的控件可以短暂禁用自己（如 On-demand 入口、导入弹窗的提交按钮）。CSS 的 `:disabled { opacity }` 仍保留，因此新边界若重新引入瞬时 `disabled` 仍会闪；应通过可用的 `locked`/`panelDisabled` 语义表达不可用。

## Artifact 区块编辑与编排

已渲染完成的页面可以在原卡片里继续局部修改：卡片标题栏右侧提供「编辑」入口，进入后页面换成只读画布加右侧「Artifact 编辑器」。编辑器把「改内容」和「调顺序」分开：用户为区块填写修改说明（保存后才生成请求），并在「区块编排」里用拖拽或键盘调整全部顶层区块的先后。发送时两者都只是同一个结构化请求的一部分；模型按请求类型调用一次工具——内容修改走 `edit_ui_blocks` 返回选中区块片段，只调顺序/整体说明走 `render_ui` 返回完整程序——Host 合并并记录为同一 Artifact 的新修订，客户端在卡片历史图标上显示修订号。支持只改内容、只调顺序（`edits` 为空数组）以及两者同时，整体说明可选。同一聊天可以并行保留多份卡片编辑草稿——单画布激活、每份草稿一个 Composer chip、每份带稳定 `requestId`；一次发送把最多 3 个 Artifact 的请求合并为同一条用户消息（多个 V1 信封），Host 按请求逐个应用并各自记录修订。

### 区块识别与稳定引用

- 编辑入口只出现在可编辑的卡片上：程序已解析、根是 `Col`、至少有一个可识别顶层区块、调用已结束；临时样式结果也可编辑（内容编辑与编辑内自然语言样式调整，见 M3-4 与 B1）。`src/shared/artifact-blocks.ts` 的 `extractArtifactBlocks` 用与 Host 相同的 `vendor/spec.json` 解析程序。
- 可编辑区块是根 `Col` 的**全部直接元素子节点**（以及 7 类嵌套容器的直接子节点，M4-6）；`Caption`、`Divider`、`Spacer`、`Toc` 与根层 `Title` 现在同样是可编辑区块，不再按页面 chrome 排除。真正的安全排除只剩：`@Each` 模板、opaque 表达式、共享命名表达式、深度/节点上限，以及“复制包含 `Section`/`Toc` anchor 的子树”。`ArtifactBlock` 同时给出 `blockId`（`b<originalIndex>`）、`nodePath`（`root[rootIndex]`）、`originalIndex`（区块在基础版本可编辑区块中的 1 基序号）、`rootIndex`（在所有根子节点中的 0 基序号）、`componentType`、`kind`（section/card/table/chart/interactive/drawing/media/container/divider/spacer/toc/heading/caption/content）与可选 `statementId`/`title`。标题来自区块内 `Title`/`Caption`、`Section.title`、`Toc.items`、`Table.columns` 或首段文本，不依赖屏幕坐标。
- 身份只在基础修订内稳定：编排只改变 `targetOrder`，不重写 `blockId`/`originalIndex`/`nodePath`；请求里另带保存时分配的 `selectionOrder`。因此调换顺序不会改变区块引用，也不会重排已保存请求的编号。
- `wrapProgramForBlockEditing` 只重写根语句：把每个可编辑子节点包进内部组件 `BlockSlot("bN", N, [...])`，其他子节点与根尾部参数按源码保留；编辑视图用这份包裹后的程序走正常渲染器，因此轮廓、编号与浮层都挂在真实 DOM 节点上。`BlockSlot` 只注册在 `library.ts` 的 `blockEditLibrary` 中（由 `render.tsx` 的 `blockSlots` 开关启用），不进入模型组件目录（57 个组件不变）。
- 程序形态无法支持时返回原因（unparsed / no_root / incomplete / parse_error / root_not_col / empty_root / no_blocks），卡片不显示编辑入口。

### Artifact 编辑器：请求与区块编排

- 浏览器 `artifact-edit/store.ts` 以 `${sessionId}:${baseRevisionId}` 为草稿 key 保存编辑会话：`originalOrder`（基础版本的区块 id 页面顺序）、`targetOrder`（当前编排草稿）、`orderChanged`、已保存请求 `selection`（含编号与修改说明）、整体说明、当前打开的区块、抽屉展开与检查/冲突状态。同一聊天可同时保留多份这样的草稿，但只有一个 active 编辑画布（`activeKeys`）；切换卡片时前一份草稿保留（`editing=false`），已填内容不丢。退出编辑后请求、编排与 Composer chip 保留。
- 每份草稿有稳定 `requestId`（`req_` + 12 位 base36，优先 `crypto.getRandomValues`）与 `attached` 标记。同一聊天最多 6 份有内容草稿（超出时打开编辑返回 `limit`，卡片显示上限提示），每次发送最多 3 份 attached（其余 detached，可附加）；关闭空画布草稿会丢弃，有内容草稿关闭后保留为 detached，仍出现在切换区与卡片角标。
- 编辑器顶部新增「待提交编辑 (N/6)」切换区（`data-dsh-iui-edit-draft-switcher`）：列出本聊天所有有内容草稿（标题、修订号、修改摘要、active 圆点、冲突/未附加标签、附加/丢弃按钮）；点击切换 active 画布，只有 active 草稿的请求列表/编排/整体说明区显示在下方。非 active 草稿在卡片头部显示角标；通过切换区或卡片编辑入口激活草稿时，对应卡片会滚动到视野内。
- 打开区块浮层只是草稿，不生成请求；保存非空修改说明才创建请求，并分配当前最小可用编号（删除后可复用）。编号只属于请求，是「编辑请求」行号、区块角标与六色循环（蓝、紫、绿、橙、粉、青，编号 1–6 循环）的依据；没有请求的区块不显示编号、颜色或「已编辑」标签。保存空说明会删除该区块的请求。
- 编辑器顶部是标题「Artifact 编辑器」与窄屏关闭抽屉按钮（桌面停靠栏无展开/收起按钮）。「编辑请求」列表只在存在已保存请求时出现：数量、右对齐的「清空」（只清请求，保留编排与整体说明），以及每项的编号、标题、修改说明与编辑/删除按钮。
- 「区块编排」始终可见：标题「区块编排」+「· N 个区块」、重置顺序与提示「拖拽调整区块顺序，点击区块可查看或添加编辑需求。」。重置顺序只把 `targetOrder` 恢复为基础版本的页面顺序，保留全部请求、编号与整体说明。列表按 `targetOrder` 列出全部顶层区块：拖拽把手（指针拖拽，4px 阈值、按行中点显示 2px 插入线，放下才调用一次 `moveBlock`；键盘 ↑/↓ 与 Home/End 也可重排）、只定位不打开浮层的正文（滚动到画布中的区块并高亮约 900ms）、类型图标、截断标题、有请求时的编号/颜色与「已编辑」标签，以及行尾打开操作菜单的「更多」按钮（定位/编辑/复制/移动到/删除，删除在菜单内二次确认）；悬停有请求的行约 180ms 后显示锚定的小卡片（标题、编号、全文与编辑/删除）。
- 编排草稿在编辑画布内实时预览：`wrapProgramForBlockEditing(program, extraction, targetOrder)` 按 `targetOrder` 重排真实 `BlockSlot` 包裹的顺序，工具栏显示「预览目标顺序」；预览只影响编辑态，已记录的修订与导出在发送前保持不变。
- 编辑器内容顺序固定为：头部 →（有请求时）编辑请求 →（可撤销的删除提示）→ 区块编排 → 分隔线 → 「整体编辑说明（可选）」→「将发送给模型」摘要（区块编辑需求 N 项、结构顺序 保持原样/已调整、整体说明 已填写/未填写）与说明。宽视口（≥1180px）是右侧停靠栏（宽度自适应，无展开按钮）；720–1179px 折叠为底部抽屉，由工具栏的「编辑请求（{count}）」按钮打开；小于 720px 不提供区块编辑，卡片与活动编辑视图都显示「窗口太窄」提示（包含最小宽度说明、关闭或退出按钮），加宽窗口后恢复。冲突时显示「Artifact 已有更新的版本」横幅，可重试或退出；检查中显示「正在检查 Artifact…」。
- 编辑期间每 15 秒以及窗口重新聚焦/由隐藏转为可见时调用 `probeArtifactRevisionStatus` 做静默修订探测；只有返回 `conflict` 才会把会话置为冲突（不会自动清除冲突），并发更新因此在发送前就显示冲突横幅。
- 修改说明通过区块浮层编辑：Escape/外部点击关闭，未保存文本先做行内放弃确认；单条最多 2,000 字符，整体说明最多 4,000 字符，单次最多 12 条内容修改。

### Composer chip 与模型信封

- 每份 attached 且有内容的草稿在输入框中各有一个引用 chip（按 ref upsert/remove，互不影响），普通发送时每个 chip 走自己的 codec、串成同一条用户消息。chip 标签为「编辑 {title} · 修订 {N} · {摘要}」（摘要：N 项修改 / 调整区块顺序 / 整体说明；title 缺省用「Artifact 编辑器」），一次发送最多 3 个 attached chip。手动删除某个 chip 只把该草稿标记为 detached（保留草稿、不自动重插，可在切换区或卡片重新附加）；800ms 的存在性检查用于区分“用户删除”与“store 自身替换”。发送前客户端用修订查询接口确认基础版本仍是最新，冲突时中止发送并提示刷新。
- chip 引用 id 是确定性的 `artifact-edit:<sessionId>:<baseRevisionId>`（只由草稿 key 派生），刷新后仍可解析；草稿已不存在或引用无法解析时发送返回 `stale` 并显示 `edit.errorStale`（可删除 chip 后重开编辑）。
- 引用源 codec 由 `serializeArtifactEditRequest` 组装 `ArtifactEditRequest`：`schemaVersion: 1`、`requestId`（草稿稳定 id）、`artifactId`、`baseRevisionId`、`baseRevision`、可选 `title`、`style`、可选 `styleId`、按 `selectionOrder` 排序的 `edits`（可为空）、完整 `targetOrder`、仅在顺序确实变化时带 `orderChanged: true` 的客户端提示、可选 `globalInstruction` 与用户当时看到的 `program`。至少要有内容修改、顺序调整或整体说明之一，否则不发送；`targetOrder` 必须恰好包含基础版本的全部顶层区块 id（最多 100 个）。
- 同一条用户消息可包含多个信封（每个 chip 一个 V1 信封，未引入 V2 复合信封）；JSON 头带 `requestId`，prose 要求模型在 `edit_ui_blocks` 参数里带 `requestId` + `artifactId`（内容修改）或 `render_ui` 参数里带 `editRequestId`（只调顺序/整体说明）。信封 = `<artifact-edit-request>` + JSON 头（`<` 转义为 `\u003c`）+ 英文编辑规则 + 目标区块清单（无内容修改时省略）+ 目标顺序清单 + `<artifact-program>` 原始程序。规则按请求类型分流：有内容修改时要求调用一次 `edit_ui_blocks`，返回 `root = Col([...])` 的微程序（每个目标区块一个顶层表达式、按请求顺序；可带新辅助语句，但不得重定义既有语句/`$state`；不返回整页，页面只作只读上下文）；只有顺序/整体说明时要求一次 `render_ui` 返回完整程序。两类都要求只改目标区块及最小关联部分、保持记录样式、把根 `Col` 的顶层区块调整到目标顺序且不新增/删除/合并/重复区块、有实质歧义先问。
- 已发送的用户消息按信封逐条折叠为多个摘要 chip（每条一个，`artifact-edit-summary` 节点按信封归属计算范围），周围补充文字仍可读；历史消息里的 chip 不可交互。

### 多卡片并行编辑（M3-1）

- 草稿与画布分离：`activeKeys` 记录每聊天当前 active 草稿，`editingSessionFor` 只返回 active 草稿，`draftSessionsFor` 返回切换区列表；切换卡片保留前一份草稿的 selection/targetOrder/global。删除旧的 `closeOtherEditors` 语义。
- 草稿上限与附加：每聊天最多 6 份有内容草稿（`MAX_ARTIFACT_DRAFTS`），打开编辑超过上限返回 `{ok:false, reason:'limit'}`；每次发送最多 3 个 attached（`MAX_ARTIFACT_BATCH_REQUESTS`），额度满时新草稿以 detached 创建。
- 每草稿稳定 `requestId`（`req_` + 12 位 base36，优先 `crypto.getRandomValues`），序列化时写入信封；发送成功后草稿标记 submitted 并释放 chip，下次编辑时重建新 `requestId`。
- Host v1 是「多个 V1 信封 + 内部 batch」：observer 用 `parseEditRequestTexts` 逐信封解析，每条消息最多 3 个信封，按 `requestId` 存入每会话 Map（`requestId`/`artifactId`/`mode: block|full`/`messageId`/`createdAt`，TTL 15 分钟，每会话最多 3 条 pending，同 Artifact 同消息只接受第一条）；旧客户端单信封无 `requestId` 时生成 legacy id 并保持原单 pending 行为；超出消息上限的请求被忽略并记录日志。
- 工具选择：多 pending 时 `edit_ui_blocks` 需带 `requestId`（可选 `artifactId` 校验归属），`render_ui` 需带 `editRequestId`；缺 selector、未知 id 或 artifactId 不匹配返回模型可读错误并列出可用 pending，所有 pending 保持 armed。apply 只消费选中的那一条，其余保留；每个请求独立校验、独立记录修订，无跨 Artifact 事务——一项失败不回滚其他成功项。
- v1 与外部设计（GPT）的差异：不引入 V2 复合信封（传输层仍是每 chip 一个 V1 信封）；请求程序仍以信封内 `program` 为权威，修订注册表级程序校验/摘要属 Phase 2 加固；`messageId` 仅尽力记录，turn 级对账见下节（客户端 side，M3-1c）；纯排序仍走 `render_ui`（带 `editRequestId`），零模型执行留作后续。共享契约还声明了批次上限常量（每批 24 条区块修改 / 120k 字符程序总量），执行侧暂未强制，属 Phase 2 加固。

### 修订对账（M3-1c）

- 修订 meta 通过 `ArtifactRevisionMeta.requestId` 回传本次修订满足的请求 id：Host 在 `apply()` 的 lineage 中带上 pending request 的 `requestId`，`render_ui` 与 `edit_ui_blocks` 两条路径的 `OUTPUT`/`BLOCK_EDIT_OUTPUT`、`presentationMeta` 都透传；客户端 `IntelligentUIProgram.requestId` 从卡片 meta 读回（`programs.ts` 的 `revisionLineage`/`blockEditProgram`）。
- 发送成功后草稿不立即删除：`markSubmitted` 置 `status:'submitted'`、记录 `requestId` 与 `submittedAt`，按提交时间保留最多 12 条未决 submitted 草稿（超限淘汰最旧）。它们不出现在切换区，也不再占用 attached 额度。
- Turn 关闭时（`IntelligentUICards` 监听 `turn.status === 'closed'`，每个 Turn 只对账一次）收集该 Turn 卡片里的 `requestId`，以 `turn.start.time - 5000` 到 `turn.end.time` 为时间窗口调用 `reconcileArtifactSubmissions`：窗口内匹配到本次修订的 submitted 草稿删除；未匹配的恢复为 `status:'ready'`、`submitFailed:true`、`attached:false`、新 `requestId`、清空 `submittedAt`，内容保持可编辑。
- UI：卡片草稿角标新增 `data-state="failed"`，文案「未完成，草稿已保留」（`edit.draftFailed`）；编辑面板切换区对应行显示 `is-failed` 标签（title 为 `edit.draftFailedHint`）。激活草稿或重新附加会清除 `submitFailed`；附加只把草稿加回下一次发送，不会自动重发。
- 边界与限制：Host 未完成的 pending 仍按 15 分钟 TTL 保留，Turn 关闭不清理；Turn 归属靠发送时间窗口启发式（历史 Turn 不会认领新提交，极端时钟/长延迟场景未验证）；每个请求独立记录修订（无跨 Artifact 事务），因此「部分成功」是正常路径；真实模型的部分成功路径未做真机验证（E2E 用 harness 模拟 Turn 关闭/部分完成；真机只覆盖单卡/双卡成功路径）。

### 分支编辑（M3-2）

- 信封 JSON 头新增可选 `branch: true`（`ArtifactEditRequest.branch`，prose 增加「这是分支编辑」说明；旧客户端不发送即普通编辑）。客户端在旧修订的冲突横幅提供「从此修订创建新修订」（`data-dsh-iui-edit-branch`）：`enableBranch` 只在 `status === 'conflict'` 且已知 `latestRevision` 时生效，置 `branch: true`、恢复 `ready` 并把冲突横幅替换为提示条 `data-dsh-iui-edit-branch-note`（`edit.branchBannerTitle`/`Body`，显示 base 修订与最新修订）；chip 标签追加「 · 分支」（`edit.chip.branchSuffix`）。
- 客户端不再因 head 不一致阻断 branch 草稿：发送前仍 probe 修订，但 `branch !== true` 时才把 conflict 当发送错误；序列化请求带 `branch: true` 与旧 `baseRevisionId`。草稿关闭/重开保留 branch；发送成功后 `markSubmitted` 清除 branch；若提交失败被 Turn 关闭对账恢复为 failed 草稿，branch 标记会丢失，需要重新在冲突横幅启用（已知边界）。
- Host 在 `describeProblem` 与 `apply` 中对 branch 请求放宽 latest 检查：base 记录存在时必须同 artifact 且 `record.revision === request.baseRevision`；未记录的 base 只允许 `baseRevision === 1`（首个 render 未入库）；否则返回模型可读错误且不消费 pending。新修订号 = 该 artifact 当前 latest 的 revision + 1（无最新记录时 `baseRevision + 1`），`baseRevisionId` 指向被选择的旧修订；targetOrder 确定性重排、保留警告、`requestId` meta 不变；超过 100,000 修订号时拒绝。非 branch 路径保持严格 latest 校验与旧错误文案。
- 限制：分支让「最新修订」与卡片显示的修订可能分离，UI 以 branch note 说明；真实模型的「分支部分失败」未单独验证。

### 零模型恢复与本地修订卡片（M3-2）

- Host 恢复路由：在现有认证/`effect`/dispose 下新增精确路由 **`POST /api/intelligent-ui/artifact-restore`**（与 GET 修订查询共用一个 disposer；GET 行为不变）。请求体 `ArtifactRestoreRequest`（`schemaVersion: 1`、`artifactId`、`sourceRevisionId`、`program`）：要求 `content-type: application/json`、body ≤ 300 KiB、15 秒超时，`describeArtifactRestoreProblem` 校验；source 必须存在于注册表（否则 404 `source_missing`）、属于同一 artifact（否则 400 `artifact_mismatch`）、不是 latest（latest → 409 `already_latest`）；program 必须能解析且根为 `Col`（否则 400 `invalid_program`）；revision 超过 100,000 返回 400 `revision_limit`；非 POST 返回 405 `method_not_allowed`。错误统一 `{error:{code,message}}`（400/404/409/413/405），响应 `no-store`。
- 成功返回 **201** `{ok:true, revision:{artifactId, revisionId, baseRevisionId, revision, program, title?, style, styleId?}}`；记录 `revision = latest + 1`、`revisionId = restore_<16 hex>`（随机 8 字节，冲突重试最多 8 次）、`baseRevisionId = sourceRevisionId`、`sessionId = "local-restore"`，复制 source 的 `style`/`styleId`/`title`，program 不写入注册表（由响应携带）。这不需要模型调用，也不改变 HEAD/latest 之外的既有修订。
- 客户端 `src/client/artifact-edit/local-revisions.ts`：卡片在 GET probe 报告 conflict（即非 latest）时显示「恢复为新修订」（`data-dsh-iui-restore`；latest 卡片与 `localRevision` 卡片不显示），点击 POST 恢复；成功结果存为 `LocalArtifactRevision` 写入 **`localStorage`**（key `dsh-intelligent-ui-local-revisions:v1:<sessionId>`，每会话最多 20 张，按 `revisionId` 去重/替换、按 `createdAt` 淘汰最旧），并写入 `localRevisionProgram()` 供渲染（`localRevision: true`、`artifactId`/`revisionId`/`baseRevisionId`/`revision`、`style`/`styleId`、可继续编辑）。本地卡片按 `turn`（触发恢复的 Turn）过滤渲染，在该 Turn 的卡片列表中出现一次；`IntelligentUICards` 用 `useLocalRevisions` 合并本地卡片与工具结果卡片。
- 限制：本地卡片只存在于浏览器 localStorage——清存储或换设备会丢失；不进入 assistant 消息条目，也不参与导出、图片导出、回放链（这些仍只认工具结果/meta 卡片）；恢复只对非 latest 修订可用；本地卡片渲染在触发恢复的 Turn，而不是对话最底部；真实模型「分支部分失败」未单独验证。

### 编辑草稿持久化（M3-3a）

- `store.ts` 把未提交草稿按标签页写入 `sessionStorage`：每条草稿键 `dsh-iui-edit-draft:v1:<sessionId>:<baseRevisionId>`，每会话索引键 `dsh-iui-edit-draft-index:v1:<sessionId>`。只持久化恢复所需字段：`key`/`sessionId`/`artifactId`/`baseRevisionId`/`baseRevision`/`requestId`/可选 `title`/`style`/可选 `styleId`/`program`/`originalOrder`/`targetOrder`/`orderChanged`/`selection`（`blockId`/`order`/`instruction`）/`globalInstruction`/`attached`；`blocks` 与包裹程序在恢复时用 `blocksForProgram`/`wrapProgramForBlockEditing` 重新计算，瞬时 UI 状态（打开的区块/草稿文本/编辑画布状态等）不持久化。
- 写入：250ms debounce（`DRAFT_PERSIST_DELAY`），内容未变则跳过；每会话索引最多 6 条并按加入顺序淘汰最旧。清理：discard、发送成功、对账删除、空草稿 prune 都会删除记录与索引；配额/JSON/受限上下文错误静默（best-effort）。
- 懒恢复 API：`ensureArtifactDraft(key)`（幂等；内存优先；损坏/不可用记录被删除）、`hydrateArtifactDrafts(sessionId)`（按索引逐条恢复）、`flushArtifactDraftPersistence()`（立即冲刷 debounce 写，供测试/页面生命周期调用）。`editSessionFor`、`useArtifactEditSession`（挂载后 `useEffect` 水合，不在 render 中）、`serializeArtifactEditRequest`（确定性 ref 反解 key）、`draftSessionsFor`、`activeDraftKeyFor`、`activateDraft` 在内存缺失时会触发恢复。
- 恢复后的草稿：`status:'ready'`、`editing:false`、`requestId`/`attached` 保留、selection 筛选为仍存在的 `blockId`、`targetOrder` 必须仍是完整排列（无效则丢弃记录）、整体说明截断 4,000；随后重建引用映射并在 250ms 内重新同步 Composer chip（恢复的 chip 可继续发送）。
- 限制：`sessionStorage` 是 per-tab——刷新保留、**跨标签不共享**；`branch`/`latestRevision`/`submitFailed` 与撤销记录不持久化（branch 恢复后要重新在冲突横幅启用）；program 超过 200,000 字符上限不持久化；没有自动 `pagehide` flush（只能显式调用导出函数）。

### 跨标签软租约（M3-3b）

- 新增 `src/client/artifact-edit/tabs.ts`：`BroadcastChannel('dsh-iui-artifact-edit-tabs:v1')`，消息 `lease`/`release`/`query`；lease 记录 `{tabId, expiresAt}`，TTL 30 秒（`LEASE_TTL_MS`）、每 10 秒续租（`RENEW_MS`）；`tabId` 优先 `crypto.randomUUID()`。频道不可用（`BroadcastChannel` 未定义或构造抛错）时初始化为空，所有 API 退化为本地无提示。
- `ArtifactEditView` 在编辑画布打开（`session.editing`）时 `queryEditLeases()`，400ms 后在无 foreign lease 时 `claimEditLease`；每 10 秒 `renewEditLease`；关闭/卸载时清理定时器并 `releaseEditLease`。存在 foreign lease 时渲染横幅 `data-dsh-iui-edit-lease-conflict`（标题/说明/「接管编辑」按钮 `data-dsh-iui-edit-lease-takeover`）；点击 `claimEditLease(key, true)` 强制接管——本标签横幅消失，原标签收到 lease 后显示横幅；过期 lease 由 `activeLease` 惰性清理。
- 限制：租约只提示，**不合并修改、不阻止编辑**；只覆盖“正在编辑”的修订，不覆盖草稿所有未发送修改；接管只转移提示归属，不回滚另一标签未发送的修改；频道不可用时无提示；Host 的修订校验仍是最终权威；极端并发/过期时钟未验证。

### 临时样式区块编辑（M3-4）

- 契约：`ArtifactEditRequest.temporaryStyle?: StyleSnapshot` 与 `ArtifactRevisionMeta.temporaryStyle?`；校验要求 `isStyleSnapshot`、`baseLayout === style`、不能与 `styleId` 同时出现、JSON ≤ 20,000 字符。信封 header 携带该快照，内容编辑 prose 说明 Host 复用快照、不要把 style/styleId 传给 `edit_ui_blocks`。
- 客户端：`supportsBlockEditing` 允许 `styleSource === 'temporary'` 且带有效快照的卡片（仍要求非 running、可识别区块、可包裹）；编辑会话保存 `temporaryStyle`/`style`（`styleId` 置空）。serialize 时内容编辑请求带 `temporaryStyle`、不带 `styleId`；只有排序/只有整体说明的临时样式请求在 probe 之前返回 `{ok:false, problem:'temporary_order'}` → `edit.errorTemporaryOrder`（草稿不消费）；内容+排序混合请求允许并由 Host 确定性重排。草稿持久化 payload 可带快照（恢复时校验 `isStyleSnapshot`/`baseLayout`，≤20k），`programs.ts` 从 revision meta 读回 `temporaryStyle` 与 `styleSource:'temporary'`，本地恢复卡片也复制快照。
- Host：`ArtifactRevisionRecord` 增加可选 `temporaryStyle`（`isStyleSnapshot` + `baseLayout === style` + JSON ≤ 20,000，旧 registry 文件兼容）；`edit_ui_blocks` 输出 schema/成功值/output meta 与 `presentationMeta`/lineage 透传快照，`style = snapshot.baseLayout` 且不带 `styleId`。`render_ui` 的完整程序回退对临时样式保持关闭，并给出明确错误：`render_ui: this artifact uses a result-owned temporary style, so only content edits through edit_ui_blocks are supported. Order-only or global-only edits on a temporary style are not supported; ask the user to edit the page content, or re-render it with a saved style first.` 恢复路由把 `source.temporaryStyle` 复制到新 record 与响应 `revision.temporaryStyle`。
- 限制：临时样式结果支持区块内容编辑与编辑内自然语言样式调整（B1）；纯排序/纯整体说明仍不支持（客户端阻止 + Host `render_ui` 回退拒绝），需要已保存/内置样式；没有有效快照的临时卡片不可编辑；真实模型/真机路径见 B1 验证记录（E2E 模拟 + 一次真实 GUI 冒烟）。

### 编辑内自然语言样式调整（B1，2026-11-08）

- **请求契约**：`ArtifactEditRequest` 变为判别联合——block 变体保持 header 与 program 正文兼容（prose 现由 `blockEditToolContract` 生成，整段文本不再保证字节不变）；新增 `kind: 'style'` 变体（必填 `requestId`、`style`（记录版式，修订必须保持）、`styleInstruction`（1–2000 字符）、完整 base `program`，可选 `title`/base `styleId`/base `temporaryStyle`/`branch`）。style 变体不允许 `edits`/`additions`/`targetOrder`/`orderByParent`/`orderChanged`/`strict`/`globalInstruction`（交叉字段报 `unknown_field`）；block 信封出现 `styleInstruction` 同样拒绝。序列化保留 block 信封的 header 与 program 正文兼容；`Tool-call contract:` 行由契约 helper 生成，其余说明性 prose 仍手写；信封 prose 指示模型用 `render_ui` 恰好一次、传 `editRequestId` + 完整程序 + 记录版式 + 完整 `temporaryStyle`（省略 `styleId`），并提示 Host 只告警内容变动。块信封与 style 信封的模型调用参数不靠手写 prose 维持：`blockEditToolContract`/`buildBlockEditToolArgs` 与 `styleEditToolContract`/`buildStyleEditToolArgs` 是单一契约源，序列化器据此生成 `Tool-call contract:` 行；Host 耦合测试执行这些 helper 产出的参数（block fragments/render 与 style builtin/saved/temporary），任何一侧漂移都会失败；branch 指令行同样由 `branchEnvelopeLine` 单一来源生成。
- **Host 授权与 mint**：style 请求**必须显式**携带 `editRequestId`（单条 pending style 请求不会被无 selector 的 `render_ui` 自动消费，H1）；`render_ui` 在 enabled 检查后先做无副作用 peek（H2），再进入 on-demand 授权；存在 bound 的 on-demand 操作时拒绝 style 应用（H3，避免同一 callId 双写结果快照）；style 编辑直接使用模型返回的 `temporaryStyle`（H7），与 on-demand 共用同一个 `validateTemporaryStyleSnapshot`（schema / `baseLayout === style` / 对比度）。应用后 revision 记录 `style` + 模型快照，不带 `styleId`/`editedBlockIds`；无变化的程序+快照返回 no-op 且不消费；整体重设计导致无可识别区块时补一条 H4 内容保留 warning。`edit_ui_blocks` 对 style 请求提前重定向并保持 pending。
- **快照边界（根因修复）**：`ArtifactRevisionStore.record` 在写修订文件前，若修订带 `temporaryStyle` 则先把 ResultStore 快照写到该 revision id（先快照后修订、失败可重试、不产生半状态）；`createArtifactRevisionStore` 接受可选 `results` sink，index.ts 注入。编辑/恢复/结构三条路径的临时样式修订因此都能在修订卡上「保存为模板」（此前 `SaveResultAction`/旧底部 adjust 因缺快照而 `result_missing`），且不做历史回填。
- **历史与兼容**：不新增 durable revision 字段或 `ArtifactHistorySource` 值；`historySource()` 按前缀识别 restore/structure（`struct_`），临时样式且无 `editedBlockIds` 的修订推断为 edit（历史行已显示临时样式徽标）。`presentationMeta` 只带 revision meta 允许的 `style`/`temporaryStyle`/`title`，不带 `kind`/`styleEdit`（H6）。
- **客户端与 UI**：编辑面板顶部新增样式区（记录皮肤/版式、展开按钮、≤2000 字文本域、样式修订提示、清除），样式说明直接写入草稿并阻塞与区块/排序/整体说明混用（`style_mixed`）；chip 与已发送摘要显示「样式调整」。`ArtifactEditView`/`EditPanel` 透传 `styleEditSupported`：新 Host 且卡片可编辑时隐藏底部「调整样式」回退（`saveAction` 保留），旧 Host/不可编辑卡片仍显示底部按钮（被重定向的只读回退卡不显示 Save/Adjust）；能力缺失时清空并丢弃已持久化的样式说明，避免旧 Host 收到无法解析的信封。
- **模型路径**：`render_ui` tool 描述与 `temporaryStyle`/`editRequestId` 参数说明、ARTIFACT_EDIT_NOTE、Agent Skill 与 integration 参考补充 style 路径（layout 不跨 card/article/free；内容变动告警；临时样式仅 on-demand 或 pending style 请求可 mint）。
- **限制**：自然语言样式修订把已保存/内置样式页转为结果自有临时样式（模型未给 theme 时继承会话主题，原模板主题延续留待后续）；历史来源显示为「区块编辑」+临时样式徽标；样式区只由能力位 `styleEdit` 与卡片可编辑性决定（缺 base 登记不会隐藏，应用时才报错），旧 Host/不可编辑卡片保留底部回退（被重定向的只读回退卡不显示 Save/Adjust）；确定性内置/模板样式切换见下一节。
- **验证**：Host 新增 style mint/apply/security 测试（含 H1/H3/H4 变异验证）、revision store 快照边界测试、mode 能力位；客户端新增 style 信封/混用/持久化/chip 测试与 E2E 场景（样式区、chip、style 信封字段、mock 样式修订卡、footer 回退/能力位）；最终门禁数字以实测为准。

### 确定性样式切换（零模型，2026-11-08）

- **请求契约**：既有认证 struct 路由 `POST /api/intelligent-ui/artifact-structure` 增加请求级 `targetStyle`（判别联合：`{kind:'builtin', layout:'card'|'article'}` 或 `{kind:'template', styleId:'cs_…'}`）与 `sessionStyleScope`（session 模板的解析作用域，选择器而非鉴权）。单意图规则：带 `targetStyle` 时 `operations` 必须为空（`style_with_operations`）、不支持 `preview`（`preview_not_supported`）；不带 target 时保持原有非空 operations 语义。目标只允许 durable 身份——内置布局或可见的已保存模板；不接收客户端快照/directives/theme，内置 `free` 直接拒绝（free 只能经已保存 free 模板）。
- **Host 执行**：目标身份由 Host 解析（builtin → 布局；template → `styles.resolve(styleId, sessionStyleScope)`，不可见/已删除 → 404 `style_missing`）；Article 目标复用与 render_ui 完全一致的 Toc/Section + anchor 判定（已抽到 `src/shared/article-layout.ts::describeArticleLayoutProblem`，Host 与客户端共用同一实现）→ 400 `article_unavailable`；记录修订时，对已有修订记录（revision ≥ 2）的 base，要求客户端声明的 `style`/`styleId` 与权威记录一致（否则 409 `base_style_mismatch` 且不落盘；这些 struct 请求都校验，修复此前对已记录 base 直接信任 body 身份的问题）；初始 revision 1 没有存储记录，身份仍来自请求/登记；若 base 无临时样式且目标与 base 身份相同 → 400 `no_change`；临时样式 base + 任意 durable 目标总是变化（快照被丢弃）。成功后 program 与 base **逐字节相同**，`style`/`styleId` 来自解析后的目标，不写 `temporaryStyle`/`editedBlockIds`，沿用 `struct_` revision id、`latest+1`、branch、幂等 ledger、program registry 与响应结构。
- **历史/兼容**：不新增 durable revision 字段或 `ArtifactHistorySource` 值。`struct_` 修订且没有 `editedBlockIds` 即确定性样式切换信号：Host `historySource` 仍为 `structure`（旧客户端按"结构操作"显示并可正常 restore/branch），新客户端按该约定显示"样式切换"标签。旧 Host + 新客户端：能力位缺失 → 隐藏 picker；新 Host + 旧客户端：无变化可见。
- **客户端/UI**：编辑画布样式区新增「样式切换」单意图 radio picker，目标按「内置样式」与「已保存样式」两组展示并以分割线区分（同一 radiogroup，单选互斥；内置 Card/Article，已保存模板带色板与布局）。客户端用共享 Article 谓词预判：页面不满足 Toc/Section/anchor 时 Article 行直接禁用，并在列表下用一行普通语言说明原因；样式区默认折叠为一行：有 theme 时显示小色板；已填样式说明时行内显示「样式说明待发送」，发送摘要增加样式说明行（不计入区块编辑数）；DraftDock 把纯样式草稿标为样式说明。展开后每次只显示一条状态（检查中／非最新／有区块草稿／已填样式说明／选择目标／不适用／当前已选／可应用／branch／临时样式），不再常驻多段说明；目标组名为「立即切换样式」，文字输入标签为「或用文字描述（由模型修改）」。显式「应用样式」才发请求（展开时的程序化聚焦不触发预览）；非 branch 的旧修订禁用 Apply，显式 branch 允许并在状态行说明。成功记录本地样式修订卡（`kind:'style'`）、关闭编辑器、不产生 composer chip；失败按 `style_missing`/`article_unavailable`/`base_not_latest`/`base_style_mismatch`/`no_change` 映射内联文案；`style_missing` 后刷新模板目录。结构请求复用 `styleSwitchOperationId`：响应丢失后重试同一 operationId 由 Host 幂等 ledger 收敛；Host 晚到的非 branch `base_not_latest` 会把草稿切到 `conflict`，使状态行与 Apply 禁用一致。
- **限制**：这是"身份 + 外壳 + 主题"的切换，模板 `directives` 不会重排既有内容（需要模型重绘）；已保存模板是 live reference，修改主题会影响引用它的旧切换修订，删除模板后回退内置主题（当前不冻结每个修订的 theme）；branch 下的切换沿用显式 branch，不自动 branch；确定性样式修订是本地修订卡，不进入助理消息、transcript replay、图片/交互页面导出或其他设备（与结构/属性修订一致）；H4 已修——pending block edit 使用 artifact 记录样式/模板，`render_ui` 的 order-only/global-only 编辑不再按会话当前样式拒绝；`sessionStyleScope` 只是模板可见性作用域，不构成授权边界。保存模板只适用于带 theme 的临时样式结果（B1/按需），切换结果不保存；保存不产生修订。
- **验证**：见对应 host/client/browser 测试与最终门禁记录（contract 单测、struct 路由矩阵与 mutation 检查、客户端 POST/dirty/本地修订/历史标签、E2E 场景 40）。

### 嵌套区块编辑（M4-1）

- 身份与映射：shared `src/shared/program-cst.ts` 的 `buildArtifactTree` 为基础修订分配 revision-scoped `nodeId`、节点 `sourceDigest` 与 CST `nodePath`/slot；客户端 `src/client/artifact-edit/nested.ts::nestedBlocksForProgram` 把树映射为展示区块：root 保持 `bN`，嵌套为 `bN.M.K`，携带 `nodeId`/`parentBlockId`/`depth`/`sourceDigest`；渲染器的 slash 路径（`root/children[0]/...`）与 CST 括号路径（`nodePath`）双向映射（`byPath`/`byNodeId`）。`nodeId` 跨修订不稳定（结构操作后重新提取属 M4-3），请求以 `baseRevisionId + nodeId + sourceDigest` 绑定。
- 渲染器：新增 `nestedEditLibrary`（由 `blockEditLibrary` 派生，M4-4 起覆盖 7 类容器 `Col`/`Row`/`Box`/`Grid`/`Card`/`Section`/`Carousel`，用 `wrapNestedContainer` HOC 把 direct children 替换为合成嵌套 `BlockSlot` AST；普通 library 与顶层 `blockEditLibrary` 不变）。`OpenUIRenderer` 新增 `nestedBlockSlots` prop（默认 `false`，false 时输出与原来一致）。`BlockSlotPathContext` 为 `{parentPath, resolve}`，`resolve` 返回 `{blockId,nodeId,blockIndex}`；嵌套 wrapper 输出 `data-dsh-iui-block`（display id）/`data-dsh-iui-block-node`/`data-dsh-iui-block-path`；根层生产 wrapper 无 path 时 markup 不变。wrapper 使用 `display:contents`，由 `src/lib/components/nested-edit.css` 补偿直接子选择器与作用域规则；`test/renderer/nested-css-contract-check.mjs` 静态检查（M4-4 起 **28/28 direct + 5/5 scoped**），几何 E2E 验证 0px 漂移、innermost 点击/悬停、overlay union rect、排序路径映射与普通渲染不变。
- 客户端：编辑器工具栏出现「嵌套区块 / 仅顶层」toggle（`data-dsh-iui-edit-nested`；默认关闭，关闭时清空选择；模式不持久化，刷新回到顶层）。开启后画布用 raw program + `nestedBlockSlots` + resolver，selection/请求列表/popover 使用嵌套 display id；信封 `edits` 增加 `nodeId`/`sourceDigest`/`parentBlockId`/`depth`（shared header 投影），`targetOrder` 仍是根层完整排列。
- Host：`isNestedEditRequest` 在任一 edit 带 `nodeId` 时为嵌套请求；`planNestedEdits`/`describeNestedEditProblem` 用 `buildArtifactTree` 校验：node 存在、`depth > 0`、非 scoped(@Each)/shared/opaque、`sourceDigest` 与 `componentType` 匹配、无祖先-后代同时选中、树大小/深度上限；要求全部 edits 带 `nodeId`（all-nested 或 all-legacy，混合拒绝）。`composeNestedEditProgram` 把模型 `edit_ui_blocks` mini program 的 root children 按 `selectionOrder` 与 edits 一一对应，经 CST `replaceNode` 顺序替换，重解析/重校验后记录 revision；根层 `targetOrder` 仍走确定性重排；`editedBlockIds` 仍为受影响的根区块 id（共享 validator 限制）。非法嵌套请求返回模型可读错误且不消费 pending。
- 限制：opt-in、仅 `Col`/`Row`/`Card`、仅内容 replace（不支持嵌套排序/删除/复制/移动）、`@Each`/opaque/共享引用不可编辑、根层 `targetOrder` 不变、all-nested 或 all-legacy、`editedBlockIds` 仍为 root id；Host 仍以信封携带的 program 为基础（权威 program store 属 M4-3）；CSS 补偿层需随组件直接子选择器维护；真机/真实模型只验证了单个嵌套文本替换。

### 层级排序（M4-2）

- 契约：`ArtifactEditRequest.orderByParent?: Record<'root' | CST nodeId, readonly nodeId[]>`，header 投影；shared shape 校验（`invalid_order_by_parent`：key 为 `root` 或 `n\d+`、每组非空且 ≤100、id 去重、最多 61 组）。值只包含该 parent 的 **editable children** 的完整排列；客户端只发送发生变化的组；`targetOrder` 仍是根层基础顺序。
- Host 校验：`describeOrderByParentProblem` 用基础 CST tree 验证 parent 存在、非 `@Each` scoped、非共享命名表达式、非 opaque、存在 children slot；每组必须是 editable children 的完整排列，拒绝未知/重复/跨父 id；`orderByParent.root` 与 legacy `targetOrder` 不一致时拒绝（targetOrder 必须是基础根顺序）；同一请求中正在内容编辑的子树不能被排序（祖先-后代冲突）；no-op 组忽略。失败返回模型可读错误、保持 pending、不写 revision。
- 应用：`applyOrderByParent` 对变化的组按 **最深优先** 调 `reorderChildren` 并在每个 parent 后重建树；存在 `orderByParent.root` 时由它拥有根顺序并跳过 legacy root `targetOrder`，否则嵌套排序后再执行根层 `targetOrder` 确定性重排。`render_ui` 完整程序路径与 `edit_ui_blocks` 嵌套内容路径共用 `apply`；order-only 请求（`edits: []` + `orderByParent`）被接受，记录 normalized program 到 revision 并在结果 meta/`presentationMeta` 返回；`editedBlockIds` 在 order-only 时为 `[]`，嵌套内容+排序时为受影响的根区块 id。
- 客户端：会话增加 `nestedOrder`/`nestedOriginalOrder`/`nestedOrderChanged`；actions `moveNestedBlock(parentBlockId, blockId, toIndex)`、`moveNestedBlockBy`、`resetNestedOrder`；进入嵌套模式时按 parent 分组；重新打开 submitted 草稿时重置 nested 状态；chip 摘要/参与判定把嵌套排序视为内容形状变化（摘要「调整区块顺序」）。serialize 只把变化的组转为 `orderByParent`（display id → CST nodeId），`targetOrder` 保持根层基础顺序。EditPanel 在嵌套模式新增「嵌套区块编排」区：每个 parent 一组标题 + 缩进行（全局编号、编辑 tag、铅笔、locate body），支持同父 pointer drag（跨组不可）+ grip ↑/↓/Home/End，以及「重置嵌套顺序」；hooks：`data-dsh-iui-edit-nested-arrangement/-group/-list/-row/-grip/-body/-edit/-reset-nested`。
- 限制：嵌套排序仍是 opt-in 且不持久化；没有画布 live preview（列表显示目标顺序）；不支持跨容器移动；order-only 仍需一次模型 `render_ui` 回合（不是零模型）；不要同时对正在排序的 parent 子树做内容编辑；Host 仍以信封携带的 program 为基础（权威 program store 属 M4-3）；`editedBlockIds` order-only 为 `[]`。

### 确定性结构操作（M4-3）

- 权威 program 注册表：`src/host/artifact-structure.ts::createArtifactProgramStore` 持久化 `<DSH_HOME>/dsh-intelligent-ui-programs.json`（`{version, programs[]}`）：最多 **200** 条记录 / **50 MB** program 文本，按 `lastAccess` LRU 淘汰，原子写、损坏恢复到空；记录每次成功 `render_ui`、`edit_ui_blocks`、结构路由与 restore 产生的新 revision program。`lookup(artifactId, revisionId)` 是结构操作的**唯一** base 来源；请求 body 带 `program` 会被 `unknown_field` 拒绝。
- 幂等 ledger：`createArtifactStructureOperationStore` 持久化 `<DSH_HOME>/dsh-intelligent-ui-structure-operations.json`（最多 200 条；`operationId` + canonical request digest → result lineage）。相同 `operationId` + body 重放返回已记录结果（HTTP 200），相同 id 不同 body 返回 409 `operation_replayed`。
- 路由：认证的精确 **`POST /api/intelligent-ui/artifact-structure`**（认证同 restore；body ≤64 KiB、JSON；成功 201 `{ok:true, result: ArtifactStructureResult}`；重放 200）。校验：base 必须存在于权威注册表；latest/branch 规则；`buildArtifactTree` 校验 `nodeId`/`sourceDigest`/scoped(`@Each`)/shared/opaque/root 目标与 `toIndex` 边界；操作集为 `delete`/`duplicate`/`move` 以及 M4-6 的 `props`（Divider/Spacer 快捷调整：按节点组件校验属性，用 `replaceNodeContent` 改写命名语句定义，批量按请求顺序原子应用，最多 20 个操作），应用后重解析/重校验。成功后记录 `revision = latest + 1`（branch 基于旧 base 也是 `latest+1`），继承 `style`/`styleId`/`temporaryStyle`/`title`，`editedBlockIds` 记录受影响的根区块 id，并把新 program 写入注册表。错误码：400 `invalid_input`/`operation_conflict`/`program_invalid`、404 `artifact_missing`/`base_missing`、409 `base_not_latest`/`operation_replayed`、500 `storage`、405/413。
- 索引语义：`duplicate.toIndex` 是复制件在该 parent 的 **editable children** 中的最终插入位置；`move.toIndex` 是移除后 0-based 的最终 editable 索引。
- 客户端：shared `src/shared/artifact-structure.ts`（路由、request/op/result、`describeStructureRequestProblem`、`isArtifactStructureResult`、`MAX_ARTIFACT_STRUCTURE_OPERATIONS = 20`）。结构操作现在统一走「待执行队列 → 总预览 → Apply」流水线（见下文编辑流水线）：`applyEditRound` 把队列作为单个原子 batch 提交，成功后记录本地 `kind:'structure'` 修订卡（在有触发操作的 Turn 渲染，标签「结构操作修订」）并 rebase 草稿；纯结构 Apply 才 `markSubmitted` 关闭编辑器，混合 Apply 保留 rebase 后的草稿并自动发送。早期逐条操作、直接入库并关闭草稿的 `applyArtifactStructure(key, blockId, 'delete'|'duplicate', turn)` API 已删除，仅作为历史记录保留在上文旧流程描述中，勿按它实现或调用。`IntelligentUIProgram.localRevisionKind` 区分 restore/structure/props，local-revisions 校验与持久化兼容旧 restore 记录。
- UI：根层与嵌套编排行 hover/focus 显示「复制」（立即）与「删除」（两段式内联确认，3 秒，danger 态，无 `window.confirm`/`alert`）；`structureBusy` 时禁用动作并给出 status，`structureError` 为 `role=alert`、可关闭并在 8 秒后自动隐藏；hooks：`data-dsh-iui-edit-structure-duplicate`/`data-dsh-iui-edit-structure-delete`、`data-confirming`、`data-structure-confirming`、`data-dsh-iui-edit-structure-error`/`-dismiss`/`-busy`。
- 限制：UI 只暴露 delete/duplicate（Host 有同父 move API 但无 UI；跨容器移动未做）；注册表只覆盖已登记且仍在 200/50 MB LRU 内的 revision——旧卡在客户端首次使用权威状态时会自动登记（见「Artifact 权威状态生命周期与基础登记」），未登记的或被驱逐的 base 返回 `base_missing`，需要重新渲染，`branch` 也要求 base program 仍在；本地结构修订卡只在 localStorage 且只在触发 Turn 渲染，无 assistant 消息/导出/跨设备，丢失提示尚未做；无 diff 预览/多步 undo；删除不做 helper GC；`Section`/`Toc`/`@Each`/共享表达式由 CST 规则限制；（历史：M4-3 时结构操作与内容编辑不能混在一个动作，且结构操作会直接 `markSubmitted` 当前草稿；该行为已被 2026-11-10 的编辑流水线取代，见下文。）

### 容器扩展、模型新增与跨容器移动（M4-4 完成）

- 容器白名单单一来源：`src/shared/artifact-containers.ts` 的 `NESTED_CONTAINER_TYPES = ['Col','Row','Box','Grid','Card','Section','Carousel']` 同时供 renderer（`library.ts`）、client（`nested.ts`）、Host（`artifact-edit.ts`/`artifact-structure.ts`）与 CST 引擎使用。`program-cst.ts` 修复容器 children 参数映射：`CONTAINER_CHILDREN_ARG_INDEX` 对 Col/Row/Box/Grid/Card/Carousel 取第 1 参数、`Section` 取第 2 参数，因此 Section 拥有真实 `children` slot/slotRange（默认 Col/Card 白名单下仍按叶子处理）。
- 渲染器与 CSS 补偿：`nestedEditLibrary` 自动覆盖新容器；`nested-edit.css` 新增 Grid `> *` 的 min-width、Carousel item 内 card/pressable 的 height，以及 5 条 grid/carousel flow 排版上限的 scoped 补偿；`nested-css-contract-check.mjs` 扩展为 **28 direct + 5 scoped**。几何 E2E 覆盖 7 类容器 / 18 个 slot 的 0px 漂移、Carousel 滚动与 overlay 命中；Carousel 的离屏 item anchor 可能超出 track，绘制时需要与 track rect 相交裁剪（尚未实现，列为 M4-4 剩余项）。
- 引擎基础（供后续 model-add/cross-move）：`program-cst.ts` 新增 `insertNode(program, parentNodeId, slotKey, index, sourceExpr)`——在可编辑索引处插入 inline 表达式，opaque/template 节点位置保持不变，root 可作 parent，支持批量 insert；`moveNode` 扩展跨容器（目标为无祖先/后代关系的 allowlisted parent；目标索引为 editable index；拒绝 self/后代/祖先-后代 slot/@Each/shared/root/不兼容容器），同父行为不变。两者返回标准 `{ok, program, tree, touched, unchanged, edits}`；引擎测试增至 18 条（`test/client/program-cst.test.mjs`）。
- 模型新增区块（additions）：shared `artifact-edit.ts` 的 `ArtifactBlockAddition`/`additions`（每请求最多 4 条；`parentBlockId`/`parentNodeId`/`index`/`instruction`）与 header 投影已接入。`isNestedEditRequest` 同时覆盖 additions；additions-only 请求走 `edit_ui_blocks`，legacy+additions 混合被拒绝；Host 校验 parent 为 allowlisted 容器、index 0…editable children 数、单请求最多 4 条、addition parent 与内容编辑子树不冲突，失败保持 pending。模型 mini program 的 root children 顺序固定：先 edits（按 `selectionOrder` 升序），再 additions（按请求顺序），children 总数 = edits + additions；helper statements 追加；edits 先 replace，additions 用 `insertNode` 插入并按 block identity 重定位 parent；结果 meta 带完整 program，`editedBlockIds` 含 addition parent 的 root id。v1 UI 每个容器只允许一个 addition（会话中 `saveBlockAddition`/`removeBlockAddition`）。
- 跨容器移动（M4-4 结构操作）：`ArtifactStructureOperation` 的 `move` 支持 `toParentNodeId`（目标必须是另一个无祖先/后代关系、allowlisted 的容器；`toIndex` 为目标 editable index；拒绝 self/后代/祖先-后代、same-parent、scope、shared、unknown，delete/duplicate 带 `toParent` 被拒；批量保持原子；`editedBlockIds` 同时含 source 与 target 的 root id）。客户端 `moveArtifactBlockTo` 发送该操作并把 `toIndex` 设为追加到目标末尾（v1 无位置选择）。
- 客户端 UI：嵌套组的组头提供「添加区块」内联表单（save/cancel/Escape/Cmd+Enter；每容器 v1 一个），addition 以行显示并可移除；每个编排 row 提供「移动到…」菜单（候选为 root + 7 类容器，排除自身/后代/当前 parent/祖先，UI 再排除 source parent 内的容器；portal/边界处理；Host 二次校验）；additions 计入 chip 内容与数量、不参与拖拽；结构错误中的 `base_missing`/`artifact_missing` 显示「重新渲染卡片」内联提示。
- 真机（ego，隔离实例「M44 容器验证」）：Box/Grid/Section 正常渲染；嵌套模式识别 b1.1 Box、b2.1 Grid、b3 Section 及其子块；复制 Grid 子块 b2.1.1 → 结构路由本地卡 **Revision 2**（grid one/grid one/grid two）；在 Box 组「添加区块」→ Send → 模型 `edit_ui_blocks` → **Revision 3** 新增 Added block；对 Added block 执行「移动到… Grid 容器」→ 无模型回合，本地结构修订卡 **Revision 4**，区块移入 Grid，均无错误。
- 限制：`additions` 与 `orderByParent` 不能放在同一请求（需分开）；root 不能作为跨容器移动目标（UI 不提供，Host 也不支持 nested→root）；Carousel 离屏 item 的 overlay anchor 需与 track 相交裁剪（未做）；无结构 diff/预览/多步 undo；delete 不做 helper GC；跨容器移动只支持追加到目标末尾；每个容器 v1 一个 addition；`base_missing` 只有内联错误提示，无旧卡自动恢复/丢失内容提示；本地结构修订卡只在 localStorage/触发 Turn，无消息/导出/跨设备；additions 依赖模型遵循 fragment 顺序，失败保留 pending 可重试。

### 结构操作预览、严格模式与 a11y/性能收口（M4-5/B2-5 完成）

- Host dry-run：`ArtifactStructureRequest.preview?: boolean`；`preview: true` 走与真实 apply **完全相同**的 authoritative base/latest/branch/CST 校验、原子操作与最终结构校验，但 **不写 revision、不写 program registry、不写幂等 ledger**。成功返回 200 `{ok:true, preview:{program, operations, changedBlockIds, touched}}`；`touched` 是去重后的 compact `{nodeId,nodePath,op}`（direct op 优先、祖先标记、上限 120、不含源码），`changedBlockIds` 与 apply 的 `editedBlockIds` 同口径；错误码与 apply 一致；同一 `operationId` 之后真实 apply 成功时仍只记录一次 revision。
- 客户端 store：`session.structurePreview`（loading/ready/failed，含 kind/blockId/target/afterProgram/changedBlockIds/diff lines）；actions `previewStructure`/`previewMoveBlockTo`/`confirmStructurePreview`/`cancelStructurePreview`；行级 LCS diff（>400 行降级为摘要）；preview 不 `markSubmitted`，只有 confirm 才走 apply 并写本地结构修订卡；`base_missing`/`artifact_missing` 仍显示既有的「重新渲染卡片」提示。
- 模态 UI：结构动作改为 preview→模态确认（duplicate/delete 先预览；delete 保留两段式确认后再进预览；`Move to…` 选择目标后预览）。dialog hooks：`data-dsh-iui-edit-structure-preview`、loading/failed、`data-dsh-iui-edit-preview-diff`（`data-diff="add|remove|same"`）、confirm/cancel；`aria-modal`/`aria-labelledby`、初始焦点在 Cancel、Tab/Shift+Tab focus trap、Esc/backdrop 取消、关闭后焦点返回触发按钮、确认期间 disabled、`prefers-reduced-motion` 下 spinner 简化；保留旧的直接 apply fallback。
- 未选区块严格模式（B2-5）：请求可选 `strict?: boolean`（shared header 投影；信封 prose 在 strict 时提示模型不得改动未选区块）。客户端会话保存 `strict`（默认关），工具栏「严格保护 / Strict protection」toggle（`data-dsh-iui-edit-strict`、`aria-pressed`、submitted/error 时 disabled），store `setStrictMode` 将 strict 序列化进请求。Host 在完成合成、计算保留警告之后、**记录 revision / 消费 pending 之前**检查：`strict === true` 且存在未选顶层区块 warning 时抛模型可读错误（前缀 `render_ui:`/`edit_ui_blocks:`，最多 3 条按 label 的摘要、不含源码），保持 pending armed、不写 revision/registry/ledger，模型可用同一请求修正后重试。比较发生在 content stage（`orderByParent`/root `targetOrder` 重排之前），因此合法排序不会误报。覆盖范围与限制：warning 口径为已识别的顶层 Artifact blocks（statement name → title+component type → unique title、digest），排除 selected/edited ids；不检测「选中的顶层区块内部、未被选中的嵌套子节点」改动；`edit_ui_blocks` 的 fragment 合成本身不能改未选顶层块，完整 `render_ui`（`edits: []`）覆盖全部顶层块；`strictOff` 文案当前未使用；严格拒绝路径由 Host 单测覆盖，未做真机验证。
- （历史：M4-5 的 `session.structurePreview` / `previewStructure` / `confirmStructurePreview` 单操作预览 API 已被编辑流水线的总预览/Apply 取代，以下描述仅作历史记录。）
- 性能与视觉守卫：新增 `test/client/nested-performance.test.mjs`（2 条 smoke：7 卡片 / 49 可编辑区块 / 57 CST nodes 的 tree + nested mapping <2s；`insertNode`+reorder <2s，预算宽松）；视觉回归仍由 `nested-edit-renderer` E2E 守卫（7 类容器 / 18 slots、card/text/body 0px 几何、Grid/Carousel 排版 18px/15px、Carousel 滚动/overlay）；B2-10 后另有 `test/browser/visual-baselines/` 手动视觉基线，仍无自动像素 diff。
- 限制：M4-5 只完成结构操作 diff 预览与 a11y/性能 smoke——当时没有像素级视觉快照基线（B2-10 已提供手动基线，仍无自动像素 diff）、没有完整 screen-reader/axe 审计；preview loading 无客户端超时（依赖 fetch 失败）；模态背景用遮罩阻止指针，但未设置 `inert`/`aria-hidden`。**B2-5 的「未选区块内容严格模式（warning→strict）」仍未做**，本次只做结构操作 Host dry-run/严格校验 + diff 预览。既有 M4 限制（Carousel 离屏 anchor、跨容器 append-only/root target、additions 与 orderByParent 分开发送、每容器 1 addition、无多步 undo/GC、base_missing 仅 inline、本地结构卡限制）不变。
- 真机（ego，隔离实例「M44 容器验证」R4）：打开编辑 →「嵌套区块」→ 复制 Box 组 → 模态 diff 显示 `boxCard ... + boxGroup_copy1` 等 add/remove/same 行，summary 为 1 个顶层区块 → 确认 → 本地结构修订卡 **Revision 5**（Box 内容重复为 box one/box two 两次），无错误。

### 结构区块解禁与快捷属性调整（M4-6）

- **解禁范围**：`Caption`、`Divider`、`Spacer`、`Toc` 与根层 `Title` 从页面 chrome 名单移除，根 `Col` 与 7 类嵌套容器的**每个直接子节点**都是可编辑区块；`ArtifactBlockKind` 新增 `divider`/`spacer`/`toc`/`heading`/`caption`（中英标签与面板图标共享一个映射），标题读取 `Title`/`Caption` 文本、`Toc.items` 前几项或首段文本。
- **画布布局零侵入**：所有编辑 wrapper 与 body 都是 `display: contents`（根层与嵌套同构），`nested-edit.css` 的直接子选择器补偿（28 条 direct + 5 条 scoped）统一覆盖两类 wrapper。hover 框/编辑聚焦框/压暗 scrim/pending 标记/页面序号/定位脉冲/轨道光晕/点击捕获/键盘焦点移到客户端 `BlockOverlay`：它在 `.dsh-iui-edit-canvas`（`position: relative`）内按真实内容 rect 测量（ResizeObserver + MutationObserver 重测），绝对定位渲染，不参与布局；根层与嵌套区块共用同一层，嵌套命中框按 depth 层叠。编辑中的区块显示浮动框 + 阴影；已保存待发送的区块改为低调 pending 标记（圆点 + 请求序号）并恢复更淡更慢的轨道光晕；不再给 body 上背景/圆角。harness 几何断言：Title→Divider 间距、Divider 宽度/margin、居中根 Col 的 Divider 宽度在普通渲染与编辑画布一致。
- **单一区块身份**：快捷调整在根层按 `block.rootIndex` 对应 CST 根 `Col` 的直接子节点（shared/opaque 兄弟不会让 bN 偏移），嵌套模式用与画布同源的嵌套映射；`shared`/`opaque`/`scoped` 节点禁用快捷调整。`targetOrder` 归一化在 statement → 标题+类型 → 唯一标题之后增加“唯一内容 digest + 组件类型”匹配，只有字节相同的可互换块才退回页面顺序；嵌套 `orderByParent` 的 `mapChildIds` 同样先 digest 后 childIndex。
- **快捷调整（Divider/Spacer）**：`Divider(color?, width?, thickness?)`、`Spacer(width?, height?)` 进入组件 props、grammar、prompt 与 Agent Skill 参考。点选这两类区块时 popover 用「快捷调整」替代指令 textarea：Divider 调颜色（20 个主题 token 或自定义 CSS 颜色）/宽度（默认/px/%，居中）/粗细（0.5–12px）；Spacer 调宽度/高度（默认/px/%）。每个长度单位在行下与下拉选项里各带一句说明；默认表示省略该参数（Spacer 恢复 flex 占位），px 为固定值，% 相对容器（百分比高度需要父容器有确定高度，否则为 0）。旧修订里的 `auto` 仍被 Host/渲染器接受，打开时显示为默认，真正改动前 Apply 保持禁用。控件保留本地 UI 状态（单位、未输完的数字不再把预览宽度写成 0），改动经 `propsPreview` 在**根层与嵌套模式都实时预览**。下拉（颜色/单位）与滑块（宽度/粗细/高度）全部是插件自绘控件（主题 token + 键盘/焦点/portal 菜单），不使用原生 `<select>`/`range`；滑块拖动时预览即时跟随，Apply 仍负责记录修订。只有当前属性全部是字面量且落在上述值域时才显示快捷面板；动态绑定（`Divider($accent, ...)`）或 rem/calc 等超范围值回退到指令编辑器并说明原因，绝不静默改写；已有保存指令的 Divider/Spacer 同样回退到指令模式。Apply 在无改动时禁用；客户端与 Host 都拒绝 no-op 属性修订（不产生相同修订卡）；结构路由的 operation digest 覆盖 `props` 与 `toParentNodeId`，同一批里重复目标节点返回 `operation_conflict`。
- **列表↔画布映射、编辑聚焦与 pending 标记（追加）**：编排/嵌套/请求行 hover 与画布区块双向联动（中性蓝 2px 细框 + 4% 淡底，未选中/未编辑时显示）；根层常显页面顺序索引（嵌套块仅在 hover 时显示）；有 pending 请求的行仍保留页面序号，并在标题后显示带 tooltip 的请求序号 badge；行尾新增「更多」菜单（定位/编辑/复制/移动/删除；定位仍复用 900ms 脉冲），保留点击行主体定位。打开任一区块编辑器时，其余区块被 scrim 压暗，当前区块保留编辑框；Save/Cancel 关闭后 scrim 消失。Save 不再保留大选中框：改为「圆点 + 请求序号」的低调 pending 标记，pending 根层区块的 orbit glow 降速（5.2s）变淡（0.3）；`selection` 数据不变，发送时照常提交。确定性 Apply/结构操作仍按既定行为记录修订并退出编辑（1A 不变）。
- **状态一致性**：未发送拦截统一用 `hasArtifactEditContent`（包含嵌套排序）；异步结构/属性请求失败只回写当前 session（不会复活已关闭/已提交的编辑器）；嵌套 kind 复用共享映射；快捷面板打开即聚焦、`aria-busy`、`edit.propsUnit`、stale-base/no-change/busy 文案齐全。
- **限制与预算**：快捷调整只支持 Divider/Spacer 的上述属性；属性修订卡与其他本地修订一样只在 localStorage/触发 Turn 渲染，不参与导出；自定义 CSS 颜色由渲染器 `isSafeCss` 约束，Host 只做保守格式校验；根层 wrapper 已无盒子，依赖 `.dsh-iui-block` 盒子的旧样式/hook 不再存在（测试改为 overlay hit/frame 选择器）。CST 节点预算为 200（此前 60）：长文章页面（如 105 节点的 Solid 2.0 导览）现在可以找到嵌套 Spacer 并使用快捷调整；66 节点 fixture 在浏览器套件中回归。
- **验证**：Node **628/628**；浏览器 9/9；`artifact-edit` **519 checks**（布局 parity、嵌套 preview、快捷面板、自绘下拉/滑块、滑块即时预览、popover 固定/单位切换不位移、大页面嵌套、确定性请求体、属性修订卡、dirty 拦截、动态回退、apply 禁用/焦点），`nested-edit-renderer` 75；CSS 客户端 222.4 kB；standalone 3.33 MB + 514.4 kB；pack 65 files 6.04 MB / 12.88 MB；harness 截图 `.tmp-report/harness-quick-props.png`、`.tmp-report/harness-pending-block.png`。

### Artifact 权威状态生命周期与基础登记（2026-11-07）

- **根因**：区块编辑依赖 Host 侧协作状态（权威 program registry、修订 registry、结构 ledger），但早于该状态存在的卡片没有登记路径，同一张旧卡在结构操作、修订历史与恢复里分别表现为 `artifact_missing`/`base_missing`、空历史与 `source_missing`。本增量补上唯一的「已渲染内容 → Host 权威状态」生命周期与统一 base resolve/失败边界，不做回填、不做后台迁移。
- **初始修订身份**：首次 `render_ui` 的 tool call id 同时是 artifactId 与 revision 1 的 revisionId，即 `revisionId === artifactId`；revision 1 只存在于权威 program registry，**不写修订记录**，记录从 revision 2 开始。`src/shared/artifact-edit.ts::isInitialRevisionId(artifactId, revisionId)` 是唯一判定，base 登记（初始锚）与结构路由的 base 解析使用它；restore 路由保持原有的 program-only 回退（source 记录缺失但 program 仍在即允许，不额外校验初始身份）。
- **状态与迁移**：`rendered`（只有卡片内容，无 Host 状态）→ `registered`（该 revision 有权威 program）。登记后结构操作/历史/恢复才可用；一个登记覆盖两种 provenance：初始锚（`revisionId === artifactId`，无需记录）与已记录锚（`revisions.get(revisionId)` 存在且 `record.artifactId === artifactId`，用于 program 被 LRU 驱逐后的已记录 revision）；两者都不满足 → 404 `unknown_revision`。
- **写一次**：登记只补缺失的 program，从不覆盖；已登记且 program 相同 → 200 `{ok:true,registered:false}`；不同 → 409 `program_conflict`。登记**不写修订记录**（revision 1 保持 program-only），失败不落盘。
- **路由契约**：认证精确 `POST /api/intelligent-ui/artifact-base`（`connection.requestRejection` 先于方法分发，与 restore 同一认证），body `{schemaVersion:1, artifactId, revisionId, program}`，严格白名单（只允许 4 个 key）、复用 `ARTIFACT_ID_PATTERN` 与共享 bounded-text 规则（非空、≤200,000 字符、同一控制字符规则；helper 从 `artifact-edit.ts` 导出一份，规则不会漂移）；body ≤ **1 MiB**（200k 多字节 program 可超过 300 KiB），JSON + 15s 读超时；结构校验要求 `extractArtifactBlocks(program).rootType === 'Col'`。成功 200 `{ok:true,registered}` + `no-store`；错误 `{error:{code,message}}`：400 `invalid_input`/`invalid_program`、404 `unknown_revision`、409 `program_conflict`、413 `payload_too_large`、500 `storage`、405 `method_not_allowed`；错误响应从不回显 program。
- **base resolve 边界**：`src/host/artifact-base.ts::resolveArtifactBase({revisions,programs},{artifactId,baseRevisionId})` 抽出结构路由原有的 latest/firstProgram/baseProgram 判断（空 artifact → `artifact_missing`；已知 artifact 但 base program 缺失 → `base_missing`），结构路由继续保留 latest/branch、CST 校验、修订记录与错误文案不变。
- **客户端 ensure**：`src/client/artifact-edit/artifact-base.ts::ensureArtifactBase({artifactId,revisionId,program})` 是唯一入口（无 A/B 分支），按 `artifactId\0revisionId` 做 single-flight + 永久缓存；成功缓存为 `present`/`registered`；旧 Host 无该路由（404）缓存为 `unsupported` capability，该 revision 不再探测；网络/其他非 2xx 为 `failed`，不缓存、可重试，且从不抛出或显示用户错误。触发点：打开编辑画布（新建/复用/已提交复用草稿，fire-and-forget）、结构 preview 与 apply 发送前 await、修订历史对话框加载前与 restore 发送前 await；`unsupported`/`failed` 不阻塞操作，走非权威降级路径。模型路径与旧卡内容不变。
- **统一失败语义**：store 的 `structureFailureMessage({code, surface, failureKey})` 同时服务 preview、apply 与快捷调整（props）；preview 现在也解析响应体 `error.code`（此前只有 apply 解析）。`artifact_missing`/`base_missing` 一律映射到可操作的说明（权威程序登记未完成或记录被淘汰、卡片记录缺失；关闭重开、重新渲染、改用指令编辑），不再是泛化「重试」死路；`base_not_latest`/`no_change` 保持原映射。
- **信任位置**：客户端提交 program 的信任级别与既有 edit envelope / restore 一致（仅用于登记，写一次 + 仅当前 revision + 结构校验）；结构路由仍只读权威 program，绝不信任客户端 program，结构请求也不带 program。
- **接受并记录的偏差（不修复）**：登记的初始修订 `createdAt` 变成登记时间；未被任何权威操作触达的旧卡保持未登记（无回填）；被 LRU 驱逐的非当前 revision program 客户端无法重建。
- **旧 Host 混合部署**：登记路由 404 时客户端缓存 `unsupported` 并按非权威路径降级——快捷调整切换为指令编辑、结构操作给出缺失权威程序的可操作提示，页面可重新渲染恢复。
- **验证**：`test/host/artifact-base.test.mjs`（14 条：含 review 后新增的写盘失败无幽灵记录、raw 超长 400、已记录锚重建等回归：路由注册/disposer、认证先于方法、POST-only/content-type/坏 JSON/>1 MiB、字段与 program 校验、初始锚登记与写一次冲突、unknown revision 与外 artifact 记录、已记录锚解锁结构/历史/restore、无模型端到端升级：登记→preview→apply 201 revision 2→历史含初始与 revision 2→restore 初始 201 revision 3、结构错误语义回归）；`test/client/artifact-base.test.mjs`（7 条：single-flight、成功缓存、404 unsupported 能力缓存、网络错误可重试、畸形 200 可重试、缓存失效后重新登记、失效期间 in-flight 不回填）；`test/client/artifact-edit.test.mjs` 新增 4 条（打开编辑器登记一次并带卡片身份、结构 preview 先 await 登记且不带 program、preview+apply+props 统一缺失 base 文案、success→miss→重开再登记两次）；浏览器 `artifact-edit` 场景 36（旧卡打开登记一次并带权威身份、登记先于结构请求、旧 Host 404 降级、preview 与 props 新文案；review 后改为按 artifactId/status/seq 语义断言），套件 **519 checks**。

### 运行时状态部分保留（B2-6）

- Renderer 接线：`OpenUIRenderer` 新增可选 `runtimeState`/`onRuntimeStateChange`，仅在传入时转发给 vendored Renderer 的 `initialState`/`onStateUpdate`；两者都不传时行为与输出不变。
- `src/client/runtime-state.ts`：按 `artifactId`（缺失时退到 `callId`）保存 revision-scoped 快照与 latest；`recordRuntimeState(program, state)` 深拷贝 plain object（≤64KiB；非对象、循环引用、超大状态忽略；`revisionId` 缺失时用 `callId`），更新该修订快照与 latest；`runtimeStateForProgram`：首渲染（无 `baseRevisionId`）返回 `undefined`，有 `baseRevisionId` 时优先基础修订快照、缺失回退该 Artifact 的 latest；读写都经过克隆隔离；容量 24 个 Artifact LRU、每个 Artifact 5 个修订快照（latest 保留）；仅浏览器会话内存、不持久化；提供 clear/reset helpers。
- 接线：`IntelligentUICards` 渲染卡片时恢复快照，并通过 `onRuntimeStateChange` 持续记录；`ArtifactEditView` 的两处渲染传入冻结的 base 快照且不写回（编辑画布冻结）。因此编辑产生的新修订卡可继承渲染器持有的 `$state` 与表单字段初始值；第三方组件内部状态、编辑画布内的交互值不保留。
- 限制：内存态、刷新丢失；容量 24 artifacts / 5 revisions / 64KiB；首渲染不继承历史；继承要求新修订带 `baseRevisionId`（缺失时仅 latest fallback）；第三方内部状态与画布交互不保留。
- 真机（ego，隔离实例，参考会话最新 DST Revision 7）：点选「夏令时」→ 打开编辑 → 修改 b2 指令 → Send → 模型记录 **Revision 8**；新卡仍选中「夏令时」并显示 summer clockNote，无错误。
- 测试：`test/client/runtime-state.test.mjs`（13 条：首渲染 undefined、同修订、base 继承、latest fallback、克隆隔离、非法/超大忽略、callId fallback、容量/淘汰、clear/reset）；浏览器 `artifact-edit` 519 checks 含新修订继承 `$state` 与选中项的用例。

### 编辑画布 a11y（B1-5）

- 单一 visually-hidden live region `[data-dsh-iui-edit-live]`（`role=status`、`aria-live=polite`、`aria-atomic=true`）；`announce()` 先清空、下一帧再设置，并用 sequence guard 丢弃过期帧，使重复相同的消息也能被播报。
- 播报内容：根层重排 `a11yReorderedRoot {index}`、嵌套重排 `a11yReorderedNested {index}`（pointer drop 与 ArrowUp/Down/Home/End，仅在确实移动时）；addition 保存/移除 `a11yAdded`/`a11yRemoved`；移动菜单选择 `a11yMoved {target}`；预览打开/取消 `a11yPreviewOpened`/`a11yPreviewClosed`（confirm 不播取消）。
- 隐藏提示：`[data-dsh-iui-edit-a11y-hint]`（`edit.a11yDragHint`）由根层/嵌套拖拽手柄 `aria-describedby` 引用；移动菜单 `aria-describedby` 指向隐藏的菜单提示（`edit.a11yMenuHint`）。
- 移动菜单键盘行为：打开时聚焦第一个 target（无 target 时聚焦 `tabIndex=-1` 容器）、ArrowUp/Down 循环、Home/End、Enter/Space 选择、Escape 关闭并把焦点返回触发按钮、Tab 关闭；`role=menu`/`menuitem` 沿用。
- 其它语义：添加表单 textarea `aria-label` + `aria-describedby` 到可见提示；嵌套组 `role=group` + 可访问名称（父标题 · kind）；菜单 target、添加控件、addition 移除新增 `:focus-visible` 焦点环。
- 限制：live region 是单个 polite 槽位，快速连续重排会合并播报；指针拖拽只在 drop 时播报；Tab 关闭菜单不强制回焦（Escape 会）；隐藏提示仍在可访问性树中；未做真机 screen-reader/axe 审计；B2-10 提供手动视觉基线，但无自动像素 diff。
- 测试：浏览器 `artifact-edit` 519 checks（新增 live region 嵌套重排/添加播报、grip `aria-describedby`、移动菜单首焦点与 ArrowDown 焦点变化）；临时 Chrome harness 121 checks 覆盖 live region 语义、hint/describedby、group 语义、根/嵌套键盘播报、添加表单 aria、菜单方向键循环/Home/End/Enter/Escape+焦点返回、空菜单容器焦点、preview open/cancel 播报。

### 真机验证与视觉基线（B2-8/B2-9/B2-10）

- Article 版式（B2-8）：模型 `render_ui` 使用 `style=article`（会话日志确认）时卡片进入 article chrome；打开编辑后对根层 3 个区块做键盘重排（b1/b2 交换）并给区块填写指令，Send 后模型生成 **Revision 2**，新卡仍为 article 版式、顺序与内容更新、无错误。
- 自由版式（B2-8）：普通 `render_ui` 只接受 card/article；free 必须经 **On-demand UI**（Composer UI 菜单选择 On-demand UI，模型再以 `style=free` + `temporaryStyle` 调用 `render_ui`）生成临时样式自由版式卡（Temporary style，Row 两栏）。编辑该卡（单个根区块，无重排）并填写内容指令后，**Revision 2 仍为 temporary/free**、内容更新、无错误。**普通 `render_ui` 传 `style=free` 会被 Host 拒绝**；free 只能来自 On-demand UI 或授权的 free 模板。
- 窄屏/移动端（B2-9）：CDP Emulation 390×844 @2x 下文档无横向溢出（`scrollWidth ≤ innerWidth + 1`），卡片正常重排（Row 两栏堆叠）；点「编辑」出现 `[data-dsh-iui-edit-narrow-notice]` 且不进入编辑画布。900×1000 @2x 下编辑画布可打开、无横向溢出、编排行可见。
- 视觉基线（B2-10）：`test/browser/visual-baselines/` 保存 5 张手动参考截图（`article-card-1440.png`、`free-card-1440.png`、`editor-article-1440.png`、`preview-modal-1440.png`、`narrow-390-viewport.png`）以及 `captures.json`（浏览器/视口/截图时间与方法）、`SHA256SUMS` 与 README。这是**手动视觉基线，不是自动像素 diff 套件**：现有浏览器套件继续负责几何/排版守卫，基线用于 UI 变更后人工对照；环境敏感（macOS、Chrome 156、2× DPR、light），且测试基线目录不进入 npm 包。
- 验证计数不变：Node 628/628、浏览器 9/9、`artifact-edit` 519 checks、`nested-edit-renderer` 75、`nested-css-contract` 28/28 + 5/5。

### 编辑时自动内容宽度适配（用户反馈修复，第二轮）

- 进入编辑（停靠面板挂载）时自动收窄主聊天内容宽度，避免右侧面板覆盖内容；退出编辑时恢复用户原来的宽度。不修改 shell 的宽度偏好，只临时覆盖会话内容元素上的 inline `--dsh-chat-content-width`。
- 第二轮根因：第一版按 **viewport 中心** 计算，忽略 sidebar 与聊天列（列可从 sidebar 之后开始），且 CSS 自定义属性的 computed 值可能是 `clamp(...)` token，`parseFloat` 解析失败后退回 748，与实际宽度（如 920）不符，导致面板仍遮挡内容。
- 纯函数 `fitChatContentWidth`（`src/client/artifact-edit/panel-width.ts`）：可选 `columnLeft`/`columnWidth`（默认 0/viewportWidth，保持旧结果）；`panelWidth = clamp((viewportWidth - current) / 2 + 16, 272, 360)`，`panelLeft = viewportWidth - panelWidth`，`maxContent = 2 * (panelLeft - gap - columnLeft) - columnWidth`，`desired = min(current, maxContent)`，迭代至固定点（≤8 轮，<0.5px 收敛）；`minContent = 360`；视口不足或已适配返回原值。
- DOM helper `applyEditChatContentWidth`：仅在 `matchMedia('(min-width: 1180px)')` 且存在 `[data-conversation-content][data-conversation-region="chat"]` 时生效；保存原 inline 值与 priority。内容宽度优先读内容父元素的 `--dsh-chat-user-width`（用户宽度偏好），否则回退到 probe 实测：插入隐藏 probe（`width: var(--dsh-chat-content-width)`）后用 `getBoundingClientRect()` 得到真实像素，从而解析 `clamp()` 值。`columnLeft`/`columnWidth` 取自内容元素的实际 `getBoundingClientRect()`（聊天列，sidebar 之后）。`resize` 重算；`MutationObserver` 观察内容父元素与自身的 `style`，编辑中拖动 shell 宽度把手（写 `--dsh-chat-user-width`）会立即重算；通过 `writing` 标志忽略自身写入避免反馈循环；低于断点或已适配时恢复 inline；卸载时恢复原 inline/移除属性、断开 observer，用户偏好不被修改。`EditPanel` 在挂载/卸载的单个 `useEffect` 中调用，不在渲染期读 DOM。
- 真机（ego，最新隔离构建，1800×1000，sidebar 280 / 聊天列 left=280 width=1520）：打开编辑后 inline 内容宽度变为 **752px**；聊天卡片右缘 1412.5、Exit editing 按钮右缘 1382.5，面板左缘 1440 → 按钮可见、无遮挡；编辑中把用户宽度偏好设为 1600，仍保持 752 不重叠；退出后 inline 覆盖移除，父元素偏好保留 1600。
- 部署：client 插件改动只有**重启 `dsh-web`** 才会加载（页面刷新不够）。用户主 GUI 曾因加载旧 client bundle 仍显示旧行为；排查文档/行为不一致时先确认服务已重启。
- 限制：仅 ≥1180px docked 模式生效；面板自身 CSS clamp 仍以 748 为 fallback；若 shell 未来迁移 `--dsh-chat-content-width`/`--dsh-chat-user-width` 或 `data-conversation-*` 属性，需要更新集中式 selector/变量常量。
- 测试：`test/client/panel-width.test.mjs`（14 条：固定点/默认视口/宽视口/断点/已适配/过小视口/minContent/常见视口不重叠/非法值/column-aware sidebar 偏移）；浏览器 `artifact-edit` 519 checks 含自动拟合/恢复、动态跟随用户宽度、真实 1180px shell fit、菜单/轨道光晕与 expand 按钮不存在的用例。

### 区块片段编辑（Phase 1）

- `src/shared/artifact-block-bundle.ts` 提供纯数据切片与回填。`extractBlockBundle(program, blockIds)` 返回：被选区块的表达式源码（裸语句引用解析为右侧表达式）、它们传递依赖的 `frozenStatements`（只读语句源码）、`stateSources`（`$name = ...` 声明）与全部顶层区块的 `outline`，并带 `statementId`/标题。
- `spliceBlockBundle(baseProgram, blockIds, fragmentProgram)`：解析模型微程序，要求根是 `Col` 且直接子节点数等于选中区块数；按 `blockIds` 顺序只替换这些根子节点槽位，其余根子节点、根语句尾部参数与基础语句保持逐字节不变；微程序里除 root 外的语句作为新辅助语句追加，但与基础语句/`$state` 重名、重复/未知区块 id、数量不符或引用了组合后不存在的标识符都会返回可重试错误。组合后再解析并重新识别，顶层区块数必须一致。
- Host 新增 `edit_ui_blocks` 工具（在 `render_ui` 之前注册；`mode.ts` 在关闭会话时 deny 两个工具，execute 也有启用守卫）：只接受待处理编辑请求；多 pending 时用 `requestId`/`artifactId` 选择器精确取一条；`edits` 为空（只调顺序/整体说明）时要求改用 `render_ui`（并提示对应 `editRequestId`）；否则切片、合并、按 `targetOrder` 做确定性重排与保留警告，记录 `revision = baseRevision + 1` 的新修订并消费请求。成功值与结果 meta 为 `{artifactId, revisionId, requestId?, baseRevisionId, revision, editedBlockIds, program, title?, style, styleId?, temporaryStyle?}`；`presentationMeta` 总会带合成后的 `program`（该工具只返回片段），客户端 `programs.ts::blockEditProgram` 据此渲染修订卡片，`edit_ui_blocks` 的进程行复用紧凑的 `RenderUiRow`。
- `render_ui` 的回退分流：多 pending 时用 `editRequestId` 选择待处理请求；待处理请求有内容修改时，`render_ui` 抛出「call edit_ui_blocks」可读错误并保持请求待处理；只调顺序/整体说明的请求仍走原完整程序路径（样式/临时样式/版本冲突校验不变）。
- Phase 1 仍把完整页面放进信封作为只读上下文，主要收益是未选区块逐字节不变与合并校验；输入 token 削减（Host 程序缓存/客户端上下文路由）留到 Phase 2。

### 编辑健壮性（M1）

- 失败的 `render_ui` / `edit_ui_blocks` 工具行在折叠状态显示一行可读原因：优先取结果文本，其次结构化错误 reason，最后 `name: code`；空白折叠、最多 160 字符、完整文本放在 title，且从不读取工具参数（`RenderUiRow.tsx`）。
- 静默修订探测只在结果为 `conflict` 时把编辑会话状态改为冲突，从不自动清除冲突，也不触碰浮层/草稿状态；因此并发更新会在发送前显示冲突横幅。

### Host 校验、确定性排序与修订血缘

- `host/artifact-edit.ts` 以前置 `session/event` 监听 `user/message`，只处理真实用户消息（注入的 skill/文件等 `source.kind !== 'user'` 不算），用 `parseEditRequestTexts` 逐信封解析（一条消息最多 3 个）。除既有校验外，还要求 `targetOrder` 是基础版本全部顶层区块 id 的完整排列（`describeTargetOrderProblem`：wrong_length / unknown_block / duplicate_block / missing_block），允许 `edits` 为空，并拒绝既无修改、顺序也未变化、又无整体说明的空操作（no-op）。校验失败的请求以 `invalidReason` 保留（工具调用时返回可读错误）；合法请求按 `requestId` 存入每会话 Map（`requestId`/`artifactId`/`mode`/`messageId`/`createdAt`）：TTL 15 分钟、每会话最多 3 条 pending、最多 64 个会话；同 Artifact 同消息只 arm 第一条，重复项标记 `invalidReason`；无 `requestId` 的旧信封走 legacy 单 pending 路径。turn 未调用工具时请求保持待应用，新消息按 `requestId` 替换/新增。
- `pending(sessionId, selector)` 在没有 selector 且恰好一条时返回它；多条 pending 且无 selector 时返回 `multiple_pending`，工具层转成模型可读错误并列出可用 `requestId`/`artifactId`（`listPending` 提供该列表）。两个工具共用 `artifactEdits.apply`，但输入不同：`edit_ui_blocks` 把 `spliceBlockBundle` 合成后的整页作为 `composedProgram` 传入（跳过 `render_ui` 的 styleId/temporaryStyle 参数校验，样式始终取请求记录值）；`render_ui` 在全部普通校验通过后应用待处理编辑，若请求含内容修改则先抛「call edit_ui_blocks」并保持请求待处理。两者都只消费 selector 选中的那一条 pending、其余保持 armed，并拒绝过期/不可读/无待处理请求、基础版本已过期、更新后根不是 `Col`，以及合成/更新程序无法重新识别为同一顶层区块集合；每个请求独立校验、独立记录修订，无跨 Artifact 事务。Host 不信任客户端的 `orderChanged` 提示，而是比较基础区块 id 顺序与 `targetOrder` 自行判断；顺序变化时用 `reorderProgramToTargetOrder` 确定性重排程序的根 `Col` 子节点：按语句名 → 标题+组件类型 → 唯一标题（同类未命名结构块按页面顺序兜底）映射回基础区块并整体重排根子节点；无法一一匹配时抛出可重试错误且不消费待处理请求，归一化程序超过 200,000 字符同样拒绝。通过后计算未选区块保留警告（最多 6 条）、记录新修订（`revision = baseRevision + 1`，`revisionId = 当前 tool callId`）并消费该请求。
- `render_ui` 成功值新增可选 `artifactId`、`revisionId`、`requestId`、`baseRevisionId`、`revision`、`editedBlockIds`、`program`、`styleEdit`、`temporaryStyle` 与 `title`（编辑时出现）；`edit_ui_blocks` 的固定输出为 `{statements, style, styleId?, title?, warnings?, artifactId, revisionId, requestId?, baseRevisionId, revision, editedBlockIds, program}`。`presentationMeta` 对普通渲染返回 `null`，对编辑返回血缘对象（含本次请求的 `requestId`，临时样式时含 `temporaryStyle`）——`edit_ui_blocks` 总会带合成后的 `program` 与记录样式/标题。客户端 `programs.ts` 用 `presentationMeta.program` 覆盖渲染、重放与再次编辑使用的程序，并由 `blockEditProgram` 从 `edit_ui_blocks` meta（`program`/`title`/`style`/`styleId` + 血缘）构造修订卡片；两者都在卡片历史图标上显示修订号，并把 `requestId` 读入 `IntelligentUIProgram.requestId` 供 Turn 关闭对账使用。仅调整顺序的结果行是 `Interactive UI updated for the user (revision N of the artifact, block order adjusted).`；有内容修改时保持 `Interactive UI updated for the user (revision N of the artifact, K blocks edited).`，`edit_ui_blocks` 的结果行同为这一行；普通渲染行不变。
- `artifact-revisions.ts` 的存储与路由不变：修订记录原子写入 `<DSH_HOME>/dsh-intelligent-ui-artifacts.json`（`{version: 1, revisions: [...]}`），含 `revisionId`、`artifactId`、可选 `baseRevisionId`、`revision`、`sessionId`、`style`、可选 `styleId`/`temporaryStyle`/`title`/`editedBlockIds`（只调顺序时可为空数组）与 `createdAt`；最多 400 条（按 `createdAt` 淘汰最旧）、记录不可变、读取返回副本、损坏文件在下次写入前改名为 `.corrupt-<时间戳>`；首次渲染不写入记录，因此未知 Artifact 的查询按调用方自己的修订 1 回答。沿用同一 `connection.requestRejection` 认证模式的精确路由 `GET /api/intelligent-ui/artifact-revisions?artifactId=&revisionId=`（JSON、`no-store`；参数不合法 400 `invalid_input`，非 GET/DELETE 405）不变，同一路由同时接受认证 `DELETE` 删除记录；客户端进入编辑、发送前与重试时用它检查最新修订，没有 `webServer`/`connection` 时按未知处理、不阻塞编辑。

### 测试

> 各功能小节「验证」行记录该功能落地时的 gate 数字，属于实现历史；当前全局 gate 以 README/`docs/current-facts.json` 与最新小节为准。

- `test/client/artifact-blocks.test.mjs`（8 条）：识别顺序、包裹后程序可解析且布局不变、Article 根暴露 Title/Toc/Section 全部区块、不支持根的原因、目标校验与保留警告、确定性排序移动全部根子节点、信封往返与形状校验、发送消息摘要范围。
- `test/client/artifact-edit.test.mjs`（75 条）：信封往返（含 targetOrder、requestId 与内容修改指向 `edit_ui_blocks`）、编排字段校验、排列与 no-op 判定、发送消息摘要的排序信息、编辑会话（保存才创建请求、只调顺序合法、重置保留请求/编号/整体说明、清空请求保留编排、空/无变化/冲突阻止发送、重开恢复请求与顺序、自定义模板 styleId、临时样式与不支持程序不进入编辑）、确定性 chip 引用与 stale、静默修订探测、chip 文案与多草稿切换/上限/附加状态，以及临时样式内容编辑（带快照/不带 styleId、纯排序被阻止、持久化保留快照、无快照不可编辑）与 6 条草稿持久化：未发送草稿写入 sessionStorage、刷新后 hydrate、损坏/不可用记录清理、discard/发送清除记录与索引、确定性 ref 从恢复草稿 hydrate、无 sessionStorage 时静默 no-op、聊天索引恢复全部草稿。
- `test/client/artifact-style-switch.test.mjs`（7 条）：目标联合与标签校验、单意图规则（target+operations、preview、sessionStyleScope）、结构批次回归。
- `test/client/style-targets.test.mjs`（2 条）：Article 目标按共享谓词禁用；Apply blocker 的优先级（检查中/非最新/忙碌/草稿/样式说明/无目标/不适用/当前）。
- `test/client/programs.test.mjs`（16 条）：render_ui 血缘 meta（含 style edit 的 title/temporaryStyle）、参数标题优先、失败/临时快照防御等。
- `test/client/artifact-edit-reconcile.test.mjs`（4 条）：未完成的 submitted 草稿恢复为 failed/detached 且重建 requestId、已完成的 submitted 草稿被删除、混合结果逐条独立对账、历史 Turn 不会认领新提交（时间窗口）。
- `test/client/local-revisions.test.mjs`（7 条）：恢复的本地修订只存本地、按 revisionId 替换并按 `createdAt` 淘汰、超过 20 条上限；本地修订转换为可编辑/可渲染的卡片程序；`restoreRevision` POST 源身份并映射 Host 返回的修订。
- `test/client/program-cst.test.mjs`（18 条）：CST 解析/范围/nodeId/结构操作（replace/reorder/remove/duplicate/move/insert）与失败码，M4-4 新增 `insertNode` 的 editable-index 插入、未触及源码保留与跨容器 `moveNode` 拒绝矩阵。
- `test/client/edit-tabs.test.mjs`（3 条）：另一标签的 lease 会被看到并阻止静默 claim、takeover 替换 foreign lease 并释放、过期 lease 被忽略。
- `test/client/nested-blocks.test.mjs`（4 条）：root 保持 `bN`、嵌套为 `parent.N`；path/nodeId 映射与 display blocks 一致；`@Each` 模板不作为嵌套可编辑区块；无可编辑嵌套子节点时 `hasNested` 为 false。
- `test/client/artifact-edit-batch.test.mjs`（7 条）：v1 批次上限常量、requestId 线格式、信封头携带 requestId 与多信封指引、一条消息按顺序解析多个信封、坏信封不影响兄弟信封、普通消息解析为空、发送摘要范围不跨信封。
- `test/client/artifact-block-bundle.test.mjs`（11 条）：选中区块表达式与传递冻结依赖/`$state` 切片、单块与双块回填顺序、chrome/根参数/基础语句保持、微程序使用基础 `$state` 或新增辅助语句、块数不匹配、未知/重复 id 与辅助语句重名、`@Each` 循环变量与对象字面量键不算未定义引用、引用组合后不存在的标识符被拒绝。
- `test/host/artifact-edit.test.mjs`（86 条）：在既有编辑/片段/多 pending 覆盖之外，新增 branch：旧修订 branch=true 记录 `latest+1`、未记录的 revision 1 允许 branch、非 branch 旧修订仍被 stale 拒绝、非法 branch base 被模型可读错误拒绝且不写修订；以及临时样式内容编辑（record/meta/schema 带快照、`render_ui` 回退拒绝、非法/超大快照拒绝）；M4-1 嵌套：单/多嵌套替换、嵌套+根 targetOrder、嵌套 branch/temporaryStyle、非法 node/digest/chrome/祖先冲突拒绝、畸形嵌套片段可重试且保持 pending；M4-2 层级排序：`orderByParent` 完整排列、chrome/跨父/@Each/root 冲突拒绝、最深优先重建、order-only meta 与非消费语义；`edit_ui_blocks` 注册/meta、合成、单/双块回填、保存模板 styleId/title、`render_ui` 拒绝内容修改、无请求/只调顺序拒绝、片段不合身可重试、无效 pending、血缘文案、警告、过期版本、不可读信封、样式不一致、注入消息不武装、确定性排序/归一化 program、超长与非法排列拒绝、no-op、TTL 与 64 会话上限。
- `test/host/artifact-revisions.test.mjs`（33 条）：不可变记录与重启读取、`latestFor`/`status`、原子写与损坏文件保留、按时间淘汰；GET 路由认证/方法/参数；恢复路由：与 GET 共用 disposer、POST 成功记录 latest+1 并返回本地修订、source 缺失/跨 artifact/already latest 拒绝、body/program/大小校验、非 POST 与认证拒绝，以及临时样式 record 校验与恢复复制快照。
- `test/host/style-routes.test.mjs`（13 条）：模板保存/范围校验、程序化快照（local-restore/structure-route）的 session 保存与真实会话拒绝。
- `test/host/artifact-structure.test.mjs`（47 条）：program 注册表 LRU/大小/损坏恢复与 lookup、幂等 ledger 重放/冲突、结构路由鉴权/方法/body 校验/错误码、CST 身份与父级校验、delete/duplicate/move 批量原子应用、revision/程序入库与 `editedBlockIds`。
- 浏览器 `test/browser/artifact-edit.e2e.mjs`（507 条检查）：编排面板、请求列表条件显示、画布实时预览、键盘/指针排序、只定位正文点击、重置顺序、内容+顺序+整体说明合并发送（信封指向 `edit_ui_blocks`）、Host 合成修订的渲染与血缘、只调顺序的 `render_ui` 路径、后台静默探测提前显示冲突、720–1179px 抽屉与 <720px 提示、深色；多卡片场景；Turn 关闭对账；M3-2 restore/branch 场景；M3-3 新增——未发送草稿写入 sessionStorage（含 instruction）、刷新后 Composer chip 与请求列表恢复、清理后回到初始态；M3-4 新增——临时样式卡片标记与编辑入口、信封携带 snapshot 且无 styleId、临时样式修订卡片、仅排序被阻止并显示引导；M4-1 新增——嵌套模式 toggle、嵌套 display id `b1.1.1`、信封携带 nodeId/digest/depth；M4-2 新增——同父嵌套重排、重置可用、chip 显示「调整区块顺序」、信封携带 `orderByParent` 且保留 `targetOrder`；M4-3 新增——结构 duplicate 请求（nodeId/sourceDigest/toIndex）、结构操作修订本地卡片标签、操作后编辑器关闭；M4-4 新增——Box/Grid/Section/Carousel 可选子区块与信封携带 Grid 子块 id；additions 表单/行/移除、信封 additions（parent/instruction）、move 菜单候选排除 root/当前 parent/祖先、单次 move 结构请求（目标 nodeId + index）；M4-5 新增——preview dry-run 200、confirm 后 apply、模态 `aria-modal`/初始焦点 Cancel、diff add 行、move 的 preview→apply 两段请求；B2-5 新增——strict toggle 默认关、信封携带 `"strict":true` 与 strict 指令；B2-6 新增——新修订继承 `$state` 与选中项；B1-5 新增——live region 嵌套重排/添加播报、grip `aria-describedby`、移动菜单首焦点与方向键焦点移动；不调用真实模型。
- `test/client/runtime-state.test.mjs`（13 条）：运行时状态快照（首渲染无、同修订、base 继承、latest fallback、克隆隔离、非法/超大忽略、callId fallback、容量/淘汰、clear/reset）。
- `test/client/nested-performance.test.mjs`（2 条）：大嵌套页（7 卡片/49 可编辑区块/57 CST nodes）的 tree + display mapping <2s、`insertNode`+reorder <2s（宽松预算 smoke）。
- `test/browser/nested-edit-renderer.e2e.mjs`（75 条检查）：嵌套编辑 library 的 `display:contents` 包装几何（card/text 0px 漂移）、innermost 点击/悬停、overlay union rect、reorder 路径映射、普通渲染无 wrapper 且输出不变；M4-4 扩展为 7 类容器 / 18 slots、Box/Grid/Section/Carousel 父子链、Carousel 滚动与 overlay 命中。
- renderer 契约新增 `test/renderer/nested-css-contract-check.mjs`（M4-4 起 28/28 direct + 5/5 scoped）：静态检查受影响直接子选择器与 grid/carousel 作用域排版补偿都有 `nested-edit.css` 对应项。

## 更新提示（npm latest）

- **Host**：`GET /api/intelligent-ui/update`（与其它路由同一 `connection.requestRejection` 认证）读取 npm `latest`（成功缓存 6 小时、失败 5 分钟、5 秒超时）。只有比运行版本新的**稳定版**才算更新；运行版本不可读或为预发布时 `updateAvailable=false`，不会误报。发现更新后，再读取 tag 固定的 `https://raw.githubusercontent.com/<repo>/v<latest>/release-notes/<latest>.md`，取前 6 条 `## Highlights`（去掉 Markdown 标记）；客户端按 DSH 当前语言在请求上加 `?lang=…`，以 `en` 开头时优先读 `<latest>.en.md`、缺失或无 Highlights 时回退默认文件（中文）；每个语言变体独立缓存。notes 读取失败仍返回版本信息、要点为空，并按失败 TTL 重试。
- **Client**：`src/client/sidebar-update.ts` 在侧栏面板 `<nav>` 前插入 normal-flow host（DSH 0.2.2-rc.1 没有该位置 slot；结构不匹配时静默不插入），`UpdateNotice.tsx` 渲染卡片。点击卡片打开 fixed 浮窗：右侧优先、空间不足时落到卡片下方，列出更新要点；点「点击查看详情」只打开浮窗列出要点；点卡片其余区域（含始终朝右的箭头）调用 `pluginNavigation.openBundle` 打开本 bundle 的插件详情页；外部点击/Escape 关闭，侧栏折叠为 rail 时卡片隐藏。
- **发布门禁**：`release-notes/<version>.md` 必须与版本号一起人工审核并提交；`publish.yml` 在 publish 前运行 `npm run check:release-notes`，缺文件或无 `## Highlights` 时拒绝发版。Release tag 固定后，卡片读到的文案不会漂移。

## 布局与间距契约

Auto 选中的自由布局、free 临时结果或选中的自由模板中，下述页面形态与排版指导仅作建议，以内容需要的组合为准；组件 flow 间距、语言、主题和安全规则仍适用。

- **渲染器拥有垂直节奏**：页面根 `Col`、`Section` 正文和 `Card` 内容都由渲染器的 flow 负责块间距（页面级 24px、组级 12px、内侧 8px）；模型不需要也不应该在这些位置再传 `gap`，否则会覆盖或叠加节奏。
- **显式 gap 只用于横向/紧凑组合**：`Row`、`Grid`、`Carousel` 和小组控件栈可用 1–2（内侧）或 3–4（组级）；不要用 5–6 的嵌套 `Col` 去模仿页面级留白。
- **禁止用手动空白兜底**：`Spacer()`、空的 `Box`/`Col`/`Card`、空 `Text`/`Markdown`、以及当空白用的 `Divider` 都会制造不可控的空白带；需要分组时用 `Card`，其余交给 flow。
- **兜底链路**：生成提示词与 Agent Skill 携带同一份契约；Host 的 `layoutWarnings` 对根 gap、纵向 Spacer、空 Section/Text、`gap: 0` 块栈返回非致命 warning，模型可在同轮修正；渲染器自身也保证 Section 正文是嵌套 flow、Article 根只保留一层间距。

## 决策策略

开关只决定能力是否可见；真正决定“这一轮出不出页面、出页面时用哪种版式”的策略只有一份，位于注入的 `tool:intelligent-ui` 提示词里（Host 在开关命中会话时还会在段首加一句“本会话已开启 Intelligent UI”，并追加当前有效样式的说明）。开启后的行为是：

- **由模型决定是否出页面（Auto 无默认）**：按「是否让读者更快、更准地理解」判断——概念、机制/流程、结构、对比、数据或交互用 `render_ui`；裸事实、术语复述、不解释运作方式的一句话定义、代码/翻译、闲聊或用户明确要文字时直接用 Markdown。两边都像适用时看种类：解释「怎么运作」即使文字版本很短也应用页面。
- **样式只决定出页面时的版式**：`Card` 页保持紧凑可扫读；`Article` 样式要求 article-first 页面——`Toc`、可折叠 `Section`、每个 major part 的实质 `Markdown` 正文，不允许只交骨架或把内容藏在交互后面；`Auto` 由模型在 Card、Article 或自由布局中选择。
- **强制出页面的入口**：用户显式要求渲染（`/intelligent-ui` 或明确要页面/看板）、按需生成、编辑请求仍必须出页面。
- **单一规则源**：Agent Skill 不重复决策规则，只负责“怎么做”。
- **实验性文档模式**：开启时普通回答的提示词改用“整篇即文档”契约（不写正文、`style: "free"`）；它只改变出页面时的呈现与提示词，不改变“是否出页面”的决策。按需生成、编辑请求与显式渲染请求不受影响。
- **自由布局开关**：插件详情页的「自由布局」写入 Host 设置文档的 volatile 字段；开启后设计规范降级为建议。它和答案样式正交，不替代样式选择；Auto 选择自由布局也不受该开关限制。

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
- **结果主题快照**：`programsToExportCards` 优先读取内联 temporaryStyle.theme，其次按 styleId 解析已保存模板，再把已解析的 themeStyle 与 scheme 逐卡片内联；导出后不再查询 catalog。无显式主题的临时结果沿用会话当前选中模板的主题（与 live 卡片同一解析），无模板时用内置主题；已保存模板缺失时按默认主题导出。
- **页面运行时**：`src/standalone/index.tsx` 只渲染真实 `OpenUIRenderer` 的卡片正文（不导出 DSH 的标题栏与折叠控件），因此地图、图表、表单等交互与 DSH 内一致；`@OpenUrl` 照常打开链接，`@ToAssistant` 退化为「复制消息 + toast 提示回到 DSH 粘贴继续」，剪贴板失败时 toast 保留原消息；插件详情页的「移除追问操作」默认开启，导出图片和页面时会移除追问控件及其最小包裹（Form 的字段随之移除；含正文的 Card 保留正文，只有纯追问区块整块消失）；关闭后保留并由页面复制消息。页面只保存导出时的主题（当前 light/dark），不跟随之后的 DSH 主题切换。

## 界面语言

- 浏览器半边的全部自有文案（输入框开关、菜单、卡片标题与状态、渲染失败提示、地图/代码块/计时器等组件 chrome、无障碍标签）都通过 DSH 的 locale 服务翻译：`ctx.locale.register('intelligent-ui', { zh, en })`，slot 注册声明 `locale` 后组件拿到注入的 `t`。
- 浏览器半边因此要求部署组合了 `@deepseek-ai/dsh-client-locale`（DSH Web 0.2.2 默认包含）；自定义组合缺少它时，浏览器半边不会挂载（Host 工具与提示词不受影响）。
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
  - `SKILL.md` — 工作流（决策策略只由注入提示词定义；显式调用是直接指令）、回答期间的只读 checkout 预检规则、OpenUI Lang 硬规则、设计规范（自由布局模式下降级为建议）、DSH 行为、收到 `<artifact-edit-request>` 信封时的定向修改规则、参考索引；
  - `references/components.md` — 57 个组件 + 73 个 `@functions`（14 core + 59 library）+ 5 个 action 的完整参数表；
  - `references/language.md` — 语法、表达式、`$` 状态、`@Each`、常见错误对照；
  - `references/examples.md` — 6+ 个可直接跑的完整程序（行程、计算器、SVG 教程、看板、表单、小游戏）；
  - `references/troubleshooting.md` — Host 校验错误原文与修法、运行时降级、预检规则；
  - `references/integration.md` — 其他部署/agent 的接入步骤与契约。

技能文件同时以普通目录形式随包发布（`skills/`），便于阅读、复用和二次分发。

### 面板动画、删除确认与 popover 裁切（第三/四轮用户反馈修复）

- 编辑面板改为无外边框的圆角浮动卡片：桌面 `top:64px / right:12px / bottom:12px`、`border-radius:16px`、双层阴影、`overflow:hidden`；窄屏 bottom sheet 同样无边框，使用 14px 圆角。进出动画只作用于面板，320ms `cubic-bezier(.22,1,.36,1)`：桌面从右滑入/滑出并淡入淡出 + 轻微 scale，窄屏从底部滑入/滑出；`prefers-reduced-motion: reduce` 时禁用。退出时编辑器延迟约 320ms 卸载（`data-closing="true"`），切换 active 草稿时旧编辑器立即卸载、不播放退出动画。
- 浮动面板增加 12px 右侧 inset，宽度拟合新增 `panelRightInset`（默认 0；DOM helper 传 12），因内容居中会在两侧各计入 inset：1440/748 + inset12 → 648，1300/900 → 508，1500/900 → 708；无 inset 的旧默认结果不变。退出卸载时恢复用户原来的 inline 宽度。
- 编排行右侧是一个正常的 24px「更多」触发器 `[data-dsh-iui-edit-row-menu]`，不再有覆盖文字的动作组；它打开 portal 菜单，包含定位、编辑、复制、移动到…、删除五项（`data-dsh-iui-edit-locate` / `-structure-edit` / `-structure-duplicate` / `-move` / `-structure-delete`），菜单项有 role=menuitem、方向键/Home/End、Escape、外部点击和焦点返回；触发器在正常 flow 中，标题不会与按钮重叠。
- 结构性删除是菜单内的持久两态确认：选择「删除区块」后，同一个菜单切换为 `data-dsh-iui-edit-structure-confirm` 的安静 Cancel 与 danger-tinted Delete 两个按钮（该步骤用 dialog 语义），无行红底/大红 pill；确认态只在 Cancel、Delete、外部点击、Escape、其它结构动作、预览打开、busy 或卸载时结束。焦点进入时落到 Cancel，取消/离开时回到行触发器；live region 播报一次。
- Block 指令 popover 现在先把目标 top 计算为 `preferredTop`，再统一 clamp 到 `[12, viewportHeight - 12 - measuredHeight]`（left 原本已 clamp），所以锚点滚出视口时输入框不会再被裁切到视口外。popover 滚动容器在 `overflow-y: auto` 的 padding box 内保留 4px 底部内边距，输入框获得焦点时的轨道光晕也留出了可见余量。
- 验证：Node **665/665**（Host 302、Client 340、packaging 23）；浏览器 9/9；`artifact-edit` **566 checks**（菜单/键盘焦点/Tab/forced-colors、输入轨道光晕、圆角/inset、enter/exit 动画名、`data-closing`、删除确认持久 / Cancel / Delete preview、popover 四边 clamp、真实 1180 shell fit、本地/内联图片与错误占位、回退链、跨卡草稿锁、引用锁与本地图导出 settle）；`nested-edit-renderer` 75；`nested-css-contract` 28/28 + 5/5。构建 host 841 kB、client 4.07 MB（js 3.85 / css 222.9 kB）；pack 65 files 6.04 / 12.92 MB。
- 部署：client 插件改动必须重启 `dsh-web` 后才会加载；页面刷新不足。

### 区块编排批量操作（用户反馈新增）

- 区块编排 section head 在「重置顺序」左侧新增「批量操作」toggle（`data-dsh-iui-edit-batch-toggle`、`aria-pressed`）：激活后每行拖拽柄替换为可 Tab 聚焦的选择控件（Space/Enter 或点击行主体切换），逐行结构菜单与行 hover 卡关闭，选中行有 `is-batch-selected` 视觉态；工具栏提供已选数量（`role=status`）、全选/清除、上移/下移/置顶/置底、复制所选/删除所选与退出；Esc 退出、切换修订或关闭编辑器时清空选择，焦点回到 toggle。
- 顺序操作只改草稿 `targetOrder`/`orderChanged` 并走既有持久化与 chip 同步，编辑请求编号与颜色不变；置顶/置底保持所选块相对顺序，上移按索引升序、下移按索引降序处理，每个所选块只与未选邻居交换一格。
- 批量复制/删除复用 `POST /api/intelligent-ui/artifact-structure` 的 `operations[]`（Host 单批上限 20），先 `preview:true` 在既有结构预览弹窗展示批量标题/涉及区块与同一 diff，确认后一次批量 POST 只记录一条 `kind:'structure'` 本地修订并提交草稿；duplicate 按页面降序发送、`toIndex = base 页内可编辑下标 + 1`，保证每份副本紧跟原块。选择超过上限或存在不可解析 nodeId/sourceDigest 的区块时在请求前拦截并显示内联错误。
- v1 只覆盖顶层 arrangement 列表（嵌套编排不变）；批量结构操作与内容编辑草稿不互斥，与单块结构操作的既有语义一致。


### 编辑流水线：结构操作队列、显式保存与总预览 Apply（2026-11-10）

- **根因**：此前批量/逐行结构操作成功后立即提交并 `markSubmitted`，编辑器关闭，用户填好的区块需求与整体说明丢失。现在所有结构操作（批量工具栏 + 逐行菜单的删除/复制/移动）先进入「本轮待执行队列」，不再立即写 Host。
- **批量模式**：进入时在面板本地快照 `targetOrder`/`nestedOrder`；批量复制/删除只追加面板本地 `batchOps` 并显示「待保存结构操作 N 项」（可单条移除），不发请求；「保存批量操作」把已即时作用于草稿的顺序与 batchOps 一并入队并退出；「取消」或 Esc 用快照恢复顺序、清空 batchOps 并退出。逐行菜单删除保留两段式确认后入队，复制/移动直接入队，均通过 `aria-live` 播报。
- **「本轮待执行」区**：结构操作队列（单条删除）、已保存区块需求/待新增摘要、整体说明（面板本地草稿 + 显式「保存整体说明」+ 已保存/未保存状态）与顺序状态。整体说明只有保存后才写入草稿、composer chip 与「待提交编辑」dock 摘要；队列数量计入 chip 摘要，仅有队列时摘要显示「结构操作 N 项」而不是整体说明。
- **底部 Apply**：`data-dsh-iui-edit-apply` 固定按钮，无已保存内容时禁用。点击后 `previewPendingStructureOps` 重新拉取 Host `preview:true` 权威 dry-run，打开总预览对话框（`aria-modal`、初始焦点在取消、Tab 焦点陷阱、Escape 关闭、关闭后焦点回到触发按钮）：结构操作列表、diff、涉及区块、模型请求摘要（区块需求/整体说明/顺序/新增/样式）与冲突列表；loading / failed（可重试）/ ready 三态；无排队结构操作时只显示模型摘要。冲突时 confirm 禁用并逐条说明如何解除。
- **Apply 执行**：`applyEditRound` 先用一次原子 batch 提交队列（`resolvePendingStructureOperations` 同时服务预览与真实提交：同父 delete/duplicate 按 base 下标降序、duplicate `toIndex = index+1`、同父混合 kind 或多 move 判 `order` 冲突、同一父内 move 的 `toIndex` 按移除自身后的目标长度计算并省略冗余 `toParentNodeId`），生成一条 `kind:'structure'` 本地修订；确认过总预览时复用其 dry-run program 作为 Apply preflight（队列身份不一致才重新 dry-run），因此一次 Apply 只发一次 dry-run + 一次真实 batch。随后 `rebaseDraftAfterStructure` 把草稿 rekey 到新修订：`remap.ts` 先用队列模拟 batch 后的兄弟顺序（同父 delete 移除槽位、duplicate 副本紧跟源、move 追加到目标父），再与 Host 权威结果逐位对齐映射块 id——副本槽位不参与映射（同签名副本不会抢走后续兄弟的已保存需求），容器块（Col/Row/Box/Grid/Card/Carousel）的显示标题派生自首个子块，按组件类型+位置配对避免首子块移动/删除造成误判，`nestedOrder` 把 batch 新建子块按 base 位置插入锚点（纯 duplicate 不会被误报为顺序改动）。重映射 selection/additions/targetOrder/nestedOrder，保留整体说明/样式说明/branch/strict/nestedMode，先 upsert 新 chip 再删除旧 session/reference/持久草稿并移除旧 chip，因此 composer 不会出现悬空 chip。任何 unmapped 需求/addition/嵌套子块或不可靠映射（如 duplicate+move 混合）都会在预览与 Apply 双重校验中阻止 Apply，绝不静默丢弃。纯结构 Apply 记录修订后直接关闭编辑器。
- **模型请求自动发送**：rebase 后若仍有模型内容，card 通过 `requestArtifactAutoSubmit` 发送：`composerHasPlainText` 预检；仅当 composer 处于 plain 且新 chip 已就位时调用 `inputActions.submit()`（≤12×400ms 轮询）。失败或输入框已有用户正文时保留 chip，并在 rekey 后的面板显示 `applyNotice`（「模型请求已在输入框，请手动发送」），由用户手动发送。
- **冲突规则**（preview 阶段阻止 Apply，且不发送任何 Host 请求）：排队删除的块或被删容器的子块仍被已保存编辑需求/addition 引用（`selection`/`addition`）；样式说明与结构操作混合（`styleMixed`）；同父级混合操作或多 move（`order`）；队列重复块（`duplicate`）；容器与其子块重叠（`overlap`）；超过 20 项（`limit`）；块或移动目标已不存在（`unresolved`）；post-batch 映射不可靠或需求/addition 无法落位（`target`）；页面超过结构操作支持的 CST 深度（`depth`，嵌套 move 用 `nestedTarget` 说明「该页面层级过深，暂不支持移动到嵌套容器」）或节点预算（`nodeLimit`，文案说明节点数量超限，绝不误报为深度问题）。
- **顺序与快捷属性**：`targetOrder`/`nestedOrderChanged` 仍属于模型请求（不产生零模型修订）；`Divider`/`Spacer` 快捷属性仍走确定性结构路由，但成功后同样 rebase，保留已保存需求、整体说明、排序与未执行队列，不再丢弃草稿。
- **深层页面**：`MAX_CST_DEPTH` 从 4 提升到 **10**（root 为 depth 0；真实 dashboard 为 depth 5–6、83 个 CST 节点），客户端嵌套映射与 Host 结构路由共享同一常量，因此大页面根级 delete/duplicate/move 可正常预览与 Apply；嵌套编辑 UI 仍只提供 display depth ≤4 的子块。`nestedBlocksForProgram` 不可用时 `resolvePendingStructureOperations` 回退到与 Host 同构的 CST 根级 block 表（nodeId/sourceDigest 与 Host 一致），根级操作仍可解析；超过支持深度的页面在预览阶段给出 `depth` 冲突（嵌套 move 给 `nestedTarget`），超过 200 个 CST 节点的浅页面给出独立的 `nodeLimit` 冲突（不再误报为深度问题，也不再显示误导性的「已不在当前修订中」）。
- **已知限制**：自动发送依赖 composer 处于 plain 阶段，busy/发送中降级为手动发送提示，并且只有 send 路径真正消费草稿后才显示「已发送」，无法确认时一律降级手动（不假报）；普通 Send 在存在未应用结构队列时被 `pending_apply` 拒绝（不 markSubmitted、不删草稿），必须 Apply 或清空队列；Apply 保留草稿的 attached 状态（detached 草稿不重插 chip、不自动发送），插入 chip 前按排除旧草稿的 attached 计数检查批次上限；嵌套模式 Apply 后按结果 program 重建嵌套 block 表与完整 nested order groups，selection/addition 必须落在新 block 表（否则阻止 Apply），嵌套选择允许 `b1.2.1` 形状并随草稿持久化；预览与 Apply 共用无副作用的模型请求校验（styleMixed/空说明/临时样式仅排序/临时修订/无效/冲突都会在 0 op 预览中显示并禁用 confirm），预览 loading 中取消会丢弃晚到响应；面板本地的未保存整体说明/批量草稿与 popover 未保存说明纳入统一 dirty 守卫（丢弃草稿需二次确认、修订删除锁覆盖、Apply 提示保存）；CST 节点预算超限与层级过深分别报 `nodeLimit`/`depth`；post-Apply notice 与草稿行共用 composer 卡片顶部 band：`[data-composer-overlay]` 由 `:has()` 规则回到文档流，band 的 `-8px` 顶边距经 DSH 的 `display: contents` slot outlet 落到卡片 padding 上（不能依赖直接子元素选择器），notice-only（Apply 消费掉草稿）时同样占位，不会盖住输入区；notice 条本身是 band 内的静默状态行（按状态取色的语义图标 + 12.5px 主墨色标题句与次要色说明句（首个分号优先、无分号用逗号，分隔符留在说明句内，渲染文案逐字不变）+ icon-only ghost × 关闭；状态同时由图标形状、图标颜色与文案表达；失败文案保持 primary ink 以满足 AA），不是有边框/填充的卡片横幅；单卡/舞台场景也可见；`submit()` 之后由既有 `reconcileArtifactSubmissions` 在 Turn 关闭时确认（Host 冲突仍走既有冲突横幅）；单次 Apply 队列上限 20（第 21 条被拒绝并提示，不截断、不丢草稿）；同一父级不允许混合结构操作种类；重映射依赖显示身份，duplicate+move 混合或无法唯一对齐时阻止 Apply（props 修订已记录但草稿无法迁移时，草稿/chip 保留在旧修订并显示可关闭的 `rebaseFailed` notice，不会静默留在过期画布）；结构操作支持 CST 深度 ≤10、节点 ≤200，Host 结构路由对更深的页面或超节点预算的页面整体拒绝（含根级操作），客户端分别以 `depth` / `nodeLimit` 冲突提前阻止；「移动到根级」仍受既有 Host move 校验限制（move 目标必须是可写容器）；编辑面板（中文）与 composer chip/dock（英文）在混合 locale 下语言可能不一致，属既有 chip locale seat 行为，非本特性引入；E2E 中走 Node bridge 的 structure 场景（25/25b/25d/61/63/65/67；25c 只取消批次、不发 preview/apply）直接调用共享 `applyStructureBatch`，绕过 Host 路由的鉴权、base registry 与幂等账本，这些路由级行为由 host 单测覆盖；E2E 引入真实异步 bridge 后仍有少量时序等待，套件存在非零 flake 概率；Phase B 已把批量取消后的 chip 负向断言改为 wait（不再单帧采样）并连续 3 次通过，其余时序等待仍按 known limit 记录。
- **测试**：`remap.ts` 纯函数 15 条单测（副本排除、容器派生标题、nestedOrder 锚点插入、duplicate+move 不可靠）+ store 队列/预览/apply/rebase/chip rekey 与 20 上限拒绝单测 + 深层页面根级结构单测 + props 失败契约单测（mock 返回结构不一致的 props 结果：本地修订已记录、旧草稿/chip 保留、`applyNotice='rebaseFailed'` 且可关闭）+ 恢复的 batch-order 单测（`test/client/artifact-edit-batch-order.test.mjs` 6 条：up/down/top/bottom、只改 targetOrder/orderChanged 不动已保存需求、nested 按父独立、无选择/边界 no-op）+ Host 路由深度用例（`test/host/artifact-structure.test.mjs`：depth 6/83 节点根级 duplicate 与 delete 经真实路由成功并记录修订、depth 11 被路由拒绝且不写修订/账本）；`artifact-edit` E2E 迁移场景 25/25b/25c/25d/27/31/33/36 到「入队 → 保存 → 总预览 → Apply」，新增场景 57（结构 + 2 项需求 + 整体说明 auto-submit：`__submits` +1、真实发送文本的 `baseRevisionId` 为新修订、blockId b3/b5→b2/b4 重映射、整体说明保留、只有一次 dry-run + apply）、58（输入框有用户正文 → 不自动发送、保留 chip、notice 提示手动发送且可关闭）、59（刷新后 pendingOps 恢复）、60（三类冲突阻止 Apply 且零 Host 请求）、61（depth 6 / 83 节点 dashboard 根级批量 duplicate 预览无冲突并 Apply 成一条修订）、62（超过支持深度的页面给 `depth`/`nestedTarget` 冲突且零 Host 请求）、63（两块同签名无标题 Text：duplicate 前块后，后块的已保存需求仍落在原块 b3）、64（第 21 条入队被拒绝并提示，已保存需求/整体说明不丢）。套件 790 → **909 checks**（Phase A）→ **920 checks**（Phase B）。Phase A 复审修复新增单测：嵌套 Apply 重建嵌套表/完整 order/序列化/reload、嵌套选择/b1.2 形状持久化、0-op 预览冲突（styleMixed/stale/instruction/temporaryOrder）、普通 Send 队列阻塞、detached rebase、composerHasPlainText 多 chip、真实发送确认、统一 dirty 守卫、nodeLimit 区分、取消预览竞态；E2E 新增 65（嵌套 Apply 保留嵌套草稿并序列化）、66（队列 pending 时普通 Send 被拒、清空后正常）、67（detached 草稿 Apply 不重插 chip/不自动发送，显式 attach 后序列化）、68（0-op 预览 stale 冲突禁用 confirm，分支后解除）。Phase B 复审修复新增：版本 store 的删除回退选择（删除当前显示修订后 selected 指向确认文案里的回退目标，而不是无声跳到 latest）与 `stageProgramFor` 只在 stage 实际显示回退目标时合成 `fallbackFrom`（选其他修订即恢复可编辑）；`artifact-version.test.mjs` +3 条、`version-items.test.mjs` +2 条（local props/style kind 覆盖 Host 的通用 structure 标签）、`artifact-edit-remap.test.mjs` +1 条（客户端队列上限与 Host batch 上限共用 `MAX_ARTIFACT_STRUCTURE_OPERATIONS`，20 接受/21 拒绝）、`doc-facts-guard.test.mjs` 9 条（上下文数字匹配、Host/Client 互换与旧文案失败用例）；E2E 新增场景 69（显示旧修订 → 删除 → stage 落到回退目标并只读 → 选另一版恢复编辑入口）与旧流程/图片导出错误文案断言（notice-only 无 stage 时显示具体原因而不是通用失败，且不下载）；`artifact-edit` 套件 **920 checks**，图片导出 **76** 条断言，`test/browser/README.md` 同步。E2E 的场景 25/25b/25d/61/63/65/67 用真实 `applyStructureBatch`（Node bridge）生成 mock preview/apply，preview 与 apply program 与 Host 一致；57/58 等其余结构场景仍用手写 mock（只验证 client 侧 draft/rebase/发送行为，Host 引擎与路由一致性由 host 单测与 bridge 场景覆盖）。
- **当前验证**（2026-11-14，本地 `main` 已推送并与 origin/main 同步；Auto 格式决策的价值判据优先级、release-check 全量 manifest、安装器空文档、composer 应用结果条修复/重设计（Codex gallery 方案 C：语义图标 + ghost ×）、草稿行 chip 化、独立复审修复与侧栏更新提示（Host 查 npm `latest` 与人工审核的 release notes，点「点击查看详情」弹要点浮窗、点卡片其余区域打开插件详情页，非遮挡布局））：Node **821/821**（Host **320**、Client **464**、packaging **37**）；浏览器 **10/10** 套件，`artifact-edit` **944 checks**、`nested-edit-renderer` 75、图片导出 76 条断言；构建 host **858 kB**、client **4.20 MB**（js 3.96 / css 249.4 kB）；pack **65** files；非构建 **3,818,283** 字节；`npm run check:docs-facts` 与 `git diff --check` 通过。

- **已知缺口**：`additions`（模型新增区块）尚未写入草稿持久化记录，reload 后同会话内的新增会丢失（同会话 Apply 重映射与序列化正常）；属既有缺口，非本轮流水线引入。

### 图标系统：统一 Remix Icon

- 插件自身 UI（编辑面板、编排行、画布选中浮层、设置页、样式选择器、composer 芯片、导出菜单、文章/媒体/文本组件控件）的所有图标统一来自 **Remix Icon v4.9.1**，路径数据内联在 `src/lib/components/remix-icon.tsx`（`REMIX_ICON_PATHS` + `<RemixIcon name size className>`，`0 0 24 24` viewBox、`fill=currentColor`）。不新增运行时依赖、不打图标字体，图标随 `currentColor` 继承颜色。
- 之前手绘的 stroke 图标（16px viewBox 的铅笔/垃圾桶/复制/移动/拖拽柄/刷新/关闭/类型图标，以及字符 `✎`、`✦`）全部替换；DSH primitives 的 `IconSparkleRegular` / `IconChevronDownOutlineRegular` 也不再用于图标。
- **例外**：OpenUI 程序内容里的 `Icon("…")` 仍由 `src/lib/components/glyph.tsx` 用 `lucide-react/dynamic.mjs` 惰性解析——那是模型生成的程序数据（历史程序里写的是 lucide 名称），不是插件 chrome，替换会破坏既有程序。
- 许可：Remix Icon License v1.0（见 `licenses/remix-icon-LICENSE` 与 `NOTICE`）。
- 验证：Node 665/665、浏览器 9/9、`artifact-edit` 566 checks、`nested-edit-renderer` 75；构建 host 841 kB、client 4.07 MB（js 3.85 / css 222.9 kB）；pack 65 files 6.04 / 12.92 MB。

### 按 Artifact 的修订历史（用户反馈新增）

- 入口两处：卡片头部常显历史图标（渲染修订 >1 时图标后带修订号，替代原独立 `Revision N` 徽标按钮）、编辑面板头部历史按钮；均只打开**当前 Artifact** 的历史，不混入其它 Artifact。
- Host：`ArtifactRevisionStore.listForArtifact()`；`GET /api/intelligent-ui/artifact-history?artifactId=` 返回元数据（新→旧，含 current/source/hasProgram/restorable；合并 program-only 的初始修订）；`GET /api/intelligent-ui/artifact-history/program?...` 按需取 program；现有 restore 路由扩展为支持初始修订（source 记录缺失但 program 仍在时，用 latest 的 style/styleId/temporaryStyle/title 兜底，新修订号 latest+1）。
- Client：`ArtifactHistory.tsx` 元数据对话框（Revision N、当前、source、时间、样式、改动区块 chips；无整页预览），`hasProgram=false` 时显示不可用，旧修订可恢复；恢复复用零模型本地修订管线并刷新历史。删除前客户端用 `rollbackTargetFor()` 在历史列表中选出修订号更小且 `hasProgram` 的最新修订，经 program 路由取回后写入 `artifact-edit/revision-fallbacks.ts`（每 session、`localStorage`、最多 20 条），删除成功后 `IntelligentUICards` 用 `applyRevisionFallback()` 把仍在渲染被删修订的工具结果卡片重定向到该修订（保留 `callId`/`requestId`，替换 program、修订号与样式），刷新后仍生效；导出入口（`export-data.ts`）应用同一 fallback。
- 删除：同一 `GET /api/intelligent-ui/artifact-revisions` 路径接受 `DELETE`（同一认证/`effect`/disposer），`ArtifactRevisionStore.remove()` 拒绝初始渲染（404 `revision_missing`）和仍被其他记录作为 `baseRevisionId` 的修订（409 `revision_referenced`），成功后原子重写注册表并清理保留 program；允许删最新（最新回退上一条）。客户端在 DELETE 前选出回退目标并持久化，删除成功后把仍渲染被删修订的卡片重定向到回退修订（回退卡只读；回退目标之后又被删除时沿回退链解析，深度/循环上限 20）；**卡片自己渲染的修订在没有回退目标时不提供删除**，避免卡片指向已删除记录；**会话内任一张卡存在未发送编辑草稿时，对应基础修订都不允许删除**（否则画布会被拆掉、chip 指向已删 base）；仍被更新修订作为基础的修订隐藏删除并说明（Host 历史返回 `referenced`）；由客户端本地修订卡拥有的修订删除后随卡片移除，不写回退记录，且不会成为回退目标。无可用回退目标时从其他卡片删除仍会成功，其他仍渲染该修订的卡片可能保持 stale。删除返回 `revision_missing`（例如响应丢失后的重试）视为已收敛：移除匹配本地卡并刷新历史。删除确认聚焦 Cancel，取消回到 Delete，warning 以 status 播报；聊天中已生成的模型卡不删（内容按回退目标重渲染）。
- 限制：初始修订靠 program registry 推断，program 被 LRU 淘汰时该行缺失；初始行自身无 style，借用最早修订记录；历史列表不触碰 LRU，program 仅按需 lookup。

### 历史单一入口与删除回退（2026-11-09）

- 入口收口：卡片头部历史图标成为该卡片唯一的历史入口；渲染修订号 >1 时在图标后追加数字（`data-dsh-iui-history-count`），原独立 `Revision N` 徽标按钮移除（编辑面板头部历史按钮保留）。卡片头部图标、编辑面板按钮与此前的 Revision 徽标共用同一个 `ArtifactHistory` 与同一份 Host 历史，收口只减少重复入口，不改变数据来源。
- 回退目标：删除已记录修订前，`rollbackTargetFor()` 在历史元数据中选出「修订号更小且 `hasProgram`」的最新一条；客户端经 `GET /api/intelligent-ui/artifact-history/program` 取回其 program，由 `createRevisionFallback()` 组装并写入 `artifact-edit/revision-fallbacks.ts`（key `dsh-intelligent-ui-revision-fallbacks:v1:<sessionId>`、每会话最多 20 条、`localStorage` 持久化）。取不到回退目标时，卡片自己渲染的修订行不提供删除；其他行仍允许删除（此时其他卡片可能按既有约定变 stale）。
- 卡片重定向：`IntelligentUICards` 订阅 `useRevisionFallbacks`，用 `applyRevisionFallback()` 把仍渲染被删修订的工具结果卡片替换为回退修订（保留 `callId`、`requestId` 与卡片位置，替换 program/`revisionId`/`revision`/样式/标题），因此不必从 transcript 删除消息卡；刷新后由 `localStorage` 恢复回退。回退卡带 `fallbackFrom` 标记并只读，避免与同一修订的原生卡共用 `editKey` 而挂载双编辑画布；回退链由 `resolveRevisionFallback()` 传递解析（记录新回退时也会改写旧条目）。普通卡片动作访问 Host result 快照时统一用 `resultIdOf(program)`（`revisionId ?? callId`）；但回退卡是只读的，且回退到 initial 时其 temporaryStyle 是借用记录、没有对应 result 快照，因此 Save as template / 底部 Adjust 在回退卡上隐藏；本地修订卡拥有的修订删除时由 `localRevisionIds` 识别并跳过回退记录。
- 导出与本地卡：消息导出（`export-data.ts::programsForMessage`）接受同一 fallback map，导出的页面与可见卡片一致；本地修订卡（结构/属性/样式/恢复）删除时仍走 `removeLocalRevision()` 从列表移除，不需要回退记录。
- 验证：Node **665/665**（Host 302、Client 340、packaging 23）；浏览器 9/9；`artifact-edit` **566 checks**（单一入口与修订号、回退确认文案、回退后卡片内容/修订号、刷新后仍回退、无回退目标时无删除、回退链传递解析、回退卡只读、跨卡草稿锁、引用修订无删除、result 身份与本地卡无回退记录、data URI 头级像素上限）；`nested-edit-renderer` 75；构建 host 841 kB、client 4.07 MB（js 3.85 / css 222.9 kB）；pack 65 files 6.04 / 12.92 MB。

### 本地图片来源（2026-11-09）

- **共享策略**：`src/shared/image-source.ts` 分类 `Image` 的来源——`http(s)` 直接显示；`data:image/{png,jpeg,webp,gif};base64` 校验后直接显示（解码 ≤512 KiB）；其余按路径处理，拒绝 NUL/控制字符、`..` 段、`~` 与任何 URL scheme（绝对路径与工作区相对路径都允许），本地文件上限 10 MiB、像素上限 40 MP（本地文件与内联 `data:` 都对已知的 PNG/JPEG/GIF/WebP 头预解析，未知头回退到加载后检查），MIME 按 magic bytes 嗅探，SVG 按内容识别后给出专门的 `svg-unsupported` 占位。协议相对的 `//host/x` 归一化为 https，`DATA:` 按大小写不敏感处理。路径语法只做输入卫生，权限边界是 Host 进程经 workspace-files 的读权限（该接口可读工作区外绝对路径），不是工作区沙箱。
- **客户端读取**（`src/client/image-source.ts`）：通过 `remote.workspaceFiles.stat/readBytes`（DSH 0.2.2 的 workspace-files 客户端命名空间，与文件预览同一 Session 读权限）读取字节，按内容嗅探 MIME 后 `URL.createObjectURL` 生成同源 Blob URL；失败映射为渲染器的错误占位 code。`src/client/index.tsx` 用可选 `ctx.inject(['remote.workspaceFiles'])` 绑定，服务缺失时本地图片降级为「不支持」占位，插件仍能加载。
- **渲染层**（`src/lib/components/image-source.tsx`）：`ImageSourceProvider`/`useImageSource` 管理 loading/ready/error 与 Blob URL 生命周期（卸载即 revoke）；`Image` 的显式来源失败只显示错误占位，不再用 `alt` 搜索；`SearchImage` 行为不变；`Markdown` 的 `![alt](src)` 走同一解析（含空格/括号的目标用 `<>` 包裹）；`OpenUIRenderer` 新增可选 `resolveImage`，卡片与编辑画布共用同一 resolver；`Image`/`SearchImage` 显式区分 mode：非字符串/动态 `src` 一律按无效显式来源处理，不退化为搜图；内联 data 图在进入 ready 前做头级像素检查。显式来源解析期间容器带 `data-iui-image-pending`，供导出 settle 等待（含 Markdown 图片）。
- **导出**：PNG 抓取实时 DOM，Blob URL 同源不污染 canvas；错误占位计入「已落定」避免导出等待满额；离线只跳过搜索等待，本地图仍会等待解析。HTML 单文件导出只等待本地来源解析（`settleLocalImages`，短上限），不等待图片搜索/远程加载；只收集**导出卡片集合内**已成功解析的本地图，并按卡片 callId + source 分组后内联（portaled Popover、失败/超大/SVG 本地图与未导出的本地修订卡显示占位）。单文件 HTML 导出从实时卡片 `img[data-iui-image-src]` 读回 Blob 并转 data URL，随 `mountIUI` 的 `assets` 表内联；standalone 页面用该表合成 resolver。
- **兼容/边界**：依赖 DSH 0.2.2 的 workspace-files 服务；绝对路径按查看会话的读权限解析，跨会话/跨设备可能指向不同文件；图片是渲染时快照，没有 live 刷新；`HtmlView` 沙盒 iframe 内的本地图片不支持；path/data 来源的 SVG 被拒绝，http(s) 的 SVG URL 仍按浏览器 `<img>` 行为显示（不执行脚本）。
- 验证：浏览器 `artifact-edit` 场景 42（本地图/内联图/http 图/缺失/坏链/SVG/越链/Markdown 图，且显式来源不触发搜图）与 `standalone-page` 的内联图片断言；`test/client/image-source.test.mjs` 覆盖分类、路径策略、MIME 嗅探、大小上限与错误映射。

### 草稿切换条移到输入框上方

- 编辑面板是**当前 Artifact** 的；而 `Pending edits (N/6)` 是**本 session** 的草稿切换器，放在面板里容易与 Artifact 混淆。现在它渲染在 composer 的 `conversation.input.overlay` slot（列表、session scope），成为输入框卡片内部顶部的一条草稿行（位于 textarea 上方），不再额外占用聊天滚动区高度。
- `DraftDock.tsx`：无草稿返回 null（零高度）；否则显示安静的一行 `待提交编辑 (N/6)` + 横向 chips；每个草稿的标题渲染为带 `file-text-line` 图标的 chip（hairline 边框 + hover surface），修订与请求摘要作为 chip 后的次要 meta 同行显示，active chip 用主色（business）边框作为选择提示并带 `aria-current`（surface step 的填充变化约 1:1、实际不可辨；hover 只提亮 hairline，不与选中态混淆），Discard 仅 hover/focus 显示（detached 时 Attach 常显）；data hooks 与旧面板一致。
- EditPanel 不再渲染 DraftSwitcher，直接从 Edit requests / Block arrangement 开始；草稿上限/批量附加逻辑不变。

### 编辑态可交互暗示与选中卡片（2026-11-06）

- 进入编辑后，未选中区块不再在内容本身上做明暗变化，也不加图标：每个**顶层可编辑区块**有一道淡色光晕沿其看不见的圆角边缘绕行一圈（约 2.6 秒一圈），带渐隐拖尾与柔和外发光；各区块错开相位，并按蓝/紫/绿/黄/粉/青六种淡色轮换（与选中编号的色系一致，但更浅）。悬停时该区块光晕变亮；选中或指令弹窗打开的区块仍使用圆角卡片 + 柔和悬浮；`prefers-reduced-motion` 下光晕停在原位不再绕行。实现为 block wrapper 上的 conic-gradient + 圆角环 mask（`::after`，`inset: -2px`，1.5px 环宽，只作用于根层 wrapper），因此圆角连续、没有 border/新增 DOM/内容 tint/外扩 halo；嵌套子元素不参与。
- 选中区块不再用蓝色边框，而是给 `.dsh-iui-block-body` 圆角 16px + 画布背景 + 柔和阴影，overlay 只保留中性 hairline 与悬浮阴影；键盘 focus-visible 用中性 ring。
- 历史对话框标题副行只在有真实 title 时显示，不再把 artifactId 当标题；styleId 显示为本地化样式文案；未知改动区块显示「区块」而不是 blockId；编辑面板头部增加「退出编辑」。

### 活动舞台与可见性回落（M1，2026-11-10）

- **版本 store**：新增 `src/client/artifact-edit/artifact-version.ts`（内存 + `useSyncExternalStore`，按 `(sessionId, artifactId)`）。每张卡以 `cardId`（transcript callId 或本地修订 id）注册自己的 revision/program/meta/turn；state 维护 `revisions`、`latestRevisionId`、`selectedRevisionId`、`stageCardId`、`stageVisible`。注册规则是纯 reducer（可单测）：首卡成为舞台并选中 latest；新卡 revision 更大时，舞台可见 → 该卡为 notice、latest/selected 前进、舞台原位重渲；舞台不可见 → 新卡晋升舞台、旧舞台 frozen、不滚动；同/旧 revision 按 turn/revision 相对舞台给 frozen/notice；舞台卸载 → 剩余卡中最新者接管并选中 latest，最后一个卡卸载时 artifact 状态清空（重新加载/重挂载按已加载卡重新收敛到最新，D6）。`selectRevision` 暴露给 M2。
- **渲染角色**：`IntelligentUICards` 的每张卡经 `ArtifactVersionGate` 决定角色。stage 用选中 revision 的 program/meta 合成渲染，但保留自己的 `callId`（`data-dsh-iui-call-id` 稳定）并带 `data-dsh-iui-stage-card`/`data-artifact-id`/`data-dsh-iui-stage-visible`；编辑 key、history `currentRevisionId`、runtime state 全部以选中 revision 为准。notice 渲染一行 `data-dsh-iui-revision-notice`（「修订 N 已更新到上方卡片」），点击滚动并聚焦舞台卡。frozen 渲染自己的 revision 完整卡 + `data-dsh-iui-stage-stale-hint`（「最新修订已移到下方」，点击回到舞台）。若舞台显示的是某张 frozen 卡原生拥有的 revision，舞台只读，避免两卡共享编辑 key 挂起两个画布。
- **可见性**：舞台卡的 IntersectionObserver（`rootMargin: 0 0 24px 0`）上报可见性；只有舞台可见才原位更新，否则回落为今天的新结果卡。观测结果写回 store 并渲染 `data-dsh-iui-stage-visible` 供 M2/E2E 使用。
- **一致性边界**：`reconcileArtifactSubmissions` 继续使用本 Turn 原始 programs（notice 卡同样参与对账）；local revisions（restore/structure/style/props）走同一 gate；历史删除先经现有 `revision-fallbacks` 生成回退，再 `forgetArtifactRevision` 删除记录并把 latest/selected 指回可用记录，舞台不会悬空。选中/最新 revision 也计入 `renderedRevisionIds`，让删除守卫把舞台显示的版本当作已渲染。
- **测试开关**：`setArtifactVersionStageEnabled(false)` 仅供浏览器 harness 使用（`artifact-edit` 场景 1–48 之前的既有断言保持 pre-M1「每修订一张卡」语义，场景 48 开启 stage 覆盖 M1）；生产默认开启，无持久化、无 Host 路由、无新修订枚举值。
- **已知限制**：M1 不做版本切换 UI/缩略图/持久化（M2）；被抑制的修订不再有整卡，图片/HTML 导出仍按既有 Turn DOM/消息 program（导出对齐留 M3，属已知回归风险）；frozen 卡仍保留既有编辑入口（D10 冲突/分支流程），当舞台显示 frozen 卡拥有的 revision 时舞台只读、编辑需从该卡进入；真实屏幕阅读器/coarse pointer 未单独验证。
- 验证：Node **685/685**（Host 302、Client 360、packaging 23），其中 `test/client/artifact-version.test.mjs` 19 条（review 修复后为 25 条）；浏览器 9/9，`artifact-edit` **599 checks**（M1 场景：可见舞台原位更新且无新卡/notice 行/点击聚焦、不可见舞台晋升 + frozen hint、重挂载回到最新、选中旧版本舞台只读、local revision 抑制与重挂载晋升）；构建 host 841 kB、client 4.08 MB（js 3.86 / css 225.0 kB）；pack 65 files 6.04 / 12.94 MB。

### 最近任务式版本条、截图缩略图与切换动画（M2，2026-11-10）

- **版本条**：stage 卡头的 history 图标（带修订号）改为打开横向「最近任务」浮层（portal 贴卡片定位、`role=dialog` + `role=listbox`、`data-dsh-iui-version-bar`）；旧 metadata 对话框降级为条内「详细列表」入口，恢复/删除仍在那里；frozen 卡的历史图标继续直接打开详细列表做只读管理。条目合并三类来源（Host history metadata、client-local revisions、M1 store 已知 revisions），按 revision 降序取最近 20 条，其余显示「还有 N 个更早修订」；每项显示缩略图/占位、修订号、来源（初始/区块编辑/结构操作/恢复/样式切换/属性调整）、时间、「当前」与待发送草稿标记。键盘支持方向键/Home/End/Tab 在条内循环、Enter/Space 原生激活、Escape 关闭并归还焦点；`aria-selected` 标记当前项。
- **按需切换**：选中某版本时若 M1 store 尚无该 revision program，则用现有 `fetchArtifactHistoryProgram` 按需拉取并 `registerArtifactRevision` 注册进版本 store，再 `selectArtifactRevision` 让 M1 舞台原位渲染；不写 Host、不产生修订、不新增卡片。内容不可得（`hasProgram=false` 或 fetch 失败）保持当前版本并提示；切换过程只有 GET（artifact-base 登记除外）。
- **缩略图**：新增 `src/client/artifact-edit/artifact-thumbnails.ts`：key = artifactId + revisionId + scheme，内存 LRU（40 条/6 MB，淘汰即 revoke object URL）+ IndexedDB `dsh-iui-thumbnails:v1`（按 artifact 索引、每 artifact 最多 40 条、写入后清理最旧）；IndexedDB 不可用/私密模式/配额失败全程安静降级为内存缓存与占位。采集用 SnapDOM（与图片导出同款）：stage 显示新 revision 后（字体就绪 + 两帧 + 约 420ms settle）异步截 stage 卡 → 宽约 300px webp(0.8) 入库；版本条打开时对前 8 个无图条目并发 ≤2 离屏渲染一次再截（真实 renderer 渲染后卸载清理），失败/超时留占位。历史删除时清理对应 revision 缩略图。
- **FLIP**：`src/client/artifact-edit/stage-flip.ts`（纯几何 `interpolateFlipRect` 可单测）在选中后以版本条缩略图矩形为起点、stage `.dsh-iui-body` 矩形为终点，fixed 图片浮层过渡约 260ms，同时 stage opacity 0.35→1；`prefers-reduced-motion` 或缩略图缺失时直接切换；浮层带 `data-dsh-iui-stage-flip` 且所有路径都会移除。
- **D5 双 scheme**：每个 revision 的 light/dark 各存一份缩略图。stage 自动截真实卡后，用离屏 renderer 以另一 scheme + 该 scheme 的主题变量再截一张并按另一 key 入库；版本条懒采集对两个 scheme 各排一次（同一并发上限、非当前 scheme 使用自己的 themeStyle）。读取优先当前 scheme，缺失时才回退另一 scheme 并用 `data-thumb-scheme` 标注；删除修订时两 scheme 一并清理并写 tombstone，飞行中的采集不会写回。
- **测试与范围**：新增单测 20 条（LRU/字节上限、IDB 降级、repo hydrate/put/remove/clear、双 scheme 存取/回退/tombstone、版本条条目合并/上限/current/draft/来源、FLIP 几何）；浏览器 `artifact-edit` 新增场景 49（版本条打开/当前与来源/draft 标记/方向键+Tab+Home/End/Escape 焦点、缩略图自动与懒采集、FLIP 浮层、选中旧版本无新卡且无 Host 写、reduced-motion 直接切换、详细列表入口、stage-on 删除回退；套件 599→632 checks）。自动缩略图只在 stage 卡显示该修订时触发；frozen/未显示过的历史版本由版本条懒采集（失败留占位），不是全量预生成。store 生命周期：最后一张卡卸载即清空该 artifact 状态，下次加载卡片时从已加载 Turn 重新收敛到最新（会话内 Turn 窗口重建会回到最新，而非保留旧选择）。既有 1–47（stage off）与 48（M1）全保留。不改 Host/路由/持久字段、不改 `reconcileArtifactSubmissions` 与 M1 角色规则；图片/HTML 导出对齐仍留 M3（已知风险）。
- 验证：Node **705/705**（Host 302、Client 380、packaging 23；新增 20 条）；浏览器 9/9，`artifact-edit` **632 checks**；构建 host 841 kB、client 4.11 MB（js 3.88 / css 230.8 kB）；pack 65 files 6.06 / 12.98 MB。

### 导出跟随当前显示版本、旧版本继续编辑与 stage-on 删除回退（M3，2026-11-10）

- **导出对齐（D8）**：图片/HTML 导出都按「当前屏幕显示的版本」取内容。
  - HTML：`export-versions.ts` 在 `programsFor` 之后按 artifact 查询 M1/M2 版本 store 的选中 revision，用 `stageProgramFor` 合成导出 program（保留原 callId），title/style/styleId/temporaryStyle 一并跟随；store 不知道时原样导出。选中 revision 的 stage 卡可能在另一 Turn，`export-html.ts` 新增 `assetElements`（导出 callId → 展示元素）从该 stage 元素读取本地图片并按导出 callId 建桶，保持单文件内联图片行为。
  - 图片：`export-image-targets.ts` 纯规划器（可单测）按消息内顺序解析该 Turn 的 notice/card：notice 用 `data-dsh-iui-artifact-id`，卡片用 `data-artifact-id`（现所有 gated 卡都带该属性）；优先跨 Turn 找 `[data-dsh-iui-stage-card][data-artifact-id]` 捕获当前显示版本，找不到 stage 时退回本 Turn 的同 artifact 整卡；notice 且无任何可捕获内容时抛明确错误（绝不静默导出旧版本）。多 artifact 按出现顺序去重，逐个展开/等图片与地图 settled 后 SnapDOM 截图，用 `stackBoxes` 纵向合成一张（同一 beautify 边框）。只有完全没有 artifact 身份（pre-version/M0）的卡片列表才走原 container 整体截图；生产 gated 卡的普通 Turn（单卡或多卡）都走 elements 路径（单卡直接截、多卡纵向合成）。
- **stage 编辑面（D10）**：当 stage 显示的是某个 frozen 卡原生拥有的 revision 时，frozen 卡转为只读、stage 作为唯一编辑面（同一 editKey 不会双重挂载画布）。因此可先经版本条选旧 revision，再在 stage 上沿用现有「冲突横幅 → 从此修订创建新修订」branch 流程；请求 baseRevisionId 为选中 revision、带 `branch:true`，不产生额外卡片。
- **stage-on 删除当前 transcript revision（D3）**：详细列表删除 stage 当前显示的 transcript revision 时，走既有 revision-fallbacks（记录回退 program）→ `forgetArtifactRevision` 删除记录；若被删的正是 selected revision，selected 指向确认文案里的回退目标（不再是无声跳到 latest），否则保留仍存在的 selected / 退回 latest；stage 由 fallback 重指向，不悬空、卡片数量不变。当 stage 显示的是从 Host history 拉取的 revision（卡片自身 program 仍是旧 revision）时，store 在回退记录上写 `redirectedFrom`，`stageProgramFor` 仅在该记录就是 stage 实际显示的回退目标时合成 `fallbackFrom`，回退后的 stage 同样保持只读（真机复验补充场景）。`fallbackFrom` 只对「stage 正在显示回退目标」生效：stage 的卡片级 fallback 标记只属于它自己回退到的 revision，选择其他 revision 后不再带标记、恢复可编辑（这正是删除后选另一版可继续编辑的契约）。`redirectedFrom` 写在 **fallback target 记录**上且是 sticky 的：该 revision 之后再次被 stage 选中时仍然只读（与既有「回退卡只读」契约一致）。stage 显示 **local revision**（结构操作本地修订）时同样按 transcript 卡语义删除并写 fallback：`renderedRevisionLocal` 只对「callId===revisionId 的真本地卡」为真，`locallyOwned` 也要求打开对话框的卡就是该 local 卡，避免 stage 被误判为本地卡而跳过 fallback。
- **测试**：新增纯单测 `export-versions.test.mjs`（store 选中优先/未知回退/callId 稳定/多 program 顺序）与 `export-image-targets.test.mjs`（pre-version container 兜底、跨 Turn stage、本 Turn 整卡回退、notice 无 stage 明确错误、混合顺序、stackBoxes 几何）；artifact-edit 套件新增场景 51（stage 选旧 revision → branch：冲突横幅 base=选中修订、envelope `branch:true`/`baseRevisionId`/`artifactId`、无新增卡）、场景 52（删除 stage 当前 transcript revision：fallback 后 latest/selected 正确、仅一个 stage、卡片数不变、行移除）、场景 53（单卡 Turn 删除当前显示 revision：fallbackFrom 继承使回退卡只读、stage 不换卡）、场景 54（单卡 stage 显示从 history 拉取的 revision，删除后经 `redirectedFrom` 保持只读、卡片数不变、版本条回落到旧 revision）、场景 55（单卡 stage 显示 store 中的 local revision，删除当前显示 local revision 后写 fallback、stage 同卡且只读、badge 消失、卡片数不变；本地卡自身的删除仍不写 fallback）与场景 56（同一条 local revision 同时存在于 localStorage/`localRevisionIds` 且其 local 卡位于未渲染 Turn；mutation 验证：旧公式 `program.localRevision === true` 时该场景失败，新公式 `&& callId===revisionId` 通过），套件 632→699 checks；另修复 review 发现的注册语义（同一 cardId 更新而非 unregister→register，frozen 卡在 stage 显示其 revision 时只读）与 stageProgramFor 的 fallbackFrom 继承；导出套件新增 D8 场景：notice-only Turn 的图片导出必须捕获 stage 卡（断言捕获元素带 `data-artifact-id`、内容为 SELECTED 而非 RAW 旧 program）与 HTML 导出嵌入选中 revision program、不嵌入旧记录。
- **范围/限制**：不改 Host/路由/持久字段；导出仍不支持跨 session 版本 store（仅当前 session）；多 artifact 合成以最大宽度+12px 间距纵向拼接，不同宽度留透明侧边；异步媒体/地图仍以 settled 为准；branch 流程语义未改，仅放开 stage 编辑面；删除修订后被删除版本的 notice 行若仍挂载可能短暂指向旧 revision（revision-fallbacks 会在卡片重渲染时重定向；作为已知限制记录）。验证：Node 722/722（Host 302、Client 397、packaging 23；新增 18 条）；浏览器 9/9；artifact-edit 699 checks；构建 host 841 kB、client 4.12 MB（js 3.89 / css 230.8 kB）。

### 合并验证（2026-11-10，本地 main）

- 本地 `main` 已合并两条功能分支：修订舞台/版本条/导出（`artifact-version-switcher`，快进）与区块编排批量操作（`artifact-batch-version-ui`，merge commit）。合并冲突只涉及 E2E 的 input-orbit 稳定化、共享 plan 文档与文档计数；代码层没有新增 Host 路由或持久字段。
- 合并后验证：Node **736/736**（Host **303**、Client **410**、packaging **23**）；浏览器 **9/9** 套件，`artifact-edit` **790 checks**、`nested-edit-renderer` 75；构建 host 841 kB、client 4.14 MB（js 3.91 / css 236.1 kB）；pack **65** files **6,064,656** / **13,016,644** 字节；`npm run check:docs-facts` 与 `git diff --check` 通过。
- 上方各功能章节的验证行记录的是分支时点数字；合并后的当前数字以本节与 README 为准。
