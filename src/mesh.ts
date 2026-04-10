import type { Vec3 } from "./math";
import { vec3 } from "./math";

export type BoundsPreset =
  | { kind: "sphere"; center: Vec3; radius: number }
  | { kind: "box"; center: Vec3; min: Vec3; max: Vec3 };

export interface IndexedMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  faceNormals: Float32Array;
  renderVertices: Float32Array;
  center: Vec3;
  radius: number;
  min: Vec3;
  max: Vec3;
  triangleCount: number;
}

function parseIndex(value: string, count: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed === 0) return -1;
  return parsed > 0 ? parsed - 1 : count + parsed;
}

function computeBounds(positions: Vec3[]): { min: Vec3; max: Vec3; center: Vec3; radius: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const [x, y, z] of positions) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }

  const center: Vec3 = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];

  let radius = 0;
  for (const pos of positions) {
    radius = Math.max(radius, vec3.length(vec3.sub(pos, center)));
  }

  return { min, max, center, radius: Math.max(radius, 1e-4) };
}

function resolveBounds(positions: Vec3[], preset?: BoundsPreset) {
  if (!preset) return computeBounds(positions);

  if (preset.kind === "sphere") {
    const min: Vec3 = [
      preset.center[0] - preset.radius,
      preset.center[1] - preset.radius,
      preset.center[2] - preset.radius,
    ];
    const max: Vec3 = [
      preset.center[0] + preset.radius,
      preset.center[1] + preset.radius,
      preset.center[2] + preset.radius,
    ];
    return { min, max, center: preset.center, radius: preset.radius };
  }

  const half: Vec3 = [
    (preset.max[0] - preset.min[0]) * 0.5,
    (preset.max[1] - preset.min[1]) * 0.5,
    (preset.max[2] - preset.min[2]) * 0.5,
  ];

  return {
    min: preset.min,
    max: preset.max,
    center: preset.center,
    radius: Math.hypot(half[0], half[1], half[2]),
  };
}

function buildIndexedMesh(name: string, points: Vec3[], triangleIndices: number[], preset?: BoundsPreset): IndexedMesh {
  const bounds = resolveBounds(points, preset);
  const vertexCount = points.length;
  const triangleCount = Math.floor(triangleIndices.length / 3);

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const faceNormals = new Float32Array(triangleCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    const [x, y, z] = points[i];
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  for (let tri = 0; tri < triangleCount; tri++) {
    const i0 = triangleIndices[tri * 3 + 0];
    const i1 = triangleIndices[tri * 3 + 1];
    const i2 = triangleIndices[tri * 3 + 2];

    const p0 = points[i0];
    const p1 = points[i1];
    const p2 = points[i2];

    const edge1 = vec3.sub(p1, p0);
    const edge2 = vec3.sub(p2, p0);
    const faceNormal = vec3.normalize(vec3.cross(edge1, edge2));

    faceNormals[tri * 3 + 0] = faceNormal[0];
    faceNormals[tri * 3 + 1] = faceNormal[1];
    faceNormals[tri * 3 + 2] = faceNormal[2];

    normals[i0 * 3 + 0] += faceNormal[0];
    normals[i0 * 3 + 1] += faceNormal[1];
    normals[i0 * 3 + 2] += faceNormal[2];
    normals[i1 * 3 + 0] += faceNormal[0];
    normals[i1 * 3 + 1] += faceNormal[1];
    normals[i1 * 3 + 2] += faceNormal[2];
    normals[i2 * 3 + 0] += faceNormal[0];
    normals[i2 * 3 + 1] += faceNormal[1];
    normals[i2 * 3 + 2] += faceNormal[2];
  }

  for (let i = 0; i < vertexCount; i++) {
    const normal = vec3.normalize([
      normals[i * 3 + 0],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
    ]);

    normals[i * 3 + 0] = normal[0];
    normals[i * 3 + 1] = normal[1];
    normals[i * 3 + 2] = normal[2];

    const p = points[i];
    const local = vec3.sub(p, bounds.center);
    const length = Math.max(vec3.length(local), 1e-6);
    const theta = Math.atan2(local[2], local[0]);
    const phi = Math.acos(Math.max(-1, Math.min(1, local[1] / length)));

    uvs[i * 2 + 0] = (theta + Math.PI) / (2 * Math.PI);
    uvs[i * 2 + 1] = phi / Math.PI;
  }

  const barycentric: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  const renderVertices = new Float32Array(triangleCount * 3 * 11);
  let dst = 0;

  for (let tri = 0; tri < triangleCount; tri++) {
    for (let corner = 0; corner < 3; corner++) {
      const index = triangleIndices[tri * 3 + corner];
      renderVertices[dst++] = positions[index * 3 + 0];
      renderVertices[dst++] = positions[index * 3 + 1];
      renderVertices[dst++] = positions[index * 3 + 2];
      renderVertices[dst++] = normals[index * 3 + 0];
      renderVertices[dst++] = normals[index * 3 + 1];
      renderVertices[dst++] = normals[index * 3 + 2];
      renderVertices[dst++] = uvs[index * 2 + 0];
      renderVertices[dst++] = uvs[index * 2 + 1];
      renderVertices[dst++] = barycentric[corner][0];
      renderVertices[dst++] = barycentric[corner][1];
      renderVertices[dst++] = barycentric[corner][2];
    }
  }

  return {
    name,
    positions,
    normals,
    uvs,
    indices: new Uint32Array(triangleIndices),
    faceNormals,
    renderVertices,
    center: bounds.center,
    radius: bounds.radius,
    min: bounds.min,
    max: bounds.max,
    triangleCount,
  };
}

export function parseOBJ(text: string, name: string, preset?: BoundsPreset): IndexedMesh {
  const points: Vec3[] = [];
  const triangleIndices: number[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    const head = parts[0];

    if (head === "v" && parts.length >= 4) {
      points.push([
        Number.parseFloat(parts[1]),
        Number.parseFloat(parts[2]),
        Number.parseFloat(parts[3]),
      ]);
      continue;
    }

    if (head !== "f" || parts.length < 4) continue;

    const face = parts
      .slice(1)
      .map(part => parseIndex(part.split("/")[0], points.length))
      .filter(index => index >= 0);

    for (let i = 1; i + 1 < face.length; i++) {
      triangleIndices.push(face[0], face[i], face[i + 1]);
    }
  }

  return buildIndexedMesh(name, points, triangleIndices, preset);
}

export function createCubeMesh(): IndexedMesh {
  const points: Vec3[] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];

  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];

  return buildIndexedMesh("cube", points, indices);
}

export function createSphereMesh(stacks: number, slices: number): IndexedMesh {
  const points: Vec3[] = [];
  const indices: number[] = [];

  for (let stack = 0; stack <= stacks; stack++) {
    const v = stack / stacks;
    const phi = v * Math.PI;

    for (let slice = 0; slice <= slices; slice++) {
      const u = slice / slices;
      const theta = u * Math.PI * 2;
      points.push([
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ]);
    }
  }

  const row = slices + 1;
  for (let stack = 0; stack < stacks; stack++) {
    for (let slice = 0; slice < slices; slice++) {
      const a = stack * row + slice;
      const b = a + row;
      const c = a + 1;
      const d = b + 1;

      if (stack !== 0) indices.push(a, b, c);
      if (stack !== stacks - 1) indices.push(c, b, d);
    }
  }

  return buildIndexedMesh("sphere", points, indices);
}
