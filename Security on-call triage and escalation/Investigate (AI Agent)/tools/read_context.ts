import {tool} from 'ai';
import {z} from 'zod';
import {mkdirSync} from 'node:fs';
import {cfg,db,get,request,redact,log} from '../common';
let calls=0;
export default tool({description:'Read an approved context source scoped to this incident and its alert time. No arbitrary URLs, mutations or queries.',inputSchema:z.object({source:z.string().max(80)}),execute:async({source},options)=>{
 if(++calls>4)return {unavailable:true,reason:'Per-turn tool budget reached'};
 const id=(options.experimental_context as any)?.itemId;if(!id)return {unavailable:true,reason:'Missing incident context'};const d=db();const item=get(d,id);d.close();
 if(source==='catalog')return {sources:cfg.enrichmentSources.map((s:any)=>({name:s.name,category:s.category})),constraints:{windowMinutes:60,maxResults:20},missing:cfg.enrichmentSources.length?[]:['No enrichment sources connected']};
 const s=cfg.enrichmentSources.find((s:any)=>s.name===source&&s.enabled===true);if(!s)return {unavailable:true,reason:'Source not approved'};
 try{const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Invalid source URL');u.searchParams.set('incident_id',item.incidentId);u.searchParams.set('service_id',item.service);u.searchParams.set('from',new Date(Date.parse(item.createdAt)-3600000).toISOString());u.searchParams.set('to',item.createdAt);u.searchParams.set('limit','20');const r=await request(u.href,{},2,5000);if(!Array.isArray(r.evidence))throw new Error('Invalid source contract');const evidence=r.evidence.slice(0,20).map((e:any,i:number)=>({id:`${source}:${i+1}`,source,text:redact(String(e.text)).slice(0,1200),kind:['benign','compromise','risk','gap'].includes(e.kind)?e.kind:'gap'}));const result={source,evidence,truncated:r.truncated===true||r.evidence.length>20,missingContext:typeof r.missingContext==='string'?redact(r.missingContext):null};const path=`/storage/security_oncall_transcripts/evidence/${id}`;mkdirSync(path,{recursive:true});await Bun.write(`${path}/${crypto.randomUUID()}.json`,JSON.stringify(result));log('enrichment_completed',{itemId:id,source,count:evidence.length});return result;
 }catch(e){log('enrichment_unavailable',{itemId:id,source},'warn');const result={unavailable:true,source,evidence:[],reason:'Source failed or exceeded bounds; evidence is missing'};const path=`/storage/security_oncall_transcripts/evidence/${id}`;mkdirSync(path,{recursive:true});await Bun.write(`${path}/${crypto.randomUUID()}.json`,JSON.stringify(result));return result;}
}});
