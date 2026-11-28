import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import type { Id } from '@meetless/core';
import { newId, useApp } from '@/state';
import { BLOB_MEDIA_TYPE, fileRequest, filePlan, fileText, importErrorKey, importOutcome } from '../model/paste';
import type { Target } from '../../chat/model/target';

type Asset = DocumentPicker.DocumentPickerAsset;

async function readText(a: Asset): Promise<string> {
  if (Platform.OS === 'web' && a.file) return a.file.text();
  return new FsFile(a.uri).text();
}

async function readBytes(a: Asset): Promise<Uint8Array> {
  if (Platform.OS === 'web' && a.file) return new Uint8Array(await a.file.arrayBuffer());
  return new FsFile(a.uri).bytes();
}

/**
 * Pick a file (md, txt, docx, pdf) and import it into the project: md and txt as text, docx and
 * pdf as an uploaded blob. Resolves to where the new input opens, or null (cancelled or failed,
 * with the notice already shown).
 */
export function useFileImport(): (a: { projectId: Id; priv: boolean; from?: string }) => Promise<{ open: Target; extracts: number } | null> {
  const { live, t, today, api, bridge, notify, errorText } = useApp();
  const fail = (code: string) => {
    const k = importErrorKey(code);
    notify('error', k ? t(k) : errorText(code));
    return null;
  };
  return async ({ projectId, priv, from = '' }) => {
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const asset = picked && !picked.canceled ? picked.assets[0] : undefined;
    if (!asset) return null;
    const plan = filePlan(asset.name, asset.size ?? asset.file?.size ?? 1);
    if (!plan.ok) return fail(plan.code);
    let text: string | null = null;
    let blobHash: string | null = null;
    try {
      if (plan.readAsText) {
        text = fileText(await readText(asset));
        if (text === null) return fail('EMPTY_FILE');
      } else {
        const up = await bridge.uploadBlob(await readBytes(asset), BLOB_MEDIA_TYPE[plan.kind as 'docx' | 'pdf']);
        if (!up.ok) return fail(up.code);
        blobHash = up.hash;
      }
    } catch {
      notify('error', t('ch.fileFailed'));
      return null;
    }
    const req = fileRequest(live, projectId, { kind: plan.kind, title: plan.title, text, blobHash, from, priv, today, inputId: newId('in') });
    const res = await api('inputs.import', req).catch(() => null);
    if (!res) {
      notify('error', t('ch.fileFailed'));
      return null;
    }
    const out = importOutcome(res, projectId);
    if ('code' in out) return fail(out.code);
    return out;
  };
}
