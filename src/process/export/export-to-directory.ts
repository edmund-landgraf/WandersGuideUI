const EXPORT_DIRECTORY_ID = 'phase1-character-export';

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
