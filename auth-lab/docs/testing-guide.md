# 验证

npm run build -- --desktop-repo <checkout> 后 npm test。自动测试覆盖 Desktop 验签、会话/CSRF/Origin、包内无凭据、直接 OIDC 配置拒绝、公开应用票据交换、浏览器事务和重放、共享便签及持久化。

独立服务另以虚拟 OIDC IdP 做真实签名/授权码/PKCE 验证，测试固定企业 callback、回调白名单和一次性票据；不以此代替真实 EIAM、TLS、多设备或原生 Windows 验收。

真实流程：先核对服务健康，再由 EIAM 管理员登记固定企业 callback，实际登录后检查 Auth Lab Cookie 和用户归属、退出及期限。桌面用户必须使用访问者自己的 Main 授权。当前 ZIP 仍由用户手动导入。

0.1.9 包验收：在空数据目录运行解包后的后端，确认无包外配置也可生成指向新加坡中转的登录跳转，callback 使用当前本机 gateway；无会话仍拒绝业务接口。配置损坏时不得退回默认登录。导入后核对实际 gateway，并同步云端精确 callback 后验收完整 Google 回调。
