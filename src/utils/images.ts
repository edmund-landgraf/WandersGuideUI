export async function getShapeIcon(content: string) {
  const res = await fetch(`https://api.dicebear.com/7.x/shapes/svg?seed=${content}`);
  return res.ok ? await res.text() : '';
}

export async function getRingIcon(content: string) {
  // await sleep(100); // to avoid rate limiting
  const res = await fetch(`https://api.dicebear.com/7.x/rings/svg?seed=${content}`);
  return res.ok ? await res.text() : '';
}

function imageFileUrl(url: string): boolean {
  try {
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(decodeURIComponent(new URL(url).pathname));
  } catch {
    return /\.(png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(url);
  }
}

function loadImage(url: string, referrerPolicy: ReferrerPolicy): Promise<boolean> {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.referrerPolicy = referrerPolicy;
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export async function isValidImage(url?: string): Promise<boolean> {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (await loadImage(trimmed, 'no-referrer')) return true;
  if (await loadImage(trimmed, '')) return true;
  return imageFileUrl(trimmed);
}

export async function preloadImage(url?: string | null): Promise<void> {
  if (!url || !url.trim()) return;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
}

