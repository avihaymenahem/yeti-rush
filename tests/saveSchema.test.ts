import { describe, expect, it } from 'vitest';
import {
  createDefaultSave,
  DEFAULT_SKIN,
  LEADERBOARD_SIZE,
  migrate,
  parseSave,
  SAVE_VERSION,
  serializeSave,
} from '@/game/state/saveSchema';

describe('createDefaultSave', () => {
  it('is a valid, playable starting state', () => {
    const save = createDefaultSave();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.coins).toBe(0);
    expect(save.ownedSkins).toContain(DEFAULT_SKIN);
    expect(save.equippedSkin).toBe(DEFAULT_SKIN);
  });

  it('returns a fresh object each time, not a shared reference', () => {
    const a = createDefaultSave();
    const b = createDefaultSave();
    a.ownedSkins.push('mutated');
    expect(b.ownedSkins).not.toContain('mutated');
  });
});

describe('migrate', () => {
  it('round-trips a complete, valid save unchanged', () => {
    const save = createDefaultSave();
    save.coins = 1234;
    save.highScore = 98_765;
    save.ownedSkins = [DEFAULT_SKIN, 'yeti-neon'];
    save.equippedSkin = 'yeti-neon';
    save.upgrades = { magnet: 2 };
    save.lastDailyClaim = '2026-07-27';

    expect(migrate(save)).toEqual(save);
  });

  it('falls back to defaults for non-objects', () => {
    const defaults = createDefaultSave();
    for (const bad of [null, undefined, 42, 'nope', [], true]) {
      expect(migrate(bad)).toEqual(defaults);
    }
  });

  it('keeps whatever survived a truncated write and defaults the rest', () => {
    const save = migrate({ coins: 500, highScore: 900 });
    expect(save.coins).toBe(500);
    expect(save.highScore).toBe(900);
    expect(save.bestDistance).toBe(0);
    expect(save.equippedSkin).toBe(DEFAULT_SKIN);
    expect(save.settings.sfxVolume).toBe(100);
  });

  it('rejects negative, fractional and non-finite counters', () => {
    const save = migrate({
      coins: -500,
      highScore: Number.NaN,
      totalRuns: 3.7,
      dailyStreak: Number.POSITIVE_INFINITY,
    });
    expect(save.coins).toBe(0);
    expect(save.highScore).toBe(0);
    expect(save.totalRuns).toBe(3);
    expect(save.dailyStreak).toBe(0);
  });

  it('always leaves the default skin owned', () => {
    const save = migrate({ ownedSkins: ['yeti-neon'] });
    expect(save.ownedSkins).toContain(DEFAULT_SKIN);
    expect(save.ownedSkins).toContain('yeti-neon');
  });

  it('refuses to equip a skin the player does not own', () => {
    const save = migrate({ ownedSkins: [DEFAULT_SKIN], equippedSkin: 'yeti-legendary' });
    expect(save.equippedSkin).toBe(DEFAULT_SKIN);
  });

  it('deduplicates owned skins', () => {
    const save = migrate({ ownedSkins: [DEFAULT_SKIN, 'a', 'a', DEFAULT_SKIN] });
    expect(save.ownedSkins).toEqual([DEFAULT_SKIN, 'a']);
  });

  it('drops junk entries from arrays and records', () => {
    const save = migrate({
      ownedSkins: [DEFAULT_SKIN, 42, null, 'yeti-neon'],
      upgrades: { magnet: 2, broken: 'three', alsoBroken: null },
    });
    expect(save.ownedSkins).toEqual([DEFAULT_SKIN, 'yeti-neon']);
    expect(save.upgrades).toEqual({ magnet: 2 });
  });

  it('discards malformed date strings', () => {
    expect(migrate({ lastDailyClaim: 'yesterday' }).lastDailyClaim).toBeNull();
    expect(migrate({ lastDailyClaim: 1_700_000_000 }).lastDailyClaim).toBeNull();
    expect(migrate({ lastDailyClaim: '2026-07-27' }).lastDailyClaim).toBe('2026-07-27');
  });

  it('preserves settings individually rather than all-or-nothing', () => {
    const save = migrate({ settings: { musicVolume: 40, sfxVolume: 'loud' } });
    expect(save.settings.musicVolume).toBe(40);
    expect(save.settings.sfxVolume).toBe(100);
    expect(save.settings.hapticsEnabled).toBe(true);
  });

  it('carries a muted toggle from an older save over to the volume slider', () => {
    // Volumes replaced on/off toggles. Someone who had deliberately turned the
    // music off must not get it back at full blast because they updated.
    const save = migrate({ settings: { musicEnabled: false, sfxEnabled: false } });
    expect(save.settings.musicVolume).toBe(0);
    expect(save.settings.sfxVolume).toBe(0);
  });

  it('treats an older save that had sound on as full volume', () => {
    const save = migrate({ settings: { musicEnabled: true, sfxEnabled: true } });
    expect(save.settings.musicVolume).toBe(100);
    expect(save.settings.sfxVolume).toBe(100);
  });

  it('prefers an explicit volume over the toggle it replaced', () => {
    const save = migrate({ settings: { musicEnabled: false, musicVolume: 60 } });
    expect(save.settings.musicVolume).toBe(60);
  });

  it('clamps volumes into range and rounds them to whole steps', () => {
    expect(migrate({ settings: { musicVolume: 500 } }).settings.musicVolume).toBe(100);
    expect(migrate({ settings: { musicVolume: -20 } }).settings.musicVolume).toBe(0);
    expect(migrate({ settings: { musicVolume: 42.7 } }).settings.musicVolume).toBe(43);
    expect(migrate({ settings: { musicVolume: Number.NaN } }).settings.musicVolume).toBe(100);
  });

  it('stamps the current version onto an older save', () => {
    expect(migrate({ version: 0, coins: 10 }).version).toBe(SAVE_VERSION);
  });

  it('is idempotent', () => {
    const once = migrate({ coins: 7, ownedSkins: ['x'], equippedSkin: 'x' });
    expect(migrate(once)).toEqual(once);
  });
});

describe('leaderboard', () => {
  it('starts empty', () => {
    expect(createDefaultSave().leaderboard).toEqual([]);
  });

  it('keeps valid entries', () => {
    const save = migrate({
      leaderboard: [{ score: 500, distance: 900, coins: 30, skin: 'yeti-ember', date: '2026-07-27' }],
    });
    expect(save.leaderboard).toHaveLength(1);
    expect(save.leaderboard[0]!.score).toBe(500);
    expect(save.leaderboard[0]!.skin).toBe('yeti-ember');
  });

  it('re-sorts a table that was stored out of order', () => {
    const save = migrate({
      leaderboard: [{ score: 100 }, { score: 900 }, { score: 400 }],
    });
    expect(save.leaderboard.map((entry) => entry.score)).toEqual([900, 400, 100]);
  });

  it('trims an over-long table rather than trusting it', () => {
    const save = migrate({
      leaderboard: Array.from({ length: 60 }, (_, i) => ({ score: i })),
    });
    expect(save.leaderboard).toHaveLength(LEADERBOARD_SIZE);
    expect(save.leaderboard[0]!.score).toBe(59);
  });

  it('drops malformed entries without losing the good ones', () => {
    const save = migrate({
      leaderboard: [{ score: 300 }, null, 'nope', { score: -5 }, { nothing: true }, { score: 700 }],
    });
    expect(save.leaderboard.map((entry) => entry.score)).toEqual([700, 300]);
  });

  it('defaults a missing board to the free one', () => {
    expect(migrate({ leaderboard: [{ score: 10 }] }).leaderboard[0]!.skin).toBe(DEFAULT_SKIN);
  });

  it('discards a malformed date on an entry', () => {
    expect(migrate({ leaderboard: [{ score: 10, date: 'today' }] }).leaderboard[0]!.date).toBeNull();
  });

  it('falls back to empty for a non-array', () => {
    expect(migrate({ leaderboard: 'nope' }).leaderboard).toEqual([]);
  });
});

describe('parseSave / serializeSave', () => {
  it('round-trips through JSON', () => {
    const save = createDefaultSave();
    save.coins = 321;
    save.bestDistance = 1500.5;
    expect(parseSave(serializeSave(save))).toEqual(save);
  });

  it('returns defaults for null, empty and corrupt input', () => {
    const defaults = createDefaultSave();
    expect(parseSave(null)).toEqual(defaults);
    expect(parseSave('')).toEqual(defaults);
    expect(parseSave('{ this is not json')).toEqual(defaults);
    expect(parseSave('null')).toEqual(defaults);
  });

  it('never throws, whatever it is handed', () => {
    for (const input of ['[]', '"a string"', '0', '{"coins":{"nested":true}}']) {
      expect(() => parseSave(input)).not.toThrow();
    }
  });
});
