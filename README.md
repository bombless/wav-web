# wav-web (migration of wav-gpt-5-high)

This repository contains a Node.js HTTP service and a lightweight browser UI that reproduces the core functionality of wav-gpt-5-high:
- Upload WAV files
- Analyze dominant frequency track, sampled top frequencies, and candidate tones per frame
- Provide beat-based note candidates and simple annotation storage
- Synthesize a sine-based rendition of a frequency track and return a WAV

Quickstart

1. Install dependencies:

   npm install

2. Start server:

   npm start

3. Open the demo in your browser:

   http://localhost:3000/

Notes
- Annotations are stored as JSON files under storage/ (file per upload id). This is simple and safe for local use. You can replace it with SQLite or other DB if you need.
- The audio analysis code is a JS port of the processing in the original Rust project (hann window, FFT, peak picking). For maximum fidelity you can compile the Rust logic to WASM and call it from Node.

Files of interest
- server/index.js - main server with analysis and synth endpoints
- client/index.html + client/app.js - simple single-page UI for upload, plotting and annotation

Docker
A Dockerfile is included for building a runnable image.
