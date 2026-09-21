/** Asset URLs use a different origin in the desktop webview. Set CORS BEFORE src. */
export function canvasImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Cannot load the local Roto frame or mask. Check its cache and file access.'));
    image.src = url;
  });
}
