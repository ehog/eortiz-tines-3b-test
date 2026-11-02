import {fixtures} from './fixtures';
import {live} from './live';
import {log,parseInput,redact} from './common';
const step='Collect evidence';log(step,'collection_started');
try{const raw=await Bun.stdin.text();if(/^HTTP\/\d\.\d [45]/.test(raw)){log(step,'collection_completed',{status:'rejected_input'});process.exit(0);}const input=parseInput(raw);const job=input.job??input;const data:any=job.mode==='fixtures'?fixtures(job.scenario,job.config):await live(job.config);for(const d of data.deployments){for(const p of ['baseline','current'])d.logs[p]=d.logs[p].map((r:any)=>({...r,signature:redact(r.signature),excerpt:redact(r.excerpt)}));}log(step,'collection_completed',{run_id:job.id,count:data.deployments.length,warnings:data.warnings?.length??0});console.log(JSON.stringify({...job,...data}));}catch(e:any){log(step,'collection_failed',{reason:redact(e.message)},'error');throw e;}
