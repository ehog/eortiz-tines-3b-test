import {mkdir,rm} from 'node:fs/promises';import {dirname} from 'node:path';
import {start,done,input,emit,log,failJob} from './common';
start();const j=await input();if(j.stage!=='test'){done(0);process.exit(0);}
try{
 const permitted=j.repository.fixture||j.repository.ciSafety?.verified===true;
 if(!permitted){j.tests={status:'not run',reason:'Sandbox authorization and GitHub Actions-disabled verification are required before repository code execution'};}
 else{
  const root='/tmp/engineering-test';await mkdir(root,{recursive:true});const files=j.testInput.files;
  for(const [p,content] of Object.entries(files) as any){if(!/^[\w./-]+$/.test(p)||p.split('/').some((s:string)=>s==='..'||s.startsWith('.')))throw Error('Unsafe test file path');await mkdir(dirname(root+'/'+p),{recursive:true});await Bun.write(root+'/'+p,content);}
  const tests=Object.keys(files).filter(p=>/\.(test|spec)\.[jt]s$/.test(p));if(!tests.length){j.tests={status:'not run',reason:'No supported dependency-free Bun test files inspected'};}
  else{
   const runs:any[]=[];
   async function run(phase:string,tz:string){const started=Date.now();const proc=Bun.spawn([process.execPath,'test',...tests.map(p=>'./'+p)],{cwd:root,env:{TZ:tz,HOME:'/tmp',PATH:'/usr/bin:/bin'},stdout:'pipe',stderr:'pipe'});let timeout=false;const timer=setTimeout(()=>{timeout=true;proc.kill('SIGKILL');},6000);let length=0;async function capture(stream:ReadableStream<Uint8Array>){let text='';for await(const b of stream){length+=b.length;if(length>32000){proc.kill('SIGKILL');break;}text+=new TextDecoder().decode(b);}return text;}
    const [out,err,exit]=await Promise.all([capture(proc.stdout),capture(proc.stderr),proc.exited]);clearTimeout(timer);const r={phase,timezone:tz,command:`bun test ${tests.join(' ')}`,status:!timeout&&length<=32000&&exit===0?'passed':'failed',exitCode:exit,timedOut:timeout,output:(out+err).slice(0,16000),durationMs:Date.now()-started};runs.push(r);log('test_completed',{phase,timezone:tz,status:r.status,exitCode:exit});}
   await run('baseline','America/Los_Angeles');await run('baseline','UTC');
   for(const c of j.testInput.changes)await Bun.write(root+'/'+c.path,c.content);
   await run('proposed patch','America/Los_Angeles');await run('proposed patch','UTC');
   j.tests={status:runs.filter(r=>r.phase==='proposed patch').every(r=>r.status==='passed')?'passed':'failed',environment:'Connector-free ephemeral 3B sandbox; clean child environment; no package installation; inspected dependency-free tests only',runs,limitations:['Not the full repository CI suite','Network egress is not asserted to be disabled; this step has no connectors, secrets, or persistent volumes']};
  }
  await rm(root,{recursive:true,force:true});
 }
 delete j.testInput;j.stage='publish';emit(j);done();
}catch(e){await failJob(j,e);emit(j);}
