import { Platform, Share } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

export interface PickedFile {
  name: string;
  size: number | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Opens the system file picker; null when cancelled. */
export async function pickFile(types: readonly string[] | null): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: types ? [...types] : '*/*', copyToCacheDirectory: true, multiple: false });
  if (r.canceled) return null;
  const a = r.assets[0];
  if (!a) return null;
  const webFile = (a as { file?: Blob }).file;
  return {
    name: a.name,
    size: a.size ?? null,
    arrayBuffer: () => (webFile ? webFile.arrayBuffer() : fetch(a.uri).then((x) => x.arrayBuffer())),
  };
}

/** Saves bytes as a file: a download on the web, the share sheet on iOS. */
export async function saveBytes(bytes: Uint8Array, filename: string, mediaType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
    try {
      const el = document.createElement('a');
      el.href = url;
      el.download = filename;
      el.rel = 'noopener';
      document.body.appendChild(el);
      el.click();
      el.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return;
  }
  const f = new File(Paths.cache, filename.replace(/[/\\]/g, '_'));
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  await Share.share({ url: f.uri, title: filename });
}
