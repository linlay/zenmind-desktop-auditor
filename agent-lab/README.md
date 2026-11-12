# Agent Lab

独立 Desktop WebApp，使用 `agent` SDK 验证 Agent 请求、后台 Run 生命周期和文件闭环。保留原 Bridge Lab；本应用有独立 ID，不迁移其数据。

```sh
npm install
npm test
npm run build -- --desktop-repo /Users/linlay/Project/zenmind/zenmind-desktop
npm run dev
```

`build/agent-lab.zip` 可在 Desktop 本地应用页导入。可选 `--agent <key>` 设置默认 Agent；`--skill <id>` 沿用现有 Lab 的固定技能引用打包方式。开发预览默认 http://127.0.0.1:4179，仅验证页面布局；真实 SDK 需在 Desktop 内使用。

选择 Agent 后上传单文件或直接 query；上传创建 canonical Chat，发送继续该 Chat。聊天页顶部可直接选择智能体，选项同时显示名称与 agentKey；切换后开启新对话，原后台 Run 继续运行。后台请求返回 runId，点击观察读取事件；解除观察后可从当前 cursor 继续。中断运行使用 interrupt。send 的回执可能指向排队或新的 Run，不自动切换或订阅它。

聊天页提供消息气泡、紧凑附件入口和自动后台观察；运行页可解除观察及继续。Executor 为独立页面，拥有独立 Agent 选择、任务/input/Schema 输入与结果面板。结构化执行单独新建 Chat，支持取消，不接受附件。Agent 必须支持 result_submit。资源读取使用 Chat 相对路径；产物列表只展示已发布产物。每个区域标题的感叹号在 hover/键盘聚焦时出现，可打开参数说明。

页面 SDK 支持全部入口；“托管后端 SDK”仅切换目录、query、execute 与运行控制，上传、观察、资源、产物和原生预览仍走页面 SDK。后端严格限制本机 Origin、方法及请求体，不转发任意 Action。

宿主需使用本次 Desktop SDK/宿主改动。Compose 未同步新增 Agent 目录、上传及控制处理器，不能用本 ZIP 宣称其后端能力通过。没有真实模型账号时，只能验证契约、模拟流程和包格式。

契约判断及验收步骤见 [docs/agent-contract.md](docs/agent-contract.md)。

启动时严格检查宿主的 agent SDK。旧宿主显示“宿主需要重新启动”并禁用发送、上传、执行等按钮，重新启动已更新的 Desktop 后可点击“重新连接”。4179 开发预览仅展示界面，不连接真实智能体。

## 页内运行过程

后台聊天返回 Chat 后，页面自动将 Desktop 可信 WebClient 运行时间线嵌入聊天容器。不是弹窗；Lab 原输入区继续负责发消息。无需地址、白名单、token 或到期时间。Desktop 负责来源与 Chat 归属校验、服务认证、区域裁剪和只读观察。

需要包含 desktop.chat.embed 与 webapp-chat Surface 支持的 Desktop 构建，不能仅重导入 ZIP 更新宿主能力。滚动、缩放、隐藏和切页更新挂载；新建 Chat 更换身份。关闭视图只解除观察，不停止 Run。旧宿主明确提示升级，不回退到弹窗。Executor 仍在返回 Chat 后查看。

开发浏览器不模拟 Desktop UI。Windows 和 macOS 均需原生验收页面缩放、滚动、输入焦点及应用切换。
