let maskId = 0;
export const nextMaskId = () => `mask-${++maskId}`;
/** Load an image from URL into an HTMLImageElement. */
export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
}
/** Flood-fill style mock segmenter (works offline, no model). */
export async function mockSegmentAt(imageUrl, nx, ny) {
    const img = await loadImage(imageUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    const sx = Math.floor(nx * w);
    const sy = Math.floor(ny * h);
    const si = (sy * w + sx) * 4;
    const tr = data[si];
    const tg = data[si + 1];
    const tb = data[si + 2];
    const mask = new Uint8ClampedArray(w * h * 4);
    const visited = new Uint8Array(w * h);
    const stack = [sx, sy];
    const tol = 42;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let sumX = 0, sumY = 0, count = 0;
    while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        if (x < 0 || y < 0 || x >= w || y >= h)
            continue;
        const i = y * w + x;
        if (visited[i])
            continue;
        const pi = i * 4;
        const dr = Math.abs(data[pi] - tr);
        const dg = Math.abs(data[pi + 1] - tg);
        const db = Math.abs(data[pi + 2] - tb);
        if (dr + dg + db > tol * 3)
            continue;
        visited[i] = 1;
        mask[pi] = 255;
        mask[pi + 1] = 255;
        mask[pi + 2] = 255;
        mask[pi + 3] = 200;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        sumX += x;
        sumY += y;
        count++;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").putImageData(new ImageData(mask, w, h), 0, 0);
    const cx = count ? sumX / count / w : nx;
    const cy = count ? sumY / count / h : ny;
    const stickerUrl = await makeSticker(imageUrl, out.toDataURL("image/png"));
    return {
        id: nextMaskId(),
        label: "mock",
        dataUrl: out.toDataURL("image/png"),
        bbox: {
            x: minX / w,
            y: minY / h,
            w: (maxX - minX + 1) / w,
            h: (maxY - minY + 1) / h,
        },
        centroid: { x: cx, y: cy },
        score: 0.5,
        selected: true,
        stickerUrl,
    };
}
/** Apple-sticker style cutout with soft white rim. */
export async function makeSticker(imageUrl, maskDataUrl) {
    const [img, maskImg] = await Promise.all([
        loadImage(imageUrl),
        loadImage(maskDataUrl),
    ]);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const base = ctx.getImageData(0, 0, w, h);
    const mc = document.createElement("canvas");
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext("2d");
    mctx.drawImage(maskImg, 0, 0, w, h);
    const md = mctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < base.data.length; i += 4) {
        const a = md[i + 3] / 255;
        base.data[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(base, 0, 0);
    // White outline pass (dilate alpha edge).
    ctx.globalCompositeOperation = "destination-over";
    ctx.filter = "blur(6px)";
    ctx.drawImage(c, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    return c.toDataURL("image/png");
}
export function mergeMasks(masks) {
    if (!masks.length)
        return null;
    // Pick highest score for focus; keep all in store separately.
    return masks.reduce((a, b) => (b.score > a.score ? b : a));
}
