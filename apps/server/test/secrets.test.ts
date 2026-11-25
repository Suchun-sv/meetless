import { describe, expect, it } from 'vitest';
import { hashSecret, INVITE_ALPHABET, newInviteCode, newToken, newUserId, normalizeInviteCode, tokenKind } from '../src/accounts/secrets';

describe('secrets', () => {
  it('INVITE_ALPHABET is the 32-character Crockford base32 alphabet', () => {
    expect(INVITE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(INVITE_ALPHABET).toHaveLength(32);
  });

  it('invite codes are 12 Crockford characters in three groups; normalize accepts lower case, spaces, no dashes, O for 0 and I or L for 1', () => {
    expect(newInviteCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newInviteCode()).not.toBe(newInviteCode());
    expect(normalizeInviteCode(' abcd-efgh-jkoi ')).toBe('ABCDEFGHJK01');
    expect(normalizeInviteCode('ABC')).toBe('');
    expect(normalizeInviteCode('abcdefghjkoi')).toBe('ABCDEFGHJK01');
  });

  it('M6: normalizes away every kind of whitespace (tabs, newlines, NBSP, full-width space) and mixed case alike', () => {
    const want = 'ABCDEFGHJK01';
    expect(normalizeInviteCode('abcd-efgh-jkoi')).toBe(want);
    expect(normalizeInviteCode('\tabcd\t-\tefgh\t-\tjkoi\t')).toBe(want);
    expect(normalizeInviteCode('abcd\n-efgh\n-jkoi\n')).toBe(want);
    expect(normalizeInviteCode('\u00A0abcd\u00A0-\u00A0efgh\u00A0-\u00A0jkoi\u00A0')).toBe(want); // NBSP
    expect(normalizeInviteCode('\u3000abcd\u3000-\u3000efgh\u3000-\u3000jkoi\u3000')).toBe(want); // full-width space
    expect(normalizeInviteCode('AbCd-EfGh-JkOi')).toBe(want);
    expect(normalizeInviteCode(' \t\n\u00A0\u3000AbCd \t-\n EfGh\u00A0-\u3000 JkOi \t\n ')).toBe(want);
  });

  it('tokens carry their kind prefix and 43 base64url characters; hashSecret is sha256-prefixed and stable', () => {
    expect(newToken('agent')).toMatch(/^mla_[A-Za-z0-9_-]{43}$/);
    expect(newToken('personal')).toMatch(/^mlp_[A-Za-z0-9_-]{43}$/);
    expect(newToken('personal')).not.toBe(newToken('personal'));
    expect(tokenKind('mlp_x')).toBe('personal');
    expect(tokenKind('mla_x')).toBe('agent');
    expect(tokenKind('dev-lin')).toBeNull();
    expect(hashSecret('a')).toBe(hashSecret('a'));
    expect(hashSecret('a')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashSecret('a')).not.toBe(hashSecret('b'));
  });

  it('newUserId returns u- plus 10 lower-case alphabet characters', () => {
    const id = newUserId();
    expect(id).toMatch(/^u-[a-z]{10}$/);
    expect(newUserId()).not.toBe(newUserId());
  });
});
