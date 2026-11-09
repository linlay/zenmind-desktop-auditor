# 浏览器优先验收

构建后 npm test 验证 DAG、Agent 身份、取消、持久化、直接 Platform HTTP 请求、错误映射、凭据不落盘与无 Desktop SDK 的安装包。

npm run smoke 使用隔离 Chromium renderer 充当普通浏览器，直接访问应用端口，不使用 Desktop Gateway、preload 或任何 /__desktop/ 请求。网页连接受控 Platform HTTP 服务，覆盖 Agent 目录、逐节点选择、完整 DAG、网页内对话、取消、刷新、拖动、导入导出及宽窄屏。受控响应不代表真实账号和模型已验证。

## 真实环境（macOS / Windows 分别验收）

1. Desktop 导入并启动 ZIP，复制本机访问地址，用 Chrome/Edge/Safari 打开，不要求在 Desktop 中打开页面。
2. 网页配置真实 Platform 地址和令牌。鉴权关闭的本机开发实例可留空 token；错误或失效 token、不可达地址、停服要明确失败。
3. 选择默认 Native Agent，按节点覆盖为不同 Agent，运行需求评审；核对提示词、Schema、上游数据与实际 Agent，缺少 result_submit 必须明确拒绝。
4. 在浏览器查看节点对话，无原生弹窗、Desktop SDK 或 Copilot 调用。
5. 取消长任务，确认 Platform 请求关闭、后续节点跳过；刷新不重复执行。后端重启后旧运行中断、token 不恢复。
6. 运行时更换 Platform 或默认 Agent 必须拒绝，草稿编辑不改变在途快照。
7. 保存、拖动、连线、循环检查、删除、JSON 往返、历史只读与记录删除正常。
8. 导出、磁盘 workspace.json、响应均不含 token，浏览器网络没有 /__desktop/ 请求。
9. 未连接 Platform 时无模型流程仍可运行；检查浅深色与宽窄屏。

开发启动 npm run dev 默认地址为 http://127.0.0.1:4186/。Desktop 托管时端口动态分配，用该应用的本机访问链接；Platform API 地址与网站地址不同。
