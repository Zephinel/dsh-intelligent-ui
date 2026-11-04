# M3 会话与版本模型设计方案

> **状态：as-planned 设计稿；M3-1a / M3-1b / M3-1c 已在工作树实现（未提交）— 2026-11-05。**
> M3 对应 [后续路线图](../artifact-edit-followups/README.md) 的 M3：多卡片并行编辑、旧修订分支/恢复、临时样式编辑、草稿持久化与多标签协调、已淘汰卡片编辑。
> 本文件描述设计与实施计划；已落地行为以代码与 [架构与行为](../../architecture.md) 为准，M3-1 的验收数据见下方「M3-1 验证记录」。
> M3-1c（部分失败/未完成 reconciliation UI）已实现并通过 Node/浏览器验证；M3-2/M3-3/M3-4 仍为计划。
>
> **2026-11-05 owner 评审结果**：一键恢复选择**零模型成本的本地修订卡片**（4.2 B）；临时样式编辑接受 **Host 校验的快照**（第 5 节）；多标签采用**软租约 + 提示**（6.2）；已淘汰卡片 **M3 暂缓**（6.3）。多卡片交互模型 owner 要求先交给 GPT 做外部设计，上下文见 [multi-card-brief.md](multi-card-brief.md)；设计已确认并落地为 M3-1a/M3-1b/M3-1c（v1，见 §0.1、§3.6）。

## 0. 外部设计评审对齐（2026-11-05）

GPT 的多卡片设计已评审并采纳其主干；以下是与本仓库现状对齐后的最终口径（实现以此为准，GPT 文档作为产品设计依据）：

**采纳**
- 多草稿并存、单画布激活、单个全局右侧编辑器 + 顶部「待提交编辑」切换区；不为每张卡片挂独立面板。
- 每个 Artifact 一个 Composer chip；删除 chip 只解除附加，不删草稿；一次正常 Send 提交多个请求。
- 每个请求独立 `requestId`、独立 pending、独立工具执行、独立 Revision 提交；**不做跨 Artifact 事务**，一个失败不回滚其他成功项。
- 多 pending 下禁止隐式选择目标：工具必须带 `requestId`（`edit_ui_blocks`）/`editRequestId`（`render_ui`）；Host 同时校验 `artifactId`。
- v1 上限：一次 Send 最多 3 个 Artifact、每聊天最多 6 份草稿、每 Artifact 每批 1 条请求、每批最多 24 条区块修改、批次程序总量 120k 字符。
- 同一 Artifact 的不同修订草稿可以并存，但同批只提交其中一条。
- 软租约（已确认）与本地修订卡片恢复（已确认）在 M3 后续阶段接入。

**与 GPT 设计的偏差（有意为之）**
1. **传输层暂不引入 V2 复合信封**：现有 Composer codec 对每个 reference 独立序列化，无法安全地把多个 chip 聚合成一个信封。v1 沿用「每个 chip 一个 V1 envelope」，Host 按同一条用户消息聚合为内部 Batch；因此 `requestId` 放在每个 V1 envelope 的 header 与 prose 中。V2 复合信封留作后续优化（不改变内部 Batch 语义）。GPT 文档中允许该过渡方案。
2. **Host 权威程序**：v1 仍以用户消息信封携带的 program 作为该请求的来源（同一用户/同一会话），Host 校验结构、版本血缘、targetOrder 与拼接结果；修订注册表级程序校验/摘要留作 Phase 2 加固（GPT 的 P0 不阻塞多 pending，但记录在案）。
3. **messageId/run 绑定**：v1 在 pending 中记录 messageId（尽力）+ requestId 显式选择器来防错配；Turn 关闭时的客户端对账已由 M3-1c 落地（§3.6），Host pending 仍只按 TTL 保留。
4. **纯排序零模型执行**：v1 保留 `render_ui` 路径（带 `editRequestId`），Host 确定性排序的零模型执行留作后续优化。
5. **全卡片重生成与局部编辑混发**：v1 允许但每批最多 1 个 full-regenerate；本里程碑的客户端只产生内容编辑/排序请求。

**实施阶段（2026-11-05 状态）**
- M3-1a：客户端多草稿 + 多 chip + 草稿切换区 — **已完成（工作树，未提交）**。
- M3-1b：Host 多 pending + requestId 选择 + 独立提交 — **已完成（工作树，未提交）**。
- M3-1c：部分失败/未完成 reconciliation UI — **已完成（工作树，未提交）**：修订 meta 回传 `requestId`，Turn 关闭按请求 id 对账，未完成项恢复为 failed 可编辑草稿；限制见 §3.6。
- 之后：M3-2 分支/本地卡片恢复、M3-3 草稿持久化/软租约、M3-4 临时样式。

## 0.1 M3-1 验证记录（2026-11-05，工作树）

- Node 测试 **347/347**（Host 159、Client 167、packaging 21；特性文件合计 98：client artifact-edit 26、artifact-edit-reconcile 4、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 32、host artifact-revisions 10）。
- 浏览器 **8/8** 套件通过，`artifact-edit e2e` **102 checks**（多卡片场景 + M3-1c：Turn 关闭后成功草稿消失、部分完成时未完成草稿以 failed 角标恢复且可重新附加成 chip）。
- renderer 契约不变：42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 构建：host `lib/index.js` 735.0 kB、client `lib/client.js` 3.80 MB（js 3.63 MB + css 172.8 kB）、standalone 3.30 MB + 510.5 kB；`npm run check` exit 0；pack 43 files ≈3.96 MB / 10.15 MB（本机实测）。
- E2E 截图（gitignored，未加入 docs assets）：`.tmp-report/harness-m3-batch-reconciled.png`（全部完成对账后无草稿角标）、`.tmp-report/harness-m3-reconcile-failed.png`（部分完成时 failed 草稿角标）。
- 真机（Lead，隔离第二个 DSH 实例，参考会话额外生成一张小卡片）：真实 Composer 同时显示两个 chip（`Edit 夏令时与冬令时 · Revision 2 · 1 changes`、`Edit 三城夏令时对比 · Revision 1 · 1 changes`），右侧面板「Pending edits (2/6)」；一次 Send 后模型依次调用两次 `edit_ui_blocks`（第一次带 requestId+artifactId，第二次带 artifactId），Host 分别记录 Revision 3 与 Revision 2，两张新卡片渲染，chip 清空。截图：`.tmp-report/real-gui-m3-two-drafts.png`、`.tmp-report/real-gui-m3-batch-revisions.png`（gitignored）。
- 明确未验证/未完成：真实模型的「部分成功」路径未做真机验证（E2E 用 harness 模拟 Turn 关闭/部分完成；真机只覆盖单卡/双卡成功路径）；纯排序真实模型回合未跑；V2 复合信封、修订注册表级程序权威校验、zero-model 排序执行、多标签/草稿持久化均未做。

## 1. 目标与非目标

目标：把现在的「单卡片 × 单修订 × 单草稿」模型升级为可并行、可分支、可恢复、可持久化的编辑会话。

非目标（M3 明确不做）：
- 不做多人协作编辑（CRDT/OT）；多标签只做冲突检测/软锁。
- 不做嵌套区块、编排增删（属于 M4）。
- 不为临时样式重新引入 on-demand 生成授权；只复用已渲染结果的快照。
- 不重写 Composer/发送系统，不引入第二套消息通道。

## 2. 现状与约束

- 客户端 store 以 `${sessionId}:${baseRevisionId}` 为 key；`closeOtherEditors()` 强制同一聊天同时只有一个编辑会话；`activeSessionFor()` 只允许一个会话决定 chip；Composer 桥只处理「第一个自己的 chip」。
- 每个 chip 的 codec 序列化出一个 `<artifact-edit-request>` 信封；Host observer 目前只解析一个请求，并以 `sessionId` 为 key 存 1 个 pending（TTL 15 分钟）。
- `edit_ui_blocks` 只接受 `{program}`，隐式作用于该会话唯一的 pending；`render_ui` 的回退路径同样隐式作用于 pending。
- 修订注册表按 `artifactId` 线性取 `revision` 最大值作为 latest；`status()` 在请求的 `baseRevisionId` 不是 latest 时报告 conflict；客户端目前只能编辑 latest。
- 临时样式结果（`styleSource: 'temporary'`）不提供编辑入口；`temporaryStyle` 目前只在 `render_ui` 的 on-demand 授权路径里被接受，修订记录不保存快照。
- 编辑会话仅内存；刷新后 chip 仍靠确定性 ref 恢复，但请求内容（selection/targetOrder/global）丢失。
- 卡片只由 Turn 内的 `render_ui` / `edit_ui_blocks` 工具结果生成；「已从会话窗口淘汰的卡片」没有 DOM 入口。

## 3. M3a 多卡片并行编辑

### 3.1 交互模型（推荐）

- **多个编辑草稿可同时存在，画布同一时间只激活一个**。用户可以在卡片 A 编辑一半、切到卡片 B 继续；每张卡片保留自己的 selection/targetOrder/global，Composer 中每个被编辑的 Artifact 各有一个 chip。
- **一次 Send 最多合并 3 个 Artifact 的内容修改请求**。信封仍是每个 chip 一个 `<artifact-edit-request>`；Host 按信封逐个 arm pending，模型对每个 Artifact 各调用一次工具（`edit_ui_blocks` 带 `requestId`+`artifactId`，或 `render_ui` 带 `editRequestId`）。
- **纯排序 / 仅整体说明的请求也可以包含在同一批次**：它们各占一次 `render_ui` 调用并带 `editRequestId`；同一 Artifact 在同一批只接受第一条请求。
- 发送后每个 Artifact 独立产生 revision 卡片；一个失败不回滚其他成功结果。

### 3.2 客户端改动（已按 v1 落地）

- store：
  - 删除 `closeOtherEditors()`；用 `activeKeys: Map<sessionId, key>` 表示当前画布，`editingSessionFor()` 返回 active 草稿，`draftSessionsFor()` 返回切换区列表。
  - 同一聊天的多个草稿可同时存在；每聊天最多 6 份有内容草稿（超出时 `openArtifactEditor` 返回 `{ok:false, reason:'limit'}`）；每次发送最多 3 个 attached，其余以 detached 创建（`attached` 字段）。
  - 每草稿稳定 `requestId`（`req_` + 12 位 base36，优先 `crypto.getRandomValues`），序列化时写入信封；发送成功后标记 submitted，下次编辑重建。
  - chip 同步按 ref 逐草稿进行：`upsertChip(sessionId, ref, label)` / `removeChip(sessionId, ref)` 只动对应 chip；label 为 `编辑 {title} · 修订 N · {summary}`（summary 用 `edit.chipTail.*`，标题缺省「Artifact 编辑器」）。
  - chip 手动删除检测：upsert 后约 800ms 读取 input occurrences，若该 ref 不存在则把草稿标记 `attached=false`（保留内容、不自动重插）；`attachDraft(key)` 重新附加。
- Composer 桥（`composer.ts`）：按 ref 定位/替换/删除；新 chip 插在末尾；多个 artifact-edit chip 可共存（最多 3 个 attached）。
- 编辑器（`EditPanel`）：顶部新增「待提交编辑 (N/6)」切换区（标题、修订、摘要、active 圆点、冲突/未附加标签、附加/丢弃）；只有 active 草稿的请求列表/编排/整体说明/摘要显示在下方。
- 卡片：非 active 草稿显示卡片角标（含 attached/detached/conflict 状态）；通过切换区或卡片入口激活草稿时卡片 `scrollIntoView`；关闭空画布草稿删除，有内容草稿保留为 detached。
- 发送摘要（`user-text.tsx`）：一条消息里的每个信封各自折叠为一个摘要 chip（`nextEditRequestSummary` 按信封归属计算范围）。

### 3.3 Host 改动（已按 v1 落地）

- 信封解析：新增 `parseEditRequestTexts(text): ArtifactEditRequest[]`，按 `<artifact-edit-request>` 边界切分，逐个 parse；observer 对一条用户消息中的每个请求分别校验并 arm（坏信封不影响其他信封）。
- pending 存储：每会话 `Map<requestId, Entry>`，Entry 含 `requestId`/`artifactId`/`mode: block|full`/`messageId`/`createdAt`；TTL 15 分钟；每会话最多 3 条 pending；每条消息最多 3 个信封；同一 Artifact 同消息只 arm 第一条（重复项标记 invalidReason）。无 `requestId` 的旧客户端单信封生成 legacy id 并保持原单 pending 行为。
- `edit_ui_blocks` 参数增加可选 **`requestId`** 与 **`artifactId`**（多 pending 时必须给出选择器；`artifactId` 仅校验归属，省略时按 requestId 定位）。
- `render_ui` 参数增加可选 **`editRequestId`**：缺省且只有 1 条 pending 时保持旧隐式行为；多于 1 条且未给选择器时返回模型可读错误并列出可用 pending。
- `apply()` 按 selector 精确取出并只消费该条 pending，其余保持 armed；stale/conflict/校验/修订记录按该 Artifact 独立进行，无跨 Artifact 事务。
- 模型提示词：说明一条消息可能包含多个 Artifact 编辑请求，必须对每个请求各调用一次工具（block 用 `edit_ui_blocks` + requestId/artifactId，full 用 `render_ui` + editRequestId）；不要把多个 Artifact 合并进一个片段程序。

### 3.4 限制与失败语义（v1 实际）

- 同时编辑上限：一次 Send 最多 3 个请求；每聊天最多 6 份有内容草稿、3 份 attached；每会话最多 3 条 pending；同一条消息超过 3 个信封的部分被忽略并记录日志；同一 Artifact 每批只接受第一条。每个请求仍受 12 条修改、2000/4000 字、100 区块编排与 200k 程序限制。共享契约声明的批次上限（24 条区块修改 / 120k 字符程序总量）**尚未在执行侧强制**，列为 Phase 2 加固。
- 某个 Artifact 的 base 过期：仅该请求失败，其余请求照常应用；失败项的客户端对账/重试 UI（partial-failure reconciliation）**尚未实现**（M3-1c），当前只在工具行显示错误原因。
- 某次调用缺 selector、requestId 未知或 artifactId 不匹配：Host 拒绝并列出可用 pending（requestId/artifactId），模型可重试；所有 pending 保持 armed。
- v1 仍以客户端信封里的 program 作为该请求的权威来源（Host 校验结构、版本血缘、targetOrder 与拼接结果）；修订注册表级程序校验/摘要属 Phase 2 加固。

### 3.5 验收（v1 已达成项）

- store 单测：多草稿同时存在、active 唯一、切换不丢、requestId 稳定、草稿上限与 attached 状态、序列化带 requestId —— **已通过**（`test/client/artifact-edit.test.mjs` / `artifact-edit-batch.test.mjs`）。
- Host 单测：一条消息两个信封 → 两条 pending；两次工具调用分别生成两个 revision；缺 selector 被拒且保持 armed；一条 stale 一条成功独立处理 —— **已通过**（`test/host/artifact-edit.test.mjs`）。
- 浏览器 E2E：两张卡片分别编辑、Composer 两个 chip、一次 Send 两个信封 → 两张修订卡片、删除 chip 后 detached/重新附加 —— **已通过**（artifact-edit 102 checks）。
- 真机：两张卡片的内容修改一次发送，模型调用两次 `edit_ui_blocks`，两张卡片都更新 —— **已通过**（2026-11-05，见 §0.1）。
- M3-1c 对账：Turn 关闭后成功草稿删除、部分完成时未完成草稿恢复为 failed/detached 且可重新附加 —— **Node/E2E 已通过**（`artifact-edit-reconcile.test.mjs` 4 条 + E2E §17/§18）。
- 未达成：真实模型的「部分成功」路径真机验证；纯排序真实模型回合。

### 3.6 M3-1c 修订对账（已实现）

- 修订 meta：`ArtifactRevisionMeta.requestId` 由 Host 在 `apply()` 的 lineage 中写入（pending request 的 requestId），`render_ui` 与 `edit_ui_blocks` 的输出版本/meta 都透传；客户端 `IntelligentUIProgram.requestId` 从卡片 meta 读回（`programs.ts::revisionLineage`/`blockEditProgram`）。
- 客户端提交保留：`markSubmitted` 置 `status:'submitted'` 并记录 `requestId`/`submittedAt`；每聊天最多保留 12 条未决 submitted（超限按 `submittedAt` 淘汰最旧）。它们不进切换区、不占 attached 额度。
- Turn 关闭对账：`IntelligentUICards` 在 `turn.status === 'closed'` 时（每 Turn 一次）收集该 Turn 卡片的 `requestId`，以 `turn.start.time - 5000` … `turn.end.time` 为时间窗口调用 `reconcileArtifactSubmissions`（`store.ts`）：命中者删除；未命中者恢复为 `status:'ready'`、`submitFailed:true`、`attached:false`、新 `requestId`、清空 `submittedAt`，保留内容可编辑。
- UI：卡片草稿角标新增 `data-state="failed"`，文案 `edit.draftFailed`（「未完成，草稿已保留」/ "Not completed; draft kept"）；编辑面板切换区行显示 `is-failed` 标签（title `edit.draftFailedHint`）；激活或重新附加会清除 `submitFailed`，附加只把草稿加回下次发送，不会自动重发。
- 限制：Host 未完成 pending 仍按 15 分钟 TTL 保留（Turn 关闭不清理）；Turn 归属依赖发送时间窗口启发式（历史 Turn 不会认领新提交，极端时钟/长延迟未验证）；真实模型的部分成功路径未真机验证；`requestId` 仅客户端使用，不写修订记录文件。

## 4. M3b 旧修订分支与恢复

### 4.1 分支模型（推荐）

- 在编辑请求 header 增加 `branch?: true`；当它为 true 时，`baseRevisionId` 允许是旧修订，Host 不再因“不是 latest”拒绝，而是校验：
  1. 该 revision 属于同一 artifact；
  2. 请求 program 与该修订的程序一致（客户端信封已带 program）；
  3. 新修订号 = 该 artifact 当前 latest + 1（线性编号不变）；
  4. 记录 `baseRevisionId` 指向被选择的旧修订，形成分支血缘。
- 客户端：旧修订卡片（同一 artifact 下 revision < latest 的卡片）增加「基于此修订创建新修订」入口；进入编辑后横幅显示「基于修订 X 创建新修订（当前最新为 Y）」；chip label 带「分支」。
- 排序/codec 不变；`orderChanged`、`branch` 都进 header。
- 冲突探测：分支模式下客户端跳过“必须 latest”的阻塞检查，但仍在发送前用 GET 确认 artifact 存在；Host 在 apply 时重新校验。

### 4.2 一键恢复（owner 已选：零模型成本的本地修订卡片）

- 目标：在旧修订卡片上点「恢复为新修订」，**不调用模型**，Host 直接记录一条新修订（程序 = 被恢复修订的程序，baseRevisionId = 该旧修订，revision = 当前 latest + 1），客户端立即在该卡片所在 Turn 的 Turn Tail 插入一张「修订 N」卡片。
- 这要求引入**本地修订卡片来源**（不来自工具结果）：
  - 客户端新增本地 revision card 节点/快照：`{source:'local-revision', artifactId, revisionId, baseRevisionId, revision, program, title, style, styleId, temporaryStyle?, createdAt}`，与会话持久化一起保存，刷新后仍能重建。
  - 卡片渲染、导出、回放、follow-up 隐藏逻辑需同时识别工具结果卡片与本地修订卡片；旧卡片仍是历史。
  - Host 新增认证路由 `POST /api/intelligent-ui/artifact-restore`：body `{artifactId, sourceRevisionId, program, title?, style, styleId?, temporaryStyle?}`；校验源修订属于同一 artifact、program 可解析且与源修订的血缘一致；记录新修订并返回 `ArtifactRevisionMeta`。
  - 失败语义：源修订不存在/被淘汰、program 超限、样式不合法 → 客户端明确提示，不产生卡片；重复点击用请求幂等键（sourceRevisionId + clientRequestId）避免重复记录。
  - 与分支编辑的关系：恢复后 latest 变为新修订；旧修订仍可继续分支编辑。
- 风险：本地卡片绕过 Turn 工具结果，需要明确「重放/导出/图片导出/发送到助手」的语义；Token 成本为零但失去模型整理机会；需限制每会话本地卡片数量与程序大小。

### 4.3 验收

- Host：旧修订 + branch=true 的请求被接受并记录新 revision；非 branch 的旧修订请求仍拒绝；branch 请求的 program 与旧修订不符时拒绝。
- E2E：旧修订卡片出现分支入口，编辑器横幅/ chip 文案正确；生成的新卡片 revision = latest+1。
- 文档：修订血缘从线性描述改为「latest + 可指定 base 的分支」。

## 5. M3c 临时样式结果编辑

### 5.1 授权模型（推荐）

- 编辑请求 header 增加 `temporaryStyle` 快照（复用 `StyleSnapshot` 校验：schemaVersion/baseLayout/非空 directives/可选封闭主题），并与 `style` 保持一致。
- Host 不要求 on-demand 运行中的授权（编辑不是生成新样式），但要求：
  - 快照通过 `isStyleSnapshot` + 对比度/枚举校验；
  - `temporaryStyle.baseLayout === style`；
  - 请求来自已渲染结果的编辑信封（`artifactId/baseRevisionId` 可解析）。
- 新修订的 meta 增加 `temporaryStyle` 与 `styleSource:'temporary'`；客户端从 meta 渲染「临时样式」徽章与主题。
- 修订记录增加可选 `temporaryStyle`（受大小上限保护），供查询/回放使用。

### 5.2 范围限制（v1）

- 临时样式结果支持**内容修改**（`edit_ui_blocks`），因为 Host 只重新合成程序、不重新授权样式。
- 纯排序/仅整体说明的临时样式结果**暂不支持**：它们需要 `render_ui` 的完整程序路径，而 `render_ui` 对 temporaryStyle 仍要求 on-demand 授权。UI 在 Send 前提示；后续可让 Host 直接做确定性重排（不需模型）再生成卡片，但那需要新的卡片来源，留给后续里程碑。

### 5.3 验收

- 单测：临时样式快照通过校验进入请求；非法/不匹配快照被拒绝；meta/记录带 temporaryStyle。
- E2E：临时样式卡片出现编辑入口，内容编辑后新卡片 badge 仍为临时样式。
- 真机：on-demand 生成的临时样式结果完成一次内容编辑。

## 6. M3d 草稿持久化、多标签、已淘汰卡片

### 6.1 草稿持久化

- 将会话快照（key/artifactId/baseRevisionId/program/selection/targetOrder/global/draft 状态）写入 `sessionStorage`，键 `artifact-edit-draft:v1:${ref}`；program 受 200k 上限，超出则不持久化并提示。
- 写入 debounce 250ms；关闭编辑、发送成功、清空草稿时删除。
- 恢复：卡片挂载或 codec 解析 chip 时，若内存无 session，则按 ref 读取快照并水合；损坏/版本不符则忽略并保持现有 stale 提示。

### 6.2 多标签协调

- `BroadcastChannel('artifact-edit')` 广播 `{type:'revision-recorded', artifactId, revisionId, revision}`、`{type:'edit-lease', artifactId, tabId, expiresAt}`。
- 编辑租约：进入编辑时尝试获取 30s 租约并每 15s 续租；另一标签进入同一 artifact 时显示横幅「另一标签页正在编辑此修订」并提供“只读查看/接管编辑”。
- 收到 revision-recorded 时触发一次静默 probe，提前出现冲突横幅。
- v1 不做自动合并；租约丢失只提示，不强制退出。

### 6.3 已淘汰卡片

- 现状没有 DOM 入口，也没有 Host 侧程序缓存。可选方案：
  - A. 会话历史里出现「修订列表」入口（需新的 UI 面）；
  - B. Host 在修订记录中保存每个 Artifact 最近一次 program（有界），并通过 card 恢复命令重开编辑。
- 两个方案都需要新的 UI/卡片来源，建议 M3 暂不实现 B2-4，只在路线图保留并标注「依赖修订列表 UI」。如果 owner 要求 M3 内完成，需要先确认入口形态。

### 6.4 验收

- 单测：快照写入/读取/损坏容错；租约冲突提示事件。
- E2E：编辑草稿后刷新页面，重新打开同一卡片恢复 selection/targetOrder/global；两个标签页出现租约提示。

## 7. 数据与 API 变更汇总

| 变更 | 位置 | 兼容性 |
| --- | --- | --- |
| 多信封解析 `parseEditRequestTexts` | shared/artifact-edit | 向后兼容单信封 |
| pending 按 `requestId` 索引（每会话最多 3 条） | host/artifact-edit | 单 pending 行为不变；无 requestId 的 legacy 信封生成固定 id |
| `edit_ui_blocks` 新增 `requestId` + 可选 `artifactId` | host/index | 单 pending 时仍可省略 |
| `render_ui` 新增 `editRequestId` | host/index | 单 pending 时仍可省略 |
| 请求 header `requestId` | shared/artifact-edit | 可选字段；客户端每草稿稳定生成 |
| revision meta `requestId` | shared/artifact-edit + host/index + client programs | M3-1c；可选字段，由 pending request 写入，客户端用于 Turn 关闭对账 |
| 客户端 submitted 草稿保留与对账（`submitFailed`/`submittedAt`/`reconcileArtifactSubmissions`） | client store + IntelligentUICards | M3-1c；纯客户端内存态，无协议变更 |
| 请求 header `branch` / `restoreFromRevision` | shared/artifact-edit | M3-2 计划，可选字段 |
| 请求 header `temporaryStyle` | shared/artifact-edit | M3-4 计划，可选字段，复用快照校验 |
| revision meta `temporaryStyle` | shared/artifact-edit | M3-4 计划，可选 |
| revision 记录 `temporaryStyle` | host/artifact-revisions | M3-4 计划，可选，旧文件可读 |
| 客户端多草稿快照（active/attached/requestId） | client store | 内存态；sessionStorage 持久化属 M3-3 |

## 8. 里程碑与顺序

0. **设计前置**：M3-1 多卡片交互设计（multi-card-brief.md）已确认并落地为 M3-1a/M3-1b/M3-1c。
1. **M3-1（多卡片并行 + 部分失败对账）**：3.2–3.6 已实现并通过 Node/浏览器验收（真机成功路径已过；真实模型部分成功未验证）。**下一步 M3-2。**
2. **M3-2（旧修订分支 + 本地卡片恢复）**：4.1–4.3；包含 Host 恢复路由与本地修订卡片来源。
3. **M3-3（草稿持久化 + 多标签）**：6.1–6.2（软租约已确认）。
4. **M3-4（临时样式编辑）**：第 5 节（快照授权已确认）。
5. **M3-5（已淘汰卡片）**：owner 已确认 M3 暂缓。

每个里程碑：实现 + Node 测试 + 浏览器 E2E + 真机验收 + 文档增量同步，全绿后才进入下一个。

## 9. 风险

- 多信封/多 pending 会改动 Host 与 Composer 的核心路径，必须保留单 Artifact 行为作为回归基线。
- 多卡片并行发送可能放大 token 成本（每条消息最多 3 个完整页面上下文）；Phase 1 仍传整页，Phase 2 输入节省的优先级需用真实模型观测评估。
- 独立执行意味着可能部分成功：M3-1c 已实现 Turn 关闭对账与 failed 草稿恢复，但没有自动重试/重发；Host pending 按 TTL 保留，turn 归属依赖时间窗口启发式，真实模型的部分成功路径未真机验证。
- 分支让「latest」与卡片显示的 revision 可能分离，UI 文案和冲突提示容易混淆；需要统一的修订/分支文案。
- 临时样式快照进入用户消息，仍属于同用户可控输入；Host 只接受封闭校验的展示快照，不执行任意 CSS。
- 草稿持久化可能把 200k 程序写入 sessionStorage；需要配额与清理策略，避免存储爆掉。

## 10. 待 owner 评审的决策点

| 决策 | 结果 |
| --- | --- |
| 多卡片交互 | **已确认并落地 M3-1a/M3-1b/M3-1c**（GPT 外部设计主干采纳；v1 差异见 §0；M3-1c 见 §3.6） |
| 一键恢复 | **零模型成本的本地修订卡片**（4.2 B）；需要 Host 恢复路由 + 本地卡片来源 |
| 临时样式编辑 | **接受 Host 校验的快照**（第 5 节） |
| 多标签协调 | **软租约 + 提示**（6.2） |
| 已淘汰卡片 | **M3 暂缓**（6.3） |
