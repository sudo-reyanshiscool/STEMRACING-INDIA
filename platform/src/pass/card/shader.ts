import { PATCH } from './mask';

/**
 * The Silver finish: black carbon weave, silver holographic foil, one fragment shader over the whole card.
 * WebGL 1 on purpose, for reach on older Android phones.
 */
const VERT = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = vec2(a.x*.5+.5, .5-a.y*.5); gl_Position = vec4(a,0.,1.); }';
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 uRes, uTilt; uniform float uTime, uSeed, uPulseT, uMotion; uniform vec3 uPulseCol; uniform sampler2D uMask;
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n = hash21(p); return vec2(n, hash21(p+n+17.1)); }
vec3 spectrum(float t){ return .5+.5*cos(6.28318*(t+vec3(0.,.33,.67))); }
/* silver foil at a viewing angle: grey face-on, a faint spectral fringe as it turns */
vec3 iri(float t){ vec3 s = spectrum(t); return mix(vec3(.70+.22*dot(s, vec3(.333))), s, .22); }
float guilloche(vec2 q, float n, float k, float ph){ float r = length(q), a = atan(q.y,q.x);
  float w = r*k + .9*sin(a*n+ph) + .45*sin(a*(n*.5+1.)-ph*1.7); return smoothstep(.09,.0,abs(fract(w)-.5)); }
void main(){
  vec2 uv = vUv; float asp = uRes.x/uRes.y; vec2 p = vec2((uv.x-.5)*asp, uv.y-.5); vec2 tilt = uTilt;
  /* twill weave: tows alternate direction, and each catches the light across its width */
  vec2 g = vec2(uv.x*asp, uv.y)*58.; vec2 id = floor(g), f = fract(g);
  float warp = step(mod(id.x-id.y,4.),1.5);
  float hx = pow(max(0.,1.-abs(f.x-.5-tilt.x*.38)*2.3),2.), hy = pow(max(0.,1.-abs(f.y-.5-tilt.y*.38)*2.3),2.);
  float tow = mix(hy,hx,warp);
  float pool = smoothstep(1.1,.0,length(p-vec2(.25,-.35)+tilt*.25));
  vec3 col = (vec3(.026,.026,.030) + tow*vec3(.085,.085,.095))*(.75+.5*pool);
  /* a broad sheen that slides across with the tilt */
  float s = dot(p, normalize(vec2(1.,.45))) - tilt.x*.75 - tilt.y*.3; float sheen = exp(-s*s*16.); col += sheen*.055;
  vec4 m = texture2D(uMask, uv);
  vec2 pc = vec2((${PATCH.x.toFixed(3)}-.5)*asp, ${PATCH.y.toFixed(3)}-.5); vec2 q = p-pc; float d = length(q), R = ${PATCH.r.toFixed(3)};
  float inPatch = smoothstep(R,R*.97,d);
  /* security line work: one colour, a halo behind the hologram, unique to the card */
  float g1 = guilloche(q, 9., 22., uSeed*6.283 + uTime*.03*uMotion);
  col = mix(col, iri(d*1.6 + tilt.x*.45 + uSeed), g1*.16*smoothstep(.30,.10,d)*step(.5,uv.x+.08));
  /* the track shape as a fine foil outline that lights as the sheen passes over it */
  col = mix(col, iri(uv.y*1.3 + tilt.x*.8 + tilt.y*.4), m.b*(1.-inPatch)*(.20+.55*sheen));
  /* foil with shard facets: each facet lights when its own angle meets the tilt */
  vec2 sg = p*30. + vec2(uSeed*40.,0.); vec2 sid = floor(sg), sf = fract(sg);
  float half_ = step(sf.x+sf.y,1.); vec2 rn = hash22(sid + half_*7.31)*2.-1.;
  float glint = smoothstep(.55,.0,length(rn*.9 - tilt*1.25 - .04*vec2(sin(uTime*.5+rn.x*6.),cos(uTime*.4+rn.y*6.))*uMotion));
  float hue = dot(p,vec2(.8,.6))*2.1 + tilt.x*1.3 + tilt.y*.85 + rn.x*.16;
  col = mix(col, iri(hue)*(.60+.25*tow) + glint*.80, m.r);
  /* hologram patch: the track shape one way, the holder's ghost portrait the other */
  if(d < R*1.12){
    float a = smoothstep(-.14,.14,tilt.x);
    float lines = .65+.35*sin(uv.y*uRes.y*.9);
    vec3 A = iri(d*9. - tilt.y*1.2 + .1)*(.14+.86*m.b);
    vec3 B = iri(.55 + m.g*.25 + tilt.y*.5 + d*3.)*(.12+.95*m.g)*lines;
    col = mix(col, mix(A,B,a)*(.8+.35*glint) + vec3(.03), inPatch);
    col = mix(col, iri(atan(q.y,q.x)/6.283*2. + tilt.x)*.95, smoothstep(R*.07,.0,abs(d-R)));
  }
  /* the sync pulse: a thin line riding the stream band, bright for a moment when it changes */
  float pl = smoothstep(.006,.0,abs(uv.y-.866))*step(.44,uv.x); col = mix(col, uPulseCol, min(1., pl*(.6+.9*exp(-uPulseT*14.)*uMotion)));
  /* a steady hairline border that shifts with the tilt */
  float e = min(min(uv.x,1.-uv.x)*asp, min(uv.y,1.-uv.y));
  col = mix(col, iri(atan(p.y,p.x)/6.283 + tilt.x*.7 + tilt.y*.3)*.85, smoothstep(.011,.0,e)*.6);
  col += (hash21(uv*uRes + uTime)-.5)*.014;
  gl_FragColor = vec4(col,1.);
}`;

export interface FoilFrame { seconds: number; tiltX: number; tiltY: number; seed: number; pulse: [number, number, number]; pulseT: number; motion: boolean }
export interface Foil {
  setMask(mask: HTMLCanvasElement): void;
  render(frame: FoilFrame): void;
  destroy(): void;
}

const UNIFORMS = ['uRes', 'uTilt', 'uTime', 'uSeed', 'uPulseT', 'uMotion', 'uPulseCol', 'uMask'] as const;

/**
 * Null when this device cannot run the shader. `onLost` is called if the graphics context is taken away later;
 * either way the card falls back to its plain version.
 */
export function createFoil(canvas: HTMLCanvasElement, onLost: () => void): Foil | null {
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null; } catch { gl = null; }
  if (!gl) return null;
  const g = gl, loc: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {};
  const compile = (type: number, source: string) => {
    const shader = g.createShader(type)!;
    g.shaderSource(shader, source); g.compileShader(shader);
    if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(shader) ?? 'shader failed to compile');
    return shader;
  };
  try {
    const program = g.createProgram()!;
    g.attachShader(program, compile(g.VERTEX_SHADER, VERT)); g.attachShader(program, compile(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? 'shader failed to link');
    g.useProgram(program);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const a = g.getAttribLocation(program, 'a');
    g.enableVertexAttribArray(a); g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) loc[name] = g.getUniformLocation(program, name);
    g.bindTexture(g.TEXTURE_2D, g.createTexture());
    for (const [k, v] of [[g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR]]) g.texParameteri(g.TEXTURE_2D, k, v);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  } catch {
    return null;
  }
  let alive = true;
  const lost = (e: Event) => { e.preventDefault(); if (alive) { alive = false; onLost(); } };
  canvas.addEventListener('webglcontextlost', lost);
  // Phones with little memory draw at a lower density: the foil is soft-edged, so it does not show.
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const density = () => Math.min(window.devicePixelRatio || 1, memory !== undefined && memory <= 4 ? 1.5 : 2);

  return {
    setMask(mask) { if (alive) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, mask); },
    render(frame) {
      if (!alive) return;
      const w = Math.max(2, Math.round(canvas.clientWidth * density())), h = Math.max(2, Math.round(canvas.clientHeight * density()));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; g.viewport(0, 0, w, h); }
      g.uniform2f(loc.uRes!, w, h); g.uniform2f(loc.uTilt!, frame.tiltX, frame.tiltY); g.uniform1f(loc.uTime!, frame.seconds % 3600); g.uniform1f(loc.uSeed!, frame.seed);
      g.uniform1f(loc.uPulseT!, frame.pulseT); g.uniform1f(loc.uMotion!, frame.motion ? 1 : 0); g.uniform3f(loc.uPulseCol!, ...frame.pulse); g.uniform1i(loc.uMask!, 0);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      alive = false;
      canvas.removeEventListener('webglcontextlost', lost);
      g.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
