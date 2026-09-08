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
// Three passes: composite -> half-float render target -> separable
// Gaussian blur (horizontal, then vertical) -> screen. Falls back to a
// flat colour (not the photo — avoids a crop mismatch on handoff) if
// WebGL or the Three.js module fails to load, or while assets are still
// loading (see .hero__stage in styles.css).
// ---------------------------------------------------------------

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const canvas = document.getElementById("hero-canvas");
const heroEl = document.querySelector(".hero");
const stageEl = document.querySelector(".hero__stage");
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

// ---------------------------------------------------------------
// TEMPORARY — on-page sliders for the depth/parallax uniforms above, so
// they can be dragged live instead of hand-edited in the shader source.
// Delete this whole function (and its call site, and the `uSubjBoostHi`
// etc. block in the uniforms/shader) once the numbers are settled — bake
// the final values back into the shader as plain literals first.
// ---------------------------------------------------------------
const DEPTH_TUNER_CONFIG = [
  { group: "Global", key: "uPanY", label: "camera pan (vertical)", min: -0.4, max: 0.4, step: 0.005 },

  { group: "Background", key: "uBgZoomBase", label: "zoom: base (far)", min: 0, max: 0.3, step: 0.005 },
  { group: "Background", key: "uBgZoomNear", label: "zoom: + near", min: 0, max: 0.4, step: 0.005 },
  { group: "Background", key: "uBgZoomThresh", label: "zoom: near threshold", min: 0.15, max: 0.9, step: 0.01 },
  { group: "Background", key: "uBgDriftNear", label: "drift: near", min: -0.15, max: 0, step: 0.002 },
  { group: "Background", key: "uBgPointerAmt", label: "pointer parallax", min: 0, max: 0.03, step: 0.001 },

  { group: '"&"', key: "uAmpGrow", label: "grow", min: 0, max: 0.5, step: 0.005 },
  { group: '"&"', key: "uAmpDriftY", label: "drift: vertical", min: -0.3, max: 0, step: 0.005 },
  { group: '"&"', key: "uAmpPointerAmt", label: "pointer parallax", min: 0, max: 0.05, step: 0.001 },

  { group: "Names", key: "uNameGrow", label: "grow", min: 0, max: 0.5, step: 0.005 },
  { group: "Names", key: "uNameDriftY", label: "drift: vertical", min: -0.3, max: 0, step: 0.005 },
  { group: "Names", key: "uNamePointerAmt", label: "pointer parallax", min: 0, max: 0.05, step: 0.001 },

  { group: "Subject", key: "uSubjZoomMult", label: "zoom: overall multiplier", min: 0, max: 2, step: 0.02 },
  { group: "Subject", key: "uSubjBoostAmt", label: "near-boost amount", min: 0, max: 0.2, step: 0.005 },
  { group: "Subject", key: "uSubjBoostHi", label: "near-boost cap depth", min: 0.55, max: 1, step: 0.01 },
  { group: "Subject", key: "uSubjDriftMult", label: "drift multiplier", min: -1, max: 0, step: 0.01 },
  { group: "Subject", key: "uSubjPointerAmt", label: "pointer parallax", min: 0, max: 0.06, step: 0.001 },
  { group: "Subject", key: "uSubjFeetY", label: "feet sample Y", min: 0, max: 0.3, step: 0.005 },
];

function buildDepthTuner(uniforms) {
  const panel = document.createElement("div");
  panel.id = "depth-tuner";
  panel.style.cssText = `
    display: none;
    position: fixed; top: 8px; left: 8px; z-index: 9999;
    max-height: 92vh; overflow-y: auto; width: 230px;
    background: rgba(20, 20, 18, 0.85); color: #f5f2ea;
    font: 11px/1.4 -apple-system, system-ui, sans-serif;
    padding: 10px 12px; border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  `;

  // Hidden by default now that values are tuned — press ` (backtick) to
  // show/hide it again, or `document.getElementById('depth-tuner')
  // .style.display = 'block'` from the console.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "`") return;
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  const title = document.createElement("div");
  title.textContent = "Depth tuner (temporary)";
  title.style.cssText = "font-weight: 600; font-size: 12px; margin-bottom: 6px;";
  panel.appendChild(title);

  let currentGroup = null;
  DEPTH_TUNER_CONFIG.forEach((cfg) => {
    if (cfg.group !== currentGroup) {
      currentGroup = cfg.group;
      const h = document.createElement("div");
      h.textContent = currentGroup;
      h.style.cssText = `
        margin: 8px 0 2px; opacity: 0.65; text-transform: uppercase;
        letter-spacing: 0.05em; font-size: 10px;
      `;
      panel.appendChild(h);
    }

    const row = document.createElement("label");
    row.style.cssText = "display: block; margin: 4px 0;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display: flex; justify-content: space-between;";
    const labelText = document.createElement("span");
    labelText.textContent = cfg.label;
    const valSpan = document.createElement("span");
    valSpan.style.opacity = "0.8";
    labelRow.appendChild(labelText);
    labelRow.appendChild(valSpan);
    row.appendChild(labelRow);

    const input = document.createElement("input");
    input.type = "range";
    input.min = cfg.min;
    input.max = cfg.max;
    input.step = cfg.step;
    input.style.cssText = "width: 100%; display: block;";

    const sync = (v) => {
      valSpan.textContent = v.toFixed(3);
      input.value = v;
    };
    sync(uniforms[cfg.key].value);

    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      uniforms[cfg.key].value = v;
      valSpan.textContent = v.toFixed(3);
    });

    row.appendChild(input);
    panel.appendChild(row);
  });

  const logBtn = document.createElement("button");
  logBtn.type = "button";
  logBtn.textContent = "Log values to console";
  logBtn.style.cssText = `
    margin-top: 10px; width: 100%; padding: 6px; border-radius: 4px;
    border: 0; cursor: pointer; font: inherit;
  `;
  logBtn.addEventListener("click", () => {
    const out = {};
    DEPTH_TUNER_CONFIG.forEach((cfg) => {
      out[cfg.key] = uniforms[cfg.key].value;
    });
    console.log("Depth tuner values:", out);
  });
  panel.appendChild(logBtn);

  document.body.appendChild(panel);
}

if (canvas && heroEl) {
  try {
    initHero();
  } catch (err) {
    // initHero() failed synchronously (e.g. WebGL context creation
    // failed) — we know for certain now it'll never paint, so reveal
    // the real photo immediately rather than waiting on the timeout.
    if (stageEl) stageEl.classList.add("show-fallback-image");
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
  const dpr = Math.min(
    window.devicePixelRatio || 1,
    window.innerWidth < 700 ? 1.5 : 1.75
  );
  renderer.setPixelRatio(dpr);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // --- pass 1: composite --------------------------------------------
  const scene = new THREE.Scene();

  const uniforms = {
    uBg: { value: null },
    uBgDepth: { value: null },
    uSubj: { value: null },
    uSubjDepth: { value: null },
    uAmp: { value: null },
    uAmpAspect: { value: 1 },
    uAmpReady: { value: 0 },
    uAmpGapFrac: { value: 0.4 }, // the names' centre gap, as a fraction of their own width
    uAmpFitGap: { value: 1 }, // 1 = clamp to the gap (desktop), 0 = allowed to overlap (mobile)
    uName: { value: null },
    uNameAspect: { value: 5 },
    uNameReady: { value: 0 },
    uNameSpanW: { value: 0.82 }, // "Victoria  Micah" width as fraction of vw
    uTitleCenterY: { value: 0.60 }, // "&"/names vertical centre (v, bottom-up) — raised on tall phone aspects, see resize()
    uPhotoRes: { value: new THREE.Vector2(PHOTO_W, PHOTO_H) },
    uBgSqueeze: { value: BG_X_SQUEEZE },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uScroll: { value: 0 },
    uReady: { value: 0 },
    uWrite: { value: prefersReduced ? 1 : 0 },
    uMotion: { value: prefersReduced ? 0.4 : 1 },

    // --- TEMPORARY: exposed to the on-page depth tuner (see
    // buildDepthTuner below) so the parallax/zoom amounts can be
    // dragged live instead of hand-edited in the shader. Panel is
    // hidden by default (buildDepthTuner) — show it via the console
    // (document.getElementById('depth-tuner').style.display = 'block')
    // to keep tuning, or bake the current values back into the shader
    // as literals and delete the tuner entirely once truly settled. ---
    uPanY: { value: 0.125 }, // global vertical camera pan, shared by bg + subject

    uBgZoomBase: { value: 0.09 },
    uBgZoomNear: { value: 0.4 },
    uBgZoomThresh: { value: 0.55 },
    uBgDriftNear: { value: -0.028 },
    uBgPointerAmt: { value: 0.022 },

    uAmpGrow: { value: 0.27 },
    uAmpDriftY: { value: -0.075 },
    uAmpPointerAmt: { value: 0.018 },

    uNameGrow: { value: 0.26 },
    uNameDriftY: { value: -0.115 },
    uNamePointerAmt: { value: 0.024 },

    uSubjBoostAmt: { value: 0.045 },
    uSubjBoostHi: { value: 1 },
    uSubjZoomMult: { value: 1.7 },
    uSubjDriftMult: { value: -0.09 },
    uSubjPointerAmt: { value: 0.03 },
    uSubjFeetY: { value: 0.12 },
  };

  const loader = new THREE.TextureLoader();
  let loaded = 0;
  const markLoaded = () => {
    if (++loaded === 4) {
      uniforms.uReady.value = 1;
      // Fade the canvas in over the CSS fallback rather than snapping to
      // it — their crops are close but not pixel-identical (see
      // .hero__stage's comment in styles.css), so a hard cut would still
      // show a small jump even with that position matched.
      canvas.classList.add("is-ready");
    }
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
  loader.load("assets/Subjects.png", (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    uniforms.uSubj.value = t;
    markLoaded();
  });
  loader.load("assets/subjdepth-web.png", (t) => {
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    uniforms.uSubjDepth.value = t;
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
      uniform sampler2D uSubjDepth;
      uniform sampler2D uAmp;
      uniform float uAmpAspect;
      uniform float uAmpReady;
      uniform float uAmpGapFrac;
      uniform float uAmpFitGap;
      uniform sampler2D uName;
      uniform float uNameAspect;
      uniform float uNameReady;
      uniform float uNameSpanW;
      uniform float uTitleCenterY;
      uniform vec2 uPhotoRes;
      uniform float uBgSqueeze;
      uniform vec2 uRes;
      uniform vec2 uPointer;
      uniform float uScroll;
      uniform float uReady;
      uniform float uWrite;
      uniform float uMotion;

      // TEMPORARY: tunable versions of the parallax constants — see the
      // uniforms block in initHero() and buildDepthTuner().
      uniform float uPanY;
      uniform float uBgZoomBase;
      uniform float uBgZoomNear;
      uniform float uBgZoomThresh;
      uniform float uBgDriftNear;
      uniform float uBgPointerAmt;
      uniform float uAmpGrow;
      uniform float uAmpDriftY;
      uniform float uAmpPointerAmt;
      uniform float uNameGrow;
      uniform float uNameDriftY;
      uniform float uNamePointerAmt;
      uniform float uSubjBoostAmt;
      uniform float uSubjBoostHi;
      uniform float uSubjZoomMult;
      uniform float uSubjDriftMult;
      uniform float uSubjPointerAmt;
      uniform float uSubjFeetY;

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

      // Dolly-zoom coefficient for the background: 0.09 at the horizon,
      // rising through 0.05-uBgZoomThresh depth to base+near at the near
      // ground. The subject adds its own extra term on top of this (see
      // below) rather than this function being stretched to cover it,
      // which would also push the background's own near ground past the
      // range it was tuned for.
      float depthZoomCoef(float depth) {
        return uBgZoomBase + uBgZoomNear * smoothstep(0.05, uBgZoomThresh, depth);
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
        float bgDark   = smoothstep(0.02, 0.62, uScroll) * 0.75;
        float midDark  = smoothstep(0.22, 0.80, uScroll) * 0.85;
        float subjDark = smoothstep(0.50, 1.00, uScroll) * 0.40;

        // Write-on: a soft, slightly raked pen edge sweeps left to right
        // across the frame, so "Victoria" draws in, then the "&", then
        // "Micah" — one continuous stroke across the whole title.
        float penX = vUv.x + (vUv.y - 0.5) * 0.05;
        float pen = mix(-0.16, 1.16, uWrite);
        float write = 1.0 - smoothstep(pen, pen + 0.13, penX);

        vec2 base = coverFit(vUv, 0.96);
        // Global camera pan: shifts the whole shared "world" coordinate
        // (both background and subject sample from base/bgUv) uniformly
        // as you scroll, on top of — and distinct from — each layer's
        // own depth-scaled rise below. That per-layer rise varies by
        // depth (a pedestal/truck move); this is a plain pan, the same
        // for every depth, so it reads as the camera tilting from a
        // higher framing down toward a lower one as you scroll.
        base.y += 0.05 + dolly * uPanY;
        vec2 bgUv = vec2((base.x - 0.5) * uBgSqueeze + 0.5, base.y);

        // -------- background layer --------
        // Gentle depth-driven dolly: near ground scales a little more
        // than the far field about a low pivot — just enough parallax to
        // read as perspective, not enough to tear the plate.
        float depth = blurDepth(bgUv);
        float nearField = smoothstep(0.05, uBgZoomThresh, depth);

        vec2 pivot = vec2(0.5, 0.40);
        float bgZoom = 1.0 + dolly * depthZoomCoef(depth);
        vec2 bgSample = (bgUv - pivot) / bgZoom + pivot;
        bgSample += vec2(0.0, dolly * uBgDriftNear) * nearField
                  + uPointer * uBgPointerAmt * uMotion * nearField;
        bgSample = clamp(bgSample, 0.0, 1.0);

        vec3 color = grade(texture2D(uBg, bgSample).rgb, bgDark, sat);
        float coc = 1.0; // 1 = fully defocusable, 0 = held sharp

        // -------- giant "&" (mid ground, behind the couple) --------
        // On wide viewports, sized to fit inside the names' own centre
        // gap (uAmpGapFrac, measured exactly from the canvas layout in
        // buildHeroText) with a small safety margin, so it never overlaps
        // "Victoria"/"Micah". On mobile widths (uAmpFitGap = 0, see
        // resize()) it's allowed to run bigger and overlap the names —
        // there isn't room for a clear gap at that scale. Screen-blended
        // at reduced strength so it reads as a soft glow behind the names
        // instead of an opaque card competing with them.
        if (uAmpReady > 0.5 && uNameReady > 0.5) {
          float ampSpanW = mix(uNameSpanW * 0.9,
                                uNameSpanW * uAmpGapFrac * 0.92,
                                uAmpFitGap);
          vec2 spanWH = vec2(ampSpanW, ampSpanW / uAmpAspect * screenRatio);
          // Nudged right of dead-centre, toward "Micah": "Victoria" is
          // the longer word, and the "&" glyph itself isn't optically
          // centred in its own box, so a true 0.5 centre reads as
          // slightly left-heavy. A little extra overlap onto "Micah" is
          // fine here.
          vec2 centre = vec2(0.52, uTitleCenterY);
          vec2 drift = uPointer * uAmpPointerAmt * uMotion
                     + vec2(0.0, dolly * uAmpDriftY);
          // Sits nearer than the background's own near-field ground
          // (saturates at 0.25) but behind the subjects (0.28) — must
          // grow faster than 0.25 or the ground overtakes it in scale.
          float grow = 1.0 + dolly * uAmpGrow;
          float fade = 1.0 - smoothstep(0.55, 0.92, uScroll);
          vec4 a = card(uAmp, spanWH, centre, drift, grow);
          float m = clamp(a.a, 0.0, 1.0) * fade * write;
          vec3 ampLit = grade(a.rgb, midDark, sat) * (m * 0.5);
          color = 1.0 - (1.0 - color) * (1.0 - ampLit);
          coc = mix(coc, 0.78, m);
        }

        // -------- "Victoria" / "Micah", flanking the "&" --------
        // Vertically centred on the giant "&" so the three read as one
        // line, and rising together as the camera cranes in.
        if (uNameReady > 0.5) {
          vec2 spanWH = vec2(uNameSpanW, uNameSpanW / uNameAspect * screenRatio);
          vec2 centre = vec2(0.5, uTitleCenterY);
          vec2 drift = uPointer * uNamePointerAmt * uMotion
                     + vec2(0.0, dolly * uNameDriftY);
          // Same mid-ground plane as the "&" — see grow note above.
          float grow = 1.0 + dolly * uNameGrow;
          float fade = 1.0 - smoothstep(0.5, 0.86, uScroll);
          vec4 n = card(uName, spanWH, centre, drift, grow);
          float m = clamp(n.a, 0.0, 1.0) * fade * write;
          color = mix(color, grade(n.rgb, midDark, sat), m);
          coc = mix(coc, 0.72, m);
        }

        // -------- subjects layer (near plane) --------
        // Rise and enlarge as the camera cranes in, as one rigid card —
        // this is a photograph of two people, not a landscape, so it
        // can't be warped per-pixel by local depth the way the
        // background is (that reads as distortion, not parallax, on a
        // human figure). Calibrated from a depth sample near the couple's
        // feet (sFeetSample) rather than at sPivot — sPivot sits around
        // chest height (v~0.40; the couple's alpha mask spans roughly
        // v 0.07-0.57, feet at the low end), which barely reads as "near"
        // and would make this calibration a no-op. The feet/ground-
        // contact point is what actually needs to agree with the
        // background's own near-ground zoom, so that's what's sampled:
        // starts from the same depthZoomCoef curve the background uses,
        // plus an extra term for depth beyond the background's own
        // near-ground cap (~0.55) — the couple's feet measure up to ~0.9
        // in depthimage.png, nearer than the background ever gets.
        vec2 sPivot = vec2(0.5, 0.40);
        vec2 sFeetSample = vec2(0.5, uSubjFeetY);
        float sFeetDepth = texture2D(uSubjDepth, sFeetSample).r;
        float sZoomCoef = (depthZoomCoef(sFeetDepth)
                        + uSubjBoostAmt * smoothstep(uBgZoomThresh, uSubjBoostHi, sFeetDepth))
                        * uSubjZoomMult;
        float sGrow = 1.0 + dolly * sZoomCoef;
        vec2 subjDrift = uPointer * uSubjPointerAmt * uMotion
                       + vec2(0.0, dolly * uSubjDriftMult * sZoomCoef);
        vec2 subjSample = (base - sPivot) / sGrow + sPivot + subjDrift;
        vec4 s = texture2D(uSubj, subjSample);
        float sa = clamp(s.a, 0.0, 1.0);
        color = mix(color, grade(s.rgb, subjDark, sat), sa);

        // Held sharp for the entire scroll, no blur at all — WebGL
        // double-pass and the CSS filter were both tried for softening
        // this late in the scroll, and both produced a visible bloom/
        // halo hugging the subject's edge. Not worth chasing further;
        // sharp throughout is the simple, correct-looking answer.
        coc = mix(coc, 0.0, sa);

        gl_FragColor = vec4(color, coc);
      }
    `,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));

  // --- pass 2 & 3: depth-of-field blur, separable (horizontal, then
  // vertical) — a single-pass 2D golden-angle disc sample (10 taps) was
  // tried first, but with so few samples scattered around a ring, sharp
  // edges (the subject's silhouette, the name-text strokes) showed up as
  // visibly duplicated/ghosted lines instead of a smooth smear. A
  // separable Gaussian samples along a straight line in each pass
  // instead of a sparse ring, which is both smoother (true Gaussian
  // falloff, no gaps) and cheaper per unit of quality (cost grows
  // linearly with samples-per-axis, not quadratically with disc
  // coverage). Both passes use the exact same per-pixel variable radius
  // (uMaxBlur * coc) the single-pass version did — only how that radius
  // gets sampled changed, not which pixels blur how much or when.
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const rt2 = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  // Shared 1D Gaussian sampling loop. AXIS is (1,0) for the horizontal
  // pass, (0,1) for the vertical pass — each pass only blurs along one
  // line, which is what makes this separable. sigma = radius * 0.5 (same
  // convention as before) makes the per-sample weight a function of the
  // normalized offset t alone (independent of radius), so it simplifies
  // to exp(-2 * t * t).
  function blurFragmentShader(axis, encodeOutput) {
    return `
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D uTex;   // rgb = composite (or H-pass result), a = coc
      uniform vec2 uTexel;      // 1 / source texture size
      uniform float uMaxBlur;   // px, scroll-ramped

      #define TAPS 9

      ${
        encodeOutput
          ? `
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
      `
          : ""
      }

      void main() {
        vec4 c0 = texture2D(uTex, vUv);
        float radius = uMaxBlur * c0.a;

        vec3 rgb;
        if (radius < 0.75) {
          rgb = c0.rgb;
        } else {
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < TAPS; i++) {
            float t = (float(i) / float(TAPS - 1)) * 2.0 - 1.0; // -1..1
            float w = exp(-2.0 * t * t);
            vec2 off = ${axis} * t * radius * uTexel;
            vec4 sc = texture2D(uTex, vUv + off);
            // Down-weight samples that land on held-sharp pixels (coc
            // near 0, i.e. the subject) so a blurring background pixel
            // near the subject's silhouette doesn't pull the subject's
            // crisp color into itself — that bleed is what read as a
            // soft bloom/halo hugging the subject's edge. Lower edge
            // sits exactly at the subject's held-sharp baseline coc
            // (0.12, see the composite shader's subjBlur mix) so it's
            // fully zero — not just reduced — for the whole first half
            // of the scroll where the subject is meant to read sharp;
            // an earlier, gentler curve (0.05-0.3) still left ~19%
            // weight at 0.12, and that residual was the visible bloom.
            // Relaxes back to full weight by 0.4, comfortably inside the
            // subject's own blur ramp, so the two still blend once the
            // subject is genuinely blurry too.
            w *= smoothstep(0.12, 0.4, sc.a);
            acc += sc.rgb * w;
            wsum += w;
          }
          // Guard against an all-subject neighborhood (e.g. a thin sliver
          // of background squeezed between two subject regions) zeroing
          // every weight and dividing by zero.
          rgb = wsum > 0.001 ? acc / wsum : c0.rgb;
        }

        gl_FragColor = vec4(${encodeOutput ? "linearToSRGB(rgb)" : "rgb"}, ${
      encodeOutput ? "1.0" : "c0.a"
    });
      }
    `;
  }

  const blurVertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const blurUniformsH = {
    uTex: { value: rt.texture },
    uTexel: { value: new THREE.Vector2(0.5, 0.5) },
    uMaxBlur: { value: 0 },
  };
  const blurMaterialH = new THREE.ShaderMaterial({
    uniforms: blurUniformsH,
    depthTest: false,
    depthWrite: false,
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader("vec2(1.0, 0.0)", false),
  });
  const blurSceneH = new THREE.Scene();
  blurSceneH.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterialH));

  const blurUniformsV = {
    uTex: { value: rt2.texture },
    uTexel: { value: new THREE.Vector2(0.5, 0.5) },
    uMaxBlur: { value: 0 },
  };
  const blurMaterialV = new THREE.ShaderMaterial({
    uniforms: blurUniformsV,
    depthTest: false,
    depthWrite: false,
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader("vec2(0.0, 1.0)", true),
  });
  const blurSceneV = new THREE.Scene();
  blurSceneV.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterialV));

  buildHeroText(uniforms).catch((err) =>
    console.warn("Hero wordmark skipped:", err)
  );
  // buildDepthTuner(uniforms); // dev-only tuning panel — see function def below; re-enable if the depth values need adjusting again

  let maxBlurPx = 0;
  let lastW = 0;
  let lastH = 0;

  // Scroll is what drives the toolbar's own resize churn in the first
  // place — rather than reacting to any resize event and hoping the
  // reading is settled, just don't resize at all while a scroll is
  // actively in progress. Once scrolling stops, reconcile once, which
  // catches any genuine change (rotation, real window resize) that
  // happened to land mid-scroll too.
  let isScrolling = false;
  let scrollStopTimer = null;
  window.addEventListener(
    "scroll",
    () => {
      isScrolling = true;
      clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(() => {
        isScrolling = false;
        resize();
      }, 150);
    },
    { passive: true }
  );

  function resize() {
    if (isScrolling) return;

    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const narrow = w < 700;

    // On mobile widths, the URL bar collapsing/expanding as you scroll
    // changes the viewport's height without its width — that's not a
    // real resize, just toolbar chrome animating (the CSS side of this
    // is handled by .hero__stage's 100lvh, but this guards the WebGL
    // resources regardless of what triggered the event). Only react to
    // a mobile "resize" when width also changes — rotation, or an
    // actual window resize — which is the real signal there. Desktop
    // isn't guarded: a height-only resize there (e.g. dragging the
    // window edge) is a genuine resize.
    if (narrow && w === lastW && h !== lastH) return;
    lastW = w;
    lastH = h;

    renderer.setSize(w, h, false);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    rt.setSize(bw, bh);
    rt2.setSize(bw, bh);
    uniforms.uRes.value.set(w, h);
    // H samples rt (full res); V samples rt2 (same size — both passes
    // run at full resolution for now, see the pass-2/3 comment above).
    blurUniformsH.uTexel.value.set(1 / bw, 1 / bh);
    blurUniformsV.uTexel.value.set(1 / bw, 1 / bh);
    maxBlurPx = bh * MAX_BLUR_FRAC;

    uniforms.uNameSpanW.value = narrow ? 0.94 : 0.88;
    uniforms.uAmpFitGap.value = narrow ? 0 : 1;

    // Tall phone aspect specifically, not just narrow width — a resized-
    // narrow desktop window is still short/wide-ish and shouldn't get
    // this. coverFit shows the photo's full height uncropped on tall/
    // narrow screens (screenAspect < photoAspect), unlike the vertically
    // -cropped, zoomed-in view desktop gets — so phones reveal extra sky
    // above the couple that desktop never shows. Raise the title into
    // that newly-visible space instead of sitting at the same fraction
    // desktop uses, which was tuned for the cropped/zoomed framing.
    const tallPhone = w < 700 && h / w > 1.5;
    uniforms.uTitleCenterY.value = tallPhone ? 0.72 : 0.60;
  }
  window.addEventListener("resize", resize);
  resize();

  // --- pointer parallax --------------------------------------------
  // Pointer Events unify mouse, touch, and pen under the same
  // "pointermove" type, and this works great for mouse — but on iOS
  // Safari, once a touch is recognized as a scroll (which any drag with
  // a vertical component on this page will be), the native scroll
  // gesture recognizer claims the touch and stops delivering move
  // events to JS for the rest of that gesture. Confirmed by testing:
  // pointermove only fires during a touch drag that stays purely
  // horizontal. touchmove would hit the identical wall (Pointer Events
  // for touch are synthesized from the same underlying touch stream),
  // so there's no event-based fix — touch fundamentally can't deliver
  // continuous position during a scroll the way a mouse cursor does.
  const targetPointer = new THREE.Vector2(0, 0);
  if (!prefersReduced) {
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

    // Device tilt as the mobile equivalent instead: a completely
    // separate sensor stream from touch, so it's unaffected by scroll-
    // gesture claiming and gives the same kind of continuous, ambient
    // input a mouse cursor does. iOS 13+ requires an explicit
    // permission prompt for motion sensors, and that prompt only works
    // inside a real user gesture — touchstart (the instant of first
    // contact, before any scroll swipe even completes) is as early as
    // that's allowed to fire; it can't run on page load with zero
    // interaction at all, Safari blocks that outright. Other browsers
    // either don't need permission or don't support the API at all;
    // both cases just skip straight past this and mouse/touch-drag
    // parallax still works normally.
    let baseTilt = null;
    function onTilt(e) {
      if (e.gamma === null || e.beta === null) return;
      if (!baseTilt) baseTilt = { gamma: e.gamma, beta: e.beta };
      const dGamma = e.gamma - baseTilt.gamma; // left/right
      const dBeta = e.beta - baseTilt.beta; // front/back
      targetPointer.set(
        clamp(dGamma / 20, -1, 1),
        clamp(-dBeta / 20, -1, 1)
      );
    }
    function enableTilt() {
      window.addEventListener("deviceorientation", onTilt, { passive: true });
    }
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      window.addEventListener(
        "touchstart",
        () => {
          DeviceOrientationEvent.requestPermission()
            .then((state) => {
              if (state === "granted") enableTilt();
            })
            .catch(() => {});
        },
        { once: true, passive: true }
      );
    } else if (typeof DeviceOrientationEvent !== "undefined") {
      enableTilt();
    }
  }

  // --- scroll progress -------------------------------------------
  // Mapped over the first CRANE_VH viewport heights, then held at 1.
  function updateScroll() {
    // lastH (from resize(), guarded against toolbar-only height changes)
    // instead of window.innerHeight directly — innerHeight fluctuates as
    // Safari's URL bar collapses/expands, which shifted this ratio (and
    // therefore the whole crane/zoom/blur state) on every toolbar
    // animation frame even with zero actual scrolling, reading as a
    // jittery "resize" jump.
    const p = clamp(window.scrollY / (lastH * CRANE_VH), 0, 1);
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
    const blurAmt = smoothstep(0.24, 1.0, uniforms.uScroll.value) * maxBlurPx;
    blurUniformsH.uMaxBlur.value = blurAmt;
    blurUniformsV.uMaxBlur.value = blurAmt;

    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(rt2);
    renderer.render(blurSceneH, camera);
    renderer.setRenderTarget(null);
    renderer.render(blurSceneV, camera);
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
  // The "&" and the names use different weights of Bradford LL and
  // previously both waited on a single Promise.all of both fonts before
  // either would draw — so a slow-loading font for one piece delayed the
  // other for no reason. Now each renders independently, as soon as its
  // own font is ready.
  await Promise.allSettled([
    buildAmpersand(uniforms),
    buildNames(uniforms),
  ]);
}

// --- the giant "&" (plain, upright) ---
async function buildAmpersand(uniforms) {
  try {
    await document.fonts.load(`italic 300 240px ${SERIF}`);
  } catch (err) {
    console.warn("Bradford LL (light italic) not ready for the \"&\":", err);
  }

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
async function buildNames(uniforms) {
  try {
    await document.fonts.load(`italic 700 240px ${SERIF}`);
  } catch (err) {
    console.warn("Bradford LL (bold italic) not ready for the names:", err);
  }

  const ss = 4;
  const fontPx = 94 * ss;
  const padY = 30 * ss;
  const font = `italic 700 ${fontPx}px ${SERIF}`;

  const gauge = document.createElement("canvas").getContext("2d");
  gauge.font = font;
  // measureText's .width is the font's advance width, not the actual
  // ink extent — for an italic bold face "V" and "h" have different
  // side-bearings, so centering on advance width alone leaves visibly
  // unequal outer margins. actualBoundingBoxLeft/Right (measured with
  // the same textAlign used to draw each word) gives the real ink
  // overhang past that anchor, so the margins below land on equal
  // visible space, not just equal logical space.
  gauge.textAlign = "left";
  const vMetrics = gauge.measureText("Victoria");
  const wV = vMetrics.width;
  const vLeftInk = vMetrics.actualBoundingBoxLeft;
  gauge.textAlign = "right";
  const mMetrics = gauge.measureText("Micah");
  const wM = mMetrics.width;
  const mRightInk = mMetrics.actualBoundingBoxRight;
  // A centre gap wide enough for the "&" to sit clear between them.
  const gap = (wV + wM) * 0.85;
  const totalW = wV + gap + wM;
  const margin = fontPx * 0.3;

  const cv = document.createElement("canvas");
  cv.width = Math.ceil(totalW + margin * 2 + vLeftInk + mRightInk);
  cv.height = Math.ceil(fontPx * 1.34) + padY * 2;
  const ctx = cv.getContext("2d");
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(18, 18, 16, 0.18)";
  ctx.shadowBlur = 14 * ss;
  ctx.shadowOffsetY = 3 * ss;
  ctx.textAlign = "left";
  ctx.fillText("Victoria", margin + vLeftInk, cv.height / 2);
  ctx.textAlign = "right";
  ctx.fillText("Micah", cv.width - margin - mRightInk, cv.height / 2);

  uniforms.uName.value = makeTex(cv);
  uniforms.uNameAspect.value = cv.width / cv.height;
  uniforms.uAmpGapFrac.value = gap / cv.width;
  uniforms.uNameReady.value = 1;
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
