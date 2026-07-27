/**
 * Falling snow.
 *
 * One `Points` cloud whose motion lives entirely in the vertex shader: the CPU
 * uploads a single time uniform per frame and nothing else. Animating ~900
 * flakes in JavaScript would mean rewriting a position buffer every frame,
 * which is exactly the kind of per-frame work that costs a mobile GPU its
 * frame budget for no visual gain.
 *
 * The field is a box that follows the player, and flakes wrap within it, so
 * there is always snow around the camera and never any outside it.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { createRng } from '@/game/core/rng';
import { runtime } from '@/game/state/runtime';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec3 uField;
  uniform float uFallSpeed;
  uniform float uDriftSpeed;
  uniform float uSize;

  attribute float aPhase;
  attribute float aScale;

  varying float vFade;

  void main() {
    vec3 pos = position;

    // Fall, and drift sideways out of phase so the cloud never looks like a grid.
    pos.y -= uTime * uFallSpeed * aScale;
    pos.x += sin(uTime * uDriftSpeed + aPhase * 6.2831) * 0.9;

    // Flakes scroll towards the camera with the world, then wrap.
    pos.z += uScroll;

    // Wrap into the field box centred on the origin.
    pos.y = mod(pos.y + uField.y * 0.5, uField.y) - uField.y * 0.5;
    pos.z = mod(pos.z + uField.z * 0.5, uField.z) - uField.z * 0.5;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (uSize * aScale * 300.0) / max(-mvPosition.z, 0.001);

    // Fade out with distance so flakes dissolve into the fog rather than pop.
    vFade = 1.0 - smoothstep(30.0, 80.0, -mvPosition.z);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying float vFade;

  void main() {
    // Round off the point sprite; a square flake reads as a bug.
    vec2 offset = gl_PointCoord - vec2(0.5);
    float d = dot(offset, offset);
    if (d > 0.25) discard;

    gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * 0.75);
  }
`;

export function Snow() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const elapsedRef = useRef(0);

  const { geometry, uniforms } = useMemo(() => {
    const { count, fieldWidth, fieldHeight, fieldDepth, fallSpeed, driftSpeed, size } = TUNING.snow;
    // Fixed seed: the flake layout is decorative and stable across runs.
    const rng = createRng(0x5f10);

    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng.range(-fieldWidth / 2, fieldWidth / 2);
      positions[i * 3 + 1] = rng.range(-fieldHeight / 2, fieldHeight / 2);
      positions[i * 3 + 2] = rng.range(-fieldDepth / 2, fieldDepth / 2);
      phases[i] = rng.next();
      // Varied fall speed and size gives the cloud depth without more flakes.
      scales[i] = rng.range(0.5, 1.4);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    return {
      geometry: geo,
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uField: { value: new THREE.Vector3(fieldWidth, fieldHeight, fieldDepth) },
        uFallSpeed: { value: fallSpeed },
        uDriftSpeed: { value: driftSpeed },
        uSize: { value: size },
      },
    };
  }, []);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material) return;

    elapsedRef.current += delta;
    material.uniforms.uTime!.value = elapsedRef.current;
    // Snow drifts past with the world, at a fraction of the ground speed - it
    // is in the air, not on the slope.
    material.uniforms.uScroll!.value = runtime.distance * 0.35;
  });

  return (
    <points
      geometry={geometry}
      position={[0, TUNING.snow.fieldHeight * 0.35, -TUNING.snow.fieldDepth * 0.25]}
      frustumCulled={false}
    >
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
      />
    </points>
  );
}
