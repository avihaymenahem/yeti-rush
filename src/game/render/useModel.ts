/**
 * GLB loading, normalisation and merging for instanced rendering.
 *
 * Two shapes of model arrive from the Kenney kits and they need different
 * handling:
 *
 *  - Holiday Kit models are a single primitive sharing one texture atlas. Their
 *    geometry is used as-is and the atlas is applied explicitly (see below).
 *  - Nature Kit models are several primitives with plain-colour, untextured
 *    materials. Rendering those as-is would cost a draw call per material per
 *    obstacle kind, so each primitive's material colour is baked into a vertex
 *    colour attribute and the primitives are merged into one geometry.
 *
 * Either way the result is exactly one geometry and one material per model,
 * which is what lets every obstacle of a kind draw in a single instanced call.
 *
 * The atlas is assigned here rather than left to the loader on purpose. The
 * Holiday Kit GLBs reference `Textures/colormap.png` by relative path, which
 * resolves differently under the dev server than in a hashed production build,
 * so the loader fails to find it in at least one of them and silently produces
 * untextured white models. Importing the atlas through the bundler and
 * assigning it makes both environments behave identically.
 *
 * The fit transform (scale to a target size, ground-align, rotate) is baked
 * into the geometry rather than applied per instance, so the hot path only ever
 * writes a position matrix.
 */

import { useGLTF, useTexture } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import colormapUrl from '@/assets/models/colormap.png';
import { GLOSS } from '@/game/config/visuals';

export interface ModelSpec {
  url: string;
  /**
   * True for models that use the shared Kenney colour atlas. Not inferred from
   * the loaded material: when the loader fails to resolve the relative texture
   * path it leaves `map` null, and inferring from that would silently fall back
   * to flat white rather than surfacing the problem.
   */
  textured?: boolean;
  /** Scale uniformly so the model is this wide, in world units. */
  fitWidth?: number;
  /** Scale uniformly so the model is this tall. Takes precedence over width. */
  fitHeight?: number;
  /**
   * Scale each axis independently to exactly this size. Use for models whose
   * proportions do not match their collider - a 1:1:1 block fitted uniformly to
   * a tall thin collider spills into the neighbouring lanes. Takes precedence
   * over the uniform fits, and should be reserved for geometric shapes where
   * stretching is invisible.
   */
  fitBox?: readonly [number, number, number];
  /**
   * Pulls the model's baked colours towards a target, for fitting assets from a
   * different palette into this one. The Nature Kit is a green-and-earth set -
   * its rock has `grass` and `dirt` materials - and a sandy brown spire reads
   * as desert against an alpine sky. Blending rather than multiplying, because
   * multiplying a brown by a grey just gives a darker brown.
   *
   * Only affects vertex-coloured (untextured) models.
   */
  recolor?: { color: string; amount: number };
  /** Rotation about Y applied before fitting, in radians. */
  rotationY?: number;
  /** Sit the model's base on y = 0. Defaults to true. */
  groundAlign?: boolean;
  /** Lift the model after ground alignment. */
  offsetY?: number;
}

export interface PreparedModel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** Pulls the diffuse colour out of whatever material the primitive carries. */
function materialColor(material: THREE.Material | THREE.Material[]): THREE.Color {
  const single = Array.isArray(material) ? material[0] : material;
  const colour = (single as THREE.MeshStandardMaterial | undefined)?.color;
  return colour ? colour.clone() : new THREE.Color(1, 1, 1);
}

/**
 * Writes a flat COLOR_0 attribute so a merged geometry can keep the per-part
 * colours its separate materials used to provide.
 */
function bakeVertexColor(
  geometry: THREE.BufferGeometry,
  colour: THREE.Color,
  recolor: ModelSpec['recolor'],
): void {
  const baked = colour.clone();
  if (recolor) {
    baked.lerp(new THREE.Color(recolor.color), THREE.MathUtils.clamp(recolor.amount, 0, 1));
  }

  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = baked.r;
    colors[i * 3 + 1] = baked.g;
    colors[i * 3 + 2] = baked.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Strips attributes that are not shared by every primitive. `mergeGeometries`
 * requires an identical attribute set, and a UV present on one part but not
 * another silently fails the merge.
 */
function harmoniseAttributes(geometries: THREE.BufferGeometry[]): void {
  const common = new Set(Object.keys(geometries[0]?.attributes ?? {}));
  for (const geometry of geometries) {
    for (const name of [...common]) {
      if (!geometry.attributes[name]) common.delete(name);
    }
  }
  for (const geometry of geometries) {
    for (const name of Object.keys(geometry.attributes)) {
      if (!common.has(name)) geometry.deleteAttribute(name);
    }
  }
}

/** Reported once per model in dev, to catch a fit that does not match a collider. */
const reported = new Set<string>();

/**
 * One configured copy of the atlas, shared by every textured model.
 *
 * The texture `useTexture` hands back is a shared cache entry, so it must not be
 * mutated in place - other consumers would inherit the changes. Cloning once and
 * caching the clone keeps a single GPU upload while leaving the cached original
 * untouched.
 */
const configuredAtlases = new WeakMap<THREE.Texture, THREE.Texture>();

function configureAtlas(source: THREE.Texture): THREE.Texture {
  const existing = configuredAtlases.get(source);
  if (existing) return existing;

  const atlas = source.clone();
  // A palette atlas must sample nearest, or neighbouring swatches bleed into
  // each other and every model picks up a fringe of the wrong colour.
  atlas.magFilter = THREE.NearestFilter;
  atlas.colorSpace = THREE.SRGBColorSpace;
  // glTF UVs assume an unflipped texture; the plain image loader flips by default.
  atlas.flipY = false;
  atlas.needsUpdate = true;

  configuredAtlases.set(source, atlas);
  return atlas;
}

function prepare(scene: THREE.Object3D, spec: ModelSpec, atlas: THREE.Texture): PreparedModel {
  scene.updateWorldMatrix(true, true);

  const geometries: THREE.BufferGeometry[] = [];
  let meshCount = 0;

  scene.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    meshCount++;

    const geometry = mesh.geometry.clone();
    // Bake the node transform in, so the merged result matches what the
    // authored scene graph looked like.
    geometry.applyMatrix4(mesh.matrixWorld);

    if (!spec.textured) bakeVertexColor(geometry, materialColor(mesh.material), spec.recolor);
    geometries.push(geometry);
  });

  if (geometries.length === 0) throw new Error(`Model ${spec.url} contains no meshes`);

  harmoniseAttributes(geometries);

  const merged =
    geometries.length === 1
      ? (geometries[0] as THREE.BufferGeometry)
      : (mergeGeometries(geometries, false) ?? (geometries[0] as THREE.BufferGeometry));

  // --- Normalise into world units ---
  if (spec.rotationY) {
    merged.applyMatrix4(new THREE.Matrix4().makeRotationY(spec.rotationY));
  }

  merged.computeBoundingBox();
  const size = new THREE.Vector3();
  merged.boundingBox!.getSize(size);

  const scale = new THREE.Vector3(1, 1, 1);
  if (spec.fitBox) {
    if (size.x > 0) scale.x = spec.fitBox[0] / size.x;
    if (size.y > 0) scale.y = spec.fitBox[1] / size.y;
    if (size.z > 0) scale.z = spec.fitBox[2] / size.z;
  } else if (spec.fitHeight && size.y > 0) {
    scale.setScalar(spec.fitHeight / size.y);
  } else if (spec.fitWidth && size.x > 0) {
    scale.setScalar(spec.fitWidth / size.x);
  }

  if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
    merged.applyMatrix4(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z));
    // Non-uniform scale invalidates the normals' unit length.
    if (scale.x !== scale.y || scale.y !== scale.z) merged.computeVertexNormals();
  }

  merged.computeBoundingBox();
  const scaled = merged.boundingBox!;
  const centreX = (scaled.min.x + scaled.max.x) / 2;
  const centreZ = (scaled.min.z + scaled.max.z) / 2;
  // Centre horizontally and stand it on the ground, so callers position by the
  // lane centre and a Y of zero rather than by each model's own pivot.
  const baseY = spec.groundAlign === false ? 0 : -scaled.min.y;

  merged.applyMatrix4(
    new THREE.Matrix4().makeTranslation(-centreX, baseY + (spec.offsetY ?? 0), -centreZ),
  );
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  // Phong so imported art picks up the same specular the procedural props do -
  // a rock or a pine next to a glossy chalet with no highlight of its own reads
  // as belonging to a different game.
  const material = spec.textured
    ? new THREE.MeshPhongMaterial({
        map: atlas,
        flatShading: true,
        specular: new THREE.Color(GLOSS.prop.specular),
        shininess: GLOSS.prop.shininess,
      })
    : new THREE.MeshPhongMaterial({
        vertexColors: true,
        flatShading: meshCount > 1,
        specular: new THREE.Color(GLOSS.prop.specular),
        shininess: GLOSS.prop.shininess,
      });

  if (import.meta.env.DEV && !reported.has(spec.url)) {
    reported.add(spec.url);
    const final = new THREE.Vector3();
    merged.boundingBox!.getSize(final);
    console.warn(
      `[model] ${spec.url.split('/').pop()} meshes=${meshCount} textured=${spec.textured ?? false} ` +
        `-> ${final.x.toFixed(2)} x ${final.y.toFixed(2)} x ${final.z.toFixed(2)}`,
    );
  }

  return { geometry: merged, material };
}

/**
 * Loads and normalises a model. Cached by drei per URL, and the preparation is
 * memoised per spec, so this runs once regardless of how many components use it.
 */
export function useModel(spec: ModelSpec): PreparedModel {
  const gltf = useGLTF(spec.url);
  // Loaded unconditionally: it is a single 12 KB atlas shared by every textured
  // model, and loading it here keeps the hook order stable across specs.
  const atlas = useTexture(colormapUrl);

  return useMemo(
    () => prepare(gltf.scene, spec, configureAtlas(atlas)),
    // The spec is a module-level constant at every call site.
    [gltf, spec, atlas],
  );
}

/** Warms the cache so the first frame of a run is not the first load. */
export function preloadModels(urls: readonly string[]): void {
  for (const url of urls) useGLTF.preload(url);
}
