import {evaluate} from './evaluate';import {fixtures} from './fixtures';import c from './settings.json';import {material} from './format';import {redact,parseInput} from './common';
let count=0;function check(v:any,msg:string){if(!v)throw Error(msg);count++;}
const rows=fixtures('all',c).deployments;
const a=rows.map(d=>evaluate(d,c));check(a[0].severity==='healthy','Healthy fixture');check(a[1].severity==='investigate','Booking fixture');check(a[2].health==='unknown'&&a[2].severity==='investigate','Missing is unknown');
const urgent=structuredClone(rows[1]);urgent.metrics.current.p95Ms=2400;check(evaluate(urgent,c).severity==='urgent','Urgent explicit latency threshold');
const watch=structuredClone(rows[0]);watch.metrics.current.p95Ms=250;check(evaluate(watch,c).severity==='watch','Watch threshold');
const low=structuredClone(urgent);low.metrics.current.samples=2;low.metrics.current.saturationPercent=40;low.sources.splunk='unavailable';check(evaluate(low,c).severity==='investigate','Low sample does not escalate latency to urgent');
const stale=structuredClone(rows[0]);stale.metrics.current.latest='2026-09-30T15:00:00Z';check(evaluate(stale,c).health==='unknown','Stale telemetry');
check(!material(a[1],structuredClone(a[1]),c.thresholds),'Unchanged suppression');const changed=structuredClone(a[1]);changed.evidence[0].current=1500;check(material(a[1],changed,c.thresholds),'Metric change updates');check(material(a[1],a[0],c.thresholds),'Recovery updates');
const r=redact('email=test@example.com token=abc123 password=topsecret 192.168.1.1');check(!r.includes('abc123')&&!r.includes('topsecret')&&!r.includes('test@')&&!r.includes('192.168'),'Redaction');
check(parseInput('HTTP/1.1 202 Accepted\r\n\r\n{"job":1}').job===1,'HTTP linked response');
for(const base of ['https://one.test','https://one.test/__3b/branch/abc','https://two.test/__3b/branch/xyz'])check(new URL(`${base}/deployment-watch/data`).pathname===new URL(base).pathname.replace(/\/$/,'')+'/deployment-watch/data','Branch-aware sibling route');
console.log(JSON.stringify({checks:count,status:'passed'}));
