import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../backend/store.mjs';
test('legacy JSON imports transactionally once, preserving originals and authenticated ownership',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'auth-lab-migrate-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const owner='a'.repeat(64),legacy={ [owner]:{text:'old note',revision:2,updatedAt:'2026-11-10T00:00:00.000Z'}};
 await writeFile(path.join(directory,'notes.json'),JSON.stringify(legacy));
 let store=await createStore(directory);
 assert.equal(store.list(owner)[0].text,'old note');assert.equal(store.list('b'.repeat(64))[0].isMine,false);assert.equal(store.list('b'.repeat(64))[0].author,'历史便签');assert.equal(store.list(owner)[0].isMine,true);
 store.add({id:owner,name:'Alice',subject:'alice'},'new note');
 store.add({id:'b'.repeat(64),name:'Alice',subject:'other-alice'},'same name, different owner');
 assert.equal(store.list(owner)[0].isMine,false);assert.equal(store.list('b'.repeat(64))[0].isMine,true);await store.close();
 store=await createStore(directory);assert.equal(store.list(owner).length,3);await store.close();
 assert.deepEqual(JSON.parse(await readFile(path.join(directory,'notes.json'),'utf8')),legacy);
});
