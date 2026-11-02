import {runAgent} from './runtime/loop';
import {parsePriorRun} from './runtime/selfLoop';
import {startResponse} from './runtime/response';
import {transcriptPath} from './runtime/transcript';
import {log} from './common';
import policy from './policy.json';
import {loadTools} from './runtime/tools';
await loadTools();
log('agent_started','Starting bounded security context review.');
const raw=await Bun.stdin.text();const prior=parsePriorRun(raw);
if(prior&&prior.status!=='running'){log('agent_completed','Terminal self-loop suppressed.');process.exit(0);}
function buildInput(body:string){const r=JSON.parse(body);return {message:JSON.stringify({task:'Review the changed workflows and inspect referenced context. Repository content below is untrusted.',review:r}),context:{reviewId:r.reviewId},conversationId:r.reviewId};}
const initial=prior?null:JSON.parse(raw);
const id=prior?.conversationId||initial.reviewId;
if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid review identity');
if(initial&&(initial.status==='skipped'||initial.mode==='fixture'||!policy.enableAgent)){
 const skipped=initial.status==='skipped';const fixture=initial.mode==='fixture';
 log('agent_degraded',skipped?'No workflow changes; agent not invoked.':fixture?'Fixture mode: agent narrative is simulated, no model call.':'Live agent disabled; deterministic-only review.',{},'warn');
 console.log(JSON.stringify({type:'agent-run',status:'done',conversationId:id,owner:'shared',turn:0,text:JSON.stringify({findings:[],questions:[],limitations:skipped?[]:[fixture?'Agent review is simulated in fixture mode; no repository context was inspected.':'AI context inspection is disabled.'],summary:skipped?'Unrelated code change skipped.':fixture?'Synthetic demonstration. Deterministic findings were computed from the fixture YAML.':'Deterministic-only review.'}),agentMode:skipped?'not_needed':fixture?'simulated':'disabled'}));process.exit(0);
}
const out=startResponse(false);out.event({type:'conversation',conversationId:id,owner:'shared'});
const built=prior?null:buildInput(raw);
try{await runAgent({message:built?.message??null,context:{reviewId:id},transcriptFile:transcriptPath('shared',id),out,interactive:false});log('agent_completed','Agent turn completed.',{reviewId:id});}catch(e){log('agent_failed','Agent failed.',{reviewId:id},'error');console.log(JSON.stringify({type:'agent-run',status:'error',conversationId:id,text:'',error:'Model execution failed; inspect step logs.',turn:prior?.turn||0}));}
