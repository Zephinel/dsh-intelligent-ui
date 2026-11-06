# M4 设计方案：嵌套区块与结构编排（区块增删/复制）

> **状态：M4-0–M4-5、B2-5、B2-6、B1-5、B2-8/B2-9/B2-10 全部完成（B2-6：86b436f；B1-5：4c0b4dd；B2-8/9/10：d6ec446 + 文档提交）；用户反馈修复（去 expand 按钮 + 编辑自动宽度适配，第二轮改为 column-aware 动态适配）已在工作树完成 — 2026-11-05；下一步发布（B1-7）。**
> owner 已确认 §0 的 5 个产品方向；GPT 评审结论为 **RETHINK**，其阻断项已吸收为 §0.1 修订；M4-0 的 CST/渲染/结构操作可行性 spike 已通过（§0.2），M4-1–M4-5 已按收窄范围落地（§0.3–§0.8）。现有行为以 [架构与行为](../../architecture.md) 为准，M3 完成记录见 [M3 计划](../artifact-edit-m3/README.md) §0.4。
> 背景：owner 在 B0-6 同时选择了「扩展到嵌套容器」与「编排支持新增/删除/复制区块」；路线图 M4 还包含 B2-5（严格校验 + diff 预览）与 B2-6（运行态部分保留）。

## 0. 评审结论（2026-11-05，owner 已确认）

| 决策 | 结果 |
| --- | --- |
| 可选节点范围 | 所有可下钻容器（Col/Row/Box/Grid/Card/Section/Carousel）的子节点，深度 ≤4；父容器与叶子都按规则可选/终止 |
| 跨容器移动 | v1 支持“移动到…”结构操作；拖拽仍只限同父排序 |
| 新增区块 | v1 仅“复制现有区块”（duplicate），再对副本做内容编辑；模型生成新块留待后续 |
| 结构操作执行 | 零模型认证路由 `artifact-structure` + 本地修订卡片；结构操作与内容编辑分开发送，不混合 |
| 范围 | M4 先做嵌套识别/渲染/内容编辑、层级排序、删除/复制/移动；B2-5 严格校验/diff 预览与 B2-6 运行态保留后续再做 |

因此实现顺序为：**M4-1 嵌套树 + 渲染器包装 + 嵌套内容编辑 → M4-2 层级排序 → M4-3 结构操作（delete/duplicate/move + 本地卡片）**，每阶段独立验收。

## 0.1 GPT 外部评审与修订（2026-11-05）

评审 verdict：**RETHINK**。结论不是否定 M4 产品目标，而是「先建立能证明结构变换正确性的底层引擎，再逐步开放可编辑容器范围」。我们接受其中 8 个 P0/P1 阻断项，修订如下：

| # | GPT 指出的问题 | 本次修订 |
| --- | --- | --- |
| 1 | 位置 ID 被当成稳定身份；插入/删除/移动后错位 | 身份拆成 **revision-scoped `nodeId`**（由基础修订的确定性提取分配、绑定 `baseRevisionId` + 源码 digest）+ `nodePath`（当前结构地址）+ `displayIndex`。跨修订不承诺 nodeId 稳定；结构操作后产生新修订并重新提取。草稿/请求绑定 base revision，结构操作使旧内容草稿过期而不是静默重映射 |
| 2 | 缺少适合源码编辑的 AST/CST 变换层 | 新增 **M4-0 源码 CST 引擎**：每个 element 的源码范围、子 slot 范围、源码 digest；所有替换/排序/移动/复制在 range 层执行并重新解析验证；先定义支持语法子集，不支持即拒绝 |
| 3 | React 容器递归包装可行性未验证；`display:contents` 不能当 overlay 锚点 | 不再承诺统一 helper。**M4-0 渲染 spike** 只验证 Col（必要时 Card）；采用**容器能力适配器**（canSelect/canEdit/canReorder/canInsert/canMoveOut/canAcceptMoved）+ 独立 overlay 层（按真实 DOM 几何定位），失败则缩小容器范围 |
| 4 | 跨容器移动缺少作用域/专用 slot 分析 | 引入 `slotKey`（默认 `children`）与移动合法性矩阵；跨容器 Move 最后实现，只允许 capability 证明合法的目标；@Each 局部变量/不兼容 slot 默认拒绝 |
| 5 | Delete/Duplicate 可能破坏引用图 | 结构操作前建立 **symbol table + 引用图 + anchor/资源注册表**；Duplicate 处理命名声明、Section/Toc anchor、表单/动作实例标识；Delete 不假定孤儿 helper 无副作用；操作原子验证后 CAS |
| 6 | 结构路由提交语义不完整 | 结构路由要求 **Host 权威基础程序**（新增有界的 revision program store / 读取接口）；`operationId` 幂等；分支感知 CAS；失败不产生 revision；结果可由 Revision 重新获取，本地卡片只做缓存 |
| 7 | 「未选区块逐字节不变」被过度承诺 | 改为**未触及源码子树逐字节不变**的保证：移动/插入会修改受影响父容器的 children 表达式，但未被触及的子表达式源码保持原字节；M4-3 的验证按子树范围断言 |
| 8 | byParent 缺少 slot 语义 | `HierarchicalOrder = byParent[parentNodeId][slotKey] -> childNodeIds[]`；每个 slot 内是完整排列；Host 从最深层开始重建源码（修正原「后序/父级先定位」的表述矛盾） |
| 9 | 父子互斥不够；共享命名表达式/别名 | 增加源码范围重叠、命名引用别名、共享节点检测；同一命名声明被多个视觉区块引用时禁止多选编辑 |
| 10 | 本地 Revision 不是权威存储 | 明确 Host revision 为权威；M4-0 增加从 Revision 读取程序的能力；localStorage 只缓存显示/位置；本地卡片丢失时提供恢复入口；导出/回放限制继续标注 |
| 11 | Draft v2 读取失败静默丢弃 | 损坏草稿隔离保存、提供导出/恢复提示，不静默丢稿 |
| 12 | 单步 Undo 依赖再次调用路由 | Undo 改为显式 `revert` 结构操作，走 CAS/冲突检查，不重放历史操作 |
| 13 | 60 区块限制不足 | 分别限制静态节点、运行时实例、overlay 数、操作复杂度、执行预算/超时 |
| 14 | B2-5 不能整体延期 | 拆开：**正确性校验（CST/作用域/引用/容器/slot/重解析/CAS/幂等）属于 M4 底座**；可视化 diff/人工确认可延期 |

**修订后的实施顺序（取代 §12 原顺序）**

```text
M4-0 结构引擎可行性验证（源码 CST + 稳定 nodeId/digest + symbol 校验 + Col/Card 渲染 spike）
  ↓
M4-1 最小嵌套垂直切片（Col/Card + 单节点替换 + 精确 overlay）
  ↓
M4-2 同父层级排序（slotKey + Host 重建 + 旧 targetOrder 兼容）
  ↓
M4-3 受限结构操作（Delete → Duplicate → 同父 Move，最后跨容器 Move）
  ↓
M4-4 按容器能力扩展（Row/Box/Grid/Section/Carousel）
```

每个阶段先跑可自动测试的引擎 fixture（不接模型），再开放 UI；七类容器不再一次性承诺。

## 0.2 M4-0 gate 结果（2026-11-05）

结论：**结构变换引擎与嵌套渲染的可行性已证明，可以进入 M4-1；但 Renderer 集成与 Host 权威提交链路不在 M4-0 内，必须在 M4-1/M4-3 完成前保持 gate 关闭。**

### 0.2.1 结构引擎 spike（`src/shared/program-cst.ts`，12 tests）

- 已实现：CST ranges（语句/表达式/call args/array items/object entries）、vendor AST↔CST 树映射、revision-scoped `nodeId`（DFS `n1..`）+ `nodePath`/slotKey/digest、symbol/ref/@Each/$state 收集、`replaceNode`/`reorderChildren`/`removeNode`/`duplicateNode`/`moveNode`/`applyOperations`；每次操作重解析 + 重建树 + 未触及子树字节对比；30 个机器可读错误码。
- 支持子集：call/array/object/string/number/bool/null/ref/paren/@Each；ternary/binary/member access 为 opaque，不参与结构编辑。
- 已验证通过：嵌套 replace 且未触及子树逐字节不变；同父 reorder/非法排列拒绝；remove 叶子/容器；duplicate inline 与命名 clone（`_copyN`）；Section anchor/@Each/shared-ref 复制拒绝；move 成功/自身后代/祖先/scope/不兼容容器拒绝；limits/atomic batch。
- 关键限制：nodeId 是 revision-scoped（结构提交后重新提取，旧 id 失效）；`Col(@Each(...))` 动态 children 作为 opaque，不能在内部 reorder/insert；跨容器 move v1 仅 sibling（拒绝祖先/后代区域重叠）；同一父 slot 的批量操作必须不重叠；opaque 表达式不可替换；`unchanged` 以 content range 为准（命名的祖先被标记 touched）。
- M4-1 建议：Host 侧用 `buildArtifactTree` 绑定权威 base program/revision；结构请求携带 `baseRevisionId + nodeId + digest`；先做同父 reorder + delete + replace，duplicate/move 放 M4-3。

### 0.2.2 渲染/overlay spike（39 checks，Col/Row/Card，depth 4，11 nested slots）

- **方案 A（运行时合成 BlockSlot AST 走 renderNode）可行；方案 B（edit-mode library HOC 包装容器）可行且推荐；方案 C 不需要。** 泛型“包 direct children”的 HOC + container allowlist 即足够，无需 per-container adapter。
- 关键发现：`display:contents` wrapper 不是布局透明的（直接子 CSS 失配，card 最大漂移 57.5px / text 67px / body 283→216px）；真实 wrapper 盒仍有 2.5px 高度漂移且成为 Row/Grid 的布局项。**`display:contents` + CSS 补偿层（把受影响的直接子选择器 re-point 到 slot wrapper）可做到 card/text/body 0px 漂移**。
- overlay：每个 slot 可用真实 rect 定位（contents 模式用 union-of-children）；父子 anchor 包含关系正确；pointer-events:none 穿透 + 按 depth 的 z-index 命中 innermost；reorder 后路径映射正确。
- 生产回归：普通渲染无 wrapper；现有 root BlockSlot/artifact-edit e2e 121/121 不变；唯一生产改动是 `block-slot.tsx` 的可选 `path` prop + context（+26/−3，path 缺省行为不变）。
- 主要 M4-1 风险：**CSS 补偿层必须覆盖所有直接子选择器**（`> *`、first/last/nth、`:has(>...)` 等）；建议加 CSS 契约扫描 + fixture 几何快照 E2E。

### 0.2.3 M4-0 验收对照

| gate 项 | 结果 |
| --- | --- |
| 稳定节点身份 | ✅ revision-scoped nodeId + digest；跨修订稳定=false（已接受限制） |
| 嵌套源码替换 | ✅ 支持子集；未触及子树字节一致；opaque 拒绝 |
| 层级排序 | ✅ 同 slot 完整排列；非法拒绝 |
| 跨容器移动 | ⚠️ sibling-only；祖先/后代/scope 拒绝 |
| 结构校验 | ✅ 重解析/引用/scope/limits；非法正确拒绝 |
| Renderer 映射 | ✅ Col/Row/Card；需 CSS 补偿层 |
| Revision/CAS/幂等 | ⏳ M4-1/M4-3 接入 Host 权威链路 |
| 旧协议 | ✅ 现有根层编辑/渲染/测试不变 |

### 0.2.4 M4-1 实际交付范围（2026-11-05，工作树）

按 gate 结论收窄后实际落地（详见 §0.3）：
1. Renderer：`nestedEditLibrary`（HOC + `Col`/`Row`/`Card` allowlist）、`OpenUIRenderer.nestedBlockSlots`（默认 false）、`display:contents` + `nested-edit.css` 25 条直接子选择器补偿、`nested-css-contract-check`（25/25）与 `nested-edit-renderer` 几何 E2E（41 checks）。
2. Client：`nested.ts` 的 CST→display block 映射（root `bN`、嵌套 `bN.M.K`、nodeId/digest/parent/depth）、编辑工具栏「嵌套区块」opt-in toggle、selection/请求/popover 用嵌套 id、信封携带身份字段。
3. Host：`buildArtifactTree` 校验 + `isNestedEditRequest`/`describeNestedEditProblem`/`composeNestedEditProgram`，all-nested/all-legacy 限制、CST `replaceNode` 回填、根层 targetOrder 保持、`editedBlockIds` root-only。
4. 明确未做：Host 权威 program store / tree 元数据路由（结构提交属 M4-3）、结构操作 UI、duplicate/move、动态 `@Each` 内部编辑、七类容器扩展。

## 0.3 M4-1 验证记录（2026-11-05，已提交 44b1178 / 01265c5）

- Node 测试 **409/409**（Host 184、Client 204、packaging 21；特性文件合计 148：artifact-edit 41、artifact-edit-reconcile 4、local-revisions 3、edit-tabs 3、nested-blocks 4、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 50、host artifact-revisions 17）。
- 浏览器 **9/9** 套件通过：`artifact-edit e2e` **127 checks**（新增嵌套：opt-in toggle、嵌套 display id `b1.1.1`、信封 nodeId/digest/depth）与新建 `nested-edit-renderer e2e` **41 checks**（card/text 0px 漂移、innermost 点击/悬停、overlay union rect、reorder 路径映射、普通渲染不变）。
- renderer：原有 42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4 不变；新增 `nested-css-contract` **25/25**。
- 构建（本机实测）：host `lib/index.js` **774.2 kB**、client `lib/client.js` 3.85 MB（js 3.67 MB + css 177.4 kB）、standalone 3.30 MB + 514.4 kB；`npm run check` exit 0；pack 43 files ≈3.99 MB / 10.24 MB。
- 真机 ego（隔离实例，参考会话新增嵌套卡片）：模型生成「嵌套卡片示例」（Card→Title + Col→两段 Text）；打开编辑 →「嵌套区块」→ 选 `b1.1.1` → 指令「把这段文字改为：嵌套编辑成功。」→ Send；模型调用 `edit_ui_blocks`（带 requestId+artifactId+单块 fragment），Host 记录 **Revision 2**，新卡片显示「嵌套编辑成功。」；对比 program 只有目标 Text 行变化，root/outerCard/未选第二段 Text 逐字节不变。截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m41-nested-card.png`、`real-gui-m41-nested-revision.png`、`harness-m4-nested-edit.png`。
- 限制（必须保留）：嵌套是 opt-in toggle（默认顶层、刷新回顶层、不持久化）；仅 `Col`/`Row`/`Card`；仅内容 replace（无嵌套排序/删除/复制/移动）；`@Each`/opaque/共享引用/ chrome 不可编辑；根层 `targetOrder` 不变；请求必须 all-nested 或 all-legacy（混合拒绝）；`editedBlockIds` 仍为 root id；Host 仍以信封 program 为基础（权威 program store 属 M4-3）；`display:contents` 依赖 25 条 CSS 补偿，需随组件 CSS 维护；真机/真实模型只验证单个嵌套文本替换。

## 0.4 M4-2 验证记录（2026-11-05，已提交 0f3a809 / 8446be0）

- Node 测试 **416/416**（Host 191、Client 204、packaging 21；特性文件合计 155：artifact-edit 41、artifact-edit-reconcile 4、local-revisions 3、edit-tabs 3、nested-blocks 4、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 57、host artifact-revisions 17）。
- 浏览器 **9/9** 套件：`artifact-edit e2e` **136 checks**（新增 nested arrangement：同父重排、重置可用、chip「调整区块顺序」、信封 `orderByParent` 且保留根 `targetOrder`）；`nested-edit-renderer` 41 checks 不变。
- renderer：原有 42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4 不变；`nested-css-contract` **25/25**（扫描 359 selectors）。
- 构建（本机实测）：host `lib/index.js` **781.1 kB**、client `lib/client.js` 3.86 MB（js 3.68 MB + css 179.4 kB）、standalone 3.30 MB + 514.4 kB；`npm run check` exit 0；pack 43 files ≈3.99 MB / 10.26 MB。
- 真机 ego（隔离实例，参考会话嵌套卡片 Revision 2）：打开编辑 →「嵌套区块」→ 把 inner Col 的第二段 Text 上移 → chip 显示「Reorder blocks」→ Send；模型调用 `render_ui` 返回完整 program（带 `editRequestId`），Host 记录 **Revision 3**；新卡片文本顺序变为「Col 里是两段 Text…」在前、「嵌套编辑成功。」在后，无错误。同时验证 stale Revision 1 chip 会被冲突阻断（预期）；成功路径使用最新 Revision 2。截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m42-nested-order.png`。
- 限制（必须保留）：嵌套排序仍是 opt-in 且不持久化；没有画布 live preview（列表只显示目标顺序）；不支持跨容器移动；order-only 仍需一次模型 `render_ui` 回合（不是零模型）；不要对正在排序的 parent 子树同时做内容编辑；Host 仍以信封携带的 program 为基础（权威 program store 属 M4-3）；`editedBlockIds` 在 order-only 时为 `[]`。

## 0.5 M4-3 验证记录（2026-11-05，已提交 f4d296f / 70fae30）

- Node 测试 **431/431**（Host 206、Client 204、packaging 21；特性文件合计 170：artifact-edit 41、artifact-edit-reconcile 4、local-revisions 3、edit-tabs 3、nested-blocks 4、artifact-blocks 8、artifact-edit-batch 7、artifact-block-bundle 11、host artifact-edit 57、host artifact-revisions 17、host artifact-structure 15）。
- 浏览器 **9/9**：`artifact-edit e2e` **143 checks**（新增 structure duplicate 客户端路径：mock 结构路由、请求 body 带 nodeId/sourceDigest/toIndex、结构操作修订本地卡片标签、编辑器关闭）；`nested-edit-renderer` 41 checks；renderer `nested-css-contract` **25/25**。
- 构建（本机实测）：host `lib/index.js` **799.7 kB**、client `lib/client.js` 3.86 MB（js 3.69 MB + css 181.8 kB）、standalone 3.30 MB + 514.4 kB；`npm run check` exit 0；pack 43 files ≈4.00 MB / 10.29 MB。
- 真机 ego（隔离实例，参考会话新建嵌套卡片「结构操作验证」R1：outerCard→Col→alpha/beta）：
  1. 打开编辑 →「嵌套区块」→ 复制 b1.1.1（alpha）→ **无模型回合**；本地卡「结构操作修订」Revision 2，内容 alpha/alpha/beta；registry `dsh-intelligent-ui-programs.json` 出现 initial + struct program，ledger 1 条。
  2. 打开 Revision 2 →「嵌套区块」→ 对复制的 b1.1.2（alpha）两段式确认删除 → Revision 3，内容 alpha/beta；编辑器关闭、无错误。
- 截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m43-structure-duplicate.png`、`real-gui-m43-structure-delete.png`。
- 限制（必须保留）：结构操作 UI 只有 delete/duplicate（Host 有 same-parent move API 但无 UI；跨容器移动未做）；权威 program 注册表只覆盖 M4-3 安装后且仍在 200/50MB LRU 内的 revision——旧卡/被驱逐 base 返回 `base_missing` 需重新渲染，branch 也要求 base 仍在；本地结构修订卡只在 localStorage、只在触发 Turn 渲染（无 assistant 消息/导出/跨设备，丢失提示仍缺）；无 diff 预览/多步 undo；删除不做 helper GC；`Section`/`Toc`/`@Each`/共享表达式由 CST 规则限制；结构操作与内容编辑不能混合为一个动作；结构操作直接 `markSubmitted` 当前草稿（尚无“草稿过期”确认 UI）；`operationId` 幂等与 `toIndex` 语义见 §7.2。

## 0.6 M4-4 第一阶段记录（2026-11-05，已提交 25869cc；M4-4 进行中）

- Node 测试 **437/437**（Host 206、Client 210、packaging 21；特性文件合计 188）。
- 浏览器 **9/9**：`artifact-edit` **149 checks**（新增 Box/Grid/Section/Carousel 可选与信封 Grid 子块 id）；`nested-edit-renderer` **75 checks**（7 类容器 / 18 slots、0px 几何、Carousel 滚动/overlay 命中）。
- renderer：`nested-css-contract` **28/28 direct + 5/5 scoped**；其余 42/42 parse、42/42 render、CSS 50/50、prop 63/63、typography 22/22、i18n 4 不变。
- 构建（本机实测）：host `lib/index.js` **801.9 kB**、client `lib/client.js` 3.87 MB（js 3.69 MB + css 183.2 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.00 MB / 10.30 MB；`npm run check` exit 0。
- 真机 ego（隔离实例，参考会话新建「M44 容器验证」）：Box/Grid/Section 正常渲染；打开编辑 →「嵌套区块」→ 识别 b1.1 Box、b2.1 Grid、b3 Section 及其子块；复制 Grid 子块 b2.1.1 → 结构路由本地卡 **Revision 2**，Grid 内容变为 grid one/grid one/grid two，无错误。截图（gitignored）：`.tmp-report/real-gui-m44-containers.png`。
- 已完成：共享容器白名单 `artifact-containers.ts`（7 类容器，单一来源）、`program-cst` 容器 children 参数映射（Section 第 2 参数）、renderer 自动覆盖 + CSS 补偿 28 direct/5 scoped、`insertNode` 与跨容器 `moveNode` 引擎基础（18 engine tests）、Carousel 几何/overlay 验证。
- 当时未完成、现已由 §0.7/§0.8 完成：模型新增区块（§0.7 additions 全链路）、跨容器 move UI（§0.7）、结构 diff/确认（§0.8）；其余（Carousel 离屏 anchor 裁剪、权威恢复/旧卡提示）仍为已知限制。

## 0.7 M4-4 完成记录（2026-11-05，已提交 125b6ad）

- Node 测试 **449/449**（Host 218、Client 210、packaging 21；特性文件合计 200：host artifact-edit 64、host artifact-structure 20、host artifact-revisions 17、client 99）。
- 浏览器 **9/9**：`artifact-edit` **164 checks**（新增 additions 表单/行/移除与信封 additions，move 菜单候选与跨容器结构请求）；`nested-edit-renderer` 75；renderer `nested-css-contract` **28/28 direct + 5/5 scoped**。
- 构建（本机实测）：host `lib/index.js` **808.3 kB**、client `lib/client.js` 3.88 MB（js 3.70 MB + css 187.1 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.32 MB；`npm run check` exit 0。
- 真机 ego（隔离实例，参考会话「M44 容器验证」R2）：
  1. 打开编辑 →「嵌套区块」→ 在 Box 的组「添加区块」，指令「在 Box 末尾新增一段 Text，内容写 Added block」→ Send；模型调用 `edit_ui_blocks`，**Revision 3** 在 Box 之后新增 Added block，无错误。
  2. 打开 Revision 3 →「嵌套区块」→ 对 Added block 执行「移动到… Grid 容器」→ **无模型回合**，本地结构修订卡 **Revision 4**，Added block 移入 Grid，无错误。
- 截图（gitignored，未加入 docs assets）：`.tmp-report/real-gui-m44b-add-block.png`、`.tmp-report/real-gui-m44b-move-block.png`。
- 已完成：7 类容器（`artifact-containers.ts` 单一来源）、Section children 参数映射、renderer 自动覆盖、CSS 补偿 28+5、`insertNode`/跨容器 `moveNode` 引擎基础；additions 全链路（schema/header/Host 校验/`insertNode`/结果 meta/客户端表单/序列化）；跨容器 move 结构操作（`toParentNodeId`、目标校验、追加位置、原子批量、source+target root ids）；客户端「移动到…」菜单与结构错误内联提示。
- 限制：`additions` 与 `orderByParent` 不能同请求；root 不能作为跨容器移动目标；Carousel 离屏 item 的 overlay anchor 需与 track 相交裁剪（未做）；无结构 diff/预览/多步 undo；delete 不做 helper GC；跨容器移动只支持追加到末尾；每个容器 v1 一个 addition；`base_missing` 只有内联错误提示，无旧卡自动恢复/丢失内容提示；本地结构修订卡只在 localStorage/触发 Turn，无消息/导出/跨设备；additions 依赖模型遵循 fragment 顺序，失败保留 pending 可重试。**M4-4 已完成；下一步 M4-5 收口（a11y、视觉回归、真实模型 E2E、文档、性能）与 B2-5。**

## 0.8 M4-5 收口 + B2-5 结构 diff 预览记录（2026-11-05，已提交 3970d33）

- Node 测试 **456/456**（Host 223、Client 212、packaging 21；特性文件合计 207：host artifact-edit 64、host artifact-structure 25、host artifact-revisions 17、client 101）。
- 浏览器 **9/9**：`artifact-edit` **170 checks**（新增 preview dry-run→200、confirm→apply、模态 `aria-modal`/初始焦点 Cancel、diff add 行、move 的 preview→apply 两段请求）；`nested-edit-renderer` 75；renderer `nested-css-contract` **28/28 direct + 5/5 scoped**。
- 构建（本机实测）：host `lib/index.js` **808.8 kB**、client `lib/client.js` 3.89 MB（js 3.71 MB + css 191.1 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.35 MB（本机实测）；`npm run check` exit 0。
- 真机 ego（隔离实例，参考会话「M44 容器验证」R4）：打开编辑 →「嵌套区块」→ 复制 Box 组 → 模态 diff 显示 `boxCard ... + boxGroup_copy1` 等 add/remove/same 行、summary 为 1 个顶层区块 → 确认 → 本地结构修订卡 **Revision 5**（Box 内容重复为 box one/box two 两次），无错误。截图（gitignored）：`.tmp-report/real-gui-m45-preview-confirm.png`。
- 已完成：Host dry-run preview（同 apply 校验/原子操作/最终校验，不写 revision/registry/ledger；200 preview 响应、touched ≤120、changedBlockIds 同口径、错误一致、同 operationId 后续 apply 只记一次 revision）；客户端 preview 状态/actions/LCS diff（>400 行降级）/confirm 才 apply；preview→模态确认（duplicate/delete/move）、`aria-modal`/初始焦点 Cancel/focus trap/Esc/backdrop/焦点返回/disabled/reduced-motion；保留旧直接 apply fallback；性能 smoke（7 卡片/49 区块/57 nodes <2s；insertNode+reorder <2s）；视觉守卫仍为几何/排版 E2E（无像素基线）。
- 限制：无像素级视觉快照基线、无完整 screen-reader/axe 审计；preview loading 无客户端超时（依赖 fetch 失败）；模态背景用遮罩阻止指针但未设 `inert`/`aria-hidden`；**B2-5 的「未选区块内容严格模式（warning→strict）」未做**；既有 M4 限制全部不变（Carousel 离屏 anchor、跨容器 append-only/root target、additions 与 orderByParent 分开发送、每容器 1 addition、无多步 undo/GC、base_missing 仅 inline、本地结构卡限制）。M4-5 完成，B2-5 仍为部分完成。

## 0.9 B2-5 严格保护记录（2026-11-05，已提交 54fb145；B2-5 完成）

- Node 测试 **461/461**（Host 236、Client 212、packaging 21；特性文件合计 212：host artifact-edit 69、host artifact-structure 25、host artifact-revisions 17、client 101）。
- 浏览器 **9/9**：`artifact-edit` **173 checks**（新增 strict toggle 默认关、信封 `"strict":true` + strict 指令）；`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` **809.1 kB**、client `lib/client.js` 3.90 MB（js 3.71 MB + css 191.6 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.35 MB（本机实测）；`npm run check` exit 0。
- 实现：shared `ArtifactEditRequest.strict?: boolean`（header 投影、strict prose）；客户端工具栏「严格保护 / Strict protection」toggle（`data-dsh-iui-edit-strict`、`aria-pressed`、默认关、submitted/error disabled）、store `setStrictMode` 与 serialize；Host 在保留警告之后、record revision/consume pending 之前检查 strict，未选顶层块改动 → 模型可读错误（`render_ui:`/`edit_ui_blocks:` 前缀、≤3 条 label 摘要、无源码），pending 保留、无 revision/registry/ledger，可用同一请求重试；比较基于 content stage（重排前），合法排序不误报。
- Host strict 测试 5 条：nested strict 成功、full render 改未选 → strict 错误且无 revision + 同 pending 修正后成功、非 strict 对照记录 warning、order-only 不误报、多块摘要无源码泄露。
- 范围与限制：只覆盖**识别到的顶层未选区块**（statement name→title+type→unique title、digest，排除 selected/edited ids）；**不检测选中的根区块内部、未被选中的嵌套子节点改动**；`edit_ui_blocks` fragment 合成本身不能改未选顶层块，完整 `render_ui`（`edits: []`）覆盖全部顶层块；`strictOff` 文案当前未使用；严格拒绝路径只有 Host 单测覆盖，**未做真机验证**。
- 状态：B2-5 完成（结构 diff 预览 §0.8 + 严格保护 §0.9）；下一步 B2-6（运行态部分保留）与 B1 收口（a11y/视觉回归/真机/发布）。

## 0.10 B2-6 运行时状态部分保留记录（2026-11-05，已提交 86b436f；B2-6 完成）

- Node 测试 **474/474**（Host 236、Client 225、packaging 21；特性文件合计 225：host artifact-edit 69、host artifact-structure 25、host artifact-revisions 17、client 114）。
- 浏览器 **9/9**：`artifact-edit` **175 checks**（新增 B2-6 场景：DST 卡片点选「夏令时」→ 应用修订生成新卡 → 新卡继承 `$state` 与选中项）；`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` **809.1 kB**、client `lib/client.js` 3.90 MB（js 3.71 MB + css 191.6 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.36 MB（本机实测）；`npm run check` exit 0。
- 实现：`OpenUIRenderer` 新增可选 `runtimeState`/`onRuntimeStateChange`（仅传入时转发 `initialState`/`onStateUpdate`，无 prop 行为不变）；新 `src/client/runtime-state.ts` 按 artifactId 保存 revision-scoped 快照 + latest，`recordRuntimeState` 深拷贝 plain JSON（≤64KiB，非法/循环/超大忽略，revisionId 缺失用 callId），`runtimeStateForProgram` 首渲染 undefined、修订优先 baseRevisionId 快照、缺失回退 latest、返回克隆；容量 24 artifacts LRU / 每 artifact 5 revisions（latest 保留）；仅会话内存、不持久化；`IntelligentUICards` 恢复+记录，`ArtifactEditView` 传冻结 base 快照且不写回（编辑画布冻结）；提供 clear/reset helpers。
- runtime-state 单测 13 条：首渲染 undefined、同修订、base 继承、latest fallback、克隆隔离、非法/超大忽略、callId fallback、容量/淘汰、clear/reset。
- 真机 ego（隔离实例，参考会话最新 DST Revision 7）：点选「夏令时」→ 编辑 b2 → Send → **Revision 8**；新卡仍选中「夏令时」并显示 summer clockNote，无错误。截图（gitignored）：`.tmp-report/real-gui-b26-state.png`。
- 限制：快照只在浏览器会话内存，**刷新丢失**；容量 24 artifacts / 5 revisions / 64KiB；**首渲染不继承**；继承要求新修订带 `baseRevisionId`（缺失仅 latest fallback）；第三方组件内部状态与编辑画布内交互值不保留。B2-6 完成；下一步 B1/B2 其余收口（B1-5 a11y、B2-8/9/10 真机/视觉）与发布。

## 0.11 B1-5 编辑画布 a11y 记录（2026-11-05，工作树，未提交；B1-5 完成）

- Node 测试 **474/474** 不变（Host 236、Client 225、packaging 21；特性 225；本轮无新增 Node 测试）。
- 浏览器 **9/9**：`artifact-edit` **180 checks**（新增 live region 嵌套重排/添加播报、grip `aria-describedby`、移动菜单首焦点与 ArrowDown 焦点变化）；`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` 809.1 kB、client `lib/client.js` 3.90 MB（js 3.71 MB + css **192.1** kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.36 MB（本机实测）；`npm run check` exit 0。
- 实现：单一 visually-hidden live region（polite/atomic，清空+下一帧+sequence guard）；播报根/嵌套重排、addition 保存/移除、move 选择、preview 开关；隐藏拖拽/菜单 hint 与 `aria-describedby`；移动菜单首焦点/方向键循环/Home/End/Enter/Escape+焦点返回/Tab 关闭；添加表单 aria、嵌套组 `role=group`、`:focus-visible` 焦点环。
- 临时 Chrome harness 121 checks 覆盖 live region 语义、hint/describedby、group 语义、根/嵌套键盘播报、添加表单 aria、菜单键盘/焦点、空菜单容器焦点、preview 播报。
- 限制：polite 单槽合并快速重排播报；pointer 仅 drop 播报；Tab 关闭菜单不强制回焦（Escape 会）；隐藏 hint 仍在可访问性树；无真机 screen-reader/axe 审计；无像素基线（B2-10 未做）。B1-5 完成；下一步 B2-8/9/10 真机与视觉基线、发布。

## 0.12 B2-8/B2-9/B2-10 真机验证与视觉基线记录（2026-11-05，已提交 d6ec446；三项完成，B2-10 为手动基线）

- 计数不变：Node **474/474**（Host 236、Client 225、packaging 21；特性 225）；浏览器 **9/9**；`artifact-edit` **180 checks**、`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` 809.1 kB、client `lib/client.js` 3.90 MB（js 3.71 MB + css 192.1 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.36 MB（视觉基线目录不进包）。
- B2-8 Article 真机：`render_ui` `style=article` → article 卡片生效；根层 3 区块键盘重排（b1/b2 交换）+ b2 指令 → Send → **Revision 2** 仍 article、顺序/内容更新、无错误。截图 `.tmp-report/b28-article-card.png`、`.tmp-report/b28-article-edit.png`（gitignored）。
- B2-8 free 真机：普通 `render_ui` 只接受 card/article；经 On-demand UI（Composer UI 菜单选 On-demand UI；模型 `style=free` + `temporaryStyle`）生成「B28 Free2 验证」临时样式自由版式卡（Temporary style，Row 两栏）；编辑（1 个根区块，无重排）+ 指令 → **Revision 2** 仍 temporary/free、内容更新、无错误。**限制：free 不能通过普通 render_ui 强制，必须 On-demand UI/授权 free 模板；本会话普通 render_ui 传 free 被 Host 拒绝。** 截图 `.tmp-report/b28-free-card.png`、`.tmp-report/b28-free-edit.png`（gitignored）。
- B2-9 窄屏/移动端真机：CDP 390×844 @2x mobile，文档无横向溢出（scrollWidth ≤ innerWidth+1），卡片重排（Row 两栏堆叠），点 Edit 出现 `[data-dsh-iui-edit-narrow-notice]` 不进入编辑画布；900×1000 @2x 编辑画布打开、无横向溢出、编排行可见。截图 `.tmp-report/b29-narrow-390.png`、`.tmp-report/b29-wide-900-editor.png`（gitignored）。
- B2-10 视觉基线：新增 `test/browser/visual-baselines/`（`article-card-1440.png`、`free-card-1440.png`、`editor-article-1440.png`、`preview-modal-1440.png`、`narrow-390-viewport.png` + `captures.json` + `SHA256SUMS` + README）；环境 macOS/Chrome 156/2×/light，记录浏览器/视口/时间/方法；**手动视觉基线，无自动像素 diff**；现有浏览器套件继续守卫几何/排版；基线目录不进 npm 包。
- 状态：B2-8/B2-9/B2-10 完成（B2-10 手动基线）；下一步发布（B1-7：版本/CHANGELOG/打包安装验证）。

## 0.13 用户反馈修复记录：去除展开按钮 + 编辑时自动收窄聊天宽度（2026-11-05，已提交 d6d2f50）

- Node 测试 **483/483**（Host 236、Client 234、packaging 21；特性文件合计 234：host artifact-edit 69、host artifact-structure 25、host artifact-revisions 17、client 123，其中新增 `panel-width` 9 条）。
- 浏览器 **9/9**：`artifact-edit` **183 checks**（新增自动宽度拟合/恢复与 expand 按钮不存在检查）；`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` 809.1 kB、client `lib/client.js` 3.90 MB（js 3.71 MB + css 191.8 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.01 MB / 10.36 MB；`npm run check` exit 0。
- 修复：编辑面板 header 删除展开/收起按钮（glyph/state/expanded class/locale 文案一并删除），仅保留 title + spacer + 窄屏 close；新增 `src/client/artifact-edit/panel-width.ts`（`fitChatContentWidth` 固定点公式 + `applyEditChatContentWidth` DOM 覆盖/恢复），`EditPanel` 单 useEffect 挂载/卸载执行；进入编辑自动收窄主聊天内容宽度（内容右缘距面板左缘 24px），退出恢复用户原宽度，不修改 shell 偏好。
- 真机 ego（1800×1000，用户手动把 chat content 设为 1600px）：打开编辑后 inline `--dsh-chat-content-width` → **1032px**，expand 按钮数量 0，无横向溢出；退出恢复 **1600px**。截图（gitignored）：`.tmp-report/fix-width-editing.png`、`.tmp-report/fix-width-restored.png`。
- 限制：base width 在面板挂载时捕获一次（编辑中拖动 shell 手柄不会即时跟随，但关闭恢复原 inline/偏好）；仅 ≥1180px docked 模式生效；未来 shell 变量位置变更需更新集中式 selector 常量；面板 CSS clamp 仍以 748 为 fallback。
- 状态：用户反馈修复完成；下一步发布（B1-7）。

## 0.14 第二轮用户反馈修复记录：column-aware 动态宽度适配（2026-11-05，已提交 df01c6b）

- Node 测试 **484/484**（Host 236、Client 235、packaging 21；特性文件 235：host artifact-edit 69、host artifact-structure 25、host artifact-revisions 17、client 124，其中 `panel-width` 10 条，新增 column-aware 1 条）。
- 浏览器 **9/9**：`artifact-edit` **186 checks**（新增动态宽度跟随/恢复与 no-expand 检查）；`nested-edit-renderer` 75；renderer `nested-css-contract` 28/28 + 5/5。
- 构建（本机实测）：host `lib/index.js` 809.1 kB、client `lib/client.js` 3.90 MB（js 3.71 MB + css 191.8 kB）、standalone 3.30 MB + 516.3 kB；pack 43 files ≈4.02 MB / 10.36 MB；`npm run check` exit 0。
- 根因：第一版按 viewport 中心计算，忽略 sidebar/聊天列；CSS 自定义属性 computed 值可能是 `clamp(...)` token，`parseFloat` 失败退回 748 与实际宽度不符。
- 修复：`fitChatContentWidth` 增加 `columnLeft`/`columnWidth`（`panelLeft = viewport - panelWidth`、`maxContent = 2 * (panelLeft - gap - columnLeft) - columnWidth`，固定点 ≤8 轮；默认 columnLeft=0 保持旧结果）；内容宽度改用隐藏 probe 实测 `--dsh-chat-content-width`；用户偏好读父元素 `--dsh-chat-user-width`；`MutationObserver` 观察父/自身 style 以跟随编辑中的 shell 宽度拖动（`writing` 标志避免反馈循环）；resize/断点/卸载恢复逻辑不变。
- 真机 ego（最新隔离构建，1800×1000，sidebar 280 / 聊天列 left=280 width=1520）：打开编辑后 inline 内容宽度 **752px**；聊天卡片右缘 1412.5、Exit editing 按钮右缘 1382.5，面板左缘 1440 → **按钮可见、无遮挡**；编辑中把用户宽度偏好设为 1600 仍保持 752 不重叠；退出后 inline 覆盖移除、父元素偏好保留 1600。截图（gitignored）：`.tmp-report/dynamic-width2-editing.png`。
- **部署事实**：用户主 GUI（3080）当时加载的是旧 client bundle；client 插件改动必须**重启 `dsh-web`** 才会生效，页面刷新不够。文档/行为不一致时先确认服务已重启，而不是代码未更新。
- 限制：仅 ≥1180px docked；面板 CSS clamp 仍以 748 为 fallback；shell 未来迁移变量/属性位置需更新集中式常量。
- 状态：第二轮修复完成；下一步发布（B1-7）。

## 1. 目标与非目标

目标：
- 允许选择/编辑/排序**容器内部**的区块（不再只限根 `Col` 直接子节点）。
- 允许对区块做**删除、复制（duplicate）、跨/同容器移动**，并把结果记录为新 Revision。
- 保持现有保证：未选区块源码逐字节不变；Host 确定性执行结构操作；版本/冲突/分支/本地卡片/草稿/租约语义不回归。
- 给模型与客户端一个可校验、可回放的结构协议，而不是让模型自由重写整页。

非目标（M4 不做）：
- 任意组件内部文本级编辑（如编辑 Table 单元格、Chart 数据点）；仍以“区块”为单位。
- 通用页面编辑器/拖拽画布布局（自由坐标、栅格设计器）。
- 多用户协作/CRDT。
- 跨 Artifact 的批量结构操作。

## 2. 当前基线（M3 完成）

- 区块 = 根 `Col` 的直接子节点；`blockId` 为按顺序的 `b1..bN`，`nodePath` 形如 `root[2]`。
- 编辑画布通过 `wrapProgramForBlockEditing` 把每个根子节点包进内部 `BlockSlot`（`display:contents` 的 wrapper + 覆盖层、编号、选中态）。
- `targetOrder` 是根区块 id 的完整排列；Host 用 `reorderProgramToTargetOrder` 确定性重排。
- 内容编辑：客户端把选中区块源码与指令放进 envelope；模型调用 `edit_ui_blocks` 返回迷你程序 `root = Col([...])`；Host 用 `spliceBlockBundle` 只替换选中槽位，未选语句逐字节保留。
- Revision 注册表（线性 latest）、分支编辑、零模型恢复/本地修订卡片、草稿持久化、跨标签软租约、临时样式内容编辑均已落地。

关键限制：以上全部假设“根层、同集合置换”。M4 要打破这两个假设。

## 3. 设计总览

M4 拆成三条能力，按依赖顺序实施：

1. **嵌套区块模型 + 渲染器包装**（身份、选择、内容编辑）。
2. **层级编排**（同容器内排序；跨容器移动先作为结构操作，不作为 v1 拖拽）。
3. **结构操作**（删除、复制、移动、后续的新增），用**零模型 Host 路由 + 本地修订卡片**执行，与内容编辑分开发送。

```text
M4-1 身份/嵌套渲染/嵌套内容编辑
        │
        ├── M4-2 层级排序（同 parent）
        │
        └── M4-3 结构操作（delete / duplicate / move，零模型）
                      │
                      └── M4-4 新增区块（模型生成）与跨容器 drag、diff 预览
```

## 4. 区块身份与嵌套模型

### 4.1 路径与 id

建议：

- 保留顶层 `blockId = b<N>` 仅作为旧协议兼容标签。
- **新身份**：每个基础修订提取时分配 revision-scoped `nodeId`（确定性、不依赖展示顺序），并记录该节点源码范围的 digest；编辑请求、选区、结构操作都以 `baseRevisionId + nodeId + digest` 引用。`b3.2` 这类位置标签只用于展示/调试，跨结构操作后不保证稳定。
- 结构操作产生新 Revision 后重新提取 nodeId；基于旧 Revision 的内容草稿标记过期，不自动套用。
- 每个区块记录：
  ```ts
  interface ArtifactBlockNode {
    blockId: string            // 'b3' | 'b3.2' | 'b3.2.1'
    parentBlockId?: string     // absent for root children
    depth: number              // 0 = root child
    nodePath: string           // 'root[2]/children[1]'
    componentType: string
    kind: ArtifactBlockKind
    title?: string
    statementId?: string
    childIndex: number         // index among the parent's direct children (raw AST index)
    editableChildren: boolean  // whether this node's children are offered
  }
  ```
- `originalOrder` 改为按父容器分组的 map：`Record<parentKey, childBlockId[]>`（root 用 `'root'`）。
- 选择、编号、颜色仍全局唯一（按 DFS 顺序编号）；父容器本身是否可选见决策 1。

### 4.2 可编辑容器与选择条件

- 可下钻容器（M4-4 已实现）：`Col`、`Row`、`Box`、`Grid`、`Card`、`Section`、`Carousel`（`Popover` 不展开）；单一来源 `src/shared/artifact-containers.ts`，Section 的 children 是第 2 个参数。
- chrome（`Caption/Divider/Spacer/Toc/Title`）在任何层级都不作为区块。
- 叶子组件（Text/Table/Chart/Button…）是区块终点；不再向下拆内部节点。
- 限制：深度 ≤ 4、单页区块总数 ≤ 60、单容器直接子区块 ≤ 30（数值待定，见 §10）。

### 4.3 嵌套内容编辑如何切片/回填

- 请求里的编辑目标由 `blockId` + `nodePath` + `parentPath` 描述；模型仍只返回被选区块的表达式（可能跨不同容器）。
- `spliceBlockBundle` 扩展为按路径替换：
  - 根层槽位：与现在一致；
  - 嵌套槽位：在父容器的源码表达式内定位第 N 个 children 参数并替换；
  - 父容器可能是内联表达式（未被命名），因此需要 source-level 的“父表达式切片”，而不是只依赖顶级语句。
- 若选中的父容器本身在被替换范围内（父子同时选中），按“父优先、子级映射到新父表达式内”的规则拒绝或合并；v1 建议**禁止同一请求同时选择父子链**（UI 与 Host 双重校验）。
- 依赖闭包：嵌套区块可能引用父容器局部 `@Each` 变量或全局语句；切片/回填沿用现有冻结依赖模型，跨层变量需在 bundle 中声明为不可重定义。

## 5. 渲染器与编辑画布

### 5.1 方案选择

| 方案 | 做法 | 风险 | 结论 |
| --- | --- | --- | --- |
| A. 容器组件递归包装 | 编辑模式 library 中，容器组件把每个 child AST 通过共享 `renderBlockChildren` 渲染成 `BlockSlot`（带父路径 context） | 需要审计/修改所有容器组件；wrapper 影响布局 | **推荐** |
| B. 源码级递归改写 | 在程序源码上递归插入 BlockSlot 包装 | 无 AST printer，源码重写不可靠 | 不推荐 |
| C. DOM 覆盖映射 | 不包装 AST，用 DOM 查询近似映射 | 身份不稳定、无法与请求 blockId 可靠对应 | 不推荐 |

### 5.2 推荐方案细节

- **前置 spike（M4-0）**：不先改七类容器。先验证 runtime 包装/几何映射，确认 `renderNode` 子节点契约、React key、布局盒与事件传播；不通过就改用独立 overlay 层 + capability 适配器。
- 新增 `BlockPathContext`（父 nodeId + parent nodePath）；根 `BlockSlot` 渲染 children 时为其直接子节点提供子路径。
- 在编辑 library 中，仅对 capability 审核通过的容器使用 helper 渲染 children：
  ```tsx
  const rendered = renderBlockChildren({ props, renderNode, parent: props.blockId })
  ```
  该 helper 对每个 child 生成 `BlockSlot(blockId=<parent>.<i>, blockIndex=<i>, children=<child AST>)`；叶子/未知容器直接 `renderNode(child)`。
- `BlockSlot` wrapper 改为 `display: contents` 外层 + 覆盖层；嵌套 wrapper 的 overlay 使用相对定位容器，点击时最深层 overlay 优先捕获。
- 需要修改的容组件清单先做审计（预计 Col/Row/Box/Grid/Card/Section/Carousel 7 个；其他组件可后续按需加入）。新增/未支持容器的 children 仍可选择其父容器，不展开。
- 非编辑渲染（普通卡片、导出、standalone）不引入 wrapper，行为不变。

### 5.3 编辑器交互

- 点击嵌套区块选中；编号与颜色全局；请求列表增加面包屑（如 `一句话版本 › 列表项 2`）。
- 父容器 hover 时显示“容器”轮廓，点击容器空白处选择容器本身（若决策 1 允许），点击子区块选择子区块。
- 富交互组件在编辑模式仍冻结（覆盖层），与 M1 行为一致。

## 6. 层级编排

### 6.1 排序表示（M4-2 已实现，简化为单 slot）

- 实际落地为 `ArtifactEditRequest.orderByParent?: Record<'root' | CST nodeId, readonly nodeId[]>`：parent → 该容器 `children` slot 可编辑子节点的完整 nodeId 排列；只发变化的组；不做 `slotKey` 多 slot 泛化（M4-2 只处理默认 `children`）。
- 只允许**同一父容器内**排序；跨容器移动不通过拖拽表达，而是结构操作 `move`（`program-cst` 已支持跨容器 `moveNode`，但 M4-4 尚无 UI）；v1 拖拽限制在同一容器内，跨组拖动被拒绝。

### 6.2 Host 确定性重排（M4-2 已实现）

- 实际实现：`applyOrderByParent(program, request)` 用 `reorderChildren` **最深优先**重排并在每个 parent 后重建树；未列入 `orderByParent` 的容器不改变；未知/重复/非完整排列/跨父/chrome/@Each/共享表达式/opaque 均拒绝且可重试。
- 根层：`orderByParent.root` 存在时由它拥有根顺序（跳过 legacy `targetOrder`）；否则先应用嵌套排序，再走现有根层 `targetOrder` 确定性重排。order-only 请求（`edits: []`）记录 normalized program 到 revision 并返回 meta；`editedBlockIds` order-only 为 `[]`。

## 7. 结构操作（删除 / 复制 / 移动 / 新增）

### 7.1 操作集合（v1）

```ts
type ArtifactStructureOperation =
  | { op: 'delete'; blockId: string }
  | { op: 'duplicate'; blockId: string; toParentId: string; toIndex: number; name?: string }
  | { op: 'move'; blockId: string; toParentId: string; toIndex: number }
```
- `delete`：删除该表达式；若被删区块是浏览器唯一引用某命名 helper 的来源，暂不自动删除 helper（保留为孤儿声明，不渲染、无副作用）；后续可加 GC。
- `duplicate`：复制表达式；若原区块是命名语句，新语句名 `name_copyN`（Host 生成、冲突重试）；若为内联表达式，直接复制。内部引用的共享 helper 仍共享；若副本内部有内联标识（如 Section id、Toc anchor）需要重写规则，v1 先禁止复制含 `Section/Toc` 的子树或在复制时加后缀（见风险）。
- `move`：从原父容器移除并插入目标父容器指定位置；跨容器 v1 允许（结构与内容分离，Host 确定性）。
- 限制：一次最多 20 个操作；不允许删除根容器；不允许移动根 `Col` 自身。
- **合法性矩阵**（实现前必须定义）：源节点类型 × 目标容器 × 目标 slot × 作用域变化 × 资源标识；无法证明合法的组合默认拒绝。
- **引用/符号校验**：symbol table + 引用图；Duplicate 处理命名声明/Section anchor/Toc/表单/动作实例标识；Delete 检查引用者；Move 拒绝移到自身后代/不兼容 slot/破坏 @Each 词法作用域。
- **实施门槛**：Delete 先实现，Duplicate 次之，同父 Move 再次，跨容器 Move 最后；每一步都要通过 CST 重解析 + 引用校验 + 幂等/CAS 测试。
- **幂等**：结构请求带 `operationId`；重复提交返回已提交 Revision，不重复创建。
- **分支与临时样式**：结构请求支持显式 `branch`（旧 base 分支）和 `temporaryStyle` 快照；记录的新 Revision 继承样式快照；分支/CAS 规则与内容编辑一致，不允许静默落到主线。
- **过期草稿**：结构操作创建新 Revision 后，基于旧 Revision 的内容编辑草稿标记为过期并保留（提示用户重新基于新修订编辑），不自动映射。

### 7.2 零模型执行路径（推荐）

- 新认证路由 `POST /api/intelligent-ui/artifact-structure`（与 restore 同 auth/effect/dispose）：
  - **base program 必须来自 Host 权威记录**（M4-0 增加有界 revision program store/读取接口）；客户端只提供 `baseRevisionId + nodeId/digest + operations + operationId`，不信任客户端附带的完整程序；
  - Host 校验 revision 血缘/分支/CAS、节点身份与 digest、operation 合法性、深度/大小/复杂度预算；按顺序应用到权威 base program，重新解析并校验 root Col、引用图与区块限制；
  - 记录新 Revision（latest+1；branch 语义复用），返回完整 `program` + meta；
  - 响应 201；错误 `{error:{code,message}}`：400 invalid_input/invalid_operation/program_invalid/revision_limit、404 base_missing、409 conflict/already_latest?（结构操作总是允许基于 latest）等。
- 客户端把返回结果插为**本地修订卡片**（复用 M3-2 `local-revisions` 机制，扩展 `kind:'structure'`），显示新 Revision；不调用模型、不产生 assistant 消息。Host 的 Revision（含程序读取接口）是权威存储；localStorage 仅是缓存，丢失时可从 Host 重新获取。
- 为什么零模型：删除/复制/移动是确定性操作，让模型重写页面既慢又可能破坏未选区块；与 owner 已选“恢复零模型”一致。
- 卡片来源：沿用本地卡片；导出/回放限制与本地恢复卡片相同（明确文档）。

### 7.3 与内容编辑的关系

- **v1 规则：结构操作与内容编辑不在同一次发送中混合**。
  - 原因：结构变化后 blockId/路径会变，内容片段映射复杂；失败隔离与模型上下文也更清晰。
  - UI：编辑模式两个动作入口——“发送内容修改”走 Composer chip/模型；“应用结构操作”走本地结构路由（即时生效）。用户可先结构后内容，或反之。
- 内容编辑在嵌套结构上仍可用（§4.3）；结构操作会生成新 Revision，后续内容编辑基于该 revision。

### 7.4 新增区块（M4-4 已实现）

- v1 有两种新增方式：复制现有区块（M4-3 duplicate，零模型）与**模型生成新块**（M4-4 additions）。客户端在嵌套组头「添加区块」，请求带 `additions:[{parentBlockId,parentNodeId,index,instruction}]`（每请求最多 4，v1 UI 每容器 1 个）；模型调用一次 `edit_ui_blocks`，mini program root children 顺序为 edits（selectionOrder 升序）→ additions（请求顺序），Host 校验后用 `insertNode` 插入并记录 Revision；失败保留 pending 可重试。
- `additions` 与 `orderByParent` 不能放在同一请求；root 不作为跨容器目标；结构 diff/确认与新增区块的撤销仍属后续。

## 8. 客户端数据/状态改造

- `ArtifactEditSession`：
  - blocks 变为树/扁平列表 + parent/depth；
  - `originalOrder`/`targetOrder` 变为 `byParent`（保留旧字段做迁移期兼容）；
  - selection 增加 `parentBlockId`、`depth`、`path`；颜色/编号仍全局。
- 草稿持久化 payload 升级（v2）：
  - 旧 v1 草稿继续可读（top-level 映射到 `root`）；新草稿写 v2；损坏草稿隔离保存（不删除原始 payload），展示可恢复/导出提示，禁止静默丢稿。
- 分支/本地卡片/租约/对账沿用：结构操作产生的本地卡片不是 submitted 草稿，不参与 reconciliation。
- UI：
  - 编排区改为树：缩进 + 展开/收起 + 父容器行；拖拽仅同父；行菜单“移动到…”；选中区块工具栏：删除、复制、上移/下移（同父）。
  - 请求列表面包屑；popover 显示嵌套位置。
  - 面板高度/滚动与窄屏限制保持。
- 撤销：v1 只保留最近一次结构操作的本地 undo；Undo 是**显式 revert 结构操作**（带 operationId/CAS/冲突检查），不是重放历史操作；多步 undo 后续。

## 9. Host 校验与兼容

- `extractArtifactBlocks` 扩展为递归树；旧函数返回顶层的兼容视图（`blocks` 仍是顶层），新增 `tree`/`allBlocks`。
- `wrapProgramForBlockEditing` 保留根层行为；新增编辑 library 的容器 helper；旧客户端/旧程序不受影响。
- 请求兼容：
  - 旧 envelope 的 `targetOrder` 是根数组 → 内部映射为 `byParent.root`；
  - 新 envelope 增加 `orderByParent` 与 `structure` 字段（版本化）；schemaVersion 升到 2，Host 同时接受 v1/v2；
  - revision meta 的 `editedBlockIds` 允许带点号嵌套 id（旧消费者按不透明字符串处理）。
- 本地卡片类型增加 `kind: 'restore' | 'structure'`、`source` 说明；文档区分。
- 既有保证不变：Host 是最终权威；未选区块源码不变（结构操作按显式操作集合变更）；revision 不可变。

## 10. 限制（初值）

| 项目 | v1 限制 |
| --- | --- |
| 嵌套深度 | ≤4 |
| 可编辑区块总数 | ≤60 |
| 单容器直接子区块 | ≤30 |
| 单次结构操作数 | ≤20 |
| 单次结构请求 program | ≤200k 字符（沿用） |
| 禁止 | 父子同时选中；源码范围重叠/共享命名引用多选编辑；删除/移动根；跨 Artifact 操作 |
| 运行时 | 除静态节点外，另限 @Each 展开实例数、overlay 数、单次变换执行时间/复杂度预算 |
| 复制含 Section/Toc | v1 先禁止或做 anchor 重写（见决策） |
| 嵌套内容编辑 | 每请求仍 ≤12 条指令；单条 2000 字 |

## 11. 评审决策点（产品方向已确认；§0.1 收窄项待确认）

GPT 评审后新增/收窄、需 owner 确认：
1. **容器范围**：M4 不再承诺七类容器一次性开放，改为 capability 适配器 + 逐步扩展（M4-0 只验证 Col/Card）。
2. **跨容器 Move**：保留入口但只允许 Host 能证明合法的目标（同 slot/作用域兼容）；不承诺任意组件到任意容器。
3. **结构操作权威存储**：M4 必须实现 Host 端的 revision program 读取/恢复（本地卡片降级为缓存），这会增加 Host 存储与接口工作。
4. **正确性校验前置**：CST/作用域/引用/slot/CAS/幂等校验必须进入 M4 底座；只有可视化 diff/人工确认可延期。
5. **首阶段 gate**：同意先用 M4-0 结构引擎 spike（不接 UI/模型）作为开工前置。

## 11.1 原产品决策（已确认，见 §0）

1. **可选节点范围**：所有“可下钻容器”的子节点都可选（推荐，深度 ≤4），还是只允许有标题/命名的结构化区块？
2. **跨容器移动**：v1 允许通过“移动到…”结构操作（推荐），还是先只允许同父容器排序、跨容器留到 M4-4？
3. **新增区块**：v1 仅支持复制现有区块（推荐），还是同时做模型生成空白区块（需要新协议）？
4. **结构操作执行方式**：零模型 Host 路由 + 本地修订卡片（推荐，复用 M3-2），还是必须走一次模型回合？结构操作与内容编辑是否允许同一次发送混合（v1 建议不混合）？
5. **范围**：M4 是否包含 B2-5（严格校验 + diff 预览）与 B2-6（运行态部分保留）？建议 M4-1..M4-3 先做核心嵌套/结构，B2-5/B2-6 放 M4-4/M5。

## 12. 实施阶段与验收

- **M4-0 结构引擎可行性验证（已完成，见 §0.2）**：
  - 源码 CST/range 引擎（嵌套 children 范围、digest、重解析、子源码字节对比）；
  - revision-scoped nodeId + baseRevision/digest 绑定；
  - symbol/引用/anchor 校验；
  - Col/Card 渲染包装 spike（overlay 几何、React key/事件、普通渲染无变化）；
  - 固定 fixture（Col 内嵌 Card/Col、共享 helper、@Each 局部变量、Section anchor、不兼容 slot、循环移动）验证 replace/reorder/delete/duplicate/move 与**正确拒绝**。
  - 未通过 gate 不得进入 UI。
- **M4-1 最小嵌套垂直切片（已完成，工作树，2026-11-05）**：Col/Row/Card 嵌套选择/内容编辑；`nestedEditLibrary` + `display:contents` 补偿层；Host CST 嵌套替换；精确 overlay；Node/E2E/真机见 §0.3。**下一步 M4-2。**
- **M4-2 同父层级排序（已完成，工作树，2026-11-05）**：`orderByParent`（单 children slot）、客户端「嵌套区块编排」同父 drag/keyboard/重置、Host 最深优先重建与 root/legacy 兼容、order-only meta。Node/E2E/真机见 §0.4。**下一步 M4-3。**
- **M4-3 受限结构操作（已完成，工作树，2026-11-05）**：权威 program 注册表 + 幂等 ledger + `POST /api/intelligent-ui/artifact-structure`；CST 校验 + 原子 delete/duplicate/move 批量 + revision 记录；客户端 delete/duplicate UI 与本地结构修订卡片。Node/E2E/真机见 §0.5。**下一步 M4-4。**
- **M4-4 按容器能力扩展（下一步）**：Delete → Duplicate → 同父 Move → 跨容器 Move；Host 权威 base program + operationId 幂等 + CAS；本地卡片缓存 + Host 恢复；并发/失败隔离；真机验证。M4-1 未实现权威 program store（结构提交的前置）。
- **M4-4 按容器能力扩展（已完成，工作树，2026-11-05）**：
  - 已完成：7 类容器白名单/渲染/CSS 补偿/几何 E2E、Section children 参数映射、CST `insertNode` 与跨容器 `moveNode` 基础（§0.6）；模型新增区块接线路由与客户端表单、跨容器 move UI 与结构操作（§0.7）。
  - 后续（M4-5/B2-5）：a11y、视觉回归、真实模型 E2E、发布收口、严格校验/diff 预览；Carousel 离屏 anchor 裁剪仍列为已知限制。
- **M4-5 收口（已完成）**：结构操作 diff 预览（Host dry-run + 客户端模态/a11y）、性能 smoke（49 区块/57 nodes）、视觉守卫（几何/排版 E2E，无像素基线）；见 §0.8。**B2-5 完成**：结构 dry-run + diff 预览与未选区块严格保护（§0.9）。M4 全部阶段完成；B2-6 已完成（§0.10）、B1-5 已完成（§0.11）、B2-8/9/10 已完成（§0.12）、用户反馈修复已完成（§0.13，第二轮 §0.14）；下一步发布（B1-7）。

每个阶段：Node 测试 + 浏览器 E2E + 真机 + 文档增量，全绿后再进入下一阶段。

## 13. 风险

- **渲染器改动面大**：容器组件审计/包装是最不确定性；先用 1 个容器（Card 或 Col）+ 1 个嵌套区块做 M4-1 垂直切片验证。
- **路径稳定性**：模型重排/重写可能改变内联容器的 children 顺序；Host 必须以显式路径校验，失败时要求模型重试。
- **父/子同时编辑**：禁止规则可避免复杂映射；UI 要清晰提示。
- **本地结构卡片**不走消息/导出链，与本地恢复同样限制；产品需接受。
- **复制语义**：Section anchor/Toc、@Each 局部变量、共享状态可能产生重复 id 或错误引用；v1 限制或显式重写。
- **性能**：60 区块的树/overlay/拖拽；需要虚拟化或限制，先测再定。
- **模型上下文**：嵌套内容编辑的 bundle 可能变大；沿用冻结依赖 + 深度限制。
- **编辑宽度适配风险**：依赖 shell 的 `data-conversation-*`/`--dsh-chat-user-width` 位置（迁移需更新常量）；column-aware 公式假设内容在聊天列内居中；仅 ≥1180px docked；面板 clamp fallback 748 与拟合值需保持一致；用户主 GUI 曾因旧 client bundle 未重启而误报未修复。
- **B2-8/9/10 风险**：free 只能经 On-demand/授权模板获得（普通 render_ui 会被拒）；视觉基线为手动对照、环境敏感、无自动像素 diff；窄屏只验证 390×844 与 900×1000 两个视口；真机截图留在 gitignored 的 `.tmp-report`。
- **B1-5 a11y 风险**：live region 单槽会合并快速连续播报；指针拖拽只在 drop 播报；Tab 关闭菜单不回焦；隐藏 hint 仍在可访问性树；未做真机 screen-reader/axe 审计，也无像素基线（B2-10）。
- **B2-6 运行时状态风险**：快照仅会话内存、刷新丢失；容量 24/5/64KiB 可能淘汰较旧快照；首渲染不继承、继承要求 `baseRevisionId`；第三方组件内部状态与编辑画布交互值不保留，用户可能误以为全部交互都会保留。
- **B2-5 严格模式风险**：只覆盖识别到的顶层未选区块，选中根块内部的嵌套未选子节点改动不检测；strictOff 文案未用；严格拒绝路径只有 Host 单测（无真机）；模型可能忽略 header strict 说明，需靠信封 prose + 错误重试兜底。
- **M4-5/B2-5 风险**：无像素级视觉快照基线，视觉回归仍靠几何/排版 E2E；无完整 screen-reader/axe 审计；preview loading 无客户端超时；模态背景未设 `inert`/`aria-hidden`（仅遮罩阻止指针）；B2-5 内容严格模式（warning→strict）未做，未选区块改动仍只有 warning。
- **M4-4 已完成阶段风险**：additions 依赖模型严格遵循 fragment 顺序（edits→additions、children 数），失败需重试；`additions` 与 `orderByParent` 分开发送；root 不能作跨容器目标；Carousel 离屏 anchor 未裁剪；跨容器移动只 append、无位置选择；每容器 v1 一个 addition；`base_missing` 无旧卡恢复提示；无结构 diff/undo/GC。
- **M4-4 第一阶段风险**：Carousel 的离屏 item anchor 可能超出 track，绘制需与 track rect 相交裁剪（未做）；CSS 补偿层从 28 direct + 5 scoped 继续增长，组件 CSS 变更必须同步维护；Section children 参数映射（第 2 参数）与其他容器（第 1 参数）不同，后续新增容器必须登记；shared `additions` schema 已存在但 Host/UI 未接入，文档不得声称模型新增区块可用；跨容器 move 引擎已支持但无 UI。
- **M4-3 新增风险**：权威注册表只覆盖安装后且在 200/50MB LRU 内的 revision，旧卡/被驱逐 base 需重新渲染；结构操作与内容编辑不能混合，且结构操作会直接提交当前草稿（无草稿过期确认）；本地结构卡仅 localStorage/触发 Turn，丢失即无提示；无 diff/undo，删除不 GC helper；`operationId` 幂等与 canonical body 需要严格一致；`move` 无 UI、跨容器未做。
- **M4-2 新增风险**：嵌套排序没有画布 live preview（列表目标顺序需清晰）；order-only 仍是模型回合（成本/延迟）；同父 scope 与 `@Each`/共享引用的拒绝依赖 CST 校验；根 `targetOrder` 与 `orderByParent.root` 冲突必须保持拒绝；`editedBlockIds` order-only 为 `[]` 可能被旧消费者误读。
- **M4-1 新增风险**：`display:contents` 包装依赖 25 条直接子选择器 CSS 补偿层，组件 CSS 变更必须同步维护（`nested-css-contract-check` 只做静态清单检查）；嵌套 nodeId 是 revision-scoped，结构操作后旧 id 失效；M4-1 只验证了单个嵌套文本替换，多嵌套/混合容器/深层场景未真机覆盖；Host 仍以信封 program 为基础（权威 program store 未做）。

## 14. 代码触点（预估）

- `src/shared/artifact-blocks.ts`：递归 extraction/tree、层级 reorder、路径 helper。
- `src/shared/artifact-edit.ts`：orderByParent/structure 类型、codec v2、revision meta 嵌套 id。
- `src/lib/render.tsx` / `src/lib/components/block-slot.tsx` / 容器组件：编辑 library 的递归包装。
- `src/client/artifact-edit/{store,contracts,EditPanel,ArtifactEditView,composer}.tsx`：选择树、编排树、结构操作 UI、草稿 v2。
- `src/host/{artifact-edit,artifact-revisions}.ts` 或新 `artifact-structure.ts`：层级校验、结构路由。
- 测试：新增嵌套 fixture（多级 Card/Col）、host/client/浏览器 E2E、真实模型场景。

**M4-1 实际触点**：`src/shared/program-cst.ts`（M4-0 已提交）、`src/shared/artifact-edit.ts`（嵌套身份字段/校验）、`src/client/artifact-edit/nested.ts`（新）、`src/client/artifact-edit/{store,contracts,ArtifactEditView}.tsx` + `artifact-edit.css`、`src/client/IntelligentUICards.tsx`、`src/lib/components/block-slot.tsx`（path context/HOC）、`src/lib/components/nested-edit.css`（新）、`src/lib/{library,render}.tsx`（nestedEditLibrary/nestedBlockSlots）、`src/host/artifact-edit.ts`（嵌套 plan/compose）、`src/shared/locales.ts`（嵌套文案）、测试 `test/client/nested-blocks.test.mjs`、`test/browser/nested-edit-renderer.e2e.mjs`、`test/renderer/nested-css-contract-check.mjs`。

## 0.15 第三/四轮用户反馈修复记录（2026-11-05，已提交 7768616）

- 面板改为圆角浮动卡片（桌面 top64/right12/bottom12、radius16、1px 边框、双层阴影、overflow hidden；窄屏 bottom sheet radius14），进退场 220ms panel-only 动画（桌面右滑/窄屏底滑 + 淡入淡出/轻微 scale，`prefers-reduced-motion` 禁用）；退出延迟 ~220ms 卸载，active 草稿切换立即卸载旧编辑器；浮动面板右侧 12px inset 计入宽度 fit（panelRightInset，1440/748+12→648 等）。
- 删除确认 unslop：去掉 3 秒自动恢复 timer；持久两态（Cancel/Delete 紧凑按钮，无红底/大红 pill），焦点到 Cancel，外部点击/Escape/其它动作取消，live region 播报一次。
- Block 指令 popover 位置 clamp 修复：anchor 滚出视口时顶边曾为负导致输入框被裁；现在 top 统一 clamp 到 `[12, vh-12-measuredHeight]`。
- 验证：Node **496/496**（Host 236、Client 239、packaging 21；特性 239）；浏览器 9/9；artifact-edit **246 checks**；nested-edit-renderer 75；nested-css-contract 28+5。构建 host 812.9 kB、client 3.91 MB（js 3.72 / css 193.0）、standalone 3.30+515.8；pack 43 files 4.02/10.37 MB。
- 说明：`.tmp-report/harness-polish-delete-confirm.png` 是取消预览后的截图，只证明圆角面板，不包含确认态；部署需重启 `dsh-web`。

## 0.16 第四轮反馈：结构动作显隐/行位移 + 面板与内容联动动画（2026-11-05，已提交 0232d37）

- 根因：hover CSS 把 structure-action **group** 本身设为 22px 且没有 opacity:1 规则 → 三动作不可见；group 68→22 造成 pencil/Edited 横移。现 group 固定 104px slot（默认 opacity0，hover/focus/确认时显示），pencil/Edited/Confirm 三态 x 不变；确认 Cancel/Delete 在槽内。
- request 列表垃圾桶改为“移除要求”并提示“不删除区块”，与结构删除“删除区块”区分。
- 面板进出与聊天内容宽度联动：`ChatContentWidthController { open, close, dispose }` + 220ms rAF/cubic-bezier(.22,1,.36,1)，open 收窄/panel 滑入同时开始，close 恢复/panel 滑出同时开始；中途打断从当前值继续；reduced-motion 立即；dispose 恢复原 inline。
- 追加：编辑工具栏进入/退场 220ms 动画（随 edit view closing）；popover textarea 左右 3px margin 防止 2px focus ring 被 scroll 容器左侧裁切；宽度动画增加隐藏窗口 rAF 暂停时的最终值 fallback。
- 验证：Node **496/496**（Host 236、Client 239、packaging 21；特性 239；panel-width 13）；浏览器 9/9；artifact-edit **246 checks**（708/1008 稳定宽度、开关中间帧宽度严格介于 base/fitted、data-closing 期间同步、CDP hover 三态坐标/opacity、结构删除 confirm）；nested 75；CSS 193.8 kB；pack 43 files 4.02/10.37 MB。

## 0.17 14 英寸 Air 遮挡修复：自适应面板宽度（2026-11-05，已提交 c3e1917）

- 现象：1234 CSS px 视口 + sidebar 后聊天列 954px 时，面板 clamp 360 + 内容最小 360 无法同时满足，面板仍遮内容。
- 修复：新增 `fitChatPanel` 返回 `{ contentWidth, panelWidth, adaptive }`；固定点低于可读阈值时先收窄面板（`--dsh-iui-edit-panel-width`，最小 272），再适配内容；宽屏保持原值，dispose 移除变量；面板宽度 220ms transition 与内容联动。
- 真机/隔离验证：1234×835 → 内容 320px、面板 281px、gap≈35px；1512×982 → 内容 440px、面板 360px、gap≈27px；无遮挡。
- 验证：Node **496/496**（Host 236、Client 239、packaging 21；特性 239；panel-width 14）；浏览器 9/9；artifact-edit **246 checks**；CSS 193.8 kB；pack 43 files 4.02/10.37 MB。

## 0.18 工具栏动画打磨（2026-11-05，已提交 8bbd0e9）

- 反馈：工具栏动画末尾“顿一下”。根因：工具栏 220ms 下移 6px 与卡片同时重排/变宽叠加，两段运动互相干扰。
- 修复：工具栏改为纯淡入（200ms ease-in）/淡出（180ms ease-in），去掉 transform，仅保留与面板一致的淡入淡出；reduced-motion 仍禁用。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**；CSS 193.8 kB。

## 0.19 动画节奏调慢（2026-11-05，已提交 8132337）

- 反馈：整体进入/退出编辑的动画太快。
- 调整：面板进出、面板宽度 transition、联动内容宽度动画、延迟卸载统一 **320ms**（同一 `cubic-bezier(.22,1,.36,1)`）；工具栏淡入 240ms / 淡出 220ms；reduced-motion 仍立即生效。
- 验证：Node **496/496**（动画时长常量断言同步）；浏览器 9/9；artifact-edit **246 checks**；CSS 193.8 kB。

## 0.20 编排行动作常显 + 图标统一 + 悬停卡只读（2026-11-05，工作树）

- 编排行动作组改为**常显**（不再 hover 才出现），编辑铅笔并入同一 104px 固定槽位，槽位内顺序为 编辑 / 复制 / 删除 / 移动；确认态仍在同一槽位，行内位置不位移。
- 行内所有图标统一为 `label-primary` 白色调（原 `label-tertiary`），更清晰可见。
- 悬停请求卡去掉「编辑 / 移除要求」两个按钮（行内已有对应入口），卡片只读；安静删除相关 CSS 一并移除。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（常显动作组、四个分组图标、分组编辑选择器迁移、悬停卡只读）；CSS 192.8 kB；真机隔离 1512×982 确认四个白色图标同组常显。

## 0.21 编辑铅笔图标统一（2026-11-05，已提交 56b8caa）

- 问题：画布选中浮层的编辑按钮用字符 `✎`（笔尖朝右下），与面板行的 SVG 铅笔（笔尖朝左下）互为镜像。
- 修复：`block-slot.tsx` 内新增 `PencilGlyph`（与 `EditGlyph` 同一路径），画布浮层改用它；请求行、编排动作组、画布浮层三处铅笔完全一致，打包产物中不再有 `✎`。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（三处 `d` 路径一致、浮层无文本字符）；CSS 192.8 kB。

## 0.22 图标体系统一为 Remix Icon（2026-11-06，工作树）

- 需求：插件自身的图标不要手绘，统一使用 Remix Icon（会话内 `remix-icon` MCP 提供的图标名）。
- 实现：新增 `src/lib/components/remix-icon.tsx`（从 `remixicon@4.9.1` 抄录 29 个图标的 path，`REMIX_ICON_PATHS` + `<RemixIcon>`；24 viewBox、`fill=currentColor`，无运行时依赖/字体）。替换编辑面板（铅笔/垃圾桶/复制/移动/拖拽/刷新/关闭/类型 8 种 + 新增）、画布浮层、设置页星标、样式选择器对勾与星、composer 作用域/箭头/对勾/样式、导出菜单、文章折叠箭头、链接外链箭头、媒体空图、Carousel 左右箭头；删除 `✎`/`✦` 字符图标与 DSH primitives sparkle/chevron。
- 例外：OpenUI 程序内容里的 `Icon("…")` 仍由 `glyph.tsx` 用 lucide 动态解析（程序数据，不是 chrome）。
- 许可：`licenses/remix-icon-LICENSE` + `NOTICE` 增加 Remix Icon（Remix Icon License v1.0）条目；`integration.md` 出货文件数 43 → **44**。
- 验证：Node **496/496**；浏览器 9/9；`artifact-edit` 246 checks；`nested-edit-renderer` 75；构建 host 812.9 kB、client 3.93 MB（js 3.73 / css 203.4）、standalone 3.31 MB + 516.3 kB；pack **44 files** 4.03 / 10.39 MB。

## 0.23 输入框跟随编辑宽度（2026-11-06，已提交 c76ecca）

- 反馈：进入编辑后内容收窄，但底部输入框仍保持原宽。
- 修复：宽度控制器在每帧同时写 `[data-composer-card]` 的 `max-width = 内容宽度 + 32px`（与 shell 的 `--dsh-composer-card-max-width` 公式一致），dispose 时恢复原始 inline max-width；输入框与内容同帧收窄/恢复。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（composer 跟随 fitted 宽度、退出恢复）；构建/打包不变（client 3.91 MB，pack 44 files 4.03/10.39 MB）。

## 0.24 按 Artifact 的修订历史（2026-11-06，已提交 d405c9f）

- Host：`listForArtifact()`；`GET artifact-history`（metadata 新→旧；current/source/hasProgram/restorable；program-only 初始修订合并）；`GET artifact-history/program` 按需 program；restore 支持初始修订（style 用 latest 兜底）。
- Client：`ArtifactHistory.tsx` 元数据对话框（改动区块 chips、无整页预览、不可用态、恢复）；入口 = 卡片历史图标 + Revision 徽标 + 编辑面板 header 历史按钮；恢复复用本地修订管线并刷新。
- 验证：Node **496/496**（Host 236、Client 239、packaging 21）；浏览器 9/9；artifact-edit **246 checks**；构建 host 812.9 kB、client 3.93 MB（js 3.73 / css 203.4）；pack 44 files 4.03/10.41 MB。

## 0.25 草稿条移到输入框上方并 unslop（2026-11-06，已提交 395a272/a3cd1f6/5acdf97/fc9e251）

- 需求：面板是当前 Artifact 的，`Pending edits (N/6)` 是 session 级草稿切换器，放在面板里容易混淆；移到输入框上方。
- 实现：`DraftDock.tsx` 注册到 `conversation.input.overlay`，成为输入框卡片内部顶部草稿行（不覆盖消息滚动区），无草稿零高度；unslop 为一句话工具条：标题/修订同行、active 用 surface step + 中性点、Discard 仅 hover/focus 显示（detached 时 Attach 常显）；保留全部 data hooks；EditPanel 移除 DraftSwitcher。新增 `PRODUCT.md`。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（草稿条在 composer 卡片之前、不在 panel 内）；CSS 203.4 kB；真机隔离确认渲染在 composer 上方。

## 0.26 修订冲突文案澄清（2026-11-06，已提交 a6ea8b2）

- 反馈：冲突横幅「已有更新版本」不够清楚，用户仍需确认。
- 文案：标题/正文带当前修订与最新修订编号；新增说明「从此修订新建修订不会覆盖最新修订；只想改最新版请退出并打开最新修订卡片」；按钮「从修订 N 新建修订」「重新检查」「退出编辑」；分支提示带 latest 与 next。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（数字、非覆盖说明断言）；CSS 203.4 kB。

## 0.27 编辑态暗示/选中卡片/历史副标题/面板退出（2026-11-06，已提交 b9d85e6）

- 未选中区块改为**容器自身**的无边框亮度呼吸（2.4s，brightness 0.95）；overlay 只做点击捕获，无描边/背景/halo，不会额外叠层或与间距重叠；选中改为圆角卡片 + 柔和悬浮阴影，去掉蓝框；键盘焦点中性 ring。
- 历史对话框不再用 artifactId 当副标题；styleId/未知 blockId 都改为本地化文案；编辑面板头部新增「退出编辑」。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **246 checks**（容器呼吸动画、overlay 无描边、选中卡片、历史无裸 ID、面板退出）；CSS 203.1 kB、standalone 516.0 kB。

## 0.28 编辑态提示改为逐块描边动画（2026-11-06，工作树）

- 反馈：整块亮度「呼吸」不明显，像是在内容上做明暗变化，不能清楚表达“区块可编辑”；加编辑图标也被认为丑，要求只用动画暗示。
- 方案：去掉呼吸。进入编辑模式后，每个可编辑区块按阅读顺序**顺时针描出一圈 1px 细线边框**（单块约 700ms，逐块错开 45ms），绘制完成后淡出；之后以 **9 秒**为周期重复轻描一次（单块描边约 0.7s，其余时间静止）。hover 时显示静止描边，`focus-visible` 时加强；选中或指令弹窗打开的区块仍使用圆角卡片 + 柔和悬浮。描边画在 block wrapper 的 `::after` 上，由四条 `background` 渐变组成（`inset: -3px`），不是 border、不新增 DOM、不改变内容亮度与布局，也不会外扩重叠间距；嵌套 wrapper 为 `display: contents`，不参与该提示（只作用于根层区块）。
- reduced motion：禁用描边动画，保留 opacity 0.1 的静止描边作为非动画替代；暗色主题沿用同一批 ink token。
- 论证依据：NN/g 的动效原则（短暂、有目的、传达状态；持续装饰性运动有害）与产品 register 的 150–250ms 状态反馈约束；因此提示由“进入编辑模式”这个状态变化触发，并用低频重复代替常驻呼吸。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **255 checks**（描边动画名与无限循环、四条 hairline 背景、逐块 delay、无 body 呼吸、hover 静止描边、reduced-motion 回退、零描边 overlay、选中卡片等）；CSS 204.6 kB；standalone 517.6 kB；pack 44 files 4.23 MB / 10.93 MB。截图：`.tmp-report/harness-block-trace.png`（暂停在中途的逐块描边）、`.tmp-verify/trace/trace.gif`（进入编辑模式后约 1.8s 的描边过程 + 静止状态循环预览）。

## 0.29 编辑态提示改为每块淡色光晕跑马灯（2026-11-07，工作树，取代 §0.28）

- 反馈（真机截图）：§0.28 的逐块描边在圆角处被裁切 —— 四条直线背景渐变会被 `border-radius` 裁掉四个角，看起来像断开的边框；用户明确要求去掉边框，改成类似「跑马灯 / 光晕」：一团淡淡的光沿着看不见的区块边缘绕一圈，每隔几秒重复，只针对最外层可编辑区块，不针对区块内部子元素（编辑粒度只到区块）。颜色要活泼但不抢眼，用淡蓝、淡绿、淡红一类淡色。
- 方案：删除 §0.28 的全部描边（含 hover 静止描边）。每个**根层** block wrapper 用 `::after` 绘制 1.5px 圆角环：`conic-gradient(from var(--dsh-iui-marquee-angle), …)` 形成带渐隐拖尾的光头，`mask: content-box/border-box exclude` 裁成圆角边环，`drop-shadow` 提供柔和光晕；`@property` 注册角度、2.6s linear 无限循环。每个区块按 `--iui-edit-stagger` 错开相位（140ms），并按 `--iui-edit-tone-N` 六色淡彩轮换（蓝/紫/绿/黄/粉/青，与选中编号色系一致但更浅；light/dark 各一套色值）。hover 时 opacity 0.9→1；选中/指令弹窗打开时不绘制；`prefers-reduced-motion` 停止绕行、保留静止光斑。
- 约束：只作用于根层 wrapper（`:not([data-dsh-iui-block-path])`），嵌套子元素不参与；圆角环由 mask 内缩得到，不是 border；`inset: -2px` 只进入区块间隙，不与相邻区块重叠；不新增 DOM、不改变内容亮度/布局。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **258 checks**（动画名/无限循环、conic-gradient、圆角 mask、逐块相位、不同淡色、hover 变亮、reduced-motion 静止、零描边 overlay、选中卡片等）；构建 host 812.9 kB、client 3.94 MB（js 3.74 / CSS 205.0）、standalone 3.32 MB + 518.1 kB；pack 44 files 4.23 MB / 10.93 MB。截图/GIF：`.tmp-report/edit-affordance-marquee-dark.png`、`.tmp-report/edit-affordance-marquee-light.png`、`.tmp-report/edit-affordance-marquee-dark.gif`、`.tmp-report/edit-affordance-marquee-light.gif`；`.tmp-report/harness-block-marquee.png` 为 E2E 暂停帧。

## 0.30 Block popover 输入框底部 focus ring 被裁（2026-11-07，工作树）

- 反馈（真机截图）：区块指令 popover 的 textarea 获得焦点时，蓝色 focus ring 的底边被裁掉。
- 根因：textarea 是 `.dsh-iui-edit-popover-scroll`（`overflow-y: auto`）的最后一个字段，滚动容器只有 `padding-right: 2px`、没有底部内边距；2px ring + 1px offset 需要 3px 空间，超出 padding box 的部分被滚动容器裁掉（左右两侧此前已用 textarea `margin: 0 3px` 解决）。
- 修复：滚动容器 padding 改为 `0 2px 4px`，把底部 4px 留在裁剪区内，四边 focus ring 完整可见；同时 E2E 增加底部空间与 padding 断言。
- 验证：Node **496/496**；浏览器 9/9；artifact-edit **260 checks**；CSS 205.0 kB；真机隔离截图（light/dark）确认输入框四边 ring 完整。

## 0.31 结构区块解禁（M4-6，2026-11-07，工作树）

- 反馈：用户指出 Toc 不能编辑，并确认 `Caption`/`Divider`/`Spacer`/Toc/游离 `Title` 都应该支持；编辑粒度按区块，不需要更细。最初只要求“这些也支持”，随后追加 Divider/Spacer 的快捷调整。
- 方案：把 `Caption`/`Divider`/`Spacer`/`Toc`/根层 `Title` 从页面 chrome 名单移除；根 `Col` 与 7 类嵌套容器的每个直接子节点都成为可编辑区块。新增 `divider`/`spacer`/`toc`/`heading`/`caption` 五种 block kind（中英标签 + Remix 图标），标题扩展为读取 Title/Caption 文本、Toc.items 与首段文本。
- 保留的安全边界：`@Each`/opaque/共享命名表达式/深度与节点上限仍不可编辑；复制含 Section/Toc anchor 的子树继续拒绝；结构操作、`orderByParent`、新增区块、跨容器移动都按普通区块处理；未命名同类块在目标顺序归一化时按同类页面顺序兜底。
- 影响面：`extractArtifactBlocks`、CST 节点 flags（移除 chrome）、Host nested/orderByParent/structure 校验、客户端 nested 映射与面板 kind、根层 wrapper 包裹（Title/Caption/Divider/Spacer 现在也有 BlockSlot）；既有 fixture 的区块数从 8 变 9（脚注 Caption 入列），因此同步更新了 51 条 client/host 测试期望。
- 验证：Node **499/499**（Host 239、Client 239、packaging 21）；浏览器 9/9；artifact-edit **260 checks**（当时）；nested-edit-renderer 75；CSS 205.0 kB。

## 0.32 Divider/Spacer 快捷调整（M4-6，2026-11-07，工作树）

- 需求：Divider 快捷调整颜色/宽度/粗细；Spacer 快捷调整宽度/高度；用户确认走**零模型确定性修订**，取值用主题 token + 灵活尺寸。
- 组件与 grammar：`Divider(color?, width?, thickness?)`（颜色 token 或 CSS 颜色；宽度 px/%，居中；粗细 0.5–12px）、`Spacer(width?, height?)`（px/%/auto，设值后不再 flex）；同步 `vendor/spec.json`、vendored prompt、生成的 prompt 与 Agent Skill 组件参考。
- 契约：新增 `src/shared/artifact-block-props.ts`（组件级/形状校验、规范表达式序列化、从 AST prefill）；CST 节点携带解析后的 `props`，并新增 `replaceNodeContent`（改写命名语句定义而不是把引用内联）。
- Host：`artifact-structure` 路由新增 `props` 操作；校验节点组件（仅 Divider/Spacer）与属性，经 `replaceNodeContent` 原子应用，复用幂等/CAS/分支/修订记录。测试覆盖根/嵌套目标、preview、幂等与全部拒绝路径。
- 客户端：popover 在 Divider/Spacer 上显示快捷调整控件（`QuickBlockProps`）；改动写入 `propsPreview` 并重新包裹渲染实现**画布实时预览**；应用时发 `props` 请求，成功后出现「属性调整修订」本地卡片（local revision kind `props`），失败在 popover 内提示；存在未发送的指令/排序/整体说明时拒绝应用并提示先发送或清除。
- 限制：仅 Divider/Spacer 的上述属性；这两类块不再显示模型指令 textarea（已保存指令仍在请求列表）；属性修订卡与其他本地修订一致，不参与导出；自定义颜色受渲染器 `isSafeCss` 与 Host 保守校验约束。
- 验证（系统性修复后）：Node **508/508**；浏览器 9/9；artifact-edit **282 checks**（快捷面板、画布预览、确定性请求体、属性修订卡、dirty 拦截、动态回退、apply 禁用/焦点）；nested 75；client CSS 203.0 kB；standalone 3.32 MB + 513.9 kB；pack 44 files 4.24 MB / 10.96 MB；harness 截图 `.tmp-report/harness-quick-props.png`、`.tmp-report/harness-pending-block.png`。

## 0.33 系统性修复（2026-11-07，工作树）

- 触发：两个只读 reviewer 对 0.31/0.32 的审查结论“需要修改”（6 条 P1、多条 P2）。按用户要求不做局部补丁，改为按根因重建。
- **画布布局零侵入**：此前编辑 wrapper 是真实 `div`（根层与嵌套都是），会改变直接子选择器、`iui-flow` 节奏与 flex 行为（实测 Title→Divider 12→28px；根层 Title/Caption/Divider/Spacer/Spacer 全受影响）。现在所有编辑 wrapper 与 body 均为 `display: contents`，`nested-edit.css` 的 28 条直接子选择器补偿从“仅嵌套 path”扩展为全部编辑 wrapper；选择/悬停/选中框/编号徽标/编辑与取消工具/跑马灯/点击与键盘焦点全部移到客户端 `BlockOverlay`：它在 `.dsh-iui-edit-canvas`（position:relative）内按真实内容 rect 测量，用 ResizeObserver + MutationObserver 重测，根层与嵌套共用，不参与布局。选中状态改为“浮动边框 + 阴影”而不是给 body 上背景/圆角（wrapper 不再有盒子）。
- **单一区块身份**：快捷调整不再借用 `nestedBlocksForProgram` 解析根层；根层按 `block.rootIndex` 对应 CST 根 `Col` 的直接子节点（shared/opaque 兄弟不再让 bN 偏移），嵌套模式沿用面板同源的嵌套映射；`shared`/`opaque`/`scoped` 一律禁用快捷调整。
- **属性安全**：新增 `describeArtifactBlockPropsSupport`：只有全部属性都是字面量且在当前快捷值域（颜色 token/CSS 颜色；px/%/auto 长度；0.5–12 粗细）时才显示快捷面板；动态绑定或 rem/calc 等超范围值回退到指令编辑器并说明原因，绝不静默丢属性。已保存指令的 Divider/Spacer 同样回退到指令模式。控件改为本地 UI 状态（单位/未输完的数字不再把画布宽度写成 0）；未修改时 Apply 禁用；客户端与 Host 都拒绝 no-op 属性修订；结构路由的 operation digest 现在包含 `props` 与 `toParentNodeId`；同一批操作里重复目标节点直接 `operation_conflict`。
- **匿名块排序身份**：`targetOrder` 归一化在“statement → 标题+类型 → 唯一标题”之后增加“唯一内容 digest + 组件类型”匹配，最后才按页面顺序兜底（只对字节相同的可互换块生效）；嵌套 `orderByParent` 的 `mapChildIds` 同样先按 digest 匹配，再退回 childIndex。
- **状态与一致性**：快捷调整的未发送拦截统一用 `hasArtifactEditContent`（补上 `nestedOrderChanged`）；嵌套模式也渲染 `propsPreview`；嵌套面板 kind 复用共享映射（Divider/Spacer/Toc/Title/Caption 不再显示成“内容”）；异步结构/属性失败回写当前 session 而不是请求前快照；快捷控件打开即聚焦、补齐 `edit.propsUnit`、完整 20 个颜色 token、`aria-busy`、busy/失效/无变化文案。
- **验证**：Node **508/508**（新增 6 条 shared/client quick-adjust+identity 单测、1 条匿名 digest 排序测试、2 条 Host props no-op/digest/批冲突测试）；浏览器 9/9；artifact-edit **282 checks**（布局 parity、嵌套 preview、dirty 拦截、动态回退、apply 禁用/焦点）；nested 75；client CSS 203.0 kB；standalone 3.32 MB + 513.9 kB；pack 44 files 4.24 MB / 10.96 MB。

## 0.34 大页面预算 + 自绘快捷控件（2026-11-07，工作树）

- 反馈：用户的实际页面「Solid 2.0 导览」有 105 个 CST 节点，`MAX_CST_NODES=60` 让 `nestedBlocksForProgram` 返回不可用——工具栏没有「Nested blocks」，唯一的 Scope 内 `Spacer`（depth 3）看不到；页面里也没有 `Divider`，红框里的线是 `.iui-section` 的 `border-top`。用户要求把长页面修好（方案 A），并把快捷调整里的系统下拉/滑块换成本插件自绘控件。
- 修复：`MAX_CST_NODES` 60 → **200**（程序字符上限与深度不变）；新增 66 节点 fixture + E2E：3 个根区块、嵌套按钮出现、根 Divider 快捷调整可用、嵌套 Spacer（b3.2）可达并实时预览。客户端单测覆盖 `>60` 节点时 `blockPropsState`/`nestedBlocksForProgram`。
- 自绘控件：新增 `QuickSelect`（button trigger + portaled listbox，`role=listbox/option`，方向键/Home/End/Enter/Escape/Tab、focus return、滚动重定位）与 `QuickSlider`（div track/fill/thumb，pointer capture、方向键/Shift/Home/End、`role=slider` + aria-valuetext、`prefers-reduced-motion`），替换 QuickBlockProps 里的原生 `<select>`；宽度/高度/厚度在数值单位下增加滑块，拖动即更新 `propsPreview`（零模型），Apply 仍负责记录修订。原生 number input 保留为精确输入并隐藏系统 spinner；菜单/滑块使用 `--dsw-alias-*` 主题 token，深色主题一致。
- 滑块初版在拖动时会把 Divider 宽度变化传给 popover 的 ResizeObserver，导致面板/滑块跟着位移、数值跳变；现在 popover 在打开时固定位置（仅真实用户滚动/缩放/切换区块重锚），滑块改为相对 pointer-down 值拖动（点击轨道不再把 thumb 瞬移）。第二处位移来自切换宽度单位（px ↔ %）时面板内部滚动与浏览器 scroll anchoring：现在忽略 popover 内部滚动，并用「锚点在视口内是否真的移动」过滤布局引发的 scroll。E2E 断言宽度预览与单位切换时 popover 的 left/top 均不变。
- 交互：portaled 菜单在 BlockPopover 的 outside-pointerdown/Escape 逻辑中被排除，Escape 先关菜单再关 popover；打开快捷面板聚焦第一个自绘控件。
- 验证：Node **510/510**；浏览器 9/9；artifact-edit **321 checks**；nested 75；client CSS 213.2 kB；standalone 3.32 MB + 513.9 kB；pack 44 files 4.25 MB / 11.00 MB。

## 0.35 列表↔画布映射、编辑聚焦与 pending 标记（2026-11-07，工作树）

- 反馈：列表行和画布的区块难以对应；希望 hover 联动；编辑某个区块时聚焦（其余压暗）；Save 指令后不应保留大选中框；跑马灯在结束编辑后恢复；并确认动画不叫“跑马灯”。
- 实现：`ArtifactEditView` 提升 `hoveredBlockId`，`EditPanel` 行与 `BlockOverlay` 双向同步 hover；画布给根层常显页面顺序号、嵌套块 hover 时显示，行内显示同一序号；行尾新增「定位」按钮（保留点击行主体定位 + 900ms 脉冲）。
- 编辑聚焦：打开任一区块编辑器时，`BlockOverlay` 给非相关区块画 scrim（同祖先链的区块不压暗），当前块保留编辑框；Save/Cancel 关闭后 scrim 消失。
- pending 状态：`selection` 数据保持不变，但 Save 后不再绘制大选中框/工具；改为「圆点 + 请求序号」的 pending 标记；pending 根层的 orbit glow 降速（5.2s）、变淡（0.3）；无 pending 的根层恢复普通 orbit glow。确定性 Apply/结构操作仍记录修订并退出编辑（1A）。
- 术语：`marquee` 改为 `orbit glow`（CSS 类 `dsh-iui-block-orbit`，保留 `dsh-iui-block-marquee` 兼容别名；`--dsh-iui-orbit-angle`/`@keyframes dsh-iui-block-orbit`），文档统一称「轨道光晕 / orbit glow」。
- 验证：Node **510/510**；浏览器 9/9；artifact-edit **321 checks**（hover 双向、页面序号、定位按钮、scrim、pending 标记/orbit glow 降速、Save 后退出大框、嵌套序号等）；nested 75。

## 0.36 编排行 unslop、Locate 图标、模式说明与嵌套映射（2026-11-07，工作树）

- 反馈：左侧编排行“太 AI slop”；新增的定位按钮看不到；嵌套区块的列表↔画布匹配不够；顶部“顶层/嵌套/严格保护”的说明不足；旧 session 的 Spacer 快捷调整报 `base_missing`。
- Unslop 方向：精确、安静、像排版工具。页面号改纯等宽数字（去掉描边胶囊）；行操作默认隐藏，hover/focus-within 才出现；行 hover 改为中性底色 + 1px 细线，不再用蓝色淡底/2px 色条；`已编辑` 从彩色胶囊改小圆点+次要文字；拖拽手柄去掉 hover 底和蓝色 glow，只保留细线 focus ring；操作组宽度从 4 个图标扩到 5 个。
- Locate：按钮图标由不存在的 `focus-3-line` 改为内置 `cursor-line`；E2E 断言 SVG path 非空。
- 工具栏文案：按钮改为「显示嵌套区块 / 仅顶层区块」；banner 分模式说明顶层 vs 嵌套；严格保护提示说明会拒绝未选中顶层区块的改动且请求保持待处理。
- 嵌套映射：嵌套行 hover ↔ 画布嵌套块双向高亮；嵌套块 hover 时显示 `1.2.1` 形式的页面地址；嵌套行 Locate 按钮与行主体点击都能定位并触发 flash；E2E 覆盖。
- base_missing：旧卡片（本机 registry 只有 15 条程序，该 Solid 2.0 导览程序不在其中）无法做确定性写入；客户端捕获后把快捷面板切换为指令编辑并显示解释（可改用模型编辑或重新渲染页面）。未实现“把当前页面注册为权威 base”的 adopt 路由。
- 验证：Node **510/510**；浏览器 9/9；artifact-edit **321 checks**；nested 75。

## 0.37 工具栏模式说明、自定义 tooltip、动作按钮与定位图标修正（2026-11-07，工作树）

- 反馈：顶部“显示嵌套区块 / 仅顶层”按钮与下方状态 banner 一个说动作一个说状态，中间产生奇怪的 Gap；严格保护没有说明；定位图标在 Remix 里确实存在；点击行主体定位后鼠标离开面板，动作按钮仍然显示。
- 工具栏：控件改为复合按钮组「状态 | 动作 + chevron | ⓘ」，看起来像按钮而不是输入框：层级组显示 `顶层/嵌套` + 动作「显示嵌套区块 / 回到顶层区块」；严格保护组显示状态圆点 + 标签 + 开/关。信息图标放进控件组内部，使用自定义 tooltip；banner 改为静态提示。不再使用原生 title tooltip。
- 新增 `InfoTip` 组件：信息图标 + portaled 自定义 tooltip（surface/边框/阴影主题化，hover/focus/click 打开，Escape/滚动/resize 处理，aria-describedby）。两个控件各带一个说明 tooltip；E2E 覆盖 tooltip 文本与关闭。
- 动作按钮：显示条件从 `:focus-within` 改为 `:has(:focus-visible)`，所以鼠标点击行主体/定位后即使焦点留在行内，指针离开后动作按钮也会隐藏；键盘 focus 仍会显示。
- 定位图标：Remix 库确实有 `focus-3-line`，只是插件内联图标子集没有；把真实 path 加入 `REMIX_ICON_PATHS`；根据反馈最终改用 `map-pin-line`（`focus-3-line` 与移动图标太像），E2E 断言定位按钮的 SVG path 非空。新增 `test/client/remix-icon-names.test.mjs`：扫描所有 `<RemixIcon name="...">` 字面量，防止再次出现空图标（client 不走 tsc，esbuild 不校验 union，之前测试只点按钮没检查 glyph）。
- 旧页面 base_missing：新增 E2E mock（404 `base_missing`）验证快捷面板切换为指令编辑器并显示“权威版本记录之前”的说明；恢复 fetch 后退出。
- 验证：Node **510/510**；浏览器 9/9；artifact-edit **321 checks**；nested 75。

## 0.38 统一「退出编辑」按钮（2026-11-07，工作树）

- 反馈：卡片头部的「退出编辑」是蓝色描边/蓝色文字的 pressed 样式，和工具栏、编辑面板头部的退出按钮不一致。
- 修复：给卡片头部退出按钮、编辑视图工具栏退出/窄屏退出、面板头部退出统一加 `.dsh-iui-edit-exit`；共享同一套中性描边按钮样式（26px 高、10px 横内边距、layer-1 背景、border-l2 边框、label-primary 文字、悬停 interactive-hover、focus ring）。移除卡片头部 `aria-pressed=true` 的蓝色覆盖；`aria-pressed` 语义保留，只影响状态播报，不影响视觉。
- 验证：E2E 断言至少 3 个退出按钮共享 `.dsh-iui-edit-exit`，且卡片头部退出按钮边框不再是 business-primary 蓝色；Node/浏览器全量回归。

## 0.39 去掉工具栏重复的「退出编辑」（2026-11-07，工作树）

- 反馈：卡片头部和编辑面板头部都已有退出编辑，工具栏红框里第三个「退出编辑」是重复入口。
- 修复：移除工具栏按钮；保留卡片头部与面板头部两个入口，继续共用 `.dsh-iui-edit-exit` 中性样式。面板退出按钮额外保留 `data-dsh-iui-edit-exit` 兼容旧流程/测试选择器；工具栏现在只承载层级、严格保护、抽屉和提示。
- 验证：E2E 断言 `.dsh-iui-edit-exit` 数量为 2，编辑视图内不再有工具栏退出按钮；artifact-edit **321 checks**。

## 0.40 修复面板重复分割线（2026-11-07，工作树）

- 截图：Block arrangement 与 Global instruction 之间出现两条相距很近的横线。
- 原因：不是嵌套区块未显示导致；面板里同时存在显式 `<div class="dsh-iui-edit-divider">` 和 `.dsh-iui-edit-global { border-top: 1px }`，两套分隔叠加。
- 修复：删除 `.dsh-iui-edit-global` 的 `border-top`，保留显式分隔线作为唯一横线；不依赖 nested arrangement 是否存在。
- 验证：E2E 断言面板只有一个 `.dsh-iui-edit-divider`，且 global 的 `borderTopWidth` 为 0；artifact-edit **321 checks**。

## 0.41 去掉拖拽手柄的焦点外框（误判，已回滚）

- 反馈被误读为 grip 的焦点外框；实际红框是行 hover 的 `inset 1px 0 0` 左缘细线（见 0.42）。
- 当时改成 grip 无 outline + 整行焦点底色；该行为不是问题来源，已回滚为原来的 grip `:focus-visible` 细线外框，避免无关改动。

- 修正：0.41 的 `outline: none` 被文件后面共享的 `:focus-visible` 组规则覆盖（该组仍列着 `.dsh-iui-edit-grip`，且加载更晚），所以外框仍在。已把 grip 从共享组里移除，仅保留行级焦点提示。

## 0.42 真正定位并去掉行 hover 的左侧细线（2026-11-07，工作树）

- 用 ego-browser 打开真实 GUI 复核：截图里红框（拖拽点左侧的圆角竖线）不是 grip 的 focus outline，而是 `.is-hover-linked` 行上的 `box-shadow: inset 1px 0 0`——只偏移 X、无扩散，因此只在行左缘出现一条被圆角裁切的竖线，上下右都看不到。
- 修复：从 `.dsh-iui-edit-arrangement-row/.dsh-iui-edit-nested-row/.dsh-iui-edit-request-row.is-hover-linked` 和 grip 键盘焦点行样式中删除 inset 左侧线，只保留中性背景高亮。ego 复核当前 bundle 的 CSS 已无该 box-shadow。
- 之前的 grip focus outline 改动与问题无关，已回滚；只保留行 hover 左缘细线的删除。

## 0.43 轨道光晕外扩（2026-11-07，工作树）

- 反馈：轨道光晕太贴合区块。
- 修复：`.dsh-iui-block-orbit` 的 `inset` 从 -3px 经 -6px 调到 **-10px**，圆角 15px → 22px，保留 1.5px 环宽、动画和 pending 降速；光晕与内容之间留出更明显的呼吸空间。

## 0.44 去掉编辑面板外边框（2026-11-07，工作树）

- 反馈：右侧编辑窗口外圈有一条边框，希望去掉。
- 修复：`.dsh-iui-edit-panel` 在窄屏 bottom sheet 和 ≥1180px 桌面 rail 两个断点都删除 `border`，保留圆角、`bg-layer-1` 背景与柔和 shadow；内部 header/section 的分隔线不变。
- 验证：E2E 断言 `.dsh-iui-edit-panel` 的 `borderTopWidth` 为 0；artifact-edit **321 checks**。

## 0.45 所有输入框的焦点高亮改为轨道光晕（2026-11-07，工作树）

- 反馈：整个插件里所有输入框的焦点高亮，从边框/outline 改为轨道光晕。
- 实现：新增 `src/client/InputOrbit.tsx`，在 client `apply()` 里挂一个 document 级 React root；监听 `focusin/focusout`，识别插件范围内的 text/number/email/url/tel/password/date/time、textarea、select、contenteditable 和 `.dsh-iui-quick-select`（field-like trigger）；每帧测量元素 rect（应对面板宽度过渡/滚动），在元素外 5px 画 conic-gradient 轨道环（复用 block orbit 的光带造型，独立 @property/keyframes）。
- 去除旧高亮：给聚焦元素加 `.dsh-iui-input-orbit-target`，全局 `outline: none !important`；渲染组件的 `.iui-input` 焦点边框恢复为 `--iui-border-strong`、去掉 box-shadow；编辑面板的 `.dsh-iui-edit-add-textarea` 焦点边框恢复为 `border-l2`、去掉光晕。
- 覆盖范围：插件 chrome（设置页、模板导入、样式面板、编辑器面板/popover）与 `.dsh-iui-host` 内模型生成的 Input/TextArea/Select；不装饰 checkbox/radio/range（非“输入框”）。
- 验证：E2E 检查焦点后轨道环存在、位置在字段外 5px、字段 outline 为 none、blur 后消失；原 textarea 2px focus ring 断言改为 orbit。
