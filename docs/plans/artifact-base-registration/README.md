# Artifact 基础登记生命周期（计划与完成记录）

> **状态：已在当前 main 未提交工作树完成（2026-11-07）。** 本计划不属于发布验收；npm `latest` 仍为 `0.5.0`。现有行为以[架构与行为](../../architecture.md)为准，验证输出见[验证记录](../../verification.md) 2026-11-07 条。

## 背景与根因

区块编辑引入了 Host 侧协作状态（权威 program registry、修订 registry、结构 ledger），但「权威程序 registry 出现之前渲染的卡片」没有任何登记路径。同一张旧卡在结构操作、修订历史与恢复里分别表现为 404 `artifact_missing`/`base_missing`、空历史与 `source_missing`，且失败语义分散。

根因：缺少「已渲染内容 → Host 权威状态」的基础登记生命周期，以及统一的 base resolve/失败边界。

## 设计决定（已锁定，不重新设计）

1. **一个登记转换覆盖两种 provenance**：初始锚（`revisionId === artifactId`，首次 render 的 callId；revision 1 只存 program，不写修订记录，记录从 2 开始）与已记录锚（`revisions.get(revisionId)` 存在且属于同一 artifact，用于 program 被 LRU 驱逐后的已记录 revision）；两者都不满足则拒绝（404 `unknown_revision`）。
2. **写一次**：只补缺失的 program，从不覆盖；同 program 幂等 no-op；不同 program 409 `program_conflict`；登记不写修订记录。
3. **不改 restore 路由语义**，不给 revision-status 响应加字段。
4. **不回填、不扫历史**；只在客户端真正使用权威状态时懒登记。
5. **客户端单一 `ensureArtifactBase` 入口**（无 A/B）：打开编辑画布即触发（新/复用/已提交复用草稿）；每个权威操作 await 它；旧 Host 404 → 缓存 `unsupported` 能力并降级；模型路径不变。
6. **接受并记录、不修复的偏差**：登记的初始修订 `createdAt` 变成登记时间；未被权威操作触达的旧卡保持未登记；被 LRU 驱逐的非当前 revision program 客户端无法重建；客户端提交 program 的信任级别与既有 edit envelope / restore 一致（写一次 + 仅当前 revision + 结构校验）。

## 实现

- 共享契约 `src/shared/artifact-base.ts`：路由与 schema 常量、`ArtifactBaseRequest`/`ArtifactBaseSuccess`、严格白名单的 `describeArtifactBaseProblem`、`isArtifactBaseSuccess`；复用 `ARTIFACT_ID_PATTERN` 与从 `artifact-edit.ts` 导出的 bounded-text helper。
- `src/shared/artifact-edit.ts`：导出并文档化 `isInitialRevisionId(artifactId, revisionId)`；导出共享 bounded-text helper。
- Host `src/host/artifact-base.ts`：`registerArtifactBase`（provenance → `Col` 结构校验 → 写一次 → 落盘）、`resolveArtifactBase`（抽出结构路由 base 判断，保持 `artifact_missing`/`base_missing` 文案）、`registerArtifactBaseRoute`（认证先于方法分发、POST-only、content-type、body ≤1 MiB、15s、`no-store`、错误码 400/404/409/413/500/405、从不回显 program）与 disposer；`src/host/index.ts` 接线。
- `src/host/artifact-structure.ts` 改用 `resolveArtifactBase`；`src/host/artifact-revisions.ts` 的 program-only 初始修订特例保持原语义（review 后按用户决定回退，不依赖 `isInitialRevisionId`，不改变 restore 接口语义）。
- 客户端 `src/client/artifact-edit/artifact-base.ts`：`ensureArtifactBase` single-flight + 永久能力缓存；`present`/`registered`/`unsupported`/`failed` 四种结果。
- `src/client/artifact-edit/store.ts`：`ensureBaseForSession`；打开画布触发、结构 preview/apply await；抽出 `structureFailureMessage` 统一 preview/apply/props 失败文案，preview 也解析响应 `error.code`。
- 组件接线：`ArtifactHistory.tsx` 在历史加载与 restore 前 await；`IntelligentUICards.tsx` 在 inline restore 前 await 并传入历史对话框所需 program。
- 文案：`src/shared/locales.ts` 中英同步，补齐可操作的缺失权威程序/卡片记录说明；移除不再使用的 `edit.propsBaseMissing`。

## 验证与完成证据

- `test/host/artifact-base.test.mjs`（14）、`test/client/artifact-base.test.mjs`（7）、`test/client/artifact-edit.test.mjs` 新增 4 条、浏览器 `artifact-edit` 场景 36；Host **257/257**、Client **260/260**、浏览器 **422 checks**（review 修复后最终门禁）。
- 端到端（无模型）：空 `DSH_HOME` + 纯客户端序列 `base(initial)` → 结构 preview/apply **201 revision 2**（`baseRevisionId = callId`）→ 历史含初始与 revision 2 → restore 初始 **201 revision 3**。
- 整合后 `npm run check` 通过（Node **538/538** = Host 257 + Client 260 + packaging 21，renderer 全绿）；早先两条打包 delta 已由 Lead 的截图/计数整合修正。
- 未覆盖：真实模型会话、真实旧 Host 进程、`dsh-web` 重启后的真实 GUI（未获批准重启）。
