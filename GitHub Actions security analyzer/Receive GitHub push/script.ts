import { createHmac, timingSafeEqual } from 'node:crypto';
import policy from './policy.json';
import {log,audit,parseMessage,response,request,validatePush,identity} from './common';
log('receive_started','Checking push delivery.');
try {
 const raw=Buffer.from(await Bun.stdin.arrayBuffer());
 if(raw.length>1_100_000){response(413,{error:'Payload too large'});process.exit(0);}
 const split=raw.indexOf(Buffer.from('\r\n\r\n'));
 const req=parseMessage(raw.toString('utf8'));
 if(req.method!=='POST'){response(405,{error:'POST required'});process.exit(0);}
 if(policy.mode!=='live'){response(409,{error:'Live webhook disabled. Use the synthetic push route.'});process.exit(0);}
 const secretUrl=policy.webhookSecretUrl;
 if(!secretUrl||!String(secretUrl).startsWith('https://')){response(503,{error:'Signature verifier is not configured; delivery rejected.'});process.exit(0);}
 const sig=req.headers['x-hub-signature-256'];
 if(split<0||!/^sha256=[a-f0-9]{64}$/.test(sig||'')){response(401,{error:'Signature required'});process.exit(0);}
 const secretResponse=await request(secretUrl,{},8192);
 const secret=secretResponse.data?.data?.data?.secret;
 if(!secretResponse.ok||typeof secret!=='string'||secret.length<32)throw Error('Webhook secret unavailable from Vault KV v2');
 const expected=createHmac('sha256',secret).update(raw.subarray(split+4)).digest();
 if(!timingSafeEqual(expected,Buffer.from(sig.slice(7),'hex'))){audit('signature_rejected','webhook','failure');response(401,{error:'Invalid signature'});process.exit(0);}
 if(req.headers['x-github-event']!=='push'){response(200,{accepted:false,reason:'Only push events are supported'});process.exit(0);}
 const event=validatePush(JSON.parse(req.body),req.headers['x-github-delivery']);
 if(!(policy.allowedRepositories as string[]).includes(event.repository)){response(403,{error:'Repository is not allowlisted'});process.exit(0);}
 const reviewId=identity(event);
 audit('push_verified',reviewId,'success');log('receive_completed','Verified push accepted.',{reviewId});
 response(202,{accepted:true,event:{...event,reviewId},reviewId,statusUrl:`${process.env._3B_WORKFLOW_BASE_URL}/ghawa/reports?id=${reviewId}`});
} catch(e) {log('receive_failed','Delivery rejected.',{reason:String((e as Error).message)},'error');audit('push_rejected','webhook','failure');response(503,{error:'Cannot verify or accept this delivery. Retry after checking configuration.'});}
