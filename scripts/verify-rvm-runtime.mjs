import fs from 'node:fs';
import * as ort from 'onnxruntime-web';

const path = process.argv[2];
if (!path) throw new Error('Pass the installed RVM ONNX path.');
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(fs.readFileSync(path), { executionProviders: ['wasm'] });
let state = Object.fromEntries([1, 2, 3, 4].map(i => [`r${i}i`, new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1])]));
const ratio = new ort.Tensor('float32', Float32Array.of(0.25), [1]);
const source = new ort.Tensor('float32', new Float32Array(3 * 288 * 512).fill(0.5), [1, 3, 288, 512]);
try {
  for (let frame = 0; frame < 3; frame++) {
    const result = await session.run({ src: source, ...state, downsample_ratio: ratio });
    if (result.pha.dims.join(',') !== '1,1,288,512' || !result.pha.data.every(Number.isFinite)) throw new Error('Invalid alpha');
    for (const tensor of Object.values(state)) tensor.dispose();
    state = Object.fromEntries([1, 2, 3, 4].map(i => [`r${i}i`, result[`r${i}o`]]));
    result.pha.dispose(); result.fgr.dispose();
  }
  console.log('RVM WASM inference: three recurrent frames passed at 512 × 288. Synthetic input; not a matte-quality benchmark.');
} finally {
  for (const tensor of Object.values(state)) tensor.dispose();
  ratio.dispose(); source.dispose(); await session.release();
}
