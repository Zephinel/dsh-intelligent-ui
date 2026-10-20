# 开发与部署

中文 | [English](development.en.md)

[← 返回 README](../README.md)

本文展开 README 的安装与开发细节。

## 安装

需要 DSH 0.2.1（`dsh` CLI）与 Node 24。浏览器半边还要求部署组合了 `@deepseek-ai/dsh-client-locale`（DSH Web 0.2.1 默认包含；缺少它时开关和卡片不会挂载，Host 工具与提示词不受影响）。

从 npm 或 GitHub 安装 bundle（推荐）：

```bash
# npm；当前 latest 为 0.1.0-26-10-21
dsh plugin --profile web add @zephinel/dsh-intelligent-ui
# 固定版本
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.1.0-26-10-21
# 或从 GitHub 安装
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
# 重启承载 Web UI 的 DSH 进程（前台 `dsh web`：Ctrl+C 后重新运行；
# DSH Desktop：退出并重开应用；systemd/launchd：重启对应服务）
```

> npm 包名是 **`@zephinel/dsh-intelligent-ui`**：无 scope 的 `dsh-intelligent-ui` 已被另一个无关项目占用，因此使用 `@zephinel` scope。GitHub 安装不受影响。

Web 端也可以在 **Plugins** 页面安装并启用。bundle 安装后 skill 随 Host 插件自动出现，无需单独安装。

### 本地 checkout（开发）

修改扩展本身时从本地 checkout 安装，命令见 [README 快速开始](../README.md#快速开始)：脚本写入 `$DSH_HOME/profiles/web/cordis.patch.yml`（自动备份），重启后页面会断开，用新打印的 URL 重新打开。卸载：

```bash
node scripts/install.mjs --uninstall   # 然后同样重启 DSH Web 进程
```

> 0.2.1-rc.2 的宿主在 patch 文件变化后会重组插件树（Host 工具立即出现），但浏览器端插件可能停留在旧 revision：**刷新页面**通常即可；仍异常再 restart。

## 开发

```bash
npm run build          # prompt + host + client 全量构建
npm run build:client   # 只重建浏览器 bundle
npm run build:host     # 只重建 Host
npm run check          # build + host/client 测试 + renderer 检查
npm run pack:check     # npm pack --dry-run，检查最终发布文件清单
```

- `scripts/build.mjs`：Host 打成一个自包含 ESM；Client 打成 CJS body + `window.__ModuleLoader__.load({ id, factory })` 外壳，React/Cordis/DSH client 平台包由 loader 注入，第三方库私有打包，CSS 收成字符串在插件加载时注入。
- `scripts/generate-prompt.mjs`：把上游生成的 OpenUI Lang 提示词改写成「通过 render_ui 工具调用」的版本。
- `scripts/install.mjs`：本地 checkout 的 profile 安装/卸载（写入带标记的 patch 块，自动备份）。
- `src/lib/**`：上游组件库与 59 个 library `@functions` 的移植；`src/lib/render.tsx` 是 DSH 封装（主题隔离、错误边界、`@ToAssistant` 回填），`src/lib/i18n.tsx` 给渲染器组件提供 `t` seat 与英文兜底。
- `src/client/**`：DSH Slot 注册（含输入框 UI 开关）、turn-tail 卡片、`render_ui` 进程行、程序提取器，以及 `ctx.locale` 字典注册。
- `src/shared/**`：Host/Client 共享的协议常量（`intelligent-ui.ts`）与中英文 UI 字典（`locales.ts`）。
- `src/host/**`：工具注册、程序校验、系统提示词 section、内嵌 skill 注册；`mode.ts` 实现三档开关（持久化文件、命令、投影、每 agent 工具可见性）。
- `skills/intelligent-ui/**`：随包发布的 Agent Skill。
- `vendor/`：上游源码（组件/函数/生成物）与许可证。

## 开发提示：改名 / 重建 client 后要重启 Web 服务

浏览器端的插件模块用 **`package.json` 的 `name` 作为 `__ModuleLoader__` 注册 id**，而运行中的 DSH Web 宿主会按 revision 缓存 client module graph 与 bundle 快照。服务运行期间：

- 改了包名（例如在 `dsh-intelligent-ui` / `@zephinel/dsh-intelligent-ui` 之间切换），或
- 重建了 `lib/client.js`（`npm run build` / `npm pack` 的 `prepare` 也会重建）

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

- 新控件的菜单发送 `/iui off|session|global`，而旧 Host 只认 `on|off`，于是命令行出现红色的 `Usage: /iui [on|off]`（命令 `kind: 'error'` 的渲染，不是崩溃）；
- 旧 Host 的成功文案也还是旧版本（例如「already off for this session」）。

看到这种混合状态先**重启承载 Web UI 的 DSH 进程**（再刷新页面），两半会一起切到当前构建；`/iui session|global` 随即返回正常成功文案。发布后的插件升级同理：bundle 更新后需要重启宿主，而不是只刷新。

## 目录（发布相关）

| 路径 | 作用 |
|---|---|
| `lib/index.js` / `lib/client.js` | 构建产物，npm 包发布内容 |
| `cordis.patch.yml` | DSH bundle patch（插入 `intelligent-ui` 行） |
| `locale/en.json` / `locale/zh.json` | 插件市场/设置页显示名与描述 |
| `src/shared/locales.ts` | 中英文 UI 字典（`ctx.locale` 注册、渲染器英文兜底） |
| `README.md` / `README.en.md` | 中文 / English 文档，顶部互相链接 |
| `docs/` | 详细文档（架构、开发、验证）；不随 npm 包发布 |
| `CHANGELOG.md` | 版本变更记录（英文，历史记录，只追加）；不随 npm 包发布 |
| `assets/` | README 截图：行程示例、三张组件一览、看板与测验示例、窄屏适配与输入框开关（WebP + PNG） |
| `icon.svg` | 插件卡片图标 |
| `skills/intelligent-ui/` | 内嵌 + 随包发布的 Agent Skill |
| `licenses/` | 第三方许可证全文（Open Intelligent UI、OpenUI、lucide、KaTeX、MapLibre、zod） |
| `LICENSE` / `NOTICE` | 本项目 MIT 许可证与第三方归属声明 |
