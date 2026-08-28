import Vue from 'vue';
import { analyzeWav } from './music-browser.js';

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const vm = new Vue({
  el: '#app',
  data: {
    status: '请选择 WAV 文件',
    meta: '',
    noteLines: true,
    sampled: true,
    beatLines: true,
    beatNotes: true,
    dismiss: false,
    bpm: 120,
    meter: '4/4',
    track: 'max',
    fromStart: true,
    playing: false,
    analysis: null,
    audio: null,
    audioCtx: null,
    rawBytes: null,
    pauseOffset: 0,
    _playStart: 0,
    _playTimer: null,
    _raf: 0,
    canvas: null,
    ctx: null,
    fileInput: null,
    view: { x0: 0, x1: 10, y0: 0, y1: 22050 },
    drag: null,
    notes: [],
    playPos: 0,
    _playGen: 0
  },
  mounted() {
    this.$nextTick(() => {
      this.canvas = document.getElementById('plot');
      this.fileInput = document.getElementById('file');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return;

      this.fileInput?.addEventListener('change', this.onFile);
      this.resize();
      window.addEventListener('resize', this.resize);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('click', this.onClick);
      this.draw();
    });
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.resize);
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('click', this.onClick);
    }
    this.fileInput?.removeEventListener('change', this.onFile);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  },
  methods: {
    sx(x) { return (x - this.view.x0) / (this.view.x1 - this.view.x0) * this.canvas.clientWidth; },
    sy(y) { return this.canvas.clientHeight - (y - this.view.y0) / (this.view.y1 - this.view.y0) * this.canvas.clientHeight; },
    tx(px) { return this.view.x0 + px / this.canvas.clientWidth * (this.view.x1 - this.view.x0); },
    ty(py) { return this.view.y0 + (this.canvas.clientHeight - py) / this.canvas.clientHeight * (this.view.y1 - this.view.y0); },

    async onFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      this.stopAudio();
      this.playing = false;
      this.pauseOffset = 0;
      this.status = '分析中…';
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        this.rawBytes = bytes;
        this.analysis = analyzeWav(bytes);
        this.view = {
          x0: 0, x1: this.analysis.duration,
          y0: 0, y1: this.analysis.fMax
        };
        this.makeNotes();
        this.meta = `${file.name} · ${this.analysis.duration.toFixed(3)}s · ${this.analysis.sampleRate}Hz`;
        this.status = '分析完成';
        this.draw();
      } catch (err) {
        this.analysis = null;
        this.status = `错误：${err.message}`;
        this.meta = '';
        this.draw();
      }
    },
    resize() {
      if (!this.canvas || !this.ctx) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = this.canvas.clientWidth * dpr;
      this.canvas.height = this.canvas.clientHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    },
    reset() {
      if (this.analysis) {
        this.view = { x0: 0, x1: this.analysis.duration, y0: 0, y1: this.analysis.fMax };
      }
      this.draw();
    },
    makeNotes() {
      if (!this.analysis) return;
      const bpm = Number(this.bpm) || 120;
      const bd = 60 / bpm;
      const count = Math.ceil(this.analysis.duration / bd);
      this.notes = [];
      for (let i = 0; i < count; i++) {
        const t = i * bd;
        const arr = [];
        for (const [tt, cands] of this.analysis.tonesTrack) {
          if (tt >= t && tt < t + bd) {
            for (const c of cands) {
              const old = arr.find(x => x[0] === c[0]);
              if (old) old[2] += c[2];
              else arr.push([...c]);
            }
          }
        }
        arr.sort((a, b) => b[2] - a[2]);
        const c = arr[0] || ['—', 0, 0];
        this.notes.push({
          id: i, t, name: c[0], freq: c[1],
          candidates: arr.slice(0, 15), full: false, dismiss: false
        });
      }
    },

    draw() {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, w, h);
      if (!this.analysis) {
        ctx.fillStyle = '#8993a4';
        ctx.font = '16px system-ui';
        ctx.fillText('载入 WAV 后显示主频轨迹', 24, 32);
        return;
      }
      const { x0, x1, y0, y1 } = this.view;
      const sx = x => (x - x0) / (x1 - x0) * w;
      const sy = y => h - (y - y0) / (y1 - y0) * h;

      // 12-TET reference lines
      if (this.noteLines) {
        const min = Math.max(20, y0);
        const max = y1;
        for (let m = 12; m < 128; m++) {
          const f = 440 * 2 ** ((m - 69) / 12);
          if (f < min || f > max) continue;
          const y = sy(f);
          ctx.strokeStyle = m === 60 ? '#3b82f6' : 'rgba(120,140,200,.22)';
          ctx.lineWidth = m === 60 ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          if ((y1 - y0) < 5000 || m % 12 === 0) {
            ctx.fillStyle = '#8c98aa';
            ctx.font = '11px system-ui';
            ctx.fillText(`${NOTE[m % 12]}${Math.floor(m / 12) - 1}`, 5, y - 3);
          }
        }
      }

      // frequency tracks
      const line = (points, stroke, width) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.beginPath();
        let started = false;
        for (const p of points) {
          if (p[0] < x0 || p[0] > x1) continue;
          const x = sx(p[0]), y = sy(p[1]);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      if (this.sampled) {
        for (let i = 0; i < 3; i++) {
          line(this.analysis.sampledTrack.map(p => [p[0], p[1][i]]), 'rgba(168,85,247,.55)', 1.2);
        }
      }
      line(this.analysis.track, '#ff355d', this.track === 'max' ? 2.8 : 1.8);

      // beat lines
      const beatDur = 60 / Math.max(1, this.bpm);
      const meterTop = Number(this.meter.split('/')[0]);
      if (this.beatLines) {
        for (let t = Math.floor(x0 / beatDur) * beatDur; t <= x1; t += beatDur) {
          const n = Math.round(t / beatDur);
          const strong = n % meterTop === 0;
          ctx.strokeStyle = strong ? 'rgba(30,150,255,.7)' : 'rgba(100,150,255,.25)';
          ctx.lineWidth = strong ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(sx(t), 0);
          ctx.lineTo(sx(t), h);
          ctx.stroke();
          if (strong) {
            ctx.fillStyle = '#62a8ff';
            ctx.font = '11px system-ui';
            ctx.fillText(`小节 ${Math.floor(n / meterTop) + 1}`, sx(t) + 3, h - 8);
          }
        }
      }

      // beat note boxes
      if (this.beatNotes) {
        for (const b of this.notes) {
          if (b.t < x0 - beatDur || b.t > x1) continue;
          const x = sx(b.t);
          const rw = Math.max(30, sx(b.t + beatDur * 0.8) - x);
          const y = 28;
          ctx.fillStyle = b.dismiss ? 'rgba(70,70,80,.35)' : '#315f9e';
          ctx.fillRect(x, y, rw, 34);
          ctx.strokeStyle = b.full ? '#ffd43b' : '#7da7df';
          ctx.strokeRect(x, y, rw, 34);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(b.dismiss ? '—' : b.name, x + rw / 2, y + 15);
          ctx.font = '10px system-ui';
          ctx.fillText(b.dismiss ? '已消除' : `${b.freq.toFixed(1)}Hz`, x + rw / 2, y + 29);
          ctx.textAlign = 'left';
          if (this.dismiss) {
            ctx.save();
            ctx.fillStyle = b.dismiss ? '#f6c343' : '#ef4444';
            ctx.beginPath();
            ctx.arc(x + rw, y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#10131a';
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // playback position
      if (this.playPos > 0) {
        ctx.strokeStyle = 'rgba(0,255,100,.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx(this.playPos), 0);
        ctx.lineTo(sx(this.playPos), h);
        ctx.stroke();
      }

      // border & axis labels
      ctx.strokeStyle = '#333b48';
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.fillStyle = '#8f9aaa';
      ctx.font = '11px system-ui';
      for (let i = 0; i <= 10; i++) {
        const t = x0 + (x1 - x0) * i / 10;
        ctx.fillText(`${t.toFixed(2)}s`, sx(t) + 2, h - 4);
      }
      ctx.fillText(`${Math.round(y1)} Hz`, 5, 13);
    },

    onClick(e) {
      if (!this.analysis || this.drag) return;
      const rect = this.canvas.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const x = this.tx(ox);
      const y = this.ty(oy);
      const beatDur = 60 / (Number(this.bpm) || 120);

      if (e.ctrlKey) {
        this.playPos = Math.max(0, Math.min(this.analysis.duration, x));
        if (this.playing) this.restart(this.playPos);
        this.draw();
        return;
      }

      if (!this.beatNotes) return;
      const b = this.notes.find(n => {
        const bx = this.sx(n.t);
        const bw = Math.max(30, this.sx(n.t + beatDur * 0.8) - bx);
        const dotX = bx + bw, dotY = 28;
        if (Math.hypot(ox - dotX, oy - dotY) <= 9) return true;
        return ox >= bx && ox <= bx + bw && oy >= 28 && oy <= 62;
      });
      if (!b) return;

      const bx = this.sx(b.t);
      const bw = Math.max(30, this.sx(b.t + beatDur * 0.8) - bx);
      const dist = Math.hypot(ox - (bx + bw), oy - 28);

      if (this.dismiss && dist <= 11) {
        b.dismiss = !b.dismiss;
        this.draw();
        return;
      }
      if (e.shiftKey && this.dismiss) {
        b.dismiss = !b.dismiss;
        this.draw();
        return;
      }
      if (b.dismiss) {
        b.dismiss = false;
        this.draw();
        return;
      }
      const idx = b.candidates.findIndex(c => c[0] === b.name);
      const c = b.candidates[(idx + 1) % Math.max(1, b.candidates.length)];
      if (c) {
        b.name = c[0];
        b.freq = c[1];
      } else {
        b.full = !b.full;
      }
      this.draw();
    },

    onWheel(e) {
      if (!this.canvas || !this.analysis) return;
      e.preventDefault();
      const cx = this.tx(e.offsetX);
      const cy = this.ty(e.offsetY);
      const k = e.deltaY > 0 ? 1.12 : 0.88;

      // zoom time (X)
      this.view.x0 = Math.max(0, cx - (cx - this.view.x0) * k);
      this.view.x1 = Math.min(this.analysis.duration, cx + (this.view.x1 - cx) * k);
      // zoom freq (Y)
      this.view.y0 = Math.max(0, cy - (cy - this.view.y0) * k);
      this.view.y1 = Math.min(this.analysis.fMax, cy + (this.view.y1 - cy) * k);

      if (this.view.x1 - this.view.x0 < 0.01) this.view.x1 = this.view.x0 + 0.01;
      this.draw();
    },
    onPointerDown(e) {
      if (!this.canvas) return;
      this.drag = {
        x: e.clientX, y: e.clientY,
        x0: this.view.x0, x1: this.view.x1,
        y0: this.view.y0, y1: this.view.y1
      };
      this.canvas.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      if (!this.drag || !this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const spanX = this.drag.x1 - this.drag.x0;
      const spanY = this.drag.y1 - this.drag.y0;
      const dx = (e.clientX - this.drag.x) / rect.width * spanX;
      const dy = (e.clientY - this.drag.y) / rect.height * spanY;
      this.view.x0 = Math.max(0, this.drag.x0 - dx);
      this.view.x1 = this.analysis ? Math.min(this.analysis.duration, this.drag.x1 - dx) : this.drag.x1 - dx;
      this.view.y0 = Math.max(0, this.drag.y0 + dy);
      this.view.y1 = this.analysis ? Math.min(this.analysis.fMax, this.drag.y1 + dy) : this.drag.y1 + dy;
      this.draw();
    },
    onPointerUp() { this.drag = null; },

    // audio
    ensureAudioCtx() {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return this.audioCtx;
    },
    stopAudio() {
      if (this.audio) {
        try { this.audio.stop(); } catch (e) { /* ignore */ }
        this.audio = null;
      }
      if (this._playTimer) { clearTimeout(this._playTimer); this._playTimer = null; }
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    },
    togglePlay() {
      if (this.playing) {
        this.stopAudio();
        this.playing = false;
        this.draw();
        return;
      }
      if (!this.analysis) return;
      this.playPos = 0;
      const offset = this.fromStart ? 0 : (this.pauseOffset || 0);
      this.startPlayback(offset);
    },
    startPlayback(offset) {
      this.stopAudio();
      if (this.track === 'original') {
        this.playOriginal(offset);
      } else if (this.track === 'notes') {
        this.playBuffer(this.synthNotes(), 44100, offset);
      } else {
        this.playBuffer(this.synthTrack(), 44100, offset);
      }
      this.playing = true;
      const remaining = Math.max(0, (this.analysis.duration - offset) * 1000);
      this._playTimer = setTimeout(() => {
        this.stopAudio();
        this.playing = false;
        this.playPos = 0;
        this.draw();
      }, remaining);
      this.tick();
    },
    restart(pos) {
      this.stopAudio();
      this.startPlayback(pos);
    },
    playBuffer(buf, sr, offset = 0) {
      const ctx = this.ensureAudioCtx();
      const gen = ++this._playGen;
      const source = ctx.createBufferSource();
      const ab = ctx.createBuffer(1, buf.length, sr);
      ab.copyToChannel(buf, 0);
      source.buffer = ab;
      source.connect(ctx.destination);
      source.onended = () => {
        if (gen !== this._playGen) return;
        this.playing = false;
        this.playPos = 0;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        this.draw();
      };
      source.start(0, offset);
      this.audio = source;
      this._playStart = ctx.currentTime - offset;
    },
    async playOriginal(offset) {
      try {
        const ctx = this.ensureAudioCtx();
        const gen = ++this._playGen;
        const buffer = await ctx.decodeAudioData(this.rawBytes.slice().buffer);
        if (gen !== this._playGen) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0, Math.min(offset, buffer.duration));
        src.onended = () => {
          if (gen !== this._playGen) return;
          this.playing = false;
          this.playPos = 0;
          if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
          this.draw();
        };
        this.audio = src;
        this._playStart = ctx.currentTime - offset;
      } catch (err) {
        console.error('[playOriginal] decode failed:', err);
        this.status = `播放失败：${err.message}`;
      }
    },
    synthTrack() {
      const sr = 44100;
      const dur = this.analysis.duration;
      const out = new Float32Array(Math.ceil(dur * sr));
      const mode = this.track;
      let phase = 0, k = 0;
      const p = mode === 'max' ? this.analysis.track
        : mode === 's1' ? this.analysis.sampledTrack.map(x => [x[0], x[1][0]])
        : mode === 's2' ? this.analysis.sampledTrack.map(x => [x[0], x[1][1]])
        : this.analysis.sampledTrack.map(x => [x[0], x[1][2]]);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        while (k + 1 < p.length && t > p[k + 1][0]) k++;
        let f = k + 1 < p.length ? p[k][1] : (p.at(-1)?.[1] || 0);
        if (k + 1 < p.length) {
          const [t0, f0] = p[k], [t1, f1] = p[k + 1];
          const a = (t - t0) / (t1 - t0);
          f = f0 + a * (f1 - f0);
        }
        phase += 2 * Math.PI * Math.max(0, Math.min(sr / 2, f)) / sr;
        out[i] = 0.25 * Math.sin(phase);
      }
      return out;
    },
    synthNotes() {
      const sr = 44100;
      const bd = 60 / (Number(this.bpm) || 120);
      const out = new Float32Array(Math.ceil(this.analysis.duration * sr));
      for (const b of this.notes) {
        if (b.dismiss) continue;
        const f = b.freq;
        if (!(f > 0)) continue;
        const start = Math.floor(b.t * sr);
        const len = Math.floor(bd * (b.full ? 1 : 0.9) * sr);
        for (let i = 0; i < len && start + i < out.length; i++) {
          const env = Math.min(1, i / (sr * 0.01), (len - i) / (sr * 0.1), 0.7);
          out[start + i] += 0.3 * env * Math.sin(2 * Math.PI * f * i / sr);
        }
      }
      return out;
    },
    tick() {
      if (!this.playing) return;
      this.playPos = Math.min(this.analysis.duration, this.audioCtx.currentTime - this._playStart);
      this.draw();
      this._raf = requestAnimationFrame(() => this.tick());
    }
  },
  watch: {
    noteLines: 'draw',
    sampled: 'draw',
    beatLines: 'draw',
    beatNotes: 'draw',
    dismiss: 'draw',
    bpm() { if (this.analysis) this.makeNotes(); this.draw(); },
    meter() { if (this.analysis) this.makeNotes(); this.draw(); },
    track: 'draw'
  }
});

export default vm;
