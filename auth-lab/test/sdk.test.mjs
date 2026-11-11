import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auth} from '../frontend/auth-sdk.mjs';
test('packaged official SDK recognises either visitor brand without depending on publisher SDK',async t=>{
 const saved={z:globalThis.__ZENMIND_AUTH__,c:globalThis.__CUTEJ_AUTH__,fetch:globalThis.fetch};
 t.after(()=>{globalThis.__ZENMIND_AUTH__=saved.z;globalThis.__CUTEJ_AUTH__=saved.c;globalThis.fetch=saved.fetch});
 delete globalThis.__ZENMIND_AUTH__;delete globalThis.__CUTEJ_AUTH__;
 globalThis.fetch=()=>{throw Error('must not request publisher SDK or identity')};
 assert.equal(auth.isAvailable(),false);
 for(const key of ['__ZENMIND_AUTH__','__CUTEJ_AUTH__']) {
  let called=0;globalThis[key]={createSession:async input=>{called++;assert.deepEqual(input,{exchangePath:'/api/auth/desktop-session'});return {ok:true}}};
  assert.equal(auth.isAvailable(),true);assert.deepEqual(await auth.createSession({exchangePath:'/api/auth/desktop-session'}),{ok:true});assert.equal(called,1);delete globalThis[key];
 }
 const app=await readFile(new URL('../frontend/app.mjs',import.meta.url),'utf8');
 assert.ok(app.includes("import('./auth-sdk.mjs')"));assert.ok(!app.includes('/__desktop/bridge.js'));
});
