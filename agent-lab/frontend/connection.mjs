const unavailableMessage = '当前没有可用的 Desktop Agent Bridge。请在 Desktop 中导入并打开 Agent Lab；4179 开发预览不连接真实智能体。';
function failure(code, message) { return Object.assign(new Error(message), { code }); }
export function createBridgeConnection(loadModule) {
  let sdk;
  return {
    get available() { return Boolean(sdk); },
    clear() { sdk = undefined; },
    get sdk() {
      if (!sdk) throw failure('agent_bridge_unavailable', unavailableMessage);
      return sdk;
    },
    async connect() {
      sdk = undefined;
      let candidate;
      try { candidate = await loadModule(); }
      catch { throw failure('agent_bridge_unavailable', unavailableMessage); }
      const methods = ['list', 'query', 'execute', 'observe', 'interrupt', 'steer', 'send', 'submit', 'upload'];
      if (methods.some(method => typeof candidate?.agent?.[method] !== 'function') || typeof candidate?.agent?.resource?.read !== 'function') {
        throw failure('agent_bridge_upgrade_required', '当前 Desktop 进程仍提供旧版 SDK，缺少 agent 接口。请先重新启动已更新的 Desktop，再重新打开 Agent Lab。仅刷新网页或重新导入 ZIP 不能更新宿主进程。');
      }
      sdk = candidate;
      return sdk;
    }
  };
}
