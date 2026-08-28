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
      this.status = '分析中…';
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
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
        if (this.audio) this.audio.pause();
        this.playing = false;
        return;
      }
      if (!this.analysis) return;
      this.playing = true;
      setTimeout(() => { this.playing = false; }, this.analysis.duration * 1000);
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
