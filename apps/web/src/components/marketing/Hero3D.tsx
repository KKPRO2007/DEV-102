'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Float, Instance, Instances, Lightformer, RoundedBox, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { STAGES, useExamStory } from './examStory';

/* ---------------------------------------------------------------- laptop screen: proctor live console (canvas texture) */

const W = 1560;
const H = 962;
const SCALE = 0.7;
const C = {
  panel: '#0d1d3f', line: '#1c3266', text: '#e6eeff', muted: '#8ea3c8',
  blue: '#1E6FF0', sky: '#38bdf8', amber: '#FFB020', red: '#ef4444', green: '#22c55e',
};

type Stage = (typeof STAGES)[number];

/** Fictional candidates shown as initials only; tile 4 is the one who opens ChatGPT. */
const TILES = [
  { name: 'Ananya I.', initials: 'AI', hue: 210, base: 6 },
  { name: 'Rohan M.', initials: 'RM', hue: 190, base: 18 },
  { name: 'Kavya R.', initials: 'KR', hue: 230, base: 9 },
  { name: 'Arjun S.', initials: 'AS', hue: 250, base: 12 },
  { name: 'Meera P.', initials: 'MP', hue: 170, base: 22 },
  { name: 'Dev K.', initials: 'DK', hue: 200, base: 4 },
] as const;
const FLAGGED = 3;

const FEED_CALM = [
  ['Rohan M.', 'Looked away 4 s', C.amber],
  ['Meera P.', 'Copy shortcut blocked', C.amber],
  ['Kavya R.', 'Network back, answers synced', C.sky],
  ['Dev K.', 'Face verified', C.green],
] as const;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient, stroke?: string, lw = 2) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

function drawConsole(g: CanvasRenderingContext2D, s: Stage, clock: string, t: number, font: string) {
  const text = (str: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left') => {
    g.font = `${weight} ${size}px ${font}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(str, x, y);
    g.textAlign = 'left';
    return g.measureText(str).width;
  };
  g.textBaseline = 'middle';
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#081733');
  bg.addColorStop(1, '#050d22');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const alert = s.alert && !s.verdict;
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);

  // Header
  g.fillStyle = C.panel;
  g.fillRect(0, 0, W, 92);
  g.beginPath(); g.arc(46, 46, 11, 0, Math.PI * 2); g.fillStyle = `rgba(239,68,68,${0.55 + 0.45 * pulse})`; g.fill();
  const x = 70 + text('Live monitor', 70, 47, 34, C.text, 700);
  text('CPA-26 · 6 candidates', x + 22, 48, 26, C.muted);
  rr(g, W - 214, 22, 190, 50, 12, '#0a2a5c');
  text(clock, W - 119, 48, 28, C.sky, 700, 'center');
  rr(g, W - 470, 22, 236, 50, 12, alert ? 'rgba(239,68,68,.2)' : 'rgba(34,197,94,.15)');
  text(alert ? '1 critical' : 'All clear', W - 352, 48, 24, alert ? C.red : C.green, 700, 'center');

  // Candidate grid 3 × 2
  const gx = 28, gy = 116, tw = 326, th = 300, gap = 18;
  TILES.forEach((c, i) => {
    const tx = gx + (i % 3) * (tw + gap);
    const ty = gy + Math.floor(i / 3) * (th + gap);
    const flagged = i === FLAGGED && s.tab;
    const risk = i === FLAGGED ? s.risk : Math.round(c.base + 4 * Math.sin(t * 0.9 + i));
    const ring = flagged && alert ? C.red : risk >= 25 ? C.amber : C.line;
    rr(g, tx, ty, tw, th, 22, C.panel, ring, flagged && alert ? 4 : 2);

    // "Webcam" area: gradient, initials avatar, face box and a moving scan line
    const cam = g.createLinearGradient(tx, ty, tx + tw, ty + 210);
    cam.addColorStop(0, `hsl(${c.hue} 55% 26%)`);
    cam.addColorStop(1, `hsl(${c.hue} 60% 14%)`);
    rr(g, tx + 12, ty + 12, tw - 24, 196, 16, cam);
    g.beginPath(); g.arc(tx + tw / 2, ty + 104, 52, 0, Math.PI * 2);
    g.fillStyle = `hsl(${c.hue} 70% 62%)`; g.fill();
    text(c.initials, tx + tw / 2, ty + 106, 40, '#06122b', 700, 'center');
    g.strokeStyle = flagged && alert ? C.red : 'rgba(110,231,183,.9)';
    g.lineWidth = 4;
    const fx = tx + tw / 2 - 74, fy = ty + 34, fw = 148, fh = 142, k = 22;
    for (const [cx, cy, dx, dy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]] as const) {
      g.beginPath(); g.moveTo(cx + dx * k, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * k); g.stroke();
    }
    const scanY = ty + 14 + ((t * 70 + i * 40) % 190);
    const scan = g.createLinearGradient(0, scanY - 16, 0, scanY + 16);
    scan.addColorStop(0, 'rgba(56,189,248,0)'); scan.addColorStop(0.5, 'rgba(56,189,248,.35)'); scan.addColorStop(1, 'rgba(56,189,248,0)');
    g.fillStyle = scan; g.fillRect(tx + 12, scanY - 16, tw - 24, 32);
    if (flagged) {
      rr(g, tx + 22, ty + 22, 168, 40, 10, alert ? C.red : 'rgba(255,176,32,.9)');
      text(alert ? 'AI QUERY' : 'chatgpt.com', tx + 106, ty + 43, 22, '#fff', 700, 'center');
    }

    // Name, risk badge and bar
    text(c.name, tx + 18, ty + 238, 26, C.text, 600);
    const badge = risk >= 50 ? C.red : risk >= 25 ? C.amber : C.green;
    rr(g, tx + tw - 84, ty + 220, 66, 38, 10, badge);
    text(String(risk), tx + tw - 51, ty + 240, 24, '#06122b', 700, 'center');
    rr(g, tx + 18, ty + 268, tw - 36, 10, 5, C.line);
    rr(g, tx + 18, ty + 268, Math.max(10, ((tw - 36) * risk) / 100), 10, 5, badge);
  });

  // Right panel: violation feed
  const px = 1056, pw = W - px - 28;
  rr(g, px, 116, pw, 446, 22, C.panel, C.line);
  text('Violation feed', px + 26, 156, 28, C.text, 700);
  const feed: [string, string, string][] = [];
  if (s.alert) feed.push(['Arjun S.', s.verdict ? 'Proctor reviewing' : 'AI query typed', s.verdict ? C.sky : C.red]);
  if (s.tab) feed.push(['Arjun S.', 'Opened chatgpt.com', C.amber]);
  for (const f of FEED_CALM) if (feed.length < 5) feed.push([f[0], f[1], f[2]]);
  feed.forEach(([who, what, color], i) => {
    const fy = 206 + i * 70;
    rr(g, px + 22, fy, pw - 44, 58, 14, i === 0 && s.alert ? 'rgba(239,68,68,.12)' : 'rgba(255,255,255,.03)');
    g.beginPath(); g.arc(px + 48, fy + 29, 8, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    const w = text(who, px + 68, fy + 30, 22, C.text, 700);
    text(what, px + 80 + w, fy + 30, 21, C.muted);
  });

  // Risk chart for the flagged candidate
  rr(g, px, 580, pw, 270, 22, C.panel, C.line);
  text('Risk · Arjun S.', px + 26, 620, 26, C.text, 700);
  const cx0 = px + 26, cy0 = 820, cw = pw - 52, ch = 160;
  g.strokeStyle = C.line; g.lineWidth = 1.5;
  for (let r = 0; r <= 3; r++) { g.beginPath(); g.moveTo(cx0, cy0 - (r * ch) / 3); g.lineTo(cx0 + cw, cy0 - (r * ch) / 3); g.stroke(); }
  const pts = 28;
  g.beginPath();
  for (let i = 0; i < pts; i++) {
    const p = i / (pts - 1);
    const rise = p > 0.7 ? (s.risk - 12) * ((p - 0.7) / 0.3) : 0;
    const v = 10 + 3 * Math.sin(i * 0.9 + t) + rise;
    const X = cx0 + p * cw, Y = cy0 - (Math.min(100, v) / 100) * ch;
    if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
  }
  g.strokeStyle = s.risk >= 50 ? C.red : C.sky; g.lineWidth = 4; g.stroke();

  // Bottom banner
  if (s.alert) {
    rr(g, 28, 870, W - 56, 70, 18, s.verdict ? 'rgba(30,111,240,.25)' : `rgba(239,68,68,${0.22 + 0.12 * pulse})`, s.verdict ? C.blue : C.red);
    text(s.verdict ? 'Proctor review · confirm or overrule with a reason' : 'CRITICAL · AI query detected · "time complexity of binary search" typed on chatgpt.com', 60, 906, 27, '#fff', 700);
  } else {
    rr(g, 28, 870, W - 56, 70, 18, 'rgba(34,197,94,.12)', 'rgba(34,197,94,.4)');
    text('All candidates verified · kiosk locked · answers autosaving', 60, 906, 27, '#bbf7d0', 600);
  }
}

function useConsoleTexture(reduce: boolean) {
  const { s, clock } = useExamStory(reduce);
  const story = useRef({ s, clock });
  story.current = { s, clock };
  const { canvas, texture } = useMemo(() => {
    // Drawn in 1560 × 962 units but stored at 70% to keep the per-frame texture upload small.
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * SCALE);
    canvas.height = Math.round(H * SCALE);
    canvas.getContext('2d')?.scale(SCALE, SCALE);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, []);
  const font = useMemo(() => getComputedStyle(document.body).fontFamily, []);
  const last = useRef(-1);
  // Redrawn about eight times a second so the scan lines and the alert pulse move.
  useFrame(({ clock: c }) => {
    const t = c.getElapsedTime();
    if (t - last.current < 0.125) return;
    last.current = t;
    const g = canvas.getContext('2d');
    if (!g) return;
    drawConsole(g, story.current.s, story.current.clock, t, font);
    texture.needsUpdate = true;
  });
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/* ---------------------------------------------------------------- laptop */

const ALUMINIUM = { color: '#d7deea', metalness: 0.85, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25 } as const;

/** 14 × 4 keys plus a space bar, instanced so the whole keyboard is one draw call. */
const KEYS: [number, number, number][] = [];
for (let row = 0; row < 4; row++) for (let col = 0; col < 14; col++) KEYS.push([-1.69 + col * 0.26, 0, -0.95 + row * 0.26]);

function Laptop({ reduce }: { reduce: boolean }) {
  const screen = useConsoleTexture(reduce);
  return (
    <group position={[0, -0.95, 0]}>
      <RoundedBox args={[4.2, 0.14, 2.8]} radius={0.06} smoothness={4}>
        <meshPhysicalMaterial {...ALUMINIUM} />
      </RoundedBox>
      <mesh position={[0, 0.071, -0.5]}>
        <boxGeometry args={[3.8, 0.004, 1.2]} />
        <meshStandardMaterial color="#1b2333" roughness={0.8} />
      </mesh>
      <Instances limit={KEYS.length + 1} position={[0, 0.09, 0]}>
        <boxGeometry args={[0.22, 0.03, 0.22]} />
        <meshStandardMaterial color="#2a3446" roughness={0.6} />
        {KEYS.map((p, i) => <Instance key={i} position={p} />)}
        <Instance position={[0, 0, 0.09]} scale={[7, 1, 1]} />
      </Instances>
      <RoundedBox args={[1.5, 0.006, 0.85]} radius={0.003} position={[0, 0.072, 0.78]}>
        <meshPhysicalMaterial color="#c7cfdc" metalness={0.6} roughness={0.35} />
      </RoundedBox>

      {/* Lid, hinged at the back edge and opened about 108° */}
      <group position={[0, 0.07, -1.38]} rotation={[-0.3, 0, 0]}>
        <RoundedBox args={[4.2, 2.7, 0.09]} radius={0.06} smoothness={4} position={[0, 1.35, 0]}>
          <meshPhysicalMaterial {...ALUMINIUM} />
        </RoundedBox>
        <mesh position={[0, 1.35, 0.047]}>
          <planeGeometry args={[4.08, 2.58]} />
          <meshStandardMaterial color="#05070c" roughness={0.3} metalness={0.2} />
        </mesh>
        <mesh position={[0, 1.37, 0.048]}>
          <planeGeometry args={[3.92, 2.42]} />
          <meshBasicMaterial map={screen} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.6, 0.05]}>
          <circleGeometry args={[0.025, 16]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- shield with an eye */

function useShieldGeometry() {
  return useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.62);
    s.bezierCurveTo(0.22, 0.5, 0.42, 0.46, 0.55, 0.46);
    s.bezierCurveTo(0.55, 0.0, 0.42, -0.42, 0, -0.68);
    s.bezierCurveTo(-0.42, -0.42, -0.55, 0.0, -0.55, 0.46);
    s.bezierCurveTo(-0.42, 0.46, -0.22, 0.5, 0, 0.62);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 6, curveSegments: 32 });
    g.center();
    return g;
  }, []);
}

/**
 * Wide elliptical orbit that never touches the laptop: it dips in front of the keyboard and
 * rises above the lid when it passes behind, so the shield is always in view.
 */
const ORBIT = { rx: 2.75, rz: 1.75, zShift: 0.35, y: 0.75, lift: 1.05 };

function Shield({ reduce }: { reduce: boolean }) {
  const holder = useRef<THREE.Group>(null);
  const iris = useRef<THREE.Mesh>(null);
  const geometry = useShieldGeometry();
  const camera = useThree((st) => st.camera);

  useFrame(({ clock, pointer }) => {
    if (!holder.current) return;
    const a = clock.getElapsedTime() * (reduce ? 0.18 : 0.42);
    holder.current.position.set(Math.cos(a) * ORBIT.rx, ORBIT.y - Math.sin(a) * ORBIT.lift, Math.sin(a) * ORBIT.rz + ORBIT.zShift);
    // Always face the viewer, with a gentle wobble.
    holder.current.lookAt(camera.position);
    holder.current.rotateY(Math.sin(a * 2) * 0.35);
    if (iris.current) {
      iris.current.position.x = THREE.MathUtils.lerp(iris.current.position.x, pointer.x * 0.06, 0.08);
      iris.current.position.y = THREE.MathUtils.lerp(iris.current.position.y, 0.04 + pointer.y * 0.05, 0.08);
    }
  });

  return (
    <group ref={holder} scale={0.62}>
      <mesh geometry={geometry}>
        <meshPhysicalMaterial color="#1E6FF0" metalness={0.25} roughness={0.12} transmission={0.55} thickness={0.6} ior={1.4} clearcoat={1} emissive="#0A4DA6" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0.04, 0.2]}>
        <torusGeometry args={[0.22, 0.035, 16, 64]} />
        <meshBasicMaterial color="#FFB020" toneMapped={false} />
      </mesh>
      <mesh ref={iris} position={[0, 0.04, 0.21]}>
        <sphereGeometry args={[0.09, 32, 32]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#38bdf8" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0, 0.5]} color="#38bdf8" intensity={3} distance={2.5} />
    </group>
  );
}

/* ---------------------------------------------------------------- scan rings */

function ScanRings({ reduce }: { reduce: boolean }) {
  const rings = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!rings.current) return;
    const t = clock.getElapsedTime() * (reduce ? 0.4 : 1);
    rings.current.children.forEach((ring, i) => {
      const k = (t * 0.35 + i / 3) % 1;
      ring.scale.setScalar(1 + k * 1.4);
      ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
    });
  });
  return (
    <group ref={rings} position={[0, -1.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i}>
          <ringGeometry args={[2.3, 2.34, 96]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.35} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------------------------------------------------------- scene */

function Rig({ reduce, children }: { reduce: boolean; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ pointer, clock }) => {
    if (!group.current) return;
    const idle = Math.sin(clock.getElapsedTime() * (reduce ? 0.15 : 0.4)) * 0.06;
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, -0.28 + pointer.x * 0.14 + idle, 0.05);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, 0.06 - pointer.y * 0.05, 0.05);
  });
  return <group ref={group}>{children}</group>;
}

/** Points the camera at the middle of the laptop and orbit, so the whole path stays in frame. */
function Aim() {
  const camera = useThree((st) => st.camera);
  useEffect(() => camera.lookAt(0, 0.45, 0), [camera]);
  return null;
}

/**
 * Interactive 3D hero: a laptop running the proctor's live console, with a shield orbiting it.
 * It keeps moving; for visitors who prefer reduced motion it moves slowly.
 */
export default function Hero3D({ reduce, active = true }: { reduce: boolean; active?: boolean }) {
  return (
    <div className="relative h-[400px] w-full sm:h-[470px]" role="img" aria-label="3D illustration: a laptop showing the proctor's live console where an AI query is flagged, with a glowing shield orbiting it">
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.7, 10.4], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} frameloop={active ? 'always' : 'never'}>
        <Aim />
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 6, 5]} intensity={1.6} />
        <pointLight position={[-5, 2, -3]} color="#1E6FF0" intensity={30} distance={14} />
        {/* Studio reflections from light panels, so no environment map is downloaded. */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 5, -6]} scale={[10, 3, 1]} />
          <Lightformer form="rect" intensity={1.4} color="#9cc8ff" position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[6, 4, 1]} />
          <Lightformer form="ring" intensity={1.2} color="#FFB020" position={[6, 2, 3]} rotation-y={-Math.PI / 2} scale={3} />
        </Environment>

        <Rig reduce={reduce}>
          <group scale={0.78}>
            <Float speed={reduce ? 0.4 : 1.2} rotationIntensity={0.06} floatIntensity={0.2}>
              <Laptop reduce={reduce} />
            </Float>
            <ScanRings reduce={reduce} />
          </group>
          <Shield reduce={reduce} />
        </Rig>

        <Sparkles count={60} scale={[9, 4.5, 6]} size={2} speed={reduce ? 0.1 : 0.35} color="#bfdbfe" opacity={0.8} />
        <ContactShadows position={[0, -0.86, 0]} opacity={0.45} scale={10} blur={2.6} far={3} color="#020817" frames={1} />
      </Canvas>
    </div>
  );
}
