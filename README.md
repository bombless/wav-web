# wav-web

将 `bombless/wav-gpt-5-high` 的 WAV 主频分析、十二平均律标注、节拍音符编辑和合成试听能力重写为 Node.js HTTP 服务 + 浏览器 UI。

## 运行

需要 Node.js 20+：

```bash
npm start
```

然后打开 `http://localhost:3000`，选择 WAV 文件。

## 功能

- 服务器端读取 16-bit PCM / 32-bit float WAV，并做 mono mixdown。
- FFT 主频分析：默认 window 2048、hop 512。
- 主频轨迹 + 三条采样频率轨迹。
- 十二平均律参考线和音名。
- BPM / 3/4、4/4、5/4、6/4 节拍。
- 每拍根据频谱候选自动给出音符，可点击循环选择候选音。
- Shift + 点击可消除节拍音符；完整节拍音符可用于试听。
- Ctrl + 点击设置播放位置。
- 最大值、三条采样轨迹、原音、节拍音符均可试听。
- Canvas 支持拖动平移和滚轮缩放。

