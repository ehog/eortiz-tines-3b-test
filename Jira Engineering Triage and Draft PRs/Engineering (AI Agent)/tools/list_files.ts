import {tool} from 'ai';import {z} from 'zod';import {action,paths} from '../context';
export default tool({description:'List the bounded, pinned repository snapshot paths.',inputSchema:z.object({}),execute:async()=>action('list_files',async()=>({paths:paths().slice(0,200)}))});
