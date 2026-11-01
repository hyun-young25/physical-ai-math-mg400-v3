// Local production-build transport for repeatable, synthetic-data UI evidence.
// This never connects to a physical bridge, a student database or a paid AI API.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../artifacts/robot-control/dist/public');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css', '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
exports.install = async context => {
  const events = [];
  await context.routeWebSocket('**', ws => ws.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.resourceType() === 'stylesheet' && ['fonts.googleapis.com','cdn.jsdelivr.net'].includes(url.hostname)) {
      // The recording supplies Korean fonts locally instead of loading remote typography.
      return route.fulfill({contentType:'text/css',body:''});
    }
    if (url.hostname === 'raw.githack.com' && url.pathname.endsWith('.hdr')) {
      // Neutral illumination only; all robot geometry and transforms are real app assets.
      return route.fulfill({body:Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 64 +X 128\n'), Buffer.from(Array.from({length:8192},()=>[128,128,128,129]).flat())])});
    }
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return route.abort();
    const endpoint = url.pathname;
    if (endpoint === '/api/auth/user') return route.fulfill({json:{user:null}});
    if (endpoint === '/api/learning/student/enter') {
      const {login} = request.postDataJSON();
      return route.fulfill({json:{user:{id:'synthetic-demo-account',login,role:'student',visitId:'synthetic-demo-visit'}}});
    }
    if (endpoint === '/api/learning/records') {
      const payload = request.postDataJSON();
      events.push(...payload.events);
      return route.fulfill({json:{acknowledged:payload.events.map(event=>event.eventId)}});
    }
    if (endpoint.startsWith('/api/')) return route.fulfill({json:{}});
    const target = path.resolve(root, '.' + (endpoint === '/' ? '/index.html' : endpoint));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.fulfill({status:404,body:'Missing local app resource'});
    return route.fulfill({body:fs.readFileSync(target),contentType:mime[path.extname(target)]});
  });
  return events;
};
