import Vue from 'vue';
import { analyzeWav, nearestNote } from './music-browser.js';

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
    canvas: null,
    ctx: null,
    fileInput: null,
    view: { minTime: 0, maxTime: 10, minFreq: 0, maxFreq: 2000 },
    drag: null
  },
  mounted() {
    this.$nextTick(() => {
      // In Vue 2, $el is not guaranteed to be a DOM Element here in every build.
      // Use document lookup for the two static elements instead of $el.querySelector().
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
      this.draw();
    });
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.resize);
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.onWheel);
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    }
    this.fileInput?.removeEventListener('change', this.onFile);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  },
  methods: {
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
        this.view.maxTime = this.analysis.duration;
        this.view.maxFreq = Math.max(2000, this.analysis.fMax);
        this.meta = `${file.name} · ${this.analysis.sampleRate} Hz · ${this.analysis.duration.toFixed(2)} s`;
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
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    },
    reset() {
      this.view = {
        minTime: 0,
        maxTime: this.analysis ? this.analysis.duration : 10,
        minFreq: 0,
        maxFreq: this.analysis ? Math.max(2000, this.analysis.fMax) : 2000
      };
      this.draw();
    },
    togglePlay() {
      if (this.playing) {
        this.pausePlayback();
        return;
      }
      if (!this.analysis) {
        console.warn('[togglePlay] no analysis loaded, nothing to play');
        return;
      }
      this.startPlayback();
    },
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
    },
    startPlayback() {
      this.stopAudio();
      const offset = this.fromStart ? 0 : (this.pauseOffset || 0);
      if (this.track === 'original') {
        this.playOriginal(offset);
      } else {
        this.playSynthesized(offset);
      }
      this.playing = true;
      const remaining = Math.max(0, (this.analysis.duration - offset) * 1000);
      this._playTimer = setTimeout(() => {
        this.stopAudio();
        this.playing = false;
        this.pauseOffset = 0;
      }, remaining);
    },
    pausePlayback() {
      if (this.audioCtx && this._playStart) {
        const elapsed = this.audioCtx.currentTime - this._playStart;
        this.pauseOffset = Math.max(0, Math.min(this.analysis.duration, elapsed));
      }
      this.stopAudio();
      this.playing = false;
    },
    buildVoices() {
      const a = this.analysis;
      const mk = fn => a.sampledTrack.map(([t, freqs]) => [t, fn(freqs) || 0]);
      switch (this.track) {
        case 's1': return [mk(f => f[0])];
        case 's2': return [mk(f => f[1])];
        case 's3': return [mk(f => f[2])];
        case 'notes': return [a.tonesTrack.map(([t, tones]) => [t, tones[0] ? tones[0][1] : 0])];
        case 'original': return null;
        case 'max':
        default: return [mk(f => f[0])];
      }
    },
    playSynthesized(offset) {
      const ctx = this.ensureAudioCtx();
      const duration = this.analysis.duration;
      const voices = this.buildVoices();
      const t0 = ctx.currentTime - offset;
      this._playStart = t0;

      const master = ctx.createGain();
      master.gain.value = 0.6;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4500;
      master.connect(filter).connect(ctx.destination);

      const oscillators = [];
      for (const voice of voices) {
        if (!voice || !voice.length) continue;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g).connect(master);
        let prevGain = 0;
        for (const [t, f] of voice) {
          if (t > duration) break;
          const ct = t0 + t;
          if (f > 0) {
            osc.frequency.setValueAtTime(Math.max(20, Math.min(8000, f)), ct);
            if (prevGain === 0) {
              g.gain.setValueAtTime(0, ct);
              g.gain.linearRampToValueAtTime(0.3, ct + 0.012);
              prevGain = 0.3;
            }
          } else if (prevGain !== 0) {
            g.gain.linearRampToValueAtTime(0, ct + 0.012);
            prevGain = 0;
          }
        }
        osc.start(t0 + offset);
        osc.stop(t0 + duration + 0.1);
        oscillators.push(osc);
      }
      console.log('[playSynthesized] track=', this.track, 'voices=', voices.length, 'offset=', offset.toFixed(2), 's');
      this.audio = {
        stop: () => {
          for (const o of oscillators) { try { o.stop(); } catch (e) { /* ignore */ } }
          try { master.disconnect(); } catch (e) { /* ignore */ }
        }
      };
    },
    async playOriginal(offset) {
      try {
        const ctx = this.ensureAudioCtx();
        const t0 = ctx.currentTime - offset;
        this._playStart = t0;
        const buffer = await ctx.decodeAudioData(this.rawBytes.slice().buffer);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0, Math.min(offset, buffer.duration));
        console.log('[playOriginal] decoded', buffer.duration.toFixed(2), 's, offset=', offset.toFixed(2), 's');
        this.audio = {
          stop: () => { try { src.stop(); } catch (e) { /* ignore */ } try { src.disconnect(); } catch (e) { /* ignore */ } }
        };
      } catch (err) {
        console.error('[playOriginal] decode failed:', err);
        this.status = `播放失败：${err.message}`;
      }
    },
    onWheel(e) {
      if (!this.canvas) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const span = this.view.maxTime - this.view.minTime;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const center = this.view.minTime + span * x;
      const next = span * factor;
      this.view.minTime = Math.max(0, center - next * x);
      this.view.maxTime = this.analysis ? Math.min(this.analysis.duration, center + next * (1 - x)) : center + next * (1 - x);
      this.draw();
    },
    onPointerDown(e) {
      if (!this.canvas) return;
      this.drag = { x: e.clientX, minTime: this.view.minTime, maxTime: this.view.maxTime };
      this.canvas.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      if (!this.drag || !this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const span = this.drag.maxTime - this.drag.minTime;
      const dt = (e.clientX - this.drag.x) / rect.width * span;
      this.view.minTime = Math.max(0, this.drag.minTime - dt);
      this.view.maxTime = this.analysis ? Math.min(this.analysis.duration, this.drag.maxTime - dt) : this.drag.maxTime - dt;
      this.draw();
    },
    onPointerUp() { this.drag = null; },
    draw() {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, w, h);
      if (!this.analysis) return;
      const { minTime, maxTime, maxFreq } = this.view;
      const toX = t => (t - minTime) / (maxTime - minTime) * w;
      const toY = f => h - Math.min(1, Math.max(0, f / maxFreq)) * h;
      ctx.strokeStyle = '#303847';
      ctx.lineWidth = 1;
      if (this.noteLines) {
        for (let midi = 0; midi < 120; midi++) {
          const f = 440 * 2 ** ((midi - 69) / 12);
          if (f <= 0 || f > maxFreq) continue;
          const y = toY(f);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
      }
      const points = this.sampled ? this.analysis.sampledTrack : this.analysis.track.map(([t, f]) => [t, [f, 0, 0]]);
      for (let channel = 0; channel < 3; channel++) {
        if (!this.sampled && channel) continue;
        ctx.beginPath();
        let started = false;
        for (const [t, freqs] of points) {
          if (t < minTime || t > maxTime) continue;
          const f = freqs[channel] || 0;
          if (!f) continue;
          const x = toX(t), y = toY(f);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = channel === 0 ? '#ef4444' : channel === 1 ? '#60a5fa' : '#34d399';
        ctx.lineWidth = channel === 0 ? 2 : 1;
        ctx.stroke();
      }
      if (this.beatLines) {
        const beat = 60 / this.bpm;
        ctx.strokeStyle = '#3a4352';
        for (let t = Math.ceil(minTime / beat) * beat; t <= maxTime; t += beat) {
          const x = toX(t); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
      }
      if (this.beatNotes) {
        ctx.fillStyle = '#f59e0b';
        for (const [t, tones] of this.analysis.tonesTrack) {
          if (t < minTime || t > maxTime || !tones[0]) continue;
          const x = toX(t), y = toY(tones[0][1]);
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  },
  watch: {
    noteLines: 'draw', sampled: 'draw', beatLines: 'draw', beatNotes: 'draw', bpm: 'draw', meter: 'draw', track: 'draw'
  }
});

export default vm;
