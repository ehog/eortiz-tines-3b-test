import { runAgent } from './runtime/loop';
import { parsePriorRun } from './runtime/selfLoop';
import { startResponse } from './runtime/response';
import { transcriptPath } from './runtime/transcript';
import { readHistory } from './runtime/transcript';
import { cfg, log, db, get, fixtureAssessment, failAssessment } from './common';
log('investigation_started');const raw=await Bun.stdin.text();const prior=parsePriorRun(raw);
if(prior&&prior.status!=='running'){log('investigation_loop_completed');process.exit(0);}
function buildInput(body:string){const p=JSON.parse(body);if(!p.item?.id)throw new Error('Missing investigation item');return {message:JSON.stringify({task:'Investigate this security incident using read-only tools. Return the exact structured assessment schema.',untrustedContext:p}),context:{itemId:p.item.id},conversationId:p.item.id};}
const initial=prior?null:buildInput(raw);const id=prior?.conversationId||initial!.conversationId;
const d=db();const item=get(d,id);d.close();if(!item||item.status!=='investigating'){log('investigation_skipped',{},'warn');process.exit(0);}
const out=startResponse(false);out.event({type:'conversation',conversationId:id,owner:'security-oncall'});
if(item.mode==='simulation'){
 const {appendRecords}=await import('./runtime/transcript');const a=fixtureAssessment(item);
 await appendRecords(transcriptPath('security-oncall',id),[{kind:'message',at:Date.now(),message:{role:'user',content:initial!.message}},{kind:'message',at:Date.now(),message:{role:'assistant',content:JSON.stringify({simulation:true,assessment:a})}}]);
 out.event({type:'done',turn:0,text:JSON.stringify(a),finishReason:'stop',totals:{inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0}});
}else{
 try{if(!cfg.liveEnabled||cfg.mode!=='live')throw new Error('Live investigation disabled');const contextInput=prior?JSON.parse((await readHistory(transcriptPath('security-oncall',id))).messages.find((m:any)=>m.role==='user')!.content as string).untrustedContext:JSON.parse(raw);if(contextInput.failure)throw new Error(contextInput.failure);
 await runAgent({message:initial?.message??null,context:{itemId:id},transcriptFile:transcriptPath('security-oncall',id),out,interactive:false});
 }catch(e){log('investigation_failed',{itemId:id},'error');out.event({type:'error',error:'Investigation unavailable'});out.event({type:'done',turn:0,text:JSON.stringify(failAssessment('Investigation failed')),totals:{inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0}});}
}log('investigation_completed',{itemId:id,mode:item.mode});
