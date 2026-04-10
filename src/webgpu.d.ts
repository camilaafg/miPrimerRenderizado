declare interface Navigator {
  gpu: any;
}

declare type GPUBuffer = any;
declare type GPUBindGroup = any;
declare type GPUTexture = any;
declare type GPUTextureFormat = any;
declare type GPUCanvasContext = any;

declare const GPUBufferUsage: {
  UNIFORM: number;
  COPY_DST: number;
  VERTEX: number;
};

declare const GPUTextureUsage: {
  TEXTURE_BINDING: number;
  COPY_DST: number;
  RENDER_ATTACHMENT: number;
};
