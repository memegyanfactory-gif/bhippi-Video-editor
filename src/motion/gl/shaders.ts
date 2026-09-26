// GLSL (WebGL2) sources for the motion engine. Every pass reads and writes premultiplied RGBA;
// colour operations unpremultiply first. `uResolution` is the target size in pixels.

export const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
vec3 unpremul(vec4 c) { return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec3 rgb2hsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
`;

/** Draws a layer texture through the placement matrix with anti-aliased quad edges. */
export const PLACE_FS = `${HEAD}
uniform sampler2D uTex;
uniform float uOpacity;
void main() {
  vec2 fw = max(fwidth(vUv), vec2(1e-6));
  vec2 d = min(vUv, 1.0 - vUv) / fw;
  float aa = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
  outColor = texture(uTex, vUv) * (uOpacity * aa);
}`;

export const COPY_FS = `${HEAD}
uniform sampler2D uTex;
uniform float uFlip;
uniform float uOpacity;
void main() {
  vec2 uv = uFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  outColor = texture(uTex, uv) * uOpacity;
}`;

/** Blits `uTex` scaled into a sub-rectangle (uRect in 0..1 of the target), transparent outside. */
export const RECT_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec4 uRect;
void main() {
  vec2 uv = (vUv - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0); return; }
  outColor = texture(uTex, uv);
}`;

export const SOLID_FS = `${HEAD}
uniform vec4 uColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

/**
 * Footage fitted into the layer box: `uFit` maps target uv → source uv. With a matte, the subject
 * alpha multiplies the picture (a cut-out) when uCutout = 1.
 */
export const FOOTAGE_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uMatte;
uniform vec4 uFit;       // offset.xy, scale.zw  (source uv = offset + uv * scale)
uniform float uHasMatte;
uniform float uCutout;
uniform float uMatteMode; // 0 = write picture, 1 = write matte as white alpha
void main() {
  vec2 uv = uFit.xy + vUv * uFit.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0); return; }
  vec4 c = texture(uTex, uv);
  float m = uHasMatte > 0.5 ? texture(uMatte, uv).r : 1.0;
  if (uMatteMode > 0.5) { outColor = vec4(m); return; }
  outColor = uCutout > 0.5 ? c * m : c;
}`;

export const MUL_MASK_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uMask;
void main() { outColor = texture(uTex, vUv) * texture(uMask, vUv).a; }`;

export const MATTE_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uMatte;
uniform int uMode; // 0 alpha, 1 alpha inverted, 2 luma, 3 luma inverted
void main() {
  vec4 m = texture(uMatte, vUv);
  float f = uMode == 0 ? m.a : uMode == 1 ? 1.0 - m.a : uMode == 2 ? luma(m.rgb) : 1.0 - luma(unpremul(m)) * m.a;
  outColor = texture(uTex, vUv) * clamp(f, 0.0, 1.0);
}`;

/** W3C compositing: separable and non-separable blend modes over premultiplied colour. */
export const BLEND_FS = `${HEAD}
uniform sampler2D uDst;
uniform sampler2D uSrc;
uniform int uMode;
float lumC(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) { float l = lumC(c); float n = min(min(c.r, c.g), c.b); float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5); return c; }
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lumC(c))); }
float satC(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) { float mx = max(max(c.r, c.g), c.b); float mn = min(min(c.r, c.g), c.b); float r = mx - mn;
  return r > 1e-5 ? (c - mn) * s / r : vec3(0.0); }
float softLight(float b, float s) { float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b); }
float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
float dodge(float b, float s) { return b <= 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s); }
vec3 blendFn(vec3 b, vec3 s) {
  if (uMode == 1) return min(b + s, vec3(1.0));
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return b * s;
  if (uMode == 4) return vec3(hardLight(s.r, b.r), hardLight(s.g, b.g), hardLight(s.b, b.b));
  if (uMode == 5) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
  if (uMode == 6) return vec3(hardLight(b.r, s.r), hardLight(b.g, s.g), hardLight(b.b, s.b));
  if (uMode == 7) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (uMode == 8) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  if (uMode == 9) return max(b, s);
  if (uMode == 10) return min(b, s);
  if (uMode == 11) return abs(b - s);
  if (uMode == 12) return b + s - 2.0 * b * s;
  if (uMode == 13) return setLum(setSat(s, satC(b)), lumC(b));
  if (uMode == 14) return setLum(setSat(b, satC(s)), lumC(b));
  if (uMode == 15) return setLum(s, lumC(b));
  if (uMode == 16) return setLum(b, lumC(s));
  return s;
}
void main() {
  vec4 d = texture(uDst, vUv);
  vec4 s = texture(uSrc, vUv);
  if (uMode == 1) { outColor = vec4(min(d.rgb + s.rgb, vec3(1.0)), s.a + d.a * (1.0 - s.a)); return; }
  vec3 cb = unpremul(d);
  vec3 cs = unpremul(s);
  vec3 mixed = (1.0 - d.a) * cs + d.a * clamp(blendFn(cb, cs), 0.0, 1.0);
  float a = s.a + d.a * (1.0 - s.a);
  outColor = vec4(s.a * mixed + (1.0 - s.a) * d.rgb, a);
}`;

/** Mixes two textures by the coverage alpha of a third (adjustment layers, backdrops). */
export const COVER_MIX_FS = `${HEAD}
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uCover;
uniform float uAmount;
void main() {
  float c = texture(uCover, vUv).a * uAmount;
  outColor = mix(texture(uA, vUv), texture(uB, vUv), clamp(c, 0.0, 1.0));
}`;

// ───────────────────────── blur ─────────────────────────

/** One axis of a gaussian; `uDir` is the pixel step, taps scale with sigma (≤ 48 each side). */
export const BLUR_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  if (uSigma < 0.3) { outColor = texture(uTex, vUv); return; }
  float radius = ceil(uSigma * 3.0);
  float stepPx = max(1.0, radius / 48.0);
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (float i = -48.0; i <= 48.0; i += 1.0) {
    float x = i * stepPx;
    if (abs(x) > radius) continue;
    float w = exp(-(x * x) / (2.0 * uSigma * uSigma));
    sum += texture(uTex, vUv + uDir * x / uResolution) * w;
    wsum += w;
  }
  outColor = sum / wsum;
}`;

export const DIRECTIONAL_BLUR_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uVector; // pixels, total length of the smear
void main() {
  vec4 sum = vec4(0.0);
  const float N = 32.0;
  for (float i = 0.0; i < N; i += 1.0) {
    float t = i / (N - 1.0) - 0.5;
    sum += texture(uTex, vUv + uVector * t / uResolution);
  }
  outColor = sum / N;
}`;

export const ZOOM_BLUR_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uCenter; // 0..1
uniform float uAmount; // fraction of distance to centre smeared
void main() {
  vec4 sum = vec4(0.0);
  const float N = 40.0;
  vec2 dir = vUv - uCenter;
  for (float i = 0.0; i < N; i += 1.0) {
    float s = 1.0 - uAmount * (i / (N - 1.0));
    sum += texture(uTex, uCenter + dir * s);
  }
  outColor = sum / N;
}`;

// ───────────────────────── glow family ─────────────────────────

export const THRESHOLD_FS = `${HEAD}
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;
uniform vec3 uTint;
uniform float uUseTint;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 col = unpremul(c);
  float l = max(max(col.r, col.g), col.b);
  float k = smoothstep(uThreshold - uKnee, uThreshold + uKnee, l);
  vec3 g = uUseTint > 0.5 ? mix(col, uTint, 0.75) * max(l, 0.35) : col;
  outColor = vec4(g * k * c.a, k * c.a);
}`;

/** Adds up to three blurred glow layers onto the source (deep-glow style falloff). */
export const GLOW_COMBINE_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uG1;
uniform sampler2D uG2;
uniform sampler2D uG3;
uniform vec3 uWeights;
uniform float uIntensity;
uniform float uScreen;
void main() {
  vec4 s = texture(uTex, vUv);
  vec4 g = (texture(uG1, vUv) * uWeights.x + texture(uG2, vUv) * uWeights.y + texture(uG3, vUv) * uWeights.z) * uIntensity;
  vec3 rgb = uScreen > 0.5 ? s.rgb + g.rgb * (1.0 - s.rgb) : s.rgb + g.rgb;
  outColor = vec4(min(rgb, vec3(1.0)), clamp(max(s.a, s.a + g.a * (1.0 - s.a)), 0.0, 1.0));
}`;

export const SHADOW_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uBlurred;
uniform vec2 uOffset; // pixels
uniform vec4 uColor;  // rgb, opacity
uniform float uOnly;
void main() {
  vec4 s = texture(uTex, vUv);
  float a = texture(uBlurred, vUv - uOffset / uResolution).a * uColor.a;
  vec4 shadow = vec4(uColor.rgb * a, a);
  outColor = uOnly > 0.5 ? shadow : s + shadow * (1.0 - s.a);
}`;

export const STROKE_FS = `${HEAD}
uniform sampler2D uTex;
uniform float uWidth;
uniform vec4 uColor;
uniform float uPosition; // 0 outside, 1 centre, 2 inside
void main() {
  vec4 s = texture(uTex, vUv);
  float grown = s.a;
  float shrunk = s.a;
  for (float r = 1.0; r <= 3.0; r += 1.0) {
    float rad = uWidth * r / 3.0;
    for (float k = 0.0; k < 16.0; k += 1.0) {
      float ang = k * 0.3926991;
      vec2 o = vec2(cos(ang), sin(ang)) * rad / uResolution;
      float a = texture(uTex, vUv + o).a;
      grown = max(grown, a);
      shrunk = min(shrunk, a);
    }
  }
  float ring = uPosition < 0.5 ? max(grown - s.a, 0.0) : uPosition < 1.5 ? max(grown - shrunk, 0.0) : max(s.a - shrunk, 0.0);
  vec4 st = vec4(uColor.rgb, 1.0) * ring * uColor.a;
  outColor = uPosition < 0.5 ? s + st * (1.0 - s.a) : st + s * (1.0 - st.a);
}`;

// ───────────────────────── colour ─────────────────────────

export const COLOR_FS = `${HEAD}
uniform sampler2D uTex;
uniform int uOp;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uC;
void main() {
  vec4 src = texture(uTex, vUv);
  if (src.a <= 1e-5) { outColor = src; return; }
  vec3 c = unpremul(src);
  float l = luma(c);
  if (uOp == 0) { // tint: map black→uA, white→uB by amount uC.x
    c = mix(c, mix(uA.rgb, uB.rgb, l), uC.x);
  } else if (uOp == 1) { // duotone: shadows uA, highlights uB, amount uC.x, contrast uC.y
    float k = clamp((l - 0.5) * uC.y + 0.5, 0.0, 1.0);
    c = mix(c, mix(uA.rgb, uB.rgb, k), uC.x);
  } else if (uOp == 2) { // black & white with filter weights uA.rgb, amount uC.x
    float g = dot(c, normalize(max(uA.rgb, vec3(0.001))) / dot(normalize(max(uA.rgb, vec3(0.001))), vec3(1.0)));
    c = mix(c, vec3(g), uC.x);
  } else if (uOp == 3) { // brightness (uA.x −1..1), contrast (uA.y −1..1)
    c = (c - 0.5) * (1.0 + uA.y) + 0.5 + uA.x;
  } else if (uOp == 4) { // hue (uA.x turns), saturation (uA.y ×), lightness (uA.z −1..1)
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    h.x = fract(h.x + uA.x);
    h.y = clamp(h.y * uA.y, 0.0, 1.0);
    c = hsv2rgb(h);
    c = uA.z >= 0.0 ? mix(c, vec3(1.0), uA.z) : c * (1.0 + uA.z);
  } else if (uOp == 5) { // levels: in black, in white, gamma, out black / out white in uB.xy
    c = clamp((c - uA.x) / max(uA.y - uA.x, 1e-4), 0.0, 1.0);
    c = pow(c, vec3(1.0 / max(uA.z, 0.01)));
    c = mix(vec3(uB.x), vec3(uB.y), c);
  } else if (uOp == 6) { // exposure (stops), offset, gamma
    c = pow(max(c * exp2(uA.x) + uA.y, 0.0), vec3(1.0 / max(uA.z, 0.01)));
  } else if (uOp == 7) { // invert amount uC.x
    c = mix(c, 1.0 - c, uC.x);
  } else if (uOp == 8) { // fill with uA.rgb by amount uC.x
    c = mix(c, uA.rgb, uC.x);
  } else if (uOp == 9) { // vignette: amount uA.x, size uA.y, softness uA.z, roundness uA.w
    vec2 p = (vUv - 0.5) * vec2(mix(1.0, uResolution.x / uResolution.y, uA.w), 1.0);
    float v = smoothstep(uA.y, uA.y - max(uA.z, 0.01), length(p) * 1.414);
    c *= mix(1.0 - uA.x, 1.0, v);
  } else if (uOp == 10) { // grain: amount uA.x, size uA.y, seed uA.z
    vec2 cell = floor(vUv * uResolution / max(uA.y, 0.5));
    float n = hash12(cell + uA.z * 91.7) + hash12(cell * 1.37 + uA.z * 13.1) - 1.0;
    c += n * uA.x * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0));
  } else if (uOp == 11) { // radial gradient overlay: centre uA.xy, radius uA.z, colour uB, amount uC.x, screen uC.y
    float d = length((vUv - uA.xy) * vec2(uResolution.x / uResolution.y, 1.0));
    float k = smoothstep(uA.z, 0.0, d) * uC.x;
    c = uC.y > 0.5 ? c + uB.rgb * k * (1.0 - c) : mix(c, uB.rgb, k);
  }
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(c * src.a, src.a);
}`;

// ───────────────────────── distortion & stylise ─────────────────────────

export const DISTORT_FS = `${HEAD}
uniform sampler2D uTex;
uniform int uOp;
uniform vec4 uA;
uniform vec4 uB;
uniform float uTime;
void main() {
  vec2 uv = vUv;
  vec2 px = uv * uResolution;
  if (uOp == 0) { // chromatic aberration: amount uA.x (px at edge), centre uA.yz
    vec2 d = (uv - uA.yz);
    vec2 o = d * uA.x / max(uResolution.x, 1.0) * 2.0;
    vec4 r = texture(uTex, uv + o);
    vec4 g = texture(uTex, uv);
    vec4 b = texture(uTex, uv - o);
    outColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
    return;
  }
  if (uOp == 1) { // rgb split: offset uA.xy px
    vec2 o = uA.xy / uResolution;
    vec4 r = texture(uTex, uv + o);
    vec4 g = texture(uTex, uv);
    vec4 b = texture(uTex, uv - o);
    outColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
    return;
  }
  if (uOp == 2) { // mosaic: cell px uA.x (and uA.y)
    vec2 cell = max(uA.xy, vec2(1.0));
    vec2 c = (floor(px / cell) + 0.5) * cell;
    outColor = texture(uTex, c / uResolution);
    return;
  }
  if (uOp == 3) { // turbulent displace: amount px uA.x, size uA.y, evolution uTime*uA.z, octave complexity
    vec2 q = px / max(uA.y, 1.0);
    float ev = uTime * uA.z;
    vec2 off = vec2(fbm(q + ev), fbm(q + 31.7 - ev)) - 0.5;
    outColor = texture(uTex, uv + off * 2.0 * uA.x / uResolution);
    return;
  }
  if (uOp == 4) { // wave warp: amplitude px uA.x, wavelength px uA.y, speed uA.z, direction deg uA.w
    float ang = radians(uA.w);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 nrm = vec2(-dir.y, dir.x);
    float phase = dot(px, dir) / max(uA.y, 1.0) * 6.2831853 - uTime * uA.z * 6.2831853;
    outColor = texture(uTex, uv + nrm * sin(phase) * uA.x / uResolution);
    return;
  }
  if (uOp == 5) { // lens distortion: k uA.x (+barrel, −pincushion), zoom uA.y
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    vec2 d = c * (1.0 + uA.x * r2) / max(uA.y, 0.01) + 0.5;
    outColor = (d.x < 0.0 || d.y < 0.0 || d.x > 1.0 || d.y > 1.0) ? vec4(0.0) : texture(uTex, d);
    return;
  }
  if (uOp == 6) { // pixel sort streaks: threshold lo uA.x hi uA.y, length px uA.z, direction deg uA.w, amount uB.x
    vec4 base = texture(uTex, uv);
    float ang = radians(uA.w);
    vec2 dir = vec2(cos(ang), sin(ang)) / uResolution;
    vec4 best = base;
    float bestL = luma(unpremul(base));
    float inBand = step(uA.x, bestL) * step(bestL, uA.y);
    for (float i = 1.0; i <= 48.0; i += 1.0) {
      float dist = i / 48.0 * uA.z;
      vec4 c = texture(uTex, uv - dir * dist);
      float l = luma(unpremul(c));
      if (l < uA.x || l > uA.y) break;
      if (l > bestL) { best = c; bestL = l; }
    }
    outColor = mix(base, best, inBand * uB.x);
    return;
  }
  if (uOp == 7) { // displacement from noise field: amount px uA.x, scale uA.y, speed uA.z
    float n = fbm(px / max(uA.y, 1.0) + uTime * uA.z);
    outColor = texture(uTex, uv + vec2(n - 0.5, fbm(px / max(uA.y, 1.0) + 9.1 - uTime * uA.z) - 0.5) * uA.x * 2.0 / uResolution);
    return;
  }
  outColor = texture(uTex, uv);
}`;

/** Liquid glass: bevel from blurred alpha, refraction of the content and a specular highlight. */
export const LIQUID_GLASS_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uHeight;   // blurred alpha
uniform sampler2D uBackdrop; // what refracts (the layer itself or the scene behind)
uniform float uRefraction;   // px
uniform float uSpecular;
uniform float uTintAmount;
uniform vec3 uTint;
uniform vec2 uLight;
void main() {
  vec2 e = 1.5 / uResolution;
  float hx = texture(uHeight, vUv + vec2(e.x, 0.0)).a - texture(uHeight, vUv - vec2(e.x, 0.0)).a;
  float hy = texture(uHeight, vUv + vec2(0.0, e.y)).a - texture(uHeight, vUv - vec2(0.0, e.y)).a;
  vec3 n = normalize(vec3(-hx, -hy, 0.08));
  vec4 self = texture(uTex, vUv);
  vec4 bent = texture(uBackdrop, vUv + n.xy * uRefraction / uResolution);
  vec3 col = unpremul(bent);
  col = mix(col, uTint, uTintAmount);
  float spec = pow(max(dot(n, normalize(vec3(uLight, 0.9))), 0.0), 24.0) * uSpecular;
  float rim = (1.0 - n.z) * 0.6;
  col += spec + rim * 0.25;
  float a = self.a;
  outColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}`;

/** Fuses a colour glow on the rim of an alpha (matte edge glow / light wrap). */
export const EDGE_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uBlurred;
uniform vec4 uColor;
uniform float uIntensity;
void main() {
  vec4 s = texture(uTex, vUv);
  float b = texture(uBlurred, vUv).a;
  float rim = clamp((b - s.a * 0.85) * 2.0 + abs(b - s.a), 0.0, 1.0);
  float glow = rim * uIntensity * uColor.a;
  outColor = vec4(min(s.rgb + uColor.rgb * glow, vec3(1.0)), max(s.a, glow));
}`;

// ───────────────────────── matte FX ─────────────────────────

/**
 * The subject reveal of the reference opening: the subject's matte quantised to a grid of
 * cells that switch on outward from a seed (the face) and down the body, each born hot in the
 * fill colour and cooling to the real footage, then resolving to the fine matte.
 */
export const SUBJECT_REVEAL_FS = `${HEAD}
uniform sampler2D uTex;    // the uncut footage
uniform sampler2D uMatte;  // subject alpha (r)
uniform float uTime;       // seconds since the reveal began
uniform vec2 uSeed;        // px in this target
uniform float uCell;       // px
uniform float uKr;         // seconds per diagonal of radial distance
uniform float uKy;         // extra seconds per diagonal below the seed (top→bottom cascade)
uniform float uKn;         // noise seconds
uniform float uThreshold;
uniform float uSpill;      // 0..1 stray cells past the contour
uniform vec3 uFill;
uniform float uFillStrength;
uniform float uDecay;      // seconds for the hot tint to cool
uniform float uResolveStart;
uniform float uResolveEnd;
uniform float uHotOnly;    // 1 = output the hot part only (fed to the glow)
uniform float uReverse;    // 1 = dissolve out instead of in
void main() {
  vec2 px = vUv * uResolution;
  vec2 cell = floor(px / uCell);
  vec2 cc = (cell + 0.5) * uCell;
  float diag = length(uResolution);
  float cellA = texture(uMatte, cc / uResolution).r;
  // coverage of the neighbourhood so edge cells light even when the centre misses the body
  float nb = max(max(texture(uMatte, (cc + vec2(uCell * 0.45, 0.0)) / uResolution).r, texture(uMatte, (cc - vec2(uCell * 0.45, 0.0)) / uResolution).r),
                 max(texture(uMatte, (cc + vec2(0.0, uCell * 0.45)) / uResolution).r, texture(uMatte, (cc - vec2(0.0, uCell * 0.45)) / uResolution).r));
  float fineA = texture(uMatte, vUv).r;
  vec2 d = (cc - uSeed) / diag;
  float delay = uKr * length(d) + uKy * max(d.y, 0.0) + uKn * hash12(cell);
  float age = uReverse > 0.5 ? (delay + 0.001) - uTime : uTime - delay;
  float born = step(0.0, age);
  float inside = step(uThreshold, cellA);
  float stray = step(1.0 - uSpill * 0.35, hash12(cell + 7.31)) * step(0.02, nb) * (1.0 - inside);
  float blockA = born * max(inside * max(cellA, 0.85), stray * 0.9);
  float resolve = smoothstep(uResolveStart, uResolveEnd, age);
  float alpha = mix(blockA, fineA, resolve);
  float hot = born * exp(-max(age, 0.0) / max(uDecay, 1e-3)) * (inside + stray);
  vec3 foot = unpremul(texture(uTex, vUv));
  // Tinted footage: multiply by the fill so the face stays readable, and a solid hot core.
  vec3 tinted = mix(foot, foot * uFill * 1.6 + uFill * 0.25, clamp(uFillStrength, 0.0, 1.0));
  // Only the newest cells burn solid; older ones show the footage through a cooling tint.
  float solid = clamp(hot * 2.2 - 1.3, 0.0, 1.0);
  vec3 col = mix(foot, tinted, clamp(hot * 1.15, 0.0, 1.0));
  col = mix(col, uFill, solid * 0.9);
  if (uHotOnly > 0.5) { float h = hot * alpha; outColor = vec4(uFill * h, h); return; }
  outColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

/** Silhouette filled with colour that wipes on, then dissolves into the footage. */
export const MATTE_FILL_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uMatte;
uniform float uProgress;   // 0..1 wipe
uniform float uMix;        // 0 = solid fill, 1 = footage
uniform float uSoft;
uniform int uFrom;         // 0 bottom, 1 top, 2 left, 3 right, 4 centre
uniform vec3 uFill;
uniform vec3 uFill2;
uniform float uUseMatte;
void main() {
  float m = uUseMatte > 0.5 ? texture(uMatte, vUv).r : texture(uTex, vUv).a;
  float pos = uFrom == 0 ? 1.0 - vUv.y : uFrom == 1 ? vUv.y : uFrom == 2 ? vUv.x : uFrom == 3 ? 1.0 - vUv.x : 1.0 - length(vUv - 0.5) * 1.414;
  float w = smoothstep(pos - uSoft, pos + uSoft, uProgress * (1.0 + 2.0 * uSoft) - uSoft);
  vec3 fill = mix(uFill, uFill2, uFrom <= 1 ? vUv.y : vUv.x);
  vec3 foot = unpremul(texture(uTex, vUv));
  vec3 col = mix(fill, foot, clamp(uMix, 0.0, 1.0));
  float a = m * w;
  outColor = vec4(col * a, a);
}`;

// ───────────────────────── procedural backgrounds ─────────────────────────

export const PROCEDURAL_FS = `${HEAD}
uniform int uKind;
uniform float uTime;
uniform vec4 uC1;
uniform vec4 uC2;
uniform vec4 uC3;
uniform vec4 uP;   // kind-specific
uniform vec4 uQ;
uniform vec2 uSize; // layer size in layer pixels: patterns scale with the layer, not the texture
float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
vec4 hexCoords(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv;
  return vec4(gv, id);
}
void main() {
  vec2 uv = vUv;
  vec2 size = uSize.x > 0.0 ? uSize : uResolution;
  vec2 px = uv * size;
  float aspect = size.x / size.y;
  vec3 col;
  float alpha = 1.0;
  if (uKind == 0) { // crimson stage: top colour uC1, bottom glow uC2, glow centre y uP.x, spread uP.y, intensity uP.z
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - uP.x);
    float glow = exp(-dot(p * vec2(0.55, 1.35), p * vec2(0.55, 1.35)) / max(uP.y, 0.01)) * uP.z;
    col = mix(uC1.rgb, uC2.rgb, clamp(glow, 0.0, 1.0));
    col += uC3.rgb * pow(clamp(glow, 0.0, 1.0), 3.0) * 0.35;
    col *= mix(0.72, 1.0, smoothstep(1.25, 0.2, length((uv - vec2(0.5, 0.55)) * vec2(aspect * 0.8, 1.0))));
  } else if (uKind == 1) { // radial glow: centre uP.xy, radius uP.z, inner uC1, outer uC2
    float d = length((uv - uP.xy) * vec2(aspect, 1.0));
    col = mix(uC1.rgb, uC2.rgb, smoothstep(0.0, max(uP.z, 0.01), d));
  } else if (uKind == 2) { // linear gradient: angle uP.x deg, uC1 → uC2 → uC3 (uP.y = use third)
    float a = radians(uP.x);
    float k = dot(uv - 0.5, vec2(cos(a), sin(a))) + 0.5;
    col = uP.y > 0.5 ? (k < 0.5 ? mix(uC1.rgb, uC2.rgb, k * 2.0) : mix(uC2.rgb, uC3.rgb, k * 2.0 - 2.0 * 0.5)) : mix(uC1.rgb, uC2.rgb, clamp(k, 0.0, 1.0));
  } else if (uKind == 3) { // hex field: size px uP.x, gap uP.y, bevel uP.z, highlight cell uQ.xy (id), highlight amount uQ.z
    vec2 q = px / max(uP.x, 4.0);
    vec4 h = hexCoords(q);
    float d = hexDist(h.xy);
    float edge = smoothstep(0.5 - uP.y, 0.5 - uP.y - 0.02, d);
    float bevel = smoothstep(0.5 - uP.y - uP.z, 0.5 - uP.y, d);
    float shade = 0.55 + 0.45 * (1.0 - length(h.xy + vec2(0.0, 0.25)) * 1.2);
    float vign = smoothstep(1.3, 0.1, length((uv - vec2(0.5, 0.6)) * vec2(aspect * 0.7, 1.0)));
    vec3 face = mix(uC1.rgb, uC2.rgb, clamp(shade * vign, 0.0, 1.0));
    float hl = uQ.z * step(length(h.zw - uQ.xy), 0.3);
    face = mix(face, uC3.rgb, hl);
    vec3 rim = mix(uC2.rgb * 0.6, vec3(1.0, 0.85, 0.85), 0.35) * (0.5 + 0.5 * bevel);
    col = mix(uC1.rgb * 0.35, mix(face, rim, bevel * 0.6), edge);
    col += 0.04 * sin(uTime * 0.7 + h.z * 0.9 + h.w * 1.3) * edge;
  } else if (uKind == 4) { // grid: spacing px uP.x, line px uP.y, colour uC2 on uC1, fade uP.z
    vec2 g = abs(fract(px / uP.x - 0.5) - 0.5) * uP.x;
    float line = 1.0 - smoothstep(uP.y * 0.5, uP.y * 0.5 + 1.0, min(g.x, g.y));
    float fade = mix(1.0, smoothstep(1.0, 0.2, length(uv - 0.5) * 1.6), uP.z);
    col = mix(uC1.rgb, uC2.rgb, line * fade * uC2.a);
  } else if (uKind == 5) { // light rails: count uP.x, floor y uP.y, rail colour uC2, bg uC1, progress uP.z
    col = uC1.rgb;
    float n = max(uP.x, 1.0);
    for (float i = 0.0; i < 12.0; i += 1.0) {
      if (i >= n) break;
      float x = (i + 0.5) / n;
      float grow = clamp(uP.z * n - i * 0.6, 0.0, 1.0);
      float top = mix(uP.y, 0.05, grow);
      float inRail = step(top, uv.y) * step(uv.y, uP.y);
      float dx = abs(uv.x - x) * size.x;
      col += uC2.rgb * (exp(-dx * 0.9) * 0.9 + exp(-dx * 0.08) * 0.12) * inRail * (0.4 + 0.6 * smoothstep(top, uP.y, uv.y));
    }
    float fy = abs(uv.y - uP.y) * size.y;
    col += uC2.rgb * (exp(-fy * 0.8) * 0.8 + exp(-fy * 0.05) * 0.1) * smoothstep(0.0, 0.05, uP.z);
  } else if (uKind == 6) { // noise: scale uP.x, speed uP.y, colours uC1..uC2
    float n = fbm(px / max(uP.x, 1.0) + uTime * uP.y);
    col = mix(uC1.rgb, uC2.rgb, n);
  } else if (uKind == 7) { // light leak blobs: colours uC1, uC2, uC3, speed uP.x, intensity uP.y
    vec2 p = vec2(uv.x * aspect, uv.y);
    float t = uTime * uP.x;
    float a = exp(-length(p - vec2(0.2 * aspect + 0.3 * sin(t * 0.7), 0.3 + 0.2 * cos(t * 0.5))) * 2.2);
    float b = exp(-length(p - vec2(0.8 * aspect + 0.25 * cos(t * 0.6), 0.7 + 0.2 * sin(t * 0.8))) * 2.6);
    float c = exp(-length(p - vec2(0.5 * aspect + 0.4 * sin(t * 0.3), 0.5)) * 3.5);
    col = (uC1.rgb * a + uC2.rgb * b + uC3.rgb * c) * uP.y;
    alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    col = alpha > 0.0 ? col / alpha : col;
  } else if (uKind == 8) { // dots: spacing uP.x, radius uP.y, uC2 on uC1
    vec2 g = fract(px / uP.x) - 0.5;
    float dot1 = smoothstep(uP.y / uP.x, uP.y / uP.x - 0.05, length(g));
    col = mix(uC1.rgb, uC2.rgb, dot1 * uC2.a);
  } else if (uKind == 9) { // aurora: bands of uC2/uC3 over uC1, speed uP.x
    float t = uTime * uP.x;
    float band = sin(uv.x * 3.0 + fbm(uv * 3.0 + t) * 4.0 + t) * 0.5 + 0.5;
    float y = smoothstep(0.9, 0.2, abs(uv.y - 0.45 - 0.15 * sin(uv.x * 2.0 + t)) * 2.5);
    col = uC1.rgb + mix(uC2.rgb, uC3.rgb, band) * y * 0.8;
  } else if (uKind == 10) { // mesh gradient: four drifting blobs uC1 uC2 uC3 uQ.rgb, speed uP.x, softness uP.y
    float t = uTime * uP.x;
    vec2 p = vec2(uv.x * aspect, uv.y);
    vec2 c1 = vec2((0.2 + 0.15 * sin(t * 0.9)) * aspect, 0.25 + 0.15 * cos(t * 0.7));
    vec2 c2 = vec2((0.8 + 0.12 * cos(t * 0.8)) * aspect, 0.3 + 0.18 * sin(t * 0.6));
    vec2 c3 = vec2((0.3 + 0.18 * cos(t * 0.5)) * aspect, 0.8 + 0.1 * sin(t * 0.9));
    vec2 c4 = vec2((0.75 + 0.15 * sin(t * 0.4)) * aspect, 0.78 + 0.12 * cos(t * 0.75));
    float s = max(uP.y, 0.05);
    float w1 = exp(-dot(p - c1, p - c1) / s), w2 = exp(-dot(p - c2, p - c2) / s), w3 = exp(-dot(p - c3, p - c3) / s), w4 = exp(-dot(p - c4, p - c4) / s);
    col = (uC1.rgb * w1 + uC2.rgb * w2 + uC3.rgb * w3 + uQ.rgb * w4) / max(w1 + w2 + w3 + w4, 1e-4);
    col += (fbm(px / 400.0 + t * 0.1) - 0.5) * 0.04;
  } else if (uKind == 11) { // light shafts: bg uC1 (alpha 0 = overlay), rays uC2 from uP.xy (uv), count uP.z, intensity uP.w, spread uQ.x, speed uQ.y
    vec2 d = (uv - uP.xy) * vec2(aspect, 1.0);
    float ang = atan(d.y, d.x);
    float r = length(d);
    float t = uTime * uQ.y;
    float rays = 0.0;
    rays += pow(0.5 + 0.5 * sin(ang * uP.z + t + fbm(vec2(ang * 3.0, t * 0.3)) * 2.0), 6.0);
    rays += 0.6 * pow(0.5 + 0.5 * sin(ang * uP.z * 1.7 - t * 0.7 + 1.3), 8.0);
    float fall = exp(-r * (1.0 / max(uQ.x, 0.05))) * smoothstep(0.0, 0.05, r);
    float k = clamp(rays * fall * uP.w, 0.0, 1.0);
    if (uC1.a < 0.01) { col = uC2.rgb; alpha = k; } else col = mix(uC1.rgb, uC2.rgb, k);
  } else { // dot wave: dots uC2 on uC1, spacing uP.x, amplitude uP.y, speed uP.z, radius uP.w, frequency uQ.x
    col = uC1.rgb;
    float sp = max(uP.x, 6.0);
    float cx = (floor(px.x / sp) + 0.5) * sp;
    float best = 0.0;
    for (float k = -2.0; k <= 2.0; k += 1.0) {
      float j = floor(px.y / sp) + k;
      float wave = sin(cx * uQ.x * 0.01 + uTime * uP.z + j * 0.35) * cos(cx * uQ.x * 0.004 - uTime * uP.z * 0.6);
      vec2 c = vec2(cx, (j + 0.5) * sp + wave * uP.y);
      float rad = uP.w * (0.6 + 0.6 * (wave * 0.5 + 0.5));
      float dot1 = smoothstep(rad, rad - 1.2, length(px - c));
      best = max(best, dot1 * (0.35 + 0.65 * (wave * 0.5 + 0.5)));
    }
    col = mix(uC1.rgb, uC2.rgb, best * uC2.a);
  }
  // dither against banding in 8-bit gradients
  col += (hash12(vUv * uResolution + uTime) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

/**
 * Inner shadow / inner glow (AE layer styles), drawn source-atop inside the layer's alpha:
 * `uBlurred` is the layer's alpha blurred (and read shifted by uOffset for a shadow); where it
 * falls short of full the colour shows. uBlend 0 = normal, 1 = screen (glows).
 */
export const INNER_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uBlurred;
uniform vec2 uOffset;   // pixels
uniform vec4 uColor;    // rgb, opacity
uniform float uChoke;   // 0..1: pushes the edge inward
uniform float uBlend;
void main() {
  vec4 s = texture(uTex, vUv);
  float b = texture(uBlurred, vUv - uOffset / uResolution).a;
  float amt = clamp((1.0 - b) / max(1e-3, 1.0 - uChoke), 0.0, 1.0) * uColor.a;
  vec3 col = unpremul(s);
  vec3 mixed = uBlend > 0.5 ? 1.0 - (1.0 - col) * (1.0 - uColor.rgb * amt) : mix(col, uColor.rgb, amt);
  outColor = vec4(mixed * s.a, s.a);
}`;

/**
 * Bevel & emboss, the "inflated" soft-3D look: the layer's alpha blurred by the bevel size is a
 * height field; its slope, lit from (angle, altitude), brightens the lit side toward uHighlight and
 * darkens the far side toward uShadow. Flat interior stays its own colour.
 */
export const BEVEL_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uHeight;
uniform vec3 uLight;      // unit vector, screen space (+y down), z toward the viewer
uniform float uDepth;
uniform vec4 uHighlight;  // rgb, opacity
uniform vec4 uShadow;     // rgb, opacity
void main() {
  vec4 s = texture(uTex, vUv);
  vec2 e = 1.0 / uResolution;
  float hx = texture(uHeight, vUv + vec2(e.x, 0.0)).a - texture(uHeight, vUv - vec2(e.x, 0.0)).a;
  float hy = texture(uHeight, vUv + vec2(0.0, e.y)).a - texture(uHeight, vUv - vec2(0.0, e.y)).a;
  vec3 n = normalize(vec3(-hx * uDepth, -hy * uDepth, 1.0));
  float shade = dot(n, uLight) - uLight.z;
  vec3 col = unpremul(s);
  col = shade > 0.0 ? mix(col, uHighlight.rgb, clamp(shade * 2.5, 0.0, 1.0) * uHighlight.a)
                    : mix(col, uShadow.rgb, clamp(-shade * 2.5, 0.0, 1.0) * uShadow.a);
  outColor = vec4(col * s.a, s.a);
}`;

/** Gradient overlay (AE layer style): up to 4 stops along `uDir`, blended source-atop. uBlend 0 normal, 1 soft light, 2 multiply, 3 screen. */
export const GRADIENT_OVERLAY_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uOffset;
uniform float uScale;
uniform vec4 uC0; uniform vec4 uC1; uniform vec4 uC2; uniform vec4 uC3;  // rgb + stop position
uniform float uCount;
uniform float uOpacity;
uniform float uBlend;
uniform float uRepeat;  // 0: clamp at the ends; 1: mirror-repeat (a band that sweeps with uOffset)
vec3 ramp(float g) {
  vec3 c = uC0.rgb;
  if (g > uC0.a) c = mix(uC0.rgb, uC1.rgb, clamp((g - uC0.a) / max(1e-4, uC1.a - uC0.a), 0.0, 1.0));
  if (uCount > 2.5 && g > uC1.a) c = mix(uC1.rgb, uC2.rgb, clamp((g - uC1.a) / max(1e-4, uC2.a - uC1.a), 0.0, 1.0));
  if (uCount > 3.5 && g > uC2.a) c = mix(uC2.rgb, uC3.rgb, clamp((g - uC2.a) / max(1e-4, uC3.a - uC2.a), 0.0, 1.0));
  return c;
}
void main() {
  vec4 s = texture(uTex, vUv);
  float raw = dot(vUv - 0.5, uDir) / uScale + 0.5 + uOffset;
  float g = uRepeat > 0.5 ? 1.0 - abs(fract(raw * 0.5) * 2.0 - 1.0) : clamp(raw, 0.0, 1.0);
  vec3 grad = ramp(g);
  vec3 col = unpremul(s);
  vec3 b = uBlend < 0.5 ? grad
    : uBlend < 1.5 ? mix(col - (1.0 - 2.0 * grad) * col * (1.0 - col), col + (2.0 * grad - 1.0) * (sqrt(col) - col), step(0.5, grad))
    : uBlend < 2.5 ? col * grad
    : 1.0 - (1.0 - col) * (1.0 - grad);
  outColor = vec4(mix(col, b, uOpacity) * s.a, s.a);
}`;

// Soft 2.5D forms (src/motion/form.ts): sphere-traced signed-distance shapes inside the layer quad,
// seen by a narrow perspective camera, shaded with the reference films' looks.
export const FORM_FS = `${HEAD}
uniform int uKind;
uniform int uKind2;
uniform float uMorph;
uniform vec3 uDims;
uniform mat3 uRot;
uniform int uLook;
uniform vec4 uBase;
uniform vec4 uRim;
uniform vec4 uH1;
uniform vec4 uH2;
uniform vec4 uH3;
uniform vec4 uH4;
uniform vec2 uLight;
uniform float uRound;
uniform vec2 uSquash;
uniform vec4 uPattern;
uniform vec4 uPatColor;
const float F = 4.0;
float sdBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - (b - r); return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdCyl(vec3 p, float rad, float h, float r) { vec2 q = vec2(length(p.xz) - rad + r, abs(p.y) - h + r); return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }
float sdKind(int k, vec3 p, vec3 d) {
  float m = min(d.x, min(d.y, d.z));
  float r = uRound * m;
  if (k == 0) { return (length(p / d) - 1.0) * m; }
  if (k == 1) { float h = max(d.y - d.x, 0.0); vec3 q = p; q.y -= clamp(q.y, -h, h); return length(q) - d.x; }
  if (k == 2) { return sdCyl(p, d.x, d.y, min(r, d.x)); }
  if (k == 3 || k == 6) { return sdBox(p, d, min(r, m)); }
  if (k == 4) { float R = d.x * 0.68; float rr = d.x * 0.32; vec2 q = vec2(length(p.xy) - R, p.z); return length(q) - rr; }
  if (k == 5) { return sdCyl(p.xzy, d.x, d.z, min(r, d.z)); }
  if (k == 7) { vec3 q = abs(p); return max(q.z - d.z, max(q.x * 0.866025 + p.y * 0.5, -p.y) - d.x * 0.5); }
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(0.0, d.y);
  vec2 k2 = vec2(-d.x, 2.0 * d.y);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? d.x : 0.0), abs(q.y) - d.y);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb))) - r * 0.2;
}
float map(vec3 p) {
  vec3 q = transpose(uRot) * p;
  vec3 sq = vec3(uSquash, 1.0 / sqrt(uSquash.x * uSquash.y));
  q /= sq;
  float d = sdKind(uKind, q, uDims);
  if (uMorph > 0.0) d = mix(d, sdKind(uKind2, q, uDims), uMorph);
  return d * min(sq.x, min(sq.y, sq.z));
}
vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
void main() {
  float s = min(uResolution.x, uResolution.y) * 0.5;
  vec2 np = (vUv - 0.5) * uResolution / s;
  np.y = -np.y;
  vec3 ro = vec3(0.0, 0.0, -F);
  vec3 rd = normalize(vec3(np, F));
  float t = F - 2.5;
  float dmin = 1e9;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    dmin = min(dmin, d);
    if (d < 0.0008) { hit = true; break; }
    t += d * 0.9;
    if (t > F + 3.0) break;
  }
  float px = 1.5 / s;
  if (!hit && dmin > px) { outColor = vec4(0.0); return; }
  vec3 p = ro + rd * t;
  vec3 n = normalAt(p);
  vec3 v = -rd;
  float nz = clamp(dot(n, v), 0.0, 1.0);
  vec3 L = normalize(vec3(uLight.x, -uLight.y, -0.9));
  float diff = dot(n, L);
  vec3 base = uBase.rgb;
  if (uPattern.x > 0.5) {
    vec3 q = transpose(uRot) * p / vec3(uSquash, 1.0);
    vec3 u = q / max(uDims.x, 1e-3) * uPattern.y;
    float m = 0.0;
    if (uPattern.x < 1.5) m = step(0.0, sin(u.x * 3.14159) * sin(u.y * 3.14159) * sin(u.z * 3.14159 + 0.5));
    else if (uPattern.x < 2.5) m = step(0.0, sin(u.y * 3.14159));
    else if (uPattern.x < 3.5) { vec3 f = fract(u * 0.5) - 0.5; m = 1.0 - step(0.18, length(f)); }
    else m = 1.0 - step(0.16 * uPattern.y / 4.0, abs(q.y / max(uDims.y, 1e-3)));
    base = mix(base, uPatColor.rgb, m * uPatColor.a);
  }
  if (uH1.a > 0.0) {
    vec4 w = vec4(max(n.x, 0.0), max(-n.x, 0.0), max(n.y, 0.0), max(-n.y, 0.0));
    vec3 hue = (uH1.rgb * w.x + uH2.rgb * w.y + uH3.rgb * w.z + uH4.rgb * w.w) / max(w.x + w.y + w.z + w.w, 1e-3);
    base = mix(base, hue, 0.45 * clamp(w.x + w.y + w.z + w.w, 0.0, 1.0));
  }
  vec3 col;
  float alpha = 1.0;
  vec3 h = normalize(L + v);
  if (uLook == 0) {
    // soft-rim: L = a + b*sqrt(1 - n_z) + c*(n_xy . light)
    float lit = 0.72 + 0.28 * dot(normalize(n.xy + 1e-5), normalize(L.xy)) * length(n.xy);
    col = base * lit + uRim.rgb * 0.5 * sqrt(max(0.0, 1.0 - nz));
  } else if (uLook == 1) {
    float wrap = diff * 0.5 + 0.5;
    col = base * (0.55 + 0.5 * wrap) + uRim.rgb * pow(1.0 - nz, 2.0) * 0.6 + vec3(pow(max(dot(n, h), 0.0), 90.0)) * 0.9;
    alpha = 0.9 + 0.1 * (1.0 - nz);
  } else if (uLook == 2) {
    col = mix(base * 0.7, base, step(0.05, diff)) + uRim.rgb * step(0.93, 1.0 - nz) * 0.6;
  } else if (uLook == 3) {
    col = base * (0.35 + 0.65 * max(diff, 0.0)) + vec3(pow(max(dot(n, h), 0.0), 64.0)) * 0.85 + uRim.rgb * pow(1.0 - nz, 3.0) * 0.35;
  } else {
    float fr = pow(1.0 - nz, 2.2);
    col = mix(base * 0.35, mix(uRim.rgb, vec3(1.0), 0.4), fr) + vec3(pow(max(dot(n, h), 0.0), 120.0));
    alpha = 0.35 + 0.65 * fr;
  }
  if (!hit) alpha *= 1.0 - smoothstep(0.0, px, dmin);
  outColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

/**
 * Riso print (docs/DRAWN-STYLES.md): coverage per ink → an AM halftone screen at the ink's own
 * angle, pinned to the layer so it never swims, with low-frequency mottling, starved-ink flecks
 * and misregistration, multiplied onto grained paper. Shared by the `drawing` layer (plates) and
 * the `riso` / `halftone` effects (coverage solved from colour).
 */
const RISO_SCREEN = `
uniform float uPitch;
uniform float uDensity;
uniform float uSeed;
uniform vec4 uAngles;
float screenInk(float c, vec2 px, float ang, float k) {
  float mottle = (fbm(px / (110.0 * uDensity) + vec2(k * 7.3, uSeed)) - 0.5) * 0.3;
  c = clamp(c * (1.0 + mottle) * (0.93 + 0.07 * vnoise(px / (2.0 * uDensity) + k * 13.0)), 0.0, 1.0);
  if (c <= 0.004) return 0.0;
  if (c >= 0.985) return 1.0 - 0.7 * step(0.992, hash12(floor(px / (1.6 * uDensity)) + k * 31.0));
  float s = sin(ang);
  float co = cos(ang);
  vec2 r = vec2(co * px.x - s * px.y, s * px.x + co * px.y);
  vec2 cell = fract(r / uPitch) - 0.5;
  float th = dot(cell, cell) * 2.0;
  float aa = max(fwidth(th) * 1.3, 0.02);
  float ink = smoothstep(th - aa, th + aa, c);
  float fleck = step(0.988, hash12(floor(px / (1.6 * uDensity)) + k * 31.0));
  return ink * (1.0 - fleck * 0.8);
}
vec4 printInks(vec4 cov, vec3 i0, vec3 i1, vec3 i2, vec3 i3, float count, vec4 paper, vec2 px) {
  vec3 mult = vec3(1.0);
  mult *= mix(vec3(1.0), i0, cov.x);
  if (count > 1.5) mult *= mix(vec3(1.0), i1, cov.y);
  if (count > 2.5) mult *= mix(vec3(1.0), i2, cov.z);
  if (count > 3.5) mult *= mix(vec3(1.0), i3, cov.w);
  float a = 1.0 - (1.0 - cov.x) * (1.0 - (count > 1.5 ? cov.y : 0.0)) * (1.0 - (count > 2.5 ? cov.z : 0.0)) * (1.0 - (count > 3.5 ? cov.w : 0.0));
  if (paper.a > 0.5) {
    float grain = (vnoise(px / (1.4 * uDensity)) - 0.5) * 0.06 + (fbm(px / (260.0 * uDensity) + 3.0) - 0.5) * 0.06;
    return vec4(clamp(paper.rgb * (1.0 + grain), 0.0, 1.0) * mult, 1.0);
  }
  return vec4(max(mult - (1.0 - a), vec3(0.0)), a);
}`;

export const RISO_PLATES_FS = `${HEAD}${RISO_SCREEN}
uniform sampler2D uPlate0;
uniform sampler2D uPlate1;
uniform sampler2D uPlate2;
uniform sampler2D uPlate3;
uniform vec3 uInk0;
uniform vec3 uInk1;
uniform vec3 uInk2;
uniform vec3 uInk3;
uniform float uCount;
uniform vec4 uPaper;
uniform vec4 uOffA;
uniform vec4 uOffB;
float plate(sampler2D s, vec2 px, vec2 off, float ang, float k) {
  vec2 q = px - off * uDensity;
  return screenInk(texture(s, q / uResolution).a, q, ang, k);
}
void main() {
  vec2 px = vUv * uResolution;
  vec4 cov = vec4(
    plate(uPlate0, px, uOffA.xy, uAngles.x, 0.0),
    uCount > 1.5 ? plate(uPlate1, px, uOffA.zw, uAngles.y, 1.0) : 0.0,
    uCount > 2.5 ? plate(uPlate2, px, uOffB.xy, uAngles.z, 2.0) : 0.0,
    uCount > 3.5 ? plate(uPlate3, px, uOffB.zw, uAngles.w, 3.0) : 0.0);
  outColor = printInks(cov, uInk0, uInk1, uInk2, uInk3, uCount, uPaper, px);
}`;

/** The riso / halftone effect: solves each pixel's ink coverage from its colour, then prints it. */
export const RISO_EFFECT_FS = `${HEAD}${RISO_SCREEN}
uniform sampler2D uTex;
uniform vec3 uInk0;
uniform vec3 uInk1;
uniform vec3 uInk2;
uniform vec3 uInk3;
uniform float uCount;
uniform vec4 uPaper;
uniform vec4 uOffA;
uniform vec4 uOffB;
uniform float uMode;
uniform float uAmount;
vec4 solve(vec3 target) {
  vec4 a = vec4(0.4);
  vec3 base = uPaper.a > 0.5 ? max(uPaper.rgb, vec3(0.05)) : vec3(1.0);
  for (int it = 0; it < 32; it++) {
    vec3 f0 = 1.0 - a.x * (1.0 - uInk0);
    vec3 f1 = uCount > 1.5 ? 1.0 - a.y * (1.0 - uInk1) : vec3(1.0);
    vec3 f2 = uCount > 2.5 ? 1.0 - a.z * (1.0 - uInk2) : vec3(1.0);
    vec3 f3 = uCount > 3.5 ? 1.0 - a.w * (1.0 - uInk3) : vec3(1.0);
    vec3 p = base * f0 * f1 * f2 * f3;
    vec3 e = 2.0 * (p - target);
    vec4 g = vec4(
      dot(e, p / max(f0, vec3(1e-3)) * -(1.0 - uInk0)),
      dot(e, p / max(f1, vec3(1e-3)) * -(1.0 - uInk1)),
      dot(e, p / max(f2, vec3(1e-3)) * -(1.0 - uInk2)),
      dot(e, p / max(f3, vec3(1e-3)) * -(1.0 - uInk3)));
    a = clamp(a - g * 0.7, 0.0, 1.0);
  }
  return a * vec4(1.0, step(1.5, uCount), step(2.5, uCount), step(3.5, uCount));
}
void main() {
  vec2 px = vUv * uResolution;
  vec4 src = texture(uTex, vUv);
  if (src.a < 0.002) { outColor = vec4(0.0); return; }
  vec3 rgb = unpremul(src);
  vec4 cov;
  if (uMode > 0.5) {
    // halftone: one ink, coverage = darkness.
    cov = vec4(clamp(1.0 - luma(rgb), 0.0, 1.0), 0.0, 0.0, 0.0);
  } else {
    // Two solves: inks 1 and 3 read the picture where their misregistered plate sits, so edges fringe.
    cov = solve(rgb);
    vec4 shifted = texture(uTex, (px - uOffA.zw * uDensity) / uResolution);
    vec4 cov2 = shifted.a > 0.002 ? solve(unpremul(shifted)) : vec4(0.0);
    cov.y = cov2.y * shifted.a / max(src.a, 1e-3);
    cov.w = cov2.w * shifted.a / max(src.a, 1e-3);
  }
  vec2 o0 = uOffA.xy * uDensity, o1 = uOffA.zw * uDensity, o2 = uOffB.xy * uDensity, o3 = uOffB.zw * uDensity;
  vec4 printed = vec4(
    screenInk(cov.x, px - o0, uAngles.x, 0.0),
    screenInk(cov.y, px - o1, uAngles.y, 1.0),
    screenInk(cov.z, px - o2, uAngles.z, 2.0),
    screenInk(cov.w, px - o3, uAngles.w, 3.0));
  vec4 inked = printInks(printed, uInk0, uInk1, uInk2, uInk3, uMode > 0.5 ? 1.0 : uCount, uPaper, px);
  vec4 outc = uPaper.a > 0.5 ? vec4(inked.rgb, 1.0) * src.a : inked * src.a;
  outColor = mix(src, outc, uAmount);
}`;
