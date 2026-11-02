import {tool} from 'ai';import {z} from 'zod';import {action,review} from '../context';
export default tool({description:'Stop investigation and ask specific human engineering questions.',inputSchema:z.object({questions:z.array(z.string().min(10).max(500)).min(1).max(8)}),execute:async({questions})=>action('request_review',()=>review(questions))});
