/**
 * The ski patrol snowmobile.
 *
 * Sits behind the player and is only drawn once it is close enough to matter -
 * a permanently visible pursuer stops registering, whereas one that appears
 * when you make a mistake and slides away when you run clean is read instantly.
 *
 * It also tracks the player's lane loosely, which sells pursuit far better than
 * a machine locked to the centre of the track.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';
import { damp } from '@/game/core/math';
import { runtime } from '@/game/state/runtime';
import { chaserPressure, chaserWorldZ } from '@/game/systems/chaser';
import { GLOSS } from '@/game/config/visuals';

const BODY = '#e03a3a';
const VISOR = '#22303a';
const SKI = '#2d3a44';

export function Chaser() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const { chaser } = runtime;
    group.visible = chaser.visible && runtime.running;
    if (!group.visible) return;

    group.position.z = chaserWorldZ(chaser);
    // Follow the player's lane, lagging behind it.
    group.position.x = damp(group.position.x, runtime.lane.x, 0.01, delta);

    // Lean forward the harder it is pushing.
    group.rotation.x = damp(group.rotation.x, chaserPressure(chaser) * -0.14, 0.001, delta);
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Skis */}
      <mesh position={[-0.28, 0.08, -0.3]}>
        <boxGeometry args={[0.16, 0.08, 1.7]} />
        <meshPhongMaterial color={SKI} flatShading specular={GLOSS.polished.specular} shininess={GLOSS.polished.shininess} />
      </mesh>
      <mesh position={[0.28, 0.08, -0.3]}>
        <boxGeometry args={[0.16, 0.08, 1.7]} />
        <meshPhongMaterial color={SKI} flatShading specular={GLOSS.polished.specular} shininess={GLOSS.polished.shininess} />
      </mesh>
      {/* Chassis */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.9, 0.6, 2]} />
        <meshPhongMaterial color={BODY} flatShading specular={GLOSS.prop.specular} shininess={GLOSS.prop.shininess} />
      </mesh>
      {/* Windscreen */}
      <mesh position={[0, 0.95, -0.6]} rotation={[-0.35, 0, 0]}>
        <boxGeometry args={[0.7, 0.5, 0.1]} />
        <meshPhongMaterial color={VISOR} flatShading specular={GLOSS.polished.specular} shininess={GLOSS.polished.shininess} />
      </mesh>
      {/* Rider */}
      <mesh position={[0, 1.1, 0.25]}>
        <capsuleGeometry args={[0.22, 0.45, 4, 8]} />
        <meshPhongMaterial color={VISOR} flatShading specular={GLOSS.polished.specular} shininess={GLOSS.polished.shininess} />
      </mesh>
    </group>
  );
}
