# 开发与部署

中文 | [English](development.en.md)

[← 返回 README](../README.md)

本文展开 README 的安装与开发细节。

## 安装

需要 DSH 0.2.1（`dsh` CLI）与 Node 24。浏览器半边还要求部署组合了 `@deepseek-ai/dsh-client-locale`（DSH Web 0.2.1 默认包含；缺少它时开关和卡片不会挂载，Host 工具与提示词不受影响）。

从 npm 或 GitHub 安装 bundle（推荐）：

```bash
# npm；当前 latest 为 0.4.0
dsh plugin --profile web add @zephinel/dsh-intelligent-ui
# 固定版本
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.4.0
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

> 0.2.1-rc.2 的宿主在 patch 文件变化后会重组插件树（Host 工具立即出现），但浏览器端插件可能停留在旧 revision：**刷新页面**通常即可；仍异常再 restart。

## 开发

```bash
npm run build          # prompt + host + client 全量构建
npm run build:client   # 只重建浏览器 bundle
npm run build:host     # 只重建 Host
npm run check          # build + Host/Client/打包测试 + renderer 检查
npm run pack:check     # npm pack --dry-run，检查最终发布文件清单
npm run test:browser   # 7 个 Chrome 套件：按需生成、样式面板、主题、图片、交互页面、Article、设置
```

- `scripts/build.mjs`：Host 打成 ESM（Node 内置模块与 `@deepseek-ai/schemastery` 之外全部打进 bundle；后者是插件详情页 Config 的运行时依赖）；Client 打成 CJS body + `window.__ModuleLoader__.load({ id, factory })` 外壳，React/Cordis/DSH client 平台包由 loader 注入，第三方库私有打包，CSS 收成字符串在插件加载时注入；另外把独立页面入口打成 `lib/standalone.js` / `lib/standalone.css`（内联 KaTeX 字体，供交互页面导出使用）。
- `scripts/generate-prompt.mjs`：把上游生成的 OpenUI Lang 提示词改写成「通过 render_ui 工具调用」的版本，并在这里维护决策策略（开启会话默认出卡片、文字例外有界、显式调用是直接指令）与布局/间距契约（页面节奏由渲染器负责，模型不手动加根 gap/空白块）；改完重新 `npm run build`。
- `scripts/install.mjs`：本地 checkout 的 profile 安装/卸载（写入带标记的 patch 块，自动备份）。
- `scripts/capture-screenshots.mjs`：`node scripts/capture-screenshots.mjs` 在 Chrome 2x 重建组件 tour、UI 菜单/样式面板、armed 提示、临时结果（明/暗）与插件设置截图。使用固定主题 token、生产组件与假投影/catalog/form，不需运行 DSH；壳层卡片图标用 lucide 替身。`--dark --out-dir=/tmp/iui-dark` 可在独立目录重跑全套深色截图；没有 Chrome 时跳过。禁止手工编辑图片。
- `src/lib/**`：上游组件库与 59 个 library `@functions` 的移植；`src/lib/render.tsx` 是 DSH 封装（主题隔离、错误边界、`@ToAssistant` 回填），`src/lib/i18n.tsx` 给渲染器组件提供 `t` seat 与英文兜底。
- `src/client/**`：DSH Slot 注册（输入框 UI 开关、插件详情页 `plugins.bundle.config`、消息操作栏的导出入口）、turn-tail 卡片、`render_ui` 进程行、程序提取器、导出消息/Turn 查找、图片导出管线（SnapDOM + 美化合成）、交互页面生成（拉取资产 + 主题快照 + 内联 HTML），以及 `ctx.locale` 字典注册。
- `src/standalone/**`：交互页面的独立入口与页面 chrome（卡片标题/折叠、`@ToAssistant` 复制兜底、主题样式）；由 `npm run build` 打成 `lib/standalone.*`，Host 通过 same-origin 路由提供给导出流程。
- `src/shared/**`：Host/Client 共享的协议常量（`intelligent-ui.ts`）与中英文 UI 字典（`locales.ts`）。
- `src/host/**`：工具注册、程序校验、系统提示词 section、设置项 Config（`globalEnabled` / `answerStyle` / `freeComposition` / `exportBackground` / `exportScale` / `removeFollowUps`）、内嵌 skill 注册，以及（可选注入 `webServer` 时）交互页面资产的 same-origin 路由；`mode.ts` 实现全局默认 + 会话覆盖的开关与样式（持久化文件、命令、投影、每 agent 工具可见性）。
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

DSH 0.2.1 的 `dsh-tools` 只接受 `type` / `oneOf` / `properties` / `required` / `additionalProperties` / `items` / `enum` / `const` 加注解（`description` / `title` / `default` / `examples`）。`render_ui` 参数或输出里出现 `maxLength` / `minLength` / `pattern` / `format` 等关键字时，注册会抛 `JsonSchemaError`，插件条目显示 **Problem**、设置页提示没有 settings service、composer 的 UI 控件消失。限制写进 `description` 并在 execute 中校验；`test/host/tool.test.mjs` 用同一子集规则守护参数与输出 schema，也可用已安装 `dsh-tools` 的 `assertSupportedJsonSchema` 自检。此类错误只在 Host 激活时暴露，修复后必须重启宿主。

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
2. 运行 `npm run check`；
3. 提交并推送 `main`；
4. 创建并推送与版本一致的 tag：

```bash
git tag v0.4.0
git push origin main --follow-tags
```

5. 在 GitHub 创建 Release 页面，标题写 `<version> — YYYY-MM-DD`（例如 `0.4.0 — 2026-10-22`），正文概述该版本变更；npm publish 由 tag 触发，Release 页面需单独创建。

`.github/workflows/publish.yml` 会拒绝 tag 与 `package.json` 版本不一致的推送，跑 `npm run check`，再用 OIDC + `--provenance` 发布到 npm；不需要 `NODE_AUTH_TOKEN`。发布后用 `npm view @zephinel/dsh-intelligent-ui version dist-tags` 校验。

> 版本号约定：正式版使用稳定 semver（如 `0.4.0`，tag `v0.4.0`），GitHub Release 标题带日期。历史版本使用 `<semver>-YY-MM-DD` 形式（如 `0.3.0-26-10-22`）；该后缀在 semver 中是 prerelease，只用于当时的预发布版本。

> 旧的 granular token 直接发布方式将在 2027-01 移除；这个流程不依赖长期 token。

## 插件市场维护

收录完成后，日常开发和发版沿用上面的发布流程，无需为每个新版本重新申请收录。

- **版本同步**：正式版本发布到 npm 的 `latest` 标签，并用上面的 `npm view` 命令确认。awesome / dsh-market 会自动关联指向本仓库的 npm 包，Open Plugin Market 当前条目未固定版本，默认跟随 `latest`；各市场按自己的构建周期刷新。保持 npm 包的 `repository` 指向本仓库，并保留 GitHub 的 `dsh-plugin` topic，供自动索引发现。[awesome 收录规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#npm-package--npm-包optional--可选) · [Open Plugin Market 维护规则](https://github.com/polang233/dsh-plugin-index/blob/main/.github/CONTRIBUTING.md)
- **截图更新**：更新本仓库的 `screenshots.json` 和对应图片，再推送到默认分支即可；清单保留 1 到 8 张截图，使用仓库内有效的相对路径。市场在后续构建时采集，无需单独向市场提 PR，也无需仅为市场截图重发 npm 包。[截图规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#screenshots--截图optional-recommended--可选推荐)
- **资料更正**：包名、仓库地址、分类改变，或市场介绍明显过时时，再更新对应市场的条目。awesome 只修改自己的 `data/plugins/Zephinel__dsh-intelligent-ui.yml`；Open Plugin Market 可在原[收录申请](https://github.com/polang233/dsh-plugin-index/issues/40)补充信息，或提交资料更正申请。
