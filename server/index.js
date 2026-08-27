const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const wavDecoder = require('wav-decoder');
const FFT = require('fft-js').fft;
const FFTUtils = require('fft-js').util;
const { WaveFile } = require('wavefile');
const bodyParser = require('body-parser');
const path = require('path');

const upload = multer({ dest: 'uploads/' });
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Serve static client
app.use('/', express.static(path.join(__dirname, '..', 'client')));

// Simple storage folders
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('storage')) fs.mkdirSync('storage');

// Utilities
function mixdownToMono(channelData) {
  if (!channelData || channelData.length === 0) return new Float32Array(0);
  if (channelData.length === 1) return channelData[0];
  const len = channelData[0].length;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < channelData.length; c++) s += channelData[c][i];
    mono[i] = s / channelData.length;
  }
  return mono;
}

function hannWindow(winSize) {
  const w = new Float32Array(winSize);
  for (let n = 0; n < winSize; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (winSize - 1)));
  }
  return w;
}

function equalTemperamentMarks(fMin, fMax) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const v = [];
  for (let midi = 0; midi <= 127; midi++) {
    const f = 440.0 * Math.pow(2, (midi - 69) / 12.0);
    if (f >= fMin && f <= fMax) {
      const pc = midi % 12;
      const octave = Math.floor(midi / 12) - 1;
      const name = `${names[pc]}${octave}`;
      v.push({ f, name, midi });
    }
  }
  return v;
}

function nearestNoteJS(freq) {
  if (!freq || freq <= 0) return { name: 'N/A', f: 0 };
  const midi = Math.round(69 + 12 * Math.log2(freq / 440.0));
  const midi_i = Math.max(0, Math.min(127, midi));
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const pc = midi_i % 12;
  const octave = Math.floor(midi_i / 12) - 1;
  const name = `${names[pc]}${octave}`;
  const f = 440.0 * Math.pow(2, (midi_i - 69) / 12.0);
  return { name, f };
}

async function dominantFrequencyTrack(mono, sr, winSize = 2048, hopSize = 512) {
  const hann = hannWindow(winSize);
  const half = Math.floor(winSize / 2);
  const nyquist = sr / 2;
  const track = [];
  const sampledTrack = [];
  const tonesTrack = [];

  let start = 0;
  while (start + winSize <= mono.length) {
    const windowed = new Array(winSize);
    for (let i = 0; i < winSize; i++) windowed[i] = mono[start + i] * hann[i];

    // prepare complex input for fft-js: as real array is acceptable
    const ph = FFT(windowed);
    const mags = FFTUtils.fftMag(ph).slice(0, half);

    // peaks sorted
    const peaks = mags.map((m, idx) => ({ idx, m })).sort((a, b) => b.m - a.m);

    const top3 = [
      (peaks[0] ? peaks[0].idx : 0) * sr / winSize,
      (peaks[1] ? peaks[1].idx : 0) * sr / winSize,
      (peaks[2] ? peaks[2].idx : 0) * sr / winSize
    ].map(f => Math.min(Math.max(f, 0), nyquist));

    const tonesSet = new Set();
    const top9 = [];
    for (const p of peaks) {
      const freq = p.idx * sr / winSize;
      if (freq <= 0) continue;
      const n = nearestNoteJS(freq);
      if (!tonesSet.has(n.name)) {
        tonesSet.add(n.name);
        top9.push({ name: n.name, freq: n.f, weight: p.m });
        if (top9.length >= 9) break;
      }
    }

    const t = start / sr;
    track.push([t, top3[0] || 0]);
    sampledTrack.push([t, top3]);
    tonesTrack.push([t, top9]);

    start += hopSize;
  }

  return { track, sampledTrack, tonesTrack };
}

function synthSineFromTrack(track, srOut = 44100, duration = 1.0, amp = 0.25) {
  if (!track || track.length === 0) return new Float32Array(0);
  const n = Math.round(duration * srOut);
  const out = new Float32Array(n);
  let phase = 0.0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / srOut;
    while (k + 1 < track.length && t > track[k+1][0]) k++;
    let fInst = track[k][1];
    if (k + 1 < track.length) {
      const t0 = track[k][0], f0 = track[k][1];
      const t1 = track[k+1][0], f1 = track[k+1][1];
      if (t1 > t0) {
        const a = (t - t0) / (t1 - t0);
        fInst = f0 + a * (f1 - f0);
      }
    }
    fInst = Math.max(0, Math.min(srOut/2, fInst));
    phase += 2 * Math.PI * fInst / srOut;
    out[i] = amp * Math.sin(phase);
  }
  return out;
}

function float32ToInt16(float32Array) {
  const l = float32Array.length;
  const buf = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buf;
}

function encodeWav(samplesFloat32, sampleRate = 44100) {
  const int16 = float32ToInt16(samplesFloat32);
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, '16', int16);
  return Buffer.from(wav.toBuffer());
}

// POST /upload - upload wav and analyze
app.post('/upload', upload.single('wav'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const buf = fs.readFileSync(filePath);
    const decoded = await wavDecoder.decode.sync(buf);
    const sr = decoded.sampleRate;
    const channelData = decoded.channelData;
    const mono = mixdownToMono(channelData);

    const winSize = parseInt(req.body.win_size) || 2048;
    const hopSize = parseInt(req.body.hop_size) || 512;

    const { track, sampledTrack, tonesTrack } = await dominantFrequencyTrack(mono, sr, winSize, hopSize);
    const equalMarks = equalTemperamentMarks(20, sr/2);

    // create an id for this upload and save original wav bytes for playback
    const id = `upload_${Date.now()}`;
    const storageDir = path.join('storage', id);
    fs.mkdirSync(storageDir);
    fs.writeFileSync(path.join(storageDir, 'original.wav'), buf);

    // save analysis json
    const meta = { sampleRate: sr, duration: mono.length / sr, track, sampledTrack, tonesTrack, equalMarks };
    fs.writeFileSync(path.join(storageDir, 'analysis.json'), JSON.stringify(meta));

    // cleanup uploads
    fs.unlinkSync(filePath);

    res.json({ ok: true, id, ...meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

// GET /storage/:id/original.wav - serve original uploaded wav
app.get('/storage/:id/original.wav', (req, res) => {
  const p = path.join('storage', req.params.id, 'original.wav');
  if (fs.existsSync(p)) {
    res.setHeader('Content-Type', 'audio/wav');
    res.sendFile(path.resolve(p));
  } else {
    res.status(404).send('Not found');
  }
});

// POST /synth - synthesize wav from provided track
app.post('/synth', (req, res) => {
  try {
    const { track, duration, srOut = 44100 } = req.body;
    if (!track || !duration) return res.status(400).json({ ok: false, error: 'missing track or duration' });
    const samples = synthSineFromTrack(track, srOut, duration, 0.25);
    const wavBuf = encodeWav(samples, srOut);
    res.setHeader('Content-Type', 'audio/wav');
    res.send(wavBuf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

// Annotations save/load
app.post('/annotations/save', (req, res) => {
  try {
    const { id, annotations } = req.body;
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
    const p = path.join('storage', id, 'annotations.json');
    fs.writeFileSync(p, JSON.stringify(annotations || []));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});
app.get('/annotations/:id', (req, res) => {
  try {
    const p = path.join('storage', req.params.id, 'annotations.json');
    if (!fs.existsSync(p)) return res.json({ ok: true, annotations: [] });
    const data = JSON.parse(fs.readFileSync(p));
    res.json({ ok: true, annotations: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
