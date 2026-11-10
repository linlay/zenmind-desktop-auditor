const card = (path, group, args = {}, mode = 'manual', note = '') => ({ path, group, args, mode, note });
export const groups = [
  ['overview', '总览', '00'], ['workflow', '准备', '01'], ['assistant', '智能体', '02'], ['connector', '连接器', '03'],
  ['skill', '技能', '04'], ['artifact', '产物', '05'], ['kanban', '看板', '06'],
  ['config', '配置与能力', '07'], ['appearance', '主题与语言', '08'], ['native', '桌面原生能力', '09'],
  ['auth', '身份交换', '10'], ['reserved', '预留接口', '11'], ['backend', '后端通道', '12']
];
export const catalog = [
  card('assistant.agents.list', 'assistant', {}, 'read', '读取实际可用智能体和宿主默认智能体；不返回提示词、路径或凭据。'),
  card('assistant.chat', 'assistant', { message: '请只回复：Bridge Lab 连接成功。' }, 'manual', '会调用 Agent；长任务建议使用后台模式。'),
  card('assistant.execute', 'assistant', { message: '提取订单金额；无法识别时提交 failure。', input: { text: '订单总额 128 元' }, outputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'], additionalProperties: false } }, 'manual', '需要支持 result_submit 的 Native Agent；可选择智能体，不传 skillIds。'),
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


const parameterNotes = {
  message: '发送给智能体的非空文本，最多 12000 个字符。', agentKey: '可选，来自 assistant.agents.list；省略时使用宿主默认智能体。',
  chatId: '本应用当前实例通过上传、聊天或 execute 实际取得的 Chat 标识。', runId: '本应用后台聊天返回的 Run 标识；控制沿用创建时的根智能体。',
  uploadIds: '可选，同一 Chat 上传返回的文件 ID 数组，最多 16 项，句柄有效 30 分钟。', skillIds: '可选，包内 Copilot 声明的附加技能 ID 子集；空数组表示不附加。', background: '可选布尔值；true 返回接受回执，再通过 subscribe 观察后台 Run。',
  input: '可选，标准 JSON 业务输入，不接受 Blob 或 $file。', outputSchema: '必填，以 type:object 为根的 JSON Schema；约束 result_submit 结果。',
  file: 'resource.read 使用 Chat 相对文件路径，禁止 URL、绝对路径及隐藏内部文件；upload 使用 Blob，最大 64 MiB。',
  name: '可选文件名，不包含目录；上传省略时使用 File.name 或 attachment.bin。', text: 'Lab 上传卡片的文本样本，会转为 text/plain Blob；SDK 实际参数是 file。',
  cursor: '可选，订阅从返回的事件游标继续；产物分页必须使用上次返回的游标。', limit: '可选，每页返回数量；以宿主接口校验为准。',
  artifactId: '从 artifact.list 返回的产物标识，与 chatId / runId 一起使用。', connectorId: '从 connector.list 返回的已安装连接器标识。',
  adapter: '执行适配器，cli 或 mcp，必须已在 describe 中声明。', args: 'CLI 参数数组，逐项传递，不拼接 shell 命令。',
  component: 'MCP 组件名，从 connector.describe 获取。', toolName: 'MCP 工具名，从 describe 获取。', arguments: 'MCP 工具的 JSON 参数对象。',
  idempotencyKey: '可选，调用方为同一业务操作保持稳定的幂等键。', credentialRevision: '可选，连接器凭据版本，不是凭据正文。',
  skillId: '从 skill.list 返回的技能 ID。', issueId: '从 kanban.issues.list 返回的问题 ID，只读。',
  awaitingId: 'Run 发出 awaiting.asking 时返回的真实等待项标识。', param: '单个表单或规划回答对象，与 params 二选一。', params: '问题或审批回答数组，与 param 二选一。',
  submitId: '可选，提交回答的关联标识。', steerId: '可选，本次追加指令的标识。', requestId: '可选调用关联标识；send 重试核对时保持同一标识。',
  capability: '能力 ID，例如 kanban.read；连接器权限申请另带 connectorId 与 adapter。',
  themeMode: 'Desktop 全局外观偏好：light、dark 或 system。', locale: 'Desktop 支持的应用语言标识，例如 zh-CN。',
  url: '要在系统浏览器打开的有效外部网址。', multiple: '是否允许一次选择多个文件。', filters: '原生文件选择器扩展名过滤数组。', suggestedName: '保存对话框建议文件名，不是允许直接写入的路径。',
  title: '通知标题。', body: '通知正文。', exchangePath: '同源网站的会话交换端点，网站后端必须验签。',
  operation: '图像操作：generate 或相应编辑模式；编辑需要 source。', prompt: '图像生成或编辑说明。', negativePrompt: '可选负向提示。', width: '输出宽度，16 的倍数。', height: '输出高度，16 的倍数。', count: '生成张数。', strength: '编辑强度。', seed: '随机种子。', preserveComposition: '是否保留原图构图。', edgeMode: '边缘处理方式。', source: '编辑原图 Blob。', mask: '可选 PNG 蒙版 Blob，必须同时提供 source。', signal: '可选 AbortSignal，放在第二参数 options 中，不能放入 JSON 业务参数。'
};
const extras = {
  'assistant.chat': ['chatId','agentKey','skillIds','background','uploadIds'], 'assistant.execute': ['agentKey'],
  'assistant.upload': ['file','chatId','agentKey','signal'], 'assistant.resource.read': ['signal'],
  'assistant.subscribe': ['signal'], 'assistant.steer': ['requestId','steerId'], 'assistant.send': ['requestId'],
  'assistant.submit': ['submitId','params'], 'skill.list': ['agentKey'], 'skill.describe': ['agentKey'],
  'connector.invoke': ['component','toolName','arguments','idempotencyKey','credentialRevision'],
  'assistant.image': ['source','mask'], 'desktop.microphone.open': ['constraints']
};
export function menuBridgeInfo(id) {
  let methods = catalog.filter(def => def.group === id);
  if (id === 'overview') methods = catalog.filter(def => ['desktop.capabilities.list','desktop.capabilities.has','desktop.app.getConfig','desktop.app.getUserConfig'].includes(def.path));
  if (id === 'workflow') methods = catalog.filter(def => ['assistant.agents.list','assistant.chat','assistant.subscribe','assistant.upload','assistant.resource.read','artifact.list','artifact.get','artifact.read','artifact.open','artifact.saveAs'].includes(def.path));
  if (id === 'backend') methods = catalog.filter(def => ['assistant','connector','skill','artifact','kanban'].includes(def.group) && !['assistant.image','assistant.image.cancel','desktop.authenticateConnector','artifact.open','artifact.saveAs'].includes(def.path));
  return methods.map(def => ({ ...def, parameters: def.mode === 'reserved' ? [] : [...new Set([...(def.args && typeof def.args === 'object' && !Array.isArray(def.args) ? Object.keys(def.args) : typeof def.args === 'string' ? [def.path === 'assistant.image.cancel' ? 'requestId' : 'capability'] : []), ...(extras[def.path] || [])])].map(name => ({name, description: parameterNotes[name] || (name === 'constraints' ? '可选音频采集约束对象，不请求视频。' : '按 SDK 参数对象传递；样例值见下方。')})) }));
}
