// Final pass (owner: modeller): tone map + sRGB + box-filter downsample in one step, alpha-aware.
// Input: premultiplied linear HDR from the composer at `ss` x the output size. Each big pixel is un-premultiplied,
// tone mapped, sRGB encoded and re-premultiplied BEFORE averaging, so edges and shadows filter correctly.
// Glow that carries light but no coverage (bloom) is folded into alpha so a straight-alpha PNG can hold it.
import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const vertexShader = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tCoverage; // the frame before bloom: bloom's additive blend also writes alpha, so coverage comes from here
uniform vec2 uBigSize;
uniform vec4 uBg;
uniform float uSat;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
vec3 tone(vec3 c) {
  #ifdef AGX_TONE_MAPPING
    return AgXToneMapping(c);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
    return ACESFilmicToneMapping(c);
  #elif defined(NEUTRAL_TONE_MAPPING)
    return NeutralToneMapping(c);
  #else
    return LinearToneMapping(c);
  #endif
}
void main() {
  vec2 outPx = floor(gl_FragCoord.xy);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < SS; j++) {
    for (int i = 0; i < SS; i++) {
      vec2 p = (outPx * float(SS) + vec2(float(i), float(j)) + 0.5) / uBigSize;
      vec4 t = texture2D(tDiffuse, p);
      float a = clamp(texture2D(tCoverage, p).a, 0.0, 1.0);
      vec3 c = max(t.rgb, vec3(0.0));
      // glow with no coverage (bloom halo outside the silhouette) is dropped: it would haze the transparent background
      float ae = a;
      vec3 straight = c / max(ae, 1e-3);
      vec3 col = tone(straight);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(l), col, uSat), vec3(0.0));
      col = sRGBTransferOETF(vec4(col, 1.0)).rgb;
      acc += vec4(col * ae, ae);
    }
  }
  acc /= float(SS * SS);
  vec4 o = acc;
  if (uBg.a > 0.5) { o = vec4(acc.rgb + (1.0 - acc.a) * uBg.rgb, 1.0); }
  gl_FragColor = o;
}`;

export class FinishPass extends Pass {
  /** coverage: a render target holding the pre-bloom frame (see SavePass); null = use the frame's own alpha */
  constructor({ coverage = null, ss = 3, bigSize = [1, 1], toneMapping = THREE.AgXToneMapping, exposure = 1, bg = null, saturation = 1 } = {}) {
    super();
    this.coverage = coverage;
    this.uniforms = {
      tDiffuse: { value: null },
      tCoverage: { value: null },
      toneMappingExposure: { value: exposure },
      uBigSize: { value: new THREE.Vector2(bigSize[0], bigSize[1]) },
      uBg: { value: new THREE.Vector4(0, 0, 0, 0) },
      uSat: { value: saturation },
    };
    const defines = { SS: ss, SRGB_TRANSFER: "" };
    if (toneMapping === THREE.AgXToneMapping) defines.AGX_TONE_MAPPING = "";
    else if (toneMapping === THREE.ACESFilmicToneMapping) defines.ACES_FILMIC_TONE_MAPPING = "";
    else if (toneMapping === THREE.NeutralToneMapping) defines.NEUTRAL_TONE_MAPPING = "";
    else defines.LINEAR_TONE_MAPPING = "";
    this.material = new THREE.RawShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, defines });
    this._quad = new FullScreenQuad(this.material);
    if (bg) this.setBackground(bg);
  }
  /** bg: a CSS colour string (sRGB) or null for transparent. */
  setBackground(bg) {
    if (!bg) this.uniforms.uBg.value.set(0, 0, 0, 0);
    else {
      // the shader adds display-referred (sRGB-encoded) values, so hand it the encoded colour, not the linear one
      const c = new THREE.Color();
      c.setStyle(bg, THREE.SRGBColorSpace);
      const enc = c.clone().convertLinearToSRGB();
      this.uniforms.uBg.value.set(enc.r, enc.g, enc.b, 1);
    }
  }
  render(renderer, _writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tCoverage.value = this.coverage ? this.coverage.texture : readBuffer.texture;
    renderer.setRenderTarget(null);
    this._quad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this._quad.dispose();
  }
}
