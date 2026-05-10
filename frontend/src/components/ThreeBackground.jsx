import { useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Float, MeshTransmissionMaterial, AdaptiveDpr, AdaptiveEvents } from '@react-three/drei';
import * as THREE from 'three';
import Lenis from 'lenis';

// Highly optimized shape component
const Shape = () => {
    const meshRef = useRef();
    const { viewport, mouse } = useThree();

    // Responsively scale the model based on viewport width
    const isMobile = viewport.width < 5; // viewport.width is in threejs units
    const responsiveScale = isMobile ? 0.75 : 1.4;

    useFrame((state, delta) => {
        if (!meshRef.current) return;
        
        // Gentle, smooth rotation using delta for consistent speed regardless of FPS
        meshRef.current.rotation.x += delta * 0.1;
        meshRef.current.rotation.y += delta * 0.15;
        
        // Lightweight parallax effect
        const targetX = (mouse.x * viewport.width) / 12;
        const targetY = (mouse.y * viewport.height) / 12;
        
        meshRef.current.position.x += (targetX - meshRef.current.position.x) * 0.03;
        meshRef.current.position.y += (targetY - meshRef.current.position.y) * 0.03;
    });

    return (
        <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.5}>
            <mesh ref={meshRef} position={[0, 0, 0]} scale={responsiveScale}>
                {/* Optimized geometry segments */}
                <torusKnotGeometry args={[1, 0.35, 96, 24]} />
                <MeshTransmissionMaterial 
                    backside
                    samples={4} 
                    thickness={0.6} 
                    chromaticAberration={0.08}
                    anisotropy={0.5}
                    distortion={0.4}
                    distortionScale={0.5}
                    temporalDistortion={0.1}
                    iridescence={0.3}
                    iridescenceIOR={1.1}
                    iridescenceThicknessRange={[0, 1000]}
                    color="#ffffff" 
                    attenuationDistance={0.7}
                    attenuationColor="#ff4d4d" 
                    transparent
                    roughness={0.02}
                    ior={1.45}
                />
            </mesh>
        </Float>
    );
};

const ParticleSystem = () => {
    const { viewport } = useThree();
    const count = viewport.width < 5 ? 30 : 50; // Fewer particles on mobile
    const mesh = useRef();
    
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 25;
            const y = (Math.random() - 0.5) * 25;
            const z = (Math.random() - 0.5) * 15;
            temp.push({ pos: new THREE.Vector3(x, y, z), speed: Math.random() * 0.005 + 0.002 });
        }
        return temp;
    }, [count]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame(() => {
        if (!mesh.current) return;
        particles.forEach((p, i) => {
            p.pos.y += p.speed;
            if (p.pos.y > 12) p.pos.y = -12;
            
            dummy.position.copy(p.pos);
            dummy.updateMatrix();
            mesh.current.setMatrixAt(i, dummy.matrix);
        });
        mesh.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[null, null, count]} frustumCulled={false}>
            <sphereGeometry args={[0.012, 6, 6]} />
            <meshBasicMaterial color="#ff4d4d" transparent opacity={0.25} />
        </instancedMesh>
    );
};

const ThreeBackground = () => {
    useEffect(() => {
        const lenis = new Lenis();
        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);
        return () => {
            lenis.destroy();
        };
    }, []);

    return (
        <div className="three-bg-wrapper" style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh', 
            zIndex: 0, 
            pointerEvents: 'none',
            background: 'var(--bg)'
        }}>
            <Canvas 
                camera={{ position: [0, 0, 8], fov: 45 }} 
                gl={{ 
                    antialias: true,
                    alpha: true,
                    powerPreference: "high-performance",
                    stencil: false,
                    depth: true
                }}
                dpr={[1, 2]}
            >
                <AdaptiveDpr pixelated />
                <AdaptiveEvents />
                
                <ambientLight intensity={1.8} /> 
                <spotLight position={[15, 25, 15]} angle={0.5} penumbra={1} intensity={4} castShadow={false} />
                <pointLight position={[-15, -15, -10]} intensity={2.5} color="#ff4d4d" />
                
                <Shape />
                <ParticleSystem />
                
                <Environment preset="studio" />
            </Canvas>
        </div>
    );
};

export default ThreeBackground;
