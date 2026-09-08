/* Local stand-in for the Resend API. Records what the Worker sent so tests can
   assert on the actual email, and can be switched to fail on demand. */
const http = require('http');
const fs = require('fs');
const OUT = process.env.MOCK_OUT || '_mock-mail.json';
let mode = 'ok';
const received = [];

http.createServer((req, res) => {
  if (req.url === '/__mode/fail') { mode = 'fail'; res.end('fail'); return; }
  if (req.url === '/__mode/ok') { mode = 'ok'; res.end('ok'); return; }
  if (req.url === '/__mode/slow') { mode = 'slow'; res.end('slow'); return; }
  if (req.url === '/__reset') { received.length = 0; res.end('reset'); return; }
  if (req.url === '/__received') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(received)); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    if (req.url === '/emails' && req.method === 'POST') {
      if (mode === 'slow') await new Promise(r => setTimeout(r, 3000));
      if (mode === 'fail') {
        res.writeHead(422, {'content-type':'application/json'});
        res.end(JSON.stringify({ message: 'simulated provider failure' }));
        return;
      }
      const parsed = JSON.parse(body);
      received.push({ auth: req.headers.authorization, ...parsed });
      fs.writeFileSync(OUT, JSON.stringify(received, null, 2));
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({ id: 'mock-' + received.length }));
      return;
    }
    res.writeHead(404); res.end();
  });
}).listen(4199, '127.0.0.1', () => console.log('mock resend on 4199'));
