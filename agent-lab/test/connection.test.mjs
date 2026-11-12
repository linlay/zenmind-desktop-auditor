import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeConnection } from '../frontend/connection.mjs';
function fixture() { return {agent:Object.fromEntries(['list','query','execute','observe','interrupt','steer','send','submit','upload'].map(name=>[name,async args=>args])),}; }
function sdk() { const value=fixture();value.agent.resource={read:async()=>{}};return value; }
test('legacy assistant-only module never becomes ready or reaches query',async()=>{
 let calls=0;const bridge=createBridgeConnection(async()=>({assistant:{chat(){calls++;}}}));
 await assert.rejects(bridge.connect(),{code:'agent_bridge_upgrade_required'});
 assert.equal(bridge.available,false);assert.throws(()=>bridge.sdk.agent.query(),{code:'agent_bridge_unavailable'});assert.equal(calls,0);
});
test('missing preview transport reports an actionable error without publishing partial SDK',async()=>{
 const bridge=createBridgeConnection(async()=>{throw new TypeError('Failed to fetch');});
 await assert.rejects(bridge.connect(),{code:'agent_bridge_unavailable'});assert.equal(bridge.available,false);
});
test('validated agent SDK sends query and failed reconnect revokes the previous client',async()=>{
 let value=sdk();const bridge=createBridgeConnection(async()=>value);await bridge.connect();assert.equal(bridge.available,true);
 const input={message:'hello',background:true};assert.deepEqual(await bridge.sdk.agent.query(input),input);
 value={assistant:{}};await assert.rejects(bridge.connect(),{code:'agent_bridge_upgrade_required'});assert.equal(bridge.available,false);
});
test('partial agent surface is rejected before controls become available',async()=>{
 const value=sdk();delete value.agent.observe;const bridge=createBridgeConnection(async()=>value);
 await assert.rejects(bridge.connect(),{code:'agent_bridge_upgrade_required'});assert.equal(bridge.available,false);
});

test('changing Agent clears Chat, Run cursor and upload handles without reassigning existing Run',async()=>{
 const {createSession,selectSessionAgent,queryRequest}=await import('../frontend/session.mjs');
 const state={...createSession(),agentKey:'first',chatId:'chat',runId:'run',cursor:7,uploads:['u']};
 assert.equal(selectSessionAgent(state,'first'),false);assert.equal(state.chatId,'chat');
 assert.equal(selectSessionAgent(state,'second'),true);assert.equal(state.chatId,'');assert.equal(state.runId,'');assert.equal(state.cursor,0);assert.deepEqual(state.uploads,[]);
 assert.deepEqual(queryRequest(state,'hello',state.agentKey,true),{message:'hello',agentKey:'second',background:true});
});
