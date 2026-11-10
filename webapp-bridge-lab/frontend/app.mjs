import { catalog, groups, findMethod, isReservedStub, listMethods } from './catalog.mjs';
import { buildReport } from './report.mjs';
import { runSuite, withTimeout, websocketEcho, resultStatus, errorStatus } from './suite.mjs';
import { Workflow, artifactKey, BACKEND_METHODS, WRITES, validateResult } from './workflow.mjs';

const $ = selector => document.querySelector(selector);
const labels = { idle: '待测试', running: '运行中', passed: '通过', failed: '失败', unavailable: '不可用', reserved: '预留符合预期', skipped: '跳过', blocked: '条件不足', cancelled: '已取消', manual: '需手动', observe: '待观察', 'business-failed': '业务失败' };
const modes = { read: '只读自检', after: '聊天后自检', manual: '手动 · 有副作用', reserved: '预留' };
const unavailableCodes = new Set(['bridge_unavailable', 'sdk_unavailable', 'unavailable', 'assistant_agent_unavailable', 'assistant_agent_unsupported',
  'desktop_identity_required', 'assistant_execute_unavailable',
  'kanban_unavailable', 'service_unavailable', 'app_grant_required', 'connector_auth_required', 'connector_auth_expired', 'permission_denied', 'auth_fixture_unconfigured']);
const state = { sdk: null, records: new Map(), cards: new Map(), results: {}, info: null, batch: false, batchController: null, suite: null,
  contexts: { page: {}, backend: {} }, subscriptions: new Map(), controllers: new Map(), events: [], backendResults: {}, websocket: null,
  workflow: new Workflow(), workflowBusy: false, artifactBusy: false, modelCall: null, reads: new Map(), resources: { page: {}, backend: {} }, descriptions: { page: new Map(), backend: new Map() }, imageRequestId: '' };
const modelMethods = new Set(['assistant.chat', 'assistant.execute', 'assistant.image']);
const readKey = args => JSON.stringify([args.chatId, args.runId, args.artifactId]);
function printable(value) { return JSON.stringify(value, (key, entry) => entry?.encoding === 'utf-8' && typeof entry.text === 'string' && entry.text.length > 8192 ? { ...entry, text: entry.text.slice(0, 8192), displayTruncated: true } : entry, 2) ?? String(value); }
function errorObject(error, action) { return { code: error.code || (error.name === 'AbortError' ? 'cancelled' : 'lab_error'), action: error.action || action,
  message: error.message || String(error), ...(error.details === undefined ? {} : { details: error.details }) }; }
function localError(code, message) { return Object.assign(Error(message), { code }); }
const recovery = {
  assistant_agent_unavailable: '所选智能体不存在或服务不可用。请在 Desktop → 设置 → 网页应用 → Bridge Lab → 测试 Agent 中重新选择，并检查 Agent Platform 是否运行。',
  assistant_agent_unsupported: '当前智能体不支持结构化执行。请在 Desktop → 设置 → 网页应用 → Bridge Lab → 测试 Agent 中选择带 result_submit 工具的 Native Agent。',
  assistant_execute_unavailable: '当前宿主没有执行通道，请升级并重启 Desktop。',
  assistant_failed: '智能体调用失败，请检查 Desktop 对话诊断、模型配置及包内声明的技能是否存在。',
  manual_only: '后端调用尚未启用，请勾选当前区域的「允许本次手动后端调用产生副作用」。',
  desktop_identity_required: '本地 Agent Platform 服务或应用身份不可用，请检查内置服务状态。',
  connector_auth_required: '请先使用 desktop.authenticateConnector 登录该连接器，再手动重试。',
  connector_auth_expired: '连接器登录已过期，请重新登录后手动重试。',
  not_implemented: '这是宿主预留接口，目前不能执行业务。',
  auth_fixture_unconfigured: '测试后端尚未配置验签和会话交换，此包不能完成 SSO 登录。',
  event_cursor_expired: '事件游标已过期，不能恢复全部事件。请核对已有 run 状态，不要重新发送任务。',
  app_grant_required: '应用实例、身份或 Chat 归属已失效，请刷新应用；旧实例的 Chat 无法恢复访问。',
  webapp_ui_unavailable: '请在 Desktop 主工作区打开并选中本应用；后台页面和独立窗口不能打开历史弹窗或控制 Copilot。',
  copilot_disabled: '当前页面禁用了 Copilot，请在宿主允许的页面测试。',
  approval_required: '此任务需要审批，而 execute 不提供审批界面。请调整任务或改用 Desktop 对话处理。'
};
function failure(error, action) {
  const detail = errorObject(error, action);
  if (recovery[detail.code]) detail.suggestion = recovery[detail.code];
  if (action.startsWith('skill.') && state.results['desktop.capabilities.list']?.capabilities?.some(item => item.id === 'skill.read' && item.declared === false)) detail.suggestion = '当前运行的宿主仍报告 skill.read 未开放。请重启使用本次构建产物的 Desktop，再加载技能；仅更新网页 ZIP 不会更新宿主查询逻辑。';
  return detail;
}
function record(id, status, extra = {}) {
  const entry = { ...(status === 'running' ? {} : state.records.get(id)), id, status, ...extra, at: new Date().toISOString() };
  if ('result' in extra) delete entry.error;
  if ('error' in extra) delete entry.result;
  if (!('result' in extra) && !('error' in extra) && ['running', 'skipped', 'unavailable'].includes(status)) { delete entry.result; delete entry.error; }
  state.records.set(id, entry);
  const path = id.startsWith('backend.') ? id.slice(8) : id;
  const view = defaultChannel(path) === (id.startsWith('backend.') ? 'backend' : 'page') ? state.cards.get(path) : null;
  if (view) {
    view.status.dataset.status = status;
    view.status.textContent = labels[status] + (entry.ms !== undefined ? ` · ${entry.ms} ms` : '') + (entry.note ? ` · ${entry.note}` : '');
    if ('result' in extra || 'error' in extra) view.output.textContent = printable({ ...(entry.request ? { request: entry.request } : {}), ...(extra.error ? { error: extra.error } : { result: extra.result }) });
    else view.output.textContent = status === 'running' ? '正在执行…' : printable({ status, note: entry.note || labels[status] });
    view.button.disabled = status === 'running';
    if (view.cancel) view.cancel.disabled = status !== 'running';
  }
  renderSummary();
  refreshAvailability();
}
function renderSummary() {
  const entries = [...state.records.values()];
  const metrics = [['total', '检查项', entries.length], ['passed', '通过', entries.filter(x => x.status === 'passed').length],
    ['failed', '失败', entries.filter(x => ['failed', 'business-failed'].includes(x.status)).length], ['unavailable', '不可用', entries.filter(x => x.status === 'unavailable').length],
    ['reserved', '预留符合预期', entries.filter(x => x.status === 'reserved').length], ['skipped', '跳过 / 待测', entries.filter(x => ['idle', 'skipped', 'blocked', 'cancelled', 'observe', 'manual'].includes(x.status)).length]];
  $('#summary').replaceChildren(...metrics.map(([key, name, count]) => {
    const div = document.createElement('div'); div.className = 'stat'; div.dataset.status = key;
    const label = document.createElement('div'); label.className = 'stat-label'; label.textContent = name;
    const number = document.createElement('div'); number.className = 'stat-value'; number.textContent = count;
    div.append(label, number); return div;
  }));
}
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; }
function emptyOption(text) { const option = node('option', '', text); option.value = ''; return option; }
function buildUI() {
  for (const [id, title, number] of groups) {
    const link = node('a', id === 'overview' ? 'active' : ''); link.href = '#' + id;
    link.append(node('span', '', number), document.createTextNode(title)); $('#navigation').append(link);
    link.addEventListener('click', () => { $('#navigation .active')?.classList.remove('active'); link.classList.add('active'); });
    if (['overview', 'workflow', 'assistant', 'backend'].includes(id)) continue;
    const section = node('section', 'section'); section.id = id;
    const heading = node('div', 'section-heading'); const text = node('div');
    text.append(node('span', 'eyebrow', number + ' / ' + id.toUpperCase()), node('h2', '', title)); heading.append(text);
    if (id === 'artifact') { const button = node('button', '', '所选产物自检'); button.id = 'run-artifacts'; button.onclick = () => void inspectArtifact(); heading.append(button); }
    const cards = node('div', 'cards'); cards.dataset.cards = id;
    section.append(heading);
    if (['connector', 'skill', 'kanban'].includes(id)) {
      const bar = node('div', 'resource-toolbar panel'); const select = node('select'); select.id = id + '-selection'; select.setAttribute('aria-label', title + '查询结果');
      const load = node('button', '', '1 · 加载列表'); load.id = id + '-load';
      const describe = node('button', '', '2 · 读取所选详情'); describe.id = id + '-describe';
      const info = node('p', 'hint', '先读取真实列表，再选择条目。空列表是正常返回，不会编造 ID。'); info.id = id + '-readiness';
      const listPath = id === 'kanban' ? 'kanban.issues.list' : id + '.list';
      const detailPath = id === 'kanban' ? 'kanban.issues.get' : id + '.describe';
      load.onclick = () => void runDescriptor(catalog.find(def => def.path === listPath), { channel: currentChannel() });
      describe.onclick = () => void runDescriptor(catalog.find(def => def.path === detailPath), { channel: currentChannel() });
      select.onchange = () => { state.resources[currentChannel()][id] = select.value; syncResourceEditors(id, currentChannel()); updateEditors(); renderResources(); refreshAvailability(); };
      bar.append(load, select, describe, info); section.append(bar);
    }
    section.append(cards); $('#capability-sections').append(section);
  }
  for (const definition of catalog) {
    const card = node('article', 'method-card'); card.dataset.method = definition.path;
    const header = node('div', 'method-header'); header.append(node('h4', '', definition.path), node('span', 'mode-label ' + definition.mode, modes[definition.mode]));
    const editor = node('textarea', 'code-input'); editor.rows = 3; editor.value = printable(definition.args); editor.setAttribute('aria-label', definition.path + ' 参数 JSON');
    editor.addEventListener('input', () => { editor.dataset.edited = 'true'; refreshAvailability(); });
    const footer = node('div', 'method-footer'); const status = node('span', 'method-status', '待测试'); const button = node('button', '', definition.mode === 'reserved' ? '验证预留状态' : '运行 ↗');
    footer.append(status, button); const details = node('div', 'method-result'); details.append(node('h5', '', '结果 / 错误'));
    const output = node('pre', 'output', '尚未运行'); details.append(output);
    card.append(header);
    if (definition.note) card.append(node('p', 'hint', definition.note));
    card.append(editor);
    let source, mask, cancel;
    if (definition.path === 'assistant.image') {
      for (const [key, title, accept] of [['source', '源图（可选）', 'image/*'], ['mask', '蒙版（可选，PNG）', 'image/png']]) {
        const label = node('label', '', title); const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
        label.append(input); card.append(label); if (key === 'source') source = input; else mask = input;
        input.onchange = refreshAvailability;
      }
    }
    if (definition.path === 'assistant.execute') {
      cancel = node('button', 'danger', '取消'); cancel.disabled = true;
      cancel.onclick = () => state.controllers.get(defaultChannel(definition.path) === 'page' ? definition.path : 'backend.' + definition.path)?.abort(); footer.append(cancel);
    }
    const prerequisite = node('p', 'hint'); const prepare = node('button', 'text-button', '准备前置条件');
    prepare.onclick = () => void prepareFor(definition.path); footer.append(prepare);
    card.append(prerequisite, footer, details); document.querySelector(`[data-cards="${definition.group}"]`).append(card);
    state.cards.set(definition.path, { card, editor, status, button, details, output, source, mask, cancel, prerequisite, prepare });
    state.records.set(definition.path, { id: definition.path, status: 'idle' });
    button.onclick = () => void runDescriptor(definition, { manual: true });
  }
  const backendPaths = [...BACKEND_METHODS];
  for (const name of backendPaths) { const option = node('option', '', name); option.value = name; $('#backend-action').append(option); }
  $('#backend-action').onchange = () => { delete $('#backend-args').dataset.edited; updateEditors('backend'); refreshAvailability(); };
  $('#backend-args').oninput = () => { $('#backend-args').dataset.edited = 'true'; refreshAvailability(); };
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) { $('#navigation .active')?.classList.remove('active'); $(`#navigation a[href="#${visible.target.id}"]`)?.classList.add('active'); }
  }, { rootMargin: '-5% 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('section[id]').forEach(section => observer.observe(section));
  renderSummary();
  renderWorkflow();
}

function currentChannel() { return $('#agent-channel').value; }
function defaultChannel(path) { return path.startsWith('desktop.') || path.startsWith('auth.') || catalog.find(def => def.path === path)?.mode === 'reserved' ? 'page' : currentChannel(); }
function methodArgs(def, channel) {
  const view = state.cards.get(def.path);
  return view.editor.dataset.edited ? JSON.parse(view.editor.value) : autoArgs(def, channel).args;
}
function blockReason(path, args, channel = 'page') {
  if (channel === 'page' && !findMethod(state.sdk, path)) return '当前环境没有此 SDK 方法，请在 Desktop 中打开安装后的应用。';
  if (channel === 'backend' && !BACKEND_METHODS.has(path)) return '此方法没有后端实现，请使用前端入口。';
  if (channel === 'backend' && WRITES.has(path) && !$('#backend-writes').checked) return '请先勾选「允许本次手动后端调用产生副作用」。';
  if (modelMethods.has(path) && (state.modelCall || [...state.workflow.chats.values()].some(chat => chat.kind === 'background' && chat.status === 'running'))) return '本应用已有正在执行的模型任务，请等待结束；后台任务可先续订查看结果或显式停止，再开始下一项。';
  if (path === 'desktop.chat.open' && (typeof args?.chatId !== 'string' || !args.chatId.trim())) return '请先通过聊天或 execute 取得 Chat ID，或填写真实的历史 Chat ID。';
  if (path === 'auth.createSession') return '此测试后端尚未配置验签和会话交换，不能完成登录。可先检测 auth.isAvailable；需要成功登录时须配置真实验签服务。';
  if (path === 'desktop.requestAccess' && !['kanban.read', 'connector.execute'].includes(args?.capability)) return '此兼容接口只接受 kanban.read 或 connector.execute，其他能力无需通过它申请。';
  if (path === 'assistant.image') {
    const view = state.cards.get(path), source = args?.source || view?.source?.files[0], mask = args?.mask || view?.mask?.files[0];
    if (args?.operation !== 'generate' && !source) return '此图像操作需要先选择源图。';
    if (mask && !source) return '蒙版必须配合源图使用。';
    if (['inpaint', 'removeObject', 'repairSelection'].includes(args?.operation) && !mask) return '局部图像操作需要先选择 PNG 蒙版。';
    if (mask && mask.type !== 'image/png') return '蒙版必须是 PNG 文件。';
    if (!Number.isInteger(args?.width) || !Number.isInteger(args?.height) || args.width < 64 || args.height < 64 || args.width > 16384 || args.height > 16384 || args.width * args.height > 100000000 || args.width % 16 || args.height % 16) return '图片宽高需在 64–16384 之间、均为 16 的倍数，总像素不超过 1 亿。';
  }
  try {
    if (path.startsWith('artifact.')) {
      if (!args?.chatId) return '请先发起聊天，在关联流程中选择真实返回的 Chat。';
      state.workflow.chat(args?.chatId);
      if (path !== 'artifact.list') state.workflow.checkArtifactArgs(args);
      if (path === 'artifact.read' && state.workflow.chat(args.chatId).items.find(item => item.artifactId === args.artifactId && (!args.runId || item.runId === args.runId))?.sizeBytes > 1048576) return '文件超过本测试页的 1 MiB 读取上限，请使用前端预览或另存为。';
    }
    if (['assistant.subscribe', 'assistant.stop', 'assistant.interrupt', 'assistant.steer', 'assistant.send', 'assistant.submit'].includes(path)) {
      const run = [...state.workflow.chats.values()].find(chat => chat.kind === 'background' && chat.runId === args?.runId && chat.status !== 'expired');
      if (!run) return '请先点击「后台聊天」或「生成测试产物」，同步聊天的 runId 不能用于后台运行控制。';
      if (path === 'assistant.stop' && run.status !== 'running') return '此后台 Run 已结束，无需再次停止；可创建新的后台聊天测试停止。';
    }
  } catch (error) { return error.message; }
  const cache = channel === 'page' ? state.results : state.backendResults;
  const relation = path.startsWith('connector.') || path === 'desktop.authenticateConnector' ? ['connector.list', 'connectorId'] : path === 'skill.describe' ? ['skill.list', 'skillId'] : path === 'kanban.issues.get' ? ['kanban.issues.list', 'issueId'] : null;
  if (relation && path !== relation[0]) {
    const [list, key] = relation;
    if (!cache[list]) return '请先点击「加载列表」，从宿主返回的条目选择目标。';
    if (!cache[list].items.some(item => (item[key] || item.id) === args?.[key])) return '当前列表为空或所选 ID 不属于这次查询，请重新加载并选择真实条目。';
  }
  if (path === 'connector.invoke') {
    const description = state.descriptions[channel].get(args?.connectorId);
    if (!description) return '请先读取所选连接器详情，核对其 CLI / MCP 能力，再编辑调用参数。';
    if (!description.adapters?.includes(args.adapter)) return '所选连接器不支持此 adapter，请按详情中的 adapters 编辑请求。';
    if (args.adapter === 'cli' && (!Array.isArray(args.args) || args.args.some(value => typeof value !== 'string') || ['component', 'toolName', 'arguments'].some(key => key in args))) return 'CLI 仅使用字符串数组 args，不混入 MCP 的 component / toolName / arguments。';
    if (args.adapter === 'mcp' && (!description.components?.includes(args.component) || !args.toolName || !args.arguments)) return '请使用详情中实际存在的 MCP component，并填写 toolName 与 arguments。';
  }
  if (path === 'assistant.image.cancel' && (!state.imageRequestId || args !== state.imageRequestId)) return '请先发起图像生成，取消只对当前尚未完成的请求有效。';
  return '';
}
function refreshAvailability() {
  for (const def of catalog) {
    const view = state.cards.get(def.path); if (!view) continue;
    const channel = defaultChannel(def.path), id = channel === 'page' ? def.path : 'backend.' + def.path;
    let reason = ''; try { reason = blockReason(def.path, methodArgs(def, channel), channel); } catch { reason = '参数不是合法 JSON，请先修正。'; }
    view.prerequisite.textContent = reason || (def.mode === 'reserved' ? '该按钮只检测预留状态，不执行业务。' : `前置条件已满足 · ${channel === 'page' ? '前端 SDK' : '后端 SDK'}`);
    view.prepare.hidden = !reason || def.mode === 'reserved';
    view.button.disabled = state.batch || !!reason || state.records.get(id)?.status === 'running';
  }
  $('#stop-tests').disabled = !state.batchController;
  const action = $('#backend-action').value;
  try { const reason = blockReason(action, JSON.parse($('#backend-args').value), 'backend'); $('#backend-readiness').textContent = reason || '前置条件已满足，使用真实查询结果调用。'; $('#backend-call').disabled = state.batch || !!reason || state.controllers.has('backend-call'); }
  catch { $('#backend-readiness').textContent = '请修正参数 JSON。'; $('#backend-call').disabled = true; }
  for (const group of ['connector', 'skill', 'kanban']) {
    const list = group === 'kanban' ? 'kanban.issues.list' : group + '.list', channel = currentChannel();
    const loading = state.records.get(channel === 'page' ? list : 'backend.' + list)?.status === 'running';
    $('#' + group + '-load').disabled = state.batch || loading || !!blockReason(list, {}, channel);
    $('#' + group + '-load').textContent = loading ? '加载中…' : '1 · 加载列表';
  }
  for (const id of ['chat-sync', 'chat-background', 'execute-run', 'prepare-artifacts']) {
    const path = id === 'execute-run' ? 'assistant.execute' : 'assistant.chat';
    const busy = id === 'execute-run' ? state.controllers.has('execute') : state.records.get('chat.' + currentChannel())?.status === 'running';
    $('#' + id).disabled = state.batch || !!blockReason(path, {}, currentChannel()) || busy || state.workflowBusy;
  }
  const context = state.contexts[currentChannel()];
  $('#subscribe-run').disabled = !!blockReason('assistant.subscribe', { runId: context.runId }, currentChannel());
  $('#stop-run').disabled = !!blockReason('assistant.stop', { runId: context.runId }, currentChannel());
  $('#abort-subscription').disabled = !state.subscriptions.has(currentChannel());
  $('#workflow-unsubscribe').disabled = !state.workflowBusy || !state.subscriptions.has(currentChannel());
  $('#execute-cancel').disabled = !state.controllers.has('execute');
  for (const id of ['chat-history', 'execute-history']) { const path = id === 'chat-history' ? 'assistant.chat' : 'assistant.execute'; const cache = currentChannel() === 'page' ? state.results : state.backendResults; $('#' + id).disabled = state.batch || !cache[path]?.chatId || !findMethod(state.sdk, 'desktop.chat.open'); }
  if (state.batch) for (const id of ['connector-describe', 'skill-describe', 'kanban-describe', 'artifact-inspect', 'artifact-preview', 'artifact-save', 'artifact-to-execute', 'run-artifacts', 'refresh-artifacts', 'more-artifacts', 'agent-channel']) $('#' + id).disabled = true;
  else $('#agent-channel').disabled = state.workflowBusy;
  const socket = state.websocket;
  $('#ws-send').disabled = socket?.readyState !== WebSocket.OPEN;
  $('#ws-close').disabled = !socket || socket.readyState >= WebSocket.CLOSING;
  $('#ws-connect').disabled = !!socket && socket.readyState < WebSocket.CLOSING;
}
function renderResources() {
  const channel = currentChannel(), cache = channel === 'page' ? state.results : state.backendResults;
  for (const group of ['connector', 'skill', 'kanban']) {
    const list = group === 'kanban' ? 'kanban.issues.list' : group + '.list';
    const detail = group === 'kanban' ? 'kanban.issues.get' : group + '.describe';
    const items = cache[list]?.items || [], key = group === 'connector' ? 'connectorId' : group === 'skill' ? 'skillId' : 'id';
    if (!items.some(item => item[key] === state.resources[channel][group])) state.resources[channel][group] = items[0]?.[key] || '';
    const select = $('#' + group + '-selection');
    select.replaceChildren(...(items.length ? items.map(item => { const option = node('option', '', `${item.name || item.title || item[key]} · ${item[key]}`); option.value = item[key]; return option; }) : [emptyOption(cache[list] ? '列表为空' : '尚未读取') ]));
    select.value = state.resources[channel][group]; select.disabled = !items.length;
    const reason = blockReason(detail, autoArgs(catalog.find(def => def.path === detail), channel).args, channel);
    $('#' + group + '-describe').disabled = !!reason;
    $('#' + group + '-readiness').textContent = reason || `已选择 ${state.resources[channel][group]}，ID 已带入 ${detail} · ${channel === 'page' ? '前端' : '后端'}通道；${items.length} 项`;
  }
}
function syncResourceEditors(group, channel) {
  const key = group === 'connector' ? 'connectorId' : group === 'skill' ? 'skillId' : 'issueId';
  const paths = group === 'connector' ? ['connector.describe', 'connector.invoke', 'desktop.authenticateConnector'] : group === 'skill' ? ['skill.describe'] : ['kanban.issues.get'];
  const selected = state.resources[channel][group] || '';
  for (const path of paths) {
    if (defaultChannel(path) !== channel) continue;
    const editor = state.cards.get(path)?.editor;
    if (editor) { try { const args = JSON.parse(editor.value); if (args && typeof args === 'object' && !Array.isArray(args)) editor.value = printable({ ...args, [key]: selected }); } catch { /* Keep invalid JSON visible for correction. */ } }
  }
  if (channel === 'backend' && paths.includes($('#backend-action').value)) {
    try { const args = JSON.parse($('#backend-args').value); if (args && typeof args === 'object' && !Array.isArray(args)) $('#backend-args').value = printable({ ...args, [key]: selected }); } catch { /* Keep the user's invalid JSON visible. */ }
  }
}
async function prepareFor(path) {
  const channel = defaultChannel(path);
  if (path.startsWith('artifact.')) {
    if (!state.workflow.selectedChatId) { $('#workflow').scrollIntoView({ behavior: 'smooth' }); $('#prepare-artifacts').focus(); return; }
    await loadArtifacts(); return;
  }
  const list = path.startsWith('connector.') || path === 'desktop.authenticateConnector' ? 'connector.list' : path.startsWith('skill.') ? 'skill.list' : path.startsWith('kanban.') ? 'kanban.issues.list' : null;
  if (list) {
    await runDescriptor(catalog.find(def => def.path === list), { channel });
    if (path === 'connector.invoke') await runDescriptor(catalog.find(def => def.path === 'connector.describe'), { channel });
    return;
  }
  $(path.startsWith('assistant.') ? '#assistant' : '#overview').scrollIntoView({ behavior: 'smooth' });
}
function artifactExecuteDraft() {
  const source = state.workflow.artifactArgs(), evidence = state.reads.get(readKey(source));
  if (!evidence || evidence.revision !== state.workflow.chat(source.chatId).revision || evidence.complete !== true || evidence.encoding !== 'utf-8' || typeof evidence.text !== 'string' || evidence.text.includes('\0') || new TextEncoder().encode(evidence.text).length !== evidence.byteLength) throw localError('complete_text_required', '请先完整读取当前清单中的 UTF-8 文本。');
  const args = { message: '从 input.text 的实际内容提取总金额。使用 result_submit 提交符合 outputSchema 的结果；无法确定时提交 failure，不能编造金额。', input: { source, text: evidence.text }, outputSchema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'], additionalProperties: false } };
  if (new TextEncoder().encode(JSON.stringify({ action: 'assistant.execute', args })).length > (currentChannel() === 'page' ? 65536 : 262144)) throw localError('execute_input_too_large', '完整文本超过当前通道请求上限，请选择更小产物；不会截断正文。');
  return args;
}
function renderWorkflow() {
  const workflow = state.workflow, select = $('#artifact-chat'), chats = [...workflow.chats.values()].filter(chat => chat.status !== 'expired');
  select.replaceChildren(...(chats.length ? chats.map(chat => { const option = node('option', '', `${chat.title} · ${chat.chatId} · ${chat.status}`); option.value = chat.chatId; return option; }) : [emptyOption('请先生成测试产物，或通过本应用发起聊天')]));
  select.value = workflow.selectedChatId; select.disabled = !chats.length || state.workflowBusy || state.artifactBusy;
  const chat = workflow.chats.get(workflow.selectedChatId), items = chat?.items || [];
  $('#artifact-choice').replaceChildren(...(items.length ? items.map(item => { const option = node('option', '', `${item.name} · ${item.runId}`); option.value = artifactKey(item); return option; }) : [emptyOption(chat?.loaded ? '尚无已发布文件' : '先刷新产物列表')]));
  $('#artifact-choice').value = chat?.selectedArtifact || ''; $('#artifact-choice').disabled = !items.length || state.artifactBusy;
  let args; try { args = workflow.artifactArgs(); } catch { args = null; }
  $('#artifact-context').textContent = args ? `chatId ${args.chatId}\nrunId ${args.runId}\nartifactId ${args.artifactId}` : chat ? `chatId ${chat.chatId} · ${chat.status}` : '尚无本应用返回的 Chat ID';
  $('#artifact-readiness').textContent = !chat ? '先完成第一步，不能使用示例或其他 Chat 的 ID。' : chat.status === 'expired' ? '此 Chat 的宿主授权已失效，请重新生成。' : !chat.loaded ? '下一步：刷新所选 Chat 的发布清单。execute 输出或聊天文本不是产物清单。' : !items.length ? '查询成功但尚无已发布文件。普通回复和结构化 output 不保证有文件；请生成测试产物，或确认 Agent 具备 artifact_publish。' : `已从清单读取 ${items.length} 个真实文件。可验证内容、预览或另存为。`;
  $('#refresh-artifacts').disabled = !chat || chat.status === 'expired' || state.artifactBusy || state.workflowBusy;
  $('#more-artifacts').disabled = !chat?.nextCursor || state.artifactBusy || state.workflowBusy;
  for (const id of ['artifact-inspect', 'artifact-preview', 'artifact-save', 'run-artifacts']) if ($('#' + id)) $('#' + id).disabled = !args || state.artifactBusy || state.workflowBusy;
  const evidence = args && state.reads.get(readKey(args));
  try { artifactExecuteDraft(); $('#artifact-to-execute').disabled = state.artifactBusy || state.workflowBusy; $('#artifact-to-execute').title = ''; } catch (error) { $('#artifact-to-execute').disabled = true; $('#artifact-to-execute').title = error.message; }
}
function autoArgs(def, channel = 'page') {
  const args = structuredClone(def.args);
  const cache = channel === 'page' ? state.results : state.backendResults;
  const context = state.contexts[channel];
  const first = path => cache[path]?.items?.[0];
  if (args && typeof args === 'object') {
    if ('connectorId' in args) args.connectorId = state.resources[channel].connector || first('connector.list')?.connectorId || '';
    if ('skillId' in args) args.skillId = state.resources[channel].skill || first('skill.list')?.skillId || '';
    if ('issueId' in args) args.issueId = state.resources[channel].kanban || first('kanban.issues.list')?.id || '';
    if ('chatId' in args) args.chatId = state.workflow.selectedChatId;
    if ('runId' in args) args.runId = context.runId || '';
    if ('artifactId' in args) { try { Object.assign(args, state.workflow.artifactArgs()); } catch { args.artifactId = ''; delete args.runId; } }
    if (def.path === 'assistant.resource.read' && cache['assistant.upload']) { args.chatId = cache['assistant.upload'].chatId; args.file = cache['assistant.upload'].upload.name; }
    if (def.path === 'assistant.chat' && cache['assistant.upload']) { args.chatId = cache['assistant.upload'].chatId; args.uploadIds = [cache['assistant.upload'].upload.id]; }
    if (def.path === 'assistant.image' && !args.requestId) args.requestId = 'bridge-lab-' + crypto.randomUUID();
  }
  if (def.path === 'assistant.image.cancel') return { args: state.imageRequestId, missing: state.imageRequestId ? null : '正在运行的图像请求' };
  const missing = args && typeof args === 'object' && Object.entries(args).find(([key, value]) => ['connectorId', 'skillId', 'issueId', 'chatId', 'artifactId', 'runId'].includes(key) && !value);
  return { args, missing: missing ? missing[0] : null };
}
function updateEditors(channel = 'page') {
  for (const def of catalog) {
    const view = state.cards.get(def.path);
    if (!view.editor.dataset.edited) view.editor.value = printable(autoArgs(def, defaultChannel(def.path)).args);
  }
  const def = catalog.find(def => def.path === $('#backend-action').value);
  if (def && !$('#backend-args').dataset.edited) $('#backend-args').value = printable(autoArgs(def, 'backend').args);
}
function applyResult(path, value, channel = 'page', args = {}, ticket) {
  const cache = channel === 'page' ? state.results : state.backendResults;
  if (path === 'artifact.list') state.workflow.acceptList(ticket, value);
  if (path === 'artifact.read') { state.workflow.assertCurrent(ticket); state.reads.set(readKey(args), { ...value, revision: ticket.revision }); }
  cache[path] = value;
  if (path === 'assistant.upload') {
    state.workflow.remember(value, { channel, kind: 'upload' });
    state.contexts[channel].chatId = value.chatId;
    updateIdentity();
  }
  if (path === 'assistant.chat' || path === 'assistant.execute') {
    state.workflow.remember(value, { channel, kind: path === 'assistant.execute' ? 'execute' : value.accepted ? 'background' : 'chat' });
    if (path === 'assistant.chat') {
      state.contexts[channel].chatId = value.chatId;
      if (value.accepted) Object.assign(state.contexts[channel], { backgroundChatId: value.chatId, runId: value.runId, cursor: 0 });
    }
    updateIdentity();
  }
  if (path === 'connector.describe') state.descriptions[channel].set(args.connectorId, value);
  if (path === 'assistant.stop') {
    const chat = [...state.workflow.chats.values()].find(chat => chat.runId === args.runId && chat.kind === 'background');
    if (chat) chat.status = 'stopping';
  }
  if (channel === 'page') {
    if (path === 'desktop.capabilities.list') $('#version-meta').textContent = 'BRIDGE v' + (value?.bridgeVersion ?? '?');
    if (['desktop.theme.get', 'desktop.theme.set'].includes(path)) {
      const theme = value?.resolvedTheme;
      if (['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
      $('#theme-meta').textContent = '主题 ' + (value?.themeMode ?? '—');
    }
    if (['desktop.locale.get', 'desktop.locale.set'].includes(path)) $('#locale-meta').textContent = '语言 ' + (value?.locale ?? '—');
    if (path === 'skill.list' && currentChannel() === 'page') renderSkills(value?.items || []);
  } else if (path === 'skill.list' && currentChannel() === 'backend') renderSkills(value?.items || []);
  renderResources();
  if (path === 'connector.list') syncResourceEditors('connector', channel);
  if (path === 'skill.list') syncResourceEditors('skill', channel);
  if (path === 'kanban.issues.list') syncResourceEditors('kanban', channel);
  updateEditors(channel); renderWorkflow(); refreshAvailability();
}
async function normalize(value, signal) {
  if (value instanceof ReadableStream) {
    const reader = value.getReader(); const chunks = []; let byteLength = 0;
    const abort = () => { void reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', abort, { once: true });
    try {
      while (true) { signal?.throwIfAborted(); const next = await reader.read(); if (next.done) break; byteLength += next.value.byteLength;
        if (byteLength > 1048576) throw localError('artifact_too_large', '产物超过 1 MiB'); chunks.push(next.value); }
      signal?.throwIfAborted();
    } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(byteLength); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const preview = bytes.subarray(0, 8192);
    const meta = { byteLength, previewBytes: preview.length };
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw Error('binary'); return { ...meta, encoding: 'utf-8', text, complete: true, previewText: new TextDecoder().decode(preview) }; }
    catch { return { ...meta, encoding: 'base64', base64: btoa(String.fromCharCode(...preview)) }; }
  }
  if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) {
    const tracks = value.getTracks();
    try { return { tracks: tracks.map(track => ({ kind: track.kind, label: track.label })), stopped: true }; }
    finally { tracks.forEach(track => track.stop()); }
  }
  return value ?? null;
}
function validateExecute(input) {
  if (!input || typeof input.message !== 'string' || !input.message.trim()) throw localError('invalid_args', '请输入任务说明');
  if (!input.outputSchema || Array.isArray(input.outputSchema) || input.outputSchema.type !== 'object') throw localError('invalid_args', 'outputSchema 根类型必须为 object');
  if (new TextEncoder().encode(JSON.stringify(input.outputSchema)).length > 65536) throw localError('invalid_args', 'outputSchema 超过 64 KiB');
  return input;
}
async function invokePage(path, args, { signal } = {}) {
  const method = findMethod(state.sdk, path);
  if (!method) throw localError('sdk_unavailable', 'SDK 未提供 ' + path);
  if (path === 'assistant.upload') { const { text, ...input } = args; if (typeof text !== 'string') throw localError('invalid_args', '请输入上传文本 text'); return method({ ...input, file: new Blob([text], { type: 'text/plain' }) }, { signal }); }
  if (path === 'assistant.execute') return method(validateExecute(args), { signal });
  return normalize(await method(args, { signal }), signal);
}
async function api(endpoint, input, signal) {
  const response = await fetch(endpoint, { method: input === undefined ? 'GET' : 'POST', signal, credentials: 'omit', redirect: 'error',
    headers: { 'X-Bridge-Lab': '1', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(Error(payload.error?.message || 'Backend request failed'), payload.error);
  return payload;
}
async function invokeBackend(action, args, { signal, readonly = false } = {}) {
  const allowSideEffects = !readonly && $('#backend-writes').checked;
  const payload = await api('/api/backend-call', { action, args, allowSideEffects }, signal);
  return payload.result;
}
async function callChannel(channel, path, args, options) {
  const reason = blockReason(path, args, channel);
  if (reason) throw localError('prerequisite_required', reason);
  const ticket = path === 'artifact.list' ? state.workflow.beginList(args) : path === 'artifact.read' ? { chatId: args.chatId, revision: state.workflow.chat(args.chatId).revision } : undefined;
  if (path === 'artifact.list' && args.cursor === undefined) for (const key of state.reads.keys()) if (JSON.parse(key)[0] === args.chatId) state.reads.delete(key);
  if (ticket) { updateEditors(); renderWorkflow(); refreshAvailability(); }
  const group = path === 'connector.list' ? 'connector' : path === 'skill.list' ? 'skill' : path === 'kanban.issues.list' ? 'kanban' : '';
  if (group) {
    delete (channel === 'page' ? state.results : state.backendResults)[path]; state.resources[channel][group] = '';
    if (group === 'connector') state.descriptions[channel].clear();
    renderResources(); updateEditors(); refreshAvailability();
  }
  try {
    if (modelMethods.has(path)) { state.modelCall = { path, channel }; refreshAvailability(); }
    const value = await (channel === 'page' ? invokePage(path, args, options) : invokeBackend(path, args, options));
    options?.signal?.throwIfAborted();
    validateResult(path, value, args);
    applyResult(path, value, channel, args, ticket); return value;
  } catch (error) {
    if (args?.chatId && ['app_grant_required', 'chat_access_denied'].includes(error.code)) state.workflow.expire(args.chatId);
    renderWorkflow(); refreshAvailability(); throw error;
  } finally {
    if (modelMethods.has(path)) { state.modelCall = null; refreshAvailability(); }
  }
}
async function runDescriptor(def, { manual = false, batch = false, channel = defaultChannel(def.path) } = {}) {
  const id = channel === 'page' ? def.path : 'backend.' + def.path;
  if (state.records.get(id)?.status === 'running' || state.batch && !batch) return;
  const view = state.cards.get(def.path);
  if (channel === 'page' && !findMethod(state.sdk, def.path)) { record(id, 'unavailable', { note: 'SDK 未提供' }); return; }
  if (batch && def.mode === 'reserved' && !isReservedStub(state.sdk, def.path)) {
    record(id, 'skipped', { note: '预留状态已变化，请手动验证' }); return;
  }
  let args;
  try {
    if (manual && view.editor.dataset.edited) args = JSON.parse(view.editor.value);
    else { const resolved = autoArgs(def, channel); if (resolved.missing) { record(id, 'skipped', { note: '缺少 ' + resolved.missing }); return; } args = resolved.args; }
    if (def.path === 'assistant.image') {
      if (view.source.files[0]) args.source = view.source.files[0];
      if (view.mask.files[0]) args.mask = view.mask.files[0];
    }
    const reason = blockReason(def.path, args, channel);
    if (reason) { record(id, 'skipped', { note: reason }); return; }
  } catch (error) { record(id, 'failed', { error: errorObject(error, def.path), ms: 0 }); return; }
  const start = performance.now(); record(id, 'running', { note: '', request: args, channel });
  const controller = new AbortController(); state.controllers.set(id, controller);
  try {
    if (def.path === 'assistant.subscribe') {
      state.contexts[channel].runId = args.runId; state.contexts[channel].cursor = args.cursor || 0;
      await subscribe(channel); return;
    }
    if (def.path === 'assistant.image') { state.imageRequestId = args.requestId; updateEditors(); refreshAvailability(); }
    const value = batch ? await withTimeout(signal => callChannel(channel, def.path, args, { signal, readonly: true }), state.batchController?.signal) : await callChannel(channel, def.path, args, { signal: controller.signal });
    const status = resultStatus(def.path, value);
    record(id, status, { ms: Math.round(performance.now() - start), result: value });
    if (manual && def.path === 'assistant.chat') {
      $('#chat-text').textContent = value.text || '后台 run 已接受，等待订阅。'; if (value.accepted) void subscribe(channel);
    }
    if (manual && ['desktop.theme.set', 'desktop.locale.set'].includes(def.path)) {
      const getter = def.path.replace('.set', '.get');
      await runDescriptor(catalog.find(x => x.path === getter));
    }
    return value;
  } catch (error) { record(id, ['stale_result', 'prerequisite_required'].includes(error.code) ? 'skipped' : error.code === 'not_implemented' && def.mode === 'reserved' ? 'reserved' : errorStatus(error) === 'cancelled' ? 'cancelled' : unavailableCodes.has(error.code) ? 'unavailable' : 'failed',
    { ms: Math.round(performance.now() - start), error: failure(error, def.path) }); }
  finally { if (state.controllers.get(id) === controller) state.controllers.delete(id); if (def.path === 'assistant.image') state.imageRequestId = ''; refreshAvailability(); }
}
async function runBatch(mode = 'read', channel = 'page') {
  if (state.batch) return;
  state.batchController = new AbortController();
  state.batch = true; refreshAvailability(); $('#run-page').disabled = true; $('#run-all').disabled = true; $('#backend-read-check').disabled = true; $('#run-artifacts').disabled = true;
  try {
    const selected = catalog.filter(def => mode === 'after' ? def.mode === 'after' : def.mode === 'read' || channel === 'page' && def.mode === 'reserved');
    for (const def of selected) {
      if (state.batchController.signal.aborted) { for (const pending of selected.slice(selected.indexOf(def))) record(channel === 'page' ? pending.path : 'backend.' + pending.path, 'cancelled', { note: '测试停止，此项未调用' }); break; }
      if (channel === 'backend' && (def.path.startsWith('desktop.') || def.path.startsWith('auth.'))) continue;
      await runDescriptor(def, { batch: true, channel });
    }
    if (channel === 'backend') $('#backend-result').textContent = printable([...state.records.values()].filter(entry => entry.id.startsWith('backend.')));
    if (mode === 'read' && channel === 'page') for (const def of catalog.filter(x => x.mode === 'manual')) {
      if (state.records.get(def.path).status === 'idle') record(def.path, 'skipped', { note: '需要手动点击' });
    }
    $('#last-check').textContent = '最近自检 ' + new Date().toLocaleTimeString();
  } finally { state.batchController = null; state.batch = false; $('#run-page').disabled = false; $('#run-all').disabled = false; $('#backend-read-check').disabled = false; renderWorkflow(); refreshAvailability(); }
}

function renderSkills(items) {
  const selected = new Set([...$('#chat-skills').selectedOptions].map(option => option.value));
  const attachable = new Set((state.info?.copilot?.references || []).filter(item => item.type === 'skill').map(item => item.id));
  $('#chat-skills').replaceChildren(...items.map(item => {
    const option = node('option', '', (item.name || item.skillId) + (item.agentHasSkill ? ' · Agent 已挂载' : ' · Agent 未挂载') + (attachable.has(item.skillId) ? ' · 可附加' : ''));
    option.value = item.skillId; option.disabled = !attachable.has(item.skillId); option.selected = !option.disabled && selected.has(item.skillId); return option;
  }));
}
function updateIdentity() {
  const context = state.contexts[currentChannel()];
  $('#chat-identity').textContent = `chatId ${context.chatId || '—'} · runId ${context.runId || '—'} · cursor ${context.cursor || 0}`;
}
async function refreshAgent() {
  try {
    const values = await invokePage('desktop.app.getUserConfig', {});
    const key = values.agent || state.info?.defaultAgent || state.info?.copilot?.agentKey || 'Desktop 默认助手';
    $('#agent-status').textContent = `当前应用配置：${key}。请在 Desktop → 设置 → 网页应用 → Bridge Lab → 测试 Agent 中切换智能体，保存后重新打开应用。网页仅使用现有 SDK 读取配置。`;
  } catch (error) { $('#agent-status').textContent = printable(failure(error, 'desktop.app.getUserConfig')); }
}
async function loadArtifacts({ more = false, chatId = state.workflow.selectedChatId, channel = currentChannel() } = {}) {
  if (state.artifactBusy) return;
  const id = channel === 'page' ? 'artifact.list' : 'backend.artifact.list', start = performance.now();
  state.artifactBusy = true; renderWorkflow();
  try {
    const chat = state.workflow.chat(chatId);
    const args = { chatId, limit: 20, ...(more && chat.nextCursor ? { cursor: chat.nextCursor } : {}) };
    record(id, 'running', { request: args, channel });
    $('#artifact-result').textContent = '正在读取发布清单…';
    const result = await callChannel(channel, 'artifact.list', args);
    record(id, 'passed', { result, ms: Math.round(performance.now() - start), note: result.items.length ? '' : '查询成功，尚无已发布文件' });
    $('#artifact-result').textContent = printable({ channel, request: args, result });
    return result;
  } catch (error) { const detail = failure(error, 'artifact.list'); record(id, error.code === 'prerequisite_required' ? 'skipped' : 'failed', { error: detail }); $('#artifact-result').textContent = printable(detail); }
  finally { state.artifactBusy = false; renderWorkflow(); refreshAvailability(); }
}
async function inspectArtifact(action = 'inspect') {
  if (state.artifactBusy) return;
  state.artifactBusy = true; renderWorkflow();
  const channel = action === 'inspect' ? currentChannel() : 'page';
  try {
    const args = state.workflow.artifactArgs(); const result = {};
    $('#artifact-result').textContent = '正在验证所选产物…';
    const paths = action === 'inspect' ? ['artifact.get', 'artifact.read'] : [action === 'preview' ? 'artifact.open' : 'artifact.saveAs'];
    for (const path of paths) {
      const id = channel === 'page' ? path : 'backend.' + path, start = performance.now(); record(id, 'running', { request: args, channel });
      try { result[path] = await callChannel(channel, path, args); record(id, resultStatus(path, result[path]), { result: result[path], ms: Math.round(performance.now() - start) }); }
      catch (error) { record(id, 'failed', { error: failure(error, path) }); throw error; }
    }
    $('#artifact-result').textContent = printable({ channel, request: args, result });
    return result;
  } catch (error) { $('#artifact-result').textContent = printable(failure(error, 'artifact.' + action)); }
  finally { state.artifactBusy = false; renderWorkflow(); refreshAvailability(); }
}
async function prepareArtifacts() {
  if (state.workflowBusy) return;
  const channel = currentChannel(), message = $('#artifact-prompt').value.trim();
  if (!message) { $('#workflow-result').textContent = '请填写需要实际生成并发布的文件任务。'; return; }
  state.workflowBusy = true; $('#agent-channel').disabled = true;
  renderWorkflow(); refreshAvailability();
  const id = 'workflow.prepare.' + channel, start = performance.now(); record(id, 'running');
  try {
    $('#workflow-result').textContent = '正在新建后台聊天。只有返回真实 Chat 且完成发布后，才能继续产物验收。';
    const value = await callChannel(channel, 'assistant.chat', { message, skillIds: [], background: true });
    state.workflow.chat(value.chatId).title = '产物任务'; state.workflow.selectChat(value.chatId); renderWorkflow();
    $('#workflow-result').textContent = printable({ phase: 'accepted', ...value, note: '正在等待此 Run 完成；此时尚不能认定文件已发布。' });
    const outcome = await subscribe(channel);
    const chat = state.workflow.chat(value.chatId);
    if (!outcome?.terminal || outcome.failed || outcome.aborted || chat.status !== 'completed') {
      record(id, outcome?.aborted ? 'skipped' : 'failed', { result: { ...value, outcome, status: chat.status }, note: '未确认正常完成。不会重新提交任务；可续订或只读刷新原 Chat 的产物列表。' });
      $('#workflow-result').textContent = printable(state.records.get(id)); return;
    }
    await loadArtifacts({ chatId: value.chatId, channel });
    const status = chat.loaded && chat.items.length ? 'passed' : chat.loaded ? 'skipped' : 'failed';
    record(id, status, { result: { chatId: value.chatId, runId: value.runId, publishedFiles: chat.items.length }, ms: Math.round(performance.now() - start), note: status === 'passed' ? '发布清单已验证，可进行下游测试' : '未验证到已发布文件，请核对 Agent 的文件工具与回复。' });
    $('#workflow-result').textContent = printable(state.records.get(id));
  } catch (error) { const detail = failure(error, 'assistant.chat'); record(id, 'failed', { error: detail }); $('#workflow-result').textContent = printable(detail); }
  finally { state.workflowBusy = false; $('#agent-channel').disabled = false; renderWorkflow(); refreshAvailability(); }
}
async function chat(background) {
  const channel = currentChannel(), id = 'chat.' + channel;
  if (state.records.get(id)?.status === 'running' || state.batch) return;
  state.subscriptions.get(channel)?.abort();
  const message = $('#chat-message').value.trim(); if (!message) { $('#chat-text').textContent = '请输入消息'; return; }
  const skillIds = [...$('#chat-skills').selectedOptions].map(option => option.value);
  const start = performance.now(); record(id, 'running');
  $('#chat-sync').disabled = $('#chat-background').disabled = true; $('#chat-text').textContent = '正在调用…';
  try {
    const value = await callChannel(channel, 'assistant.chat', { message, skillIds, ...(background ? { background: true } : {}) });
    $('#chat-text').textContent = background ? '' : value.text || printable(value);
    record(id, 'passed', { ms: Math.round(performance.now() - start), result: value });
    if (background) void subscribe(channel);
  } catch (error) { $('#chat-text').textContent = printable(failure(error, 'assistant.chat')); record(id, unavailableCodes.has(error.code) ? 'unavailable' : 'failed', { error: failure(error, 'assistant.chat') }); }
  finally { refreshAvailability(); }
}
function appendEvent(channel, event, run = state.contexts[channel]) {
  state.events.push({ channel, runId: run.runId, ...event }); if (state.events.length > 256) state.events.shift();
  $('#chat-events').textContent = state.events.map(item => JSON.stringify(item)).join('\n');
  if (typeof event.cursor === 'number') { run.cursor = event.cursor; if (state.contexts[channel].runId === run.runId) state.contexts[channel].cursor = event.cursor; }
  if (event.type === 'text.delta' && currentChannel() === channel) $('#chat-text').textContent = ($('#chat-text').textContent + (event.text || '')).slice(-100000);
  state.workflow.event(run.runId, event);
  updateIdentity(); renderWorkflow(); refreshAvailability();
}
async function* backendEvents(context, signal) {
  const response = await fetch('/api/backend-subscribe', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Bridge-Lab': '1' },
    body: JSON.stringify({ action: 'assistant.subscribe', args: { runId: context.runId, cursor: context.cursor || 0 }, allowSideEffects: $('#backend-writes').checked }) });
  if (!response.ok) { const payload = await response.json(); throw Object.assign(Error(payload.error?.message || '订阅失败'), payload.error); }
  if (!response.body) throw localError('invalid_response', '订阅缺少响应流');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
  try {
    while (true) {
      const next = await reader.read(); pending += decoder.decode(next.value, { stream: !next.done });
      if (pending.length > 1048576) throw localError('event_too_large', '事件超过 1 MiB');
      let end;
      while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); if (line) yield JSON.parse(line); }
      if (next.done) { if (pending.trim()) throw localError('invalid_response', '订阅事件未完整结束'); return; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function subscribe(channel = currentChannel()) {
  const context = { ...state.contexts[channel] }, id = channel === 'page' ? 'assistant.subscribe' : 'backend.assistant.subscribe';
  if (!context.runId) { record(id, 'skipped', { note: '请先发起后台聊天' }); return; }
  state.subscriptions.get(channel)?.abort();
  const controller = new AbortController(); state.subscriptions.set(channel, controller); record(id, 'running', { note: '' });
  try {
    const method = channel === 'page' ? findMethod(state.sdk, 'assistant.subscribe') : null;
    if (channel === 'page' && !method) throw localError('sdk_unavailable', 'SDK 未提供 assistant.subscribe');
    const events = channel === 'page' ? method({ runId: context.runId, cursor: context.cursor || 0 }, { signal: controller.signal }) : backendEvents(context, controller.signal);
    let failed = null, terminal = null;
    for await (const event of events) {
      if (controller.signal.aborted) break;
      if (event.ok === false) throw Object.assign(Error(event.error?.message || '后端订阅失败'), event.error);
      appendEvent(channel, event, context);
      if (['run.failed', 'subscription.failed'].includes(event.type)) failed = event;
      if (['run.finished', 'run.failed'].includes(event.type)) terminal = event.type;
    }
    if (state.subscriptions.get(channel) !== controller) return;
    record(id, controller.signal.aborted ? 'skipped' : failed ? 'failed' : terminal ? 'passed' : 'failed',
      { note: controller.signal.aborted ? '已中止订阅，run 状态未改变' : failed ? '运行或订阅失败' : terminal ? terminal : '订阅结束但未收到终态', result: failed || { cursor: context.cursor, terminal } });
    return { terminal, failed, aborted: controller.signal.aborted };
  } catch (error) {
    if (state.subscriptions.get(channel) === controller) record(id, controller.signal.aborted ? 'skipped' : unavailableCodes.has(error.code) ? 'unavailable' : 'failed',
      { note: controller.signal.aborted ? '已中止订阅，run 状态未改变' : '', error: errorObject(error, 'assistant.subscribe') });
    return { failed: true, aborted: controller.signal.aborted };
  } finally { if (state.subscriptions.get(channel) === controller) state.subscriptions.delete(channel); refreshAvailability(); }
}
async function stopRun() {
  const channel = currentChannel(), context = state.contexts[channel];
  if (!context.runId) { $('#chat-text').textContent = '请先发起后台聊天'; return; }
  try { const result = await callChannel(channel, 'assistant.stop', { runId: context.runId }); record(channel + '.stop', 'passed', { result }); appendEvent(channel, { type: 'stop.requested', result }); }
  catch (error) { record(channel + '.stop', 'failed', { error: errorObject(error, 'assistant.stop') }); appendEvent(channel, { type: 'stop.failed', error: errorObject(error, 'assistant.stop') }); }
}
function executeInput() { const input = $('#execute-input').value.trim(); return validateExecute({ message: $('#execute-message').value, ...(input ? { input: JSON.parse(input) } : {}), outputSchema: JSON.parse($('#execute-schema').value) }); }
async function execute() {
  if (state.controllers.has('execute')) return;
  const channel = currentChannel(), id = 'execute.' + channel;
  const controller = new AbortController(); state.controllers.set('execute', controller);
  $('#execute-run').disabled = true; const start = performance.now(); record(id, 'running');
  try {
    const input = executeInput(); $('#execute-result').textContent = '执行中；可点击取消。';
    const result = await callChannel(channel, 'assistant.execute', input, { signal: controller.signal });
    $('#execute-result').textContent = printable(result); record(id, result.status === 'failure' ? 'failed' : 'passed', { ms: Math.round(performance.now() - start), result });
  } catch (error) { const detail = failure(error, 'assistant.execute'); $('#execute-result').textContent = printable(detail);
    record(id, error.code === 'cancelled' || controller.signal.aborted ? 'skipped' : unavailableCodes.has(error.code) ? 'unavailable' : 'failed', { error: detail, ms: Math.round(performance.now() - start) }); }
  finally { state.controllers.delete('execute'); refreshAvailability(); }
}
async function copyRequest() {
  try {
    const text = printable({ action: 'assistant.execute', args: executeInput() });
    if (findMethod(state.sdk, 'desktop.clipboard.writeText')) await invokePage('desktop.clipboard.writeText', { text });
    else await navigator.clipboard.writeText(text);
    $('#execute-result').textContent = '请求已复制。\n' + text;
  } catch (error) { $('#execute-result').textContent = printable(errorObject(error, 'copy')); }
}

async function backendProbe(endpoint) {
  const id = 'backend.' + endpoint.split('/').at(-1), start = performance.now(); record(id, 'running');
  try { const result = await api(endpoint); $('#backend-result').textContent = printable(result); record(id, 'passed', { result, ms: Math.round(performance.now() - start) }); }
  catch (error) { $('#backend-result').textContent = printable(errorObject(error, id)); record(id, 'failed', { error: errorObject(error, id) }); }
}
async function backendCall() {
  if (state.controllers.has('backend-call')) return;
  const action = $('#backend-action').value, id = 'backend.' + action, start = performance.now();
  const controller = new AbortController(); state.controllers.set('backend-call', controller); $('#backend-call').disabled = true; record(id, 'running');
  try {
    const args = JSON.parse($('#backend-args').value);
    const reason = blockReason(action, args, 'backend'); if (reason) throw localError('prerequisite_required', reason);
    if (action === 'assistant.subscribe') { state.contexts.backend.runId = args.runId; state.contexts.backend.cursor = args.cursor || 0; await subscribe('backend'); return; }
    const result = await callChannel('backend', action, args, { signal: controller.signal });
    $('#backend-result').textContent = printable(result); record(id, resultStatus(action, result), { ms: Math.round(performance.now() - start), result });
    if (action === 'assistant.chat' && result.accepted) void subscribe('backend');
  } catch (error) { $('#backend-result').textContent = printable(errorObject(error, action));
    record(id, error.code === 'not_implemented' ? 'reserved' : controller.signal.aborted ? 'skipped' : unavailableCodes.has(error.code) ? 'unavailable' : 'failed', { error: errorObject(error, action) }); }
  finally { state.controllers.delete('backend-call'); refreshAvailability(); }
}
function wsLog(message) { const lines = ($('#ws-result').dataset.started ? $('#ws-result').textContent.split('\n') : []); lines.push(new Date().toLocaleTimeString() + ' ' + message); $('#ws-result').textContent = lines.slice(-100).join('\n'); $('#ws-result').dataset.started = 'true'; }
function wsConnect() {
  if (state.websocket && state.websocket.readyState < 2) return;
  const url = new URL('/api/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url); state.websocket = socket; $('#ws-state').textContent = '连接中'; record('backend.websocket', 'running');
  const timeout = setTimeout(() => { if (socket.readyState === WebSocket.CONNECTING) socket.close(); }, 10000);
  socket.onopen = () => { clearTimeout(timeout); $('#ws-state').textContent = '已连接'; wsLog('连接成功'); refreshAvailability(); };
  socket.onmessage = event => { const matches = event.data === socket.expectedEcho; wsLog('收到：' + event.data); record('backend.websocket', matches ? 'passed' : 'failed', { result: { echo: event.data, matches }, ms: Math.round(performance.now() - socket.sentAt) }); };
  socket.onerror = () => { clearTimeout(timeout); wsLog('连接错误'); record('backend.websocket', 'failed', { error: { code: 'websocket_failed' } }); };
  socket.onclose = event => { clearTimeout(timeout); $('#ws-state').textContent = '已关闭'; wsLog('关闭 code=' + event.code); if (state.records.get('backend.websocket')?.status === 'running') record('backend.websocket', 'skipped', { note: '连接已关闭，未验证回声' }); refreshAvailability(); };
}
function wsSend() {
  const socket = state.websocket, text = $('#ws-message').value;
  if (!socket || socket.readyState !== WebSocket.OPEN) { wsLog('请先连接'); return; }
  if (new TextEncoder().encode(text).length > 65536) { wsLog('文本超过 64 KiB'); return; }
  socket.expectedEcho = text; socket.sentAt = performance.now(); socket.send(text); wsLog('发送：' + text);
}
function exportReport() {
  const report = buildReport({ records: [...state.records.values()], contract: state.info, suite: state.suite,
    details: $('#report-details').checked, events: state.events, workflow: state.workflow.report() });
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'bridge-lab-report-' + Date.now() + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function renderSuite(suite) {
  state.suite = suite; const summary = suite.summary;
  $('#suite-status').textContent = `${suite.state === 'running' ? '检查中' : suite.state === 'cancelled' ? '已停止' : '本轮完成'} · ${summary.completed}/${summary.automatic} · 通过 ${summary.passed} · 失败 ${summary.failed} · 条件不足 ${summary.blocked} · 需手动 ${summary.manual} · 预留 ${summary.reserved}`;
  $('#suite-progress').max = summary.automatic || 1; $('#suite-progress').value = summary.completed;
  const table = node('table', 'suite-table'); const header = node('tr');
  for (const title of ['入口 / 方法', '状态', '耗时', '说明']) header.append(node('th', '', title));
  table.append(header);
  for (const check of suite.checks) { const row = node('tr'); for (const text of [`${check.scope} / ${check.method}`, labels[check.status] || check.status, check.durationMs === undefined ? '—' : check.durationMs + ' ms', check.reason || (check.kind === 'manual' ? '用户逐项发起' : check.kind === 'reserved' ? '本轮未调用，不计通过' : '')]) row.append(node('td', '', text)); table.append(row); }
  $('#suite-results').replaceChildren(table);
}
async function oneClickTest() {
  if (state.batch || state.controllers.size || state.workflowBusy || state.artifactBusy) return;
  const controller = new AbortController(); state.batchController = controller; state.batch = true;
  $('#run-all').disabled = $('#run-page').disabled = $('#backend-read-check').disabled = true; refreshAvailability();
  try {
    await runSuite({ environment: state.sdk ? 'desktop' : 'offline', signal: controller.signal,
      probes: {
        'environment.host': async () => { if (!state.sdk) throw localError('sdk_unavailable', '请在 Desktop 内打开安装包。'); const actual = listMethods(state.sdk); return { methods: actual.length, missing: catalog.filter(def => !actual.includes(def.path)).map(def => def.path), uncatalogued: actual.filter(path => !catalog.some(def => def.path === path)) }; },
        'environment.health': async signal => { const value = await api('/api/health', undefined, signal); if (value.ok !== true) throw localError('invalid_response', '后端健康响应不完整'); return { healthy: true }; },
        'environment.runtime': signal => api('/api/env', undefined, signal),
        'environment.backend': async signal => { const value = await api('/api/env', undefined, signal); if (!value.presence?.DESKTOP_ACTION_BRIDGE_URL || !value.presence?.DESKTOP_ACTION_BRIDGE_TOKEN) throw localError('bridge_unavailable', '受管后端未取得 Desktop SDK 配置。'); return { configured: true }; },
        'transport.http': async signal => { const message = 'Bridge Lab ' + crypto.randomUUID(); const value = await api('/api/echo', { message }, signal); if (value.result?.message !== message || value.result.byteLength !== new TextEncoder().encode(message).length) throw localError('echo_mismatch', 'HTTP 回声不匹配'); return { echoMatches: true }; },
        'transport.websocket': signal => { const url = new URL('/api/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; return websocketEcho(url.href, signal); }
      }, call: (channel, path, args, signal) => callChannel(channel, path, args, { signal, readonly: true }),
      onUpdate: renderSuite,
      onRecord: check => record(check.scope === 'backend' ? 'backend.' + check.method : check.method, check.status, { channel: check.scope, request: check.request, ...(check.error ? { error: check.error } : { result: check.result }), note: check.reason, ms: check.durationMs }) });
    $('#last-check').textContent = '最近一键测试 ' + new Date().toLocaleTimeString();
  } finally { state.batch = false; state.batchController = null; $('#run-all').disabled = $('#run-page').disabled = $('#backend-read-check').disabled = false; refreshAvailability(); }
}
function wire() {
  for (const [id, path] of [['chat-history', 'assistant.chat'], ['execute-history', 'assistant.execute']]) $('#' + id).onclick = async () => {
    const cache = currentChannel() === 'page' ? state.results : state.backendResults, chatId = cache[path]?.chatId; if (!chatId || state.batch) return;
    const start = performance.now(); try { const result = await callChannel('page', 'desktop.chat.open', { chatId }); record('desktop.chat.open', 'observe', { result, request: { chatId }, ms: Math.round(performance.now() - start), note: '宿主已确认打开，请核对历史内容' }); } catch (error) { record('desktop.chat.open', errorStatus(error), { error: failure(error, 'desktop.chat.open') }); }
  };
  $('#artifact-to-execute').onclick = () => {
    let draft; try { draft = artifactExecuteDraft(); } catch (error) { $('#execute-result').textContent = error.message; return; }
    const source = draft.input.source;
    $('#execute-message').value = draft.message; $('#execute-input').value = printable(draft.input); $('#execute-schema').value = printable(draft.outputSchema);
    $('#execute-result').textContent = '已带入实际读取的文件内容；点击「执行任务」才会调用模型。来源：' + printable(source);
    $('#assistant').scrollIntoView({ behavior: 'smooth' }); $('#execute-run').focus();
  };
  $('#workflow-check').onclick = async () => { await runBatch('read', currentChannel()); $('#workflow-result').textContent = '只读检查已完成。请核对配置、连接器和看板结果；产物任务需要能写文件并调用 artifact_publish 的 Agent。'; };
  $('#prepare-artifacts').onclick = () => void prepareArtifacts();
  $('#workflow-unsubscribe').onclick = () => state.subscriptions.get(currentChannel())?.abort();
  $('#artifact-chat').onchange = () => {
    state.workflow.selectChat($('#artifact-chat').value);
    $('#artifact-result').textContent = '已切换 Chat，请选择并验证该 Chat 实际发布的文件。';
    for (const def of catalog.filter(def => def.path.startsWith('artifact.'))) delete state.cards.get(def.path).editor.dataset.edited;
    updateEditors(); renderWorkflow(); refreshAvailability();
  };
  $('#artifact-choice').onchange = () => { state.workflow.selectArtifact($('#artifact-choice').value); $('#artifact-result').textContent = '已切换文件，请重新验证。'; updateEditors(); renderWorkflow(); refreshAvailability(); };
  $('#refresh-artifacts').onclick = () => void loadArtifacts(); $('#more-artifacts').onclick = () => void loadArtifacts({ more: true });
  $('#artifact-inspect').onclick = () => void inspectArtifact(); $('#artifact-preview').onclick = () => void inspectArtifact('preview'); $('#artifact-save').onclick = () => void inspectArtifact('save');
  $('#run-all').onclick = () => void oneClickTest(); $('#run-page').onclick = () => void runBatch(); $('#stop-tests').onclick = () => state.batchController?.abort(localError('cancelled', '用户停止测试'));  $('#backend-read-check').onclick = () => void runBatch('read', 'backend');
  $('#export-report').onclick = exportReport; $('#chat-sync').onclick = () => void chat(false); $('#chat-background').onclick = () => void chat(true);
  $('#load-skills').onclick = async () => {
    const channel = currentChannel();
    await runDescriptor(catalog.find(def => def.path === 'skill.list'), { channel });
    const entry = state.records.get(channel === 'page' ? 'skill.list' : 'backend.skill.list');
    $('#chat-text').textContent = entry?.error ? printable(entry.error) : `已读取 ${entry?.result?.items?.length || 0} 项技能。Agent 已挂载技能自动生效；只有包内声明为附加引用的技能可手动附加。`;
  };
  $('#subscribe-run').onclick = () => void subscribe(); $('#abort-subscription').onclick = () => state.subscriptions.get(currentChannel())?.abort();
  $('#stop-run').onclick = () => void stopRun(); $('#execute-run').onclick = () => void execute(); $('#execute-cancel').onclick = () => state.controllers.get('execute')?.abort();
  $('#execute-copy').onclick = () => void copyRequest(); $('#backend-health').onclick = () => void backendProbe('/api/health'); $('#backend-env').onclick = () => void backendProbe('/api/env');
  $('#backend-call').onclick = () => void backendCall(); $('#backend-cancel').onclick = () => { state.controllers.get('backend-call')?.abort(); state.subscriptions.get('backend')?.abort(); };
  $('#agent-channel').onchange = () => {
    updateIdentity(); $('#agent-backend-consent').hidden = currentChannel() !== 'backend'; const cache = currentChannel() === 'page' ? state.results : state.backendResults; renderSkills(cache['skill.list']?.items || []);
    for (const def of catalog) if (defaultChannel(def.path) !== 'page' || BACKEND_METHODS.has(def.path)) delete state.cards.get(def.path).editor.dataset.edited;
    for (const [path, view] of state.cards) {
      const entry = state.records.get(defaultChannel(path) === 'page' ? path : 'backend.' + path);
      view.status.dataset.status = entry?.status || 'idle';
      view.status.textContent = labels[entry?.status || 'idle'] + (entry?.note ? ' · ' + entry.note : '');
      view.output.textContent = entry?.error ? printable(entry.error) : entry && 'result' in entry ? printable({ request: entry.request, result: entry.result }) : '当前通道尚未运行';
    }
    renderResources(); updateEditors(); renderWorkflow(); refreshAvailability();
  };
  for (const id of ['backend-writes', 'agent-backend-writes']) $('#' + id).onchange = event => {
    $('#backend-writes').checked = $('#agent-backend-writes').checked = event.target.checked;
    refreshAvailability();
  };
  $('#agent-refresh').onclick = () => void refreshAgent();
  $('#ws-connect').onclick = wsConnect; $('#ws-send').onclick = wsSend; $('#ws-close').onclick = () => state.websocket?.close(1000, 'Lab test complete');
  window.addEventListener('pagehide', () => { for (const controller of state.subscriptions.values()) controller.abort(); for (const controller of state.controllers.values()) controller.abort(); state.websocket?.close(); });
}
async function init() {
  buildUI(); wire();
  try { const response = await fetch('/build-info.json'); if (response.ok) { state.info = await response.json(); $('#contract-info').textContent = printable(state.info); } }
  catch { $('#contract-info').textContent = '预览环境没有构建契约信息。'; }
  try {
    state.sdk = await import('/__desktop/bridge.js');
    const methods = listMethods(state.sdk), covered = new Set(catalog.map(x => x.path)), unknown = methods.filter(method => !covered.has(method));
    $('#coverage-info').textContent = `SDK 提供 ${methods.length} 个方法；卡片覆盖 ${methods.filter(path => covered.has(path)).length} 个。` + (unknown.length ? '\n新增未覆盖方法（需补充测试卡片）：' + unknown.join(', ') : ' 所有已发现方法均有卡片。');
    $('#connection').textContent = 'Desktop SDK 已加载';
    $('#environment-notice').textContent = '自检不会发起 Agent 调用、修改主题或打开原生窗口。带「手动」标记的操作需逐项点击。';
    for (const path of ['desktop.capabilities.list', 'desktop.theme.get', 'desktop.locale.get']) await runDescriptor(catalog.find(def => def.path === path));
    await refreshAgent();
    if (!findMethod(state.sdk, 'assistant.execute')) $('#execute-result').textContent = 'Desktop SDK 尚未提供 assistant.execute。可以复制请求，待升级 Desktop 后实测。';
    if (state.records.get('desktop.capabilities.list')?.status !== 'passed') {
      document.body.dataset.disconnected = 'true'; $('#connection').textContent = 'SDK 已加载，宿主不可用';
      $('#environment-notice').textContent = 'SDK 已加载，但宿主调用失败。请查看配置与能力卡片中的错误；不能将当前结果视为实机通过。'; $('#environment-notice').classList.add('warning');
    }
  } catch {
    document.body.dataset.disconnected = 'true'; $('#connection').textContent = '独立浏览器预览';
    $('#environment-notice').classList.add('warning'); $('#environment-notice').textContent = '当前没有 Desktop Bridge。请将 build/bridge-lab.zip 导入 Desktop 后测试；预览不会模拟成功结果。';
    $('#coverage-info').textContent = '未加载宿主 SDK。';
    $('#agent-status').textContent = '当前是浏览器预览，无法读取 Desktop 配置。请导入 ZIP，并在 Desktop 网页应用设置中选择测试 Agent。';
    for (const def of catalog) record(def.path, 'unavailable', { note: 'SDK 未提供' });
  }
  document.body.dataset.ready = 'true';
  renderResources(); updateEditors(); renderWorkflow(); refreshAvailability();
}
void init();
