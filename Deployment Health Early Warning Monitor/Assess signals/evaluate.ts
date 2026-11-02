const ranks={healthy:0,watch:1,investigate:2,urgent:3};
export function evaluate(d:any,c:any){
 const t=c.thresholds,b=d.metrics.baseline,n=d.metrics.current;const missing=[...d.missing];const evidence:any[]=[];let severity:keyof typeof ranks='healthy';
 const raise=(s:keyof typeof ranks)=>{if(ranks[s]>ranks[severity])severity=s;};
 const fact=(id:string,label:string,baseline:any,current:any,unit:string,trigger:string|null)=>{evidence.push({id,label,baseline,current,unit,trigger});};
 for(const source of ['port','newRelic','splunk'])if(d.sources[source]!=='ok')missing.push(`${source} coverage ${d.sources[source]}`);
 if(d.windows.currentMinutes<c.windows.minCurrentMinutes)missing.push('Insufficient mature post-deployment window');
 const baselineEnough=Number.isFinite(b.samples)&&b.samples>=t.minRequests;
 const currentEnough=Number.isFinite(n.samples)&&n.samples>=t.minRequests;
 if(!baselineEnough)missing.push(`Baseline sample count below ${t.minRequests} or unknown`);
 if(!currentEnough)missing.push(`Current sample count below ${t.minRequests} or unknown`);
 let fresh=true;
 for(const [p,m] of [['baseline',b],['current',n]] as any){const age=(Date.parse(d.windows[p+'End'])-Date.parse(m.latest))/60000;if(!Number.isFinite(age)||age>t.maxTelemetryAgeMinutes||age<0){missing.push(`${p} telemetry stale or timestamp unavailable`);fresh=false;}}
 const enough=baselineEnough&&currentEnough&&fresh&&d.windows.currentMinutes>=c.windows.minCurrentMinutes;
 const valid=(k:string)=>Number.isFinite(b[k])&&Number.isFinite(n[k])&&b[k]>=0&&n[k]>=0;
 for(const [key,label,unit] of [['p95Ms','p95 latency','ms'],['errorPercent','Error rate','%'],['rpm','Throughput','req/min'],['saturationPercent','Saturation','%']]){
 if(!valid(key)){missing.push(`${label} baseline or current unavailable`);fact(key,label,b[key]??null,n[key]??null,unit,'unknown');continue;}
 let reason:string|null=null;
 if(key==='p95Ms'&&enough){const ratio=b[key]>0?n[key]/b[key]:null;if(ratio===null)missing.push('Zero latency baseline; ratio undefined');else if(ratio>=t.latencyUrgentRatio&&n[key]>=t.latencyUrgentMs){raise('urgent');reason=`≥${t.latencyUrgentRatio}× baseline and ≥${t.latencyUrgentMs}ms`;}else if(ratio>=t.latencyInvestigateRatio){raise('investigate');reason=`≥${t.latencyInvestigateRatio}× baseline`;}else if(ratio>=t.latencyWatchRatio){raise('watch');reason=`≥${t.latencyWatchRatio}× baseline`;}}
 if(key==='errorPercent'&&enough){const delta=n[key]-b[key];if(n[key]>=t.errorUrgentPercent&&delta>=t.errorInvestigateDeltaPp){raise('urgent');reason=`≥${t.errorUrgentPercent}% errors with ≥${t.errorInvestigateDeltaPp}pp increase`;}else if(delta>=t.errorInvestigateDeltaPp){raise('investigate');reason=`≥${t.errorInvestigateDeltaPp}pp increase`;}else if(delta>=t.errorWatchDeltaPp){raise('watch');reason=`≥${t.errorWatchDeltaPp}pp increase`;}}
 if(key==='rpm'&&baselineEnough&&fresh){if(b[key]>0&&(b[key]-n[key])/b[key]*100>=t.throughputDropPercent){raise('investigate');reason=`≥${t.throughputDropPercent}% throughput drop`;}}
 if(key==='saturationPercent'){if(b.saturationSamples<t.minSaturationSamples||n.saturationSamples<t.minSaturationSamples||!Number.isFinite(n.saturationSamples)||!Number.isFinite(b.saturationSamples)){missing.push('Insufficient saturation samples');}else if(fresh){if(n[key]>=t.saturationUrgentPercent){raise('urgent');reason=`≥${t.saturationUrgentPercent}% saturation`;}else if(n[key]>=t.saturationWatchPercent){raise('watch');reason=`≥${t.saturationWatchPercent}% saturation`;}}}
 fact(key,label,b[key],n[key],unit,reason??(!enough&&key!=='saturationPercent'?'insufficient confidence in samples':null));
 }
 const signatures:any[]=[];
 if(d.sources.splunk==='ok'&&d.windows.currentMinutes>=c.windows.minCurrentMinutes){for(const row of d.logs.current){const prior=d.logs.baseline.find((r:any)=>r.signature===row.signature);const before=prior?.count??0;const baselineRate=before/d.windows.baselineMinutes,currentRate=row.count/d.windows.currentMinutes;const isNew=!d.logsTruncated&&before===0&&row.count>=t.newSignatureMinCount;const increased=baselineRate>0&&currentRate/baselineRate>=t.logRateRatio&&currentRate-baselineRate>=t.logRateMinDeltaPerMinute;if(isNew||increased){raise('investigate');signatures.push({signature:row.signature,baselineCount:before,currentCount:row.count,baselineRate,currentRate,isNew,excerpt:row.excerpt});}}}
 if(missing.length)raise('investigate');
 const confidence=missing.length?'low':severity==='healthy'?'high':'medium';
 const checks=severity==='healthy'?['Continue observing through the next scheduled window.']:missing.length?['Verify entity and environment mappings, telemetry freshness, sampling, and source query health.','Obtain missing signals before concluding this deployment is healthy.']:['Compare traces by deployed version and route; check whether unaffected instances show the same pattern.','Inspect dependency latency, timeouts, retry volume and connection-pool pressure.','Check concurrent changes and traffic mix before attributing the regression to this deployment.'];
 const hypothesis=missing.length?'Available evidence is incomplete. Service health and deployment contribution remain unknown.':severity==='healthy'?'No configured threshold was crossed in the observed windows. This is not proof of absence of problems.':`The timing is consistent with a possible deployment-associated regression in ${d.service}. Dependency or traffic changes are alternative explanations; causation is not established.`;
 return {...d,severity,health:missing.length?'unknown':severity==='healthy'?'healthy':'degraded',confidence,missing:[...new Set(missing)],evidence,signatures,hypotheses:[hypothesis],recommendedChecks:checks,affectedServices:[{service:d.service,basis:'directly observed'},...d.dependencies.map((service:string)=>({service,basis:'configured dependency; impact unverified'}))]};
}
