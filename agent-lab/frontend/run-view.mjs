// Desktop places a trusted WebClient surface over this page-owned content region.
export function createRunView({container,sdk,onStatus=()=>{}}){
 let target='',viewId='',revision=0,frame=0,sending=false,last='',pending,epoch=0;
 const send=async()=>{
  if(sending||!pending)return;
  const input=pending;pending=undefined;sending=true;const generation=epoch;
  try{const bridge=sdk();if(typeof bridge.desktop?.chat?.embed!=='function')throw Error('请更新并重启支持页内聊天的 Desktop');
   const result=await bridge.desktop.chat.embed(input);
   if(generation===epoch && input.bounds){if(result?.chatId!==input.chatId || result.status!=='embedded')throw Error('宿主没有接受页内聊天');onStatus('WebClient 运行过程');}
  }catch(error){if(generation===epoch && input.bounds){if(error.code!=='webapp_ui_unavailable')container.hidden=true;last='';onStatus(error.message);};}
  finally{sending=false;if(pending)void send();}
 };
 const update=()=>{
  frame=0;if(!target)return;
  const rect=container.getBoundingClientRect();const visible=!document.hidden && container.getClientRects().length && rect.width>0 && rect.height>0 && rect.x+rect.width>0 && rect.y+rect.height>0 && rect.x<innerWidth && rect.y<innerHeight && !document.querySelector?.('dialog[open]');
  const bounds=visible?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight}:null;
  const key=JSON.stringify(bounds);if(key===last)return;last=key;
  pending={chatId:target,viewId,revision:++revision,bounds};void send();
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 const observer=new ResizeObserver(schedule);observer.observe(container);
 const mutations=typeof MutationObserver==='function'?new MutationObserver(schedule):null;mutations?.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['open']});
 window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);
 const hide=()=>{
  if(target){pending={chatId:target,viewId,revision:++revision,bounds:null};void send();}
  epoch++;target='';last='';container.hidden=true;
 };
 return {show(chatId){if(typeof chatId!=='string'||!chatId)throw Error('等待聊天返回 Chat');if(target!==chatId){hide();target=chatId;viewId=crypto.randomUUID();revision=0;}container.hidden=false;last='';schedule();},hide,destroy(){hide();observer.disconnect();mutations?.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);if(frame)cancelAnimationFrame(frame);}};
}
