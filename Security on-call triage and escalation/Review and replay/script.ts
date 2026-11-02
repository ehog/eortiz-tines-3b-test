import {cfg,log,parse,requirePost,requireReviewer,response,routeError,db,all,createFixture,save,history,get,decide,now,enqueue} from './common';
log('request_started');
try {
 const r=parse(await Bun.stdin.text());requirePost(r);const actor=requireReviewer(r);const p=JSON.parse(r.body);const d=db(true);
 if(p.action==='replay'){
  if(typeof p.requestId!=='string'||! /^[a-zA-Z0-9_-]{8,64}$/.test(p.requestId))throw new Error('400:Valid replay requestId required');
  const id=`demo-${p.requestId}`;const old=get(d,id);if(old){response(200,{duplicate:true,item:old});}else{
   if(all(d).length>=cfg.maxItems)throw new Error('503:Queue capacity reached; archive records');
   const item=createFixture(p.scenario,id);save(d,item);history(d,'synthetic_replay',id,{actor,scenario:p.scenario});response(202,{itemId:id,mode:'simulation',statusUrl:`${process.env._3B_WORKFLOW_BASE_URL}/security-oncall/queue`});
  }
 }else if(p.action==='decide'){
  const item=get(d,p.itemId);if(!item)throw new Error('400:Unknown review item');if(item.mode==='live'&&!cfg.reviewers.includes(actor))throw new Error('403:Live reviewer not authorized');if(p.version!==item.version)throw new Error('409:Stale review; refresh the queue');response(200,{item:decide(d,item,p.decision,actor,p.rationale,'authenticated_console')});
 }else if(p.action==='expire_demo'){
  const item=get(d,p.itemId);if(!item||item.mode!=='simulation'||item.status!=='pending_review')throw new Error('409:Only pending synthetic reviews can be expired');item.reviewDueAt=new Date(Date.now()-1000).toISOString();save(d,item);history(d,'demo_deadline_expired',item.id,{actor});response(200,{item});
 }else throw new Error('400:Unsupported action');
 d.close();log('request_completed');
}catch(e){routeError(e);}
