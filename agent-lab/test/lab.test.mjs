import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLabServer } from '../backend/server.mjs';
import { createSession,acceptQuery,queryRequest,uploadRequest } from '../frontend/session.mjs';
test('canonical upload Chat continues into query and accepted query consumes attachments',()=>{
 const state=createSession();assert.deepEqual(uploadRequest(state,'file','a'),{file:'file',agentKey:'a'});
 state.chatId='canonical';state.uploads=['upload'];assert.deepEqual(queryRequest(state,'hello','a',true),{message:'hello',background:true,agentKey:'a',chatId:'canonical',uploadIds:['upload']});
 acceptQuery(state,{chatId:'canonical',runId:'run',accepted:true});assert.equal(state.runId,'run');assert.deepEqual(state.uploads,[]);
});
test('backend rejects remote, cross origin and unlisted methods before SDK invocation',async t=>{
 let calls=0;const server=createLabServer({loadClient:()=>({agent:{list:async()=>{calls++;return {items:[],defaultAgentKey:'a'};}}})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const url=`http://127.0.0.1:${server.address().port}`;
 const request=(method,headers={})=>fetch(url+'/api/agent',{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Lab':'1',Origin:url,...headers},body:JSON.stringify({method,args:{}})});
 assert.equal((await request('list',{Origin:'https://evil.test'})).status,403);
 assert.equal((await request('list',{'X-Forwarded-Host':'evil.test'})).status,403);
 assert.equal((await request('image')).status,400);assert.equal((await request('stop')).status,400);assert.equal(calls,0);
 const response=await request('list');assert.equal(response.status,200);assert.equal((await response.json()).result.defaultAgentKey,'a');assert.equal(calls,1);
});
