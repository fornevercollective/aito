/**
 * Lightweight EXIF parser focused on the tags that matter for a pro photo editor.
 * No external dependencies. Handles the common JPEG APP1 (Exif) segment.
 *
 * Returns a flat object with the fields we display in the Inspector.
 */

export interface ExifData {
  make?: string;
  model?: string;
  lensModel?: string;
  dateTimeOriginal?: string;
  exposureTime?: string;   // e.g. "1/125"
  fNumber?: string;        // e.g. "f/2.8"
  iso?: number;
  focalLength?: string;    // e.g. "85mm"
  orientation?: number;
  software?: string;
  [key: string]: any;
}

const TAG_MAP: Record<number, string> = {
  0x010f: "make",
  0x0110: "model",
  0xa434: "lensModel",
  0x9003: "dateTimeOriginal",
  0x829a: "exposureTime",
  0x829d: "fNumber",
  0x8827: "iso",
  0x920a: "focalLength",
  0x0112: "orientation",
  0x0131: "software",
};

function readUint16(view: DataView, offset: number, little: boolean): number {
  return little ? view.getUint16(offset, true) : view.getUint16(offset, false);
}

function readUint32(view: DataView, offset: number, little: boolean): number {
  return little ? view.getUint32(offset, true) : view.getUint32(offset, false);
}

function parseRational(view: DataView, offset: number, little: boolean): number {
  const num = readUint32(view, offset, little);
  const den = readUint32(view, offset + 4, little);
  return den === 0 ? 0 : num / den;
}

export async function extractExif(fileOrDataUrl: File | string): Promise<ExifData | null> {
  try {
    let buffer: ArrayBuffer;

    if (typeof fileOrDataUrl === "string") {
      // data: URL or blob URL — fetch as array buffer
      const res = await fetch(fileOrDataUrl);
      buffer = await res.arrayBuffer();
    } else {
      buffer = await fileOrDataUrl.arrayBuffer();
    }

    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return null; // not JPEG

    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset);
      if (marker === 0xffda) break; // SOS — image data starts
      if (marker === 0xffe1) {
        // APP1 — possible EXIF
        view.getUint16(offset + 2); // segment length (not currently needed)
        const exifHeader = offset + 4;

        // Check for "Exif\0\0"
        if (
          view.getUint32(exifHeader) === 0x45786966 &&
          view.getUint16(exifHeader + 4) === 0x0000
        ) {
          const tiffOffset = exifHeader + 6;
          const little = view.getUint16(tiffOffset + 2) === 0x4949; // "II"
          const ifd0Offset = tiffOffset + readUint32(view, tiffOffset + 4, little);

          const entries = readUint16(view, ifd0Offset, little);
          const exif: ExifData = {};

          for (let i = 0; i < entries; i++) {
            const entryOffset = ifd0Offset + 2 + i * 12;
            const tag = readUint16(view, entryOffset, little);
            const type = readUint16(view, entryOffset + 2, little);
            const count = readUint32(view, entryOffset + 4, little);
            const valueOffset = entryOffset + 8;

            const name = TAG_MAP[tag];
            if (!name) continue;

            let val: any;

            if (type === 2) {
              // ASCII
              const strOffset = count > 4 ? tiffOffset + readUint32(view, valueOffset, little) : valueOffset;
              let str = "";
              for (let j = 0; j < count - 1; j++) {
                str += String.fromCharCode(view.getUint8(strOffset + j));
              }
              val = str.trim();
            } else if (type === 3) {
              // SHORT
              val = readUint16(view, count > 2 ? tiffOffset + readUint32(view, valueOffset, little) : valueOffset, little);
            } else if (type === 4) {
              // LONG
              val = readUint32(view, count > 1 ? tiffOffset + readUint32(view, valueOffset, little) : valueOffset, little);
            } else if (type === 5) {
              // RATIONAL
              const ratOffset = count > 1 ? tiffOffset + readUint32(view, valueOffset, little) : valueOffset;
              const num = parseRational(view, ratOffset, little);

              if (name === "exposureTime") {
                val = num >= 1 ? num.toFixed(1) : `1/${Math.round(1 / num)}`;
              } else if (name === "fNumber") {
                val = `f/${num.toFixed(1)}`;
              } else if (name === "focalLength") {
                val = `${Math.round(num)}mm`;
              } else {
                val = num;
              }
            } else if (type === 7 && name === "iso") {
              // sometimes ISO is in a weird place
              val = readUint16(view, valueOffset, little);
            }

            if (val !== undefined) {
              (exif as any)[name] = val;
            }

            // Special case: ISO is often in a sub-IFD or directly as SHORT
            if (tag === 0x8827 && type === 3) {
              exif.iso = readUint16(view, valueOffset, little);
            }
          }

          // Also try to read ExifIFD (tag 0x8769) for more accurate date/exposure
          // (kept simple for now — the above covers 90% of what we need)

          return Object.keys(exif).length > 0 ? exif : null;
        }
      }

      offset += 2 + view.getUint16(offset + 2);
    }
  } catch (e) {
    // Silently fail — EXIF is nice-to-have
    console.warn("[exif] parse failed", e);
  }
  return null;
}

export function formatExifForDisplay(exif: ExifData | null): Array<{ label: string; value: string }> {
  if (!exif) return [];

  const rows: Array<{ label: string; value: string }> = [];

  if (exif.make || exif.model) {
    rows.push({ label: "Camera", value: [exif.make, exif.model].filter(Boolean).join(" ") });
  }
  if (exif.lensModel) {
    rows.push({ label: "Lens", value: exif.lensModel });
  }
  if (exif.exposureTime) {
    rows.push({ label: "Shutter", value: exif.exposureTime });
  }
  if (exif.fNumber) {
    rows.push({ label: "Aperture", value: exif.fNumber });
  }
  if (exif.iso) {
    rows.push({ label: "ISO", value: String(exif.iso) });
  }
  if (exif.focalLength) {
    rows.push({ label: "Focal", value: exif.focalLength });
  }
  if (exif.dateTimeOriginal) {
    rows.push({ label: "Date", value: exif.dateTimeOriginal.replace(/:/g, "-").replace(" ", " ") });
  }

  return rows;
}
