#!/usr/bin/env node
/**
 * 程序化渲染 MyCurl 终端风格（Terminal）macOS 桌面应用图标
 * 输出：
 *  - assets/icon-source.png (1024x1024 透明底 Squircle 主图)
 *  - src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.icns, icon.ico}
 *  - public/icon.png (256x256 供前端 favicon 与顶栏品牌图标使用)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const publicDir = path.join(root, 'public');
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// ---- PNG 编码 ----
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 数学 & SDF 工具 ----
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function sdSquircle(px, py, half, p = 4.8) {
  const ax = Math.abs(px) / half;
  const ay = Math.abs(py) / half;
  const r = Math.pow(Math.pow(ax, p) + Math.pow(ay, p), 1 / p);
  return (r - 1.0) * half;
}

function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function blendOver(dstR, dstG, dstB, srcR, srcG, srcB, a) {
  return [dstR * (1 - a) + srcR * a, dstG * (1 - a) + srcG * a, dstB * (1 - a) + srcB * a];
}

/**
 * 渲染 1024x1024 精雕 macOS 终端风格图标：
 * - 外层深空灰金属质感 Squircle 机壳 + 平滑玻璃高光倒角 + 柔和底部投影
 * - 内嵌暗黑 OLED 终端屏幕 + 顶部 macOS 经典三色交通灯窗口栏
 * - 主体：高对比度发光终端提示符 `>_`（翡翠绿到电光青渐变 + 真实荧光漫反射光晕）
 * - 底部微弱终端命令装饰条，整体在 22px 到 1024px 均清晰锐利
 */
function renderTerminalIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size;
  const outerHalf = 0.825; // Apple HIG 标准留白比例
  const innerHalf = 0.742; // 金属边框厚度

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;

      const dOuter = sdSquircle(nx, ny, outerHalf, 4.8);
      const outerAlpha = clamp(0.5 - dOuter / (aa * 2), 0, 1);

      const idx = (y * size + x) * 4;

      if (outerAlpha <= 0) {
        // 底部柔和环境阴影
        const dShadow = sdSquircle(nx, ny - 0.024, outerHalf + 0.008, 4.8);
        if (dShadow < 0.095) {
          const t = clamp(1 - Math.max(0, dShadow) / 0.095, 0, 1);
          const sa = Math.pow(t, 2.3) * 0.3;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = Math.round(sa * 255);
        }
        continue;
      }

      // 1. 外部深色阳极氧化金属机身
      const gradT = clamp((ny + outerHalf) / (outerHalf * 2), 0, 1);
      const diagT = clamp((nx + ny + 1.65) / 3.3, 0, 1);
      let r = mix(54, 24, gradT) + mix(8, 0, diagT);
      let g = mix(60, 27, gradT) + mix(10, 0, diagT);
      let b = mix(74, 36, gradT) + mix(14, 0, diagT);

      // 金属外框顶部微玻璃反光
      const rimStrength = 0.1 + 0.24 * Math.pow(clamp((1 - ny) * 0.5, 0, 1), 1.6);
      const outerRim = Math.exp(-Math.pow((dOuter + 0.013) / 0.011, 2)) * rimStrength;
      r += 215 * outerRim;
      g += 230 * outerRim;
      b += 255 * outerRim;

      // 2. 内嵌 OLED 终端屏幕区域
      const dInner = sdSquircle(nx, ny, innerHalf, 4.6);
      const innerAlpha = clamp(0.5 - dInner / (aa * 2), 0, 1);

      // 屏幕凹槽内边缘微弱高光（下沿反光）与暗边（上沿阴影）
      const bezelGlow = Math.exp(-Math.pow((dInner - 0.008) / 0.009, 2));
      if (bezelGlow > 0.01 && innerAlpha < 0.99) {
        const lowerLight = smoothstep(-0.2, 0.8, ny) * 0.14;
        const upperShade = smoothstep(0.2, -0.8, ny) * 0.35;
        r = r * (1 - upperShade * bezelGlow) + 190 * lowerLight * bezelGlow;
        g = g * (1 - upperShade * bezelGlow) + 210 * lowerLight * bezelGlow;
        b = b * (1 - upperShade * bezelGlow) + 235 * lowerLight * bezelGlow;
      }

      if (innerAlpha > 0) {
        // 深邃碳黑终端屏幕底色
        const scrT = clamp((ny + innerHalf) / (innerHalf * 2), 0, 1);
        let sr = mix(17, 9, scrT);
        let sg = mix(22, 12, scrT);
        let sb = mix(30, 18, scrT);

        // 微妙扫描线纹理（仅在屏幕内容区极轻呈现，增加终端硬件质感）
        const scan = 0.5 + 0.5 * Math.sin(y * (Math.PI * 2 / (size / 64)));
        sr += scan * 1.1;
        sg += scan * 1.6;
        sb += scan * 1.5;

        // 顶部终端窗口标题栏区域
        const barY = -0.455;
        const inHeader = smoothstep(barY + aa * 1.5, barY - aa * 1.5, ny);
        if (inHeader > 0) {
          [sr, sg, sb] = blendOver(sr, sg, sb, 34, 40, 52, inHeader * 0.72);
        }
        // 标题栏底部分割线
        const sep = Math.exp(-Math.pow((ny - barY) / (aa * 1.4), 2));
        [sr, sg, sb] = blendOver(sr, sg, sb, 130, 150, 185, sep * 0.18);

        // 标题栏左上角 macOS 三色窗口控制点
        const dotY = -0.585;
        const dotR = 0.037;
        const dots = [
          [-0.515, 255, 95, 87],   // 红
          [-0.402, 254, 188, 46],  // 黄
          [-0.289, 40, 200, 64],   // 绿
        ];
        for (const [dx, dr, dg, db] of dots) {
          const dd = Math.hypot(nx - dx, ny - dotY) - dotR;
          const da = clamp(0.5 - dd / (aa * 2), 0, 1);
          if (da > 0) {
            // 小圆点顶部微高光
            const hi = Math.exp(-Math.pow(Math.hypot(nx - dx, ny - (dotY - dotR * 0.35)) / (dotR * 0.7), 2)) * 0.25;
            [sr, sg, sb] = blendOver(sr, sg, sb, Math.min(255, dr + 255 * hi), Math.min(255, dg + 255 * hi), Math.min(255, db + 255 * hi), da);
          }
        }

        // 标题栏右侧极简终端会话指示胶囊（低对比度，不抢主体）
        const dPill = sdRoundedRect(nx, ny, 0.36, dotY, 0.19, 0.028, 0.028);
        const pillA = clamp(0.5 - dPill / (aa * 2), 0, 1);
        if (pillA > 0) {
          [sr, sg, sb] = blendOver(sr, sg, sb, 148, 163, 184, pillA * 0.16);
        }

        // 3. 发光终端提示符 `>` 与实心终端光标块 `_`
        // 中心略偏下（避开顶部标题栏）
        const cy = 0.08;
        const dChevTop = sdSegment(nx, ny, -0.45, cy - 0.235, -0.11, cy);
        const dChevBot = sdSegment(nx, ny, -0.11, cy, -0.45, cy + 0.235);
        const dChevron = Math.min(dChevTop, dChevBot) - 0.072;

        // 终端光标横杠（微圆角发光胶囊）
        const dCursor = sdRoundedRect(nx, ny, 0.255, cy + 0.19, 0.215, 0.064, 0.036);

        // 柔和的终端荧光绿/青色漫反射光晕（洒在深色玻璃屏幕上）
        const glowChev = Math.exp(-Math.max(0, dChevron) * 5.2) * 0.34;
        const glowCurs = Math.exp(-Math.max(0, dCursor) * 5.0) * 0.3;
        const ambientGlow = Math.exp(-Math.hypot((nx + 0.05) * 0.9, (ny - cy) * 1.1) * 2.4) * 0.16;

        sr += 20 * (glowChev + ambientGlow) + 30 * glowCurs;
        sg += 225 * (glowChev + ambientGlow * 0.95) + 210 * glowCurs;
        sb += 160 * (glowChev + ambientGlow * 0.85) + 245 * glowCurs;

        // 底部两行极淡终端命令装饰条（增强“终端窗口”氛围，不影响小尺寸清晰度）
        const dLine1 = sdRoundedRect(nx, ny, -0.17, 0.495, 0.28, 0.022, 0.022);
        const dLine2 = sdRoundedRect(nx, ny, 0.28, 0.495, 0.12, 0.022, 0.022);
        const lineA = Math.max(clamp(0.5 - dLine1 / (aa * 2), 0, 1), clamp(0.5 - dLine2 / (aa * 2), 0, 1));
        if (lineA > 0) {
          [sr, sg, sb] = blendOver(sr, sg, sb, 52, 211, 153, lineA * 0.14);
        }

        // 绘制锐利发光 `>` 提示符（平滑渐变 + 柔和顶光）
        const chevA = clamp(0.5 - dChevron / (aa * 2), 0, 1);
        if (chevA > 0) {
          const ct = clamp((nx + 0.5) / 0.45, 0, 1);
          const sheen = smoothstep(0.32, -0.28, ny - cy) * 0.2;
          const core = smoothstep(-0.01, -0.055, dChevron) * 0.14;
          const cr = mix(46, 36, ct) + 170 * (sheen + core);
          const cg = mix(244, 226, ct) + 90 * (sheen + core);
          const cb = mix(154, 232, ct) + 130 * (sheen + core);
          [sr, sg, sb] = blendOver(sr, sg, sb, Math.min(255, cr), Math.min(255, cg), Math.min(255, cb), chevA);
        }

        // 绘制锐利发光 `_` 终端光标
        const cursA = clamp(0.5 - dCursor / (aa * 2), 0, 1);
        if (cursA > 0) {
          const ut = clamp((nx - 0.04) / 0.44, 0, 1);
          const topSheen = smoothstep(0.05, -0.05, ny - (cy + 0.19)) * 0.22;
          const ur = mix(45, 118, ut) + 160 * topSheen;
          const ug = mix(232, 222, ut) + 130 * topSheen;
          const ub = mix(212, 255, ut) + 120 * topSheen;
          [sr, sg, sb] = blendOver(sr, sg, sb, Math.min(255, ur), Math.min(255, ug), Math.min(255, ub), cursA);
        }

        // 屏幕左上方斜向微弱玻璃反光
        const glassSheen = smoothstep(0.15, -0.95, nx * 0.55 + ny * 0.85) * 0.065;
        sr += 210 * glassSheen;
        sg += 230 * glassSheen;
        sb += 255 * glassSheen;

        [r, g, b] = blendOver(r, g, b, sr, sg, sb, innerAlpha);
      }

      rgba[idx] = clamp(Math.round(r), 0, 255);
      rgba[idx + 1] = clamp(Math.round(g), 0, 255);
      rgba[idx + 2] = clamp(Math.round(b), 0, 255);
      rgba[idx + 3] = Math.round(outerAlpha * 255);
    }
  }
  return { width: size, height: size, rgba };
}

function resizeRgba(src, dstSize) {
  const { width: sw, height: sh, rgba } = src;
  const out = Buffer.alloc(dstSize * dstSize * 4);
  const scaleX = sw / dstSize;
  const scaleY = sh / dstSize;
  for (let y = 0; y < dstSize; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * scaleX)));
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          const al = rgba[i + 3] / 255;
          r += rgba[i] * al;
          g += rgba[i + 1] * al;
          b += rgba[i + 2] * al;
          a += al;
          cnt++;
        }
      }
      const di = (y * dstSize + x) * 4;
      const avgA = a / cnt;
      if (avgA > 1e-5) {
        out[di] = Math.min(255, Math.round(r / a));
        out[di + 1] = Math.min(255, Math.round(g / a));
        out[di + 2] = Math.min(255, Math.round(b / a));
        out[di + 3] = Math.min(255, Math.round(avgA * 255));
      }
    }
  }
  return encodePng(dstSize, dstSize, out);
}

function encodeIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  for (let i = 0; i < count; i++) {
    const { size, buf } = pngBuffers[i];
    const base = 6 + i * 16;
    header[base] = size >= 256 ? 0 : size;
    header[base + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(buf.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += buf.length;
  }
  return Buffer.concat([header, ...pngBuffers.map((p) => p.buf)]);
}

function encodeIcns(entries) {
  const chunks = entries.map(([type, buf]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 4, 'ascii');
    h.writeUInt32BE(8 + buf.length, 4);
    return Buffer.concat([h, buf]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

const master = renderTerminalIcon(1024);

const p16 = resizeRgba(master, 16);
const p32 = resizeRgba(master, 32);
const p64 = resizeRgba(master, 64);
const p128 = resizeRgba(master, 128);
const p256 = resizeRgba(master, 256);
const p512 = resizeRgba(master, 512);
const p1024 = encodePng(master.width, master.height, master.rgba);

fs.writeFileSync(path.join(assetsDir, 'icon-source.png'), p1024);
fs.writeFileSync(path.join(iconsDir, '32x32.png'), p32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), p128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), p256);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), p512);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), encodeIco([{ size: 32, buf: p32 }, { size: 128, buf: p128 }, { size: 256, buf: p256 }]));
fs.writeFileSync(
  path.join(iconsDir, 'icon.icns'),
  encodeIcns([
    ['icp4', p16],
    ['icp5', p32],
    ['icp6', p64],
    ['ic07', p128],
    ['ic08', p256],
    ['ic09', p512],
    ['ic10', p1024],
  ]),
);
fs.writeFileSync(path.join(publicDir, 'icon.png'), p256);

console.log('Generated Terminal-style MyCurl icons');
