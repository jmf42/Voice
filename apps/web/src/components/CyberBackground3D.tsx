import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 3D Scene containing the object, material, and animations
function CyberScene() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const mesh = meshRef.current;

    // Base continuous floating/breathing animation
    mesh.rotation.x += delta * 0.08;
    mesh.rotation.y += delta * 0.12;

    // Handheld camera feel / breathing
    state.camera.position.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.12;
    state.camera.position.x = Math.cos(state.clock.elapsedTime * 0.25) * 0.06;
  });

  return (
    <mesh ref={meshRef}>
      {/* Complex geometric shape: TorusKnot represents digital innovation */}
      <torusKnotGeometry args={[2, 0.48, 56, 8]} />
      {/* Dark metallic material — lightweight, no transmission pass */}
      <meshStandardMaterial
        color="#080818"
        metalness={0.95}
        roughness={0.25}
        envMapIntensity={0.6}
      />
    </mesh>
  );
}

interface CyberBackground3DProps {
  children: React.ReactNode;
  /** Whether to use Drei's ScrollControls for scroll-linked 3D animations */
  isScrollable?: boolean;
  /** Fixed overlay elements (like a Navbar) that sit above the 3D scene but don't scroll */
  overlay?: React.ReactNode;
}

export function CyberBackground3D({
  children,
  isScrollable = false,
  overlay,
}: CyberBackground3DProps) {
  const [liteMode, setLiteMode] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowCpu = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const lowerMemory =
      'deviceMemory' in navigator &&
      Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) <= 8;
    setLiteMode(reducedMotion || lowCpu || coarsePointer || lowerMemory);
  }, []);

  return (
    <div className="relative w-full h-screen bg-gradient-to-br from-[#020202] to-[#0A0A0A] overflow-hidden text-white font-sans">
      {!liteMode ? (
        <div className="absolute inset-0 z-0">
          <Canvas
            gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
            dpr={1}
            camera={{ position: [0, 0, 8], fov: 45 }}
          >
            <ambientLight intensity={0.12} />
            <directionalLight position={[5, 5, 5]} intensity={1.8} color="#00f3ff" />
            <pointLight position={[-5, -5, -5]} intensity={1.9} color="#9d00ff" />
            <CyberScene />
          </Canvas>
        </div>
      ) : (
        <div className="absolute inset-0 z-0 cyber-lite-bg" />
      )}

      {overlay && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="pointer-events-auto">{overlay}</div>
        </div>
      )}

      <div className="absolute inset-0 z-10 w-full h-full overflow-auto pointer-events-auto gpu-scroll-shell">
        <div className={isScrollable ? 'scroll-page-stack' : undefined}>{children}</div>
      </div>
    </div>
  );
}
