# 身份边界

Auth Lab 只拥有公开应用 UUID、可信 ticket 服务地址、浏览器事务和应用会话，不是 OAuth/OIDC Client。独立服务是标准企业 OIDC RP，持有企业配置并验证签名、issuer/audience、时效、state/nonce、上游 S256。Auth Lab 不保存 Client ID、Secret 或公司 Token。

上下游事务完全分离。应用 verifier 只留后端；服务记 challenge。应用接收 60 秒一次性票据，服务仅对绑定的 app UUID、精确 callback 和正确 verifier 返回与 nonce 绑定的最小身份。应用验证结果来源、app、callback、nonce、签发/到期及最大一小时后建随机 HttpOnly Cookie。HTTP 只限本机 loopback，其他部署必须 HTTPS。

UUID 是公开产品标识，无法证明安装实例或程序本身可信。当前模式是无客户端凭据的接入，不提供 confidential client 的实例证明；回调必须管理员精确登记。不能通过重命名字段暗藏客户端凭据，不提供开放注册或动态端口通配。

Desktop 现有交换保持独立，后端短暂验真经访问者原生确认提交的 OneID，页面不获得 Bearer；不向中间服务转发。官网身份、本地 App Token、发布者和访问者身份不混用。

会话不超过服务返回的上游证明期限及一小时，重启清空，退出只影响当前应用。不承诺企业即时撤销。用户键按可信 issuer+subject 生成，不以姓名/邮箱自动合并旧身份；SQLite 便签及原作者键保留，已登录用户继续读取共享列表。

Desktop Token 的 Audience 使用预配 SHA-256 指纹精确匹配，不保存原始 Audience/Client ID 字符串；指纹是公开验证参数，不是认证凭据。Token 仍先独立验签、校验 issuer/期限，再对验真的 Audience 做指纹比较。

0.1.8：后端在请求前重新读取包外配置；管理员补齐或更新配置后无需再次重启后端。配置变化会清理本实例旧会话和登录事务；错误配置继续拒绝认证。服务回调仍只允许管理员精确登记的 origin 和路径，不新增端口通配。

# 包内公开测试默认值

0.1.9 默认连接 https://auth-test.zenmind.cc，内置公开 app UUID，不内置客户端凭据。仅当包外 auth-config.json 缺失时启用包内默认值；存在但无效的配置继续拒绝认证。包外显式配置保持优先，不能被默认值掩盖。

无显式 publicOrigin 时仅允许本机 loopback gateway，逐次登录事务保存并核对精确 origin，Cookie 按 origin 隔离；远程请求不能推导任意回调。云端仍只接受管理员登记的精确 callback，不支持动态端口通配或开放注册。

# 默认双登录入口

0.1.10 的测试 ZIP 预配 CuteJ 企业 Desktop 公开信任参数与新加坡 broker。Desktop OneID 和 Google broker 仍是独立身份来源，不合并 issuer 或 subject，不向 broker 转发 OneID。默认 Desktop 配置只包含 issuer、JWKS、签名算法和 Audience 指纹；前端只有检测到真实官方 auth bridge 时才展示直接 OneID 登录，且继续调用原生确认与后端验签。浏览器只展示统一认证入口。包外配置仍显式覆盖整个默认配置；其他 Desktop 环境须预配其可信公钥参数。

中转本机动态端口策略已由用户明确授权，只接受 http://127.0.0.1:{1024..65535}/api/auth/oidc/callback，并将每次事务和票据绑定完整 callback；不开放任意地址。

# 用户明确授权的局域网 HTTP 测试

0.1.11 测试 ZIP 默认开启 allowPrivateHttpForTesting。仅私有 IPv4 与链路本地 HTTP origin 可在无固定 publicOrigin 时发起认证，固定 HTTPS origin 的生产配置保持原行为。OneID 与 broker 的会话、Cookie 和登录事务仍绑定访问者实际 origin；状态页返回可用登录地址，不允许前端跳转空字符串。关闭开关后，HTTP 页面可以展示，但未获认证的远端入口不得建立会话。访问者 Desktop 另由宿主开发测试开关控制 OneID 提交，不由应用页面开启。
