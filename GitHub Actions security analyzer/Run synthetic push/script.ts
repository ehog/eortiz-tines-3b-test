import {fixture} from './fixtures';
import {parseMessage,response,log,audit} from './common';
log('demo_started','Receiving synthetic push.');
try {const r=parseMessage(await Bun.stdin.text());if(r.method!=='POST'){response(405,{error:'POST required'});process.exit(0);}const {scenario}=JSON.parse(r.body);const event=fixture(scenario);audit('synthetic_push',event.reviewId,'success');log('demo_completed','Synthetic push accepted.',{scenario});response(202,{accepted:true,event,reviewId:event.reviewId,statusUrl:`${process.env._3B_WORKFLOW_BASE_URL}/ghawa/reports?id=${event.reviewId}`});}catch{response(400,{error:'Choose unrelated, safe, unsafe-pr, or exfiltration'});}
