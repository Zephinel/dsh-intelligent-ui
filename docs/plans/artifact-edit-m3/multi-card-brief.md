# 外部设计 brief：Artifact 多卡片并行编辑

> 用途：交给 GPT/外部设计者，产出一份可评审的交互 + 技术设计。把本文完整粘贴即可，不需要访问仓库。
> 产品：DeepSeek Harness（DSH）Web GUI 的扩展 `dsh-intelligent-ui`（Intelligent UI / render_ui Artifact）。
> 现状基线：单卡片编辑、区块编排、区块片段编辑（Phase 1）已实现并有测试；本轮要设计的是「多卡片并行编辑」。

## 1. 背景（产品是什么）

DSH 是一个本地/自托管的 AI 对话工作台。开启 Intelligent UI 后，模型可以调用 `render_ui` 工具，返回一段 OpenUI Lang 程序（`root = Col([...])`），前端把它渲染成对话里的一张 Artifact 卡片（可含图表、表格、表单、地图、SVG 等真实交互组件）。卡片不是 Markdown/HTML，而是 OpenUI Lang 渲染结果。

2026-11 已上线「Artifact 区块编辑」：

- 已渲染卡片有「编辑」入口；进入编辑模式后，卡片变成只读画布（每个顶层区块可点选），右侧出现「Artifact 编辑器」面板。
- 用户可为每个区块写修改说明（保存后成为带编号的请求），调整顶层区块顺序（`targetOrder`），写整体说明；Composer 中出现一个结构化引用 chip，正常发送。
- 模型只返回被选中区块的片段（`edit_ui_blocks` 工具，迷你程序 `root = Col([...])`），Host 把片段拼回原页面、做确定性排序、记录新修订（`revision N`），原卡片保留，新卡片渲染更新后的页面。未选区块的源码逐字节不变。
- 纯排序 / 仅整体说明的请求仍走 `render_ui` 返回完整程序的旧路径。
- 有修订注册表与冲突检查：编辑基于某修订；若已有更新修订，发送被阻止。

现在要做 M3：**多卡片并行编辑**。

## 2. 当前单卡片实现（必须理解的约束）

### 2.1 客户端编辑会话

- 编辑会话 key = `${sessionId}:${baseRevisionId}`。
- 会话字段：`selection[{blockId, order, instruction}]`、`originalOrder`、`targetOrder`、`orderChanged`、`globalInstruction`、`editing`、`activeBlockId`、`activeDraft`、`status(ready/checking/conflict/error/submitted)`、`artifactTitle/style/styleId`。
- 目前 `closeOtherEditors()` 强制同一聊天会话同时只有一个编辑会话处于编辑态。
- Composer 集成：每个编辑会话对应一个引用 chip（`inputTriggers` source `artifact-edit`，ref 形如 `artifact-edit:<sessionId>:<baseRevisionId>`）；store 只把「当前活跃会话」同步成一个 chip；用户手动删除 chip 后会话仍在内存。
- chip 的 codec 在发送时把该会话序列化成一段 model-facing 文本：`<artifact-edit-request>{JSON header}</artifact-edit-request>` + 自然语言规则 + 目标区块列表 + 目标顺序 + 整体说明 + 完整当前程序（Phase 1 仍带完整程序作为只读上下文）。一条消息目前最多出现一个这样的信封。

### 2.2 Host 接收与执行

- Host 观察 user message（session/event 前置观察者），解析信封，校验后 arm 一个 pending edit（按 `sessionId` 存，TTL 15 分钟，最多 64 个会话）。
- 模型随后调用工具：
  - 内容修改：`edit_ui_blocks({ program: "mini program" })` —— 参数里没有 artifact 选择器，隐式作用于该会话唯一 pending。
  - 纯排序/整体说明：`render_ui({ program: "完整程序", ... })`。
- Host 校验 pending、拼接片段、确定性排序、记录 revision、返回结果 meta：`{artifactId, revisionId, baseRevisionId, revision, editedBlockIds, program, title?, style, styleId?}`。
- 客户端从工具结果 meta 提取出新卡片（`Revision N`）。卡片只来自 Turn 内的工具结果；会话里没有「本地插入卡片」的机制（但 M3 已决定为「旧修订恢复」引入本地修订卡片来源）。

### 2.3 限制

- 每个 Artifact 每次最多 12 条区块修改；单条说明 2,000 字、整体说明 4,000 字；`targetOrder` ≤100 区块；程序 ≤200,000 字符。
- 修订注册表按 `artifactId` 线性编号，latest = 最大 `revision`；冲突检查基于「请求的 base 是否 latest」（M3 会加入显式分支）。
- 编辑基于 base 修订的完整程序；Program 由客户端从卡片中取出并放进信封。

### 2.4 已确定的 M3 其他决定（供设计时协同，不在本轮设计范围内）

- 旧修订恢复：**零模型成本的本地修订卡片**（Host 新恢复路由 + 客户端本地卡片来源）。
- 临时样式结果：允许内容编辑，编辑请求携带 Host 封闭校验的样式快照。
- 多标签：软租约 + 提示；不做自动合并。
- 已淘汰卡片：M3 暂缓。

## 3. 本轮要设计什么

目标：用户能同时编辑多张 Artifact 卡片，并用**一次正常 Send** 提交这些编辑（产品已决定支持多卡片并行；不新增发送通道）。

必须回答的设计问题：

### A. 交互模型
- 多张卡片同时「编辑中」如何呈现？推荐候选：多个草稿可存在，但同一时间只有一个画布处于激活态（其余卡片保留草稿、点编辑可切回）；是否可接受？有更好的方案吗？
- 右侧「Artifact 编辑器」目前是单实例停靠面板。多卡片时：每个卡片各挂一个面板（会重叠）、全局一个面板随激活卡片切换、还是标签页/抽屉？
- 如何让用户一眼看到「哪些卡片还有未发送的编辑」？卡片角标、Composer chips、还是编辑器内的列表？
- 窄屏/移动端（<720px 已不支持编辑）与多卡片如何取舍？
- 同一 Artifact 的两张修订卡片是否允许同时编辑？如果允许，冲突怎么呈现？

### B. Composer / chip 模型
- 每个 Artifact 一个 chip，还是一个聚合 chip（如「编辑 3 个 Artifact」）？各自的删除、重命名、排序、上限、冲突提示怎么做？
- chip 标签如何区分（Artifact 标题、修订号、修改数、排序/整体说明状态）？
- 用户手动删除某个 chip 时，对应草稿怎么处理（保留、丢弃、提示）？
- 多 chip 与普通文本混排、草稿恢复、刷新后的语义。

### C. 发送语义
- 一次 Send 是否可以同时包含多个 Artifact 的编辑请求？每个 Artifact 一个信封，还是一条复合信封？
- 多个请求是「逐个原子应用」还是「全部成功/全部失败」？部分失败（某 Artifact base 过期）时，其他请求怎么办？
- 内容修改、排序、整体说明混合时，哪些组合允许一次发送？哪些必须单独发送？为什么？
- Send 后 UI 状态：草稿清除、chip 清除、失败项的草稿如何保留与重试？
- 成本上限：是否限制每条消息的 Artifact 数量/总字符数？建议值？

### D. 状态模型
- 如何区分「草稿存在」与「画布激活」？编辑会话生命周期（何时创建/关闭/清理）？
- 每个聊天会话最多允许几个草稿、几个激活过？跨聊天是否隔离？
- 刷新/关闭标签页后的恢复（草稿持久化将在 M3 做）；多标签软租约如何参与？
- 撤销/清空/删除 chip 与草稿状态机。

### E. Host 协议
- pending 如何索引：`sessionId → artifactId → request`？一个用户消息多个信封如何 arm、如何防重复、TTL、数量上限？
- 工具参数如何选择 pending：`edit_ui_blocks` 增加 `artifactId`？`render_ui` 回退（排序/整体说明）在多 pending 时如何消歧？给出参数/错误语义。
- 一条消息多个信封的解析/校验/消费顺序；某个信封 invalid 时是否影响其他；模型重试时如何避免错配。
- 幂等与安全：重复发送、同一 pending 被调用两次、客户端伪造 artifactId、超限请求。

### F. 模型提示词/失败模式
- 模型看到 N 个信封时如何组织工具调用（每个 artifact 一次 `edit_ui_blocks`）；如何避免把多个 Artifact 合并进一个片段程序。
- 模型漏调/多调/错配 artifactId 时 Host 的错误文案与客户端呈现。
- token 成本与上下文压力；是否必须在 v1 限制合并数量。

### G. 边界情况矩阵
请列出并给出行为：同一 Artifact 多修订卡片同时编辑；base 过期；分支（M3 计划）；本地恢复卡片参与编辑；chip 被删但草稿在；卡片被滚动出会话窗口；发送时另一标签页更新了修订；模型调用失败/超时；用户切换卡片；撤销、重置顺序、清空全部；两个卡片同一区块 ID；Envelope 超限；重复 Send。

### H. 限制与指标
- 建议的 v1 上限：同时编辑 Artifact 数、每条消息 envelope 数、总字符数、pending 数、草稿数。
- 日志/可观测性：需要记录哪些事件来定位错配和失败？

## 4. 必须遵守的架构约束

1. 不新增消息系统/发送通道；沿用 DSH Composer 的引用 chip + 普通 Send。
2. 不引入 CRDT/OT 或后台协作服务；多标签最多做冲突检测/软锁。
3. 卡片必须能回放/导出；新增的本地修订卡片来源必须纳入回放/导出/图片导出语义（这是 M3 恢复功能的既定方向，可供多卡片复用）。
4. 内容编辑必须保留「未选区块源码逐字节不变」的隔离保证。
5. 需要向后兼容：单卡片、单信封、旧客户端的现有流程不能回归。
6. 不重写编辑器视觉体系；可以扩展布局/状态，但尽量复用现有面板与卡片组件。
7. 所有网络请求/状态必须有失败与恢复路径；不产生静默丢稿。

## 5. 建议的交付物格式

请输出一份 markdown 设计文档，包含：

1. **结论摘要**：推荐方案（1–2 段）与关键理由。
2. **候选方案对比**：至少 2 个交互/传输方案，优缺点、成本、风险，并明确推荐。
3. **UX 流程**：用户从「编辑卡片 A」到「编辑卡片 B」到「一次 Send」的完整步骤；ASCII 流程图/状态机；空态/多草稿/失败态文案建议（中英）。
4. **状态模型**：客户端会话/草稿/激活态/chip 的数据结构与生命周期；Host pending 结构。
5. **协议**：多信封示例、工具参数/返回值、错误码/文案；给出具体 JSON 片段。
6. **边界情况矩阵**：G 中每一项的行为。
7. **上限与配置**：建议值。
8. **分阶段实施计划**：后端/客户端/提示词/测试顺序，每步的验收标准。
9. **风险与开放问题**：明确哪些需要产品再拍板。
10. **测试计划**：单元/浏览器 E2E/真实模型验收。

## 6. 评价标准

- 能保持单卡片流程与隔离保证不回归。
- 多卡片并行的收益（一次提交多个卡片的修改）是否真实成立，而不是把复杂度转嫁给用户。
- 失败隔离：一个 Artifact 失败不拖垮其他。
- Token/上下文成本可控，有明确上限。
- 状态机可测试、可持久化、可恢复。
- 尽量少的新概念；能与既定 M3 的本地卡片/软租约/分支方向协同。

## 7. 已知的当前字段与类型（节选，供设计命名参考）

```ts
// 客户端编辑会话（现状）
interface ArtifactEditSession {
  key: string; sessionId: string; artifactId: string; baseRevisionId: string; baseRevision: number;
  title?: string; style: 'card' | 'article' | 'free'; styleId?: string;
  program: string; wrappedProgram?: string; blocks: ArtifactBlock[];
  originalOrder: string[]; targetOrder: string[]; orderChanged: boolean;
  selection: { blockId: string; order: number; instruction: string }[];
  globalInstruction: string; editing: boolean; activeBlockId?: string;
  status: 'checking' | 'ready' | 'conflict' | 'error' | 'submitted';
}

// 编辑信封 header（现状，节选）
interface ArtifactEditRequest {
  schemaVersion: 1; artifactId: string; baseRevisionId: string; baseRevision: number;
  title?: string; style: 'card' | 'article' | 'free'; styleId?: string;
  edits: { blockId: string; nodePath: string; originalIndex: number; selectionOrder: number; componentType: string; title?: string; instruction: string }[];
  targetOrder: string[]; orderChanged?: boolean; globalInstruction?: string;
  program: string; // Phase 1 仍随请求发送
}

// Host 工具结果 meta（现状）
interface ArtifactRevisionMeta {
  artifactId: string; revisionId: string; baseRevisionId: string; revision: number;
  editedBlockIds?: string[]; program?: string; title?: string; style?: 'card' | 'article' | 'free'; styleId?: string;
}
```

请开始设计，并明确说明你推荐方案中「一张卡片之外的全局 UI」如何组织。
