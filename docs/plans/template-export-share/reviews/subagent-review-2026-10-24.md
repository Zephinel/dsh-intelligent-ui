# 独立 subagent 第二轮评审记录（模板导出/分享）

> 2026-10-24。两个只读通用 subagent 复核上一轮修复与当前工作树（HEAD `b53482f` + 未发布改动）；Codex CLI 仍因账号用量限制不可用。两者均 **SHIP WITH CHANGES、无 P0/P1**。评审后 Lead 已修复下列问题并独立复跑门禁。

## 发现与处置

1. **P2 保存中仍可从父面板关闭导入**（Composer 面板外点/返回/chip、设置页 disabled）→ 已修：导入 busy 上报父面板；父面板关闭路径与 disabled 渲染守卫在 POST 期间让位；e2e 覆盖 Escape/禁用/焦点保持。
2. **P2 directives 仅剥离 bidi，tag/ZWSP/WJ 等不可见字符可夹带隐藏文本** → 已修：导入时剥离全部 `\p{Cf}`；补 12 个 bidi 控制与 tag/零宽测试。
3. **P2 修改 name/description 不重置确认（与文档不符）** → 已修：任何预览编辑重置确认；e2e 覆盖。
4. **P2 选择文件名保留行分隔符/C1** → 已修：显示清洗；e2e 覆盖。
5. **P2 缺边界测试、文档口径冲突** → 已补：码点安全截断（共享函数 + 单测）、fileStem Cf/行分隔符、codec 对不可导出名称的拒绝断言；**导出失败 UI 的 `template.exportFailed` 分支仍无专门测试**（只在 codec 层验证抛出）。文档统一为“每次导入都确认 / 描述仅保存/导出、不进提示词 / 执行层与 Origin 审计为发布前加固”，plan 原计划条款加“已被 2026-10-24 owner 决定取代”。

## 修复后复验（Lead 独立执行）

- `npm test` / `npm run check`：**206/206**（Host 88、Client 97、packaging 21；0 失败/跳过）
- renderer 解析/渲染 41/41、contrast OK、i18n 4 个程序、typography 22/22
- `npm run test:browser`：**7/7**；settings **100**、on-demand **114** 断言
- `npm run pack:check`：**43** 文件，压缩 **4,049,089** 字节、解包 **10,262,652** 字节
- `git diff --check`、文档链接检查通过

## 残余风险 / 发布闸门

- 第三方内容（name/directives）仍可能影响模型；免责声明 + 预览确认是缓解，不消除提示词注入。
- DSH 执行层工具权限、真实部署 Origin/CSRF、真实模型对抗观察仍未做，保留为发布前加固项。
- 未更新营销截图；`npm run typecheck` 因仓库无 `tsconfig.json` 仍不可用（既有事实）。
