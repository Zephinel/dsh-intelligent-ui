# 独立 subagent 评审记录（模板导出/分享）

> 2026-10-23。三个只读 reviewer 并行审查未提交工作树（HEAD `b53482f`，v0.4.2 + 未发布改动）：两个通用 subagent（correctness、security）与一个 teammate（security 复核）。Codex CLI review 因账号用量限制不可用，不构成本记录证据。结论均为 **SHIP WITH CHANGES**、无 P0；作为未提交/本地构建可接受，发布前需执行层审计（见文末）。

## 结论摘要

- 代码契约（Envelope v1、严格解析、32 KiB、host `save` 复用、无新增端点、全局导入、无自动应用）通过三份 review 独立核对。
- 已修复的发现：
  1. **外部 name 绕过确认**（P1）：name/description 也进入系统提示与模型可见错误；现在所有导入模板都必须确认，名称/描述剥离全部 `\p{Cf}` 与 U+2028/U+2029，host 引用时转义行分隔符。
  2. **bidi 预览欺骗**（P2）：导入 directives 中的 bidi 控制字符会重排 `pre` 预览；现在导入时剥离。
  3. **保存中可关闭导入弹窗**（P2）：save 进行中 Escape/外点会关闭弹窗且失败不可见；现在保存中不可关闭，成功仍强制关闭。
  4. **多行描述**（P2）：后端拒绝换行，输入框原为多行；改为单行。
  5. **库内名称导出失败提示**（P2）：`\u200b`/`Card\u200b` 类名称能入库但不能导出；导出失败现在有明确本地化提示。
  6. **`(Imported)` 截断拆代理对**（P2）：改为按码点截断。
  7. **文件名格式控制**（P2）：`fileStem` 与文件选择显示剥离全部 `\p{Cf}`/行分隔符。
  8. **文档数字/覆盖描述过期**（P2）：README、verification 实时数字与 browser README 文案已更新。
- **owner 已确认（2026-10-24）**：采用「免责声明 + 阅读确认」方案保留外部内容，替代原计划的审计前强制仅外观。docs 已记录批准；执行层工具权限、真实 Origin/CSRF 审计仍作为发布前加固项保留。

## 修复后的复验（Lead 独立执行）

- `npm test`：**205/205**（Host 88、Client 96、packaging 21；0 失败/跳过）
- `npm run check`：通过；renderer 解析/渲染 41/41、contrast OK、i18n 4 个程序、typography 22/22
- `npm run test:browser`：**7/7**；settings **94**、on-demand **114** 断言
- `npm run pack:check`：**43** 文件，压缩 **4,048,614** 字节、解包 **10,261,873** 字节
- `git diff --check` 通过；文档链接检查通过

## 残余风险 / 发布闸门

- 第三方 directives 的提示词注入无法由本扩展消除；执行层（DSH 工具/权限）审计与真实部署 Origin/CSRF 审计仍未完成。
- 未做真实模型/对抗性观察；未更新营销截图；`npm run typecheck` 因仓库无 `tsconfig.json` 仍不可用（既有事实）。
- 发布前必须完成执行层审计，或由 owner 批准阅读确认方案；否则应回退为「仅导入外观」。
