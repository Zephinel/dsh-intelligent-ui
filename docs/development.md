# 开发与部署

中文 | [English](development.en.md)

[← 返回 README](../README.md)

本文展开 README 的安装与开发细节。

## 安装

需要 DSH 0.2.2（`dsh` CLI）与 Node 24。浏览器半边还要求部署组合了 `@deepseek-ai/dsh-client-locale`（DSH Web 0.2.2 默认包含；缺少它时开关和卡片不会挂载，Host 工具与提示词不受影响）。

从 npm 或 GitHub 安装 bundle（推荐）：

```bash
# npm；当前 latest 为 0.5.0
dsh plugin --profile web add @zephinel/dsh-intelligent-ui
# 固定版本
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.5.0
# 或从 GitHub 安装
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
# 重启承载 Web UI 的 DSH 进程（前台 `dsh web`：Ctrl+C 后重新运行；
# DSH Desktop：退出并重开应用；systemd/launchd：重启对应服务）
```

> npm 包名是 **`@zephinel/dsh-intelligent-ui`**：无 scope 的 `dsh-intelligent-ui` 已被另一个无关项目占用，因此使用 `@zephinel` scope。GitHub 安装不受影响。

Web 端也可以在 **Plugins** 页面安装并启用。DSH Desktop 同样在应用内安装：侧栏 **插件** → **添加插件**（或箭头 → **安装第三方插件**）→ 输入包名及版本 → **安装** → **立即启用**。桌面版 profile 由 Electron 应用独占管理，`dsh plugin --profile desktop` 会被拒绝；启用后若输入框右侧没有 **UI** 控件，退出并重开 Desktop。国内镜像可能晚于 npm 官方源同步刚发布的版本，装不到时把安装源切回 npm 官方源。bundle 安装后 skill 随 Host 插件自动出现，无需单独安装。

### 本地 checkout（开发）

修改扩展本身时从本地 checkout 安装。扩展**没有独立的开发服务器**——它运行在 DSH 里。开发回路是：构建 → 安装进 profile → 重启 DSH Web → 打开它打印的 URL；输入框右侧出现 **UI** 控件即成功。没有 watch 模式，改完重新 `npm run build` 并重启。

```bash
npm install && npm run build
node scripts/install.mjs  # 写入 $DSH_HOME/profiles/web/cordis.patch.yml（自动备份）
```

重启后页面会断开，用新打印的 URL 重新打开。卸载：

```bash
node scripts/install.mjs --uninstall   # 然后同样重启 DSH Web 进程
```

> 0.2.2-rc.1 的宿主在 patch 文件变化后会重组插件树（Host 工具立即出现），但浏览器端插件可能停留在旧 revision：**刷新页面**通常即可；仍异常再 restart。

### 两种安装模式与切换

本地开发用 **dev row**（`scripts/install.mjs`），发布/升级路径用 **bundle 安装**（`dsh plugin add` 或插件市场）。两者都会插入同一个 loader row id，**不要装在同一个 profile**。

| 模式 | profile 里的样子 | 用途 |
|---|---|---|
| dev row | `cordis.patch.yml` 里一个带标记的 insert 块，`name` 指向 checkout 的 `lib/index.js` | 日常改代码：`npm run build` 后重启即生效，不拷贝 |
| bundle | `dsh plugin` 安装，`name` 为包名，代码在 profile 的 `node_modules` 副本里 | 发布验证与普通使用：更新后需要重装 |

从 bundle 切到 dev row：

```bash
dsh plugin --profile web remove @zephinel/dsh-intelligent-ui
# 若 cordis.patch.yml 里还有旧的 `- id: intelligent-ui` 配置行，先删掉
npm run build
node scripts/install.mjs   # 只写 id + name（一个插入块），不写 config
```

`install.mjs` 不写 `config`。把原设置作为**独立覆盖行**追加在标记块之后（重跑 install.mjs 不会冲掉）：

```yaml
- id: intelligent-ui
  config:
    freeComposition: true
    globalEnabled: false
    answerStyle: auto
    exportBackground: "#ecfdf5"
    exportScale: 2x
    removeFollowUps: true
```

（字段按当前设置写，以上都是 Host Config 的字段；实验开关 `documentMode` 默认关闭，需要时再加。`globalEnabled: false` 时用输入框的 **UI** 开关按会话启用。`install.mjs` 会把模板里的空 `[]` 替换成插入块，卸载且没有其它条目时写回 `[]`。）

验证与回滚：

```bash
dsh --profile web --dump-config | grep -A12 'id: intelligent-ui'
# dev row: name 以 file:// 指向 checkout 的 lib/index.js，且 config 在
# bundle:  name 为 '@zephinel/dsh-intelligent-ui'
node scripts/install.mjs --uninstall   # 回退 bundle 前先卸载 dev row，然后重启
```

`install.mjs` 会在写入前把 patch 备份到 `$DSH_HOME/backups/dsh-intelligent-ui-*`。

日常循环按改动类型区分：

```bash
# 只改 skills/intelligent-ui/SKILL.md：重启即可（技能在启动时从 checkout 读取）
# 改 prompt（scripts/generate-prompt.mjs）、Host 或 Client：先构建
npm run build
# 然后重启承载 Web UI 的 DSH 进程
```

没有 watch 模式；重建 `lib/client.js` 后刷新页面可能拿到旧 revision，重启才可靠（见下一节）。

## 开发

```bash
npm run build          # prompt + host + client 全量构建
npm run build:client   # 只重建浏览器 bundle
npm run build:host     # 只重建 Host
npm run typecheck      # tsc --noEmit；浏览器 src/client 因运行时平台包类型不可解析而排除
npm run check          # typecheck + build + Host/Client/打包测试 + renderer + 文档事实/链接与打包事实检查
npm run check:docs-links # 校验 README/docs/Agent Skill 的本地链接、锚点、仓库链接与 clone URL（已含在 check 中）
npm run check:pack-facts # 校验打包文件数与非构建文件字节与 docs/current-facts.json 一致（已含在 check 中）
npm run pack:check     # npm pack --dry-run，检查最终发布文件清单
npm run check:release  # 打包 → 一次性 DSH_HOME 安装 → 校验包内全量文件哈希、挂载、client bundle → 卸载（需要 dsh + pnpm）
npm run test:browser   # 9 个 Chrome 套件：按需生成、样式面板、主题、图片、交互页面、Article、设置、Artifact 区块编辑与编排、嵌套编辑渲染
```

- `scripts/build.mjs`：Host 打成 ESM（Node 内置模块与 `@deepseek-ai/schemastery` 之外全部打进 bundle；后者是插件详情页 Config 的运行时依赖）；Client 打成 CJS body + `window.__ModuleLoader__.load({ id, factory })` 外壳，React/Cordis/DSH client 平台包由 loader 注入，第三方库私有打包，CSS 收成字符串在插件加载时注入；另外把独立页面入口打成 `lib/standalone.js` / `lib/standalone.css`（内联 KaTeX 字体，供交互页面导出使用）。
- `scripts/generate-prompt.mjs`：把上游生成的 OpenUI Lang 提示词改写成「通过 render_ui 工具调用」的版本，并在这里维护决策策略（是否出页面由模型按回答判断、样式只决定出页面时的版式、显式调用或明确要求页面是直接指令）与布局/间距契约（页面节奏由渲染器负责，模型不手动加根 gap/空白块）；改完重新 `npm run build`。
- `scripts/install.mjs`：本地 checkout 的 profile 安装/卸载（写入带标记的 patch 块，自动备份）。
- `scripts/release-check.mjs`：发布前的包级检查。`npm pack` 产物解包后与 checkout 逐文件对比（每个打包路径都必须存在于 checkout，`lib/`、`skills/`、`locale/` 与 bundle patch 全量哈希一致），再装进一次性 `$DSH_HOME`（独立端口启动 Web），校验安装后的文件集合与哈希和 tarball 逐字节一致、组合树出现 loader row、boot graph 与实际提供的 client bundle 来自安装包、卸载后依赖/bundle row/目录全部消失。`npm pack` 会运行仓库的 `prepare` 构建（重写 ignored 的 `lib/`），但脚本不读写现有 profile、不碰运行中的服务；需要 `dsh` 与 `pnpm` 在 PATH 上。
- `scripts/capture-screenshots.mjs`：`node scripts/capture-screenshots.mjs` 在 Chrome 2x 重建组件 tour、UI 菜单/样式面板、armed 提示、临时结果（明/暗）与插件设置截图。使用固定主题 token、生产组件与假投影/catalog/form，不需运行 DSH；壳层卡片图标用 lucide 替身。`--dark --out-dir=/tmp/iui-dark` 可在独立目录重跑全套深色截图；没有 Chrome 时跳过。禁止手工编辑图片。
- `src/lib/**`：上游组件库与 59 个 library `@functions` 的移植（含 M4-1 `nestedEditLibrary` 容器 HOC、`nested-edit.css` 直接子选择器补偿与 B2-6 `runtimeState`/`onRuntimeStateChange` 转发）；`src/lib/render.tsx` 是 DSH 封装（主题隔离、错误边界、`@ToAssistant` 回填），`src/lib/i18n.tsx` 给渲染器组件提供 `t` seat 与英文兜底。
- `src/client/**`：DSH Slot 注册（输入框 UI 开关、插件详情页 `plugins.bundle.config`、消息操作栏的导出入口）、turn-tail 卡片、`render_ui` / `edit_ui_blocks` 进程行（失败时一行原因）、程序提取器（含 block-edit 修订卡片与 `requestId`）、导出消息/Turn 查找、图片导出管线（SnapDOM + 美化合成）、交互页面生成（拉取资产 + 主题快照 + 内联 HTML），以及 `ctx.locale` 字典注册；另有 Artifact 区块编辑与编排（多草稿 store、单 active 画布与草稿切换区、每草稿一个 Composer chip、编辑视图/Artifact 编辑器/区块浮层、实时排序预览、后台修订探测、已发送消息逐信封摘要、Turn 关闭按 `requestId` 对账与 failed 草稿恢复，以及旧修订的 branch 模式和 `local-revisions.ts` 零模型本地修订卡片（localStorage，按 Turn 渲染）、`store.ts` 的 sessionStorage 草稿持久化/懒恢复与 `tabs.ts` 的 BroadcastChannel 跨标签软租约，以及临时样式结果的内容编辑（快照随请求、纯排序/整体说明被阻止）、`nested.ts` 的 CST→嵌套区块映射与编辑画布「嵌套区块」opt-in 模式、嵌套「嵌套区块编排」同父排序（`nestedOrder`/drag/keyboard/reset）、编排行复制/两段式删除/「移动到…」跨容器移动（本地结构修订卡 `kind` 为 structure）、嵌套组「添加区块」（模型 additions）与结构操作 preview→diff 模态确认。
- `src/standalone/**`：交互页面的独立入口与页面 chrome（卡片标题/折叠、`@ToAssistant` 复制兜底、主题样式）；由 `npm run build` 打成 `lib/standalone.*`，Host 通过 same-origin 路由提供给导出流程。
- `src/shared/**`：Host/Client 共享的协议常量（`intelligent-ui.ts`）与中英文 UI 字典（`locales.ts`）；Artifact 区块编辑也在这里定义任务信封与形状校验（`artifact-edit.ts`，含 `requestId`、`parseEditRequestTexts` 与多卡片批次上限，以及 B1 的 block/style 判别信封与样式序列化）、区块识别/包装与确定性排序（`artifact-blocks.ts`）、区块片段切片/回填（`artifact-block-bundle.ts`），以及基础登记契约与校验（`artifact-base.ts`，供 Host 路由与客户端 shared 使用），和 B2 的结构路由目标契约（`artifact-structure.ts` 的 `targetStyle`/`sessionStyleScope` 与单意图校验）。
- `src/host/**`：工具注册（`render_ui` 与区块片段工具 `edit_ui_blocks`，多 pending 时用 `editRequestId` / `requestId`+`artifactId` 选择，branch 请求允许旧 base）、程序校验、系统提示词 section、设置项 Config（`globalEnabled` / `answerStyle` / `freeComposition` / `documentMode` / `exportBackground` / `exportScale` / `removeFollowUps`）、内嵌 skill 注册，以及（可选注入 `webServer` 时）交互页面资产的 same-origin 路由；`mode.ts` 实现全局默认 + 会话覆盖的开关与样式（持久化文件、命令、投影、每 agent 工具可见性，关闭时 deny 两个工具）；`artifact-revisions.ts` / `artifact-edit.ts` 提供修订注册表、认证查询路由与 POST 零模型恢复路由，以及多信封解析（`parseEditRequestTexts`）、按 `requestId` 的 pending Map、branch 校验、targetOrder 校验、片段合并与确定性排序控制器，M4-2 `orderByParent` 层级校验与最深优先重建、M4-3 权威 program 注册表 + 幂等 ledger + `POST /api/intelligent-ui/artifact-structure` 确定性结构路由、M4-4 共享容器白名单与 Section children 参数接入，以及 `artifact-base.ts` 的 base 登记生命周期与 `resolveArtifactBase` 边界（结构路由共用），`artifact-revisions.ts` 的临时样式快照边界（修订写入前登记 ResultStore）与 history 来源推断，以及 `program-validation.ts`（从 index.ts 抽出的共享程序/Article 校验）与 B2 的结构路由 `executeStyleSwitch` 分支（Host 解析 durable 目标、H1 base 身份校验、no-op/临时快照丢弃、`styleSwitch` 能力位）。
- `skills/intelligent-ui/**`：随包发布的 Agent Skill。
- `vendor/`：上游源码（组件/函数/生成物）与许可证。

## 开发提示：改名 / 重建 client 后要重启 Web 服务

浏览器端的插件模块用 **`package.json` 的 `name` 作为 `__ModuleLoader__` 注册 id**，而运行中的 DSH Web 宿主会按 revision 缓存 client module graph 与 bundle 快照。服务运行期间：

- 改了包名（例如在 `dsh-intelligent-ui` / `@zephinel/dsh-intelligent-ui` 之间切换），或
- 重建了 `lib/client.js` 或 `lib/standalone.*`（`npm run build` / `npm pack` 的 `prepare` 也会重建；Host 路由按进程缓存资产）

之后**只刷新页面可能拿到旧 revision**，页面会显示：

```
Failed to load plugins
… import failed: client-modules: … already executed without registering "<包名>";
… loaded without registering "<包名>" via __ModuleLoader__.load
```

含义是：加载到的 bundle 实际注册的 id 与浏览器 boot graph 里的行 id 不一致（典型原因就是上面的改名/重建）。此时**重启一次承载 Web UI 的 DSH 进程**（前台 `dsh web` 就 Ctrl+C 再启动；由 launchd/systemd 托管则重启对应服务；DSH Desktop 则退出重开）让宿主重新计算 graph 即可；单纯刷新修不好。发布后的用户升级插件/改配置后同理：先刷新，仍报错再重启。

`npm run check` 里的打包测试会校验 `lib/client.js` 的注册 id 与 `package.json` 的 `name` 一致，防止发布物与包名漂移。

### Host/Client 版本错位（开发时常见）

Host 半边只在**进程启动**时加载；浏览器半边在**刷新页面**时由 module loader 重新取当前 `lib/client.js`。所以只刷新不重启时，可能出现「新控件 + 旧 Host」：

- 新控件的菜单发送 `/iui on|off|inherit` 或 `/iui style …`，而旧 Host 只认 `on|off`，于是命令行出现红色的 `Usage: …`（命令 `kind: 'error'` 的渲染，不是崩溃）；
- 旧 Host 的成功文案也还是旧版本（例如「already off for this session」）。

看到这种混合状态先**重启承载 Web UI 的 DSH 进程**（再刷新页面），两半会一起切到当前构建；`/iui on` 随即返回正常成功文案。发布后的插件升级同理：bundle 更新后需要重启宿主，而不是只刷新。

### 工具 JSON Schema 子集（激活失败排查）

DSH 0.2.2 的 `dsh-tools` 只接受 `type` / `oneOf` / `properties` / `required` / `additionalProperties` / `items` / `enum` / `const` 加注解（`description` / `title` / `default` / `examples`）。`src/host/tool-schema.ts` 在注册任何工具/路由/提示词之前先用同一子集验证 `render_ui` 参数与输出 schema，因此不合法的 schema 会让整个插件激活失败并指出具体关键字，而不是留下“工具缺失但提示词已启用”的半活状态。限制写进 `description` 并在 execute 中校验；`test/host/tool-schema.test.mjs` 守护子集与失败形态，`test/host/tool.test.mjs` 继续守护实际参数/输出 schema。此类错误只在 Host 激活时暴露，修复后必须重启宿主。

### 新增 Host 侧协作状态的硬性要求

任何新增 Host 侧协作状态的能力（例如权威 program registry、本轮的基础登记）必须同时交付以下四项，缺一不可：

1. **状态版本**：持久化文件与路由 body 带 schema version；读到旧版本时必须能安全失败或显式迁移。
2. **幂等登记/迁移路径**：已存在的内容必须能通过一条带 provenance 校验、写一次、可重放的路径进入权威状态；不允许依赖客户端每次重传、手工脚本或后台任务。
3. **旧形态测试**：用「安装该能力之前渲染的卡片 / 写出的状态文件」作为 fixture 覆盖升级路径，而不只测新数据。
4. **混合版本降级**：新 Client + 旧 Host（或反向）必须有明确行为：缺路由/缺字段时降级到哪个 UI 文案与哪条非权威路径，且不阻塞主流程。

反例是基础登记之前的旧卡：同一张卡在结构操作、修订历史与恢复里分别失败成不同错误。参考实现：`src/shared/artifact-base.ts`（共享契约与校验）、`src/host/artifact-base.ts`（登记生命周期与 base resolve 边界）、`src/client/artifact-edit/artifact-base.ts`（single-flight ensure 与旧 Host 能力缓存）。

## 持续集成（CI）

仓库有两个 GitHub Actions 工作流（GitHub-hosted `ubuntu-latest`，Node 24；Chrome 由 runner 提供，步骤里解析其路径并断言存在，避免排版检查静默跳过）：

- [`ci.yml`](../.github/workflows/ci.yml)：`changes` job 先判断改动是否只涉及 CHANGELOG/PRODUCT/docs/.agents（README 属打包内容，走全量门禁）；`verify` job **在 PR 与 main push 上始终运行**（因此 required status check 不会因 paths 过滤被跳过），全量改动跑 `npm run check`（typecheck/build/Node/renderer/docs-facts/docs-links/pack-facts）和生成物检查，纯文档改动（CHANGELOG/PRODUCT/docs/.agents）只跑 `check:docs-facts` + `check:docs-links`（数秒级）；README 属于打包内容，因此 README 改动走全量门禁，由 `check:pack-facts` 校验非构建打包字节；`browser` job 只在 main push 与手动触发时跑 9 个 Chrome 套件，并拆成 2 个 shard：`artifact-edit` 单独一个（本地实测约占整套 78 秒中的 58 秒），其余 8 个套件另一个；首个真实 CI 运行实测套件合计 88 秒，拆分后由最长 shard 决定 wall time。它不作为 PR 门禁（该套件有已知的少量 flake 概率）。CI 中每个套件单次上限 600 秒、最多尝试 3 次（全失败才判红）；harness 对每条 CDP 命令设 30 秒超时，卡死的 Chrome 会快速失败而不是拖住 job。
- 并发：PR 使用同一并发组且 `cancel-in-progress`，连续推送只保留最新一次；main 每个 commit 使用独立组（含 SHA），保证 main 上每个提交都完整跑过，符合发版分支要求。
- 缓存：只使用 `actions/setup-node` 的 npm 缓存（按 lockfile 键）；`lib/` 是 ignored 构建产物且完整构建约 0.8 秒，不缓存。
- [`publish.yml`](../.github/workflows/publish.yml)：`v*` tag 触发，流程见[发布（Trusted Publishing）](#发布trusted-publishing)。

`npm run check:release`（打包 → 一次性 `DSH_HOME` 安装 → 启动隔离 Web → 卸载）尚未接入 CI：Linux runner 上的行为还需要一次验证，目前它是**本地发布前门禁**，不要在没跑过它的机器上发版。分支保护（required status check `verify`）与 `v*` tag 限制需要在 GitHub 仓库设置里由维护者开启，不在代码里。首个运行实测：全量 **118 s** wall（verify 51 s，browser 单 job 102 s、套件 88 s）；拆分与去重后全量 **80–93 s**（verify 47–51 s，artifact-edit shard 68–79 s，other-suites shard 40–58 s，runner 波动；最终运行 **81 s** / run `363324d`）；纯文档推送 **34 s**（改动前）→ **21 s**（分类 job 只 fetch diff base 后）走快速路径（changes + docs fast gate），browser 与 npm ci 均跳过。

## 发布前检查

发布前按顺序运行：

```bash
npm run check          # typecheck、构建、Node/renderer 测试与 docs-facts
npm run check:release  # 把打包产物装进一次性 DSH_HOME，校验全量文件哈希、挂载、client bundle 与卸载
npm run pack:check     # 确认最终发布文件清单
```

`check:release` 需要 `dsh` 与 `pnpm` 在 PATH 上；`npm pack` 会先跑仓库构建（只写 ignored 的 `lib/`），脚本自己启动隔离实例，不读写当前 profile、不触碰运行中的服务。发布本身由 `v*` tag 触发 [publish.yml](../.github/workflows/publish.yml)（Trusted Publishing、OIDC 与 provenance），细节见下一节。

## 目录（发布相关）

| 路径 | 作用 |
|---|---|
| `lib/index.js` / `lib/client.js` / `lib/standalone.js` / `lib/standalone.css` | 构建产物，npm 包发布内容；后两者是交互页面导出用的独立渲染器资产 |
| `cordis.patch.yml` | DSH bundle patch（插入 `intelligent-ui` 行） |
| `.github/workflows/publish.yml` | tag 触发的发布工作流（Trusted Publishing / OIDC + provenance）；不随 npm 包发布 |
| `locale/en.json` / `locale/zh.json` | 插件市场/插件详情页显示名与描述 |
| `src/shared/locales.ts` | 中英文 UI 字典（`ctx.locale` 注册、渲染器英文兜底） |
| `README.md` / `README.en.md` | 中文 / English 文档，顶部互相链接 |
| `docs/` | 详细文档（架构、开发、验证）；不随 npm 包发布 |
| `CHANGELOG.md` | 版本变更记录（英文，历史记录，只追加）；不随 npm 包发布 |
| `assets/` | README 截图：行程示例、三张组件一览、看板与测验示例、窄屏适配、输入框开关/样式面板与插件设置页（WebP + PNG） |
| `screenshots.json` | 社区市场精选截图清单，路径相对于仓库根目录；不随 npm 包发布 |
| `icon.svg` | 插件卡片图标 |
| `skills/intelligent-ui/` | 内嵌 + 随包发布的 Agent Skill |
| `licenses/` | 第三方许可证全文（Open Intelligent UI、OpenUI、lucide、KaTeX、MapLibre、zod、SnapDOM、React） |
| `LICENSE` / `NOTICE` | 本项目 MIT 许可证与第三方归属声明 |

## 发布（Trusted Publishing）

发布由 GitHub Actions 执行，仓库和 CI 里都不保存 npm token。

**一次性配置**（包 owner，需要 npm 账号 2FA），二选一：

```bash
npm login
npm trust github @zephinel/dsh-intelligent-ui --file publish.yml \
  --repo Zephinel/dsh-intelligent-ui --allow-publish --yes
```

或在 npmjs.com 的包设置里添加 Trusted Publishing：GitHub Actions，仓库 `Zephinel/dsh-intelligent-ui`，workflow `publish.yml`。

**发布一个版本**：

1. 更新 `package.json` / `package-lock.json` 的版本、`CHANGELOG.md`、README 状态与版本 pin、相关 docs；
2. 编写并人工审核 `release-notes/<version>.md`（必需）与可选的 `release-notes/<version>.en.md`（英文界面用；缺失时 Host 回退默认文件）；`## Highlights` 至少一条，格式见 `release-notes/README.md`，`npm run check:release-notes` 可本地预览门禁结果；
3. 运行 `npm run check`；
4. 提交并推送 `main`；
5. 创建并推送与版本一致的 tag：

```bash
git tag v0.5.0
git push origin main --follow-tags
```

6. 在 GitHub 创建 Release 页面，标题写 `<version> — YYYY-MM-DD`（例如 `0.5.0 — 2026-10-25`），正文可复用 `release-notes/<version>.md` 的 Highlights；npm publish 由 tag 触发，Release 页面需单独创建。

`.github/workflows/publish.yml` 会拒绝 tag 与 `package.json` 版本不一致的推送，先跑 `npm run check` 与 `npm run pack:check`、校验 `CHANGELOG.md` 存在当前版本段与 `release-notes/<version>.md` 有已审核的 `## Highlights`，再用 OIDC + `--provenance` 发布到 npm，发布后自动核对 registry 版本与 `latest` dist-tag；不需要 `NODE_AUTH_TOKEN`。`npm run check:release` 仍未接入发布 workflow（Linux runner 行为待验证），发版前请在本地跑一次。

> 版本号约定：正式版使用稳定 semver（如 `0.5.0`，tag `v0.5.0`），GitHub Release 标题带日期；CHANGELOG 段日期与 GitHub Release 标题使用 **UTC 发布日期**（仅历史版本 `0.1.0-26-10-21` 的后缀沿用当时本地日期，属例外）。历史版本使用 `<semver>-YY-MM-DD` 形式（如 `0.3.0-26-10-22`）；该后缀在 semver 中是 prerelease，只用于当时的预发布版本。早期 `0.0.0-stage`（npm 预演）与 `0.1.0-26-10-20` 在 tag/GitHub Release 流程建立前发布，没有对应 tag 与 Release；其余已发布版本均有 tag 与 GitHub Release。

> 旧的 granular token 直接发布方式将在 2027-01 移除；这个流程不依赖长期 token。

## 插件市场维护

收录完成后，日常开发和发版沿用上面的发布流程，无需为每个新版本重新申请收录。

- **版本同步**：正式版本发布到 npm 的 `latest` 标签，并用上面的 `npm view` 命令确认。awesome / dsh-market 会自动关联指向本仓库的 npm 包，Open Plugin Market 当前条目未固定版本，默认跟随 `latest`；各市场按自己的构建周期刷新。保持 npm 包的 `repository` 指向本仓库，并保留 GitHub 的 `dsh-plugin` topic，供自动索引发现。[awesome 收录规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#npm-package--npm-包optional--可选) · [Open Plugin Market 维护规则](https://github.com/polang233/dsh-plugin-index/blob/main/.github/CONTRIBUTING.md)
- **截图更新**：更新本仓库的 `screenshots.json` 和对应图片，再推送到默认分支即可；清单保留 1 到 8 张截图，使用仓库内有效的相对路径。市场在后续构建时采集，无需单独向市场提 PR，也无需仅为市场截图重发 npm 包。[截图规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#screenshots--截图optional-recommended--可选推荐)
- **资料更正**：包名、仓库地址、分类改变，或市场介绍明显过时时，再更新对应市场的条目。awesome 只修改自己的 `data/plugins/Zephinel__dsh-intelligent-ui.yml`；Open Plugin Market 可在原[收录申请](https://github.com/polang233/dsh-plugin-index/issues/40)补充信息，或提交资料更正申请。
