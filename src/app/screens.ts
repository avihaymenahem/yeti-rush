/**
 * The screens the shell can show outside a run.
 *
 * Kept in its own module so `App` can route on it without every screen
 * importing the shell, and so adding a screen is one entry here plus one case
 * in the shell.
 */

export type Screen = 'home' | 'shop' | 'missions' | 'scores' | 'settings';
