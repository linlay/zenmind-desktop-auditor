import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const methods = new Set(['list','query','execute','interrupt','steer','send','submit']);
function json(res,status,value){if(!res.destroyed)res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));}
export function authorize(req){
 const authority=String(req.headers['x-forwarded-host'] || req.headers.host || '');
 let target;try{target=new URL('http://'+authority);}catch{throw Error('local_only');}
 if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.host!==authority||target.username||target.password||target.search||target.hash||target.pathname!=='/'||req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto']!=='http')throw Error('local_only');
 if(req.headers.origin!==target.origin || req.headers['x-agent-lab']!=='1'||req.headers['sec-fetch-site'] && req.headers['sec-fetch-site']!=='same-origin')throw Error('origin_forbidden');
}
export function createLabServer({loadClient,preview=false}={}){
 let clientPromise;
 const client=()=>clientPromise ||= Promise.resolve().then(async()=>{
  if(loadClient)return loadClient();
  const {createBackendClient}=await import('./bridge.mjs');
  return createBackendClient({url:process.env.DESKTOP_ACTION_BRIDGE_URL,token:process.env.DESKTOP_ACTION_BRIDGE_TOKEN});
 }).catch(error=>{clientPromise=undefined;throw error;});
 return http.createServer(async(req,res)=>{
  const controller=new AbortController();req.once('aborted',()=>controller.abort());res.once('close',()=>controller.abort());
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/health' && req.method==='GET')return json(res,200,{ok:true});
   if(url.pathname==='/api/agent' && req.method==='POST'){
    try{authorize(req);}catch(error){return json(res,403,{ok:false,error:{code:error.message,message:'请从本机 Desktop 同源页面调用'}});}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))return json(res,415,{ok:false,error:{code:'content_type',message:'Use JSON'}});
    let size=0;const chunks=[];for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>262144){req.resume();return json(res,413,{ok:false,error:{code:'body_too_large',message:'最多 256 KiB'}});}chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks));
    if(!body||Object.keys(body).some(key=>!['method','args'].includes(key))||!methods.has(body.method)||!body.args||typeof body.args!=='object'||Array.isArray(body.args))return json(res,400,{ok:false,error:{code:'invalid_args',message:'Unsupported method or arguments'}});
    const sdk=await client();const result=await sdk.agent[body.method](body.args,{signal:controller.signal});return json(res,200,{ok:true,result});
   }
   const files={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/session.mjs':'session.mjs','/connection.mjs':'connection.mjs','/run-view.mjs':'run-view.mjs','/styles.css':'styles.css'};
   if(preview && req.method==='GET' && Object.hasOwn(files,url.pathname)){const name=files[url.pathname];res.writeHead(200,{'Content-Type':name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff'});return res.end(await readFile(path.join(root,name)));}
   return json(res,404,{ok:false,error:{code:'not_found',message:'Not found'}});
  }catch(error){return json(res,400,{ok:false,error:{code:error.code || 'request_failed',message:error.message || 'Request failed'}});}
 });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createLabServer();server.listen(Number(process.env.PORT),process.env.HOST || '127.0.0.1');
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();server.closeAllConnections();});
}
