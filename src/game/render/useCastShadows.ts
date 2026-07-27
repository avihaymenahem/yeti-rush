/**
 * Marks every mesh under a group as a shadow caster.
 *
 * `castShadow` is a per-object flag in three and is not inherited, so a rig
 * assembled from a dozen parented meshes - the yeti, the ski patrol - would
 * otherwise need the flag repeated on every one of them, and any part added
 * later would silently stop casting. Walking the subtree once on mount keeps
 * that impossible to get wrong.
 *
 * Casting only, never receiving. These are small articulated figures whose own
 * faces are already shaded by the key light; self-shadowing at this shadow map
 * resolution buys nothing but acne across the fur.
 */

import { useLayoutEffect, type RefObject } from 'react';
import type * as THREE from 'three';

export function useCastShadows(ref: RefObject<THREE.Object3D | null>): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
  }, [ref]);
}
