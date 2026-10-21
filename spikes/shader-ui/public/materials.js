// Named materials. Each is the body of `fn shade(uv, px) -> vec4f` (see gpu.js PRELUDE).
// u.state: 0 idle, 1 thinking, 2 streaming, 3 error. u.energy: 0..1 activity.

export const materials = {
  // The agent's aura: slow ink when idle, a vortex while thinking, flowing bands while streaming.
  aura: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let asp = u.res.x / u.res.y;
  var p = (uv - 0.5) * vec2f(asp, 1.0);
  let t = u.time;
  let think = smoothstep(0.5, 1.5, u.state) * (1.0 - smoothstep(1.5, 2.0, u.state));
  let stream = smoothstep(1.5, 2.5, u.state) * (1.0 - smoothstep(2.5, 3.0, u.state));
  let err = smoothstep(2.5, 3.0, u.state);
  let r = length(p);
  let ang = atan2(p.y, p.x);
  // thinking twists space around the centre
  let tw = think * (1.2 / (r + 0.25)) * sin(t * 0.6);
  p = vec2f(cos(tw) * p.x - sin(tw) * p.y, sin(tw) * p.x + cos(tw) * p.y);
  // streaming drags everything to the right
  p.x -= stream * t * 0.35;
  let m = (u.mouse - 0.5) * vec2f(asp, 1.0);
  let q = vec2f(fbm(p * 2.2 + t * 0.07), fbm(p * 2.2 - t * 0.05 + 4.0));
  var n = fbm(p * 3.0 + q * (1.5 + u.energy * 2.0) + vec2f(0.0, t * 0.04));
  n += 0.25 / (1.0 + 40.0 * dot(uv - u.mouse, uv - u.mouse));
  let bands = stream * 0.18 * sin((p.x * 18.0 + n * 6.0));
  var col = mix(u.c1.rgb, u.c2.rgb, smoothstep(0.3, 0.8, n + bands));
  col = mix(col, vec3f(1.0, 0.25, 0.3), err * (0.6 + 0.4 * step(0.5, hash(floor(px / 6.0) + floor(t * 12.0)))));
  let glow = smoothstep(0.25, 0.95, n) * (0.55 + 0.45 * u.energy);
  let vign = smoothstep(1.1, 0.2, r);
  return vec4f(col * (0.35 + glow) * vign + 0.04, 1.0);
}`,

  // A heat field driven by up to 8 data values laid out as columns.
  heat: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let col_i = i32(floor(uv.x * 8.0));
  let v = datum(col_i);
  let x = fract(uv.x * 8.0);
  let bar = smoothstep(0.08, 0.14, x) * smoothstep(0.92, 0.86, x) * step(uv.y, v * 0.85);
  let flicker = fbm(vec2f(uv.x * 10.0, uv.y * 6.0 - u.time * (0.6 + v * 2.0)));
  let hot = clamp(v * 1.2 + flicker * 0.4 - uv.y * 0.6, 0.0, 1.0);
  let fire = mix(u.c1.rgb, u.c2.rgb, hot);
  let halo = smoothstep(0.4, 0.0, abs(uv.y - v * 0.85)) * v * 0.6 * step(abs(x - 0.5), 0.5);
  let base = vec3f(0.03, 0.035, 0.05) + 0.03 * noise(px * 0.05);
  return vec4f(base + fire * (bar * (0.6 + flicker) + halo), 1.0);
}`,

  // Frosted glass that bends towards the cursor.
  glass: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let d = uv - u.mouse;
  let lens = 0.08 / (0.02 + dot(d, d) * 6.0);
  let p = uv * 3.0 + d * lens * 0.2;
  let n = fbm(p + u.time * 0.03);
  let caustic = pow(abs(sin(n * 12.0 + u.time * 0.5)), 8.0);
  let col = mix(u.c1.rgb, u.c2.rgb, uv.y + n * 0.3) * 0.25 + caustic * 0.35 + lens * 0.02;
  return vec4f(col, 1.0);
}`,

  // A calm paper surface for writing; brightens slightly where suggestions arrive (u.energy).
  paper: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let grain = noise(px * 0.7) * 0.025;
  let wash = fbm(uv * 2.0 + u.time * 0.01) * 0.05;
  let breathe = u.energy * (0.5 + 0.5 * sin(u.time * 2.0)) * smoothstep(0.6, 1.0, uv.x) * 0.08;
  let c = vec3f(0.965, 0.955, 0.93) - grain - wash + breathe * u.c1.rgb;
  return vec4f(c, 1.0);
}`,

  // A small living presence: the ambient agent's body.
  orb: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let p = uv - 0.5;
  let a = atan2(p.y, p.x);
  let wob = 0.02 * sin(a * 5.0 + u.time * 3.0) + 0.03 * fbm(vec2f(a * 2.0, u.time)) * (0.5 + u.energy);
  let r = length(p);
  let edge = 0.3 + wob;
  let body = smoothstep(edge, edge - 0.04, r);
  let inner = fbm(p * 6.0 + vec2f(u.time * 0.4, -u.time * 0.3));
  let col = mix(u.c1.rgb, u.c2.rgb, inner + p.y);
  let halo = exp(-max(r - edge, 0.0) * 18.0) * (0.35 + 0.5 * u.energy);
  let spec = smoothstep(0.12, 0.0, length(p - vec2f(-0.09, 0.1))) * 0.6;
  let a_out = clamp(body + halo * 0.8, 0.0, 1.0);
  return vec4f(col * (body * (0.7 + inner) + halo) + spec * body, a_out);
}`,

  // Reveal mask: the artifact materialises where noise is below u.energy (progress).
  reveal: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let n = fbm(uv * vec2f(4.0, 6.0) + vec2f(0.0, u.time * 0.1)) * 0.7 + (1.0 - uv.y) * 0.3;
  let prog = u.energy * 1.25 - 0.1;
  let edge = smoothstep(prog - 0.06, prog, n) * (1.0 - smoothstep(prog, prog + 0.02, n));
  let cover = smoothstep(prog - 0.01, prog + 0.01, n);
  let ink = mix(u.c1.rgb, u.c2.rgb, uv.x);
  let bg = vec3f(0.06, 0.06, 0.08) + 0.04 * fbm(uv * 8.0 + u.time * 0.2);
  return vec4f(bg * cover + ink * edge * 1.6, max(cover, edge));
}`,

  // A ripple that rings out from a point (u.mouse), used to show what just changed.
  ripple: /* wgsl */ `
fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let asp = u.res.x / u.res.y;
  let d = length((uv - u.mouse) * vec2f(asp, 1.0));
  let t = u.energy;
  let ring = smoothstep(0.03, 0.0, abs(d - t * 0.9)) * (1.0 - t);
  let fill = smoothstep(t * 0.9, 0.0, d) * (1.0 - t) * 0.15;
  return vec4f(u.c1.rgb, clamp(ring + fill, 0.0, 1.0));
}`,
};
