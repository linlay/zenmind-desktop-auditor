# Work Hub

可由普通浏览器访问的项目与任务管理网站。Desktop 可以安装、启动这个 WebApp；业务操作不依赖 Desktop bridge，智能体能力直接使用 Agent Platform HTTP API。

## 运行

要求 Node.js ≥ 22.12。进入本目录：

```sh
npm ci
npm run dev
```

打开 [http://127.0.0.1:4191/](http://127.0.0.1:4191/)。终端进程需保持运行；下次使用重新运行同一命令即可恢复数据。

默认业务数据保存在本目录 `.local-data/workspace.json`，不会提交 Git。可用 `WORK_HUB_DATA_DIR` 指定其他持久目录，`PORT` 修改端口。Desktop 安装后使用其提供的 `WEBAPP_DATA_DIR`，与开发模式的数据独立。备份时停止应用，复制整个数据目录；恢复时使用同一版本并替换该目录。初次运行生成明确标识的可编辑示例：6 个项目、30 个任务、6 名成员；不会每次启动重置。

## 功能

| 页面 | 可操作功能 |
| --- | --- |
| 工作概览 | 活跃项目、完成率、逾期、近 14 天完成趋势、状态分布、项目进度、成员剩余工时、最近活动；点击图表进入对应列表 |
| 项目管理 | 新建、搜索筛选、排序分页、编辑、详情、任务关联、负责人、预算与日期、确认级联删除 |
| 任务中心 | 新建、项目/成员/状态/优先级筛选、列表与详情、工时、状态变更、进度备注及删除 |
| 团队成员 | 列表、详情、增删改、每周容量与剩余工作量；关联项目或任务时需先改派再删除 |
| 智能分析 | Platform Agent 选择、全局或单项目范围、分析重点、风险证据、行动建议、下周计划、取消、历史、报告导出及 Platform 对话历史 |

全局搜索可通过 Ctrl/Cmd + K 聚焦；列表支持当前筛选结果 CSV 导出，概览支持业务 JSON 导出。项目、任务、成员、备注和分析历史都实际保存到本机。编辑与删除有版本校验，多页面冲突会提示刷新，不会静默覆盖。

## Platform 连接

点击左下角“连接 Platform”，输入实际服务地址（默认 `http://127.0.0.1:11949`）及有效 Bearer Token。凭据只存于服务进程内存，服务重启后需重填；地址和默认 Agent 可以保存。不要将真实凭据写入源码、Git 或截图。非本机地址必须使用 HTTPS。

使用真实的 `/api/agents?scope=invoke`、`/api/execute` 和 `/api/chat`，不经过 Desktop Gateway。目录过滤不支持 execute 的 ACP、PROXY、CHANNEL Agent。执行时发送选定范围的业务快照，包括任务描述、项目及成员姓名/角色；不发送成员邮箱和进度备注。请连接你信任的 Platform。

智能分析要求 Agent 以 `result_submit` 提交结构化结果。失败、401、取消、异常交卷会明确显示，不会生成预设“成功报告”。结果中的项目/任务引用需属于发送的快照；报告保留来源版本和记录数。建议“创建任务”先打开可编辑表单，只有点击保存才会产生任务。报告属于当时快照，后续业务变更不会自动重算。

## 构建 Desktop 安装包

```sh
npm run build -- --desktop-repo /absolute/path/to/zenmind-desktop
```

生成 `build/work-hub.zip`。构建使用目标 Desktop 当前契约校验 manifest、目录、最终 ZIP 的布局和 CRC。导入 Desktop 本地应用后启动，再用浏览器访问 Desktop 显示的本机服务地址。包不包含 Desktop SDK、凭据、运行数据、依赖或测试文件。前端与后端仅需安装包内资源，运行时无 npm 依赖。

## 验证

```sh
npm test
npm run smoke -- --desktop-repo /absolute/path/to/zenmind-desktop
```

smoke 前先 build，使用该 Desktop 的 Electron 加载**构建产物**，隔离数据与用户 profile。HTTP 集成与页面验收的智能体响应来自明确的测试 Platform，不代表真实模型已验证。实际账号与模型、Desktop 安装启动、Windows 实机按 [验收指南](docs/testing-guide.md) 验证。

设计与边界见 [架构说明](docs/architecture.md)。
