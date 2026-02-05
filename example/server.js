const http = require('node:http');

const PORT = process.env.APP_PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'unknown';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: `Hello from session ${SESSION_ID}!`,
    port: PORT,
    uptime: process.uptime(),
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Session ${SESSION_ID} listening on port ${PORT}`);
});
