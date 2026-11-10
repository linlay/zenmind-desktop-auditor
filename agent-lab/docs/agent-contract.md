# Agent Bridge 边界与验收

## 接口

- `agent.list()` → `{items:[{agentKey,name,role}],defaultAgentKey}`。
- `agent.query(message | {message,agentKey?,chatId?,uploadIds?,skillIds?,background?})`：默认等待 `{text,agentKey,chatId,runId}`；后台返回 `{accepted,chatId,runId}`。当前没有 query 流返回，不伪造 raw Platform 流。
- `agent.execute({message,input?,outputSchema,agentKey?},{signal?})`：结构化交卷；不接受文件、references、chatId 或任意路由。
- `agent.observe({runId,cursor?},{signal?})`：异步迭代器，内部轮询 `agent.events`；只观察本实例 query 后台 Run。
- `agent.interrupt({runId})`；`steer({runId,message,requestId?,steerId?})`；`send({runId,message,requestId?})`；`submit({runId,awaitingId,submitId?,param?|params?})`。param 与 params 二选一。Run owner 始终为创建时根 agentKey，TEAM 成员不改变 owner。
- `agent.upload({file:Blob,name?,chatId?,agentKey?},{signal?})`：单文件 64 MiB，返回 canonical chatId 和 upload；句柄 30 分钟有效；query 最多引用 16 个。
- `agent.resource.read({chatId,file},{signal?})`：Chat 相对路径，返回字节流，当前有界 16 MiB。
- `artifact.list/get/read/open/saveAs`：既有已发布产物接口，read/saveAs 当前 1 MiB；`@chat/...` 不是 artifactId。

## 订阅结论

旧 assistant.subscribe 是轮询 assistant.events 的有界文本/状态缓存消费者。新名 observe 用于提交后的观察、同一实例游标续读，不是 Platform attach 或持久事件服务。当前最多 256 条事件、128 Run，30 分钟后释放。游标过期报告 event_cursor_expired，不重新提交 query。解除观察不 interrupt；宿主重启、实例/本地身份变化不能恢复旧 Run。页面刷新也不能保证归属仍然有效。原始工具参数和结果不对外透传，awaiting 只提供 ID/模式，复杂表单仍需真实集成验证。

## 图像结论与证据

Desktop `src/main/modules/desktop-actions/webapp-page-methods.ts` 的旧 image 方法固定 `agentKey:zenmi`，调用 completeImage 并返回 desktop-zenmi。它是旧 Image Studio 专用适配，不能升级为 agent.image。

Platform `internal/tools/tool_image_generate_edit.go` 校验具体图像模型是否支持 edit、蒙版协议、输入来源及尺寸。mask 需要 images[0]，并区分 alpha/white_edit/black_edit。这些工具参数不是 Agent query 参数。

因此本次不提供 agent.image、通用 modelId 或 mask 参数，也不暴露任意模型 HTTP URL。query 的 Agent 可能自行调用图像工具；是否成功取决于 Agent 工具、模型、权限与配置。上传原图或蒙版仅形成附件引用，不证明模型收到原生编辑蒙版。图像工具生成文件后，通过 resource 或已发布 artifact 获取，不将文本 URL 伪装成产物。

Platform 的 `/api/execute` 支持 references、已有上传 Chat 和 multipart（见该仓库 docs/智能体执行接口.md），但 Desktop execute 当前未开放这些字段；Lab 明确保留差异，不伪造文件结构化执行支持。

## 迁移与兼容

新应用只使用 agent.list/query/observe/interrupt 等规范名称，没有 agent.chat/stop/subscribe/image。Desktop 显式允许列表将规范 Action 适配到已有安全处理器；原有本实例 Chat/Run、身份复验和上传大小边界保持。旧 assistant.* 暂保留为废弃兼容入口，包括 stop/image，避免破坏现有 Bridge Lab 与图像应用；不是新契约的通用能力。生成 SDK 由 Desktop 的 webapp-contract:generate 产生，不直接修改副本。

Compose `internal/webappbridge` 有独立处理器和 SDK；本次未将 Desktop SDK 复制到 Compose。旧 Compose 能力维持原状态，新目录/上传/控制/agent 名称不得标为已支持。

## 真实环境手工验收

1. macOS / Windows 分别导入 ZIP；确认 Agent 目录与宿主默认一致，不显示路径或凭据。
2. 各完成一次前台 query、后台 query→observe→解除→游标续读→interrupt。确认解除观察后运行继续，根 Agent 不被控制参数替换。
3. 上传文本/图片，继续 canonical Chat，再生成文件并测试 resource.read 与真实 artifact；测试跨实例 ID、路径穿越、64 MiB 上传上界与超限。
4. 支持 result_submit 的 Native Agent 验证 execute success/failure/cancel；不支持的 Agent 应明确拒绝。
5. 后端模式验证 query/execute/控制；发布与跨源访问后端应拒绝。不自动重放失败请求。
6. 图像任务分别确认工具执行与产物；蒙版编辑必须由实际工具日志确认，不能仅凭附件或回复宣称通过。
