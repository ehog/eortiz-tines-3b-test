import policy from './policy.json';
import {input,log,githubClient,isWorkflow,encPath,safePath} from './common';
import {fixtureEvidence} from './fixtures';
log('collect_started','Collecting immutable workflow evidence.');
const e=await input();
if(e.mode==='fixture'){const r=fixtureEvidence(e);log('collect_completed','Synthetic evidence collected.',{files:r.files.length});console.log(JSON.stringify(r));process.exit(0);}
const coverage:any={changeDetection:'complete',contents:'complete',agent:'not_started',limitations:[],notes:[]};
const result:any={...e,coverage,files:[],changedFiles:[],compare:{source:'GitHub compare + exact-SHA directory inventories'},contextInventory:[],findings:[],questions:[]};
const gh=githubClient(policy.maxApiCalls);const root=`/repos/${e.repository}`;
function gap(s:string,field='changeDetection'){coverage[field]='incomplete';coverage.limitations.push(s);log('coverage_degraded',s,{},'warn');}
const zero=(s:string)=>/^0{40}$/.test(s);
async function workflows(sha:string){if(zero(sha))return [];const commit=(await gh(`${root}/git/commits/${sha}`)).data;let tree=commit.tree.sha;for(const name of ['.github','workflows']){const r=(await gh(`${root}/git/trees/${tree}`)).data;if(r.truncated)gap(`Tree listing truncated at ${name} for ${sha}`);const node=r.tree.find((x:any)=>x.path===name);if(!node)return [];if(node.type!=='tree'){gap(`${name} is not a directory at ${sha}`);return [];}tree=node.sha;}const r=(await gh(`${root}/git/trees/${tree}`)).data;if(r.truncated)gap(`Workflow directory truncated at ${sha}`);return r.tree.filter((x:any)=>/^[^/]+\.ya?ml$/.test(x.path)).map((x:any)=>({...x,path:`.github/workflows/${x.path}`}));}
async function blob(n:any){if(!n)return '';if(n.type!=='blob'||n.mode==='120000'){gap(`Unsupported workflow object: ${n.path}`,'contents');return null;}if(n.size>policy.maxFileBytes){gap(`Workflow exceeds ${policy.maxFileBytes} bytes: ${n.path}`,'contents');return null;}const d=(await gh(`${root}/git/blobs/${n.sha}`)).data;if(d.encoding!=='base64'||d.size>policy.maxFileBytes){gap(`Unavailable workflow content: ${n.path}`,'contents');return null;}const text=Buffer.from(d.content,'base64').toString('utf8');if(text.includes('\0')){gap(`Binary workflow: ${n.path}`,'contents');return null;}return text;}
try {
 if(policy.mode!=='live'||!(policy.allowedRepositories as string[]).includes(e.repository))throw Error('Live collection is not enabled for this repository');
 let compareFiles:any[]=[];
 if(!zero(e.before)&&!zero(e.after)){
  try{let count=0;for(let page=1;page<=policy.maxComparePages;page++){const r=await gh(`${root}/compare/${e.before}...${e.after}?per_page=100&page=${page}`);const d=r.data;if(page===1){compareFiles=d.files||[];result.compare={...result.compare,status:d.status,totalCommits:d.total_commits,pages:1};if(compareFiles.length>=300)coverage.notes.push('Compare file list reached its 300-file cap; exact workflow directory inventories used instead.');if(e.forced||d.status==='diverged'||d.status==='behind')coverage.notes.push('Force/non-ancestor push: comparing exact endpoint snapshots, not the merge-base patch.');}count+=(d.commits||[]).length;result.compare.pages=page;if(count>=d.total_commits)break;if(page===policy.maxComparePages){coverage.notes.push('Compare commit pagination capped; endpoint workflow inventories still checked.');result.compare.commitHistoryComplete=false;}}}catch(err){gap(`Authoritative compare unavailable: ${(err as Error).message}`);}
 }else coverage.notes.push(e.deleted?'Deleted branch: inventory before SHA; no after commit to publish a check against.':'New branch: empty-ref baseline; report newly present workflows, not proof the code was newly authored.');
 const before=await workflows(e.before),after=await workflows(e.after);
 const b=new Map(before.map((n:any)=>[n.path,n])),a=new Map(after.map((n:any)=>[n.path,n]));
 const paths=[...new Set([...b.keys(),...a.keys()])] as string[];
 const changed=paths.filter(p=>(b.get(p) as any)?.sha!==(a.get(p) as any)?.sha);
 const selected=changed.slice(0,policy.maxWorkflowFiles);if(changed.length>selected.length)gap(`Workflow budget exceeded: ${selected.length} of ${changed.length} files inspected`,'contents');
 const renamedOld=new Set<string>();
 for(const p of selected){const renamed=(!e.forced&&result.compare.status==='ahead')?compareFiles.find((f:any)=>f.filename===p&&f.status==='renamed'&&isWorkflow(f.previous_filename)&&b.has(f.previous_filename)):null;const identicalMove=(!b.has(p)&&a.has(p))?before.find((n:any)=>!a.has(n.path)&&n.sha===(a.get(p) as any).sha):null;const oldPath=renamed?.previous_filename||identicalMove?.path||p;if(renamed||identicalMove)renamedOld.add(oldPath);let left:any=b.get(oldPath),right:any=a.get(p);const status=renamed||identicalMove?'renamed':!left?'added':!right?'removed':'modified';const item={path:p,oldPath,status,before:await blob(left),after:await blob(right)};result.files.push(item);}
 result.files=result.files.filter((f:any)=>!(f.status==='removed'&&renamedOld.has(f.path)));
 result.changedFiles=result.files.map((x:any)=>({path:x.path,oldPath:x.oldPath,status:x.status}));
 result.compare.workflowChanges=changed.length;
 coverage.notes.push('Diffs are reconstructed from full exact-SHA contents; missing or truncated API patches are not trusted. Changes to dependency-only files intentionally do not trigger review.');
}catch(err){gap(`Collection stopped: ${(err as Error).message}`,'contents');gap('Change detection could not be fully established.');}
log('collect_completed','Evidence collection completed.',{files:result.files.length,coverage:coverage.changeDetection});console.log(JSON.stringify(result));
