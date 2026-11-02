import {mkdir} from 'node:fs/promises';import {log,audit,safeId,redact} from './common';
const step='Send authorized Slack';log(step,'delivery_started');
try{const input=JSON.parse(await Bun.stdin.text());if(!input.deliveries?.length){log(step,'delivery_completed',{count:0,mode:'preview'});console.log(JSON.stringify({id:input.id,posted:0}));process.exit(0);}
const job=await Bun.file(`/storage/deployment_watch_jobs/${safeId(input.id)}/report.json`).json();
if(job.synthetic||job.mode!=='live'||job.config.notifications.mode!=='post'||job.config.notifications.postingAuthorized!==true)throw Error('Slack posting is not authorized');
await mkdir('/storage/deployment_watch_deliveries',{recursive:true});
let posted=0;
for(const d of input.deliveries){const deliveryId=safeId(d.deliveryId);const file=`/storage/deployment_watch_deliveries/${deliveryId}.json`;if(await Bun.file(file).exists()){log(step,'delivery_skipped',{deliveryId,reason:'Already finalized; reconcile before any resend'},'warn');continue;}
if(!job.deliveries.some((x:any)=>x.deliveryId===deliveryId&&x.text===d.text&&x.channel===d.channel))throw Error('Delivery does not match committed authorization');
let outcome:any={deliveryId,status:'unknown',reason:'Delivery outcome not confirmed'};
await audit(step,job.id,'slack_delivery','attempted',{deliveryId});
try{const started=Date.now();const res=await fetch('https://slack.com/api/chat.postMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:d.channel,text:d.text.slice(0,12000),client_msg_id:deliveryId,unfurl_links:false,unfurl_media:false,parse:'none'}),signal:AbortSignal.timeout(10000)});log(step,'source_request',{host:'slack.com',status:res.status,duration_ms:Date.now()-started});if(res.ok){const body=await res.json();outcome=body.ok?{deliveryId,status:'sent',ts:body.ts,channel:d.channel}:{deliveryId,status:'failed',reason:redact(body.error)};if(body.ok)posted++;}else outcome={deliveryId,status:res.status===429?'failed':'unknown',reason:`Slack HTTP ${res.status}; no automatic retry to prevent duplicate messages`};}catch(e:any){outcome={deliveryId,status:'unknown',reason:redact(e.message)};}
await Bun.write(file,JSON.stringify({...outcome,operationId:job.id,completedAt:new Date().toISOString()}));await audit(step,job.id,'slack_delivery',outcome.status==='sent'?'success':'failure',{deliveryId,status:outcome.status});if(outcome.status!=='sent')log(step,'delivery_degraded',{deliveryId,status:outcome.status},'warn');}
log(step,'delivery_completed',{posted});console.log(JSON.stringify({id:job.id,posted}));
}catch(e:any){log(step,'delivery_failed',{reason:redact(e.message)},'error');throw e;}
