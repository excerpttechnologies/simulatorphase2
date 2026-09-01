'use client'

import { ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'

function Model() {
  const { scene } = useGLTF('/wafer_rack_module.glb')

  return <primitive object={scene} />
}

export default function WaferRack() {
  return (
    <Canvas camera={{ position: [1.5, 1.2, 1.5], fov: 45 }} dpr={[1, 2]} shadows>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 2]} intensity={1.3} castShadow />
      <Model />
      <ContactShadows position={[0, -0.78, 0]} opacity={0.5} scale={4} blur={2} />
      <Environment preset="studio" />
      <OrbitControls makeDefault />
    </Canvas>
  )
}

useGLTF.preload('/wafer_rack_module.glb')
