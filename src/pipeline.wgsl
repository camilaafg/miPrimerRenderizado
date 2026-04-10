struct Uniforms {
  mvp         : mat4x4<f32>,
  model       : mat4x4<f32>,
  normalMat   : mat4x4<f32>,
  lightPos    : vec4<f32>,
  lightColor  : vec4<f32>,
  material    : vec4<f32>,
  camPos      : vec4<f32>,
  objectColor : vec4<f32>,
  params      : vec4<f32>,
};

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
  @location(3) bary     : vec3<f32>,
};

struct GBufferOut {
  @location(0) color    : vec4<f32>,
  @location(1) normal   : vec4<f32>,
  @location(2) position : vec4<f32>,
};

struct GeometryOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,
  @location(1) worldNormal   : vec3<f32>,
  @location(2) uv            : vec2<f32>,
  @location(3) gouraudLight  : vec3<f32>,
  @location(4) bary          : vec3<f32>,
};

struct LightingOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) uv            : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var meshSampler : sampler;
@group(0) @binding(2) var meshTexture : texture_2d<f32>;

@group(1) @binding(0) var gSampler : sampler;
@group(1) @binding(1) var gColor : texture_2d<f32>;
@group(1) @binding(2) var gNormal : texture_2d<f32>;
@group(1) @binding(3) var gPosition : texture_2d<f32>;

fn lightingTerms(N: vec3<f32>, worldPos: vec3<f32>, useBlinn: bool) -> vec3<f32> {
  let L = normalize(u.lightPos.xyz - worldPos);
  let V = normalize(u.camPos.xyz - worldPos);
  let ambient = u.material.x * u.lightColor.xyz;
  let NdotL = max(dot(N, L), 0.0);
  let diffuse = u.material.y * NdotL * u.lightColor.xyz;

  var specular = vec3<f32>(0.0);
  if NdotL > 0.0 {
    if useBlinn {
      let H = normalize(L + V);
      specular = u.material.z * pow(max(dot(N, H), 0.0), u.material.w) * u.lightColor.xyz;
    } else {
      let R = reflect(-L, N);
      specular = u.material.z * pow(max(dot(R, V), 0.0), u.material.w) * u.lightColor.xyz;
    }
  }

  return ambient + diffuse + specular;
}

fn flatLighting(worldPos: vec3<f32>) -> vec3<f32> {
  let dx = dpdx(worldPos);
  let dy = dpdy(worldPos);
  let faceNormal = normalize(cross(dx, dy));
  return lightingTerms(faceNormal, worldPos, false);
}

fn gouraudLighting(N: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  return lightingTerms(normalize(N), worldPos, false);
}

fn phongLighting(N: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  return lightingTerms(normalize(N), worldPos, false);
}

fn blinnPhongLighting(N: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  return lightingTerms(normalize(N), worldPos, true);
}

fn textureColor(uv: vec2<f32>) -> vec3<f32> {
  return textureSample(meshTexture, meshSampler, fract(uv)).rgb;
}

fn edgeMask(bary: vec3<f32>) -> f32 {
  let edge = min(min(bary.x, bary.y), bary.z);
  let width = fwidth(edge) * 1.4;
  return 1.0 - smoothstep(0.0, width, edge);
}

fn applyWireframe(color: vec3<f32>, bary: vec3<f32>) -> vec3<f32> {
  let line = edgeMask(bary) * u.params.y;
  return mix(color, vec3<f32>(0.05, 0.05, 0.05), line);
}

@vertex
fn vs_geometry(input: VSIn) -> GeometryOut {
  var out: GeometryOut;
  let worldPos4 = u.model * vec4<f32>(input.position, 1.0);
  let worldNormal4 = u.normalMat * vec4<f32>(input.normal, 0.0);

  out.clipPos = u.mvp * vec4<f32>(input.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.worldNormal = normalize(worldNormal4.xyz);
  out.uv = input.uv;
  out.bary = input.bary;
  out.gouraudLight = gouraudLighting(out.worldNormal, out.worldPos);
  return out;
}

@fragment
fn fs_geometry(input: GeometryOut) -> GBufferOut {
  var out: GBufferOut;
  let baseColor = textureColor(input.uv);
  let modelId = u.params.x;

  var shaded = baseColor;
  if modelId < 0.5 {
    shaded = flatLighting(input.worldPos) * baseColor;
  } else if modelId < 1.5 {
    shaded = input.gouraudLight * baseColor;
  }

  out.color = vec4<f32>(applyWireframe(shaded, input.bary), 1.0);
  out.normal = vec4<f32>(normalize(input.worldNormal), 1.0);
  out.position = vec4<f32>(input.worldPos, 1.0);
  return out;
}

@vertex
fn vs_lighting(@builtin(vertex_index) vertexIndex: u32) -> LightingOut {
  var out: LightingOut;
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(3.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );

  let clip = positions[vertexIndex];
  out.clipPos = vec4<f32>(clip, 0.0, 1.0);
  out.uv = clip * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}

@fragment
fn fs_lighting(input: LightingOut) -> @location(0) vec4<f32> {
  let baseColor = textureSample(gColor, gSampler, input.uv).rgb;
  let worldNormal = normalize(textureSample(gNormal, gSampler, input.uv).xyz);
  let worldPos = textureSample(gPosition, gSampler, input.uv).xyz;
  let modelId = u.params.x;

  if u.params.z > 0.5 {
    return vec4<f32>(worldNormal * 0.5 + vec3<f32>(0.5), 1.0);
  }

  if modelId < 1.5 {
    return vec4<f32>(baseColor, 1.0);
  }

  if modelId < 2.5 {
    return vec4<f32>(phongLighting(worldNormal, worldPos) * baseColor, 1.0);
  }

  return vec4<f32>(blinnPhongLighting(worldNormal, worldPos) * baseColor, 1.0);
}
