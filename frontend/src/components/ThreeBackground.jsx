import { useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Float, AdaptiveDpr, AdaptiveEvents } from '@react-three/drei';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const Shape = () => {
    const meshRef = useRef();
    const materialRef = useRef();
    const { viewport, mouse } = useThree();

    const isMobile = viewport.width < 5; 
    const responsiveScale = isMobile ? 0.55 : 1.5;

    const uniforms = useMemo(() => ({
        time: { value: 0 }
    }), []);

    useFrame((state, delta) => {
        if (!meshRef.current) return;
        meshRef.current.rotation.x += delta * 0.2;
        meshRef.current.rotation.y += delta * 0.25;
        
        const targetX = (mouse.x * viewport.width) / 10;
        const targetY = (mouse.y * viewport.height) / 10;
        meshRef.current.position.x += (targetX - meshRef.current.position.x) * 0.05;
        meshRef.current.position.y += (targetY - meshRef.current.position.y) * 0.05;

        if (materialRef.current) {
            materialRef.current.uniforms.time.value = state.clock.getElapsedTime();
        }
    });

    return (
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
            <mesh ref={meshRef} position={[0, 0, 0]} scale={responsiveScale}>
                <torusKnotGeometry args={[1, 0.35, 128, 32]} />
                <shaderMaterial
                    ref={materialRef}
                    attach="material"
                    uniforms={uniforms}
                    vertexShader={`
                        varying vec2 vUv;
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        void main() {
                            vUv = uv;
                            vNormal = normalize(normalMatrix * normal);
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                            vViewPosition = -mvPosition.xyz;
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    `}
                    fragmentShader={`
                        uniform float time;
                        varying vec2 vUv;
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        
                        vec3 palette(float t) {
                            vec3 a = vec3(0.5, 0.5, 0.5);
                            vec3 b = vec3(0.5, 0.5, 0.5);
                            vec3 c = vec3(1.0, 1.0, 1.0);
                            vec3 d = vec3(0.263, 0.416, 0.557);
                            return a + b * cos(6.28318 * (c * t + d));
                        }

                        void main() {
                            vec3 normal = normalize(vNormal);
                            vec3 viewDir = normalize(vViewPosition);
                            
                            float noise = sin(vUv.x * 15.0 + time * 1.2) * cos(vUv.y * 15.0 - time * 0.8);
                            
                            float fresnel = dot(normal, viewDir);
                            fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
                            
                            float thickness = fresnel * 1.8 + noise * 0.4;
                            vec3 oilColor = palette(thickness - time * 0.3);
                            
                            vec3 baseColor = vec3(0.95, 0.96, 0.98);
                            float mixFactor = smoothstep(0.0, 1.0, fresnel + noise * 0.5);
                            
                            gl_FragColor = vec4(mix(baseColor, oilColor, mixFactor * 0.85), 1.0);
                        }
                    `}
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
                
                <Shape />
                <ParticleSystem />
            </Canvas>
        </div>
    );
};

export default ThreeBackground;
