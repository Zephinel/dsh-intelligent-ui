# M4 设计方案：嵌套区块与结构编排（区块增删/复制）

> **状态：M4-0 已通过，M4-1 待 owner 批准开工 — 2026-11-05。**
> owner 已确认 §0 的 5 个产品方向；GPT 评审结论为 **RETHINK**，其阻断项已吸收为 §0.1 修订；M4-0 的 CST/渲染/结构操作可行性 spike 已通过（§0.2）。**M4-1 开始前需 owner 确认 §0.2 的 gate 结论与 M4-1 范围。** 现有行为以 [架构与行为](../../architecture.md) 为准，M3 完成记录见 [M3 计划](../artifact-edit-m3/README.md) §0.4。
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

### 0.2.4 M4-1 提议范围（待 owner 批准）

1. Host：权威 base program/revision + `buildArtifactTree`；结构请求绑定 `baseRevisionId + nodeId + digest`；向客户端暴露 outline/tree 元数据（不回传整页源码）。
2. Renderer：新增 edit-only `nestedEditLibrary`（HOC + allowlist），`display:contents` + CSS 补偿层；审计 components.css 直接子选择器；fixture 几何快照 E2E。
3. Client：编辑画布选择键改为 tree nodeId；overlay rect/union；请求列表面包屑；先做**嵌套内容 replace**。
4. 暂不做：结构操作 UI（M4-3）、duplicate/move、动态 @Each 实例内部编辑、七类容器扩展。

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

- 可下钻容器（建议）：`Col`、`Row`、`Box`、`Grid`、`Card`、`Section`、`Carousel`（`Popover` 不展开，避免浮层编辑）。
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

### 6.1 排序表示

- `targetOrder` v2：
  ```ts
  interface HierarchicalOrder {
    readonly byParent: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> // parentNodeId -> slotKey -> childNodeIds
  }
  ```
- 只允许**同一父容器的同一 slot 内**排序：每个 `byParent[parent][slot]` 必须是该 slot 可编辑子节点的完整排列；`slotKey` 默认 `children`，容器适配器可声明其他 slot。
- 跨容器移动不通过拖拽表达，而是结构操作 `move`（§7）；v1 拖拽限制在同一容器内，UI 在拖到其他容器时提示“用移动到…”菜单。

### 6.2 Host 确定性重排

- 扩展现有 `reorderProgramToTargetOrder` 为 `reorderProgramToHierarchicalOrder(program, byParent, baseExtraction)`：
  - 深度优先后序重排，保证父级表达式先定位再重排子级；
  - 未列入 map 的容器（没有可编辑子区块）不改变；
  - 任何缺失/重复/未知 id 或深度变化 → 拒绝并可重试。
- 根层行为与旧 `targetOrder` 完全一致（旧请求仍走现有路径，做向后兼容适配）。

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

### 7.4 新增区块

- v1：**复制现有区块**是唯一的“新增”方式（duplicate 后可再编辑内容）。
- M4-4 再评估模型生成空白区块：客户端在目标容器上点“添加区块” → 编辑请求带 `additions:[{parentId,index,instruction}]`，模型返回新表达式，Host 插入并记录 Revision；需要新的模型协议与失败恢复。
- 不在 v1 提供“空白区块”本地创建（会绕开模型/组件目录约束）。

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
- **M4-1 最小嵌套垂直切片**：仅 Col/Card；嵌套选择/内容编辑；Host 嵌套 splice；精确 overlay；E2E。
- **M4-2 同父层级排序**：slotKey + 树形编排；Host 重建；旧 targetOrder 兼容。
- **M4-3 受限结构操作**：Delete → Duplicate → 同父 Move → 跨容器 Move；Host 权威 base program + operationId 幂等 + CAS；本地卡片缓存 + Host 恢复；并发/失败隔离；真机验证。
- **M4-4 按容器能力扩展**：Row/Box/Grid/Section/Carousel；模型新增区块（若 owner 后续要）；可视化 diff（可选）。
- **M4-5 收口**：a11y、视觉回归、真实模型 E2E、文档、性能（区块数 60 时的渲染/拖拽）。

每个阶段：Node 测试 + 浏览器 E2E + 真机 + 文档增量，全绿后再进入下一阶段。

## 13. 风险

- **渲染器改动面大**：容器组件审计/包装是最不确定性；先用 1 个容器（Card 或 Col）+ 1 个嵌套区块做 M4-1 垂直切片验证。
- **路径稳定性**：模型重排/重写可能改变内联容器的 children 顺序；Host 必须以显式路径校验，失败时要求模型重试。
- **父/子同时编辑**：禁止规则可避免复杂映射；UI 要清晰提示。
- **本地结构卡片**不走消息/导出链，与本地恢复同样限制；产品需接受。
- **复制语义**：Section anchor/Toc、@Each 局部变量、共享状态可能产生重复 id 或错误引用；v1 限制或显式重写。
- **性能**：60 区块的树/overlay/拖拽；需要虚拟化或限制，先测再定。
- **模型上下文**：嵌套内容编辑的 bundle 可能变大；沿用冻结依赖 + 深度限制。

## 14. 代码触点（预估）

- `src/shared/artifact-blocks.ts`：递归 extraction/tree、层级 reorder、路径 helper。
- `src/shared/artifact-edit.ts`：orderByParent/structure 类型、codec v2、revision meta 嵌套 id。
- `src/lib/render.tsx` / `src/lib/components/block-slot.tsx` / 容器组件：编辑 library 的递归包装。
- `src/client/artifact-edit/{store,contracts,EditPanel,ArtifactEditView,composer}.tsx`：选择树、编排树、结构操作 UI、草稿 v2。
- `src/host/{artifact-edit,artifact-revisions}.ts` 或新 `artifact-structure.ts`：层级校验、结构路由。
- 测试：新增嵌套 fixture（多级 Card/Col）、host/client/浏览器 E2E、真实模型场景。
