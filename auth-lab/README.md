# Auth Lab 0.1.11

Auth Lab 不再充当 OIDC Client。源码、安装包和当前实际配置不保存企业或 Broker 的 Client ID/Secret；包内预置公开认证服务地址和应用 UUID；包外配置可覆盖这些公开值，并保留 Desktop 公钥验签配置。UUID 是公开路由标识，不证明应用可信。

浏览器登录：Auth Lab 建立 HttpOnly 事务 Cookie、state/nonce、PKCE verifier，浏览器跳转独立服务。独立服务持有企业客户端凭据并完成 OIDC，在固定企业 callback 验证身份后，向预先登记的应用 callback 发一次性短票据。Auth Lab 后端以 verifier 兑换最小身份结果并创建会话，不接收企业 Token。

配置示例见 config/auth-config.example.json。服务 origin 必须固定且可信；远程 HTTPS，本机 loopback 可 HTTP。精确 callback 由独立服务管理员登记，不允许任意 returnUrl。

```sh
npm ci
npm run build -- --desktop-repo /path/to/zenmind-desktop
npm test
npm run dev
```

build/auth-lab.zip 由用户手动导入，不自动导入或重启 Desktop。包不含实际用户配置、Token、私钥、依赖树或测试数据。Node >=22.13，Windows PowerShell 使用相同 npm 参数及实际 checkout 路径。

Desktop OneID 保留：访问者自己的 Main 原生确认后同源交换，应用验签并建 Cookie；该分支不把 Bearer 转交认证服务，不借发布者身份。共享便签和 SQLite 数据保持原有规则。

部署配置仅使用公开 broker.origin/appId，不接受旧 oidc 配置或任意层级的客户端凭据键。真实旧配置必须先由操作者迁往独立服务私有目录并从 Auth Lab 删除，不在应用数据目录留下含凭据的备份。配置变更后需替换旧进程以清除内存凭据。

详见 docs/architecture.md、docs/testing-guide.md、docs/broker-migration.md。

Desktop Token 的 Audience 使用预配 SHA-256 指纹精确匹配，不保存原始 Audience/Client ID 字符串；指纹是公开验证参数，不是认证凭据。Token 仍先独立验签、校验 issuer/期限，再对验真的 Audience 做指纹比较。

0.1.8：后端在请求前重新读取包外配置；管理员补齐或更新配置后无需再次重启后端。配置变化会清理本实例旧会话和登录事务；错误配置继续拒绝认证。服务回调仍只允许管理员精确登记的 origin 和路径，不新增端口通配。

0.1.9：ZIP 默认内置 https://auth-test.zenmind.cc 和公开 app UUID，无 auth-config.json 时直接启用浏览器登录。默认仅从本机 Desktop gateway 推导回调 origin，登录事务绑定该 origin；远程部署仍需显式配置 HTTPS publicOrigin。包外配置存在时优先使用，损坏配置拒绝认证。云中转精确回调白名单不变，新 gateway 端口需管理员同步登记。

0.1.10：默认 ZIP 同时预置新加坡统一认证和 CuteJ Desktop OneID 的公开验证配置（issuer、JWKS、算法、Audience SHA-256 指纹），不含原始 Client ID、Secret 或 Token。在具备 Desktop auth bridge 的页面优先显示 OneID 按钮，并保留统一认证选项；普通浏览器只提供可用的统一认证。OneID 继续由访问者原生确认、后端验签，不经过新加坡中转。包外配置存在时仍整份覆盖默认值。新加坡中转已为此应用显式启用受限本机动态端口，不再逐端口登记；内部网络分享仍需精确 HTTPS 回调。

0.1.11 测试包：默认 allowPrivateHttpForTesting:true，允许本机及私有 IPv4/链路本地 HTTP 地址发起两种认证；本机和每个局域网 origin 的会话/事务继续隔离。中转需启用同名应用测试策略；访问者局域网 OneID 还需新版 Desktop 的 ZENMIND_AUTH_PRIVATE_HTTP_TEST=1。正式恢复 HTTPS 时关闭两端测试策略；公网 HTTP 不在此例外范围。修复空登录 URL 导致页面刷新的问题。
