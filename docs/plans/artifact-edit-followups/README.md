# Artifact 编辑与编排 — 后续路线图（A/B 清单与 B0 决策）

> **状态：as-planned 路线图；M1、M2 Phase 1、M3、M4-0–M4-5、B2-5、B2-6、B1-5 与 B2-8/B2-9/B2-10 均已实现并提交（M4-5：3970d33；B2-5：54fb145；B2-6：86b436f；B1-5：4c0b4dd；B2-8/9/10 基线：d6ec446）— 2026-11-05。下一步发布（B1-7：版本/CHANGELOG/打包安装验证）。**
> 本文件是路线图与决策记录，不是 as-built 文档。已实现行为以代码与 [架构与行为](../../architecture.md) 为准。
> M1 收口、M2 Phase 1、M3 与 M4-0–M4-5 已提交；当前工作树干净（仅既有未跟踪 `pnpm-lock.yaml`）。窄屏提示是 owner 做出「极小屏不支持」决定后提前实现的，B0-1 已决定**保留**该实现。
> 后续实现（B1/B2 收口项、B2-6）在 owner 明确说「开始」之前不写代码。
>
> **2026-11-04 B0 已拍板**：保留窄屏提示；开放临时样式编辑（先做授权设计）；支持多卡片并行编辑；维持请求上限；允许从旧修订分支；同时扩展嵌套容器与编排增删/复制；做画布实时预览；第一批 B1 收口与 B3-1 区块子程序原型并行。范围因此比最初计划显著变大，见 §4.1 与 §6 里程碑。

## 1. 背景与当前状态

2026-11-04 已完成并提交（M1/M2 Phase 1）；2026-11-05 已提交 M3-1/M3-2、M3-3/M3-4 与 M4-0..M4-3：

- 区块识别、编辑模式、单区块编辑浮窗、多区块请求列表、整体编辑说明、Composer 结构化引用 chip、发送前版本校验、Host 编辑信封解析/校验、Artifact Revision（`<DSH_HOME>/dsh-intelligent-ui-artifacts.json` + 认证查询路由）与修订血缘（`presentationMeta` / `meta.program`）。
- 区块编排：完整顶层区块列表、目标顺序 `targetOrder`、指针拖拽与键盘排序、重置顺序、编辑请求列表条件显示、悬停需求卡、Composer chip 文案随请求形状变化。
- Host 确定性重排：按语句名 → 标题+组件类型 → 唯一标题映射回填 `targetOrder`；映射失败可重试且不写修订。
- unslop 后的「编辑请求」列表视觉；窄屏最小宽度提示（<720px 不支持编辑，B0-1 保留）。
- **M1 收口（2026-11-04）**：确定性 composer chip 引用（刷新后仍可解析；失效引用改为 `stale` + `edit.errorStale`）、失败工具行显示一行原因（≤160 字符，全文在 title，不读参数）、编辑期 15 秒 + 窗口 focus/visibility 静默修订探测。
- **M2 Phase 1（2026-11-04）**：`artifact-block-bundle.ts` 区块片段切片/回填 + `edit_ui_blocks` Host 工具（结果 meta 携带合成 `program`/`title`/`style`/`styleId`）、`render_ui` 对内容修改的回退拒绝、画布实时排序预览。
- **M3-1a/M3-1b（2026-11-05，工作树）**：同一聊天多草稿（最多 6 份有内容草稿、单 active 画布、最多 3 份 attached）、每草稿稳定 `requestId`、每草稿一个 Composer chip（标签 `编辑 {title} · 修订 N · {摘要}`，手动删除 chip 只 detach 不删草稿，800ms 检测后可从草稿切换区重新附加）、右侧「待提交编辑 (N/6)」切换区与非 active 卡片角标；Host 一条消息解析多个 V1 信封（最多 3 个），每会话按 `requestId` 最多 3 条 pending，`edit_ui_blocks` 用 `requestId`/`artifactId`、`render_ui` 用 `editRequestId` 选择，每个请求独立应用/记录修订（无跨 Artifact 事务）。
- **M3-1c（2026-11-05，工作树）**：修订 meta 新增 `requestId`（`render_ui`/`edit_ui_blocks` 两条路径、`presentationMeta` 透传）；发送后的草稿保留为 submitted（最多 12 条未决，含 `requestId`/`submittedAt`）；Turn 关闭时按 `turn.start-5s`…`turn.end` 时间窗口对账——成功项删除，未完成项恢复为 `submitFailed` 的可编辑 detached 草稿（新 `requestId`、清空 `submittedAt`），卡片角标「未完成，草稿已保留」并可重新附加再 Send（不自动重发）。限制：Host pending 仍按 TTL 保留；时间窗口启发式；真实模型部分成功未真机验证。
- **M3-2（2026-11-05，工作树）**：分支编辑——信封 header 支持 `branch: true`，旧修订冲突横幅「从此修订创建新修订」→ branch note → chip 追加「 · 分支」；Host 校验旧 base（记录需同 artifact + revision 匹配，未记录只允许 revision 1）并记录 `latest + 1`，非 branch 仍严格 latest。零模型恢复——新增 `POST /api/intelligent-ui/artifact-restore`（201、400/404/409/413/405 错误码、body ≤300 KiB/15 s）复制旧修订为新修订；客户端 `local-revisions.ts` 把结果存为 localStorage 本地修订卡片（每会话 ≤20、`localRevision` 标记、在触发恢复的 Turn 渲染一次、可继续编辑）。限制：本地卡片不进入 assistant 消息/导出/图片导出/回放链，清存储或换设备丢失；restore 只对非 latest 修订可用；branch 草稿被对账恢复后丢失 branch 标记；真实模型「分支部分失败」未单独验证。
- **M3-3（2026-11-05，工作树）**：草稿持久化（sessionStorage per-tab，键 `dsh-iui-edit-draft:v1:<sessionId>:<baseRevisionId>` + 每会话索引，250ms debounce，每会话 ≤6，懒 hydrate/`flushArtifactDraftPersistence`，刷新后恢复 chip/请求；限制：跨标签不共享、branch/latestRevision/submitFailed/撤销不持久化、超大 program 不持久化）；跨标签软租约（BroadcastChannel `dsh-iui-artifact-edit-tabs:v1`，30s TTL/10s 续租，query 后 claim、接管按钮、横幅；只提示不合并/不阻止编辑，频道不可用无提示，Host 修订校验仍是最终权威）。
- **M3-4（2026-11-05，工作树）**：临时样式结果的区块内容编辑——编辑请求/revision meta 增加可选 `temporaryStyle` 快照（`isStyleSnapshot`、`baseLayout===style`、不与 `styleId` 同用、≤20k）；客户端允许带有效快照的临时卡片进入编辑，serialize 内容编辑请求带快照、不带 styleId，纯排序/纯整体说明在 probe 前返回 `temporary_order` → `edit.errorTemporaryOrder`；Host 记录/投影/回放快照、恢复路由复制快照、`render_ui` 完整程序回退对临时样式保持拒绝。限制：只支持内容编辑；排序/整体说明需已保存/内置样式；无有效快照不可编辑；临时样式未单独真机/真实模型验证（E2E 模拟）。M3 四项全部完成，下一步 M4（嵌套/编排增删复制）与 B1/B2 收口。
- **M4-1（2026-11-05，工作树）**：嵌套区块内容编辑——渲染器 `nestedEditLibrary`（Col/Row/Card HOC）+ `OpenUIRenderer.nestedBlockSlots`（默认 false）、`display:contents` + 25 条直接子选择器 CSS 补偿与 `nested-css-contract-check`、几何 E2E；客户端 `nested.ts` CST→display block 映射（root `bN`、嵌套 `bN.M.K`、nodeId/digest）与「嵌套区块」opt-in toggle；信封 edits 带 nodeId/sourceDigest/parentBlockId/depth；Host CST 校验 + `composeNestedEditProgram` 按 selectionOrder 替换节点，all-nested/all-legacy、根层 targetOrder 不变、`editedBlockIds` root-only。限制：opt-in、仅 Col/Row/Card、仅内容 replace、@Each/opaque/共享引用不可编辑、根层顺序不变、混合拒绝、Host 仍以信封 program 为基础（权威 store 属 M4-3）、CSS 补偿层需随组件 CSS 维护。下一步 M4-2 层级排序。
- **M4-2（2026-11-05，工作树）**：层级排序——信封 `orderByParent`（parent → 完整子 nodeId 排列，只发变化组，root `targetOrder` 保持基础顺序）；客户端「嵌套区块编排」同父 pointer drag/grip ↑/↓/Home/End + 重置、`nestedOrder` 状态与 chip「调整区块顺序」；Host `describeOrderByParentProblem`/`applyOrderByParent`（完整排列、chrome/跨父/@Each/共享/opaque 拒绝、root 冲突拒绝、最深优先重建、root group 拥有根顺序、order-only 接受并返回 normalized program、`editedBlockIds` order-only 为 []）。限制：仍 opt-in/不持久化、无画布 live preview、无跨容器移动、order-only 仍需一次模型 render_ui、不要在排序 parent 子树内同时编辑、Host 仍以信封 program 为基础（权威 store 属 M4-3）。下一步 M4-3 受限结构操作。
- **M4-3（2026-11-05，工作树）**：权威 program store + 确定性结构操作——`<DSH_HOME>/dsh-intelligent-ui-programs.json`（≤200 条/50MB LRU）记录每个新 revision program 作为结构 base 唯一来源；`dsh-intelligent-ui-structure-operations.json` 幂等 ledger（operationId+digest；重放 200、不同 body 409）；`POST /api/intelligent-ui/artifact-structure`（201/200、64KiB、CST nodeId/digest/toIndex 校验、delete/duplicate/move 同父批量原子、revision latest+1、style/styleId/temporaryStyle/title 继承、`editedBlockIds` root ids）；客户端编排行复制/两段式删除、`applyArtifactStructure`、本地结构修订卡（kind structure，「结构操作修订」）、structureBusy/Error UI。限制：UI 仅 delete/duplicate（move 无 UI、跨容器未做）；registry 仅覆盖安装后且未淘汰的 revision（base_missing 需重渲染，branch 需 base 在）；本地卡仅 localStorage/触发 Turn（无消息/导出/跨设备）；无 diff/undo/helper GC；Section/Toc/@Each/shared 受限；结构操作与内容编辑不能混合；结构操作直接 markSubmitted 草稿（无过期确认 UI）。下一步 M4-4 容器扩展/模型新增/跨容器/权威恢复收口。
- **B2-8/B2-9/B2-10（2026-11-05，工作树；完成，B2-10 为手动基线）**：B2-8 Article 真机（render_ui style=article → 编辑重排+指令 → Revision 2 仍 article）；free 必须经 On-demand UI（style=free + temporaryStyle）生成，编辑后 Revision 2 仍 temporary/free，**普通 render_ui 传 free 被 Host 拒绝**；B2-9 窄屏 390×844 无横向溢出、Edit 只显示窄屏提示不进入编辑器，900×1000 编辑器可打开无溢出；B2-10 新增 `test/browser/visual-baselines/`（5 PNG + captures.json + SHA256SUMS + README，手动对照无自动像素 diff，环境 macOS/Chrome 156/2x/light，不进包）。计数不变（474/9/180/75/28+5）。下一步发布（B1-7）。
- **B1-5 编辑画布 a11y（2026-11-05，工作树；B1-5 完成）**：单一 polite live region（清空+下一帧+sequence guard）播报根/嵌套重排、addition 保存/移除、move 选择、preview 开关；隐藏拖拽/菜单 hint + `aria-describedby`；移动菜单首焦点/方向键循环/Home/End/Enter/Escape+焦点返回/Tab 关闭；添加表单 aria、嵌套组 `role=group`、`:focus-visible` 焦点环；浏览器 artifact-edit 180 checks、临时 Chrome harness 121 checks。限制：单槽合并快速播报、pointer 仅 drop 播报、Tab 关闭不回焦、隐藏 hint 在树内、无真机 screen-reader/axe 审计、无像素基线。下一步 B2-8/9/10 与发布。
- **B2-6 运行时状态部分保留（2026-11-05，工作树；B2-6 完成）**：`OpenUIRenderer` 可选 `runtimeState`/`onRuntimeStateChange`；新 `runtime-state.ts`（按 artifactId 的 revision-scoped + latest 快照、≤64KiB plain JSON、克隆隔离、24 artifacts/5 revisions 容量、会话内存）；`IntelligentUICards` 恢复+记录、`ArtifactEditView` 冻结 base 快照不写回；单测 13、E2E 175。限制：刷新丢失、容量上限、首渲染不继承、需 baseRevisionId、第三方内部状态/编辑画布交互不保留。真机 ego：DST R7 选中「夏令时」→ 编辑 b2 → R8 仍选中并显示 summer clockNote。下一步 B1/B2 其余收口与发布。
- **B2-5 严格保护（2026-11-05，工作树；B2-5 完成）**：shared strict 字段/header prose；工具栏「严格保护」toggle（默认关、aria-pressed、submitted/error disabled）；store setStrictMode/serialize；Host 在 warnings 后、record/consume 前拒绝未选顶层块改动（`render_ui:`/`edit_ui_blocks:` 前缀、≤3 条摘要、无源码、pending 保留可重试、content-stage 比较避免排序误报）；Host 5 条 strict 测试 + E2E scenario 28。限制：只覆盖识别到的顶层未选块，选中根块内部未选嵌套子节点不检测；strictOff 文案未用；无真机 strict 拒绝路径（Host 单测覆盖）。
- **M4-5 收口 + B2-5 结构 diff 预览（2026-11-05，工作树）**：Host dry-run preview（同 apply 校验/原子操作/最终校验，不写 revision/registry/ledger；200 preview、touched ≤120、changedBlockIds 同口径、同 operationId 后续 apply 只记一次 revision）；客户端 preview 状态/LCS diff/confirm 才 apply；预览模态（duplicate/delete/move）含 `aria-modal`、初始焦点 Cancel、focus trap、Esc/backdrop/焦点返回、disabled、reduced-motion；性能 smoke（49 区块/57 nodes <2s）；视觉守卫仍为几何/排版 E2E。限制：无像素基线/axe 审计、preview 无客户端超时、背景非 inert、**B2-5 内容严格模式未做**、既有 M4 限制不变。真机 ego：R4 复制 Box → 预览 add/remove/same + summary 1 → 确认 → Revision 5。M4-5 完成，B2-5 部分完成。
- **M4-4（2026-11-05，工作树；已完成）**：容器扩展——shared `artifact-containers.ts` 单一来源（Col/Row/Box/Grid/Card/Section/Carousel）、program-cst 容器 children 参数映射（Section 为第 2 参数）、renderer 自动覆盖、CSS 补偿 28 direct + 5 scoped、7 类容器/18 slots 几何 E2E（Carousel 滚动/overlay；离屏 anchor 裁剪未做）；引擎基础——`insertNode` 与跨容器 `moveNode`（18 engine tests）。additions 全链路（模型新增区块）与跨容器 move 已接入：嵌套组「添加区块」→ 一次模型 `edit_ui_blocks` → 新修订；编排 row「移动到…」→ 零模型结构路由 → 本地结构修订卡。限制：additions 与 orderByParent 不能同请求；root 不作跨容器目标；Carousel 离屏 anchor 未裁剪；无 diff/undo/GC；跨容器只 append；每容器 v1 一个 addition；base_missing 仅内联提示；本地结构卡仅 localStorage/触发 Turn；additions 依赖 fragment 顺序。真机 ego：Box/Grid/Section 识别 + Grid 复制 R2、Box 新增 R3、移动至 Grid R4。M4-4 完成；M4-5/B2-5 见上。
- 真机验证（M3-1，Lead，隔离 DSH 实例）：两张卡、两个 chip、一次 Send、模型两次 `edit_ui_blocks`、Revision 3 与 Revision 2 同时落卡；M3-2：旧 Revision 2 restore → 本地 Revision 7（无模型调用、只渲染一次），旧 Revision 2 branch → 「latest is 5」→ 模型生成 Revision 6（base 旧修订）；M3-3：两个标签页同一 session 出现租约横幅/接管，保存草稿后 Reload 恢复 chip `Edit 夏令时与冬令时 · Revision 7 · 1 changes` 与卡片草稿角标。详见 `docs/plans/artifact-edit-m3/README.md` §0.1–§0.4。仍未跑纯排序真实模型回合；真实模型的「部分成功」路径未真机验证（E2E 用 harness 模拟 Turn 关闭/部分完成）。

规模：区块编辑/编排相关新增源码 5,574 行（含编辑态 CSS）、特性测试 1,903 行（含浏览器套件）；M3-3/M3-4 工作树增量：约 20 个已跟踪文件，新增 `tabs.ts`/`test/client/edit-tabs.test.mjs`，另有临时样式契约/记录/客户端编辑改动。Node 测试 **383/383**（Host 174、Client 188、packaging 21；九个特性测试文件合计 134）；浏览器 8 套件通过（artifact-edit 121 checks），packaging 21/21。

## 2. 已记录的产品决定

| 编号 | 日期 | 决定 | 状态 |
| --- | --- | --- | --- |
| D-1 | 2026-11-04 | 极小屏不支持"画布 + 面板并排"；检测到窗口过小直接提示用户加宽窗口或改用大屏，不提供降级编辑布局 | 已决定；实现保留（B0-1） |
| D-2 | 2026-11-04 | 临时样式结果开放区块编辑，先做授权设计：base snapshot 纳入编辑请求 + Host 校验复用 | 已实现 M3-4（工作树）：内容编辑携带快照，排序/整体说明需已保存/内置样式 |
| D-3 | 2026-11-04 | 支持多卡片并行编辑 | 已实现 M3-1a/M3-1b（已提交）与 M3-1c（工作树，2026-11-05） |
| D-4 | 2026-11-04 | 维持当前请求上限（12 / 2000 / 4000 / 100 / 200k） | 已决定 |
| D-5 | 2026-11-04 | 允许从旧修订分支生成新修订 | 已实现 M3-2（工作树）：`branch:true` + 旧 base 校验 + `latest+1` 修订 |
| D-6 | 2026-11-04 | 可编辑粒度扩展嵌套容器；编排支持新增/删除/复制区块；顶层 + 仅重排不再是最终范围 | 已决定，依赖渲染器/协议改造 |
| D-7 | 2026-11-04 | 做画布内实时重排预览 | 已决定 |
| D-8 | 2026-11-04 | 第一批 B1 收口与 B3-1 区块子程序原型并行推进 | 已决定 |

## 3. A. 真的做不了（当前架构内不可行）

1. **不经过模型做通用内容改写**：确定性能力只覆盖排序/移动与文本级替换；语义改写必须由模型参与。
2. **语义等价校验**：OpenUI Lang 没有规范等价算法；只能结构/文本签名近似，严格比对会误杀合法的关联修改。仅对"整页返回"模式成立，区块子程序模式可通过"未选区块源码不进入模型"绕过。
3. **没有 Host 时由客户端权威判断最新修订**：版本权威必须在服务端，纯客户端无法跨标签/跨刷新成立。
4. **保证模型输出与下一次生成可预测/逐字节一致**：生成不可控，Host 只能对排序做确定性归一化。

## 4. B0. 已拍板的规则 / 范围（2026-11-04）

| 编号 | 决定 | 状态 | 影响 / 依赖 |
| --- | --- | --- | --- |
| B0-1 | 保留已实现的窄屏提示（<720px 不支持编辑） | 已决定 | 无额外工作；需在最终验收中确认 |
| B0-2 | 开放临时样式结果的区块编辑，先做授权设计 | 已实现 M3-4（工作树） | 内容编辑请求携带 temporaryStyle 快照；Host 校验/记录/回放/恢复复制；纯排序/整体说明不支持 |
| B0-3 | 支持多卡片并行编辑 | 已实现 M3-1a/M3-1b（已提交）+ M3-1c（工作树） | 多草稿 + 单 active 画布 + 每草稿一个 chip + 每会话多 pending + Turn 关闭对账/failed 草稿恢复；设计见 [M3 plan](../artifact-edit-m3/README.md) |
| B0-4 | 维持当前请求上限 | 已决定 | 无 |
| B0-5 | 允许从旧修订分支 | 已实现 M3-2（工作树） | 版本模型扩展为"可指定 base 的分支"：`branch:true` 请求记录 `latest+1` 并以旧修订为 base；非 branch 仍严格 latest |
| B0-6 | 扩展嵌套容器 + 编排新增/删除/复制区块，同时保留顶层能力 | 已决定 | 渲染器需为嵌套节点生成可寻址包装；协议从 targetOrder 扩展为结构操作；Host 校验从"同集合排列"放宽为结构补丁；大工程 |
| B0-7 | 做画布内实时重排预览 | 已决定 | 复用 shared 排序函数；编辑态只读预览与撤销路径；可与 B3-1 合并设计 |
| B0-8 | 第一批 B1 收口与 B3-1 原型并行 | 已决定 | 两条工作流需文件/任务隔离：B1 偏 client 修复，B3-1 偏 shared/host 协议 |

### 4.1 决策对范围的影响

- 最初计划是"顶层区块 + 内容/排序 + 单卡片单修订 + 整页返回模型"。B0 之后目标变为：**多卡片并行、临时样式可编辑、旧修订可分支、嵌套容器可编辑、编排可增删复制、画布可实时预览、区块子程序级编辑**。
- 这已不是单个迭代能完成的范围，建议拆成 4 个里程碑（§6）。其中多卡片并行、旧修订分支、临时样式授权会同时改动"编辑会话状态 + Composer 提交 + 版本路由"，应在同一份设计里解决；嵌套与增删复制会改动"区块身份 + 协议 + Host 校验"，应在 B3-1 协议稳定后再做。
- 在 B3-1（区块子程序编辑）Phase 2 稳定输入侧协议前，嵌套/增删复制仍可能反复改协议；Phase 1（片段回填 + 实时预览）已落地，建议继续按 M2 Phase 2 → M3 → M4 的顺序推进，而不是全部并行开工。

## 5. B. 还没做、但能做（完整后续）

### B1 小工程（把当前功能收口）

- B1-1 刷新后残留 chip 的清理与正确提示（当前 `missing ref` 会阻断发送且文案不准确）。**已完成（M1，2026-11-04）**：chip 引用改为确定性 id，刷新后仍可解析；失效引用返回 `stale` 并显示 `edit.errorStale`。
- B1-2 编辑失败 UI：捕获编辑回合的 tool error / turn 结果，展示横幅 + 重试入口。**已部分完成（M1，2026-11-04）**：失败的 `render_ui`/`edit_ui_blocks` 进程行现在显示一行可读原因（全文在 title）；完整横幅 + 重试入口仍可另做。
- B1-3 编辑过程中的实时版本冲突提示（不必等到发送才发现过期）。**已完成（M1，2026-11-04）**：编辑期 15 秒 + 窗口 focus/visibility 的静默修订探测，只在冲突时显示现有冲突横幅。
- B1-4 多步 undo/redo（当前只有最近一次删除的 inline undo）。
- B1-5 拖拽无障碍：live region 播报、完整键盘焦点走查。
- B1-6 历史验证文档追加本轮证据（历史类文档，不改写旧记录）。
- B1-7 提交拆分、版本号 bump、发布流程。

### B2 中等工程

- B2-1 真机验收：重启后确认 unslop 列表与编排；跑通"纯排序 → 真实模型生成修订"回合（上次被会话所有权挡住）。**部分完成（2026-11-04/05）**：隔离 DSH 实例上单卡内容编辑 → `edit_ui_blocks` → revision 2，以及 M3-1 双卡/双 chip/一次 Send 两次 `edit_ui_blocks` → Revision 3 + Revision 2 均已通过（见 §1 与 M3 plan §0.1）；纯排序真实模型回合与真实模型「部分成功」路径仍未跑。
- B2-2 一键恢复旧修订 / 版本对比视图。**一键恢复已完成（M3-2，工作树）**：非 latest 修订可零模型恢复为本地修订卡片（Host POST 恢复路由 + localStorage 本地卡片，不进入导出/消息历史）；版本对比视图仍未做。
- B2-3 编辑草稿持久化 + 多标签协调（加锁/冲突提示；不做自动语义合并）。**已完成（M3-3，工作树）**：sessionStorage per-tab 草稿持久化 + BroadcastChannel 软租约（仅提示/接管，不合并）。
- B2-4 已淘汰卡片编辑：Host 从会话日志恢复程序后下发。
- B2-5 未选区块校验升级为可选严格模式 + diff 预览（当前仅 warning）。
- B2-6 编辑后运行时状态部分保留（`$state` / 表单初始值快照；第三方组件内部状态明确不保留）。
- B2-7 token / 日志成本优化（信封程序引用化、避免 `meta.program` 全文重复）。**Phase 1 部分完成（M2，2026-11-04）**：模型输出已只返回选中区块片段；输入侧 Phase 1 仍传整页，节省留到 Phase 2（Host 程序缓存 / 客户端上下文路由）。
- B2-8 Article / free 布局的真机编排验证。**已完成（2026-11-05）**：Article 编辑后仍 article；free 需 On-demand UI，编辑后仍 temporary/free。
- B2-9 移动端真机手势 / 窄屏回归（配合 D-1）。**已完成（2026-11-05）**：390×844 无横向溢出 + 窄屏提示；900×1000 编辑器可用。
- B2-10 视觉回归截图基线（unslop 后尤其需要）。**已完成（2026-11-05，手动基线）**：`test/browser/visual-baselines/` 5 PNG + captures.json + SHA256SUMS + README，无自动像素 diff。

### B3 大工程（需要改协议/渲染器）

- B3-1 **区块子程序编辑管线**（owner 2026-11-04 提议）：只把选中区块的 OpenUI Lang 子程序 + 冻结依赖 + 页面大纲交给模型，模型只返回新区块片段，Host 校验后回填；未选区块源码逐字节不动，同时节省 token。需要：依赖切片/闭包、冻结依赖与命名空间、回填与校验、Toc/状态同步、失败回退整页模式。**Phase 1 已完成（M2，2026-11-04）**：见 §1、§6.2；Phase 2 待做输入侧 token 节省与失败回退细化。
- B3-2 局部 patch 协议：模型返回补丁、Host 应用（可与 B3-1 合并）。
- B3-3 嵌套区块编辑/排序：渲染器为嵌套节点生成可寻址包装 + 身份/跨容器规则。
- B3-4 编排层新增/删除/复制区块：`targetOrder` 扩展为结构操作 + Host 校验 + 模型契约。
- B3-5 真实模型 E2E 自动化（成本/稳定性问题，但可做）。
- B3-6 多用户 / 共享会话权限隔离（超出当前单用户假设）。
- B3-7 多标签自动无冲突合并（若坚持要自动合并；否则用 B2-3 的加锁/检测）。

## 6. 里程碑与建议顺序（B0 后）

### M1 — 收口（已完成 2026-11-04）
范围：B1-1 残留 chip → B1-2 编辑失败 UI → B1-3 实时冲突提示 → B2-1 真机验收（重启后 unslop/编排 + 纯排序真实模型回合）。
交付：B1-1/B1-3 完成、B1-2 完成进程行原因（完整横幅/重试入口仍可另做）；内容编辑真机回合已通过。纯排序真实模型回合仍未跑，保持"未验证"；编辑协议未变。

### M2 — 区块子程序编辑 + 实时预览（Phase 1 已完成 2026-11-04；Phase 2 待做）
范围：B3-1 依赖切片/冻结依赖/回填/校验/回退整页；B0-7 画布内实时重排预览；B3-2 局部 patch 协议在原型中一并验证。
Phase 1 交付（已完成）：
- `artifact-block-bundle.ts`：`extractBlockBundle` 切片选中区块表达式 + 传递冻结语句/`$state` + 页面 outline；`spliceBlockBundle` 只替换选中的根子节点槽位，其余区块/chrome/根参数/基础语句逐字节不变，追加新辅助语句，拒绝重名/未定义引用/数量不符，组合后重新解析校验。
- Host `edit_ui_blocks` 工具 + `render_ui` 回退分流；结果 meta 携带合成 `program`/`title`/`style`/`styleId`，客户端从 meta 渲染修订卡片（`programs.ts::blockEditProgram`）。
- 画布实时排序预览（复用 shared 排序函数，工具栏「预览目标顺序」）。
- M1 收口与 M2 Phase 1 并行完成，Node 321/321、浏览器 artifact-edit 77 checks。

### M2 Phase 1 验证记录（2026-11-04，非历史 docs/verification；M3-1 后最新数据见 §1 与 [M3 plan §0.1](../artifact-edit-m3/README.md#01-m3-1-验证记录2026-11-05工作树)）
- 构建：host 727.0 kB、client 3.79 MB（js 3.62 + css 168.9 kB）、standalone 3.29 MB + 509.5 kB；pack 43 files ≈3.95 MB / 10.12 MB。
- Node 321/321（Host 152、Client 148、packaging 21；五个特性测试文件合计 72）；浏览器 8/8 套件，`artifact-edit e2e: 77 checks passed`；renderer 42/42 + 42/42、CSS 50/50、prop 63/63、typography 22/22、i18n 4。
- 真机（隔离第二个 DSH 实例、参考会话、显式 `/iui on`）：对时钟区块做一次内容编辑，模型调用 `edit_ui_blocks`，Host 返回 revision 2，新卡片渲染数字时钟 + 日期；未选中的基础语句逐字节不变（仅 `clockCard` 槽位被替换 + 新增辅助语句），Revision 1 卡片保留；发送前画布实时预览了目标顺序。
- 未验证：纯排序真实模型回合（仍未跑）；Phase 2 的输入 token 节省。

Phase 2（待做）：输入 token 节省（Host 程序缓存 / 客户端上下文路由，避免信封内整页）、失败回退整页模式的细化；之后按 §6 M3 → M4 推进。

### M3 — 会话与版本模型（全部完成：M3-1a/b/c、M3-2、M3-3、M3-4）
范围：B0-2 临时样式授权设计；B0-3 多卡片并行；B0-5 旧修订分支；B2-2 一键恢复；B2-3 草稿持久化与多标签协调；B2-4 已淘汰卡片编辑。
交付：**M3-1a/M3-1b/M3-1c、M3-2 已提交；M3-3、M3-4 已在工作树实现（2026-11-05），M3 全部完成**，验收数据见 [M3 plan §0.1–§0.4](../artifact-edit-m3/README.md#01-m3-1-验证记录2026-11-05工作树) 与 §3.6/§4/§5/§6；限制（localStorage 本地卡片不进入导出/消息历史、sessionStorage 仅同标签、租约仅提示不合并、临时样式只支持内容编辑且未单独真机/真实模型验证）见 §1/§4/§5/§6。
说明：M3 已完整落地多卡片主轴、部分失败对账、分支与恢复、草稿持久化与软租约、临时样式内容编辑；下一步 M4（嵌套容器、编排增删复制）与 B1/B2 收口项（a11y、视觉回归、真机验收记录、发布）。M4 会再次改动"编辑会话 + 提交 + 版本"共享状态，按 M3 plan §8 推进。

### M4 — 结构扩展（M4-0–M4-5 全部完成；B2-5/B2-6/B1-5 完成）
范围：B0-6 嵌套容器可编辑 + 编排新增/删除/复制；B3-3 嵌套渲染器包装；B3-4 结构补丁协议与 Host 校验；B2-5 严格校验 + diff 预览；B2-6 运行态部分保留。
交付：**M4-0–M4-3 已完成并提交；M4-4 第一阶段（7 类容器扩展 + `insertNode`/跨容器 `moveNode` 引擎基础）已完成（工作树未提交，2026-11-05）**，验收见 [M4 plan §0.3–§0.6](../artifact-edit-m4/README.md)。**M4-4 已完成（容器扩展 + 模型新增区块 + 跨容器移动）；M4-5 已完成（结构操作 diff 预览 + a11y/性能 smoke）；B2-5 完成（结构 diff 预览 + 严格保护）；B2-6 完成（运行时状态部分保留）；B1-5 完成（编辑画布 a11y）；B2-8/B2-9/B2-10 完成（真机验证 + 手动视觉基线）。下一步发布（B1-7：版本/CHANGELOG/打包安装验证）。**
交付标准：嵌套节点可选可排；增删复制有协议与校验；未选区块保护仍成立；渲染器/导出/回放兼容。

### 贯穿（每批完成时）
B1-5 拖拽 a11y、B2-8 Article/free 真机、B2-9 移动端回归、B2-10 视觉基线、B1-6 验证文档、B1-7 提交/发版、B3-5 真实模型 E2E 自动化。

## 7. 工作树状态（摘要）

已提交基线：M1 收口、M2 Phase 1、M3、M4-0/M4-1/M4-2/M4-3（M4-3：`f4d296f` feat + `70fae30` docs，含 `src/host/artifact-structure.ts`、`src/shared/artifact-structure.ts`、结构路由/registry/ledger、客户端复制/两段式删除与本地结构卡、15 条 host 结构测试与 143 checks E2E）。
当前工作树未提交（M4-4 第一阶段）：`src/shared/artifact-containers.ts`（新，7 类容器白名单）、`src/shared/program-cst.ts`（容器参数映射 + `insertNode`/跨容器 `moveNode`）、`src/shared/artifact-edit.ts`（`additions` schema，未接入）、`src/lib/{library.ts,components/nested-edit.css}`、`src/client/artifact-edit/nested.ts`、`src/host/{artifact-edit,artifact-structure}.ts`、`test/client/program-cst.test.mjs`（+6）、`test/browser/{artifact-edit.e2e.mjs,nested-edit-renderer.e2e.mjs}`、`test/browser/fixtures/nested-containers.ts`（新）、`test/renderer/nested-css-contract-check.mjs`，以及文档。构建产物 `lib/` 已生成（gitignored）；当前树 Node 474/474、浏览器 artifact-edit 180 checks + nested-edit-renderer 75 checks；M4-5、B2-5、B2-6、B1-5、B2-8/9/10 均完成。

## 8. 已知风险（与 A/B 的关系）

- 残留 chip / 失败 UI / 实时冲突已随 M1（2026-11-04）处理；真实体验风险主要在 Phase 2 的输入 token 成本与新协议扩展。
- 多卡片并行（M3-1）让每条消息最多带 3 个完整页面上下文，token 成本需用真实模型观测；各请求独立提交意味着可能部分成功；M3-1c 已提供 Turn 关闭对账与「未完成，草稿已保留」恢复，但没有自动重发，Host pending 仅按 TTL 保留，turn 归属依赖时间窗口启发式，真实模型的部分成功路径未真机验证。
- 分支与本地恢复（M3-2）：分支让「latest」与卡片显示的 revision 分离（branch note 说明），且 branch 草稿被对账恢复后丢失 branch 标记，真实模型“分支部分失败”未单独验证；本地修订卡片只存 localStorage，不进入 assistant 消息/导出/图片导出/回放链，清存储/换设备会丢失，restore 仅对非 latest 修订可用。
- Host 确定性排序依赖语句名/标题映射，模型大改命名会触发重试（B3-1 可进一步缓解）。
- 未选区块改动目前仅 warning（B2-5 决定是否升级）。
- 草稿持久化/多标签（M3-3）：sessionStorage 仅同标签页、跨标签不共享；branch/submitFailed/撤销不持久化；软租约仅提示、不合并/不阻止编辑，频道不可用时无提示；Host 修订校验仍是最终权威。
- 临时样式编辑（M3-4）：只支持内容编辑；排序/整体说明需已保存/内置样式（客户端与 Host 双重拒绝）；无有效快照不可编辑；未单独真机/真实模型验证。
- 嵌套区块编辑（M4-1）：opt-in、仅 Col/Row/Card、仅内容 replace；@Each/opaque/共享引用不可编辑；根层 targetOrder 不变；all-nested/all-legacy；`editedBlockIds` 仍为 root id；Host 仍以信封 program 为基础（权威 program store 属 M4-3）；`display:contents` 依赖 25 条 CSS 补偿层；真机只验证单个嵌套文本替换。
- 层级排序（M4-2）：仍 opt-in/不持久化；无画布 live preview；无跨容器移动；order-only 仍需一次模型 render_ui（非零模型）；排序 parent 子树不能同时内容编辑；`editedBlockIds` order-only 为 []；真机只验证单容器两段文本换序。
- 结构操作（M4-3）：UI 仅 delete/duplicate（move 无 UI、跨容器引擎已支持但 UI 未做）；权威 program 注册表仅覆盖安装后且未淘汰的 revision（base_missing 需重渲染；branch 需 base 在）；本地结构卡仅 localStorage/触发 Turn，无消息/导出/跨设备；无 diff/undo/helper GC；Section/Toc/@Each/shared 受限；结构操作与内容编辑不能混合；结构操作直接 markSubmitted 草稿（无过期确认 UI）。
- B2-8/9/10：free 仅 On-demand/授权模板；视觉基线为手动对照、环境敏感、无自动像素 diff；窄屏仅验证两个视口。
- B1-5：live region 单槽合并快速播报；pointer 仅 drop 播报；Tab 关闭菜单不回焦；隐藏 hint 在可访问性树；无真机 screen-reader/axe 审计；无像素基线（B2-10）。
- B2-6：运行时状态快照仅会话内存、刷新丢失；容量 24/5/64KiB；首渲染不继承、需 baseRevisionId；第三方内部状态/编辑画布交互不保留。
- M4-5/B2-5：无像素级视觉快照基线、无完整 screen-reader/axe 审计；preview loading 无客户端超时；模态背景非 inert/aria-hidden；严格保护只覆盖识别到的顶层未选块（选中根块内部未选嵌套子节点不检测），strictOff 文案未用，严格拒绝路径无真机验证。
- M4-4：additions 依赖模型严格 fragment 顺序（edits→additions、children 数），失败需重试；additions 与 orderByParent 分开发送；root 不作跨容器目标；Carousel 离屏 anchor 未裁剪；跨容器移动只 append、无位置选择；每容器 v1 一个 addition；base_missing 无旧卡恢复提示；无结构 diff/undo/GC；本地结构卡仅 localStorage/触发 Turn。
- 大请求 token / 日志成本：输出侧已由区块片段降低，输入侧仍传整页（Phase 2、B3-1）。
- 重启运行中的 `dsh-web` 才能看到新 client bundle；当前 profile 与仓库 `lib/` 为硬链接。
- 大 diff 未提交，评审与合并需要按模块拆分。

## 9. 决策记录（待 owner 填写）

| 日期 | 决定 | 备注 |
| --- | --- | --- | --- |
| 2026-11-04 | B0-1 保留窄屏提示；B0-2 开放临时样式（先设计）；B0-3 多卡片并行；B0-4 维持上限；B0-5 允许旧修订分支；B0-6 扩展嵌套 + 编排增删复制；B0-7 实时预览；B0-8 第一批并行 | 由 owner 在 B0 问答中确认；M1 与 M2 Phase 1 已于同日落地并已提交；B0-2/5/6 仍待设计 |
| 2026-11-05 | M3-1 多卡片并行按 GPT 外部设计主干落地为 v1：多草稿 + 单 active 画布 + 多 chip + 每会话多 pending + requestId 选择器；不引入 V2 复合信封；无跨 Artifact 事务 | M3-1a/b/c 已提交；纯排序真实模型回合未跑 |
| 2026-11-05 | M3-2 旧修订分支 + 零模型本地恢复落地：`branch:true` 旧 base 分支（Host 记录 latest+1）、`POST /api/intelligent-ui/artifact-restore`、localStorage 本地修订卡片（不进入导出/消息历史、仅非 latest 可恢复） | 工作树未提交；branch 失败后不保留标记；真实模型分支部分失败未验证 |
| 2026-11-05 | M3-1c 落地客户端 Turn 关闭对账：修订 meta requestId、submitted 草稿保留（≤12）、未完成项恢复为 failed 可附加草稿；不自动重发 | 工作树未提交；Host pending 仍按 TTL；时间窗口启发式与真实模型部分成功待验证 |
| 2026-11-05 | M3-3 草稿持久化 + 跨标签软租约落地：sessionStorage per-tab 草稿（懒 hydrate/清理/上限 6）、BroadcastChannel lease（30s TTL/10s 续租、query→claim、takeover 横幅）；租约仅提示不合并 | 工作树未提交；跨标签不共享草稿；branch 标记不恢复；真实设备/极端并发未验证 |
| 2026-11-05 | M3-4 临时样式内容编辑落地：请求/meta/record 可选 `temporaryStyle` 快照（≤20k、不与 styleId 同用）、客户端只允许内容编辑、Host 记录/回放/恢复复制、`render_ui` 回退拒绝排序/整体说明 | 工作树未提交；M3 全部完成；临时样式未单独真机/真实模型验证 |
| 2026-11-05 | M4-1 嵌套区块内容编辑落地：Col/Row/Card opt-in、CST nodeId/digest 身份、渲染器 nestedEditLibrary + CSS 补偿、Host 嵌套校验/替换、all-nested/all-legacy、根层 targetOrder 不变 | 已提交；M4 进行中 |
| 2026-11-05 | M4-2 层级排序落地：`orderByParent`（单 children slot、完整排列、只发变化组）、客户端同父编排 UI、Host 最深优先重建 + root/legacy 兼容、order-only meta | 已提交 |
| 2026-11-05 | M4-3 权威 program store + 确定性结构操作落地：programs registry（≤200/50MB LRU）+ 幂等 ledger + `POST artifact-structure`（delete/duplicate/move 同父批量原子、revision latest+1、CST 校验）、客户端复制/两段式删除与本地结构修订卡 | 已提交 |
| 2026-11-05 | M4-4 第一阶段：7 类容器白名单/渲染/CSS 补偿（28+5）/几何 E2E、Section children 参数映射、`insertNode`/跨容器 `moveNode` 引擎基础 | 已提交 |
| 2026-11-05 | M4-4 完成：模型新增区块（additions 全链路、fragment 顺序、每容器 1 个）、跨容器 move（结构操作 `toParentNodeId`、追加位置、UI「移动到…」菜单）、结构错误内联提示 | 已提交 |
| 2026-11-05 | M4-5 收口：结构操作 preview 模态/a11y/性能 smoke | 工作树未提交；M4 全部完成 |
| 2026-11-05 | B2-5 完成：结构 diff 预览 + 未选区块严格保护（strict 字段/工具栏 toggle/Host 拒绝点/content-stage 比较） | 工作树未提交；B2-5 完成 |
| 2026-11-05 | B2-6 完成：运行时状态部分保留（Renderer runtimeState props + revision-scoped/有界/克隆隔离快照 + 卡片恢复记录、编辑画布冻结） | 工作树未提交；B2-6 完成 |
| 2026-11-05 | B1-5 完成：编辑画布 a11y（live region 播报、菜单键盘/焦点、hint/describedby、组/表单语义、focus-visible） | 工作树未提交；B1-5 完成 |
| 2026-11-05 | B2-8/B2-9/B2-10 完成：Article/free 真机、窄屏 390/900 验证、手动视觉基线目录 | 工作树未提交；B2-10 为手动基线（无自动像素 diff）；下一步发布 B1-7 |
