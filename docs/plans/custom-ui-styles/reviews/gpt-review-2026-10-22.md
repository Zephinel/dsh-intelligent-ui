DSH Intelligent UI 交互重构评审
SHIP WITH CHANGES

结论：整体方向正确，建议采用「主对话驱动 + 一次性意图 + 内联样式快照 + 事后可选保存」的架构，但不建议直接按目前六项方案全部实现。

现有的模板模型、Host 样式约束、主题 token 校验、真实 renderer 预览和测试体系都值得保留。需要重构的是生成流程的入口、执行状态以及生成结果的生命周期，而不是推翻整个样式系统。

当前方案有四个需要优先解决的架构问题：

优先级

	

发现

	

判断




P0

	

Host 每会话布尔标志无法可靠关联触发消息、工具调用和浏览器标签页

	

必须改为带 ID 的操作状态机




P0

	

temporaryStyle 没有 baseLayout，且会与现有强制 styleId 策略冲突

	

必须统一样式解析与优先级




P0

	

内联主题和 directives 不一定足以把一次生成结果变成可复用模板

	

必须定义可复用的样式快照




P0

	

尚未证明内联样式能完整经过聊天记录持久化、重放和导出链路

	

必须在删除旧路径前验证

另外有三个 P1：

ask_user_question 的工具可用性、提问次数和恢复机制不能只依靠系统提示词。

样式调整需要稳定引用原始结果，并追踪最新版本，否则容易保存旧样式。

Composer 的「按需生成」应是一次性的输入意图，而不是立即切换整个会话的样式设置。

我赞成内联 temporaryStyle，也赞成废弃独立创建弹窗作为主流程；但建议先解决上面四个 P0，再实施 UI 替换。

以下评审基于你提供的已实现状态，并非实际代码审计。涉及 DSH 内部事件、工具执行与消息持久化的地方，我会明确区分设计建议和需要通过代码验证的前提。

一、建议确定的目标架构

不要把「按需生成」实现成第四种持久样式，也不要把它实现成必须经过几个页面的创建工作流。

建议分为五个独立职责：

Composer

用户选择按需生成，并通过正常聊天发送需求

Generation Intent Controller

绑定消息 ID · 管理追问 · 取消 · 失败和完成

DSH 主对话模型

理解需求 · 必要时 ask_user_question · render_ui

Render Result + Style Snapshot

立即渲染 · 结果及样式配置随消息保留

继续调整

新修订版本

保存为模板

可选持久化

仅保存时

Existing Style Catalog

使用现有 StyleTemplate 和存储 API

这里有一个重要区分：

Generation Intent：用户此刻要系统做什么，属于执行状态。

Style Snapshot：这次结果实际采用了什么样式，属于结果数据。

StyleTemplate：用户决定长期保留的可复用样式，属于持久化资源。

三者应该能够独立存在，也应该有清晰的转换关系。

二、temporaryStyle：推荐内联，但必须是完整快照
1. 内联比临时模板 ID 更适合这个场景

我推荐：

render_ui 内联样式快照，Host 校验并规范化，结果随聊天消息保留，保存模板时再转入 catalog。

原因如下：

维度

	

内联 Style Snapshot

	

临时模板 ID + Catalog




单次生成

	

不需要预先写入样式库

	

需要分配与注册 ID




聊天重放

	

结果自包含

	

依赖 catalog 仍可查询




模板删除

	

历史结果不受影响

	

容易出现引用失效




事后保存

	

可以直接复制快照

	

需要转换临时模板




垃圾回收

	

无需单独管理临时模板

	

需要处理孤立资源




数据成本

	

每个结果存一份样式数据

	

可以共享同一资源




实现复杂度

	

Schema、Host、消息链路需要改动

	

生命周期和存储管理更复杂

对于当前限制在 2,000 字符以内的 directives，以及一组受控 theme tokens，重复存储快照通常比维护临时模板资源更合理。

但需要补充两个关键条件。

2. temporaryStyle 必须包含 baseLayout

你们提出的结构：

TypeScript
temporaryStyle: {
  name?,
  directives,
  theme
}

不够完整。

它缺失 baseLayout，而现有 StyleTemplate 明确要求 card | article。

建议定义一个可以独立复用的规范化结构：

TypeScript

interface StyleSnapshotV1 {
  schemaVersion: 1;
  baseLayout: "card" | "article";
  directives: string;
  theme: StyleTheme;
}

interface TemporaryStyleInput extends StyleSnapshotV1 {
  suggestedName?: string;
}


其中：

schemaVersion 用于后续迁移。

baseLayout 与当前 render_ui.style 保持一致。

directives 描述可迁移到其他内容的样式规则。

theme 复用现有受控 token。

suggestedName 仅用于界面建议，不代表模板已经命名或保存。

不要让模型填写 Host 权威的 resultId、sessionId 或 revisionId，这些应由 Host 生成。

3. 样式来源必须互斥

建议保持原有 render_ui 工具，通过可选字段扩展，而不是新增第二种渲染工具。

简化结构：

TypeScript

type RenderUIArgs = {
  style: "card" | "article";

  // 已持久化的自定义样式
  styleId?: string;

  // 一次性或迭代生成的内联样式
  temporaryStyle?: TemporaryStyleInput;

  // 原有 OpenUI Lang 程序字段
  // ...
};


Host 执行以下约束：

TypeScript

function validateStyleSource(
  args: RenderUIArgs,
  context: RenderContext
) {
  if (args.styleId && args.temporaryStyle) {
    throw new Error(
      "styleId and temporaryStyle are mutually exclusive"
    );
  }

  if (args.temporaryStyle) {
    if (!context.allowsTemporaryStyle) {
      throw new Error(
        "Temporary style is not authorized for this turn"
      );
    }

    const snapshot =
      normalizeAndValidateStyle(args.temporaryStyle);

    if (snapshot.baseLayout !== args.style) {
      throw new Error("baseLayout mismatch");
    }

    return {
      kind: "temporary" as const,
      snapshot,
    };
  }

  // Existing styleId / session / global resolution.
  return resolveExistingStyle(args, context);
}


context.allowsTemporaryStyle 必须由 Host 根据本次合法的按需生成操作或明确的样式修订操作决定，不能由模型自己声明。

特别注意现有约束：

会话使用自定义样式时，Host 强制要求 styleId 等于模板 ID。

这个检查必须在按需生成场景下调整。

建议最终优先级为：

1. 本轮明确授权的临时样式

仅影响目标结果，最高优先级

2. 会话样式覆盖

现有自定义模板或内置样式

3. 全局默认样式

Plugin Settings 中的默认选择

4. Built-in Auto

最终兜底

授权完成后不应改变第二、第三层设置。

4. 最大的隐患：样式快照是否真的可复用？

这里是我认为最容易被忽略的问题。

一次 render_ui 调用通常同时产生：

针对本次内容的 OpenUI Lang 程序。

针对本次内容的视觉设计和布局方式。

能够渲染当前内容，不代表已经得到一份可以适用于其他内容的模板。

例如模型生成了某个财务分析仪表盘，使用了五张指标卡、一张折线图和一个结论面板。

如果生成的 directives 是：

顶部显示五张指标卡，下方放置收入折线图。

这可能是对当前内容的描述，而不是通用的样式定义。

保存后用于一篇技术文章，就可能生成不合理的结构。

建议区分：

Render Program：此次回答的具体内容和组件树。

Reusable Style Spec：布局原则、信息密度、视觉层级、排版、配色和组件表现规则。

要求模型在输出临时样式时提供通用的设计规则，而不是复制当前业务内容。

例如：

Plain text

Use a compact, modern dashboard presentation.

Prioritize information hierarchy and concise headings.
Use cards for independently meaningful content groups.
Choose charts only when the content contains suitable data.
Avoid decorative elements that do not aid comprehension.
Preserve readability on narrow screens.


这更适合作为持久化模板的 directives。

生成结果与样式规范可以在同一次 render_ui 调用中输出，不需要额外调用模型创建模板。

但是，真实模型能否稳定地做到这一点，必须纳入端到端测试。

5. 重放与持久化的边界

这里需要区分两种持久化：

临时样式不是持久化模板，但它可以作为聊天结果的一部分保存。

推荐的结果结构如下：

TypeScript

interface RenderedUIArtifact {
  resultId: string;
  sessionId: string;
  messageId: string;

  program: OpenUIProgram;
  styleSnapshot: StyleSnapshotV1;

  styleSource:
    | "builtin"
    | "saved-template"
    | "on-demand";

  revisionId: string;
  parentRevisionId?: string;
}


program 在这里代表现有 OpenUI Lang 程序的数据结构，具体类型应使用项目中的真实定义。

要求：

聊天历史重放时读取该结果的样式快照。

导出时使用结果自身的 theme，而非当前全局主题。

保存模板时从已校验的快照生成 StyleTemplate。

删除某个持久化模板，不应破坏历史聊天结果。

前端刷新后不需要重新调用模型才能重现已提交结果。

需要先检查 DSH 的聊天历史是否保存了完整工具参数及结果元数据。

如果没有，就必须在现有消息持久化层建立可靠的快照存储关联，而不是假定前端始终能取回原始 temporaryStyle。

同时，导出链路还要验证 CSS 变量是在截图、页面导出和主题切换时正确应用的。

6. 安全校验不能只检查颜色

现有的主题 token 白名单和对比度校验可以直接复用，但还需要保证：

不接受模型输出的任意 CSS、HTML、脚本或远程样式 URL。

限制深层对象、属性数量、字符串长度及消息整体大小。

只接受已知 schemaVersion 和受控字段。

主题在 Host 校验，客户端再做防御性检查。

用户可控的 directives 不得提升为能够覆盖 Host 安全策略的高权限指令。

最后一点尤其重要。

你们现在已经把保存模板的 directives 注入系统提示词。临时样式如果也采用相同机制，需要重新审查信任边界。

建议将样式 directives 视为受约束的展示偏好数据，明确标记来源和优先级，禁止其中内容覆盖工具使用、安全规则或其他上层指令。

三、一次性意图：不要用单个 Boolean，使用请求级状态机

现有建议：

TypeScript
onDemand: boolean

对于简单单标签页场景可以工作，但在真实聊天系统中风险较高。

例如：

用户点击按需生成，却迟迟没有发送。

两个浏览器标签页打开同一会话。

模型先提问，回答在下一轮才到来。

工具失败，模型重新调用。

用户取消后，旧异步结果才返回。

用户在生成过程中继续发送普通消息。

这些都不是布尔值可以可靠表达的状态。

推荐状态机

按需生成状态机

核心状态及转换

Composer Armed

仅前端：等待用户发送消息

发送带操作 ID 的消息

Running

Host 正在执行本次生成

Clarifying

等待结构化回答

回答后返回 Running

Completed

结果提交成功，意图清除

Cancelled

显式取消 / 操作失效

Failed

失败后显式重试

建议实际状态：

TypeScript

type OnDemandStatus =
  | "running"
  | "clarifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

interface OnDemandOperation {
  operationId: string;

  sessionId: string;
  clientInstanceId: string;
  triggerMessageId: string;

  status: OnDemandStatus;

  clarificationRounds: number;

  resultIds: string[];

  createdAt: number;
  updatedAt: number;
}


不必强制逐字使用这些命名，但需要这些语义。

关键建议：Composer Armed 尽量留在前端

点击「按需生成」时，最好不要立刻让 Host 创建一个已经生效的会话样式标志。

推荐：

Composer 在本地进入 armed。

输入框出现可取消的提示。

用户发送消息。

将 onDemand 请求标识绑定到这条实际用户消息。

Host 创建正式 Operation。

这样用户点击后又改变主意、切换页面、清空输入，都不会留下服务端的悬挂状态。

如果 DSH 消息发送机制支持消息元数据，优先使用元数据标记这一次操作。

如果不支持，可以复用 /iui 命令或现有服务端路由，但必须引入操作 token，并在消息发送时完成绑定。

不建议仅靠执行 /iui on-demand，然后把会话下一条任意消息视为触发消息。

这会引入竞态，也可能误消费来自其他标签页的消息。

生命周期规则

事件

	

应执行的行为




用户在发送前取消

	

清除 Composer 本地 armed 状态，不触发 Host




用户发送需求

	

原子绑定 operationId 和 triggerMessageId




模型调用 ask_user_question

	

进入 clarifying，保留同一 Operation




用户回答澄清问题

	

恢复同一 Operation，而不是开启新的按需生成




render_ui 校验且结果提交成功

	

记录结果快照，完成 Operation




模型返回普通文本但没有生成 UI

	

作为未完成或失败处理，不能静默污染下一轮




工具调用失败

	

失败状态，允许针对同一需求显式重试




用户取消正在执行的生成

	

取消 Operation，并阻止旧结果继续提交




页面刷新 / Host 重启

	

从既有记录恢复已完成结果；无法恢复的执行标记为中断

多标签页

建议用 operationId + sessionId + clientInstanceId 关联生成请求，不共享某个简单的 session Boolean。

同一会话并发按需生成，第一版建议采用保守策略：

同一会话最多一个活动中的按需生成 Operation。

第二次触发时可以提示恢复、取消或替换，而不是默默覆盖第一个操作。

普通消息不应自动接管该 Operation。只有明确关联的澄清回答、调整操作或重试才继续原有执行。

什么时候清除意图？

推荐以：

Host 接受有效结果并完成消息提交

作为成功边界。

不应该在以下时刻清除：

用户刚点击发送。

模型开始响应。

模型发出第一条文本。

模型调用澄清工具。

render_ui 参数校验失败。

如果同一轮回答允许多个合法的 render_ui 输出，建议在该轮完成时统一结算，而不是第一个工具调用成功就撤销后续工具的临时样式授权。

四、如何可靠使用 ask_user_question

这里的核心判断是：

Prompt 可以指导模型提问，但不能独自保证执行协议。

建议采用三层约束。

第一层：请求级提示词

只在本次按需生成 Operation 中注入，不要写入永久会话系统提示词。

建议：

Plain text

ON-DEMAND UI GENERATION

The current user message requests an on-demand UI result.

Use the user request and relevant conversation context.

1. If the requirements are sufficient, call render_ui
   directly and generate the final result.

2. Ask clarifying questions only when important
   missing details would materially affect the result.

3. If clarification is necessary, use the available
   ask_user_question tool with concise structured
   options and allow free-form input when supported.

4. Do not ask for details already present in context.

5. Use reasonable defaults for nonessential details.

6. Do not require the user to preview, name, confirm,
   or save a template before rendering.

7. Provide a reusable style specification alongside
   the rendered UI.

8. The temporary style applies only to the authorized
   result or refinement operation.

9. Do not modify the global default style or save
   a template without explicit user action.


请按 DSH 真实工具能力调整文字，不能假设模型一定能够使用尚未注册的提问工具。

第二层：工具可用性和结果校验

必须确认：

ask_user_question 在本次主对话模型运行中确实可用。

该工具支持哪些选项结构。

是否支持自由输入与跳过。

工具回答如何恢复原执行上下文。

工具结果是否可能由新的聊天回合承载。

Host 应根据实际工具事件维持 clarifying 状态。

如果模型发出澄清问题，Host 不得把它误判为普通回答完成。

如果澄清工具不可用，应有明确的降级策略，例如使用普通聊天提问，但不能声称仍然提供同等的结构化体验。

第三层：轮次和问题数量控制

建议初版：

每轮澄清最多 1–3 个关键问题。

默认最多 2 轮主动澄清。

优先给出可直接选择的选项。

非必要问题允许跳过。

用户拒绝补充时，应采用合理默认值继续生成。

这些是推荐初值，并非固定协议限制。

达到限制时，不应强制模型无限等待。如果仍然缺失关键输入，应明确说明缺什么；如果只是视觉偏好不完整，应直接生成。

还应处理一种常见问题：模型在同一轮中调用了 ask_user_question，随后又提前调用 render_ui。

建议 Host 对尚未得到必要回答的 Operation 禁止进入最终提交阶段，避免提问只是形式上的步骤。

五、「调整样式」和「保存为模板」的 UI 位置

建议使用扩展自有的结果级操作区，不要让模型负责生成这些控制按钮。

原因很简单：

用户生成的 OpenUI Lang 组件内容可能变化很大，但「调整」「收藏」「重试」等是扩展的固定产品能力。

这些操作应该由 Host / 扩展渲染层控制，而不是写进模型生成的 OpenUI 程序里。

推荐设计

按需生成的 UI

临时样式

Project Overview

紧凑布局 · 现代风格

24

项目

18

进行中

6

已完成

项目进度

总体完成率

68%

调整样式
保存为模板
此处为交互示意，保存操作尚未连接实际扩展

实际实现时可以默认只显示低干扰的操作行，鼠标悬停时增强显示；触屏和键盘操作仍应能访问，不要完全依赖 hover。

调整样式

点击后：

保留现有输入框草稿。

为用户准备调整当前结果的输入意图。

关联本次 resultId。

正常聊天发送调整需求。

生成新的结果修订版本。

不要只靠「调整刚才的 UI」这样的自然语言定位。

用户可能在两个结果之间插入大量消息，也可能连续生成多个 UI。

最好让调整意图与具体结果关联。

保存为模板

点击时打开轻量 Popover。

建议默认只有两个字段：

名称（必填）

描述（可选）

下面使用低干扰文案：

「保存到我的样式，方便以后复用；不会更改当前会话或全局默认样式。」

如果继续支持 global | session 的模板存储范围，可以在高级选项中调整，或明确默认保存到全局可复用的个人样式库。

这里的 global 表示模板可用范围，不表示自动应用到所有会话。建议在数据层和界面文案上明确区分。

保存接口建议改为引用结果

你们已有 POST op:'save'，可以保留。

但我更推荐为「保存当前结果」增加一种服务端操作：

JSON

{
  "op": "saveFromResult",
  "resultId": "result_123",
  "revisionId": "rev_3",
  "name": "Linear Compact",
  "description": "Modern compact dashboard",
  "scope": "global"
}


Host 从已存在的结果快照提取样式，规范化后转为现有 StyleTemplate。

相较于让客户端重新 POST 一份可任意修改的 directives 和 theme，这样具有更明确的来源、版本和权限校验路径。

同时需要确保：

请求经过现有 connection 鉴权。

当前用户有权访问目标结果和会话。

保存操作具备幂等处理。

重名时给予明确提示。

保存不自动改变会话或全局默认样式。

保存的是用户指定的结果修订，而不是一个意外被覆盖的全局临时变量。

样式调整后如何保存最新版本？

不要使用单个可变对象保存「当前临时样式」。

更稳妥的方式是：

Plain text

Result A / Revision 1
  └── 调整样式
       └── Result B / Revision 2
            └── 再次调整
                 └── Result C / Revision 3


每个结果都持有自己的不可变快照。

用户点击哪个结果的「保存为模板」，就保存哪个结果对应的修订。

这能保证历史结果仍可准确重放，也能防止旧卡片错误地保存最新版本。

六、现有 Stage 3：保留哪些，删除哪些？

我建议拆除工作流，但保留底层能力。

当前组件或能力

	

建议

	

原因




StyleCreator 独立创建弹窗

	

从主流程移除

	

不再符合聊天内直接生成




/styles/draft LLM 访谈路由

	

最终删除

	

与主对话模型的澄清能力重复




草稿 JSON Schema 校验

	

保留并抽离

	

可复用于临时样式和保存模板




明暗双预览

	

保留组件，取消强制步骤

	

适用于模板管理和显式预览




Theme token 校验

	

保留

	

Host 与客户端的重要安全边界




对比度校验

	

保留

	

临时样式和模板都需要




StyleTemplate / Catalog

	

保留

	

仍是持久化模板的核心




真实 renderer 预览

	

保留

	

比静态假缩略图更可信




/iui style 命令

	

保留

	

与按需生成不冲突




创建弹窗中的保存逻辑

	

抽离复用

	

供结果卡片和模板管理使用

删除顺序

不建议一开始就把 StyleCreator 和 /draft 立即删掉。

更稳妥的步骤：

先把验证、预览、保存逻辑抽成独立能力。

建立新的聊天内按需生成路径。

完成结果快照与保存复用。

跑完回归和真实模型测试。

确认旧路径不再被引用。

删除旧弹窗、访谈路由、无用状态和对应的过期测试。

这样不会为了取消旧 UI 而损失已经实现的能力。

同时，不能保留两个互相平行的生成实现。完成迁移后，最终代码应只有一套样式校验和持久化服务。

七、另外几个容易遗漏的缺口
1. 直接使用与「作用范围」不是同一个问题

当用户说「把这次分析做成仪表盘」时，应默认仅生成当前结果。

当用户说「接下来所有回答都用这个风格」时，才需要明确采用当前会话的持续样式覆盖。

这两种意图必须分离。

如果未来允许把临时样式设置成全局默认值，我建议要求用户先明确保存或确认持久化，不能无提示修改全局设置。

否则临时快照可能在 Host 重启后消失，导致全局默认值无法恢复。

2. 模板复用不应依赖原始内容

上面提到的可复用样式规范，还涉及一个数据安全问题。

一次回答可能包含：

私有项目名称

业务指标

用户输入的敏感数据

特定文档内容

这些不应该因为用户保存了一个视觉模板，就被不必要地永久复制到模板 directives 中。

建议保存时检查 directives 是否混入当前结果特有的数据，尽可能提炼为可迁移的设计规则。

3. 生成失败不能偷偷降级成看似成功

例如模型生成了不合法的主题，Host 校验失败。

推荐：

在同一操作内部尝试一次受限修复。

仍然失败则返回明确错误。

允许用户重试或采用内置样式。

不要在无法完成定制样式时直接静默切换为 Card，却对用户宣称已经应用了请求的风格。

如果使用了兜底样式，必须让结果元数据反映真实情况。

4. 现有 card | article 可能限制动态样式

你们现在的自定义模板仍然基于两个基础版式。

这不一定有问题，因为 OpenUI Lang 本身可能支持在 Card 基础上构建复杂结构。

但需要确认一件事：

用户提出仪表盘、画廊、看板或流程图时，baseLayout 和现有自由布局模式是否会限制模型实际可输出的组件树？

特别是 article 必须包含 Toc + Section 的硬约束，可能与用户所需展示形式冲突。

我不建议现在立即引入第三个基础版式，而是先做真实模型测试，确定是否存在结构性限制。

5. 模板删除与历史结果

历史结果应继续使用自身的快照渲染。

如果当前会话正在使用某个持久化模板，而模板随后被删除：

已生成的结果保持原样。

后续生成沿用你们现有的失效回退策略。

前端要显示已失效或已回退的状态。

不应因为 catalog 缺失而重写历史结果。

6. 样式目录的实时同步

你们现在已有 catalog 获取失败时的主题回退。

还应该考虑：

Composer 保存新模板后，菜单是否立即更新。

多标签页中另一个标签删除模板后，当前页是否更新。

旧缓存里的模板是否可能被误选。

保存后的模板是否在页面刷新后仍可访问。

可以通过保存成功后的局部缓存失效和重新拉取解决，不必为了这项功能引入复杂的实时订阅机制。

7. 模型能力与协议能力要分开测试

153 个 Node 测试和 6 套浏览器 E2E 全绿，是很好的工程基础。

但它们不能证明主对话模型一定会：

在信息充分时直接调用 render_ui。

在真正存在歧义时调用 ask_user_question。

不进行冗余确认。

输出可复用的 directives。

在用户连续修改风格后保持正确关联。

这些必须通过真实模型端到端验证。

八、推荐的落地顺序

建议改成下面六个阶段，先完成 Host 正确性，再调整 UI。

Phase 1 — 样式快照与渲染协议

P0

定义 StyleSnapshotV1，扩展 render_ui，解决 styleId 冲突、Host 校验、主题继承和文章结构约束。

验收：有效快照可渲染，非法组合被拒绝，原有样式行为不退化。

Phase 2 — 结果快照与重放

P0

验证 DSH 消息存储链路，保证结果可以在刷新、主题切换和导出后准确还原。增加结果 ID、修订 ID 和快照版本。

验收：删除相关模板或 catalog 不可用时，历史临时结果仍能正确展示。

Phase 3 — On-Demand Operation Controller

P0

实现请求级意图、消息绑定、结构化提问关联、取消、失败、重试和完成机制。优先使用请求元数据，避免会话 Boolean。

验收：多标签页、连续追问、取消后迟到结果均不会污染其他消息。

Phase 4 — Composer 与结果操作 UI

P1

将「智能创建新样式」改为「按需生成」，回到正常输入框；增加示例和取消入口；结果卡片增加调整、保存操作。

验收：不覆盖草稿，不强制预览，不强制保存，结果操作能准确关联对应卡片。

Phase 5 — 模板保存与管理

P1

实现 saveFromResult、重名处理、模板更新和删除；设置页承担持久化管理，Composer 保留轻量管理入口。

验收：临时结果使用、事后保存、再次复用均成立，且不自动修改全局默认。

Phase 6 — 真实模型验证与旧路径清理

P1

使用实际部署的 DSH 模型测试按需生成、澄清、调整和保存；确认稳定后删除旧的创建弹窗及草稿路由。

验收：真实模型场景通过，现有测试继续全绿，不存在两套并行创建流程。

九、建议新增的核心测试

以下场景值得纳入自动化验收。真实模型相关场景则应另外做端到端评估。

重构验收检查表

0/14

按需生成入口不会覆盖已有 Composer 草稿

UI

两个标签页不会互相消费按需生成意图

State

模型连续两轮澄清后仍能正确完成生成

Agent

取消后迟到的 render_ui 结果不能提交

State

非法 temporaryStyle 与 styleId 组合被拒绝

Host

Article 的 Toc + Section 约束保持有效

Host

历史结果可在模板删除后准确重放

Persistence

深色、浅色、导出的样式快照一致

Renderer

调整三次后可保存指定修订版本

Workflow

重复保存请求不会生成重复模板

API

临时生成不改变后续普通消息的样式

State

插件关闭时无法绕过授权使用 temporaryStyle

Security

保存模板不会自动改写全局样式默认值

Persistence

模板 directives 无法覆盖 Host 的高优先级规则

Security

重置
复制检查表
用于工程验收记录，勾选不会自动运行测试。

建议在真实模型测试里专门覆盖一个对抗性场景：

用户给出很清楚的需求，例如：

把上面的技术分析整理为紧凑的浅色卡片布局，标题清晰，保留关键代码块，不要额外确认。

预期是模型直接使用 render_ui，而不是先问四个关于颜色、密度、图标和布局偏好的问题。

这对于验证「不强制澄清」尤其重要。

十、最后的架构裁决

决策项

	

建议




使用主对话模型替代独立访谈模型

	

同意




从 Composer 启动按需生成

	

同意




使用 /iui on-demand 设置会话 Boolean

	

反对，改为绑定消息的请求级 Operation




使用 render_ui.temporaryStyle

	

同意，但必须包含完整、可版本化的 Style Snapshot




临时样式直接渲染

	

同意




生成前强制预览

	

取消




生成前强制命名和保存

	

取消




通过普通聊天继续调整

	

同意，但需要关联结果与修订 ID




结果卡片提供保存入口

	

同意，使用扩展自有操作区




保存时重新生成模板

	

不推荐，优先复用已有的规范化样式快照




立即删除 Stage 3 全部实现

	

不推荐，先抽离公共能力再清理




设置页提供第二套生成工作台

	

不推荐




模板管理留在设置页

	

同意，Composer 可提供轻量入口

最值得坚持的三个工程原则

第一：生成意图是 Operation，不是 Setting。

不要把按需生成误建模为一种会话样式设置。它有自己的触发、运行、澄清、完成和失败生命周期。

第二：已生成结果是 Artifact，不是 Template。

每个结果应有独立、不可变、可重放的样式快照。模板只是用户选择保存后，从这个快照派生出的持久化资源。

第三：UI 生成属于聊天主流程，不属于模板管理流程。

正常聊天负责理解、提问、生成和调整；Composer 负责启动意图；结果操作区负责可选保存；设置页负责全局配置和长期管理。

最终建议：批准整体架构方向，但将 Phase 1–3 作为合并新交互 UI 前的架构门槛。 这样能够最大程度复用已完成的 Stage 3 投入，同时避免把一次性生成能力做成另一套难以维护的会话状态系统。