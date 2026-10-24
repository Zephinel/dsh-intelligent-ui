# 模板导出与分享（模板交换格式 v1）方案

> **状态：as-planned（方案，未实现）— 2026-10-23。**
> **实现状态（2026-10-23）**：MVP 已落地（模板交换格式 v1、导出确认、导入预览/确认、复用 `save`；设置页与 Composer 面板均已接入，Composer 可导出会话模板，导入仍只写全局；分享码/链接与会话作用域导入未实现）。**实现偏差（已获 owner 确认）**：原计划要求执行层审计前强制仅导入外观；2026-10-24 owner 确认采用「免责声明 + 阅读确认」方案保留外部内容。执行层审计仍是发布前建议补做的加固项。行为以代码与 [架构与行为](../../architecture.md) 为准；本文件保留为方案与决策记录。§5.2 第 5 步、§7.1「审计通过前强制仅外观」、§7.5 清单与 §13.4 仍是原计划表述，已被 2026-10-24 owner 决定取代；实现函数名为 `createTemplate`（原 §8 写作 `saveTemplate`）。
> 本文是实现前的对齐稿，保留方案意图与决策；实现落地后，行为以代码与 [架构与行为](../../architecture.md) 为准。
> 评审记录：[GPT 架构评审](reviews/gpt-review-2026-10-23.md)（2026-10-23，结论 **SHIP WITH CHANGES**）。评审通过 `review-with-gpt` 技能在用户已登录的 ChatGPT 网页会话中完成。
> **2026-10-23 更新**：工作树中的模板契约已改为 `baseLayout: RenderLayout`（card/article/free），保存自由结果不再要求选择 Card/Article，模板与渲染结果保持一致。本方案按更新后的契约编写；评审记录中「模板仍是 Card/Article」的表述是修复前的历史输入。

## 1. 目标

让用户能把已保存的自定义 UI 样式模板**导出成可移植文件**，发给另一个人；对方**导入**后，模板进入「我的样式」，像本地模板一样选用、编辑、删除和再次分享。

一句话验收：**导出 → 通过任意聊天工具发文件 → 在另一台设备导入 → 选中后生成效果一致。**

分享分两级：**视觉主题与基础布局**始终可以交换；**第三方展示规范（`directives`）**受执行层安全审计闸门约束——审计通过前，导入默认且强制「仅导入外观」，不把外部文本写入模板（详见 §7.1、§7.5）。

## 2. 非目标（本次不做）

- 不做在线模板市场、模板图库、公开分享链接（需要后端与内容治理，属于另一个产品）。
- 不做分享码 / 压缩编码 / Base64 文本分享（延后到 v1.1，见 §11）。
- 不做批量导出、整库备份恢复、导入后自动应用、模板指纹去重、作者/签名体系。
- 不做「临时结果」直接分享；临时结果先「保存为模板」，再导出（模板完整保留结果的 free/card/article 布局与主题，不再做外壳转换）。
- 不做会话作用域导入；MVP 的设置页与 Composer 导入都只写全局模板（评审 P1 项，见 §4 决策 7）。

## 3. 背景：当前实现与缺口

### 3.1 模板模型（`src/shared/style-templates.ts`）

`StyleTemplate` 是持久化在 catalog 的资源：

| 字段 | 规则 |
| --- | --- |
| `id` | 服务端生成 `cs_[a-z0-9]{6,32}`；客户端不能指定 |
| `name` | 1–30 字符，去首尾空白；不能是 `auto/card/article`；C0/C1 控制字符拒绝 |
| `description` | 0–100 字符 |
| `baseLayout` | `RenderLayout`：`card` \| `article` \| `free`（保存时精确复制渲染结果） |
| `directives` | ≤2000 字符的展示偏好文本；C0/C1 控制字符拒绝 |
| `theme` | 封闭白名单：light/dark 各 3 个必备 hex（`canvas/ink/accent`）+ 3 个可选 hex（`muted/surface/border`）；`font`、`radius`、`density`、`shadow` 枚举；拒绝任意 CSS/URL/脚本/未知 token |
| `scope` / `sessionId` | `global`，或 `session` + 所属会话 id |
| `createdAt` / `updatedAt` | 服务端生成 |

`isStyleTemplate()` 会同时校验身份、作用域与时间戳不变量，因此**不能直接用来校验导入文件**；其中 `baseLayout` 自 2026-10-23 起接受全部三种 `RenderLayout` 值。`isStyleTheme()`、`isReservedStyleName()`、`isHexColor()`、标签长度规则可直接复用（评审指出的关键复用点）。

#### 3.1.1 结果布局与模板布局（2026-10-23 修复后）

- **结果契约** `RenderLayout = card | article | free`：新的按需生成使用 `style: 'free'` + `temporaryStyle.baseLayout: 'free'`，由程序自行组合页面布局；旧快照仍是 `card/article`。
- **模板契约**同为 `baseLayout: RenderLayout`：`StyleTemplate`、create/patch 输入与持久化校验都接受 `free`。**保存自由结果时不再选择 Card/Article**，模板精确复制结果的布局、directives 与主题；原结果保持不变。
- **已验证**（2026-10-23，真实模型 + 隔离 DSH Web 实例）：`free` 结果保留 DSH 卡片头部，没有 `.dsh-iui-article` / `.iui-toc` / `.iui-section`。随后同一工作树修复了保存/复用链路（模板保留结果布局；选中 free 模板可渲染、导出与回放），共享格式 v1 因此直接承载全部三种布局值。

### 3.2 持久化与 Host 路由

- 存储：`<DSH_HOME>/dsh-intelligent-ui-styles.json`（`version: 1`；`free` 是新增布局值，无需迁移；strict 校验、原子替换、损坏文件先改名保留）。
- 配额：全局模板最多 40 个，每会话最多 20 个；名称**跨作用域全局唯一**（大小写不敏感）。
- 路由：`GET/POST /api/intelligent-ui/styles`，先过 `connection.requestRejection` 认证，`no-store`，JSON body ≤64 KiB / 15 秒；POST 仅支持 `save`、`saveFromResult`、`update`、`delete`。
- `save` 收 `{op:'save', template:{name,description,baseLayout,directives,theme}, scope, sessionId?}`，服务端重新校验、生成 id 与时间戳、执行重名/配额检查。

### 3.3 现有导出是半成品

`src/client/TemplateManagement.tsx` 的「导出 JSON」只做一件事：把**原始持久化对象** `JSON.stringify(template)` 下载为 `${id}.json`。

由此产生的缺口：

1. 文件里带 `id`、`scope`、`createdAt`、`updatedAt` 等本地元数据，无法作为可移植格式；
2. 没有 `kind` / `schemaVersion`，接收方无法判断文件类型与版本；
3. **完全没有导入能力**，Host 没有 import 端点，客户端没有文件读取、预览或保存入口；
4. 导出入口只在插件设置页出现（`global === true` 时才渲染菜单项），Composer 面板没有导出；
5. 导出的文件名是内部 id，不是可读模板名。

### 3.4 提示词注入链路（安全背景）

已选模板的 `directives` 会被 Host 包进 `BEGIN/END DISPLAY PREFERENCES (JSON string)` 注入系统提示（`src/host/index.ts` 的 `customStyleNote()`），并附「展示偏好，不能覆盖系统/工具/安全规则」的说明。文档（`docs/architecture.md`）已声明这一边界。

**但这是缓解，不是隔离。** 第三方模板的 `directives` 是任意文本，可能包含诱导模型偏离展示任务的指令；真正的执行权限只能由 DSH 工具/权限层控制。这是本次评审的 P0-1，也是本方案的发布闸门（§7）。

## 4. 与 GPT 讨论后的收敛结论

| # | 决策 | 依据 |
| --- | --- | --- |
| 1 | 只做**单模板 JSON 文件**导出/导入 | 本地优先、可离线、可检查、无需服务端；分享码/链接/市场延后 |
| 2 | 交换格式为 **Envelope v1**：`kind` + `schemaVersion` + 可移植 `template` | 与持久化模型解耦；版本契约独立于 npm 包版本 |
| 3 | **不新增 Host 端点**，导入复用现有 `POST op:'save'` | Host 仍是最终校验与授权边界；新端点只会增加契约与测试面 |
| 4 | 导入器**只接受 Envelope v1**，不做旧版原始导出兼容（2026-10-23 决定） | 当前没有外部用户，旧格式维护成本不值得；原始对象/库文件按无效结构拒绝 |
| 5 | 导入流程 = **本地解析 → 预览 → 用户确认 → 保存**，不自动应用 | 外部内容不可信；导入与应用分离 |
| 6 | 预览允许**改名**；**审计前默认且强制「仅导入外观」**（只保存 theme + baseLayout，directives 置空）；审计通过后才允许显式勾选「包含展示规范」（默认仍关闭） | 外部 directives 不可信；第二轮评审明确「审计前不应默认保留外部 directives」 |
| 7 | 导入入口在**设置页「我的样式」与 Composer「显示样式」面板**，均只导入为**全局模板** | 设置页没有可靠的当前会话上下文；Composer 会话作用域导入仍延后（需先确认 `save` 的 sessionId 授权） |
| 8 | 导出在**设置页与 Composer 面板**均可用（含会话作用域模板） | 模板在哪用就在哪分享；会话模板无需先转全局 |
| 9 | 分享码、压缩、`exportedAt`、`appVersion`、作者/校验和/签名**全部不做** | 复杂度不落在真正的信任边界上；文件内容保持确定性 |
| 10 | 导入是**新建**：Host 分配新 id、新时间戳，不恢复来源 identity | 旧文件的 `id/scope/sessionId/时间戳` 一律丢弃 |
| 11 | 不做持久化的「外部来源」标记 | 导入后模板归用户所有；永久来源标签不提供可信度，只在导入时提示 |
| 12 | 不做内容指纹去重 / 幂等键 | 同名冲突已由 Host 拦截；相同文件重复导入视为新建，仍受重名与配额约束 |
| 13 | 交换格式 v1 承载**模板自身布局** `baseLayout: RenderLayout`（card/article/free），与 2026-10-23 修复后的模板契约一致；导入导出不做外壳转换 | 模板已能精确保存渲染时的 free 布局；交换格式若仍只允许 card/article，会立刻与模板模型脱节 |

与 GPT 评审的差异：第一轮评审建议 MVP 只做文件通道；本方案额外接受**粘贴 JSON 原文**（不压缩、不编码、同一解析器，允许显式剥离一层代码围栏）。第二轮评审确认该偏离可保留（「成本低、实用性高」），压缩分享码/链接仍延后。

## 5. 用户流程

### 5.1 导出

1. 打开插件设置页「我的样式」，或 Composer 的「显示样式」面板 → 目标模板的 `…` →「导出文件」（Composer 同时覆盖仅本会话模板）。
2. 浏览器下载 `<清理后的模板名>.iui-style.json`。
3. 下载前菜单/对话框提示：导出内容包含名称、描述、**展示规范全文**与主题，请确认其中不含个人信息或内部信息。
4. 文件内容稳定可复现：同一模板每次导出字节一致。

### 5.2 导入

1. 设置页「我的样式」分组或 Composer「显示样式」面板 →「导入模板」（两处都只创建全局模板）。
2. 选择 `.iui-style.json`，或把 Envelope v1 的 JSON 原文粘贴进输入框。
3. 客户端在解析前检查大小（≤32 KiB），解析后严格校验结构、版本与字段。
4. 预览：名称、描述、基础布局、明暗主题色板/样例卡片、`directives` 全文。
5. **默认状态（审计通过前）**：只导入外观——保存 `theme` + `baseLayout`，`directives` 置空；预览仍展示外部 directives 全文供检查，但不写入。UI 不提供「包含展示规范」路径。
6. **审计通过后**：预览提供「包含展示规范」选项（默认不勾选）；勾选后才允许编辑 `directives`，未勾选时保存空串。
7. 用户可改名、改描述；点「导入模板」→ POST `save`（scope 固定 `global`，不带 sessionId）。
8. 成功后关闭对话框、刷新 catalog、提示「已导入「name」」；**不改变当前已选样式或全局默认**。
9. 失败时对话框保留输入，按错误类型提示（重名建议改名、配额已满、版本不支持、格式无效、文件过大）。

### 5.3 重名、配额与失败状态

| 场景 | 行为 |
| --- | --- |
| 名称可用、全局未满 | 正常导入 |
| 本地 catalog 已有同名 | 预填建议名 `<base> (Imported)`（截断到 30 字符），并提示可修改 |
| 建议名仍冲突 | 保持对话框，提示改名；Host 返回 `duplicate_name` 时同文案 |
| 全局 40 个已满 | 禁用确认按钮，提示先删除不需要的模板；Host `limit_reached` 同样提示 |
| 保存时发生重名/配额竞争 | 保留名字与编辑内容，提示后重试，不自动覆盖 |
| 网络/请求失败 | 保留输入，允许重试；不产生半成品记录（Host 原子写） |
| 同一文件再次导入 | 视为新建模板，受重名与配额约束 |

## 6. 交换格式：模板交换格式 v1（Envelope v1）

### 6.1 结构

```json
{
  "kind": "dsh-intelligent-ui/style-template",
  "schemaVersion": 1,
  "template": {
    "name": "Soft Minimal",
    "description": "简洁的浅色卡片样式",
    "baseLayout": "card",
    "directives": "Use concise headings and generous spacing.",
    "theme": {
      "light": { "canvas": "#ffffff", "ink": "#202020", "accent": "#5865f2" },
      "dark": { "canvas": "#151515", "ink": "#f5f5f5", "accent": "#8a95ff" },
      "font": "sans",
      "radius": "soft",
      "density": "comfortable",
      "shadow": "soft"
    }
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | 是 | 固定 `"dsh-intelligent-ui/style-template"` |
| `schemaVersion` | 是 | 必须是数字 `1`；未知版本明确拒绝 |
| `template.name` | 是 | 1–30，去首尾空白，非保留名 |
| `template.description` | 否 | 缺省为空串，≤100 |
| `template.baseLayout` | 是 | `RenderLayout`：`card` \| `article` \| `free`（与模板持久化字段一致） |
| `template.directives` | 是 | 可为空串，≤2000，控制字符规则同持久化模型 |
| `template.theme` | 是 | 与 `isStyleTheme()` 完全相同的封闭 token 集合 |

不导出 `id`、`scope`、`sessionId`、`createdAt`、`updatedAt`、`appVersion`、`exportedAt`、作者、来源或校验和。字段顺序固定，`JSON.stringify(..., null, 2)`。

### 6.2 严格校验（客户端）

导入器按层校验，任何一层失败都返回可本地化错误码，**不调用 POST**：

1. **UTF-8 字节数** ≤32 KiB：文件先看 `File.size` 再读取；粘贴文本用 `TextEncoder().encode(text).length` 计算，不用 JS 字符长度。不信任文件名或 MIME。
2. 粘贴输入允许**显式剥离一层完整 Markdown 代码围栏**（首尾恰好是 ` ```json … ``` ` 时剥离一次并提示）；不在任意文本中搜索或猜测 JSON。文件输入同样按此规则容错一层围栏。
3. `JSON.parse` 结果必须是普通对象。
4. 顶层键集合必须恰为 `kind`、`schemaVersion`、`template`；`kind` 精确匹配；`schemaVersion === 1`。
5. `template` 键集合必须恰为 `name`、`description`、`baseLayout`、`directives`、`theme`（`description` 可缺省）。
6. 逐字段类型/长度/字符校验；`baseLayout` 复用 `isRenderLayout()`（card/article/free）；主题复用 `isStyleTheme()`；名称复用保留名与标签规则，并额外剥离 Unicode 格式字符（`\p{Cf}`，含双向控制符、零宽字符、BOM）作为纵深防御（剥离失败/名称为空则拒绝）。
7. **显式重建**可移植对象（不 spread 外部对象、不把外部对象塞进内部结构）；未知键一律拒绝，不做猜测。
8. `__proto__` / `constructor` / `prototype` 等危险键按未知键拒绝（`Object.keys` 可见即拒绝）。

### 6.3 旧版兼容：不做（2026-10-23 决定）

当前没有外部用户，不为已发布的原始 `StyleTemplate` 导出维护迁移分支。导入器只接受 Envelope v1；原始模板对象、持久化库文件 `{version:1, templates:[…]}` 与其他非 Envelope 形状统一以 `invalid_structure` 拒绝，不做模糊识别，也不显示 legacy 提示。

### 6.4 版本策略与兼容承诺

| 导出端 | 导入端 | 结果 |
| --- | --- | --- |
| 旧版原始 JSON | 本方案 | 拒绝（`invalid_structure`） |
| Envelope v1 | 本方案 | 支持 |
| Envelope v1 | 旧版插件 | 旧版没有导入功能，无法导入 |
| Envelope v2（未来） | 本方案 | 明确拒绝，提示升级插件 |
| Envelope v1 | 未来支持 v2 的版本 | 未来版本应继续支持 v1 |

README / architecture 需要写入的兼容承诺：

> 模板交换格式 v1 只包含可移植的样式配置（名称、描述、基础布局、展示规范、受控主题），不含本地模板身份与会话元数据。支持 v1 的插件版本可以导入该格式；未知交换格式版本会被拒绝，不尝试降级解析。原始模板导出不在兼容范围内。

交换格式版本与 npm 包版本独立。

v1 覆盖当前模板的全部布局值（`card|article|free`）。如果未来模板模型新增布局值或彻底移除 `baseLayout` 字段，必须发布 **Envelope v2**（或显式扩展字段）并保留 v1 解析分支；不允许 v1 静默接受未知 `baseLayout` 值。

## 7. 安全与信任边界（发布闸门）

### 7.1 外部 directives 是不可信内容（P0）

- **事实**：服务端校验只能保证「数据合法」，不能阻止合法长度内的恶意展示规范影响模型行为；`DISPLAY PREFERENCES` 与 JSON 编码不是强制信任边界（评审 P0-1）。
- **运行时真实边界**：DSH 的工具/权限执行层，而不是本扩展。模板数据只进入提示词，Host 不会执行 directives；但模型可能被文本诱导调用工具，这类越权必须在 DSH 执行层被拒绝。
- **本方案的缓解（默认关闭外部 directives）**：
  - **审计通过前：导入默认且强制「仅导入外观」**——只保存 `theme` + `baseLayout`，`directives` 置空；预览展示外部 directives 全文仅供检查，不写入、不可编辑。
  - **审计通过后：** 才在预览中提供「包含展示规范」选项（默认不勾选、需显式选择），勾选后允许编辑；未勾选时仍保存空串。
  - **若无法建立可靠的执行权限边界：永远不开放第三方 directives 导入**，即使有用户确认也不例外。
  - 导入后**不自动应用、不自动启用**，必须由用户主动选用；导入时提示「展示规范来自外部文件，可能包含影响 AI 行为的文本」。
  - 不做虚假保证：文档和 UI 不宣称分隔符已解决提示词注入。
- **发布闸门（实现阶段必须完成）**：
  1. 审计 Host 提示词组装和 DSH 工具权限路径，确认扩展没有把模板文本提升为执行权限；
  2. 记录残余风险、外部 directives 的默认状态与适用范围，更新 README / architecture 的安全段落；
  3. 补确定性测试（不可信文本不能获得工具权限；工具层拒绝未授权操作）与一次模型对抗观察记录（不作为通过/失败判据）；
  4. 审计结论决定「包含展示规范」开关是否上线；不通过则保持仅外观，或只发布外观子集。

### 7.2 UI 欺骗与信息泄漏（P0）

- 预览、列表、对话框全部用 React 文本节点渲染，不使用 `innerHTML` / Markdown 渲染外部名称与描述。
- 对名称/描述剥离 Unicode 格式字符（双向控制、零宽、BOM）；剥离后为空的名称拒绝。**这只是纵深防御，不是防冒充的充分条件**——内置样式与自定义模板必须靠**内部类型与控件结构**区分（自定义卡片带类型标签），名称不构成任何信任依据。
- 预览中的「仅导入外观」等类型标签来自解析结果，不来自外部文本。
- 导出前提示文件包含展示规范全文；文件名由清理后的模板名生成（复用 `src/client/export-image-plan.ts` 的 `fileStem()` 清洗规则），不使用内部 id 或原始名称作为路径。
- 不持久化「外部来源」标记（评审建议），避免制造虚假可信度。

### 7.3 会话与持久化规则（P0）

- 导入只允许 `scope: 'global'`，请求**不携带 sessionId**；文件中的 `scope/sessionId` 一律丢弃。
- id、时间戳、重名、配额全部由 Host 在写入时决定；单次导入只产生一次 `save`，失败不落半成品（现有原子写）。
- 不自动修改已选模板或全局默认。
- 实现阶段只核查、不新增防御：确认 DSH webServer 的连接认证与 Origin/CSRF 策略覆盖该路由（本方案不新增端点、不放开 CORS）。
- 已记录的现有事实：普通 `save` 的 `sessionId` 由客户端提交、不走与 `saveFromResult` 相同的会话匹配校验。本方案不触碰该路径（不导入会话模板）；若未来做会话作用域导入，必须从 Composer 活动会话取 id 并重新核查会话授权。

### 7.4 资源限制（P0）

| 阶段 | 限制 |
| --- | --- |
| 文件选择 | `File.size` ≤32 KiB，超限不读取 |
| 粘贴文本 | UTF-8 字节 ≤32 KiB（`TextEncoder` 计算，不用字符长度） |
| 解析 | 单模板、单层结构；未知键拒绝 |
| 保存 | 沿用 Host 64 KiB / 15 秒请求门，服务端字段上限 |
| 失败 | 明确错误码，不触发保存 |

不依赖 `<input accept>` 或 MIME 做安全检查。未来若加压缩分享码，必须限制解压后字节数并在超限时终止。

### 7.5 最小发布闸门检查清单（第二轮评审，0/5 已验证）

- [ ] Envelope v1 导入、严格白名单、32 KiB（UTF-8 字节）限制全部通过
- [ ] Host 认证、Origin/CSRF 策略、重名与并发配额检查通过
- [ ] 外部文本无脚本执行、无名称冒充、无本地元数据泄漏
- [ ] 恶意 directives 无法获得越权工具能力；否则仅发布「导入外观」子集
- [ ] 导出→导入→选用→编辑→删除、zh/en、构建与 e2e 全部通过

## 8. 技术实现

### 8.1 数据流

```text
导出：StyleTemplate（catalog，已校验）
        → toPortableStyle()（显式投影，剥离本地字段）
        → Envelope v1 → JSON 文件下载

导入：文件/粘贴文本
        → 大小检查 → parseStyleExport()
        → Envelope v1（其他形状拒绝）→ 显式重建 PortableStyleTemplate
        → 预览 / 改名 / 默认仅外观（审计通过后可显式勾选包含展示规范）
        → POST /api/intelligent-ui/styles { op:'save', template, scope:'global' }
        → Host 重新校验 + 生成 id/时间戳 + 重名/配额 → 原子写
        → styles.refresh() → 列表出现（不自动应用）
```

### 8.2 文件级改动

| 文件 | 改动 |
| --- | --- |
| `src/shared/style-template-exchange.ts`（新增） | `STYLE_EXCHANGE_KIND/VERSION/MAX_BYTES`、`PortableStyleTemplate`、`StyleExportEnvelope`、`StyleExportError`（错误码）、`toPortableStyle()`、`createStyleExport()`、`encodeStyleExport()`、`parseStyleExport()`。纯函数、无 React/DOM/DSH 依赖 |
| `src/client/style-actions.ts` | 新增 `saveTemplate(input)`：POST `{op:'save', template, scope:'global'}`，用 `isStyleTemplate` 校验响应并返回模板；错误码沿用 `StyleActionError` |
| `src/client/TemplateManagement.tsx` | 「导出 JSON」改为「导出文件」：用 exchange 模块生成 Envelope v1、文件名改为 `<fileStem(name)>.iui-style.json`；下载 helper 补 `append/rel=noopener/remove`（与 `export-html.ts` 一致）；导出前提示展示规范公开范围 |
| `src/client/TemplateImport.tsx`（新增） | 「导入模板」按钮 + `StylePopover` 对话框：文件/粘贴输入、32 KiB 检查、解析预览、改名/改名建议、directives 编辑与「仅导入外观」、错误与配额状态、成功后 `styles.refresh()`；全部文本按纯文本渲染 |
| `src/client/SettingsPage.tsx` | 「我的样式」分组接入 `TemplateImport`（传入 catalog、`styleActions`、`t`、禁用态） |
| `src/client/index.css` | 导入对话框的少量样式（复用 popover、template-field、色板既有类） |
| `src/shared/locales.ts` | 新增 zh/en 文案：导出/导入、文件/粘贴、预览、外部文件提示、重名建议、版本不支持、格式无效、过大、配额、成功等；zh 为 key 准绳 |
| `test/client/style-template-exchange.test.mjs`（新增） | 编解码与校验单测（见 §9） |
| `test/client/style-actions.test.mjs` | `saveTemplate` 请求体、响应校验、错误码映射 |
| `test/host/style-routes.test.mjs` | 「导入等价」向量：Envelope 的 `template` 直接走 `save` → 201、Host 分配 id/时间戳、无会话字段、重名/配额拒绝 |
| `test/client/settings.test.mjs` | 设置页渲染新增导入入口的 SSR 断言（如现有 harness 需要） |
| `test/browser/settings-picker.e2e.mjs` | 更新导出断言（文件名、Envelope、无本地字段）；新增导入 e2e（粘贴 JSON → 预览 → 改名 → 导入 → 列表出现；失败路径：未知版本/超限/重名） |
| `README.md` / `README.en.md` | 「我的样式」使用说明、分享步骤、兼容承诺、已知限制（安全表述） |
| `docs/architecture.md` / `.en.md` | 模板导出/导入流程、交换格式、无新增 Host 端点、信任边界与限额 |
| `CHANGELOG.md` | `[Unreleased]` 中英文条目 |
| `docs/verification.md` / `.en.md` | 实现并验证后追加证据（历史文档，只追加/刷新 live 子 claim） |

**分享功能本身不改动**：`src/host/style-routes.ts`、`src/host/style-store.ts`、`src/host/index.ts`、`src/generated/prompt.txt`、Agent Skill、`lib/**`（由构建生成）。注意：模板 free 支持所需的 `render_ui` 契约变更已由 2026-10-23 的保存布局修复落地，不属于本方案。

### 8.3 关键接口（示意）

```ts
// src/shared/style-template-exchange.ts
const STYLE_EXCHANGE_KIND = 'dsh-intelligent-ui/style-template'
const STYLE_EXCHANGE_VERSION = 1
const STYLE_EXCHANGE_MAX_BYTES = 32 * 1024

interface PortableStyleTemplate {
  name: string; description: string
  baseLayout: RenderLayout
  directives: string
  theme: StyleTheme
}
interface StyleExportEnvelope {
  kind: typeof STYLE_EXCHANGE_KIND
  schemaVersion: typeof STYLE_EXCHANGE_VERSION
  template: PortableStyleTemplate
}

function toPortableStyle(template: StyleTemplate): PortableStyleTemplate
function createStyleExport(template: StyleTemplate): StyleExportEnvelope
function encodeStyleExport(template: StyleTemplate): string
function parseStyleExport(text: string): PortableStyleTemplate
```

错误码（`StyleExportError.code`，UI 映射到 locale）：`invalid_json`、`invalid_structure`、`unsupported_version`、`invalid_template`、`too_large`、`empty_input`。

## 9. 测试矩阵

| 组 | 用例 | 期望 |
| --- | --- | --- |
| 协议 | v1 合法 JSON（含中文、Emoji、转义）roundtrip | 字段无损、导出确定性 |
| 协议 | 未知 `kind` / `schemaVersion: 2` | `unsupported_version` / 拒绝 |
| 协议 | 未知顶层/模板/主题字段、缺失必填、类型错误 | 拒绝，不猜测 |
| 旧版 | v0.4.2 原始导出（含 id/scope/sessionId/时间戳）、持久化库文件 | 拒绝（`invalid_structure`），不做模糊识别 |
| 旧版 | 伪造/不完整对象、持久化库文件、嵌套异常结构 | 拒绝 |
| 资源 | 33 KiB 文件/文本、超长 directives | `too_large` / 字段错误，解析前失败 |
| 安全 | `__proto__`、`constructor`、`prototype` 键 | 未知键拒绝，无原型污染 |
| 安全 | 名称/描述含 HTML、脚本样式文本、双向控制/零宽字符 | 纯文本渲染；格式字符剥离/拒绝 |
| 主题 | 非法 hex、未知枚举、缺必备色 | 拒绝 |
| 一致性 | 导出 → 导入 → 再导出（含 free/card/article 三种布局） | 可移植字段一致；布局不丢失；id/时间戳为新值 |
| 存储 | 重名、大小写碰撞、40 个已满 | Host 拒绝；不覆盖、不越限 |
| 并发 | 连续点击导入、两个窗口同时保存 | 不重复写入、不越配额 |
| 资源 | UTF-8 字节边界：中文文本按字节计算 ≤32 KiB | 与字符长度不同的用例分别通过/拒绝 |
| 输入 | 首尾完整代码围栏、半截围栏、正文中间出现 JSON 片段 | 只剥离一层完整围栏；其余拒绝，不猜测 |
| 信任 | 审计前导入（默认状态） | 落库 `directives` 为空串；界面不可编辑外部 directives |
| 信任 | 审计通过后的「包含展示规范」显式勾选 | 未勾选为空串；勾选后才写入并经 Host 校验 |
| 交互 | 取消、保存失败、切换页面、重复选择同一文件 | 无部分写入、无自动应用 |
| 生命周期 | 导入后选用、编辑、删除、再次导出 | 与普通模板一致 |
| i18n | zh/en 全部新 key、错误码文案 | key 集合一致，无原始错误泄漏 |
| 前置 | free 结果 →「保存为模板」：不选外壳，模板 `baseLayout: 'free'` 并落库 | 2026-10-23 已修复并验证：保存返回 201、原结果不变；Host/浏览器测试与 `npm run check` 全绿 |
| 浏览器 | 文件下载、文件选择（DataTransfer）、粘贴、键盘操作 | e2e 通过 |

命令：`npm run build && npm test`；新增/修改的浏览器用例用 `npm run test:browser`（或单文件 `node test/browser/settings-picker.e2e.mjs`）；合并前 `npm run check`，发布前 `npm run pack:check`。

## 10. 文档与发布

- 实现完成后按 `sync-iui-docs` 做增量同步：README 对、architecture 对、CHANGELOG、verification 追加证据；`lib/**`、`src/generated/prompt.txt`、`vendor/**` 不手改。
- i18n 文案只改 `src/shared/locales.ts`（zh 准绳、en 同 key 集合）。
- 兼容承诺按 §6.4 原文写入 README / architecture；明确「交换格式版本 ≠ npm 包版本」。
- 安全表述按 §7 如实写入：导入的展示规范来自外部、属于不可信内容；**审计通过前导入默认且强制仅外观**；审计通过后才可显式选择包含展示规范；执行权限由 DSH 工具层控制；不宣称已消除提示词注入风险。
- 新截图/资产非必需；若改设置页布局需要截图，按 `scripts/capture-screenshots.mjs` 流程同步两份 README 与资产数量守卫。

## 11. 明确砍掉或延期

| 功能 | 决策 |
| --- | --- |
| 单模板文件导出/导入 + Envelope v1 + 旧版兼容 | **MVP** |
| 导入预览、改名、默认「仅导入外观」 | **MVP** |
| 「包含展示规范」选项（默认关闭、需显式勾选） | 审计通过后开放；不通过则不开放 |
| 复用 Host `save`、不新增端点 | **MVP** |
| 本地固定样式的主题预览 | MVP（复用现有预览组件，成本低） |
| 分享码 / 压缩 / Base64（`iui1u.` / `iui1d.`，16 Ki 字符上限，解压后 32 KiB 上限） | v1.1 再评估 |
| 公开分享链接、在线模板市场 | 不做（需要后端与治理） |
| Composer 导出（含会话模板）与 Composer 全局导入 | 已实现（2026-10-23） |
| Composer 会话作用域导入 | 延后：需从活动会话取 sessionId 并核查 `save` 的会话授权 |
| 去掉模板的 `baseLayout` 字段（完全取消壳/布局概念） | 不在本方案（属于模板模型改造）；若推进，分享格式需 Envelope v2 |
| 批量导出/导入、整库备份恢复 | 下一迭代 |
| 内容指纹去重、幂等键、「已导入」状态 | 不做 |
| 作者/官方认证/签名、`appVersion`/`exportedAt`/来源永久标记 | 不做 |
| 导入后自动应用 / 「导入并使用」 | 不做（先保持导入与应用分离） |
| 模型实时生成效果预览 | 不做（本地固定样例足够） |
| 剪贴板自动识别导入 | 不做（分享码延后后无意义） |

## 12. 风险与待确认取舍

### 12.1 风险

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| 第三方 directives 的提示词注入残余风险 | 高 | §7 缓解 + 发布闸门前置；不可宣称已解决 |
| 解析器边界过宽/过窄 | 中 | 单一 Envelope v1 解析器，严格键集合；测试覆盖原始导出/库文件/伪造结构拒绝 |
| 严格拒绝未知字段导致未来扩展必须发 v2 | 中 | 有意为之；v2 时新增解析分派，不静默丢弃 |
| 用户误分享 directives 中的敏感信息 | 中 | 导出前提示公开范围；预览可检查 |
| Host `save` 的 sessionId 授权边界未收紧 | 中 | 本方案不导入会话模板；作为已知事实记录，未来做会话导入时处理 |
| 自由结果 → 保存模板的真实交互未验证 | 中 | 分享自由生成样式的必经路径；实现前补真实验证，再进入导入导出测试 |
| e2e 文件选择依赖 Chromium 行为 | 低 | 粘贴路径覆盖同一解析器；文件读取再补单测 |

### 12.2 建议用户确认的三点

1. **输入通道**：MVP 除文件外接受「粘贴 JSON 原文」（同一解析器，允许显式剥离一层代码围栏，不做压缩分享码）。第二轮评审确认可保留。
2. **作用域**：MVP 导入只生成全局模板，导出入口保持在设置页——是否满足你的分享场景？
3. **安全闸门（2026-10-24 owner 已确认 A 方案）**：采用「免责声明 + 阅读确认」保留外部内容，替代审计前强制仅外观；执行层工具权限与真实 Origin/CSRF 审计作为发布前加固项。

### 12.3 已定：模板布局与分享格式（2026-10-23）

- 用户指出「保存的时候肯定是要和渲染的匹配」是 bug。工作树已修复：保存自由结果得到 `baseLayout: 'free'` 的模板，不再选择 Card/Article，模板与结果布局/主题/偏好一致。验证：`npm test` **191/191**、`npm run check`、浏览器 **7/7**（按需 **114** 断言，含页面刷新后的 free 模板回放）。
- 因此本方案 v1 直接承载 `card|article|free`；不存在「模板要不要 free」的待决项。
- 分享链路的实现仍需覆盖 free 模板的导出/导入 roundtrip；该验证已列入 §9 与 §13。

### 12.4 独立 subagent 评审（2026-10-23）

三个独立 review（两个 subagent + 一个 teammate，只读）对未提交工作树的结论均为 **SHIP WITH CHANGES**、无 P0。已修复：

- 外部 `name` 也是进入提示词的不可信文本，原先只有 `directives` 非空才要求确认 → 现在所有导入模板都必须确认；名称/描述剥离全部格式控制与行分隔符，提示词引用时转义 U+2028/U+2029。
- 导入指令中的 bidi 控制字符会重排预览 → 导入时剥离 bidi 控制；文件名/文件选择显示剥离全部 `\p{Cf}`。
- 保存请求进行中可被 Escape 关闭导致失败不可见 → 保存中不可关闭；描述改为单行输入。
- 极少数库内名称导出失败、`(Imported)` 截断拆代理对、导出错误提示不明确 → 均有专门处理。
- README/verification 的实测数字与浏览器覆盖描述已更新。

**已获 owner 确认（2026-10-24）**：采用「免责声明 + 阅读确认」方案保留外部内容，替代原计划的审计前强制仅外观。发布前仍建议补执行层工具权限审计与真实 Origin/CSRF 检查；这属于加固而不是首版阻塞。

**第二轮 review（2026-10-24）**：两个只读 subagent 无 P0/P1，提出的 5 个 P2（父面板保存中可关闭、不可见格式字符、确认未随名称编辑重置、文件显示行分隔符、文档口径）均已修复并补测；记录见 [subagent-review-2026-10-24.md](reviews/subagent-review-2026-10-24.md)。第三轮 review（同日晚）无 P0/P1，指出的 5 个 P2（父面板锁定/arm 路径仍可卸载、默认忽略字符、描述文案、覆盖声明、焦点抖动）已修复，记录见 [subagent-review-2026-10-24-third.md](reviews/subagent-review-2026-10-24-third.md)。第四轮 review 无 P0/P1，指出导入结束后的 Composer 状态保留、busy 键盘焦点、隐藏失败测试、架构消毒器描述与 docs-sync 计数滞后，均已修复，记录见 [subagent-review-2026-10-24-fourth.md](reviews/subagent-review-2026-10-24-fourth.md)。

## 13. 实施顺序（建议拆成 4 个提交/PR）

0. **前置条件（已完成）**：工作树已修复并验证「free 结果 → 保存为模板」精确保留布局；分享实现从「导出/导入 free 模板」本身开始验证。
1. **数据层**：`style-template-exchange.ts` + 单测（协议、资源、安全、确定性）——先于任何 UI。
2. **导出切换**：`TemplateManagement.tsx` 改用 Envelope + 文件名清理 + i18n；更新设置页 e2e 导出断言。
3. **导入闭环**：`style-actions.saveTemplate` + `TemplateImport.tsx` + 设置页入口 + i18n + client/host 测试 + e2e（粘贴路径与文件路径）。
4. **安全与文档闸门**：审计 directives 运行时权限、补确定性测试与观察记录；当前实现的阅读确认偏差需 owner 明确批准，否则发布前回退为「仅导入外观」；更新 README/architecture/CHANGELOG/verification，跑 `npm run check` 与 `npm run pack:check`。

每步的完成标准：新增测试通过、旧测试不回归、构建产物可加载、文档与代码一致。
