# WebApp Bridge API 参考与验收说明

本文供测试人员和外部开发者共同使用。接口快照来自 **CuteJ / ZenMind Desktop v0.5.42，2026-11-09** 对应的公开 WebApp SDK：8 个命名空间、64 个可调用方法，其中 43 个已实现、21 个预留。清单包括函数属性 `assistant.image.cancel`；顶层 `createBackendClient` 与 `DesktopBridgeError` 属于工具导出，不计入64项。

运行时以当前页面从 `/__desktop/bridge.js` 加载的模块、方法是否存在及 `desktop.capabilities.list()` 为准。旧宿主可能没有 `assistant.execute`。出现缺失应标记“当前宿主不支持”，不要改用任意 Desktop Action 或静默回退到 chat。

## 最小接入

浏览器示例使用 ES Module，例如 `<script type="module">`。不要硬编码本机端口；使用 gateway 同源模块。安装已授予公开 WebApp 能力，新应用不需要先声明旧 desktopBridge 字段或调用 requestAccess。

```js
import { desktop, assistant, DesktopBridgeError } from '/__desktop/bridge.js';

const capabilities = await desktop.capabilities.list();
const executeAvailable = typeof assistant.execute === 'function'
  && capabilities.capabilities.some(item => item.id === 'assistant.execute'
    && item.status === 'available' && item.declared);
console.log({ executeAvailable });
// available 不代表 Agent、账号、设备或业务前置条件已经满足。
```

受管 Node 后端使用随项目提供的生成 SDK；真实配置由宿主注入，不复制到前端、源代码、日志或导出报告：

```js
import { createBackendClient } from './bridge.mjs';

const client = createBackendClient({
  url: process.env.DESKTOP_ACTION_BRIDGE_URL,
  token: process.env.DESKTOP_ACTION_BRIDGE_TOKEN
});
const result = await client.connector.list();
console.log({ connectorCount: result.items.length });
```

后端只有 assistant、connector、skill、automation、kanban、artifact 六个命名空间，没有 desktop 或 auth。assistant.image、artifact.open、artifact.saveAs 在后端是 `not_implemented` stub；后端 assistant.image 没有 cancel 属性。automation 当前也都是 stub。方法表的“页面+后端”只表示真实可用的数据调用，预留方法的存在不计为支持。

应用自行设计的后端测试端点必须校验访问来源与会话，不能向远程访客开放任意 SDK 转发，也不能从 HTTP 请求接收宿主 token 或任意动作名称。Desktop 官网身份和本地 Platform 身份有不同职责；本地能力不可用不应一概提示“先登录官网”。

## 验收结果的含义

| 状态 | 判定 |
| --- | --- |
| 通过 | 真实调用符合契约；需要人工观察的功能，还应核对可见结果 |
| 业务失败 | execute 返回 status:failure，或连接器结果声明业务失败；不是传输异常 |
| 调用失败 | SDK 抛出错误；记录稳定 code/action 和适当诊断，不自动重放 |
| 用户取消 | 用户取消授权、对话框或当前运行；不要计为业务功能失败 |
| 跳过 / 环境缺失 | 缺少真实连接器、Agent、设备、当前实例 Chat 或产物等前置条件 |
| 预留未实现 | 预期 not_implemented；不表示该业务能力已通过 |
| 当前宿主缺失 | 方法不存在或能力未实现；显示升级提示，不调用其他全局动作替代 |

SDK 大多数异步方法返回业务 result 本身，失败抛 `DesktopBridgeError`；没有通用的 `result.ok` 成功包装。例外是 auth.createSession 成功返回 `{ok:true}`。错误可读取 code、action 和可选 details。SDK 不自动重试，未知执行结果尤其不能自动重新提交。

一键只读自检只运行无需用户资源 ID 的读取：能力检测、app/user 配置、theme/locale 读取、麦克风权限、连接器目录、技能目录、看板和默认分页问题列表，以及认证桥可用性。describe/get、产物读取与订阅有前置标识，按用户选择单独运行。空目录和空列表是正常结果。

chat、execute、image、connector.invoke、认证会话、登录、主题/语言写入、剪贴板、通知、对话框、麦克风采集、产物预览/另存均须用户主动触发。即使某条 connector 命令名称看起来像查询，也不能在无语义依据时把它自动归为只读。

## 参数和行为要点

### 结构化执行

assistant.execute 只接受 `{message,input?,outputSchema}`，第二参数为 `{signal?}`。它沿用宿主的用户 Agent 设置、固定 Copilot 或默认助手选择，不能传 agentKey、skillIds、references、background、accessLevel、chatId、requestId。目标必须是工具包含 result_submit 的 Native Agent；默认 helper 不一定满足。

message 最多 12,000 个 UTF-16 code unit。outputSchema 根必须 object，序列化最多 64 KiB；完整页面请求最多 64 KiB、后端最多 256 KiB，因此 schema 还需为 message 和 input 留空间。input 和 schema 从各自根节点计数，最多64层。input 支持标准 JSON；拒绝 Blob、Date、multipart、$file、自定义 toJSON、循环、稀疏数组、非有限数和嵌套 undefined。显式 `input:undefined` 按省略处理。

成功返回 `{chatId,status:'success',output}`；业务失败返回 `{chatId,status:'failure',reason}`，两者均 resolve。主进程执行期限10分钟，SDK传输期限10分15秒；全局最多8个在途执行，同应用最多2个，不排队。只用本次 AbortController 取消，不用 assistant.stop/subscribe。取消不回滚已发生的操作，接口没有调用方 requestId 去重。

常见异常为 assistant_agent_unsupported、assistant_agent_unavailable、approval_required、output_missing、output_invalid、assistant_timeout、assistant_result_too_large、cancelled、assistant_execute_unavailable、app_capacity_exceeded。details.executionState 可能为 not_started 或 unknown。宿主决定执行权限，应用不提供权限档位，也不要假定存在可交互审批或问答流程。

output 对象只证明结构化交卷，不证明外部副作用或后续步骤成功。output 中的 `@chat` 路径不是 artifactId；只有真实已发布产物能由 artifact 接口读取。

### 三种助理取消方式

| 创建方式 | 结果或事件 | 正确取消 |
| --- | --- | --- |
| assistant.chat({background:true}) | accepted、chatId、runId；subscribe 精简事件 | assistant.stop({runId})；订阅 signal 只停止观察 |
| assistant.execute(input,{signal}) | success/output 或 failure/reason | 本次 controller.abort() |
| assistant.image({requestId,...}) | images 及关联标识 | assistant.image.cancel(requestId 字符串) |

后台 chat 事件最多256条，当前缓存最多128个 Run，保留30分钟。游标过期返回 event_cursor_expired，不能因此重新发送原 chat 请求。事件可能包含 run.accepted、run.start、text.delta、run.complete、run.error、run.interrupted、artifact.publish/published、run.finished、run.failed、subscription.failed；它们是精简状态，不含完整工具参数/结果。终态应结合事件 type/reason 解释。

### 图片

operation 支持 generate、imageToImage、inpaint、outpaint、removeObject、replaceBackground、removeBackground、enhance、repairSelection。除 generate 外都需 source Blob；inpaint/removeObject/repairSelection 还需 mask PNG Blob。generate/imageToImage/inpaint/outpaint/replaceBackground 必须有 prompt。

requestId 为8–128位字母数字下划线或连字符；prompt/negativePrompt 各最多4000字符。width/height 各64–16384且都是16倍数，总像素不超过1亿；count 为1–4整数，strength 为0–1，seed 为0–2147483647整数，preserveComposition 必须布尔，edgeMode 必须 strict 或 soft。这些数值字段需要明确传入，宿主不会替示例补齐。

source 支持 PNG/JPEG/WebP，mask 只支持 PNG，各最多20 MiB。SDK 自动使用本机受限上传入口交换一次性句柄，调用者不用自行保存 uploadId 或 token。返回的 images 项含 name、mimeType、sizeBytes、sha256、dataBase64，可用 data URL 或 Blob 展示。图像 Chat 没有保证取得 artifact 归属，示例应直接处理 images，不把图像 chatId 当作通用产物授权。

### 连接器

CLI 输入：`{connectorId,adapter:'cli',args:string[],idempotencyKey?,credentialRevision?}`。MCP 输入：`{connectorId,adapter:'mcp',component,toolName,arguments:{},idempotencyKey?,credentialRevision?}`，字段不能混用。connectorId 由 list 取得；args 最多256项且不含 NUL。幂等键为8–128位字母数字及 `._:-`；credentialRevision 非空且最多256字符。旧 operationId 请求返回 connector_contract_upgrade_required。

CLI 输出文档约定含 invocationId、connectorId、adapter、credentialRevision、exitCode、stdout?/stderr?；需继续检查退出码和业务结果。MCP 返回身份字段及原生 mcp 结果，可能含 content、structuredContent、isError。describe 和 invoke 由 Platform 传回实际 DTO，Desktop 不强制统一所有业务输出形状。不要把 SDK resolve 当作业务成功，也不要把原始输出直接写入公共日志。

连接器登录必须在真实 click 处理器内直接调用 desktop.authenticateConnector，调用前不要 await 其他请求。SDK 检查 userActivation，宿主还会原生确认。返回 authorized/cancelled/failed；成功后由业务显式决定是否重试原只读请求，有副作用请求不能自动重发。

### 技能与产物

最新 skill.list/describe 读取 Platform 实际技能目录的安全元数据，不要求固定 Copilot 或 manifest 引用。Skill 为 `{skillId,name,description?,agentHasSkill}`；agentHasSkill 按宿主当前选定 Agent 计算，不返回技能正文或安装路径。assistant.chat 的额外 skillIds 仍只能取 manifest 固定 Copilot 引用子集；这条限制不适用于技能目录读取。

artifact 只能读取当前应用实例通过 chat/execute 建立归属的 Chat，不能访问全局产物或其他应用的 Chat；重启应用后旧归属不自动恢复。list/get 返回 Platform 业务 DTO；read 返回 `ReadableStream<Uint8Array>`，实质是最多1 MiB有界读取后的流。saveAs 也受1 MiB限制。open/saveAs 仅本机页面可用，分别返回 `{opened:true}` 与 `{saved:true}` / `{cancelled:true}`。

### 会话认证

auth.createSession 只接受 exchangePath。路径单个 `/` 起始、同源、最多1024字符，不含查询/片段、路径回退或 `/__desktop/`；只允许字母数字和 `/_-.`。本示例默认 `/api/auth/session`。服务器必须真正验签并校验 issuer/audience/有效期/权限后建立会话；测试端点不能用不验证的假 Cookie 制造通过。

接口通过当前访问者专用 preload 发起，只有已登记本机 WebApp 的 loopback HTTP 或符合条件的远端 HTTPS Website 可用。需要 Desktop 官网会话与原生同源授权；backend 和普通浏览器没有此入口。成功仅 `{ok:true}`，不把 token、Cookie 值或响应正文交给页面。

交换接口须返回1–4个 host-only Cookie，不带 Domain，Path=/，HttpOnly，SameSite=Lax 或 Strict；HTTPS 须 Secure，本机 HTTP 不能 Secure。Cookie 有效期受 token 到期及8小时上限约束；使用应用独有 Cookie 名称，不覆盖其他 Cookie。应用自己的 `/api/me` 等会话查询与业务权限属于应用后端。

### 原生能力

文件/目录/保存路径选择器使用 canceled（一个 l）；artifact.saveAs、连接器与认证取消使用 cancelled（两个 l），请按各自契约处理。选择保存路径不会写文件；只有 artifact.saveAs 执行宿主写入。

microphone.open 传音频 constraints 本身，SDK 固定 video:false，返回 MediaStream。用户停止、离开页面和组件卸载时都应停止 tracks，不把获取流误写成录音文件已保存。主题语言 set 会持久改变整个 Desktop，界面应展示影响并允许用户恢复先前值。

notification 与 openExternal 每应用每分钟最多5次。剪贴板 handler 虽允许1 MiB文本，页面完整 Action JSON 仍有64 KiB上限。getConfig 返回 appConfig 本身；getUserConfig 返回实际值对象；capabilities.has 参数是能力字符串。

<!-- METHOD_REFERENCE_START -->

## 方法总览

| 方法 | 范围 | 自动只读 | 状态 |
| --- | --- | --- | --- |
| `desktop.capabilities.list` | 页面 | 是 | 已实现 |
| `desktop.capabilities.has` | 页面 | 是 | 已实现 |
| `desktop.app.getConfig` | 页面 | 是 | 已实现 |
| `desktop.app.getUserConfig` | 页面 | 是 | 已实现 |
| `desktop.theme.get` | 页面 | 是 | 已实现 |
| `desktop.theme.set` | 页面 | 否 | 已实现 |
| `desktop.locale.get` | 页面 | 是 | 已实现 |
| `desktop.locale.set` | 页面 | 否 | 已实现 |
| `desktop.requestAccess` | 页面 | 否 | 已实现 |
| `desktop.authenticateConnector` | 页面 | 否 | 已实现 |
| `desktop.browser.openExternal` | 页面 | 否 | 已实现 |
| `desktop.dialog.selectFiles` | 页面 | 否 | 已实现 |
| `desktop.dialog.selectDirectory` | 页面 | 否 | 已实现 |
| `desktop.dialog.selectSavePath` | 页面 | 否 | 已实现 |
| `desktop.microphone.getPermission` | 页面 | 是 | 已实现 |
| `desktop.microphone.requestAccess` | 页面 | 否 | 已实现 |
| `desktop.microphone.open` | 页面 | 否 | 已实现 |
| `desktop.clipboard.writeText` | 页面 | 否 | 已实现 |
| `desktop.notification.show` | 页面 | 否 | 已实现 |
| `desktop.clipboard.readText` | SDK预留 | 否 | 预留 |
| `desktop.screen.capture` | SDK预留 | 否 | 预留 |
| `desktop.file.reveal` | SDK预留 | 否 | 预留 |
| `desktop.window.getState` | SDK预留 | 否 | 预留 |
| `desktop.window.minimize` | SDK预留 | 否 | 预留 |
| `desktop.window.maximize` | SDK预留 | 否 | 预留 |
| `desktop.window.restore` | SDK预留 | 否 | 预留 |
| `desktop.window.close` | SDK预留 | 否 | 预留 |
| `desktop.camera.getPermission` | SDK预留 | 否 | 预留 |
| `desktop.camera.requestAccess` | SDK预留 | 否 | 预留 |
| `desktop.camera.open` | SDK预留 | 否 | 预留 |
| `desktop.share.open` | SDK预留 | 否 | 预留 |
| `auth.isAvailable` | 页面 | 是 | 已实现 |
| `auth.createSession` | 页面 | 否 | 已实现 |
| `assistant.chat` | 页面+后端 | 否 | 已实现 |
| `assistant.execute` | 页面+后端 | 否 | 已实现 |
| `assistant.subscribe` | 页面+后端 | 否 | 已实现 |
| `assistant.stop` | 页面+后端 | 否 | 已实现 |
| `assistant.image` | 页面 | 否 | 已实现 |
| `assistant.image.cancel` | 页面 | 否 | 已实现 |
| `connector.list` | 页面+后端 | 是 | 已实现 |
| `connector.describe` | 页面+后端 | 否 | 已实现 |
| `connector.invoke` | 页面+后端 | 否 | 已实现 |
| `skill.list` | 页面+后端 | 是 | 已实现 |
| `skill.describe` | 页面+后端 | 否 | 已实现 |
| `artifact.list` | 页面+后端 | 否 | 已实现 |
| `artifact.get` | 页面+后端 | 否 | 已实现 |
| `artifact.read` | 页面+后端 | 否 | 已实现 |
| `artifact.open` | 页面 | 否 | 已实现 |
| `artifact.saveAs` | 页面 | 否 | 已实现 |
| `kanban.boards.list` | 页面+后端 | 是 | 已实现 |
| `kanban.issues.list` | 页面+后端 | 是 | 已实现 |
| `kanban.issues.get` | 页面+后端 | 否 | 已实现 |
| `automation.list` | SDK预留 | 否 | 预留 |
| `automation.get` | SDK预留 | 否 | 预留 |
| `automation.create` | SDK预留 | 否 | 预留 |
| `automation.update` | SDK预留 | 否 | 预留 |
| `automation.pause` | SDK预留 | 否 | 预留 |
| `automation.resume` | SDK预留 | 否 | 预留 |
| `automation.remove` | SDK预留 | 否 | 预留 |
| `automation.runs.list` | SDK预留 | 否 | 预留 |
| `automation.runs.get` | SDK预留 | 否 | 预留 |

## 桌面能力

应用配置、能力检测、主题语言、原生对话框与系统交互。

### desktop.capabilities.list — 读取能力列表

读取当前 WebApp 可见能力及其可用、预留和系统权限状态。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：无单独能力标识，按方法存在性与所属传输判断。
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {bridgeVersion:2, capabilities:[{id,status,declared,permission}]}。available 只表示接口可用，不保证连接器账号、Agent 或业务前置条件已满足。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.capabilities.list();
console.log(result);
```

### desktop.capabilities.has — 检测单项能力

检测指定能力是否 available 且 declared=true；内部重新读取能力列表。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：无单独能力标识，按方法存在性与所属传输判断。
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：参数是能力标识字符串，例如 assistant.execute、desktop.theme；不是对象，也不一定等于 SDK 方法路径。
- 返回与验收：返回 boolean。旧宿主没有 assistant.execute 时通常返回 false；不应据此自动回退到 chat。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

默认输入（空标识必须换成本应用实际取得的值）：

```json
"assistant.execute"
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.capabilities.has("assistant.execute");
console.log(result);
```

### desktop.app.getConfig — 读取随包配置

读取 webapp.json 中非敏感 appConfig 对象。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：无单独能力标识，按方法存在性与所属传输判断。
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：直接返回 appConfig 对象，不是完整 manifest，也不包含外层 id、label、version。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.app.getConfig();
console.log(result);
```

### desktop.app.getUserConfig — 读取用户配置

读取 Desktop 在包外保存的当前应用用户配置值。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：无单独能力标识，按方法存在性与所属传输判断。
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：直接返回 Record<string,string|number|boolean>，不是字段定义，也不是 {values:...} 包装。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.app.getUserConfig();
console.log(result);
```

### desktop.theme.get — 读取桌面主题

读取持久主题偏好与当前实际明暗状态。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.theme`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {themeMode:'light'|'dark'|'system', resolvedTheme:'light'|'dark'}。system 不会改写为当前明暗。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.theme.get();
console.log(result);
```

### desktop.theme.set — 设置桌面主题

修改整个 Desktop 的主题偏好并持久化。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.theme`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：仅传 {themeMode:'light'|'dark'|'system'}；建议先 theme.get 记录原值。
- 返回与验收：返回提交后的 {themeMode,resolvedTheme}；保存失败应显示错误，不能自行标记已保存。
- 影响：改变整个 Desktop 的主题，重启后保留。恢复原值也是一次用户设置操作。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "themeMode": "dark"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const before = await desktop.theme.get();
const result = await desktop.theme.set({ themeMode: 'dark' });
console.log({ before, result });
// 用户选择恢复时，再调用：
// await desktop.theme.set({ themeMode: before.themeMode });
```

### desktop.locale.get — 读取桌面语言

读取 Desktop 当前语言与偏好来源。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.locale`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {locale:'zh-CN'|'en-US', source:'stored'|'system'|'default'}。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.locale.get();
console.log(result);
```

### desktop.locale.set — 设置桌面语言

修改整个 Desktop 的语言设置；WebApp 自行翻译正文。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.locale`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：仅传 {locale:'zh-CN'|'en-US'}；建议先 locale.get 保存原语言。
- 返回与验收：返回提交后的语言状态。Desktop 界面更新不表示 WebApp 自带词典已同步。
- 影响：改变并持久化整个 Desktop 的语言。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "locale": "zh-CN"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const before = await desktop.locale.get();
const result = await desktop.locale.set({ locale: 'zh-CN' });
console.log({ before, result });
// 用户选择恢复时，再调用：
// await desktop.locale.set({ locale: before.locale });
```

### desktop.requestAccess — 兼容权限入口

兼容已安装旧 SDK；安装已授予公开能力，此方法不会新增授权状态。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.permissions`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 仅本机页面可调用；新应用无需先调用它再使用其他能力。
- 输入说明：使用 {capability:'kanban.read'}；或 {capability:'connector.execute',connectorId,adapter:'cli'|'mcp'}。旧 connector.read 无效。
- 返回与验收：返回 {status:'granted'}，不弹权限确认；不表示连接器账号已登录。无效参数返回 invalid_arguments。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "capability": "kanban.read"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.requestAccess({
  "capability": "kanban.read"
});
console.log(result);
```

### desktop.authenticateConnector — 连接器登录

在用户点击后请求宿主启动指定连接器的认证流程。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.connector.authenticate`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 必须在新的真实点击处理器内直接调用，不能先等待其他异步工作而丢失 userActivation。宿主还会原生确认。
- 输入说明：只传 connector.list 返回的 connectorId；不接受 URL、账号、回调或 token。
- 返回与验收：返回 {status:'authorized'|'cancelled'|'failed'}；缺少点击手势抛 user_gesture_required。登录成功不会自动重试原业务操作。
- 影响：打开原生确认及连接器登录界面，可能改变该连接器共享账号的认证状态。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "connectorId": ""
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const connectorId = 'replace-with-installed-connector-id';
const button = document.createElement('button');
button.textContent = '登录连接器';
button.onclick = async () => {
  // 调用前不要 await 其他异步操作，以保留真实点击手势。
  const result = await desktop.authenticateConnector({ connectorId });
  console.log(result.status);
};
document.body.append(button);
```

### desktop.browser.openExternal — 在系统浏览器打开

用系统浏览器打开用户指定的 HTTP(S) 地址。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.browser.external`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：传 {url}；仅 HTTP(S)，最多8192字符。
- 返回与验收：返回 {opened:true,url}。每应用每分钟最多5次，超限返回 rate_limited。
- 影响：在系统默认浏览器中打开网页。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "url": "https://example.com/"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.browser.openExternal({
  "url": "https://example.com/"
});
console.log(result);
```

### desktop.dialog.selectFiles — 选择文件

打开原生文件选择器，只返回用户选中的路径与文件名。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.dialog.files`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：参数可省略；multiple:boolean，filters最多10项，每项{name,extensions}，扩展名数组1–20项。
- 返回与验收：返回 {canceled:boolean,files:[{path,name}]}；用户取消时 files为空。此方法不读取文件字节。
- 影响：打开系统文件选择器，并向当前应用交付用户选择的文件路径。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "multiple": false,
  "filters": [
    {
      "name": "文本与 JSON",
      "extensions": [
        "txt",
        "json"
      ]
    }
  ]
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.dialog.selectFiles({
  "multiple": false,
  "filters": [
    {
      "name": "文本与 JSON",
      "extensions": [
        "txt",
        "json"
      ]
    }
  ]
});
console.log(result);
```

### desktop.dialog.selectDirectory — 选择目录

打开原生目录选择器。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.dialog.directories`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {canceled:false,path,name} 或 {canceled:true}；不扫描目录、不授权任意磁盘访问。
- 影响：打开系统目录选择器；选择器允许用户创建目录，并交付选定目录路径。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.dialog.selectDirectory();
console.log(result);
```

### desktop.dialog.selectSavePath — 选择保存路径

选择一个保存目标；不会替应用写入内容。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.dialog.savePath`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：suggestedName可省略，只能是≤255字符文件名；filters规则同selectFiles。
- 返回与验收：返回 {canceled:false,path,name} 或 {canceled:true}。测试不能把路径选择成功当作文件保存成功。
- 影响：打开系统保存对话框，并交付用户选定路径。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "suggestedName": "bridge-lab-example.txt",
  "filters": [
    {
      "name": "文本与 JSON",
      "extensions": [
        "txt",
        "json"
      ]
    }
  ]
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.dialog.selectSavePath({
  "suggestedName": "bridge-lab-example.txt",
  "filters": [
    {
      "name": "文本与 JSON",
      "extensions": [
        "txt",
        "json"
      ]
    }
  ]
});
console.log(result);
```

### desktop.microphone.getPermission — 读取麦克风权限

读取 macOS / Windows 当前麦克风权限，不开始录音。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.microphone`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {permission:'granted'|'denied'|'prompt'|'restricted'|'unavailable'}。unavailable应显示环境不支持，非业务通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.microphone.getPermission();
console.log(result);
```

### desktop.microphone.requestAccess — 申请麦克风权限

请求或检查操作系统的麦克风授权。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.microphone`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：无需参数。
- 返回与验收：返回 {permission}；拒绝抛 permission_denied。macOS可能弹系统授权；Windows使用系统权限状态。
- 影响：可能显示操作系统权限弹窗，并修改麦克风授权状态。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.microphone.requestAccess();
console.log(result);
```

### desktop.microphone.open — 打开麦克风

获得音频 MediaStream；结束后必须释放音轨。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.microphone`
- 前置条件：本机页面可用 navigator.mediaDevices.getUserMedia，且系统授权和音频设备可用。
- 输入说明：直接传音频constraints对象，不要再包一层audio；SDK固定video:false。
- 返回与验收：返回 MediaStream。失败可能为 permission_denied、media_unavailable、unavailable；成功取得流不代表已经录制或保存。
- 影响：申请权限并开始采集麦克风音频；必须停止所有tracks才能释放设备。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "echoCancellation": true,
  "noiseSuppression": true
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const stream = await desktop.microphone.open({ echoCancellation: true, noiseSuppression: true });
console.log(stream.getAudioTracks().map(track => ({ kind: track.kind, readyState: track.readyState })));
const stop = () => stream.getTracks().forEach(track => track.stop());
const button = document.createElement('button');
button.textContent = '停止麦克风';
button.onclick = stop;
document.body.append(button);
window.addEventListener('pagehide', stop, { once: true });
```

### desktop.clipboard.writeText — 写入剪贴板

把示例文本写入系统剪贴板。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.clipboard.write`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：参数为{text:string}，不是字符串本身。handler最多1MiB，但页面完整JSON请求受64KiB限制。
- 返回与验收：返回 {written:true}；通过手动粘贴验收文本。读取剪贴板目前预留，不能用readText做自动回读。
- 影响：覆盖系统剪贴板当前文本，可能替换用户原有剪贴板内容。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "text": "Bridge Lab 剪贴板示例"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.clipboard.writeText({
  "text": "Bridge Lab 剪贴板示例"
});
console.log(result);
```

### desktop.notification.show — 显示系统通知

展示一条示例通知；点击通知会聚焦应用。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`desktop.notification`
- 前置条件：在 Desktop 中打开已安装并运行的本机 WebApp。
- 输入说明：title必填且≤120字符，body可选且≤1000字符；每应用每分钟最多5次。
- 返回与验收：返回 {shown:true}；需人工确认操作系统实际展示。可能返回 unavailable 或 rate_limited。
- 影响：向操作系统发送通知，点击后可能切换应用焦点。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "title": "Bridge Lab",
  "body": "这是一条用户主动触发的测试通知。"
}
```

```js
import { desktop } from '/__desktop/bridge.js';

const result = await desktop.notification.show({
  "title": "Bridge Lab",
  "body": "这是一条用户主动触发的测试通知。"
});
console.log(result);
```

### desktop.clipboard.readText — 读取剪贴板（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.clipboard.read`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.clipboard.readText();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.screen.capture — 屏幕截图（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.screen.capture`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.screen.capture();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.file.reveal — 在文件管理器显示（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.file.reveal`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.file.reveal();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.window.getState — 窗口状态（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.window`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.window.getState();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.window.minimize — 最小化窗口（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.window`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.window.minimize();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.window.maximize — 最大化窗口（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.window`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.window.maximize();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.window.restore — 恢复窗口（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.window`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.window.restore();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.window.close — 关闭窗口（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.window`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.window.close();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.camera.getPermission — 摄像头权限（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.camera`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.camera.getPermission();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.camera.requestAccess — 申请摄像头（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.camera`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.camera.requestAccess();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.camera.open — 打开摄像头（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.camera`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.camera.open();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### desktop.share.open — 系统分享（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`desktop.share`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { desktop, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await desktop.share.open();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

## 登录会话

通过当前页面的宿主认证桥建立同源会话，不向页面交付凭据。

### auth.isAvailable — 检测认证桥

检查当前页面是否获得宿主会话交换传输。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`auth.session`
- 前置条件：可在普通浏览器检测；只有符合条件的 Desktop 顶层页面通常会返回true。
- 输入说明：无需参数。
- 返回与验收：同步返回boolean；false表示传输缺失，true不表示已登录、已确认或交换接口可用。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { auth } from '/__desktop/bridge.js';

const result = await auth.isAvailable();
console.log(result);
```

### auth.createSession — 建立同源登录会话

通过宿主原生确认向当前应用的同源接口交换受限会话Cookie。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`auth.session`
- 前置条件：auth.isAvailable()为true，Desktop已登录官网，应用后端真实验签并提供交换接口；用户允许原生确认。普通浏览器和backend客户端没有此入口。
- 输入说明：只传exchangePath。单个/起始，同源路径≤1024字符，不含查询、片段、路径回退或/__desktop/。
- 返回与验收：返回 {ok:true}。用户取消是cancelled异常；未登录sign_in_required；接口/Cookie问题可能为exchange_rejected、invalid_cookie、cookie_conflict、exchange_failed。不会返回token或Cookie值。
- 影响：请求原生凭据提交确认，并在当前页面session写入应用会话Cookie。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "exchangePath": "/api/auth/session"
}
```

```js
import { auth, DesktopBridgeError } from '/__desktop/bridge.js';

if (!auth.isAvailable()) {
  console.log('请在支持认证桥的 Desktop 页面打开。');
} else {
  try {
    await auth.createSession({ exchangePath: '/api/auth/session' });
    console.log('宿主会话交换成功；再调用应用自己的会话查询接口确认登录状态。');
  } catch (error) {
    if (error instanceof DesktopBridgeError && error.code === 'cancelled') console.log('用户取消登录。');
    else throw error;
  }
}
```

## 智能助理

文本对话、后台订阅、结构化执行与图片生成，各有独立取消方式。

### assistant.chat — 发送文本对话

调用宿主选定Agent；支持同步结果或后台运行两种输入形态。

- 范围：本机页面与受管Node后端。
- 能力标识：`assistant.chat`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 宿主选定的 Agent 可用；调用方不能传入 agentKey。
- 输入说明：可传message字符串，或{message,skillIds?,background?}。message非空且≤12000 UTF-16 code unit。skillIds最多16项且只能是manifest固定Copilot声明的技能子集。不能传agentKey。
- 返回与验收：同步返回{text,agentKey,chatId,runId}；background:true返回{accepted:true,chatId,runId}。后台accepted仅表示接受，还需订阅终态。
- 影响：创建Chat与Run，消耗模型调用；Agent可能根据自身配置执行工具。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "message": "请用一句话说明这是 Bridge Lab 的测试调用，不要调用任何外部工具。",
  "background": false
}
```

```js
import { assistant } from '/__desktop/bridge.js';

const result = await assistant.chat({
  message: '请用一句话说明这是测试调用，不要调用任何外部工具。',
  background: false
});
console.log(result.text, result.chatId, result.runId);
// 字符串简写同样有效：await assistant.chat('你好');
```

### assistant.execute — 结构化执行

按JSON Schema获得结构化交卷；业务failure与调用异常分别处理。

- 范围：本机页面与受管Node后端。
- 能力标识：`assistant.execute`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 宿主选定的 Agent 可用；调用方不能传入 agentKey。 该Agent必须是有效工具含result_submit的Native Agent；默认helper未必满足。旧宿主可能根本没有此SDK方法。
- 输入说明：只允许{message,input?,outputSchema}，第二参数为{signal?}。schema根必须object。input是标准JSON，不支持Blob、$file、Date、循环或非有限数。不能传agentKey/skillIds/background/accessLevel/requestId。
- 返回与验收：返回{chatId,status:'success',output}或{chatId,status:'failure',reason}；failure正常resolve。异常包括assistant_agent_unsupported、output_missing/output_invalid、approval_required、assistant_timeout、cancelled。
- 影响：创建执行Chat并消耗模型；Agent可能使用工具。取消不回滚已产生的副作用，SDK不自动重试。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "message": "只从输入文本提取金额，不调用外部工具；无法识别时提交 failure。",
  "input": {
    "text": "订单总额 128 元"
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "number"
      }
    },
    "required": [
      "amount"
    ],
    "additionalProperties": false
  }
}
```

```js
import { assistant, DesktopBridgeError } from '/__desktop/bridge.js';

const controller = new AbortController();
const cancel = document.createElement('button');
cancel.textContent = '取消本次执行';
cancel.onclick = () => controller.abort();
document.body.append(cancel);
try {
  const result = await assistant.execute({
    message: '只从输入提取金额，不调用外部工具；无法识别时提交 failure。',
    input: { text: '订单总额 128 元' },
    outputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'], additionalProperties: false }
  }, { signal: controller.signal });
  if (result.status === 'success') console.log(result.output);
  else console.log('业务失败：', result.reason);
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'cancelled') console.log('已取消；已执行操作不会自动回滚。');
  else throw error;
} finally { cancel.remove(); }
```

### assistant.subscribe — 订阅后台对话

从指定游标读取当前应用后台chat的精简事件，直到终态或主动解除订阅。

- 范围：本机页面与受管Node后端。
- 能力标识：`assistant.chat`
- 前置条件：本应用当前实例已启动后台chat，且Run仍在有界缓存内（最多256事件，保留30分钟）。
- 输入说明：使用chat({background:true})返回的runId；cursor非负整数，默认0。第二参数{signal}取消订阅。不能订阅execute或image的Run。
- 返回与验收：异步迭代{cursor,type,text?,reason?}；可能有text.delta、run.finished等。游标过期event_cursor_expired；解除订阅不会停止Agent。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "runId": "",
  "cursor": 0
}
```

```js
import { assistant } from '/__desktop/bridge.js';

const runId = 'replace-with-this-app-background-run-id';
const controller = new AbortController();
const stopWatching = document.createElement('button');
stopWatching.textContent = '停止订阅';
stopWatching.onclick = () => controller.abort();
document.body.append(stopWatching);
try {
  for await (const event of assistant.subscribe({ runId, cursor: 0 }, { signal: controller.signal })) {
    console.log(event);
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally { stopWatching.remove(); }
// 这只解除订阅。停止Agent需用户另行调用assistant.stop({runId})。
```

### assistant.stop — 停止后台对话

停止本应用通过chat后台模式建立的运行。

- 范围：本机页面与受管Node后端。
- 能力标识：`assistant.chat`
- 前置条件：先用chat({background:true})创建运行并保存runId；不用于execute或image。
- 输入说明：传{runId}；必须是本应用当前实例的后台chat运行标识。
- 返回与验收：返回{stopped:true}；不属于本应用或缓存失效时app_grant_required，停止失败assistant_stop_failed。
- 影响：中断指定后台Agent运行；已经发生的外部操作不会回滚。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "runId": ""
}
```

```js
import { assistant } from '/__desktop/bridge.js';

const result = await assistant.stop({
  "runId": ""
});
console.log(result);
```

### assistant.image — 生成或编辑图片

通过固定Zenmi图片适配器生成图片，或上传原图与可选蒙版后编辑。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`assistant.image`
- 前置条件：本机页面、Platform与固定zenmi图像Agent可用。非generate操作需原图；inpaint/removeObject/repairSelection还需PNG蒙版。每文件≤20MiB。
- 输入说明：width/height为64–16384且16倍数，总像素≤1亿；count 1–4，strength 0–1，seed 0–2147483647，preserveComposition布尔，edgeMode strict/soft。编辑时UI另注入source:Blob和mask:Blob，不把它们写成JSON路径。
- 返回与验收：返回{provider:'desktop-zenmi',agentKey:'zenmi',requestId,runId,chatId,images:[{name,mimeType,sizeBytes,sha256,dataBase64}]}。失败可能invalid_args、image_upload_missing、selection_required、request_conflict、assistant_image_failed。
- 影响：生成或编辑图片并消耗模型。编辑会先把用户选定的原图/蒙版上传到本机宿主的一次性入口。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "requestId": "bridge_lab_image_001",
  "operation": "generate",
  "prompt": "白色背景上一枚蓝色圆形图标，无文字。",
  "negativePrompt": "",
  "width": 512,
  "height": 512,
  "count": 1,
  "strength": 0.5,
  "seed": 0,
  "preserveComposition": true,
  "edgeMode": "soft"
}
```

```js
import { assistant } from '/__desktop/bridge.js';

const requestId = 'image_' + crypto.randomUUID().replaceAll('-', '');
const cancel = document.createElement('button');
cancel.textContent = '取消图片请求';
cancel.onclick = async () => console.log(await assistant.image.cancel(requestId));
document.body.append(cancel);
try {
  const result = await assistant.image({
    requestId, operation: 'generate', prompt: '白色背景上一枚蓝色圆形图标，无文字。', negativePrompt: '',
    width: 512, height: 512, count: 1, strength: 0.5, seed: 0, preserveComposition: true, edgeMode: 'soft'
  });
  for (const item of result.images) {
    const image = document.createElement('img');
    image.alt = item.name;
    image.src = `data:${item.mimeType};base64,${item.dataBase64}`;
    document.body.append(image);
  }
} finally { cancel.remove(); }
```

### assistant.image.cancel — 取消图片请求

按requestId取消当前应用拥有的活动图片请求。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`assistant.image`
- 前置条件：本机页面；requestId为8–128位字母数字下划线或连字符。后端SDK没有此属性。
- 输入说明：参数直接传requestId字符串，必须匹配本次assistant.image输入；不要传{requestId}或runId。
- 返回与验收：返回{requestId,cancelled:true}；无活动请求时cancelled:false；可能assistant_cancel_failed。false不表示发生了取消。
- 影响：中断匹配的图片生成运行；已经发生的操作不会自动回滚。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
"bridge_lab_image_001"
```

```js
import { assistant } from '/__desktop/bridge.js';

const result = await assistant.image.cancel("bridge_lab_image_001");
console.log(result);
```

## 连接器

发现已安装连接器并调用 CLI / MCP；业务调用可能产生外部副作用。

### connector.list — 列出连接器

读取当前Platform的连接器使用目录。

- 范围：本机页面与受管Node后端。
- 能力标识：`connector.execute`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。
- 输入说明：无需参数。
- 返回与验收：返回{items:[{connectorId,name}]}；不含adapter、版本或凭据。空目录正常；详情需describe。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { connector } from '/__desktop/bridge.js';

const result = await connector.list();
console.log(result);
```

### connector.describe — 读取连接器详情

按连接器ID读取原生CLI/MCP执行描述。

- 范围：本机页面与受管Node后端。
- 能力标识：`connector.execute`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 用户已选择真实已安装连接器。
- 输入说明：只传connector.list返回的connectorId，不能传operationId或自定义URL。
- 返回与验收：返回Platform描述DTO，包含revision、adapters、components等；宿主不合成业务操作清单。显示实际结构，不假设所有连接器形状相同。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "connectorId": ""
}
```

```js
import { connector } from '/__desktop/bridge.js';

const result = await connector.describe({
  "connectorId": ""
});
console.log(result);
```

### connector.invoke — 执行连接器

调用连接器CLI argv或MCP工具；返回原生业务结果。

- 范围：本机页面与受管Node后端。
- 能力标识：`connector.execute`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 用户依据describe选择真实适配器和操作，必要时先认证；应确认操作作用，不能按名字猜测只读。
- 输入说明：CLI:{connectorId,adapter:'cli',args:string[],idempotencyKey?,credentialRevision?}；MCP:{connectorId,adapter:'mcp',component,toolName,arguments:{},idempotencyKey?,credentialRevision?}。两类字段互斥。
- 返回与验收：CLI检查exitCode及stdout业务码，MCP检查mcp.isError；resolve不等于业务成功。认证错误需新的用户点击登录；不自动重试。
- 影响：执行连接器原生操作，可能读取或修改外部数据、发送消息；没有通用只读保证。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "connectorId": "",
  "adapter": "cli",
  "args": []
}
```

```js
import { connector } from '/__desktop/bridge.js';

// 先从connector.list/describe取得真实ID与文档化参数，再由用户触发。
const input = { connectorId: 'replace-with-installed-connector-id', adapter: 'cli', args: ['replace-with-a-documented-command'] };
const result = await connector.invoke(input);
if (result.exitCode !== 0) throw new Error('CLI执行失败，请检查该连接器的业务诊断。');
// stdout可能含业务数据；按连接器契约解析，不向公共日志输出原始内容。
console.log({ invocationId: result.invocationId, exitCode: result.exitCode });
// MCP输入形式：{connectorId,adapter:'mcp',component,toolName,arguments:{}}。
// 有副作用请求应由业务维护稳定idempotencyKey；失败后不要换键自动重发。
```

## 技能目录

读取实际技能目录的安全元数据，查看宿主所选 Agent 的挂载状态。

### skill.list — 列出技能目录

读取Platform实际技能目录的安全元数据，不要求固定Copilot声明。

- 范围：本机页面与受管Node后端。
- 能力标识：`skill.read`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 宿主选定的 Agent 可用；调用方不能传入 agentKey。
- 输入说明：无需参数。
- 返回与验收：返回{items:[{skillId,name,description?,agentHasSkill}]}；agentHasSkill反映当前宿主选定Agent。空数组是正常结果，不返回技能正文或安装路径。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { skill } from '/__desktop/bridge.js';

const result = await skill.list();
console.log(result);
```

### skill.describe — 读取技能详情

读取一个目录技能的安全元数据。

- 范围：本机页面与受管Node后端。
- 能力标识：`skill.read`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 宿主选定的 Agent 可用；调用方不能传入 agentKey。 用户选择一个真实目录技能；该读取不受manifest copilot.references过滤。
- 输入说明：只传skill.list返回的skillId；非空且≤256字符。不能传agentKey。
- 返回与验收：直接返回{skillId,name,description?,agentHasSkill}，不是{item:...}；不存在时skill_not_found。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "skillId": ""
}
```

```js
import { skill } from '/__desktop/bridge.js';

const result = await skill.describe({
  "skillId": ""
});
console.log(result);
```

## 产物

读取本应用实例创建的 Chat 产物，并按用户操作预览或另存。

### artifact.list — 列出本应用产物

按当前应用拥有的Chat查询真实已发布产物。

- 范围：本机页面与受管Node后端。
- 能力标识：`artifact.read`
- 前置条件：先由本应用当前实例通过 assistant.chat 或 assistant.execute 创建 Chat，再取得真实已发布的 artifactId。应用重启后旧 Chat 归属不会自动恢复；图片请求返回的 Chat 不保证取得此归属。
- 输入说明：{chatId,runId?,cursor?,limit?}。分页字段由Platform产物契约处理；不能当作全局产物列表。
- 返回与验收：返回Platform产物列表DTO，读取实际items；没有产物时空列表正常。Chat不属于本实例时app_grant_required。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "chatId": "",
  "limit": 20
}
```

```js
import { artifact } from '/__desktop/bridge.js';

const result = await artifact.list({
  "chatId": "",
  "limit": 20
});
console.log(result);
```

### artifact.get — 读取产物元数据

读取指定Chat内单个产物的元数据。

- 范围：本机页面与受管Node后端。
- 能力标识：`artifact.read`
- 前置条件：先由本应用当前实例通过 assistant.chat 或 assistant.execute 创建 Chat，再取得真实已发布的 artifactId。应用重启后旧 Chat 归属不会自动恢复；图片请求返回的 Chat 不保证取得此归属。
- 输入说明：填写本应用当前实例拥有的 chatId 与 artifact.list 返回的 artifactId；runId 可选。不能用 @chat 路径、磁盘路径或其他应用的标识代替。
- 返回与验收：返回Platform metadata DTO，包含产物身份与名称等实际字段；宿主不另包装为item。缺少归属为app_grant_required。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "chatId": "",
  "artifactId": ""
}
```

```js
import { artifact } from '/__desktop/bridge.js';

const result = await artifact.get({
  "chatId": "",
  "artifactId": ""
});
console.log(result);
```

### artifact.read — 读取产物字节

把有界产物字节返回为ReadableStream。

- 范围：本机页面与受管Node后端。
- 能力标识：`artifact.read`
- 前置条件：先由本应用当前实例通过 assistant.chat 或 assistant.execute 创建 Chat，再取得真实已发布的 artifactId。应用重启后旧 Chat 归属不会自动恢复；图片请求返回的 Chat 不保证取得此归属。
- 输入说明：填写本应用当前实例拥有的 chatId 与 artifact.list 返回的 artifactId；runId 可选。不能用 @chat 路径、磁盘路径或其他应用的标识代替。
- 返回与验收：返回ReadableStream<Uint8Array>，最多1MiB，超限artifact_too_large；不是dataBase64对象，也不是贯穿Platform的网络流。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "chatId": "",
  "artifactId": ""
}
```

```js
import { artifact } from '/__desktop/bridge.js';

const stream = await artifact.read({ chatId: 'replace-with-this-app-chat-id', artifactId: 'replace-with-published-artifact-id' });
const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
console.log({ byteLength: bytes.byteLength });
// 已确认是文本时才使用new TextDecoder().decode(bytes)。
```

### artifact.open — 预览产物

让宿主在WorkPanel打开本应用的已发布产物。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`artifact.present`
- 前置条件：先由本应用当前实例通过 assistant.chat 或 assistant.execute 创建 Chat，再取得真实已发布的 artifactId。应用重启后旧 Chat 归属不会自动恢复；图片请求返回的 Chat 不保证取得此归属。
- 输入说明：填写本应用当前实例拥有的 chatId 与 artifact.list 返回的 artifactId；runId 可选。不能用 @chat 路径、磁盘路径或其他应用的标识代替。
- 返回与验收：返回{opened:true}；需要人工确认真实预览。可能artifact_not_found、artifact_ambiguous、artifact_preview_unavailable。
- 影响：打开或激活Desktop产物预览界面，改变当前展示。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "chatId": "",
  "artifactId": ""
}
```

```js
import { artifact } from '/__desktop/bridge.js';

const result = await artifact.open({
  "chatId": "",
  "artifactId": ""
});
console.log(result);
```

### artifact.saveAs — 另存产物

经系统选择器将本应用产物保存到用户确认的位置。

- 范围：页面；backend客户端不提供此可用能力。
- 能力标识：`artifact.present`
- 前置条件：先由本应用当前实例通过 assistant.chat 或 assistant.execute 创建 Chat，再取得真实已发布的 artifactId。应用重启后旧 Chat 归属不会自动恢复；图片请求返回的 Chat 不保证取得此归属。
- 输入说明：填写本应用当前实例拥有的 chatId 与 artifact.list 返回的 artifactId；runId 可选。不能用 @chat 路径、磁盘路径或其他应用的标识代替。
- 返回与验收：返回{saved:true}或{cancelled:true}（两个l）；最多1MiB。不会返回绝对保存路径。
- 影响：打开系统另存对话框并写入用户选定的文件，可能覆盖用户确认的已有文件。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "chatId": "",
  "artifactId": ""
}
```

```js
import { artifact } from '/__desktop/bridge.js';

const result = await artifact.saveAs({
  "chatId": "",
  "artifactId": ""
});
console.log(result);
```

## 看板

读取看板、项目和问题的受限投影，不开放工作流变更。

### kanban.boards.list — 读取看板与项目

读取可用看板和项目投影，云离线时不返回云端缓存。

- 范围：本机页面与受管Node后端。
- 能力标识：`kanban.read`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 Desktop Kanban runtime可用。
- 输入说明：无需参数。
- 返回与验收：返回{items:[{id}],projects:[{id,name,parentId,syncMode}],cloudAvailable}。云离线/零项目应按结果展示，不伪造看板。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

无需参数。

```js
import { kanban } from '/__desktop/bridge.js';

const result = await kanban.boards.list();
console.log(result);
```

### kanban.issues.list — 列出问题

分页读取问题摘要，可按项目筛选。

- 范围：本机页面与受管Node后端。
- 能力标识：`kanban.read`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 Desktop Kanban runtime可用；默认分页无需用户提供ID。
- 输入说明：参数可省略。{projectId?,cursor?,limit?}；cursor非负整数默认0，limit整数1–100默认50。
- 返回与验收：返回{items:[{id,projectId,title,status,statusName,priority,syncMode}],nextCursor?,cloudAvailable}。无结果是正常成功。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：纳入。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "cursor": 0,
  "limit": 20
}
```

```js
import { kanban } from '/__desktop/bridge.js';

const result = await kanban.issues.list({
  "cursor": 0,
  "limit": 20
});
console.log(result);
```

### kanban.issues.get — 读取问题详情

读取一个当前可见问题的受限详情。

- 范围：本机页面与受管Node后端。
- 能力标识：`kanban.read`
- 前置条件：应用正在运行，Agent Platform 与 Desktop 本地服务身份可用；官网登录状态不等于本地调用身份。 已选择真实问题；云问题还需要云连接可用。
- 输入说明：只传issues.list返回的issueId，非空且≤256字符。
- 返回与验收：返回{issue:{id,projectId,title,status,statusName,priority,syncMode,description}}。不存在或不可见为issue_not_found；不返回运行路径、Chat授权或附件缓存。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

默认输入（空标识必须换成本应用实际取得的值）：

```json
{
  "issueId": ""
}
```

```js
import { kanban } from '/__desktop/bridge.js';

const result = await kanban.issues.get({
  "issueId": ""
});
console.log(result);
```

## 自动化（预留）

记录 SDK 已导出但当前版本尚未实现的接口。

### automation.list — 列出自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.list();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.get — 读取自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.get();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.create — 创建自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.create();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.update — 更新自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.update();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.pause — 暂停自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.pause();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.resume — 恢复自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.resume();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.remove — 删除自动化（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.remove();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.runs.list — 列出自动化运行（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.runs.list();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

### automation.runs.get — 读取自动化运行（预留）

SDK 已预留此方法，当前宿主尚未实现。

- 范围：当前仅为SDK预留，不表示后端或页面业务可用。
- 能力标识：`automation.manage`
- 前置条件：仅用于验证预留接口；当前版本没有正式输入或成功返回契约。
- 输入说明：当前不接受可依赖的业务参数；验证预留行为时无参调用。
- 返回与验收：预期抛出 DesktopBridgeError，code 为 not_implemented；此结果表示预留，不表示业务功能通过。
- 影响：无业务或用户设置副作用；资源读取仍需满足权限与实例前提。
- 自动只读自检：不纳入；由用户选择或单独触发。

无需参数。

```js
import { automation, DesktopBridgeError } from '/__desktop/bridge.js';

try {
  await automation.runs.get();
  console.log('接口行为已变化，请重新核对当前宿主文档。');
} catch (error) {
  if (error instanceof DesktopBridgeError && error.code === 'not_implemented') {
    console.log('当前版本预留，尚未实现。');
  } else {
    throw error;
  }
}
```

## 契约来源与升级维护

本目录以宿主以下源码与生成SDK核对：src/main/modules/webs/webapps/bridge-module.ts、src/shared/webapp-bridge.ts、src/shared/webapp-execute.ts、webapp-native-actions.ts、webapp-page-methods.ts、webapp-connector.ts、webapp-kanban.ts、webapp-execute.ts、auth-session-policy.ts，以及contracts/webapp/bridge.mjs。

新增SDK方法时同步修改src/catalog.mjs与本参考，并比较真实导出的对象和函数属性。不要只靠capability数目推断方法覆盖率。此参考不代表所有实际业务链路已经验收；运行报告必须保留环境、真实结果、人工观察与未验证项。


## desktop.chat.open

仅主工作区当前 WebApp 本机页面调用，参数 `{chatId: string}`，返回 `{chatId, status: "opened"}`。打开只读历史弹窗，不发起 Run；不接受 URL、Agent 或 Run 控制参数。不要求包内固定 Copilot 声明。

```js
await desktop.chat.open({chatId: actualChatId});
```

独立窗口、后台应用返回 `webapp_ui_unavailable`。只能手动验收，需核对弹窗内容。聊天/execute 工作区提供查看本次返回 Chat 的快捷按钮，也可在方法卡片填写真实历史 Chat ID。该入口不授予 artifact 读取授权。

## desktop.copilot.open / desktop.copilot.close

仅主工作区当前 WebApp 本机页面调用，无参数，分别返回 `{open:true}` / `{open:false}`。幂等复用当前应用已有 Agent、引用和会话，不创建第二个 Copilot；关闭不停止后台 Run。

```js
await desktop.copilot.open();
await desktop.copilot.close();
```

页面禁用 Copilot 时 open 返回 `copilot_disabled`；应用不在主工作区前台时返回 `webapp_ui_unavailable`。后端、局域网、发布页面不可用。仅手动调用，回执记为待观察，需确认界面实际变化。


新增 Platform 桥：`assistant.upload({file: Blob, name?, chatId?}, {signal?})`（单文件 64 MiB，省略 chatId 时由 Platform 创建并返回 canonical chatId；指定已有 chatId 则向该 Chat 追加文件，返回安全 upload 元数据）；聊天可带 `chatId + uploadIds` 引用同实例上传，句柄有效 30 分钟。`assistant.resource.read({chatId,file},{signal?})` 返回有界字节流（16 MiB），file 是 Chat 相对路径，不接受 URL 或主机路径。已发布产物继续使用 artifact 接口。

`assistant.steer({runId,message,requestId?,steerId?})`、`assistant.send({runId,message,requestId?})`、`assistant.submit({runId,awaitingId,submitId?,param?|params?})` 仅操作本实例的后台 Run。send 返回 mailbox 回执，不代表任务完成；新回执 Run 不自动取得订阅资格。`assistant.interrupt({runId})` 等同 stop。所有控制使用固定根 Agent 和 Primary 通道。

新增卡片均为手动调用。Lab 上传卡片用 text 生成真实文本 Blob，方便前后端使用相同样本；业务 SDK 直接接受 Blob。resource 测试页保持 1 MiB 展示限额，宿主支持 16 MiB。


智能体选择（Desktop）：`assistant.agents.list()` 返回 `{items:[{agentKey,name,role}],defaultAgentKey}`。聊天、execute、upload 和 skill.list/describe 可传可选 agentKey；省略时沿用宿主用户配置、固定 Copilot、默认助手的既有选择规则，显式指定必须来自当前可用列表。Lab 下拉框选择用于前后端的新请求，已有 Run 的控制 owner 不变。智能体缺少 result_submit 时 execute 如实失败，不自动换智能体。该能力尚未在 Compose 托管桥实现。
