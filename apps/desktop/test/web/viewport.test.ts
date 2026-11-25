import { describe, expect, it } from 'vitest';
import { installKeyboardInset, keyboardInset } from '../../src/renderer/ui/viewport';

describe('keyboardInset', () => {
  it('is the part of the layout viewport the visual viewport no longer covers, never negative', () => {
    expect(keyboardInset(null, 844)).toBe(0);
    expect(keyboardInset({ height: 500, offsetTop: 0 }, 844)).toBe(344);
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 844)).toBe(0);
    expect(keyboardInset({ height: 500, offsetTop: 44 }, 844)).toBe(300);
    expect(keyboardInset({ height: 500.4, offsetTop: 0 }, 844)).toBe(344);
  });
});

class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

function fakeWindow(vv: FakeViewport | null) {
  const props = new Map<string, string>();
  const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) };
  const win = { visualViewport: vv, innerHeight: 844, document: { documentElement: { style } } } as unknown as Window;
  return { win, props };
}

describe('installKeyboardInset', () => {
  it('sets --kb-inset on the root on resize and scroll; the remover detaches and drops it', () => {
    const vv = new FakeViewport();
    const { win, props } = fakeWindow(vv);
    const remove = installKeyboardInset(win);
    expect(props.has('--kb-inset')).toBe(false); // no keyboard: no inline style, the token's 0px applies
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    expect(props.get('--kb-inset')).toBe('344px');
    vv.offsetTop = 44;
    vv.dispatchEvent(new Event('scroll'));
    expect(props.get('--kb-inset')).toBe('300px');
    vv.height = 844;
    vv.offsetTop = 0;
    vv.dispatchEvent(new Event('resize'));
    expect(props.has('--kb-inset')).toBe(false);
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    expect(props.get('--kb-inset')).toBe('344px');
    remove();
    expect(props.has('--kb-inset')).toBe(false);
    vv.height = 400;
    vv.dispatchEvent(new Event('resize'));
    expect(props.has('--kb-inset')).toBe(false);
  });

  it('a pinch zoom is not a keyboard, and no visualViewport means nothing to follow', () => {
    const vv = new FakeViewport();
    const { win, props } = fakeWindow(vv);
    installKeyboardInset(win);
    vv.scale = 2;
    vv.height = 422;
    vv.dispatchEvent(new Event('resize'));
    expect(props.has('--kb-inset')).toBe(false);
    const none = fakeWindow(null);
    installKeyboardInset(none.win)();
    expect(none.props.size).toBe(0);
  });
});
