import {start,done,input,cfg,allowed,emit,failJob,log} from './common';
start();const result=await input();if(result.type!=='agent-run'||result.status==='running'){done(0);process.exit(0);}if(!/^[a-f0-9]{32}$/.test(result.conversationId))throw Error('Invalid conversation ID');let j:any;
try{const state=await Bun.file(`/storage/engineering-agent/${result.conversationId}.json`).json();j=state.job;j.agentActions=state.actions;j.usage=result.totals;
 if(result.status==='error')throw Error(result.error||'Agent failed');
 if(state.review){j.stage='terminal';j.outcome='human_review';j.triage.questions.push(...state.review.questions);j.tests={status:'not run',reason:'Agent requested human review'};emit(j);process.exit(0);}
 const p=state.proposal;if(!p)throw Error('Agent finished without a structured proposal');
 if(p.changes.length>cfg.maxFilesChanged||new TextEncoder().encode(JSON.stringify(p.changes)).length>cfg.maxPatchBytes)throw Error('Patch budget exceeded');
 const files:any={};for(const [path,v] of Object.entries(state.reads) as any)files[path]=v.content;
 for(const c of p.changes){if(!allowed(c.path,j.repository.allowedPaths)||!(c.path in files))throw Error('Patch path is not allowed or was not inspected');if(/(^|\/)(tests?|__tests__)\/|\.(test|spec)\./.test(c.path))throw Error('Existing tests cannot be changed');if(/\b(eval|require|fetch|WebSocket|XMLHttpRequest|process|Bun)\b|node:|child_process|https?:\/\//.test(c.content))throw Error('Proposed presentation code includes prohibited runtime or network capability');}
 if(!Object.keys(files).some(p=>/test|spec/.test(p)))throw Error('Missing test evidence');
 j.proposal=p;j.diff=p.changes.map((c:any)=>{const old=files[c.path].split('\n');const next=c.content.split('\n');return `--- a/${c.path}\n+++ b/${c.path}\n@@ -1,${old.length} +1,${next.length} @@\n`+old.map((v:string)=>'-'+v).join('\n')+'\n'+next.map((v:string)=>'+'+v).join('\n');}).join('\n');
 j.testInput={files,changes:p.changes};j.stage='test';emit(j);done();
}catch(e){j??={id:result.conversationId,ticket:{key:'AGENT',summary:'Agent investigation failed'}};await failJob(j,e);emit(j);}
