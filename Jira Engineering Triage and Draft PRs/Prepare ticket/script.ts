import { readdir } from 'node:fs/promises';
import {start,done,input,cfg,api,jiraBase,plain,hash,readJob,saveJob,emit,failJob,audit,ROOT,log} from './common';
import fixtures from './fixtures.json';
start();const x=await input();if(x.stage==='terminal'){if(x.kind==='prepared'){if(!(x.remaining||[]).length)process.exit(0);}else{emit({...x,kind:'prepared',remaining:[]});process.exit(0);}}if(x.kind!=='intake'&&x.kind!=='prepared')process.exit(0);
let queue=x.kind==='prepared'?x.remaining||[]:x.keys||[x.key||x.fixture];if(!queue.length){done(0);process.exit(0);}const key=queue[0];const remaining=queue.slice(1);let j:any={id:x.source==='fixture'?x.id:hash(['jira',key]),kind:'prepared',source:x.source==='fixture'?'fixture':'jira',remaining,stage:'prepare'};
try{
 const existing=await readJob(j.id);if(existing&&existing.stage!=='queued'&&existing.outcome!=='skipped'){log('duplicate_skipped',{id:j.id},'warn');emit({...j,stage:'duplicate'});done(0);process.exit(0);}
 const count=await readdir(`${ROOT}/jobs`).catch(()=>[]);if(count.length>=cfg.maxStoredJobs)throw Error('Job capacity reached; archive completed records before intake');
 if(j.source==='fixture'){j.ticket=(fixtures.tickets as any)[key];if(!j.ticket)throw Error('Unknown fixture');j.repository={fixture:true,allowedPaths:cfg.fixtureAllowedPaths,files:fixtures.files,baseSha:hash(fixtures.files)};}
 else{
  if(cfg.sourceMode!=='jira')throw Error('Jira is disabled');if(!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))throw Error('Invalid issue key');const base=jiraBase();const r=await api(`${base}/rest/api/3/issue/${key}?fields=summary,description,labels,priority,project,issuelinks${cfg.acceptanceCriteriaField?','+encodeURIComponent(cfg.acceptanceCriteriaField):''}`);const f=r.fields;
  if(f.project.key!==cfg.jiraProject||!f.labels.includes(cfg.optInLabel)){if(existing)await saveJob({...j,stage:'terminal',outcome:'skipped',completedAt:new Date().toISOString(),ticket:{key,summary:'Not eligible: project or opt-in label mismatch'}});emit({...j,stage:'duplicate'});log('ticket_skipped',{key,reason:'Project or opt-in label mismatch'},'warn');done(0);process.exit(0);}
  const comments=await api(`${base}/rest/api/3/issue/${key}/comment?maxResults=${cfg.maxComments}&orderBy=-created`);
  const links=f.issuelinks||[];const linked=[];for(const l of links.slice(0,cfg.maxLinkedIssues)){const k=l.inwardIssue?.key||l.outwardIssue?.key;if(k){const li=await api(`${base}/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,description,status`);linked.push({key:k,summary:li.fields.summary,description:plain(li.fields.description).slice(0,4000),status:li.fields.status?.name});}}
  const description=plain(f.description);const ac=cfg.acceptanceCriteriaField?plain(f[cfg.acceptanceCriteriaField]):(description.match(/acceptance criteria[:\s]+([\s\S]*)/i)?.[1]||'');
  j.ticket={key,summary:f.summary,description:description.slice(0,12000),acceptanceCriteria:ac?[ac.slice(0,6000)]:[],comments:comments.comments.map((v:any)=>plain(v.body).slice(0,3000)),linkedIssues:linked,labels:f.labels,priority:f.priority?.name,url:`${base}/browse/${key}`,incompleteEvidence:comments.total>cfg.maxComments||comments.comments.some((v:any)=>plain(v.body).length>3000)||links.length>cfg.maxLinkedIssues||description.length>12000||ac.length>6000||linked.some((v:any)=>v.description.length>=4000)};
  const map=cfg.repositoryMappings[cfg.jiraProject];j.repository=map?{...map,fixture:false}:null;
 }
 if(!j.ticket.labels.includes(cfg.optInLabel)){emit({...j,stage:'duplicate'});process.exit(0);}
 j.createdAt=new Date().toISOString();j.stage='triage';j.mode=j.source==='fixture'?'fixture':cfg.liveWrites?'live':'dry-run';await saveJob(j);await audit('ticket_reserved',j.ticket.key,'success',{id:j.id,mode:j.mode});emit(j);done();
}catch(e){await failJob(j,e);await saveJob(j);await audit('intake_failed',j.id,'failure',{error:j.error});emit(j);}
