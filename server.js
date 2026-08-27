import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWav } from './src/music.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
async function body(req, max = 128 * 1024 * 1024) { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>max) throw Error('WAV 文件过大（上限 128 MiB）'); chunks.push(chunk); } return Buffer.concat(chunks); }
function json(res,status,value){ const data=JSON.stringify(value); res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(data); }
async function serve(res,pathname){ const rel=pathname==='/'?'index.html':pathname.slice(1); const file=path.resolve(PUBLIC,rel); if(!file.startsWith(PUBLIC+path.sep)) return json(res,403,{error:'forbidden'}); try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-cache'});res.end(data);}catch{json(res,404,{error:'not found'});} }
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true});if(req.method==='POST'&&url.pathname==='/api/analyze'){const wav=await body(req);const win=Math.max(256,Math.min(16384,Number(url.searchParams.get('win')||2048)));const hop=Math.max(64,Math.min(win,Number(url.searchParams.get('hop')||512)));return json(res,200,analyzeWav(wav,win,hop));}if(req.method==='GET')return serve(res,url.pathname);json(res,405,{error:'method not allowed'});}catch(err){json(res,400,{error:err?.message||String(err)});}});
server.listen(PORT,()=>console.log(`wav-web listening on http://localhost:${PORT}`));
