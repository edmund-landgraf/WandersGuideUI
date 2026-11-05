import { makeRequest } from "@requests/request-manager";
import { artUploadCategory, isSiteRelativeArtPath, publicArtSrc } from "@utils/public-art-url";

export async function uploadImage(file: File, category: string): Promise<string> {
  const result = await makeRequest<{ url: string } | null>('upload-public-file', {
    data: (await toBase64(file)).split(';base64,')[1],
    category: category,
    type: file.type.split('/')[1],
  });
  return result?.url ?? '';
}

/**
 * Site-relative art (`/portraits/...`, `/backgrounds/...`) is fetched from the
 * public asset host and re-uploaded through upload-public-file so the stored
 * value is a public storage URL. If that fetch or upload cannot run, the stored
 * value is the absolute public URL instead. Absolute http(s) links are unchanged.
 */
export async function persistPublicArtUrl(raw: string, category?: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!isSiteRelativeArtPath(trimmed)) return trimmed;
  const absolute = publicArtSrc(trimmed);
  const bucket = category ?? artUploadCategory(trimmed);
  try {
    const response = await fetch(absolute, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return absolute;
    const blob = await response.blob();
    const header = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
    const type = header === 'image/png' || header === 'image/jpeg' || header === 'image/webp' ? header : '';
    if (!type) return absolute;
    const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    const uploaded = await uploadImage(new File([blob], `art.${extension}`, { type }), bucket);
    return uploaded || absolute;
  } catch {
    return absolute;
  }
}

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
