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
 *
 * **This shader is on the same transfer function as the rest of the world, and
 * it used not to be.** That is the mechanical reason the sky and the scene
 * looked like two separate images pasted together. `WebGLProgram` only
 * *declares* `toneMapping()` and `linearToOutputTexel()` in the fragment prefix
 * - nothing calls them unless the shader includes the chunks that do - so
 * writing `gl_FragColor` directly put a scene-linear value straight into an
 * sRGB-interpreted buffer. The authored zenith displayed at about 1.6%
 * luminance and the horizon at 34%, against a fog the world dissolved into at
 * 61%: an eighteen-point step, in the wrong direction, along the one line in
 * the frame where two surfaces are supposed to be indistinguishable.
 *
 * So the dome now runs `<tonemapping_fragment>` and `<colorspace_fragment>`
 * like every other material, and the palette in `visuals.ts` is authored for
 * the *input* to that curve. The two must stay together: putting the old hexes
 * through the curve gives a near-black sky, and taking the curve back out of
 * this shader gives one too.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PALETTE, SKY } from '@/game/config/visuals';
import { fogDisplayColour, SKY_GRADIENT } from '@/game/render/atmosphere';

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

/*
 * `<common>` is here for `rand()`, which `<dithering_pars_fragment>` needs and
 * which the renderer's prefix does not provide - the prefix carries the tone
 * mapping and colour space helpers only.
 *
 * Dithering matters more on this surface than on any other in the game and is
 * the one place `material.dithering` cannot reach on its own: the mid-to-zenith
 * ramp moves about seventeen 8-bit steps over roughly four hundred pixels of a
 * portrait phone, which is a visible contour every twenty-odd pixels across the
 * largest unbroken area in the frame.
 */
const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <dithering_pars_fragment>

  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunCore;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDirection;
  uniform float uSunSize;
  uniform float uSunGlowSize;
  uniform float uSunGlowStrength;
  uniform vec4 uGradient;
  uniform vec3 uFogDisplay;

  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);

    // Two-stage gradient: horizon into mid, then mid into zenith. A single
    // mix from horizon to zenith washes the middle of the sky out. The band
    // edges arrive as a uniform because Mountains.tsx bakes the same curve
    // into its vertex colours and the two have to be one function.
    float h = clamp(dir.y, -1.0, 1.0);
    float lower = smoothstep(uGradient.x, uGradient.y, h);
    float upper = smoothstep(uGradient.z, uGradient.w, h);

    vec3 colour = mix(uHorizon, uMid, lower);
    colour = mix(colour, uZenith, upper);

    /*
     * Sun. The glow is a soft falloff, the disc a hard-edged core inside it.
     *
     * The strength is a uniform rather than the bare literal it used to be, and
     * that is not tidying. It is a *scene-linear add* on top of a mid sky
     * sitting near 0.1 linear, so wherever the glow is appreciable it is the
     * dominant term - it decided the value of most of the visible sky while
     * being the one number in the scene that nobody reading visuals.ts could
     * see. SKY.sunGlowStrength has what the measurement said.
     */
    float toSun = dot(dir, normalize(uSunDirection));
    float glow = pow(max(toSun, 0.0), 1.0 / max(uSunGlowSize, 0.001));
    colour += uSunGlow * glow * uSunGlowStrength;

    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, toSun);
    colour = mix(colour, uSunCore, disc);

    gl_FragColor = vec4(colour, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    /*
     * The join with the fog, and it happens *here* - after the two chunks
     * above - on purpose.
     *
     * The comment this replaced said it pulled the dome bottom towards the
     * horizon colour "so the join with the fog is invisible", and then blended
     * towards uHorizon: a hot orange, against a fog that is pale blue. The code
     * did the opposite of what it claimed. Worse, the two could never have
     * agreed even if the hue had matched, because three mixes fogColor *after*
     * the colorspace fragment and uploads it through getUnlitUniformColorSpace
     * - it is a literal display value, not a scene-linear one.
     *
     * So the target is the fog itself, expressed in the space the fog is
     * actually mixed in. Below the horizon the dome is now bit-for-bit the
     * colour the fogged world dissolves to, and the seam cannot drift again
     * without someone changing both.
     *
     * Written with the edges the right way round and the result inverted. The
     * line this replaced read smoothstep(0.02, -0.16, h), and GLSL leaves
     * smoothstep *undefined* when edge0 >= edge1 - it happens to work on every
     * driver anyone has run this on because they all evaluate the clamped
     * ratio, but it is undefined behaviour sitting on the horizon line.
     */
    float join = 1.0 - smoothstep(-0.16, 0.02, h);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogDisplay, join);

    #include <dithering_fragment>
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
      uSunGlowStrength: { value: SKY.sunGlowStrength },
      uGradient: {
        value: new THREE.Vector4(
          SKY_GRADIENT.lowerFrom,
          SKY_GRADIENT.lowerTo,
          SKY_GRADIENT.upperFrom,
          SKY_GRADIENT.upperTo,
        ),
      },
      uFogDisplay: { value: fogDisplayColour() },
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
        dithering
      />
    </mesh>
  );
}
