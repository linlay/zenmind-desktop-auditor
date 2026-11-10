# Agent Lab

独立 Desktop WebApp，使用 `agent` SDK 验证 Agent 请求、后台 Run 生命周期和文件闭环。保留原 Bridge Lab；本应用有独立 ID，不迁移其数据。

```sh
npm install
npm test
npm run build -- --desktop-repo /Users/linlay/Project/zenmind/zenmind-desktop
npm run dev
```

`build/agent-lab.zip` 可在 Desktop 本地应用页导入。可选 `--agent <key>` 设置默认 Agent；`--skill <id>` 沿用现有 Lab 的固定技能引用打包方式。开发预览默认 http://127.0.0.1:4179，仅验证页面布局；真实 SDK 需在 Desktop 内使用。

选择 Agent 后上传单文件或直接 query；上传创建 canonical Chat，发送继续该 Chat。已建立 Chat 后锁定 Agent，切换前点击“新建对话”。后台请求返回 runId，点击观察读取事件；解除观察后可从当前 cursor 继续。中断运行使用 interrupt。send 的回执可能指向排队或新的 Run，不自动切换或订阅它。

聊天页提供消息气泡、紧凑附件入口和自动后台观察；运行页可解除观察及继续。Executor 为独立页面，拥有独立 Agent 选择、任务/input/Schema 输入与结果面板。结构化执行单独新建 Chat，支持取消，不接受附件。Agent 必须支持 result_submit。资源读取使用 Chat 相对路径；产物列表只展示已发布产物。每个区域标题的感叹号在 hover/键盘聚焦时出现，可打开参数说明。

页面 SDK 支持全部入口；“托管后端 SDK”仅切换目录、query、execute 与运行控制，上传、观察、资源、产物和原生预览仍走页面 SDK。后端严格限制本机 Origin、方法及请求体，不转发任意 Action。

宿主需使用本次 Desktop SDK/宿主改动。Compose 未同步新增 Agent 目录、上传及控制处理器，不能用本 ZIP 宣称其后端能力通过。没有真实模型账号时，只能验证契约、模拟流程和包格式。

契约判断及验收步骤见 [docs/agent-contract.md](docs/agent-contract.md)。
