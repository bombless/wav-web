const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function nearestNote(freq) {
  if (!(freq > 0)) return ['—', 0];
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return [`${N[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`, 440 * 2 ** ((midi - 69) / 12)];
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readWav(bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw Error('不是有效的 RIFF/WAVE 文件');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12;
  let fmt = null;
  let data = null;

  while (p + 8 <= bytes.length) {
    const id = ascii(bytes, p, 4);
    const n = dv.getUint32(p + 4, true);
    p += 8;
    if (p + n > bytes.length) throw Error('WAV 数据块超出文件范围');

    if (id === 'fmt ') {
      if (n < 16) throw Error('WAV fmt 块无效');
      fmt = {
        format: dv.getUint16(p, true),
        channels: dv.getUint16(p + 2, true),
        sampleRate: dv.getUint32(p + 4, true),
        bits: dv.getUint16(p + 14, true)
      };
    } else if (id === 'data') {
      data = [p, n];
      break;
    }
    p += n + (n & 1);
  }

  if (!fmt || !data) throw Error('WAV 缺少 fmt 或 data 块');
  if (!fmt.channels || !fmt.sampleRate) throw Error('WAV 音频参数无效');
  if (!((fmt.format === 1 && fmt.bits === 16) || (fmt.format === 3 && fmt.bits === 32))) {
    throw Error('仅支持 16-bit PCM 或 32-bit float WAV');
  }

  const [start, size] = data;
  const bytesPerSample = fmt.bits / 8;
  const blockAlign = bytesPerSample * fmt.channels;
  const frames = Math.floor(size / blockAlign);
  const mono = new Float64Array(frames);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = start + i * blockAlign + c * bytesPerSample;
      sum += fmt.format === 1
        ? dv.getInt16(o, true) / 32768
        : dv.getFloat32(o, true);
    }
    mono[i] = sum / fmt.channels;
  }

  return { mono, sampleRate: fmt.sampleRate };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    const co = Math.cos(a), si = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2;
        const tr = re[v] * wr - im[v] * wi;
        const ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const nw = wr * co - wi * si;
        wi = wr * si + wi * co;
        wr = nw;
      }
    }
  }
}

export function analyzeWav(bytes, win = 2048, hop = 512) {
  const { mono, sampleRate: sr } = readWav(bytes);
  if ((win & (win - 1)) !== 0) throw Error('win 必须是 2 的幂');
  if (hop <= 0) throw Error('hop 必须大于 0');

  const hann = Float64Array.from({ length: win }, (_, i) => .5 * (1 - Math.cos(2 * Math.PI * i / (win - 1))));
  const track = [], sampledTrack = [], tonesTrack = [];
  const half = win >> 1;
  const nyq = sr / 2;

  for (let start = 0; start + win <= mono.length; start += hop) {
    const re = new Float64Array(win), im = new Float64Array(win);
    for (let i = 0; i < win; i++) re[i] = mono[start + i] * hann[i];
    fft(re, im);

    const peaks = [];
    for (let k = 1; k < half; k++) peaks.push([k, re[k] * re[k] + im[k] * im[k]]);
    peaks.sort((a, b) => b[1] - a[1]);

    const top3 = peaks.slice(0, 3).map(([k]) => Math.min(nyq, k * sr / win));
    while (top3.length < 3) top3.push(0);

    const seen = new Set(), top9 = [];
    for (const [k, power] of peaks) {
      const f = k * sr / win;
      const [name, nf] = nearestNote(f);
      if (!(nf > 0) || seen.has(name)) continue;
      seen.add(name);
      top9.push([name, nf, power]);
      if (top9.length === 9) break;
    }

    const t = start / sr;
    track.push([t, top3[0]]);
    sampledTrack.push([t, top3]);
    tonesTrack.push([t, top9]);
  }

  return {
    track,
    sampledTrack,
    tonesTrack,
    duration: mono.length / sr,
    sampleRate: sr,
    fMax: nyq
  };
}
