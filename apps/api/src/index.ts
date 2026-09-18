import 'dotenv/config';
import { app } from './app.js';
import { db } from './db.js';
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () =>
  console.log(`Dellvit API listening on http://localhost:${port}`),
);
function shutdown() {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
