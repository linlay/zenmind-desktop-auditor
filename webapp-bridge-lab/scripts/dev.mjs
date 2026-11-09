import { createLabServer } from '../backend/server.mjs';
const server = createLabServer({ preview: true });
server.listen(Number(process.env.PORT || 4178), '127.0.0.1', () => {
  console.log(`Bridge Lab preview: http://127.0.0.1:${server.address().port}/ (Desktop SDK unavailable outside Desktop)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
