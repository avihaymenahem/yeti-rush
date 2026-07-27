/**
 * Builds a single vertex-coloured geometry from a set of primitives.
 *
 * three.js issues one draw call per mesh and does not batch siblings, even when
 * they share a material. Anything assembled from a dozen little meshes costs a
 * dozen calls - and for an obstacle that is *instanced* across the whole track,
 * that multiplies. Merging the parts into one geometry with their colours baked
 * into vertex attributes keeps every kind at exactly one instanced draw call,
 * however detailed it is.
 *
 * Shared by the yeti and the procedural props.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLOSS } from '@/game/config/visuals';

export interface Piece {
  geometry: THREE.BufferGeometry;
  color: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
}

export function bakeColor(geometry: THREE.BufferGeometry, color: string): void {
  const rgb = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = rgb.r;
    colors[i * 3 + 1] = rgb.g;
    colors[i * 3 + 2] = rgb.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Transforms, colours and merges a set of primitives into one geometry. */
export function assemble(pieces: Piece[]): THREE.BufferGeometry {
  const parts = pieces.map((piece) => {
    let geometry = piece.geometry;

    if (piece.scale !== undefined) {
      const s = piece.scale;
      const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
      geometry.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
    }
    if (piece.rotation) {
      const [rx, ry, rz] = piece.rotation;
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    }
    if (piece.position) {
      const [px, py, pz] = piece.position;
      geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(px, py, pz));
    }

    // Everything is flattened to non-indexed before merging. `mergeGeometries`
    // refuses to mix indexed and non-indexed sources, and three's primitives
    // are indexed while anything hand-authored here is not - so mixing the two
    // returns null and takes the whole scene down. Normalising removes the
    // constraint instead of relying on every caller remembering it.
    if (geometry.index) {
      const expanded = geometry.toNonIndexed();
      geometry.dispose();
      geometry = expanded;
    }

    bakeColor(geometry, piece.color);
    return geometry;
  });

  const merged = mergeGeometries(parts, false);
  // Sources are discarded immediately; only the merged result is ever uploaded.
  for (const part of parts) part.dispose();

  if (!merged) {
    throw new Error(
      `mergeParts: failed to merge ${parts.length} geometries - check they share attributes`,
    );
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * One material for everything built this way.
 *
 * Phong rather than Lambert so the low sun and the cool rim light actually
 * glint off the geometry - see `GLOSS` in `config/visuals`. Flat shading keeps
 * the highlight faceted, which suits low-poly far better than a smooth sweep.
 */
export interface GlossSpec {
  /** Highlight colour, and therefore its strength - a dark specular is subtle. */
  specular: string;
  /** Higher is a tighter, sharper highlight. */
  shininess: number;
}

export function vertexColorMaterial(gloss: GlossSpec = GLOSS.prop): THREE.Material {
  return new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    specular: new THREE.Color(gloss.specular),
    shininess: gloss.shininess,
  });
}

/**
 * A right-angled wedge: flat base, a face sloping up from the near edge, and a
 * vertical back. A take-off kicker.
 *
 * Hand-authored rather than derived from a cylinder because the profile is a
 * right triangle, not an isosceles one - the slope has to start at ground level
 * on the approach side and finish at full height on the lip.
 *
 * Built ground-aligned and centred on X and Z. Non-indexed, so every triangle
 * owns its vertices and `computeVertexNormals` yields flat faces.
 *
 * +Z is the approach side: obstacles travel from -Z towards the camera, so the
 * rider meets the near face first and launches off the far edge.
 */
export function wedge(width: number, height: number, depth: number): THREE.BufferGeometry {
  const x = width / 2;
  const z = depth / 2;

  // Six corners: four on the base, two on the raised back edge.
  const frontLeft: [number, number, number] = [-x, 0, z];
  const frontRight: [number, number, number] = [x, 0, z];
  const backLeft: [number, number, number] = [-x, 0, -z];
  const backRight: [number, number, number] = [x, 0, -z];
  const topLeft: [number, number, number] = [-x, height, -z];
  const topRight: [number, number, number] = [x, height, -z];

  const triangles: [number, number, number][][] = [
    // Base.
    [frontLeft, backRight, frontRight],
    [frontLeft, backLeft, backRight],
    // The ride surface, sloping from the near edge up to the lip.
    [frontLeft, topRight, topLeft],
    [frontLeft, frontRight, topRight],
    // Vertical back.
    [backLeft, topLeft, topRight],
    [backLeft, topRight, backRight],
    // Sides.
    [frontLeft, topLeft, backLeft],
    [frontRight, backRight, topRight],
  ];

  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach((triangle, t) => {
    triangle.forEach((vertex, v) => {
      positions.set(vertex, t * 9 + v * 3);
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  // Matched to every other primitive so merges never fail on a missing attribute.
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  return geometry;
}

/**
 * A triangular prism running along Z - a gable end, a roof ridge, a wedge.
 *
 * Built from a 3-sided cylinder, which is exactly a triangular prism, rather
 * than by hand-authoring vertices.
 */
export function prism(width: number, height: number, depth: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 3);
  // Lay the prism on its side so its length runs along Z, then square it up so
  // the flat face is the base rather than a vertex.
  geometry.rotateY(Math.PI / 2);
  geometry.rotateZ(-Math.PI / 2);
  geometry.computeBoundingBox();

  const box = geometry.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  geometry.scale(width / size.x, height / size.y, depth / size.z);

  // Sit it on y = 0 so callers position by the base.
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry;
}
