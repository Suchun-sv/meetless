import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusComposer, focusPending, registerComposer } from '../../src/renderer/chat/focus';

/** A stand-in for the composer's textarea: only `focus()` is used. */
function fakeEl() {
  return { focus: vi.fn() } as unknown as HTMLTextAreaElement & { focus: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  // Leave no element or pending request behind for the next test.
  registerComposer(fakeEl());
  registerComposer(null);
});

describe('chat/focus', () => {
  it('a composer that registers after focusComposer() takes the focus (side-new routes, then the new page mounts)', () => {
    const oldEl = fakeEl();
    const newEl = fakeEl();
    registerComposer(oldEl);
    focusComposer(); // still the old page: go() only renders after the click handler returns
    expect(focusPending()).toBe(true);
    registerComposer(null); // the old page unmounts
    registerComposer(newEl); // the new page's composer mounts
    expect(newEl.focus).toHaveBeenCalledTimes(1);
    expect(focusPending()).toBe(false);
  });

  it('with no composer mounted, the request waits for the next one', () => {
    registerComposer(null);
    focusComposer();
    const el = fakeEl();
    registerComposer(el);
    expect(el.focus).toHaveBeenCalledTimes(1);
  });

  it('the request is used once: a later registration does not steal focus', () => {
    const first = fakeEl();
    const later = fakeEl();
    registerComposer(null);
    focusComposer();
    registerComposer(first);
    registerComposer(later);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(later.focus).not.toHaveBeenCalled();
  });

  it('with no request, registering never focuses', () => {
    const el = fakeEl();
    registerComposer(el);
    expect(el.focus).not.toHaveBeenCalled();
  });

  it('focuses a composer that is already mounted at once', () => {
    const el = fakeEl();
    registerComposer(el);
    focusComposer();
    expect(el.focus).toHaveBeenCalledTimes(1);
  });
});
