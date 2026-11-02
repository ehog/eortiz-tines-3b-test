import {runAgent} from './runtime/loop';
import {parsePriorRun} from './runtime/selfLoop';
import {startResponse} from './runtime/response';
import {transcriptPath,emptyUsage} from './runtime/transcript';
import {log,redact,safeId} from './common';
const step='Investigate changes (AI Agent)'; log(step,'investigation_started');
const raw=await Bun.stdin.text();const prior=parsePriorRun(raw);
if(prior&&prior.status!=='running'){log(step,'investigation_completed',{status:'self_loop_stopped'});process.exit(0);}
try{
 const job=prior?await Bun.file(`/storage/deployment_watch_jobs/${safeId(prior.conversationId)}/assessed.json`).json():JSON.parse(raw);
 function buildInput(){return {message:JSON.stringify({operationId:job.id,synthetic:job.synthetic,asOf:job.asOf,services:job.assessments.map((a:any)=>({service:a.service,severity:a.severity,missing:a.missing})),task:'Use read-only tools to investigate suspicious services, contrast baseline and current signals, and examine configured dependencies. Return the required JSON.'}),context:{job},conversationId:safeId(job.id)};}
 const input=buildInput();
 if(job.synthetic||!job.config.agentEnabled||!job.assessments.some((a:any)=>a.severity!=='healthy')){
 const reason=job.synthetic?'Synthetic scripted investigation; no model was called':!job.config.agentEnabled?'Live agent disabled; deterministic assessment only':'No suspicious services; agent not called';
 const text=JSON.stringify({kind:job.synthetic?'synthetic-scripted':'deterministic-only',services:job.assessments.map((a:any)=>({service:a.service,hypotheses:a.hypotheses,recommendedChecks:a.recommendedChecks,evidenceIds:a.evidence.map((e:any)=>e.id)})),note:reason});
 console.log(JSON.stringify({type:'agent-run',status:'done',conversationId:job.id,owner:'shared',turn:0,text,totals:emptyUsage()}));log(step,'investigation_completed',{run_id:job.id,mode:reason});process.exit(0);
 }
 const out=startResponse(false);out.event({type:'conversation',conversationId:input.conversationId,owner:'shared'});
 await runAgent({message:prior?null:input.message,context:input.context,transcriptFile:transcriptPath('shared',input.conversationId),out,interactive:false});
 log(step,'investigation_completed',{run_id:job.id});
}catch(e:any){log(step,'investigation_failed',{reason:redact(e.message)},'error');const parsed=JSON.parse(raw);console.log(JSON.stringify({type:'agent-run',status:'error',conversationId:prior?.conversationId??parsed.id,owner:'shared',turn:prior?.turn??0,text:'',error:redact(e.message),totals:emptyUsage()}));}
