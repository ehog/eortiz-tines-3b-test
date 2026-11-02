import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {input,identity,log,audit} from './common';
import policy from './policy.json';
log('reserve_started','Checking delivery and commit identity.');
const data=await input();if(!data.accepted||!data.event){log('reserve_skipped','Input was not accepted.',{},'warn');process.exit(0);}
const e=data.event;const id=identity(e);mkdirSync('/storage/ghawa-state',{recursive:true});
const db=new Database('/storage/ghawa-state/reviews.sqlite',{create:true});
db.run('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, event TEXT NOT NULL, status TEXT NOT NULL, report TEXT, created TEXT NOT NULL, output_state TEXT, receipts TEXT)');
db.run('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, review_id TEXT NOT NULL)');
const delivery=`${e.mode}:${e.delivery}`;
const previous=db.query('SELECT review_id FROM deliveries WHERE id=?').get(delivery) as any;
if(previous&&previous.review_id!==id){audit('delivery_conflict',id,'failure');throw Error('Delivery ID reused with different identity');}
if(previous||db.query('SELECT id FROM reviews WHERE id=?').get(id)){db.run('INSERT OR IGNORE INTO deliveries VALUES (?,?)',[delivery,id]);audit('duplicate_suppressed',id,'skipped');log('reserve_completed','Duplicate suppressed.',{reviewId:id});process.exit(0);}
if((db.query('SELECT COUNT(*) AS n FROM reviews').get() as any).n>=policy.maxReviews){audit('capacity_rejected',id,'failure');throw Error('Review capacity reached; archive state before admitting new reviews');}
if((db.query('SELECT COUNT(*) AS n FROM deliveries').get() as any).n>=policy.maxReviews*20)throw Error('Delivery ledger capacity reached');
db.transaction(()=>{db.run('INSERT INTO reviews (id,event,status,created) VALUES (?,?,?,?)',[id,JSON.stringify(e),'pending',new Date().toISOString()]);db.run('INSERT INTO deliveries VALUES (?,?)',[delivery,id]);})();
audit('review_reserved',id,'success');log('reserve_completed','Review reserved.',{reviewId:id});console.log(JSON.stringify({...e,reviewId:id}));
