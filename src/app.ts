import "./style.css";
import shaderCode from "./pipeline.wgsl?raw";
import { gui, hexToRgb, initGUI, updateLightDisplay, updateZoomDisplay, wireframe, type GuiShape } from "./guiControls";
import { mat4, vec3 } from "./math";
import type { Vec3 } from "./math";
import { createCubeMesh, createSphereMesh, parseOBJ, type BoundsPreset, type IndexedMesh } from "./mesh";
import { OrbitCamera } from "./orbitCamera";

if (!navigator.gpu) throw new Error("WebGPU not supported");

const canvas = document.querySelector("#gfx-main") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #gfx-main not found");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No GPU adapter found");

const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
if (!context) throw new Error("Unable to create WebGPU context");

const format = navigator.gpu.getPreferredCanvasFormat();
const shader = device.createShaderModule({ label: "Object Order Pipeline", code: shaderCode });

const FOV = (60 * Math.PI) / 180;
const FIT_RADIUS = 1.05;
const UNIFORM_SIZE = 288;

type ShapeName = GuiShape;
type SceneGeometry = {
  mesh: IndexedMesh;
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  fitMatrix: Float32Array;
};

const shapeSources: Record<ShapeName, { url: string; name: string; preset: BoundsPreset; fallback: () => IndexedMesh }> = {
  cube: {
    url: "",
    name: "cube",
    preset: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    fallback: () => createCubeMesh(),
  },
  sphere: {
    url: "",
    name: "sphere",
    preset: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    fallback: () => createSphereMesh(48, 48),
  },
  beacon: {
    url: "/models/KAUST_Beacon.obj",
    name: "beacon",
    preset: { kind: "sphere", center: [125, 125, 125], radius: 125 },
    fallback: () => createCubeMesh(),
  },
  teapot: {
    url: "/models/teapot.obj",
    name: "teapot",
    preset: {
      kind: "box",
      center: [0.217, 1.575, 0],
      min: [-3, 0, -2],
      max: [3.434, 3.15, 2],
    },
    fallback: () => createSphereMesh(48, 48),
  },
};

const meshCache = new Map<ShapeName, Promise<IndexedMesh>>();
let currentObjectColorHex = gui.objectColor;

function createSolidTexture(color: [number, number, number]) {
  const size = 4;
  const pixels = new Uint8Array(size * size * 4);
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);

  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    pixels[idx + 0] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  }

  const texture = device.createTexture({
    size: [size, size, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.writeTexture(
    { texture },
    pixels,
    { bytesPerRow: size * 4 },
    { width: size, height: size, depthOrArrayLayers: 1 },
  );

  return texture;
}

function buildSceneGeometry(mesh: IndexedMesh): SceneGeometry {
  const vertexBuffer = device.createBuffer({
    size: mesh.renderVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(vertexBuffer, 0, mesh.renderVertices);

  const scale = 1 / mesh.radius;
  const fitMatrix = mat4.multiply(
    mat4.scaling(scale, scale, scale),
    mat4.translation(-mesh.center[0], -mesh.center[1], -mesh.center[2]),
  );

  return {
    mesh,
    vertexBuffer,
    vertexCount: mesh.renderVertices.length / 11,
    fitMatrix,
  };
}

function computeClipPlanes(): { near: number; far: number } {
  const objectDistance = Math.max(vec3.length(camera.position), FIT_RADIUS + 0.05);
  const near = Math.max(0.01, objectDistance - FIT_RADIUS * 1.5);
  const far = Math.max(near + 4, objectDistance + FIT_RADIUS * 3.0);
  return { near, far };
}

async function loadShapeMesh(shape: ShapeName): Promise<IndexedMesh> {
  const cached = meshCache.get(shape);
  if (cached) return cached;

  const source = shapeSources[shape];
  const promise = (async () => {
    try {
      if (!source.url) return source.fallback();
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`Missing ${source.url}`);
      const text = await response.text();
      const mesh = parseOBJ(text, source.name, source.preset);
      if (mesh.indices.length === 0 || mesh.positions.length === 0) throw new Error(`Empty mesh in ${source.url}`);
      return mesh;
    } catch {
      return source.fallback();
    }
  })();

  meshCache.set(shape, promise);
  return promise;
}

let depthTexture: GPUTexture | null = null;
let gColorTexture: GPUTexture | null = null;
let gNormalTexture: GPUTexture | null = null;
let gPositionTexture: GPUTexture | null = null;
let lightingBindGroup: GPUBindGroup | null = null;
let geometryBindGroup: GPUBindGroup;

const uniformBuffer = device.createBuffer({
  size: UNIFORM_SIZE,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const uniformDataBuffer = new ArrayBuffer(UNIFORM_SIZE);
const uniformData = new Float32Array(uniformDataBuffer);

let defaultMaterialTexture = createSolidTexture(hexToRgb(gui.objectColor));
let currentMaterialTexture = defaultMaterialTexture;
let usingCustomTexture = false;
const materialSampler = device.createSampler({
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "linear",
  addressModeU: "repeat",
  addressModeV: "repeat",
});

const gBufferSampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
});

const geometryPipeline = device.createRenderPipeline({
  label: "Geometry Pipeline",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_geometry",
    buffers: [{
      arrayStride: 11 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
        { shaderLocation: 2, offset: 6 * 4, format: "float32x2" },
        { shaderLocation: 3, offset: 8 * 4, format: "float32x3" },
      ],
    }],
  },
  fragment: {
    module: shader,
    entryPoint: "fs_geometry",
    targets: [
      { format: "rgba16float" },
      { format: "rgba16float" },
      { format: "rgba16float" },
    ],
  },
  primitive: { topology: "triangle-list", cullMode: "none" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

const lightingPipeline = device.createRenderPipeline({
  label: "Lighting Pipeline",
  layout: "auto",
  vertex: { module: shader, entryPoint: "vs_lighting" },
  fragment: { module: shader, entryPoint: "fs_lighting", targets: [{ format }] },
  primitive: { topology: "triangle-list" },
});

function rebuildGeometryBindGroup() {
  geometryBindGroup = device.createBindGroup({
    layout: geometryPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: materialSampler },
      { binding: 2, resource: currentMaterialTexture.createView() },
    ],
  });
}

const lightingUniformBindGroup = device.createBindGroup({
  layout: lightingPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});

rebuildGeometryBindGroup();

function createRenderTexture(textureFormat: GPUTextureFormat) {
  return device.createTexture({
    size: [canvas.width, canvas.height],
    format: textureFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}

function rebuildTargets() {
  canvas.width = Math.max(1, Math.floor(window.innerWidth * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * devicePixelRatio));
  context.configure({ device, format, alphaMode: "premultiplied" });

  depthTexture?.destroy();
  gColorTexture?.destroy();
  gNormalTexture?.destroy();
  gPositionTexture?.destroy();

  depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  gColorTexture = createRenderTexture("rgba16float");
  gNormalTexture = createRenderTexture("rgba16float");
  gPositionTexture = createRenderTexture("rgba16float");

  lightingBindGroup = device.createBindGroup({
    layout: lightingPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: gBufferSampler },
      { binding: 1, resource: gColorTexture.createView() },
      { binding: 2, resource: gNormalTexture.createView() },
      { binding: 3, resource: gPositionTexture.createView() },
    ],
  });
}

async function updateTextureFromFile(file: File | null) {
  if (!file) return;

  const image = await createImageBitmap(file);
  const texture = device.createTexture({
    size: [image.width, image.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: image },
    { texture },
    [image.width, image.height],
  );

  image.close();
  if (usingCustomTexture) {
    currentMaterialTexture.destroy();
  }
  currentMaterialTexture = texture;
  usingCustomTexture = true;
  rebuildGeometryBindGroup();
}

function rebuildDefaultTexture() {
  const previousDefault = defaultMaterialTexture;
  defaultMaterialTexture = createSolidTexture(hexToRgb(gui.objectColor));
  currentObjectColorHex = gui.objectColor;

  if (!usingCustomTexture) {
    currentMaterialTexture = defaultMaterialTexture;
    rebuildGeometryBindGroup();
  }

  previousDefault.destroy();
}

function resetTextureToDefault() {
  if (usingCustomTexture) {
    currentMaterialTexture.destroy();
  }
  if (gui.objectColor !== currentObjectColorHex) {
    const previousDefault = defaultMaterialTexture;
    defaultMaterialTexture = createSolidTexture(hexToRgb(gui.objectColor));
    currentObjectColorHex = gui.objectColor;
    previousDefault.destroy();
  }
  currentMaterialTexture = defaultMaterialTexture;
  usingCustomTexture = false;
  rebuildGeometryBindGroup();
}

function syncZoomSlider() {
  updateZoomDisplay(camera.getZoomPercent() * 100);
}

rebuildTargets();
window.addEventListener("resize", rebuildTargets);

const camera = new OrbitCamera();
const keys = new Set<string>();

let normalDebugEnabled = false;
let rotationMatrix = mat4.identity();
let isDragging = false;
let lastVec: Vec3 = [0, 0, 0];
let loadVersion = 0;

let scene = buildSceneGeometry(await loadShapeMesh("cube"));
camera.fitToSphere(FIT_RADIUS, FOV, canvas.width / canvas.height);
syncZoomSlider();
window.addEventListener("resize", () => {
  camera.fitToSphere(FIT_RADIUS, FOV, canvas.width / canvas.height);
  syncZoomSlider();
});

function projectToSphere(x: number, y: number): Vec3 {
  const rect = canvas.getBoundingClientRect();
  const nx = 1 - (2 * (x - rect.left) / rect.width);
  const ny = 1 - (2 * (y - rect.top) / rect.height);
  const length = nx * nx + ny * ny;
  const nz = length > 1 ? 0 : Math.sqrt(1 - length);
  return vec3.normalize([nx, ny, nz]);
}

async function switchShape(shape: ShapeName) {
  const requestId = ++loadVersion;
  const mesh = await loadShapeMesh(shape);
  if (requestId !== loadVersion) return;

  const nextScene = buildSceneGeometry(mesh);
  scene.vertexBuffer.destroy();
  scene = nextScene;
  rotationMatrix = mat4.identity();
  camera.fitToSphere(FIT_RADIUS, FOV, canvas.width / canvas.height);
  syncZoomSlider();
}

initGUI({
  onShapeChange: (shape: GuiShape) => { void switchShape(shape); },
  onZoomChange: (value: number) => { camera.setZoomPercent(value / 100); },
  onTextureFile: (file: File | null) => { void updateTextureFromFile(file); },
  onUseDefaultTexture: () => { resetTextureToDefault(); },
});

canvas.addEventListener("mousedown", event => {
  isDragging = true;
  lastVec = projectToSphere(event.clientX, event.clientY);
});

canvas.addEventListener("mouseup", () => {
  isDragging = false;
});

canvas.addEventListener("mouseleave", () => {
  isDragging = false;
});

canvas.addEventListener("mousemove", event => {
  if (!isDragging) return;

  const current = projectToSphere(event.clientX, event.clientY);
  const axis = vec3.cross(current, lastVec);
  const axisLength = vec3.length(axis);
  const dot = Math.max(-1, Math.min(1, vec3.dot(lastVec, current)));
  const angle = Math.acos(dot);

  if (axisLength > 1e-5 && angle > 1e-5) {
    rotationMatrix = mat4.multiply(mat4.axisRotation(axis, angle), rotationMatrix);
  }

  lastVec = current;
});

canvas.addEventListener("wheel", event => {
  event.preventDefault();
  camera.zoom(event.deltaY);
  syncZoomSlider();
}, { passive: false });

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (!event.repeat && key === "f") {
    const toggle = document.getElementById("wireframeToggle") as HTMLInputElement | null;
    if (toggle) {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event("change"));
    }
    return;
  }

  if (!event.repeat && key === "n") {
    normalDebugEnabled = !normalDebugEnabled;
    return;
  }

  keys.add(event.key);
});

window.addEventListener("keyup", event => {
  keys.delete(event.key);
});

function computeLightPosition(time: number): Vec3 {
  let offsetX = gui.lightX;
  const offsetY = Math.abs(gui.lightY) + 2.0;
  let offsetZ = gui.lightZ;

  if (gui.autoRotLight) {
    offsetX = Math.cos(time * 0.8) * 3.6;
    offsetZ = Math.sin(time * 0.8) * 3.6;
    updateLightDisplay(offsetX, offsetZ);
  }

  return [
    camera.position[0] + offsetX,
    camera.position[1] + offsetY,
    camera.position[2] + offsetZ,
  ];
}

let lastTime = performance.now();
const startTime = performance.now();

function frame(now: number) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  camera.update(keys, dt);
  syncZoomSlider();

  if (!usingCustomTexture && gui.objectColor !== currentObjectColorHex) {
    rebuildDefaultTexture();
  }

  const time = (now - startTime) / 1000;
  const aspect = canvas.width / canvas.height;
  const view = camera.getViewMatrix();
  const { near, far } = computeClipPlanes();
  const projection = mat4.perspective(FOV, aspect, near, far);
  const model = mat4.multiply(rotationMatrix, scene.fitMatrix);
  const normalMatrix = mat4.normalMatrix(model);
  const mvp = mat4.multiply(mat4.multiply(projection, view), model);
  const lightPosition = computeLightPosition(time);
  const [objectR, objectG, objectB] = hexToRgb(gui.objectColor);
  const [lightR, lightG, lightB] = hexToRgb(gui.lightColor);

  uniformData.set(mvp, 0);
  uniformData.set(model, 16);
  uniformData.set(normalMatrix, 32);
  uniformData.set([lightPosition[0], lightPosition[1], lightPosition[2], 1], 48);
  uniformData.set([lightR, lightG, lightB, 1], 52);
  uniformData.set([gui.ambient, gui.diffuse, gui.specular, gui.shininess], 56);
  uniformData.set([camera.position[0], camera.position[1], camera.position[2], camera.distance], 60);
  uniformData.set([objectR, objectG, objectB, 1], 64);
  uniformData.set([gui.modelId, wireframe ? 1 : 0, normalDebugEnabled ? 1 : 0, time], 68);
  device.queue.writeBuffer(uniformBuffer, 0, uniformDataBuffer);

  const encoder = device.createCommandEncoder();

  const geometryPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: gColorTexture!.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: gNormalTexture!.createView(),
        clearValue: { r: 0, g: 0, b: 1, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: gPositionTexture!.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTexture!.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });

  geometryPass.setPipeline(geometryPipeline);
  geometryPass.setBindGroup(0, geometryBindGroup);
  geometryPass.setVertexBuffer(0, scene.vertexBuffer);
  geometryPass.draw(scene.vertexCount);
  geometryPass.end();

  const lightingPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.08, g: 0.08, b: 0.12, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });

  lightingPass.setPipeline(lightingPipeline);
  lightingPass.setBindGroup(0, lightingUniformBindGroup);
  lightingPass.setBindGroup(1, lightingBindGroup!);
  lightingPass.draw(3);
  lightingPass.end();

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
