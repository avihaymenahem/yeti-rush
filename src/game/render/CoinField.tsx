/**
 * Coin rendering.
 *
 * Every coin on the track is one instanced mesh - one draw call for hundreds
 * of coins. They share a single spin angle rather than each tracking its own,
 * which is both cheaper and reads better: a coin line spins in unison.
 *
 * The magnet's pull is drawn here and *only* here. Where a coin is collected
 * from is the simulation's business and has not changed; where it appears to be
 * on the way in is presentation, and putting it in the renderer keeps the sim
 * pure and headless-testable. Nothing about the pull can affect what is picked
 * up, which is the useful property: this cannot introduce a gameplay bug.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { coinGeometry } from '@/game/render/propGeometry';
import { RECYCLE_Z, SPAWN_Z } from '@/game/render/trackLayout';
import { coinPickupMultiplier, flightHeight } from '@/game/content/powerUps';
import { runtime } from '@/game/state/runtime';
import { laneToX } from '@/game/systems/lanes';
import { MAX_COINS, worldZOf } from '@/game/systems/spawner';
import { GLOSS } from '@/game/config/visuals';

const scratch = new THREE.Object3D();
// YXZ order applies the spin *after* the tilt, so the disc faces the player and
// rotates about the world Y axis. With the default XYZ order the spin would be
// applied around the cylinder's own axis and be invisible.
scratch.rotation.order = 'YXZ';

export function CoinField() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const spinRef = useRef(0);
  const geometry = useMemo(() => coinGeometry(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    spinRef.current = (spinRef.current + TUNING.coins.spinRate * delta) % (Math.PI * 2);

    // Where the coin is being drawn towards: the rider's chest, not their feet,
    // so the line of flight ends on the character rather than under them.
    const pickupRadius = TUNING.coins.pickupRadius * coinPickupMultiplier(runtime.powerUps);
    const pulling = pickupRadius > TUNING.coins.pickupRadius * 1.5;
    const range = TUNING.coins.magnetVisualRange;
    const px = runtime.lane.x;
    const py = runtime.player.y + TUNING.player.halfHeight;
    const pz = TUNING.player.z;
    // Matches `collectCoins`: while flying, the drop to the piste is not part of
    // the reach. Measuring it here as well is what keeps the arrival and the
    // pickup on the same frame - the coin must not reach the rider and linger.
    const flying = flightHeight(runtime.powerUps) !== null;

    let written = 0;
    for (const coin of runtime.track.coins) {
      if (!coin.active) continue;

      const worldZ = worldZOf(coin.trackZ, runtime.distance);
      if (worldZ > RECYCLE_Z || worldZ < SPAWN_Z) continue;

      let x = laneToX(coin.lane);
      let y = coin.y;
      let z = worldZ;

      if (pulling) {
        const dx = px - x;
        const dy = py - y;
        const dz = pz - z;
        // The offsets below still lift the coin to the rider; only the *reach*
        // forgives the drop, so the coin flies up and is collected as it lands.
        const reachDy = flying && y < py ? 0 : dy;
        const distance = Math.sqrt(dx * dx + dz * dz + reachDy * reachDy);

        if (distance < range) {
          // Scaled so the coin arrives exactly as it is collected: at the pickup
          // radius the pull is complete, so nothing ever winks out mid-flight.
          // Squared, because a linear ramp drifts rather than snatches.
          const t = Math.min(1, (range - distance) / Math.max(0.001, range - pickupRadius));
          const pull = t * t;
          x += dx * pull;
          y += dy * pull;
          z += dz * pull;
        }
      }

      scratch.position.set(x, y, z);
      scratch.rotation.set(Math.PI / 2, spinRef.current, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      mesh.setMatrixAt(written, scratch.matrix);

      written++;
      if (written >= MAX_COINS) break;
    }

    mesh.count = written;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      geometry={geometry}
      args={[undefined, undefined, MAX_COINS]}
      frustumCulled={false}
    >
      {/* Vertex-coloured, so the rim, face and numeral are one draw call rather
          than three materials. The emissive is kept: it is what stops a coin
          going dead when it drifts into a cast shadow, where an unlit disc is
          just a dark spot the player stops chasing. */}
      <meshPhongMaterial
        vertexColors
        flatShading
        emissive="#6b4a10"
        specular={GLOSS.metal.specular}
        shininess={GLOSS.metal.shininess}
      />
    </instancedMesh>
  );
}
