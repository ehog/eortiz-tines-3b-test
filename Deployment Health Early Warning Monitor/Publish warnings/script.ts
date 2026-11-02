import {mkdir,readdir,rm,stat} from 'node:fs/promises';import {log,audit,redact,safeId} from './common';import {slackText,material} from './format';
const step='Publish warnings';log(step,'publication_started');
try{
 const result=JSON.parse(await Bun.stdin.text());if(result.status==='running'){log(step,'publication_completed',{status:'awaiting_agent'});process.exit(0);}
 const id=safeId(result.conversationId);const job=await Bun.file(`/storage/deployment_watch_jobs/${id}/assessed.json`).json();
 let investigation:any={kind:'unavailable',services:[]};let validInvestigation=false;
 try{if(result.status!=='done')throw Error('Agent failed or exhausted its budget');investigation=JSON.parse(result.text.replace(/^```json\s*|\s*```$/g,''));if(!Array.isArray(investigation.services))throw Error('Invalid agent result');for(const s of investigation.services){if(!job.assessments.some((a:any)=>a.service===s.service)||!Array.isArray(s.hypotheses)||!Array.isArray(s.recommendedChecks)||!Array.isArray(s.evidenceIds))throw Error('Invalid agent service result');const a=job.assessments.find((a:any)=>a.service===s.service);if(s.evidenceIds.some((e:any)=>!a.evidence.some((x:any)=>x.id===e)))throw Error('Unrecognized evidence reference');if([...s.hypotheses,...s.recommendedChecks,...s.evidenceIds].some(x=>typeof x!=='string')||!s.hypotheses.length||!s.recommendedChecks.length)throw Error('Invalid investigation text');}for(const s of investigation.services){const a=job.assessments.find((a:any)=>a.service===s.service);if(!job.synthetic&&job.config.agentEnabled){a.hypotheses=s.hypotheses.slice(0,3).map(redact);a.recommendedChecks=s.recommendedChecks.slice(0,5).map(redact);}}validInvestigation=true;}catch(e:any){job.warnings=[...(job.warnings??[]),'Investigation unavailable; deterministic assessment retained'];log(step,'investigation_degraded',{reason:redact(e.message)},'warn');}
 job.investigation={kind:job.synthetic?'synthetic-scripted':job.config.agentEnabled?(validInvestigation?'agent':'unavailable'):'deterministic-only',turns:result.turn,usage:result.totals};
 const root='/storage/deployment_watch_state';await mkdir(root,{recursive:true});const f=Bun.file(`${root}/state.json`);const state=await f.exists()?await f.json():{};const now=Date.now();
 for(const [k,v] of Object.entries(state) as any)if(now-v.updatedAt>job.config.limits.retentionDays*86400000)delete state[k];
 const outgoing:any[]=[];const rank:any={healthy:0,watch:1,investigate:2,urgent:3};
 for(const a of job.assessments){
 const key=JSON.stringify([job.mode,job.config.notifications.mode,job.config.notifications.postingAuthorized,job.config.notifications.channel,a.environment,a.service,a.id]);const old=state[key];if(old?.asOf&&Date.parse(old.asOf)>Date.parse(job.asOf)){a.notification={mode:'preview',decision:'suppressed_stale',text:slackText(a,job)};continue;}const changed=material(old?.assessment,a,job.config.thresholds);const recovery=a.severity==='healthy'&&old&&old.assessment.severity!=='healthy';const eligible=rank[a.severity]>=rank[job.config.notifications.minSeverity]||recovery;
 const text=slackText(a,job);a.notification={mode:'preview',decision:!eligible?'not_required':!changed?'suppressed_unchanged':recovery?'recovery':'new_or_changed',text};
 if(eligible&&changed){
 const posting=job.mode==='live'&&job.config.notifications.mode==='post'&&job.config.notifications.postingAuthorized===true&&/^C[A-Z0-9]+$/.test(job.config.notifications.channel??'');
 if(posting){const deliveryId=crypto.randomUUID();a.notification.mode='reserved';a.notification.deliveryId=deliveryId;outgoing.push({deliveryId,key,channel:job.config.notifications.channel,text});}
 state[key]={assessment:a,updatedAt:now,asOf:job.asOf,notification:a.notification};
 }else if(!old)state[key]={assessment:a,updatedAt:now,asOf:job.asOf,notification:a.notification};
 await audit(step,id,'warning_assessed',eligible&&changed?'success':'skipped',{service:a.service,severity:a.severity,health:a.health,decision:a.notification.decision,mode:a.notification.mode,synthetic:job.synthetic});
 }
 job.status='complete';job.completedAt=new Date().toISOString();job.deliveries=outgoing;delete job.deployments;
 await Bun.write(`${root}/state.json`,JSON.stringify(state));
 await Bun.write(`/storage/deployment_watch_jobs/${id}/report.json`,JSON.stringify(job));
 for(const name of await readdir('/storage/deployment_watch_jobs')){if(name===id||!/^[a-zA-Z0-9_-]+$/.test(name))continue;const path=`/storage/deployment_watch_jobs/${name}`;const info=await stat(path);if(now-info.mtimeMs>job.config.limits.retentionDays*86400000)await rm(path,{recursive:true,force:true});}
 log(step,'publication_completed',{run_id:id,count:job.assessments.length,deliveries:outgoing.length});console.log(JSON.stringify({id,deliveries:outgoing}));
}catch(e:any){log(step,'publication_failed',{reason:redact(e.message)},'error');throw e;}
