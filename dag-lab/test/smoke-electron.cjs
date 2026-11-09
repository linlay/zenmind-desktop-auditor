const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const http = require('node:http'); const assert = require('node:assert/strict'); const { pathToFileURL } = require('node:url');
const root = process.env.DAG_LAB_PROJECT, desktop = process.env.DAG_LAB_DESKTOP;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-lab-smoke-')); app.setPath('userData', path.join(output, 'electron-profile')); app.on('window-all-closed', () => {});
let win, bridge, backend, gateway, preview, hold = false, execution = 0, cancelled = 0; const calls = [], errors = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source, true);
const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
const text = id => js(`document.getElementById(${JSON.stringify(id)}).textContent`);
const value = (id, value) => js(`{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));}`);
async function until(fn, label) { const limit = Date.now() + 15000; while (Date.now() < limit) { if (await fn()) return; await pause(40); } throw Error('Timed out: ' + label); }
const check = name => { checks.push(name); console.log('PASS ' + name); };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const watchdog = setTimeout(() => { console.error('Smoke exceeded 90 seconds'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'build/bundle.json'))), bundle = path.join(root, 'build', index.packagePath), manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'webapp.json')));
  const { createServer } = await import(pathToFileURL(path.join(bundle, 'backend/server.mjs')));
  bridge = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks)); calls.push(input);
      assert.ok(['Bearer synthetic-dag-page', 'Bearer synthetic-dag-backend'].includes(req.headers.authorization));
      let result;
      if (input.action === 'desktop.theme.get') result = { themeMode: 'light', resolvedTheme: 'light' };
      else if (input.action === 'desktop.chat.open') result = { chatId: input.args.chatId, status: 'opened' };
      else if (input.action === 'assistant.execute') {
        assert.equal(req.headers.authorization, 'Bearer synthetic-dag-backend'); assert.equal(input.args.agentKey, undefined); assert.equal(input.args.skillIds, undefined); assert.equal(input.args.outputSchema.type, 'object'); execution++;
        if (hold) { res.on('close', () => { cancelled++; }); return; }
        result = { chatId: 'dag-fixture-chat-' + execution, status: 'success', output: { summary: input.args.message.includes('执行建议') || input.args.input.upstream.merge ? '综合执行建议' : input.args.message.includes('实施风险') ? '两周工期存在风险' : '核心需求已提取', items: ['真实传输结果-' + execution] } };
      } else throw Error('Unexpected action: ' + input.action);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result }));
    } catch (error) { errors.push(error.stack); if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { code: 'fixture_error', message: error.message } })); } }
  });
  const bridgeOrigin = await listen(bridge);
  backend = await createServer({ directory: path.join(output, 'data'), env: { DESKTOP_ACTION_BRIDGE_URL: bridgeOrigin + '/webapps', DESKTOP_ACTION_BRIDGE_TOKEN: 'synthetic-dag-backend' } });
  const backendOrigin = await listen(backend);
  const userPaths = require(path.join(desktop, 'dist-electron/main/infrastructure/filesystem/user-paths.js'));
  userPaths.getDesktopWebappStateRoot = (_, id) => path.join(output, 'webapp-state', id);
  userPaths.getDesktopWebappsDataRoot = () => path.dirname(bundle);
  userPaths.getDesktopWebappDataRoot = (_, id) => path.join(output, 'webapp-data', id);
  userPaths.getDesktopWebsConfigRoot = () => path.join(output, 'web-config');
  gateway = await require(path.join(desktop, 'dist-electron/main/modules/webs/webapps/gateway.js')).startWebappGateway({ app, item: { ...manifest, allowLanAccess: false }, webappDir: bundle, backendUrl: backendOrigin, pageActionToken: 'synthetic-dag-page', integrationPorts: { getConfiguredDesktopActionBridgePort: () => bridge.address().port } });
  win = new BrowserWindow({ show: false, width: 1520, height: 1100, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'dag-lab-smoke' } });
  win.webContents.on('console-message', event => { if ((event.level === 'error' || event.level === 3) && !/404|Failed to load resource/.test(event.message)) errors.push(event.message); });
  await win.loadURL(gateway.webUrl); await until(() => js('document.body.dataset.ready === "true"'), 'initial UI');
  assert.equal(await js('document.querySelectorAll(".dag-node").length'), 6); assert.equal(await js('document.getElementById("run").disabled'), false);
  check('installed WebApp loads its node editor and official page SDK through the real Desktop Gateway');
  await click('run'); await until(() => js('document.getElementById("run-status").dataset.status === "succeeded"'), 'Agent DAG result');
  assert.equal(execution, 3); const executions = calls.filter(call => call.action === 'assistant.execute'); assert.ok(executions[2].args.input.upstream.merge.extract); assert.ok(executions[2].args.input.upstream.merge.risks);
  assert.match(await text('run-output'), /综合执行建议/); assert.equal(backend.store.value.runs.length, 1);
  await js('document.querySelectorAll(".run-node")[2].click()'); await js('document.querySelector("#run-output button").click()'); await until(() => calls.some(call => call.action === 'desktop.chat.open'), 'node chat history');
  assert.equal(calls.filter(call => call.action === 'desktop.chat.open').at(-1).args.chatId, 'dag-fixture-chat-1');
  await js('document.querySelectorAll(".run-node")[0].click()'); await click('fit'); await pause(120); fs.writeFileSync(path.join(output,'dag-success.png'),(await win.webContents.capturePage()).toPNG());
  check('three Agent nodes execute with real wire inputs, merged outputs and the exact returned Chat history identity');
  await win.reload(); await until(() => js('document.body.dataset.ready === "true"'), 'reload'); assert.equal(execution, 3); assert.equal(await js('document.querySelectorAll(".history-item").length'), 1);
  assert.equal(await js('document.getElementById("run-status").dataset.status'), 'succeeded');
  check('page reload restores saved workflow and run results without replaying Agent calls');
  // Real editor events alter prompt, dependencies, add/delete nodes and reject cycles.
  await js('document.querySelector(".dag-node[data-id=extract]").click()'); await value('node-label', '需求拆解（已修改）'); await value('agent-message', '仅依据 input.upstream 提取核心需求，使用 result_submit 返回 summary 和 items。'); await js('document.getElementById("node-form").requestSubmit()'); await click('save'); await until(() => text('save-state').then(value => value === '已保存'), 'save edits'); assert.equal(backend.store.value.graph.nodes.find(node => node.id === 'extract').label, '需求拆解（已修改）');
  const oldX = backend.store.value.graph.nodes.find(node => node.id === 'extract').x;
  const drag = await js('(()=>{const r=document.querySelector(".dag-node[data-id=extract] header").getBoundingClientRect();return {x:Math.round(r.x+45),y:Math.round(r.y+20)}})()');
  win.webContents.sendInputEvent({type:'mouseMove',x:drag.x,y:drag.y}); await pause(30); win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:drag.x,y:drag.y}); await pause(30); win.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x:drag.x+36,y:drag.y+24}); await pause(50); win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:drag.x+36,y:drag.y+24}); await pause(50); await click('save'); await until(()=>text('save-state').then(value=>value==='已保存'),'save drag');
  assert.ok(backend.store.value.graph.nodes.find(node=>node.id==='extract').x>oldX,'drag changes persisted node position');
  await js('document.querySelector(".dag-node[data-id=plan] .port.out").click();document.querySelector(".dag-node[data-id=extract] .port.in").click()'); assert.match(await text('notice'), /存在环/); assert.equal(backend.store.value.graph.edges.length, 6);
  await js('{const s=document.getElementById("add-node");s.value="merge";s.dispatchEvent(new Event("change"));}'); assert.equal(await js('document.querySelectorAll(".dag-node").length'), 7); await click('remove-node'); assert.equal(await js('document.querySelectorAll(".dag-node").length'), 6); await click('save'); await until(() => text('save-state').then(value => value === '已保存'), 'save deletion');
  check('node edits persist; port connections reject cycles; adding and deleting nodes updates the actual graph');
  await js('document.querySelector("[data-template=data]").click()'); await click('save'); await until(() => text('save-state').then(value => value === '已保存'), 'data template saved'); await click('run'); await until(() => js('document.getElementById("run-status").dataset.status === "succeeded" && document.getElementById("run-output").textContent.includes("12000")'), 'local data DAG'); assert.equal(execution, 3);
  check('the data-only DAG joins two real inputs without any Agent invocation');
  await js('document.querySelector("[data-template=review]").click()'); await click('save'); await until(() => text('save-state').then(value => value === '已保存'), 'review saved'); hold = true; await click('run'); await until(() => execution === 4, 'pending Agent'); await click('cancel'); await until(() => js('document.getElementById("run-status").dataset.status === "cancelled"'), 'cancelled DAG'); await until(() => cancelled > 0, 'SDK disconnected'); hold = false;
  assert.equal(backend.store.value.runs[0].nodes.risks.status, 'skipped');
  check('cancel disconnects the official backend execute request and skips all unstarted nodes');
  await js('document.querySelector(".history-item").click()'); await until(() => js('document.getElementById("workflow-name").readOnly'), 'history snapshot'); assert.equal(await js('document.getElementById("run").disabled'), true); await click('new-workflow'); assert.equal(await js('document.getElementById("workflow-name").readOnly'), false);
  check('run history snapshots are read-only and returning to the editor preserves the draft');
  // Import/export use actual browser File and Blob interfaces, with only the file picker replaced.
  await js(`{const file=new File([JSON.stringify({version:1,name:'invalid',nodes:[],edges:[{source:'missing',target:'other'}]})],'bad.json',{type:'application/json'});const dt=new DataTransfer();dt.items.add(file);document.getElementById('import-file').files=dt.files;document.getElementById('import-file').dispatchEvent(new Event('change'));}`); await until(() => text('notice').then(value => value.includes('导入失败')), 'invalid import'); assert.equal(await js('document.querySelectorAll(".dag-node").length'), 6);
  let download; win.webContents.session.once('will-download', (_event, item) => { const target = path.join(output, 'exported-workflow.json'); item.setSavePath(target); download = new Promise(resolve => item.once('done', (_e, status) => resolve(status === 'completed' ? target : null))); }); await click('export'); await until(() => !!download, 'workflow export'); const exported = JSON.parse(fs.readFileSync(await download)); assert.equal(exported.nodes.length, 6); assert.equal(exported.edges.length, 6); assert.ok(!JSON.stringify(exported).includes('synthetic-dag-backend'));
  const imported = { ...exported, name: '已导入的需求评审' };
  await js(`{const file=new File([${JSON.stringify(JSON.stringify(imported))}],'workflow.json',{type:'application/json'});const dt=new DataTransfer();dt.items.add(file);document.getElementById('import-file').files=dt.files;document.getElementById('import-file').dispatchEvent(new Event('change'));}`);
  await until(()=>js('document.getElementById("workflow-name").value === "已导入的需求评审"'),'valid imported workflow'); await click('save'); await until(()=>text('save-state').then(value=>value==='已保存'),'save imported graph'); assert.deepEqual(backend.store.value.graph.edges,exported.edges);
  await click('validate');
  check('invalid JSON workflows leave the current draft intact; exported workflows contain the actual graph and no bridge token');
  for (const [width, height] of [[1520,1100],[1050,900],[390,844]]) { win.setContentSize(width,height); await pause(100); assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'no outer overflow '+width); await click('fit'); await pause(80); fs.writeFileSync(path.join(output,'dag-'+width+'.png'),(await win.webContents.capturePage()).toPNG()); }
  win.setContentSize(1520,1100); await js('document.documentElement.dataset.theme="dark"'); await pause(100); fs.writeFileSync(path.join(output,'dag-dark.png'),(await win.webContents.capturePage()).toPNG());
  check('editor, node inspector and execution results fit desktop, narrow and mobile layouts');
  preview = await createServer({ directory: path.join(output,'preview-data'), preview:true, frontendRoot:path.join(bundle,'frontend'), env:{} }); const previewOrigin=await listen(preview); await win.loadURL(previewOrigin); await until(()=>js('document.body.dataset.ready === "true"'),'offline preview'); assert.equal(await js('document.getElementById("run").disabled'),true); await js('document.querySelector("[data-template=data]").click()'); await click('run'); await until(()=>js('document.getElementById("run-status").dataset.status === "succeeded"'),'offline data run'); assert.equal(execution,4);
  check('ordinary browser preview cannot run Agent nodes, but executes the real data-only workflow');
  assert.deepEqual(errors,[]); fs.writeFileSync(path.join(output,'smoke.json'),JSON.stringify({checks,platform:process.platform,execution,cancelled},null,2)); console.log('Smoke evidence: '+output);
}).then(async()=>{await cleanup();app.exit(0)}).catch(async error=>{console.error(error);console.error('Evidence: '+output);if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(output,'failure-dom.json'),JSON.stringify(await js('({text:document.body.innerText,buttons:[...document.querySelectorAll("button[id]")].map(e=>({id:e.id,disabled:e.disabled}))})'),null,2));}await cleanup();app.exit(1)});
async function cleanup(){clearTimeout(watchdog);win?.destroy();await preview?.shutdown();await gateway?.close();await backend?.shutdown();if(bridge){bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));}}
