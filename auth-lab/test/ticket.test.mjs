import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { lab } from './helpers.mjs';
import { parseConfig, AUTH_LAB_APP_ID } from '../backend/config.mjs';
test('Auth Lab refuses legacy credentials and accepts only public application configuration', () => {
 assert.throws(()=>parseConfig({oidc:{clientId:'forbidden',clientSecret:'forbidden'}}));
 assert.throws(()=>parseConfig({publicOrigin:'https://app.test',broker:{appId:AUTH_LAB_APP_ID,origin:'https://login.test',clientSecret:'forbidden'}}));
 assert.ok(parseConfig({publicOrigin:'https://app.test',broker:{appId:AUTH_LAB_APP_ID,origin:'https://login.test'}}).broker);
});
test('browser-bound ticket exchange verifies nonce/origin/app and rejects replay without client credentials',async t=>{
 let origin,nonce;
 const server=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;
  const value=JSON.parse(text);assert.deepEqual(Object.keys(value).sort(),['appId','callback','code','verifier']);
  assert.equal(req.headers.authorization,undefined);
  res.setHeader('content-type','application/json');
  const now=Math.floor(Date.now()/1000);
  res.end(JSON.stringify({appId:value.appId,callback:value.callback,nonce,identity:{iss:origin,sub:'verified-user',iat:now,exp:now+600,name:'Alice'}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const app=await lab(t,{publicOrigin:'http://127.0.0.1:44999',broker:{origin,appId:AUTH_LAB_APP_ID}});
 const start=await app.request('/api/auth/oidc/start'),url=new URL(start.headers.get('location'));
 assert.equal(url.pathname,'/api/login');assert.equal(url.searchParams.has('client_id'),false);nonce=url.searchParams.get('nonce');
 const callback='/api/auth/oidc/callback?code='+'a'.repeat(43)+'&state='+url.searchParams.get('state');
 const cookie=start.headers.get('set-cookie').split(';')[0];
 const finish=await app.request(callback,{headers:{Cookie:cookie}});assert.equal(finish.headers.get('location'),app.origin+'/');
 const session=finish.headers.getSetCookie().find(v=>v.startsWith('zm_auth_lab_8')).split(';')[0];
 assert.equal((await(await app.request('/api/me',{headers:{Cookie:session}})).json()).method,'broker');
 assert.match((await app.request(callback,{headers:{Cookie:cookie}})).headers.get('location'),/login_error/);
});

test('configuration migration removes synthetic old credentials without a backup and preserves Audience verification',async t=>{
 const {mkdtemp,writeFile,readFile,readdir,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {createHash}=await import('node:crypto');const {configureBroker}=await import('../scripts/configure-broker.mjs');
 const {keys}=await import('./helpers.mjs');const key=await keys();
 const dir=await mkdtemp(path.join(tmpdir(),'ticket-configure-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=path.join(dir,'incoming.json');
 await writeFile(source,JSON.stringify({publicOrigin:'https://app.test',broker:{origin:'https://login.test',appId:AUTH_LAB_APP_ID}}));
 await writeFile(path.join(dir,'auth-config.json'),JSON.stringify({oidc:{clientId:'synthetic-retired-id',clientSecret:'synthetic-retired-secret'},desktop:{issuer:'https://identity.test',audience:'synthetic-retired-id',publicKeyPem:key.pem}}));
 const result=await configureBroker({dataDirectory:dir,brokerFile:source});assert.equal(result.backup,'');
 const text=await readFile(path.join(dir,'auth-config.json'),'utf8'),saved=JSON.parse(text);
 assert.ok(!text.includes('synthetic-retired'));assert.equal(saved.oidc,undefined);
 assert.deepEqual(saved.desktop.audienceSha256,[createHash('sha256').update('synthetic-retired-id').digest('hex')]);
 assert.deepEqual((await readdir(dir)).sort(),['auth-config.json','incoming.json']);
});

test('an installed backend recovers when its external configuration is added after startup',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {createServer}=await import('../backend/server.mjs');const directory=await mkdtemp(path.join(tmpdir(),'auth-config-reload-test-'));
 const server=await createServer({directory});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await server.shutdown();await rm(directory,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port;
 let status=await(await fetch(origin+'/api/auth/status')).json();assert.equal(status.oidc,true);assert.equal(status.desktop,true);assert.equal(status.issue,'');assert.equal(status.oidcLoginUrl,origin+'/api/auth/oidc/start');
 const defaultStart=await fetch(origin+'/api/auth/oidc/start',{redirect:'manual'});const defaultTarget=new URL(defaultStart.headers.get('location'));assert.equal(defaultTarget.origin,'https://auth-test.zenmind.cc');assert.equal(defaultTarget.searchParams.get('callback'),origin+'/api/auth/oidc/callback');
 await writeFile(path.join(directory,'auth-config.json'),'{invalid');status=await(await fetch(origin+'/api/auth/status')).json();assert.equal(status.oidc,false);assert.ok(status.issue);
 await writeFile(path.join(directory,'auth-config.json'),JSON.stringify({publicOrigin:origin,broker:{origin:'https://broker.example.test',appId:AUTH_LAB_APP_ID}}));
 status=await(await fetch(origin+'/api/auth/status')).json();assert.equal(status.oidc,true);assert.equal(status.issue,'');assert.equal(status.oidcLoginUrl,origin+'/api/auth/oidc/start');
 await writeFile(path.join(directory,'auth-config.json'),'{}');status=await(await fetch(origin+'/api/auth/status')).json();assert.equal(status.oidc,false);
});
