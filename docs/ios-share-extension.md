# iOS share extension (planned, not built)

Status, 2026-11-28: deferred. The iOS app has only run on the simulator, and the one open question
(does a free Personal Team accept the app group on a real device?) can only be answered by a
real-device install. Until then the 「需求」 page hides its 「在其他 App 里点「分享」」 hint and offers
the clipboard fallback instead (`ClipboardOffer` in `apps/app/src/components/ui`).

## Why it should work on free signing
- Apple's capability table (Supported capabilities (iOS), developer.apple.com/help/account) marks
  App Groups and Keychain Sharing as available to the free "Apple Developer" account (Personal Team).
- Tools that register app groups for free teams (xtool, AltStore) report a limit of one app group per
  app. One is enough: the app and the extension share it.
- Free provisioning profiles expire after 7 days, like the app's own; reinstall weekly.

## Plan
1. Add the Expo config plugin `expo-share-intent` (MIT) in `apps/app/app.config.js`, with the single
   app group `group.app.meetless.mobile` on both the app and the extension.
2. The extension accepts text, URLs, images, PDF and docx.
3. Upload from the extension itself, so the material arrives even if the app is never opened:
   - put the session in a shared keychain access group (`$(AppIdentifierPrefix)app.meetless.mobile`)
     instead of the app-only item in `apps/app/src/bridge/token-store.ts`;
   - the extension reads the server URL and token from it and calls `POST /v1/inbox` (multipart:
     text, file or image, with on-device OCR text when it is an image).
4. If the upload fails (offline, no session), write the item into the app-group container; the app
   picks queued items up when it next comes to the foreground and sends them through the inbox.
5. Show the B1 hint line again once a real-device install has proved the group.

## Check on a real device
- In Xcode, sign the app and the extension with the user's Personal Team; the app group must be
  accepted at provisioning (otherwise Xcode reports the capability is not available for the team).
- Share a photo and a PDF from Photos and Files; both should appear under 「最近收进来的」.

## Fallback (built)
When the 「需求」 page comes to the foreground and the clipboard has text or an image, a light bar
offers 「粘贴刚复制的内容？」. Detection only checks `hasStringAsync`/`hasImageAsync`; the clipboard is
read only after the tap (iOS shows its paste prompt then).
