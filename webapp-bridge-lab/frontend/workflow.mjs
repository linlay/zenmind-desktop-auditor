export function problem(code, message) { return Object.assign(new Error(message), { code }); }
const nonempty = value => typeof value === 'string' && value.length > 0;
export const artifactKey = item => JSON.stringify([item.runId, item.artifactId]);
const ended = new Set(['completed', 'failed', 'interrupted', 'cancelled']);

// Only identities returned by this application's SDK are admitted. Nothing is restored from storage.
export class Workflow {
  chats = new Map();
  selectedChatId = '';
  remember(result, { channel, kind, title = '' }) {
    if (!nonempty(result?.chatId)) throw problem('invalid_response', '宿主未返回有效 chatId，不能进入产物测试。');
    const chat = this.chats.get(result.chatId) || { chatId: result.chatId, items: [], selectedArtifact: '', revision: 0, loaded: false };
    Object.assign(chat, { channel, kind, title: title || kind, runId: result.runId || '', status: result.accepted ? 'running' : 'completed' });
    this.chats.set(chat.chatId, chat);
    if (!this.selectedChatId) this.selectedChatId = chat.chatId;
    return chat;
  }
  chat(id = this.selectedChatId) {
    const chat = this.chats.get(id);
    if (!chat || chat.status === 'expired') throw problem('prerequisite_required', '请先通过本应用发起聊天或点击「生成测试产物」。其他应用、旧实例或手填的 Chat ID 不能作为本次测试依据。');
    return chat;
  }
  selectChat(id) { this.chat(id); this.selectedChatId = id; }
  selectArtifact(key) {
    const chat = this.chat();
    if (!chat.items.some(item => artifactKey(item) === key)) throw problem('prerequisite_required', '请从当前 Chat 的实际产物列表选择文件。');
    chat.selectedArtifact = key;
  }
  artifact(chatId = this.selectedChatId) {
    const chat = this.chat(chatId);
    const item = chat.items.find(item => artifactKey(item) === chat.selectedArtifact);
    if (!chat.loaded || !item) throw problem('prerequisite_required', '请先刷新当前 Chat 的产物列表并选择真实文件；有 chatId 不等于已经发布产物。');
    return item;
  }
  artifactArgs(chatId = this.selectedChatId) {
    const item = this.artifact(chatId);
    return { chatId, runId: item.runId, artifactId: item.artifactId };
  }
  checkArtifactArgs(args) {
    const chat = this.chat(args?.chatId);
    const matches = chat.items.filter(item => item.artifactId === args.artifactId && (!args.runId || item.runId === args.runId));
    if (!chat.loaded || !nonempty(args.runId) || matches.length !== 1) throw problem('prerequisite_required', 'chatId、runId 与 artifactId 必须来自同一份已读取的产物列表，不能混用不同 Chat 或 Run 的 ID。');
  }
  beginList(args) {
    const chat = this.chat(args.chatId);
    if (args.cursor !== undefined && (!chat.loaded || chat.nextCursor === undefined || JSON.stringify(args.cursor) !== JSON.stringify(chat.nextCursor))) throw problem('prerequisite_required', '下一页必须使用当前清单返回的游标。');
    chat.revision++;
    if (args.cursor === undefined) { chat.items = []; chat.loaded = false; chat.selectedArtifact = ''; delete chat.nextCursor;
    }
    return { chatId: chat.chatId, revision: chat.revision, args: { ...args } };
  }
  assertCurrent(ticket) {
    if (this.chat(ticket.chatId).revision !== ticket.revision) throw problem('stale_result', '产物清单已更新，本次迟到结果已忽略。');
  }
  acceptList(ticket, result) {
    const chat = this.chat(ticket.chatId);
    if (ticket.revision !== chat.revision) throw problem('stale_result', '已有更新的产物查询，本次迟到结果已忽略。');
    if (!Array.isArray(result?.items)) throw problem('invalid_response', '产物列表没有返回 items 数组。');
    if (result.nextCursor !== undefined && result.nextCursor !== null && !((typeof result.nextCursor === 'string' && result.nextCursor) || (Number.isSafeInteger(result.nextCursor) && result.nextCursor >= 0))) throw problem('invalid_response', '分页游标必须是宿主返回的非空字符串。');
    if (ticket.args.cursor !== undefined && result.nextCursor === ticket.args.cursor) throw problem('invalid_response', '宿主重复返回同一分页游标，不能继续翻页。');
    for (const item of result.items) {
      if (item?.chatId !== chat.chatId || !nonempty(item.runId) || !nonempty(item.artifactId) || !nonempty(item.name)) throw problem('invalid_response', '产物元数据缺少真实 Chat/Run/文件标识，或返回了其他 Chat 的文件。');
    }
    const combined = new Map(chat.items.map(item => [artifactKey(item), item]));
    result.items.forEach(item => combined.set(artifactKey(item), item));
    chat.items = [...combined.values()]; chat.loaded = true; chat.nextCursor = result.nextCursor;
    if (!chat.items.some(item => artifactKey(item) === chat.selectedArtifact)) chat.selectedArtifact = chat.items[0] ? artifactKey(chat.items[0]) : '';
  }
  event(runId, event) {
    const chat = [...this.chats.values()].find(chat => chat.runId === runId && chat.kind === 'background');
    if (!chat) return;
    if (['run.error', 'run.failed', 'subscription.failed'].includes(event.type)) chat.status = 'failed';
    if (event.type === 'run.interrupted') chat.status = 'interrupted';
    if (event.type === 'run.finished' && !ended.has(chat.status)) chat.status = ['failed', 'error', 'interrupted', 'cancelled'].includes(event.reason) ? event.reason : 'completed';
  }
  expire(id) {
    const chat = this.chats.get(id);
    if (chat) { chat.status = 'expired'; chat.items = []; chat.loaded = false; chat.selectedArtifact = ''; chat.revision++; }
  }
  report() { return [...this.chats.values()].map(({ revision, ...chat }) => chat); }
}

export const BACKEND_METHODS = new Set(['assistant.agents.list', 'assistant.upload', 'assistant.resource.read', 'assistant.steer', 'assistant.send', 'assistant.interrupt', 'assistant.submit', 'assistant.chat', 'assistant.execute', 'assistant.subscribe', 'assistant.stop',
  'connector.list', 'connector.describe', 'connector.invoke', 'skill.list', 'skill.describe', 'artifact.list', 'artifact.get', 'artifact.read',
  'kanban.boards.list', 'kanban.issues.list', 'kanban.issues.get']);
export const WRITES = new Set(['assistant.upload', 'assistant.resource.read', 'assistant.steer', 'assistant.send', 'assistant.interrupt', 'assistant.submit', 'assistant.chat', 'assistant.execute', 'assistant.subscribe', 'assistant.stop', 'connector.invoke']);

export function validateResult(path, value, args) {
  const invalid = message => { throw problem('invalid_response', path + '：' + message); };
  if (!['auth.isAvailable', 'desktop.capabilities.has'].includes(path) && (!value || typeof value !== 'object' || Array.isArray(value))) invalid('必须返回实际结果对象，不能用 null 或缺失值代替');
  if (path === 'assistant.agents.list') {
    if (!Array.isArray(value.items) || value.items.some(item => !nonempty(item.agentKey) || !nonempty(item.name)) || !nonempty(value.defaultAgentKey)) invalid('缺少真实智能体列表或默认智能体');
  } else if (path === 'assistant.upload') {
    if (!nonempty(value.chatId) || !nonempty(value.upload?.id) || !nonempty(value.upload?.name)) invalid('缺少上传 Chat 或文件标识');
  } else if (path === 'assistant.chat') {
    if (!nonempty(value?.chatId) || !nonempty(value?.runId)) invalid('缺少真实 chatId / runId');
    if (args.background ? value.accepted !== true : !nonempty(value.text)) invalid('缺少聊天接受标识或实际回复');
  } else if (path === 'assistant.execute') {
    if (!nonempty(value?.chatId) || !['success', 'failure'].includes(value.status)) invalid('执行结果缺少 Chat 或状态');
    if (value.status === 'success' ? !Object.hasOwn(value, 'output') : !nonempty(value.reason)) invalid('执行结果缺少 output 或失败原因');
  } else if (['connector.list', 'skill.list', 'artifact.list', 'kanban.boards.list', 'kanban.issues.list'].includes(path)) {
    if (!Array.isArray(value?.items)) invalid('缺少 items 数组，不能假定为空列表');
    const key = path === 'connector.list' ? 'connectorId' : path === 'skill.list' ? 'skillId' : path === 'artifact.list' ? 'artifactId' : 'id';
    if (value.items.some(item => !nonempty(item?.[key]))) invalid('列表条目缺少有效标识');
  } else if (path === 'artifact.get') {
    if (value?.chatId !== args.chatId || value.artifactId !== args.artifactId || (args.runId && value.runId !== args.runId) || !nonempty(value.name)) invalid('元数据与请求的 Chat / Run / 产物不一致');
  } else if (path === 'connector.describe' && value?.connectorId !== args.connectorId) invalid('连接器与请求不一致');
  else if (path === 'connector.invoke' && (value?.connectorId !== args.connectorId || value.adapter !== args.adapter || (args.adapter === 'cli' ? !Number.isInteger(value.exitCode) : args.adapter !== 'mcp' || !value.mcp || typeof value.mcp !== 'object' || Array.isArray(value.mcp)))) invalid('连接器执行回执缺少目标标识或真实退出码');
  else if (path === 'skill.describe' && value?.skillId !== args.skillId) invalid('技能与请求不一致');
  else if (path === 'kanban.issues.get' && value?.issue?.id !== args.issueId) invalid('问题与请求不一致');
  else if (path === 'artifact.read' && !Number.isSafeInteger(value?.byteLength)) invalid('没有读取到合法的文件字节数');
  else if (path === 'assistant.stop' && value?.stopped !== true) invalid('宿主没有确认已停止');
  else if (path === 'desktop.capabilities.list' && !Array.isArray(value?.capabilities)) invalid('缺少能力数组');
  else if (['auth.isAvailable', 'desktop.capabilities.has'].includes(path) && typeof value !== 'boolean') invalid('必须返回布尔值');
  else if (['desktop.theme.get', 'desktop.theme.set'].includes(path) && (!['light', 'dark', 'system'].includes(value?.themeMode) || !['light', 'dark'].includes(value?.resolvedTheme))) invalid('主题状态不合法');
  else if (['desktop.locale.get', 'desktop.locale.set'].includes(path) && !['zh-CN', 'en-US'].includes(value?.locale)) invalid('语言状态不合法');
  else if (path === 'desktop.chat.open' && (value.chatId !== args.chatId || value.status !== 'opened')) invalid('历史弹窗回执与请求 Chat 不一致');
  else if (path === 'desktop.copilot.open' && value.open !== true) invalid('宿主没有确认打开 Copilot');
  else if (path === 'desktop.copilot.close' && value.open !== false) invalid('宿主没有确认关闭 Copilot');
  else if (path === 'desktop.requestAccess' && value.status !== 'granted') invalid('未确认安装授权状态');
  else if (path === 'desktop.browser.openExternal' && value.opened !== true) invalid('宿主没有确认打开');
  else if (path === 'desktop.clipboard.writeText' && value.written !== true) invalid('宿主没有确认写入剪贴板');
  else if (path === 'desktop.notification.show' && value.shown !== true) invalid('宿主没有确认显示通知');
  else if (path === 'desktop.dialog.selectFiles' && (typeof value.canceled !== 'boolean' || !Array.isArray(value.files))) invalid('文件选择结果不合法');
  else if (['desktop.dialog.selectDirectory', 'desktop.dialog.selectSavePath'].includes(path) && (typeof value.canceled !== 'boolean' || !value.canceled && !nonempty(value.path))) invalid('未返回取消状态或用户选择的路径');
  else if (['desktop.microphone.getPermission', 'desktop.microphone.requestAccess'].includes(path) && !['granted', 'denied', 'prompt', 'restricted', 'unavailable'].includes(value.permission)) invalid('麦克风权限状态不合法');
  else if (path === 'desktop.microphone.open' && (!Array.isArray(value.tracks) || value.stopped !== true)) invalid('未取得并释放测试媒体轨道');
  else if (path === 'desktop.authenticateConnector' && !['authorized', 'cancelled', 'failed'].includes(value.status)) invalid('连接器登录没有返回有效终态');
  else if (path === 'artifact.open' && value.opened !== true) invalid('宿主没有确认预览');
  else if (path === 'artifact.saveAs' && value.saved !== true && value.cancelled !== true) invalid('宿主没有确认保存或取消');
  else if (path === 'assistant.image' && (value.requestId !== args.requestId || !Array.isArray(value.images) || !value.images.length)) invalid('图像响应缺少与本次请求对应的结果');
  else if (path === 'assistant.image.cancel' && (value.requestId !== args || typeof value.cancelled !== 'boolean')) invalid('图像取消回执与请求不一致');
  return value;
}
