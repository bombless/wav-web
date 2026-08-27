const $ = id => document.getElementById(id);
const canvas = $('plot');
const ctx = canvas.getContext('2d');

let data = null;
let fileBuffer = null;
let view = { x0: 0, x1: 1, y0: 0, y1: 22050 };
let drag = null;
let notes = [];
let audioCtx = null;
let source = null;
let playing = false;
let playStart = 0;
let playPos = 0;
let raf = 0;

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteAt(f) {
  if (!(f > 0)) return ['—', 0];
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return [`${NOTE[(m % 12 + 12) % 12]}${Math.floor(m / 12) - 1}`, 440 * 2 ** ((m - 69) / 12)];
}

function resize() {
  const d = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * d;
  canvas.height = canvas.clientHeight * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  draw();
}

addEventListener('resize', resize);

function sx(x) { return (x - view.x0) / (view.x1 - view.x0) * canvas.clientWidth; }
function sy(y) { return canvas.clientHeight - (y - view.y0) / (view.y1 - view.y0) * canvas.clientHeight; }
function tx(px) { return view.x0 + px / canvas.clientWidth * (view.x1 - view.x0); }
function ty(py) { return view.y0 + (canvas.clientHeight - py) / canvas.clientHeight * (view.y1 - view.y0); }

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, w, h);

  if (!data) {
    ctx.fillStyle = '#8993a4';
    ctx.font = '16px system-ui';
    ctx.fillText('载入 WAV 后显示主频轨迹', 24, 32);
    return;
  }

  if ($('noteLines').checked) {
    const min = Math.max(20, view.y0);
    const max = view.y1;
    for (let m = 12; m < 128; m++) {
      const f = 440 * 2 ** ((m - 69) / 12);
      if (f < min || f > max) continue;
      const y = sy(f);
      ctx.strokeStyle = m === 60 ? '#3b82f6' : 'rgba(120,140,200,.22)';
      ctx.lineWidth = m === 60 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if ((view.y1 - view.y0) < 5000 || m % 12 === 0) {
        ctx.fillStyle = '#8c98aa'; ctx.font = '11px system-ui';
        ctx.fillText(`${NOTE[m % 12]}${Math.floor(m / 12) - 1}`, 5, y - 3);
      }
    }
  }

  function line(points, stroke, width) {
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (p[0] < view.x0 || p[0] > view.x1) continue;
      const x = sx(p[0]), y = sy(p[1]);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  if ($('sampled').checked) {
    for (let i = 0; i < 3; i++) line(data.sampledTrack.map(p => [p[0], p[1][i]]), 'rgba(168,85,247,.55)', 1.2);
  }
  line(data.track, '#ff355d', $('track').value === 'max' ? 2.8 : 1.8);

  const beatDur = 60 / Math.max(1, Number($('bpm').value));

  if ($('beatLines').checked) {
    for (let t = Math.floor(view.x0 / beatDur) * beatDur; t <= view.x1; t += beatDur) {
      const n = Math.round(t / beatDur);
      const strong = n % Number($('meter').value.split('/')[0]) === 0;
      ctx.strokeStyle = strong ? 'rgba(30,150,255,.7)' : 'rgba(100,150,255,.25)';
      ctx.lineWidth = strong ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(sx(t), 0); ctx.lineTo(sx(t), h); ctx.stroke();
      if (strong) {
        ctx.fillStyle = '#62a8ff'; ctx.font = '11px system-ui';
        ctx.fillText(`小节 ${n / Number($('meter').value.split('/')[0]) + 1}`, sx(t) + 3, h - 8);
      }
    }
  }

  if ($('beatNotes').checked) {
    for (const b of notes) {
      if (b.t < view.x0 - beatDur || b.t > view.x1) continue;
      const x = sx(b.t);
      const rw = Math.max(30, sx(b.t + beatDur * 0.8) - x);
      const boxY = 28;
      const dotX = x + rw;
      const dotY = boxY - 7;

      ctx.fillStyle = b.dismiss ? 'rgba(70,70,80,.35)' : '#315f9e';
      ctx.fillRect(x, boxY, rw, 34);
      ctx.strokeStyle = b.full ? '#ffd43b' : '#7da7df';
      ctx.strokeRect(x, boxY, rw, 34);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(b.dismiss ? '—' : b.name, x + rw / 2, boxY + 15);
      ctx.font = '10px system-ui';
      ctx.fillText(b.dismiss ? '已消除' : `${b.freq.toFixed(1)}Hz`, x + rw / 2, boxY + 29);
      ctx.textAlign = 'left';

      if ($('dismiss').checked) {
        ctx.save();
        ctx.fillStyle = b.dismiss ? '#f6c343' : '#ef4444';
        ctx.beginPath(); ctx.arc(dotX, dotY, 7, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#10131a'; ctx.stroke();
        ctx.restore();
      }
    }
  }

  if (playPos > 0) {
    ctx.strokeStyle = 'rgba(0,255,100,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx(playPos), 0); ctx.lineTo(sx(playPos), h); ctx.stroke();
  }

  ctx.strokeStyle = '#333b48'; ctx.strokeRect(.5, .5, w - 1, h - 1);
  ctx.fillStyle = '#8f9aaa'; ctx.font = '11px system-ui';
  for (let i = 0; i <= 10; i++) {
    const t = view.x0 + (view.x1 - view.x0) * i / 10;
    ctx.fillText(`${t.toFixed(2)}s`, sx(t) + 2, h - 4);
  }
  ctx.fillText(`${Math.round(view.y1)} Hz`, 5, 13);
}

function makeNotes() {
  const bpm = Number($('bpm').value) || 120;
  const bd = 60 / bpm;
  const count = Math.ceil(data.duration / bd);
  notes = [];
  for (let i = 0; i < count; i++) {
    const t = i * bd;
    const arr = [];
    for (const [tt, cands] of data.tonesTrack) {
      if (tt >= t && tt < t + bd) {
        for (const c of cands) {
          const old = arr.find(x => x[0] === c[0]);
          if (old) old[2] += c[2]; else arr.push([...c]);
        }
      }
    }
    arr.sort((a, b) => b[2] - a[2]);
    const c = arr[0] || ['—', 0, 0];
    notes.push({ id: i, t, name: c[0], freq: c[1], candidates: arr.slice(0, 15), full: false, dismiss: false });
  }
}

async function loadFile(f) {
  $('status').textContent = '分析中…';
  fileBuffer = await f.arrayBuffer();
  const r = await fetch('/api/analyze?win=2048&hop=512', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: fileBuffer });
  if (!r.ok) throw Error((await r.json()).error || '分析失败');
  data = await r.json();
  view = { x0: 0, x1: data.duration, y0: 0, y1: data.fMax };
  makeNotes();
  $('meta').textContent = `${f.name} · ${data.duration.toFixed(3)}s · ${data.sampleRate}Hz`;
  $('status').textContent = '分析完成';
  resize();
}

$('file').onchange = e => {
  if (e.target.files[0]) loadFile(e.target.files[0]).catch(err => { $('status').textContent = err.message; });
};

for (const id of ['noteLines', 'sampled', 'beatLines', 'beatNotes', 'dismiss', 'bpm', 'meter']) {
  $(id).addEventListener('input', () => { if (data && (id === 'bpm' || id === 'meter')) makeNotes(); draw(); });
}

$('reset').onclick = () => { if (data) view = { x0: 0, x1: data.duration, y0: 0, y1: data.fMax }; draw(); };

canvas.addEventListener('wheel', e => {
  if (!data) return;
  e.preventDefault();
  const cx = tx(e.offsetX), cy = ty(e.offsetY), k = e.deltaY > 0 ? 1.12 : .88;
  view.x0 = Math.max(0, cx - (cx - view.x0) * k);
  view.x1 = Math.min(data.duration, cx + (view.x1 - cx) * k);
  view.y0 = Math.max(0, cy - (cy - view.y0) * k);
  view.y1 = Math.min(data.fMax, cy + (view.y1 - cy) * k);
  if (view.x1 - view.x0 < .01) view.x1 = view.x0 + .01;
  draw();
}, { passive: false });

canvas.onmousedown = e => { drag = { x: e.offsetX, y: e.offsetY, x0: view.x0, x1: view.x1, y0: view.y0, y1: view.y1 }; };
addEventListener('mouseup', () => { drag = null; });
canvas.onmousemove = e => {
  if (!drag) return;
  const dx = (e.offsetX - drag.x) / canvas.clientWidth * (drag.x1 - drag.x0);
  const dy = (e.offsetY - drag.y) / canvas.clientHeight * (drag.y1 - drag.y0);
  view.x0 = Math.max(0, drag.x0 - dx); view.x1 = Math.min(data.duration, drag.x1 - dx);
  view.y0 = Math.max(0, drag.y0 + dy); view.y1 = Math.min(data.fMax, drag.y1 + dy);
  draw();
};

canvas.onclick = e => {
  if (!data) return;
  const x = tx(e.offsetX);
  const y = ty(e.offsetY);
  const bd = 60 / (Number($('bpm').value) || 120);

  if (e.ctrlKey) {
    playPos = Math.max(0, Math.min(data.duration, x));
    if (playing) restart(playPos);
    draw();
    return;
  }

  if (!$('beatNotes').checked) return;

  if ($('dismiss').checked) {
    for (const b of notes) {
      if (b.t < view.x0 - bd || b.t > view.x1) continue;
      const bx = sx(b.t);
      const bw = Math.max(30, sx(b.t + bd * 0.8) - bx);
      const dotX = bx + bw;
      const dotY = 28 - 7;
      if (Math.hypot(e.offsetX - dotX, e.offsetY - dotY) <= 13) {
        b.dismiss = !b.dismiss;
        draw();
        return;
      }
    }
  }

  const b = notes.find(n => x >= n.t && x <= n.t + bd * .8 && y > 0 && y < view.y1 * .35);
  if (!b) return;

  if (e.shiftKey && $('dismiss').checked) {
    b.dismiss = !b.dismiss;
    draw();
    return;
  }

  if (b.dismiss) {
    b.dismiss = false;
    draw();
    return;
  }

  const idx = b.candidates.findIndex(c => c[0] === b.name);
  const c = b.candidates[(idx + 1) % Math.max(1, b.candidates.length)];
  if (c) { b.name = c[0]; b.freq = c[1]; }
  else b.full = !b.full;
  draw();
};

async function getOriginal() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx.decodeAudioData(fileBuffer.slice(0));
}

function synthTrack(points, duration, sr = 44100) {
  const out = new Float32Array(Math.ceil(duration * sr));
  const mode = $('track').value;
  let phase = 0, k = 0;
  const p = mode === 'max' ? data.track : mode === 's1' ? data.sampledTrack.map(x => [x[0], x[1][0]]) : mode === 's2' ? data.sampledTrack.map(x => [x[0], x[1][1]]) : data.sampledTrack.map(x => [x[0], x[1][2]]);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    while (k + 1 < p.length && t > p[k + 1][0]) k++;
    let f = k + 1 < p.length ? p[k][1] : (p.at(-1)?.[1] || 0);
    if (k + 1 < p.length) { const [t0, f0] = p[k], [t1, f1] = p[k + 1]; f = f0 + (t - t0) / (t1 - t0) * (f1 - f0); }
    phase += 2 * Math.PI * Math.max(0, Math.min(sr / 2, f)) / sr;
    out[i] = .25 * Math.sin(phase);
  }
  return out;
}

function playBuffer(buf, sr, offset = 0) {
  if (!audioCtx) audioCtx = new AudioContext();
  source = audioCtx.createBufferSource();
  const ab = audioCtx.createBuffer(1, buf.length, sr);
  ab.copyToChannel(buf, 0);
  source.buffer = ab;
  source.connect(audioCtx.destination);
  source.onended = () => { playing = false; playPos = 0; cancelAnimationFrame(raf); raf = 0; $('play').textContent = '播放合成音'; draw(); };
  source.start(0, offset);
  playing = true;
  playStart = audioCtx.currentTime - offset;
  cancelAnimationFrame(raf);
  tick();
}

function restart(pos) {
  if (source) try { source.stop(); } catch {}
  const mode = $('track').value;
  if (mode === 'original') getOriginal().then(b => playBuffer(b.getChannelData(0), b.sampleRate, pos));
  else if (mode === 'notes') playBuffer(synthNotes(), 44100, pos);
  else playBuffer(synthTrack(data.track, data.duration), 44100, pos);
}

function synthNotes() {
  const sr = 44100;
  const bd = 60 / (Number($('bpm').value) || 120);
  const out = new Float32Array(Math.ceil(data.duration * sr));
  for (const b of notes) {
    if (b.dismiss || !(b.freq > 0)) continue;
    const start = Math.floor(b.t * sr);
    const len = Math.floor(bd * (b.full ? 1 : .9) * sr);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.min(1, i / (sr * .01), (len - i) / (sr * .1), .7);
      out[start + i] += .3 * env * Math.sin(2 * Math.PI * b.freq * i / sr);
    }
  }
  return out;
}

function tick() {
  if (!playing) return;
  playPos = Math.min(data.duration, audioCtx.currentTime - playStart);
  draw();
  raf = requestAnimationFrame(tick);
}

$('play').onclick = async () => {
  if (playing) {
    try { source.stop(); } catch {}
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    $('play').textContent = '播放合成音';
    draw();
    return;
  }
  if (!data) return;
  $('play').textContent = '停止播放';
  if (!$('fromStart').checked && playPos > 0) restart(playPos);
  else { playPos = 0; restart(0); }
};

resize();
