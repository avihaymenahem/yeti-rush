/**
 * Falling snow, and the near-field flakes that sweep past the lens.
 *
 * One draw call whose motion lives entirely in the vertex shader: the CPU
 * uploads three floats per frame and nothing else. Animating a thousand flakes
 * in JavaScript would mean rewriting a position buffer every frame, which is
 * exactly the kind of per-frame work that costs a mobile GPU its frame budget
 * for no visual gain.
 *
 * The layout, the two field boxes and the reasoning behind them are in
 * `nearField.ts`. Two things changed here when this stopped being a `Points`
 * cloud.
 *
 * **The scroll rate was wrong.** It ran at 0.35 of the ground speed, justified
 * by a comment reading "it is in the air, not on the slope". That reasoning is
 * backwards: still air means a flake has no horizontal velocity of its own, so
 * relative to a rider going down the hill it recedes at the *full* ground
 * speed. See `SNOW_FIELD.scrollFraction`.
 *
 * **Flakes are streaked along the distance they cover in one shutter opening.**
 * That is not a taste value: scrolling at the full ground speed moves a flake
 * 35 cm between two frames, and drawing it as a stationary dot is the textbook
 * definition of temporal aliasing. One frame's worth of streak is precisely
 * what removes it - longer is a smear and shorter strobes.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TUNING } from '@/game/config/tuning';
import { SNOW_FIELD } from '@/game/config/visuals';
import {
  buildSnowField,
  DRIFT_AMPLITUDE,
  FIELD_ALPHA,
  LENS_FADE,
  MAIN_FIELD,
  NEAR_FIELD,
} from '@/game/render/nearField';
import { runtime } from '@/game/state/runtime';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform float uSpeed;
  uniform float uExposure;
  uniform vec3 uField;
  uniform vec3 uFieldCentre;
  uniform vec3 uNearField;
  uniform vec3 uNearCentre;
  uniform float uFallSpeed;
  uniform float uDriftSpeed;
  uniform float uDriftAmplitude;
  uniform float uSize;
  uniform float uNearSize;
  uniform float uFieldAlpha;
  uniform float uNearAlpha;
  uniform vec2 uLensFade;

  // The flake seed is normalised to [-0.5, 0.5] and scaled by whichever box it
  // belongs to, so one attribute layout serves both bands.
  attribute vec2 aCorner;
  attribute float aPhase;
  attribute float aScale;
  attribute float aNear;

  varying float vFade;
  varying float vAlpha;
  varying vec2 vCorner;
  varying float vStretch;

  void main() {
    vec3 box = mix(uField, uNearField, aNear);
    vec3 centre = mix(uFieldCentre, uNearCentre, aNear);

    vec3 pos = position * box;

    float phase = uTime * uDriftSpeed + aPhase * 6.2831;
    pos.x += sin(phase) * uDriftAmplitude;
    pos.y -= uTime * uFallSpeed * aScale;
    pos.z += uScroll;

    // Wrap into the box, then put the box where it lives. GLSL mod() is correct
    // for negatives, which the obvious fract() form is not.
    pos = mod(pos + box * 0.5, box) - box * 0.5 + centre;

    // World velocity of the flake. The scroll term is what the streak is made
    // of; the other two are along for the ride and cost one transcendental.
    vec3 velocity = vec3(
      cos(phase) * uDriftSpeed * uDriftAmplitude,
      -uFallSpeed * aScale,
      uSpeed
    );

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // The mesh is at the origin with no rotation or scale, so the upper 3x3 is
    // the view rotation and needs no inverse-transpose.
    vec3 mvVelocity = mat3(modelViewMatrix) * velocity;
    float depth = max(-mv.z, 0.001);

    /*
     * Apparent lateral motion, expressed in metres *at this depth* so it can be
     * added straight onto the view-space quad.
     *
     * The second term is the perspective one and it is the whole reason the
     * near band streaks hardest. Differentiating the projection u = x / -z
     * gives du/dt = (vx + u * vz) / -z, so a flake beside the lens sweeps
     * outwards in proportion to how far off-axis it already is - however
     * identical its world velocity to one on the axis, which does not move on
     * screen at all.
     */
    vec2 flow = mvVelocity.xy + (mv.xy / depth) * mvVelocity.z;

    float extent = mix(uSize, uNearSize, aNear) * aScale;
    float streak = length(flow) * uExposure;
    // Below a tenth of a millimetre the direction is noise; any axis will do.
    vec2 axis = streak > 1e-4 ? normalize(flow) : vec2(0.0, 1.0);
    vec2 across = vec2(-axis.y, axis.x);

    // View-space XY is the screen plane, so a quad built in it is camera-facing
    // by construction - no billboard matrix, no normalisation, no branch.
    mv.xy += axis * (aCorner.y * 0.5 * (extent + streak))
           + across * (aCorner.x * 0.5 * extent);
    gl_Position = projectionMatrix * mv;

    // Dissolve into the fog rather than popping, and out of existence rather
    // than being sliced in half by the near plane.
    vFade = (1.0 - smoothstep(30.0, 80.0, depth))
          * smoothstep(uLensFade.x, uLensFade.y, depth);
    vAlpha = mix(uFieldAlpha, uNearAlpha, aNear);
    vCorner = aCorner;
    vStretch = extent > 0.0 ? streak / extent : 0.0;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying float vFade;
  varying float vAlpha;
  varying vec2 vCorner;
  varying float vStretch;

  void main() {
    /*
     * A capsule, not an ellipse: the flake is a disc dragged along the streak,
     * so it keeps a constant width however long the smear gets. An ellipse
     * would get thinner as the run sped up, which is the opposite of what
     * motion blur does.
     *
     * Measured in units of the flake's half-width, which is why the along-axis
     * coordinate is scaled back up by (1 + vStretch) - the quad was widened by
     * exactly that factor in the vertex shader.
     */
    float along = abs(vCorner.y) * (1.0 + vStretch);
    float d = length(vec2(vCorner.x, max(along - vStretch, 0.0)));
    if (d > 1.0) discard;

    // Soft edge. A hard circle three pixels across aliases into a flickering
    // dot, and it is the falloff that makes the near band read as out of focus
    // rather than as lumps of polystyrene.
    float mask = 1.0 - smoothstep(0.55, 1.0, d);

    gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * vAlpha * mask);

    /*
     * The one thing a shader writing gl_FragColor by hand has to remember.
     *
     * WebGLProgram declares toneMapping() and linearToOutputTexel() in every
     * fragment prefix but never calls them - the built-in materials call them
     * through these two chunks. Writing raw, as this file used to, put the snow
     * on a different transfer function from every other surface in the scene:
     * white here meant display white, while white on the ground meant white
     * *into* ACES at the configured exposure and came out lower.
     */
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function Snow() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const elapsedRef = useRef(0);

  const geometry = useMemo(() => buildSnowField(), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uSpeed: { value: 0 },
      uExposure: { value: SNOW_FIELD.streakExposure },
      uField: {
        value: new THREE.Vector3(MAIN_FIELD.width, MAIN_FIELD.height, MAIN_FIELD.depth),
      },
      uFieldCentre: { value: new THREE.Vector3(...MAIN_FIELD.centre) },
      uNearField: {
        value: new THREE.Vector3(NEAR_FIELD.width, NEAR_FIELD.height, NEAR_FIELD.depth),
      },
      uNearCentre: { value: new THREE.Vector3(...NEAR_FIELD.centre) },
      uFallSpeed: { value: TUNING.snow.fallSpeed },
      uDriftSpeed: { value: TUNING.snow.driftSpeed },
      uDriftAmplitude: { value: DRIFT_AMPLITUDE },
      /*
       * Both sizes are the flake's drawn *extent* across the streak, in metres.
       *
       * `TUNING.snow.size` used to be a `gl_PointSize` number - pixels at some
       * reference distance, scaled by a magic 300 - which made it resolution
       * dependent and about a tenth of this as a world measurement. Read as
       * metres it lands a mid-field flake at roughly five pixels on an 812 px
       * viewport at twenty metres, which is where a streak reads. Turning the
       * knob up still makes flakes bigger, which is all it was ever used for.
       *
       * `SNOW_FIELD.nearSize` is used the same way, which is the figure its own
       * note works its 40-to-160-pixel band from.
       */
      uSize: { value: TUNING.snow.size },
      uNearSize: { value: SNOW_FIELD.nearSize },
      uFieldAlpha: { value: FIELD_ALPHA },
      uNearAlpha: { value: SNOW_FIELD.nearAlpha },
      uLensFade: { value: new THREE.Vector2(LENS_FADE[0], LENS_FADE[1]) },
    }),
    [],
  );

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material) return;

    elapsedRef.current += delta;
    material.uniforms.uTime!.value = elapsedRef.current;

    /*
     * Scroll comes from `distance`, not from integrating `speed`: distance is
     * what the rest of the world scrolls by, so the snow cannot drift out of
     * step with it however the frame rate wobbles, and it is already zero while
     * the run is not moving.
     *
     * Reduced modulo the field depth on the CPU. A run of several kilometres
     * would otherwise send a value in the thousands into a 32-bit uniform, and
     * a mod against 90 in the shader would be quantising a number whose
     * resolution had already fallen to centimetres - a visible jitter across
     * the whole cloud, appearing only after several minutes of play.
     */
    const scrolled = (runtime.distance * SNOW_FIELD.scrollFraction) % MAIN_FIELD.depth;
    material.uniforms.uScroll!.value = (scrolled + MAIN_FIELD.depth) % MAIN_FIELD.depth;

    // The streak is drawn from the *rate*, which is zero on a menu or a dead
    // run even though the flakes keep falling.
    material.uniforms.uSpeed!.value =
      runtime.running && runtime.alive ? runtime.speed * SNOW_FIELD.scrollFraction : 0;
  });

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        // The quad is assembled in view space, so its winding depends on the
        // sign of the streak axis. Cheaper to draw both faces of an unlit,
        // unshadowed quad than to branch on it.
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
