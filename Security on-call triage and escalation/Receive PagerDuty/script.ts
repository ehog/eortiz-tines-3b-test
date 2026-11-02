import {cfg,log,parse,requirePost,verify,response,routeError,db,all,save,history,now,redact} from './common';
log('webhook_started');
try{
 const r=parse(await Bun.stdin.text());requirePost(r);await verify('pagerduty',r);const p=JSON.parse(r.body);const e=p.event;
 if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(e.id)||!e.data?.id||!e.data?.service?.id)throw new Error('400:Invalid PagerDuty v3 event');
 if(!['incident.triggered','incident.reopened'].includes(e.event_type)){response(200,{ignored:true,reason:'Only triggered and reopened events start investigations'});process.exit(0);}
 if(!/^[A-Z0-9]{3,32}$/.test(e.data.id)||!cfg.services.includes(e.data.service.id))throw new Error('403:Service or incident not allowed');
 const d=db(true);if(d.query('SELECT id FROM deliveries WHERE id=?').get(e.id)){response(200,{duplicate:true});process.exit(0);}
 if(all(d).length>=cfg.maxItems)throw new Error('503:Queue capacity reached');
 const id=`pd-${e.id}`;const item={id,incidentId:e.data.id,mode:'live',source:'PagerDuty signed webhook',title:redact(e.data.title||'Security incident'),service:e.data.service.id,severity:e.data.urgency==='high'?4:3,critical:cfg.criticalServices.includes(e.data.service.id)||!cfg.noncriticalServices.includes(e.data.service.id),createdAt:now(),investigationDueAt:new Date(Date.now()+cfg.investigationMinutes*60000).toISOString(),status:'investigating',version:1};
 d.transaction(()=>{d.query('INSERT INTO deliveries VALUES (?,?)').run(e.id,id);save(d,item);history(d,'webhook_accepted',id,{deliveryId:e.id,service:item.service});})();d.close();response(202,{itemId:id,mode:'live',statusUrl:`${process.env._3B_WORKFLOW_BASE_URL}/security-oncall/queue`});log('webhook_completed');
}catch(e){routeError(e);}
