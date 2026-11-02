import {request,getPath,httpsUrl,sourceLink,redact,log} from './common';
const step='Collect evidence';
const ident=(s:any)=>{if(typeof s!=='string'||! /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s))throw Error('Invalid configured field or index');return s;};
const literal=(s:any)=>{if(typeof s!=='string'||! /^[A-Za-z0-9_:./ -]{1,200}$/.test(s))throw Error('Invalid configured identifier value');return s;};
export async function live(c:any){
 const deadline=Date.now()+c.limits.collectionDeadlineMs;const asOf=new Date().toISOString(); const warnings:string[]=[];
 const json=async(url:string,init:any)=>JSON.parse(await request(url,init,c,step,deadline));
 const post=(body:any)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let deployments:any[]=[];
 try{
 const base=httpsUrl(c.port.baseUrl), bp=ident(c.port.deploymentBlueprint), sbp=ident(c.port.serviceBlueprint), f=c.port.deploymentFields, sf=c.port.serviceFields;
 for(const key of ['service','deployedAt','version','environment'])if(!f[key])throw Error(`Configure Port deploymentFields.${key}`);
 if(!sf.owner)throw Error('Configure Port serviceFields.owner');
 const schema=await json(`${base}/blueprints/${bp}`,{});if(!schema.blueprint)throw Error('Port deployment blueprint could not be verified');
 const dateProp=f.deployedAt.replace(/^properties\./,''); if(!f.deployedAt.startsWith('properties.')||!schema.blueprint.schema?.properties?.[dateProp])throw Error('Deployment timestamp mapping must reference an existing blueprint property');
 let from:any; let entities:any[]=[];
 for(let page=0;page<c.limits.maxPortPages;page++){
 const body:any={query:{combinator:'and',rules:[{property:dateProp,operator:'>=',value:new Date(Date.now()-c.windows.deploymentLookbackMinutes*60000).toISOString()}]},limit:c.limits.portPageSize};if(from)body.from=from;
 const result=await json(`${base}/blueprints/${bp}/entities/search`,post(body)); if(!Array.isArray(result.entities))throw Error('Unexpected Port entity response');entities.push(...result.entities);from=result.next;
 if(!from)break;if(page===c.limits.maxPortPages-1)warnings.push('Port page limit reached; deployment coverage incomplete');
 }
 entities=entities.filter(e=>String(getPath(e,f.environment))===c.environment).sort((a,b)=>Date.parse(getPath(b,f.deployedAt))-Date.parse(getPath(a,f.deployedAt)));
 if(entities.length>c.limits.maxDeployments)warnings.push('Deployment limit reached; additional deployments not evaluated');
 for(const e of entities.slice(0,c.limits.maxDeployments)){
 try{
 const service=String(getPath(e,f.service)); const deployedAt=new Date(getPath(e,f.deployedAt)).toISOString();if(Date.parse(deployedAt)>Date.now())throw Error('Future deployment timestamp');
 let owner='Unknown owner',dependencies:string[]=[];const missing:string[]=[];
 try{const s=await json(`${base}/blueprints/${sbp}/entities/${encodeURIComponent(service)}`,{});owner=redact(getPath(s.entity,sf.owner)||'Unknown owner');const ds=getPath(s.entity,sf.dependencies); dependencies=Array.isArray(ds)?ds.map(String).slice(0,20):[];if(owner==='Unknown owner')missing.push('Port ownership unavailable');}catch(err:any){missing.push(`Port ownership: ${redact(err.message)}`);}
 const end=Date.now()-c.windows.lagMinutes*60000;
 const start=Math.max(Date.parse(deployedAt),end-c.windows.currentMinutes*60000);
 const windows={baselineStart:new Date(Date.parse(deployedAt)-c.windows.baselineMinutes*60000).toISOString(),baselineEnd:deployedAt,currentStart:new Date(start).toISOString(),currentEnd:new Date(Math.max(end,start)).toISOString(),baselineMinutes:c.windows.baselineMinutes,currentMinutes:Math.max(0,(end-start)/60000)};
 deployments.push({id:String(e.identifier),service,owner,dependencies,deployedAt,version:redact(getPath(e,f.version)||'Unknown version'),environment:c.environment,windows,missing,sources:{port:missing.length?'partial':'ok',newRelic:'unknown',splunk:'unknown'},links:[{label:'Port',url:sourceLink(getPath(e,f.url))}].filter(x=>x.url),timeline:[{time:windows.baselineStart,label:'Baseline begins'},{time:deployedAt,label:'Deployment'},{time:windows.currentEnd,label:'Current window closes'}],metrics:{baseline:{},current:{}},logs:{baseline:[],current:[]}});
 }catch(err:any){warnings.push(`Port deployment skipped: ${redact(err.message)}`);}
 }
 }catch(err:any){warnings.push(`Port unavailable or not configured: ${redact(err.message)}`);}
 for(const d of deployments){
 const mapping=c.services.find((x:any)=>x.portService===d.service&&x.environment===d.environment);
 if(!mapping){d.missing.push('Explicit cross-system service mapping missing');continue;}
 if(d.windows.currentMinutes<c.windows.minCurrentMinutes){d.missing.push('Post-deployment window not yet mature after telemetry lag buffer');continue;}
 try{
 const n=mapping.newRelic; if(!Number.isSafeInteger(c.newRelic.accountId)||c.newRelic.accountId<1)throw Error('Configure New Relic accountId');
 const guid=literal(n.entityGuid),event=ident(n.eventType),ef=ident(n.entityField),envf=ident(n.environmentField),duration=ident(n.durationField),error=ident(n.errorField);
 const where=`${ef} = '${guid}' AND ${envf} = '${literal(c.environment)}'`;
 const nrql=async(q:string)=>{const data=await json(httpsUrl(c.newRelic.endpoint),post({query:`{ actor { account(id: ${c.newRelic.accountId}) { nrql(query: ${JSON.stringify(q)}, timeout: 5) { results } } } }`}));if(data.errors?.length)throw Error('NerdGraph returned query errors');const rows=data.data?.actor?.account?.nrql?.results;if(!Array.isArray(rows)||!rows.length)throw Error('No NRQL results');return rows[0];};
 for(const period of ['baseline','current']){
 const start=d.windows[period+'Start'],end=d.windows[period+'End'];const range=`SINCE '${start}' UNTIL '${end}'`;
 const r=await nrql(`SELECT count(*) AS samples, count(${duration}) AS latencySamples, count(${error}) AS errorSamples, percentile(${duration},95) AS latency, percentage(count(*), WHERE ${error} IS true) AS errorPercent, rate(count(*),1 minute) AS rpm, latest(timestamp) AS latest FROM ${event} WHERE ${where} ${range}`);
 const p95=typeof r.latency==='object'?r.latency?.['95']:r.latency;
 d.metrics[period]={samples:r.samples,p95Ms:r.latencySamples<c.thresholds.minRequests||p95==null?null:p95*(n.durationUnit==='seconds'?1000:1),errorPercent:r.errorSamples<c.thresholds.minRequests||r.errorSamples<r.samples*0.95?null:r.errorPercent,rpm:r.rpm,latest:r.latest?new Date(r.latest).toISOString():null,saturationPercent:null,saturationSamples:0};
 try{const s=n.saturation;if(!s)throw Error('No saturation mapping');const sr=await nrql(`SELECT average(${ident(s.field)}) AS value, count(${ident(s.field)}) AS samples FROM ${ident(s.eventType)} WHERE ${ident(s.entityField)} = '${literal(s.entityValue)}' AND ${ident(s.environmentField)} = '${literal(c.environment)}' ${range}`);d.metrics[period].saturationPercent=sr.value==null?null:sr.value*(s.unit==='fraction'?100:1);d.metrics[period].saturationSamples=sr.samples;}catch(err:any){d.missing.push(`New Relic ${period} saturation: ${redact(err.message)}`);}
 }
 d.sources.newRelic='ok';const link=sourceLink(n.url);if(link)d.links.push({label:'New Relic',url:link});
 }catch(err:any){d.sources.newRelic='unavailable';d.missing.push(`New Relic: ${redact(err.message)}`);}
 try{
 const s=mapping.splunk;const base=httpsUrl(c.splunk.baseUrl);if(s.redactedExcerptField&&(['_raw','message','msg','log'].includes(s.redactedExcerptField)||!s.excerptFieldApproved))throw Error('Excerpt field must be pre-sanitized and explicitly approved');
 const search=`search index="${ident(s.index)}" ${ident(s.serviceField)}="${literal(s.serviceValue)}" ${ident(s.environmentField)}="${literal(c.environment)}" ${ident(s.levelField)}="${literal(s.errorLevel)}" | eval signature=coalesce(${ident(s.signatureField)},"UNCLASSIFIED") | stats count${s.redactedExcerptField?' latest('+ident(s.redactedExcerptField)+') AS excerpt':''} by signature | sort - count | head ${c.limits.maxSignatures+1}`;
 for(const period of ['baseline','current']){
 const payload=new URLSearchParams({search,earliest_time:String(Date.parse(d.windows[period+'Start'])/1000),latest_time:String(Date.parse(d.windows[period+'End'])/1000),output_mode:'json',preview:'false'});
 const text=await request(`${base}/services/search/jobs/export`,{method:'POST',body:payload},c,step,deadline);const rows=text.split('\n').filter(Boolean).map(l=>JSON.parse(l));if(rows.some(r=>r.messages?.some((m:any)=>['ERROR','FATAL'].includes(m.type))))throw Error('Splunk search error');
 const results=rows.filter(r=>r.result&&r.preview!==true).map(r=>r.result);if(results.length>c.limits.maxSignatures){d.missing.push('Splunk signature limit reached; log coverage partial');d.logsTruncated=true;}
 d.logs[period]=results.slice(0,c.limits.maxSignatures).map(r=>({signature:redact(r.signature),count:Number(r.count),excerpt:s.redactedExcerptField?redact(r.excerpt):'No approved redacted excerpt field configured; inspect bounded source search.'}));
 if(d.logs[period].some((r:any)=>!Number.isFinite(r.count)))throw Error('Invalid Splunk count');
 }
 d.sources.splunk='ok';const web=sourceLink(c.splunk.webUrl);if(web){const u=new URL(web);u.searchParams.set('q',search);u.searchParams.set('earliest',String(Date.parse(d.windows.baselineStart)/1000));u.searchParams.set('latest',String(Date.parse(d.windows.currentEnd)/1000));d.links.push({label:'Splunk',url:u.href});}
 }catch(err:any){d.sources.splunk='unavailable';d.missing.push(`Splunk: ${redact(err.message)}`);}
 if(d.missing.length)log(step,'service_degraded',{service:d.service,reasons:d.missing},'warn');
 }
 return {asOf,deployments,warnings};
}
