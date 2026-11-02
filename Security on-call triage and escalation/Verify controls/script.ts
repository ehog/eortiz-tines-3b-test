import {Database} from 'bun:sqlite';
import {cfg,log,fixtures,createFixture,fixtureAssessment,routing,validateAssessment,requireReviewer,decide,save,get,redact,parse,assertLive} from './common';
log('verification_started');const tests:any[]=[];
function check(name:string,f:()=>void){try{f();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:String(e)});}}
function assert(v:any){if(!v)throw new Error('Assertion failed');}function rejects(f:()=>void){let rejected=false;try{f();}catch{rejected=true;}assert(rejected);}
check('scanner enters human review',()=>{const i=createFixture('scanner','test-scanner');assert(routing(i,fixtureAssessment(i)).route==='review');});
check('privileged compromise escalates',()=>{const i=createFixture('privileged','test-priv');assert(routing(i,fixtureAssessment(i)).route==='urgent');});
check('critical uncertainty escalates',()=>{const i=createFixture('ambiguous','test-gap');assert(routing(i,fixtureAssessment(i)).route==='urgent');});
check('confidence cannot justify deferral',()=>{const i=createFixture('ambiguous','test-confidence');const a=fixtureAssessment(i);a.confidence=1;assert(routing(i,a).route==='urgent');});
check('source severity cannot be downgraded',()=>{const i=createFixture('scanner','test-high');i.severity=5;assert(routing(i,fixtureAssessment(i)).route==='urgent');});
check('one source is insufficient',()=>{const i=createFixture('scanner','test-single');const a=structuredClone(fixtureAssessment(i));a.evidence=a.evidence.slice(0,1);assert(routing(i,a).route==='urgent');});
check('invalid assessment rejected',()=>rejects(()=>validateAssessment({classification:'benign',confidence:1})));
check('unauthenticated reviewer rejected',()=>rejects(()=>requireReviewer({headers:{'content-type':'application/json'}})));
check('cross-origin review rejected',()=>rejects(()=>requireReviewer({headers:{'x-3b-authenticated-email':'test@example.invalid',origin:'https://attacker.invalid','content-type':'application/json'}})));
check('non-json mutation rejected',()=>rejects(()=>requireReviewer({headers:{'x-3b-authenticated-email':'test@example.invalid','content-type':'text/plain'}})));
check('live disabled by default',()=>rejects(assertLive));
check('secrets redacted',()=>{const r=redact({token:'secret',text:'Bearer abc123 operator@example.invalid'});assert(r.token==='[REDACTED]'&&!r.text.includes('abc123')&&!r.text.includes('operator@'));});
check('HTTP parser preserves raw body',()=>assert(parse('POST /x HTTP/1.1\r\nX-Test: yes\r\n\r\na=1&b=%2F').body==='a=1&b=%2F'));
for(const choice of ['confirm_benign','escalate'])check(`synthetic reviewer ${choice}; conflicts rejected`,()=>{const d=new Database(':memory:');d.exec('CREATE TABLE items(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE decisions(item_id TEXT PRIMARY KEY,data TEXT);CREATE TABLE outbox(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE history(id INTEGER PRIMARY KEY,data TEXT);');const i:any=createFixture('scanner',`unit-${choice}`);i.status='pending_review';i.reviewDueAt=new Date(Date.now()+60000).toISOString();save(d,i);decide(d,i,choice,'SYNTHETIC TEST ACTOR','Synthetic test rationale references approved evidence.','unit_test_not_human');const saved=get(d,i.id);assert(saved.status===(choice==='confirm_benign'?'confirmed_benign':'escalated'));rejects(()=>decide(d,saved,'escalate','SYNTHETIC TEST ACTOR','Duplicate decision must be blocked.','unit_test_not_human'));d.close();});
check('expired review rejected',()=>{const i:any=createFixture('scanner','expired');i.status='pending_review';i.reviewDueAt='2000-01-01T00:00:00Z';rejects(()=>decide(null,i,'confirm_benign','SYNTHETIC TEST ACTOR','Expired decision must be rejected.','unit_test_not_human'));});
check('draft-safe sibling route URLs',()=>{for(const base of ['https://one.example','https://one.example/__3b/branch/demo','https://two.example/__3b/branch/other']){const path=new URL(`${base}/security-oncall/queue`).pathname;assert(path===new URL(base).pathname.replace(/\/$/,'')+'/security-oncall/queue');}});
console.log(JSON.stringify({passed:tests.filter(t=>t.passed).length,total:tests.length,tests}));log('verification_completed',{count:tests.length});if(tests.some(t=>!t.passed))process.exit(1);
