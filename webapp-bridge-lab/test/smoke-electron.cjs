const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = process.env.BRIDGE_LAB_PROJECT, desktop = process.env.BRIDGE_LAB_DESKTOP;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lab-smoke-'));
app.setPath('userData', path.join(output, 'electron-profile'));
app.on('window-all-closed', () => {});
let win, gateway, backend, bridge;
const errors = [], fixtureErrors = [], calls = [], checks = [], timers = new Set(), chats = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) { const deadline = Date.now() + 12000; while (Date.now() < deadline) { if (await fn()) return; await pause(30); } throw Error('Timed out: ' + message); }
const js = source => win.webContents.executeJavaScript(source, true);
const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
const setValue = (id, value) => js(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change'))`);
const content = id => js(`document.getElementById(${JSON.stringify(id)}).textContent`);
const disabled = id => js(`document.getElementById(${JSON.stringify(id)}).disabled`);
const cardStatus = method => js(`document.querySelector('[data-method="${method}"] .method-status').dataset.status`);
const cardClick = method => js(`document.querySelector('[data-method="${method}"] .method-footer button').click()`);
function check(name) { checks.push(name); console.log('PASS ' + name); }
let empty = false, holdEvents = false, holdExecute = false, cancelledExecutions = 0, sequence = 0, theme = 'light', selectedAgent = '', connectorExit = 0;
function send(res, result, error) { res.writeHead(error ? 400 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(error ? { ok: false, error } : { ok: true, result })); }
function files(chat) {
  if (!chat.published) return [];
  return ['first', 'second'].map((label, index) => {
    const text = index ? '{"amount":128}' : '# Bridge Lab 验收\n\n商品 A 80 元，商品 B 48 元，总额 128 元。';
    return { chatId: chat.chatId, runId: index ? chat.runId + '-extra' : chat.runId, artifactId: 'same-file-id', name: label + (index ? '.json' : '.md'), mimeType: index ? 'application/json' : 'text/markdown', sizeBytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), publishedAt: Date.now(), text };
  });
}
const watchdog = setTimeout(() => { console.error('Smoke watchdog expired'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'build/bundle.json')));
  const bundle = path.resolve(root, 'build', index.packagePath), manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'webapp.json')));
  assert.equal(require(path.join(desktop, 'dist-electron/main/modules/webs/webapps/bridge-module.js')).WEBAPP_BRIDGE_MODULE_SOURCE, fs.readFileSync(path.join(bundle, 'backend/bridge.mjs'), 'utf8'));
  const { createLabServer } = await import(pathToFileURL(path.join(bundle, 'backend/server.mjs')));
  const { catalog } = await import(pathToFileURL(path.join(bundle, 'frontend/catalog.mjs')));
  const { validateResult } = await import(pathToFileURL(path.join(bundle, 'frontend/workflow.mjs')));
  const { normalizeWebappImageRequest } = require(path.join(desktop, 'dist-electron/main/modules/desktop-actions/webapp-image-input.js'));
  const { requestWebappPermission } = require(path.join(desktop, 'dist-electron/main/modules/desktop-actions/webapp-permissions.js'));
  const { executeNativeWebappAction } = require(path.join(desktop, 'dist-electron/main/modules/desktop-actions/webapp-native-actions.js'));
  const { resolveWebappAction } = require(path.join(desktop, 'dist-electron/shared/webapp-bridge.js'));
  const imageSample = { ...catalog.find(item => item.path === 'assistant.image').args, requestId: 'bridge-lab-contract-check' };
  assert.doesNotThrow(() => normalizeWebappImageRequest(imageSample));
  const access = catalog.find(item => item.path === 'desktop.requestAccess').args;
  assert.equal((await requestWebappPermission({}, { check: async () => {} }, { kind: 'webappPage' }, access.capability)).status, 'granted');
  const nativeOptions = { app: { getPath: () => output }, webs: { webappWindowManager: { getWindow: () => null, focus() {} } }, getMainWindow: () => null,
    openExternal: async () => {}, showFileDialog: async () => ({ canceled: false, filePaths: [path.join(output, 'selection.txt')] }), showSaveDialog: async () => ({ canceled: false, filePath: path.join(output, 'saved.txt') }),
    writeClipboardText() {}, showNotification: () => true, getMicrophonePermission: () => 'granted', requestMicrophoneAccess: async () => true };
  const nativePaths = ['desktop.browser.openExternal', 'desktop.dialog.selectFiles', 'desktop.dialog.selectDirectory', 'desktop.dialog.selectSavePath', 'desktop.microphone.getPermission', 'desktop.microphone.requestAccess', 'desktop.clipboard.writeText', 'desktop.notification.show'];
  for (const method of nativePaths) {
    const input = catalog.find(item => item.path === method).args;
    const response = await executeNativeWebappAction(nativeOptions, resolveWebappAction(method), input, manifest.id);
    assert.equal(response.ok, true, method); validateResult(method, response.result, input);
  }
  check('shipped image, compatibility-permission and native examples pass the real Desktop validators with isolated OS adapters');
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
  bridge = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks)); calls.push({ ...input, transport: req.headers.authorization.includes('backend') ? 'backend' : 'page' });
      const { action, args } = input;
      assert.ok(['Bearer synthetic-page-grant', 'Bearer synthetic-backend-grant'].includes(req.headers.authorization));
      let result;
      if (action === 'desktop.capabilities.list') result = { bridgeVersion: 2, capabilities: [{ id: 'assistant.execute', status: 'available', declared: true, permission: 'not_required' }] };
      else if (action === 'desktop.chat.open') { assert.equal(req.headers.authorization, 'Bearer synthetic-page-grant'); assert.ok(typeof args.chatId === 'string' && args.chatId); result = { chatId: args.chatId, status: 'opened' }; }
      else if (action === 'desktop.copilot.open' || action === 'desktop.copilot.close') { assert.equal(req.headers.authorization, 'Bearer synthetic-page-grant'); result = { open: action.endsWith('.open') }; }
      else if (action === 'desktop.theme.get') result = { themeMode: theme, resolvedTheme: theme };
      else if (action === 'desktop.theme.set') { theme = args.themeMode; result = { themeMode: theme, resolvedTheme: theme }; }
      else if (action === 'desktop.locale.get' || action === 'desktop.locale.set') result = { locale: args.locale || 'zh-CN', source: 'settings' };
      else if (action === 'desktop.requestAccess') result = await requestWebappPermission({}, { check: async () => {} }, { kind: 'webappPage' }, args.capability, args.connectorId, args.adapter);
      else if (nativePaths.includes(action)) { const response = await executeNativeWebappAction(nativeOptions, resolveWebappAction(action), args, manifest.id); assert.equal(response.ok, true); result = response.result; }
      else if (action === 'assistant.image') { normalizeWebappImageRequest(args); result = { requestId: args.requestId, chatId: 'image-fixture-chat', runId: 'image-fixture-run', images: [{ mimeType: 'image/png', dataUrl: 'data:image/png;base64,fixture' }] }; }
      else if (action === 'connector.list') result = { items: empty ? [] : [{ connectorId: 'fixture', name: 'Fixture' }] };
      else if (action === 'connector.describe') { assert.equal(args.connectorId, 'fixture'); result = { connectorId: 'fixture', revision: '1', adapters: ['cli'], components: [] }; }
      else if (action === 'connector.invoke') { assert.equal(args.connectorId, 'fixture'); assert.equal(args.adapter, 'cli'); result = { connectorId: 'fixture', adapter: 'cli', invocationId: 'inv-1', credentialRevision: 'r1', exitCode: connectorExit, stdout: connectorExit ? '' : 'Fixture usage', stderr: connectorExit ? 'fixture command failed' : '' }; }
      else if (action === 'skill.list') result = { items: empty ? [] : [{skillId:'installed-writing',name:'Writing',description:'Write documents',agentHasSkill:true},{skillId:'installed-report',name:'Reports',description:'Read reports',agentHasSkill:false}] };
      else if (action === 'skill.describe') { assert.ok(['installed-writing','installed-report'].includes(args.skillId)); result = {skillId:args.skillId,name:args.skillId==='installed-writing'?'Writing':'Reports',description:args.skillId==='installed-writing'?'Write documents':'Read reports',agentHasSkill:args.skillId==='installed-writing'}; }
      else if (action === 'kanban.boards.list') result = { items: [], projects: [], cloudAvailable: false };
      else if (action === 'kanban.issues.list') result = { items: empty ? [] : [{ id: 'issue-1', title: 'First issue' }, { id: 'issue-2', title: 'Second issue' }], cloudAvailable: false };
      else if (action === 'kanban.issues.get') { assert.ok(['issue-1', 'issue-2'].includes(args.issueId)); result = { issue: { id: args.issueId, title: args.issueId === 'issue-1' ? 'First issue' : 'Second issue' } }; }
      else if (action === 'assistant.agents.list') result = {items:[{agentKey:'helper',name:'Helper'},{agentKey:'executor',name:'Executor'}],defaultAgentKey:selectedAgent || 'helper'};
      else if (action === 'assistant.chat') {
        assert.deepEqual(args.skillIds || [], []); sequence++;
        const chat = { chatId: 'chat-' + sequence, runId: 'run-' + sequence, wantsFiles: args.message.includes('artifact_publish'), published: false, terminal: !args.background };
        chats.set(chat.chatId, chat);
        result = args.background ? { accepted: true, chatId: chat.chatId, runId: chat.runId } : { text: 'Bridge Lab 连接成功。', agentKey: selectedAgent || 'helper', chatId: chat.chatId, runId: chat.runId };
      } else if (action === 'assistant.events') {
        const chat = [...chats.values()].find(chat => chat.runId === args.runId); assert.ok(chat, 'Run must have been created by the app.');
        const complete = () => {
          if (res.destroyed) return;
          chat.terminal = true; if (chat.wantsFiles) chat.published = true;
          send(res, { events: [{ type: 'text.delta', text: '你好，Bridge Lab。', cursor: 1 }, { type: 'run.finished', reason: chat.interrupted ? 'interrupted' : 'completed', cursor: 2 }].filter(event => event.cursor > args.cursor), cursor: 2, terminal: true });
        };
        if (holdEvents) { const timer = setTimeout(() => { timers.delete(timer); complete(); }, 10000); timers.add(timer); res.on('close', () => { clearTimeout(timer); timers.delete(timer); }); }
        else complete();
        return;
      } else if (action === 'assistant.stop') { const chat = [...chats.values()].find(chat => chat.runId === args.runId); assert.ok(chat); chat.interrupted = true; result = { stopped: true }; }
      else if (action === 'assistant.execute') {
        if ((args.agentKey || selectedAgent) !== 'executor') return send(res, null, { code: 'assistant_agent_unsupported', message: 'result_submit unavailable' });
        if (holdExecute) { res.on('close', () => { cancelledExecutions++; }); return; }
        assert.equal(args.outputSchema.type, 'object'); assert.equal(args.skillIds, undefined); if(args.agentKey !== undefined) assert.equal(args.agentKey,'executor');
        const chatId = 'execute-' + (++sequence); chats.set(chatId, { chatId, published: false });
        result = { chatId, status: 'success', output: { amount: 128 } };
      } else if (action.startsWith('artifact.')) {
        const chat = chats.get(args.chatId); assert.ok(chat, 'Artifacts require an actually returned Chat ID.');
        const items = files(chat);
        if (action === 'artifact.list') {
          const offset = Number(args.cursor || 0); const page = items.slice(offset, offset + 1).map(({ text, ...item }) => item);
          result = { items: page, ...(offset + 1 < items.length ? { nextCursor: String(offset + 1) } : {}) };
        } else {
          const item = items.find(item => item.artifactId === args.artifactId && item.runId === args.runId); assert.ok(item, 'Chat, Run and artifactId must identify the same published file.');
          if (action === 'artifact.get') { const { text, ...meta } = item; result = meta; }
          else if (action === 'artifact.read') result = { dataBase64: Buffer.from(item.text).toString('base64') };
          else if (action === 'artifact.open') { assert.equal(req.headers.authorization, 'Bearer synthetic-page-grant'); result = { opened: true }; }
          else if (action === 'artifact.saveAs') { assert.equal(req.headers.authorization, 'Bearer synthetic-page-grant'); result = { saved: true }; }
          else throw Error('Unsupported artifact method: ' + action);
        }
      } else throw Error('Unknown fixture action: ' + action);
      send(res, result);
    } catch (error) { fixtureErrors.push(error.stack); if (!res.headersSent) send(res, null, { code: 'invalid_fixture_request', message: error.message }); }
  });
  const bridgeOrigin = await listen(bridge);
  backend = createLabServer({ env: { HOST: '127.0.0.1', WEBAPP_ID: manifest.id, DESKTOP_ACTION_BRIDGE_URL: bridgeOrigin + '/webapps', DESKTOP_ACTION_BRIDGE_TOKEN: 'synthetic-backend-grant' } });
  const backendOrigin = await listen(backend);
  const userPaths = require(path.join(desktop, 'dist-electron/main/infrastructure/filesystem/user-paths.js'));
  // Both native Windows and macOS use only the isolated test directory, never real profile paths.
  userPaths.getDesktopWebappStateRoot = (_, id) => path.join(output, 'webapp-state', id);
  userPaths.getDesktopWebappsDataRoot = () => path.dirname(bundle);
  userPaths.getDesktopWebappDataRoot = (_, id) => path.join(output, 'webapp-data', id);
  userPaths.getDesktopWebsConfigRoot = () => path.join(output, 'web-config');
  gateway = await require(path.join(desktop, 'dist-electron/main/modules/webs/webapps/gateway.js')).startWebappGateway({ app, item: { ...manifest, allowLanAccess: false }, webappDir: bundle, backendUrl: backendOrigin, pageActionToken: 'synthetic-page-grant', integrationPorts: { getConfiguredDesktopActionBridgePort: () => bridge.address().port } });
  win = new BrowserWindow({ show: false, width: 1440, height: 1080, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'bridge-lab-smoke' } });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) errors.push(event.message); });
  await win.loadURL(gateway.webUrl); await until(() => js('document.body.dataset.ready === "true"'), 'ready');
  assert.equal(await cardStatus('desktop.capabilities.list'), 'passed');
  assert.equal(await js('[...document.querySelectorAll(".method-card .output")].every(element=>!element.closest("details")&&element.getBoundingClientRect().height>0)'), true);
  assert.equal(await disabled('artifact-inspect'), true); assert.equal(await disabled('refresh-artifacts'), true); assert.equal(await disabled('stop-run'), true);
  assert.ok(!(await js('[...document.querySelectorAll("#backend-action option")].map(option=>option.value)')).includes('artifact.open'));
  check('initial workflow explains prerequisites and never exposes page-only methods in the backend workbench');
  const automaticStart = calls.length; await click('run-all'); await until(() => disabled('run-all').then(value => !value), 'one-click suite');
  assert.match(await content('suite-status'), /本轮完成/); assert.match(await content('suite-status'), /失败 0/);
  assert.ok(calls.slice(automaticStart).some(row => row.transport === 'backend' && row.action === 'connector.describe'));
  assert.ok(calls.slice(automaticStart).every(row => !['assistant.chat', 'assistant.execute', 'connector.invoke', 'desktop.chat.open', 'desktop.copilot.open', 'desktop.copilot.close', 'desktop.theme.set'].includes(row.action)));
  assert.match(await content('suite-results'), /需手动/); assert.match(await content('suite-results'), /预留/);
  await pause(100); fs.writeFileSync(path.join(output, 'one-click.png'), (await win.webContents.capturePage()).toPNG());
  check('one-click checks page/backend inventories and HTTP/WS through the real gateway without invoking manual UI or model methods');
  const before = calls.length; await click('run-page'); await until(() => disabled('run-page').then(value => !value), 'read-only self check');
  assert.equal(await cardStatus('connector.describe'), 'passed'); assert.equal(await cardStatus('kanban.issues.get'), 'passed');
  assert.equal(await cardStatus('skill.list'), 'passed'); assert.equal(await cardStatus('skill.describe'), 'passed'); assert.equal(await cardStatus('desktop.window.close'), 'reserved');
  assert.ok(calls.slice(before).every(row => !['assistant.chat', 'assistant.execute', 'connector.invoke', 'desktop.theme.set'].includes(row.action)));
  assert.equal(await js('document.querySelectorAll(".method-status[data-status=failed]").length'), 0);
  check('read-only self check uses real inventory IDs, skips absent fixtures and performs no model calls or writes');
  await js('const editor=document.querySelector(\'[data-method="kanban.issues.get"] textarea\');editor.value=JSON.stringify({issueId:"stale-manual-id"});editor.dispatchEvent(new Event("input"))');
  await cardClick('kanban.issues.list');
  await until(()=>js('JSON.parse(document.querySelector(\'[data-method="kanban.issues.get"] textarea\').value).issueId === "issue-1"'), 'issue list replaces edited stale ID');
  await setValue('kanban-selection', 'issue-2');
  assert.equal(await js('JSON.parse(document.querySelector(\'[data-method="kanban.issues.get"] textarea\').value).issueId'), 'issue-2');
  await cardClick('kanban.issues.get'); await until(()=>cardStatus('kanban.issues.get').then(status=>status==='passed'), 'selected issue details');
  assert.equal(calls.filter(row=>row.action==='kanban.issues.get').at(-1).args.issueId,'issue-2');
  assert.match(await js('document.querySelector(\'[data-method="kanban.issues.get"] .output\').textContent'), /Second issue/);
  check('all results display inline and issue list/selection updates edited get parameters before the real request');
  const skillCalls = calls.filter(row=>row.action==='skill.list').length;
  assert.equal(manifest.copilot,undefined);
  await click('skill-load');await until(()=>calls.filter(row=>row.action==='skill.list').length>skillCalls&&!win.isDestroyed(),'actual skill list call');
  await until(()=>disabled('skill-describe').then(value=>!value),'skills loaded without package references');
  await setValue('skill-selection','installed-report');
  assert.equal(await js('JSON.parse(document.querySelector(\'[data-method="skill.describe"] textarea\').value).skillId'),'installed-report');
  await click('skill-describe');await until(()=>js('document.querySelector(\'[data-method="skill.describe"] .output\').textContent.includes("Read reports")'),'selected skill metadata');
  assert.equal(await js('document.querySelector(\'[data-method="skill.describe"] .output\').getBoundingClientRect().height>0'),true);
  assert.equal(await disabled('skill-load'),false);
  await js('document.getElementById("skill").scrollIntoView()');await pause(50);fs.writeFileSync(path.join(output,'skill-inline.png'),(await win.webContents.capturePage()).toPNG());
  await click('load-skills');await until(()=>content('chat-text').then(value=>value.includes('已读取 2 项技能')),'workspace skill discovery');
  assert.equal(await js('[...document.getElementById("chat-skills").options].every(option=>option.disabled)'),true);
  check('skill load invokes real SDK methods in the default package, selects actual IDs and displays details without expanding');
  empty = true; await click('run-page'); await until(() => disabled('run-page').then(value => !value), 'empty inventory');
  assert.equal(await disabled('connector-describe'), true); assert.equal(await cardStatus('connector.describe'), 'skipped'); empty = false;
  assert.equal(await js('JSON.parse(document.querySelector(\'[data-method="kanban.issues.get"] textarea\').value).issueId'), '');
  await click('connector-load'); await until(() => disabled('connector-describe').then(value => !value), 'connector inventory');
  await click('connector-describe'); await until(() => cardStatus('connector.describe').then(value => value === 'passed'), 'connector metadata');
  await cardClick('connector.invoke'); await until(() => cardStatus('connector.invoke').then(value => value === 'passed'), 'connector execution');
  connectorExit = 7; await cardClick('connector.invoke'); await until(() => cardStatus('connector.invoke').then(value => value === 'business-failed'), 'connector nonzero exit'); connectorExit = 0;
  check('resource selectors populate dependent parameters and nonzero connector exits are not counted as success');
  await cardClick('assistant.image'); await until(() => cardStatus('assistant.image').then(value => value === 'passed'), 'image example request');
  for (const method of nativePaths.filter(method => method !== 'desktop.microphone.getPermission')) { await cardClick(method); await until(() => cardStatus(method).then(value => value === (['desktop.browser.openExternal', 'desktop.clipboard.writeText', 'desktop.notification.show'].includes(method) ? 'observe' : 'passed')), method); }
  check('page SDK sends complete image requests and native calls reach actual handlers without opening real OS dialogs');
  await click('chat-sync'); await until(() => disabled('chat-sync').then(value => !value), 'sync chat');
  assert.match(await content('chat-text'), /连接成功/); assert.equal(await disabled('stop-run'), true);
  const plainChat = [...chats.values()].at(-1).chatId;
  await click('chat-history'); await until(() => cardStatus('desktop.chat.open').then(value => value === 'observe'), 'chat history receipt');
  assert.equal(calls.filter(row => row.action === 'desktop.chat.open').at(-1).args.chatId, plainChat);
  for (const action of ['desktop.copilot.open', 'desktop.copilot.open', 'desktop.copilot.close', 'desktop.copilot.close']) { const before = calls.filter(row => row.action === action).length; await cardClick(action); await until(async () => calls.filter(row => row.action === action).length > before && await cardStatus(action) === 'observe', action); }
  check('history shortcut and repeated Copilot buttons use the page SDK and leave their UI effect pending human observation');

  await click('refresh-artifacts'); await until(() => content('artifact-readiness').then(value => value.includes('尚无已发布文件')), 'empty artifacts');
  assert.equal(await disabled('artifact-inspect'), true); assert.equal(chats.get(plainChat).published, false);
  check('ordinary chat IDs are real but do not fabricate files or unlock artifact reads');
  await click('prepare-artifacts'); await until(() => content('workflow-result').then(value => value.includes('发布清单已验证')), 'artifact preparation');
  const preparedChat = [...chats.values()].find(chat => chat.wantsFiles).chatId;
  assert.equal(await js('document.getElementById("artifact-chat").value'), preparedChat);
  await click('artifact-inspect'); await until(() => content('artifact-result').then(value => value.includes('总额 128')), 'artifact metadata and content');
  await click('more-artifacts'); await until(() => js('document.getElementById("artifact-choice").options.length===2'), 'artifact pagination');
  const second = files(chats.get(preparedChat))[1]; await setValue('artifact-choice', JSON.stringify([second.runId, second.artifactId]));
  await click('artifact-inspect'); await until(() => content('artifact-result').then(value => value.includes(second.runId) && value.includes('128')), 'exact second run');
  await click('artifact-preview'); await until(() => content('artifact-result').then(value => value.includes('opened')), 'preview');
  await click('artifact-save'); await until(() => content('artifact-result').then(value => value.includes('saved')), 'save');
  await click('artifact-to-execute');
  assert.equal(await js('JSON.parse(document.getElementById("execute-input").value).source.chatId'), preparedChat);
  assert.equal(await js('JSON.parse(document.getElementById("execute-input").value).text'), second.text);
  check('one explicit preparation creates and publishes files before list, pagination, exact Run selection, content, preview and save tests');
  await click('chat-background'); await until(() => cardStatus('assistant.subscribe').then(value => value === 'passed'), 'background completion');
  holdEvents = true; const eventsBefore = calls.filter(row => row.action === 'assistant.events').length;
  await click('chat-background'); await until(() => calls.filter(row => row.action === 'assistant.events').length > eventsBefore, 'pending subscription');
  assert.equal(await disabled('chat-sync'), true); assert.equal(await disabled('execute-run'), true);
  const stopBefore = calls.filter(row => row.action === 'assistant.stop').length;
  await click('abort-subscription'); await until(() => cardStatus('assistant.subscribe').then(value => value === 'skipped'), 'unsubscribe');
  assert.equal(calls.filter(row => row.action === 'assistant.stop').length, stopBefore);
  holdEvents = false; await click('stop-run'); await until(() => calls.filter(row => row.action === 'assistant.stop').length > stopBefore, 'stop');
  check('background Run controls only use returned background identities; unsubscribe does not stop a Run');
  await click('execute-run'); await until(() => disabled('execute-run').then(value => !value), 'unsupported execute');
  assert.match(await content('execute-result'), /请选择.*Native Agent/);
  const { writeWebappUserConfigValues } = require(path.join(desktop, 'dist-electron/main/modules/webs/webapps/store.js'));
  assert.equal(writeWebappUserConfigValues(app, manifest.id, { agent: 'executor' }).ok, true); selectedAgent = 'executor';
  await click('agent-refresh'); await until(() => content('agent-status').then(value => value.includes('executor')), 'configured agent');
  await click('execute-run'); await until(() => disabled('execute-run').then(value => !value), 'execute'); assert.match(await content('execute-result'), /128/);
  assert.equal(await js('document.getElementById("artifact-chat").value'), preparedChat);
  await click('artifact-inspect'); await until(() => content('artifact-result').then(value => value.includes(second.runId)), 'preserved artifact identity');
  const executedChat = [...chats.keys()].find(id => id.startsWith('execute-'));
  await click('execute-history'); await until(() => calls.filter(row => row.action === 'desktop.chat.open').at(-1)?.args.chatId === executedChat, 'execute history identity');
  await setValue('artifact-chat', executedChat); await click('refresh-artifacts'); await until(() => content('artifact-readiness').then(value => value.includes('尚无已发布文件')), 'execute without artifacts');
  assert.equal(await disabled('artifact-inspect'), true);
  await setValue('artifact-chat', preparedChat); assert.equal(await disabled('artifact-inspect'), false);
  const countExecute = calls.filter(row => row.action === 'assistant.execute').length; holdExecute = true;
  await click('execute-run'); await until(() => calls.filter(row => row.action === 'assistant.execute').length > countExecute, 'pending execute');
  await click('execute-cancel'); await until(() => disabled('execute-run').then(value => !value), 'execute cancellation'); await until(() => cancelledExecutions > 0, 'upstream cancelled'); holdExecute = false;
  await setValue('execute-input', ''); await click('execute-run'); await until(() => disabled('execute-run').then(value => !value), 'optional execute input');
  assert.equal(Object.hasOwn(calls.filter(row => row.action === 'assistant.execute').at(-1).args, 'input'), false);
  check('execute preserves selected published Chat, cannot manufacture artifacts, and cancellation disconnects the real SDK request');
  await setValue('agent-channel', 'backend'); assert.equal(await disabled('chat-sync'), true);
  await js('document.getElementById("agent-backend-writes").checked=true;document.getElementById("agent-backend-writes").dispatchEvent(new Event("change"))');
  assert.equal(await js('document.getElementById("backend-writes").checked'), true);
  await click('artifact-inspect'); await until(() => calls.some(row => row.transport === 'backend' && row.action === 'artifact.read' && row.args.chatId === preparedChat), 'backend reading page chat');
  await click('chat-background'); await until(() => cardStatus('assistant.subscribe').then(value => value === 'passed'), 'backend background');
  await click('execute-run'); await until(() => disabled('execute-run').then(value => !value), 'backend execute'); assert.match(await content('execute-result'), /128/);
  await click('backend-read-check'); await until(() => disabled('backend-read-check').then(value => !value), 'backend inventory');
  assert.equal(await cardStatus('skill.list'),'passed');
  await setValue('skill-selection','installed-report');await click('skill-describe');
  await until(()=>calls.some(row=>row.transport==='backend'&&row.action==='skill.describe'&&row.args.skillId==='installed-report'),'backend skill detail');
  await setValue('backend-action','kanban.issues.get');
  await js('const input=document.getElementById("backend-args");input.value=JSON.stringify({issueId:"old-backend-id"});input.dispatchEvent(new Event("input"))');
  await cardClick('kanban.issues.list');
  await until(()=>js('JSON.parse(document.getElementById("backend-args").value).issueId === "issue-1"'),'backend list updates edited get ID');
  await setValue('kanban-selection','issue-2');
  assert.equal(await js('JSON.parse(document.getElementById("backend-args").value).issueId'),'issue-2');
  await click('backend-call');await until(()=>disabled('backend-call').then(value=>!value),'backend get selected issue');
  assert.equal(calls.filter(row=>row.transport==='backend'&&row.action==='kanban.issues.get').at(-1).args.issueId,'issue-2');
  await click('backend-env'); await until(() => content('backend-result').then(value => value.includes('presence')), 'backend environment');
  assert.ok(!(await content('backend-result')).includes('synthetic-backend-grant'));
  await click('prepare-artifacts'); await until(() => content('workflow-result').then(value => value.includes('发布清单已验证') && !value.includes('running')), 'backend artifact preparation');
  const backendPrepared = [...chats.values()].filter(chat => chat.wantsFiles).at(-1).chatId;
  await click('artifact-inspect'); await until(() => calls.some(row => row.transport === 'backend' && row.action === 'artifact.read' && row.args.chatId === backendPrepared), 'backend prepared content');
  await click('artifact-preview'); await until(() => calls.some(row => row.transport === 'page' && row.action === 'artifact.open' && row.args.chatId === backendPrepared), 'page preview of backend chat');
  assert.ok(calls.filter(row => row.action.startsWith('assistant.agents.')).every(row => row.action === 'assistant.agents.list'));
  check('both SDKs share only app-owned Chat results; backend preparation can be read and previewed via the page without new host interfaces');
  await click('ws-connect'); await until(() => content('ws-state').then(value => value === '已连接'), 'WS connected');
  await click('ws-send'); await until(() => content('ws-result').then(value => value.includes('收到：Hello')), 'WS echo'); await click('ws-close'); await until(() => content('ws-state').then(value => value === '已关闭'), 'WS closed');
  check('HTTP backend and WebSocket transport retain real gateway behavior');
  for (const [width, height] of [[1440, 1080], [1000, 900], [640, 900]]) {
    win.setContentSize(width, height); await pause(100); assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'no overflow ' + width);
    await js('document.getElementById("workflow").scrollIntoView()'); await pause(50); fs.writeFileSync(path.join(output, 'workflow-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  win.setContentSize(1440, 1080); await cardClick('desktop.theme.set'); await until(() => js('document.documentElement.dataset.theme === "dark"'), 'dark theme');
  fs.writeFileSync(path.join(output, 'workflow-dark.png'), (await win.webContents.capturePage()).toPNG());
  check('guided workflow renders without overflow at desktop, narrow and mobile widths in light/dark themes');
  let download; win.webContents.session.once('will-download', (_event, item) => { const file = path.join(output, 'report.json'); item.setSavePath(file); download = new Promise((resolve, reject) => item.once('done', (_e, status) => status === 'completed' ? resolve(file) : reject(Error(status)))); });
  await click('export-report'); await until(() => !!download, 'report download'); const report = JSON.parse(fs.readFileSync(await download));
  assert.equal(report.contract.sdkSha256.length, 64); assert.equal(report.workflow, undefined); assert.equal(report.events, undefined); assert.equal(report.includesDetails, false); assert.ok(report.oneClickTest.checks.some(check => check.method === 'desktop.chat.open' && !check.executed)); assert.ok(report.records.every(record => !('result' in record) && !('request' in record) && !('error' in record))); assert.ok(!JSON.stringify(report).includes('synthetic-backend-grant'));
  check('default report includes the complete test plan and diagnostics while excluding business bodies and backend credentials');
  assert.deepEqual(await js('[...document.querySelectorAll("#navigation a")].slice(0,4).map(e=>e.textContent)'), ['00总览','01准备','02智能体','03连接器']);
  assert.equal(await js('document.querySelectorAll(".nav-help").length===document.querySelectorAll("#navigation a").length'),true);
  for(const group of ['overview','workflow','assistant','connector','skill','artifact','kanban','config','appearance','native','auth','reserved','backend']) {
    await js(`document.querySelector('.nav-help[data-menu="${group}"]').click()`);
    assert.equal(await js('document.getElementById("menu-help-dialog").open'),true);
    assert.ok((await content('menu-help-body')).includes('.'));
    await click('menu-help-close');
  }
  await js('document.querySelector(".nav-help[data-menu=assistant]").click()');
  assert.match(await content('menu-help-body'), /assistant.agents.list/);assert.match(await content('menu-help-body'), /agentKey/);
  fs.writeFileSync(path.join(output,'bridge-menu-help.png'),(await win.webContents.capturePage()).toPNG());await click('menu-help-close');
  await setValue('assistant-agent','executor');
  await click('execute-run');await until(()=>disabled('execute-run').then(value=>!value),'explicit agent execute');
  assert.ok(calls.some(row=>row.action==='assistant.execute'&&row.args.agentKey==='executor'));
  await setValue('assistant-agent','');
  check('ordered menu help dialogs describe bridge parameters and selected Agent reaches new execute requests');
  const preview = createLabServer({ preview: true, frontendRoot: path.join(bundle, 'frontend') }); const previewOrigin = await listen(preview);
  await win.loadURL(previewOrigin); await until(() => js('document.body.dataset.ready === "true"'), 'preview ready');
  assert.equal(await js('document.body.dataset.disconnected'), 'true'); assert.equal(await disabled('prepare-artifacts'), true); await preview.closeLab();
  check('ordinary browser preview provides no fabricated SDK, chats or artifacts');
  assert.deepEqual(fixtureErrors, []); assert.equal(errors.filter(message => !/404|Failed to load resource/.test(message)).length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(output, 'smoke.json'), JSON.stringify({ checks, calls, output, platform: process.platform }, null, 2)); console.log('Smoke evidence: ' + output);
}).then(async () => { await cleanup(); app.exit(0); }).catch(async error => {
  console.error(error); console.error('Evidence: ' + output); console.error('Fixture errors: ' + fixtureErrors.join('\n'));
  if (win && !win.isDestroyed()) { try { fs.writeFileSync(path.join(output, 'failure-dom.json'), JSON.stringify(await js('({text:document.body.innerText,states:[...document.querySelectorAll("button[id]")].map(e=>({id:e.id,disabled:e.disabled}))})'), null, 2)); } catch {} }
  await cleanup(); app.exit(1);
});
async function cleanup() { clearTimeout(watchdog); for (const timer of timers) clearTimeout(timer); win?.destroy(); await gateway?.close(); await backend?.closeLab(); if (bridge) { bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve)); } }
