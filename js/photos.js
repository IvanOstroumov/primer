// Сжатие фото: максимум 1080 px по длинной стороне, JPEG.
export async function compressImage(file, max = 1080, quality = 0.82) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), hgt = Math.round(bmp.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export const dataURLToBlob = async u => (await fetch(u)).blob();
