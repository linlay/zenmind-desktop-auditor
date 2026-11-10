import { createSession, acceptQuery, uploadRequest, queryRequest } from './session.mjs';
const $ = id => document.getElementById(id);
const state = createSession(); let sdk, observation, execution, pending = false, execChatId = "", currentReply;
const help = {
 prepare: ['agent.list()', '返回 {items:[{agentKey,name,role}],defaultAgentKey}。默认选择沿用宿主配置；目录不证明 Agent 支持执行或图像工具。'],
 query: ['agent.query / agent.execute', 'query({message,agentKey?,chatId?,uploadIds?,background?})\n默认等待文本结果；background:true 返回 accepted/chatId/runId。\nexecute({message,input?,outputSchema,agentKey?},{signal?})\n等待 result_submit，返回 success/output 或 failure/reason。不会自动重试。'],
 run: ['agent.observe / interrupt / steer / send / submit', 'observe({runId,cursor?},{signal?}) 是轮询精简事件的异步迭代器。256 条事件 / 128 Run / 30 分钟；游标过期报错，不重发 query。\ninterrupt({runId}) 中断；解除观察仅停止消费。\nsteer({runId,message,steerId?}) 插入活动 Run。\nsend({runId,message,requestId}) 可插入或排队，回执不代表执行完成。\nsubmit({runId,awaitingId,submitId,param}) 提交等待项；不替换根 Agent。\n不支持跨实例或宿主重启 attach。'],
 files: ['agent.upload / resource.read / artifact', 'upload({file:Blob,chatId?,agentKey?}) 单文件 64 MiB；无 Chat 时 Platform 创建 canonical chatId。\nresource.read({chatId,file}) Chat 相对路径，最多 16 MiB。\nartifact.list/get/read/open/saveAs 仅访问本实例 Chat 的已发布产物。read/saveAs 当前最多 1 MiB。\n@chat 路径不是 artifactId。蒙版只是输入文件，不是通用编辑指令。']
};
function log(value) { $('log').textContent = (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n' + $('log').textContent.slice(0, 16000); }
function identity() { $('identity').textContent = `Chat: ${state.chatId || '—'} / Run: ${state.runId || '—'} / cursor: ${state.cursor}`; $('agent').disabled = !!state.chatId; }
async function call(method, args = {}, signal) {
 if (!sdk) throw Error('请在支持 agent Bridge 的 Desktop 中打开');
 if ($('transport').value === 'backend') {
  const response = await fetch('/api/agent', { method:'POST', headers:{'Content-Type':'application/json','X-Agent-Lab':'1'}, body:JSON.stringify({method,args}), signal });
  const value = await response.json(); if (!value.ok) throw Object.assign(Error(value.error.message), value.error); return value.result;
 }
 return sdk.agent[method](args, { signal });
}
function action(id, handler) { $(id).onclick = async () => { try { await handler(); } catch(error) { log({action:id,code:error.code || 'error',message:error.message}); } }; }
async function refresh() {
 const result = await call('list'); const execSelected=$('exec-agent').value; $('exec-agent').replaceChildren(new Option('宿主默认','')); for(const item of result.items)$('exec-agent').add(new Option(`${item.name} (${item.role})`,item.agentKey)); $('exec-agent').value=execSelected; const selected = $('agent').value; $('agent').replaceChildren(new Option('宿主默认',''));
 for (const item of result.items) $('agent').add(new Option(`${item.name} (${item.role})`,item.agentKey));
 $('agent').value = selected; $('default').textContent = `宿主默认：${result.defaultAgentKey}`; log(result);
}
action('refresh',refresh);
action('request',async()=>{
 if (pending) return; pending=true; $('request').disabled=true;
 try {
  const mode=$('mode').value; bubble('user',$('message').value); currentReply=bubble('assistant','正在请求…'); if(mode==='execute' && (state.chatId || state.uploads.length)) throw Error('结构化执行请先新建对话；当前 Bridge 不接受附件');
  const agentKey=$('agent').value || undefined; execution=new AbortController();
  const args=mode==='execute'?{message:$('message').value,input:JSON.parse($('input').value),outputSchema:JSON.parse($('schema').value),...(agentKey?{agentKey}:{})}:queryRequest(state,$('message').value,agentKey,mode==='background');
  const result=await call(mode==='execute'?'execute':'query',args,execution.signal);
  observation?.abort(); acceptQuery(state,result); state.agentKey=agentKey; $('answer').textContent=JSON.stringify(result,null,2); currentReply.textContent=result.text || '请求已受理，正在等待输出…'; identity(); log(result); if(result.accepted) $('observe').click();
 } catch(error){if(currentReply)currentReply.textContent=`请求失败：${error.code || error.message}`;throw error;} finally {pending=false;$('request').disabled=false;execution=undefined;}
});
action('cancel',async()=>execution?.abort());
action('new',async()=>{if(pending)throw Error('请求进行中');observation?.abort();Object.assign(state,createSession());identity();$('uploads').textContent='暂无附件';$('events').textContent='暂无事件';$('conversation').replaceChildren();currentReply=undefined;});
action('upload',async()=>{if(pending)throw Error('请求进行中');if(state.uploads.length>=16)throw Error('每次请求最多 16 个附件');const file=$('file').files[0];if(!file)throw Error('请选择单个文件');pending=true;$('upload').disabled=true;try{const result=await sdk.agent.upload(uploadRequest(state,file,$('agent').value));state.chatId=result.chatId;state.uploads.push(result.upload.id);$('uploads').textContent=`待发送附件 ${state.uploads.length} 个：${result.upload.name}`;identity();log(result);}finally{pending=false;$('upload').disabled=false;}});
action('observe',async()=>{if(!state.runId)throw Error('先提交后台 Run');observation?.abort();const controller=new AbortController();observation=controller;$('events').textContent='';try{for await(const event of sdk.agent.observe({runId:state.runId,cursor:state.cursor},{signal:controller.signal})){state.cursor=event.cursor;$('events').textContent+=JSON.stringify(event)+'\n';if(event.text){$('answer').textContent+=event.text;if(currentReply){if(currentReply.dataset.waiting!=='no'){currentReply.textContent='';currentReply.dataset.waiting='no';}currentReply.textContent+=event.text;}}if(event.awaitingId)$('awaiting').value=event.awaitingId;identity();}}catch(error){if(!controller.signal.aborted)throw error;}});
action('detach',async()=>observation?.abort());
for(const method of ['interrupt','steer','send','submit'])action(method,async()=>{if(!state.runId)throw Error('当前没有后台 Run');const args={runId:state.runId};if(['steer','send'].includes(method))args.message=$('control-message').value;if(method==='send')args.requestId=crypto.randomUUID();if(method==='submit')Object.assign(args,{awaitingId:$('awaiting').value,submitId:crypto.randomUUID(),param:JSON.parse($('param').value)});log(await call(method,args));});
action('history',async()=>{if(!state.chatId)throw Error('当前没有 Chat');log(await sdk.desktop.chat.open({chatId:state.chatId}));});
action('read',async()=>{const stream=await sdk.agent.resource.read({chatId:state.chatId,file:$('resource').value});const blob=await new Response(stream).blob();download(blob,$('resource').value.split('/').at(-1));log({bytes:blob.size});});
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name || 'resource';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
action('artifacts',async()=>{const args={chatId:state.chatId,...(state.runId?{runId:state.runId}:{})};const result=await sdk.artifact.list(args);$('artifact-list').replaceChildren();for(const item of result.items){const li=document.createElement('li');li.textContent=item.name || item.artifactId;for(const method of ['get','read','open','saveAs']){const button=document.createElement('button');button.textContent=method;button.onclick=async()=>{try{const value=await sdk.artifact[method]({...args,artifactId:item.artifactId});if(method==='read')download(await new Response(value).blob(),item.name);else log(value);}catch(error){log({code:error.code,message:error.message});}};li.append(button);}$('artifact-list').append(li);}log(result);});
for(const button of document.querySelectorAll('[data-help]'))button.onclick=()=>{const [title,text]=help[button.dataset.help];$('help-title').textContent=title;$('help-text').textContent=text;$('help').showModal();};$('close-help').onclick=()=>$('help').close();


function bubble(role,text){const empty=$('conversation').querySelector('.empty');empty?.remove();const item=document.createElement('article');item.className='bubble '+role;const label=document.createElement('small');label.textContent=role==='user'?'你':'Agent';const content=document.createElement('div');content.textContent=text;item.append(label,content);$('conversation').append(item);item.scrollIntoView({block:'nearest'});return content;}
function showPage(name){if(!['chat','executor','run','files'].includes(name))name='chat';for(const section of document.querySelectorAll('[data-view]'))section.hidden=section.dataset.view!==name;for(const link of document.querySelectorAll('[data-page]')){link.classList.toggle('active',link.dataset.page===name);if(link.dataset.page===name)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}document.querySelector('header h2').textContent={chat:'与智能体一起完成任务',executor:'结构化执行工作台',run:'运行观察与控制',files:'附件与输出文件'}[name];}
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));showPage(location.hash.slice(1));
action('execute',async()=>{if(pending)throw Error('另一个请求进行中');pending=true;$('execute').disabled=true;execution=new AbortController();$('exec-result').textContent='执行中…';try{const agentKey=$('exec-agent').value || undefined;const result=await call('execute',{message:$('exec-message').value,input:JSON.parse($('input').value),outputSchema:JSON.parse($('schema').value),...(agentKey?{agentKey}:{})},execution.signal);execChatId=result.chatId;$('exec-result').textContent=JSON.stringify(result,null,2);log(result);}catch(error){$('exec-result').textContent=JSON.stringify({code:error.code,message:error.message},null,2);throw error;}finally{pending=false;execution=undefined;$('execute').disabled=false;}});
action('exec-history',async()=>{if(!execChatId)throw Error('尚无执行 Chat');await sdk.desktop.chat.open({chatId:execChatId});});
$('message').addEventListener('keydown',event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();$('request').click();}});

try{sdk=await import('/__desktop/bridge.js');if(!sdk.agent)throw Error('宿主尚不支持 agent 契约');$('status').textContent='Desktop Bridge 已连接';await refresh();}catch(error){$('status').textContent='预览 / 宿主不可用';log(error.message);}
