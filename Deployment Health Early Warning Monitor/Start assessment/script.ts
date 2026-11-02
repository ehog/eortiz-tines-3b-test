import settings from './settings.json';
import {mkdir} from 'node:fs/promises';
import {log,audit,http,parseInput} from './common';
const step='Start assessment'; log(step,'assessment_started');
const raw=await Bun.stdin.text(); const routed=/^[A-Z]+ \S+ HTTP\//.test(raw);
try {
  if(routed&&!raw.startsWith('POST ')){log(step,'assessment_completed',{status:'method_rejected'});http(405,{error:'Use POST to start a preview replay'});process.exit(0);}
  const input=parseInput(raw); const scenario=input.scenario??settings.defaultScenario;
  if(!['all','healthy','deteriorating','incomplete'].includes(scenario))throw Error('Invalid scenario');
  if(Object.keys(input).some(k=>!['scenario'].includes(k)))throw Error('Only scenario may be supplied; configuration is editor-managed');
  const c=structuredClone(settings) as any;
  if(routed)c.mode='fixtures';
  if(!['fixtures','live'].includes(c.mode))throw Error('Invalid source mode');
  if(c.mode==='fixtures')c.notifications.mode='preview';
  if(c.mode==='live'&&(!c.owner||!c.port.deploymentBlueprint||!c.port.serviceBlueprint||!c.services.length))throw Error('Live activation requires an accountable owner, Port blueprint mappings and explicit service mappings');
  if(c.notifications.mode==='post'&&(!c.notifications.postingAuthorized||!/^C[A-Z0-9]+$/.test(c.notifications.channel??'')))throw Error('Slack posting requires separate authorization and a valid channel ID');
  for(const v of Object.values(c.thresholds))if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Thresholds must be finite nonnegative numbers');
  for(const v of Object.values(c.windows))if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>1440)throw Error('Windows must be positive and at most 1440 minutes');
  if(c.limits.maxDeployments<1||c.limits.maxDeployments>12||c.limits.requestAttempts<1||c.limits.requestAttempts>3||c.limits.maxPortPages<1||c.limits.maxPortPages>3||c.limits.maxSignatures<1||c.limits.maxSignatures>20||c.limits.retentionDays<1||c.limits.retentionDays>14)throw Error('Configured limits exceed bounded capacity');
  for(const [key,max] of Object.entries({portPageSize:50,maxResponseBytes:1000000,requestTimeoutMs:8000,collectionDeadlineMs:210000,maxReadReports:30})){const v=c.limits[key];if(!Number.isInteger(v)||v<1||v>max)throw Error(`Invalid bounded limit: ${key}`);}
  if(!['preview','post'].includes(c.notifications.mode)||!['watch','investigate','urgent'].includes(c.notifications.minSeverity))throw Error('Invalid notification policy');
  const id=crypto.randomUUID(); const now=new Date().toISOString();
  const job={id,createdAt:now,status:'pending',scenario,mode:c.mode,config:c,synthetic:c.mode==='fixtures'};
  await mkdir(`/storage/deployment_watch_jobs/${id}`,{recursive:true});
  await Bun.write(`/storage/deployment_watch_jobs/${id}/job.json`,JSON.stringify(job));
  await audit(step,id,'assessment_requested','success',{mode:c.mode,scenario});
  log(step,'assessment_completed',{run_id:id,mode:c.mode});
  const statusUrl=new URL(`${process.env._3B_WORKFLOW_BASE_URL}/deployment-watch/data`).pathname+`?id=${id}`;
  if(routed)http(202,{operationId:id,statusUrl,job});else console.log(JSON.stringify(job));
}catch(e:any){log(step,'assessment_failed',{reason:e.message},'error');if(routed)http(400,{error:e.message});else throw e;}
