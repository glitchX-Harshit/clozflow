import { useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Float, AdaptiveDpr, AdaptiveEvents } from '@react-three/drei';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Simplified Shape to debug visibility
const Shape = () => {
    const meshRef = useRef();
    const { viewport, mouse } = useThree();

    const isMobile = viewport.width < 5; 
    const responsiveScale = isMobile ? 0.8 : 1.5;

    useFrame((state, delta) => {
        if (!meshRef.current) return;
        meshRef.current.rotation.x += delta * 0.2;
        meshRef.current.rotation.y += delta * 0.25;
        
        const targetX = (mouse.x * viewport.width) / 10;
        const targetY = (mouse.y * viewport.height) / 10;
        meshRef.current.position.x += (targetX - meshRef.current.position.x) * 0.05;
        meshRef.current.position.y += (targetY - meshRef.current.position.y) * 0.05;

        // LIGHTER VIBRANT TECH PALETTE
        const time = state.clock.getElapsedTime();
        const phase = (Math.sin(time * 0.3) + 1) / 2;
        
        const cobalt = new THREE.Color('#3b82f6'); 
        const cyan = new THREE.Color('#00f2ff'); 
        const sky = new THREE.Color('#7dd3fc'); 
        const teal = new THREE.Color('#00d4ff');
        
        let mixedColor;
        if (phase < 0.33) {
            mixedColor = cobalt.clone().lerp(cyan, phase * 3);
        } else if (phase < 0.66) {
            mixedColor = cyan.clone().lerp(sky, (phase - 0.33) * 3);
        } else {
            mixedColor = sky.clone().lerp(teal, (phase - 0.66) * 3);
        }
        
        meshRef.current.material.color = mixedColor;
        meshRef.current.material.emissive = mixedColor;
        meshRef.current.material.emissiveIntensity = 0.4;
    });

    return (
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
            <mesh ref={meshRef} position={[0, 0, 0]} scale={responsiveScale}>
                <torusKnotGeometry args={[1, 0.35, 128, 32]} />
                <meshStandardMaterial 
                    color="#1e40af" 
                    roughness={0.1} 
                    metalness={0.8}
                    emissive="#1e40af"
                    emissiveIntensity={0.2}
                />
            </mesh>
        </Float>
    );
};

const ParticleSystem = () => {
    const { viewport } = useThree();
    const count = 40;
    const mesh = useRef();
    
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 20;
            const y = (Math.random() - 0.5) * 20;
            const z = (Math.random() - 0.5) * 10;
            temp.push({ pos: new THREE.Vector3(x, y, z), speed: Math.random() * 0.01 + 0.005 });
        }
        return temp;
    }, [count]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame(() => {
        if (!mesh.current) return;
        particles.forEach((particle, i) => {
            particle.pos.y += particle.speed;
            if (particle.pos.y > 10) particle.pos.y = -10;
            dummy.position.copy(particle.pos);
            dummy.updateMatrix();
            mesh.current.setMatrixAt(i, dummy.matrix);
        });
        mesh.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[null, null, count]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
        </instancedMesh>
    );
};

const ThreeBackground = () => {
    const containerRef = useRef(null);

    useEffect(() => {
        // Visibility Logic - using a more robust check
        let ctx = gsap.context(() => {
            const triggerElement = document.querySelector('.crowd__section');
            if (triggerElement) {
                gsap.to(containerRef.current, {
                    opacity: 0,
                    scrollTrigger: {
                        trigger: triggerElement,
                        start: 'top 80%',
                        end: 'bottom 20%',
                        toggleActions: 'play reverse play reverse'
                    }
                });
            }
        }, containerRef);

        return () => {
            ctx.revert();
        };
    }, []);

    return (
        <div 
            ref={containerRef}
            className="three-bg-fixed-container"
            style={{ 
                position: 'fixed', 
                top: 0, 
                left: 0, 
                width: '100vw', 
                height: '100vh', 
                zIndex: 0, 
                pointerEvents: 'none',
                opacity: 1
            }}
        >
            <Canvas 
                camera={{ position: [0, 0, 8], fov: 45 }} 
                gl={{ 
                    antialias: true,
                    alpha: true,
                    powerPreference: "high-performance",
                    preserveDrawingBuffer: true
                }}
                dpr={[1, 2]}
            >
                <AdaptiveDpr pixelated />
                <AdaptiveEvents />
                
                <ambientLight intensity={1} /> 
                <pointLight position={[10, 10, 10]} intensity={2.5} color="#3b82f6" />
                <pointLight position={[-10, -10, 5]} intensity={1.5} color="#1e40af" />
                
                <Shape />
                <ParticleSystem />
                
                <Environment preset="city" />
            </Canvas>
        </div>
    );
};

export default ThreeBackground;
