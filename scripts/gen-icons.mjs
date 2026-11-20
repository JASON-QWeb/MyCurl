#!/usr/bin/env node
/**
 * 从 assets/icon-source.png 生成全套 MyCurl 图标（应用 macOS Squircle 圆角蒙版 + 微高光边框）：
 *  - src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.icns, icon.ico}
 *  - public/icon.png（供前端 favicon 与顶栏品牌图标使用）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets', 'icon-source.png');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const publicDir = path.join(root, 'public');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// ---- PNG 编解码 ----
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
  ihdr[9] = 6; // RGBA
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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`Unsupported PNG colorType: ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  const recon = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowOff = y * stride;
    const rawOff = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const val = raw[rawOff + x];
      const left = x >= bpp ? recon[rowOff + x - bpp] : 0;
      const up = y > 0 ? recon[rowOff - stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? recon[rowOff - stride + x - bpp] : 0;
      let out = val;
      if (filter === 1) out = (val + left) & 0xff;
      else if (filter === 2) out = (val + up) & 0xff;
      else if (filter === 3) out = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) out = (val + paeth(left, up, upLeft)) & 0xff;
      recon[rowOff + x] = out;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = recon[i * bpp];
    rgba[i * 4 + 1] = recon[i * bpp + 1];
    rgba[i * 4 + 2] = recon[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? recon[i * bpp + 3] : 255;
  }
  return { width, height, rgba };
}

// macOS Apple HIG 风格 Squircle 蒙版（内缩约 9% 留白 + 柔和玻璃边缘高光）
function applyMacSquircle(src) {
  const { width: w, height: h, rgba } = src;
  const out = Buffer.alloc(w * h * 4);
  const half = 0.825; // Apple HIG 824/1024 视觉比例
  const p = 4.8; // 超椭圆曲率
  const aa = 2.0 / w;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = ((y + 0.5) / h) * 2 - 1;

      // 从原图略微放大采样（适配 82.5% 图标内框，使主体符号更饱满）
      const sx = Math.max(0, Math.min(w - 1, Math.round((((nx / half) * 0.94 + 1) * 0.5) * (w - 1))));
      const sy = Math.max(0, Math.min(h - 1, Math.round((((ny / half) * 0.94 + 1) * 0.5) * (h - 1))));

      const rNorm = Math.pow(Math.pow(Math.abs(nx) / half, p) + Math.pow(Math.abs(ny) / half, p), 1 / p);
      const dist = (rNorm - 1.0) * half;

      // 外侧柔光投影（底部偏移）
      const rShadow = Math.pow(
        Math.pow(Math.abs(nx) / (half + 0.01), p) + Math.pow(Math.abs(ny - 0.022) / (half + 0.01), p),
        1 / p,
      );
      const shadowDist = (rShadow - 1.0) * half;

      const idx = (y * w + x) * 4;
      const alpha = Math.max(0, Math.min(1, 0.5 - dist / (aa * 2)));

      if (alpha > 0) {
        const si = (sy * w + sx) * 4;
        let r = rgba[si];
        let g = rgba[si + 1];
        let b = rgba[si + 2];

        // 精细玻璃高光内描边（由上到下平滑过渡，无接缝）
        const rimIntensity = 0.08 + 0.16 * Math.pow(Math.max(0, (1 - ny) * 0.5), 1.4);
        const rim = Math.exp(-Math.pow((dist + 0.012) / 0.01, 2)) * rimIntensity;
        r = Math.min(255, r + 210 * rim);
        g = Math.min(255, g + 235 * rim);
        b = Math.min(255, b + 255 * rim);

        out[idx] = Math.round(r);
        out[idx + 1] = Math.round(g);
        out[idx + 2] = Math.round(b);
        out[idx + 3] = Math.round(alpha * 255);
      } else if (shadowDist < 0.09) {
        const sAlpha = Math.max(0, 1 - Math.max(0, shadowDist) / 0.09);
        const sa = Math.pow(sAlpha, 2.2) * 0.28;
        out[idx] = 0;
        out[idx + 1] = 0;
        out[idx + 2] = 0;
        out[idx + 3] = Math.round(sa * 255);
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

// 高质量区域平均缩放（带预乘 Alpha，边缘无黑边）
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

const rawSrc = decodePng(fs.readFileSync(sourcePath));
const master = applyMacSquircle(rawSrc);

const p16 = resizeRgba(master, 16);
const p32 = resizeRgba(master, 32);
const p64 = resizeRgba(master, 64);
const p128 = resizeRgba(master, 128);
const p256 = resizeRgba(master, 256);
const p512 = resizeRgba(master, 512);
const p1024 = encodePng(master.width, master.height, master.rgba);

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

console.log('Generated new MyCurl icons from assets/icon-source.png');
