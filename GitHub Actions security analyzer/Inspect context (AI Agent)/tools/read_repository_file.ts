import {tool} from 'ai';
import {z} from 'zod';
import {mkdirSync} from 'node:fs';
import {githubClient,safePath,encPath,log} from '../common';
import policy from '../policy.json';
let queue:Promise<unknown>=Promise.resolve();
export default tool({
 description:'Read a referenced repository file as inert text at an exact SHA; only reachable local context or explicitly referenced pinned actions are allowed. Never executes content.',
 inputSchema:z.object({repository:z.string(),sha:z.string().regex(/^[a-f0-9]{40}$/),path:z.string().max(400),reason:z.string().max(300)}),
 execute:async(args,options)=>{
  const previous=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await previous;
  try {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.repository)||args.repository.split('/').some(x=>x==='.'||x==='..'))return {error:'Invalid repository'};
  const {reviewId}=(options.experimental_context||{}) as any;
  if(!/^[a-f0-9]{64}$/.test(reviewId||''))return {error:'Missing review context'};
  if(!safePath(args.path))return {error:'Unsafe path'};
  const review=await Bun.file(`/storage/ghawa-evidence/${reviewId}.json`).json();
  const dir=`/storage/ghawa-agent/${reviewId}`;mkdirSync(dir,{recursive:true});const stateFile=Bun.file(`${dir}/reads.json`);const state=await stateFile.exists()?await stateFile.json():{attempts:0,reads:[],limitations:[]};
  async function save(){await Bun.write(`${dir}/reads.json`,JSON.stringify(state));}
  if(state.attempts>=policy.maxContextFiles)return {error:'Context read budget exhausted'};
  state.attempts++;await save();
  const sources=[...review.files.flatMap((f:any)=>[{text:f.before||'',sha:review.before,repository:review.repository,path:f.oldPath||f.path},{text:f.after||'',sha:review.after,repository:review.repository,path:f.path}]),...state.reads.map((x:any)=>({...x,text:x.content}))];
  let allowed=false;
  for(const s of sources){
   if(s.repository===args.repository&&s.sha===args.sha){const normalized=args.path.replace(/^\.\//,'');const direct=s.text.includes('./'+normalized)||s.text.includes(normalized);const dirAction=normalized.replace(/\/(action\.ya?ml|Dockerfile)$/,'');const localAction=dirAction!==normalized&&s.text.includes('./'+dirAction);const sibling=s.path?.replace(/[^/]+$/,'')+normalized.split('/').pop();const siblingRef=sibling===normalized&&s.text.includes(normalized.split('/').pop());if(direct||localAction||siblingRef)allowed=true;}
   const refs=[...s.text.matchAll(/\buses:\s*['"]?([\w.-]+\/[\w.-]+)(\/[^\s'"@]+)?@([a-f0-9]{40})/g)];
   for(const match of refs){const repo=match[1],sub=(match[2]||'').replace(/^\//,'');if(args.repository===repo&&args.sha===match[3]&&(args.path===sub||(sub?args.path.startsWith(sub+'/'):['action.yml','action.yaml','Dockerfile'].includes(args.path))))allowed=true;}
  }
  if(!allowed){state.limitations.push(`Blocked unreferenced or mutable context: ${args.repository}/${args.path}@${args.sha}`);await save();return {error:'Not reachable from inspected references at this exact SHA; mutable refs are not inspected.'};}
  try{const gh=githubClient(2);const d=(await gh(`/repos/${args.repository}/contents/${encPath(args.path)}?ref=${args.sha}`)).data;if(d.type!=='file'||d.encoding!=='base64'||d.size>policy.maxFileBytes)throw Error('File is binary, symlink, too large, or not available as text');const content=Buffer.from(d.content,'base64').toString('utf8');if(content.includes('\0'))throw Error('Binary content cannot be inspected');const read={...args,content};state.reads.push(read);await save();log('context_read_completed','Read inert repository context.',{count:state.reads.length});return {...read,untrusted:true};}catch(e){const error=String((e as Error).message);state.limitations.push(`${args.repository}/${args.path}@${args.sha}: ${error}`);await save();return {error};}
  } finally { release(); }
 }
});
