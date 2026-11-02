import {start,done,input,cfg,api,jiraBase,plain,readJob,saveJob,audit,log} from './common';
start();const j=await input();if(j.stage!=='terminal'){done(0);process.exit(0);}const stored=await readJob(j.id);j.effects={...stored?.effects,...j.effects};
try{
 const marker=`3b-engineering:${j.id}`;const summary=j.outcome==='human_review'?`Human engineering review required.\n${j.triage.rationale}\n${j.triage.questions.map((q:string)=>'* '+q).join('\n')}`:j.pr?`Draft pull request: [Review PR|${j.pr.url}]\n${j.proposal.summary}\nTests: ${j.tests.status}.\nTicket closure and PR merge remain with humans.`:j.outcome==='failed'?`Automation stopped: ${j.error}\nHuman review and reconciliation required before retry.`:`Dry-run proposal only; no GitHub branch or PR was created.\nTests: ${j.tests?.status||'not run'}.`;
 j.proposedJiraComment=`h3. Engineering agent result\n${summary}\n\n{{${marker}}}`;
 if(cfg.liveWrites&&j.source==='jira'){
  const base=jiraBase();let found=false;let complete=false;for(let page=0;page<10;page++){const r=await api(`${base}/rest/api/2/issue/${j.ticket.key}/comment?startAt=${page*100}&maxResults=100`);if(r.comments.some((c:any)=>plain(c.body).includes(marker))){found=true;break;}if(r.startAt+r.comments.length>=r.total){complete=true;break;}}
  if(!found&&!complete)throw Error('Cannot safely deduplicate comments: pagination bound exceeded');
  if(!found){if(j.effects.commentAttempted)throw Error('Uncertain prior comment write; manual reconciliation required');j.effects.commentAttempted=true;await saveJob(j);await api(`${base}/rest/api/2/issue/${j.ticket.key}/comment`,'POST',{body:j.proposedJiraComment});await audit('jira_comment_created',j.ticket.key,'success',{id:j.id});}
  j.jiraCommentStatus=found?'existing comment reused':'posted';
 }else j.jiraCommentStatus='proposed only; writes disabled';
 j.completedAt=new Date().toISOString();delete j.remaining;await saveJob(j);await audit('outcome_recorded',j.ticket?.key||j.id,j.outcome==='failed'?'failure':'success',{id:j.id,outcome:j.outcome,tests:j.tests?.status||'not run',toolCalls:j.agentActions?.length||0});console.log(JSON.stringify({id:j.id,outcome:j.outcome,tests:j.tests?.status||'not run',prUrl:j.pr?.url||null,jiraCommentStatus:j.jiraCommentStatus}));done();
}catch(e){j.reportingError=String(e);j.outcome='failed';j.completedAt=new Date().toISOString();await saveJob(j);await audit('report_failed',j.id,'failure',{error:String(e)});log('report_failed',{id:j.id,error:String(e)},'error');console.log(JSON.stringify({id:j.id,outcome:'failed',error:String(e)}));}
