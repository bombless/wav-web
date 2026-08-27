// client/app.js
// Simple client logic: upload wav, draw track with Plotly, play original/synth

const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const fileEl = document.getElementById('file');
const uploadBtn = document.getElementById('upload');
const audioEl = document.getElementById('audio');
const synthBtn = document.getElementById('synthBtn');
const winInput = document.getElementById('win_size');
const hopInput = document.getElementById('hop_size');

let currentId = null;
let currentAnalysis = null;

uploadBtn.onclick = async () => {
  const f = fileEl.files[0];
  if (!f) return alert('Please select a WAV file');
  const fd = new FormData();
  fd.append('wav', f);
  fd.append('win_size', winInput.value);
  fd.append('hop_size', hopInput.value);
  statusEl.innerText = 'Uploading...';
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const j = await res.json();
  if (!j.ok) { statusEl.innerText = 'Error: ' + (j.error || 'unknown'); return; }
  currentId = j.id;
  currentAnalysis = j;
  statusEl.innerText = 'Analyzed: ' + currentId;
  infoEl.innerText = `sampleRate: ${j.sampleRate}, duration: ${j.duration.toFixed(3)}s`;
  // set audio src to original
  audioEl.src = `/storage/${currentId}/original.wav`;
  drawPlot(j.track, j.sampledTrack);
};

function drawPlot(track, sampledTrack) {
  const xs = track.map(p => p[0]);
  const ys = track.map(p => p[1]);
  const traceMain = { x: xs, y: ys, mode: 'lines', name: 'dominant' };
  const sampleTraces = [];
  if (sampledTrack && sampledTrack.length) {
    for (let i = 0; i < 3; i++) {
      sampleTraces.push({ x: sampledTrack.map(s => s[0]), y: sampledTrack.map(s => s[1][i]), mode: 'lines', name: `sample${i+1}`, line: { dash: 'dot' } });
    }
  }
  Plotly.newPlot('plot', [traceMain, ...sampleTraces], { xaxis: { title: 'time (s)'}, yaxis: { title: 'freq (Hz)'} });
}

synthBtn.onclick = async () => {
  if (!currentAnalysis) return alert('Upload first');
  // synth using dominant track
  statusEl.innerText = 'Synthesizing...';
  const body = { track: currentAnalysis.track, duration: currentAnalysis.duration, srOut: 44100 };
  const res = await fetch('/synth', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) { statusEl.innerText = 'Synth failed'; return; }
  const arr = await res.arrayBuffer();
  const blob = new Blob([arr], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  audioEl.src = url;
  audioEl.play();
  statusEl.innerText = 'Synth ready';
}

// annotations
const downloadBtn = document.getElementById('downloadAnnotations');
downloadBtn.onclick = async () => {
  if (!currentId) return alert('No upload');
  const res = await fetch(`/annotations/${currentId}`);
  const j = await res.json();
  const data = JSON.stringify(j.annotations || [], null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentId}-annotations.json`;
  a.click();
};

const loadBtn = document.getElementById('loadAnnotations');
loadBtn.onclick = async () => {
  if (!currentId) return alert('No upload');
  const res = await fetch(`/annotations/${currentId}`);
  const j = await res.json();
  alert('Annotations loaded: ' + ((j.annotations||[]).length));
};
