# Bridge Lab 接入指南

本应用保留稳定 ID `webapp-72eb6f709c8a4d15`。纯 HTML/JS/CSS 页面从同源 `/__desktop/bridge.js` 加载当前宿主 SDK；后端通过 Desktop 注入的 URL/token 创建官方 `createBackendClient`。打包原样复制指定 checkout 的 SDK，并记录 Desktop 版本、revision 与 SDK SHA256，不读取身份文件，不导出 token。

页面和后端共用当前应用实例的 Chat 归属；模型调用、连接器业务命令、系统对话框、设置修改及界面导航由用户逐项发起。后端固定白名单、精确本机来源、自定义请求头和副作用开关保持不变；继续经过同源 `/api` 网关，不建立跨源后端直连通道。

`/api/health`、`/api/env` 为健康和环境存在性诊断；`/api/echo` 和 `/api/ws` 只回显用户提交的数据，不代表任何 SDK 业务成功。WebSocket 仅完整文本帧、ping/pong/关闭，64 KiB 消息、32 个连接及有界缓冲。

测试 Agent 仍在 Desktop 的应用设置里选择；页面只回读配置。execute 需要支持 result_submit 的 Native Agent，文件任务还需实际文件写入与 artifact_publish。SSO 成功交换未配置，后端固定拒绝未验证凭据，不伪造登录会话。

`desktop.chat.open({chatId})` 和 `desktop.copilot.open()/close()` 仅主工作区当前应用的页面可用。后台应用或独立窗口不能调用；Copilot 被禁用时 open 失败。历史弹窗只读，不发起 Run；关闭 Copilot 不停止后台任务。

逐方法参数与示例见 [API 参考](api-reference.md)。安装包内的 `docs/sdk-guide.md` 直接来自指定 Desktop checkout；确切接口以当前源码与生成契约为准。
