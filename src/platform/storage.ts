/**
 * Key/value persistence.
 *
 * `@capacitor/preferences` ships a web implementation backed by localStorage,
 * so this is one code path on both native and web. Every call is wrapped:
 * storage failing (private mode, quota, a WebView quirk) must degrade the save
 * system, never crash the game.
 */

import { Preferences } from '@capacitor/preferences';

export async function getItem(key: string): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key });
    return value;
  } catch (error) {
    console.warn('[storage] read failed', key, error);
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<boolean> {
  try {
    await Preferences.set({ key, value });
    return true;
  } catch (error) {
    console.warn('[storage] write failed', key, error);
    return false;
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch (error) {
    console.warn('[storage] remove failed', key, error);
  }
}
