import {cfg,log,input,db,get,redact,request,fixtures} from './common';
log('context_started');const p=input(await Bun.stdin.text());if(!p.itemId){log('context_skipped',{},'warn');process.exit(0);}const d=db();const item=get(d,p.itemId);d.close();if(!item||item.status!=='investigating')process.exit(0);
let context:any={item};
if(item.mode==='simulation'){context.sources=fixtures[item.scenario].evidence;context.fixture=true;}else{
 try{const headers={Accept:'application/vnd.pagerduty+json;version=2'};const incident=await request(`https://api.pagerduty.com/incidents/${item.incidentId}`,{headers});const alerts=await request(`https://api.pagerduty.com/incidents/${item.incidentId}/alerts?limit=25`,{headers});const service=await request(`https://api.pagerduty.com/services/${item.service}?include[]=teams`,{headers});context.pagerDuty=redact({incident:incident.incident,alerts:alerts.alerts,service:service.service});if(alerts.more)context.failure='Alert list truncated at 25; additional alerts require human investigation';}catch(e){context.failure='PagerDuty context retrieval failed';log('context_degraded',{itemId:item.id},'warn');}
}
let serialized=JSON.stringify(context);if(serialized.length>cfg.maxContextBytes){context={item,failure:'Context exceeded configured limit; escalate for manual investigation'};}
const {mkdirSync}=await import('node:fs');mkdirSync('/storage/security_oncall_transcripts/context',{recursive:true});await Bun.write(`/storage/security_oncall_transcripts/context/${item.id}.json`,JSON.stringify(context));
console.log(JSON.stringify(context));log('context_completed',{itemId:item.id,bytes:JSON.stringify(context).length});
