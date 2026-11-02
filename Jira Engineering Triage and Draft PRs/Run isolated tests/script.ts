import {mkdir,mkdtemp,rm} from 'node:fs/promises';import {dirname} from 'node:path';
import {start,done,input,emit,log,failJob} from './common';
start();const j=await input();if(j.stage!=='test'){done(0);process.exit(0);}
try{
 const permitted=j.repository.fixture||j.repository.ciSafety?.verified===true;
 if(!permitted){j.tests={status:'not run',reason:'Sandbox authorization and GitHub Actions-disabled verification are required before repository code execution'};log('tests_skipped',{reason:j.tests.reason},'warn');}
 else{
  const files=j.testInput.files;
  function safePath(p:string){return /^[\w./-]+$/.test(p)&&p.split('/').every(s=>s.length>0&&!s.startsWith('.'));}
  for(const [p,content] of Object.entries(files)){if(!safePath(p)||typeof content!=='string')throw Error('Unsafe test file path or content');}
  const patched={...files};
  for(const c of j.testInput.changes){if(!safePath(c.path)||!Object.hasOwn(files,c.path)||typeof c.content!=='string')throw Error('Patch must replace an inspected relative file');patched[c.path]=c.content;}
  const tests=Object.keys(files).filter(p=>/\.(test|spec)\.[jt]s$/.test(p));
  if(!tests.length){j.tests={status:'not run',reason:'No supported dependency-free Bun test files inspected'};log('tests_skipped',{reason:j.tests.reason},'warn');}
  else{
   const runs:any[]=[];
   async function run(phase:string,tz:string){
    const root=await mkdtemp('/tmp/engineering-test-');
    try{
     const cwd=root+'/workspace';const home=root+'/home';const tmp=root+'/tmp';
     await Promise.all([mkdir(cwd),mkdir(home),mkdir(tmp)]);
     const snapshot=phase==='baseline'?files:patched;
     for(const [p,content] of Object.entries(snapshot) as any){await mkdir(dirname(cwd+'/'+p),{recursive:true});await Bun.write(cwd+'/'+p,content);}
     log('test_started',{phase,timezone:tz,file_count:Object.keys(snapshot).length});
     const started=Date.now();const proc=Bun.spawn([process.execPath,'test',...tests.map(p=>'./'+p)],{cwd,env:{TZ:tz,HOME:home,TMPDIR:tmp,PATH:'/usr/bin:/bin'},stdout:'pipe',stderr:'pipe'});
     let timeout=false;let length=0;const timer=setTimeout(()=>{timeout=true;proc.kill('SIGKILL');},6000);
     async function capture(stream:ReadableStream<Uint8Array>){let text='';for await(const b of stream){length+=b.length;if(length>32000){proc.kill('SIGKILL');break;}text+=new TextDecoder().decode(b);}return text;}
     try{
      const [out,err,exit]=await Promise.all([capture(proc.stdout),capture(proc.stderr),proc.exited]);
      const r={phase,timezone:tz,command:`bun test ${tests.join(' ')}`,status:!timeout&&length<=32000&&exit===0?'passed':'failed',exitCode:exit,timedOut:timeout,output:(out+err).slice(0,16000),durationMs:Date.now()-started};runs.push(r);log('test_completed',{phase,timezone:tz,status:r.status,exitCode:exit});
     }finally{clearTimeout(timer);proc.kill('SIGKILL');await proc.exited;}
    }finally{await rm(root,{recursive:true,force:true});}
   }
   await run('baseline','America/Los_Angeles');await run('baseline','UTC');
   await run('proposed patch','America/Los_Angeles');await run('proposed patch','UTC');
   j.tests={status:runs.filter(r=>r.phase==='proposed patch').every(r=>r.status==='passed')?'passed':'failed',environment:'Connector-free ephemeral 3B sandbox; fresh inspected snapshot, HOME and TMPDIR per invocation; clean child environment; no package installation; inspected dependency-free tests only',runs,limitations:['Not the full repository CI suite','Network egress is not asserted to be disabled; this step has no connectors, secrets, or persistent volumes','Fresh directories prevent incidental state reuse, not deliberate access to other sandbox paths']};
  }
 }
 delete j.testInput;j.stage='publish';emit(j);done();
}catch(e){await failJob(j,e);delete j.testInput;emit(j);}
