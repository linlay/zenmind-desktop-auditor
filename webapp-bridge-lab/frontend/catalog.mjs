const card = (path, group, args = {}, mode = 'manual', note = '') => ({ path, group, args, mode, note });
export const groups = [
  ['overview', '总览', '01'], ['workflow', '关联测试流程', '→'], ['assistant', 'Agent 聊天与执行', '02'], ['connector', '连接器', '03'],
  ['skill', '技能', '04'], ['artifact', '产物', '05'], ['kanban', '看板', '06'],
  ['config', '配置与能力', '07'], ['appearance', '主题与语言', '08'], ['native', '桌面原生能力', '09'],
  ['auth', '身份交换', '10'], ['reserved', '预留接口', '11'], ['backend', '后端通道', '12']
];
export const catalog = [
  card('assistant.chat', 'assistant', { message: '请只回复：Bridge Lab 连接成功。' }, 'manual', '会调用 Agent；长任务建议使用后台模式。'),
  card('assistant.execute', 'assistant', { message: '提取订单金额；无法识别时提交 failure。', input: { text: '订单总额 128 元' }, outputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'], additionalProperties: false } }, 'manual', '需要支持 result_submit 的 Native Agent；不传 skillIds 或 agentKey。'),
  card('assistant.subscribe', 'assistant', { runId: '', cursor: 0 }, 'manual', '开始订阅后台 run；中止订阅不会停止 run。'),
  card('assistant.stop', 'assistant', { runId: '' }, 'manual', '仅停止本应用发起的后台 run。'),
  card('assistant.upload', 'assistant', { name: 'bridge-upload.txt', text: 'Bridge Lab upload verification' }, 'manual', '将 text 编码为真实文本 Blob 上传；返回 chatId 与 upload.id，可在 assistant.chat 中填写 chatId + uploadIds。单文件宿主上限 64 MiB；省略 chatId 时由 Platform 创建并返回。'),
  card('assistant.resource.read', 'assistant', { chatId: '', file: '' }, 'manual', '读取本应用 Chat 内相对路径；可填 upload.name。测试页最多读 1 MiB。'),
  card('assistant.steer', 'assistant', { runId: '', message: '请简短回答。' }, 'manual', '向本应用运行中的后台 Run 追加指令。'),
  card('assistant.send', 'assistant', { runId: '', message: '请补充一句说明。' }, 'manual', '向后台 Run 所属 Chat 投递消息，返回真实 mailbox 回执；不会自动重试。'),
  card('assistant.interrupt', 'assistant', { runId: '' }, 'manual', '与 stop 相同，使用 Primary 控制通道。'),
  card('assistant.submit', 'assistant', { runId: '', awaitingId: '', param: {} }, 'manual', '提交真实 awaitingId 的回答，param 和 params 二选一。'),
  card('assistant.image', 'assistant', { requestId: '', operation: 'generate', prompt: '一张简洁的蓝色圆形测试图标', negativePrompt: '', width: 512, height: 512, count: 1, strength: 0.6, seed: 0, preserveComposition: true, edgeMode: 'strict' }, 'manual', '使用宿主固定 zenmi 图像 Agent，与「测试 Agent」选择无关。每次生成使用新 requestId；默认参数已补齐必填字段。非 generate 操作需源图，局部编辑需 PNG 蒙版。会调用模型。'),
  card('assistant.image.cancel', 'assistant', '', 'manual', '只取消当前正在执行的图像请求，自动带入其 requestId。'),
  card('connector.list', 'connector', {}, 'read'),
  card('connector.describe', 'connector', { connectorId: '' }, 'read'),
  card('connector.invoke', 'connector', { connectorId: '', adapter: 'cli', args: ['--help'] }, 'manual', 'CLI / MCP 可能产生写操作；运行前核对参数。MCP 使用 component、toolName、arguments。'),
  card('desktop.authenticateConnector', 'connector', { connectorId: '' }, 'manual', '需要真实点击；授权后手动重试原请求。'),
  card('skill.list', 'skill', {}, 'read'), card('skill.describe', 'skill', { skillId: '' }, 'read'),
  ...['list', 'get', 'read', 'open', 'saveAs'].map(method => card('artifact.' + method, 'artifact',
    method === 'list' ? { chatId: '', limit: 20 } : { chatId: '', artifactId: '' },
    ['open', 'saveAs'].includes(method) ? 'manual' : 'after', '仅限本应用当前实例发起的 Chat。')),
  card('kanban.boards.list', 'kanban', {}, 'read'),
  card('kanban.issues.list', 'kanban', { limit: 20 }, 'read'),
  card('kanban.issues.get', 'kanban', { issueId: '' }, 'read'),
  card('desktop.capabilities.list', 'config', {}, 'read'),
  card('desktop.capabilities.has', 'config', 'assistant.execute', 'read'),
  card('desktop.chat.open', 'native', { chatId: '' }, 'manual', '在主工作区打开指定 Chat 的只读历史弹窗，不发起 Run。可使用本应用 chat / execute 返回的 Chat ID；也可填写待查看的真实 Chat ID。独立窗口和后台应用不可用。'),
  card('desktop.copilot.open', 'native', {}, 'manual', '幂等打开当前应用已有 Copilot，沿用 Agent、引用和会话；页面禁用时返回 copilot_disabled。仅主工作区当前应用可用。'),
  card('desktop.copilot.close', 'native', {}, 'manual', '关闭当前应用 Copilot，不停止后台 Run。仅主工作区当前应用可用。'),
  card('desktop.app.getConfig', 'config', {}, 'read'), card('desktop.app.getUserConfig', 'config', {}, 'read'),
  card('desktop.requestAccess', 'config', { capability: 'kanban.read' }, 'read', '兼容入口只接受 kanban.read 或带连接器 ID / adapter 的 connector.execute；当前安装即信任。'),
  card('desktop.theme.get', 'appearance', {}, 'read'), card('desktop.locale.get', 'appearance', {}, 'read'),
  card('desktop.theme.set', 'appearance', { themeMode: 'dark' }, 'manual', '修改整个 Desktop，重启后仍保留。'),
  card('desktop.locale.set', 'appearance', { locale: 'zh-CN' }, 'manual', '修改整个 Desktop 的语言偏好。'),
  card('desktop.browser.openExternal', 'native', { url: 'https://example.com' }),
  card('desktop.dialog.selectFiles', 'native', { multiple: false, filters: [{ name: 'Text', extensions: ['txt', 'md'] }] }),
  card('desktop.dialog.selectDirectory', 'native'), card('desktop.dialog.selectSavePath', 'native', { suggestedName: 'bridge-lab.txt' }),
  card('desktop.microphone.getPermission', 'native', {}, 'read'), card('desktop.microphone.requestAccess', 'native'),
  card('desktop.microphone.open', 'native', {}, 'manual', '读取轨道信息后立即停止所有轨道。'),
  card('desktop.clipboard.writeText', 'native', { text: 'Bridge Lab clipboard test' }),
  card('desktop.notification.show', 'native', { title: 'Bridge Lab', body: 'Desktop Bridge 通知测试' }),
  card('auth.isAvailable', 'auth', {}, 'read'),
  card('auth.createSession', 'auth', { exchangePath: '/api/auth/session' }, 'manual', '会弹原生确认。默认测试后端返回未配置；成功交换需要接入验证 token 的后端。'),
  ...['desktop.clipboard.readText', 'desktop.screen.capture', 'desktop.file.reveal', 'desktop.window.getState',
    'desktop.window.minimize', 'desktop.window.maximize', 'desktop.window.restore', 'desktop.window.close',
    'desktop.camera.getPermission', 'desktop.camera.requestAccess', 'desktop.camera.open', 'desktop.share.open',
    'automation.list', 'automation.get', 'automation.create', 'automation.update', 'automation.pause',
    'automation.resume', 'automation.remove', 'automation.runs.list', 'automation.runs.get']
    .map(method => card(method, 'reserved', {}, 'reserved', '宿主尚未实现，不能执行业务；运行仅验证是否返回 not_implemented。'))
];

export function findMethod(root, path) {
  let owner = root;
  const parts = path.split('.');
  for (const key of parts.slice(0, -1)) owner = owner?.[key];
  const fn = owner?.[parts.at(-1)];
  return typeof fn === 'function' ? fn.bind(owner) : null;
}
export function isReservedStub(root, path) {
  let fn = root;
  for (const key of path.split('.')) fn = fn?.[key];
  return typeof fn === 'function' && Function.prototype.toString.call(fn).includes('"not_implemented"');
}
export function listMethods(root) {
  const methods = [];
  function visit(value, prefix, depth) {
    if (depth > 5) return;
    for (const key of Object.keys(value || {})) {
      if (key === 'DesktopBridgeError' || key === 'createBackendClient') continue;
      const next = prefix ? prefix + '.' + key : key;
      if (typeof value[key] === 'function') { methods.push(next); visit(value[key], next, depth + 1); }
      else if (value[key] && typeof value[key] === 'object') visit(value[key], next, depth + 1);
    }
  }
  visit(root, '', 0);
  return methods.sort();
}
