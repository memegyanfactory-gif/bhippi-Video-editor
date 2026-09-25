Filled by `node scripts/fetch-bundle.mjs` (run by `npm run bundle`) and shipped inside the installer:
FFmpeg, yt-dlp, the whisper.cpp and Piper engines and the Roto models. Everything here except this
file is downloaded, not committed. Bhippi reads it from its resource folder at startup
(src-tauri/src/bundled.rs).
