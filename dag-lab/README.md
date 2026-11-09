# DAG Lab

可安装到 ZenMind Desktop 的智能体 DAG 工作流应用。输入、智能体、汇总、输出节点支持拖动、端口连线、依赖编辑、校验、保存及 JSON 导入导出；运行使用正式 WebApp SDK，逐节点记录状态、结果、耗时与真实 Chat ID。

## 安装与使用

导入 `build/dag-lab.zip`，在主工作区打开 DAG Lab。Desktop → 本应用设置 → 工作流 Agent，选择有 `result_submit` 工具的 Native Agent。所有智能体节点共用这一选择；不需要单独安装模型或配置 API Key。

1. 从需求评审模板开始，点击节点编辑输入、任务说明和结果 Schema，然后“应用修改”。
2. 点击上游节点右端口，再点击目标左端口；也可勾选右侧上游依赖。点击连线可移除。
3. 检查 DAG、保存流程，再点击运行。智能体会产生真实模型调用，按依赖顺序串行执行。
4. 从执行记录查看各节点输出，或打开智能体节点的真实对话历史。查看历史快照时配置只读，点击左侧“工作流编辑器”返回草稿。
5. 取消会中断当前 execute，未执行节点跳过；不自动重试、不回滚外部副作用。刷新页面不重发任务，后端仍可继续当前流程。

普通浏览器可编辑全部流程，运行“数据汇总”模板的本地节点；未连接 Desktop 时智能体流程明确不可运行，不提供模拟通过结果。模板只是用户点击后加载的流程，不在安装、打开或导入时自动执行。

## 开发与打包

Node.js ≥22.12，macOS / Windows 共用纯 JS 代码和 target:any ZIP。

```sh
npm ci
npm run dev
npm run build -- --desktop-repo /absolute/path/to/zenmind-desktop
npm test
npm run smoke -- --desktop-repo /absolute/path/to/zenmind-desktop
```

PowerShell 同样使用这些命令，将参数路径替换为 `C:\Projects\zenmind-desktop`。预览监听 `http://127.0.0.1:4186`；端口可通过 `PORT` 环境变量覆盖。预览数据位于系统临时目录的 `zenmind-dag-lab-preview`，可设置 `DAG_LAB_PREVIEW_DATA` 指向独立测试目录。

构建从指定 Desktop checkout 原样复制生成 SDK、验证 Manifest 和最终 ZIP，并记录版本、revision 与 SHA256。不打包依赖、凭据、用户配置、业务记录或测试证据。安装包不需要目标机器运行 npm install。

## 项目边界

这是使用智能体能力的 Desktop WebApp；没有增加宿主 IPC、任意 SDK 代理、脚本执行或插件专用原生窗口入口。WebApp SDK 与 Plugin Bridge 是独立协议，不能相互替代。

流程与运行记录保存在 `WEBAPP_DATA_DIR/workspace.json`，升级程序包不覆盖数据。保留最多 30 条运行记录和 20 MiB 工作区；用户可删除旧记录。流程最多 40 节点、160 连线、512 KiB；输入上下文和输出超限会明确失败，不静默截断。

[架构与运行边界](docs/architecture.md) · [验收清单](docs/testing-guide.md)
