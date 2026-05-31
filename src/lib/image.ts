/**
 * Image loading utilities for the photo editor.
 * Handles File objects and URLs, always returns an object URL + native dimensions.
 */

export interface LoadedImage {
  url: string; // object URL or original URL (for external)
  width: number;
  height: number;
  name?: string;
}

/**
 * Load a File (from input or drop) and return a safe object URL + dimensions.
 * The caller is responsible for managing URL lifetime if replacing images frequently.
 */
export function loadFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        name: file.name,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Load an external or data URL. Does not create a new object URL.
 * Useful for demo images or pasted URLs.
 */
export function loadUrl(url: string, name?: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve({
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        name,
      });
    };
    img.onerror = () => reject(new Error(`Failed to load image from URL`));
    img.src = url;
  });
}

/**
 * Revoke an object URL if it looks like one we created (blob:).
 * Safe to call on external URLs.
 */
export function maybeRevoke(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
