import {mkdirSync} from 'node:fs';
import {input,log} from './common';
import {analyze} from './rules';
log('analysis_started','Running deterministic YAML checks.');
const r=analyze(await input());mkdirSync('/storage/ghawa-evidence',{recursive:true});await Bun.write(`/storage/ghawa-evidence/${r.reviewId}.json`,JSON.stringify(r));log('analysis_completed','Deterministic checks completed.',{findings:r.findings.length,status:r.status});console.log(JSON.stringify(r));
