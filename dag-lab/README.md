# DAG Lab 0.2

**Desktop 托管启动，普通浏览器访问，智能体能力全部来自 Platform。**

支持 DAG 节点编辑、拖动连线、输入、智能体、汇总、输出、逐节点 Agent 选择、取消、保存、运行历史及 JSON 导入导出。浏览器不加载 Desktop SDK，不依赖 preload，不调用原生弹窗、Copilot、主题或系统能力。

## 在 Desktop 托管，在浏览器使用

1. 导入 `build/dag-lab.zip`，在 Desktop 中启动应用。
2. 复制该网页应用的本机访问地址，用普通浏览器打开。也可直接访问应用后端的本机监听端口，后端同时提供完整前端与同源业务 API。不要把 Platform API 端口误当作网站端口。
3. 网页点击“连接 Platform”，填写实际 Platform 地址。常见本机地址为 `http://127.0.0.1:11949`，实际地址以服务配置为准。开启鉴权时填写有权访问该 Platform 的 Bearer token；可以使用 Desktop 本机服务设置的 Platform 调用示例中的 App access token，不能填写 Provider 模型 API Key。
4. 从 Platform 实际目录选择默认 Agent，每个智能体节点也可选择不同 Agent。执行需要有效工具中具有 `result_submit`，不按 mode 名称猜测能力。
5. 编辑、检查并保存流程，点击运行。节点按拓扑顺序执行；“查看节点对话”直接从 Platform 读取并在当前浏览器展示。

令牌只保留在后端内存，不写入流程、历史、磁盘或导出文件。地址与默认 Agent 为非敏感偏好，可保存。后端重启、令牌到期后需重新连接；刷新或关闭浏览器页面不会重发任务。

## 本机直接启动

Node.js ≥22.12：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:4186/`，网页连接 Platform 后即可使用全部智能体功能。未连接时仍能运行无模型数据流程，不生成假的智能体结果。

可选启动环境变量：`DAG_LAB_PLATFORM_URL`、`DAG_LAB_PLATFORM_TOKEN`；显式设置地址时启动验证连接。`PORT` 覆盖预览端口，`DAG_LAB_PREVIEW_DATA` 覆盖预览数据目录。macOS 使用 shell 环境变量，Windows PowerShell 使用 `$env:名称`；无环境变量时也可完全通过网页配置。不要把真实令牌写入仓库或命令输出。

## 打包与验证

```sh
npm run build -- --desktop-repo /absolute/path/to/zenmind-desktop
npm test
npm run smoke -- --desktop-repo /absolute/path/to/zenmind-desktop
```

Desktop checkout 仅用于校验安装包，不复制 Desktop SDK。`backend/platform-bridge.mjs` 对接 Platform 公开 HTTP 契约：Agent 目录、结构化执行、对话读取。它不是 Linux Compose WebApp 托管 SDK，不要求开启该托管能力。Desktop 仅负责本应用进程、端口和数据目录。

macOS / Windows 共用 target:any ZIP，安装后不需要 npm。包内不包含依赖、凭据、业务记录或测试证据。

## 执行与数据

数据位于 `WEBAPP_DATA_DIR/workspace.json`，升级不覆盖；独立预览使用系统临时目录。最多 30 条运行、20 MiB 工作区、40 节点、160 连线。运行冻结实际 Agent 选择，期间不能更换 Platform 或默认 Agent。取消中断 Platform execute，未开始节点跳过；不自动重试、不回滚副作用。重启将未完成记录标为中断，不自动调用模型。

[架构](docs/architecture.md) · [验收](docs/testing-guide.md)
