import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Float } from '@react-three/drei';
import * as THREE from 'three';

function AIOrb() {
    const meshRef = useRef();
    const materialRef = useRef();

    const uniforms = useMemo(() => ({
        time: { value: 0 }
    }), []);

    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.rotation.x = state.clock.getElapsedTime() * 0.2;
            meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.3;
        }
        if (materialRef.current) {
            materialRef.current.uniforms.time.value = state.clock.getElapsedTime();
        }
    });

    return (
        <Float speed={2.5} rotationIntensity={1.5} floatIntensity={2}>
            <Sphere ref={meshRef} args={[1.5, 64, 64]} position={[0, 0, 0]}>
                <shaderMaterial
                    ref={materialRef}
                    attach="material"
                    uniforms={uniforms}
                    vertexShader={`
                        uniform float time;
                        varying vec2 vUv;
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        void main() {
                            vUv = uv;
                            vec3 pos = position;
                            // Add an organic wobble distortion
                            float noise = sin(pos.x * 3.0 + time) * cos(pos.y * 3.0 + time) * 0.15;
                            pos += normal * noise;
                            
                            vNormal = normalize(normalMatrix * normal);
                            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                            vViewPosition = -mvPosition.xyz;
                            
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    `}
                    fragmentShader={`
                        uniform float time;
                        varying vec2 vUv;
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        
                        // Iridescent cosine palette (Thin-film interference)
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
                            
                            // Swirling oil texture
                            float noise = sin(vUv.x * 12.0 + time) * cos(vUv.y * 12.0 - time * 0.5);
                            
                            // Fresnel term for viewing angle
                            float fresnel = dot(normal, viewDir);
                            fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
                            
                            // Oil thickness varies by fresnel and noise
                            float thickness = fresnel * 1.5 + noise * 0.3;
                            
                            // Get iridescent rainbow color
                            vec3 oilColor = palette(thickness - time * 0.2);
                            
                            // Bright, clean pearl/glass base
                            vec3 baseColor = vec3(0.95, 0.96, 0.98);
                            
                            // Blend oil based on viewing angle and swirling texture
                            float mixFactor = smoothstep(0.0, 1.0, fresnel + noise * 0.5);
                            vec3 finalColor = mix(baseColor, oilColor, mixFactor * 0.85);
                            
                            gl_FragColor = vec4(finalColor, 1.0);
                        }
                    `}
                />
            </Sphere>
        </Float>
    );
}

function Particles() {
    const particlesRef = useRef();

    useFrame((state) => {
        if (particlesRef.current) {
            particlesRef.current.rotation.y = state.clock.getElapsedTime() * 0.05;
        }
    });

    const positions = new Float32Array(500 * 3);
    for (let i = 0; i < 500 * 3; i++) {
        positions[i] = (Math.random() - 0.5) * 20;
    }

    return (
        <points ref={particlesRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={positions.length / 3}
                    array={positions}
                    itemSize={3}
                />
            </bufferGeometry>
            <pointsMaterial size={0.05} color="#111111" />
        </points>
    );
}

const InteractiveScene = () => {
    return (
        <Canvas
            camera={{ position: [0, 0, 5], fov: 50 }}
            gl={{ antialias: true, alpha: true }}
        >
            <AIOrb />
            <Particles />
        </Canvas>
    );
};

export default InteractiveScene;
