/**
 * What kind of build this is. Shown in the macOS About panel and in smoke
 * output. Every build produced from this repo today is an unsigned
 * development build (ad-hoc signed, not notarized). See docs/MACOS.md.
 */
export const BUILD_CHANNEL = 'unsigned-dev';
export const BUILD_LABEL = 'unsigned dev build';
export const BUILD_NOTE = 'Unsigned development build: ad-hoc signed, not notarized, not for distribution.';
