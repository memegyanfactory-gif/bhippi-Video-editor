/* GLSL for the 3D brain. Every layer is one draw call and additive; colours are linear (the output pass tone-maps). */

const STATE = /* glsl */ `
uniform sampler2D uState;
uniform float uStateW;
vec4 nodeState(float i) {
  int n = int(i + 0.5);
  int w = int(uStateW);
  return texelFetch(uState, ivec2(n % w, n / w), 0);
}
uniform vec2 uFog;
float fogOf(float d) { return mix(1.0, 0.28, smoothstep(uFog.x, uFog.y, d)); }
`;

export const cortexVert = /* glsl */ `
attribute float aSeed;
attribute float aLobe;
attribute float aMix;
attribute float aGroove;
attribute vec3 aNormal;
uniform float uTime;
uniform float uPx;
uniform float uSize;
uniform float uDream;
uniform float uWave;
uniform float uIntensity;
uniform vec3 uLobeCol[7];
uniform float uLobeGlow[7];
uniform vec4 uRip[12];
uniform vec2 uFog;
varying vec3 vCol;
float fogOf(float d) { return mix(1.0, 0.28, smoothstep(uFog.x, uFog.y, d)); }
void main() {
  vec3 p = position;
  float breath = 1.0 + 0.006 * sin(uTime * 0.7);
  p *= breath;
  p += aNormal * (sin(uTime * 0.9 + aSeed * 6.2831) * 0.0016);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * aNormal);
  vec3 v = normalize(-mv.xyz);
  float ndv = dot(n, v);
  float rim = pow(1.0 - abs(ndv), 2.4);
  float facing = smoothstep(-0.7, 0.45, ndv);
  vec3 key = normalize((viewMatrix * vec4(-0.45, 0.85, 0.55, 0.0)).xyz);
  float lam = max(dot(n, key), 0.0);
  int li = int(aLobe + 0.5);
  float glow = uLobeGlow[li] * aMix;
  vec3 base = vec3(0.34, 0.31, 0.78);
  vec3 col = mix(base, uLobeCol[li], clamp(glow * 1.5, 0.0, 0.9));
  float tw = 0.78 + 0.22 * sin(uTime * (0.8 + aSeed * 1.8) + aSeed * 40.0);
  float b = (0.12 + 0.34 * lam + 0.9 * rim) * mix(0.4, 1.0, facing) * mix(0.12, 1.0, 1.0 - aGroove) * tw + glow * 0.4;
  float band = exp(-pow((p.z - uWave) / 0.22, 2.0)) + 0.5 * exp(-pow((p.z - uWave - 1.25) / 0.2, 2.0));
  b += band * uDream * 0.9;
  col = mix(col, vec3(0.3, 0.55, 1.0), clamp(band * uDream, 0.0, 0.9));
  for (int i = 0; i < 12; i++) {
    vec4 r = uRip[i];
    if (r.w < 0.0) continue;
    float age = uTime - r.w;
    float d = distance(p, r.xyz);
    float ring = exp(-pow((d - age * 0.85) / 0.085, 2.0)) * exp(-age * 1.5);
    b += ring * 1.7;
    col = mix(col, vec3(1.0), clamp(ring * 0.55, 0.0, 0.6));
  }
  gl_Position = projectionMatrix * mv;
  vCol = col * b * fogOf(-mv.z) * uIntensity;
  gl_PointSize = max(1.0, uSize * uPx / (-mv.z) * (0.85 + 0.7 * rim + band * uDream * 0.5));
}
`;

export const cortexFrag = /* glsl */ `
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

export const shellVert = /* glsl */ `
uniform float uTime;
uniform vec2 uFog;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vFog;
float fogOf(float d) { return mix(1.0, 0.28, smoothstep(uFog.x, uFog.y, d)); }
void main() {
  float breath = 1.0 + 0.006 * sin(uTime * 0.7);
  vec3 p = position * breath;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = p;
  vFog = fogOf(-mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const shellFrag = /* glsl */ `
uniform float uTime;
uniform float uDream;
uniform float uWave;
uniform vec3 uRim;
uniform vec3 uLobeCol[7];
uniform float uLobeGlow[7];
uniform vec3 uLobeC[7];
uniform vec3 uLobeR[7];
uniform float uLobeS[7];
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vFog;
// The same hash and value noise as shape.ts, so the sulci shaded here line up with the cloud's grooves.
uint ih(ivec3 q) {
  uint x = uint(q.x); uint y = uint(q.y); uint z = uint(q.z);
  uint h = (x * 374761393u) ^ (y * 668265263u) ^ (z * 1274126177u);
  h = (h ^ (h >> 13u)) * 1103515245u;
  return h ^ (h >> 16u);
}
float hs(ivec3 q) { return float(ih(q)) / 4294967296.0; }
float vnoise(vec3 p) {
  ivec3 i = ivec3(floor(p));
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hs(i), hs(i + ivec3(1, 0, 0)), f.x), mix(hs(i + ivec3(0, 1, 0)), hs(i + ivec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hs(i + ivec3(0, 0, 1)), hs(i + ivec3(1, 0, 1)), f.x), mix(hs(i + ivec3(0, 1, 1)), hs(i + ivec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z) * 2.0 - 1.0;
}
float creaseAt(vec3 p) {
  float n1 = vnoise(p * 7.4 + vec3(3.1, -1.7, 8.3));
  float n2 = vnoise(p * 15.0 + vec3(-7.7, 2.2, 4.9));
  float groove = 1.0 - smoothstep(0.0, 0.2, abs(n1 + 0.55 * n2));
  vec3 q = (p - vec3(0.0, -0.41, -0.8)) / vec3(0.48, 0.26, 0.31);
  float cb = 1.0 - smoothstep(-0.02, 0.07, (length(q) - 1.0) * 0.26);
  float folia = 0.5 + 0.5 * sin(p.y * 150.0 + n1 * 3.2);
  return mix(groove, 1.0 - folia, cb);
}
void main() {
  vec3 n0 = normalize(vN);
  vec3 v = normalize(vV);
  vec3 p = vP;
  float crease = creaseAt(p);
  // Bump the normal by the fold field so gyri catch the light like wet tissue.
  const float e = 0.012;
  vec3 g = vec3(creaseAt(p + vec3(e, 0.0, 0.0)) - crease, creaseAt(p + vec3(0.0, e, 0.0)) - crease, creaseAt(p + vec3(0.0, 0.0, e)) - crease) / e;
  vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
  gv -= n0 * dot(gv, n0);
  vec3 n = normalize(n0 + gv * 0.016);
  float ndv = abs(dot(n0, v));
  float rim = pow(1.0 - ndv, 2.3);
  vec3 key = normalize((viewMatrix * vec4(-0.45, 0.85, 0.55, 0.0)).xyz);
  float lam = max(dot(n, key), 0.0);
  float soft = 0.2 + 0.8 * lam;
  float spec = pow(max(dot(reflect(-key, n), v), 0.0), 18.0);
  vec3 body = mix(vec3(0.005, 0.005, 0.022), vec3(0.13, 0.1, 0.4), soft) * (0.04 + 0.96 * pow(1.0 - crease, 1.5));
  vec3 col = body * 1.0 + vec3(0.55, 0.5, 1.0) * spec * 0.3 * (1.0 - crease) + uRim * (0.025 + rim * 0.42);
  for (int i = 0; i < 7; i++) {
    vec3 qq = vec3(uLobeS[i] > 0.5 ? abs(p.x) : p.x, p.y, p.z);
    vec3 d = (qq - uLobeC[i]) / uLobeR[i];
    float w = exp(-dot(d, d) * 0.8);
    col += uLobeCol[i] * w * uLobeGlow[i] * (0.06 + 0.22 * rim + 0.12 * soft * (1.0 - crease));
  }
  float band = exp(-pow((p.z - uWave) / 0.24, 2.0));
  col += vec3(0.25, 0.5, 1.0) * band * uDream * (0.1 + 0.6 * rim + 0.3 * (1.0 - crease));
  gl_FragColor = vec4(col * vFog, 1.0);
}
`;

export const neuronVert = /* glsl */ `
attribute vec3 aPos;
attribute float aSize;
attribute vec3 aColor;
attribute vec2 aMeta;
attribute float aBorn;
attribute float aIdx;
uniform float uTime;
${STATE}
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vS;
varying vec3 vFlags;
varying float vFogK;
varying float vMult;
varying float vAge;
void main() {
  vec4 s = nodeState(aIdx);
  float age = uTime - aBorn;
  float hub = step(0.5, mod(aMeta.x, 2.0));
  float epi = step(0.5, mod(floor(aMeta.x / 4.0), 2.0));
  float sickF = step(0.5, mod(floor(aMeta.x / 2.0), 2.0));
  float mult = (epi > 0.5 && age > 4.0 && s.b < 0.5 && sickF < 0.5) ? 3.6 : 7.0;
  float scale = aSize * mult * (1.0 + s.g * 0.45 + s.b * 0.18);
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * mult;
  vColor = aColor;
  vS = s;
  vFlags = vec3(hub, sickF, epi);
  vFogK = fogOf(-mv.z);
  vMult = mult;
  vAge = age;
}
`;

export const neuronFrag = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vS;
varying vec3 vFlags;
varying float vFogK;
varying float vMult;
varying float vAge;
void main() {
  float r = length(vUv);
  float dim = vS.r;
  float flash = vS.g;
  float emph = vS.b;
  float hub = vFlags.x;
  float sickF = vFlags.y;
  float epi = vFlags.z;
  vec3 col = vec3(0.0);
  // Core: a lit sphere.
  if (r < 1.0) {
    float z = sqrt(1.0 - r * r);
    vec3 nrm = vec3(vUv, z);
    float lam = clamp(dot(nrm, normalize(vec3(-0.45, 0.6, 0.75))), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(vec3(0.0, 0.0, -1.0), nrm), normalize(vec3(-0.45, 0.6, 0.75))) * -1.0, 0.0, 1.0), 14.0);
    float edge = smoothstep(1.0, 0.82, r);
    vec3 body = vColor * (0.55 + 1.15 * lam) + vec3(1.0) * (spec * 0.55 + flash * 0.9 + emph * 0.2);
    col += body * edge * (epi > 0.5 ? 0.8 : (hub > 0.5 ? 1.3 : 0.45));
  }
  // Halo.
  float haloK = epi > 0.5 ? 0.14 : (hub > 0.5 ? 1.1 : 0.16);
  col += vColor * exp(-r * r * (epi > 0.5 ? 0.42 : 0.2)) * haloK * (0.16 + flash * 1.1 + emph * 0.4);
  // A newly learned neuron pulses outward rings.
  if (vAge < 4.0) {
    float ph = fract(vAge / 1.3);
    float rr = 1.3 + ph * (vMult - 1.5);
    col += vColor * exp(-pow((r - rr) / 0.32, 2.0)) * (1.0 - ph) * 1.5 * (1.0 - vAge / 4.5);
  }
  // Ring on whatever is picked.
  if (emph > 0.75) {
    col += vec3(1.0) * exp(-pow((r - 1.75) / 0.12, 2.0)) * 0.9;
  }
  // A tool or skill that keeps failing wears a red ring.
  if (sickF > 0.5) {
    col += vec3(1.0, 0.18, 0.18) * exp(-pow((r - 1.4) / 0.11, 2.0)) * 1.1;
  }
  float vis = mix(0.07, 1.0, smoothstep(0.1, 0.9, dim));
  if (epi > 0.5 && flash < 0.02 && emph < 0.5) vis *= 0.9;
  float calm = mix(vS.a, 1.0, clamp(emph * 2.0 + flash, 0.0, 1.0));
  gl_FragColor = vec4(col * vis * vFogK * calm, 1.0);
  if (dot(col, col) < 0.0004) discard;
}
`;

export const edgeVert = /* glsl */ `
attribute vec3 color;
attribute vec2 aEnds;
attribute float aT;
attribute float aW;
uniform float uTime;
uniform float uActive;
uniform float uFocus;
uniform float uBase;
${STATE}
varying vec3 vCol;
void main() {
  vec4 sa = nodeState(aEnds.x);
  vec4 sb = nodeState(aEnds.y);
  float va = smoothstep(0.1, 0.9, sa.r);
  float vb = smoothstep(0.1, 0.9, sb.r);
  float vis = min(sa.r, sb.r);
  float lit = va * vb;
  float hot = (abs(aEnds.x - uActive) < 0.5 || abs(aEnds.y - uActive) < 0.5) ? 1.0 : 0.0;
  float alpha = uBase * aW * (0.25 + vis * 0.75) * (1.0 - uFocus * 0.8 * (1.0 - lit));
  alpha += lit * uFocus * 0.1;
  float flow = 0.62 + 0.38 * sin(aT * 22.0 - uTime * 5.0);
  alpha *= mix(sa.a, sb.a, aT);
  alpha += hot * 0.5 * flow * lit;
  alpha += ((1.0 - aT) * sa.g + aT * sb.g) * 0.7;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 c = mix(color, vec3(1.0), hot * 0.55);
  vCol = c * alpha * fogOf(-mv.z) * (0.4 + 0.6 * lit);
}
`;

export const edgeFrag = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }
`;

export const pulseVert = /* glsl */ `
attribute vec3 aPos;
attribute float aSize;
attribute vec4 aColor;
uniform vec2 uFog;
varying vec2 vUv;
varying vec4 vColor;
float fogOf(float d) { return mix(1.0, 0.28, smoothstep(uFog.x, uFog.y, d)); }
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += position.xy * aSize;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vColor = vec4(aColor.rgb, aColor.a * fogOf(-mv.z));
}
`;

export const pulseFrag = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float g = exp(-r * r * 5.0);
  vec3 col = vColor.rgb * g + vec3(1.0) * exp(-r * r * 28.0) * 0.9;
  gl_FragColor = vec4(col * vColor.a, 1.0);
}
`;

export const dustVert = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uPx;
uniform float uMotion;
varying float vA;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.05 * uMotion + aSeed * 30.0) * 0.12;
  p.y += cos(uTime * 0.04 * uMotion + aSeed * 50.0) * 0.1;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, 0.012 * uPx / (-mv.z));
  vA = (0.05 + 0.08 * fract(aSeed * 91.7)) * (0.6 + 0.4 * sin(uTime * 0.6 + aSeed * 99.0));
}
`;

export const dustFrag = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vec3(0.5, 0.55, 1.0) * a * vA, 1.0);
}
`;

export const backVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const backFrag = /* glsl */ `
uniform vec2 uAspect;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * uAspect;
  float r = length(p - vec2(0.05, 0.04));
  vec3 inner = vec3(0.0105, 0.0095, 0.026);
  vec3 outer = vec3(0.0018, 0.0018, 0.0036);
  vec3 col = mix(inner, outer, smoothstep(0.0, 1.35, r));
  col += vec3(0.0035, 0.0018, 0.007) * exp(-pow(length(p - vec2(-0.5, -0.4)) / 0.8, 2.0));
  gl_FragColor = vec4(col, 1.0);
}
`;
