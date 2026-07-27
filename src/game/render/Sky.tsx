/**
 * Sky dome.
 *
 * A flat background colour is the single biggest thing making a low-poly scene
 * look cheap: it reads as an empty viewport rather than air. A three-stop
 * vertical gradient with a sun and a glow around it costs one draw call and one
 * inverted sphere, and gives the whole scene a light source the eye can find.
 *
 * Rendered back-side with depth write off and a low render order, so it always
 * sits behind everything without needing a huge far plane.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PALETTE, SKY } from '@/game/config/visuals';

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    // Direction from the camera, which is what the gradient and sun are
    // evaluated against - the dome follows the camera, so world position would
    // give a gradient that slides as the player moves.
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunCore;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDirection;
  uniform float uSunSize;
  uniform float uSunGlowSize;

  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);

    // Two-stage gradient: horizon into mid, then mid into zenith. A single
    // mix from horizon to zenith washes the middle of the sky out.
    float h = clamp(dir.y, -1.0, 1.0);
    float lower = smoothstep(-0.06, 0.30, h);
    float upper = smoothstep(0.18, 0.85, h);

    vec3 colour = mix(uHorizon, uMid, lower);
    colour = mix(colour, uZenith, upper);

    // Sun. The glow is a wide soft falloff, the disc a hard-edged core inside it.
    float toSun = dot(dir, normalize(uSunDirection));
    float glow = pow(max(toSun, 0.0), 1.0 / max(uSunGlowSize, 0.001));
    colour += uSunGlow * glow * 0.55;

    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, toSun);
    colour = mix(colour, uSunCore, disc);

    // Pull the very bottom of the dome towards the horizon colour so the join
    // with the fog is invisible.
    colour = mix(colour, uHorizon, smoothstep(0.02, -0.16, h));

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export function Sky() {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
      uMid: { value: new THREE.Color(PALETTE.skyMid) },
      uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      uSunCore: { value: new THREE.Color(PALETTE.sunCore) },
      uSunGlow: { value: new THREE.Color(PALETTE.sunGlow) },
      uSunDirection: { value: new THREE.Vector3(...SKY.sunDirection).normalize() },
      uSunSize: { value: SKY.sunSize },
      uSunGlowSize: { value: SKY.sunGlowSize },
    }),
    [],
  );

  // The dome rides with the camera, so it can be far smaller than the world and
  // still never be reached.
  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (mesh) mesh.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[SKY.radius, 24, 16]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        toneMapped
      />
    </mesh>
  );
}
