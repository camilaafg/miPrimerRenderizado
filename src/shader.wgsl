// shader.wgsl
// The uniform struct and vertex pipeline are already wired up for you.
// model_id values:
//   0 = Flat implemented
//   1 = Gouraud TODO
//   2 = Phong TODO
//   3 = Blinn-Phong TODO
//
// Useful WGSL built-ins:
//   normalize(v) — returns unit vector
//   dot(a, b) — scalar dot product
//   reflect(I, N) — reflects incident vector I around normal N
//   max(a, b) — component-wise max
//   pow(base, exp) — power function
//   dpdx(v), dpdy(v) — screen-space partial derivatives (fragment stage only)
//   cross(a, b)— cross product

// ── Uniform block
struct Uniforms {
  mvp        : mat4x4<f32>,  // Model-View-Projection matrix
  model      : mat4x4<f32>,  // Model matrix (object -> world space)
  normalMat  : mat4x4<f32>,  // transpose(inverse(model)) — keeps normals correct under scale

  lightPos   : vec3<f32>,    // Light position in world space
  _p0        : f32,

  lightColor : vec3<f32>,    // RGB light colour
  _p1        : f32,

  ambient    : f32,          // Ka — ambient coefficient
  diffuse    : f32,          // Kd — diffuse coefficient
  specular   : f32,          // Ks — specular coefficient
  shininess  : f32,          // n  — specular exponent 

  camPos     : vec3<f32>,    // Camera position in world space
  model_id   : u32,          // Which lighting model to use (0–3)

  objectColor : vec3<f32>,   // Base colour of the object
  time        : f32,         // Elapsed seconds
};

@group(0) @binding(0) var<uniform> u : Uniforms;

// ── Vertex shader I/O 
struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
  //@location(4) bary: vec3<f32>
};

struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,   // fragment position in world space
  @location(1) worldNormal   : vec3<f32>,   // interpolated world-space normal
  @location(2) uv            : vec2<f32>,
  // TODO (Gouraud): compute and store the light colour here in vs_main,
  // then read it back in fs_main instead of re-computing lighting per fragment
  @location(3) gouraudColor  : vec3<f32>,
  //@location(4) bary: vec3<f32>
};


//Flat shading
// Flat shading uses ONE normal per triangle face instead of per-vertex normals.
// We derive it in the fragment shader using screen-space derivatives:
//   dpdx(p) = how much world-position changes horizontally across one pixel
//   dpdy(p) = how much world-position changes vertically
//   cross(dpdx, dpdy) gives the face normal pointing toward the camera.

fn flatShading(fragWorldPos: vec3<f32>) -> vec3<f32> {
  // Derive the face normal from position derivatives
  let dx    = dpdx(fragWorldPos);
  let dy    = dpdy(fragWorldPos);
  let faceN = normalize(cross(dx, dy));

  // ── Standard lighting terms
  let L = normalize(u.lightPos - fragWorldPos);  // direction TO the light
  let V = normalize(u.camPos   - fragWorldPos);  // direction TO the camera

  // Ambient: constant low-level light so dark side isn't pure black
  let ambientC = u.ambient * u.lightColor;

  // Diffuse: Lambertian — cos(angle between N and L), clamped to [0,1]
  let NdotL    = max(dot(faceN, L), 0.0);
  let diffuseC = u.diffuse * NdotL * u.lightColor;

  // Specular: Phong reflection — angle between reflected light and view direction
  var specularC = vec3<f32>(0.0);
  if NdotL > 0.0 {
    let R = reflect(-L, faceN);                              // perfect mirror direction
    let RdotV = max(dot(R, V), 0.0);
    specularC = u.specular * pow(RdotV, u.shininess) * u.lightColor;
  }

  return (ambientC + diffuseC + specularC) * u.objectColor;
}

// ── TODO 1 of 3: Gouraud shading
// Called ONCE PER VERTEX in vs_main, not per fragment.

fn gouraudLighting(N: vec3<f32>, vertWorldPos: vec3<f32>) -> vec3<f32> {
  // TODO: implement Gouraud lighting.
  // Placeholder — shows magenta so it is not finished
  return vec3<f32>(1.0, 0.0, 1.0);
}


// ── TODO 2 of 3: Phong shading 
// Called ONCE PER FRAGMENT in fs_main.
fn phongLighting(N: vec3<f32>, fragWorldPos: vec3<f32>) -> vec3<f32> {
  // TODO: implement Phong per-fragment lighting.
  // Placeholder — shows cyan so it is not finished
  return vec3<f32>(0.0, 1.0, 1.0);
}

// ── TODO 3 of 3: Blinn-Phong shading 
// Called ONCE PER FRAGMENT in fs_main.
fn blinnPhongLighting(N: vec3<f32>, fragWorldPos: vec3<f32>) -> vec3<f32> {
  // TODO: implement Blinn-Phong per-fragment lighting.
  // Placeholder — shows yellow so it is not finished
  return vec3<f32>(1.0, 1.0, 0.0);
}

// ── Vertex shader
// Transforms geometry to clip space and prepares interpolated data for the fragment shader.
@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;

  let worldPos4    = u.model    * vec4<f32>(input.position, 1.0);
  let worldNormal4 = u.normalMat * vec4<f32>(input.normal, 0.0);

  out.clipPos     = u.mvp * vec4<f32>(input.position, 1.0);
  out.worldPos    = worldPos4.xyz;
  out.worldNormal = normalize(worldNormal4.xyz);
  out.uv          = input.uv;
  //out.bary = input.bary;

  // TODO (Gouraud): call gouraudLighting() here and store the result.
  // When model_id == 1u, compute lighting per vertex so the fragment shader can just read out.gouraudColor directly without any extra work.
  if u.model_id == 1u {
    out.gouraudColor = gouraudLighting(out.worldNormal, out.worldPos);
  } else {
    out.gouraudColor = vec3<f32>(0.0);
  }

  return out;
}

// ── Fragment shader
// Dispatches to the correct lighting function based on model_id
// Do NOT need to modify the switch
@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  var color: vec3<f32>;
  let N = normalize(input.worldNormal);  // smooth interpolated normal

  switch u.model_id {
    case 0u: {
      // Flat — already done, use as reference
      color = flatShading(input.worldPos);
    }
    case 1u: {
      // Gouraud — colour was computed per-vertex and interpolated by GPU
      color = input.gouraudColor;
    }
    case 2u: {
      // Phong — implement phongLighting() above
      color = phongLighting(N, input.worldPos);
    }
    default: {
      // Blinn-Phong — implement blinnPhongLighting() above
      color = blinnPhongLighting(N, input.worldPos);
    }
  }

  return vec4<f32>(color, 1.0);
}