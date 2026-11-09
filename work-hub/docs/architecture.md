# 架构与边界

## 运行关系

普通浏览器 → 同源本机 Node HTTP 后端 → 本地事务数据文件 / Agent Platform HTTP API。

Desktop 仅提供 v2 WebApp 安装、electron-node 启动、端口、数据目录与生命周期。网站不注入 Desktop preload，不引用 Desktop SDK，不请求 `/__desktop/`，普通浏览器也能完成所有业务功能。项目、任务、成员是本应用自己的业务数据，并非云 Kanban Issue；不调用 Issue 协议或已删除的 issue CRUD 端点。

## 模块职责

| 模块 | 责任 |
| --- | --- |
| frontend/app.mjs | hash 路由、请求、弹窗、确认流程、取消及报告轮询；忽略晚到的旧路由响应 |
| frontend/views.mjs / charts.mjs | 业务页面与根据真实记录生成的 SVG 图表，文本与属性转义 |
| frontend/core/contracts.mjs | 共享字段校验、状态、日期规则及项目指标 |
| backend/server.mjs | 固定 API、同源校验、静态文件白名单、连接切换互斥及关闭流程 |
| backend/store.mjs / seed.mjs | 一次性示例初始化、关系校验、乐观并发、串行事务与原子文件替换 |
| backend/platform-bridge.mjs | Platform Agent 目录、execute、chat；认证、取消、超时、响应大小限制 |
| backend/analysis.mjs | 单活动分析、冻结业务快照、结构化交卷及引用验证、历史状态、凭据脱敏 |

## 业务一致性

每次写入先复制当前状态，在队列中校验并修改草稿；文件替换成功后才发布内存状态。存储失败保持原状态。各实体独立 revision，更新与删除须匹配。项目包含未完成任务时不能标记完成，已完成项目不能新增未完成任务。成员有关联时不能删除。项目删除需明确确认级联，并检查确认时的任务数量；关联变化则拒绝并要求重新确认。删除任务同时删除其备注。

首版使用本机单用户 JSON 工作区，不是多人云数据库；记录数量、备注和分析历史均有限额。数据文件读取损坏时拒绝启动，不自动覆盖。日期按 Asia/Shanghai 日历计算，事件时间存 ISO 时间戳。

## 智能分析状态

`running → completed / failed / cancelled`；请求取消时可短暂显示 `cancelling`。启动时遗留的 running/cancelling 变为 interrupted，不自动重放。每次分析固定快照版本、范围与所用 Platform 地址。连接切换与运行互斥，取消中止实际 HTTP 请求；关闭等待分析及存储队列收尾。

交卷校验风险等级、数组、日期、工时，以及项目和任务的实际引用。它不保证模型推理的事实完整性，页面保留来源和证据供人工判断。建议是草稿，创建任务仍通过普通表单校验与用户保存。聊天历史仅从生成报告时的 Platform 地址读取。原始访问 Token 不进入持久数据、API 输出、业务导出或报告。

## 本机边界

仅绑定 127.0.0.1；API 要求本机 Host、同源 Origin 与自定义请求头，不放开跨域。没有通用代理、命令执行、任意文件访问。浏览器只访问同源 API，Token 由后端转发给明确配置的 Platform。运行目录采用 Node path API，包内路径统一 POSIX；生成 ZIP 在 Windows 覆盖目标时显式删除旧生成物后重命名。macOS/Linux 数据文件权限设为 0600，Windows 使用当前用户文件系统 ACL。
