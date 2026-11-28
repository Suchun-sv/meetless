import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File as FsFile } from 'expo-file-system';
import { useApp } from '@/state';
import { addMaterial, type AddSource, type ApiFn } from '../model/api';
import { watchMaterial } from '../model/watch';
import { recognizeText } from './ocr';

/** The largest file the inbox takes (same as an input import). */
export const MAX_BYTES = 20 * 1024 * 1024;

const DOC_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'image/*'];

const mediaTypeOf = (name: string, given?: string | null): string => {
  if (given) return given;
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return (
    { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', webp: 'image/webp' } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
};

async function bytesOf(uri: string, file?: File | null): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    if (file) return new Uint8Array(await file.arrayBuffer());
    return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  }
  return new FsFile(uri).bytes();
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Everything that brings material into the inbox: pasted or typed text, a file, a photo, an album
 * image, a pasted image (the clipboard bar), and files dropped on the page (web and desktop). Files
 * and images upload as blobs first; on iOS a photo's text is recognised on the device and sent along.
 * A single material opens its page (B2) right away; several dropped at once stay on the list.
 */
export function useInboxInput() {
  const { t, api, bridge, notify, errorText } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const call = api as unknown as ApiFn;

  const open = useCallback((id: string) => router.push(`/inbox/${encodeURIComponent(id)}` as Href), [router]);
  const fail = useCallback((code: string) => notify('error', code === 'TOO_LARGE' ? t('inb.tooLarge') : code === 'INBOX_UNAVAILABLE' ? t('inb.unavailable') : errorText(code)), [notify, t, errorText]);

  /** Uploads bytes and adds them as one material. Resolves to its id, or null (the notice is shown). */
  const addBytes = useCallback(
    async (source: AddSource, bytes: Uint8Array, name: string, mediaType: string, ocrText?: string | null): Promise<string | null> => {
      if (bytes.length > MAX_BYTES) {
        fail('TOO_LARGE');
        return null;
      }
      const up = await bridge.uploadBlob(bytes, mediaType);
      if (!up.ok) {
        fail(up.code);
        return null;
      }
      try {
        const r = await addMaterial(call, { source, blobHash: up.hash, mediaType, fileName: name, ...(ocrText ? { ocrText } : {}) });
        watchMaterial(r.id, name);
        return r.id;
      } catch (e) {
        fail((e as { code?: string }).code ?? 'ERROR');
        return null;
      }
    },
    [bridge, call, fail],
  );

  const run = useCallback(
    async (f: () => Promise<string | null>) => {
      if (busy) return;
      setBusy(true);
      try {
        const id = await f();
        if (id) open(id);
      } finally {
        setBusy(false);
      }
    },
    [busy, open],
  );

  const sendText = useCallback(
    (text: string) =>
      run(async () => {
        if (!text.trim()) return null;
        try {
          const r = await addMaterial(call, { source: 'paste', text });
          watchMaterial(r.id, text.split('\n')[0]!.slice(0, 30));
          return r.id;
        } catch (e) {
          fail((e as { code?: string }).code ?? 'ERROR');
          return null;
        }
      }),
    [run, call, fail],
  );

  const pickFile = useCallback(
    () =>
      run(async () => {
        const r = await DocumentPicker.getDocumentAsync({ type: Platform.OS === 'web' ? '*/*' : DOC_TYPES, copyToCacheDirectory: true }).catch(() => null);
        const a = r && !r.canceled ? r.assets[0] : undefined;
        if (!a) return null;
        const mt = mediaTypeOf(a.name, a.mimeType);
        const bytes = await bytesOf(a.uri, a.file);
        const ocr = mt.startsWith('image/') ? await recognizeText({ uri: a.uri }) : null;
        return addBytes('file', bytes, a.name, mt, ocr);
      }),
    [run, addBytes],
  );

  const image = useCallback(
    (source: 'camera' | 'album') =>
      run(async () => {
        const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          notify('error', t(source === 'camera' ? 'inb.noCamera' : 'inb.noPhotos'));
          return null;
        }
        const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85 };
        const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts).catch(() => null) : await ImagePicker.launchImageLibraryAsync(opts).catch(() => null);
        const a = r && !r.canceled ? r.assets[0] : undefined;
        if (!a) return null;
        const name = a.fileName ?? (source === 'camera' ? 'photo.jpg' : 'image.jpg');
        const mt = a.mimeType ?? mediaTypeOf(name);
        const bytes = await bytesOf(a.uri, (a as { file?: File }).file);
        const ocr = await recognizeText({ uri: a.uri });
        return addBytes(source, bytes, name, mt, ocr);
      }),
    [run, addBytes, notify, t],
  );

  /** An image from the clipboard bar: treated like an album pick (OCR on iOS, then upload). */
  const pasteImage = useCallback(
    (base64: string) =>
      run(async () => {
        const ocr = await recognizeText({ base64 });
        return addBytes('album', fromBase64(base64), 'pasted.png', 'image/png', ocr);
      }),
    [run, addBytes],
  );

  /** Files dropped on the page (web and desktop): one material each; one file opens its page. */
  const dropFiles = useCallback(
    async (files: File[]) => {
      if (busy || files.length === 0) return;
      setBusy(true);
      try {
        const ids: string[] = [];
        for (const f of files) {
          const id = await addBytes('drop', new Uint8Array(await f.arrayBuffer()), f.name, mediaTypeOf(f.name, f.type));
          if (id) ids.push(id);
        }
        if (ids.length === 1) open(ids[0]!);
        else if (ids.length > 1) notify('info', t('inb.dropped', { n: ids.length }));
      } finally {
        setBusy(false);
      }
    },
    [busy, addBytes, open, notify, t],
  );

  return { busy, sendText, pickFile, takePhoto: () => image('camera'), pickImage: () => image('album'), pasteImage, dropFiles };
}
