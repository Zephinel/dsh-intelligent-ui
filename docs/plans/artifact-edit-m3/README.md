# M3 会话与版本模型设计方案

> **状态：as-planned 设计稿；M3-1a / M3-1b / M3-1c / M3-2 / M3-3 / M3-4 已在工作树实现（未提交）— 2026-11-05；M3 全部完成。**
> M3 对应 [后续路线图](../artifact-edit-followups/README.md) 的 M3：多卡片并行编辑、旧修订分支/恢复、临时样式编辑、草稿持久化与多标签协调、已淘汰卡片编辑。
> 本文件描述设计与实施计划；已落地行为以代码与 [架构与行为](../../architecture.md) 为准，M3-1/M3-2/M3-3/M3-4 的验收数据见下方验证记录。
> M3-4（临时样式快照内容编辑）已实现并通过 Node/浏览器验证；M3 四项全部完成，下一步 M4（嵌套容器、编排增删复制）与 B1/B2 收口项。
>
> **2026-11-05 owner 评审结果**：一键恢复选择**零模型成本的本地修订卡片**（4.2 B）；临时样式编辑接受 **Host 校验的快照**（第 5 节）；多标签采用**软租约 + 提示**（6.2）；已淘汰卡片 **M3 暂缓**（6.3）。多卡片交互模型 owner 要求先交给 GPT 做外部设计，上下文见 [multi-card-brief.md](multi-card-brief.md)；设计已确认并落地为 M3-1a/M3-1b/M3-1c/M3-2/M3-3/M3-4（v1，见 §0.1–§0.4、§3.6、§4、§5、§6）。

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
- M3-2：旧修订分支 + 零模型本地修订卡片恢复 — **已完成（工作树，未提交）**：`branch: true` 分支编辑、`POST /api/intelligent-ui/artifact-restore` 恢复路由、localStorage 本地修订卡片；限制见 §4.1/§4.2。
- M3-3：草稿持久化 + 跨标签软租约 — **已完成（工作树，未提交）**：sessionStorage per-tab 草稿持久化与懒恢复、BroadcastChannel 软租约横幅/接管；限制见 §6.1/§6.2。
- M3-4：临时样式快照内容编辑 — **已完成（工作树，未提交）**：`temporaryStyle` 契约/客户端内容编辑/Host record+meta+restore 复制/`render_ui` 回退拒绝；限制见 §5.1/§5.2。
- M3 全部完成；下一步 M4（嵌套容器、编排增删复制）与 B1/B2 收口项。

## 0.1 M3-1 验证记录（2026-11-05，工作树）

> 本节是 M3-1 当时的数据；M3-2 后的最新数据见 §0.2。

- Node 测试 **347/347**（Host 159、Client 167、packaging 21；特性文件合计 98：client artifact-edit 26、artifact-edit-reconcile 4、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 32、host artifact-revisions 10）。
- 浏览器 **8/8** 套件通过，`artifact-edit e2e` **102 checks**（多卡片场景 + M3-1c：Turn 关闭后成功草稿消失、部分完成时未完成草稿以 failed 角标恢复且可重新附加成 chip）。
- renderer 契约不变：42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 构建：host `lib/index.js` 735.0 kB、client `lib/client.js` 3.80 MB（js 3.63 MB + css 172.8 kB）、standalone 3.30 MB + 510.5 kB；`npm run check` exit 0；pack 43 files ≈3.96 MB / 10.15 MB（本机实测）。
- E2E 截图（gitignored，未加入 docs assets）：`.tmp-report/harness-m3-batch-reconciled.png`（全部完成对账后无草稿角标）、`.tmp-report/harness-m3-reconcile-failed.png`（部分完成时 failed 草稿角标）。
- 真机（Lead，隔离第二个 DSH 实例，参考会话额外生成一张小卡片）：真实 Composer 同时显示两个 chip（`Edit 夏令时与冬令时 · Revision 2 · 1 changes`、`Edit 三城夏令时对比 · Revision 1 · 1 changes`），右侧面板「Pending edits (2/6)」；一次 Send 后模型依次调用两次 `edit_ui_blocks`（第一次带 requestId+artifactId，第二次带 artifactId），Host 分别记录 Revision 3 与 Revision 2，两张新卡片渲染，chip 清空。截图：`.tmp-report/real-gui-m3-two-drafts.png`、`.tmp-report/real-gui-m3-batch-revisions.png`（gitignored）。
- 明确未验证/未完成：真实模型的「部分成功」路径未做真机验证（E2E 用 harness 模拟 Turn 关闭/部分完成；真机只覆盖单卡/双卡成功路径）；纯排序真实模型回合未跑；V2 复合信封、修订注册表级程序权威校验、zero-model 排序执行、多标签/草稿持久化均未做。

## 0.2 M3-2 验证记录（2026-11-05，工作树）

- Node 测试 **364/364**（Host 169、Client 174、packaging 21；特性文件合计 115：client artifact-edit 30、artifact-edit-reconcile 4、local-revisions 3、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 37、host artifact-revisions 15）。
- 浏览器 **8/8** 套件通过，`artifact-edit e2e` **111 checks**（新增：旧修订卡片 restore → 本地修订卡片、branch 冲突横幅/note/`branch:true` envelope）。
- renderer 契约不变：42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 构建：host `lib/index.js` 740.0 kB、client `lib/client.js` 3.81 MB（js 3.64 MB + css 173.2 kB）、standalone 3.30 MB + 510.5 kB；`npm run check` exit 0；pack 43 files ≈3.97 MB / 10.16 MB。
- 真机（Lead，隔离 DSH 实例，参考会话）：旧 Revision 2 卡片 restore → 本地卡片 **Revision 7**（1 个 local badge，无模型调用）；再发一个普通新回合后本地卡片仍只渲染一次。分支：旧 Revision 2 进入编辑显示冲突 → 「Create a new revision from this one」→ branch note「The latest revision is 5」→ chip 追加「 · branch」→ 一次 Send 后模型调用 `edit_ui_blocks`，生成 **Revision 6**（base 为旧修订）。
- 截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m32-local-restore.png`、`.tmp-report/harness-m3-local-revision.png`。
- 必须记住的限制：本地卡片只存 localStorage（清存储/换设备丢失）；不进入 assistant 消息条目，也不参与导出/图片导出/回放；restore 只对非 latest 修订可用（latest → already_latest）；本地卡片在触发恢复的 Turn 渲染，不在对话最底部；branch 草稿提交失败被对账恢复会丢失 branch 标记；真实模型的「分支部分失败」未单独验证。

## 0.3 M3-3 验证记录（2026-11-05，工作树）

- Node 测试 **373/373**（Host 169、Client 183、packaging 21；特性文件合计 124：client artifact-edit 36、artifact-edit-reconcile 4、local-revisions 3、edit-tabs 3、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 37、host artifact-revisions 15）。
- 浏览器 **8/8** 套件通过，`artifact-edit e2e` **115 checks**（新增：草稿写入 sessionStorage、刷新后 Composer chip/请求列表恢复、清理后回到初始态）。
- renderer 契约不变：42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 构建（本机实测）：host `lib/index.js` 740.2 kB、client `lib/client.js` 3.82 MB（js 3.65 MB + css 173.5 kB）、standalone 3.30 MB + 510.5 kB；pack 43 files ≈3.97 MB / 10.17 MB。
- 真机（Lead，隔离 DSH 实例，参考会话）：两个标签页打开同一 session；tab2 打开同卡片编辑时出现租约横幅「Another tab is editing this revision / Take over editing」，点击接管后 tab2 横幅消失、tab1 出现租约横幅。tab 编辑后保存草稿，Reload 后 Composer 恢复 chip 文本 `Edit 夏令时与冬令时 · Revision 7 · 1 changes`，卡片出现草稿角标。
- 截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m33-lease.png`、`.tmp-report/real-gui-m33-draft-restored.png`、`.tmp-report/harness-m3-draft-restored.png`。
- 必须记住的限制：sessionStorage 仅同标签页（刷新保留、跨标签不共享）；branch/latestRevision/submitFailed 与撤销记录不持久化（branch 恢复后需重新在冲突横幅启用）；超大 program 不持久化；租约仅提示，不合并/不阻止编辑；BroadcastChannel 不可用时降级无提示；Host 修订校验仍是最终权威；极端并发/时钟偏移未验证。
- 说明：本记录是 M3-3 验收时的快照；M3-4 完成后当前树为 Node 383/383、artifact-edit 121 checks，最新数据见 §0.4（§0.1–§0.3 均为各自里程碑的当时数据）。

## 0.4 M3-4 验证记录（2026-11-05，工作树）

- Node 测试 **383/383**（Host 174、Client 188、packaging 21；特性文件合计 134：client artifact-edit 41、artifact-edit-reconcile 4、local-revisions 3、edit-tabs 3、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 40、host artifact-revisions 17）。
- 浏览器 **8/8**；`artifact-edit e2e` **121 checks**（新增：临时样式卡片标记/编辑入口、信封携带 snapshot 且无 styleId、临时样式修订卡片、仅排序被阻止并显示引导）。
- renderer 契约不变：42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 构建（本机实测）：host `lib/index.js` 741.2 kB、client `lib/client.js` 3.82 MB（js 3.65 MB + css 173.5 kB）、standalone 3.30 MB + 510.5 kB；`npm run check` exit 0；pack 43 files ≈3.97 MB / 10.18 MB。
- 限制：临时样式结果只支持区块内容编辑；纯排序/纯整体说明不支持（客户端 `edit.errorTemporaryOrder` + Host `render_ui` 回退拒绝），需要已保存/内置样式；没有有效快照的临时卡片不可编辑；临时样式路径未单独做真实模型/真机验证（E2E 模拟）。M3 至此全部完成（M3-1/2/3/4）；M4 与 B1/B2 收口项未开始。

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

### 4.1 分支模型（已按 v1 落地）

- 请求 header 增加 `branch?: true`（`ArtifactEditRequest.branch`），信封 prose 增加「这是分支编辑」说明；旧客户端不发送即普通编辑。客户端在旧修订的冲突横幅提供「从此修订创建新修订」（`data-dsh-iui-edit-branch`）：`enableBranch` 只在 `status === 'conflict'` 且 `latestRevision` 已知时生效，设置 `branch: true`、恢复 `ready`，冲突横幅替换为提示条 `data-dsh-iui-edit-branch-note`（`edit.branchBannerTitle`/`Body` 显示 base 修订与最新修订）；chip 标签追加「 · 分支」。
- 客户端发送前仍 probe，但 `branch !== true` 时才把 conflict 当发送错误；branch 请求仍带旧 `baseRevisionId`，Host 记录新修订。草稿关闭/重开保留 branch；发送成功后 `markSubmitted` 清除；若提交失败被 Turn 关闭对账恢复为 failed 草稿，branch 标记丢失，需要重新在冲突横幅启用（已知边界）。
- Host 在 `describeProblem`/`apply` 放宽 branch 的 latest 检查：base 存在时必须属于同一 artifact 且 `record.revision === request.baseRevision`；未记录的 base 只允许 `revision === 1`（首个 render 未入库）；否则返回模型可读错误且不消费 pending。新修订号 = 该 artifact 当前 latest + 1（无 latest 时 `baseRevision + 1`），`baseRevisionId` 指向被选择的旧修订；`targetOrder` 确定性重排、warnings、`requestId` meta 不变；修订号超过 100,000 拒绝。非 branch 路径保持严格 latest 校验与旧文案。
- 限制：分支让「最新修订」与卡片显示的 revision 分离，由 branch note 说明；真实模型的“分支部分失败”未单独验证。

### 4.2 一键恢复（已按 v1 落地：零模型本地修订卡片）

- Host 路由：在现有认证/effect/dispose 下新增精确 **`POST /api/intelligent-ui/artifact-restore`**（与 GET 修订查询共用 disposer；GET 行为不变）。请求体 `{schemaVersion:1, artifactId, sourceRevisionId, program}`：要求 `content-type: application/json`、body ≤300 KiB、15 秒超时，`describeArtifactRestoreProblem` 校验；source 必须存在（404 `source_missing`）、同 artifact（400 `artifact_mismatch`）、非 latest（409 `already_latest`）；program 必须能解析且根为 `Col`（400 `invalid_program`）；修订号超过 100,000 返回 400 `revision_limit`；非 POST 405 `method_not_allowed`。错误统一 `{error:{code,message}}`（400/404/409/413/405），响应 `no-store`。
- 成功返回 **201** `{ok:true, revision:{artifactId, revisionId, baseRevisionId, revision, program, title?, style, styleId?}}`；记录 `revision = latest + 1`、`revisionId = restore_<16 hex>`（随机 8 字节，最多 8 次冲突重试）、`baseRevisionId = sourceRevisionId`、`sessionId = "local-restore"`，复制 source 的 `style`/`styleId`/`title`，program 不写入注册表（由响应携带）。
- 客户端 `artifact-edit/local-revisions.ts`：卡片在 GET probe 报告 conflict（非 latest）时显示「恢复为新修订」（`data-dsh-iui-restore`；latest 与 localRevision 卡片不显示），点击 POST 恢复；结果存为 `LocalArtifactRevision` 写入 **localStorage**（key `dsh-intelligent-ui-local-revisions:v1:<sessionId>`，每会话最多 20 张、按 `revisionId` 去重替换、按 `createdAt` 淘汰最旧），并转为 `localRevisionProgram()` 渲染（`localRevision: true`、可继续编辑）。本地卡片按触发恢复的 `turn` 过滤，在该 Turn 的卡片列表中渲染一次。
- 限制：只在浏览器 localStorage，清存储/换设备丢失；不进入 assistant 消息条目，也不参与导出/图片导出/回放链；恢复只对非 latest 修订可用；本地卡片渲染在触发恢复的 Turn（不是对话最底部）；真实模型“分支部分失败”未单独验证。

### 4.3 验收（已达成项）

- Host：旧修订 + `branch=true` 被接受并记录 `latest+1`；非 branch 旧修订仍拒绝；非法 branch base 被模型可读错误拒绝且不写修订。恢复路由：POST 成功记录 `latest+1` 并返回本地修订；source 缺失/跨 artifact/already latest/非法 body/超长/非 POST/认证拒绝分别拒绝；GET 仍工作；disposer 同时释放两个路由。—— **已通过**（`test/host/artifact-edit.test.mjs` 37 条、`test/host/artifact-revisions.test.mjs` 15 条）。
- 客户端：本地修订只存本地、替换/上限；本地修订可渲染/可编辑；restore 请求映射 Host 响应。—— **已通过**（`test/client/local-revisions.test.mjs` 3 条）。
- 浏览器 E2E：旧修订 restore → 本地卡片；branch 冲突横幅 → note → chip「 · 分支」→ `branch:true` envelope。—— **已通过**（artifact-edit 111 checks）。
- 真机：旧 Revision 2 restore → 本地 Revision 7（无模型调用、只渲染一次）；旧 Revision 2 branch → Revision 6（base 旧修订）。—— **已通过**（2026-11-05，见 §0.2）。
- 未达成：真实模型的“分支部分失败”独立验证；本地卡片导出/回放语义（明确不支持，属设计限制）。

## 5. M3c 临时样式结果编辑（已按 v1 落地）

### 5.1 授权与契约（已实现）

- 编辑请求 header 增加可选 `temporaryStyle` 快照（`ArtifactEditRequest.temporaryStyle?: StyleSnapshot`，复用 `StyleSnapshot` 校验），并与 `style` 保持一致；不能与 `styleId` 同用；JSON ≤ 20,000 字符。
- Host 不要求 on-demand 运行中的授权（编辑不是生成新样式），但校验：`isStyleSnapshot`、`temporaryStyle.baseLayout === style`、请求本身可解析。`edit_ui_blocks` 的 composed 路径允许快照；`render_ui` 的完整程序回退对临时样式保持关闭，并返回专门错误（只支持 `edit_ui_blocks` 内容编辑，排序/整体说明需要已保存/内置样式）。
- 修订记录 `ArtifactRevisionRecord` 增加可选 `temporaryStyle`（校验同上，旧 registry 文件兼容）；`edit_ui_blocks` 输出 schema/值/output meta/`presentationMeta`/lineage 透传快照；客户端 `programs.ts` 从 meta 读回 `temporaryStyle` 与 `styleSource:'temporary'`，渲染临时样式徽章/主题；本地恢复卡片复制快照。
- 恢复路由 `POST artifact-restore` 复制 `source.temporaryStyle` 到新 record 与响应 `revision.temporaryStyle`。

### 5.2 范围限制（v1，已实现）

- 临时样式结果支持**内容修改**（`edit_ui_blocks`），Host 只重新合成程序、复用快照，不重新授权样式。
- 纯排序/仅整体说明的临时样式结果**不支持**：客户端 serialize 在 probe 前返回 `temporary_order` → `edit.errorTemporaryOrder`（草稿不消费）；Host `render_ui` 回退也明确拒绝。需要用户先用已保存/内置样式重新渲染。
- 没有有效快照的临时卡片不可编辑；内容+排序混合请求允许（Host 确定性重排）。

### 5.3 验收（已达成项）

- 单测：临时样式内容编辑成功且 record/meta/schema 带 `temporaryStyle`、无 styleId；非法/与 styleId 同用/超大快照被拒绝；`render_ui` 回退拒绝；record 校验与 restore 复制快照。—— **已通过**（`test/host/artifact-edit.test.mjs` 40 条、`test/host/artifact-revisions.test.mjs` 17 条、`test/client/artifact-edit.test.mjs` 41 条）。
- E2E：临时样式卡片出现编辑入口，内容编辑后新卡片 badge 仍为临时样式；仅排序草稿被阻止并显示引导。—— **已通过**（artifact-edit 121 checks）。
- 真机/真实模型：**未单独验证**（临时样式路径用 E2E 模拟；真机只覆盖普通样式内容编辑与多卡片/分支/恢复/草稿恢复）。

## 6. M3d 草稿持久化、多标签、已淘汰卡片

### 6.1 草稿持久化（已按 v1 落地）

- `store.ts` 把未提交草稿按标签页写入 `sessionStorage`：每条草稿键 `dsh-iui-edit-draft:v1:<sessionId>:<baseRevisionId>`，每会话索引键 `dsh-iui-edit-draft-index:v1:<sessionId>`；只存恢复所需字段（ids/requestId/style/program/originalOrder/targetOrder/orderChanged/selection/globalInstruction/attached），`blocks`/包裹程序在恢复时重算，瞬时 UI 状态不持久化。
- 写入 250ms debounce（内容未变跳过）；每会话索引最多 6 条并淘汰最旧；discard/发送成功/对账删除/空草稿 prune 清理记录与索引；配额/JSON/受限上下文错误静默。
- 懒恢复：`ensureArtifactDraft(key)`、`hydrateArtifactDrafts(sessionId)`、`flushArtifactDraftPersistence()`；`editSessionFor`/`useArtifactEditSession`（挂载后 useEffect 水合）/`serializeArtifactEditRequest`（确定性 ref 反解 key）/`draftSessionsFor`/`activeDraftKeyFor`/`activateDraft` 在内存缺失时触发恢复。恢复后 `status:'ready'`、`editing:false`、selection 过滤、targetOrder 重新校验、chip 250ms 内重同步。
- 限制（已实现）：仅同标签页（刷新保留、跨标签不共享）；`branch`/`latestRevision`/`submitFailed`/撤销记录不持久化（branch 恢复后需重新在冲突横幅启用）；超过 200k 的 program 不持久化；无自动 `pagehide` flush（仅导出函数）。

### 6.2 多标签协调（已按 v1 落地：软租约）

- `BroadcastChannel('dsh-iui-artifact-edit-tabs:v1')` 广播 `lease`/`release`/`query`；lease 记录 `{tabId, expiresAt}`，TTL 30 秒、每 10 秒续租；打开编辑器先 query，400ms 后仅在无 foreign lease 时 claim，接管按钮强制 claim；关闭/卸载释放。
- 其他标签持有 lease 时，编辑器显示 `data-dsh-iui-edit-lease-conflict` 横幅（标题/说明/「接管编辑」按钮 `data-dsh-iui-edit-lease-takeover`）；接管后本标签横幅消失，原标签收到 lease 后显示横幅。
- 限制（已实现）：租约只提示，不合并、不阻止编辑；只覆盖“正在编辑”的修订，不覆盖草稿所有未发送修改；广播不可用时降级为无提示；Host 修订校验仍是最终权威；极端并发/过期时钟未验证。收到 revision-recorded 后自动 probe 的设想未在 v1 实现（仍靠 15 秒后台 probe + 冲突横幅）。

### 6.3 已淘汰卡片

- 现状没有 DOM 入口，也没有 Host 侧程序缓存。可选方案：
  - A. 会话历史里出现「修订列表」入口（需新的 UI 面）；
  - B. Host 在修订记录中保存每个 Artifact 最近一次 program（有界），并通过 card 恢复命令重开编辑。
- 两个方案都需要新的 UI/卡片来源，建议 M3 暂不实现 B2-4，只在路线图保留并标注「依赖修订列表 UI」。如果 owner 要求 M3 内完成，需要先确认入口形态。

### 6.4 验收（已达成项）

- 单测：未发送草稿写入 sessionStorage、刷新后 hydrate、损坏/不可用记录清理、discard/发送清除记录与索引、确定性 ref 恢复、无 sessionStorage no-op、聊天索引恢复全部草稿（`test/client/artifact-edit.test.mjs` 6 条）；另一标签 lease 可见并阻止静默 claim、takeover 替换并释放、过期 lease 忽略（`test/client/edit-tabs.test.mjs` 3 条）。—— **已通过**。
- E2E：草稿保存后刷新，Composer chip 与请求列表恢复；真机（两个标签页 + 租约横幅/接管 + Reload 后 chip 恢复）见 §0.3。—— **已通过**（artifact-edit 115 checks + 真机，2026-11-05）。
- 未达成：自动 `pagehide` flush；revision-recorded 触发的即时 probe（v1 未实现）；跨标签草稿共享（设计限制）。

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
| 请求 header `branch` | shared/artifact-edit + client store + host/artifact-edit | M3-2 已实现；可选布尔字段，旧客户端不发送即普通编辑 |
| 恢复路由 `POST /api/intelligent-ui/artifact-restore` | shared/artifact-edit + host/artifact-revisions | M3-2 已实现；认证/effect/dispose 与 GET 共用；201 成功、400/404/409/413/405 错误 |
| 客户端本地修订卡片（`artifact-edit/local-revisions.ts`） | client IntelligentUICards + localStorage | M3-2 已实现；每会话 ≤20、`localRevision` 标记、按 Turn 渲染；不进入导出/消息历史 |
| 草稿持久化（sessionStorage 键/索引 + hydrate API） | client store | M3-3 已实现；per-tab、刷新保留、跨标签不共享；branch/submitFailed/撤销不持久化 |
| 请求 header `temporaryStyle` + revision meta `temporaryStyle` | shared/artifact-edit | M3-4 已实现；可选快照，`baseLayout===style`、不与 `styleId` 同用、≤20k；内容编辑专用 |
| revision record `temporaryStyle` | host/artifact-revisions | M3-4 已实现；可选、旧文件可读、restore 复制 |
| 跨标签软租约（`artifact-edit/tabs.ts` + BroadcastChannel） | client ArtifactEditView | M3-3 已实现；30s TTL/10s 续租、query→claim、takeover；仅提示不合并；不可用时无提示 |
| 请求 header `temporaryStyle` | shared/artifact-edit | M3-4 计划，可选字段，复用快照校验 |
| revision meta `temporaryStyle` | shared/artifact-edit | M3-4 计划，可选 |
| revision 记录 `temporaryStyle` | host/artifact-revisions | M3-4 计划，可选，旧文件可读 |
| 客户端多草稿快照（active/attached/requestId） | client store | 内存态；sessionStorage 持久化属 M3-3 |

## 8. 里程碑与顺序

0. **设计前置**：M3-1 多卡片交互设计（multi-card-brief.md）已确认并落地为 M3-1a/M3-1b/M3-1c。
1. **M3-1（多卡片并行 + 部分失败对账）**：3.2–3.6 已实现并提交。**已完成。**
2. **M3-2（旧修订分支 + 本地卡片恢复）**：4.1–4.3 已实现（工作树）；Node/浏览器/真机验证通过。**已完成。**
3. **M3-3（草稿持久化 + 多标签）**：6.1–6.4 已实现（工作树）；Node/浏览器/真机验证通过。**已完成。**
4. **M3-4（临时样式编辑）**：第 5 节已实现（工作树）；Node/浏览器验证通过。**M3 全部完成。**
5. **M4（结构扩展）**：嵌套容器、编排增删复制；B1/B2 收口项（a11y、视觉回归、真机验收记录、发布）同步推进。
6. **M3-5（已淘汰卡片）**：owner 已确认 M3 暂缓。

每个里程碑：实现 + Node 测试 + 浏览器 E2E + 真机验收 + 文档增量同步，全绿后才进入下一个。

## 9. 风险

- 多信封/多 pending 会改动 Host 与 Composer 的核心路径，必须保留单 Artifact 行为作为回归基线。
- 多卡片并行发送可能放大 token 成本（每条消息最多 3 个完整页面上下文）；Phase 1 仍传整页，Phase 2 输入节省的优先级需用真实模型观测评估。
- 独立执行意味着可能部分成功：M3-1c 已实现 Turn 关闭对账与 failed 草稿恢复，但没有自动重试/重发；Host pending 按 TTL 保留，turn 归属依赖时间窗口启发式，真实模型的部分成功路径未真机验证。
- 分支让「latest」与卡片显示的 revision 可能分离，UI 文案和冲突提示容易混淆；M3-2 已用 branch note 说明，但真实模型的“分支部分失败”未单独验证，且 branch 草稿被对账恢复后丢失 branch 标记。
- 本地修订卡片绕过工具结果：卡片只存 localStorage，不进入 assistant 消息/导出/图片导出/回放链；清存储或换设备会丢失，且渲染在触发恢复的 Turn 而非对话最底部；每会话最多 20 张。
- 草稿持久化与租约（M3-3）：sessionStorage 是 per-tab，跨标签不共享草稿；branch/submitFailed/撤销不持久化；租约仅提示、不合并、不阻止编辑，频道不可用时无提示；这些都属于“已知边界”，Host 修订校验仍是最终权威。
- 临时样式编辑（M3-4）：只支持内容编辑，排序/整体说明被双重拒绝；无有效快照不可编辑；临时样式路径未单独真机/真实模型验证，E2E 模拟可能低估真实模型行为差异。
- 临时样式快照进入用户消息，仍属于同用户可控输入；Host 只接受封闭校验的展示快照，不执行任意 CSS。
- 草稿持久化可能把 200k 程序写入 sessionStorage；需要配额与清理策略，避免存储爆掉。

## 10. 待 owner 评审的决策点

| 决策 | 结果 |
| --- | --- |
| 多卡片交互 | **已确认并落地 M3-1a/M3-1b/M3-1c**（GPT 外部设计主干采纳；v1 差异见 §0；M3-1c 见 §3.6） |
| 一键恢复 | **已落地 M3-2：零模型成本的本地修订卡片**（Host POST 恢复路由 + localStorage 本地卡片；不进入导出/消息历史；最新修订不可恢复） |
| 分支编辑 | **已落地 M3-2**：`branch: true` 信封 + 旧 base 校验 + `latest+1` 修订；非 branch 严格 latest 不变 |
| 临时样式编辑 | **已落地 M3-4：接受 Host 校验的快照**（第 5 节）；只支持内容编辑，排序/整体说明需已保存/内置样式 |
| 多标签协调 | **已落地 M3-3：软租约 + 提示**（BroadcastChannel，30s TTL/10s 续租，接管只转移提示；不合并、不阻止编辑；不可用时无提示） |
| 已淘汰卡片 | **M3 暂缓**（6.3） |
