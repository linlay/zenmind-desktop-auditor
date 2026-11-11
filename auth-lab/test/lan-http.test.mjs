import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {lab,keys,token,desktopConfig} from './helpers.mjs';
import {AUTH_LAB_APP_ID,parseConfig} from '../backend/config.mjs';
import {loginState} from '../frontend/login-state.mjs';

test('HTTP LAN test mode supports visitor OneID and broker with exact origin binding',async t=>{
 const origin='http://192.168.1.8:54321',key=await keys();let nonce,brokerOrigin;
 const broker=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);
  assert.equal(input.callback,origin+'/api/auth/oidc/callback');assert.ok(input.verifier);assert.equal(input.appId,AUTH_LAB_APP_ID);
  const now=Math.floor(Date.now()/1000);res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({appId:input.appId,callback:input.callback,nonce,identity:{iss:brokerOrigin,sub:'synthetic-user',name:'Alice',iat:now,exp:now+600}}));
 });
 await new Promise(r=>broker.listen(0,'127.0.0.1',r));brokerOrigin='http://127.0.0.1:'+broker.address().port;
 t.after(()=>new Promise(r=>broker.close(r)));
 const app=await lab(t,desktopConfig(key,{allowPrivateHttpForTesting:true,broker:{origin:brokerOrigin,appId:AUTH_LAB_APP_ID}}));
 const headers={'x-forwarded-host':new URL(origin).host};
 const status=await(await app.request('/api/auth/status',{headers})).json();assert.equal(status.canonicalRequired,false);assert.equal(status.oidcLoginUrl,origin+'/api/auth/oidc/start');
 const start=await app.request('/api/auth/oidc/start',{headers}),target=new URL(start.headers.get('location'));assert.equal(start.status,303);assert.equal(target.searchParams.get('callback'),origin+'/api/auth/oidc/callback');nonce=target.searchParams.get('nonce');
 const tx=start.headers.get('set-cookie').split(';')[0];assert.ok(!start.headers.get('set-cookie').includes('Secure'));
 const callback='/api/auth/oidc/callback?code='+'a'.repeat(43)+'&state='+target.searchParams.get('state');
 const finished=await app.request(callback,{headers:{...headers,Cookie:tx}});assert.equal(finished.headers.get('location'),origin+'/');
 const brokerCookie=finished.headers.getSetCookie().find(v=>v.startsWith('zm_auth_lab_8')).split(';')[0];
 assert.equal((await(await app.request('/api/me',{headers:{...headers,Cookie:brokerCookie}})).json()).method,'broker');
 const direct=await app.request('/api/auth/desktop-session',{method:'POST',headers:{...headers,Origin:origin,Authorization:'Bearer '+await token(key.privateKey),'Content-Type':'application/json'},body:'{}'});assert.equal(direct.status,200);assert.ok(!direct.headers.get('set-cookie').includes('Secure'));
 const cookie=direct.headers.get('set-cookie').split(';')[0];assert.equal((await(await app.request('/api/me',{headers:{...headers,Cookie:cookie}})).json()).method,'desktop');
 assert.equal((await app.request('/api/me',{headers:{...headers,'x-forwarded-host':'192.168.1.9:54321',Cookie:cookie}})).status,401);
 assert.equal((await app.request('/api/auth/desktop-session',{method:'POST',headers:{...headers,Origin:'http://192.168.1.9:54321','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await app.request('/api/me',{headers:{'x-forwarded-host':'8.8.8.8:54321',Cookie:cookie}})).status,403);
});

test('disabled LAN authentication gives a clear UI state instead of an empty redirect',async t=>{
 const app=await lab(t,{broker:{origin:'https://broker.example.test',appId:AUTH_LAB_APP_ID}},{preview:true});
 const status=await(await app.request('/api/auth/status',{headers:{'x-forwarded-host':'192.168.1.8:54321'}})).json();assert.equal(status.canonicalRequired,true);assert.equal(status.oidcLoginUrl,'');
 const view=loginState(status,false,'http://192.168.1.8:54321');assert.equal(view.oidcLogin,false);assert.equal(view.desktopLogin,false);assert.equal(view.title,'当前地址无法登录');
 assert.throws(()=>parseConfig({allowPrivateHttpForTesting:'true'}));
 assert.throws(()=>parseConfig({allowPrivateHttpForTesting:true,publicOrigin:'http://8.8.8.8'}));
});
