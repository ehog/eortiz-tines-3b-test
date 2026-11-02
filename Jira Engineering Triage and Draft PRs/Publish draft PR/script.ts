import {start,done,input,cfg,gh,emit,readJob,saveJob,audit,failJob,hash} from './common';
start();const j=await input();if(j.stage==='terminal'){emit(j);process.exit(0);}if(j.stage!=='publish'){done(0);process.exit(0);}
try{
 const branch=`agent-demo/${j.ticket.key.toLowerCase()}-${j.id.slice(0,12)}`;const marker=`3b-engineering:${j.id}`;
 const title=`[Draft] ${j.ticket.key}: ${j.proposal.summary}`.slice(0,220);
 const body=[`<!-- ${marker} -->`,`Ticket: ${j.ticket.url||j.ticket.key+' (synthetic; no Jira URL)'}`,'','## Change summary',j.proposal.summary,'','## Rationale',j.proposal.rationale,'','## Test evidence',`Status: **${j.tests.status}**`,...(j.tests.runs||[]).map((r:any)=>`- ${r.phase}; TZ=${r.timezone}; ${r.command}; ${r.status}; exit=${r.exitCode}; ${r.durationMs} ms`),j.tests.reason||'','',...(j.tests.runs||[]).map((r:any)=>`<details><summary>${r.phase} — ${r.timezone}</summary>\n\n\`\`\`text\n${r.output.replaceAll('```','~~~')}\n\`\`\`\n</details>`),'','## Limitations',...j.proposal.limitations.map((s:string)=>'- '+s),...(j.tests.limitations||[]).map((s:string)=>'- '+s),'- Only inspected dependency-free tests ran; full CI and product acceptance require human review.','- This PR must remain draft until a human approves it. No merge, deployment or ticket closure is automated.','','## Reviewer checklist','- [ ] Verify scope against acceptance criteria','- [ ] Review diff and unchanged regression tests','- [ ] Run full relevant CI in a safe environment','- [ ] Confirm no payment, security or deployment changes','- [ ] Approve manually before marking ready or merging'].join('\n');
 j.proposedPR={title,body,branch,draft:true,url:null};
 if(!cfg.liveWrites||j.source==='fixture'){
  j.outcome='proposed_draft_pr';j.stage='terminal';await audit('draft_pr_proposed',j.ticket.key,'success',{id:j.id,tests:j.tests.status});emit(j);done();process.exit(0);
 }
 if(j.tests.status!=='passed')throw Error('Live publication requires passed tests');
 const repo=j.repository.repo;const authorization=cfg.authorizedDemoRepositories.find((r:any)=>r.repo===repo&&r.authorized===true&&r.noPrivilegedExternalCI===true&&r.noProductionCredentials===true);if(!authorization)throw Error('Repository lacks explicit sandbox authorization');
 const actions=await gh(repo,'/actions/permissions');if(actions.enabled!==false)throw Error('GitHub Actions must be disabled before any push or PR creation');
 const meta=await gh(repo,'');if(meta.archived||meta.disabled)throw Error('Repository is not writable');if(branch===meta.default_branch||j.repository.defaultBranch!==meta.default_branch)throw Error('Default branch changed or unsafe target');
 const current=await gh(repo,`/git/ref/heads/${encodeURIComponent(meta.default_branch)}`);if(current.object.sha!==j.repository.baseSha)throw Error('Base branch moved; human review and fresh investigation required');
 let ledger=await readJob(j.id)||j;ledger.effects??={};
 const prs=await gh(repo,`/pulls?state=all&head=${encodeURIComponent(repo.split('/')[0]+':'+branch)}&per_page=100`);let pr=prs.find((p:any)=>p.body?.includes(marker));if(pr&&(!pr.draft||pr.state!=='open'))throw Error('Existing PR is no longer an open draft; human ownership prevents automation');
 if(!pr){
  const refs=await gh(repo,`/git/matching-refs/heads/${encodeURIComponent(branch)}`);const existing=refs.find((r:any)=>r.ref===`refs/heads/${branch}`);
  if(existing&&(!ledger.effects.commitSha||existing.object.sha!==ledger.effects.commitSha))throw Error('Existing branch does not match recorded agent commit; manual reconciliation required');
  if(!existing){
   if(ledger.effects.branchAttempted)throw Error('Uncertain prior branch creation; manual reconciliation required');
   let sha=ledger.effects.commitSha;
   if(!sha){const commit=await gh(repo,`/git/commits/${j.repository.baseSha}`);const tree=await gh(repo,'/git/trees','POST',{base_tree:commit.tree.sha,tree:j.proposal.changes.map((c:any)=>({path:c.path,mode:'100644',type:'blob',content:c.content}))});const c=await gh(repo,'/git/commits','POST',{message:`${j.ticket.key}: ${j.proposal.summary}\n\n${marker}`,tree:tree.sha,parents:[j.repository.baseSha]});sha=c.sha;ledger.effects.commitSha=sha;await saveJob(ledger);}
   ledger.effects.branchAttempted=true;await saveJob(ledger);await gh(repo,'/git/refs','POST',{ref:`refs/heads/${branch}`,sha});await audit('branch_created',repo+'@'+branch,'success',{id:j.id});
  }
  if(ledger.effects.prAttempted)throw Error('Uncertain prior PR creation; no duplicate POST allowed until reconciled');
  ledger.effects.prAttempted=true;await saveJob(ledger);
  pr=await gh(repo,'/pulls','POST',{title,body,head:branch,base:meta.default_branch,draft:true,maintainer_can_modify:false});await audit('draft_pr_created',repo,'success',{id:j.id,number:pr.number});
 }
 j.effects=ledger.effects;j.pr={url:pr.html_url,number:pr.number,draft:true,branch};j.stage='terminal';j.outcome='draft_pr_opened';await saveJob(j);emit(j);done();
}catch(e){const stored=await readJob(j.id);j.effects=stored?.effects||j.effects;await failJob(j,e);await saveJob(j);await audit('publication_failed',j.id,'failure',{error:j.error});emit(j);}
