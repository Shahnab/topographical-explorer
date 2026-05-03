import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Environment, Line } from '@react-three/drei';
import * as THREE from 'three';
import { ElevationData } from './lib/elevationService';
import { scaleLinear } from 'd3-scale';

interface Map3DProps {
  data: ElevationData;
  rivers?: any[];
  states?: any[];
}

const colorScale = scaleLinear<string>()
  .domain([0, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1])
  .range(['#f5e4c6', '#eab57f', '#dda570', '#d68d5a', '#cd7048', '#ba553d', '#9f3622', '#801c11']);

// Map math helper
function getPointMetrics(data: ElevationData) {
    const { gridWidth, gridHeight, aspectRatio, minPxX, actualMinPxY, pxWidth, pxHeight, z, elevation, minElev, maxElev, mask } = data;

    const mapSize = 12;
    let physWidth = mapSize;
    let physHeight = mapSize;
    if (aspectRatio > 1) {
        physHeight = mapSize / aspectRatio;
    } else {
        physWidth = mapSize * aspectRatio;
    }

    // Exaggerate vertical differences more
    const elevRange = Math.max(20, maxElev - minElev);
    const scaleY = 3.0 / elevRange;

    const getPoint = (lon: number, lat: number, zOff: number = 0): [number, number, number] => {
        const pixelX = ((lon + 180) / 360) * Math.pow(2, z) * 256;
        const sinLat = Math.sin((lat * Math.PI) / 180);
        const MathLog = Math.log((1 + sinLat) / (1 - sinLat));
        const safeLog = isNaN(MathLog) ? 0 : MathLog; 
        const pixelY = (0.5 - safeLog / (4 * Math.PI)) * Math.pow(2, z) * 256;
        
        const gx = ((pixelX - minPxX) / pxWidth) * gridWidth;
        const gy = ((pixelY - actualMinPxY) / pxHeight) * gridHeight;
        
        const numBoxesX = 100;
        const numBoxesY = Math.max(1, Math.floor(gridHeight * (numBoxesX / gridWidth)));
        const cellW = gridWidth / numBoxesX;
        const cellH = gridHeight / numBoxesY;
        
        const bx = Math.floor(gx / cellW);
        const by = Math.floor(gy / cellH);
        
        const startX = Math.floor(bx * cellW);
        const endX = Math.floor((bx + 1) * cellW);
        const startY = Math.floor(by * cellH);
        const endY = Math.floor((by + 1) * cellH);
        
        let sumElev = 0;
        let validCount = 0;
        
        for (let y = Math.max(0, startY); y < Math.min(gridHeight, endY); y++) {
            for (let x = Math.max(0, startX); x < Math.min(gridWidth, endX); x++) {
                const i = y * gridWidth + x;
                if (mask[i] > 128) {
                    sumElev += elevation[i];
                    validCount++;
                }
            }
        }
        
        let e = validCount > 0 ? sumElev / validCount : minElev;
        
        const physX = (gx / gridWidth - 0.5) * physWidth;
        const physZ = (gy / gridHeight - 0.5) * physHeight; 
        const physY = (e - minElev) * scaleY + zOff; 
        
        return [physX, physY, physZ];
    };

    return { physWidth, physHeight, scaleY, getPoint };
}

function TerrainMesh({ data }: { data: ElevationData }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const instanceData = useMemo(() => {
    const { gridWidth, gridHeight, mask, elevation, minElev, maxElev } = data;
    const { physWidth, physHeight, scaleY } = getPointMetrics(data);
    
    // We want a chunky block effect like the reference image
    const numBoxesX = 100; // Increased number of bars for higher resolution
    const numBoxesY = Math.max(1, Math.floor(gridHeight * (numBoxesX / gridWidth)));
    
    const blockWidth = physWidth / numBoxesX;
    const blockDepth = physHeight / numBoxesY;
    const gap = 0.02; // gap for distinct bars
    
    const cellW = gridWidth / numBoxesX;
    const cellH = gridHeight / numBoxesY;
    
    const instances = [];
    const cScale = scaleLinear<number>().domain([minElev, maxElev]).range([0, 1]);
    const tmpColor = new THREE.Color();
    
    for (let by = 0; by < numBoxesY; by++) {
      for (let bx = 0; bx < numBoxesX; bx++) {
        // Sample cell
        let sumElev = 0;
        let count = 0;
        let validCount = 0;
        
        const startX = Math.floor(bx * cellW);
        const endX = Math.floor((bx + 1) * cellW);
        const startY = Math.floor(by * cellH);
        const endY = Math.floor((by + 1) * cellH);
        
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = y * gridWidth + x;
            count++;
            if (mask[i] > 128) {
              sumElev += elevation[i];
              validCount++;
            }
          }
        }
        
        // Only output a block if more than 30% of the grid cell is inside the bounds, or if it's small, any valid counts.
        if (validCount > count * 0.3 || validCount > 0) {
          const avgElev = validCount > 0 ? sumElev / validCount : minElev;
          
          const physX = ((bx + 0.5) / numBoxesX - 0.5) * physWidth;
          const physZ = ((by + 0.5) / numBoxesY - 0.5) * physHeight;
          
          const baseDepth = -0.5;
          const height = Math.max(0.01, (avgElev - minElev) * scaleY - baseDepth);
          const posY = baseDepth + height / 2;
          
          const t = cScale(avgElev);
          tmpColor.set(colorScale(isNaN(t) ? 0.5 : t));
          
          instances.push({
            position: [physX, posY, physZ],
            scale: [blockWidth * (1 - gap), height, blockDepth * (1 - gap)],
            color: tmpColor.clone()
          });
        }
      }
    }
    
    return instances;
  }, [data]);

  React.useLayoutEffect(() => {
    if (meshRef.current) {
       const mesh = meshRef.current;
       const dummy = new THREE.Object3D();
       instanceData.forEach((inst, i) => {
           dummy.position.set(inst.position[0], inst.position[1], inst.position[2]);
           dummy.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
           dummy.updateMatrix();
           mesh.setMatrixAt(i, dummy.matrix);
           mesh.setColorAt(i, inst.color);
       });
       mesh.instanceMatrix.needsUpdate = true;
       if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [instanceData]);

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, instanceData.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.9} metalness={0.05} />
    </instancedMesh>
  );
}

function RiversLayer({ data, rivers }: { data: ElevationData, rivers: any[] }) {
    const tubes = useMemo(() => {
        if (!rivers) return [];
        const { getPoint } = getPointMetrics(data);
        const paths: THREE.CatmullRomCurve3[] = [];
        
        for (const r of rivers) {
             if (!r.geometry || r.geometry.length < 2) continue;
             if (paths.length >= 50) break; // cap for performance
             const pts = r.geometry.map((g: any) => {
                 const pt = getPoint(g.lon, g.lat, 0.08); // Slight offset
                 return new THREE.Vector3(pt[0], pt[1], pt[2]);
             });
             
             paths.push(new THREE.CatmullRomCurve3(pts));
        }
        return paths;
    }, [rivers, data]);
    
    const materialRef = useRef<THREE.MeshStandardMaterial>(null);
    useFrame((state) => {
        if (materialRef.current && materialRef.current.userData.shader) {
            materialRef.current.userData.shader.uniforms.uTime.value = state.clock.getElapsedTime();
        }
    });

    const onBeforeCompile = useMemo(() => {
        return (shader: any) => {
            shader.uniforms.uTime = { value: 0 };
            
            shader.vertexShader = `
                varying vec2 vRiverUv;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `#include <begin_vertex>
                 vRiverUv = uv;
                `
            );

            shader.fragmentShader = `
                uniform float uTime;
                varying vec2 vRiverUv;
            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <color_fragment>`,
                `#include <color_fragment>
                 float flow = sin(vRiverUv.x * 200.0 - uTime * 20.0) * 0.5 + 0.5;
                 diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.9, 1.0), flow * 0.6);
                `
            );
            
            if (materialRef.current) {
                materialRef.current.userData.shader = shader;
            }
        };
    }, []);

    const sharedMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x3498db,
            roughness: 0.2,
            metalness: 0.3,
            transparent: true,
            opacity: 0.85,
        });
        mat.onBeforeCompile = onBeforeCompile;
        return mat;
    }, [onBeforeCompile]);

    React.useEffect(() => {
        materialRef.current = sharedMaterial;
    }, [sharedMaterial]);
    
    return (
        <group>
            {tubes.map((curve, i) => (
                <mesh key={i} castShadow receiveShadow material={sharedMaterial}>
                     <tubeGeometry args={[curve, Math.min(curve.points.length * 3, 80), 0.04, 5, false]} />
                </mesh>
            ))}
        </group>
    );
}

function StateBoundariesLayer({ data, states }: { data: ElevationData, states: any[] }) {
    const points = useMemo(() => {
        if (!states || states.length === 0) return null;
        const { getPoint } = getPointMetrics(data);
        // Collect every segment as a pair of [number,number,number] tuples.
        // drei's <Line segments> treats consecutive pairs as independent line segments.
        const pts: [number, number, number][] = [];

        const addPolyline = (geometry: any[]) => {
            if (geometry.length < 2) return;
            for (let i = 0; i < geometry.length - 1; i++) {
                pts.push(getPoint(geometry[i].lon, geometry[i].lat, 0.4));
                pts.push(getPoint(geometry[i + 1].lon, geometry[i + 1].lat, 0.4));
            }
        };

        for (const s of states) {
            if (s.type === 'way' && s.geometry) {
                addPolyline(s.geometry);
            } else if (s.type === 'relation' && s.members) {
                for (const m of s.members) {
                    if (m.type === 'way' && m.geometry) addPolyline(m.geometry);
                }
            }
        }

        return pts.length >= 2 ? pts : null;
    }, [states, data]);

    if (!points) return null;

    return (
        <Line
            points={points}
            segments
            color="#ffffff"
            lineWidth={1.2}
            transparent
            opacity={0.9}
            depthWrite={false}
        />
    );
}

function extractGeoJSONLines(geometry: any): number[][][] {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates;
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(1);
    if (geometry.type === 'LineString') return [geometry.coordinates];
    if (geometry.type === 'MultiLineString') return geometry.coordinates;
    if (geometry.type === 'FeatureCollection') return geometry.features.map((f:any) => extractGeoJSONLines(f.geometry)).flat();
    if (geometry.type === 'Feature') return extractGeoJSONLines(geometry.geometry);
    return [];
}

function BorderLayer({ data }: { data: ElevationData }) {
   const lines = useMemo(() => {
       const { getPoint } = getPointMetrics(data);
       const rings = extractGeoJSONLines(data.geojson);
       return rings.map(ring => ring.map((coord: number[]) => getPoint(coord[0], coord[1], 0.15)));
   }, [data]);

   return (
       <group>
           {lines.map((pts, i) => (
               <Line key={i} points={pts} color="#000000" lineWidth={2.5} transparent opacity={0.8} />
           ))}
       </group>
   );
}

function CameraAdjuster({ data }: { data: ElevationData }) {
    const { camera, size, controls } = useThree();
    useEffect(() => {
        const { physWidth, physHeight } = getPointMetrics(data);
        const cam = camera as THREE.PerspectiveCamera;

        // Fixed viewing angle matching the screenshot:
        // ~38° elevation above horizontal, ~18° azimuth east of south
        const elevRad = 38 * (Math.PI / 180);
        const azimRad = 18 * (Math.PI / 180);
        const targetY = 1.5;
        // Approximate max block height for vertical extent computation
        const maxBlockH = 3.5;

        // Project the map extents onto the view plane at this elevation angle
        // so we can compute the minimum distance that fits the country in frame
        const fovYRad = (cam.fov * Math.PI) / 180;
        const aspect = size.width / size.height;
        const fovXRad = 2 * Math.atan(Math.tan(fovYRad / 2) * aspect);

        // Visible height in world-space at elevation angle
        const projectedH = physHeight * Math.cos(elevRad) + maxBlockH * Math.sin(elevRad);
        const projectedW = physWidth;

        // Distance required to fit each axis (with 18% padding)
        const distForH = (projectedH / 2) / Math.tan(fovYRad / 2) * 1.18;
        const distForW = (projectedW / 2) / Math.tan(fovXRad / 2) * 1.18;
        const dist = Math.max(distForH, distForW);

        const camX = dist * Math.cos(elevRad) * Math.sin(azimRad);
        const camY = targetY + dist * Math.sin(elevRad);
        const camZ = dist * Math.cos(elevRad) * Math.cos(azimRad);

        camera.position.set(camX, camY, camZ);
        camera.lookAt(0, targetY, 0);
        camera.updateProjectionMatrix();

        // Sync OrbitControls so it picks up the new position as its baseline
        if (controls) {
            (controls as any).target.set(0, targetY, 0);
            (controls as any).update();
        }
    }, [data, camera, size, controls]);
    return null;
}

export default function Map3D({ data, rivers, states }: Map3DProps) {
  const [autoRotate, setAutoRotate] = React.useState(false);

  return (
    <div className="w-full h-full bg-[#E5E5E5] relative cursor-grab active:cursor-grabbing">
      <Canvas shadows camera={{ position: [0, 8, 10], fov: 40 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <CameraAdjuster data={data} />
        <color attach="background" args={['#E5E5E5']} />
        
        {/* Soft lighting */}
        <ambientLight intensity={0.45} />
        <directionalLight 
            castShadow 
            position={[10, 20, 15]} 
            intensity={1.5} 
            shadow-mapSize={[4096, 4096]} 
            shadow-camera-left={-15}
            shadow-camera-right={15}
            shadow-camera-top={15}
            shadow-camera-bottom={-15}
            shadow-bias={-0.0005}
        />
        <directionalLight position={[-10, 5, -5]} intensity={0.3} color="#e0eaff" />

        <group position={[0, 0, 0]}>
            <TerrainMesh data={data} key={`terrain-${data.gridWidth}-${data.gridHeight}-${data.minElev}`} />
            <BorderLayer data={data} key={`border-${data.minElev}`} />
            <RiversLayer data={data} rivers={rivers || []} key={`rivers-${rivers?.length}`} />
            <StateBoundariesLayer data={data} states={states || []} key={`states-${states?.length}`} />
            
            {/* Flat base shadow plane */}
            <ContactShadows position={[0, -0.51, 0]} opacity={0.7} scale={30} blur={2.5} far={4} color="#000000" resolution={512} />
            
            {/* Base map layer (a solid plane under the blocks) to catch standard shadows and define the floor */}
            <mesh position={[0, -0.52, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow>
               <planeGeometry args={[50, 50]} />
               <meshStandardMaterial color="#EAEAEA" roughness={1} />
            </mesh>
        </group>

        <OrbitControls 
            target={[0, 1.5, 0]} 
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={2} 
            maxDistance={60} 
            makeDefault 
            autoRotate={autoRotate}
            autoRotateSpeed={0.5}
        />
        
        <Environment preset="city" />
      </Canvas>
      
      {/* Auto-rotate Toggle */}
      <div className="absolute bottom-4 sm:bottom-6 left-3 sm:left-6 flex items-center gap-2 pointer-events-auto select-none">
        <label className="flex items-center cursor-pointer">
          <div className="relative">
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={autoRotate} 
              onChange={(e) => setAutoRotate(e.target.checked)} 
            />
            <div className={`block w-10 h-6 rounded-full transition-colors ${autoRotate ? 'bg-[#9f3622]' : 'bg-gray-300'}`}></div>
            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition transform ${autoRotate ? 'translate-x-4' : ''} shadow-sm`}></div>
          </div>
          <div className="ml-3 text-gray-700 font-medium text-sm hidden sm:block">Auto-Rotate</div>
        </label>
      </div>

      <div className="absolute bottom-4 sm:bottom-6 right-3 sm:right-6 pointer-events-none flex flex-col items-end">
          <Legend min={data.minElev} max={data.maxElev} />
          <div className="text-gray-500/80 tracking-wide text-xs font-semibold mt-2 mr-1">Concept by Shahnab</div>
      </div>
    </div>
  );
}

function Legend({ min, max }: { min: number, max: number }) {
    const steps = 6;
    const items = Array.from({ length: steps }).map((_, i) => {
        const t = i / (steps - 1);
        return {
            color: colorScale(t),
            val: Math.round(min + t * (max - min))
        }
    });

    return (
        <div className="bg-[#E5E5E5]/90 backdrop-blur-md p-3 sm:p-4 shadow-xl border border-black/10 flex flex-col gap-1 w-36 sm:w-48 font-sans">
            <h4 className="font-bold text-xs sm:text-sm mb-1 sm:mb-2 text-gray-800">Mean Elevation</h4>
            {items.map((item, i) => (
                <div key={i} className="flex items-center text-[0.65rem] sm:text-xs text-gray-700">
                    <div className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3 border border-black/20 shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="flex-1">{item.val.toLocaleString()} m</span>
                </div>
            ))}
        </div>
    );
}


