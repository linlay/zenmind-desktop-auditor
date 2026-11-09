import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../backend/server.mjs';
const directory=process.env.WORK_HUB_DATA_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'../.local-data');
const server=await createServer({directory,env:{WORK_HUB_PLATFORM_URL:process.env.WORK_HUB_PLATFORM_URL,WORK_HUB_PLATFORM_TOKEN:process.env.WORK_HUB_PLATFORM_TOKEN}});
server.listen(Number(process.env.PORT||4191),'127.0.0.1',()=>console.log(`Work Hub: http://127.0.0.1:${server.address().port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void server.shutdown());
