#!/usr/bin/env node
'use strict';

const http = require('http');
const { execFile, spawn } = require('child_process');
const { URL } = require('url');
const path = require('path');

const PORT = process.env.PORT || 8765;
const ADB = process.env.ADB || 'adb';

// ---- helpers ---------------------------------------------------------------

// Single-quote a string for the *device* shell (adb runs args through sh on
// the phone). This keeps spaces & special chars safe and blocks injection.
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { maxBuffer: 1024 * 1024 * 64, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr }));
      resolve({ stdout, stderr });
    });
  });
}

function humanSize(n) {
  n = Number(n);
  if (!isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
}

// Parse `ls -lap` output from Android/toybox.
// Example line:
//   -rw-rw---- 1 u0_a1 sdcard_rw 12345 2024-01-02 13:45 video.mp4
//   drwxrwx--- 2 u0_a1 sdcard_rw  4096 2024-01-02 13:45 Camera/
const LS_RE = /^([dl\-][rwxsStT\-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(.*)$/;

function parseLs(stdout) {
  const out = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || /^total\b/.test(line)) continue;
    const m = LS_RE.exec(line);
    if (!m) continue;
    const type = m[1][0];
    let name = m[5];
    // symlink "name -> target"
    if (type === 'l') {
      const idx = name.indexOf(' -> ');
      if (idx !== -1) name = name.slice(0, idx);
    }
    const isDir = type === 'd' || name.endsWith('/');
    name = name.replace(/\/$/, '');
    if (name === '.' || name === '..') continue;
    out.push({
      name,
      isDir,
      size: isDir ? null : Number(m[2]),
      sizeHuman: isDir ? '' : humanSize(m[2]),
      mtime: m[3] + ' ' + m[4],
    });
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return out;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  '.pdf': 'application/pdf', '.txt': 'text/plain',
};

// ---- API handlers ----------------------------------------------------------

async function apiDevices(res) {
  try {
    const { stdout } = await run(['devices', '-l']);
    const devices = stdout.split('\n').slice(1)
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        const [serial, state] = l.split(/\s+/);
        const model = (l.match(/\bmodel:(\S+)/) || [])[1] || '';
        return { serial, state, model };
      });
    sendJson(res, 200, { devices });
  } catch (e) {
    sendJson(res, 500, { error: e.stderr || e.message });
  }
}

async function apiList(res, dir) {
  if (!dir) dir = '/sdcard/';
  try {
    const { stdout } = await run(['shell', `ls -lap ${shq(dir)}`]);
    sendJson(res, 200, { path: dir, entries: parseLs(stdout) });
  } catch (e) {
    sendJson(res, 200, { path: dir, entries: [], error: (e.stderr || e.message || '').trim() });
  }
}

function apiDownload(req, res, filePath, inline) {
  if (!filePath) return sendJson(res, 400, { error: 'missing path' });
  const name = path.posix.basename(filePath);
  const ext = path.posix.extname(name).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  // Stream the file straight off the device without a temp copy.
  const child = spawn(ADB, ['exec-out', `cat ${shq(filePath)}`]);
  const disp = inline ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `${disp}; filename="${name.replace(/"/g, '')}"`,
  });
  child.stdout.pipe(res);
  child.stderr.on('data', () => {}); // ignore adb chatter
  child.on('error', () => { try { res.destroy(); } catch (_) {} });
  req.on('close', () => { try { child.kill('SIGKILL'); } catch (_) {} });
}

// ---- server ----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (p === '/api/devices') return apiDevices(res);
  if (p === '/api/list') return apiList(res, u.searchParams.get('path'));
  if (p === '/api/download') return apiDownload(req, res, u.searchParams.get('path'), false);
  if (p === '/api/view') return apiDownload(req, res, u.searchParams.get('path'), true);

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ADB File Manager → http://localhost:${PORT}\n`);
});

// ---- frontend (inline) -----------------------------------------------------

const HTML = String.raw`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ADB File Manager</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, system-ui, sans-serif;
         background: #0f1115; color: #e6e6e6; }
  header { padding: 14px 18px; background: #161922; border-bottom: 1px solid #262a36;
           position: sticky; top: 0; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  #device { font-size: 12px; color: #8a93a5; }
  #device .ok { color: #4ade80; }
  #device .bad { color: #f87171; }
  .crumbs { padding: 10px 18px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;
            background: #11141b; border-bottom: 1px solid #1f2330; }
  .crumbs a { color: #7aa2f7; cursor: pointer; text-decoration: none; }
  .crumbs a:hover { text-decoration: underline; }
  .crumbs span.sep { color: #4b5263; }
  .shortcuts { padding: 10px 18px; display: flex; gap: 8px; flex-wrap: wrap;
               border-bottom: 1px solid #1f2330; }
  .chip { background: #1c2030; border: 1px solid #2b3142; color: #b8c1d6; padding: 4px 10px;
          border-radius: 999px; cursor: pointer; font-size: 12px; }
  .chip:hover { background: #232838; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 9px 18px; border-bottom: 1px solid #1a1d27; }
  th { color: #8a93a5; font-weight: 500; font-size: 12px; position: sticky; }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { color: #cdd6f4; }
  th .arr { color: #4b5263; font-size: 11px; margin-left: 2px; }
  th .arr.on { color: #7aa2f7; }
  tr.row:hover { background: #161a24; }
  .name { display: flex; align-items: center; gap: 9px; }
  .name .ico { width: 18px; text-align: center; }
  .dir .nm { color: #7aa2f7; cursor: pointer; }
  .dir .nm:hover { text-decoration: underline; }
  .file .nm { color: #e6e6e6; }
  .size { color: #8a93a5; white-space: nowrap; }
  .date { color: #6b7385; white-space: nowrap; font-size: 12px; }
  .actions { white-space: nowrap; text-align: right; }
  .actions a { color: #9ece6a; text-decoration: none; margin-left: 12px; cursor: pointer; }
  .actions a:hover { text-decoration: underline; }
  .msg { padding: 18px; color: #8a93a5; }
  .err { padding: 14px 18px; color: #f87171; background: #2a1518; border-bottom: 1px solid #3a2024; }
  /* modal preview */
  #modal { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none;
           align-items: center; justify-content: center; padding: 24px; z-index: 50; }
  #modal.open { display: flex; }
  #modal .box { max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px; }
  #modal video, #modal img { max-width: 96vw; max-height: 82vh; border-radius: 8px; background:#000; }
  #modal .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  #modal .bar b { font-weight: 500; }
  #modal .bar a { color: #9ece6a; cursor: pointer; text-decoration: none; }
  #modal .close { color: #aaa; cursor: pointer; font-size: 22px; line-height: 1; }
</style>
</head>
<body>
<header>
  <h1>📱 ADB File Manager</h1>
  <span id="device">mengecek device…</span>
  <span style="flex:1"></span>
  <span class="chip" onclick="load(cur)">↻ Refresh</span>
</header>
<div class="crumbs" id="crumbs"></div>
<div class="shortcuts">
  <span class="chip" onclick="load('/sdcard/DCIM/Camera/')">📷 Camera</span>
  <span class="chip" onclick="load('/sdcard/DCIM/')">DCIM</span>
  <span class="chip" onclick="load('/sdcard/Movies/')">🎬 Movies</span>
  <span class="chip" onclick="load('/sdcard/Pictures/')">🖼 Pictures</span>
  <span class="chip" onclick="load('/sdcard/Download/')">⬇ Download</span>
  <span class="chip" onclick="load('/sdcard/')">🏠 sdcard</span>
</div>
<div id="err"></div>
<div id="content"><div class="msg">memuat…</div></div>

<div id="modal" onclick="if(event.target.id==='modal')closeModal()">
  <div class="box">
    <div class="bar">
      <b id="mTitle"></b>
      <span><a id="mDl">⬇ Download</a> &nbsp; <span class="close" onclick="closeModal()">✕</span></span>
    </div>
    <div id="mBody"></div>
  </div>
</div>

<script>
let cur = '/sdcard/';
let curEntries = [];
let sortState = { key: 'name', asc: true };
const VID = ['mp4','mov','mkv','webm','avi','3gp'];
const IMG = ['jpg','jpeg','png','gif','webp','heic'];
const AUD = ['mp3','m4a','wav','ogg','opus'];

function ext(n){ const i = n.lastIndexOf('.'); return i<0?'':n.slice(i+1).toLowerCase(); }
function icon(e){
  if(e.isDir) return '📁';
  const x = ext(e.name);
  if(VID.includes(x)) return '🎬';
  if(IMG.includes(x)) return '🖼';
  if(AUD.includes(x)) return '🎵';
  return '📄';
}
function join(dir, name){ return (dir.endsWith('/')?dir:dir+'/') + name; }

async function checkDevice(){
  const el = document.getElementById('device');
  try{
    const r = await fetch('/api/devices'); const j = await r.json();
    const on = (j.devices||[]).filter(d=>d.state==='device');
    if(!on.length){
      const any = (j.devices||[])[0];
      el.innerHTML = any
        ? '<span class="bad">● '+any.serial+' ('+any.state+')</span>'
        : '<span class="bad">● tidak ada device — colok USB & izinkan debugging</span>';
    } else {
      el.innerHTML = on.map(d=>'<span class="ok">● '+(d.model||d.serial)+'</span>').join(' ');
    }
  }catch(e){ el.innerHTML = '<span class="bad">● server error</span>'; }
}

function crumbs(p){
  const box = document.getElementById('crumbs');
  const parts = p.replace(/\/+$/,'').split('/').filter(Boolean);
  let acc = '';
  let html = '<a onclick="load(\'/\')">/</a>';
  parts.forEach((seg,i)=>{
    acc += '/' + seg;
    const path = acc + '/';
    html += '<span class="sep">/</span><a onclick="load(\''+path.replace(/'/g,"\\'")+'\')">'+seg+'</a>';
  });
  box.innerHTML = html;
}

async function load(p){
  cur = p;
  document.getElementById('err').innerHTML = '';
  document.getElementById('content').innerHTML = '<div class="msg">memuat…</div>';
  crumbs(p);
  try{
    const r = await fetch('/api/list?path='+encodeURIComponent(p));
    const j = await r.json();
    if(j.error) document.getElementById('err').innerHTML = '<div class="err">⚠ '+j.error+'</div>';
    curEntries = j.entries || [];
    render(p);
  }catch(e){
    document.getElementById('content').innerHTML = '<div class="err">Gagal memuat: '+e.message+'</div>';
  }
}

function setSort(key){
  if(sortState.key === key) sortState.asc = !sortState.asc;
  else { sortState.key = key; sortState.asc = true; }
  render(cur);
}

function sortEntries(entries){
  const { key, asc } = sortState;
  const dir = asc ? 1 : -1;
  return entries.slice().sort((a, b) => {
    // folder selalu di atas
    if(a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let r;
    if(key === 'size') r = (a.size||0) - (b.size||0);
    else if(key === 'mtime') r = String(a.mtime||'').localeCompare(String(b.mtime||''));
    else r = a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' });
    if(r === 0) r = a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' });
    return r * dir;
  });
}

function arrow(key){
  if(sortState.key !== key) return '<span class="arr">↕</span>';
  return '<span class="arr on">'+(sortState.asc ? '↑' : '↓')+'</span>';
}

function render(p){
  if(!curEntries.length){
    document.getElementById('content').innerHTML = '<div class="msg">Folder kosong (atau tidak bisa diakses).</div>';
    return;
  }
  const entries = sortEntries(curEntries);
  let rows = '';
  entries.forEach(e=>{
    const full = join(p, e.name);
    const fp = encodeURIComponent(full);
    const x = ext(e.name);
    const previewable = VID.includes(x) || IMG.includes(x) || AUD.includes(x);
    let actions = '';
    if(!e.isDir){
      if(previewable) actions += '<a onclick="preview(\''+full.replace(/'/g,"\\'")+'\')">👁 Lihat</a>';
      actions += '<a href="/api/download?path='+fp+'">⬇ Download</a>';
    }
    const nameCell = e.isDir
      ? '<span class="nm" onclick="load(\''+full.replace(/'/g,"\\'")+'/\')">'+escapeHtml(e.name)+'</span>'
      : '<span class="nm">'+escapeHtml(e.name)+'</span>';
    rows += '<tr class="row '+(e.isDir?'dir':'file')+'">'
      + '<td class="name"><span class="ico">'+icon(e)+'</span>'+nameCell+'</td>'
      + '<td class="size">'+(e.sizeHuman||'')+'</td>'
      + '<td class="date">'+(e.mtime||'')+'</td>'
      + '<td class="actions">'+actions+'</td></tr>';
  });
  document.getElementById('content').innerHTML =
    '<table><thead><tr>'
    + '<th class="sortable" onclick="setSort(\'name\')">Nama '+arrow('name')+'</th>'
    + '<th class="sortable" onclick="setSort(\'size\')">Ukuran '+arrow('size')+'</th>'
    + '<th class="sortable" onclick="setSort(\'mtime\')">Diubah '+arrow('mtime')+'</th>'
    + '<th></th></tr></thead><tbody>'
    + rows + '</tbody></table>';
}

function preview(full){
  const name = full.split('/').pop();
  const x = ext(name);
  const fp = encodeURIComponent(full);
  document.getElementById('mTitle').textContent = name;
  document.getElementById('mDl').href = '/api/download?path='+fp;
  let body = '';
  if(VID.includes(x)) body = '<video src="/api/view?path='+fp+'" controls autoplay></video>';
  else if(IMG.includes(x)) body = '<img src="/api/view?path='+fp+'">';
  else if(AUD.includes(x)) body = '<audio src="/api/view?path='+fp+'" controls autoplay style="width:60vw"></audio>';
  document.getElementById('mBody').innerHTML = body;
  document.getElementById('modal').classList.add('open');
}
function closeModal(){
  document.getElementById('modal').classList.remove('open');
  document.getElementById('mBody').innerHTML = '';
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

checkDevice();
load(cur);
</script>
</body>
</html>`;
