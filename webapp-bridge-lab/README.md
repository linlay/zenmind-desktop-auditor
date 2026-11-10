# WebApp Bridge Lab

包含上下游关联流程的 Desktop WebApp 测试工作台。纯 HTML / JS / CSS 前端、只用 Node 内置模块的受管后端；ZIP 在 macOS / Windows 共用，`target: any`。

## 构建与导入

需要 Node.js ≥ 22.12，以及要测试的 `zenmind-desktop` checkout。打包使用本子项目锁定的 jszip，不借用 Desktop 的 node_modules。

macOS：

```sh
cd /Users/linlay/Project/zenmind/zenmind-desktop-auditor/webapp-bridge-lab
npm ci
npm run build -- --desktop-repo /Users/linlay/Project/zenmind/zenmind-desktop
```

Windows PowerShell（替换为实际目录）：

```powershell
Set-Location C:\Projects\zenmind-desktop-auditor\webapp-bridge-lab
npm ci
npm run build -- --desktop-repo C:\Projects\zenmind-desktop
```

产物：`build/bridge-lab.zip`。在 Desktop「设置 → 网页应用」导入 ZIP，启动并打开。不要直接选择源码目录；安装后的应用不依赖开发机的 checkout 或 node_modules。

打包脚本会：

1. 从指定 checkout 读取生成的 manifest validator 与 `contracts/webapp/bridge.mjs`。
2. 原样复制 SDK 到包内后端，用 Desktop 自己的目录、归档校验器验证文件。
3. 输出单顶层目录 `webapp-72eb6f709c8a4d15/` 的 ZIP，重读 ZIP 验证 CRC 和 SDK 副本。
4. 在应用内记录 Desktop revision、契约是否有未提交变更、SDK SHA256、时间与测试配置。ZIP 不带开发依赖、测试脚本或凭据。

## 配置测试 Agent 与技能

默认不固定 Agent，也不声明测试技能，使用 Desktop 默认助手。可在页面「02 智能体」选择实际智能体，也可保持「使用默认智能体」。列表由 `assistant.agents.list()` 返回；省略 agentKey 时沿用 Desktop 用户配置、固定 Copilot 和默认助手的既有规则。页面选择只作用于新请求，不修改 Desktop 设置。包不会安装或创建 Agent / 技能。需要预设实际 Agent 或声明附加技能时：

```sh
npm run build -- --desktop-repo /path/to/zenmind-desktop --agent nativeAgentKey --skill existing-skill-id
```

`--skill` 可以重复，受 Desktop manifest 的数量和命名约束。应用更新使用固定 ID；导入新版 ZIP 后重新启动应用。

`--agent` 设置测试 Agent 字段的包内默认值；`--skill` 才启用固定 Copilot 的附加技能声明（未传 `--agent` 时其 Agent 为 `desktopAssistant`）。也可以在 Desktop 的网页应用用户配置中修改「测试 Agent」。`assistant.execute` 需要支持 `result_submit` 的 Native Agent；返回 `assistant_agent_unsupported` 时页面会提示切换，宿主不自动换 Agent。执行请求使用 `message`、`input?`、`outputSchema` 和可选 `agentKey`，不发送 `skillIds`。技能页加载实际目录与当前 Agent 的挂载状态，不需要包内声明；聊天不选附加引用时发送空数组，使用智能体自身配置。只有包内声明的附加引用可以在聊天技能控件中手动附加，未声明的目录条目只展示挂载状态。

`0.3.1` 同时修正 Desktop 原有 `skill.list/describe` 的查询语义和网页交互：不再按包内 Copilot 引用过滤只读技能目录；该版本的 Agent 选择在 Desktop 设置进行；当前版本已补充页面列表与选择能力。先在 Desktop checkout 执行 `npm run build:main:prepared` 并重启使用该构建产物的 Desktop，再导入新版 ZIP、重新启动 Bridge Lab。仅更新 ZIP 不会更新已运行的旧宿主。默认包无需 `--skill` 即可加载技能，空目录显示真实空列表，错误直接展示。

## 关联流程与前置条件

页面使用正式 SDK 方法，智能体列表与可选 agentKey 需要匹配新版 Desktop 宿主。前端直接从同源 Gateway 导入 SDK；受管 Node 后端用 Desktop 注入的地址和 token 初始化 `createBackendClient`。它们属于同一个应用实例，可以读取彼此创建的 Chat；OS 界面操作只由前端发起，后端选择框只列已实现的数据方法。

1. 在「02 智能体」选择测试 Agent，或使用默认智能体，再点击「检查连接」。产物任务需要文件写入与 `artifact_publish`；结构化执行需要 `result_submit`。想串起整个流程，Agent 必须同时具备这些工具；否则分别验收对应功能。更改应用设置可能重启实例，旧 Chat 授权不能继续使用。
2. 点击「生成测试产物」。页面明确请求创建并发布 `bridge-lab-verification.md`，使用一次真实后台聊天，等待对应 Run 完成后自动读取产物清单。不会根据回复里的链接猜 ID，不会因超时自动重发任务。
3. 从返回的 Chat 和产物清单选择文件。页面完整显示 `chatId + runId + artifactId`，支持下一页；相同 artifactId 在不同 Run 中分别列出。普通聊天、execute 的 output 和 `@chat` 路径均不代表存在已发布文件。
4. 点击「验证元数据和内容」。后续 get/read/预览/另存为都使用所选文件的精确三元组。空列表属于正常查询结果，提示回到生成步骤；不会用示例 ID 调用。预览与另存为始终通过前端 SDK，即使文件由后端聊天产生。
5. 读到完整 UTF-8 文本后，可以点击「将已读内容带入 execute」，把真实文本和来源三元组填入执行区，再手动点击执行任务。该按钮只填参数，不自动调用模型。测试页读流最多 1 MiB、展示前 8 KiB；完整 UTF-8 文本仅在满足当前通道请求体积限制时进入此链路，二进制以 Base64 预览。
6. 普通聊天和 execute 新建的 Chat 也可在关联流程中选择，但不会覆盖已选产物 Chat 或带入另一份清单的文件 ID。当前页只记录通过本应用 SDK 返回的身份；刷新后重新准备，不能恢复其他应用或旧实例的授权。
7. 连接器、技能、看板先点击「加载列表」，选择真实条目，再读取详情。查询或切换选择会将返回的 ID 带入详情卡片与后端参数，即使之前手动改过 ID；空列表会清空旧 ID。连接器 invoke 还要先 describe，按其实际 adapters/components 编辑 CLI/MCP 参数；命令非零退出码、MCP isError 和业务失败不会记为成功。默认不会主动调用连接器业务命令。
8. 切到后端模式后，在工作区启用手动副作用开关，再调用聊天、execute 或停止 Run。副作用开关与下方后端区同步。停止和续订只接受实际返回的后台 Run；同步聊天的 runId 不进入后台控制。
9. SDK 方法卡片是更细的手动入口，显示缺失的前置步骤和准备按钮，参数来自实际查询结果。图像生成的宿主必填字段已补齐，每次使用新 requestId，取消自动关联当前在途请求；使用固定 zenmi 图像 Agent，与测试 Agent 选择无关。原生文件选择、剪贴板写入、通知等操作均手动触发；麦克风轨道取得后立即释放。
所有方法结果、错误和事件流都直接显示，无需点击展开。点击运行时立即显示进度；跳过与不可用也显示具体原因，不残留“尚未运行”。

10. 导出报告默认仅包含状态、耗时、错误码及 SDK 指纹。勾选详情后附带请求、业务结果与事件，常见凭据字段会遮盖；业务内容可能仍包含用户提交的文本。

## 接口核对与能力边界

| 接口组 | 正常调用前需要什么 | 实际结果与限制 |
| --- | --- | --- |
| assistant.chat / subscribe / stop | 当前服务、有效 Agent；后台控制先有后台 Run | 实际 Chat/Run、精简事件与停止回执；中止订阅不停止 Run |
| assistant.execute | 带 result_submit 的 Native Agent，合法 message/input/outputSchema | 实际 Chat、status、output 或 reason；不会把结构化结果当作文件 |
| artifact.list/get/read/open/saveAs | 当前实例已知 Chat；文件操作再选清单中的精确 Run/文件 | 空列表合法；无文件不解锁下游；同应用前后端共用身份，open/saveAs 由前端触发 |
| connector.list/describe/invoke | 真实列表、所选条目、已读取适配器能力；必要时先登录 | 保留真实退出码与业务错误；不自动重试写请求 |
| skill.list/describe | 当前 Platform 与有效宿主 Agent；无需包内技能声明 | 实际目录的安全元数据，挂载状态跟随当前 Agent；列表与详情在前后端均可调用 |
| kanban.boards.list/issues.list/get | 先列表，再选择实际问题 | 空列表和 cloudAvailable:false 均为正常值；没有任何写接口 |
| desktop.app / capabilities / theme / locale | 页面 SDK 与同源宿主 | 回读真实配置；修改主题和语言仍是手动操作 |
| desktop.requestAccess | kanban.read，或带 connectorId/adapter 的 connector.execute | 使用当前宿主接受的兼容参数，返回 status:granted；不再发送无效 skill.read |
| assistant.image / cancel | 固定 zenmi 服务与模型；编辑再选源图/蒙版 | 尺寸、强度、seed 等必填项已补齐；取消只关联在途请求 |
| desktop.browser/dialog/clipboard/notification/microphone | 用户逐项操作与必要的 OS 权限 | 用户取消、OS 拒绝或不支持均如实显示，不伪造宿主成功 |
| auth | 专用 preload；成功交换还需验签后端 | isAvailable 可检测；默认测试服务未配置交换，createSession 显示具体条件 |
| automation、截图、剪贴板读取、窗口、相机、分享 | 当前 SDK 尚未实现 | 独立预留状态探针，只验证 not_implemented，不能视为业务可用 |

只读自检仅运行读取和确认仍为 stub 的预留探针，不发起模型、写连接器、修改设置或弹原生窗口。实际外部服务、Agent 工具、模型、账号和 OS 权限仍决定能否执行；空值、错误响应或空对象不会被加工成成功数据。

## 后端边界

- 只绑定 loopback，使用 Desktop 注入的 `HOST` / `PORT`。受管启动不依赖系统 Node。
- `/api/backend-call` 固定白名单，不支持任意路径或通用 Desktop action；受保护 API 要求本机来源、自定义头，POST 校验精确 Origin。发布 / 局域网来源不能继承本机后端身份。
- 环境接口只返回变量名与存在性，以及 Node / Electron 版本。后端不记录 token，也不把 SDK 的原始错误 details 透传给页面。
- `/api/backend-subscribe` 使用 NDJSON 逐事件转发，消费端断开会中止订阅，不会停止 run。
- execute 的请求中止会传到 SDK，再断开上游执行请求。其他方法的请求中止不保证服务端撤销；停止后台 run 必须显式调用 stop，不能据此重试写操作。
- `/api/ws` 只提供文本回声、ping/pong 与关闭；要求客户端掩码、合法 UTF-8，单条消息最多 64 KiB，不支持二进制或分片消息。
- `auth.isAvailable` 可自检，`auth.createSession` 有手动卡片。默认 `/api/auth/session` 返回 `501 auth_fixture_unconfigured`，不会根据未验签 Bearer 签发 Cookie。成功 SSO 交换需要接入验证 token 的测试后端；本项目不伪造登录成功。
- 后端 image、artifact.open/saveAs、automation 等保留 SDK 原始 `not_implemented` 行为。后端不存在 desktop / auth SDK。

## 本地预览

```sh
npm run dev
```

打开终端输出的 loopback 地址（默认 4178）。这里只预览真实页面与 HTTP / WS 测试通道，不提供假的 Desktop SDK；所有宿主能力明确显示不可用。可用 `PORT` 调整端口：macOS 用 `PORT=4180 npm run dev`，PowerShell 用 `$env:PORT=4180` 后运行 `npm run dev`。

## 自动验证

先构建，再运行：

```sh
npm test
npm run smoke -- --desktop-repo /path/to/zenmind-desktop
```

`npm test` 验证实际 ZIP、SDK 方法覆盖、Chat / Run / Artifact 身份隔离、分页和迟到响应、返回值结构、后端访问边界、真实复制 SDK 的取消和流读取，以及 WebSocket 的拆包、合包、掩码、UTF-8、ping/pong 和 64 KiB 边界。

`smoke` 额外需要指定 Desktop checkout 已安装的 Electron，以及匹配源码的 `dist-electron`（Desktop 执行 `npm run build:main:prepared`）。它使用真正的 Desktop Gateway 和正式 SDK，Agent / 连接器响应由本地 fixture 提供，验证普通聊天无文件、发布后下游解锁、跨 Run 同名 ID、分页、execute 不覆盖产物 Chat、前后端共享归属及真实按钮传输。原生入口用实际宿主 handler 和隔离 OS 适配器校验，图片与兼容权限参数用实际宿主 validator 校验；不调用真实模型或个人账号。新增验收覆盖默认无 Copilot 包的技能加载和详情、结果无折叠、已编辑 issueId 的前后端同步与空列表清理。Electron profile、数据适配器和输出目录全部隔离；Windows 不读取真实注册表选择的运行数据目录。测试输出截图、JSON 报告和检查结果到系统临时目录。

macOS 可执行本机 Electron 验证；Windows 同样需要在原生 Windows 执行 smoke 和人工导入，不把窄窗口截图或 CSS 预览作为 Windows 实机验收。


## 0.4.0 合并更新

- 新增一键只读验收、逐项进度、12 秒时限与停止控制；前后端分别使用本轮真实目录 ID。模型、界面导航及预留方法不自动调用。
- 修复 MCP 回执误用 CLI exitCode 校验的问题，区分业务失败和宿主异常。
- 默认导出精简报告；显式勾选后才包含脱敏业务详情。
- 加强分页游标、迟到读取、完整文本及 execute 请求体积校验；仍严格验证产物三元组。
- 增加 WebSocket 连接数、帧缓冲、发送队列与关闭超时限制，保持已有同源网关安全检查。
- 新增 desktop.chat.open、desktop.copilot.open/close 手动卡片，以及 chat/execute 对话历史快捷按钮；只支持主工作区当前应用。回执需人工核对界面，不计为业务效果已验证。
- 保留原应用 ID，不引入 React 重写、后端跨源直连或 SSO 会话验签后端。

[接入指南](docs/integration-guide.md) · [测试指南](docs/testing-guide.md) · [API 参考](docs/api-reference.md)。构建时附带指定 Desktop checkout 的官方 SDK 指南并记录其版本与 SHA256。

产物读取限制：完整文本最多读取 1 MiB并保留于内存，默认输出/详情展示前 8 KiB；仅完整且满足请求体积限制的原文才能带入 execute。默认报告不包含请求和业务结果。

菜单依次为「00 总览」「01 准备」「02 智能体」「03 连接器」等。每个菜单在悬停或键盘聚焦时显示感叹号；触屏直接显示。点击打开 bridge 说明 dialog，展示该菜单的接口列表、参数含义和卡片示例，预留接口标注未实现。查看说明不调用接口，支持关闭按钮和 Escape。
