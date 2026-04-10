export const gui = {
  modelId: 0,
  ambient: 0.12,
  diffuse: 0.75,
  specular: 0.60,
  shininess: 32,
  lightX: 3.0,
  lightY: 4.0,
  lightZ: 3.0,
  autoRotLight: true,
  objectColor: "#4a9eff",
  lightColor: "#ffffff",
};

export let wireframe = false;
export type GuiShape = "cube" | "sphere" | "beacon" | "teapot";

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function updateLightDisplay(lx: number, lz: number) {
  (document.getElementById("lightX") as HTMLInputElement).value = lx.toFixed(1);
  document.getElementById("lightX-val")!.textContent = lx.toFixed(1);
  (document.getElementById("lightZ") as HTMLInputElement).value = lz.toFixed(1);
  document.getElementById("lightZ-val")!.textContent = lz.toFixed(1);
}

function slider(id: string, label: string, min: number, max: number, step: number, val: number) {
  return `
  <div class="slider-row">
    <span class="slider-label">${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="slider-val" id="${id}-val">${val}</span>
  </div>`;
}

export function initGUI(onShapeChange: (shape: GuiShape) => void) {
  const overlay = document.createElement("div");
  overlay.id = "gui";
  overlay.innerHTML = `
<div class="gui-panel">
  <div class="gui-title">Lighting Assignment</div>

  <div class="gui-section">
    <div class="gui-label">Shading Model</div>
    <div class="model-btns">
      <button class="model-btn active" data-id="0">Flat</button>
      <button class="model-btn" data-id="1">Gouraud</button>
      <button class="model-btn" data-id="2">Phong</button>
      <button class="model-btn" data-id="3">Blinn-Phong</button>
    </div>
  </div>

  <div class="gui-section">
    <div class="gui-label">Geometry</div>
    <div class="model-btns">
      <button class="shape-btn active" data-shape="cube">Cube</button>
      <button class="shape-btn" data-shape="sphere">Sphere</button>
      <button class="shape-btn" data-shape="beacon">Beacon</button>
      <button class="shape-btn" data-shape="teapot">Teapot</button>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="wireframeToggle"> Wireframe
    </label>
  </div>

  <div class="gui-section">
    <div class="gui-label">Material</div>
    ${slider("ambient", "Ambient (Ka)", 0, 1, 0.01, gui.ambient)}
    ${slider("diffuse", "Diffuse (Kd)", 0, 1, 0.01, gui.diffuse)}
    ${slider("specular", "Specular (Ks)", 0, 1, 0.01, gui.specular)}
    ${slider("shininess", "Shininess (n)", 1, 256, 1, gui.shininess)}
  </div>

  <div class="gui-section">
    <div class="gui-label">Light</div>
    ${slider("lightX", "X", -8, 8, 0.1, gui.lightX)}
    ${slider("lightY", "Y", -8, 8, 0.1, gui.lightY)}
    ${slider("lightZ", "Z", -8, 8, 0.1, gui.lightZ)}
    <label class="checkbox-row">
      <input type="checkbox" id="autoRotLight" checked> Auto-rotate light
    </label>
  </div>

  <div class="gui-section">
    <div class="gui-label">Colors</div>
    <div class="color-row"><span>Object</span><input type="color" id="objectColor" value="${gui.objectColor}"></div>
    <div class="color-row"><span>Light</span><input type="color" id="lightColor" value="${gui.lightColor}"></div>
  </div>

  <div class="gui-hint">WASD/QE move · Arrows look</div>
</div>`;
  document.body.appendChild(overlay);

  document.querySelectorAll<HTMLButtonElement>(".model-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      gui.modelId = Number(btn.dataset.id);
      document.querySelectorAll(".model-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".shape-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const shape = btn.dataset.shape as GuiShape;
      document.querySelectorAll(".shape-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onShapeChange(shape);
    });
  });

  (["ambient", "diffuse", "specular", "shininess", "lightX", "lightY", "lightZ"] as const).forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement;
    const valEl = document.getElementById(`${id}-val`)!;
    el.addEventListener("input", () => {
      gui[id] = parseFloat(el.value);
      valEl.textContent = el.value;
    });
  });

  (document.getElementById("autoRotLight") as HTMLInputElement)
    .addEventListener("change", e => { gui.autoRotLight = (e.target as HTMLInputElement).checked; });

  (document.getElementById("objectColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.objectColor = (e.target as HTMLInputElement).value; });

  (document.getElementById("lightColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.lightColor = (e.target as HTMLInputElement).value; });

  (document.getElementById("wireframeToggle") as HTMLInputElement)
    .addEventListener("change", e => { wireframe = (e.target as HTMLInputElement).checked; });
}
