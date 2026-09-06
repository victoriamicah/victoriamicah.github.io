// ---------------------------------------------------------------
// Hero — 3D depth parallax with a scroll-driven crane-in and a
// progressive depth-of-field blur. The finished hero holds, fully
// blurred, as a frosted backdrop that the page content scrolls over.
//
// Back to front:
//
//   assets/background.png  — the landscape with the couple painted out,
//                            displaced per-pixel by the background-only
//                            depth map (assets/backgroundOnlyDepth.png,
//                            white = near). The depth map also drives a
//                            gentle per-pixel dolly (perspective
//                            foreshortening) as the camera cranes in.
//   giant "&"              — the ampersand from the title, set MASSIVE
//                            in Bradford LL and floated in the mid ground
//                            behind the couple. Parallax-drifts and
//                            grows with the crane, fades near the end.
//   assets/Subjects.png    — the couple, cut out on transparency, the
//                            near plane: one rigid card that rises and
//                            enlarges the most, held sharpest until the
//                            very end when everything defocuses.
//
// Two passes: composite -> half-float render target -> golden-angle
// disc blur -> screen. Falls back to a plain cover image if WebGL or
// the Three.js module fails to load (see .hero__stage in styles.css).
// ---------------------------------------------------------------

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const canvas = document.getElementById("hero-canvas");
const heroEl = document.querySelector(".hero");
const overlayEl = document.querySelector(".hero__overlay");

// assets/Subjects.png is the full photo framing (3131x4007). The
// background plate + its depth map are a hair narrower — the photo
// cropped ~4.4% horizontally — so the background sample is squeezed on
// X to keep its full width in frame while its vertical scale still
// matches the subjects exactly.
const PHOTO_W = 3131;
const PHOTO_H = 4007;
const BG_X_SQUEEZE = 0.9556; // (896/1200) / (3131/4007)

// Blur radius at full scroll, as a fraction of the drawing buffer height.
const MAX_BLUR_FRAC = 0.017;

// The crane-in completes over this many viewport heights of scroll; past
// it the hero holds fully blurred as a backdrop for the content above.
const CRANE_VH = 1.6;

// Matches --serif in styles.css, where Bradford LL's @font-face lives.
const SERIF = '"Bradford LL", Georgia, "Times New Roman", serif';

// How long the pen takes to sweep across the hero title, in ms.
const WRITE_MS = 2000;

if (canvas && heroEl) {
  try {
    initHero();
  } catch (err) {
    // Leave the CSS cover-image fallback in place.
    console.warn("Hero parallax disabled:", err);
  }
}

function initHero() {
  const prefersReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // the blur pass is the resolve
    alpha: true,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- pass 1: composite --------------------------------------------
  const scene = new THREE.Scene();

  const uniforms = {
    uBg: { value: null },
    uBgDepth: { value: null },
    uSubj: { value: null },
    uAmp: { value: null },
    uAmpAspect: { value: 1 },
    uAmpReady: { value: 0 },
    uAmpSpanH: { value: 0.78 }, // "&" height as fraction of viewport height
    uName: { value: null },
    uNameAspect: { value: 5 },
    uNameReady: { value: 0 },
    uNameSpanW: { value: 0.82 }, // "Victoria  Micah" width as fraction of vw
    uPhotoRes: { value: new THREE.Vector2(PHOTO_W, PHOTO_H) },
    uBgSqueeze: { value: BG_X_SQUEEZE },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uScroll: { value: 0 },
    uReady: { value: 0 },
    uWrite: { value: prefersReduced ? 1 : 0 },
    uMotion: { value: prefersReduced ? 0.4 : 1 },
  };

  const loader = new THREE.TextureLoader();
  let loaded = 0;
  const markLoaded = () => {
    if (++loaded === 3) uniforms.uReady.value = 1;
  };

  loader.load("assets/bg-web.jpg", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    uniforms.uBg.value = t;
    markLoaded();
  });
  loader.load("assets/bgdepth-web.png", (t) => {
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    uniforms.uBgDepth.value = t;
    markLoaded();
  });
  loader.load("assets/subjects-web.png", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    uniforms.uSubj.value = t;
    markLoaded();
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D uBg;
      uniform sampler2D uBgDepth;
      uniform sampler2D uSubj;
      uniform sampler2D uAmp;
      uniform float uAmpAspect;
      uniform float uAmpReady;
      uniform float uAmpSpanH;
      uniform sampler2D uName;
      uniform float uNameAspect;
      uniform float uNameReady;
      uniform float uNameSpanW;
      uniform vec2 uPhotoRes;
      uniform float uBgSqueeze;
      uniform vec2 uRes;
      uniform vec2 uPointer;
      uniform float uScroll;
      uniform float uReady;
      uniform float uWrite;
      uniform float uMotion;

      vec2 coverFit(vec2 v, float overscan) {
        float screenA = uRes.x / uRes.y;
        float imgA = uPhotoRes.x / uPhotoRes.y;
        vec2 fit = screenA > imgA
          ? vec2(1.0, imgA / screenA)
          : vec2(screenA / imgA, 1.0);
        fit *= overscan;
        return (v - 0.5) * fit + 0.5;
      }

      float blurDepth(vec2 uv) {
        vec2 px = 3.5 / uPhotoRes;
        float d = texture2D(uBgDepth, uv).r * 0.25;
        d += texture2D(uBgDepth, uv + vec2( px.x, 0.0)).r * 0.125;
        d += texture2D(uBgDepth, uv + vec2(-px.x, 0.0)).r * 0.125;
        d += texture2D(uBgDepth, uv + vec2(0.0,  px.y)).r * 0.125;
        d += texture2D(uBgDepth, uv + vec2(0.0, -px.y)).r * 0.125;
        d += texture2D(uBgDepth, uv + px).r * 0.0625;
        d += texture2D(uBgDepth, uv - px).r * 0.0625;
        d += texture2D(uBgDepth, uv + vec2( px.x, -px.y)).r * 0.0625;
        d += texture2D(uBgDepth, uv + vec2(-px.x,  px.y)).r * 0.0625;
        return d;
      }

      // Progressive grade: lift saturation, then darken (slightly cool).
      vec3 grade(vec3 c, float dark, float sat) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, sat);
        return mix(c, c * vec3(0.30, 0.31, 0.37), dark);
      }

      // A screen-placed card. spanWH is its size as a fraction of the
      // viewport; centre is where its middle sits in screen uv.
      vec4 card(sampler2D tex, vec2 spanWH, vec2 centre, vec2 drift, float grow) {
        vec2 span = spanWH / grow;
        vec2 uv = (vUv - centre) / span + 0.5 + drift / span;
        float inb =
          step(0.0, uv.x) * step(uv.x, 1.0) *
          step(0.0, uv.y) * step(uv.y, 1.0);
        vec4 c = texture2D(tex, uv);
        c.a *= inb;
        return c;
      }

      void main() {
        if (uReady < 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }

        float dolly = clamp(uScroll, 0.0, 1.0) * uMotion; // crane-in amount
        float screenRatio = uRes.x / uRes.y;

        // Saturation lifts steadily the whole way down. Darkening rolls
        // on back-to-front: the plate goes first and hardest, the
        // mid-ground next, the couple last and least — so depth keeps
        // separating even as the whole frame sinks into a backdrop.
        float sat      = 1.0 + smoothstep(0.08, 1.0, uScroll) * 0.5;
        float bgDark   = smoothstep(0.02, 0.62, uScroll);
        float midDark  = smoothstep(0.22, 0.80, uScroll) * 0.85;
        float subjDark = smoothstep(0.50, 1.00, uScroll) * 0.62;

        // Write-on: a soft, slightly raked pen edge sweeps left to right
        // across the frame, so "Victoria" draws in, then the "&", then
        // "Micah" — one continuous stroke across the whole title.
        float penX = vUv.x + (vUv.y - 0.5) * 0.05;
        float pen = mix(-0.16, 1.16, uWrite);
        float write = 1.0 - smoothstep(pen, pen + 0.13, penX);

        vec2 base = coverFit(vUv, 0.96);
        base.y += 0.05;
        vec2 bgUv = vec2((base.x - 0.5) * uBgSqueeze + 0.5, base.y);

        // -------- background layer --------
        // Gentle depth-driven dolly: near ground scales a little more
        // than the far field about a low pivot — just enough parallax to
        // read as perspective, not enough to tear the plate.
        float depth = blurDepth(bgUv);
        float nearField = smoothstep(0.05, 0.55, depth);

        vec2 pivot = vec2(0.5, 0.40);
        float bgZoom = 1.0 + dolly * (0.09 + 0.16 * nearField);
        vec2 bgSample = (bgUv - pivot) / bgZoom + pivot;
        bgSample += vec2(0.0, dolly * -0.028) * nearField
                  + uPointer * 0.006 * uMotion;
        bgSample = clamp(bgSample, 0.0, 1.0);

        vec3 color = grade(texture2D(uBg, bgSample).rgb, bgDark, sat);
        float coc = 1.0; // 1 = fully defocusable, 0 = held sharp

        // -------- giant "&" (mid ground, behind the couple) --------
        if (uAmpReady > 0.5) {
          vec2 spanWH = vec2(uAmpSpanH * uAmpAspect / screenRatio, uAmpSpanH);
          vec2 centre = vec2(0.5, 0.60);
          vec2 drift = uPointer * 0.018 * uMotion
                     + vec2(0.0, dolly * -0.075);
          float grow = 1.0 + dolly * 0.12;
          float fade = 1.0 - smoothstep(0.55, 0.92, uScroll);
          vec4 a = card(uAmp, spanWH, centre, drift, grow);
          float m = clamp(a.a, 0.0, 1.0) * fade * write;
          color = mix(color, grade(a.rgb, midDark, sat), m);
          coc = mix(coc, 0.78, m);
        }

        // -------- "Victoria" / "Micah", flanking the "&" --------
        // Vertically centred on the giant "&" so the three read as one
        // line, and rising together as the camera cranes in.
        if (uNameReady > 0.5) {
          vec2 spanWH = vec2(uNameSpanW, uNameSpanW / uNameAspect * screenRatio);
          vec2 centre = vec2(0.5, 0.60);
          vec2 drift = uPointer * 0.024 * uMotion
                     + vec2(0.0, dolly * -0.115);
          float grow = 1.0 + dolly * 0.10;
          float fade = 1.0 - smoothstep(0.5, 0.86, uScroll);
          vec4 n = card(uName, spanWH, centre, drift, grow);
          float m = clamp(n.a, 0.0, 1.0) * fade * write;
          color = mix(color, grade(n.rgb, midDark, sat), m);
          coc = mix(coc, 0.72, m);
        }

        // -------- subjects layer (near plane) --------
        // Rise and enlarge the most as the camera cranes in. Held
        // sharpest, but by the end of the scroll they defocus too.
        vec2 sPivot = vec2(0.5, 0.40);
        float sGrow = 1.0 + dolly * 0.15;
        vec2 subjDrift = uPointer * 0.030 * uMotion
                       + vec2(0.0, dolly * -0.10);
        vec2 subjSample = (base - sPivot) / sGrow + sPivot + subjDrift;
        vec4 s = texture2D(uSubj, subjSample);
        float sa = clamp(s.a, 0.0, 1.0);
        color = mix(color, grade(s.rgb, subjDark, sat), sa);

        float subjBlur = smoothstep(0.5, 1.0, uScroll); // both layers by the end
        coc = mix(coc, mix(0.12, 0.92, subjBlur), sa);

        gl_FragColor = vec4(color, coc);
      }
    `,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));

  // --- pass 2: depth-of-field blur ---------------------------------
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const blurScene = new THREE.Scene();
  const blurUniforms = {
    uTex: { value: rt.texture },
    uTexel: { value: new THREE.Vector2(0.5, 0.5) },
    uMaxBlur: { value: 0 },
  };
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: blurUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D uTex;   // rgb = composite, a = circle of confusion
      uniform vec2 uTexel;      // 1 / drawing-buffer size
      uniform float uMaxBlur;   // px, scroll-ramped

      #define TAPS 16
      const float GOLDEN = 2.399963229;

      // Linear-light -> sRGB. The composite is sampled from sRGB textures
      // (hardware-decoded to linear), rendered into a linear half-float
      // target and blurred here in linear. Three.js does NOT encode a
      // ShaderMaterial's output, so without this the screen shows raw
      // linear values and the whole hero reads a couple of stops dark.
      vec3 linearToSRGB(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(
          1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
          c * 12.92,
          step(c, vec3(0.0031308))
        );
      }

      void main() {
        vec4 c0 = texture2D(uTex, vUv);
        float radius = uMaxBlur * c0.a;

        vec3 rgb;
        if (radius < 0.75) {
          rgb = c0.rgb;
        } else {
          vec3 acc = c0.rgb;
          float wsum = 1.0;
          for (int i = 0; i < TAPS; i++) {
            float t = (float(i) + 0.5) / float(TAPS);
            float r = sqrt(t) * radius;
            float a = float(i) * GOLDEN;
            vec2 off = vec2(cos(a), sin(a)) * r * uTexel;
            vec4 sc = texture2D(uTex, vUv + off);
            float w = sc.a; // sharp neighbours barely bleed outward
            acc += sc.rgb * w;
            wsum += w;
          }
          rgb = acc / wsum;
        }

        gl_FragColor = vec4(linearToSRGB(rgb), 1.0);
      }
    `,
  });
  blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial));

  buildHeroText(uniforms).catch((err) =>
    console.warn("Hero wordmark skipped:", err)
  );

  let maxBlurPx = 0;
  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    rt.setSize(bw, bh);
    uniforms.uRes.value.set(w, h);
    blurUniforms.uTexel.value.set(1 / bw, 1 / bh);
    maxBlurPx = bh * MAX_BLUR_FRAC;

    const narrow = w < 700;
    uniforms.uAmpSpanH.value = narrow ? 0.5 : 0.74;
    uniforms.uNameSpanW.value = narrow ? 0.94 : 0.88;
  }
  window.addEventListener("resize", resize);
  resize();

  // --- pointer parallax --------------------------------------------
  const targetPointer = new THREE.Vector2(0, 0);
  if (!prefersReduced && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener(
      "pointermove",
      (e) => {
        targetPointer.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          -((e.clientY / window.innerHeight) * 2 - 1)
        );
      },
      { passive: true }
    );
  }

  // --- scroll progress -------------------------------------------
  // Mapped over the first CRANE_VH viewport heights, then held at 1.
  function updateScroll() {
    const p = clamp(
      window.scrollY / (window.innerHeight * CRANE_VH),
      0,
      1
    );
    uniforms.uScroll.value = p;
    if (overlayEl) overlayEl.style.setProperty("--p", p.toFixed(4));
  }
  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("resize", updateScroll);
  updateScroll();

  // --- render loop -----------------------------------------------
  // The hero is a fixed backdrop, so it can't be scrolled out of view.
  // Instead it idles: once the crane is settled and the pointer stops,
  // rendering pauses until the next scroll or pointer move.
  const cur = new THREE.Vector2(0, 0);
  let lastScroll = -1;
  let idle = 0;
  let writeStart = 0; // set once the title textures land

  function tick() {
    requestAnimationFrame(tick);
    if (uniforms.uReady.value < 0.5) return;

    // Pen sweep, started when the title textures are ready.
    let writing = false;
    if (!prefersReduced && uniforms.uNameReady.value > 0.5) {
      if (!writeStart) writeStart = performance.now();
      const t = clamp((performance.now() - writeStart) / WRITE_MS, 0, 1);
      // Ease out — the stroke starts brisk and settles.
      uniforms.uWrite.value = 1 - Math.pow(1 - t, 2.2);
      writing = t < 1;
    }

    cur.lerp(targetPointer, 0.06);
    const moved =
      writing ||
      cur.distanceTo(targetPointer) > 0.0012 ||
      Math.abs(uniforms.uScroll.value - lastScroll) > 0.0002;
    idle = moved ? 0 : idle + 1;
    if (idle > 4) return;

    uniforms.uPointer.value.copy(cur);
    lastScroll = uniforms.uScroll.value;
    blurUniforms.uMaxBlur.value =
      smoothstep(0.24, 1.0, uniforms.uScroll.value) * maxBlurPx;

    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(blurScene, camera);
  }
  tick();
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- DOM write-on -------------------------------------------------
// The same pen sweep as the hero, for .write-on elements further down
// the page. Fires once each, when the element first scrolls into view.
(function initWriteOn() {
  const targets = document.querySelectorAll(".write-on");
  if (!targets.length) return;

  const reveal = (el, delay) =>
    setTimeout(() => el.classList.add("is-written"), delay);

  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-written"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        // Stagger siblings so the stroke runs down the block.
        const group = [...entry.target.parentElement.children].filter((c) =>
          c.classList.contains("write-on")
        );
        reveal(entry.target, Math.max(0, group.indexOf(entry.target)) * 220);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.4, rootMargin: "0px 0px -8% 0px" }
  );

  targets.forEach((el) => io.observe(el));
})();

// Render the giant "&" and the "Victoria & Micah" wordmark to canvas
// textures for the mid-ground layers behind the couple.
async function buildHeroText(uniforms) {
  // Bradford LL is declared as @font-face in styles.css; make sure the
  // faces the canvas needs are actually decoded before measuring.
  try {
    await Promise.all([
      document.fonts.load(`italic 400 240px ${SERIF}`),
      document.fonts.load(`italic 300 240px ${SERIF}`),
    ]);
  } catch (err) {
    console.warn("Bradford LL not ready for the hero wordmark:", err);
  }

  // --- the giant "&" (plain, upright) ---
  {
    const ss = 3;
    const fontPx = 440 * ss;
    const pad = 24 * ss;
    const gauge = document.createElement("canvas").getContext("2d");
    gauge.font = `italic 300 ${fontPx}px ${SERIF}`;
    const m = gauge.measureText("&");
    const asc = m.actualBoundingBoxAscent || fontPx * 0.72;
    const desc = m.actualBoundingBoxDescent || fontPx * 0.2;

    const cv = document.createElement("canvas");
    cv.width = Math.ceil(m.width) + pad * 2;
    cv.height = Math.ceil(asc + desc) + pad * 2;
    const ctx = cv.getContext("2d");
    ctx.font = `italic 300 ${fontPx}px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#F6F3EC"; // warm white, matching the names
    ctx.fillText("&", cv.width / 2, cv.height / 2);

    uniforms.uAmp.value = makeTex(cv);
    uniforms.uAmpAspect.value = cv.width / cv.height;
    uniforms.uAmpReady.value = 1;
  }

  // --- "Victoria" and "Micah", pushed out to flank the giant "&" ---
  {
    const ss = 4;
    const fontPx = 94 * ss;
    const padY = 30 * ss;
    const font = `italic 400 ${fontPx}px ${SERIF}`;

    const gauge = document.createElement("canvas").getContext("2d");
    gauge.font = font;
    const wV = gauge.measureText("Victoria").width;
    const wM = gauge.measureText("Micah").width;
    // A centre gap wide enough for the "&" to sit clear between them.
    const gap = (wV + wM) * 0.85;
    const totalW = wV + gap + wM;

    const cv = document.createElement("canvas");
    cv.width = Math.ceil(totalW) + fontPx * 0.6;
    cv.height = Math.ceil(fontPx * 1.34) + padY * 2;
    const ctx = cv.getContext("2d");
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#F6F3EC";
    ctx.shadowColor = "rgba(18, 18, 16, 0.34)";
    ctx.shadowBlur = 22 * ss;
    ctx.shadowOffsetY = 5 * ss;
    const inset = (cv.width - totalW) / 2;
    ctx.textAlign = "left";
    ctx.fillText("Victoria", inset, cv.height / 2);
    ctx.textAlign = "right";
    ctx.fillText("Micah", cv.width - inset, cv.height / 2);

    uniforms.uName.value = makeTex(cv);
    uniforms.uNameAspect.value = cv.width / cv.height;
    uniforms.uNameReady.value = 1;
  }
}

function makeTex(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  return tex;
}
