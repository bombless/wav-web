import { Buffer } from 'node:buffer';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function nearestNote(freq) {
  if (!(freq > 0)) return ['—', 0];
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const f = 440 * 2 ** ((midi - 69) / 12);
  return [`${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`, f];
}

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是有效的 RIFF/WAVE 文件');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), n = buf.readUInt32LE(p + 4); p += 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p), channels: buf.readUInt16LE(p + 2), sampleRate: buf.readUInt32LE(p + 4), bits: buf.readUInt16LE(p + 14) };
    if (id === 'data') { data = [p, Math.min(n, buf.length - p)]; break; }
    p += n + (n & 1);
  }
  if (!fmt || !data) throw new Error('WAV 缺少 fmt 或 data 块');
  if (!((fmt.format === 1 && fmt.bits === 16) || (fmt.format === 3 && fmt.bits === 32))) throw new Error('仅支持 16-bit PCM 或 32-bit float WAV');
  const [start, size] = data, bytes = fmt.bits / 8, frames = Math.floor(size / bytes / fmt.channels), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const off = start + (i * fmt.channels + c) * bytes;
      sum += fmt.format === 1 ? buf.readInt16LE(off) / 32768 : buf.readFloatLE(off);
    }
    mono[i] = sum / fmt.channels;
  }
  return { mono, sampleRate: fmt.sampleRate };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr0 = Math.cos(a), wi0 = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2, tr = re[v] * wr - im[v] * wi, ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const nw = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = nw;
      }
    }
  }
}

function analyze(mono, sr, win, hop) {
  if ((win & (win - 1)) !== 0) throw new Error('win 必须是 2 的幂');
  const hann = Float64Array.from({ length: win }, (_, n) => 0.5 * (1 - Math.cos(2 * Math.PI * n / (win - 1))));
  const track = [], sampled = [], tones = [];
  const half = win >> 1, nyq = sr / 2;
  for (let start = 0; start + win <= mono.length; start += hop) {
    const re = new Float64Array(win), im = new Float64Array(win);
    for (let i = 0; i < win; i++) re[i] = mono[start + i] * hann[i];
    fft(re, im);
    const peaks = [];
    for (let k = 0; k < half; k++) peaks.push([k, re[k] * re[k] + im[k] * im[k]]);
    peaks.sort((a, b) => b[1] - a[1]);
    const top3 = peaks.slice(0, 3).map(([k]) => Math.min(nyq, k * sr / win)); while (top3.length < 3) top3.push(0);
    const seen = new Set(), top9 = [];
    for (const [k, weight] of peaks) { const f = k * sr / win, [name, nf] = nearestNote(f); if (!(nf > 0) || seen.has(name)) continue; seen.add(name); top9.push([name, nf, weight]); if (top9.length === 9) break; }
    const t = start / sr; track.push([t, top3[0]]); sampled.push([t, top3]); tones.push([t, top9]);
  }
  return { track, sampledTrack: sampled, tonesTrack: tones, duration: mono.length / sr, sampleRate: sr, fMax: nyq };
}

export function analyzeWav(buf, winSize = 2048, hopSize = 512) {
  const { mono, sampleRate } = readWav(buf);
  if (!mono.length) throw new Error('WAV 没有音频数据');
  return analyze(mono, sampleRate, winSize, hopSize);
}
