# 浏览器与 Platform 能力边界

## 数据流与所有权

Desktop 仅托管 electron-node 进程并注入监听端口、程序和数据目录。浏览器访问本机应用，后端同时提供静态页面与业务 API。链路为：浏览器 → DAG Lab 同源接口 → Platform 公开 HTTP API。前端不加载 /__desktop/，不依赖 preload；后端不读取 Desktop 身份文件、不使用 Desktop Action Bridge。

Platform Bridge 是应用的契约适配器，固定提供 Agent 目录、execute 和 Chat 读取，不开放任意 URL/path/action 代理。Platform 现有 WebApp 托管 SDK 仅适用于 Linux Compose，本应用无需该能力。

## 凭据与执行身份

用户在本机网页显式设置地址和 token，真实读取 Agent 目录验证后才替换连接。令牌只留后端内存，仅持久化非敏感地址及默认 Agent；也可由应用启动环境显式注入。凭据不进入日志、流程、运行记录、响应、安装包或导出。Platform 验证身份，应用不通过解码 JWT 假装验签，也不扫描宿主凭据。

本机 HTTP 仅允许 loopback，远程需要 HTTPS；拒绝 URL 凭据、查询、片段和重定向。业务 API 校验本机 Host、精确 Origin、自定义请求头与固定路由，拒绝局域网、Tunnel 和跨源借用本机权限。

连接变更与运行互斥，避免节点间更换主体或实例。每轮冻结各节点实际 Agent key，默认与节点覆盖均来自真实目录；是否具有 result_submit 由 Platform execute 准入判断，不按 mode 推断。不会自动提高 accessLevel。

## DAG、状态与数据

页面拥有草稿，后端拥有快照、拓扑调度及记录，Platform 拥有 Agent/Run/Chat。智能体请求只传 agentKey、message、input.upstream、outputSchema；结果原样交付下游，超限明确失败。失败和取消停止本轮，不自动重试，不回滚已执行操作。

运行 running → succeeded/failed/cancelled；取消中为 cancelling，后端重启将未终结记录标 interrupted。取消用 AbortSignal 断开 Platform execute，遵守其断开即中断契约。刷新仅重新读取状态，不重发模型任务。

对话通过 Platform /api/chat 读取并在网页展示；只接受本应用实际回执中的 Chat ID，不透传资源票据。Platform 权限仍是最终边界。

数据只写应用数据根，同目录临时文件加 rename 发布，进程内串行保存；revision 检测页面冲突。Windows/macOS 使用 Node 路径与文件 API，程序打包替换有明确平台分支。用户数据独立于程序升级。记录包含业务内容，仅用户主动导出时生成文件，凭据不进入记录。
