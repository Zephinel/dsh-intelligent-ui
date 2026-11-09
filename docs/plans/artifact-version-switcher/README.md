# Artifact 原位版本舞台与「最近任务」版本切换 — 调研与方案

> **状态：as-planned 方案，用户已于 2026-11-09 拍板全部待定项（见 §6「决策记录」），实现尚未开始（未写代码）。** 基线 commit `7f367f9`（worktree `artifact-batch-version-ui`）。证据为仓库相对路径:行；标注 `[DSH]` 的是本机安装的 DSH 平台包（`$(npm root -g)/@deepseek-ai/dsh`）类型/实现，运行中的 GUI 版本未单独核对。
> **启动前置条件（用户决定）**：主 checkout 里另一 session 的未提交改动（`revision-fallbacks.ts`、`ArtifactHistory.tsx` 删除回退、`IntelligentUICards.tsx` 历史入口、`export-data.ts`）合并进 main 之后，从合并后的 main 拉新 worktree 再开始 M1；避免两套「当前显示版本」store 打架。
> 本文不是 as-built 文档；已实现行为以代码与 [架构与行为](../../architecture.md) 为准。

## 1. 结论速览

- **可做**，属于中等偏大的客户端改造；推荐方案不新增 Host 路由、durable 字段或修订枚举值。
- **「原位」没有 DSH API 支持**：不能把卡片渲染到旧 Turn 的位置。`conversation.chat.turnTail` 是每个 Turn 尾部追加的 list slot（[DSH] `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:436-440`），所以「原位」只能理解为：**最初那张卡自己切换渲染内容**。后续修订卡由插件组件自行决定是否渲染（插件返回 null 或一行提示即可，`src/client/IntelligentUICards.tsx:211-240`）。
- **版本条可行**：历史元数据已有 `GET /api/intelligent-ui/artifact-history`（`src/shared/artifact-edit.ts:288`），每个修订的 program 已有按需 `GET .../artifact-history/program`（`src/client/artifact-edit/local-revisions.ts:313`）。版本条**不在打开时实时渲染所有组件**，而是优先显示该修订的小尺寸截图（缩略图）；SnapDOM 已在导出功能里使用（`src/client/export-image.ts:18、246`），同一套 DOM 捕获能力可直接复用。切换版本时再把缩略图以动画过渡为真实渲染。
- **主要风险**：① 原卡所在 Turn 可能不在 DSH 已加载消息窗口（`HISTORY_PAGE_OPTIONS.maxMessages = 500`，翻页窗口最少 50 条消息/2 Turn，[DSH] `@deepseek-ai/dsh-api-session-controller/lib/client.js:2162-2174`；`turnDataSource` 只覆盖 loaded Turns），此时无法原位、按已确认方案回落到下方新建结果卡；② program registry 是 LRU 200 条/50MB（`src/host/artifact-structure.ts:51-54`），旧版本 program 可能永久不可得；③ 抑制后续修订卡会破坏图片导出（按 Turn DOM 找卡）与依赖「N 次编辑 = N 张卡」的现有 E2E；④ 主 checkout 里另一 session 的未提交改动（`revision-fallbacks.ts`、`ArtifactHistory.tsx` 删除回退、`IntelligentUICards.tsx` 历史入口）已经实现了「这张卡当前显示哪一版」的底层原语，**必须先合并并统一成一个 store**，否则会出现三套互相打架的「当前显示版本」。

## 2. 现状：现在编辑到底生成了什么（用户问题的直接回答）

- **不是新 Artifact**：模型 `edit_ui_blocks` 的结果 meta 携带同一 `artifactId` 的整页新 revision（`src/client/programs.ts:94-114`；Host 侧组合与 meta 投射见 `src/host/index.ts:679-698、833-861`）。本次编辑发生在一个**新的 Turn**，而卡片按 Turn 渲染，所以视觉上是「下面新增一张修订卡」。
- **渲染管线**：插件注册一个 `conversation.chat.turnTail` 贡献（`src/client/index.tsx:149-170`），每个 Turn 用 `turnDataSource(turn, 'tool-call')` 读本 Turn 的工具节点，`programsFromToolNodes` 提取 program（`src/client/programs.ts:61-91`），`IntelligentUICards` 为本 Turn 的每个 program 渲染一张卡（`src/client/IntelligentUICards.tsx:126-150、211-240`）。卡的身份：`artifactId`（首个 `render_ui` callId）、`revisionId`、`turn`、`style`、`title`（同文件 `:221、320-322、466-467`）。
- **零模型修订**（结构操作 / 恢复 / 样式切换）走认证路由，客户端把结果存为 localStorage 本地修订卡，只在触发操作的 Turn 渲染一次（`src/client/artifact-edit/local-revisions.ts:1-9、155-173`；`src/client/IntelligentUICards.tsx:144-150`）。它们同样没有消息/导出/跨设备。
- **历史入口**：卡头的 history 图标 + 修订徽章打开的是 **metadata-only 弹窗**，行内动作是「恢复为新修订」（`src/client/IntelligentUICards.tsx:580-602、699-710`；`src/client/artifact-edit/ArtifactHistory.tsx:1-8、292-305`）。当前**不存在**「切换查看某个版本」的概念，只有「以旧版本为基础新建修订」。

## 3. 需求理解（已与用户确认）

- 正常情况下在**最初生成的位置**原位更新（叠一层新版本 + 版本条切换）；如果原卡所在 Turn 已滚出加载窗口、或原卡在窗口里但已在视口很远的上方，则退化为在下方新建一张结果卡（即今天的表现），不强行滚动回去。
- 点历史图标时，像安卓系统「最近任务」那样浮出一排每个版本的小小预览：**优先显示该版本的小尺寸截图**（不在浮层里实时渲染全部组件）；点某个预览 = 舞台切换为该版本，切换时用动画把缩略图过渡成真实渲染。
- 选中旧版本是**只读查看**：不写 Host、不产生新修订。从旧版本继续编辑时走现有 **branch** 语义（`branch: true`，新修订 = latest + 1，不覆盖最新版）。用户 2026-11-09 已确认此语义。

## 4. 可行性与关键约束

### 4.1 原位渲染任意版本

- 舞台卡自己维护 `selectedRevisionId`，用该修订的 program 合成一个 `IntelligentUIProgram` 后交给现有 `OpenUIRenderer`（任意 program 可渲染，`src/lib/render.tsx:140-178`）；编辑 / 历史 / 恢复 / 草稿都以这个合成 program 的身份工作（`openArtifactEditor` 接受任意 program，`src/client/artifact-edit/store.ts:947`）。
- 版本 program 的取法优先级：本 Turn tool result meta（窗口内零网络）→ localStorage 本地修订 → Host 按需 `GET`（`src/client/artifact-edit/local-revisions.ts:313`）。
- 不可得版本：`hasProgram: false`（registry LRU 淘汰、旧安装、Host 状态丢失）→ 缩略图/切换入口显示「内容不可用」（`ArtifactHistory.tsx:136`、`src/host/artifact-revisions.ts:646-651`）。初始修订是 program-only 行，需要 registry 里仍有其 program。

### 4.2 后续修订卡：条件性抑制

- 插件完全可控：同一 `artifactId` 的后续修订，在「活动舞台可见」时只渲染一行 `data-…-revision-notice`（「已更新上方 Artifact · 修订 N」+ 点击滚回舞台卡），不建卡；舞台不可见时（§4.3）则正常渲染为本轮结果卡，并由它接任活动舞台。
- 抑制/静默必须在 Turn 关闭对账**之后**处理，否则 `reconcileArtifactSubmissions` 看不到本 Turn 的 requestId（`src/client/IntelligentUICards.tsx:128-143`）。
- 连带影响：图片导出按 Turn DOM 找卡（`src/client/export-image.ts:66-69、222-224`），当活动舞台在更早 Turn 时需要按活动舞台解析；页面/standalone 导出按消息 program（`src/client/export-data.ts:148-157`），需要决定是否跟随屏幕版本；现有 E2E 有大量「N 次编辑 = N 张卡」断言，需按「舞台可见路径不再建卡」的新语义迁移；卡头的编辑入口/草稿角标跟随活动舞台。

### 4.3 加载窗口与可见性：「活动舞台」+ 不可见就新建（用户方案，已确认）

- 约束：DSH 聊天只渲染已加载的消息窗口（`HISTORY_PAGE_OPTIONS`：最多 500 条消息，翻页窗口最少 50 条消息/2 Turn；跳转页最少 200 条消息，[DSH] `@deepseek-ai/dsh-api-session-controller/lib/client.js:2162-2181`；`turnDataSource` 明确为 loaded Turns）。原卡可能不在窗口内，也可能在窗口内但滚到很远的上方。
- **规则**：
  1. 每个 artifact 在客户端维护一个「活动舞台」指针，初始指向最初生成的那张卡；它渲染该 artifact 当前选中的版本。
  2. 新修订到达时检查活动舞台卡是否在视口附近（`getBoundingClientRect()` 与视口相交，或 IntersectionObserver + 小 rootMargin）：
     - **在** → 原位更新舞台卡，不新增卡、不滚动；
     - **不在**（在窗口内但远上方，或所在 Turn 未加载）→ **不滚动**，直接在本次回复的 Turn 尾部渲染一张新的整卡（即今天的行为，编辑结果总在眼前），并把这张新卡设为新的活动舞台；上方原卡保持它当时显示的版本（卡头已有「修订 N」徽标可区分），并加一行「最新修订已移到下方」的轻提示（已决定加）。
  3. 后续编辑遵循同一规则：活动舞台可见就原位更新，不可见就继续新建；历史卡保留自己的版本，不再被更新。
- 已确认的关联行为：选中版本按 session 记忆、刷新/重开会话回到最新（D6）；旧版本继续编辑沿用现有「冲突横幅 → 从此修订创建新修订」流程，不额外改入口文案（D10）。
- 好处：不需要 DSH 的滚动 / `loadThrough` 能力，也不需要「最早加载卡 = 舞台」那套多卡提示/去重逻辑；任何时刻只有活动舞台跟随最新/选中版本，实现和心智模型都更简单。
- 这取代了之前「后续修订卡一律降级为提示行」的设想：现在只在「舞台可见」时不生成新卡；不可见时生成本轮结果卡，是用户接受的降级。
- 边界：历史卡与活动舞台可以显示不同版本（预期行为，靠修订徽标/版本条区分）；版本条、编辑入口、草稿角标、删除/恢复回退都跟随活动舞台。若活动舞台卡的 program 被 LRU 淘汰等异常，仍按现有错误路径处理。

### 4.4 缩略预览：小尺寸截图（采纳用户方案）

- **来源**：复用已打包的 SnapDOM（`src/client/export-image.ts:18、246`），对卡片元素 `snapdom.toCanvas(card, { scale: 0.25~0.35 })`（SnapDOM 支持 `scale`/`dpr`），得到小图后 `toDataURL('image/webp'|'image/png')` 缓存，版本条只显示 `<img>`——打开浮层时**不渲染任何 Artifact 组件**。
- **采集时机**（按优先级）：① 某修订正在任意已渲染的卡上显示时（活动舞台或本轮结果卡，真实渲染已在 DOM 里，零额外渲染，只截一张）；② 从未在任何卡上显示过的历史版本（功能上线前的旧会话/换设备/用户没切到过的旧版）：打开浮层后对可见项懒采集（离屏容器渲染一次 + 截图），并发限 2–3。截过的都进缓存。
- **缓存（D4 已定）**：IndexedDB 持久化缩略图（Blob），key = artifactId + revisionId + scheme；内存 Map 做热缓存，按 LRU 上限（如 24 张/会话）与删除/清理失效。不放 localStorage（草稿可占 ~1MB，配额易冲突）。
- **主题（D5 已定）**：light/dark 各存一份；只在当前 scheme 下直接截，另一份在切换主题或需要时懒补截，避免一次性双重渲染成本。
- **保真度**：SnapDOM 对刚渲染完的静态 DOM 最可靠；异步媒体（图片搜索、MapLibre WebGL、YouTube iframe、动画图表）可能截到占位/旧帧。缩略图是「尽力而为」：给一个短 settle 预算（约 300–800ms，不阻塞 UI），失败或明显空白时降级为「按比例裁切 + 标题/来源」的卡片式占位，不阻塞版本切换。
- **裁切/比例**：整卡通常很高，版本条按统一高度裁切显示顶部（`object-fit: cover`，`object-position: top`），保留标题与首屏内容作为识别依据。
- **动画**：选中版本时先测量缩略图与舞台卡的矩形，用 FLIP（fixed 浮层 + `transform`）把缩略图放大移动到舞台位置，同时舞台真实渲染在下面淡入完成交接；`prefers-reduced-motion` 时直接切换。这样切换瞬间不会先看到空框。
- **形态与入口（D1/D2/D3 已定）**：版本条为横向「最近任务」卡片（统一高度裁切，默认上限 20 个 + 「更多」）；它是主入口，旧 metadata 历史列表降级为「详细/管理」入口（删除等管理动作仍在列表里），不做两套并存；「恢复为新修订」保留为旧版本行内的次要动作。
- **每项信息（D11 已定）**：修订号 + 来源（初始/编辑/结构/恢复/样式）+ 时间 + 「当前」标记 + 已有待发送草稿的标记。
- **边界**：缩略图只是视觉索引，点击后仍需按 revision program 真实渲染（program 不可得时显示「此修订内容不可用」并禁用选中）；删除修订时清理对应缩略图缓存。单 program 上限 200k 字符、修订记录上限 400（`src/host/artifact-revisions.ts:22`），版本条数量需要有上限（如最近 20 个 + 「更多」）。

### 4.5 与主 checkout 未提交改动的关系

主 checkout 另一 session 的未提交改动（本 worktree 没有）：

- `src/client/artifact-edit/revision-fallbacks.ts`（新增）：localStorage + `useSyncExternalStore`，语义就是「这张卡当前显示哪一版」的客户端覆盖。
- `ArtifactHistory.tsx`：删除当前渲染修订时回退到较新的可用旧修订。
- `IntelligentUICards.tsx`：历史图标与修订徽章合并；卡片用 fallback 重定向内容。
- `export-data.ts`：导出跟随可见卡。

结论：**这些是同一块拼图**。建议先合并该批改动，把 fallback store 升级为统一的 `artifact-version` store（当前选中版本 + fallback + 本地修订），再实现舞台与版本条；否则三套覆盖逻辑会互相打架。

## 5. 推荐分阶段

| 阶段 | 内容 | 复杂度 |
| --- | --- | --- |
| **M1 舞台（含可见性回落）** | 新增版本 store（仿 `local-revisions`/`revision-fallbacks` 的 localStorage + `useSyncExternalStore` 模式）+ 「活动舞台」指针；舞台可见 → 原位更新，不可见 → 本轮新建结果卡并接任舞台（不滚动、不调用 DSH 能力）；版本选择/草稿/编辑入口跟随活动舞台；选中版本按 session 记住（可选持久化） | 中等（约 400–600 行 + 测试） |
| **M2 版本条（截图缩略图）** | 历史入口改为「最近任务」式横向浮层：复用 SnapDOM 截小图 + IndexedDB 持久化缓存（内存热缓存 + LRU）+ 自动/懒采集 + light/dark 双主题缩略图 + 统一裁切、键盘/a11y、不可用占位；选中时 FLIP 动画从缩略图过渡到真实渲染；点选只切换舞台显示，不写 Host | 中偏大（捕获管线 + 缓存 + 动画 + 交互） |
| **M3 收口** | 旧版本继续编辑（branch）、导出/图片导出对齐到舞台当前版本、删除/回退整合、E2E 迁移、真机验证 | 取决于决策 |

不推荐把「portal 浮动层盖住原卡」当主体方案：双渲染、滚动同步脆弱，只适合做版本条的呈现技巧。更远期的方案是把「当前显示版本」交给 Host 保存（跨标签/跨设备一致），但需要新字段/路由并重写导出/E2E，代价最高。

## 6. 决策记录（2026-11-09，用户确认）

### 流程 / 交付

- **A1** 需求 1 提交到分支（已完成：`e22bfcb` 功能、`ead6ac1` 本文档）。
- **A2** 需求 2 的实现基线：**等主 checkout 那批未提交改动合并后**再开始，从合并后的 main 拉新 worktree。
- **A3** 需求 2 在新 worktree/分支实现（建议名 `artifact-version-switcher`）。
- **A4** M1 不再等 M2 细节；合并完成后立即开始。
- **A5** 不部署需求 1 到运行中的 GUI。

### 需求 1 收尾

- **B1** 嵌套区块列表也补批量操作（v1 未做，决定现在补）。
- **B2** 批量结构操作在有未发送草稿时增加确认提示。
- **B3** 批量复制的插入位置按修订页序（接受该限制）。

### 需求 2

- **D1** 版本条为横向「最近任务」卡片；上限默认 20 个。
- **D2** 版本条为主入口；旧 metadata 历史列表降级为「详细/管理」入口，不做两套并存。
- **D3** 保留「恢复为新修订」为旧版本行内的次要动作。
- **D4** 缩略图用 IndexedDB 跨刷新持久化（内存热缓存 + LRU）。
- **D5** light/dark 各存一份缩略图（缺失的一侧懒补截）。
- **D6** 刷新/重开会话后选中版本回到最新。
- **D7** 被冻结的历史卡加「最新修订已移到下方」轻提示。
- **D8** 图片/HTML 导出跟随当前屏幕显示的版本。
- **D9** 缩略图采集：修订显示时自动截 + 未显示过的历史版本懒截。
- **D10** 旧版本继续编辑沿用现有「冲突横幅 → 从此修订创建新修订」。
- **D11** 版本条每项显示：修订号 + 来源 + 时间 + 当前标记 + 待发送草稿标记。

### 唯余外部条件（不是用户决策）

- 主 checkout 那批未提交改动合并进 main（A2 前置条件）。完成后：从合并后的 main 拉新 worktree，先做 M1，再做 M2。

## 7. 主要 blocker 汇总

1. 没有把卡渲染到旧轮位置的 DSH API，只能原卡自更新；「活动舞台 + 可见性回落」已把不可见/未加载场景降级为今天的「下方新建卡」，不再是阻塞点；历史卡与活动舞台可显示不同版本属预期行为（靠修订徽标/版本条区分）。
2. 截图缩略图避免了「打开版本条就渲染 N 个组件」的成本，但 SnapDOM 捕获本身并非零成本；且异步媒体（图片搜索/MapLibre/iframe/动画图表）可能截到占位或旧帧，只能「尽力而为 + 降级占位」，不能像导出那样等 6–12.5 秒 settle。
3. 部分 revision program 永久不可得（LRU 200/50MB、旧安装、清 localStorage）→ 缩略图与切换都要有「内容不可用」态。
4. 抑制修订卡是行为迁移而不是纯样式改动：图片导出、页面导出语义、E2E、编辑入口/草稿角标、选中版本与草稿的关系都要一起改。
5. 与主 checkout 未提交改动的合并顺序已定为前置条件（A2）：合并前不开始 M1，避免两套「当前显示版本」store。
6. 缩略图缓存/主题/裁剪策略有存储与一致性成本，需要在上限内做 LRU 与失效（删除修订、切换主题、清理会话）。
