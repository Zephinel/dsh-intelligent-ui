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
├─ webServer 路由（可选注入）                # /api/intelligent-ui/export/standalone.{js,css}；GET 修订查询与 POST /api/intelligent-ui/artifact-restore（零模型恢复）
└─ ctx.skills.register(intelligent-ui)    # 内嵌 Agent Skill（skills/intelligent-ui/SKILL.md）

Client  lib/client.js（浏览器，DSH module loader 懒加载）
├─ ctx.locale.register('intelligent-ui')  # zh/en UI 字典；slot 声明 locale 后组件拿到注入的 t
├─ conversation.input.activity             # 输入框右侧的 UI 控件（chip + Menu + 样式面板；读投影 + 开关/样式/按需命令）
├─ conversation.input.overlay              # OnDemandHint：发起标签页的 armed 提示、示例与取消
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # 插件详情页：可用性、回答样式、我的样式、编排方式与导出（写 Host 设置文档的 volatile 字段）
├─ conversation.chat.turnTail 列表项       # 每轮结束时提取程序/临时快照，渲染主题、临时标记、调整/保存操作
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 移植后的 57 个组件（chrome 走渲染器 i18n context）
├─ 卡片区块编辑与编排（IntelligentUICards + artifact-edit/*）  # 多草稿表格：同一聊天多份编辑草稿、单 active 画布（activeKeys）、每 chat 最多 6 份/发送最多 3 个 attached；草稿按标签页持久化到 sessionStorage（刷新恢复，跨标签不共享）；卡片显示「编辑」入口、修订 N、非 active 草稿角标；编辑模式挂载编辑视图（画布实时预览目标顺序，<720px 提示）、Artifact 编辑器（顶部「待提交编辑 (N/6)」切换区）与区块浮层；block-edit 修订卡片从 `edit_ui_blocks` 结果 meta 渲染；Turn 关闭时按 requestId 对账 submitted 草稿；旧修订冲突横幅可启用 branch；旧修订可零模型恢复为本地修订卡片；临时样式卡片支持内容编辑（快照随请求）；「嵌套区块」opt-in 后可选 `Col`/`Row`/`Card` 内的子区块做内容替换（根层顺序不变），并在「嵌套区块编排」中调整同一 parent 内的子区块顺序，编排行提供复制/删除结构操作（M4-3，零模型 Host 路由 + 本地结构修订卡片）
│   └─ BlockSlot（仅编辑模式 library）+ 每草稿一个 Composer 引用 chip（按 ref upsert/remove，标签「编辑 {title} · 修订 N · {摘要}」，branch 追加「 · 分支」）+ 已发送消息逐信封摘要节点；`programs.ts::blockEditProgram` + `artifact-edit/local-revisions.ts`（localStorage 每会话 ≤20、按 Turn 渲染）+ `artifact-edit/tabs.ts`（BroadcastChannel 跨标签软租约横幅）+ `artifact-edit/nested.ts`（CST→嵌套 display block 映射，`bN.M.K` 与 nodeId/digest）+ RenderUiRow 错误明细；嵌套模式经 `nestedBlockSlots` 走 `nestedEditLibrary`（`src/lib/library.ts`，Col/Row/Card HOC）；Host 归一化/合成 program 随 presentationMeta 回放
├─ conversation.chat.assistant-actions 列表项  # 仅该轮记录过 render_ui 的消息出现导出按钮
│   └─ 菜单（图片：原始 / 圆角 / 卡片；交互页面）→ PNG 或单文件 HTML 下载
├─ tool.call.toolview keyed 'render_ui' / 'edit_ui_blocks'  # 进程区只留一行「交互式回答」；失败调用附一行原因（完整文本在 title）
└─ 内置 CSS（组件库 / MapLibre / KaTeX 使用 DSH 全局样式 + scoped reset）
```

开关关闭时模型侧完全没有这个工具的痕迹；打开后模型才看到工具、一段系统提示词和一个按需加载的 skill。UI 渲染与交互全部在浏览器完成，程序本身作为工具参数进入会话日志，随历史重放。

## 开关与回答样式

![输入框右侧的 UI 控件：三档开关与分隔线下的 Display style](../assets/intelligent-ui-toggle.png)

- **全局默认**：插件详情页提供「在所有会话中启用」开关、回答样式（Auto / Card / Article 或已保存的全局模板）、「自由布局」开关，以及导出的默认值（图片背景色、1x/2x、图片/交互页面是否移除 `@ToAssistant` 追问控件及其表单字段（含正文的卡片保留正文，只有纯追问区块整块消失；默认移除））。新会话默认继承这些设置。页面按 **可用性** / **回答样式** / **我的样式** / **编排方式** / **导出** 分组。
- **会话覆盖**：输入框 UI 控件只改当前会话。`/iui on` / `off` / `inherit` 设置启用覆盖；`/iui style auto|card|article|inherit|<cs_id>` 设置样式覆盖。会话覆盖优先于全局，`inherit` 跟随全局。
- **答案样式**：`Card` 为紧凑交互卡片；`Article` 为 `render_ui` 卡片内的阅读版式（`Toc` + 可折叠 `Section` + 长 Markdown 正文）；`Auto` 由模型按请求选择。Article 的 `Section` 正文是一个嵌套 flow，块间距使用 group 级节奏；页面级 flow 只靠 margin 排版，不再叠加 flex gap，避免 section 前后出现双倍留白。
- 状态：全局启用/样式/自由布局在 Host 设置文档；会话启用、关闭与样式覆盖原子写入 `<DSH_HOME>/dsh-intelligent-ui.json`（`sessions`、`offSessions`、`styles`）。旧版 `{ "global": true, "sessions": [...] }` 仍可读取为全局/会话迁移值。
- 会话里的命令日志折叠成 `intelligent-ui` 投影，提供当前启用/样式状态、pending 和实时 `onDemand`（stateVersion 6）；输入框控件只镜像投影，Host 负责全部状态决定。控件会把乐观视图通过 BroadcastChannel 同步给其他标签，投影到达后收敛为该投影值。作用域菜单与导出菜单共用 `MenuItem`/`MenuDivider` 菜单行（宽度按内容、最小 208px，统一行距与选中/悬停/禁用态）；作用域菜单与样式面板都按右缘对齐 chip，并与触发按钮保持 12px 间距；两者使用不透明的 layer-2 抬升表面，内部卡片/行保留 module surface 以便在深浅色下分层。「显示样式」一行常驻，关闭时置灰禁用，上方有一条内缩的浅分割线；样式面板是菜单的第二级，返回按钮回到作用域菜单而不是关闭全部浮层。
- 开关依赖部署同时组合 `sessionProjections` + `commands`（DSH Web 默认都有）。缺任一服务时无法显示/持久化会话控件，扩展回到**始终开启**行为。

## 自定义样式与按需操作

### 结果样式契约

`src/shared/style-templates.ts` 的 `StyleSnapshot` 是 schemaVersion 1（StyleSnapshotV1）：`baseLayout: card|article|free`、`directives`、可选 `theme`，另有可选 `suggestedName`。不带主题是正常情况：结果继承会话主题（当前选中模板，否则内置主题）；只有需要独立配色时才传完整主题，此时才做 3:1/建议 4.5:1 对比度检查。没有显式主题的结果不能保存为模板（没有可复制的 palette）。`render_ui` 要求 `program` 与 `style`；可带 `title`，以及互斥的 `styleId` 或 `temporaryStyle`。临时快照的 `baseLayout` 必须等于 `style`；仅当前 Host 授权且已观察到的工具调用可使用它。新按需生成使用 `style: "free"` 与 `temporaryStyle.baseLayout: "free"`，由程序组合用户要求的布局，不受 Card 紧凑要求或 Article 阅读 wrapper 限制；Toc/Section 可选，解析、锚点、主题与授权校验仍保留。旧 card/article 快照继续使用原有外壳与 Article 校验；内置会话样式仍为 Auto/Card/Article；保存模板的 `baseLayout` 为 `RenderLayout`（card/article/free）。选中自由模板时传 `style: "free"` 与精确 `styleId`，不带 `temporaryStyle`；Host 保留模板 ID 与布局一致性校验。按需操作期间不注入会话外壳提示；布局由用户请求决定，有实质歧义时先问一个聚焦问题，不静默默认。成功值含 `statements`、`style`、`styleSource: builtin|template|temporary`，以及可选 `styleId`、`warnings`；快照由工具参数承载，不在成功值中复制。

Host 按操作类型强制校验布局：`generate` 的 `style` 和 `temporaryStyle.baseLayout` 必须均为 `free`；`adjust` 必须均与 `parentResultId` 在结果注册表中的快照 `baseLayout` 一致（free 保持 free，旧 card/article 保持原布局）。父快照缺失（包括被最近 200 条上限淘汰）时拒绝调整，错误提示用户取消后重新按需生成；不从模型参数或对话推断父布局。拒绝不写结果、不完成操作，历史工具参数仍可重放。

优先级是：当前调用已授权的临时样式 → 会话样式覆盖 → 全局默认 → Auto。临时样式不写会话/全局设置。已选自定义模板时，普通调用必须传准确的 `styleId` 和模板的基础版式。模板或 catalog 不可用时客户端降级默认主题；没有显式主题的临时快照同样继承当前选中模板或内置主题，而不是独立于模板库。

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

临时结果显示「临时样式」标记及扩展自身渲染的「调整样式」「保存为模板」，这些操作不进入模型程序。调整关联具体 resultId，保留草稿并填入前缀，正常发送后才生成新结果。保存 Popover 收名称/描述/可用范围；不再选择 Card/Article。Host 精确保存原布局、已校验主题和偏好，原结果保持不变，不调用模型；旧快照继续原有保存流程并保留布局。自由模板有本地组合预览和「自由布局」提示，支持选用、重命名、编辑偏好与删除。模板结果保留 DSH 卡片标题栏，无临时样式标记及调整/保存操作；free 不添加 Article wrapper，不强制 Toc/Section，使用模板明暗主题。设置页只做全局默认、已保存模板管理、编排与导出；生成发生在 Composer。

主题只接受 light/dark 六位 hex palette 与 font/radius/density/shadow 枚举，拒绝未知键、任意 CSS/脚本/URL；临时样式的 ink/canvas、accent/canvas 在两种方案下至少 3:1，低于 4.5:1 警告。directives 最多 2,000 字符；已保存模板注入提示词时作为 JSON 字符串包在 DISPLAY PREFERENCES 边界中，明确无权覆盖系统、工具或安全规则。临时 directives 是结果数据，不提升为系统指令。模型不能自行武装、保存模板或改变默认值；`HtmlView` 原有沙盒边界仍适用。

重放解析接受带合法 styleId 的 free 模板调用，无来源的 free、无效快照与 styleId/temporaryStyle 混用仍不渲染。重放与 `programsToExportCards` 保留临时结果及模板的 free 布局；PNG 截取实际组件组合。独立 HTML 中自由结果使用可用页面宽度，Card/Article 保留 760px 宽度、卡片列间距与 live 一致（12px），包括混合导出；逐结果解析的主题与明暗模式仍内联冻结。

界面状态结构：进行中的写入/命令不能折算成视觉 `disabled`。设置页没有可渲染的 pending 状态，保存只通过 `sectionRef` 命令式设置 `aria-busy`；Composer 面板拆为独立的 `StylePanel`，只接收可用性（`disabled`）与回调，父级 `busy`/`pending` 不在其作用域；On-demand 的 arming 状态在 `StylePicker` 内部。新增控件位于这些边界内时拿不到瞬时命令状态，因此无法把一次保存/切换变成整块控件的 disabled/opacity 闪烁。只有拥有该异步操作的控件可以短暂禁用自己（如 On-demand 入口、导入弹窗的提交按钮）。CSS 的 `:disabled { opacity }` 仍保留，因此新边界若重新引入瞬时 `disabled` 仍会闪；应通过可用的 `locked`/`panelDisabled` 语义表达不可用。

## Artifact 区块编辑与编排

已渲染完成的页面可以在原卡片里继续局部修改：卡片标题栏右侧提供「编辑」入口，进入后页面换成只读画布加右侧「Artifact 编辑器」。编辑器把「改内容」和「调顺序」分开：用户为区块填写修改说明（保存后才生成请求），并在「区块编排」里用拖拽或键盘调整全部顶层区块的先后。发送时两者都只是同一个结构化请求的一部分；模型按请求类型调用一次工具——内容修改走 `edit_ui_blocks` 返回选中区块片段，只调顺序/整体说明走 `render_ui` 返回完整程序——Host 合并并记录为同一 Artifact 的新修订，客户端显示「修订 N」。支持只改内容、只调顺序（`edits` 为空数组）以及两者同时，整体说明可选。同一聊天可以并行保留多份卡片编辑草稿——单画布激活、每份草稿一个 Composer chip、每份带稳定 `requestId`；一次发送把最多 3 个 Artifact 的请求合并为同一条用户消息（多个 V1 信封），Host 按请求逐个应用并各自记录修订。

### 区块识别与稳定引用

- 编辑入口只出现在可编辑的卡片上：程序已解析、根是 `Col`、至少有一个可识别顶层区块、调用已结束且不是临时样式结果。`src/shared/artifact-blocks.ts` 的 `extractArtifactBlocks` 用与 Host 相同的 `vendor/spec.json` 解析程序。
- 可编辑区块是根 `Col` 的直接子节点；`Caption`、`Divider`、`Spacer`、`Toc` 与游离 `Title` 属于页面 chrome，不作为区块。`ArtifactBlock` 同时给出 `blockId`（`b<originalIndex>`）、`nodePath`（`root[rootIndex]`）、`originalIndex`（区块在基础版本可编辑区块中的 1 基序号）、`rootIndex`（在所有根子节点中的 0 基序号）、`componentType`、`kind`（section/card/table/chart/interactive/drawing/media/container/content）与可选 `statementId`/`title`。标题来自区块内 `Title`、`Section.title`、`Table.columns` 或首段文本，不依赖屏幕坐标。
- 身份只在基础修订内稳定：编排只改变 `targetOrder`，不重写 `blockId`/`originalIndex`/`nodePath`；请求里另带保存时分配的 `selectionOrder`。因此调换顺序不会改变区块引用，也不会重排已保存请求的编号。
- `wrapProgramForBlockEditing` 只重写根语句：把每个可编辑子节点包进内部组件 `BlockSlot("bN", N, [...])`，其他子节点与根尾部参数按源码保留；编辑视图用这份包裹后的程序走正常渲染器，因此轮廓、编号与浮层都挂在真实 DOM 节点上。`BlockSlot` 只注册在 `library.ts` 的 `blockEditLibrary` 中（由 `render.tsx` 的 `blockSlots` 开关启用），不进入模型组件目录（57 个组件不变）。
- 程序形态无法支持时返回原因（unparsed / no_root / incomplete / parse_error / root_not_col / empty_root / no_blocks），卡片不显示编辑入口。

### Artifact 编辑器：请求与区块编排

- 浏览器 `artifact-edit/store.ts` 以 `${sessionId}:${baseRevisionId}` 为草稿 key 保存编辑会话：`originalOrder`（基础版本的区块 id 页面顺序）、`targetOrder`（当前编排草稿）、`orderChanged`、已保存请求 `selection`（含编号与修改说明）、整体说明、当前打开的区块、抽屉展开与检查/冲突状态。同一聊天可同时保留多份这样的草稿，但只有一个 active 编辑画布（`activeKeys`）；切换卡片时前一份草稿保留（`editing=false`），已填内容不丢。退出编辑后请求、编排与 Composer chip 保留。
- 每份草稿有稳定 `requestId`（`req_` + 12 位 base36，优先 `crypto.getRandomValues`）与 `attached` 标记。同一聊天最多 6 份有内容草稿（超出时打开编辑返回 `limit`，卡片显示上限提示），每次发送最多 3 份 attached（其余 detached，可附加）；关闭空画布草稿会丢弃，有内容草稿关闭后保留为 detached，仍出现在切换区与卡片角标。
- 编辑器顶部新增「待提交编辑 (N/6)」切换区（`data-dsh-iui-edit-draft-switcher`）：列出本聊天所有有内容草稿（标题、修订号、修改摘要、active 圆点、冲突/未附加标签、附加/丢弃按钮）；点击切换 active 画布，只有 active 草稿的请求列表/编排/整体说明区显示在下方。非 active 草稿在卡片头部显示角标；通过切换区或卡片编辑入口激活草稿时，对应卡片会滚动到视野内。
- 打开区块浮层只是草稿，不生成请求；保存非空修改说明才创建请求，并分配当前最小可用编号（删除后可复用）。编号只属于请求，是「编辑请求」行号、区块角标与六色循环（蓝、紫、绿、橙、粉、青，编号 1–6 循环）的依据；没有请求的区块不显示编号、颜色或「已编辑」标签。保存空说明会删除该区块的请求。
- 编辑器顶部是标题「Artifact 编辑器」与展开/收起（加宽停靠栏）按钮，窄屏另有关闭抽屉按钮。「编辑请求」列表只在存在已保存请求时出现：数量、右对齐的「清空」（只清请求，保留编排与整体说明），以及每项的编号、标题、修改说明与编辑/删除按钮。
- 「区块编排」始终可见：标题「区块编排」+「· N 个区块」、重置顺序与提示「拖拽调整区块顺序，点击区块可查看或添加编辑需求。」。重置顺序只把 `targetOrder` 恢复为基础版本的页面顺序，保留全部请求、编号与整体说明。列表按 `targetOrder` 列出全部顶层区块：拖拽把手（指针拖拽，4px 阈值、按行中点显示 2px 插入线，放下才调用一次 `moveBlock`；键盘 ↑/↓ 与 Home/End 也可重排）、只定位不打开浮层的正文（滚动到画布中的区块并高亮约 900ms）、类型图标、截断标题、有请求时的编号/颜色与「已编辑」标签，以及打开浮层的铅笔按钮；悬停有请求的行约 180ms 后显示锚定的小卡片（标题、编号、全文与编辑/删除）。
- 编排草稿在编辑画布内实时预览：`wrapProgramForBlockEditing(program, extraction, targetOrder)` 按 `targetOrder` 重排真实 `BlockSlot` 包裹的顺序，工具栏显示「预览目标顺序」；预览只影响编辑态，已记录的修订与导出在发送前保持不变。
- 编辑器内容顺序固定为：头部 →（有请求时）编辑请求 →（可撤销的删除提示）→ 区块编排 → 分隔线 → 「整体编辑说明（可选）」→「将发送给模型」摘要（区块编辑需求 N 项、结构顺序 保持原样/已调整、整体说明 已填写/未填写）与说明。宽视口（≥1180px）是右侧停靠栏，可展开加宽；700–1179px 折叠为底部抽屉，由工具栏的「编辑请求（{count}）」按钮打开；小于 720px 不提供区块编辑，卡片与活动编辑视图都显示「窗口太窄」提示（包含最小宽度说明、关闭或退出按钮），加宽窗口后恢复。冲突时显示「Artifact 已有更新的版本」横幅，可重试或退出；检查中显示「正在检查 Artifact…」。
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
- 限制：临时样式结果只支持区块内容编辑；纯排序/纯整体说明不支持（客户端阻止 + Host `render_ui` 回退拒绝），需要已保存/内置样式；没有有效快照的临时卡片不可编辑；临时样式路径未单独做真实模型/真机验证（E2E 模拟）。

### 嵌套区块编辑（M4-1）

- 身份与映射：shared `src/shared/program-cst.ts` 的 `buildArtifactTree` 为基础修订分配 revision-scoped `nodeId`、节点 `sourceDigest` 与 CST `nodePath`/slot；客户端 `src/client/artifact-edit/nested.ts::nestedBlocksForProgram` 把树映射为展示区块：root 保持 `bN`，嵌套为 `bN.M.K`，携带 `nodeId`/`parentBlockId`/`depth`/`sourceDigest`；渲染器的 slash 路径（`root/children[0]/...`）与 CST 括号路径（`nodePath`）双向映射（`byPath`/`byNodeId`）。`nodeId` 跨修订不稳定（结构操作后重新提取属 M4-3），请求以 `baseRevisionId + nodeId + sourceDigest` 绑定。
- 渲染器：新增 `nestedEditLibrary`（由 `blockEditLibrary` 派生，仅 `Col`/`Row`/`Card` 用 `wrapNestedContainer` HOC 把 direct children 替换为合成嵌套 `BlockSlot` AST；普通 library 与顶层 `blockEditLibrary` 不变）。`OpenUIRenderer` 新增 `nestedBlockSlots` prop（默认 `false`，false 时输出与原来一致）。`BlockSlotPathContext` 为 `{parentPath, resolve}`，`resolve` 返回 `{blockId,nodeId,blockIndex}`；嵌套 wrapper 输出 `data-dsh-iui-block`（display id）/`data-dsh-iui-block-node`/`data-dsh-iui-block-path`；根层生产 wrapper 无 path 时 markup 不变。wrapper 使用 `display:contents`，由 `src/lib/components/nested-edit.css` 补偿 25 条直接子选择器；`test/renderer/nested-css-contract-check.mjs` 静态检查（25/25），几何 E2E 验证 0px 漂移、innermost 点击/悬停、overlay union rect、排序路径映射与普通渲染不变。
- 客户端：编辑器工具栏出现「嵌套区块 / 仅顶层」toggle（`data-dsh-iui-edit-nested`；默认关闭，关闭时清空选择；模式不持久化，刷新回到顶层）。开启后画布用 raw program + `nestedBlockSlots` + resolver，selection/请求列表/popover 使用嵌套 display id；信封 `edits` 增加 `nodeId`/`sourceDigest`/`parentBlockId`/`depth`（shared header 投影），`targetOrder` 仍是根层完整排列。
- Host：`isNestedEditRequest` 在任一 edit 带 `nodeId` 时为嵌套请求；`planNestedEdits`/`describeNestedEditProblem` 用 `buildArtifactTree` 校验：node 存在、`depth > 0`、非 chrome/scoped(@Each)/shared/opaque、`sourceDigest` 与 `componentType` 匹配、无祖先-后代同时选中、树大小/深度上限；要求全部 edits 带 `nodeId`（all-nested 或 all-legacy，混合拒绝）。`composeNestedEditProgram` 把模型 `edit_ui_blocks` mini program 的 root children 按 `selectionOrder` 与 edits 一一对应，经 CST `replaceNode` 顺序替换，重解析/重校验后记录 revision；根层 `targetOrder` 仍走确定性重排；`editedBlockIds` 仍为受影响的根区块 id（共享 validator 限制）。非法嵌套请求返回模型可读错误且不消费 pending。
- 限制：opt-in、仅 `Col`/`Row`/`Card`、仅内容 replace（不支持嵌套排序/删除/复制/移动）、`@Each`/opaque/共享引用不可编辑、根层 `targetOrder` 不变、all-nested 或 all-legacy、`editedBlockIds` 仍为 root id；Host 仍以信封携带的 program 为基础（权威 program store 属 M4-3）；CSS 补偿层需随组件直接子选择器维护；真机/真实模型只验证了单个嵌套文本替换。

### 层级排序（M4-2）

- 契约：`ArtifactEditRequest.orderByParent?: Record<'root' | CST nodeId, readonly nodeId[]>`，header 投影；shared shape 校验（`invalid_order_by_parent`：key 为 `root` 或 `n\d+`、每组非空且 ≤100、id 去重、最多 61 组）。值只包含该 parent 的 **editable children**（chrome 不出现）的完整排列；客户端只发送发生变化的组；`targetOrder` 仍是根层基础顺序。
- Host 校验：`describeOrderByParentProblem` 用基础 CST tree 验证 parent 存在、非 chrome、非 `@Each` scoped、非共享命名表达式、非 opaque、存在 children slot；每组必须是 editable children 的完整排列，拒绝未知/重复/跨父/chrome id；`orderByParent.root` 与 legacy `targetOrder` 不一致时拒绝（targetOrder 必须是基础根顺序）；同一请求中正在内容编辑的子树不能被排序（祖先-后代冲突）；no-op 组忽略。失败返回模型可读错误、保持 pending、不写 revision。
- 应用：`applyOrderByParent` 对变化的组按 **最深优先** 调 `reorderChildren` 并在每个 parent 后重建树；存在 `orderByParent.root` 时由它拥有根顺序并跳过 legacy root `targetOrder`，否则嵌套排序后再执行根层 `targetOrder` 确定性重排。`render_ui` 完整程序路径与 `edit_ui_blocks` 嵌套内容路径共用 `apply`；order-only 请求（`edits: []` + `orderByParent`）被接受，记录 normalized program 到 revision 并在结果 meta/`presentationMeta` 返回；`editedBlockIds` 在 order-only 时为 `[]`，嵌套内容+排序时为受影响的根区块 id。
- 客户端：会话增加 `nestedOrder`/`nestedOriginalOrder`/`nestedOrderChanged`；actions `moveNestedBlock(parentBlockId, blockId, toIndex)`、`moveNestedBlockBy`、`resetNestedOrder`；进入嵌套模式时按 parent 分组；重新打开 submitted 草稿时重置 nested 状态；chip 摘要/参与判定把嵌套排序视为内容形状变化（摘要「调整区块顺序」）。serialize 只把变化的组转为 `orderByParent`（display id → CST nodeId），`targetOrder` 保持根层基础顺序。EditPanel 在嵌套模式新增「嵌套区块编排」区：每个 parent 一组标题 + 缩进行（全局编号、编辑 tag、铅笔、locate body），支持同父 pointer drag（跨组不可）+ grip ↑/↓/Home/End，以及「重置嵌套顺序」；hooks：`data-dsh-iui-edit-nested-arrangement/-group/-list/-row/-grip/-body/-edit/-reset-nested`。
- 限制：嵌套排序仍是 opt-in 且不持久化；没有画布 live preview（列表显示目标顺序）；不支持跨容器移动；order-only 仍需一次模型 `render_ui` 回合（不是零模型）；不要同时对正在排序的 parent 子树做内容编辑；Host 仍以信封携带的 program 为基础（权威 program store 属 M4-3）；`editedBlockIds` order-only 为 `[]`。

### 确定性结构操作（M4-3）

- 权威 program 注册表：`src/host/artifact-structure.ts::createArtifactProgramStore` 持久化 `<DSH_HOME>/dsh-intelligent-ui-programs.json`（`{version, programs[]}`）：最多 **200** 条记录 / **50 MB** program 文本，按 `lastAccess` LRU 淘汰，原子写、损坏恢复到空；记录每次成功 `render_ui`、`edit_ui_blocks`、结构路由与 restore 产生的新 revision program。`lookup(artifactId, revisionId)` 是结构操作的**唯一** base 来源；请求 body 带 `program` 会被 `unknown_field` 拒绝。
- 幂等 ledger：`createArtifactStructureOperationStore` 持久化 `<DSH_HOME>/dsh-intelligent-ui-structure-operations.json`（最多 200 条；`operationId` + canonical request digest → result lineage）。相同 `operationId` + body 重放返回已记录结果（HTTP 200），相同 id 不同 body 返回 409 `operation_replayed`。
- 路由：认证的精确 **`POST /api/intelligent-ui/artifact-structure`**（认证同 restore；body ≤64 KiB、JSON；成功 201 `{ok:true, result: ArtifactStructureResult}`；重放 200）。校验：base 必须存在于权威注册表；latest/branch 规则；`buildArtifactTree` 校验 `nodeId`/`sourceDigest`/chrome/scoped(`@Each`)/shared/opaque/root 目标与 `toIndex` 边界；v1 的 `delete`/`duplicate`/`move` 仅同 parent，批量按请求顺序原子应用（evolving tree，最多 20 个操作），应用后重解析/重校验。成功后记录 `revision = latest + 1`（branch 基于旧 base 也是 `latest+1`），继承 `style`/`styleId`/`temporaryStyle`/`title`，`editedBlockIds` 记录受影响的根区块 id，并把新 program 写入注册表。错误码：400 `invalid_input`/`operation_conflict`/`program_invalid`、404 `artifact_missing`/`base_missing`、409 `base_not_latest`/`operation_replayed`、500 `storage`、405/413。
- 索引语义：`duplicate.toIndex` 是复制件在该 parent 的 **editable children** 中的最终插入位置（chrome 不计）；`move.toIndex` 是移除后 0-based 的最终 editable 索引。
- 客户端：shared `src/shared/artifact-structure.ts`（路由、request/op/result、`describeStructureRequestProblem`、`isArtifactStructureResult`、`MAX_ARTIFACT_STRUCTURE_OPERATIONS = 20`）。`applyArtifactStructure(key, blockId, 'delete'|'duplicate', turn)` 从 `nestedBlocksForProgram` 取 `nodeId`/`sourceDigest`，POST 后成功 `addLocalRevision({kind:'structure'})`（本地卡片在有触发操作的 Turn 渲染，标签「结构操作修订 / Structural revision」），`markSubmitted` 关闭编辑器并移除 chip；失败设置 `structureError`，不丢草稿。`IntelligentUIProgram.localRevisionKind` 区分 restore/structure，local-revisions 校验与持久化兼容旧 restore 记录。
- UI：根层与嵌套编排行 hover/focus 显示「复制」（立即）与「删除」（两段式内联确认，3 秒，danger 态，无 `window.confirm`/`alert`）；`structureBusy` 时禁用动作并给出 status，`structureError` 为 `role=alert`、可关闭并在 8 秒后自动隐藏；hooks：`data-dsh-iui-edit-structure-duplicate`/`data-dsh-iui-edit-structure-delete`、`data-confirming`、`data-structure-confirming`、`data-dsh-iui-edit-structure-error`/`-dismiss`/`-busy`。
- 限制：UI 只暴露 delete/duplicate（Host 有同父 move API 但无 UI；跨容器移动未做）；注册表只覆盖 M4-3 安装后且仍在 200/50 MB LRU 内的 revision——旧卡/被驱逐的 base 返回 `base_missing`，需要重新渲染，`branch` 也要求 base program 仍在；本地结构修订卡只在 localStorage 且只在触发 Turn 渲染，无 assistant 消息/导出/跨设备，丢失提示尚未做；无 diff 预览/多步 undo；删除不做 helper GC；`Section`/`Toc`/`@Each`/共享表达式由 CST 规则限制；结构操作与内容编辑不能混在一个动作；结构操作会直接 `markSubmitted` 当前草稿（尚无“结构改变使内容草稿过期”的确认 UI）。

### 区块片段编辑（Phase 1）

- `src/shared/artifact-block-bundle.ts` 提供纯数据切片与回填。`extractBlockBundle(program, blockIds)` 返回：被选区块的表达式源码（裸语句引用解析为右侧表达式）、它们传递依赖的 `frozenStatements`（只读语句源码）、`stateSources`（`$name = ...` 声明）与全部顶层区块的 `outline`，并带 `statementId`/标题。
- `spliceBlockBundle(baseProgram, blockIds, fragmentProgram)`：解析模型微程序，要求根是 `Col` 且直接子节点数等于选中区块数；按 `blockIds` 顺序只替换这些根子节点槽位，其余区块、页面 chrome、根语句尾部参数与基础语句保持逐字节不变；微程序里除 root 外的语句作为新辅助语句追加，但与基础语句/`$state` 重名、重复/未知区块 id、数量不符或引用了组合后不存在的标识符都会返回可重试错误。组合后再解析并重新识别，顶层区块数必须一致。
- Host 新增 `edit_ui_blocks` 工具（在 `render_ui` 之前注册；`mode.ts` 在关闭会话时 deny 两个工具，execute 也有启用守卫）：只接受待处理编辑请求；多 pending 时用 `requestId`/`artifactId` 选择器精确取一条；`edits` 为空（只调顺序/整体说明）时要求改用 `render_ui`（并提示对应 `editRequestId`）；否则切片、合并、按 `targetOrder` 做确定性重排与保留警告，记录 `revision = baseRevision + 1` 的新修订并消费请求。成功值与结果 meta 为 `{artifactId, revisionId, requestId?, baseRevisionId, revision, editedBlockIds, program, title?, style, styleId?, temporaryStyle?}`；`presentationMeta` 总会带合成后的 `program`（该工具只返回片段），客户端 `programs.ts::blockEditProgram` 据此渲染修订卡片，`edit_ui_blocks` 的进程行复用紧凑的 `RenderUiRow`。
- `render_ui` 的回退分流：多 pending 时用 `editRequestId` 选择待处理请求；待处理请求有内容修改时，`render_ui` 抛出「call edit_ui_blocks」可读错误并保持请求待处理；只调顺序/整体说明的请求仍走原完整程序路径（样式/临时样式/版本冲突校验不变）。
- Phase 1 仍把完整页面放进信封作为只读上下文，主要收益是未选区块逐字节不变与合并校验；输入 token 削减（Host 程序缓存/客户端上下文路由）留到 Phase 2。

### 编辑健壮性（M1）

- 失败的 `render_ui` / `edit_ui_blocks` 工具行在折叠状态显示一行可读原因：优先取结果文本，其次结构化错误 reason，最后 `name: code`；空白折叠、最多 160 字符、完整文本放在 title，且从不读取工具参数（`RenderUiRow.tsx`）。
- 静默修订探测只在结果为 `conflict` 时把编辑会话状态改为冲突，从不自动清除冲突，也不触碰浮层/草稿状态；因此并发更新会在发送前显示冲突横幅。

### Host 校验、确定性排序与修订血缘

- `host/artifact-edit.ts` 以前置 `session/event` 监听 `user/message`，只处理真实用户消息（注入的 skill/文件等 `source.kind !== 'user'` 不算），用 `parseEditRequestTexts` 逐信封解析（一条消息最多 3 个）。除既有校验外，还要求 `targetOrder` 是基础版本全部顶层区块 id 的完整排列（`describeTargetOrderProblem`：wrong_length / unknown_block / duplicate_block / missing_block），允许 `edits` 为空，并拒绝既无修改、顺序也未变化、又无整体说明的空操作（no-op）。校验失败的请求以 `invalidReason` 保留（工具调用时返回可读错误）；合法请求按 `requestId` 存入每会话 Map（`requestId`/`artifactId`/`mode`/`messageId`/`createdAt`）：TTL 15 分钟、每会话最多 3 条 pending、最多 64 个会话；同 Artifact 同消息只 arm 第一条，重复项标记 `invalidReason`；无 `requestId` 的旧信封走 legacy 单 pending 路径。turn 未调用工具时请求保持待应用，新消息按 `requestId` 替换/新增。
- `pending(sessionId, selector)` 在没有 selector 且恰好一条时返回它；多条 pending 且无 selector 时返回 `multiple_pending`，工具层转成模型可读错误并列出可用 `requestId`/`artifactId`（`listPending` 提供该列表）。两个工具共用 `artifactEdits.apply`，但输入不同：`edit_ui_blocks` 把 `spliceBlockBundle` 合成后的整页作为 `composedProgram` 传入（跳过 `render_ui` 的 styleId/temporaryStyle 参数校验，样式始终取请求记录值）；`render_ui` 在全部普通校验通过后应用待处理编辑，若请求含内容修改则先抛「call edit_ui_blocks」并保持请求待处理。两者都只消费 selector 选中的那一条 pending、其余保持 armed，并拒绝过期/不可读/无待处理请求、基础版本已过期、更新后根不是 `Col`，以及合成/更新程序无法重新识别为同一顶层区块集合；每个请求独立校验、独立记录修订，无跨 Artifact 事务。Host 不信任客户端的 `orderChanged` 提示，而是比较基础区块 id 顺序与 `targetOrder` 自行判断；顺序变化时用 `reorderProgramToTargetOrder` 确定性重排程序的根 `Col` 子节点：按语句名 → 标题+组件类型 → 唯一标题三轮回映基础区块，只移动已识别区块、其余 chrome 子节点保留原槽位；无法一一匹配时抛出可重试错误且不消费待处理请求，归一化程序超过 200,000 字符同样拒绝。通过后计算未选区块保留警告（最多 6 条）、记录新修订（`revision = baseRevision + 1`，`revisionId = 当前 tool callId`）并消费该请求。
- `render_ui` 成功值新增可选 `artifactId`、`revisionId`、`requestId`、`baseRevisionId`、`revision`、`editedBlockIds` 与 `program`（编辑时出现）；`edit_ui_blocks` 的固定输出为 `{statements, style, styleId?, title?, warnings?, artifactId, revisionId, requestId?, baseRevisionId, revision, editedBlockIds, program}`。`presentationMeta` 对普通渲染返回 `null`，对编辑返回血缘对象（含本次请求的 `requestId`，临时样式时含 `temporaryStyle`）——`edit_ui_blocks` 总会带合成后的 `program` 与记录样式/标题。客户端 `programs.ts` 用 `presentationMeta.program` 覆盖渲染、重放与再次编辑使用的程序，并由 `blockEditProgram` 从 `edit_ui_blocks` meta（`program`/`title`/`style`/`styleId` + 血缘）构造修订卡片；两者都显示「修订 N」，并把 `requestId` 读入 `IntelligentUIProgram.requestId` 供 Turn 关闭对账使用。仅调整顺序的结果行是 `Interactive UI updated for the user (revision N of the artifact, block order adjusted).`；有内容修改时保持 `Interactive UI updated for the user (revision N of the artifact, K blocks edited).`，`edit_ui_blocks` 的结果行同为这一行；普通渲染行不变。
- `artifact-revisions.ts` 的存储与路由不变：修订记录原子写入 `<DSH_HOME>/dsh-intelligent-ui-artifacts.json`（`{version: 1, revisions: [...]}`），含 `revisionId`、`artifactId`、可选 `baseRevisionId`、`revision`、`sessionId`、`style`、可选 `styleId`/`temporaryStyle`/`title`/`editedBlockIds`（只调顺序时可为空数组）与 `createdAt`；最多 400 条（按 `createdAt` 淘汰最旧）、记录不可变、读取返回副本、损坏文件在下次写入前改名为 `.corrupt-<时间戳>`；首次渲染不写入记录，因此未知 Artifact 的查询按调用方自己的修订 1 回答。沿用同一 `connection.requestRejection` 认证模式的精确路由 `GET /api/intelligent-ui/artifact-revisions?artifactId=&revisionId=`（JSON、`no-store`；参数不合法 400 `invalid_input`，非 GET 405）不变；客户端进入编辑、发送前与重试时用它检查最新修订，没有 `webServer`/`connection` 时按未知处理、不阻塞编辑。

### 测试

- `test/client/artifact-blocks.test.mjs`（8 条）：识别顺序、包裹后程序可解析且布局不变、Article 根只暴露 Section 而不是 Toc/页面标题、不支持根的原因、目标校验与保留警告、确定性排序移动根子节点并保留 chrome 槽位、信封往返与形状校验、发送消息摘要范围。
- `test/client/artifact-edit.test.mjs`（41 条）：信封往返（含 targetOrder、requestId 与内容修改指向 `edit_ui_blocks`）、编排字段校验、排列与 no-op 判定、发送消息摘要的排序信息、编辑会话（保存才创建请求、只调顺序合法、重置保留请求/编号/整体说明、清空请求保留编排、空/无变化/冲突阻止发送、重开恢复请求与顺序、自定义模板 styleId、临时样式与不支持程序不进入编辑）、确定性 chip 引用与 stale、静默修订探测、chip 文案与多草稿切换/上限/附加状态，以及临时样式内容编辑（带快照/不带 styleId、纯排序被阻止、持久化保留快照、无快照不可编辑）与 6 条草稿持久化：未发送草稿写入 sessionStorage、刷新后 hydrate、损坏/不可用记录清理、discard/发送清除记录与索引、确定性 ref 从恢复草稿 hydrate、无 sessionStorage 时静默 no-op、聊天索引恢复全部草稿。
- `test/client/artifact-edit-reconcile.test.mjs`（4 条）：未完成的 submitted 草稿恢复为 failed/detached 且重建 requestId、已完成的 submitted 草稿被删除、混合结果逐条独立对账、历史 Turn 不会认领新提交（时间窗口）。
- `test/client/local-revisions.test.mjs`（3 条）：恢复的本地修订只存本地、按 revisionId 替换并按 `createdAt` 淘汰、超过 20 条上限；本地修订转换为可编辑/可渲染的卡片程序；`restoreRevision` POST 源身份并映射 Host 返回的修订。
- `test/client/edit-tabs.test.mjs`（3 条）：另一标签的 lease 会被看到并阻止静默 claim、takeover 替换 foreign lease 并释放、过期 lease 被忽略。
- `test/client/nested-blocks.test.mjs`（4 条）：root 保持 `bN`、嵌套为 `parent.N`；path/nodeId 映射与 display blocks 一致；`@Each` 模板不作为嵌套可编辑区块；无可编辑嵌套子节点时 `hasNested` 为 false。
- `test/client/artifact-edit-batch.test.mjs`（7 条）：v1 批次上限常量、requestId 线格式、信封头携带 requestId 与多信封指引、一条消息按顺序解析多个信封、坏信封不影响兄弟信封、普通消息解析为空、发送摘要范围不跨信封。
- `test/client/artifact-block-bundle.test.mjs`（11 条）：选中区块表达式与传递冻结依赖/`$state` 切片、单块与双块回填顺序、chrome/根参数/基础语句保持、微程序使用基础 `$state` 或新增辅助语句、块数不匹配、未知/重复 id 与辅助语句重名、`@Each` 循环变量与对象字面量键不算未定义引用、引用组合后不存在的标识符被拒绝。
- `test/host/artifact-edit.test.mjs`（57 条）：在既有编辑/片段/多 pending 覆盖之外，新增 branch：旧修订 branch=true 记录 `latest+1`、未记录的 revision 1 允许 branch、非 branch 旧修订仍被 stale 拒绝、非法 branch base 被模型可读错误拒绝且不写修订；以及临时样式内容编辑（record/meta/schema 带快照、`render_ui` 回退拒绝、非法/超大快照拒绝）；M4-1 嵌套：单/多嵌套替换、嵌套+根 targetOrder、嵌套 branch/temporaryStyle、非法 node/digest/chrome/祖先冲突拒绝、畸形嵌套片段可重试且保持 pending；M4-2 层级排序：`orderByParent` 完整排列、chrome/跨父/@Each/root 冲突拒绝、最深优先重建、order-only meta 与非消费语义；`edit_ui_blocks` 注册/meta、合成、单/双块回填、保存模板 styleId/title、`render_ui` 拒绝内容修改、无请求/只调顺序拒绝、片段不合身可重试、无效 pending、血缘文案、警告、过期版本、不可读信封、样式不一致、注入消息不武装、确定性排序/归一化 program、超长与非法排列拒绝、no-op、TTL 与 64 会话上限。
- `test/host/artifact-revisions.test.mjs`（17 条）：不可变记录与重启读取、`latestFor`/`status`、原子写与损坏文件保留、按时间淘汰；GET 路由认证/方法/参数；恢复路由：与 GET 共用 disposer、POST 成功记录 latest+1 并返回本地修订、source 缺失/跨 artifact/already latest 拒绝、body/program/大小校验、非 POST 与认证拒绝，以及临时样式 record 校验与恢复复制快照。
- `test/host/artifact-structure.test.mjs`（15 条）：program 注册表 LRU/大小/损坏恢复与 lookup、幂等 ledger 重放/冲突、结构路由鉴权/方法/body 校验/错误码、CST 身份与父级校验、delete/duplicate/move 批量原子应用、revision/程序入库与 `editedBlockIds`。
- 浏览器 `test/browser/artifact-edit.e2e.mjs`（143 条检查）：编排面板、请求列表条件显示、画布实时预览、键盘/指针排序、只定位正文点击、重置顺序、内容+顺序+整体说明合并发送（信封指向 `edit_ui_blocks`）、Host 合成修订的渲染与血缘、只调顺序的 `render_ui` 路径、后台静默探测提前显示冲突、720–1179px 抽屉与 <720px 提示、深色；多卡片场景；Turn 关闭对账；M3-2 restore/branch 场景；M3-3 新增——未发送草稿写入 sessionStorage（含 instruction）、刷新后 Composer chip 与请求列表恢复、清理后回到初始态；M3-4 新增——临时样式卡片标记与编辑入口、信封携带 snapshot 且无 styleId、临时样式修订卡片、仅排序被阻止并显示引导；M4-1 新增——嵌套模式 toggle、嵌套 display id `b1.1.1`、信封携带 nodeId/digest/depth；M4-2 新增——同父嵌套重排、重置可用、chip 显示「调整区块顺序」、信封携带 `orderByParent` 且保留 `targetOrder`；M4-3 新增——结构 duplicate 请求（nodeId/sourceDigest/toIndex）、结构操作修订本地卡片标签、操作后编辑器关闭；不调用真实模型。
- `test/browser/nested-edit-renderer.e2e.mjs`（41 条检查）：嵌套编辑 library 的 `display:contents` 包装几何（card/text 0px 漂移）、innermost 点击/悬停、overlay union rect、reorder 路径映射、普通渲染无 wrapper 且输出不变。
- renderer 契约新增 `test/renderer/nested-css-contract-check.mjs`（25/25）：静态检查 25 条受影响的直接子选择器都有 `nested-edit.css` 补偿。

## 布局与间距契约

free 临时结果或选中的自由模板中，下述页面形态与排版指导仅作建议，以用户要求的组合为准；组件 flow 间距、语言、主题和安全规则仍适用。

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
- **结果主题快照**：`programsToExportCards` 优先读取内联 temporaryStyle.theme，其次按 styleId 解析已保存模板，再把已解析的 themeStyle 与 scheme 逐卡片内联；导出后不再查询 catalog。无显式主题的临时结果沿用会话当前选中模板的主题（与 live 卡片同一解析），无模板时用内置主题；已保存模板缺失时按默认主题导出。
- **页面运行时**：`src/standalone/index.tsx` 只渲染真实 `OpenUIRenderer` 的卡片正文（不导出 DSH 的标题栏与折叠控件），因此地图、图表、表单等交互与 DSH 内一致；`@OpenUrl` 照常打开链接，`@ToAssistant` 退化为「复制消息 + toast 提示回到 DSH 粘贴继续」，剪贴板失败时 toast 保留原消息；插件详情页的「移除追问操作」默认开启，导出图片和页面时会移除追问控件及其最小包裹（Form 的字段随之移除；含正文的 Card 保留正文，只有纯追问区块整块消失）；关闭后保留并由页面复制消息。页面只保存导出时的主题（当前 light/dark），不跟随之后的 DSH 主题切换。

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
  - `SKILL.md` — 工作流（决策策略只由注入提示词定义；显式调用是直接指令）、回答期间的只读 checkout 预检规则、OpenUI Lang 硬规则、设计规范（自由布局模式下降级为建议）、DSH 行为、收到 `<artifact-edit-request>` 信封时的定向修改规则、参考索引；
  - `references/components.md` — 57 个组件 + 73 个 `@functions`（14 core + 59 library）+ 5 个 action 的完整参数表；
  - `references/language.md` — 语法、表达式、`$` 状态、`@Each`、常见错误对照；
  - `references/examples.md` — 6+ 个可直接跑的完整程序（行程、计算器、SVG 教程、看板、表单、小游戏）；
  - `references/troubleshooting.md` — Host 校验错误原文与修法、运行时降级、预检规则；
  - `references/integration.md` — 其他部署/agent 的接入步骤与契约。

技能文件同时以普通目录形式随包发布（`skills/`），便于阅读、复用和二次分发。
