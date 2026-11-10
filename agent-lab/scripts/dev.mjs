import { createLabServer } from '../backend/server.mjs';
const server=createLabServer({preview:true});server.listen(Number(process.env.PORT || 4179),'127.0.0.1',()=>console.log(`Agent Lab preview: http://127.0.0.1:${server.address().port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});
