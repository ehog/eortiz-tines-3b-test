import { mkdir, appendFile } from 'node:fs/promises';
import settings from './settings.json';
export const cfg = settings as any;
export const ROOT='/storage/priceline-engineering';
export const step=(await Bun.file('./step-name.json').json()).name;
export function log(event:string,extra:any={},level='info'){console.error(JSON.stringify({ts:new Date().toISOString(),level,step,event,msg:event.replaceAll('_',' '),...extra}));}
export async function audit(action:string,target:string,outcome:string,detail:any={}){const ts=new Date().toISOString();await mkdir('/storage/audit',{recursive:true});await appendFile(`/storage/audit/${ts.slice(0,10)}.jsonl`,JSON.stringify({ts,workflow:'Jira Engineering Triage and Draft PRs',step,action,target,outcome,detail})+'\n');}
export function hash(x:unknown){return new Bun.CryptoHasher('sha256').update(JSON.stringify(x)).digest('hex').slice(0,32);}
export function unpack(raw:string){if(/^(?:HTTP\/|GET |POST )/.test(raw)){const at=raw.indexOf('\r\n\r\n');if(at<0)throw Error('Malformed HTTP input');return JSON.parse(raw.slice(at+4)||'{}');}return JSON.parse(raw||'{}');}
export function response(status:number,data:any){process.stdout.write(`HTTP/1.1 ${status} ${status===202?'Accepted':status===200?'OK':'Error'}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n${JSON.stringify(data)}`);}
export async function input(){return unpack(await Bun.stdin.text());}
export function emit(x:any){console.log(JSON.stringify(x));}
export async function readJob(id:string){if(!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid operation ID');const f=Bun.file(`${ROOT}/jobs/${id}.json`);return await f.exists()?f.json():null;}
export async function saveJob(x:any){await mkdir(`${ROOT}/jobs`,{recursive:true});await Bun.write(`${ROOT}/jobs/${x.id}.json`,JSON.stringify(x));}
export async function api(url:string,method='GET',body?:any){for(let n=0;n<3;n++){const t=Date.now();let r:Response;try{r=await fetch(url,{method,redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch(e){log('request_failed',{host:new URL(url).host,method,attempt:n+1},'error');if(method==='GET'&&n<2){await Bun.sleep(500*2**n);continue;}throw Error(`Network failure (${method}); reconcile before retry`);}log('request_completed',{host:new URL(url).host,endpoint:new URL(url).pathname,method,status:r.status,duration_ms:Date.now()-t});if(r.ok){const text=await r.text();if(text.length>3000000)throw Error('API response exceeds safety limit');return text?JSON.parse(text):{};}if(method==='GET'&&(r.status===429||r.status>=500)&&n<2){await Bun.sleep(Math.min(4000,Math.max(500*2**n,Number(r.headers.get('retry-after')||0)*1000))+Math.random()*150);continue;}throw Error(`API ${method} ${new URL(url).pathname}: ${r.status}`);}throw Error('Retry bound exceeded');}
export function jiraBase(){let d=process.env.JIRA_DOMAIN||'';if(d&&!d.startsWith('https://'))d='https://'+d;if(!/^https:\/\/[a-zA-Z0-9-]+\.atlassian\.net\/?$/.test(d))throw Error('Attach Jira connector with valid JIRA_DOMAIN');return d.replace(/\/$/,'');}
export function gh(repo:string,path:string,method='GET',body?:any){if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('Invalid configured repository');return api(`https://api.github.com/repos/${repo}${path}`,method,body);}
export function plain(x:any):string{if(typeof x==='string')return x;if(Array.isArray(x))return x.map(plain).join('\n');if(x&&typeof x==='object')return [x.text,...(x.content||[]).map(plain)].filter(Boolean).join(' ');return '';}
export function allowed(path:string,paths:string[]){return /^[\w./-]+$/.test(path)&&!path.split('/').some(x=>x==='..'||x.startsWith('.'))&&!/(^|\/)(package(-lock)?\.json|bun\.lock.*|.*\.ya?ml|.*\.env|.*lock|Dockerfile)$/i.test(path)&&!/(payment|auth|secret|deploy|billing|credential)/i.test(path)&&paths.some(p=>p.endsWith('/')?path.startsWith(p):path===p);}
export async function failJob(j:any,e:unknown){j.stage='terminal';j.outcome='failed';j.error=e instanceof Error?e.message:String(e);j.tests??={status:'not run',reason:'Pipeline stopped before test execution'};log('pipeline_failed',{id:j.id,error:j.error},'error');return j;}
export function start(){log('step_started');}
export function done(count=1){log('step_completed',{count});}
