const EXPORT_DIRECTORY_ID = 'phase1-character-export';

export function canPickExportDirectory() {
  return typeof window.showDirectoryPicker === 'function';
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let crc = n;
  for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  CRC_TABLE[n] = crc >>> 0;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Uncompressed zip. Firefox has no folder picker, so Export all downloads this instead. */
export function zipStored(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.data as BlobPart);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  parts.push(...centrals, end);
  return new Blob(parts, { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = window.showDirectoryPicker;
  if (!picker) {
    throw new Error('This browser cannot export to a folder. Use Chrome or Edge.');
  }
  try {
    return await picker.call(window, { id: EXPORT_DIRECTORY_ID, mode: 'readwrite' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function openExportDirectory(directory: FileSystemDirectoryHandle) {
  const openFiles = window.showOpenFilePicker;
  try {
    if (openFiles) {
      await openFiles.call(window, { id: EXPORT_DIRECTORY_ID, startIn: directory, multiple: true });
      return;
    }
    const picker = window.showDirectoryPicker;
    if (!picker) throw new Error('This browser cannot open the folder.');
    await picker.call(window, { id: EXPORT_DIRECTORY_ID, mode: 'read', startIn: directory });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw error;
  }
}

export async function writeFileToDirectory(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: BlobPart | Uint8Array,
  type: string,
) {
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable({ keepExistingData: false });
  await writable.write(new Blob([data as BlobPart], { type }));
  await writable.close();
}
