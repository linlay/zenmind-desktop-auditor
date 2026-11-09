import { TYPES, createNode, template, validateGraph, requireGraph } from './core/graph.mjs';
const $ = id => document.getElementById(id);
const labels = { pending: '等待依赖', running: '运行中', cancelling: '取消中', succeeded: '已完成', failed: '失败', skipped: '未执行', cancelled: '已取消', interrupted: '已中断' };
const state = { graph: template(), revision: 0, dirty: false, selected: 'extract', run: null, runNode: null, runs: [], activeId: null, historyMode: false, zoom: .85, connecting: null, sdk: null, configured: false, polling: false, dragging: false, selectedRunId: null, inspectorDirty: false, pending: false };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const pretty = value => JSON.stringify(value, null, 2);
const graph = () => state.historyMode && state.run ? state.run.graph : state.graph;
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text; }
async function api(endpoint, input, method = input === undefined ? 'GET' : 'POST') {
  const response = await fetch(endpoint, { method, headers: { 'X-DAG-Lab': '1', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000), ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const value = await response.json(); if (!response.ok || !value.ok) throw Object.assign(Error(value.error?.message || '本地服务请求失败'), value.error); return value.result;
}
function changed() { state.dirty = true; $('save-state').textContent = '未保存'; updateControls(); }
function sameGraph(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function displayState(id) { return state.run && (state.historyMode || sameGraph(state.run.graph, state.graph)) ? state.run.nodes[id] : null; }
function updateControls() {
  const busy = !!state.activeId, readOnly = state.historyMode;
  $('run').disabled = state.pending || busy || readOnly || (state.graph.nodes.some(node => node.type === 'agent') && !state.configured);
  $('run').title = !state.configured && state.graph.nodes.some(node => node.type === 'agent') ? '请在 Desktop 内启动应用并选择工作流 Agent' : '';
  $('cancel').hidden = !busy || state.historyMode && state.selectedRunId !== state.activeId; $('cancel').disabled = state.pending;
  $('save').disabled = state.pending || readOnly; $('workflow-name').readOnly = readOnly;
  for (const id of ['add-node', 'arrange', 'apply-node', 'remove-node']) $(id).disabled = readOnly;
  $('save-state').textContent = readOnly ? '正在查看运行快照' : state.dirty || state.inspectorDirty ? '未保存' : '已保存';
  $('download-run').disabled = !state.run; $('delete-run').disabled = !state.run || ['running', 'cancelling'].includes(state.run.status);
}
function drawEdges() {
  const svg = $('edges'), data = graph(); svg.replaceChildren();
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'), marker = document.createElementNS(svg.namespaceURI, 'marker');
  marker.setAttribute('id', 'arrow'); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6'); marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS(svg.namespaceURI, 'path'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('class', 'edge-arrow'); marker.append(arrow); defs.append(marker); svg.append(defs);
  for (const edge of data.edges) {
    const from = data.nodes.find(node => node.id === edge.source), to = data.nodes.find(node => node.id === edge.target); if (!from || !to) continue;
    const line = document.createElementNS(svg.namespaceURI, 'path'), x = from.x + 210, y = from.y + 54, tx = to.x, ty = to.y + 54, curve = Math.max(55, Math.abs(tx - x) * .5);
    line.setAttribute('d', `M ${x} ${y} C ${x + curve} ${y}, ${tx - curve} ${ty}, ${tx} ${ty}`); line.setAttribute('class', 'edge' + ([from.id, to.id].includes(state.selected) ? ' active' : '')); line.setAttribute('marker-end', 'url(#arrow)');
    const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = from.label + ' → ' + to.label + '；点击移除'; line.append(title);
    line.addEventListener('click', () => { if (state.historyMode) return; state.graph.edges = state.graph.edges.filter(item => item !== edge); changed(); renderCanvas(); renderInspector(); }); svg.append(line);
  }
}
function resizeBoard() {
  const data = graph(), width = Math.max(850, ...data.nodes.map(node => node.x + 300)), height = Math.max(540, ...data.nodes.map(node => node.y + 210));
  $('board').style.width = width + 'px'; $('board').style.height = height + 'px'; $('board').style.transform = `scale(${state.zoom})`;
  $('board-sizer').style.width = width * state.zoom + 'px'; $('board-sizer').style.height = height * state.zoom + 'px'; $('zoom-value').textContent = Math.round(state.zoom * 100) + '%';
}
function renderCanvas() {
  const data = graph(); $('nodes').replaceChildren(); $('graph-count').textContent = `${data.nodes.length} 节点 · ${data.edges.length} 连线`; $('canvas-empty').hidden = !!data.nodes.length;
  for (const node of data.nodes) {
    const card = el('article', 'dag-node' + (state.selected === node.id ? ' selected' : '')); card.dataset.id = node.id; card.dataset.state = displayState(node.id)?.status || 'draft'; card.style.left = node.x + 'px'; card.style.top = node.y + 'px'; card.tabIndex = 0; card.setAttribute('aria-label', node.label + '，' + TYPES[node.type].label + '节点');
    const header = el('header'), icon = el('span', 'node-icon ' + TYPES[node.type].color, TYPES[node.type].icon), title = el('div'), h = el('h3', '', node.label); title.append(h, el('small', '', TYPES[node.type].label + '节点')); header.append(icon, title); card.append(header);
    const description = node.type === 'agent' ? node.config.message : node.type === 'input' ? JSON.stringify(node.config.value) : node.type === 'merge' ? '收集所有上游节点的结果' : '流程的最终交付结果'; card.append(el('div', 'node-description', description));
    card.append(el('div', 'node-state', displayState(node.id) ? labels[displayState(node.id).status] : node.type === 'agent' ? '✦ 使用工作流 Agent' : '● 本地处理'));
    for (const direction of ['in', 'out']) {
      if (node.type === 'input' && direction === 'in' || node.type === 'output' && direction === 'out') continue;
      const port = el('button', 'port ' + direction + (state.connecting === node.id && direction === 'out' ? ' connecting' : '')); port.setAttribute('aria-label', node.label + (direction === 'in' ? ' 输入端口' : ' 输出端口')); port.title = direction === 'out' ? '点击后选择目标输入端口' : '连接上游节点';
      port.addEventListener('pointerdown', event => event.stopPropagation());
      port.addEventListener('click', event => { event.stopPropagation(); if (state.historyMode) return; if (direction === 'out') { state.connecting = state.connecting === node.id ? null : node.id; notice(state.connecting ? '请选择目标节点的左侧输入端口。' : ''); renderCanvas(); } else if (state.connecting) connect(state.connecting, node.id); else notice('请先点击一个上游节点的右侧输出端口。'); }); card.append(port);
    }
    card.addEventListener('click', () => selectNode(node.id)); card.addEventListener('keydown', event => { if (event.key === 'Enter') selectNode(node.id); });
    header.addEventListener('pointerdown', event => {
      if (state.historyMode || event.button !== 0) return;
      state.dragging = true;
      const x = event.clientX, y = event.clientY, original = { x: node.x, y: node.y }; let moved = false;
      header.setPointerCapture(event.pointerId);
      const move = current => { if (Math.abs(current.clientX - x) + Math.abs(current.clientY - y) > 3) moved = true; node.x = Math.round(Math.max(0, Math.min(5000, original.x + (current.clientX - x) / state.zoom))); node.y = Math.round(Math.max(0, Math.min(5000, original.y + (current.clientY - y) / state.zoom))); card.style.left = node.x + 'px'; card.style.top = node.y + 'px'; drawEdges(); resizeBoard(); };
      const finish = () => { state.dragging = false; header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', finish); header.removeEventListener('pointercancel', finish); header.removeEventListener('lostpointercapture', finish); if (moved) changed(); };
      header.addEventListener('pointermove', move); header.addEventListener('pointerup', finish); header.addEventListener('pointercancel', finish); header.addEventListener('lostpointercapture', finish);
    });
    $('nodes').append(card);
  }
  drawEdges(); resizeBoard(); updateControls();
}
function connect(source, target) {
  const next = { ...state.graph, edges: [...state.graph.edges, { source, target }] }, validation = validateGraph(next, { draft: true });
  if (!validation.valid) return notice(validation.errors.join('\n'), true);
  state.graph = next; state.connecting = null; changed(); notice('已连接节点。'); renderCanvas(); renderInspector();
}
function selectNode(id) {
  if (state.inspectorDirty && state.selected !== id && !applyInspector()) return;
  state.selected = id; state.runNode = id; renderCanvas(); renderInspector(); renderRun();
}
function renderInspector() {
  const data = graph(), node = data.nodes.find(node => node.id === state.selected); state.inspectorDirty = false;
  $('inspector-empty').hidden = !!node; $('node-form').hidden = !node; $('node-type').textContent = node ? TYPES[node.type].label : '选择节点'; if (!node) return;
  $('node-label').value = node.label; $('node-id').textContent = node.id;
  $('input-config').hidden = node.type !== 'input'; $('agent-config').hidden = node.type !== 'agent'; $('data-config').hidden = !['merge', 'output'].includes(node.type);
  $('data-config').textContent = node.type === 'merge' ? '将上游结果合并为一个对象，以节点 ID 为键。' : '一个上游时直接输出，多路上游时按节点 ID 汇总输出。';
  $('input-value').value = pretty(node.config.value ?? {}); $('agent-message').value = node.config.message || ''; $('agent-schema').value = pretty(node.config.outputSchema || {});
  $('dependencies').replaceChildren();
  const parents = data.edges.filter(edge => edge.target === node.id).map(edge => edge.source);
  if (node.type === 'input') $('dependencies').append(el('div', 'field-hint', '输入节点是流程起点，无上游依赖。'));
  else for (const candidate of data.nodes.filter(candidate => candidate.id !== node.id && candidate.type !== 'output')) {
    const label = el('label', 'dependency'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = candidate.id; checkbox.checked = parents.includes(candidate.id); checkbox.disabled = state.historyMode; checkbox.addEventListener('change', () => { state.inspectorDirty = true; updateControls(); }); label.append(checkbox, el('span', '', candidate.label)); $('dependencies').append(label);
  }
  for (const field of $('node-form').querySelectorAll('input,textarea')) field.disabled = state.historyMode;
  updateControls();
}
function applyInspector() {
  if (state.historyMode) return true;
  const current = state.graph.nodes.find(node => node.id === state.selected); if (!current) return true;
  try {
    const next = structuredClone(state.graph), node = next.nodes.find(node => node.id === current.id); node.label = $('node-label').value.trim();
    if (node.type === 'input') node.config = { value: JSON.parse($('input-value').value) };
    if (node.type === 'agent') node.config = { message: $('agent-message').value, outputSchema: JSON.parse($('agent-schema').value) };
    const parents = [...$('dependencies').querySelectorAll('input:checked')].map(input => input.value);
    next.edges = next.edges.filter(edge => edge.target !== node.id || parents.includes(edge.source));
    for (const source of parents) if (!next.edges.some(edge => edge.source === source && edge.target === node.id)) next.edges.push({ source, target: node.id });
    const validation = validateGraph(next, { draft: true }); if (!validation.valid) throw Error(validation.errors.join('\n'));
    if (!sameGraph(next, state.graph)) { state.graph = next; changed(); }
    state.inspectorDirty = false; updateControls(); renderCanvas(); return true;
  } catch (error) { notice('节点参数未应用：' + error.message, true); return false; }
}
function renderHistory() {
  $('history-count').textContent = state.runs.length; $('history').replaceChildren();
  if (!state.runs.length) $('history').append(el('p', 'empty-note', '运行流程后，记录会出现在这里。'));
  for (const run of state.runs) {
    const button = el('button', 'history-item' + (state.selectedRunId === run.id ? ' selected' : '')); const name = el('span'); name.append(el('i', 'history-dot ' + run.status), document.createTextNode(run.name)); const details = el('small'); details.append(el('span', '', new Date(run.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })), el('span', '', labels[run.status])); button.append(name, details);
    button.disabled = !!state.activeId && run.id !== state.activeId;
    button.addEventListener('click', async () => { try { if (state.inspectorDirty && !applyInspector()) return; state.selectedRunId = run.id; state.runNode = null; state.historyMode = true; await loadRun(); $('workflow-name').value = state.run.name; state.selected = state.run.graph.nodes[0]?.id; renderCanvas(); renderInspector(); renderHistory(); } catch (error) { notice(error.message, true); } }); $('history').append(button);
  }
}
function renderRun() {
  const run = state.run; $('run-empty').hidden = !!run; $('run-detail').hidden = !run; $('run-status').textContent = run ? labels[run.status] : '尚未运行'; $('run-status').dataset.status = run?.status || 'idle'; $('run-time').textContent = run ? ((run.finishedAt || Date.now()) - run.startedAt) / 1000 + ' s' : '';
  if (!run) return;
  $('run-nodes').replaceChildren(); const result = state.runNode && run.nodes[state.runNode];
  const final = el('button', 'run-node' + (!result ? ' selected' : ''), '最终结果'); final.addEventListener('click', () => { state.runNode = null; renderRun(); }); $('run-nodes').append(final);
  for (const node of run.graph.nodes) { const record = run.nodes[node.id], button = el('button', 'run-node' + (state.runNode === node.id ? ' selected' : ''), (record.status === 'succeeded' ? '✓ ' : record.status === 'running' ? '◉ ' : '') + node.label); button.addEventListener('click', () => { state.runNode = node.id; renderRun(); }); $('run-nodes').append(button); }
  const data = result ? { nodeId: state.runNode, status: result.status, ...(result.startedAt ? { durationMs: (result.finishedAt || Date.now()) - result.startedAt } : {}), upstream: run.graph.edges.filter(edge => edge.target === state.runNode).map(edge => edge.source), ...('output' in result ? { output: result.output } : {}), ...(result.error ? { error: result.error } : {}), ...(result.chatId ? { chatId: result.chatId } : {}) } : { status: run.status, mode: run.mode, ...(run.error ? { error: run.error } : {}), outputs: run.outputs };
  $('run-output').textContent = pretty(data).slice(0, 48000) + (pretty(data).length > 48000 ? '\n…显示已截断；导出结果可读取完整内容。' : '');
  if (result?.chatId) { const button = el('button', 'quiet', '打开节点对话历史 ↗'); button.disabled = !state.sdk?.desktop?.chat?.open; button.addEventListener('click', async () => { try { await state.sdk.desktop.chat.open({ chatId: result.chatId }); } catch (error) { notice(error.message, true); } }); $('run-output').prepend(button); }
  updateControls();
}
async function refreshWorkspace({ initial = false } = {}) {
  const value = await api('/api/workspace'); state.configured = value.agentConfigured; state.runs = value.runs; state.activeId = value.activeRunId;
  if (initial) { state.graph = value.graph; state.revision = value.revision; state.selected = value.graph.nodes.find(node => node.type === 'agent')?.id || value.graph.nodes[0]?.id; $('workflow-name').value = state.graph.name; state.selectedRunId = value.activeRunId || value.runs[0]?.id; }
  $('connection').textContent = value.agentConfigured ? 'Desktop 后端已连接' : '本地预览 · 智能体未连接'; $('connection-dot').classList.toggle('offline', !value.agentConfigured);
  renderHistory(); updateControls();
}
async function loadRun() {
  if (!state.selectedRunId) return;
  const id = state.selectedRunId, run = await api('/api/runs/' + id); if (state.selectedRunId !== id) return;
  state.run = run; renderRun(); if (!state.dragging) renderCanvas();
}
async function refreshAgent() {
  try {
    const sdk = await import('/__desktop/bridge.js'); state.sdk = sdk;
    const values = await sdk.desktop.app.getUserConfig(); const appearance = await sdk.desktop.theme.get(); document.documentElement.dataset.theme = appearance.resolvedTheme;
    $('agent-name').textContent = values.agent || 'Desktop 默认助手'; $('agent-note').textContent = '所有智能体节点共用此 Agent · 需要 result_submit 工具';
  } catch { $('agent-name').textContent = '尚未连接 Desktop Agent'; $('agent-note').textContent = '在 Desktop 应用设置选择 Agent；浏览器可运行无模型的数据流程。'; }
  updateControls();
}
async function save() {
  if (!applyInspector()) return false;
  const revision = state.revision, savedGraph = structuredClone(state.graph); const value = await api('/api/graph', { graph: savedGraph, revision }, 'PUT'); state.revision = value.revision;
  state.dirty = !sameGraph(savedGraph, state.graph); updateControls(); return true;
}
async function run() {
  state.pending = true; updateControls();
  try {
    if (!applyInspector()) return;
    const validation = validateGraph(state.graph); if (!validation.valid) throw Error(validation.errors.join('\n'));
    if (!await save()) return;
    const value = await api('/api/runs', { revision: state.revision }); state.selectedRunId = value.id; state.historyMode = false; state.runNode = null; state.activeId = value.id;
    await loadRun(); await refreshWorkspace(); notice('流程已开始。智能体节点会调用模型；关闭此页面不会重发任务。');
  } catch (error) { notice(error.message + (error.code === 'revision_conflict' ? '\n请先导出本页草稿，再刷新页面。' : ''), true); await refreshWorkspace().catch(() => {}); }
  finally { state.pending = false; updateControls(); }
}
function download(name, value) { const url = URL.createObjectURL(new Blob([pretty(value)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function replaceGraph(next) {
  if ((state.dirty || state.inspectorDirty) && !confirm('替换当前未保存的草稿？可以先导出 JSON 保留。')) return;
  state.graph = next; state.historyMode = false; state.selected = next.nodes[0]?.id; state.connecting = null; $('workflow-name').value = next.name; state.inspectorDirty = false; changed(); renderCanvas(); renderInspector(); notice('流程已载入，保存后即可运行。');
}
function wire() {
  $('workflow-name').addEventListener('input', () => { state.graph.name = $('workflow-name').value; changed(); });
  $('node-form').addEventListener('submit', event => { event.preventDefault(); if (applyInspector()) notice('节点配置已应用，保存流程后生效。'); });
  for (const field of ['node-label', 'input-value', 'agent-message', 'agent-schema']) $(field).addEventListener('input', () => { state.inspectorDirty = true; updateControls(); });
  $('save').addEventListener('click', async () => { if (state.pending) return; state.pending = true; updateControls(); try { if (await save()) notice('流程已保存。'); } catch (error) { notice(error.message, true); } finally { state.pending = false; updateControls(); } });
  $('run').addEventListener('click', run);
  $('cancel').addEventListener('click', async () => { try { await api('/api/runs/' + state.activeId + '/cancel', {}); notice('已请求取消；已经执行的操作不会回滚。'); await refreshWorkspace(); await loadRun(); } catch (error) { notice(error.message, true); } });
  $('add-node').addEventListener('change', () => { const type = $('add-node').value; if (!type) return; if (!applyInspector()) return; const node = createNode(type, state.graph.nodes.length); state.graph.nodes.push(node); state.selected = node.id; $('add-node').value = ''; changed(); renderCanvas(); renderInspector(); $('canvas-viewport').scrollTo({ left: Math.max(0, node.x * state.zoom - 50), top: Math.max(0, node.y * state.zoom - 70), behavior: 'smooth' }); });
  $('remove-node').addEventListener('click', () => { const id = state.selected; state.graph.nodes = state.graph.nodes.filter(node => node.id !== id); state.graph.edges = state.graph.edges.filter(edge => edge.source !== id && edge.target !== id); state.selected = null; state.inspectorDirty = false; changed(); renderCanvas(); renderInspector(); });
  $('validate').addEventListener('click', () => { if (!applyInspector()) return; const result = validateGraph(graph()); notice(result.valid ? `检查通过：${graph().nodes.length} 个节点，没有循环依赖。` : result.errors.join('\n'), !result.valid); });
  $('arrange').addEventListener('click', () => { if (!applyInspector()) return; const result = validateGraph(state.graph, { draft: true }); if (!result.valid) return notice(result.errors.join('\n'), true); const ranks = new Map(), levels = new Map(); for (const id of result.order) { const rank = Math.max(0, ...state.graph.edges.filter(edge => edge.target === id).map(edge => (ranks.get(edge.source) || 0) + 1)); ranks.set(id, rank); const index = levels.get(rank) || 0; levels.set(rank, index + 1); const node = state.graph.nodes.find(node => node.id === id); node.x = 60 + rank * 280; node.y = 100 + index * 230; } changed(); renderCanvas(); });
  for (const button of document.querySelectorAll('[data-template]')) button.addEventListener('click', () => replaceGraph(template(button.dataset.template)));
  $('new-workflow').addEventListener('click', () => { state.historyMode = false; $('workflow-name').value = state.graph.name; state.selected = state.graph.nodes[0]?.id; renderCanvas(); renderInspector(); });
  $('export').addEventListener('click', () => { if (!applyInspector()) return; download('dag-workflow.json', graph()); });
  $('new').addEventListener('click', () => replaceGraph(template('blank')));
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => { try { const file = $('import-file').files[0]; if (!file) return; if (file.size > 512 * 1024) throw Error('导入文件不能超过 512 KiB。'); const next = requireGraph(JSON.parse(await file.text()), { draft: true }); replaceGraph(next); } catch (error) { notice('导入失败：' + error.message, true); } finally { $('import-file').value = ''; } });
  $('download-run').addEventListener('click', () => { if (state.run) download('dag-run-' + state.run.id + '.json', state.run); });
  $('delete-run').addEventListener('click', async () => { try { if (!state.run || !confirm('删除这条运行记录？结果和运行快照将一并移除。')) return; await api('/api/runs/' + state.run.id, undefined, 'DELETE'); state.run = null; state.selectedRunId = null; state.historyMode = false; await refreshWorkspace(); renderRun(); renderCanvas(); renderInspector(); } catch (error) { notice(error.message, true); } });
  $('help').addEventListener('click', () => $('help-dialog').showModal()); $('close-help').addEventListener('click', () => $('help-dialog').close()); $('refresh-agent').addEventListener('click', () => { void refreshAgent(); void refreshWorkspace().catch(error => notice(error.message, true)); });
  for (const [id, delta] of [['zoom-out', -.1], ['zoom-in', .1]]) $(id).addEventListener('click', () => { state.zoom = Math.min(1.5, Math.max(.35, state.zoom + delta)); resizeBoard(); });
  $('fit').addEventListener('click', () => { state.zoom = Math.min(1, Math.max(.35, ($('canvas-viewport').clientWidth - 50) / Math.max(700, ...graph().nodes.map(node => node.x + 250)))); $('canvas-viewport').scrollTo(0, 0); resizeBoard(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { state.connecting = null; renderCanvas(); } if ((navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey) && event.key === 's') { event.preventDefault(); if (!state.historyMode) $('save').click(); } });
  window.addEventListener('beforeunload', event => { if (state.dirty || state.inspectorDirty) { event.preventDefault(); event.returnValue = ''; } });
}
async function poll() {
  if (state.polling) return; state.polling = true;
  try { await refreshWorkspace(); if (state.selectedRunId) await loadRun(); }
  catch (error) { $('connection').textContent = '连接中断，正在重连…'; $('connection-dot').classList.add('offline'); }
  finally { state.polling = false; setTimeout(poll, state.activeId ? 900 : 4000); }
}
wire();
try { await refreshWorkspace({ initial: true }); if (state.selectedRunId) await loadRun(); renderCanvas(); renderInspector(); await refreshAgent(); document.body.dataset.ready = 'true'; setTimeout(poll, 1200); }
catch (error) { notice('无法连接本地服务：' + error.message, true); renderCanvas(); renderInspector(); document.body.dataset.ready = 'error'; }
