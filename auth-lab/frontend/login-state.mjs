/** Login affordances depend on both server configuration and this page's host capability. */
export function loginState(status, desktopAvailable, pageUrl) {
  const configuredDesktop = Boolean(status.desktop);
  const configuredOidc = Boolean(status.oidc);
  const localPage = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(pageUrl).hostname);
  const desktopLogin = desktopAvailable && configuredDesktop;
  const openDesktopUrl = !desktopAvailable && configuredDesktop && /^(?:cutej|zenmind):\/\/open$/u.test(status.desktopOpenUrl || '') ? status.desktopOpenUrl : '';
  if (status.canonicalRequired && !status.oidcLoginUrl) return {
    title: '当前地址无法登录', message: '页面可以访问，但此地址尚未启用认证。',
    help: '请使用管理员提供的认证访问地址。', desktopLogin: false, oidcLogin: false, openDesktopUrl: ''
  };
  if (status.issue || !configuredDesktop && !configuredOidc) return {
    title: '登录尚未配置', message: '应用已启动，管理员完成认证配置后才能登录。',
    help: status.issue || '请配置 OIDC 或 Desktop OneID 验证，并重启应用。', desktopLogin: false, oidcLogin: false, openDesktopUrl: ''
  };
  if (!desktopLogin && !configuredOidc) return {
    title: desktopAvailable ? '登录方式不可用' : '请在 Desktop 中继续',
    message: '当前应用尚未启用浏览器登录。',
    help: localPage ? '请在 Desktop 内置浏览器中打开当前网址，使用自己的 OneID 登录。复制地址到系统浏览器不会共享 Desktop 登录状态。'
      : '请在自己的 Desktop 内置浏览器或工作面板中打开本应用的 HTTPS 地址，使用 OneID 登录。',
    desktopLogin: false, oidcLogin: false, openDesktopUrl
  };
  return {
    title: '登录 Auth Lab', message: '选择一种方式登录。', help: '',
    desktopLogin, oidcLogin: configuredOidc, openDesktopUrl
  };
}
