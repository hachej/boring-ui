// One WebGPU device shared by every shader surface on the page.
// A material is only `fn shade(uv: vec2f, px: vec2f) -> vec4f`: the prelude owns the
// vertex stage, the uniforms and the noise helpers, so generated code stays small and
// can only paint pixels (WGSL has no DOM, network or file access).

export const PRELUDE = /* wgsl */ `
struct U {
  res: vec2f, mouse: vec2f,
  time: f32, state: f32, energy: f32, seed: f32,
  c1: vec4f, c2: vec4f, data0: vec4f, data1: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7)) + u.seed) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var k = 0; k < 5; k++) { s += a * noise(p); p = p * 2.03 + vec2f(1.7, 9.2); a *= 0.5; }
  return s;
}
fn datum(i: i32) -> f32 {
  if (i < 4) { return u.data0[i]; }
  return u.data1[i - 4];
}
`;

const TAIL = /* wgsl */ `
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = vec2f(pos.x / u.res.x, 1.0 - pos.y / u.res.y);
  let c = shade(uv, pos.xy);
  return vec4f(c.rgb * c.a, c.a);
}
`;

let devicePromise;
export function gpu() {
  devicePromise ??= (async () => {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      device.lost.then((i) => console.warn('GPU device lost:', i.reason, i.message));
      device.addEventListener('uncapturederror', (e) => console.warn('GPU error:', e.error.message));
      // Keep the adapter referenced: some Chromium builds drop the instance once it is collected.
      return { adapter, device, format: readback ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat() };
    } catch { return null; }
  })();
  return devicePromise;
}

const surfaces = new Set();
// ?scale=0.3 renders at a fraction of CSS pixels (software GPUs, screenshots, slow laptops).
const params = new URLSearchParams(location.search);
const forcedScale = Number(params.get('scale')) || 0;
// ?readback=1 renders the same pipelines into an offscreen texture and copies the pixels to a
// 2D canvas: for machines whose WebGPU cannot present to a canvas (headless, no GPU).
const readback = params.has('readback');
let started = false;
function loop(t) {
  for (const s of surfaces) s.frame(t / 1000);
  requestAnimationFrame(loop);
}

const hexToVec = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

export class Surface {
  // canvas: HTMLCanvasElement; shade: WGSL body of fn shade
  constructor(canvas, shade, { c1 = '#7c5cff', c2 = '#22d3ee', seed = Math.random() * 10 } = {}) {
    this.canvas = canvas;
    this.u = { mouse: [0.5, 0.5], state: 0, energy: 0, seed, c1: hexToVec(c1), c2: hexToVec(c2), data: new Array(8).fill(0) };
    this.visible = true;
    this.ready = this.#init(shade);
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.u.mouse = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    });
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(canvas);
  }

  async #init(shade) {
    const g = await gpu();
    if (!g) { this.canvas.classList.add('gpu-fallback'); return false; }
    this.g = g;
    if (readback) this.ctx2d = this.canvas.getContext('2d');
    else {
      this.ctx = this.canvas.getContext('webgpu');
      this.ctx.configure({ device: g.device, format: g.format, alphaMode: 'premultiplied' });
    }
    this.buffer = g.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const res = await this.setShader(shade);
    if (!res.ok) console.warn('shader', res.error);
    surfaces.add(this);
    if (!started) { started = true; requestAnimationFrame(loop); }
    return true;
  }

  // Compiles a new material; on error the previous pipeline keeps running.
  async setShader(shade) {
    const g = this.g ?? (await gpu());
    if (!g) return { ok: false, error: 'WebGPU unavailable' };
    const { device, format } = g;
    const module = device.createShaderModule({ code: PRELUDE + shade + TAIL });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) {
      const offset = PRELUDE.split('\n').length - 1;
      return { ok: false, error: errors.map((m) => `line ${m.lineNum - offset}: ${m.message}`).join('\n') };
    }
    device.pushErrorScope('validation');
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
    });
    const err = await device.popErrorScope();
    if (err) return { ok: false, error: err.message };
    this.pipeline = pipeline;
    this.bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
    return { ok: true };
  }

  set(values) {
    for (const [k, v] of Object.entries(values)) {
      if (k === 'c1' || k === 'c2') this.u[k] = hexToVec(v);
      else if (k === 'data') v.forEach((x, i) => { this.u.data[i] = x; });
      else this.u[k] = v;
    }
  }

  frame(time) {
    if (!this.pipeline || !this.visible || this.busy) return;
    const dpr = forcedScale || Math.min(devicePixelRatio, 1.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const u = this.u;
    const arr = new Float32Array([w, h, ...u.mouse, time, u.state, u.energy, u.seed, ...u.c1, ...u.c2, ...u.data]);
    const { device } = this.g;
    device.queue.writeBuffer(this.buffer, 0, arr);
    const enc = device.createCommandEncoder();
    const target = readback ? this.#offscreen(w, h) : this.ctx.getCurrentTexture();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.draw(3);
    pass.end();
    if (readback) enc.copyTextureToBuffer({ texture: target }, { buffer: this.rb.buf, bytesPerRow: this.rb.bpr }, [w, h]);
    device.queue.submit([enc.finish()]);
    if (readback) this.#present(w, h);
  }

  #offscreen(w, h) {
    if (this.rb?.w !== w || this.rb?.h !== h) {
      const bpr = Math.ceil((w * 4) / 256) * 256;
      const { device } = this.g;
      this.rb = { w, h, bpr,
        tex: device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
        buf: device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) };
    }
    return this.rb.tex;
  }

  async #present(w, h) {
    const { buf, bpr } = this.rb;
    this.busy = true;
    try {
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const img = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * bpr + x * 4, o = (y * w + x) * 4, a = src[i + 3];
          // The pipeline writes premultiplied alpha; ImageData wants straight alpha.
          img.data[o] = a ? (src[i] * 255) / a : 0;
          img.data[o + 1] = a ? (src[i + 1] * 255) / a : 0;
          img.data[o + 2] = a ? (src[i + 2] * 255) / a : 0;
          img.data[o + 3] = a;
        }
      }
      buf.unmap();
      this.ctx2d.putImageData(img, 0, 0);
    } catch { /* buffer replaced by a resize: the next frame redraws */ }
    this.busy = false;
  }

  destroy() { surfaces.delete(this); }
}

// Smoothly eases a numeric uniform towards a target, for state changes that should flow.
export function tween(surface, key, to, ms = 600) {
  const from = surface.u[key];
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    surface.u[key] = from + (to - from) * (1 - Math.pow(1 - k, 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
